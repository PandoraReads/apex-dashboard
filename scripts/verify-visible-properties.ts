/**
 * Verifies the pinned-card-properties feature end to end:
 *
 * 1. selectBadgeKeys semantics — the complementary rule the user approved:
 *    a card hitting any picked property shows exactly the hits (pick order,
 *    uncapped, missing keys skipped); a card hitting none falls back to the
 *    automatic first-N slice, byte-identical to the historical behavior.
 * 2. VisiblePropertiesEditor — chips list = common keys + vault keys + saved
 *    custom keys; toggling picks in order; the add box picks custom keys.
 * 3. FolderConfigModal save round-trip — picks reach the saved config as an
 *    ordered array; no picks collapse back to undefined (automatic mode).
 *
 * Run: `npm run test:visible-properties`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { selectBadgeKeys } from '../src/library-section';
import { VisiblePropertiesEditor } from '../src/visible-properties-editor';
import { FolderConfigModal } from '../src/folder-config-modal';
import { El, findByClass, findTag } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
};

// ---------- 1. selectBadgeKeys ----------

const fm = {
	title: 'Note A',
	作者: '张三',
	状态: '在读',
	类型: '技术',
	rating: 4,
	tags: ['x', 'y'],
	position: { start: { line: 0 } },
	empty: '',
	missing: null,
};

// Automatic mode (no picks): note order, tags/position/empty skipped, capped.
assert.deepEqual(
	selectBadgeKeys(fm, undefined, 6),
	['title', '作者', '状态', '类型', 'rating'],
	'auto mode shows first N formattable keys',
);
assert.deepEqual(
	selectBadgeKeys(fm, [], 2),
	['title', '作者'],
	'auto mode respects the cap',
);
assert.deepEqual(selectBadgeKeys({}, undefined, 6), [], 'empty note yields no badges');

// Pinned mode: hits only, pick order preserved, uncapped, missing skipped.
assert.deepEqual(
	selectBadgeKeys(fm, ['类型', '作者', '出版社'], 3),
	['类型', '作者'],
	'picks show in pick order; missing key skipped',
);
assert.deepEqual(
	selectBadgeKeys(fm, ['作者', '状态', '类型', 'rating'], 1),
	['作者', '状态', '类型', 'rating'],
	'picks are uncapped by the auto limit',
);
// Pinned keys holding empty/unformattable values count as misses.
assert.deepEqual(
	selectBadgeKeys(fm, ['empty', 'missing'], 6),
	['title', '作者', '状态', '类型', 'rating'],
	'unformattable picks fall back to automatic',
);
// tags/position are never badge candidates, even when pinned — such picks all
// miss and the card falls back to the automatic slice.
assert.deepEqual(
	selectBadgeKeys(fm, ['tags', 'position'], 6),
	['title', '作者', '状态', '类型', 'rating'],
	'tags/position unpinnable',
);

console.log('selectBadgeKeys semantics: PASS');

// ---------- 2. VisiblePropertiesEditor ----------

const app = {
	vault: {
		getMarkdownFiles: () => [{ path: 'a.md' }],
	},
	metadataCache: {
		getFileCache: () => ({
			frontmatter: { 作者: 'x', 自定义键: 'y', status: 1 },
		}),
	},
} as unknown as App;

const host = new El('div');
// tsc sees HTMLElement (real typings); the bundled mini-DOM provides El.
const editor = new VisiblePropertiesEditor(app, host as unknown as HTMLElement, ['出版社']);

const chipKeys = (): string[] => findByClass(host, 'dashboard-library-filter-chip').map(c => c.textContent);
const chipState = (): Array<[string, boolean]> =>
	findByClass(host, 'dashboard-library-filter-chip').map(c => [c.textContent, c.hasClass('active')] as [string, boolean]);

// Candidates: common keys first, then scanned vault keys, then saved custom.
const keys = chipKeys();
assert.ok(keys.indexOf('作者') < keys.indexOf('自定义键'), 'common keys list before scanned keys');
assert.ok(keys.includes('自定义键') && keys.includes('status'), 'vault keys included');
assert.ok(keys.includes('出版社'), 'saved custom key kept even though no note has it');
assert.ok(keys.indexOf('出版社') === keys.length - 1, 'saved custom key appended after scan');

// Saved pick renders active.
assert.ok(chipState().some(([k, on]) => k === '出版社' && on), 'initial pick rendered active');

// Toggling picks in click order: 作者 then 类型.
findByClass(host, 'dashboard-library-filter-chip').find(c => c.textContent === '作者')!.click();
findByClass(host, 'dashboard-library-filter-chip').find(c => c.textContent === '类型')!.click();
assert.deepEqual(editor.value, ['出版社', '作者', '类型'], 'value follows click order');

// Unpick removes just that key.
findByClass(host, 'dashboard-library-filter-chip').find(c => c.textContent === '作者')!.click();
assert.deepEqual(editor.value, ['出版社', '类型'], 'unpick removes only that key');

// Add box: a brand-new key joins candidates and gets picked; an existing
// candidate just gets picked without duplicating.
const addInput = findTag(host, 'input').find(el => el.getAttribute('placeholder') === '指定显示字段')!;
const addBtn = findTag(host, 'button')
	.find(b => findByClass(host, 'dashboard-modal-btn--confirm').includes(b))!;
addInput.value = '我的字段';
addBtn.click();
assert.ok(chipKeys().includes('我的字段'), 'custom key appears as candidate');
assert.deepEqual(editor.value, ['出版社', '类型', '我的字段'], 'custom key picked on add');

addInput.value = '作者';
addBtn.click();
assert.equal(chipKeys().filter(k => k === '作者').length, 1, 'adding existing key does not duplicate');
assert.deepEqual(editor.value, ['出版社', '类型', '我的字段', '作者'], 'adding existing key picks it');

// Enter key in the input also adds.
addInput.value = '回车键';
addInput.dispatchEvent({ type: 'keydown', key: 'Enter' });
assert.deepEqual(editor.value.slice(-1), ['回车键'], 'Enter adds the typed key');

console.log('VisiblePropertiesEditor UI: PASS');

// ---------- 3. FolderConfigModal save round-trip ----------

let saved: { visibleProperties?: string[] } | undefined;
const modal = new FolderConfigModal(app, [], [], [], undefined, undefined, undefined, r => { saved = r; });
modal.onOpen();
const content = modal.contentEl as unknown as El;

// Two chips hosts exist (tag filter + property picker); the picker's is the one
// holding the common keys.
const pickerChips = findByClass(content, 'dashboard-library-filter-values')
	.find(v => findByClass(v, 'dashboard-library-filter-chip').some(c => c.textContent === '作者'))!;
findByClass(pickerChips, 'dashboard-library-filter-chip').find(c => c.textContent === '作者')!.click();
const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.deepEqual((saved as { visibleProperties?: string[] } | undefined)?.visibleProperties, ['作者'],
	'save carries picked properties');

// No picks -> undefined (automatic mode persisted as absence).
let saved2: { visibleProperties?: string[] } | undefined;
const modal2 = new FolderConfigModal(app, [], [], [], undefined, undefined, undefined, r => { saved2 = r; });
modal2.onOpen();
const footer2 = findByClass(modal2.contentEl as unknown as El, 'dashboard-modal-footer')[0]!;
findTag(footer2, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.strictEqual((saved2 as { visibleProperties?: string[] } | undefined)?.visibleProperties, undefined,
	'no picks save as undefined');

console.log('FolderConfigModal round-trip: PASS');
console.log('visible properties: ALL PASS');
