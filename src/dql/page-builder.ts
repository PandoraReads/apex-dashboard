import { App, type CachedMetadata, type TFile } from 'obsidian';
import type { DqlValue, Page } from './types';
import {
	asList, coerceString, kindOf, makeDate, makeLink, makeObject,
} from './values';
import { parseDate } from './functions';
import { scanFileTasks } from '../alltasks-scan';

/** Safe string coercion for `unknown` frontmatter values: scalars stringify
 *  directly; objects/arrays fall back to an empty string (never "[object Object]"). */
function toStr(v: unknown): string {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

/** One cached page keyed by (path → mtime). Mirrors alltasks-scan.ts:39. */
interface PageCacheEntry {
	readonly mtime: number;
	readonly page: Page;
}

const moduleCache = new Map<string, PageCacheEntry>();

/** mtime-keyed cache for the resolvedLinks pass (rebuilt when any file changes). */
let linksMtime = 0;
let inlinksCache: Readonly<Record<string, readonly string[]>> = {};
let outlinksCache: Readonly<Record<string, readonly string[]>> = {};

/** Build the full page index for the current vault state. Cheap on repeat
 *  calls thanks to the mtime cache; yields to the UI thread every 50 files so
 *  large vaults don't freeze the app (mirrors alltasks-scan.ts:191). */
export async function buildPages(app: App): Promise<Page[]> {
	const files = app.vault.getMarkdownFiles();
	const stale = new Set(moduleCache.keys());
	const pages: Page[] = [];

	// Build link maps once per render pass (cheap relative to N file reads).
	rebuildLinkMaps(app);

	for (let i = 0; i < files.length; i++) {
		const file = files[i]!;
		if (i > 0 && i % 50 === 0) await new Promise<void>(r => window.setTimeout(r, 0));

		if (file.path.startsWith('.')) { stale.delete(file.path); continue; }
		stale.delete(file.path);

		const cached = moduleCache.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) {
			pages.push(cached.page);
			continue;
		}

		const page = await buildPage(app, file);
		if (page) {
			moduleCache.set(file.path, { mtime: file.stat.mtime, page });
			pages.push(page);
		}
	}
	for (const path of stale) moduleCache.delete(path);
	return pages;
}

/** Drop a single path from the cache so the next build re-reads it. */
export function invalidatePath(path: string): void {
	moduleCache.delete(path);
}

async function buildPage(app: App, file: TFile): Promise<Page | null> {
	const cache = app.metadataCache.getFileCache(file);
	const fields: Record<string, DqlValue> = {};

	// Read the body once — used for inline fields AND task extraction.
	let body = '';
	try {
		body = await app.vault.cachedRead(file);
	} catch {
		// File read failure (race with deletion, etc.) — keep the metadata-only page.
	}

	// file.* implicit fields (computed from TFile.stat + metadataCache + body).
	addFileFields(fields, app, file, cache, body);

	// Frontmatter fields (skip Obsidian's internal `position`).
	if (cache?.frontmatter) {
		for (const [key, value] of Object.entries(cache.frontmatter)) {
			if (key === 'position') continue;
			const lower = key.toLowerCase();
			if (lower === 'aliases' || lower === 'tags' || lower === 'tag') continue; // handled via file.*
			fields[lower] = coerceFrontmatterValue(value);
			if (lower !== key) fields[key] = fields[lower]!;
		}
	}

	// Inline fields from the body (the generalization of alltasks-scan.ts:50-62).
	for (const [k, v] of parseInlineFields(body)) {
		const lower = k.toLowerCase();
		if (!(lower in fields)) fields[lower] = coerceFrontmatterValue(v);
		if (!(k in fields)) fields[k] = fields[lower]!;
	}

	return { file, fields };
}

/** Populate the `file.*` implicit fields for a page. */
function addFileFields(fields: Record<string, DqlValue>, app: App, file: TFile, cache: CachedMetadata | null, body: string): void {
	const stat = file.stat;
	const path = file.path;
	const name = file.basename;
	const slash = path.lastIndexOf('/');
	const folder = slash >= 0 ? path.slice(0, slash) : '';
	const extIndex = path.lastIndexOf('.');
	const ext = extIndex >= 0 ? path.slice(extIndex + 1) : '';

	fields['file.name'] = name;
	fields['file.folder'] = folder;
	fields['file.path'] = path;
	fields['file.ext'] = ext;
	fields['file.link'] = makeLink(path, name);
	fields['file.size'] = stat.size;
	fields['file.ctime'] = makeDate(stat.ctime);
	fields['file.cday'] = makeDate(midnight(stat.ctime));
	fields['file.mtime'] = makeDate(stat.mtime);
	fields['file.mday'] = makeDate(midnight(stat.mtime));

	// Tags: merge frontmatter tags + inline #tags from the cache.
	const tags = collectTags(cache);
	fields['file.tags'] = tags.map(tagToLink);
	fields['file.etags'] = tags.map(tagToLink); // exact (no parent expansion) — same set here

	// Aliases from frontmatter.
	fields['file.aliases'] = asList(coerceFrontmatterValue(cache?.frontmatter?.aliases)).map(a => coerceString(a));

	// Inlinks/outlinks from the resolved-link maps.
	fields['file.inlinks'] = (inlinksCache[path] ?? []).map(p => makeLink(p));
	fields['file.outlinks'] = (outlinksCache[path] ?? []).map(p => makeLink(p));

	// Tasks / lists: parsed from checkbox lines via the shared scanner.
	const tasks = collectTasks(file, body);
	fields['file.tasks'] = tasks;
	fields['file.lists'] = tasks;

	// Raw frontmatter object (for file.frontmatter.key access).
	const fmObj: Record<string, DqlValue> = {};
	if (cache?.frontmatter) {
		for (const [k, v] of Object.entries(cache.frontmatter)) {
			if (k === 'position') continue;
			fmObj[k.toLowerCase()] = coerceFrontmatterValue(v);
		}
	}
	fields['file.frontmatter'] = makeObject(fmObj);

	// file.day: from a `Date`-named frontmatter field or a daily-note filename.
	fields['file.day'] = resolveFileDay(cache, name);

	fields['file.starred'] = false; // best-effort; Obsidian's starred list is internal
}

function midnight(ts: number): number {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function collectTags(cache: CachedMetadata | null): string[] {
	const set = new Set<string>();
	if (cache?.frontmatter) {
		const fm = cache.frontmatter as Record<string, unknown>;
		const fmTags: unknown = fm['tags'] ?? fm['tag'];
		const arr: readonly unknown[] = Array.isArray(fmTags) ? fmTags : fmTags !== undefined ? [fmTags] : [];
		for (const t of arr) if (t != null) set.add(toStr(t).replace(/^#/, ''));
	}
	if (cache?.tags) {
		for (const t of cache.tags) set.add(t.tag.replace(/^#/, ''));
	}
	return [...set];
}

function tagToLink(tag: string): DqlValue {
	return makeLink('#' + tag, '#' + tag);
}

function collectTasks(file: TFile, body: string): DqlValue[] {
	if (!body) return [];
	const scanned = scanFileTasks(file, body);
	return scanned.map(t => {
		// Each task is a queryable object: `completed`, `text`, `due`, plus the
		// interactive payload the renderer needs to toggle it back to disk.
		const entries: Record<string, DqlValue> = {
			completed: t.checked,
			checked: t.checked,
			text: t.text,
			due: t.due ?? null,
			created: makeDate(t.ctime),
			priority: t.priority ?? null,
			link: makeLink(file.path, file.basename),
			// Internal payload (prefixed so it never collides with user fields).
			__line: t.line,
			__original: t.originalLine,
			__path: file.path,
		};
		return makeObject(entries);
	});
}

/** Resolve file.day from a frontmatter Date field or a yyyy-mm-dd filename. */
function resolveFileDay(cache: CachedMetadata | null, name: string): DqlValue {
	const fm = cache?.frontmatter;
	const dayField: unknown = fm?.['day'] ?? fm?.['date'];
	if (dayField != null) {
		const ts = parseDate(toStr(dayField));
		if (ts !== null) return makeDate(ts);
	}
	const m = /(\d{4})[-_]?(\d{2})[-_]?(\d{2})/.exec(name);
	if (m) {
		const ts = parseDate(`${m[1]}-${m[2]}-${m[3]}`);
		if (ts !== null) return makeDate(ts);
	}
	return null;
}

/** Coerce a raw frontmatter/inline value into the DQL value model. YAML has
 *  already typed scalars (number/boolean/string), so we mostly pass those
 *  through and only promote ISO-date strings to Date values. */
function coerceFrontmatterValue(value: unknown): DqlValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') {
		// Wikilinks inside a string value → Link when the whole string is one.
		const single = /^\[\[([^\]]+)\]\]$/.exec(value.trim());
		if (single) return makeLink(single[1]!.split('|')[0]!.trim());
		const ts = parseDate(value);
		if (ts !== null && /^\d{4}-\d{2}-\d{2}/.test(value)) return makeDate(ts);
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map(coerceFrontmatterValue);
	if (typeof value === 'object') {
		const entries: Record<string, DqlValue> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			entries[k.toLowerCase()] = coerceFrontmatterValue(v);
		}
		return makeObject(entries);
	}
	return coerceString(value as never);
}

/** Generalized Dataview inline-field extractor. Recognizes three forms:
 *    key:: value            (own-line)
 *    [key:: value]          (inline bracketed)
 *    (key:: value)          (inline hidden-render)
 *  Returns raw [key, value] string pairs; type coercion happens at field-set. */
const INLINE_BRACKET = /\[([^[\]]+?)::\s*([^[\]]*?)\s*]/g;
const INLINE_PAREN = /\(([^()]+?)::\s*([^()]*?)\s*\)/g;
const INLINE_LINE = /^([A-Za-z0-9_][A-Za-z0-9_ -]*)::\s*(.+)$/;

export function parseInlineFields(body: string): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	// Strip frontmatter so its single-colon YAML keys aren't misread.
	const fmTrimmed = stripFrontmatter(body);
	for (const line of fmTrimmed.split('\n')) {
		const m = INLINE_LINE.exec(line.trim());
		if (m && !line.trim().startsWith('-')) {
			out.push([m[1]!.trim(), m[2]!.trim()]);
		}
	}
	let bm: RegExpExecArray | null;
	const bracket = new RegExp(INLINE_BRACKET);
	while ((bm = bracket.exec(body)) !== null) out.push([bm[1]!.trim(), bm[2]!.trim()]);
	const paren = new RegExp(INLINE_PAREN);
	while ((bm = paren.exec(body)) !== null) out.push([bm[1]!.trim(), bm[2]!.trim()]);
	return out;
}

function stripFrontmatter(body: string): string {
	if (!body.startsWith('---')) return body;
	const end = body.indexOf('\n---', 3);
	if (end === -1) return body;
	return body.slice(end + 4);
}

/** Rebuild the inlinks/outlinks maps from metadataCache.resolvedLinks.
 *  O(vault) per render; runs once before the per-file loop. */
function rebuildLinkMaps(app: App): void {
	const resolved = app.metadataCache.resolvedLinks;
	const inlinks: Record<string, string[]> = {};
	const outlinks: Record<string, string[]> = {};
	for (const source of Object.keys(resolved)) {
		const targets = resolved[source]!;
		const outs = Object.keys(targets);
		outlinks[source] = outs.slice();
		for (const target of outs) {
			(inlinks[target] ??= []).push(source);
		}
	}
	inlinksCache = inlinks;
	outlinksCache = outlinks;
	linksMtime = Date.now();
	void linksMtime;
}

export { asList, kindOf };
