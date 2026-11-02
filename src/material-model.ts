/**
 * Material library model: the pure, Obsidian-free core of the standalone
 * material view (素材库). Scanning is fed minimal file records so the whole
 * pipeline — scope → filter → sort → group → paginate → waterfall columns —
 * is deterministic and jiti/esbuild-testable standalone, mirroring
 * immersive-grid.ts / widget-span.ts.
 *
 * The waterfall placement is shortest-column by cumulative aspect: every
 * column has the same width, so an item's rendered height is proportional to
 * its aspect ratio (h/w) and column "fullness" is just the running aspect
 * sum. Pure and stable — same input, same output; ties go to the leftmost
 * column.
 */

import type { AgentTarget, MaterialFolderPage, MaterialLibraryConfig, MaterialSkillButton } from './types';
import { normalizeExcludeFolders, isUnderExcludedFolder } from './exclude-folders';

/** File extensions the material library types specially (superset: images +
 * videos); every other extension scans in as a 'text' item. */
export const MATERIAL_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
export const MATERIAL_VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);
/** Structured non-media formats the library shows as their own kind (Rae —
 * PDF/EPUB books, saved HTML pages, Excalidraw drawings and Canvas boards all
 * get tiles, each with a best-effort generated cover). */
export const MATERIAL_DOC_KIND_BY_EXT: Readonly<Record<string, MaterialKind>> = {
	pdf: 'pdf',
	html: 'html',
	htm: 'html',
	epub: 'epub',
	canvas: 'canvas',
	excalidraw: 'excalidraw',
};
/** Kinds beyond the original media/text trio. */
export const MATERIAL_DOC_KINDS: readonly MaterialKind[] = ['pdf', 'html', 'epub', 'excalidraw', 'canvas'];
export function isDocKind(kind: MaterialKind): boolean {
	return kind !== 'image' && kind !== 'video' && kind !== 'text';
}

/** Minimal file record the model needs — a structural subset of TFile so
 *  tests feed plain objects and the view feeds real TFiles. */
export interface MaterialFileRecord {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; ctime: number; size: number };
}

/** One material asset in display terms. 'text' is plain markdown/unknown —
 *  only notes with a resolvable frontmatter cover become tiles; the doc kinds
 *  (pdf/html/epub/excalidraw/canvas) always tile, cover generated for them. */
export interface MaterialItem {
	path: string;
	basename: string;
	ext: string;
	kind: MaterialKind;
	mtime: number;
	ctime: number;
	size: number;
	/** Folder group key: the first sub-folder BELOW the deepest matching scan
	 *  root (root-qualified, so two roots can't collide), the root itself for
	 *  files sitting directly in it, and '' for vault-root files when the
	 *  scope is the whole vault. Display uses the key's last segment. */
	folder: string;
	/** User tags from the shared media tag store (sorted). */
	tags: string[];
}

export type MaterialKind = 'image' | 'video' | 'text' | 'pdf' | 'html' | 'epub' | 'excalidraw' | 'canvas';
export type MaterialKindFilter = 'all' | MaterialKind;

/** Type-filter choices shared by the toolbar dropdown and the type-group
 *  headers (label keys resolve through i18n; icons verified against the
 *  Obsidian Lucide dictionary). */
export const MATERIAL_TYPE_CHOICES: ReadonlyArray<{ key: MaterialKind; labelKey: string; icon: string }> = [
	{ key: 'image', labelKey: 'material.typeImages', icon: 'image' },
	{ key: 'video', labelKey: 'material.typeVideos', icon: 'film' },
	{ key: 'text', labelKey: 'material.typeText', icon: 'file-text' },
	{ key: 'pdf', labelKey: 'material.typePdf', icon: 'book' },
	{ key: 'epub', labelKey: 'material.typeEpub', icon: 'book-open' },
	{ key: 'html', labelKey: 'material.typeHtml', icon: 'code' },
	{ key: 'excalidraw', labelKey: 'material.typeExcalidraw', icon: 'pen-tool' },
	{ key: 'canvas', labelKey: 'material.typeCanvas', icon: 'layout-dashboard' },
];

/** Aspect fallbacks for doc kinds before their generated cover settles (or
 *  for good when no cover could be produced): A4 for PDFs, a book cover for
 *  EPUB, a browser viewport for saved HTML, portrait sketchpads for
 *  Excalidraw, landscape boards for Canvas. */
export const MATERIAL_DOC_ASPECTS: Readonly<Record<string, number>> = {
	pdf: 1 / 1.414,
	epub: 2 / 3,
	html: 4 / 3,
	excalidraw: 1 / 1.35,
	canvas: 16 / 9,
};
export type MaterialSortBy = 'modified' | 'created' | 'name' | 'size';
export type MaterialGroupMode = 'none' | 'folder' | 'tag' | 'type';
export type MaterialDensity = 'small' | 'medium' | 'large';

/** One rendered material group: header key, its items, and the group's start
 *  offset into the flattened display order (lightbox indexing). */
export interface MaterialGroup {
	key: string;
	/** Display name when it differs from the key — folder groups show the
	 *  sub-folder name, not the root-qualified key ('素材/图片' → '图片'). */
	label?: string;
	items: MaterialItem[];
	offset: number;
}

/** Per-group progressive batch: a group body mounts the first N tiles plus a
 *  load-more pill (Rae — the old 500-total ceiling hid whole folders, so a
 *  vault's later folders simply never appeared in grouped views). */
export const MATERIAL_GROUP_PAGE_SIZE = 50;

/** Density → target tile width in px (the waterfall column width). */
export const DENSITY_TARGET_PX: Record<MaterialDensity, number> = { small: 150, medium: 210, large: 280 };
/** Gap between waterfall columns in px. */
export const MATERIAL_COL_GAP = 12;
/** Fewest / most waterfall columns at any width. */
export const MATERIAL_MIN_COLS = 2;
export const MATERIAL_MAX_COLS = 8;

/** Aspect fallbacks: images before their probe settles, videos (16:9
 *  placeholder; real video thumbs are letterboxed by CSS object-fit). */
export const MATERIAL_IMAGE_ASPECT = 4 / 3;
export const MATERIAL_VIDEO_ASPECT = 16 / 9;
/** Text tiles without a frontmatter cover render a low extension strip
 *  instead of a full-height gray box. */
export const MATERIAL_TEXT_ASPECT = 5 / 2;

/** Type one file by extension. The basename matters for the Excalidraw
 *  plugin's markdown-wrapped format (`note.excalidraw.md` — extension 'md'
 *  with an `.excalidraw` basename tail), which must not scan in as a plain
 *  coverless note. */
export function materialKindFor(ext: string, basename?: string): MaterialKind {
	const e = ext.toLowerCase();
	if (MATERIAL_DOC_KIND_BY_EXT[e]) return MATERIAL_DOC_KIND_BY_EXT[e]!;
	if (e === 'md' && basename && basename.toLowerCase().endsWith('.excalidraw')) return 'excalidraw';
	if (MATERIAL_IMAGE_EXTS.has(e)) return 'image';
	if (MATERIAL_VIDEO_EXTS.has(e)) return 'video';
	return 'text';
}

/** Normalize include-folder entries: trim, strip slashes, keep case (paths
 *  match case-insensitively downstream, like the media sections). */
export function normalizeIncludeFolders(folders: readonly string[]): string[] {
	return folders
		.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
		.filter(f => f.length > 0);
}

/** Normalize one folder path (the import destination, an attachment-folder
 *  config value): trim, drop a leading './' and any wrapping slashes so every
 *  source folds to the same shape. '' means the vault root. */
export function normalizeImportFolder(folder: string): string {
	return folder.trim().replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

/** Scan vault file records into material items: EVERY non-dot in-scope file
 *  becomes an item (media typed image/video, everything else 'text');
 *  include scope (empty = whole vault) + exclude prefixes + tag attach. */
export function buildMaterialItems(
	files: readonly MaterialFileRecord[],
	tagsOf: (path: string) => readonly string[],
	cfg: Pick<MaterialLibraryConfig, 'includeFolders' | 'excludeFolders'>,
): MaterialItem[] {
	const includes = normalizeIncludeFolders(cfg.includeFolders);
	const lowerIncludes = includes.map(f => f.toLowerCase());
	const excluded = normalizeExcludeFolders(cfg.excludeFolders);
	const inScope = (path: string): boolean => {
		if (includes.length === 0) return true;
		const p = path.toLowerCase();
		return lowerIncludes.some(inc => p === inc || p.startsWith(inc + '/'));
	};
	/** Deepest matching include root ('' when unscoped). Folder grouping is
	 *  RELATIVE to it, so a scoped library groups by the next level down
	 *  instead of collapsing everything under the one scan root (Rae). */
	const matchedRoot = (path: string): string => {
		const p = path.toLowerCase();
		let best = '';
		let bestLen = -1;
		for (let i = 0; i < includes.length; i++) {
			const inc = lowerIncludes[i]!;
			if ((p === inc || p.startsWith(inc + '/')) && inc.length > bestLen) {
				best = includes[i]!;
				bestLen = inc.length;
			}
		}
		return best;
	};
	const folderKeyOf = (path: string): string => {
		const root = matchedRoot(path);
		const rel = root === '' ? path : path.slice(root.length + 1);
		const parts = rel.split('/');
		if (parts.length >= 2) return root === '' ? parts[0]! : `${root}/${parts[0]}`;
		return root;
	};
	const items: MaterialItem[] = [];
	for (const file of files) {
		if (file.path.startsWith('.')) continue;
		if (!inScope(file.path)) continue;
		if (isUnderExcludedFolder(file.path, excluded)) continue;
		items.push({
			path: file.path,
			basename: file.basename,
			ext: file.extension,
			kind: materialKindFor(file.extension, file.basename),
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			size: file.stat.size,
			folder: folderKeyOf(file.path),
			tags: [...tagsOf(file.path)],
		});
	}
	return items;
}

export interface MaterialFilter {
	query: string;
	kind: MaterialKindFilter;
	/** OR-union: an item passes when it carries ANY of these tags. */
	tags: string[];
}

/** Filter by search query (basename or full path), type, and tag union. */
export function filterMaterialItems(items: readonly MaterialItem[], filter: MaterialFilter): MaterialItem[] {
	const q = filter.query.trim().toLowerCase();
	return items.filter(r => {
		if (filter.kind !== 'all' && r.kind !== filter.kind) return false;
		if (filter.tags.length > 0 && !r.tags.some(tag => filter.tags.includes(tag))) return false;
		if (q && !r.basename.toLowerCase().includes(q) && !r.path.toLowerCase().includes(q)) return false;
		return true;
	});
}

/** Sort into a NEW array (pure): modified/created/name/size, either
 *  direction. Name compares numerically-aware like the media sections. */
export function sortMaterialItems(items: readonly MaterialItem[], sortBy: MaterialSortBy, desc: boolean): MaterialItem[] {
	const sorted = [...items];
	sorted.sort((a, b) => {
		let cmp = 0;
		if (sortBy === 'name') cmp = a.basename.localeCompare(b.basename, undefined, { numeric: true });
		else if (sortBy === 'created') cmp = a.ctime - b.ctime;
		else if (sortBy === 'size') cmp = a.size - b.size;
		else cmp = a.mtime - b.mtime;
		return desc ? -cmp : cmp;
	});
	return sorted;
}

/** Group display-ordered items. Folder mode keys by the sub-folder below the
 *  scan root (label = that sub-folder's own name); tag mode fans an item out
 *  one bucket per tag; type mode splits by kind (image/video/text + every
 *  doc kind). Buckets sort alphabetically (numeric-aware); the not-set bucket
 *  always goes last. */
export function groupMaterialItems(items: readonly MaterialItem[], mode: MaterialGroupMode, notSetLabel: string): MaterialGroup[] {
	if (mode === 'none') return [];
	const buckets = new Map<string, MaterialItem[]>();
	const folderLabels = new Map<string, string>();
	const notSet: MaterialItem[] = [];
	for (const r of items) {
		if (mode === 'folder') {
			if (!r.folder) { notSet.push(r); continue; }
			const list = buckets.get(r.folder) ?? [];
			list.push(r);
			buckets.set(r.folder, list);
			folderLabels.set(r.folder, r.folder.slice(r.folder.lastIndexOf('/') + 1));
		} else if (mode === 'type') {
			const list = buckets.get(r.kind) ?? [];
			list.push(r);
			buckets.set(r.kind, list);
		} else {
			if (r.tags.length === 0) { notSet.push(r); continue; }
			for (const tag of r.tags) {
				const list = buckets.get(tag) ?? [];
				list.push(r);
				buckets.set(tag, list);
			}
		}
	}
	const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
	const groups: MaterialGroup[] = [];
	let offset = 0;
	for (const [key, list] of sorted) {
		const label = folderLabels.get(key);
		groups.push({ key, ...(label ? { label } : {}), items: list, offset });
		offset += list.length;
	}
	if (notSet.length > 0) groups.push({ key: notSetLabel, items: notSet, offset });
	return groups;
}

/** Page slice with page clamping (returns the page and the clamped page
 *  number so callers can resync their state). */
export function paginateMaterial(items: readonly MaterialItem[], page: number, pageSize: number): { page: number; items: MaterialItem[]; totalPages: number } {
	const totalPages = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
	const clamped = Math.min(Math.max(1, page), totalPages);
	const start = (clamped - 1) * pageSize;
	return { page: clamped, items: items.slice(start, start + pageSize), totalPages };
}

/** Waterfall column count for a container width and density. Pure math:
 *  floor((width + gap) / (target + gap)), clamped 2..8. */
export function materialColumnCount(containerWidth: number, density: MaterialDensity): number {
	const target = DENSITY_TARGET_PX[density];
	if (!Number.isFinite(containerWidth) || containerWidth <= 0) return MATERIAL_MIN_COLS;
	return Math.min(MATERIAL_MAX_COLS, Math.max(MATERIAL_MIN_COLS, Math.floor((containerWidth + MATERIAL_COL_GAP) / (target + MATERIAL_COL_GAP))));
}

/** Shortest-column waterfall assignment: item i lands in the column whose
 *  cumulative aspect sum is smallest (leftmost on ties). Aspect units stand
 *  in for height because every column shares the same width. */
export function assignWaterfall(aspects: readonly number[], cols: number): number[] {
	const width = Math.max(1, Math.round(cols));
	const sums = new Array<number>(width).fill(0);
	const out: number[] = [];
	for (const aspect of aspects) {
		const a = Number.isFinite(aspect) && aspect > 0 ? aspect : MATERIAL_IMAGE_ASPECT;
		let best = 0;
		for (let i = 1; i < width; i++) {
			if (sums[i]! < sums[best]!) best = i;
		}
		out.push(best);
		sums[best] = sums[best]! + a;
	}
	return out;
}

/** Template vars handed to dispatchSkill for a selection: the full
 *  dash-prefixed path list ({paths}), the first path ({path}) and the count
 *  ({count}) — the parts any "send these assets to an agent" prompt needs. */
export function materialSkillVars(paths: readonly string[]): Record<string, string> {
	return {
		paths: paths.map(p => `- ${p}`).join('\n'),
		path: paths[0] ?? '',
		count: String(paths.length),
	};
}

/** A button's effective template: user-written wins; the default sends the
 *  skill invocation followed by the selected file list. */
export function effectiveMaterialTemplate(button: Pick<MaterialSkillButton, 'promptTemplate'>): string {
	return button.promptTemplate.trim() || '{skill}\n\n{paths}';
}

/** Sanitize a saved config (or garbage/undefined) into a complete
 *  MaterialLibraryConfig. Skill buttons keep only valid agent ids; ids are
 *  regenerated when missing. */
export function sanitizeMaterialConfig(raw: unknown, validAgents: readonly AgentTarget[]): MaterialLibraryConfig {
	const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
	const strList = (v: unknown): string[] => Array.isArray(v)
		? v.filter((x): x is string => typeof x === 'string')
		: [];
	const agents = new Set<string>(validAgents);
	const buttons: MaterialSkillButton[] = [];
	const rawButtons = Array.isArray(obj.skillButtons) ? obj.skillButtons : [];
	for (const rb of rawButtons) {
		if (!rb || typeof rb !== 'object') continue;
		const b = rb as Record<string, unknown>;
		const agent = typeof b.agent === 'string' && agents.has(b.agent) ? b.agent as AgentTarget : 'claudian';
		buttons.push({
			id: typeof b.id === 'string' && b.id ? b.id : `mb_${Date.now().toString(36)}_${buttons.length}`,
			label: typeof b.label === 'string' ? b.label.trim() : '',
			icon: typeof b.icon === 'string' ? b.icon.trim() : '',
			agent,
			skillName: typeof b.skillName === 'string' ? b.skillName.trim() : '',
			promptTemplate: typeof b.promptTemplate === 'string' ? b.promptTemplate.trim() : '',
			...(b.directSend === true ? { directSend: true } : {}),
		});
	}
	return {
		includeFolders: normalizeIncludeFolders(strList(obj.includeFolders)),
		excludeFolders: strList(obj.excludeFolders),
		skillButtons: buttons,
		importFolder: typeof obj.importFolder === 'string' ? normalizeImportFolder(obj.importFolder) : '',
	archiveFolder: typeof obj.archiveFolder === 'string' ? normalizeImportFolder(obj.archiveFolder) : '',
	};
}

/** Sanitize saved folder-setting pages (old/garbage data.json entries): keep
 *  only entries with a usable name, normalizing folder lists the same way the
 *  live config does. */
export function sanitizeMaterialFolderPages(raw: unknown): MaterialFolderPage[] {
	if (!Array.isArray(raw)) return [];
	const strList = (v: unknown): string[] => Array.isArray(v)
		? v.filter((x): x is string => typeof x === 'string')
		: [];
	const out: MaterialFolderPage[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const name = typeof e.name === 'string' ? e.name.trim() : '';
		if (!name) continue;
		out.push({
			id: typeof e.id === 'string' && e.id ? e.id : `mp_${Date.now().toString(36)}_${out.length}`,
			name,
			includeFolders: normalizeIncludeFolders(strList(e.includeFolders)),
			excludeFolders: strList(e.excludeFolders),
		});
	}
	return out;
}

/** Save-or-update one folder page (pin button): a page saved under a name
 *  that already exists is REFRESHED in place — a page is a living snapshot of
 *  the scan scope + excludes, so re-saving after tweaking the excluded
 *  folders updates the same row instead of stacking a look-alike (Rae hit
 *  exactly that: pages saved before excludes were configured never picked
 *  them up). Returns the new list and whether an existing row was updated. */
export function upsertMaterialFolderPage(
	pages: readonly MaterialFolderPage[],
	name: string,
	cfg: Pick<MaterialLibraryConfig, 'includeFolders' | 'excludeFolders'>,
): { pages: MaterialFolderPage[]; updated: boolean } {
	const trimmed = name.trim();
	const existingIndex = pages.findIndex(p => p.name === trimmed);
	const page: MaterialFolderPage = {
		id: existingIndex >= 0 ? pages[existingIndex]!.id : `mp_${Date.now().toString(36)}_${pages.length}`,
		name: trimmed,
		includeFolders: normalizeIncludeFolders(cfg.includeFolders),
		excludeFolders: [...cfg.excludeFolders],
	};
	return {
		pages: existingIndex >= 0
			? pages.map((p, i) => (i === existingIndex ? page : p))
			: [...pages, page],
		updated: existingIndex >= 0,
	};
}
