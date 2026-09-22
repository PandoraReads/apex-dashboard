/**
 * Verifies toolbar grouping for the library section's grid/gallery/list/table
 * views (viewGroupMode/viewGroupBy):
 *
 * 1. Parser round-trip — 'folder'/'property' persist to the dashboard file,
 *    'none'/undefined writes nothing, garbage drops, and a stray viewGroupBy
 *    without mode 'property' is ignored.
 * 2. groupLibraryResults — property mode: scalar buckets in first-occurrence
 *    order, array values fan out, missing values fall to a trailing not-set
 *    bucket. Folder mode: folderGroupKey semantics + numeric-aware
 *    alphabetical order, vault-root files fall to the not-set bucket.
 * 3. Toolbar pill + menu + grouped rendering — menu item order (none / folder
 *    / tags-first properties, pseudo keys absent), picks persist through
 *    onConfigChange, grouped DOM (collapsible headers with counts, per-group
 *    grids/tables), page-size select hidden while grouped (including on the
 *    empty-result early-return path), collapse toggles in place and clears
 *    when the grouping dimension changes, re-picking the active option is a
 *    no-op, kanban hides the pill, a hand-edited property mode without a key
 *    degrades to the flat view, 'no grouping' restores the flat view.
 *
 * Blind spot: mini-dom checks class names, not computed styles — the CSS rules
 * that give `.dashboard-library-group-toggle.is-hidden` /
 * `.dashboard-library-page-size.is-hidden` their effect are untested here.
 *
 * Run: `npm run test:library-group`
 */
import { strict as assert } from 'node:assert';
import { Menu } from 'obsidian';
import { parse, serialize } from '../src/parser';
import { renderLibrarySection, groupLibraryResults } from '../src/library-section';
import type { LibraryFileResult } from '../src/library-section';
import { El, findByClass } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

// ---------- 1. Parser round-trip ----------

interface RoundTripOutcome {
	mode: string | undefined;
	by: string | undefined;
	serialized: string;
}

const roundTrip = (libraryLines: string[]): RoundTripOutcome => {
	const dash = parse([
		'---',
		'columns:',
		'  - name: C1',
		'    type: folder',
		'    library:',
		...libraryLines,
		'---',
		'',
		'## C1',
	].join('\n'));
	const lc = dash.columns[0]!.libraryConfig!;
	return {
		mode: lc.viewGroupMode,
		by: lc.viewGroupBy,
		serialized: serialize(dash),
	};
};

const folderCase = roundTrip(['      viewGroupMode: folder']);
assert.equal(folderCase.mode, 'folder', 'folder mode parses');
assert.equal(folderCase.by, undefined, 'folder mode carries no property key');
assert.match(folderCase.serialized, /viewGroupMode: folder/, 'folder mode persists');
assert.doesNotMatch(folderCase.serialized, /viewGroupBy/, 'folder mode writes no viewGroupBy');

const propCase = roundTrip(['      viewGroupMode: property', '      viewGroupBy: "status"']);
assert.equal(propCase.mode, 'property', 'property mode parses');
assert.equal(propCase.by, 'status', 'property key parses');
assert.match(propCase.serialized, /viewGroupMode: property/, 'property mode persists');
assert.match(propCase.serialized, /viewGroupBy: "status"/, 'property key persists');

const noneCase = roundTrip(['      viewGroupMode: none']);
assert.equal(noneCase.mode, 'none', "'none' parses as explicit off");
assert.doesNotMatch(noneCase.serialized, /viewGroupMode/, "'none' (default) writes nothing");

const absentCase = roundTrip(['      viewMode: grid']);
assert.equal(absentCase.mode, undefined, 'absent mode parses to undefined');
assert.doesNotMatch(absentCase.serialized, /viewGroup/, 'absent mode writes nothing');

const garbageCase = roundTrip(['      viewGroupMode: sideways']);
assert.equal(garbageCase.mode, undefined, 'garbage mode dropped');
assert.doesNotMatch(garbageCase.serialized, /viewGroup/, 'garbage mode writes nothing');

const strayByKey = roundTrip(['      viewGroupBy: "status"']);
assert.equal(strayByKey.by, undefined, 'viewGroupBy without property mode is ignored');
assert.doesNotMatch(strayByKey.serialized, /viewGroupBy/, 'stray viewGroupBy writes nothing');

const folderByKey = roundTrip(['      viewGroupMode: folder', '      viewGroupBy: "status"']);
assert.equal(folderByKey.by, undefined, 'viewGroupBy under folder mode is ignored');

console.log('viewGroup parser round-trip: PASS');

// ---------- 2. groupLibraryResults ----------

const mk = (path: string, frontmatter: Record<string, unknown>): LibraryFileResult => ({
	file: { path } as unknown as LibraryFileResult['file'],
	basename: path.split('/').pop() ?? path,
	mtime: 1,
	ctime: 1,
	frontmatter,
	preview: '',
	tags: [],
});

// Property: scalars bucket by value in first-occurrence order; missing value
// falls to a trailing not-set bucket.
const propGroups = groupLibraryResults(
	[mk('a.md', { status: 'done' }), mk('b.md', { status: 'todo' }), mk('c.md', { status: 'done' }), mk('d.md', {})],
	'property', 'status', [],
);
assert.deepEqual(propGroups.map(g => g.label), ['done', 'todo', '(未设置)'], 'scalar buckets in first-occurrence order, not-set last');
assert.equal(propGroups[0]!.items.length, 2, 'done bucket holds both files');
assert.equal(propGroups[2]!.isNoGroup, true, 'trailing bucket flagged isNoGroup');

// Property: array values fan a file into every value's group.
const arrayGroups = groupLibraryResults(
	[mk('a.md', { tags: ['x', 'y'] }), mk('b.md', { tags: 'x' })],
	'property', 'tags', [],
);
assert.deepEqual(arrayGroups.map(g => g.label), ['x', 'y'], 'array value fans out');
assert.equal(arrayGroups[0]!.items.length, 2, 'file appears in every matched group');

// Folder: scan-root subfolders key by their top segment; a scan root's direct
// files group under the root's own name; files outside every scan root fall
// back to their first parent segment; vault-root files are not-set.
const folderGroups = groupLibraryResults(
	[mk('notes/b/2.md', {}), mk('notes/a/1.md', {}), mk('notes/3.md', {}), mk('other/4.md', {}), mk('5.md', {})],
	'folder', undefined, ['notes'],
);
assert.deepEqual(folderGroups.map(g => g.label), ['a', 'b', 'notes', 'other', '(未设置)'],
	'folder keys: subfolders, root-own-name, parent fallback, alphabetical + not-set last');

// Folder: numeric-aware ordering (a2 before a10 — lexical would flip them).
const numericGroups = groupLibraryResults(
	[mk('notes/a10/1.md', {}), mk('notes/a2/2.md', {})],
	'folder', undefined, ['notes'],
);
assert.deepEqual(numericGroups.map(g => g.label), ['a2', 'a10'], 'numeric-aware alphabetical folder order');

console.log('groupLibraryResults: PASS');

// ---------- 3. Toolbar + grouped rendering ----------

interface StubFile {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; ctime: number };
	fm: Record<string, unknown>;
}

const stubFiles: StubFile[] = [
	{ path: 'notes/a/one.md', basename: 'one', extension: 'md', stat: { mtime: 5, ctime: 1 }, fm: { status: 'done' } },
	{ path: 'notes/a/two.md', basename: 'two', extension: 'md', stat: { mtime: 4, ctime: 1 }, fm: { status: 'a' } },
	{ path: 'notes/b/three.md', basename: 'three', extension: 'md', stat: { mtime: 3, ctime: 1 }, fm: {} },
];

const makeApp = () => ({
	vault: {
		getMarkdownFiles: () => stubFiles,
		cachedRead: async () => 'body',
		adapter: { read: async () => { throw new Error('no adapter in stub'); } },
	},
	metadataCache: {
		getFileCache: (f: StubFile) => ({ frontmatter: f.fm, tags: [] }),
		fileToLinktext: (f: { path: string }) => f.path,
	},
	workspace: { on: () => {}, off: () => {} },
	fileManager: {},
	lastEvent: null,
}) as unknown as Parameters<typeof renderLibrarySection>[2];

const el = new El('div');
let saved: Record<string, unknown> | undefined;
let savedCount = 0;
renderLibrarySection(
	el as unknown as HTMLElement,
	{ name: 'G', color: '', sectionType: 'folder', libraryConfig: { filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true, folders: ['notes'] } },
	makeApp(),
	cfg => { savedCount++; saved = { ...cfg } as Record<string, unknown>; },
);

const groupToggle = findByClass(el, 'dashboard-library-group-toggle')[0]
	?? assert.fail('group toggle rendered');
const groupBtn = (): El => findByClass(groupToggle, 'dashboard-library-view-btn')[0]
	?? assert.fail('group button rendered');
const openGroupMenu = (): { items: Array<{ title: string; click(): void }> } => {
	groupBtn().click();
	// tsc resolves the real obsidian types (no static last there); the runtime
	// alias points at the stub, whose Menu.last exists — bridge with a cast.
	return (Menu as unknown as { last: { items: Array<{ title: string; click(): void }> } | null }).last!;
};
const headers = (): El[] => findByClass(el, 'dashboard-library-group-header');
const bodies = (): El[] => findByClass(el, 'dashboard-library-group-body');

// Default: pill visible, flat grid, no group headers, page-size select shown.
assert.ok(!groupToggle.hasClass('is-hidden'), 'group pill visible in grid view');
assert.equal(headers().length, 0, 'no group headers without grouping');
assert.ok(findByClass(el, 'dashboard-library-grid').length > 0, 'flat grid rendered');
assert.ok(!findByClass(el, 'dashboard-library-page-size')[0]!.hasClass('is-hidden'), 'page-size select shown ungrouped');

// Menu: 不分组 / 按文件夹 / properties with tags first; pseudo keys absent.
let menu = openGroupMenu();
assert.ok(menu, 'group button opens a menu');
const titles = menu.items.map(i => i.title);
assert.equal(titles[0], '不分组', 'first item: no grouping');
assert.equal(titles[1], '按文件夹', 'second item: by folder');
assert.equal(titles.indexOf('tags'), 2, 'tags leads the property list');
assert.ok(titles.includes('status'), 'vault property listed');
for (const pseudo of ['modified', 'created', 'path']) {
	assert.ok(!titles.includes(pseudo), `pseudo key ${pseudo} not groupable`);
}

// Pick 按文件夹: config persists, grouped DOM appears, paging chrome hides.
menu.items[1]!.click();
assert.equal(saved!.viewGroupMode, 'folder', 'folder pick reported through onConfigChange');
assert.equal(saved!.viewGroupBy, undefined, 'folder pick clears the property key');
assert.equal(headers().length, 2, 'two folder groups (a, b)');
assert.deepEqual(headers().map(h => findByClass(h, 'dashboard-library-group-name')[0]!.textContent), ['a', 'b'], 'group names');
assert.deepEqual(headers().map(h => findByClass(h, 'dashboard-library-group-count')[0]!.textContent), ['2', '1'], 'group counts');
assert.equal(bodies().length, 2, 'one body per group');
assert.ok(bodies().every(b => findByClass(b, 'dashboard-library-grid').length === 1), 'each body holds its own grid');
assert.ok(findByClass(el, 'dashboard-library-page-size')[0]!.hasClass('is-hidden'), 'page-size select hidden while grouped');
assert.equal(findByClass(el, 'dashboard-library-pagination')[0]!.childElementCount, 0, 'no pagination controls while grouped');

// Collapse in place: click header → body hides; click again → restores.
headers()[0]!.click();
assert.ok(headers()[0]!.hasClass('is-collapsed'), 'header collapses');
assert.ok(bodies()[0]!.hasClass('is-hidden'), 'body hides with header');
headers()[0]!.click();
assert.ok(!headers()[0]!.hasClass('is-collapsed'), 'header expands again');
assert.ok(!bodies()[0]!.hasClass('is-hidden'), 'body shows again');

// Re-picking the already-active option is a no-op: no config write, no
// re-render (leave 'a' collapsed to prove nothing was rebuilt).
headers()[0]!.click();
assert.ok(headers()[0]!.hasClass('is-collapsed'), 'header collapsed for the guard test');
const savesBeforeRePick = savedCount;
menu = openGroupMenu();
menu.items[1]!.click(); // 按文件夹 — already active
assert.equal(savedCount, savesBeforeRePick, 're-picking the active option writes nothing');
assert.ok(headers()[0]!.hasClass('is-collapsed'), 'no re-render on re-pick (collapse preserved)');

// Pick the status property: the collapse set is cleared with the dimension
// change, so the group also keyed 'a' (file two's status, mtime 4) renders
// expanded despite folder-group 'a' being collapsed. Groups follow
// first-occurrence order of the sorted results (mtime 5/4/3).
menu = openGroupMenu();
menu.items.find(i => i.title === 'status')!.click();
assert.equal(saved!.viewGroupMode, 'property', 'property pick reported');
assert.equal(saved!.viewGroupBy, 'status', 'property key reported');
assert.deepEqual(headers().map(h => findByClass(h, 'dashboard-library-group-name')[0]!.textContent),
	['done', 'a', '(未设置)'], 'property groups inherit the section sort');
assert.ok(headers()[2]!.hasClass('is-nogroup'), 'not-set header carries the muted variant');
assert.ok(!headers().some(h => h.hasClass('is-collapsed')), 'collapse set cleared on dimension change');

// Empty-result path: with the search box filtering everything out, a menu
// pick still re-renders through the early return — the page-size select must
// stay hidden there too, not only on the populated path.
const searchEl = findByClass(el, 'dashboard-library-search')[0] as unknown as { value: string };
searchEl.value = 'zzz';
menu = openGroupMenu();
menu.items[1]!.click(); // 按文件夹
assert.equal(headers().length, 0, 'search filters every group out');
assert.ok(findByClass(el, 'dashboard-library-empty').length > 0, 'empty state rendered');
assert.ok(findByClass(el, 'dashboard-library-page-size')[0]!.hasClass('is-hidden'),
	'page-size select stays hidden on the empty-result path');
searchEl.value = '';
menu = openGroupMenu();
menu.items.find(i => i.title === 'status')!.click();
assert.equal(headers().length, 3, 'grouped view restored after clearing the search');

// Grouping persists across a view switch; each table group renders its own table.
const viewToggle = findByClass(el, 'dashboard-library-view-toggle')
	.find(t => !t.hasClass('dashboard-library-size-toggle') && !t.hasClass('dashboard-library-group-toggle'))!;
findByClass(viewToggle, 'dashboard-toolbar-dropdown')[0]!.click();
const viewMenu = (Menu as unknown as { last: { items: Array<{ click(): void }> } | null }).last!;
viewMenu.items[3]!.click(); // table
assert.equal(findByClass(el, 'dashboard-library-table').length, 3, 'grouped table view: one table per group');

// Kanban hides the pill; list shows it again and stays grouped.
findByClass(viewToggle, 'dashboard-toolbar-dropdown')[0]!.click();
const kanbanMenu = (Menu as unknown as { last: { items: Array<{ click(): void }> } | null }).last!;
kanbanMenu.items[4]!.click(); // kanban
assert.ok(groupToggle.hasClass('is-hidden'), 'group pill hidden in kanban view');
findByClass(viewToggle, 'dashboard-toolbar-dropdown')[0]!.click();
const listMenu = (Menu as unknown as { last: { items: Array<{ click(): void }> } | null }).last!;
listMenu.items[2]!.click(); // list
assert.ok(!groupToggle.hasClass('is-hidden'), 'group pill visible in list view');
assert.equal(findByClass(el, 'dashboard-library-list').length, 3, 'grouped list view: one list per group');

// Pick 不分组: flat view restored, paging chrome back.
menu = openGroupMenu();
menu.items[0]!.click();
assert.equal(saved!.viewGroupMode, undefined, "'no grouping' clears the mode");
assert.equal(headers().length, 0, 'group headers gone');
assert.equal(findByClass(el, 'dashboard-library-list').length, 1, 'single flat list restored');
assert.ok(!findByClass(el, 'dashboard-library-page-size')[0]!.hasClass('is-hidden'), 'page-size select shown again');

// A hand-edited 'property' mode without a key degrades to the flat view so the
// menu checkmark and the rendered state stay in sync.
const el2 = new El('div');
renderLibrarySection(
	el2 as unknown as HTMLElement,
	{ name: 'H', color: '', sectionType: 'folder', libraryConfig: { filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true, folders: ['notes'], viewGroupMode: 'property' } },
	makeApp(),
	() => {},
);
assert.equal(findByClass(el2, 'dashboard-library-group-header').length, 0, 'property mode without a key renders flat');
assert.equal(findByClass(el2, 'dashboard-library-grid').length, 1, 'flat grid rendered');
assert.ok(!findByClass(el2, 'dashboard-library-page-size')[0]!.hasClass('is-hidden'), 'page-size select shown in the degraded state');

console.log('group toolbar + rendering: PASS');
console.log('library view grouping: ALL PASS');
