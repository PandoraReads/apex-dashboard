/**
 * PDF first-page covers for the material library (素材库).
 *
 * Obsidian ships pdf.js with the app (`/lib/pdfjs/pdf.min.mjs`, loaded
 * lazily onto window.pdfjsLib the first time a PDF view opens) — reusing it
 * renders real first-page thumbnails with zero bundled dependency.
 *
 * The whole path is desktop-gated: anywhere the dynamic import fails
 * (mobile, test harness), the caller falls back to an icon tile.
 */

/** The slice of the pdf.js API used here. */
interface PdfjsViewport {
	width: number;
	height: number;
}
interface PdfjsPage {
	getViewport(params: { scale: number }): PdfjsViewport;
	render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): { promise: Promise<void> };
}
interface PdfjsDocument {
	getPage(n: number): Promise<PdfjsPage>;
}
interface PdfjsLib {
	getDocument(src: { data: Uint8Array }): { promise: Promise<PdfjsDocument> };
	GlobalWorkerOptions: { workerSrc: string };
}

/** Cover side rendered for a PDF tile (page width; the aspect follows the
 *  page itself). */
export const PDF_COVER_WIDTH = 480;

let pdfjsLoading: Promise<PdfjsLib | null> | null = null;

function loadPdfjs(): Promise<PdfjsLib | null> {
	const g = typeof window === 'undefined' ? null : window as { pdfjsLib?: PdfjsLib };
	if (g?.pdfjsLib) return Promise.resolve(g.pdfjsLib);
	if (pdfjsLoading) return pdfjsLoading;
	pdfjsLoading = (async (): Promise<PdfjsLib | null> => {
		try {
			// '/lib/pdfjs/...' resolves against the Obsidian renderer origin,
			// exactly how the core PDF view loads it. The import() argument is
			// a runtime value ON PURPOSE: esbuild cannot analyze it, so the
			// native dynamic import — the only loader for this ESM-only asset
			// under cjs bundling — survives into main.js untouched. The URL is
			// a module constant, never user input.
			const pdfjsUrl = '/lib/pdfjs/pdf.min.mjs';
			// eslint-disable-next-line no-unsanitized/method -- the URL is the module constant above, kept non-literal on purpose so esbuild preserves this native import()
			const mod = (await import(pdfjsUrl)) as { default?: PdfjsLib } & PdfjsLib;
			const lib = mod?.default ?? mod;
			if (!lib || typeof lib.getDocument !== 'function') return null;
			lib.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/pdf.worker.min.mjs';
			if (g) g.pdfjsLib = lib;
			return lib;
		} catch {
			return null;
		}
	})();
	// A failed load must not poison later attempts forever, but retrying on
	// every tile would spin — remember the miss until the next session.
	pdfjsLoading.catch(() => { pdfjsLoading = null; });
	return pdfjsLoading;
}

export interface PdfCover {
	src: string;
	aspect: number;
}

/** Render page 1 of a PDF to a JPEG data URL. Resolves null on any failure
 * (unreadable PDF, no pdf.js available, renderer error). */
export async function pdfFirstPageCover(bytes: Uint8Array): Promise<PdfCover | null> {
	try {
		const lib = await loadPdfjs();
		if (!lib) return null;
		const doc = await lib.getDocument({ data: bytes.slice() }).promise;
		const page = await doc.getPage(1);
		const base = page.getViewport({ scale: 1 });
		if (!(base.width > 0) || !(base.height > 0)) return null;
		const scale = Math.min(3, Math.max(0.2, PDF_COVER_WIDTH / base.width));
		const viewport = page.getViewport({ scale });
		const canvasEl = createEl('canvas');
		canvasEl.width = Math.max(1, Math.floor(viewport.width));
		canvasEl.height = Math.max(1, Math.floor(viewport.height));
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return null;
		// PDF pages can be transparent — a white base keeps JPEGs clean.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
		await page.render({ canvasContext: ctx, viewport }).promise;
		return {
			src: canvasEl.toDataURL('image/jpeg', 0.85),
			aspect: canvasEl.width / canvasEl.height,
		};
	} catch {
		return null;
	}
}
