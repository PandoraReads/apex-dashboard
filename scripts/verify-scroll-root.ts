/**
 * Verifies the whole-root scroll preservation used by full dashboard
 * renders (captureRootScrollState / restoreRootScrollState in
 * scroll-preserve.ts):
 *
 * 1. Capture-then-rebuild replay — every scrolled element in a rebuilt tree
 *    gets its top/left back: the stacked region, the board, the sidebar
 *    rail, the stacked widget deck (horizontal), section card decks,
 *    task lists, and the root itself.
 * 2. Anchor stability under reorder — section rows and widgets swap
 *    positions; their internal scrollers still restore (keys ride the
 *    data-column / data-widget-key anchors, not sibling order).
 * 3. Graceful degradation — keys absent from the new tree are skipped, and
 *    elements at rest (scroll 0) are never recorded.
 *
 * Run: `npm run test:scroll-root`
 */
import { strict as assert } from 'node:assert';
import { El } from './mini-dom';
import { captureRootScrollState, restoreRootScrollState } from '../src/scroll-preserve';

// mini-dom keeps className in a field, so classSignature's getAttribute
// path needs the attribute set explicitly (the real DOM keeps both in sync).
const cls = (el: El, name: string): El => {
	el.setAttribute('class', name);
	return el;
};
const div = (className: string, scroll?: { top?: number; left?: number }): El => {
	const el = new El('div');
	el.setAttribute('class', className);
	if (scroll?.top) (el as unknown as { scrollTop: number }).scrollTop = scroll.top;
	if (scroll?.left) (el as unknown as { scrollLeft: number }).scrollLeft = scroll.left;
	return el;
};

// ---------- 1. Full-tree replay ----------
// Structure mirrors the real stacked DOM: root > main > region > sidebar
// (deck) + kanban (section rows with card decks and task lists).
const buildTree = (scrolled: boolean): El => {
	const root = cls(new El('div'), 'apex-dashboard-root');
	const main = cls(new El('div'), 'dashboard-main');
	const region = div('dashboard-scroll-region', scrolled ? { top: 321 } : undefined);
	const sidebar = cls(new El('div'), 'dashboard-sidebar');
	const sidebarScroll = div('dashboard-sidebar-scroll', scrolled ? { top: 55 } : undefined);
	const widgets = cls(new El('div'), 'dashboard-sidebar-widgets');
	const deck = div('dashboard-sidebar-widgets-row', scrolled ? { left: 480 } : undefined);

	const habit = cls(new El('div'), 'dashboard-sidebar-widget');
	habit.setAttribute('data-widget-key', 'habit');
	const habitList = div('dashboard-habit-list', scrolled ? { top: 88 } : undefined);
	habit.appendChild(habitList);

	const kanban = cls(new El('div'), 'dashboard-kanban');
	kanban.appendChild(cls(new El('div'), 'dashboard-kanban-wrapper'));
	const rowA = cls(new El('div'), 'dashboard-section-row');
	rowA.setAttribute('data-column', 'A');
	const cardsA = div('dashboard-section-cards', scrolled ? { left: 240 } : undefined);
	const card1 = cls(new El('div'), 'dashboard-card');
	card1.setAttribute('data-card-id', 'c1');
	const tasks1 = div('dashboard-task-list', scrolled ? { top: 66 } : undefined);
	card1.appendChild(tasks1);
	cardsA.appendChild(card1);
	rowA.appendChild(cardsA);
	const rowB = cls(new El('div'), 'dashboard-section-row');
	rowB.setAttribute('data-column', 'B');

	kanban.appendChild(rowA);
	kanban.appendChild(rowB);
	sidebarScroll.appendChild(widgets);
	widgets.appendChild(deck);
	widgets.appendChild(habit);
	sidebar.appendChild(sidebarScroll);
	region.appendChild(sidebar);
	region.appendChild(kanban);
	main.appendChild(region);
	root.appendChild(main);
	return root;
};

const oldTree = buildTree(true);
// Root scrolls on mobile — include it in the replay contract.
(oldTree as unknown as { scrollTop: number }).scrollTop = 130;

const states = captureRootScrollState(oldTree as unknown as Element);
assert.equal(states.size, 7, 'all seven scrolled elements captured (root included)');

const newTree = buildTree(false);
restoreRootScrollState(newTree as unknown as Element, states);
const scrollOf = (el: El): { top: number; left: number } => {
	const box = el as unknown as { scrollTop?: number; scrollLeft?: number };
	return { top: box.scrollTop ?? 0, left: box.scrollLeft ?? 0 };
};
const find = (parent: El, className: string): El => {
	const hit = parent.children.find(c => c.getAttribute('class') === className);
	assert.ok(hit, className + ' present');
	return hit;
};
const findByData = (parent: El, attr: string, value: string): El => {
	const hit = parent.children.find(c => c.getAttribute(attr) === value);
	assert.ok(hit, `${attr}=${value} present`);
	return hit;
};

assert.equal(scrollOf(newTree).top, 130, 'root (mobile scroller) restored');
const region = find(find(newTree, 'dashboard-main'), 'dashboard-scroll-region');
assert.equal(scrollOf(region).top, 321, 'stacked region restored');
const sidebar = find(region, 'dashboard-sidebar');
const sidebarScroll = find(sidebar, 'dashboard-sidebar-scroll');
assert.equal(scrollOf(sidebarScroll).top, 55, 'sidebar rail restored');
const widgets = find(sidebarScroll, 'dashboard-sidebar-widgets');
const deck = find(widgets, 'dashboard-sidebar-widgets-row');
assert.equal(scrollOf(deck).left, 480, 'stacked widget deck horizontal scroll restored');
const habit = findByData(widgets, 'data-widget-key', 'habit');
const habitList = find(habit, 'dashboard-habit-list');
assert.equal(scrollOf(habitList).top, 88, 'widget-internal scroller restored');
const kanban = find(region, 'dashboard-kanban');
const rowA = findByData(kanban, 'data-column', 'A');
const cardsA = find(rowA, 'dashboard-section-cards');
assert.equal(scrollOf(cardsA).left, 240, 'section card deck restored');
const card1 = findByData(cardsA, 'data-card-id', 'c1');
const tasks1 = find(card1, 'dashboard-task-list');
assert.equal(scrollOf(tasks1).top, 66, 'task list restored');
console.log('full-tree capture/replay: PASS');

// ---------- 2. Anchor stability under reorder ----------
const buildReorderedTree = (): El => {
	const tree = buildTree(false);
	const regionEl = find(find(tree, 'dashboard-main'), 'dashboard-scroll-region');
	const kanbanEl = find(regionEl, 'dashboard-kanban');
	// Sections swap: B now precedes A. A's card deck + task list must still
	// restore — their keys anchor on data-column / data-card-id.
	kanbanEl.children.reverse();
	const widgetsEl = find(find(find(regionEl, 'dashboard-sidebar'), 'dashboard-sidebar-scroll'), 'dashboard-sidebar-widgets');
	// A second widget joins before habit; habit's key still anchors on its
	// data-widget-key, not its sibling position.
	const music = cls(new El('div'), 'dashboard-sidebar-widget');
	music.setAttribute('data-widget-key', 'music');
	widgetsEl.children.unshift(music);
	return tree;
};
const reordered = buildReorderedTree();
restoreRootScrollState(reordered as unknown as Element, states);
const region2 = find(find(reordered, 'dashboard-main'), 'dashboard-scroll-region');
const kanban2 = find(region2, 'dashboard-kanban');
assert.equal(kanban2.children[0]!.getAttribute('data-column'), 'B', 'sections really reordered');
const rowA2 = findByData(kanban2, 'data-column', 'A');
const cardsA2 = find(rowA2, 'dashboard-section-cards');
assert.equal(scrollOf(cardsA2).left, 240, 'card deck restores after section reorder');
const card12 = findByData(cardsA2, 'data-card-id', 'c1');
assert.equal(scrollOf(find(card12, 'dashboard-task-list')).top, 66, 'task list restores after section reorder');
const widgets2 = find(find(find(region2, 'dashboard-sidebar'), 'dashboard-sidebar-scroll'), 'dashboard-sidebar-widgets');
const habit2 = findByData(widgets2, 'data-widget-key', 'habit');
assert.equal(scrollOf(find(habit2, 'dashboard-habit-list')).top, 88, 'widget scroller restores after widget reorder');
console.log('anchor stability under reorder: PASS');

// ---------- 3. Graceful degradation ----------
const foreign = buildTree(false);
const foreignStates = captureRootScrollState(buildTree(true) as unknown as Element);
// Structure matches, so most keys resolve; remove the habit widget entirely —
// its key must simply not resolve (no crash, no mis-restore).
const widgets3 = find(find(find(find(find(foreign, 'dashboard-main'), 'dashboard-scroll-region'), 'dashboard-sidebar'), 'dashboard-sidebar-scroll'), 'dashboard-sidebar-widgets');
const habitIdx = widgets3.children.findIndex(c => c.getAttribute('data-widget-key') === 'habit');
widgets3.children.splice(habitIdx, 1);
assert.doesNotThrow(() => restoreRootScrollState(foreign as unknown as Element, foreignStates));
assert.equal(scrollOf(find(find(foreign, 'dashboard-main'), 'dashboard-scroll-region')).top, 321, 'other scrollers still restored');

const restTree = buildTree(false); // nothing scrolled
assert.equal(captureRootScrollState(restTree as unknown as Element).size, 0, 'elements at rest are not recorded');
console.log('graceful degradation: PASS');

console.log('verify-scroll-root: ALL PASS');
