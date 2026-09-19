/**
 * Verifies the kanban grouped-view upgrades:
 *
 * 1. nextGroupPropertyValue — the pure core of a property-grouped kanban
 *    move. Scalars replace (no-op on same value); null gains the target;
 *    arrays swap the dragged-from value for the target while keeping their
 *    other entries (a multi-valued card sits in several columns), with a
 *    member-wise no-op check so dropping back on the own column neither
 *    reorders nor rewrites the array.
 * 2. kanbanShowCovers round-trip — the per-section cover toggle survives
 *    serialize → parse, and stays undefined when never set (parser whitelist
 *    discipline: unknown/absent values never leak through).
 * 3. Kanban property badges — kanban cards share the card views' exact badge
 *    settings (visibleProperties / propertyLimit / showProperties); the
 *    property-mode grouping field drops from badges (it is the column
 *    header), folder mode keeps every property.
 *
 * Run: `npm run test:kanban-upgrade`
 */
import { strict as assert } from 'node:assert';
import { nextGroupPropertyValue, renderLibrarySection } from '../src/library-section';
import { parse, serialize } from '../src/parser';
import { El, findByClass } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

// ---------- 1. nextGroupPropertyValue ----------

// Scalars: replace, same-value no-op, typed values survive.
assert.equal(nextGroupPropertyValue('todo', 'doing', 'todo'), 'doing');
assert.equal(nextGroupPropertyValue('doing', 'doing', 'doing'), undefined);
assert.equal(nextGroupPropertyValue(3, '3', '3'), undefined);
assert.equal(nextGroupPropertyValue(true, 'false', 'true'), 'false');

// Null/absent (dragged out of the not-set column): gains the target.
assert.equal(nextGroupPropertyValue(undefined, 'doing', null), 'doing');
assert.equal(nextGroupPropertyValue(null, 'doing', null), 'doing');

// Arrays: the dragged-from value swaps for the target, others keep theirs.
assert.deepEqual(nextGroupPropertyValue(['a', 'b'], 'c', 'a'), ['b', 'c']);

// Array already containing the target: from-value just drops away.
assert.deepEqual(nextGroupPropertyValue(['a', 'b'], 'b', 'a'), ['b']);

// Array dragged from not-set (fromKey null): only gains the target.
assert.deepEqual(nextGroupPropertyValue(['a'], 'b', null), ['a', 'b']);

// Array drop back on the own column: no reorder, no rewrite.
assert.equal(nextGroupPropertyValue(['a', 'b'], 'a', 'a'), undefined);
assert.equal(nextGroupPropertyValue(['a', 'b'], 'b', 'b'), undefined);

// Stale fromKey (value no longer present): adding the target is still a change.
assert.deepEqual(nextGroupPropertyValue(['a', 'b'], 'c', 'x'), ['a', 'b', 'c']);

// Removing the last value leaves a single-entry array (never an empty one:
// the target is always pushed when missing).
assert.deepEqual(nextGroupPropertyValue(['a'], 'b', 'a'), ['b']);

// ---------- 2. kanbanShowCovers round-trip ----------

const md = (libraryBlock: string): string => [
	'---',
	'columns:',
	'  - name: 书库',
	"    color: '#6366f1'",
	'    type: library',
	'    library:',
	'      viewMode: kanban',
	'      sortBy: modified',
	'      sortDesc: true',
	libraryBlock,
	'---',
	'',
	'## 书库',
].join('\n');

// Round-trip: toggle survives serialize → parse → serialize.
const parsedOn = parse(md('      kanbanShowCovers: true'));
assert.equal(parsedOn.columns[0]!.libraryConfig!.kanbanShowCovers, true, 'toggle parses from markdown');
assert.equal(
	parse(serialize(parsedOn)).columns[0]!.libraryConfig!.kanbanShowCovers,
	true,
	'toggle survives serialize -> parse round-trip',
);

// Absent stays undefined and never serializes a value.
const parsedOff = parse(md(''));
assert.equal(parsedOff.columns[0]!.libraryConfig!.kanbanShowCovers, undefined, 'absent toggle stays undefined');
const reserialized = serialize(parsedOff);
assert.ok(!reserialized.includes('kanbanShowCovers'), 'absent toggle must not serialize');

console.log('kanbanShowCovers round-trip: PASS');

// ---------- 3. Kanban cards share the card views' property badges ----------

const makeApp = () => {
	const file = {
		path: 'notes/a.md', basename: 'a', extension: 'md',
		stat: { mtime: 1, ctime: 1 },
	};
	return {
		vault: {
			getMarkdownFiles: () => [file],
			cachedRead: async () => '---\nstatus: todo\ntitle: x\n---\n\nbody',
			adapter: { read: async () => { throw new Error('no adapter in stub'); } },
		},
		metadataCache: {
			getFileCache: () => ({ frontmatter: { status: 'todo', title: 'x' }, tags: [] }),
			fileToLinktext: (f: { path: string }) => f.path,
		},
		workspace: { on: () => {}, off: () => {} },
		fileManager: {},
	} as unknown as Parameters<typeof renderLibrarySection>[2];
};

const renderKanban = (extra: Record<string, unknown>): El => {
	const host = new El('div');
	renderLibrarySection(
		host as unknown as HTMLElement,
		{
			name: 'C1', color: '', sectionType: 'library',
			libraryConfig: { filters: [], viewMode: 'kanban', sortBy: 'modified', sortDesc: true, kanbanGroupBy: 'status', ...extra },
		},
		makeApp(),
		() => {},
	);
	return host;
};

const badgeTexts = (host: El): string[] =>
	findByClass(host, 'dashboard-library-badge').map(b => b.textContent);

// Group-by field drops from badges (it IS the column); other properties badge.
assert.deepEqual(badgeTexts(renderKanban({})), ['titlex'],
	'kanban card badges non-group properties, group field dropped');

// visibleProperties picks govern kanban exactly like the card views.
assert.deepEqual(badgeTexts(renderKanban({ visibleProperties: ['status', 'title'] })), ['titlex'],
	'picks render on kanban minus the grouping field');

// propertyLimit 0 with no picks → no badges at all.
assert.equal(findByClass(renderKanban({ propertyLimit: 0 }), 'dashboard-library-badge').length, 0,
	'propertyLimit 0 hides kanban badges');

// showProperties false hides kanban badges.
assert.equal(findByClass(renderKanban({ showProperties: false }), 'dashboard-library-badge').length, 0,
	'showProperties false hides kanban badges');

// Folder grouping keeps the group-by field (only the column key is redundant
// in property mode).
assert.deepEqual(badgeTexts(renderKanban({ groupMode: 'folder', folders: ['notes'] })), ['statustodo', 'titlex'],
	'folder-grouped kanban keeps all properties');

console.log('kanban property badges: PASS');
console.log('verify-kanban-upgrade: all assertions passed');
