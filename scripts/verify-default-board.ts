/**
 * Verifies the default-board template generation (generateDefaultMarkdown)
 * and the dynamic New-Year countdown factory (newYearCountdown):
 *
 * 1. Immersive default: layout pinned 'immersive', the 13-tile arrangement
 *    (Rae's 5-3 board) with a per-year countdown tile id, sticky demo column
 *    mixing generic + task cards, serialize∘parse byte-stable round-trip.
 * 2. newYearCountdown: id/target computed from the injected date (2025 board
 *    targets 2026-01-01; a board created in 2027 targets 2028 — the
 *    cd-2026-end expiry lesson never recurs), label localized.
 * 3. i18n: the immersive demo cards follow the plugin language — English
 *    under setLanguage('en') (the old board hardcoded Chinese), zh default.
 *    No stale sidebar/banner instructions anywhere.
 * 4. Classic default: sticky + Projects + Library columns; the interface
 *    guide card carries the layout-neutral cguide texts (guide1-4 retired).
 *
 * Run: `npm run test:default-board`
 */
import { strict as assert } from 'node:assert';
import { parse, serialize, generateDefaultMarkdown, newYearCountdown } from '../src/parser';
import { setLanguage, t } from '../src/i18n';

const CURRENT_YEAR = new Date().getFullYear();

// --- 1. Immersive default board -------------------------------------------
const immersiveMd = generateDefaultMarkdown('immersive');
const immersive = parse(immersiveMd);
assert.equal(immersive.layout, 'immersive', 'immersive default pins layout: immersive');
assert.ok(immersive.immersive, 'immersive default ships a tile arrangement');
assert.equal(immersive.immersive!.length, 13, 'immersive default keeps the 13-tile arrangement');
const cdTile = immersive.immersive!.find(item => item.id.startsWith('widget:countdown-'));
assert.ok(cdTile, 'countdown tile present');
assert.equal(
	cdTile!.id,
	`widget:countdown-cd-${CURRENT_YEAR}-end`,
	'countdown tile id is computed from the current year',
);
const sticky = immersive.columns.find(col => (col.sectionType ?? '').toLowerCase() === 'sticky');
assert.ok(sticky, 'sticky demo column present');
assert.ok(sticky!.cards.some(c => c.type === 'generic'), 'sticky column has memo (generic) cards');
assert.ok(sticky!.cards.some(c => c.type === 'task'), 'sticky column has todo (task) cards');
assert.equal(serialize(immersive), immersiveMd, 'immersive default round-trips byte-stable');

// --- 2. newYearCountdown: per-year, never stale ----------------------------
const cd2025 = newYearCountdown(new Date('2025-06-01T12:00:00'));
assert.equal(cd2025.id, 'cd-2025-end');
assert.equal(cd2025.targetDate, '2026-01-01T00:00:00');
assert.equal(cd2025.displayMode, 'days');
const cd2027 = newYearCountdown(new Date('2027-01-03T00:00:00'));
assert.equal(cd2027.id, 'cd-2027-end');
assert.equal(cd2027.targetDate, '2028-01-01T00:00:00');
assert.equal(newYearCountdown().id, `cd-${CURRENT_YEAR}-end`, 'default now = current year');

// --- 3. Immersive demo cards follow the language ---------------------------
setLanguage('en');
const enMd = generateDefaultMarkdown('immersive');
const enBoard = parse(enMd);
const enSticky = enBoard.columns.find(col => (col.sectionType ?? '').toLowerCase() === 'sticky')!;
const enTexts = enSticky.cards.flatMap(c => [c.title, c.body, ...c.tasks.map(task => task.text)]);
assert.ok(enTexts.some(text => text.includes('Capture a quick thought in the top bar')), 'en itodo1 present');
assert.ok(enTexts.some(text => text.includes('Right-click any tile')), 'en iguide1 present');
assert.ok(enTexts.some(text => text?.includes('snap to nearby edges')), 'en tips body present');
assert.equal(enSticky.name, 'Sticky Notes', 'sticky column name localized');
for (const text of enTexts) {
	assert.ok(!text?.includes('隐藏条') && !text?.includes('图钉') && !text?.includes('书签按钮'),
		`no stale zh sidebar/banner instructions in en board: ${text}`);
}
assert.ok(t('defaults.newYearEndLabel', { year: 2025 }).includes('2025'), 'countdown label interpolates the year');

setLanguage('zh');
const zhBoard = parse(generateDefaultMarkdown('immersive'));
const zhSticky = zhBoard.columns.find(col => (col.sectionType ?? '').toLowerCase() === 'sticky')!;
const zhTexts = zhSticky.cards.flatMap(c => [c.title, c.body, ...c.tasks.map(task => task.text)]);
assert.ok(zhTexts.some(text => text.includes('在顶部输入框记一条闪念')), 'zh itodo1 present');
assert.ok(zhTexts.some(text => text.includes('右键任意瓷贴')), 'zh iguide1 present');
assert.ok(zhTexts.some(text => text?.includes('顶部中央的输入框')), 'zh tips body present');
for (const text of zhTexts) {
	assert.ok(!text?.includes('隐藏条') && !text?.includes('图钉按钮') && !text?.includes('书签按钮收起'),
		`no stale sidebar/banner instructions in zh board: ${text}`);
}

// --- 4. Classic default board ----------------------------------------------
const classic = parse(generateDefaultMarkdown());
assert.equal(classic.layout, undefined, 'classic default stays unpinned (follows global)');
assert.equal(classic.columns.length, 3, 'classic default: sticky + Projects + Library');
assert.deepEqual(classic.columns.map(c => c.sectionType), ['sticky', 'projects', 'projects']);
const classicSticky = classic.columns[0]!;
const classicMemos = classicSticky.cards.filter(c => c.type === 'generic');
assert.equal(classicMemos.length, 1, 'classic default: the three demo memos merged into one');
assert.ok(classicMemos[0]!.body.includes('**'), 'merged memo carries markdown (bold)');
assert.ok(classicMemos[0]!.body.includes('\n- '), 'merged memo carries a markdown bullet list');
assert.ok(classicMemos[0]!.body.includes('dashboard'), 'merged memo keeps the path tip');
assert.ok(classicMemos[0]!.body.toLowerCase().includes('rename') || classicMemos[0]!.body.includes('重命名'), 'merged memo keeps the rename tip');
const classicFirst = classicSticky.cards.find(c => c.id === 'demo-todo-1')!;
assert.equal(classicFirst.tasks[1]!.text, t('default.todo2'), 'first todo card task 2 = add-new-section');
assert.equal(t('default.todo2'), '添加一个新分区', 'todo2 zh wording');
const classicGuide = classicSticky.cards.find(c => c.id === 'demo-todo-2')!;
assert.deepEqual(
	classicGuide.tasks.map(task => task.text),
	[t('default.cguide1'), t('default.cguide2'), t('default.cguide3'), t('default.cguide4')],
	'classic interface guide carries the layout-neutral cguide texts',
);
assert.equal(serialize(classic), generateDefaultMarkdown(), 'classic default round-trips byte-stable');

console.log('verify-default-board: all assertions passed');
