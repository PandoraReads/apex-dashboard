/**
 * Verifies the sticky ("便利贴") section affordances added when the standalone
 * memo/todo section types retired into it:
 *
 * 1. Pin-to-top: every sticky card carries a hover-reveal pin button
 *    (置顶 aria-label); clicking fires onCardPinTop(cardId, columnName) with
 *    the card's own ids and does not reach the card (stopPropagation).
 *    Projects-section cards stay pin-free.
 * 2. Section header: sticky sections get BOTH the archive button and the
 *    task-template button (previously todo-only); projects sections get
 *    neither.
 * 3. Pin semantics at the data layer: moveDashboardCard(id, column, 0) puts
 *    the card first — same column, flavor untouched (the view handler is a
 *    thin guard over that call).
 * 4. TemplatePickerModal still round-trips: renders templates from
 *    settings.taskTemplates, confirm hands the chosen template to onSelect
 *    (the exact pipeline the sticky header button opens).
 * 5. CSS contract: no [data-section-type="memo"|"todo"] selectors remain;
 *    the sticky resize-handle reveal and the card-actions hover reveal
 *    survive.
 *
 * Run: `npm run test:sticky-features`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import { renderSection } from '../src/renderer';
import { TemplatePickerModal } from '../src/template-modal';
import { moveDashboardCard } from '../src/card-move';
import { parse } from '../src/parser';
import type { DashboardCard, DashboardColumn, RenderCallbacks } from '../src/types';
import { t } from '../src/i18n';

// Obsidian globals absent in Node (see verify-card-new-note for the idiom).
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
};
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// Document-level createEl (task-item markup renders through the Obsidian
// global): build via the mini-dom factory, then detach so callers own it.
{
	const scratch = new El('div');
	(globalThis as Record<string, unknown>).createEl = (tag: string, o?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): El => {
		const el = scratch.createEl(tag, o);
		scratch.removeChild(el);
		return el;
	};
}

const app = {
	vault: { getFileByPath: () => null, getMarkdownFiles: () => [] },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App;

const makeCard = (over: Partial<DashboardCard> = {}): DashboardCard =>
	({
		id: 'c1',
		type: 'generic',
		column: '便利贴',
		title: '卡片',
		body: '',
		tasks: [],
		docs: [],
		url: '',
		wikiLink: '',
		progress: 0,
		streak: 0,
		dueDate: '',
		blockquote: '',
		color: '',
		coverImage: '',
		width: 0,
		size: 'M',
		gridCols: 0,
		gridRows: 0,
		gridCol: 0,
		gridRow: 0,
		...over,
	} as unknown as DashboardCard);

// 1 + 2: render a sticky section (mixed flavors) and a projects section.
const pinCalls: Array<{ cardId: string; columnName: string }> = [];
const callbacks = {
	onCardPinTop: (cardId: string, columnName: string) => { pinCalls.push({ cardId, columnName }); },
} as unknown as RenderCallbacks;

const stickyColumn: DashboardColumn = {
	name: '便利贴',
	color: '',
	sectionType: 'sticky',
	cards: [
		makeCard({ id: 'memo-a', title: '备忘A' }),
		makeCard({ id: 'task-a', title: '待办A', type: 'task', tasks: [{ text: '事项', checked: false }] }),
	],
} as unknown as DashboardColumn;
const stickySection = renderSection(stickyColumn, callbacks, app) as unknown as El;

{
	const cards = findByClass(stickySection, 'dashboard-card');
	assert.equal(cards.length, 2, '1: both sticky cards rendered');
	for (const card of cards) {
		const pin = findTag(card, 'button').find(b => b.getAttribute('aria-label') === t('renderer.pinToTop'));
		assert.ok(pin, `1: card ${card.getAttribute('data-card-id')} carries the pin button`);
		assert.ok(pin!.hasClass('dashboard-card-btn'), '1: pin button uses the card-btn base class');
		assert.doesNotThrow(() => pin!.click(), '1: pin click stops propagation');
	}
	assert.deepEqual(pinCalls, [
		{ cardId: 'memo-a', columnName: '便利贴' },
		{ cardId: 'task-a', columnName: '便利贴' },
	], '1: onCardPinTop fires per card with card id + column name');
}

{
	const buttons = findTag(stickySection, 'button').map(b => b.getAttribute('aria-label'));
	assert.ok(buttons.includes(t('renderer.archiveTasks')), '2: sticky header has the archive button');
	assert.ok(buttons.includes(t('template.addFromTemplate')), '2: sticky header has the task-template button');

	const projectsSection = renderSection({ name: '项目', color: '', sectionType: 'projects', cards: [makeCard({ type: 'project', column: '项目' })] } as unknown as DashboardColumn, callbacks, app) as unknown as El;
	const projectsButtons = findTag(projectsSection, 'button').map(b => b.getAttribute('aria-label'));
	assert.ok(!projectsButtons.includes(t('renderer.pinToTop')), '2: projects cards have no pin button');
	assert.ok(!projectsButtons.includes(t('renderer.archiveTasks')), '2: projects header has no archive button');
	assert.ok(!projectsButtons.includes(t('template.addFromTemplate')), '2: projects header has no template button');
}

// 3. Pin semantics at the data layer: same-column move to index 0.
{
	const board = parse(`---
columns:
  - name: 便利贴
    type: sticky
---
## 便利贴
### 甲
id: a
type: generic
### 乙
id: b
type: generic
### 丙
id: c
type: generic
`);
	const pinned = moveDashboardCard(board, 'c', '便利贴', 0);
	const order = pinned.columns[0]!.cards.map(c => c.id);
	assert.deepEqual(order, ['c', 'a', 'b'], '3: pinned card becomes first');
	assert.equal(pinned.columns[0]!.cards[0]!.type, 'generic', '3: flavor untouched');
}

// 4. TemplatePickerModal renders templates and hands the selection back.
{
	const plugin = {
		settings: { taskTemplates: [{ id: 't1', name: '采购清单', tasks: ['买菜', '买奶'] }] },
		saveSettings: async () => {},
	};
	const picked: string[] = [];
	const modal = new TemplatePickerModal(app as never, plugin as never, tmpl => { picked.push(tmpl.id); });
	modal.onOpen();
	const content = modal.contentEl as unknown as El;
	const items = findByClass(content, 'template-modal-item');
	assert.equal(items.length, 1, '4: template item rendered');
	assert.ok(findTag(content, 'button').some(b => b.textContent === t('template.manageTemplates')), '4: manage entry present');
	items[0]!.click();
	const confirm = findTag(content, 'button').find(b => b.textContent === t('template.confirm'))!;
	confirm.click();
	assert.deepEqual(picked, ['t1'], '4: confirm hands the chosen template to onSelect');
}

// 5. CSS contract: retired selectors gone, sticky + hover reveal rules intact.
{
	const css = readFileSync('styles.css', 'utf8');
	assert.ok(!/data-section-type="memo"/.test(css), '5: no memo selectors remain');
	assert.ok(!/data-section-type="todo"/.test(css), '5: no todo selectors remain');
	assert.ok(css.includes('.dashboard-section-row[data-section-type="sticky"] .dashboard-card:hover .dashboard-card-resize-handle'), '5: sticky resize-handle reveal kept');
	assert.ok(css.includes('.dashboard-card:hover .dashboard-card-actions'), '5: card actions hover reveal kept');
	assert.ok(css.includes('[data-section-type="sticky"] .dashboard-section-cards'), '5: sticky horizontal row rule kept');
}

console.log('verify-sticky-features: pin button, header buttons, pin semantics, template modal and CSS checks passed');
