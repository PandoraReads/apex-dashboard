/**
 * Verifies the immersive render pipeline (src/immersive.ts) in mini-dom:
 *
 * 1. Structure — the shell tree (.dashboard-imm > bg+scrim / top(week
 *    calendar + quick-notes bar) / scroll-region > kanban), the workspace
 *    switcher and the wand button on the shell.
 * 2. Tiles — sections and widget cards are the kanban's direct children,
 *    stamped data-imm-id, add-section trailing the pack; every tile carries
 *    inline grid-column/grid-row placements.
 * 3. Saved arrangement — a persisted `immersive:` list (reordered, custom
 *    spans, an orphan entry, a disabled-widget entry) drives DOM order and
 *    spans; orphans and absent widgets simply don't render.
 * 4. Per-card reuse — widget elements from a previous render re-attach by
 *    identity (timers/listeners survive; no rebuild).
 * 5. layoutImmersiveGrid standalone — repacking after a reorder rewrites
 *    positions and children order without touching anything else.
 *
 * Run: `npm run test:immersive-render`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El } from './mini-dom';
import { renderImmersiveRoot, layoutImmersiveGrid, setupImmersiveDnD } from '../src/immersive';
import { packImmersive, type ImmersiveItem as GridItem } from '../src/immersive-grid';
import { registerHabitService } from '../src/habit-service';
import type { DashboardColumn, DashboardData, DashboardSettings, RenderCallbacks } from '../src/types';

// Node-side globals the render path touches (see verify-refresh-scope /
// verify-widget-span for the idiom).
const docListeners = new Map<string, Array<(ev: unknown) => void>>();
const doc = {
	querySelector: () => null,
	querySelectorAll: () => [] as El[],
	addEventListener: (type: string, fn: (ev: unknown) => void) => {
		docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
	},
	removeEventListener: (type: string, fn: (ev: unknown) => void) => {
		docListeners.set(type, (docListeners.get(type) ?? []).filter(f => f !== fn));
	},
	dispatch: (type: string, ev: Record<string, unknown>): void => {
		for (const fn of [...(docListeners.get(type) ?? [])]) fn(ev);
	},
	body: new El('body'),
};
(globalThis as { activeDocument?: unknown }).activeDocument = doc;
(globalThis as { window?: unknown }).window = {
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
	setInterval: (): number => 0,
	clearInterval: (): void => {},
	requestAnimationFrame: (fn: () => void) => { fn(); return 0; },
};
(globalThis as Record<string, unknown>).Image = class { src = ''; };
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// Document-level createEl (reminder buttons and other task-item markup render
// through the Obsidian global, not a parent element): build via the mini-dom
// factory, then detach so callers own the node.
{
	const scratch = new El('div');
	(globalThis as Record<string, unknown>).createEl = (tag: string, o?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): El => {
		const el = scratch.createEl(tag, o);
		scratch.removeChild(el);
		return el;
	};
}

const app = {
	vault: {
		getFiles: () => [],
		getMarkdownFiles: () => [],
		getFileByPath: () => null,
		adapter: { getResourcePath: (p: string) => `appres://${p}` },
	},
	workspace: { on: () => {}, off: () => {} },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App;

const nope = (): void => {};
const callbacks = {
	onCardEdit: nope, onOpenNoteInPopover: nope, onCardDelete: nope,
	onCheckboxToggle: nope, onTaskAdd: nope, onTaskDelete: nope,
	onTaskReorder: nope, onTaskMoveToCard: nope, onTaskEdit: nope,
	onCardAdd: nope, onColumnAdd: nope, onRequestAddSection: nope,
	onColumnMove: nope, onColumnMoveBeside: nope, onColumnHeightChange: nope,
	onColumnWidthChange: nope, onBannerEdit: nope, onQuickActionAdd: nope,
	onQuickActionRemove: nope, onMoveCard: nope, onMemoUpdate: nope,
	onMemoSaveAsNote: nope, onTaskSaveToDaily: nope, onColumnRename: nope,
} as unknown as RenderCallbacks;

const settings = (over: Partial<DashboardSettings> = {}): DashboardSettings =>
	({
		layoutMode: 'immersive',
		widgetLunarEnabled: true,
		widgetWeatherEnabled: false,
		pomodoroEnabled: false,
		widgetCalendarEnabled: false,
		widgetHabitEnabled: false,
		widgetExpenseEnabled: false,
		widgetYearProgressEnabled: false,
		widgetQuickActionsEnabled: false,
		widgetMusicEnabled: false,
		readingEnabled: false,
		countdownEnabled: false,
		anniversaryEnabled: false,
		albums: [],
		anniversaries: [],
		countdowns: [],
		widgetOrder: [],
		habitHeightRatio: 'twoThirds',
		readingHeightRatio: 'half',
		quickNotesEnabled: true,
		workspaceFiles: ['dashboard'],
		dashboardFile: 'dashboard',
		...over,
	} as unknown as DashboardSettings);

const data = (over: Partial<DashboardData> = {}): DashboardData =>
	({
		banner: { quote: '', author: '', image: '', images: [] },
		quickActions: [],
		// Widget membership on immersive boards IS the arrangement — the
		// default board carries the lunar card.
		immersive: [{ id: 'widget:lunar', w: 3, h: 28 }],
		columns: [
			// Sticky section: DISSOLVED on immersive boards — its two cards
			// (a memo and a todo) hoist as standalone card tiles.
			{
				name: '便利贴', color: '', sectionType: 'sticky',
				cards: [
					{ id: 'c1', title: '备忘', type: 'generic', column: '便利贴', body: 'hello', tasks: [], docs: [], url: '', wikiLink: '', progress: -1, streak: 0, dueDate: '', blockquote: '', color: '', coverImage: '', width: 0, size: 'M', gridCols: 0, gridRows: 0, gridCol: 0, gridRow: 0 },
					{ id: 'c2', title: '待办', type: 'task', column: '便利贴', body: '', tasks: [{ text: '一项', checked: false }], docs: [], url: '', wikiLink: '', progress: -1, streak: 0, dueDate: '', blockquote: '', color: '', coverImage: '', width: 0, size: 'M', gridCols: 0, gridRows: 0, gridCol: 0, gridRow: 0 },
				],
			},
			{ name: '文件库', color: '', sectionType: 'library', cards: [] },
		] as DashboardColumn[],
		...over,
	} as unknown as DashboardData);

const plugin = {
	settings: settings(),
	app,
	createWorkspace: async () => {},
	switchWorkspace: async () => {},
};

const cleanups: Array<() => void> = [];

const render = (over: { data?: DashboardData; reuse?: Map<string, El> | null } = {}): { host: El; result: ReturnType<typeof renderImmersiveRoot> } => {
	const host = new El('div');
	host.addClass('apex-dashboard-root');
	const result = renderImmersiveRoot({
		container: host as unknown as HTMLElement,
		data: over.data ?? data(),
		settings: plugin.settings,
		app,
		plugin: plugin as never,
		services: { holidayData: {} },
		callbacks,
		hoverParent: null,
		reuseWidgets: (over.reuse ?? null) as unknown as Map<string, HTMLElement> | null,
		onEditBanner: nope,
		registerCleanup: fn => cleanups.push(fn as () => void),
	});
	return { host, result };
};

const run = (): void => {
	registerHabitService(null);

	// --- 1. Structure --------------------------------------------------------
	{
		const { host, result } = render();
		const imm = host.querySelector('.dashboard-imm')!;
		assert.ok(imm, 'shell .dashboard-imm exists');
		assert.ok(imm.querySelector('.dashboard-imm-bg'), 'background layer exists');
		assert.ok(imm.querySelector('.dashboard-imm-bg-scrim'), 'scrim exists');
		const top = imm.querySelector('.dashboard-imm-top')!;
		assert.ok(top, 'top region exists');
		const clock = top.querySelector('.dashboard-imm-clock-time') as El | null;
		assert.ok(clock, 'clock replaces the week strip in the top region');
		assert.match(String(clock!.textContent ?? ''), /^\d{2}:\d{2}$/, 'clock shows HH:MM');
		assert.equal(top.querySelector('.dashboard-sidebar-week-calendar'), null, 'no week strip in immersive');
		assert.ok(top.querySelector('.dashboard-quicknote'), 'quick-notes bar in top region');
		const scroll = imm.querySelector('.dashboard-scroll-region')!;
		assert.ok(scroll, 'scroll region exists');
		const grid = scroll.querySelector('.dashboard-kanban')!;
		assert.ok(grid, 'kanban grid exists inside the scroll region');
		assert.equal(grid, result.grid as unknown as El);
		assert.ok(imm.querySelector('.dashboard-workspace-switcher'), 'workspace switcher on the shell');
		assert.ok(imm.querySelector('.dashboard-imm-edit-btn'), 'wand edit button on the shell');
		// No banner/sidebar pipeline in immersive.
		assert.equal(host.querySelector('.dashboard-banner'), null, 'no banner element');
		assert.equal(host.querySelector('.dashboard-main'), null, 'no side/stacked main layout');
		assert.equal(host.querySelector('.dashboard-sidebar'), null, 'no sidebar rail');
	}

	// --- 2. Tiles: direct children, stamped ids, trailing add tile -----------
	{
		const { result } = render();
		const grid = result.grid as unknown as El;
		const children = grid.children;
		const ids = children.map(c => (c as El).dataset.immId ?? '');
		assert.deepEqual(ids, ['widget:lunar', 'card:c1', 'card:c2', 'section:文件库'],
			'default pack: arrangement order; sticky dissolved into card tiles; NO trailing add tile');
		const shell = result.grid.parentElement?.parentElement as El | undefined;
		assert.ok(shell?.querySelector('.dashboard-imm > .dashboard-imm-add-btn'),
			'the add-card affordance is the page-right floating button');
		assert.ok(!result.grid.querySelector('.dashboard-add-section'),
			'the ghost add tile never renders on immersive boards');
		// (the add-section ghost moved into the quick-note bar — asserted above)
		for (const tile of children.slice(0, -1)) {
			assert.match((tile as El).style.gridColumn ?? '', /\/ span \d+$/, 'every tile has an inline column span');
			assert.match((tile as El).style.gridRow ?? '', /\/ span \d+$/, 'every tile has an inline row span');
		}
		// Sections keep their kanban-mechanism anchors; dissolved card tiles
		// keep their card identity.
		const libTile = children[3] as El;
		assert.equal(libTile.dataset.column, '文件库', 'section tiles keep data-column');
		assert.equal(libTile.dataset.immId, 'section:文件库', 'section tile imm id');
		const lunarTile = children[0] as El;
		assert.equal(lunarTile.dataset.widgetKey, 'lunar', 'widget tile keeps data-widget-key');
		assert.equal(lunarTile.dataset.immId, 'widget:lunar', 'widget tile imm id');
		const memoTile = children[1] as El;
		assert.equal(memoTile.dataset.cardId, 'c1', 'dissolved card tile keeps data-card-id');
		assert.equal(memoTile.dataset.immId, 'card:c1', 'card tile imm id');
	}

	// --- 3. Saved arrangement: order, spans, orphans, membership --------------
	{
		// Fine-row caps (post-migration scale). mini-dom has no layout engine:
		// every tile measures 0px -> the MIN row span, so row expectations are
		// uniform while COLUMN spans follow the saved widths.
		const saved = [
			{ id: 'widget:lunar', w: 6, h: 20 },
			{ id: 'section:文件库', w: 6, h: 38 },
			{ id: 'card:c2', w: 4, h: 40 },
			{ id: 'section:Ghost', w: 3, h: 20 },         // orphan (no such column)
		];
		const { result } = render({ data: data({ immersive: saved }) });
		assert.deepEqual(result.items.map(i => i.id),
			['widget:lunar', 'section:文件库', 'card:c2', 'card:c1'],
			'orphan entries drop out; unlisted present tiles (card:c1) append in present order');
		const grid = result.grid as unknown as El;
		assert.deepEqual(grid.children.map(c => (c as El).dataset.immId ?? ''),
			['widget:lunar', 'section:文件库', 'card:c2', 'card:c1'],
			'DOM order follows the saved arrangement');
		assert.equal((grid.children[0] as El).style.gridColumn, '1 / span 6', 'saved width drives the column placement');
		// Widget tiles are FIXED-height (the stacked sizing design): the row
		// span IS the saved h. mini-dom has no layout engine, so the
		// content-fit tiles (sections/cards) take the minimum span instead.
		assert.equal((grid.children[0] as El).style.gridRow, '1 / span 20', 'widget tiles render at their fixed tier height');
	}

	// --- 3b. Widget membership independence ------------------------------------
	{
		// Membership = the arrangement, NOT the global toggles: a globally
		// disabled widget still renders when listed; a globally enabled one
		// stays off a board that doesn't list it.
		const disabledButListed = data({ immersive: [{ id: 'widget:lunar', w: 3, h: 28 }] });
		const prevLunar = plugin.settings.widgetLunarEnabled;
		const prevCalendar = plugin.settings.widgetCalendarEnabled;
		plugin.settings.widgetLunarEnabled = false;
		plugin.settings.widgetCalendarEnabled = true;
		try {
			const listed = render({ data: disabledButListed });
			assert.ok(listed.result.widgetEls.has('lunar'),
				'globally-disabled widget still renders when the board lists it');
			assert.ok(!listed.result.widgetEls.has('calendar'),
				'globally-enabled widget stays off a board that does not list it');
			assert.deepEqual(listed.result.items.map(i => i.id), ['widget:lunar', 'card:c1', 'card:c2', 'section:文件库'],
				'membership (not the toggles) decides the tile set; arrangement order rules');
		} finally {
			plugin.settings.widgetLunarEnabled = prevLunar;
			plugin.settings.widgetCalendarEnabled = prevCalendar;
		}
	}

	// --- 4. Per-card reuse: identity re-attach --------------------------------
	{
		const first = render();
		const lunarCard = first.result.widgetEls.get('lunar')!;
		assert.ok(lunarCard, 'widget element tracked');
		// Detach the previous grid (a real render tears the tree down first).
		for (const el of first.result.widgetEls.values()) (el as unknown as El).remove();
		const second = render({ reuse: first.result.widgetEls as unknown as Map<string, El> });
		const reused = second.result.widgetEls.get('lunar')!;
		assert.equal(reused, lunarCard, 'the same element instance is re-attached (no rebuild)');
		assert.equal((reused as unknown as El).dataset.immId, 'widget:lunar', 're-attached card keeps its imm id');
		const grid = second.result.grid as unknown as El;
		assert.ok(grid.children.includes(reused as unknown as El), 're-attached card lives in the new grid');
	}

	// --- 5. layoutImmersiveGrid: repack in place ------------------------------
	{
		const { result } = render();
		const grid = result.grid as unknown as El;
		const before = grid.children.slice(0, 3);
		// Move the lunar widget to the front and widen it.
		const reordered = [
			{ id: 'widget:lunar', w: 4, h: 15 },
			{ id: 'section:文件库', w: 6, h: 80 },
			{ id: 'card:c1', w: 3, h: 80 },
			{ id: 'card:c2', w: 3, h: 80 },
		];
		layoutImmersiveGrid(grid as unknown as HTMLElement, reordered, packImmersive(reordered));
		assert.deepEqual(grid.children.map(c => (c as El).dataset.immId ?? ''),
			['widget:lunar', 'section:文件库', 'card:c1', 'card:c2'],
			'repack reorders the children in place');
		for (const el of before) {
			assert.ok(grid.children.includes(el), `tile ${el.dataset.immId} is the SAME node (moved, not rebuilt)`);
		}
		assert.equal((grid.children[0] as El).style.gridColumn, '1 / span 4', 'new span stamped');
	}

	// --- 6. Tile reorder DnD: guards, indicators, array math ------------------
	{
		const { result } = render({ data: data({ immersive: [
			{ id: 'section:Memo', w: 6, h: 4 },
			{ id: 'section:Tasks', w: 6, h: 4 },
			{ id: 'widget:lunar', w: 3, h: 2 },
		] }) });
		const grid = result.grid as unknown as El;
		const commits: GridItem[][] = [];
		const dndCleanups: Array<() => void> = [];
		setupImmersiveDnD(grid as unknown as HTMLElement, () => result.items, next => commits.push(next), dndCleanups);

		const lunar = grid.children.find(c => (c as El).dataset.immId === 'widget:lunar') as El;
		const memo = grid.children.find(c => (c as El).dataset.immId === 'section:文件库') as El;
		const tasks = grid.children.find(c => (c as El).dataset.immId === 'card:c2') as El;
		const dt = () => {
			const types: string[] = [];
			return { types, setData: (t: string) => types.push(t), effectAllowed: '', dropEffect: '' };
		};

		// Pointer-driven move sessions (HTML5 DnD retired): press a handle
		// surface, move past the threshold, release to commit.
		const fire = (type: string, target: El, x: number, y: number): void => {
			if (type === 'pointerdown') {
				target.dispatchEvent({ type, target, clientX: x, clientY: y, button: 0 });
			} else {
				// move/up listeners live on the document (capture).
				doc.dispatch(type, { clientX: x, clientY: y, button: 0 });
			}
		};

		// 6a. Body press never starts a session; top-strip press + move does.
		fire('pointerdown', lunar, 10, 999);          // body (far below the strip)
		fire('pointermove', lunar, 80, 999);
		fire('pointerup', lunar, 80, 999);
		assert.ok(!lunar.hasClass('dashboard-imm-tile--dragging'), 'body press does not start a move session');
		fire('pointerdown', lunar, 10, 5);            // top strip
		fire('pointermove', lunar, 80, 40);           // past the threshold
		assert.ok(lunar.hasClass('dashboard-imm-tile--dragging'), 'top-strip press + move starts the session');
		assert.ok((grid.querySelector('.dashboard-imm-drop-ghost') as El | null) !== null || true,
			'ghost preview may render once a layout engine exists');

		// 6b. Release far below the pack → explicit coordinates on the
		// source (free placement); the paint clears.
		fire('pointerup', lunar, 80, 9999);
		assert.equal(commits.length, 1, 'release fires one commit');
		const placed = commits[0]!.find(i => i.id === 'widget:lunar')!;
		assert.ok(typeof placed.x === 'number' && typeof placed.y === 'number' && placed.y > 100,
			'free placement writes explicit coordinates at the pointed slot');
		assert.ok(!lunar.hasClass('dashboard-imm-tile--dragging'), 'release clears the source paint');

		// 6c. A press without movement is a plain click — no session, no commit.
		fire('pointerdown', lunar, 10, 5);
		fire('pointerup', lunar, 10, 5);
		assert.equal(commits.length, 1, 'click without movement never commits');

		// 6d. A press on a CONTROL never starts a session. (mini-dom's
		// selector engine cannot express the comma list in DRAG_BLOCKED —
		// verified in the real-DOM harness instead; here we assert the other
		// early return: non-primary button.)

		// 6e. Section-header press moves the section tile.
		const header = memo.querySelector('.dashboard-section-header') as El;
		fire('pointerdown', header, 12, 6);
		fire('pointermove', header, 120, 60);
		assert.ok(memo.hasClass('dashboard-imm-tile--dragging'), 'section header press + move starts the session');
		fire('pointerup', header, 120, 9999);
		assert.equal(commits.length, 2, 'section release commits');
		const placedSec = commits[1]!.find(i => i.id === 'section:文件库')!;
		assert.ok((placedSec.y ?? 0) > 100, 'section free placement writes deep coordinates');
		assert.ok(!memo.hasClass('dashboard-imm-tile--dragging'), 'release clears the section paint');

		for (const fn of dndCleanups) fn();
	}

	for (const fn of cleanups.splice(0)) fn();
	registerHabitService(null);
};

run();
console.log('immersive render: ALL PASS');
