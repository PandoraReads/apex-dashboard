/**
 * Verifies the property-filter operators in library/folder sections:
 *
 * Evaluation (queryVaultFiles):
 *   equals    — exact match, OR across values, array items count (default when
 *               operator is absent, i.e. legacy dashboard files)
 *   contains  — case-insensitive substring; empty patterns never match
 *   notEquals — excludes exact matches; files without the property never match
 *   tags      — operators also apply to the tags pseudo-property
 *
 * Modal (LibraryConfigModal):
 *   - operator select renders between the property select and the value search
 *   - hidden for pseudo-properties (path/created/modified)
 *   - contains mode swaps the search placeholder and Enter adds a custom value
 *     that survives the save round-trip
 *
 * Run: `npm run test:property-operator`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { queryVaultFiles } from '../src/library-section';
import { LibraryConfigModal } from '../src/library-config-modal';
import type { LibraryConfig } from '../src/types';
import { findByClass, orderIndex, type El } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
};

// Five files covering the interesting shapes: exact value, substring-only
// value, unrelated value, missing property, array-valued property.
const files = [
	{ path: 'a.md', basename: 'a', fm: { channel: 'Ali Abdaal', tags: ['work', 'project'] } },
	{ path: 'b.md', basename: 'b', fm: { channel: 'Ali', tags: ['work'] } },
	{ path: 'c.md', basename: 'c', fm: { channel: 'Dan Koe', tags: ['life'] } },
	{ path: 'd.md', basename: 'd', fm: { tags: ['life', 'project'] } },
	{ path: 'e.md', basename: 'e', fm: { channel: ['Ali Abdaal', 'Matt Gray'], tags: ['fun'] } },
];

const stat = { mtime: 1, ctime: 1 };
const app = {
	vault: {
		getMarkdownFiles: () => files.map(f => ({ path: f.path, basename: f.basename, stat })),
	},
	metadataCache: {
		getFileCache: (f: { path: string }) => {
			const rec = files.find(x => x.path === f.path)!;
			return { frontmatter: rec.fm, tags: rec.fm.tags?.map((tag: string) => ({ tag })) };
		},
	},
} as unknown as App;

const baseConfig: LibraryConfig = {
	filters: [],
	viewMode: 'grid',
	sortBy: 'name',
	sortDesc: false,
};

const query = (property: string, values: string[], operator?: LibraryConfig['filters'][number]['operator']): string[] =>
	queryVaultFiles(app, { ...baseConfig, filters: [{ property, values, operator }] })
		.map(r => r.basename);

// --- equals (default + explicit) ---
assert.deepEqual(query('channel', ['Ali Abdaal']).sort(), ['a', 'e'], 'equals: scalar + array-item exact match');
assert.deepEqual(query('channel', ['Ali Abdaal'], 'equals').sort(), ['a', 'e'], 'equals: explicit operator same as default');
assert.deepEqual(query('channel', ['Ali Abdaal', 'Dan Koe']).sort(), ['a', 'c', 'e'], 'equals: OR across values');

// --- contains ---
assert.deepEqual(query('channel', ['ali'], 'contains').sort(), ['a', 'b', 'e'], 'contains: case-insensitive substring');
assert.deepEqual(query('channel', ['ALI', 'koe'], 'contains').sort(), ['a', 'b', 'c', 'e'], 'contains: OR across patterns');
assert.deepEqual(query('channel', ['Tiago'], 'contains'), [], 'contains: no match');
assert.deepEqual(query('channel', [''], 'contains'), [], 'contains: empty pattern matches nothing');

// --- notEquals ---
assert.deepEqual(query('channel', ['Ali Abdaal'], 'notEquals').sort(), ['b', 'c'], 'notEquals: excludes exact matches; missing property excluded');

// --- tags pseudo-property ---
assert.deepEqual(query('tags', ['work']).sort(), ['a', 'b'], 'tags equals');
assert.deepEqual(query('tags', ['proj'], 'contains').sort(), ['a', 'd'], 'tags contains');
assert.deepEqual(query('tags', ['work'], 'notEquals').sort(), ['c', 'd', 'e'], 'tags notEquals');

// Empty values is a no-op filter under every operator.
assert.equal(query('channel', [], 'notEquals').length, 5, 'empty values: no-op');

// --- Modal UI ---
const captured: { cfg?: LibraryConfig } = {};
const modal = new LibraryConfigModal(app, {
	...baseConfig,
	filters: [{ property: 'channel', values: [] }],
}, (cfg) => { captured.cfg = cfg; });
modal.onOpen();
const content = modal.contentEl as unknown as El;

const row = findByClass(content, 'dashboard-library-filter-row')[0]!;
assert.ok(row, 'filter row rendered');

const propSelect = findByClass(row, 'dashboard-library-filter-property').find(el => el.tagName === 'SELECT')!;
const opSelect = findByClass(row, 'dashboard-library-filter-operator')[0]!;
const searchInput = findByClass(row, 'dashboard-library-value-search').find(el => el.tagName === 'INPUT')!;
assert.ok(propSelect && opSelect && searchInput, 'property select, operator select and search input all render');

// Operator sits between the property selector and the value search box.
const propIdx = orderIndex(row, propSelect);
const opIdx = orderIndex(row, opSelect);
const searchIdx = orderIndex(row, searchInput);
assert.ok(propIdx >= 0 && opIdx > propIdx && searchIdx > opIdx, 'operator select renders between property select and search box');

// Three options with localized labels, equals preselected (mini-dom keeps the
// selection on the option's `selected` flag, not on select.value).
const opOptions = opSelect.children;
assert.deepEqual(opOptions.map(o => o.getAttribute('value')), ['equals', 'contains', 'notEquals'], 'operator options');
assert.equal(opOptions.find(o => o.getAttribute('value') === 'equals')!.textContent, '等于', 'equals label');
assert.equal(opOptions.find(o => o.selected)!.getAttribute('value'), 'equals', 'equals is the default selection');

// Switch to contains: row re-renders, placeholder invites free text.
opSelect.value = 'contains';
opSelect.dispatchEvent({ type: 'change' });
const row2 = findByClass(content, 'dashboard-library-filter-row')[0]!;
const search2 = findByClass(row2, 'dashboard-library-value-search').find(el => el.tagName === 'INPUT')!;
assert.equal(search2.getAttribute('placeholder'), '输入文字后按回车添加', 'contains placeholder');

// Enter adds a custom value (not an existing vault value) as an active chip.
search2.value = 'Tiago';
search2.dispatchEvent({ type: 'keydown', key: 'Enter' });
const chips = findByClass(row2, 'dashboard-library-filter-chip');
const custom = chips.find(c => c.textContent === 'Tiago');
assert.ok(custom, 'custom value rendered as chip');
assert.ok(custom!.hasClass('active'), 'custom chip is active/selected');

// Save round-trips the operator and the custom value. Sub-editors inside the
// modal also use the --confirm class, so pick the footer button by its label.
const confirmBtn = findByClass(content, 'dashboard-modal-btn--confirm')
	.find(el => el.textContent === '保存')!;
confirmBtn.dispatchEvent({ type: 'click' });
const saved = captured.cfg;
assert.ok(saved, 'onSave fired');
assert.equal(saved!.filters[0]!.operator, 'contains', 'operator saved');
assert.deepEqual(saved!.filters[0]!.values, ['Tiago'], 'custom value saved');

// Pseudo-properties get no operator select (fixed semantics).
const modal2 = new LibraryConfigModal(app, {
	...baseConfig,
	filters: [{ property: 'modified', values: [] }],
}, () => {});
modal2.onOpen();
const rowM = findByClass(modal2.contentEl as unknown as El, 'dashboard-library-filter-row')[0]!;
assert.equal(findByClass(rowM, 'dashboard-library-filter-operator').length, 0, 'no operator select for pseudo-property');

console.log('verify-property-operator: all assertions passed');
