/**
 * Verifies the grouped/kanban render-crash protections (GROUP_PAGE_SIZE /
 * RENDER_CEILING) added to renderLibrarySection: *
 * 1. Constants export — 50 per group/column, 500 total ceiling.
 * 2. In-group progressive rendering — first GROUP_PAGE_SIZE cards per group,
 *    load-more pill with the remaining count, small groups render whole.
 * 3. Load-more rebuild — bigger slice, one view container per body (rebuild,
 *    not stacking), pill disappears at the end.
 * 4. Collapsed-at-render groups are lazy — empty placeholder body until the
 *    first expand, which renders at the remembered limit (not back to 50).
 * 5. Collapse-all sweep triggers the lazy renderers on expand (the sweep walks
 *    headers and flips their nextElementSibling; the body element must exist).
 * 6. Collapse-all sweep folds everything and keeps already-built DOM.
 * 7. renderedLimits lifecycle — survives same-dimension re-renders (view
 *    switch), cleared when the grouping dimension changes (pickGroup).
 * 8. Render ceiling (grouped) — 511 results truncate to 500 with a notice;
 *    a 123-result section never caps.
 * 9. Render ceiling (kanban) — same truncation, column title keeps the data
 *    total.
 * 10. Kanban in-column progressive rendering — true appends (first card DOM
 *    survives), pill stays at the column bottom, data-hidden-count tracks the
 *    hidden remainder, small columns render whole.
 *
 * Blind spot: mini-dom checks class names and structure, not computed styles —
 * the CSS rules (.dashboard-library-load-more capsule, .dashboard-library-render-cap
 * bar, .is-capped kanban height reserve) are untested here, as is any real-DOM
 * nextElementSibling nuance beyond El's implementation.
 *
 * Run: `npm run test:group-render-cap`
 */
import { strict as assert } from 'node:assert';
import { Menu } from 'obsidian';
import { renderLibrarySection, GROUP_PAGE_SIZE, RENDER_CEILING } from '../src/library-section';
import { El, findByClass, findTag } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

// ---------- 1. Constants ----------

assert.equal(GROUP_PAGE_SIZE, 50, 'group page size is 50');
assert.equal(RENDER_CEILING, 500, 'render ceiling is 500');
console.log('constants: PASS');

// ---------- fixtures + harness ----------

interface StubFile {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; ctime: number };
	fm: Record<string, unknown>;
}

/** `count` files under notes/<folder>/ with ascending mtimes from base. */
const genFiles = (folder: string, count: number, baseMtime: number, fm: Record<string, unknown> = {}): StubFile[] =>
	Array.from({ length: count }, (_, i): StubFile => {
		const name = `f${String(i).padStart(4, '0')}`;
		return {
			path: `notes/${folder}/${name}.md`,
			basename: name,
			extension: 'md',
			stat: { mtime: baseMtime + i, ctime: 1 },
			fm: { ...fm },
		};
	});

const makeApp = (files: StubFile[]) => ({
	vault: {
		getMarkdownFiles: () => files,
		cachedRead: async () => 'body',
		adapter: { read: async () => { throw new Error('no adapter in stub'); } },
	},
	metadataCache: {
		getFileCache: (f: StubFile) => ({ frontmatter: f.fm, tags: [] }),
		fileToLinktext: (f: { path: string }) => f.path,
	},
	workspace: { on: () => {}, off: () => {} },
	fileManager: {},
}) as unknown as Parameters<typeof renderLibrarySection>[2];

interface Mount {
	el: El;
	headers: () => El[];
	bodies: () => El[];
	filesEl: () => El;
	groupBtn: () => El;
	pickView: (idx: number) => void;
	sweepBtn: () => El;
}

const mount = (files: StubFile[], extraConfig: Record<string, unknown> = {}): Mount => {
	const el = new El('div');
	renderLibrarySection(
		el as unknown as HTMLElement,
		{
			name: 'S', color: '', sectionType: 'folder',
			libraryConfig: {
				filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true,
				folders: ['notes'], ...extraConfig,
			},
		},
		makeApp(files),
		() => {},
	);
	const headers = (): El[] => findByClass(el, 'dashboard-library-group-header');
	const bodies = (): El[] => findByClass(el, 'dashboard-library-group-body');
	const groupToggle = findByClass(el, 'dashboard-library-group-toggle')[0] ?? assert.fail('group toggle rendered');
	const viewToggle = findByClass(el, 'dashboard-library-view-toggle')
		.find(t => !t.hasClass('dashboard-library-size-toggle') && !t.hasClass('dashboard-library-group-toggle'))!;
	const pickView = (idx: number): void => {
		findByClass(viewToggle, 'dashboard-toolbar-dropdown')[0]!.click();
		const menu = (Menu as unknown as { last: { items: Array<{ click(): void }> } | null }).last!;
		menu.items[idx]!.click();
	};
	const sweepBtn = (): El => {
		const toggle = findByClass(el, 'dashboard-library-collapse-toggle')[0] ?? assert.fail('collapse toggle rendered');
		return findByClass(toggle, 'dashboard-library-view-btn')[0] ?? assert.fail('sweep button rendered');
	};
	return {
		el,
		headers,
		bodies,
		filesEl: () => findByClass(el, 'dashboard-library-files')[0]!,
		groupBtn: () => findByClass(groupToggle, 'dashboard-library-view-btn')[0]!,
		pickView,
		sweepBtn,
	};
};

const cards = (host: El): number => findByClass(host, 'dashboard-library-card').length;
const loadMore = (host: El): El | undefined => findByClass(host, 'dashboard-library-load-more')[0];
const tableRows = (host: El): number => {
	const table = findByClass(host, 'dashboard-library-table')[0] ?? assert.fail('table rendered');
	const tbody = findTag(table, 'tbody')[0] ?? assert.fail('tbody rendered');
	return tbody.childElementCount;
};

// big=120 + small=3, every file carrying status 'todo' for the dimension-switch
// checkpoint later.
const smallFixture = (): StubFile[] => [
	...genFiles('big', 120, 1000, { status: 'todo' }),
	...genFiles('small', 3, 2000, { status: 'todo' }),
];

// ---------- 2 + 3 + 4 + 7. grouped progressive render on the first mount ----------

const m1 = mount(smallFixture(), { viewGroupMode: 'folder' });

assert.equal(m1.headers().length, 2, 'two folder groups (big, small)');
assert.deepEqual(
	m1.headers().map(h => findByClass(h, 'dashboard-library-group-name')[0]!.textContent),
	['big', 'small'],
	'alphabetical folder groups',
);
assert.deepEqual(
	m1.headers().map(h => findByClass(h, 'dashboard-library-group-count')[0]!.textContent),
	['120', '3'],
	'count badges carry the DATA total, not the rendered slice',
);

const [bigBody, smallBody] = m1.bodies();
assert.equal(cards(bigBody!), 50, 'big group renders its first 50 cards');
assert.equal(loadMore(bigBody!)?.textContent, '显示更多（剩 70 条）', 'pill shows the remaining count');
assert.equal(cards(smallBody!), 3, 'small group renders whole');
assert.equal(loadMore(smallBody!), undefined, 'no pill on a fully-rendered group');
assert.equal(findByClass(m1.el, 'dashboard-library-render-cap').length, 0, '123 results never hit the ceiling');
assert.ok(!m1.filesEl().hasClass('is-capped'), 'no is-capped marker below the ceiling');
console.log('in-group progressive initial state: PASS');

// Load-more rebuilds the body with a bigger slice (one grid, not stacked).
loadMore(bigBody!)!.click();
assert.equal(cards(bigBody!), 100, 'first click renders 100');
assert.equal(findByClass(bigBody!, 'dashboard-library-grid').length, 1, 'rebuild, not stacking');
assert.equal(loadMore(bigBody!)?.textContent, '显示更多（剩 20 条）', 'pill updated');
loadMore(bigBody!)!.click();
assert.equal(cards(bigBody!), 120, 'second click renders everything');
assert.equal(loadMore(bigBody!), undefined, 'pill gone at the end');
console.log('load-more rebuild: PASS');

// Collapsed-at-render is lazy: collapse big, re-render via a view switch, the
// body must stay EMPTY (no table built); expanding renders at the remembered
// limit (120, not back to 50).
m1.headers()[0]!.click();
assert.ok(m1.headers()[0]!.hasClass('is-collapsed'), 'big collapsed');
m1.pickView(3); // table
assert.ok(m1.bodies()[0]!.hasClass('is-hidden'), 'collapsed body hidden');
assert.equal(findByClass(m1.bodies()[0]!, 'dashboard-library-table').length, 0, 'collapsed body is an empty placeholder');
assert.equal(tableRows(m1.bodies()[1]!), 3, 'expanded small group renders its table');
m1.headers()[0]!.click();
assert.ok(!m1.bodies()[0]!.hasClass('is-hidden'), 'big expanded again');
assert.equal(tableRows(m1.bodies()[0]!), 120, 'lazy render honors the remembered limit');
m1.headers()[0]!.click();
assert.equal(tableRows(m1.bodies()[0]!), 120, 're-collapsing keeps the built DOM');
console.log('collapsed lazy render: PASS');

// renderedLimits survives a same-dimension re-render...
m1.headers()[0]!.click(); // expand big again
m1.pickView(0); // grid
assert.equal(cards(m1.bodies()[0]!), 120, 'limit survives the view switch');
assert.equal(loadMore(m1.bodies()[0]!), undefined, 'no pill when the limit covers the group');

// ...and resets when the grouping dimension changes (pickGroup).
m1.groupBtn().click();
const dimMenu = (Menu as unknown as { last: { items: Array<{ title: string; click(): void }> } | null }).last!;
dimMenu.items.find(i => i.title === 'status')!.click();
assert.equal(m1.headers().length, 1, 'status groups everything into one bucket');
assert.equal(findByClass(m1.headers()[0]!, 'dashboard-library-group-name')[0]!.textContent, 'todo', 'single todo bucket');
assert.equal(cards(m1.bodies()[0]!), 50, 'dimension switch resets the limit to 50');
assert.equal(loadMore(m1.bodies()[0]!)?.textContent, '显示更多（剩 73 条）', 'pill reflects the fresh 50-limit');
console.log('renderedLimits lifecycle: PASS');

// ---------- 5 + 6. collapse-all sweep drives the lazy renderers ----------

const m2 = mount(smallFixture(), { viewGroupMode: 'folder' });
m2.headers()[0]!.click(); // collapse big
m2.headers()[1]!.click(); // collapse small
m2.pickView(3); // table — both groups now collapsed-at-render (lazy)
assert.equal(findByClass(m2.bodies()[0]!, 'dashboard-library-table').length, 0, 'big placeholder empty');
assert.equal(findByClass(m2.bodies()[1]!, 'dashboard-library-table').length, 0, 'small placeholder empty');

m2.sweepBtn().click(); // everything folded → expand-all branch
assert.ok(!m2.headers().some(h => h.hasClass('is-collapsed')), 'all headers expanded');
assert.ok(!m2.bodies().some(b => b.hasClass('is-hidden')), 'all bodies visible');
assert.equal(tableRows(m2.bodies()[0]!), 50, 'sweep expand filled the lazy big body');
assert.equal(tableRows(m2.bodies()[1]!), 3, 'sweep expand filled the lazy small body');
console.log('sweep expand triggers lazy render: PASS');

m2.sweepBtn().click(); // everything open → collapse-all branch
assert.ok(m2.headers().every(h => h.hasClass('is-collapsed')), 'all headers collapsed');
assert.ok(m2.bodies().every(b => b.hasClass('is-hidden')), 'all bodies hidden');
assert.equal(tableRows(m2.bodies()[0]!), 50, 'collapse keeps the built DOM');
console.log('sweep collapse keeps DOM: PASS');

// ---------- 8. render ceiling, grouped ----------
// small's mtimes (5000+) sort ABOVE big's, so the 500-cap drops the TAIL of
// big: 489 of its 500 survive. That ordering is deliberate — it exercises
// truncation slicing into a group, not just dropping a whole trailing group.
const hugeFixture = (): StubFile[] => [
	...genFiles('big', 500, 1000, { status: 'todo' }),
	...genFiles('small', 11, 5000, { status: 'todo' }),
];

const m3 = mount(hugeFixture(), { viewGroupMode: 'folder' });
const capNotice = findByClass(m3.el, 'dashboard-library-render-cap')[0] ?? assert.fail('cap notice rendered');
assert.ok(capNotice.textContent!.includes('511'), 'notice names the real total');
assert.ok(capNotice.textContent!.includes('500'), 'notice names the rendered count');
assert.ok(m3.filesEl().hasClass('is-capped'), 'content area carries is-capped');
assert.equal(findByClass(m3.headers()[0]!, 'dashboard-library-group-name')[0]!.textContent, 'big', 'truncation keeps the biggest group');
assert.equal(findByClass(m3.headers()[0]!, 'dashboard-library-group-count')[0]!.textContent, '489', 'big badge reflects the truncated input');
assert.equal(cards(m3.bodies()[0]!), 50, 'ceiling mount still renders progressively');
assert.equal(loadMore(m3.bodies()[0]!)?.textContent, '显示更多（剩 439 条）', 'pill reflects the truncated group size');
console.log('render ceiling (grouped): PASS');

// ---------- 9 + 10. kanban ----------

const kanbanCfg = { viewMode: 'kanban', groupMode: 'folder' };

const m4 = mount(hugeFixture(), kanbanCfg);
assert.ok(findByClass(m4.el, 'dashboard-library-render-cap').length > 0, 'kanban caps too');
assert.ok(m4.filesEl().hasClass('is-capped'), 'kanban content area carries is-capped');
const cols4 = findByClass(m4.el, 'dashboard-library-kanban-col');
assert.equal(cols4.length, 2, 'two kanban columns (big, small)');
assert.equal(findByClass(cols4[0]!, 'dashboard-library-kanban-col-title')[0]!.textContent, 'big (489)', 'column title keeps the truncated data total');
assert.equal(findByClass(cols4[0]!, 'dashboard-library-kanban-card').length, 50, 'big column renders 50 cards');
assert.equal(loadMore(cols4[0]!)?.textContent, '显示更多（剩 439 条）', 'kanban pill shows the remainder');
console.log('render ceiling (kanban): PASS');

const m5 = mount(smallFixture(), kanbanCfg);
const [bigCol, smallCol] = findByClass(m5.el, 'dashboard-library-kanban-col');
assert.equal(findByClass(bigCol!, 'dashboard-library-kanban-col-title')[0]!.textContent, 'big (120)', 'title data total');
assert.equal(findByClass(bigCol!, 'dashboard-library-kanban-card').length, 50, 'big column starts at 50');
const firstTitleBefore = findByClass(findByClass(bigCol!, 'dashboard-library-kanban-card')[0]!, 'dashboard-library-kanban-card-title')[0]!.textContent;
assert.equal(loadMore(bigCol!)!.getAttribute('data-hidden-count'), '70', 'data-hidden-count tracks the remainder');

loadMore(bigCol!)!.click();
assert.equal(findByClass(bigCol!, 'dashboard-library-kanban-card').length, 100, 'first click appends to 100');
assert.equal(
	findByClass(findByClass(bigCol!, 'dashboard-library-kanban-card')[0]!, 'dashboard-library-kanban-card-title')[0]!.textContent,
	firstTitleBefore,
	'append, not rebuild — first card DOM survives',
);
assert.equal(loadMore(bigCol!)!.getAttribute('data-hidden-count'), '20', 'hidden count updated');
assert.equal(bigCol!.children[bigCol!.children.length - 1], loadMore(bigCol!), 'pill stays at the column bottom');

loadMore(bigCol!)!.click();
assert.equal(findByClass(bigCol!, 'dashboard-library-kanban-card').length, 120, 'second click completes the column');
assert.equal(loadMore(bigCol!), undefined, 'pill removed at the end');
assert.equal(findByClass(smallCol!, 'dashboard-library-kanban-card').length, 3, 'small column renders whole');
assert.equal(loadMore(smallCol!), undefined, 'no pill on a small column');
console.log('kanban in-column progressive append: PASS');

console.log('group render cap: ALL PASS');
