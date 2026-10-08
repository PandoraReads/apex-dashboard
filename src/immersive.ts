/**
 * Immersive layout: full-bleed poster background + one free grid mixing
 * widget cards and section cards.
 *
 * Structure (see the styles.css immersive chapter):
 *
 *   .dashboard-imm                  (column shell, z-index above the bg)
 *   ├── .dashboard-imm-bg           (fixed, banner poster + focal + rotation + scrim)
 *   ├── .dashboard-imm-top          (clock + quick-notes bar, centered)
 *   ├── .dashboard-scroll-region    (the one scrolling layer)
 *   │   └── .dashboard-kanban       (12-column grid: sections + widgets + add tile)
 *   ├── .dashboard-workspace-switcher (absolute, top-left — same spot semantics
 *   │                                 as on the banner)
 *   └── wand edit button             (absolute, top-right, opens BannerEditModal —
 *                                     the banner images ARE this layout's bg)
 *
 * The kanban keeps its class name so every kanban-rooted mechanism
 * (refreshSectionInPlace `:scope > [data-column]` lookups, setupDragAndDrop,
 * the view's delegated board events, scroll-preservation anchors) works
 * unmodified; tiles are its direct children and carry `data-imm-id`.
 *
 * Sizing is CONTENT-FIT ("贴合"): a tile's width is its user-dragged column
 * span, its height is measured from the content onto a fine row grid
 * (see refitImmersiveGrid) up to the tile's saved cap. Nothing is truncated
 * below the cap, and short tiles don't carry empty space.
 */

import type { App, HoverParent } from 'obsidian';
import { Menu, setIcon } from 'obsidian';
import { t } from './i18n';
import type { DashboardData, DashboardSettings, ImmersiveItem, RenderCallbacks } from './types';
import type { DashboardColumn } from './types';
import type DashboardPlugin from './main';
import type { PomodoroService } from './pomodoro-service';
import type { ReadingService } from './reading-service';
import type { HolidayInfo } from './holiday-service';
import {
	buildWidgetEntries,
	sortWidgetEntries,
	mountWidgetCard,
	renderCard,
	renderDashboard,
	type WidgetBuildDeps,
} from './renderer';
import {
	applyBannerFocal,
	createBannerEditButton,
	getActiveImage,
	resolveVaultImage,
	startBannerImageRotation,
	BANNER_IMAGE_ROTATION_MS,
} from './banner';
import { renderQuickNoteRegion } from './quick-note-section';
import { renderWorkspaceSwitcher } from './workspace-switcher';
import { startGuardedDrag } from './drag-guard';
import { IMM_ITEM_DRAG_TYPE } from './dnd';
import {
	DEFAULT_SECTION_SPAN,
	planImmersive,
	overlapsAny,
	resolvePlacement,
	clampSpanH,
	clampSpanW,
	defaultWidgetSize,
	IMM_COLS,
	IMM_MAX_H,
	IMM_MIN_ROWS,
	IMM_ROW_UNIT,
	IMM_TILE_GAP,
	normalizeImmersive,
	packImmersive,
	pxToRows,
	rowsToPx,
	sectionItemId,
	widgetItemId,
	type ImmersiveItem as GridItem,
	type PackedItem,
} from './immersive-grid';

export interface ImmersiveServices extends WidgetBuildDeps {
	pomodoroService?: PomodoroService;
	readingService?: ReadingService;
	holidayData?: Record<string, HolidayInfo>;
}

export interface ImmersiveRenderResult {
	/** The grid host (the kanban element). */
	grid: HTMLElement;
	/** The reconciled arrangement (order + spans) actually rendered. */
	items: GridItem[];
	/** Fresh per-key widget card elements (the view caches these across
	 *  renders so live timers survive re-renders, one card per entry). */
	widgetEls: Map<string, HTMLElement>;
}

/** Paint the grid placement onto one tile element (1-based CSS lines). */
function applyGridPosition(el: HTMLElement, tile: PackedItem): void {
	el.style.gridColumn = `${tile.col + 1} / span ${tile.w}`;
	el.style.gridRow = `${tile.row + 1} / span ${tile.h}`;
}

/** Order the kanban's children to match `packed` and stamp positions. Moves
 *  are ORDER-AWARE: when the children already sit in the packed sequence
 *  (positions-only refit), nothing is re-appended at all — appendChild moves
 *  are real DOM mutations that reload iframes, restart animations and give
 *  lazy renderers a visibility flip, so they must only happen on a genuine
 *  reorder. The add-section tile always stays last. Child lookup walks the
 *  direct children and matches dataset directly (no selector engine: keeps
 *  mini-dom tests honest and dodges CSS.escape for CJK section names). */
export function layoutImmersiveGrid(grid: HTMLElement, items: readonly GridItem[], packed: readonly PackedItem[]): void {
	const elById = new Map<string, HTMLElement>();
	let addBtn: HTMLElement | null = null;
	for (const child of Array.from(grid.children)) {
		const el = child as HTMLElement;
		if (el.dataset?.immId) elById.set(el.dataset.immId, el);
		else if (!addBtn && el.classList?.contains('dashboard-add-section')) addBtn = el;
	}
	// Stamp placements first — position writes are cheap and idempotent.
	const desired: HTMLElement[] = [];
	for (const tile of packed) {
		const el = elById.get(tile.id);
		if (!el) continue;
		applyGridPosition(el, tile);
		desired.push(el);
	}
	if (addBtn) desired.push(addBtn);
	// Already in order (an unchanged positions-only refit)? Zero mutations.
	const current = Array.from(grid.children) as HTMLElement[];
	const inOrder = current.length === desired.length
		&& current.every((el, i) => el === desired[i]);
	if (inOrder) return;
	for (const el of desired) grid.appendChild(el);
	// Anything unplaced keeps its slot ahead of the rewritten tail.
	void items;
}

/** Measure one tile's content height in px. With align-self: start and
 *  height auto (the immersive CSS), an uncapped tile's scrollHeight IS its
 *  content height; a capped tile's scrollHeight reports the FULL content
 *  past the cap — exactly what the fit needs in both cases. Returns 0 where
 *  no layout engine exists (mini-dom tests → tiles take the min rows). */
function contentHeightPx(el: HTMLElement): number {
	const direct = (el as unknown as { scrollHeight?: number }).scrollHeight;
	if (typeof direct === 'number' && direct > 0) return direct;
	const fallback = (el as unknown as { offsetHeight?: number }).offsetHeight;
	return typeof fallback === 'number' ? fallback : 0;
}

/** Per-grid memo of the last applied fit — the anti-oscillation core. Two
 *  effects:
 *  - the skip: unchanged (+/- nothing) measurements skip every DOM write, so
 *    the ResizeObserver feedback (our own span writes resize the grid) ends;
 *  - the hysteresis: a measurement within HYSTERESIS_PX of the previous one
 *    KEEPS the previous row span. Content that flaps a pixel or two around a
 *    track boundary (subpixel font rounding, async loaders, lazy renderers
 *    reacting to their own viewport) must not flip the span back and forth —
 *    that was the "section cards strobing" bug. */
interface FitMemoEntry { px: number; rows: number; }
const fitMemo = new WeakMap<HTMLElement, Map<string, FitMemoEntry>>();
const HYSTERESIS_PX = 6;
const xyOf = (item: { x?: number; y?: number }): { x?: number; y?: number } =>
	(typeof item.x === 'number' && typeof item.y === 'number') ? { x: item.x, y: item.y } : {};
/** Growth from a measurement must exceed this to enlarge a content-fit tile.
 *  Smaller growth is CREEP: section content that fills whatever height it's
 *  given (library lists revealing another partial row, progressive groups)
 *  feeds back — taller tile → more content → taller measurement → … the
 *  "folder card keeps slightly changing size" loop. Real bulk changes
 *  (expanding a group, adding cards) clear this easily. */
const GROW_THRESHOLD_PX = 80;

/** Content-fit pass: measure every tile, clamp to its saved height CAP,
 *  write the cap as an inline max-height (tiles scroll inside past it), pack
 *  the measured rows with the skyline packer and stamp the placements.
 *  `items` carries the persisted truth (w = span, h = cap); the measured
 *  rows are internal to this pass. Call after any mount/reorder/resize and
 *  whenever content grows (the grid-level ResizeObserver does that).
 *  `force` skips the unchanged shortcut — a reorder changes no heights, but
 *  the DOM order MUST still be rewritten. Style writes are always
 *  compare-before-write: touching a style attribute with the same value is
 *  still a mutation observers can see. */
export function refitImmersiveGrid(grid: HTMLElement, items: readonly GridItem[], force = false): PackedItem[] {
	// Walk in ITEMS order (the saved arrangement), not DOM order — the packer
	// must see the user's order even right after a mount whose DOM order
	// differs (sections render before widgets).
	const elById = new Map<string, HTMLElement>();
	for (const child of Array.from(grid.children)) {
		const el = child as HTMLElement;
		if (el.dataset?.immId) elById.set(el.dataset.immId, el);
	}
	const memo = fitMemo.get(grid);
	const measured = new Map<string, FitMemoEntry>();
	const effective: GridItem[] = [];
	for (const cap of items) {
		const el = elById.get(cap.id);
		if (!el) continue;
		// A tile mid-resize is lifted out of the flow (position: fixed, raw
		// px box) — measuring or restyling it now would fight the drag. Keep
		// its previous entry and leave it alone.
		if (el.hasClass?.('dashboard-imm-tile--resizing')) {
			const prevEntry = memo?.get(cap.id);
			if (prevEntry) {
				measured.set(cap.id, prevEntry);
				effective.push({ id: cap.id, w: cap.w, h: prevEntry.rows, ...xyOf(cap) });
			} else {
				effective.push({ id: cap.id, w: cap.w, h: cap.h, ...xyOf(cap) });
			}
			continue;
		}
		const px = contentHeightPx(el);
		// Widget tiles are FIXED-HEIGHT cards (the stacked strip's sizing
		// design: one canonical size per type, content scrolls inside —
		// content-hugging produced the uneven "层次不齐" board). Section and
		// card tiles stay content-fit.
		const isWidget = cap.id.startsWith('widget:');
		const prev = memo?.get(cap.id);
		// Hysteresis + growth gate, in order:
		//  - widget tiles: fixed tier height, the cap IS the size;
		//  - within HYSTERESIS_PX of the last measurement → keep last rows;
		//  - growth beyond that but under GROW_THRESHOLD_PX → CREEP (section
		//    content that fills whatever height it's given — library lists
		//    revealing another partial row — feeds back: taller tile → more
		//    content → taller measurement → …); record the larger px so
		//    sustained real growth can eventually cross the threshold;
		//  - shrink or big growth → recompute (clamped by the cap).
		const candidate = Math.min(pxToRows(px), cap.h);
		let rows: number;
		if (isWidget || cap.fixed) {
			// Fixed-height tiles: widgets (the stacked sizing design) and
			// any tile the USER resized — the cap IS the size; the content
			// fit must not shrink a user-dragged size back (the "grows on
			// drag, snaps back on release" bug that left gaps unfillable).
			rows = cap.h;
		} else if (prev && Math.abs(px - prev.px) <= HYSTERESIS_PX) {
			rows = prev.rows;
		} else if (prev && px > prev.px && px - prev.px <= GROW_THRESHOLD_PX && candidate > prev.rows) {
			rows = prev.rows;
		} else {
			rows = candidate;
		}
		measured.set(cap.id, { px, rows });
		// PIN the box to its spanned tracks: minHeight AND maxHeight both at
		// the fill. A box that follows its content directly (max = '') let
		// any internal oscillation (library progressive reveals, partial-row
		// fill feedback) move the tile without a single one of OUR writes —
		// the "folder card keeps jittering" loop. Pinned, the box only moves
		// when `rows` moves (gated above); content taller than the pin
		// scrolls in the section's own internal scroller.
		// height joins the pin (same value): min/max clamps do NOT make the
		// box DEFINITE for percentage resolution, so internal height:100%
		// chains (the library kanban view's board → column scrollers) fell
		// back to auto, the board grew to its tallest column and the columns
		// never scrolled — the wheel scrolled the page instead. An explicit
		// height keeps those chains live while the box stays byte-identical
		// (min=max=height is the same clamp triple the fit already wrote).
		const fillPx = `${rowsToPx(rows)}px`;
		if (el.style.minHeight !== fillPx) el.style.minHeight = fillPx;
		if (el.style.maxHeight !== fillPx) el.style.maxHeight = fillPx;
		if (el.style.height !== fillPx) el.style.height = fillPx;
		effective.push({ id: cap.id, w: cap.w, h: rows, ...xyOf(cap) });
	}
	// Skip the layout write when nothing measured changed beyond the
	// hysteresis AND a previous fit exists: breaks the ResizeObserver
	// feedback loop. (Forced passes — reorder commits — always write: same
	// heights, new order.)
	const unchanged = !force && !!memo && memo.size === measured.size
		&& [...measured].every(([id, entry]) => memo.get(id)?.rows === entry.rows);
	fitMemo.set(grid, measured);
	if (unchanged) {
		// Placements are already correct from the previous pass.
		return planImmersive(effective);
	}
	const packed = planImmersive(effective);
	layoutImmersiveGrid(grid, effective, packed);
	return packed;
}

/** Watch the board for content-driven size changes and refit.
 *
 *  Observation is THREE-pronged, because no single observer sees everything:
 *  - ResizeObserver on each TILE: the tiles keep NATURAL boxes (auto height +
 *    an inline min-height floor), so content growth/shrink IS a box change;
 *  - ResizeObserver on the GRID: catches column/width changes (pane resizes);
 *  - MutationObserver on the grid subtree: catches element swaps
 *    (refreshSectionInPlace, refreshDataWidget mounts) and lazy-rendered node
 *    additions, then re-observes the fresh tile elements.
 *
 *  All three funnel into ONE trailing debounce (150ms) — transient flapping
 *  settles within the window and costs at most one fit — and the fit's own
 *  writes are compare-before-write + hysteresis, so the feedback loop ends. */
export function observeImmersiveGrid(grid: HTMLElement, refit: () => void, registerCleanup: (fn: () => void) => void): void {
	const hasRO = typeof ResizeObserver !== 'undefined';
	const hasMO = typeof MutationObserver !== 'undefined';
	if (!hasRO && !hasMO) return;
	let timer: number | null = null;
	const run = (): void => {
		timer = null;
		syncTileObservers();
		applySideRails();
		refit();
	};
	const schedule = (): void => {
		if (timer !== null) return;
		timer = window.setTimeout(run, 150);
	};
	// Width-adaptive side rails: wide panes get generous margins; as the pane
	// narrows (a sidebar opens) the rails shrink so the 12-column grid keeps
	// usable card widths instead of being squeezed by dead margin.
	// LOAD-BEARING: bracket by the SCROLLER's own clientWidth — it is immune
	// to its own padding, so setting the var cannot change the input. The
	// grid's width was used first and fed back through the ResizeObserver
	// (pad -> grid narrower -> new bracket -> new pad ...): the whole board
	// visibly breathed left-right.
	const applySideRails = (): void => {
		const scroller = grid.parentElement as HTMLElement | null;
		if (!scroller) return;
		const w = scroller.clientWidth;
		const pad = w > 1600 ? 64 : w > 1200 ? 48 : w > 950 ? 28 : 14;
		scroller.style.setProperty('--imm-h-pad', `${pad}px`);
	};
	applySideRails();
	const ro = hasRO ? new ResizeObserver(schedule) : null;
	let observed = new Set<Element>();
	const syncTileObservers = (): void => {
		if (!ro) return;
		observed = new Set([...observed].filter(el => el.isConnected));
		for (const child of Array.from(grid.children)) {
			const el = child as HTMLElement;
			if (el.dataset?.immId && !observed.has(el)) {
				observed.add(el);
				ro.observe(el);
			}
		}
	};
	syncTileObservers();
	ro?.observe(grid);
	const mo = hasMO ? new MutationObserver(schedule) : null;
	mo?.observe(grid, { childList: true, subtree: true });
	registerCleanup(() => {
		if (timer !== null) window.clearTimeout(timer);
		ro?.disconnect();
		mo?.disconnect();
	});
}

export function renderImmersiveRoot(opts: {
	container: HTMLElement;
	data: DashboardData;
	settings: DashboardSettings;
	app: App;
	plugin: DashboardPlugin;
	services: ImmersiveServices;
	callbacks: RenderCallbacks;
	hoverParent?: HoverParent | null;
	reuseWidgets: Map<string, HTMLElement> | null;
	/** Live items accessor (the view's immItems). The ResizeObserver refits
	 *  through this so post-drag passes never pack against a stale list;
	 *  defaults to the render snapshot. */
	getItems?: () => readonly GridItem[];
	onEditBanner: () => void;
	registerCleanup: (fn: () => void) => void;
}): ImmersiveRenderResult {
	const { container, data, settings, app, callbacks } = opts;

	const imm = container.createDiv({ cls: 'dashboard-imm' });

	// --- Background layer: the banner poster, full-bleed ----------------------
	const bg = imm.createDiv({ cls: 'dashboard-imm-bg' });
	// The scrim rides inside the poster layer (also with no image at all —
	// it IS the fallback surface under the glass).
	bg.createDiv({ cls: 'dashboard-imm-bg-scrim' });
	const activeImage = getActiveImage(data.banner);
	if (activeImage) {
		const resolved = resolveVaultImage(app, activeImage);
		if (resolved) bg.style.backgroundImage = `url("${resolved}")`;
		applyBannerFocal(bg, data.banner, activeImage);
	}
	startBannerImageRotation(bg, data.banner, app, BANNER_IMAGE_ROTATION_MS, opts.registerCleanup);

	// --- Top region: clock centered, quick-notes bar re-flowed ----------------
	// Mounted INSIDE the scroll region (first child): the whole page —
	// clock, input, chips, board — scrolls away together; nothing pins.
	const scrollHost = imm.createDiv({ cls: 'dashboard-scroll-region' });
	const top = scrollHost.createDiv({ cls: 'dashboard-imm-top' });
	const clockTime = top.createSpan({ cls: 'dashboard-imm-clock-time' });
	const tickClock = (): void => {
		const now = new Date();
		const pad = (n: number): string => String(n).padStart(2, '0');
		const next = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
		if (clockTime.textContent !== next) clockTime.textContent = next;
	};
	tickClock();
	const clockTimer = window.setInterval(tickClock, 1000);
	opts.registerCleanup(() => window.clearInterval(clockTimer));
	if (settings.quickNotesEnabled) {
		renderQuickNoteRegion(top, settings, callbacks);
	}

	// --- Grid: sections (renderDashboard) + widget tiles ----------------------
	const grid = scrollHost.createDiv({ cls: 'dashboard-kanban' });
	renderDashboard(grid, data, callbacks, app, settings, opts.hoverParent ?? null, { skipQuickNotes: true });

	// The "+ 添加卡片" affordance rides the chips row at the PAGE RIGHT —
	// same height as the function buttons, pinned to the row's right edge
	// (the top region never scrolls, so it stays visible). Mounting it in
	// the row also keeps it OUT of the board area: as a mid-page fixed FAB
	// it shadowed tiles near the right edge and ate their resize-strip
	// presses. The ghost tile never renders on immersive boards.
	{
		const addHost = top.querySelector<HTMLElement>('.dashboard-quicknote-nav') ?? top;
		const btn = addHost.createEl('button', {
			cls: 'dashboard-imm-add-btn',
			attr: { 'aria-label': t('renderer.addCard'), type: 'button', title: t('renderer.addCard') },
		});
		setIcon(btn, 'plus');
		btn.addEventListener('click', e => {
			e.stopPropagation();
			callbacks.onRequestAddSection();
		});
		grid.querySelector('.dashboard-add-section')?.remove();
	}

	// Sticky sections DISSOLVE here: no "便利贴" container concept on this
	// board — every memo note and every todo list is its own card tile
	// (renderCard standalone). The backing column stays in the data (its
	// cards, templates and archive entry all keep working); only the section
	// wrapper never renders.
	const cardColumnOf = new Map<string, DashboardColumn>();
	for (const child of Array.from(grid.children)) {
		const row = child as HTMLElement;
		if (row.dataset?.sectionType !== 'sticky') continue;
		const column = data.columns.find(col => col.name === row.dataset.column);
		row.remove();
		if (!column) continue;
		for (const card of column.cards) {
			const cardEl = renderCard(card, column.name, 'sticky', callbacks, app, data, settings);
			cardEl.dataset.immId = `card:${card.id}`;
			grid.appendChild(cardEl);
			cardColumnOf.set(card.id, column);
		}
	}

	// Section tiles first (array order), then widget tiles. Widget membership
	// is PER-BOARD: the arrangement itself (widget: ids in data.immersive) is
	// the source of truth — the global settings toggles only rule the
	// side/stacked rails. A board with no arrangement starts widget-free and
	// grows through the in-board add menu.
	const memberKeys = new Set<string>();
	for (const item of data.immersive ?? []) {
		if (item.id.startsWith('widget:')) memberKeys.add(item.id.slice('widget:'.length));
	}
	const entries = sortWidgetEntries(buildWidgetEntries(settings, app, opts.services, memberKeys), settings);
	const presentIds: string[] = [];
	for (const col of data.columns) {
		if ((col.sectionType ?? '').toLowerCase() === 'sticky') {
			// Dissolved: its CARDS are the tiles (skip the section id).
			for (const card of col.cards) presentIds.push(`card:${card.id}`);
		} else {
			presentIds.push(sectionItemId(col.name));
		}
	}
	const widgetIds: string[] = entries.map(entry => widgetItemId(entry.key));
	presentIds.push(...widgetIds);

	const widgetEls = new Map<string, HTMLElement>();
	for (const entry of entries) {
		const cached = opts.reuseWidgets?.get(entry.key);
		if (cached && cached.isConnected === false) {
			// Re-attach the live card (timers/listeners intact).
			grid.appendChild(cached);
			widgetEls.set(entry.key, cached);
			continue;
		}
		const el = mountWidgetCard(entry, grid, app, settings);
		if (el) widgetEls.set(entry.key, el);
	}

	// Stamp imm ids; sections sit under [data-column], widgets under
	// [data-widget-key] — both are direct children of the grid.
	for (const child of Array.from(grid.children)) {
		const el = child as HTMLElement;
		const name = el.dataset?.column;
		if (name) el.dataset.immId = sectionItemId(name);
	}
	for (const [key, el] of widgetEls) {
		el.dataset.immId = widgetItemId(key);
	}

	// Reconcile the saved arrangement with the live tiles, pack, and order.
	const defaultSizeOf = (id: string): { w: number; h: number } => {
		if (id.startsWith('card:')) return { w: 3, h: 80 }; // memo/todo cards: content-fit
		if (id.startsWith('section:')) return DEFAULT_SECTION_SPAN;
		return defaultWidgetSize(id.slice('widget:'.length), {
			habit: settings.habitHeightRatio,
			reading: settings.readingHeightRatio,
			albums: settings.albums,
		});
	};
	const { items } = normalizeImmersive(data.immersive, presentIds, defaultSizeOf);
	// Content-fit: measure → cap → pack → place (replaces the fixed-span pass;
	// saved h values are height CAPS, the content decides the real size).
	refitImmersiveGrid(grid, items, true);
	observeImmersiveGrid(grid, () => refitImmersiveGrid(grid, opts.getItems?.() ?? items), opts.registerCleanup);

	// --- Corner controls: switcher keeps its banner spot, wand goes right ------
	renderWorkspaceSwitcher(imm, opts.plugin);
	const wand = createBannerEditButton(imm, opts.onEditBanner);
	wand.addClass('dashboard-imm-edit-btn');

	return { grid, items, widgetEls };
}

/** The item id of a grid child ('' when untagged). */
export function immIdOf(el: Element | null): string {
	return (el as HTMLElement | null)?.dataset.immId ?? '';
}

/** Copy a tile's immersive identity + placement onto its replacement element
 *  — the shared step of EVERY in-place section/widget swap. Without it the
 *  fresh element drops to auto placement and teleports to the end of the
 *  board until the next fit (the read: sections strobing on every scan
 *  refresh). Idempotent on non-immersive DOM (no immId → no-op). The height
 *  pins travel too: an unpinned replacement loses its DEFINITE height for a
 *  frame, collapsing internal percentage chains (kanban columns) into auto. */
export function carryImmersivePlacement(oldEl: HTMLElement, newEl: HTMLElement): void {
	const immId = oldEl.dataset?.immId;
	if (!immId) return;
	newEl.dataset.immId = immId;
	if (oldEl.style.gridColumn) newEl.style.gridColumn = oldEl.style.gridColumn;
	if (oldEl.style.gridRow) newEl.style.gridRow = oldEl.style.gridRow;
	if (oldEl.style.minHeight) newEl.style.minHeight = oldEl.style.minHeight;
	if (oldEl.style.maxHeight) newEl.style.maxHeight = oldEl.style.maxHeight;
	if (oldEl.style.height) newEl.style.height = oldEl.style.height;
}

// ===== Phase 3: tile interactions (reorder drag + corner resize) =====

/** Controls whose own pointer gesture must not arm a widget-tile drag — the
 *  same recipe as setupWidgetDnD's DRAG_BLOCKED. */
const DRAG_BLOCKED = 'input, textarea, select, button, a[href], [contenteditable], [data-no-drag]';

/** Height of the top strip that arms a tile MOVE (the title-bar zone). */
const MOVE_ZONE_PX = 44;

/** Whole-tile reorder drag over the free grid. Grid-level delegation, so
 *  refreshSectionInPlace node swaps keep the wiring alive.
 *
 *  Two drag sources:
 *  - a section tile's grip (`.dashboard-section-grip`, already draggable;
 *    the side/stacked grip-reorder wiring is skipped in immersive via
 *    setupDragAndDrop's skipSectionGrip);
 *  - a widget card, armed per gesture (mousedown on plain card surface →
 *    draggable on; pressing a control leaves it off).
 *
 *  Drop: the hovered tile's left/right half picks insert-before/after in the
 *  items array; `onCommit` receives the reordered list (the caller applies
 *  the optimistic repack and persists). Card drags inside sections and task/
 *  doc item drags are declined by target/dataTransfer guards — those belong
 *  to setupDragAndDrop / the section renderers. */
export function setupImmersiveDnD(
	grid: HTMLElement,
	getItems: () => GridItem[],
	onCommit: (items: GridItem[]) => void,
	cleanupFns: Array<() => void>,
): void {
	let srcId: string | null = null;
	let srcTile: HTMLElement | null = null;

	const tileOf = (el: Element | null): HTMLElement | null =>
		(el?.closest('[data-imm-id]') as HTMLElement | null) ?? null;

	const clearIndicators = (): void => {
		// Two simple queries (not a comma list): the restricted selector
		// engines we run under (mini-dom tests) only take one simple selector.
		for (const cls of ['dashboard-imm-tile--over-left', 'dashboard-imm-tile--over-right']) {
			grid.querySelectorAll('.' + cls).forEach(el => (el as HTMLElement).removeClass(cls));
		}
	};

	// The MOVE gesture is POINTER-DRIVEN (like resize): press a handle
	// surface, drag past a small threshold, release to drop. HTML5 drag-and-
	// drop is deliberately NOT used — Electron/Chromium's native DnD is known
	// to die app-wide after system sleep / display changes ("after a while
	// idle, cards can't be moved"), and pointer events never rot.
	//
	// Handle surfaces (press-to-move): a widget card's TOP strip, a dissolved
	// card tile's own header, a section tile's header. Controls inside are
	// excluded (DRAG_BLOCKED), so clicks/dblclick-rename pass through when the
	// pointer never crosses the threshold.
	const MOVE_THRESHOLD_PX = 5;
	let press: { tile: HTMLElement; id: string; x: number; y: number; grabDX: number; grabDY: number } | null = null;
	let moving = false;

	const findHandleTile = (target: HTMLElement, e: PointerEvent): HTMLElement | null => {
		// Widget tiles: top strip only.
		const widgetTile = target.closest('[data-widget-key]') as HTMLElement | null;
		if (widgetTile && widgetTile.dataset.immId !== undefined && !target.closest('.dashboard-card')) {
			const rect = widgetTile.getBoundingClientRect();
			return e.clientY - rect.top <= MOVE_ZONE_PX ? widgetTile : null;
		}
		// Dissolved card tiles: their own header (nested card headers do NOT
		// move the section — those cards keep their own machinery).
		const cardHeader = target.closest('.dashboard-card-header') as HTMLElement | null;
		if (cardHeader) {
			const card = cardHeader.closest('.dashboard-card') as HTMLElement | null;
			return card && card.dataset.immId ? card : null;
		}
		// Section tiles: the header is the handle.
		const header = target.closest('.dashboard-section-header') as HTMLElement | null;
		if (header) return header.closest('[data-imm-id]') as HTMLElement | null;
		return null;
	};

	const beginSession = (e: PointerEvent): void => {
		if (!press) return;
		moving = true;
		srcTile = press.tile;
		srcId = press.id;
		srcTile.addClass('dashboard-imm-tile--dragging');
		activeDocument.body.addClass('dashboard-imm-pointer-dragging');
		// Kill any text selection the press started; the shield keeps new
		// ones from forming while the gesture runs.
		activeDocument.getSelection?.()?.removeAllRanges();
		onMovePreview(e);
	};

	const endSession = (e: PointerEvent | null): void => {
		const doc = activeDocument;
		doc.removeEventListener('pointermove', onSessionMove, true);
		doc.removeEventListener('pointerup', onSessionUp, true);
		doc.removeEventListener('pointercancel', onSessionAbort, true);
		activeDocument.body.removeClass('dashboard-imm-pointer-dragging');
		if (moving) {
			// The release still dispatches a CLICK at the drop point — onto
			// whatever tile sits there now (a memo's save button, a search
			// input, an edit pencil). Swallow that one click whole, or every
			// move reads as "drag then random modal opens".
			const suppress = (ev: Event): void => {
				ev.preventDefault();
				ev.stopPropagation();
			};
			doc.addEventListener('click', suppress, true);
			window.setTimeout(() => doc.removeEventListener('click', suppress, true), 300);
		}
		if (moving && e && srcId && press) {
			hideGhost();
			const next = computePlacement(getItems(), srcId, grid, e.clientX, e.clientY, press.grabDX, press.grabDY, spanOf);
			if (next) onCommit(next);
		}
		srcTile?.removeClass('dashboard-imm-tile--dragging');
		srcTile = null;
		srcId = null;
		press = null;
		moving = false;
		hideGhost();
	};

	const onSessionMove = (e: PointerEvent): void => {
		if (!press) return;
		if (!moving) {
			const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
			if (dist < MOVE_THRESHOLD_PX) return;
			beginSession(e);
			return;
		}
		onMovePreview(e);
	};
	const onSessionUp = (e: PointerEvent): void => {
		endSession(e);
	};
	const onSessionAbort = (): void => {
		endSession(null);
	};

	const onPointerDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (target.closest(DRAG_BLOCKED)) return;
		const tile = findHandleTile(target, e);
		if (!tile || !tile.dataset.immId) return;
		// Kill the NATIVE drag the browser would otherwise start on header
		// text (dragstart hijacks the gesture — every pointer event ceases,
		// which read as "memo/todo cards can't be moved"). Click/dblclick
		// still fire in Chromium when pointerdown is canceled; controls were
		// already excluded by DRAG_BLOCKED above.
		e.preventDefault();
		const tr = tile.getBoundingClientRect();
		press = {
			tile,
			id: tile.dataset.immId,
			x: e.clientX,
			y: e.clientY,
			grabDX: e.clientX - tr.left,
			grabDY: e.clientY - tr.top,
		};
		const doc = activeDocument;
		doc.addEventListener('pointermove', onSessionMove, true);
		doc.addEventListener('pointerup', onSessionUp, true);
		doc.addEventListener('pointercancel', onSessionAbort, true);
	};
	grid.addEventListener('pointerdown', onPointerDown);

	// Landing preview + POSITION-based insertion. The drop point itself
	// picks the slot: the pointer's grid cell maps to an insertion index in
	// the packed order, the dragged card takes that slot and everything
	// after it flows down — "drop where you want it", not swap-with-target.
	// (The old left/right-half insertion read as swapping on adjacent cards
	// and couldn't target empty space.) The ghost shows the exact landing
	// slot live; spans come from the tiles' pinned inline values.
	let ghost: HTMLElement | null = null;
	const spanOf = (id: string, fallback: number): number => {
		const el = grid.querySelector<HTMLElement>(`[data-imm-id="${id}"]`);
		const m = el ? /span (\d+)/.exec(el.style.gridRow ?? '') : null;
		return m ? parseInt(m[1]!, 10) : fallback;
	};
	const hideGhost = (): void => {
		ghost?.remove();
		ghost = null;
	};
	const showGhostAt = (candidate: readonly GridItem[]): void => {
		const preview = candidate.map(item => ({ ...item, h: spanOf(item.id, item.h) }));
		const packed = planImmersive(preview);
		const slot = packed.find(t => t.id === srcId);
		if (!slot) {
			hideGhost();
			return;
		}
		ghost ??= grid.createDiv({ cls: 'dashboard-imm-drop-ghost' });
		ghost.style.gridColumn = `${slot.col + 1} / span ${slot.w}`;
		ghost.style.gridRow = `${slot.row + 1} / span ${slot.h}`;
		grid.appendChild(ghost);
	};

	// Live landing preview while the pointer session runs (also called once
	// at threshold-crossing). Empty space included; leaving the grid hides
	// the ghost but the session keeps running.
	const onMovePreview = (e: PointerEvent): void => {
		if (!srcId) return;
		const gridRect = grid.getBoundingClientRect();
		if (e.clientX < gridRect.left || e.clientX > gridRect.right
			|| e.clientY < gridRect.top || e.clientY > gridRect.bottom) {
			hideGhost();
			return;
		}
		// Edge auto-scroll: dragging against the scroll region's top/bottom
		// edge keeps the board flowing under the pointer.
		edgeAutoScroll(e.clientY);
		if (press) {
			const candidate = computePlacement(getItems(), srcId, grid, e.clientX, e.clientY, press.grabDX, press.grabDY, spanOf);
			if (candidate) showGhostAt(candidate);
			else hideGhost();
		}
	};

	// Nudge the scroll region when the pointer rides its edges (HTML5 DnD
	// did this natively; pointer drags must scroll themselves).
	const edgeAutoScroll = (clientY: number): void => {
		const scroller = grid.closest('.dashboard-scroll-region') as HTMLElement | null;
		if (!scroller) return;
		const r = scroller.getBoundingClientRect();
		const EDGE = 64;
		const SPEED = 14;
		if (clientY < r.top + EDGE) scroller.scrollTop -= SPEED;
		else if (clientY > r.bottom - EDGE) scroller.scrollTop += SPEED;
	};

	cleanupFns.push(() => {
		grid.removeEventListener('pointerdown', onPointerDown);
		endSession(null);
	});
}

/** Free placement for a drop: the card lands where the POINTER puts it
 *  (grab-offset honored), with SMART SNAP — its top/bottom/left/right edges
 *  magnetize to neighbor edges within a few pixels (the top/bottom alignment
 *  the board lacked) — and gravity resolution so it never buries a neighbor.
 *  Returns the updated items with explicit x/y on the source. */
function computePlacement(
	items: readonly GridItem[],
	srcId: string,
	grid: HTMLElement,
	pointerX: number,
	pointerY: number,
	grabDX: number,
	grabDY: number,
	spanOf: (id: string, fallback: number) => number,
): GridItem[] | null {
	const from = items.findIndex(i => i.id === srcId);
	if (from < 0) return null;
	const self = items[from]!;
	const rect = grid.getBoundingClientRect();
	const gap = readGridColumnGap(grid);
	const colW = (rect.width - (IMM_COLS - 1) * gap) / IMM_COLS;
	const pitch = colW + gap;
	const unit = IMM_ROW_UNIT;

	const others = items
		.filter(item => item.id !== srcId)
		.map(item => {
			const p = planImmersive(items.filter(i => i.id === item.id)).find(() => true);
			void p;
			const packedAll = planImmersive(items.map(i => i.id === item.id ? { ...i, h: spanOf(i.id, i.h) } : { ...i, h: spanOf(i.id, i.h) }));
			return packedAll.find(t => t.id === item.id)!;
		});

	// Pointer → intended top-left in px (grab offset keeps the card under
	// the fingers where it was grabbed).
	let leftPx = pointerX - grabDX - rect.left;
	let topPx = pointerY - grabDY - rect.top;

	// Smart snap: pull edges toward the nearest neighbor edge within ~8px.
	const SNAP_PX = 8;
	const wPx = self.w * pitch - gap;
	const hPx = rowsToPx(spanOf(srcId, self.h)) + gap;
	const snapV = (val: number, targets: number[]): number => {
		let best = val;
		let bestD = SNAP_PX;
		for (const t of targets) {
			const d = Math.abs(val - t);
			if (d < bestD) {
				bestD = d;
				best = t;
			}
		}
		return best;
	};
	// Align MY top or bottom to THEIR top or bottom; my left/right to theirs.
	topPx = snapV(topPx, others.flatMap(o => [o.row * unit, (o.row + o.h) * unit - gap + gap]));
	// (bottom-of-other aligns my bottom: snap my bottom too and keep the better)
	for (const o of others) {
		const ob = (o.row + o.h) * unit;
		const d = Math.abs((topPx + hPx) - ob);
		if (d < SNAP_PX) topPx = ob - hPx;
	}
	leftPx = snapV(leftPx, others.flatMap(o => [o.col * pitch, (o.col + o.w) * pitch - gap]));
	for (const o of others) {
		const orr = (o.col + o.w) * pitch;
		const d = Math.abs((leftPx + wPx) - orr);
		if (d < SNAP_PX) leftPx = orr - wPx;
	}

	// px → grid units, clamped in bounds.
	const x = Math.max(0, Math.min(IMM_COLS - self.w, Math.round(leftPx / pitch)));
	const y = Math.max(0, Math.floor(Math.max(0, topPx) / unit));

	// SWAP: when the board is packed and the pointer sits INSIDE a tile (or
	// mostly over it), the two cards trade positions — the flexible move for
	// full boards where no free slot exists. Falls through to nearest-free
	// for glancing overlaps.
	const selfRect = { x, y, w: self.w, h: spanOf(srcId, self.h) };
	const rects = others.map(o => ({ x: o.col, y: o.row, w: o.w, h: o.h }));
	if (overlapsAny(selfRect, rects)) {
		const overlapArea = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number => {
			const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
			const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
			return w > 0 && h > 0 ? w * h : 0;
		};
		const px = Math.floor((pointerX - rect.left) / pitch);
		const py = Math.floor((pointerY - rect.top) / unit);
		let primary: { o: (typeof others)[number]; r: { x: number; y: number; w: number; h: number }; area: number } | null = null;
		for (let i = 0; i < others.length; i++) {
			const r = rects[i]!;
			const area = overlapArea(selfRect, r);
			if (area <= 0) continue;
			const inside = px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
			const weight = area * (inside ? 4 : 1);
			if (!primary || weight > primary.area) primary = { o: others[i]!, r, area: weight };
		}
		const primaryRect = primary?.r;
		const dominates = primaryRect
			? overlapArea(selfRect, primaryRect) >= 0.5 * Math.min(selfRect.w * selfRect.h, primaryRect.w * primaryRect.h)
			: false;
		if (primary && primaryRect && dominates) {
			// Trade origins; each keeps its own size. Clamp x for widths.
			const srcPacked = planImmersive(items.map(i => ({ ...i, h: spanOf(i.id, i.h) }))).find(t => t.id === srcId)!;
			const myNewX = Math.max(0, Math.min(IMM_COLS - self.w, primaryRect.x));
			const otherItem = items.find(i => i.id === primary.o.id)!;
			const otherNewX = Math.max(0, Math.min(IMM_COLS - (otherItem?.w ?? primaryRect.w), srcPacked.col));
			return items.map(item => {
				if (item.id === srcId) return { ...item, x: myNewX, y: primaryRect.y };
				if (item.id === primary.o.id) return { ...item, x: otherNewX, y: srcPacked.row };
				return item;
			});
		}
	}

	// Nearest-free: land at the closest non-overlapping cell to the intent.
	const resolved = resolvePlacement(selfRect, rects);
	return items.map(item => item.id === srcId
		? { ...item, x: resolved.x, y: resolved.y }
		: item);
}

/** Edge-based resize: the RIGHT edge strips drag width, the BOTTOM edge
 *  drags height (the corner does both). The tile stays IN PLACE — no lift,
 *  no floating overlay — each pointer move rewrites its grid spans
 *  (columns snap in ~one-column steps, rows in 10px steps), and the grid
 *  reflows neighbors around it live. Release commits the snapped size.
 *  A pointer press on a strip never arms the move-drag (stopPropagation). */
export function attachImmersiveResizeHandle(
	tile: HTMLElement,
	itemId: string,
	getItems: () => GridItem[],
	onCommit: (items: GridItem[]) => void,
): void {
	if (tile.querySelector('.dashboard-imm-resize-h')) return;
	const grid = tile.parentElement;
	if (!grid) return;

	const startResize = (e: PointerEvent, axis: 'x' | 'y' | 'xy'): void => {
		e.preventDefault();
		e.stopPropagation();
		if (!tile.isConnected || !grid.isConnected) return;
		const items = getItems();
		const current = items.find(i => i.id === itemId);
		if (!current) return;

		const tileRect = tile.getBoundingClientRect();
		const gridRect = grid.getBoundingClientRect();
		const gap = readGridColumnGap(grid);
		const colW = (gridRect.width - (IMM_COLS - 1) * gap) / IMM_COLS;
		const colStart = parseGridLine(tile.style.gridColumn);
		const rowStart = parseGridLine(tile.style.gridRow);
		const minW = colW + gap;                    // one full column incl. its gap
		const maxW = gridRect.width;
		const minH = rowsToPx(IMM_MIN_ROWS);
		const maxH = rowsToPx(IMM_MAX_H);
		const startW = tileRect.width;
		const startH = tileRect.height;

		tile.addClass('dashboard-imm-tile--resizing');
		let liveW = current.w;
		let liveH = current.h;

		startGuardedDrag(e, {
			cursor: axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'nwse-resize',
			onMove: (ev: PointerEvent) => {
				if (!tile.isConnected) return;
				const wantW = axis !== 'y' ? Math.max(minW, Math.min(maxW, startW + (ev.clientX - e.clientX))) : startW;
				const wantH = axis !== 'x' ? Math.max(minH, Math.min(maxH, startH + (ev.clientY - e.clientY))) : startH;
				liveW = clampSpanW(spanFromPixels(wantW, colW, gap));
				liveH = clampSpanH(pxToRows(wantH));
				// In-place: same origin tracks, new spans; the box follows the
				// tracks (pinned via min+max+height), neighbors reflow around
				// it live.
				tile.style.gridColumn = `${colStart} / span ${liveW}`;
				tile.style.gridRow = `${rowStart} / span ${liveH}`;
				const fill = `${rowsToPx(liveH)}px`;
				tile.style.minHeight = fill;
				tile.style.maxHeight = fill;
				tile.style.height = fill;
			},
			onUp: () => {
				tile.removeClass('dashboard-imm-tile--resizing');
				if (!tile.isConnected) return;
				if (liveW === current.w && liveH === current.h) return;
				// A user-dragged size is exact from now on (fixed): the fit
				// keeps it instead of re-collapsing to content height.
				onCommit(items.map(i => i.id === itemId ? { ...i, w: liveW, h: liveH, fixed: true } : i));
			},
		});
	};

	const hEdge = tile.createDiv({ cls: 'dashboard-imm-resize-h' });
	hEdge.addEventListener('pointerdown', e => startResize(e, 'x'));
	const vEdge = tile.createDiv({ cls: 'dashboard-imm-resize-v' });
	vEdge.addEventListener('pointerdown', e => startResize(e, 'y'));
	const corner = tile.createDiv({ cls: 'dashboard-imm-resize-handle' });
	corner.addEventListener('pointerdown', e => startResize(e, 'xy'));
}

/** Column-gap px of the grid element (computed style; 10px fallback). Row gap
 *  is 0 by design — the fine-row grid bakes the vertical spacing into the
 *  tile margin (see the immersive CSS chapter). */
function readGridColumnGap(grid: HTMLElement): number {
	const raw = typeof getComputedStyle === 'function' ? getComputedStyle(grid).columnGap : '';
	const px = raw ? parseFloat(raw) : Number.NaN;
	return Number.isFinite(px) && px > 0 ? px : IMM_TILE_GAP;
}

/** 1-based start line from an inline `X / span N` value (1 fallback). */
function parseGridLine(value: string): number {
	const m = /^(\d+)/.exec((value ?? '').trim());
	return m ? Math.max(1, parseInt(m[1]!, 10)) : 1;
}

/** span N from a pixel extent: width(N) = N*unit + (N-1)*gap. */
function spanFromPixels(px: number, unit: number, gap: number): number {
	return Math.round((px + gap) / (unit + gap));
}


// ===== In-board widget management (immersive boards only) =====
// Widget membership on an immersive board is the arrangement itself — added
// and removed like any other card, fully independent of the global settings
// toggles (those keep ruling the side/stacked rails).

/** One addable widget card: key (member key) + menu face. */
export interface ImmersiveWidgetOption {
	key: string;
	label: string;
	icon: string;
	/** Set on placeholder entries for EMPTY instance families (album /
	 *  countdown / anniversary with nothing configured yet): picking the entry
	 *  opens that family's creation modal instead of adding a card, so the
	 *  type is reachable from the board without a settings detour. */
	createKind?: 'album' | 'countdown' | 'anniversary';
}

const WIDGET_META: Record<string, { labelKey: string; icon: string }> = {
	quickActions: { labelKey: 'settings.widgetQuickActionsEnabled', icon: 'zap' },
	lunar: { labelKey: 'settings.widgetLunar', icon: 'sparkles' },
	yearProgress: { labelKey: 'settings.widgetYearProgress', icon: 'trending-up' },
	calendar: { labelKey: 'settings.widgetCalendar', icon: 'calendar' },
	weather: { labelKey: 'settings.widgetWeatherEnabled', icon: 'cloud-sun' },
	pomodoro: { labelKey: 'settings.pomodoroEnabled', icon: 'timer' },
	reading: { labelKey: 'settings.readingEnabled', icon: 'book-open' },
	habit: { labelKey: 'settings.widgetHabitEnabled', icon: 'flame' },
	expense: { labelKey: 'settings.widgetExpenseEnabled', icon: 'coins' },
	skills: { labelKey: 'skillsWidget.title', icon: 'wand-sparkles' },
	music: { labelKey: 'settings.widgetMusic', icon: 'music' },
};

/** Every widget card that COULD join the board right now — the add menu's
 *  catalog, independent of the settings toggles (membership mode rules the
 *  board). Mirrors buildWidgetEntries' availability rules without the
 *  membership filter. An EMPTY instance family (album / countdown /
 *  anniversary with nothing configured) still gets one placeholder entry that
 *  opens the family's creation modal — otherwise those types would be
 *  unreachable from the board until a settings detour configured one. */
export function immersiveWidgetCatalog(settings: DashboardSettings, deps: WidgetBuildDeps): ImmersiveWidgetOption[] {
	const out: ImmersiveWidgetOption[] = [];
	for (const [key, meta] of Object.entries(WIDGET_META)) {
		if (key === 'quickActions' && !deps.renderQuickActions) continue;
		if (key === 'pomodoro' && !deps.pomodoroService) continue;
		if (key === 'reading' && !deps.readingService) continue;
		out.push({ key, label: t(meta.labelKey), icon: meta.icon });
	}
	const albums = settings.albums ?? [];
	for (const cfg of albums) {
		out.push({ key: `album-${cfg.id}`, label: `${t('settings.widgetAlbum')} · ${cfg.folder || cfg.id}`, icon: 'image' });
	}
	if (albums.length === 0) {
		out.push({ key: 'album:new', label: `${t('settings.widgetAlbum')} · ${t('immersive.createInstance')}`, icon: 'image', createKind: 'album' });
	}
	const countdowns = settings.countdowns ?? [];
	for (const cfg of countdowns) {
		out.push({ key: `countdown-${cfg.id}`, label: `${t('settings.countdownEnabled')} · ${cfg.label}`, icon: 'alarm-clock' });
	}
	if (countdowns.length === 0) {
		out.push({ key: 'countdown:new', label: `${t('settings.countdownEnabled')} · ${t('immersive.createInstance')}`, icon: 'alarm-clock', createKind: 'countdown' });
	}
	const anniversaries = settings.anniversaries ?? [];
	for (const cfg of anniversaries) {
		out.push({ key: `anniversary-${cfg.id}`, label: `${t('settings.widgetAnniversary')} · ${cfg.label}`, icon: 'heart' });
	}
	if (anniversaries.length === 0) {
		out.push({ key: 'anniversary:new', label: `${t('settings.widgetAnniversary')} · ${t('immersive.createInstance')}`, icon: 'heart', createKind: 'anniversary' });
	}
	return out;
}

/** The "+ 添加卡片" menu: sections through the existing modal, memo/todo
 *  cards straight onto the board (dissolved sticky types), widgets appended
 *  to the arrangement (per-board membership). Already-present widgets are
 *  listed disabled — one card per type/instance. */
export function openImmersiveAddMenu(opts: {
	settings: DashboardSettings;
	services: ImmersiveServices;
	boardKeys: Set<string>;
	anchor: HTMLElement;
	onAddSection: () => void;
	onAddNoteCard: (kind: 'memo' | 'todo') => void;
	onAddWidget: (key: string) => void;
	/** Create the first instance of an EMPTY family (album / countdown /
	 *  anniversary) — opens the family's settings modal from the board. */
	onCreateInstance: (kind: 'album' | 'countdown' | 'anniversary') => void;
}): void {
	const menu = new Menu();
	menu.addItem(item => item
		.setTitle(t('immersive.addSectionItem'))
		.setIcon('plus')
		.onClick(opts.onAddSection));
	menu.addItem(item => item
		.setTitle(t('immersive.addMemoCard'))
		.setIcon('sticky-note')
		.onClick(() => opts.onAddNoteCard('memo')));
	menu.addItem(item => item
		.setTitle(t('immersive.addTodoCard'))
		.setIcon('list-checks')
		.onClick(() => opts.onAddNoteCard('todo')));
	menu.addSeparator();
	for (const option of immersiveWidgetCatalog(opts.settings, opts.services)) {
		menu.addItem(item => item
			.setTitle(option.label)
			.setIcon(option.icon)
			.setDisabled(opts.boardKeys.has(option.key))
			.onClick(() => {
				if (option.createKind) opts.onCreateInstance(option.createKind);
				else opts.onAddWidget(option.key);
			}));
	}
	const rect = opts.anchor.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}

/** Right-click a widget tile → remove it from the board (the card form of
 *  the section delete button; underlying widget config stays untouched).
 *  No "tidy layout" entry on purpose: the auto re-flow packed worse than the
 *  user's own placement (retired at Rae's request). */
export function setupImmersiveTileMenu(
	grid: HTMLElement,
	onRemove: (itemId: string) => void,
	cleanupFns: Array<() => void>,
): void {
	const handler = (e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		const tile = target?.closest('[data-imm-id]') as HTMLElement | null;
		if (!tile || !tile.dataset.immId) return;
		e.preventDefault();
		e.stopPropagation();
		const id = tile.dataset.immId;
		const menu = new Menu();
		if (tile.hasAttribute?.('data-widget-key') || tile.dataset.widgetKey) {
			menu.addItem(item => item
				.setTitle(t('immersive.removeCard'))
				.setIcon('trash-2')
				.onClick(() => onRemove(id)));
		}
		menu.showAtMouseEvent(e);
	};
	grid.addEventListener('contextmenu', handler);
	cleanupFns.push(() => grid.removeEventListener('contextmenu', handler));
}

/** Hover-revealed × at the tile's top-right corner — the VISIBLE removal
 *  affordance (right-click alone went unnoticed). Idempotent. The card's own
 *  corner config gear shifts down a notch in immersive CSS so the two chips
 *  stack instead of colliding. */
export function attachImmersiveWidgetDelete(tile: HTMLElement, onRemove: (itemId: string) => void): void {
	if (tile.querySelector('.dashboard-imm-widget-del')) return;
	const btn = tile.createEl('button', {
		cls: 'dashboard-imm-widget-del',
		attr: { 'aria-label': t('immersive.removeCard'), type: 'button' },
	});
	setIcon(btn, 'x');
	btn.addEventListener('pointerdown', e => e.stopPropagation());
	btn.addEventListener('click', e => {
		e.stopPropagation();
		const id = tile.dataset.immId;
		if (id) onRemove(id);
	});
}
