/**
 * Material library render smoke test (src/material-render.ts): the full-page
 * waterfall surface against the mini-dom harness.
 *
 * 1. Initial render: toolbar (search / type pills / sort / group / density /
 *    settings), result count, waterfall columns with tiles distributed by
 *    shortest-column aspect placement; the right ACTION RAIL is always
 *    mounted with its batch buttons disabled at zero selection.
 * 2. Tile anatomy (polaroid card): photo + caption share one white paper
 *    block (.dashboard-material-photo), then a pale-accent meta strip carries
 *    tag chips, the created date and the favorite heart. Image tiles carry
 *    <img>; video tiles the placeholder + play badge; TEXT tiles render ONLY
 *    when a frontmatter cover resolves — coverless text files never tile at
 *    all (the icon strip is gone with them).
 * 3. Search re-render narrows results; empty state shows on no match.
 * 4. Type pills: visible segmented buttons (全部/图片/视频/文本) filter the
 *    waterfall; group mode renders folder groups with collapse headers;
 *    type groups show localized labels over raw kind keys. Grouped views
 *    reveal the collapse-all toolbar button and the LEFT nav rail (one dash
 *    per group, section-rail styling); flat views hide both.
 * 5. Select mode: the right action rail carries select toggle + count badge
 *    + skill buttons + batch actions, icons only; buttons disabled at zero
 *    selection; selecting tiles enables them; skill dispatch opens
 *    AgentPromptModal with the selection; copy-paths writes ABSOLUTE paths;
 *    clear keeps the rail; leaving select mode clears the mode classes.
 * 6. Rubber-band marquee: dragging over the empty canvas in select mode
 *    sweeps a rectangle and selects every intersecting tile (union with the
 *    drag-start snapshot); presses starting on a tile never start a sweep.
 * 7. Click opens on a delay (lightbox for media, openLinkText for text);
 *    double-click cancels the pending open and renames in place.
 * 8. Per-tile tag button opens MediaTagEditModal against the shared store.
 * 8b. Favorites: hearts start hollow, click fills in place through the
 *     favorites hooks WITHOUT opening the item; the toolbar entry scopes the
 *     waterfall to the collection; un-favoriting inside the filtered view
 *     drops the tile live.
 * 8c. Card style switch: the toolbar button flips polaroid ⇄ plain (the
 *     original cover-only card), the variant classes/DOM follow, the choice
 *     persists to localStorage, and favorites survive the flip.
 * 9. Controller lifecycle: refresh() re-reads the CONFIG GETTER (the stale
 *    scan-scope fix — widening includeFolders through the same live object
 *    reaches the next refresh without remount); destroy() tears down clean.
 * 10. Folder grouping below the scan root: keys stay root-qualified while
 *    headers and left-rail dashes show the sub-folder's own name; a stored
 *    card style is honored at mount.
 * 11. OS file drop: dragging a file in from outside the vault copies it —
 *    folder group → that folder, tag group → the default folder plus the tag,
 *    flat/type → the configured default (then Obsidian's attachment folder);
 *    the hint pill names the live destination, non-media is refused with a
 *    notice, non-file drags are ignored, and the drop refreshes the waterfall.
 *
 * Pure scanning/sorting/column math is covered by verify-material.
 * Run: `npm run test:material-render`
 */
import { strict as assert } from 'node:assert';
import { Modal, Notice } from 'obsidian';
import { El, findByClass } from './mini-dom';
import type { App, TFile } from 'obsidian';
import { renderMaterialLibrary } from '../src/material-render';
import { MATERIAL_MOVE_DRAG_TYPE } from '../src/material-dnd';
import { AgentPromptModal } from '../src/agent-prompt-modal';
import { MediaLightboxModal } from '../src/media-lightbox-modal';
import { MediaTagEditModal } from '../src/media-tag-editor-modal';
import { t } from '../src/i18n';
import type { MaterialLibraryConfig, MaterialSkillButton } from '../src/types';

// Real obsidian types don't know the stub's capture hooks (`Modal.last`,
// `StubNotice.messages`).
const StubModal = Modal as unknown as { last: Modal | null };
const StubNotice = Notice as unknown as { messages: string[] };

// Global createDiv for detached tile construction (the sanitized global-helper
// pattern the plugin itself uses) + window/activeDocument for popups/rAF.
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
(globalThis as { window?: unknown }).window = globalThis;
// activeDocument is a real El so the marquee's document-capture pointermove/
// pointerup listeners actually receive dispatched events; `body` hosts the
// view root and the popups (filter/tag) that mount there.
const docEl = new El('div');
const bodyHost = new El('body');
(docEl as unknown as { body: El }).body = bodyHost;
(globalThis as Record<string, unknown>).activeDocument = docEl;

// Clipboard capture for the absolute-path copy assertion (Node's navigator
// has no clipboard; defineProperty installs ours, or is a no-op when locked).
let clipboardText = '';
try {
	Object.defineProperty(globalThis, 'navigator', {
		value: { clipboard: { writeText: async (text: string) => { clipboardText = text; } } },
		configurable: true,
		writable: true,
	});
} catch { /* keep going without the copy assertion below */ }

function mediaFile(path: string, mtime: number, size: number): TFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	// Real TFile always reports a lowercased extension (Obsidian normalizes)
	// and carries its parent folder (rename keeps the directory).
	return {
		path,
		name,
		basename: dot > 0 ? name.slice(0, dot) : name,
		extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
		parent: { path: dir },
		stat: { mtime, ctime: mtime, size },
	} as unknown as TFile;
}

const VAULT = [
	mediaFile('素材/cover.png', 30, 500),
	mediaFile('素材/shot.JPG', 20, 400),
	mediaFile('素材/clip.mp4', 40, 9000),
	mediaFile('素材/notes.txt', 50, 3),
	mediaFile('素材/article.md', 60, 800),
	// Outside the configured scan scope — only visible once the config getter
	// test widens includeFolders (section 9).
	mediaFile('外部/outside.md', 10, 60),
];

// Frontmatter for text tiles: article.md and outside.md declare vault covers
// (so they tile), notes.txt deliberately has none — a coverless text file
// must never render in the visual waterfall.
const FRONTMATTER: Record<string, Record<string, unknown>> = {
	'素材/article.md': { '封面': 'cover.png', tags: ['文章'] },
	'外部/outside.md': { '封面': 'cover.png' },
};

function makeApp(
	files: readonly TFile[] = VAULT,
	frontmatter: Record<string, Record<string, unknown>> = FRONTMATTER,
	seedStorage: Record<string, string> = {},
	/** Section 12 (drag-move): when true, renameFile also swaps the entry in
	 *  the live vault maps so the post-move refresh regroups the tile — the
	 *  default record-only stub matches what earlier sections assert. */
	moveOnRename = false,
): {
	app: App;
	renamed: Array<{ from: string; to: string }>;
	openedNotes: string[];
	storage: Record<string, string>;
	/** Files an OS drop copied in (path + byte length), in drop order. */
	created: Array<{ path: string; bytes: number }>;
	/** Folders the importer had to create. */
	mkdirs: string[];
} {
	const byPath = new Map(files.map(f => [f.path, f]));
	// Live vault contents: an imported file joins this list so the post-drop
	// refresh tiles it, exactly like a real vault.create event would.
	const live = [...files];
	const folders = new Set<string>();
	// Seed folders from the fixture's file paths: a real vault holds every
	// ancestor as a TFolder, and the importer's exists() checks rely on that.
	for (const file of files) {
		let cur = '';
		for (const part of file.path.split('/').slice(0, -1)) {
			cur = cur ? `${cur}/${part}` : part;
			folders.add(cur);
		}
	}
	const renamed: Array<{ from: string; to: string }> = [];
	const openedNotes: string[] = [];
	const created: Array<{ path: string; bytes: number }> = [];
	const mkdirs: string[] = [];
	// In-memory localStorage: density + card style persist here (seeded so a
	// test can start a controller in a stored style).
	const storage: Record<string, string> = { ...seedStorage };
	const app = {
		vault: {
			getFiles: () => [...live],
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			createBinary: async (path: string, data: ArrayBuffer) => {
				created.push({ path, bytes: data.byteLength });
				const file = mediaFile(path, 1000, data.byteLength);
				live.push(file);
				byPath.set(path, file);
				return file;
			},
			// Obsidian's attachment folder — the importer's last-resort default.
			getConfig: (key: string) => (key === 'attachmentFolderPath' ? '附件/默认' : ''),
			adapter: {
				basePath: '/vault-root',
				getResourcePath: (p: string) => `app://local/${p}`,
				exists: async (p: string) => byPath.has(p) || folders.has(p),
				mkdir: async (p: string) => { mkdirs.push(p); folders.add(p); },
			},
		},
		metadataCache: {
			getFileCache: (f: { path: string }) =>
				frontmatter[f.path] ? { frontmatter: frontmatter[f.path] } : null,
			getFirstLinkpathDest: (link: string) => byPath.get(link) ?? byPath.get(`素材/${link}`) ?? null,
		},
		workspace: {
			openLinkText: async (linktext: string) => { openedNotes.push(linktext); },
		},
		fileManager: {
			renameFile: async (file: { path: string }, to: string) => {
				renamed.push({ from: file.path, to });
				if (!moveOnRename) return;
				const existing = byPath.get(file.path);
				if (!existing) return;
				const moved = mediaFile(to, existing.stat.mtime, existing.stat.size);
				const idx = live.indexOf(existing);
				if (idx >= 0) live[idx] = moved;
				byPath.delete(file.path);
				byPath.set(to, moved);
			},
			trashFile: async () => {},
		},
		loadLocalStorage: (key: string) => storage[key] ?? null,
		saveLocalStorage: (key: string, value: string) => { storage[key] = value; },
		plugins: { plugins: {} },
	} as unknown as App;
	return { app, renamed, openedNotes, storage, created, mkdirs };
}

const SKILL_BUTTON: MaterialSkillButton = {
	id: 'mb_1', label: '配图', icon: 'image', agent: 'claudian',
	skillName: 'mk-cover', promptTemplate: '', directSend: false,
};

const CONFIG: MaterialLibraryConfig = {
	includeFolders: ['素材'],
	excludeFolders: [],
	skillButtons: [SKILL_BUTTON],
};

function tilePaths(host: El): string[] {
	return findByClass(host, 'dashboard-material-tile').map(el => el.dataset.materialPath ?? '');
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

async function main(): Promise<void> {
	StubModal.last = null;
	const { app, renamed, openedNotes, storage } = makeApp();
	// In-memory shared tag store (same surface MediaTagService exposes;
	// item.tags comes from HERE, not from frontmatter).
	const tagMap = new Map<string, string[]>([
		['素材/cover.png', ['封面', '小红书']],
		['素材/article.md', ['文章']],
	]);
	const tagStore = {
		getTags: (p: string) => [...tagMap.get(p) ?? []],
		getAllTags: () => [...new Set([...tagMap.values()].flat())],
		setTags: (p: string, tags: readonly string[]) => { tagMap.set(p, [...tags]); return true; },
	};
	const savedConfigs: MaterialLibraryConfig[] = [];
	let settingsOpened = 0;

	// Body-rooted host: mini-dom's isConnected (the inline rename's
	// re-entrancy guard) only reads true under a BODY root.
	const host = new El('div');
	bodyHost.appendChild(host);
	// Live config object behind the GETTER — the renderer must re-read it on
	// every render (the stale scan-scope bug fixed it that way), so mutating
	// the same object simulates a settings edit reaching the next refresh.
	const liveConfig: MaterialLibraryConfig = { ...CONFIG };
	// In-memory favorites (the surface MaterialLibraryView wires to
	// settings.materialFavorites); favOps records the toggle order.
	const favSet = new Set<string>();
	const favOps: string[] = [];
	const controller = renderMaterialLibrary(host as unknown as HTMLElement, {
		app,
		getConfig: () => liveConfig,
		onConfigChange: cfg => savedConfigs.push(cfg),
		onOpenSettings: () => { settingsOpened++; },
		tagStore,
		favorites: {
			has: (p: string) => favSet.has(p),
			toggle: (p: string) => {
				if (favSet.has(p)) favSet.delete(p);
				else favSet.add(p);
				favOps.push(p);
				return favSet.has(p);
			},
		},
	});

	// --- 1. Initial render: toolbar + count + waterfall ---------------------
	assert.equal(findByClass(host, 'dashboard-library-search').length, 1, 'search input rendered');
	assert.equal(findByClass(host, 'dashboard-material-settings-btn').length, 1, 'settings gear rendered');
	// Chromeless right cluster (Rae): favorites/style/collapse are bare
	// view-btns on the toolbar — no view-toggle chip-well around them, and no
	// orphaned wrapper that would render as a stray dot beside the gear.
	// (The density S/M/L segmented control keeps its wrapper on purpose.)
	const toolbarEl = findByClass(host, 'dashboard-material-toolbar')[0]!;
	for (const cls of ['dashboard-material-favorites-btn', 'dashboard-material-style-btn', 'dashboard-material-collapse-all', 'dashboard-material-settings-btn']) {
		const btn = findByClass(host, cls)[0]!;
		assert.equal(btn.parent, toolbarEl, `${cls} sits directly on the toolbar`);
	}
	for (const well of findByClass(host, 'dashboard-library-view-toggle')) {
		const inside = well.children.map(c => c.className);
		assert.ok(!inside.some(cn => cn.includes('favorites-btn') || cn.includes('style-btn') || cn.includes('collapse-all') || cn.includes('settings-btn')), 'no chip-well wraps a right-cluster button');
	}
	// Collapse-all lives beside the FILTER FUNNEL (Rae) — left of the right
	// cluster, right after the funnel + chips bar.
	const toolbarKids = toolbarEl.children;
	const collapseIdx = toolbarKids.indexOf(findByClass(host, 'dashboard-material-collapse-all')[0]!);
	const funnelIdx = toolbarKids.indexOf(findByClass(host, 'dashboard-library-filter-btn')[0]!);
	const favoritesIdx = toolbarKids.indexOf(findByClass(host, 'dashboard-material-favorites-btn')[0]!);
	assert.ok(collapseIdx > funnelIdx, 'collapse-all sits right of the filter funnel');
	assert.ok(collapseIdx < favoritesIdx, 'collapse-all stays out of the right cluster');
	// Only the density toggle remains a dropdown — types moved to pills.
	assert.equal(findByClass(host, 'dashboard-toolbar-dropdown').length, 1, 'density dropdown rendered');
	const countEl = findByClass(host, 'dashboard-library-count')[0]!;
	assert.equal(countEl.textContent, '4 个文件', 'count = scoped files MINUS the coverless text file (notes.txt never tiles)');

	// Flat mode → one block, one cols host, 2 columns (NaN width guard).
	assert.equal(findByClass(host, 'dashboard-material-block').length, 1);
	const cols = findByClass(host, 'dashboard-material-col');
	assert.equal(cols.length, 2, 'NaN clientWidth (harness) falls back to 2 columns');
	// Modified-desc order: article(60) clip(40) cover(30) shot(20) — notes.txt
	// is cover-gated out. Aspects: article 4/3 (cover), clip 16/9, cover/shot
	// 4/3 → shortest-column placement article→c0, clip→c1, cover→c0, shot→c1.
	const col0 = cols[0]!.children.map(c => (c as El).dataset.materialPath ?? '');
	const col1 = cols[1]!.children.map(c => (c as El).dataset.materialPath ?? '');
	assert.deepEqual(col0, ['素材/article.md', '素材/cover.png'], 'column 0 placement');
	assert.deepEqual(col1, ['素材/clip.mp4', '素材/shot.JPG'], 'column 1 placement');
	// The action rail is ALWAYS mounted (select toggle + skills discoverable
	// before the first selection); batch buttons sit disabled at zero, and no
	// count badge renders until something is picked. Flat mode hides the
	// collapse-all button and mounts no left nav rail.
	const rail0 = findByClass(host, 'dashboard-material-actionrail')[0]!;
	assert.ok(rail0, 'right action rail mounted outside select mode');
	assert.equal(findByClass(rail0, 'dashboard-material-select-toggle').length, 1, 'select toggle lives on the rail');
	assert.equal(findByClass(host, 'dashboard-material-batchbar').length, 0, 'old bottom batch bar is gone');
	assert.equal(findByClass(rail0, 'dashboard-material-railcount').length, 0, 'no count badge at zero selection');
	assert.equal(findByClass(rail0, 'dashboard-material-railbtn--skill').length, 1, 'skill button on the rail at zero selection');
	assert.equal(findByClass(rail0, 'dashboard-material-railbtn--skill')[0]!.getAttribute('disabled'), 'disabled', 'skill button disabled until a selection exists');
	assert.equal(findByClass(rail0, 'dashboard-material-collapse-all').length, 0, 'collapse-all stays in the toolbar, not the rail');
	assert.equal(findByClass(host, 'dashboard-material-collapse-all')[0]!.hasClass('is-hidden'), true, 'collapse-all hidden in flat view');
	assert.equal(findByClass(host, 'dashboard-section-rail--left').length, 0, 'no left nav rail in flat view');

	// --- 2. Tile anatomy (polaroid card) --------------------------------------
	const tiles = findByClass(host, 'dashboard-material-tile');
	assert.equal(tiles.length, 4, 'four scoped files tile — coverless notes.txt is gated out');
	const tileOf = (path: string): El =>
		findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === path)!;
	const articleTile = tileOf('素材/article.md');
	assert.ok(articleTile, 'tile carries dataset.materialPath');
	assert.ok(!findByClass(host, 'dashboard-material-tile').some(el => el.dataset.materialPath === '素材/notes.txt'), 'coverless text file renders no tile at all');
	assert.equal(findByClass(host, 'dashboard-material-text-ph').length, 0, 'the old icon/extension placeholder strip is gone entirely');

	// Polaroid: photo + name on ONE white paper block, meta strip below.
	const articlePhoto = findByClass(articleTile, 'dashboard-material-photo')[0]!;
	assert.ok(articlePhoto, 'photo paper block renders');
	const articleImg = findByClass(articlePhoto, 'dashboard-material-img')[0]!;
	assert.ok(articleImg, 'text tile with a 封面 renders it as an <img> on the paper');
	assert.equal(articleImg.getAttribute('src'), 'app://local/素材/cover.png', 'cover resolves through getFirstLinkpathDest + resource path');
	assert.equal(findByClass(articlePhoto, 'dashboard-material-name').length, 1, 'caption sits on the paper block with the photo');
	const articleMeta = findByClass(articleTile, 'dashboard-material-meta')[0]!;
	assert.ok(articleMeta, 'pale-accent meta strip renders under the paper');
	assert.deepEqual(findByClass(articleMeta, 'dashboard-media-tile-tag').map(el => el.textContent), ['文章'], 'meta strip carries the tags');
	// The strip renders the CREATED date (ctime) through the datetime facade.
	const artDate = new Date(60); // article.md stat.ctime
	const pad2 = (n: number): string => String(n).padStart(2, '0');
	const expectedDate = `${artDate.getFullYear()}-${pad2(artDate.getMonth() + 1)}-${pad2(artDate.getDate())}`;
	assert.equal(findByClass(articleMeta, 'dashboard-material-meta-date')[0]!.textContent, expectedDate, 'meta strip shows the created date');
	const artHeart = findByClass(articleMeta, 'dashboard-material-heart')[0]!;
	assert.ok(artHeart, 'favorite heart sits on the meta strip');
	assert.equal(artHeart.getAttribute('title'), '收藏', 'heart labels the favorites action');
	assert.equal(artHeart.hasClass('is-fav'), false, 'hearts start hollow');

	const coverTile = tileOf('素材/cover.png');
	assert.equal(findByClass(coverTile, 'dashboard-material-img').length, 1, 'image tile embeds <img>');
	assert.equal(findByClass(findByClass(coverTile, 'dashboard-material-meta')[0]!, 'dashboard-media-tile-tag').length, 2, 'meta strip carries both tag chips');
	const clipTile = tileOf('素材/clip.mp4');
	assert.equal(findByClass(clipTile, 'dashboard-material-img').length, 0, 'video tile has no <img>');
	assert.equal(findByClass(clipTile, 'dashboard-material-video-ph').length, 1, 'video placeholder rendered');
	assert.equal(findByClass(clipTile, 'dashboard-media-play').length, 1, 'play badge rendered');
	assert.equal(findByClass(clipTile, 'dashboard-material-meta-tags').length, 0, 'no tags row when the item is untagged');
	assert.equal(findByClass(clipTile, 'dashboard-material-heart').length, 1, 'every tile carries a heart');
	assert.equal(findByClass(clipTile, 'dashboard-material-actbtn').length, 3, 'tag/move/delete hover actions per tile');

	// --- 3. Search ------------------------------------------------------------
	const search = findByClass(host, 'dashboard-library-search')[0]!;
	search.value = 'cover';
	search.dispatchEvent({ type: 'input' });
	assert.deepEqual(tilePaths(host), ['素材/cover.png'], 'search narrows to the matching tile');
	assert.equal(countEl.textContent, '1 个文件');
	search.value = 'zzz-does-not-exist';
	search.dispatchEvent({ type: 'input' });
	assert.equal(findByClass(host, 'dashboard-library-empty').length, 1, 'no-match empty state');
	assert.equal(findByClass(host, 'dashboard-material-tile').length, 0);
	search.value = '';
	search.dispatchEvent({ type: 'input' });
	assert.equal(tilePaths(host).length, 4, 'cleared search restores results');

	// --- 4. Type pills + group modes ------------------------------------------
	// Types are visible segmented buttons, not a dropdown menu.
	let pills = findByClass(host, 'dashboard-material-typepill');
	assert.equal(pills.length, 4, 'four type pills: all / image / video / text');
	assert.equal(pills[0]!.hasClass('active'), true, 'all pill starts active');
	pills[2]!.click();
	assert.deepEqual(tilePaths(host), ['素材/clip.mp4'], 'video pill filters to videos');
	pills = findByClass(host, 'dashboard-material-typepill');
	assert.equal(pills[2]!.hasClass('active'), true, 'video pill is now the active one');
	pills[3]!.click();
	assert.deepEqual(tilePaths(host), ['素材/article.md'], 'text pill shows only COVERED text files (notes.txt is gated out)');
	pills = findByClass(host, 'dashboard-material-typepill');
	pills[0]!.click();
	assert.equal(tilePaths(host).length, 4, 'all pill restores every kind');

	// Folder groups with in-place collapse.
	const groupSelect = findByClass(host, 'dashboard-media-group-select')[0]!;
	groupSelect.value = 'folder';
	groupSelect.dispatchEvent({ type: 'change' });
	const headers = findByClass(host, 'dashboard-media-group-header');
	assert.equal(headers.length, 1, 'single folder group for the scoped 素材 folder');
	assert.equal(headers[0]!.dataset.groupKey, '素材');
	assert.equal(findByClass(host, 'dashboard-media-group-count')[0]!.textContent, '4', 'folder group count excludes the coverless text file');
	assert.equal(findByClass(host, 'dashboard-material-col').length, 2, 'each group body lays out its own waterfall');
	// Single group → collapse-all shows, but the left nav rail needs >= 2.
	assert.equal(findByClass(host, 'dashboard-material-collapse-all')[0]!.hasClass('is-hidden'), false, 'collapse-all visible once grouped');
	assert.equal(findByClass(host, 'dashboard-section-rail--left').length, 0, 'left nav rail needs at least two groups');
	headers[0]!.click();
	assert.equal(findByClass(host, 'dashboard-media-group-body')[0]!.hasClass('is-hidden'), true, 'collapse hides the group body');
	headers[0]!.click();
	assert.equal(findByClass(host, 'dashboard-media-group-body')[0]!.hasClass('is-hidden'), false, 'second click expands');

	// Type groups: keys stay raw (collapse state), labels localize.
	groupSelect.value = 'type';
	groupSelect.dispatchEvent({ type: 'change' });
	const typeHeaders = findByClass(host, 'dashboard-media-group-header');
	assert.equal(typeHeaders.length, 3, 'three type groups');
	assert.deepEqual(typeHeaders.map(h => h.dataset.groupKey), ['image', 'text', 'video'], 'group keys stay the raw kinds');
	assert.deepEqual(typeHeaders.map(h => findByClass(h, 'dashboard-media-group-name')[0]!.textContent), ['图片', '文本', '视频'], 'group labels are localized');

	// Left nav rail (section-rail styling, mounted left): one dash per group,
	// data-name carrying the LOCALIZED label (type groups localize).
	const leftRail = findByClass(host, 'dashboard-section-rail--left')[0]!;
	assert.ok(leftRail, 'left nav rail mounts in grouped view');
	const dashes = findByClass(leftRail, 'dashboard-section-rail-item');
	assert.equal(dashes.length, 3, 'one dash per type group');
	assert.deepEqual(dashes.map(d => d.dataset.name), ['图片', '文本', '视频'], 'dash labels match the group headers');

	// One-click collapse-all: every header collapses in place (bodies hidden,
	// state synced), the button flips to its expand state.
	const collapseBtn = findByClass(host, 'dashboard-material-collapse-all')[0]!;
	assert.equal(collapseBtn.getAttribute('title'), '折叠全部分组', 'collapse-all starts in collapse wording');
	collapseBtn.click();
	assert.equal(findByClass(host, 'dashboard-media-group-header').every(h => h.hasClass('is-collapsed')), true, 'all headers collapsed');
	assert.equal(findByClass(host, 'dashboard-media-group-body').every(b => b.hasClass('is-hidden')), true, 'all group bodies hidden');
	assert.equal(findByClass(host, 'dashboard-material-collapse-all')[0]!.getAttribute('title'), '展开全部分组', 'button flips to expand wording');
	findByClass(host, 'dashboard-material-collapse-all')[0]!.click();
	assert.equal(findByClass(host, 'dashboard-media-group-header').every(h => !h.hasClass('is-collapsed')), true, 'second click expands every group');
	assert.equal(findByClass(host, 'dashboard-media-group-body').every(b => !b.hasClass('is-hidden')), true, 'all group bodies visible again');
	groupSelect.value = 'none';
	groupSelect.dispatchEvent({ type: 'change' });
	assert.equal(findByClass(host, 'dashboard-section-rail--left').length, 0, 'left nav rail unmounts back in flat view');
	assert.equal(findByClass(host, 'dashboard-material-collapse-all')[0]!.hasClass('is-hidden'), true, 'collapse-all hides again in flat view');

	// --- 5. Select mode + action rail + skill dispatch -------------------------
	findByClass(host, 'dashboard-material-select-toggle')[0]!.click();
	const selectToggle = findByClass(host, 'dashboard-material-select-toggle')[0]!;
	assert.ok(selectToggle.hasClass('active'), 'toggle reflects active select mode');
	assert.equal(findByClass(host, 'dashboard-material-tile').every(el => el.hasClass('is-select-mode')), true, 'tiles enter select mode');
	// Rail persists the whole time select mode is on — skill buttons are
	// discoverable right after being configured, disabled at zero selection.
	const railOf = (): El => findByClass(host, 'dashboard-material-actionrail')[0]!;
	const railBtnByTitle = (rail: El, title: string): El | undefined =>
		findByClass(rail, 'dashboard-material-railbtn').find(el => el.getAttribute('title') === title);
	assert.equal(findByClass(railOf(), 'dashboard-material-railcount').length, 0, 'no count badge at zero selection');
	assert.equal(railBtnByTitle(railOf(), '打标签')!.getAttribute('disabled'), 'disabled', 'tag disabled at zero');
	assert.equal(railBtnByTitle(railOf(), '移动到…')!.getAttribute('disabled'), 'disabled', 'move disabled at zero');
	assert.equal(railBtnByTitle(railOf(), '复制路径')!.getAttribute('disabled'), 'disabled', 'copy disabled at zero');
	assert.equal(railBtnByTitle(railOf(), '删除')!.getAttribute('disabled'), 'disabled', 'delete disabled at zero');
	assert.equal(railBtnByTitle(railOf(), '取消选择')!.getAttribute('disabled'), null, 'clear stays enabled');

	// Click tiles to select two of them.
	const tileEls = findByClass(host, 'dashboard-material-tile');
	tileEls.find(el => el.dataset.materialPath === '素材/cover.png')!.click();
	tileEls.find(el => el.dataset.materialPath === '素材/clip.mp4')!.click();
	const selectedTiles = findByClass(host, 'dashboard-material-tile').filter(el => el.hasClass('is-selected'));
	assert.equal(selectedTiles.length, 2, 'clicked tiles flip is-selected');
	assert.equal(findByClass(railOf(), 'dashboard-material-railcount')[0]!.textContent, '2', 'rail count badge shows the selection size');
	assert.equal(findByClass(railOf(), 'dashboard-material-railbtn--skill')[0]!.getAttribute('disabled'), null, 'skill button enabled with a selection');
	assert.equal(railBtnByTitle(railOf(), '复制路径')!.getAttribute('disabled'), null, 'copy enabled with a selection');
	// Copy paths writes ABSOLUTE paths (vault basePath + relative path).
	railBtnByTitle(railOf(), '复制路径')!.click();
	assert.equal(clipboardText, '/vault-root/素材/cover.png\n/vault-root/素材/clip.mp4', 'copied paths are absolute on-disk paths');
	// Skill dispatch → agent prompt modal (non-directSend previews).
	StubModal.last = null;
	findByClass(railOf(), 'dashboard-material-railbtn--skill')[0]!.click();
	// Re-widen: the `= null` above narrows the property through the intervening call.
	const openedPrompt = StubModal.last as Modal | null;
	assert.ok(openedPrompt instanceof AgentPromptModal, 'skill button opens AgentPromptModal');
	// Modal content: the {paths} var lists the dash-prefixed selection.
	const promptModal = openedPrompt as unknown as { contentEl: El; onOpen(): void };
	promptModal.onOpen();
	assert.ok(promptModal.contentEl.textContent.includes('- 素材/cover.png') && promptModal.contentEl.textContent.includes('- 素材/clip.mp4'), 'prompt lists the selected files');
	// Clear selection keeps the rail (select mode still on) at zero.
	railBtnByTitle(railOf(), '取消选择')!.click();
	assert.equal(findByClass(host, 'dashboard-material-actionrail').length, 1, 'clear selection keeps the rail while select mode is on');
	assert.equal(findByClass(railOf(), 'dashboard-material-railcount').length, 0, 'count badge drops back off at zero');

	// --- 6. Rubber-band marquee selection --------------------------------------
	// Still in select mode, nothing selected. Give the tiles deterministic
	// viewport rects: cover and clip sit side by side at the top, everything
	// else parks far below the sweep.
	const area = findByClass(host, 'dashboard-material-area')[0]!;
	const rectFor = (path: string): { top: number; right: number; bottom: number; left: number; width: number; height: number } => {
		if (path === '素材/cover.png') return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
		if (path === '素材/clip.mp4') return { left: 200, top: 0, right: 300, bottom: 100, width: 100, height: 100 };
		return { left: 0, top: 5000, right: 100, bottom: 5100, width: 100, height: 100 };
	};
	for (const tile of findByClass(host, 'dashboard-material-tile')) {
		const rect = rectFor(tile.dataset.materialPath ?? '');
		tile.getBoundingClientRect = () => ({ ...rect });
	}
	// Sweep 1: (0,0) → (150,60) covers only cover.png.
	area.dispatchEvent({ type: 'pointerdown', target: area, clientX: 0, clientY: 0 });
	assert.equal(findByClass(host, 'dashboard-material-marquee').length, 1, 'marquee rectangle mounts on empty-canvas press');
	docEl.dispatchEvent({ type: 'pointermove', clientX: 150, clientY: 60 });
	docEl.dispatchEvent({ type: 'pointerup' });
	assert.equal(findByClass(host, 'dashboard-material-marquee').length, 0, 'marquee removed on release');
	let swept = findByClass(host, 'dashboard-material-tile').filter(el => el.hasClass('is-selected'));
	assert.deepEqual(swept.map(el => el.dataset.materialPath), ['素材/cover.png'], 'sweep selects the intersecting tile');
	assert.equal(findByClass(railOf(), 'dashboard-material-railcount')[0]!.textContent, '1', 'rail badge reflects the sweep');
	// Sweep 2: (0,0) → (250,60) covers both top tiles (union with the
	// drag-start snapshot — cover stays picked).
	area.dispatchEvent({ type: 'pointerdown', target: area, clientX: 0, clientY: 0 });
	docEl.dispatchEvent({ type: 'pointermove', clientX: 250, clientY: 60 });
	docEl.dispatchEvent({ type: 'pointerup' });
	swept = findByClass(host, 'dashboard-material-tile').filter(el => el.hasClass('is-selected'));
	assert.deepEqual(swept.map(el => el.dataset.materialPath).sort(), ['素材/clip.mp4', '素材/cover.png'], 'wider sweep unions both tiles into the selection');
	// A press that starts on a TILE never starts a sweep (tiles own their
	// pointer gestures — the click handler toggles selection instead).
	const coverTilePress = findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/cover.png')!;
	coverTilePress.dispatchEvent({ type: 'pointerdown', target: coverTilePress, clientX: 0, clientY: 0 });
	docEl.dispatchEvent({ type: 'pointermove', clientX: 250, clientY: 60 });
	docEl.dispatchEvent({ type: 'pointerup' });
	assert.equal(findByClass(host, 'dashboard-material-marquee').length, 0, 'tile-anchored press never mounts a marquee');
	assert.equal(findByClass(host, 'dashboard-material-tile').filter(el => el.hasClass('is-selected')).length, 2, 'tile-anchored press leaves the selection alone');

	// Leaving select mode clears the mode classes (the toggle is rebuilt on
	// every toggle, so re-query before asserting).
	findByClass(host, 'dashboard-material-select-toggle')[0]!.click();
	assert.equal(findByClass(host, 'dashboard-material-tile').every(el => !el.hasClass('is-select-mode')), true, 'tiles leave select mode');
	assert.equal(findByClass(host, 'dashboard-material-select-toggle')[0]!.hasClass('active'), false, 'toggle drops its active state');
	assert.equal(findByClass(host, 'dashboard-material-actionrail').length, 1, 'rail stays mounted outside select mode');

	// --- 7. Delayed open + double-click rename ---------------------------------
	// Single click opens on a delay: nothing fires immediately…
	StubModal.last = null;
	findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/clip.mp4')!.click();
	assert.ok(!StubModal.last, 'no modal before the open delay elapses');
	await sleep(320);
	const openedLightbox = StubModal.last as Modal | null;
	assert.ok(openedLightbox instanceof MediaLightboxModal, 'delayed single click opens the lightbox');

	// Text tiles open as notes (openLinkText), also on the delay.
	const articleTileNow = findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/article.md')!;
	articleTileNow.click();
	assert.equal(openedNotes.length, 0, 'note open also waits out the delay');
	// …and a double-click cancels the pending open and starts the rename.
	articleTileNow.dispatchEvent({ type: 'dblclick' });
	const renameInput = findByClass(articleTileNow, 'dashboard-library-table-edit-input')[0]!;
	assert.ok(renameInput, 'double-click swaps the name row into an inline input');
	renameInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
	await sleep(320);
	assert.equal(openedNotes.length, 0, 'double-click cancelled the pending note open');
	assert.equal(renamed.length, 0, 'escape discards the rename');

	// A committed rename rides through renameFile (extension preserved).
	const articleTile2 = findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/article.md')!;
	articleTile2.dispatchEvent({ type: 'dblclick' });
	const input2 = findByClass(articleTile2, 'dashboard-library-table-edit-input')[0]!;
	input2.value = '封面文章';
	input2.dispatchEvent({ type: 'keydown', key: 'Enter' });
	assert.deepEqual(renamed, [{ from: '素材/article.md', to: '素材/封面文章.md' }], 'enter commits the rename with the extension kept');
	assert.ok(findByClass(host, 'dashboard-material-tile').some(el => el.dataset.materialPath === '素材/article.md'), 'tile re-renders (stub vault keeps the old path)');

	// --- 8. Per-tile tag editor -------------------------------------------------
	StubModal.last = null;
	const coverTileNow = findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/cover.png')!;
	findByClass(coverTileNow, 'dashboard-material-actbtn')[0]!.click();
	const openedTagModal = StubModal.last as Modal | null;
	assert.ok(openedTagModal instanceof MediaTagEditModal, 'tile tag button opens MediaTagEditModal against the shared store');

	// Settings gear routes through the context hook.
	findByClass(host, 'dashboard-material-settings-btn')[0]!.click();
	assert.equal(settingsOpened, 1, 'settings gear invokes onOpenSettings');

	// --- 8b. Favorites: heart + collection filter ------------------------------
	const favBtn = findByClass(host, 'dashboard-material-favorites-btn')[0]!;
	assert.ok(favBtn, 'toolbar favorites entry mounted');
	assert.equal(favBtn.getAttribute('title'), '收藏', 'entry labels the favorites action');
	assert.equal(favBtn.hasClass('active'), false, 'favorites filter starts off');

	// Heart click: fills IN PLACE through the hooks (tile node survives — no
	// re-render) and never opens the item (stopPropagation guards the tile).
	StubModal.last = null;
	const artTileNode = tileOf('素材/article.md');
	const heartEl = findByClass(artTileNode, 'dashboard-material-heart')[0]!;
	heartEl.click();
	assert.equal(findByClass(artTileNode, 'dashboard-material-heart')[0]!.hasClass('is-fav'), true, 'heart fills after the click');
	assert.ok(findByClass(host, 'dashboard-material-tile').includes(artTileNode), 'tile survives the in-place heart flip');
	assert.deepEqual(favOps, ['素材/article.md'], 'toggle routes through the favorites hooks');
	await sleep(320);
	assert.ok(!StubModal.last, 'heart click never opens the lightbox');
	assert.equal(openedNotes.length, 0, 'heart click never opens the note either');

	// Toolbar entry scopes the waterfall to the collection.
	favBtn.click();
	assert.equal(favBtn.hasClass('active'), true, 'entry reflects the filtered state');
	assert.deepEqual(tilePaths(host), ['素材/article.md'], 'favorites view lists only the collected item');
	assert.equal(countEl.textContent, '1 个文件');
	// Un-favoriting INSIDE the filtered view drops the tile live.
	findByClass(tileOf('素材/article.md'), 'dashboard-material-heart')[0]!.click();
	assert.equal(tilePaths(host).length, 0, 'un-favoriting inside the collection drops the tile');
	assert.equal(findByClass(host, 'dashboard-library-empty').length, 1, 'empty collection shows the empty state');
	favBtn.click();
	assert.equal(favBtn.hasClass('active'), false, 'leaving the filter restores the full waterfall');
	assert.equal(tilePaths(host).length, 4);
	assert.deepEqual(favOps, ['素材/article.md', '素材/article.md'], 'both heart toggles went through the hooks');

	// --- 8c. Card style switch (original cover card ⇄ Pin polaroid) ------------
	const styleBtn = findByClass(host, 'dashboard-material-style-btn')[0]!;
	assert.ok(styleBtn, 'toolbar carries the card-style switch');
	assert.equal(styleBtn.getAttribute('title'), 'Pin 风格', 'the button names the CURRENT style (polaroid)');
	assert.equal(findByClass(host, 'dashboard-material-tile').every(el => el.hasClass('dashboard-material-tile--polaroid')), true, 'tiles start in the polaroid style');

	// Flip to the original cover-only card.
	styleBtn.click();
	const plainTiles = findByClass(host, 'dashboard-material-tile');
	assert.equal(plainTiles.every(el => el.hasClass('dashboard-material-tile--plain')), true, 'every tile switches to the plain variant');
	assert.equal(plainTiles.every(el => el.dataset.cardStyle === 'plain'), true, 'dataset mirrors the active style');
	assert.equal(findByClass(host, 'dashboard-material-photo').length, 0, 'the paper block is polaroid-only');
	assert.equal(findByClass(host, 'dashboard-material-meta').length, 0, 'the macaron meta strip is polaroid-only');
	assert.equal(findByClass(host, 'dashboard-material-meta-date').length, 0, 'no created-date row in the plain style');
	assert.equal(findByClass(host, 'dashboard-material-plainrow').length, 0, 'plain adds NOTHING below the image (no bottom row)');
	assert.equal(findByClass(host, 'dashboard-material-coverbar').length, plainTiles.length, 'each plain tile pins ONE overlay bar on the cover');
	assert.equal(findByClass(host, 'dashboard-material-name').length, plainTiles.length, 'the caption survives the style switch');
	assert.equal(findByClass(host, 'dashboard-material-style-btn')[0]!.getAttribute('title'), '原始风格', 'the button names the new current style');
	assert.equal(storage['apex-dashboard-material-card-style'], 'plain', 'the choice persists to localStorage');
	// Title + heart share the bar: same row, title first, heart last.
	const plainCover = plainTiles.find(el => el.dataset.materialPath === '素材/cover.png')!;
	const plainBar = findByClass(plainCover, 'dashboard-material-coverbar')[0]!;
	const barName = findByClass(plainBar, 'dashboard-material-name')[0]!;
	assert.ok(barName.hasClass('dashboard-material-name--plain'), 'the plain caption carries its overlay variant class');
	assert.equal(barName.textContent, 'cover', 'the bar shows the basename');
	const barChildren = plainBar.children;
	assert.equal(barChildren.length, 2, 'the bar carries exactly the caption and the heart');
	assert.equal(barChildren[0], barName, 'caption first');
	assert.equal(barChildren[1]!.hasClass('dashboard-material-heart'), true, 'heart beside it, never below the image');
	// Hearts work in the plain style too…
	const plainHeart = findByClass(plainCover, 'dashboard-material-heart')[0]!;
	plainHeart.click();
	assert.equal(plainHeart.hasClass('is-fav'), true, 'plain-style heart fills in place');

	// …and the favorite survives the flip back (state lives in the context).
	styleBtn.click();
	assert.equal(findByClass(host, 'dashboard-material-tile').every(el => el.hasClass('dashboard-material-tile--polaroid')), true, 'flipping back restores the polaroid cards');
	assert.equal(findByClass(host, 'dashboard-material-meta').length, 4, 'the meta strip comes back on every tile');
	const backCover = findByClass(host, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/cover.png')!;
	assert.equal(findByClass(backCover, 'dashboard-material-heart')[0]!.hasClass('is-fav'), true, 'favorites survive a style flip');
	assert.equal(storage['apex-dashboard-material-card-style'], 'polaroid', 'the flipped-back choice persists too');

	// --- 9. Controller lifecycle + the config GETTER (scan-scope fix) -----------
	// refresh() re-reads the getter: widening the scan scope through the SAME
	// live object (what the settings modal effectively does) must reach the
	// next refresh without a remount — the old captured-config closure showed
	// the whole vault forever / ignored scope edits.
	const before = tilePaths(host);
	controller.refresh();
	assert.equal(tilePaths(host).length, before.length, 'refresh rebuilds the same listing');
	liveConfig.includeFolders = [];
	controller.refresh();
	assert.equal(countEl.textContent, '5 个文件', 'widened scope reaches the next refresh through the getter');
	assert.ok(tilePaths(host).includes('外部/outside.md'), 'out-of-scope text file appears once the scope is cleared (it has a 封面)');
	assert.ok(!tilePaths(host).includes('素材/notes.txt'), 'notes.txt stays gated out even at full-vault scope (no cover)');
	liveConfig.includeFolders = ['素材'];
	controller.refresh();
	assert.equal(countEl.textContent, '4 个文件', 'narrowing the scope again drops the outside file');
	assert.ok(!tilePaths(host).includes('外部/outside.md'), 'scoped refresh excludes the outside file again');
	controller.destroy();
	assert.ok(true, 'destroy runs clean (no ResizeObserver/mounter in node)');
	assert.equal(findByClass(host, 'dashboard-section-rail--left').length, 0, 'destroy unmounts any live nav rail');

	// --- 10. Folder grouping BELOW the scan root + a stored card style ---------
	// A scoped library groups by the sub-folder under the root (Rae), headers
	// and nav dashes show that sub-folder's own name, and a style persisted by
	// an earlier session is honored at mount.
	const DEEP_VAULT = [
		mediaFile('素材/cover.png', 30, 500),
		mediaFile('素材/图片/shot.jpg', 20, 400),
		mediaFile('素材/图片/2024/newyear.png', 15, 300),
		mediaFile('素材/视频/clip.mp4', 40, 9000),
	];
	const deep = makeApp(DEEP_VAULT, {}, { 'apex-dashboard-material-card-style': 'plain' });
	const deepHost = new El('div');
	bodyHost.appendChild(deepHost);
	const deepController = renderMaterialLibrary(deepHost as unknown as HTMLElement, {
		app: deep.app,
		getConfig: () => ({ includeFolders: ['素材'], excludeFolders: [], skillButtons: [] }),
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore: { getTags: () => [], getAllTags: () => [], setTags: () => true },
	});
	assert.equal(deep.storage['apex-dashboard-material-card-style'], 'plain', 'fixture seeded the stored style');
	assert.equal(findByClass(deepHost, 'dashboard-material-tile').every(el => el.hasClass('dashboard-material-tile--plain')), true, 'a stored style is honored at mount');
	const deepGroupSelect = findByClass(deepHost, 'dashboard-media-group-select')[0]!;
	deepGroupSelect.value = 'folder';
	deepGroupSelect.dispatchEvent({ type: 'change' });
	const deepHeaders = findByClass(deepHost, 'dashboard-media-group-header');
	assert.deepEqual(
		deepHeaders.map(h => h.dataset.groupKey),
		['素材', '素材/图片', '素材/视频'],
		'folder keys stay root-qualified so two roots cannot collide',
	);
	assert.deepEqual(
		deepHeaders.map(h => findByClass(h, 'dashboard-media-group-name')[0]!.textContent),
		['素材', '图片', '视频'],
		'headers show the sub-folder name, not the whole key',
	);
	assert.deepEqual(
		findByClass(deepHost, 'dashboard-section-rail-item').map(d => d.dataset.name),
		['素材', '图片', '视频'],
		'the left nav rail lists the sub-folder labels',
	);
	assert.equal(findByClass(deepHeaders[1]!, 'dashboard-media-group-count')[0]!.textContent, '2', 'deeper levels fold into the first sub-folder below the root');
	assert.equal(findByClass(deepHeaders[0]!, 'dashboard-media-group-count')[0]!.textContent, '1', 'files directly in the root bucket under the root itself');
	deepController.destroy();

	// --- 11. OS file drop: drag in from outside → copy into the vault ----------
	// Rae's rules: a folder group takes the file into its own folder, a tag
	// group into the configured default folder PLUS its tag, and anything else
	// (flat view, type group, no default configured) into the default folder —
	// falling back to Obsidian's attachment folder.
	const DROP_VAULT = [
		mediaFile('素材/图片/shot.jpg', 20, 400),
		mediaFile('素材/视频/clip.mp4', 40, 9000),
	];
	const drop = makeApp(DROP_VAULT, {});
	const dropTagMap = new Map<string, string[]>();
	const dropHost = new El('div');
	bodyHost.appendChild(dropHost);
	let dropCfg: MaterialLibraryConfig = {
		includeFolders: ['素材'], excludeFolders: [], skillButtons: [], importFolder: '素材/收件箱',
	};
	const dropController = renderMaterialLibrary(dropHost as unknown as HTMLElement, {
		app: drop.app,
		getConfig: () => dropCfg,
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore: {
			getTags: (p: string) => [...dropTagMap.get(p) ?? []],
			getAllTags: () => [...new Set([...dropTagMap.values()].flat())],
			setTags: (p: string, tags: readonly string[]) => { dropTagMap.set(p, [...tags]); return true; },
		},
	});
	const dropContent = findByClass(dropHost, 'dashboard-material-content')[0]!;
	const dropArea = findByClass(dropHost, 'dashboard-material-area')[0]!;
	const dropHint = findByClass(dropHost, 'dashboard-material-drophint')[0]!;
	const dropGroupSelect = findByClass(dropHost, 'dashboard-media-group-select')[0]!;
	const fakeFile = (name: string, bytes = 6) => ({ name, arrayBuffer: async () => new ArrayBuffer(bytes) });
	const dragEvent = (type: string, target: El, files: unknown[]) =>
		({ type, target, dataTransfer: { files, types: ['Files'], dropEffect: 'none' } });
	const setGroup = (mode: string): void => {
		dropGroupSelect.value = mode;
		dropGroupSelect.dispatchEvent({ type: 'change' });
	};
	const bodyForKey = (key: string): El => {
		const found = findByClass(dropHost, 'dashboard-media-group-body').find(b => b.dataset.importKey === key);
		assert.ok(found, `group body for ${key}`);
		return found!;
	};

	// The bare results area is the fallback zone; the hint waits for a drag.
	assert.ok(dropArea.hasClass('dashboard-material-dropzone'), 'the results area is itself a drop zone');
	assert.ok(!dropArea.dataset.importKey, 'the fallback zone carries no group key');
	assert.ok(dropHint.hasClass('is-hidden'), 'the destination hint is hidden while nothing is dragged');

	// 11a. flat view: dragging in shows where the file will land.
	dropArea.dispatchEvent(dragEvent('dragenter', dropArea, [fakeFile('a.png')]));
	assert.ok(dropContent.hasClass('is-dragging-file'), 'a file drag marks the content');
	assert.equal(dropHint.hasClass('is-hidden'), false, 'the hint shows during the drag');
	assert.equal(dropHint.textContent, t('material.dropHint', { folder: '素材/收件箱' }), 'the hint names the configured default');
	assert.ok(dropArea.hasClass('is-drop-active'), 'the hovered zone highlights');

	// 11b. dropping copies into the default folder, refuses non-media, refreshes.
	StubNotice.messages.length = 0;
	drop.created.length = 0;
	dropArea.dispatchEvent(dragEvent('drop', dropArea, [fakeFile('dropped.png', 11), fakeFile('note.md')]));
	await sleep(20);
	assert.deepEqual(drop.created, [{ path: '素材/收件箱/dropped.png', bytes: 11 }], 'the copy lands in the configured default folder');
	assert.deepEqual(drop.mkdirs, ['素材/收件箱'], 'a missing destination is created (existing parents are not)');
	assert.equal(dropContent.hasClass('is-dragging-file'), false, 'the drag state clears on drop');
	assert.ok(dropHint.hasClass('is-hidden'), 'and the hint hides again');
	assert.ok(tilePaths(dropHost).includes('素材/收件箱/dropped.png'), 'the post-drop refresh tiles the imported file');
	assert.equal(StubNotice.messages.length, 1, 'one notice per drop');
	assert.deepEqual(StubNotice.messages[0]!.split('\n'), [
		t('material.imported', { count: 1, folder: '素材/收件箱' }),
		t('material.dropSkipped', { count: 1 }),
	], 'the notice reports what landed and what was refused');

	// 11c. folder grouping: the drop goes into THAT group's folder, untagged.
	setGroup('folder');
	const folderHeaders = findByClass(dropHost, 'dashboard-media-group-header');
	assert.ok(folderHeaders.every(h => typeof h.dataset.importKey === 'string' && h.dataset.importKey !== ''), 'every group header is a drop zone carrying its key');
	const pictureBody = bodyForKey('素材/图片');
	drop.created.length = 0;
	drop.mkdirs.length = 0;
	pictureBody.dispatchEvent(dragEvent('dragenter', pictureBody, [fakeFile('x.png')]));
	assert.equal(dropHint.textContent, t('material.dropHint', { folder: '素材/图片' }), 'the hint follows the hovered folder group');
	assert.ok(pictureBody.hasClass('is-drop-active'), 'the hovered group highlights');
	assert.ok(!dropArea.hasClass('is-drop-active'), 'only the innermost zone stays highlighted');
	pictureBody.dispatchEvent(dragEvent('drop', pictureBody, [fakeFile('pic.png', 7)]));
	await sleep(20);
	assert.deepEqual(drop.created, [{ path: '素材/图片/pic.png', bytes: 7 }], 'a folder-group drop copies into that folder');
	assert.deepEqual(drop.mkdirs, [], 'an existing destination needs no mkdir');
	assert.equal(dropTagMap.size, 0, 'folder drops do not tag');

	// 11d. tag grouping: default folder PLUS the group's tag.
	dropTagMap.set('素材/图片/shot.jpg', ['封面']);
	setGroup('tag');
	drop.created.length = 0;
	StubNotice.messages.length = 0;
	bodyForKey('封面').dispatchEvent(dragEvent('drop', bodyForKey('封面'), [fakeFile('tagged.png', 5)]));
	await sleep(20);
	assert.deepEqual(drop.created, [{ path: '素材/收件箱/tagged.png', bytes: 5 }], 'a tag-group drop still uses the default folder');
	assert.deepEqual(dropTagMap.get('素材/收件箱/tagged.png'), ['封面'], 'and stamps the group tag on the copy');
	assert.equal(
		StubNotice.messages[0],
		t('material.importedWithTag', { count: 1, folder: '素材/收件箱', tag: '封面' }),
		'the notice names the tag that was applied',
	);

	// 11e. type grouping: a kind is not a folder — the default wins, no tag.
	setGroup('type');
	drop.created.length = 0;
	bodyForKey('image').dispatchEvent(dragEvent('drop', bodyForKey('image'), [fakeFile('typed.png', 3)]));
	await sleep(20);
	assert.deepEqual(drop.created, [{ path: '素材/收件箱/typed.png', bytes: 3 }], 'a type group is not a destination');
	assert.equal(dropTagMap.has('素材/收件箱/typed.png'), false, 'and nothing is tagged');

	// 11f. a drag without files (text/URI) is never hijacked.
	drop.created.length = 0;
	StubNotice.messages.length = 0;
	dropArea.dispatchEvent({ type: 'drop', target: dropArea, dataTransfer: { files: [], types: ['text/plain'] } });
	await sleep(5);
	assert.deepEqual(drop.created, [], 'a non-file drag copies nothing');
	assert.equal(StubNotice.messages.length, 0, 'and raises no notice');
	assert.equal(dropContent.hasClass('is-dragging-file'), false, 'leaving no drag state behind');

	// 11g. no configured default → Obsidian's attachment folder.
	dropCfg = { ...dropCfg, importFolder: '' };
	setGroup('none');
	drop.created.length = 0;
	dropArea.dispatchEvent(dragEvent('dragenter', dropArea, [fakeFile('b.png')]));
	assert.equal(dropHint.textContent, t('material.dropHint', { folder: '附件/默认' }), 'the hint falls back to the attachment folder');
	dropArea.dispatchEvent(dragEvent('drop', dropArea, [fakeFile('attach.png', 4)]));
	await sleep(20);
	assert.deepEqual(drop.created, [{ path: '附件/默认/attach.png', bytes: 4 }], 'an empty default lands in the attachment folder');
	dropController.destroy();

	// --- 12. Folder-group drag-move: drag a tile onto another group ---------
	// Rae: in folder grouping a group key IS a vault path, so an internal
	// drag-and-drop there means "move the file(s)". Internal drags carry a
	// custom data type (never 'Files'), so the OS-import wiring stays quiet.
	const MOVE_VAULT = [
		mediaFile('素材/图片/cover.png', 30, 500),
		mediaFile('素材/图片/shot.jpg', 20, 400),
		mediaFile('素材/视频/clip.mp4', 40, 9000),
		mediaFile('素材/视频/shot.jpg', 25, 100),
	];
	const mv = makeApp(MOVE_VAULT, {}, {}, true);
	const mvHost = new El('div');
	bodyHost.appendChild(mvHost);
	const mvController = renderMaterialLibrary(mvHost as unknown as HTMLElement, {
		app: mv.app,
		getConfig: () => ({ includeFolders: ['素材'], excludeFolders: [], skillButtons: [] }),
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore: { getTags: () => [], getAllTags: () => [], setTags: () => true },
	});
	const mvGroupSelect = findByClass(mvHost, 'dashboard-media-group-select')[0]!;
	const mvHint = findByClass(mvHost, 'dashboard-material-drophint')[0]!;
	const mvSetGroup = (mode: string): void => {
		mvGroupSelect.value = mode;
		mvGroupSelect.dispatchEvent({ type: 'change' });
	};
	const mvBodyForKey = (key: string): El => {
		const found = findByClass(mvHost, 'dashboard-media-group-body').find(b => b.dataset.importKey === key);
		assert.ok(found, `group body for ${key}`);
		return found!;
	};
	const mvTile = (path: string): El => {
		const found = findByClass(mvHost, 'dashboard-material-tile').find(el => el.dataset.materialPath === path);
		assert.ok(found, `tile for ${path}`);
		return found!;
	};
	// A recording DataTransfer for INTERNAL drags: types grow via setData, so
	// the handler's type sniffing works exactly like a real browser's.
	const moveDT = () => {
		const store = new Map<string, string>();
		const types: string[] = [];
		return {
			types,
			effectAllowed: 'none',
			dropEffect: 'none',
			setData(type: string, value: string): void { if (!types.includes(type)) types.push(type); store.set(type, value); },
			getData(type: string): string { return store.get(type) ?? ''; },
		};
	};
	const moveEvent = (type: string, target: El, dt: ReturnType<typeof moveDT>) => {
		const record = {
			type,
			target,
			dataTransfer: dt,
			prevented: false,
			preventDefault(): void { record.prevented = true; },
			stopPropagation(): void {},
		};
		return record;
	};
	const draggableOf = (el: El): boolean => (el as unknown as { draggable?: boolean }).draggable === true;

	// 12a. flat view: tiles are not draggable and an internal drag seeds nothing.
	const flatDT = moveDT();
	mvTile('素材/图片/cover.png').dispatchEvent(moveEvent('dragstart', mvTile('素材/图片/cover.png'), flatDT));
	assert.deepEqual(flatDT.types, [], 'flat view: no drag payload is seeded');
	assert.equal(findByClass(mvHost, 'dashboard-material-tile').every(el => !draggableOf(el)), true, 'flat view: tiles are not draggable');

	// 12b. folder grouping turns tiles into drag sources.
	mvSetGroup('folder');
	assert.equal(findByClass(mvHost, 'dashboard-material-tile').every(el => draggableOf(el)), true, 'folder view: every tile is draggable');
	const mvCoverTile = mvTile('素材/图片/cover.png');

	// 12c. dragstart seeds the custom type with the tile's path.
	const dt = moveDT();
	mvCoverTile.dispatchEvent(moveEvent('dragstart', mvCoverTile, dt));
	assert.deepEqual(dt.types, [MATERIAL_MOVE_DRAG_TYPE], 'dragstart seeds the internal move type');
	assert.equal(dt.effectAllowed, 'move', 'the drag is declared as a move');
	assert.equal(dt.getData(MATERIAL_MOVE_DRAG_TYPE), JSON.stringify(['素材/图片/cover.png']), 'the payload is the tile path as JSON');

	// 12d. hovering another folder group accepts the drop and shows where it lands.
	const videoBody = mvBodyForKey('素材/视频');
	const over = moveEvent('dragover', videoBody, dt);
	videoBody.dispatchEvent(over);
	assert.equal(over.prevented, true, 'a folder-group zone preventDefaults the dragover (drop is allowed)');
	assert.equal(dt.dropEffect, 'move', 'the cursor reports a move');
	assert.ok(videoBody.hasClass('is-move-active'), 'the hovered group outlines as the move target');
	assert.equal(mvHint.hasClass('is-hidden'), false, 'the destination hint shows');
	assert.equal(mvHint.textContent, t('material.moveHint', { folder: '视频' }), 'the hint names the sub-folder, not the whole key');

	// 12e. moving out of the hovered zone (no drop) clears the chrome.
	mvCoverTile.dispatchEvent({ type: 'dragend', target: mvCoverTile });
	assert.ok(!videoBody.hasClass('is-move-active'), 'dragend clears the outline');
	assert.ok(mvHint.hasClass('is-hidden'), 'dragend hides the hint');

	// 12f. the actual drop moves the file and the refresh regroups it.
	StubNotice.messages.length = 0;
	mv.renamed.length = 0;
	videoBody.dispatchEvent(moveEvent('dragover', videoBody, dt));
	videoBody.dispatchEvent(moveEvent('drop', videoBody, dt));
	await sleep(20);
	assert.deepEqual(mv.renamed, [{ from: '素材/图片/cover.png', to: '素材/视频/cover.png' }], 'the drop renames the file into the group folder');
	assert.deepEqual(StubNotice.messages, [t('material.moved', { count: 1 })], 'one notice reports the move');
	assert.ok(!videoBody.hasClass('is-move-active'), 'the outline clears after the drop');
	assert.ok(tilePaths(mvBodyForKey('素材/视频')).includes('素材/视频/cover.png'), 'the refreshed tile lands in the destination group');
	assert.equal(tilePaths(mvBodyForKey('素材/图片')).includes('素材/图片/cover.png'), false, 'and leaves its old group');

	// 12g. dropping onto the file's own group is a no-op (same destination).
	StubNotice.messages.length = 0;
	mv.renamed.length = 0;
	const ownDT = moveDT();
	mvTile('素材/图片/shot.jpg').dispatchEvent(moveEvent('dragstart', mvTile('素材/图片/shot.jpg'), ownDT));
	const mvPictureBody = mvBodyForKey('素材/图片');
	mvPictureBody.dispatchEvent(moveEvent('drop', mvPictureBody, ownDT));
	await sleep(20);
	assert.deepEqual(mv.renamed, [], 'a same-destination drop renames nothing');
	assert.deepEqual(StubNotice.messages, [], 'and stays silent');

	// 12h. a name conflict at the destination is skipped, not clobbered.
	StubNotice.messages.length = 0;
	mv.renamed.length = 0;
	// 素材/图片/shot.jpg dragged into 素材/视频 where shot.jpg already lives.
	const clashDT = moveDT();
	mvTile('素材/图片/shot.jpg').dispatchEvent(moveEvent('dragstart', mvTile('素材/图片/shot.jpg'), clashDT));
	mvBodyForKey('素材/视频').dispatchEvent(moveEvent('drop', mvBodyForKey('素材/视频'), clashDT));
	await sleep(20);
	assert.deepEqual(mv.renamed, [], 'a colliding move is never issued');
	assert.deepEqual(StubNotice.messages, [t('material.moveSkipped', { count: 1 })], 'the skip is reported');

	// 12i. a selection rides along: dragging a selected tile moves them all.
	const selectBtn = findByClass(mvHost, 'dashboard-material-select-toggle')[0]!;
	selectBtn.dispatchEvent({ type: 'click', target: selectBtn });
	const shotTile = mvTile('素材/图片/shot.jpg');
	const movedCoverTile = mvTile('素材/视频/cover.png');
	shotTile.dispatchEvent({ type: 'click', target: shotTile });
	movedCoverTile.dispatchEvent({ type: 'click', target: movedCoverTile });
	const multiDT = moveDT();
	shotTile.dispatchEvent(moveEvent('dragstart', shotTile, multiDT));
	assert.equal(
		multiDT.getData(MATERIAL_MOVE_DRAG_TYPE),
		JSON.stringify(['素材/图片/shot.jpg', '素材/视频/cover.png']),
		'dragging a selected tile carries the whole selection (in click order)',
	);

	// 12j. type grouping has no folder keys: even a properly typed internal
	// drag finds no legal zone there.
	mvSetGroup('type');
	const strayDT = moveDT();
	strayDT.setData(MATERIAL_MOVE_DRAG_TYPE, JSON.stringify(['素材/图片/shot.jpg']));
	const typeBody = mvBodyForKey('image');
	const typeOver = moveEvent('dragover', typeBody, strayDT);
	typeBody.dispatchEvent(typeOver);
	assert.equal(typeOver.prevented, false, 'a type group never accepts an internal move');
	assert.ok(!typeBody.hasClass('is-move-active'), 'and never outlines');
	mvController.destroy();

	// --- 13. No 500 ceiling: big vaults stay fully reachable -----------------
	// Rae: the old total cap hid everything past item 500 — flat pagination
	// never reached it, and grouped views dropped whole folders. Progressive
	// per-group rendering replaces the cap (first 50 + pill), and a group that
	// renders while collapsed builds nothing until it is expanded.
	const BIG_VAULT: TFile[] = [
		...Array.from({ length: 560 }, (_, i): TFile => mediaFile(`素材/图片/f${String(i).padStart(3, '0')}.png`, 100 + i, 500)),
		...Array.from({ length: 12 }, (_, i): TFile => mediaFile(`素材/视频/clip${String(i).padStart(2, '0')}.mp4`, 900 + i, 9000)),
	];
	const big = makeApp(BIG_VAULT, {}, {});
	const bigHost = new El('div');
	bodyHost.appendChild(bigHost);
	const bigController = renderMaterialLibrary(bigHost as unknown as HTMLElement, {
		app: big.app,
		getConfig: () => ({ includeFolders: ['素材'], excludeFolders: [], skillButtons: [] }),
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore: { getTags: () => [], getAllTags: () => [], setTags: () => true },
	});
	const bigGroupSelect = findByClass(bigHost, 'dashboard-media-group-select')[0]!;
	const bigCount = findByClass(bigHost, 'dashboard-library-count')[0]!;
	const bigSetGroup = (mode: string): void => {
		bigGroupSelect.value = mode;
		bigGroupSelect.dispatchEvent({ type: 'change' });
	};
	const bigHeaderOf = (key: string): El => {
		const found = findByClass(bigHost, 'dashboard-media-group-header').find(h => h.dataset.groupKey === key);
		assert.ok(found, `header for ${key}`);
		return found!;
	};
	const bigBodyOf = (key: string): El => {
		const found = findByClass(bigHost, 'dashboard-media-group-body').find(b => b.dataset.importKey === key);
		assert.ok(found, `group body for ${key}`);
		return found!;
	};

	// 13a. flat view: all 572 counted; pagination reaches page 12 (cap was 10).
	assert.equal(bigCount.textContent, t('library.fileCount', { count: 572 }), 'every file is counted — nothing hidden at 500');
	const lastPageBtn = findByClass(bigHost, 'dashboard-library-pagination-page').find(el => el.textContent === '12');
	assert.ok(lastPageBtn, 'pagination offers the 12th page (the old cap stopped at 10)');
	lastPageBtn.dispatchEvent({ type: 'click', target: lastPageBtn });
	assert.equal(findByClass(bigHost, 'dashboard-material-tile').length, 22, 'the last page mounts its full 22 tiles');

	// 13b. grouped view: every folder appears; big groups render progressively.
	bigSetGroup('folder');
	assert.deepEqual(
		findByClass(bigHost, 'dashboard-media-group-header').map(h => h.dataset.groupKey),
		['素材/图片', '素材/视频'],
		'every folder is a group — none dropped past a 500 cap',
	);
	assert.equal(findByClass(bigHeaderOf('素材/图片'), 'dashboard-media-group-count')[0]!.textContent, '560', 'the big group keeps its true count');
	assert.equal(findByClass(bigHeaderOf('素材/视频'), 'dashboard-media-group-count')[0]!.textContent, '12', 'and so does the small one');
	const bigPicBody = bigBodyOf('素材/图片');
	assert.equal(findByClass(bigPicBody, 'dashboard-material-tile').length, 50, 'a big group mounts its first 50 tiles only');
	const morePill = findByClass(bigPicBody, 'dashboard-library-load-more')[0]!;
	assert.equal(morePill.textContent, t('library.showMore', { count: 510 }), 'the pill counts the unmounted remainder');
	morePill.dispatchEvent({ type: 'click', target: morePill });
	assert.equal(findByClass(bigPicBody, 'dashboard-material-tile').length, 100, 'a pill click mounts the next batch in place');
	assert.equal(findByClass(bigBodyOf('素材/视频'), 'dashboard-material-tile').length, 12, 'a small group mounts everything, no pill');
	assert.equal(findByClass(bigBodyOf('素材/视频'), 'dashboard-library-load-more').length, 0, 'no pill under the size limit');

	// 13c. a group that renders while collapsed builds nothing until expanded.
	const videoHeader1 = bigHeaderOf('素材/视频');
	videoHeader1.dispatchEvent({ type: 'click', target: videoHeader1 });
	bigController.refresh();
	const videoBodyAfterRefresh = bigBodyOf('素材/视频');
	assert.ok(videoBodyAfterRefresh.hasClass('is-hidden'), 'the collapsed group body is hidden');
	assert.equal(findByClass(videoBodyAfterRefresh, 'dashboard-material-tile').length, 0, 'collapsed at render time: the body is deferred, not built');
	const videoHeader2 = bigHeaderOf('素材/视频');
	videoHeader2.dispatchEvent({ type: 'click', target: videoHeader2 });
	assert.equal(findByClass(bigBodyOf('素材/视频'), 'dashboard-material-tile').length, 12, 'expanding fills the deferred body');

	// 13d. expand-all also fills groups that rendered collapsed.
	const clipHeader1 = bigHeaderOf('素材/视频');
	clipHeader1.dispatchEvent({ type: 'click', target: clipHeader1 });
	bigController.refresh();
	const collapseAll = findByClass(bigHost, 'dashboard-material-collapse-all')[0]!;
	collapseAll.dispatchEvent({ type: 'click', target: collapseAll });
	assert.ok(bigBodyOf('素材/视频').hasClass('is-hidden'), 'collapse-all folds every group');
	collapseAll.dispatchEvent({ type: 'click', target: collapseAll });
	assert.equal(findByClass(bigBodyOf('素材/视频'), 'dashboard-material-tile').length, 12, 'expand-all builds deferred bodies before revealing');
	bigController.destroy();

	assert.equal(savedConfigs.length, 0, 'no config writes during render-only interactions');

	console.log('verify-material-render: all assertions passed');
}

void main();
