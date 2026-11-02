/**
 * Doc-cover pipeline for the material library (素材库): one async resolver
 * per doc kind (pdf / epub / html / excalidraw / canvas), fronted by a cache
 * keyed by path + mtime with in-flight dedup, so tiles, probes and the warm
 * pass can all ask for the same cover without duplicate work.
 *
 * The renderer owns one DocCoverCache per view; the resolver is injectable
 * (MaterialRenderContext.docCoverResolver) so the node harness can test the
 * wiring with deterministic fake covers.
 */

import type { App, TFile } from 'obsidian';
import type { MaterialItem } from './material-model';
import { epubCoverDataUrl } from './material-epub';
import { canvasThumbSvg, excalidrawThumbSvg, svgDataUrl } from './material-sketch';
import { htmlMetaImage, htmlShotSvg, HTML_SHOT_WIDTH, HTML_SHOT_HEIGHT } from './material-html';
import { pdfFirstPageCover } from './material-pdf';
import { resolveVaultImage } from './banner';

export interface DocCover {
	src: string;
	/** Known aspect (PDF page, fixed viewport). Absent = measure by probing
	 *  the generated image (EPUB cover bytes, sketch SVGs). */
	aspect?: number;
}

export type DocCoverResolver = (item: MaterialItem, app: App) => Promise<DocCover | null>;

/** Normalize a relative reference against the owning file's folder. */
function resolveRelativePath(fromPath: string, ref: string): string {
	const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
	const parts = (dir + ref.replace(/^\.\//, '')).split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') stack.pop();
		else stack.push(part);
	}
	return stack.join('/');
}

function fileOf(app: App, path: string): TFile | null {
	return app.vault.getFileByPath(path) ?? null;
}

async function readText(app: App, file: TFile): Promise<string | null> {
	try {
		return await app.vault.read(file);
	} catch {
		return null;
	}
}

async function readBinary(app: App, file: TFile): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await app.vault.readBinary(file));
	} catch {
		return null;
	}
}

/** Excalidraw's auto-export writes a same-named .svg/.png next to the source
 * (note.excalidraw.md → note.excalidraw.svg) — a pixel-perfect cover when it
 * exists, so prefer it over re-drawing the scene. */
function excalidrawExportCover(app: App, path: string): string | null {
	const file = fileOf(app, path);
	if (!file) return null;
	const candidates = [`${file.parent?.path ? file.parent.path + '/' : ''}${file.basename}.svg`,
		`${file.parent?.path ? file.parent.path + '/' : ''}${file.basename}.png`];
	for (const candidate of candidates) {
		if (fileOf(app, candidate)) return resolveVaultImage(app, candidate) ?? null;
	}
	return null;
}

/** HTML declared images: http(s)/data pass through; vault-relative refs
 *  resolve through the adapter. */
function htmlImageSrc(app: App, path: string, ref: string): string | null {
	if (/^(https?:|data:)/i.test(ref)) return ref;
	const tryPaths = [ref, resolveRelativePath(path, ref)];
	for (const p of tryPaths) {
		if (fileOf(app, p)) return resolveVaultImage(app, p) ?? null;
	}
	return null;
}

/** The shipped resolver: one branch per doc kind, each all-or-null. */
export const defaultDocCoverResolver: DocCoverResolver = async (item, app): Promise<DocCover | null> => {
	const file = fileOf(app, item.path);
	if (!file) return null;
	switch (item.kind) {
		case 'pdf': {
			const bytes = await readBinary(app, file);
			if (!bytes) return null;
			const cover = await pdfFirstPageCover(bytes);
			return cover ?? null;
		}
		case 'epub': {
			const bytes = await readBinary(app, file);
			if (!bytes) return null;
			const src = await epubCoverDataUrl(bytes);
			return src ? { src } : null;
		}
		case 'canvas': {
			const text = await readText(app, file);
			if (text == null) return null;
			const svg = canvasThumbSvg(text);
			return svg ? { src: svgDataUrl(svg) } : null;
		}
		case 'excalidraw': {
			const exported = excalidrawExportCover(app, item.path);
			if (exported) return { src: exported };
			const text = await readText(app, file);
			if (text == null) return null;
			const svg = excalidrawThumbSvg(text);
			return svg ? { src: svgDataUrl(svg) } : null;
		}
		case 'html': {
			const text = await readText(app, file);
			if (text == null) return null;
			const meta = htmlMetaImage(text);
			if (meta) {
				const src = htmlImageSrc(app, item.path, meta);
				if (src) return { src };
			}
			const svg = htmlShotSvg(text);
			return svg ? { src: svgDataUrl(svg), aspect: HTML_SHOT_WIDTH / HTML_SHOT_HEIGHT } : null;
		}
		default:
			return null;
	}
};

interface CacheEntry {
	mtime: number;
	cover: DocCover | null;
}

/** Path-keyed cover cache with in-flight dedup and mtime invalidation.
 *  `get` is the synchronous cache read the render loop needs (undefined =
 *  not resolved yet, null = resolved to "no cover"); `ensure` generates. */
export class DocCoverCache {
	private readonly entries = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, { mtime: number; promise: Promise<DocCover | null> }>();
	private readonly resolver: DocCoverResolver;

	constructor(resolver: DocCoverResolver = defaultDocCoverResolver) {
		this.resolver = resolver;
	}

	get(path: string, mtime: number): DocCover | null | undefined {
		const entry = this.entries.get(path);
		if (!entry || entry.mtime !== mtime) return undefined;
		return entry.cover;
	}

	/** Generate (or join) the cover for one item; resolves null when the
	 *  resolver yields nothing. Never rejects. */
	ensure(item: MaterialItem, app: App): Promise<DocCover | null> {
		const cached = this.get(item.path, item.mtime);
		if (cached !== undefined) return Promise.resolve(cached);
		const running = this.inflight.get(item.path);
		if (running && running.mtime === item.mtime) return running.promise;
		const promise = this.resolver(item, app)
			.then(cover => {
				this.entries.set(item.path, { mtime: item.mtime, cover });
				return cover;
			})
			.catch(() => {
				this.entries.set(item.path, { mtime: item.mtime, cover: null });
				return null;
			})
			.finally(() => {
				this.inflight.delete(item.path);
			});
		// The generation remembers its mtime: a file saved mid-flight goes
		// stale and is re-resolved by the next ensure.
		this.inflight.set(item.path, { mtime: item.mtime, promise });
		return promise;
	}
}
