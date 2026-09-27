/**
 * Verifies the property-filter section in FolderConfigModal (folder sections):
 * the same PropertyFiltersEditor the library section's config uses, minus the
 * 'tags' option (the dedicated tags section owns that filter).
 *
 * Modal UI:
 *   - section renders with the existing filter; value chips toggle into the save
 *   - 'tags' is not offered in the property picker; frontmatter keys are
 *   - add-filter + property change renders values; contains mode's Enter adds a
 *     custom value that survives the save round-trip
 *   - removing the row clears propertyFilters on save
 *
 * Merge (folderResultToLibraryConfig):
 *   - propertyFilters lead, the tags filter is appended
 *   - an empty editor clears the config's non-tags filters (authority contract)
 *
 * Data (queryVaultFiles): a folder-section config narrows to files under the
 * scanned folders that match the property filter — the feature's whole point.
 *
 * Run: `npm run test:folder-property-filter`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { FolderConfigModal, folderResultToLibraryConfig, type FolderConfigResult } from '../src/folder-config-modal';
import { queryVaultFiles } from '../src/library-section';
import type { LibraryConfig, PropertyFilter } from '../src/types';
import { findByClass, findTag, type El } from './mini-dom';

// applyModalTheme reads the Obsidian global `activeDocument`; no dashboard root
// exists here, so a null-returning querySelector keeps the theme mirror a no-op.
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
};

// Stub vault: files under projects/ carry a status property with two values;
// one file outside the scanned folder proves the folder scope still applies.
const files = [
	{ path: 'projects/a.md', basename: 'a', fm: { status: 'todo', tags: ['work'] } },
	{ path: 'projects/b.md', basename: 'b', fm: { status: 'done' } },
	{ path: 'other/c.md', basename: 'c', fm: { status: 'todo' } },
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

const openModal = (
	propertyFilters: PropertyFilter[],
	onSave: (r: FolderConfigResult) => void = () => {},
): El => {
	const modal = new FolderConfigModal(
		app, [], [], [], undefined, undefined, undefined,
		onSave as never, undefined, undefined, undefined, [], propertyFilters,
	);
	modal.onOpen();
	return modal.contentEl as unknown as El;
};

/** The modal's property-filter section: the one hosting the shared editor
 *  (a .dashboard-library-config-filters container). Distinct from the tags
 *  section, which hosts .dashboard-library-filter-values instead. */
const filterSectionOf = (content: El): El => {
	const section = findByClass(content, 'dashboard-library-config-section')
		.find(sec => findByClass(sec, 'dashboard-library-config-filters').length > 0);
	assert.ok(section, 'property filter section rendered');
	return section;
};

// --- 1. Section renders the existing filter; chips reflect current values ---
const content1 = openModal([{ property: 'status', values: ['todo'] }]);
const sec1 = filterSectionOf(content1);
const row1 = findByClass(sec1, 'dashboard-library-filter-row')[0]!;
assert.ok(row1, 'existing filter rendered as a row');

const propSelect = findByClass(row1, 'dashboard-library-filter-property')
	.find(el => el.tagName === 'SELECT')!;
const optionValues = propSelect.children.map(o => o.getAttribute('value')!);
assert.ok(optionValues.includes('status'), 'frontmatter property offered');
assert.ok(!optionValues.includes('tags'), 'tags not offered (dedicated section owns it)');

const chips1 = findByClass(row1, 'dashboard-library-filter-chip');
assert.deepEqual(chips1.map(c => c.textContent).sort(), ['done', 'todo'], 'value chips render');
assert.ok(chips1.find(c => c.textContent === 'todo')!.hasClass('active'), 'current value active');
assert.ok(!chips1.find(c => c.textContent === 'done')!.hasClass('active'), 'other value inactive');

// --- 2. Toggling a chip and saving carries it through ---
{
	let saved: FolderConfigResult | undefined;
	const content = openModal([{ property: 'status', values: ['todo'] }], r => { saved = r; });
	const row = findByClass(filterSectionOf(content), 'dashboard-library-filter-row')[0]!;
	findByClass(row, 'dashboard-library-filter-chip').find(c => c.textContent === 'done')!.click();
	const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
	findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
	assert.deepEqual(
		saved!.propertyFilters,
		[{ property: 'status', values: ['todo', 'done'] }],
		'toggled chip saved',
	);
}

// --- 3. Add-filter row: picking a property renders its value chips ---
{
	let saved: FolderConfigResult | undefined;
	const content = openModal([], r => { saved = r; });
	const sec = filterSectionOf(content);
	const addBtn = findByClass(sec, 'dashboard-library-add-filter-btn')[0]!;
	assert.ok(addBtn, 'add-filter button rendered');
	assert.ok(findByClass(sec, 'dashboard-library-filter-empty').length > 0, 'empty state shown');
	addBtn.click();
	const row = findByClass(sec, 'dashboard-library-filter-row')[0]!;
	const select = findByClass(row, 'dashboard-library-filter-property').find(el => el.tagName === 'SELECT')!;
	select.value = 'status';
	select.dispatchEvent({ type: 'change' });
	const row2 = findByClass(sec, 'dashboard-library-filter-row')[0]!;
	const chip = findByClass(row2, 'dashboard-library-filter-chip').find(c => c.textContent === 'done')!;
	assert.ok(chip, 'values render after picking a property');
	chip.click();
	const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
	findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
	assert.deepEqual(saved!.propertyFilters, [{ property: 'status', values: ['done'] }], 'picked filter saved');
}

// --- 4. Contains mode: Enter adds a custom value; operator round-trips ---
{
	let saved: FolderConfigResult | undefined;
	const content = openModal([{ property: 'status', values: [] }], r => { saved = r; });
	const row = findByClass(filterSectionOf(content), 'dashboard-library-filter-row')[0]!;
	const opSelect = findByClass(row, 'dashboard-library-filter-operator')[0]!;
	opSelect.value = 'contains';
	opSelect.dispatchEvent({ type: 'change' });
	const row2 = findByClass(filterSectionOf(content), 'dashboard-library-filter-row')[0]!;
	const search = findByClass(row2, 'dashboard-library-value-search').find(el => el.tagName === 'INPUT')!;
	assert.equal(search.getAttribute('placeholder'), '输入文字后按回车添加', 'contains placeholder');
	search.value = 'to';
	search.dispatchEvent({ type: 'keydown', key: 'Enter' });
	const custom = findByClass(row2, 'dashboard-library-filter-chip').find(c => c.textContent === 'to')!;
	assert.ok(custom?.hasClass('active'), 'custom value added as active chip');
	const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
	findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
	assert.deepEqual(
		saved!.propertyFilters,
		[{ property: 'status', values: ['to'], operator: 'contains' }],
		'operator and custom value saved',
	);
}

// --- 5. Removing the row clears propertyFilters on save ---
{
	let saved: FolderConfigResult | undefined;
	const content = openModal([{ property: 'status', values: ['todo'] }], r => { saved = r; });
	const row = findByClass(filterSectionOf(content), 'dashboard-library-filter-row')[0]!;
	findByClass(row, 'dashboard-library-filter-remove')[0]!.click();
	const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
	findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
	assert.deepEqual(saved!.propertyFilters, [], 'removed filter cleared on save');
}

// --- 6. Merge: propertyFilters lead, tags appended; empty editor clears ---
const result = (over: Partial<FolderConfigResult>): FolderConfigResult => ({
	folders: ['projects'],
	excludeFolders: [],
	tags: ['work'],
	propertyFilters: [{ property: 'status', values: ['todo'] }],
	groupBy: undefined,
	groupMode: 'property',
	kanbanShowCovers: false,
	showProperties: true,
	propertyLimit: 6,
	visibleProperties: undefined,
	templatePaths: [],
	...over,
});
const base: LibraryConfig = {
	filters: [{ property: 'status', values: ['todo'] }, { property: 'tags', values: ['work'] }],
	viewMode: 'grid',
	sortBy: 'modified',
	sortDesc: true,
	folders: ['projects'],
};
const merged = folderResultToLibraryConfig(base, result({}));
assert.deepEqual(
	merged.filters.map(f => f.property),
	['status', 'tags'],
	'propertyFilters lead, tags filter appended',
);
const cleared = folderResultToLibraryConfig(merged, result({ propertyFilters: [], tags: [] }));
assert.deepEqual(cleared.filters, [], 'empty editor + empty tags clear all filters');

// --- 7. End-to-end: the merged config narrows the section's files ---
assert.deepEqual(
	queryVaultFiles(app, merged).map(r => r.basename),
	['a'],
	'folder scope AND property filter: only matching files inside the folder',
);

console.log('folder property filter: ALL PASS');
