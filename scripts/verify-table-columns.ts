/**
 * Verifies the table-view column picker:
 *
 * 1. selectTableColumns semantics — picked keys ARE the columns (pick order,
 *    'name'/'modified' guards dropped); empty picks fall back to the automatic
 *    derivation (filter properties first, then keys scanned from the results,
 *    capped at 6 — including the overflow fix: the historical inner-loop break
 *    let later results each smuggle in one more key, up to ~25).
 * 2. tableProperties round-trips through the dashboard file (serialize →
 *    parse), and stays undefined when never set (parser whitelist safety).
 *
 * Run: `npm run test:table-columns`
 */
import { strict as assert } from 'node:assert';
import { Modal } from 'obsidian';
import { renderLibrarySection, selectTableColumns, tablePickerRows } from '../src/library-section';
import { parse, serialize } from '../src/parser';
import { El, findByClass, findTag } from './mini-dom';

// Obsidian globals absent in Node. The guarded drag mounts its shield on
// activeDocument.body, so the stub carries a body element.
const stubBody = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: stubBody,
};

// ---------- 1. selectTableColumns ----------

// Picked mode: exactly the picks, in pick order; fixed-column names dropped;
// blanks trimmed away.
assert.deepEqual(
	selectTableColumns({ tableProperties: ['状态', 'author', 'modified', 'name', ' 评分 '] }, []),
	['状态', 'author', '评分'],
	'picks become the columns in pick order',
);

// Picked mode ignores filters and samples entirely.
assert.deepEqual(
	selectTableColumns(
		{ filters: [{ property: '类型', values: ['书'] }], tableProperties: ['状态'] },
		[{ 状态: '在读', 类型: '书', extra: 1 }],
	),
	['状态'],
	'picks override filters + samples',
);

// Picker model (tableOrder) beats the legacy picks: explicit order first,
// candidate keys the order doesn't know appended (new properties default
// visible), hidden keys dropped, fixed-column guards dropped.
assert.deepEqual(
	selectTableColumns(
		{ tableOrder: ['评分', '作者', 'name', 'modified'], tableHidden: ['作者'] },
		[{ 状态: 1, 作者: 2, 评分: 3 }],
	),
	['评分', '状态'],
	'order wins: ordered keys + unseen tail, minus hidden',
);
// Order keys absent from the samples still render (blank column), matching
// the legacy pick behavior.
assert.deepEqual(
	selectTableColumns({ tableOrder: ['幽灵键'] }, [{ 状态: 1 }]),
	['幽灵键', '状态'],
	'order keys without samples stay, tail follows',
);

// tablePickerRows seeding: fresh sections default EVERYTHING visible;
// picker-managed configs keep their order + hidden set; legacy chip configs
// show picks first with the rest hidden.
assert.deepEqual(
	tablePickerRows({}, [{ 状态: 1, 作者: 2 }]),
	[{ key: '状态', hidden: false }, { key: '作者', hidden: false }],
	'fresh: all rows visible by default',
);
assert.deepEqual(
	tablePickerRows({ tableOrder: ['作者', '状态'], tableHidden: ['状态'] }, [{ 评分: 3, 状态: 1, 作者: 2 }]),
	[
		{ key: '作者', hidden: false },
		{ key: '状态', hidden: true },
		{ key: '评分', hidden: false },
	],
	'stored order + hidden preserved, new keys appended visible',
);
assert.deepEqual(
	tablePickerRows({ tableProperties: ['评分'] }, [{ 状态: 1, 作者: 2, 评分: 3 }]),
	[
		{ key: '评分', hidden: false },
		{ key: '状态', hidden: true },
		{ key: '作者', hidden: true },
	],
	'legacy picks seed visible, others hidden',
);

// Automatic mode: filter properties lead (pseudo filter keys excluded), then
// scanned keys in first-seen order, capped at 6 total.
assert.deepEqual(
	selectTableColumns(
		{
			filters: [
				{ property: '状态', values: ['在读'] },
				{ property: 'tags', values: ['a'] },
				{ property: 'modified', values: [] },
			],
			tableProperties: undefined,
		},
		[{ 状态: 'x', 作者: 'A', 评分: 5 }, { 类型: '书' }],
	),
	['状态', '作者', '评分', '类型'],
	'auto: filter props first, then scanned keys first-seen',
);

// Cap: 20 samples each introducing a fresh key stop at exactly 6 (the
// historical code overshot by one key per later sample).
{
	const samples = Array.from({ length: 20 }, (_, i) => ({ [`k${i}`]: i }));
	assert.deepEqual(
		selectTableColumns({ filters: [], tableProperties: undefined }, samples),
		['k0', 'k1', 'k2', 'k3', 'k4', 'k5'],
		'auto: exactly 6 columns, no overflow',
	);
}

// 'position' never becomes a column (kanban placement key, not user data).
assert.deepEqual(
	selectTableColumns({ filters: [], tableProperties: undefined }, [{ position: { x: 1, y: 2 }, 状态: 'x' }]),
	['状态'],
	'position key skipped',
);

// Filter properties count toward the cap (historical behavior kept).
assert.deepEqual(
	selectTableColumns(
		{ filters: [{ property: '状态', values: [] }], tableProperties: undefined },
		[{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }, { f: 6 }, { g: 7 }],
	),
	['状态', 'a', 'b', 'c', 'd', 'e'],
	'filter prop counts toward the 6 cap',
);

// ---------- 2. parser round-trip ----------

const md = (libraryBlock: string): string => [
	'---',
	'columns:',
	'  - name: 书库',
	"    color: '#6366f1'",
	'    type: library',
	'    library:',
	'      viewMode: table',
	'      sortBy: modified',
	'      sortDesc: true',
	libraryBlock,
	'---',
	'',
	'## 书库',
].join('\n');

// Set: parses, and survives serialize -> parse unchanged (order included).
const parsedOn = parse(md([
	'      tableProperties:',
	'        - "评分"',
	'        - "作者"',
].join('\n')));
assert.deepEqual(parsedOn.columns[0]!.libraryConfig!.tableProperties, ['评分', '作者'], 'columns parse from markdown');
assert.deepEqual(
	parse(serialize(parsedOn)).columns[0]!.libraryConfig!.tableProperties,
	['评分', '作者'],
	'columns survive serialize -> parse round-trip',
);

// Absent stays undefined and never serializes a value.
const parsedOff = parse(md(''));
assert.equal(parsedOff.columns[0]!.libraryConfig!.tableProperties, undefined, 'absent stays undefined');
const reserialized = serialize(parsedOff);
assert.ok(!reserialized.includes('tableProperties'), 'absent must not serialize');

// ---------- 3. Toolbar eye button + picker modal ----------

interface StubFile {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; ctime: number };
	fm: Record<string, unknown>;
}
const stubFiles: StubFile[] = [
	{ path: 'notes/one.md', basename: 'one', extension: 'md', stat: { mtime: 5, ctime: 1 }, fm: { 状态: 'done', 作者: '甲' } },
	{ path: 'notes/two.md', basename: 'two', extension: 'md', stat: { mtime: 4, ctime: 1 }, fm: { 状态: 'a', 评分: 5 } },
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

const renderToolbar = (viewMode: string, extra?: { tableProperties?: string[]; tableOrder?: string[]; tableHidden?: string[] }) => {
	const el = new El('div');
	let saved: Record<string, unknown> | undefined;
	renderLibrarySection(
		el as unknown as HTMLElement,
		{
			name: 'T', color: '', sectionType: 'folder',
			libraryConfig: { filters: [], viewMode: viewMode as never, sortBy: 'modified', sortDesc: true, folders: ['notes'], ...extra },
		},
		makeApp(),
		cfg => { saved = { ...cfg } as Record<string, unknown>; },
	);
	return { el, saved: () => saved };
};

// Table view: the eye button sits between the sort-direction control and the
// view toggle (toolbar child order), idle (not active) without a pick set.
{
	const { el } = renderToolbar('table');
	const toolbar = findByClass(el, 'dashboard-library-toolbar')[0] ?? assert.fail('toolbar rendered');
	const kids = toolbar.children as El[];
	const colsIdx = kids.findIndex(k => k.hasClass('dashboard-library-cols-btn'));
	const sortIdx = kids.findIndex(k => k.hasClass('dashboard-library-sort-dir'));
	const viewIdx = kids.findIndex(k => k.hasClass('dashboard-library-view-toggle'));
	assert.ok(colsIdx > sortIdx, 'eye right of the sort control');
	assert.ok(colsIdx < viewIdx, 'eye left of the view toggle');
	const btn = findByClass(el, 'dashboard-library-cols-btn')[0]!;
	assert.ok(!btn.hasClass('is-hidden'), 'eye visible in table view');
	assert.ok(!btn.hasClass('active'), 'eye idle without a pick set');
}

// Grid view: the eye hides (same gating as the card-size toggle).
{
	const { el } = renderToolbar('grid');
	const btn = findByClass(el, 'dashboard-library-cols-btn')[0]!;
	assert.ok(btn.hasClass('is-hidden'), 'eye hidden outside table view');
}

// With any custom layout stored the eye renders active; clicking opens the
// picker list. Rows default visible (legacy chip config seeds picks on / rest
// off), the eye toggles a row off, drag reorders, and save emits the new
// tableOrder/tableHidden model (clearing the legacy form).
{
	const { el, saved } = renderToolbar('table', { tableProperties: ['状态'] });
	const btn = findByClass(el, 'dashboard-library-cols-btn')[0]!;
	assert.ok(btn.hasClass('active'), 'eye active with a stored layout');
	btn.click();
	const modal = (Modal as unknown as { last: { contentEl: El; onOpen(): void } | null }).last
		?? assert.fail('eye button opened the picker modal');
	// The stub's open() records the instance but (unlike Obsidian) does not
	// fire onOpen — drive the render manually.
	modal.onOpen();

	// Legacy seed: the old pick is visible, the other candidates are hidden.
	const rows = findByClass(modal.contentEl, 'dashboard-table-cols-row');
	const rowKeys = rows.map(r => r.dataset.key);
	assert.deepEqual(rowKeys, ['状态', '作者', '评分'], 'legacy config seeds pick first, rest after');
	assert.ok(!rows[0]!.hasClass('is-off'), 'legacy pick visible');
	assert.ok(rows[1]!.hasClass('is-off'), 'legacy non-picks hidden');

	// Eye toggle: click 作者's eye -> visible; 状态's -> hidden; 评分's -> visible.
	const eyeOf = (key: string): El => {
		const row = rows.find(r => r.dataset.key === key)!;
		return findByClass(row, 'dashboard-table-cols-eye')[0]!;
	};
	eyeOf('作者').click();
	eyeOf('状态').click();
	eyeOf('评分').click();
	const rows2 = findByClass(modal.contentEl, 'dashboard-table-cols-row');
	assert.ok(!rows2.find(r => r.dataset.key === '作者')!.hasClass('is-off'), 'eye click shows 作者');
	assert.ok(rows2.find(r => r.dataset.key === '状态')!.hasClass('is-off'), 'eye click hides 状态');
	assert.ok(!rows2.find(r => r.dataset.key === '评分')!.hasClass('is-off'), 'eye click shows 评分');

	// Drag: pointer down on 评分's handle, then the moves/ups ride the guarded
	// drag shield (that's where capture routes them in the real app) — a
	// pointer far above every row's midpoint moves the row to the top (stub
	// rects are all zero-height).
	const handle = findByClass(rows2.find(r => r.dataset.key === '评分')!, 'dashboard-table-cols-handle')[0]!;
	handle.dispatchEvent({ type: 'pointerdown', target: handle, pointerId: 1, clientY: 100 });
	const shield = findByClass(stubBody, 'dashboard-drag-shield')[0]
		?? assert.fail('guarded drag mounted its shield');
	shield.dispatchEvent({ type: 'pointermove', target: shield, pointerId: 1, clientY: -999 });
	shield.dispatchEvent({ type: 'pointerup', target: shield, pointerId: 1, clientY: -999 });
	assert.equal(findByClass(stubBody, 'dashboard-drag-shield').length, 0, 'shield removed after release');

	const saveBtn = findTag(modal.contentEl, 'button').filter(b => b.textContent === '保存' || b.textContent === 'Save')[0]!;
	saveBtn.click();
	assert.deepEqual(saved()?.tableOrder, ['评分', '状态', '作者'], 'save emits the dragged row order');
	assert.deepEqual(saved()?.tableHidden, ['状态'], 'save emits the hidden keys');
	assert.equal(saved()?.tableProperties, undefined, 'legacy form cleared on save');
}

// Fresh section (no config at all): every candidate row defaults VISIBLE.
{
	const { el } = renderToolbar('table');
	const btn = findByClass(el, 'dashboard-library-cols-btn')[0]!;
	btn.click();
	const modal = (Modal as unknown as { last: { contentEl: El; onOpen(): void } | null }).last!;
	modal.onOpen();
	const rows = findByClass(modal.contentEl, 'dashboard-table-cols-row');
	assert.deepEqual(rows.map(r => r.dataset.key), ['状态', '作者', '评分'], 'fresh rows in candidate order');
	assert.ok(rows.every(r => !r.hasClass('is-off')), 'fresh rows all visible by default');
	assert.ok(!btn.hasClass('active'), 'eye idle without a stored layout');
}

console.log('verify-table-columns: ALL PASS');
