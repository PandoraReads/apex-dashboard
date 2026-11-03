/**
 * Material library render smoke test (src/material-render.ts): the full-page
 * waterfall surface against the mini-dom harness.
 *
 * 1. Initial render: toolbar (search / type dropdown / sort / group / density /
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
 * 4. Type filter: ONE dropdown button (icon + current label) whose native menu
 *    lists 全部/图片/视频/文本 and narrows the waterfall on pick; group mode
 *    renders folder groups with collapse headers; type groups show localized
 *    labels over raw kind keys. Grouped views reveal the collapse-all toolbar
 *    button and the LEFT nav rail (one dash per group, section-rail styling);
 *    flat views hide both.
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
 * 14. View theme lifecycle (MaterialLibraryView): the page mounts with the
 *    FULL appearance pass (custom colors reach it at open, not just the
 *    preset attribute), and applyThemeSurface() flips the preset in place —
 *    attribute changes, stale overrides clear, the waterfall DOM is NOT
 *    rebuilt (no vault rescan for a pure CSS change).
 * 16. Folder-settings pin (right of the heart): the popup saves the CURRENT
 *    scan scope + excludes under a typed name (Enter or the save button; an
 *    empty name notices instead), page rows mark the one matching the live
 *    config, clicking a row swaps the folders through onConfigChange and
 *    rescopes the waterfall in place, × deletes a page without closing.
 *    No storage hooks → the button stays hidden.
 *
 * Pure scanning/sorting/column math is covered by verify-material.
 * Run: `npm run test:material-render`
 */
import { strict as assert } from 'node:assert';
import { Menu, Modal, Notice, WorkspaceLeaf } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import type { App, TFile } from 'obsidian';
import { renderMaterialLibrary } from '../src/material-render';
import { MaterialLibraryView } from '../src/material-view';
import { MATERIAL_MOVE_DRAG_TYPE } from '../src/material-dnd';
import { upsertMaterialFolderPage } from '../src/material-model';
import { AgentPromptModal } from '../src/agent-prompt-modal';
import { MediaLightboxModal } from '../src/media-lightbox-modal';
import { MediaTagEditModal } from '../src/media-tag-editor-modal';
import { t } from '../src/i18n';
import type { MaterialFolderPage, MaterialLibraryConfig, MaterialSkillButton } from '../src/types';

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
	/** Files opened through getLeaf().openFile() — the doc-kind route. */
	openedFiles: string[];
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
	/** Files opened through getLeaf().openFile() — the doc-kind route. */
	const openedFiles: string[] = [];
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
			// Doc kinds open like a file-tree double-click: getLeaf().openFile,
			// routed by the view registry in real Obsidian (recorded here).
			getLeaf: () => ({
				openFile: async (file: { path: string }) => { openedFiles.push(file.path); },
			}),
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
	return { app, renamed, openedNotes, openedFiles, storage, created, mkdirs };
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
	// Two dropdowns now: the type filter (icon + label) and density (S/M/L).
	assert.equal(findByClass(host, 'dashboard-toolbar-dropdown').length, 2, 'type + density dropdowns rendered');
	assert.equal(
		findByClass(host, 'dashboard-material-type-toggle')[0]!.parent,
		toolbarEl,
		'the type dropdown wrapper sits directly on the toolbar (no chip-well)',
	);
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

	// --- 4. Type dropdown + group modes ---------------------------------------
	// Types live in ONE toolbar button (icon + the current label) that opens the
	// native menu; a pick rebuilds the button and narrows the waterfall.
	const typeBtn = (): El => findByClass(
		findByClass(host, 'dashboard-material-type-toggle')[0]!,
		'dashboard-toolbar-dropdown',
	)[0]!;
	const typeLabel = (): string => findByClass(typeBtn(), 'dashboard-toolbar-dropdown-label')[0]!.textContent;
	const openTypeMenu = (): { items: Array<{ title: string; checked: boolean; click(): void }> } => {
		typeBtn().click();
		// tsc resolves the real obsidian types (no static last there); the runtime
		// alias points at the stub, whose Menu.last exists — bridge with a cast.
		const menu = (Menu as unknown as {
			last: { items: Array<{ title: string; checked: boolean; click(): void }> } | null;
		}).last;
		assert.ok(menu, 'the type button opens a native menu');
		return menu!;
	};
	const pickType = (index: number): void => { openTypeMenu().items[index]!.click(); };

	assert.equal(findByClass(host, 'dashboard-material-typepill').length, 0, 'the segmented pill row is gone');
	assert.equal(typeLabel(), t('material.typeAll'), 'the collapsed button names the current scope');
	pickType(2);
	assert.deepEqual(tilePaths(host), ['素材/clip.mp4'], 'picking videos filters to videos');
	assert.equal(typeLabel(), t('material.typeVideos'), 'the button face follows the pick');
	pickType(3);
	assert.deepEqual(tilePaths(host), ['素材/article.md'], 'picking text shows only COVERED text files (notes.txt is gated out)');
	pickType(0);
	assert.equal(tilePaths(host).length, 4, 'picking all restores every kind');
	// Menu shape: every kind in order (media trio + the five doc kinds), the
	// active one checked.
	const typeMenu = openTypeMenu();
	assert.deepEqual(
		typeMenu.items.map(i => i.title),
		[t('material.typeAll'), t('material.typeImages'), t('material.typeVideos'), t('material.typeText'), t('material.typePdf'), t('material.typeEpub'), t('material.typeHtml'), t('material.typeExcalidraw'), t('material.typeCanvas')],
		'menu lists every kind in order',
	);
	assert.deepEqual(typeMenu.items.map(i => i.checked), [true, false, false, false, false, false, false, false, false], 'the active kind is checked');

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

	// --- 7b. Text open honors the workspace open-note hook --------------------
	// With ctx.openNote wired (the view backs it with the popover setting),
	// a text click routes through the hook instead of openLinkText.
	const hookHost = new El('div');
	bodyHost.appendChild(hookHost);
	const openedViaHook: string[] = [];
	const hookController = renderMaterialLibrary(hookHost as unknown as HTMLElement, {
		app,
		getConfig: () => liveConfig,
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore,
		openNote: file => { openedViaHook.push(file.path); },
	});
	const hookTile = findByClass(hookHost, 'dashboard-material-tile').find(el => el.dataset.materialPath === '素材/article.md')!;
	assert.ok(hookTile, 'hook controller tiles the text file');
	hookTile.click();
	assert.equal(openedViaHook.length, 0, 'the hook path also waits out the open delay');
	await sleep(320);
	assert.deepEqual(openedViaHook, ['素材/article.md'], 'text click routes through ctx.openNote when provided');
	assert.equal(openedNotes.length, 0, 'openLinkText stays untouched while the hook owns the open');
	hookController.destroy();

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
	// The row wears the material chrome hook: pure transparent text (no chips,
	// no bar) so the bottom of the page reads as more material space. It keeps
	// the shared class its nav renders into.
	const pager = findByClass(bigHost, 'dashboard-material-pagination')[0];
	assert.ok(pager, 'pagination carries the transparent material hook class');
	assert.ok(pager!.hasClass('dashboard-library-pagination'), '...alongside the shared pagination class');
	assert.equal(findByClass(pager!, 'dashboard-library-pagination-nav').length, 1, 'the shared nav renders inside it');

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

	// 14. View theme lifecycle: the standalone view carries the dashboard
	// board's FULL theming surface, and a preset flip re-themes it in place.
	type MaterialPlugin = ConstructorParameters<typeof MaterialLibraryView>[1];
	const { app: themeBaseApp } = makeApp();
	// The view registers vault listeners at open; the render app stub has no
	// `on` — mirror a real vault's event source (never fired in this section).
	const themeApp = { ...themeBaseApp, vault: { ...themeBaseApp.vault, on: () => () => {} } };
	const themeLeaf = new WorkspaceLeaf();
	(themeLeaf as unknown as { app: unknown }).app = themeApp;
	const themeSettings = {
		stylePreset: 'earth',
		customColors: { accent: '#123456' },
		materialConfig: { includeFolders: ['素材'], excludeFolders: [], skillButtons: [] },
		materialFavorites: ['素材/cover.png'],
	};
	const themePlugin = {
		settings: themeSettings,
		saveSettings: async () => {},
		mediaTagService: null,
	} as unknown as MaterialPlugin;
	const themeView = new MaterialLibraryView(themeLeaf, themePlugin);
	await themeView.onOpen();
	const surface = themeView.containerEl.children[1] as unknown as El;
	assert.equal(surface.getAttribute('data-theme'), 'earth', 'the view opens on the stored preset');
	assert.ok(surface.hasClass('apex-dashboard-root'), 'same theming surface classes as the board');
	assert.equal(surface.style.getPropertyValue('--db-accent'), '#123456', 'custom color overrides reach the material page at open');

	// A re-render would rebuild the waterfall (a full vault rescan); the
	// in-place flip must leave the very same tile nodes attached.
	const tilesBefore = findByClass(surface, 'dashboard-material-tile');
	assert.ok(tilesBefore.length > 0, 'the waterfall is mounted');
	themePlugin.settings = { ...themeSettings, stylePreset: 'matcha', customColors: {} } as unknown as MaterialPlugin['settings'];
	themeView.applyThemeSurface();
	assert.equal(surface.getAttribute('data-theme'), 'matcha', 'applyThemeSurface flips the preset attribute');
	assert.equal(surface.style.getPropertyValue('--db-accent'), '', 'the old accent override is dropped, not stuck over the new theme');
	assert.equal(findByClass(surface, 'dashboard-material-tile').length, tilesBefore.length, 'tile count unchanged — pure CSS switch, no re-render');
	assert.ok(tilesBefore.every(tile => findByClass(surface, 'dashboard-material-tile').includes(tile)), 'the very same tile nodes survive the theme flip');
	await themeView.onClose();

	assert.equal(savedConfigs.length, 0, 'no config writes during render-only interactions');

	// --- 15. Filter popup + batch-tag chips + archive rail + probe defer ------
	const fxConfig: MaterialLibraryConfig = { includeFolders: ['素材'], excludeFolders: [], skillButtons: [SKILL_BUTTON] };
	const fxHost = new El('div');
	bodyHost.appendChild(fxHost);
	const fxController = renderMaterialLibrary(fxHost as unknown as HTMLElement, {
		app,
		getConfig: () => fxConfig,
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore,
	});

	// a) the filter popup: chips toggle the filter, the clear button says
	//    "clear filters" (it used to reuse the reminder string).
	findByClass(fxHost, 'dashboard-library-filter-btn')[0]!.click();
	const popup15 = findByClass(bodyHost, 'dashboard-library-filter-popup')[0]!;
	assert.ok(popup15, 'the filter popup mounts at the body');
	assert.deepEqual(
		findByClass(popup15, 'dashboard-library-filter-chip').map(c => c.textContent),
		['封面', '小红书', '文章'],
		'the popup lists every existing tag',
	);
	findByClass(popup15, 'dashboard-library-filter-chip').find(c => c.textContent === '封面')!.click();
	assert.equal(findByClass(fxHost, 'dashboard-material-tile').length, 1, 'a picked tag narrows the waterfall');
	const clearBtn15 = findByClass(popup15, 'dashboard-library-filter-popup-clear')[0]!;
	assert.equal(clearBtn15.textContent, '清除筛选', 'the clear button says clear-filters, not the reminder string');
	assert.ok(findByClass(popup15, 'dashboard-library-filter-chip').some(c => c.hasClass('active') && c.textContent === '封面'), 'the active chip reflects the picked tag');
	clearBtn15.click();
	assert.equal(findByClass(fxHost, 'dashboard-material-tile').length, 4, 'clearing restores the full page');
	assert.equal(findByClass(bodyHost, 'dashboard-library-filter-popup').length, 0, 'and closes the popup');

	// b) batch tags: existing tags are one click away, chips toggle into the
	//    input, apply writes every picked tag to the whole selection.
	findByClass(fxHost, 'dashboard-material-select-toggle')[0]!.click();
	const fxTiles = () => findByClass(fxHost, 'dashboard-material-tile');
	fxTiles().find(el => el.dataset.materialPath === '素材/cover.png')!.click();
	fxTiles().find(el => el.dataset.materialPath === '素材/clip.mp4')!.click();
	const fxRailBtns = (): El[] => findByClass(fxHost, 'dashboard-material-railbtn');
	fxRailBtns().find(b => b.getAttribute('title') === '打标签')!.click();
	const tagpop = findByClass(bodyHost, 'dashboard-material-tagpop')[0]!;
	assert.ok(tagpop, 'the batch-tag popup floats beside the rail');
	const tagInput = findTag(tagpop, 'input')[0] as unknown as El & { value: string };
	const popChip = (name: string): El => findByClass(tagpop, 'dashboard-library-filter-chip').find(c => c.textContent === name)!;
	assert.deepEqual(
		findByClass(tagpop, 'dashboard-library-filter-chip').map(c => c.textContent),
		['封面', '小红书', '文章'],
		'the popup offers the existing tags as chips',
	);
	popChip('封面').click();
	assert.equal(tagInput.value, '封面', 'a chip click fills the input');
	popChip('小红书').click();
	assert.equal(tagInput.value, '封面, 小红书', 'chips accumulate');
	popChip('封面').click();
	assert.equal(tagInput.value, '小红书', 'clicking an active chip removes it');
	popChip('封面').click();
	(findTag(tagpop, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm')) as unknown as El)!.click();
	assert.deepEqual([...tagStore.getTags('素材/clip.mp4')].sort(), ['封面', '小红书'], 'apply writes every picked tag to the selection');
	assert.deepEqual([...tagStore.getTags('素材/cover.png')].sort(), ['封面', '小红书'], 'and keeps existing tags');

	// c) the archive rail button: without a destination a notice points at the
	//    setting; with one the selection moves there via renameFile.
	StubNotice.messages.length = 0;
	const renamedBefore15 = renamed.length;
	const archiveBtn = (): El | undefined => fxRailBtns().find(b => b.getAttribute('title') === '归档');
	assert.ok(archiveBtn(), 'the archive button sits on the rail');
	const railBtnTitles = fxRailBtns().map(b => b.getAttribute('title'));
	assert.ok(railBtnTitles.indexOf('归档') < railBtnTitles.indexOf('删除'), 'archive sits above delete');
	archiveBtn()!.click();
	assert.equal(renamed.length, renamedBefore15, 'no destination configured → nothing moves');
	assert.ok(StubNotice.messages.some((m: string) => m.includes('归档文件夹')), 'and a notice points at the missing setting');
	fxConfig.archiveFolder = '归档';
	archiveBtn()!.click();
	// movePathsTo awaits renameFile per file — let the microtasks drain
	// before asserting on the moves/notices (same discipline as the drop tests).
	await sleep(20);
	assert.deepEqual(
		renamed.slice(renamedBefore15).map(r => r.to).sort(),
		['归档/clip.mp4', '归档/cover.png'],
		'the selection archives into the configured folder',
	);
	assert.equal(StubNotice.messages[StubNotice.messages.length - 1], '已移动 2 个文件', 'one notice reports the move');
	assert.equal(findByClass(fxHost, 'dashboard-material-railcount').length, 0, 'archiving clears the selection');

	// d) atomic swap: when the next paint includes unmeasured images, the
	//    render HOLDS (nothing mounts — no partial layout) until the probes
	//    settle, then paints everything in one pass at final ratios.
	const probeQueue: Array<{ naturalWidth: number; naturalHeight: number; onload: (() => void) | null }> = [];
	class FakeImage {
		naturalWidth = 0;
		naturalHeight = 0;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		src = '';
		constructor() { probeQueue.push(this); }
	}
	(globalThis as Record<string, unknown>).Image = FakeImage;
	// probeAspect arms an 8s-failure timeout per image; a real node timer
	// would keep the process alive — swallow only the long timers.
	const realSetTimeout = globalThis.setTimeout;
	(globalThis as Record<string, unknown>).setTimeout = ((fn: () => void, ms?: number) => {
		if ((ms ?? 0) >= 8000) return 0 as unknown as ReturnType<typeof setTimeout>;
		return realSetTimeout(fn, ms) as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout;
	const deferHost = new El('div');
	bodyHost.appendChild(deferHost);
	renderMaterialLibrary(deferHost as unknown as HTMLElement, {
		app,
		getConfig: () => fxConfig,
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore,
	});
	assert.equal(findByClass(deferHost, 'dashboard-material-tile').length, 0, 'the swap holds — no partial layout before probes settle');
	assert.ok(probeQueue.length >= 3, `unmeasured images queued probes (${probeQueue.length})`);
	for (const img of probeQueue.splice(0)) {
		img.naturalWidth = 800;
		img.naturalHeight = 400;
		img.onload!();
	}
	await sleep(30);
	const deferTiles = findByClass(deferHost, 'dashboard-material-tile');
	assert.equal(deferTiles.length, 4, 'probes settle → the whole page paints in one pass');
	const coverThumb = findByClass(deferTiles.find(el => el.dataset.materialPath === '素材/cover.png')!, 'dashboard-material-thumb')[0]! as unknown as { style: { aspectRatio?: string } };
	assert.equal(coverThumb.style.aspectRatio, '2', 'at their settled aspect, with no fallback-ratio pass in between');

	// f) background warm-up: after the first render the aspect cache fills
	//    for the whole scan scope, so a LATER render mounts every tile in one
	//    synchronous pass — the deferred two-phase join never happens.
	const warmHost = new El('div');
	bodyHost.appendChild(warmHost);
	const warmController = renderMaterialLibrary(warmHost as unknown as HTMLElement, {
		app,
		getConfig: () => fxConfig,
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore,
	});
	// Drain the FakeImage queue until the visible probes AND the warm-up
	// pump (which mints images lazily as slots free) both run dry.
	for (let round = 0; round < 8 && probeQueue.length > 0; round++) {
		for (const img of probeQueue.splice(0)) {
			img.naturalWidth = 800;
			img.naturalHeight = 400;
			img.onload!();
		}
		await sleep(10);
	}
	assert.equal(probeQueue.length, 0, 'visible probes and warm-up both drained');
	// A re-render of the SAME controller (what a filter click is) finds every
	// ratio cached and mounts the whole page in one synchronous pass.
	warmController.refresh();
	assert.equal(
		findByClass(warmHost, 'dashboard-material-tile').length, 4,
		'a warm cache mounts every tile synchronously — no deferred join',
	);

	delete (globalThis as Record<string, unknown>).Image;
	(globalThis as Record<string, unknown>).setTimeout = realSetTimeout;

	// e) image-element pool: a re-render reparents the SAME decoded <img>
	//    node (no blank-then-fill repaint wave across the grid); two tiles
	//    sharing one cover source keep distinct nodes (pool is keyed by
	//    item, not by src, so neither steals the other's element).
	const tileOf15 = (path: string): El => findByClass(fxHost, 'dashboard-material-tile').find(el => el.dataset.materialPath === path)!;
	const imgBefore15 = findByClass(tileOf15('素材/cover.png'), 'dashboard-material-img')[0]!;
	fxController.refresh();
	assert.strictEqual(
		findByClass(tileOf15('素材/cover.png'), 'dashboard-material-img')[0]!,
		imgBefore15,
		'refresh reparents the same decoded img node',
	);
	const articleImg15 = findByClass(tileOf15('素材/article.md'), 'dashboard-material-img')[0]!;
	const coverImg15 = findByClass(tileOf15('素材/cover.png'), 'dashboard-material-img')[0]!;
	assert.equal(articleImg15.getAttribute('src'), coverImg15.getAttribute('src'), 'the text tile and its cover image share the source');
	assert.notStrictEqual(articleImg15, coverImg15, 'but keep distinct img nodes');

	// --- 16. Folder-settings pin: named scope pages, one-click swap -----------
	// The view backs the hooks with settings; this harness mirrors that with
	// an in-memory page list + a live config object the onConfigChange hook
	// writes back into (so the getter reflects an applied page immediately).
	// The save hook runs the SAME upsert as the view, so the same-name refresh
	// behavior is what this section exercises end to end.
	const pinLive: MaterialLibraryConfig = { includeFolders: ['素材'], excludeFolders: [], skillButtons: [] };
	let pinPages: MaterialFolderPage[] = [];
	const pinSavedCalls: Array<{ name: string; includes: string[]; excludes: string[] }> = [];
	const pinRemovedIds: string[] = [];
	const pinHost = new El('div');
	bodyHost.appendChild(pinHost);
	const pinController = renderMaterialLibrary(pinHost as unknown as HTMLElement, {
		app,
		getConfig: () => pinLive,
		onConfigChange: cfg => { savedConfigs.push(cfg); Object.assign(pinLive, cfg); },
		onOpenSettings: () => {},
		tagStore,
		folderPages: {
			list: () => [...pinPages],
			save: (name, cfg) => {
				pinSavedCalls.push({ name, includes: [...cfg.includeFolders], excludes: [...cfg.excludeFolders] });
				const { pages, updated } = upsertMaterialFolderPage(pinPages, name, cfg);
				pinPages = pages;
				return updated;
			},
			remove: id => {
				pinRemovedIds.push(id);
				pinPages = pinPages.filter(p => p.id !== id);
			},
		},
	});
	const pinPopupOf = (): El => {
		const found = findByClass(bodyHost, 'dashboard-material-pinpop')[0]!;
		assert.ok(found, 'the pin popup is mounted at the body');
		return found!;
	};
	const pinRowNamed = (popup: El, name: string): El => {
		const found = findByClass(popup, 'dashboard-material-pin-row').find(r => findByClass(r, 'dashboard-material-pin-name')[0]!.textContent === name);
		assert.ok(found, `pin row for ${name}`);
		return found!;
	};

	// a) the pin sits DIRECTLY right of the heart, inside the right cluster;
	//    controllers mounted without storage hooks keep the button hidden.
	const pinToolbar = findByClass(pinHost, 'dashboard-material-toolbar')[0]!;
	const pinBtnEl = findByClass(pinHost, 'dashboard-material-pin-btn')[0]!;
	assert.ok(pinBtnEl, 'pin button mounted');
	assert.equal(pinBtnEl.parent, pinToolbar, 'pin sits directly on the toolbar (no chip-well)');
	const pinHeartIdx = pinToolbar.children.indexOf(findByClass(pinHost, 'dashboard-material-favorites-btn')[0]!);
	const pinIdx16 = pinToolbar.children.indexOf(pinBtnEl);
	const pinStyleIdx = pinToolbar.children.indexOf(findByClass(pinHost, 'dashboard-material-style-btn')[0]!);
	assert.equal(pinIdx16, pinHeartIdx + 1, 'pin sits directly right of the favorites heart');
	assert.ok(pinIdx16 < pinStyleIdx, 'and stays left of the style switch (right cluster)');
	assert.ok(findByClass(fxHost, 'dashboard-material-pin-btn')[0]!.hasClass('is-hidden'), 'no storage hooks → the pin button hides');

	// b) open: name input + save button + the empty state; an EMPTY name
	//    notices instead of saving.
	pinBtnEl.click();
	const pinPop1 = pinPopupOf();
	const pinInput = findTag(pinPop1, 'input')[0] as unknown as El & { value: string };
	assert.equal(pinInput.getAttribute('placeholder'), t('material.pinNamePlaceholder'), 'the name input carries the placeholder');
	assert.ok(findTag(pinPop1, 'button').some(b => b.textContent === t('common.save')), 'the save button rides the row');
	assert.ok(findByClass(pinPop1, 'dashboard-library-config-hint').some(el => el.textContent === t('material.pinEmpty')), 'no pages yet → the empty state shows');
	StubNotice.messages.length = 0;
	(findTag(pinPop1, 'button').find(b => b.textContent === t('common.save')) as unknown as El)!.click();
	assert.deepEqual(pinSavedCalls, [], 'an empty name saves nothing');
	assert.deepEqual(StubNotice.messages, [t('material.pinNameRequired')], 'and asks for a name first');

	// c) Enter commits: the CURRENT scope snapshots under the typed name and
	//    the row renders active (it matches the live config).
	StubNotice.messages.length = 0;
	pinInput.value = '素材范围';
	pinInput.dispatchEvent({ type: 'keydown', key: 'Enter' });
	assert.deepEqual(pinSavedCalls, [{ name: '素材范围', includes: ['素材'], excludes: [] }], 'save snapshots the scan scope + excludes');
	assert.deepEqual(StubNotice.messages, [t('material.pinSaved', { name: '素材范围' })], 'one notice confirms the save');
	const row16a = pinRowNamed(pinPopupOf(), '素材范围');
	assert.equal(findByClass(row16a, 'dashboard-material-pin-scope')[0]!.textContent, '素材', 'the summary names the include folders');
	assert.equal(row16a.hasClass('active'), true, 'a row matching the live config is active');

	// d) widen the live scope: the row drops its match, and a second page
	//    saved now snapshots the whole-vault shape ('全仓库' summary).
	pinLive.includeFolders = [];
	pinController.refresh();
	assert.equal(tilePaths(pinHost).length, 5, 'widened scope tiles the outside file too');
	pinBtnEl.click(); // close
	pinBtnEl.click(); // reopen → active states recomputed
	assert.equal(pinRowNamed(pinPopupOf(), '素材范围').hasClass('active'), false, 'the row no longer matches the widened scope');
	const pinInput2 = findTag(pinPopupOf(), 'input')[0] as unknown as El & { value: string };
	pinInput2.value = '全仓库';
	(findTag(pinPopupOf(), 'button').find(b => b.textContent === t('common.save')) as unknown as El)!.click();
	const row16b = pinRowNamed(pinPopupOf(), '全仓库');
	assert.equal(findByClass(row16b, 'dashboard-material-pin-scope')[0]!.textContent, t('material.pinScopeAll'), 'an empty include list summarizes as whole vault');
	assert.equal(row16b.hasClass('active'), true, 'the whole-vault page matches the live config');

	// e) apply: one click swaps ONLY the folders, writes one config, closes
	//    the popup, and rescopes the waterfall in place.
	savedConfigs.length = 0;
	StubNotice.messages.length = 0;
	pinRowNamed(pinPopupOf(), '素材范围').click();
	assert.equal(findByClass(bodyHost, 'dashboard-material-pinpop').length, 0, 'applying closes the popup');
	assert.deepEqual(StubNotice.messages, [t('material.pinApplied', { name: '素材范围' })], 'one notice names the applied page');
	assert.equal(savedConfigs.length, 1, 'exactly one config write rides the apply');
	assert.deepEqual(pinLive.includeFolders, ['素材'], 'the live config takes the page folders');
	assert.deepEqual(tilePaths(pinHost).length, 4, 'the waterfall rescopes without a remount');

	// e2) same-name save = UPDATE (Rae): excludes configured AFTER a page was
	//     saved flow into the row on re-save — the row refreshes in place
	//     (same id, no look-alike stacked), the notice says "updated", and
	//     applying the page restores the excludes too.
	pinLive.excludeFolders = ['素材/私密'];
	pinBtnEl.click(); // reopen (apply closed it)
	const updInput = findTag(pinPopupOf(), 'input')[0] as unknown as El & { value: string };
	updInput.value = '素材范围';
	StubNotice.messages.length = 0;
	(findTag(pinPopupOf(), 'button').find(b => b.textContent === t('common.save')) as unknown as El)!.click();
	assert.equal(pinPages.length, 2, 'a same-name save updates instead of stacking a row');
	assert.equal(pinPages.filter(p => p.name === '素材范围').length, 1, 'exactly one row keeps the name');
	assert.deepEqual(pinPages.find(p => p.name === '素材范围')?.excludeFolders, ['素材/私密'], 'the refreshed row snapshots the excludes');
	assert.deepEqual(StubNotice.messages, [t('material.pinUpdated', { name: '素材范围' })], 'the notice says updated, not saved');
	assert.equal(
		findByClass(pinRowNamed(pinPopupOf(), '素材范围'), 'dashboard-material-pin-scope')[0]!.textContent,
		`素材 · ${t('material.pinExcludes', { count: 1 })}`,
		'the summary now carries the exclude count',
	);
	pinRowNamed(pinPopupOf(), '素材范围').click();
	assert.deepEqual(pinLive.excludeFolders, ['素材/私密'], 'applying the refreshed page restores the excludes');

	// f) the other direction: the whole-vault page brings the outside file
	//    back, and the active row follows.
	pinBtnEl.click();
	pinRowNamed(pinPopupOf(), '全仓库').click();
	assert.deepEqual(pinLive.includeFolders, [], 'applying the whole-vault page clears the scope');
	assert.equal(tilePaths(pinHost).length, 5, 'and the outside file tiles again');
	pinBtnEl.click();
	assert.equal(pinRowNamed(pinPopupOf(), '全仓库').hasClass('active'), true, 'the applied page is the active row');
	assert.equal(pinRowNamed(pinPopupOf(), '素材范围').hasClass('active'), false, 'the other page is not');

	// g) × deletes one page in place (the popup stays open), and a toggle
	//    click on the pin closes it.
	const popBeforeDel = pinPopupOf();
	const delTargetId = pinPages.find(p => p.name === '素材范围')?.id;
	const del16 = findByClass(pinRowNamed(popBeforeDel, '素材范围'), 'dashboard-material-pin-del')[0]!;
	del16.click();
	assert.deepEqual(pinRemovedIds, [delTargetId], 'the × routes the page id through remove');
	assert.equal(findByClass(bodyHost, 'dashboard-material-pinpop')[0], popBeforeDel, 'deleting keeps the popup open');
	assert.equal(findByClass(popBeforeDel, 'dashboard-material-pin-row').length, 1, 'only the surviving page rows remain');
	pinBtnEl.click();
	assert.equal(findByClass(bodyHost, 'dashboard-material-pinpop').length, 0, 'the toggle click closes the popup');
	pinController.destroy();

	// --- 17. Doc kinds: PDF/EPUB/HTML/Excalidraw/Canvas tile with covers -----
	// Doc files tile WITHOUT any frontmatter cover (the coverless-md gate
	// stays text-only): every doc kind mounts at its icon placeholder first,
	// the async resolver backfills the real cover image in place (an EPUB
	// resolving to "no cover" keeps the placeholder for good), the resolver
	// runs once per file, and a click opens the file as its native view.
	const DOC_VAULT = [
		mediaFile('书/Deutsch Perfekt.pdf', 30, 900000),
		mediaFile('书/Never Let Me Go.epub', 20, 800000),
		mediaFile('简报/今日简报.html', 25, 12000),
		mediaFile('画板/白板.canvas', 35, 3000),
		mediaFile('画板/架构图.excalidraw.md', 45, 5000),
		mediaFile('书/plain note.md', 50, 200), // coverless md stays gated out
	];
	const docEnv = makeApp(DOC_VAULT, {});
	const docHost = new El('div');
	bodyHost.appendChild(docHost);
	const resolvedCovers: string[] = [];
	const docController = renderMaterialLibrary(docHost as unknown as HTMLElement, {
		app: docEnv.app,
		getConfig: () => ({ includeFolders: [], excludeFolders: [], skillButtons: [] }),
		onConfigChange: () => {},
		onOpenSettings: () => {},
		tagStore: null,
		docCoverResolver: async item => {
			resolvedCovers.push(item.path);
			if (item.kind === 'epub') return null; // resolved to "no cover"
			return { src: `data:image/png;base64,${item.kind}`, aspect: 0.7 };
		},
	});
	// Every doc kind tiles (the waterfall scatters them across columns, so
	// compare as a set — column assignment follows the aspect fallbacks).
	assert.deepEqual(
		[...tilePaths(docHost)].sort(),
		['画板/架构图.excalidraw.md', '画板/白板.canvas', '书/Deutsch Perfekt.pdf', '简报/今日简报.html', '书/Never Let Me Go.epub'].sort(),
		'doc kinds tile without frontmatter covers, coverless md stays out',
	);
	assert.equal(findByClass(docHost, 'dashboard-material-docph').length, 5, 'covers start as icon placeholders');
	const docTileOf = (path: string): El => {
		const hit = findByClass(docHost, 'dashboard-material-tile').find(el => el.dataset.materialPath === path);
		assert.ok(hit, `tile for ${path}`);
		return hit!;
	};
	const docThumbOf = (path: string): El => findByClass(docTileOf(path), 'dashboard-material-thumb')[0]!;
	assert.equal(findByClass(docThumbOf('书/Deutsch Perfekt.pdf'), 'dashboard-material-docph-icon').length, 1, 'placeholder carries the type glyph');
	assert.equal(
		findByClass(docThumbOf('书/Deutsch Perfekt.pdf'), 'dashboard-material-docph-ext')[0]!.textContent,
		'PDF',
		'the extension strip names the format',
	);
	assert.equal(
		findByClass(docThumbOf('画板/架构图.excalidraw.md'), 'dashboard-material-docph-ext')[0]!.textContent,
		'EXCALIDRAW',
		'the markdown-wrapped drawing names its kind, not the md extension',
	);
	await sleep(30);
	// Backfill: every resolved tile now shows its cover img at the given
	// aspect; the EPUB that resolved to null keeps the icon placeholder.
	assert.equal(
		findByClass(docThumbOf('书/Deutsch Perfekt.pdf'), 'dashboard-material-img')[0]!.getAttribute('src'),
		'data:image/png;base64,pdf',
		'generated cover backfills into the live tile',
	);
	assert.equal(findByClass(docThumbOf('书/Deutsch Perfekt.pdf'), 'dashboard-material-docph').length, 0, 'the placeholder left with the cover');
	assert.equal(docThumbOf('书/Deutsch Perfekt.pdf').style.aspectRatio, '0.7', 'the cover aspect lands on the thumb');
	assert.equal(findByClass(docThumbOf('书/Never Let Me Go.epub'), 'dashboard-material-docph').length, 1, 'a resolved-to-null cover keeps the icon tile');
	assert.equal(findByClass(docThumbOf('书/Never Let Me Go.epub'), 'dashboard-material-img').length, 0, 'no img mounts for a null cover');
	assert.equal(
		docThumbOf('书/Never Let Me Go.epub').style.aspectRatio,
		String(2 / 3),
		'null covers settle at the EPUB default aspect',
	);
	assert.deepEqual([...new Set(resolvedCovers)].sort(), [
		'书/Deutsch Perfekt.pdf', '书/Never Let Me Go.epub', '简报/今日简报.html', '画板/架构图.excalidraw.md', '画板/白板.canvas',
	].sort(), 'every doc file resolves exactly once (fresh tiles, no re-render yet)');
	// Click opens the native view the way a file-tree double-click does:
	// getLeaf().openFile (view-registry routed), NOT openLinkText.
	docTileOf('画板/白板.canvas').click();
	await sleep(320);
	assert.ok(docEnv.openedFiles.includes('画板/白板.canvas'), 'a doc tile click opens the file through openFile');
	assert.ok(!docEnv.openedNotes.includes('画板/白板.canvas'), 'doc opens never touch the markdown link path');
	// Type dropdown narrows to one doc kind.
	const docTypeBtn = findByClass(findByClass(docHost, 'dashboard-material-type-toggle')[0]!, 'dashboard-toolbar-dropdown')[0]!;
	docTypeBtn.click();
	const docMenu = (Menu as unknown as { last: { items: Array<{ title: string; checked: boolean; click(): void }> } | null }).last!;
	assert.equal(docMenu.items.length, 9, 'nine kind entries on a doc vault too');
	docMenu.items[4]!.click(); // PDF
	assert.deepEqual(tilePaths(docHost), ['书/Deutsch Perfekt.pdf'], 'picking PDF filters to PDF tiles');
	// Type grouping splits doc kinds; headers carry localized names.
	const docGroupSelect = findByClass(docHost, 'dashboard-media-group-select')[0]!;
	docGroupSelect.value = 'type';
	docGroupSelect.dispatchEvent({ type: 'change' });
	const docHeaders = findByClass(docHost, 'dashboard-media-group-header');
	assert.deepEqual(
		docHeaders.map(h => findByClass(h, 'dashboard-media-group-name')[0]!.textContent),
		[t('material.typePdf')],
		'type groups show the localized doc kind name',
	);
	docController.destroy();

	console.log('verify-material-render: all assertions passed');
}

void main();
