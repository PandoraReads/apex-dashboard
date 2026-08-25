import { App, Notice, Platform, setIcon, TFile } from 'obsidian';
import { t } from './i18n';
import type { DashboardSettings } from './types';
import {
	collectVaultTasks,
	indexTasksByDay,
	isCalendarRelevant,
	toggleTaskInFile,
	invalidatePath,
	dateBucketOf,
	type VaultTask,
} from './alltasks-scan';
import { renderMonthGrid, renderWeekGrid, mondayOf, taskDayTime, byDayTaskTime, appendDayOriginMark } from './calendar-grid';
import { CalendarMonthModal, DayAgendaModal } from './calendar-modal';
import { applyModalTheme } from './modal-theme';
import { renderTextWithLinks } from './renderer';

/** Module-level hover-preview state, so only one popup ever exists and it can be
 *  torn down across re-renders. Mirrors the single-popup discipline used elsewhere
 *  (e.g. note-popover) rather than a per-cell instance. */
let hoverTimer: number | null = null;
let hoverPopup: HTMLElement | null = null;
const HOVER_DELAY_MS = 350;
const PREVIEW_MAX_TASKS = 8;

/** Per-widget reload functions keyed by the widget's root element, so vault task
 *  changes can refresh the grid in place (re-scan + re-render into the live
 *  gridHost) without rebuilding the whole widget - and without losing the user's
 *  month/week navigation. WeakMap: discarded widget DOM releases its entry. */
const widgetReloaders = new WeakMap<HTMLElement, (resetToToday: boolean) => Promise<void>>();

/** Re-scan tasks and re-render the live sidebar task calendar's grid in place.
 *  Returns false when the widget is absent (disabled) or not yet loaded (phones
 *  defer the initial scan). `resetToToday` also snaps navigation back to the
 *  current month - used by the day-rollover path. */
export function refreshSidebarTaskCalendar(root: HTMLElement, resetToToday = false): boolean {
	const el = root.querySelector<HTMLElement>('.dashboard-sidebar-calendar');
	if (!el || !el.isConnected) return false;
	const reload = widgetReloaders.get(el);
	if (!reload) return false;
	void reload(resetToToday);
	return true;
}

/** Close and discard the active hover preview, cancelling any pending show. */
export function closeDayPreview(): void {
	if (hoverTimer !== null) { window.clearTimeout(hoverTimer); hoverTimer = null; }
	if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
}

/** Render one compact, non-interactive task row for the preview list. Visually
 *  matches the calendar's task rows (time prefix, priority bar, overdue tint,
 *  day-origin marker). */
function renderPreviewTask(task: VaultTask, iso: string, app: App): HTMLElement {
	const row = createDiv();
	const overDue = !task.checked && dateBucketOf(task.due) === 'overdue';
	row.className = 'dashboard-calendar-event'
		+ (task.checked ? ' is-done' : '')
		+ (task.priority ? ` prio-${task.priority}` : '')
		+ (overDue ? ' is-overdue' : '');
	const tm = taskDayTime(task, iso);
	if (tm) row.createDiv({ cls: 'dashboard-calendar-event-time', text: tm });
	const text = row.createDiv({ cls: 'dashboard-calendar-event-text' });
	renderTextWithLinks(text, task.text, app);
	appendDayOriginMark(row, task, iso);
	return row;
}

/** Build and position the preview popup near `anchor`, listing the day's tasks.
 *  Clamps to the viewport so it never spills off-screen. */
function showDayPreview(anchor: HTMLElement, iso: string, tasks: VaultTask[], app: App): void {
	// A newer hover superseded this one while its timer was pending.
	if (hoverTimer !== null) { window.clearTimeout(hoverTimer); hoverTimer = null; }

	closeDayPreview();
	const popup = activeDocument.body.createDiv({ cls: 'dashboard-calendar-day-preview' });
	// Body-level popup: mirror the dashboard's --db-* tokens so it follows the
	// active theme instead of falling back to Obsidian's native surface.
	applyModalTheme(popup);
	hoverPopup = popup;

	const list = popup.createDiv({ cls: 'dashboard-calendar-day-preview-list' });
	const sorted = tasks.slice().sort(byDayTaskTime(iso));
	const shown = sorted.slice(0, PREVIEW_MAX_TASKS);
	for (const task of shown) {
		list.appendChild(renderPreviewTask(task, iso, app));
	}
	if (sorted.length > PREVIEW_MAX_TASKS) {
		list.createDiv({
			cls: 'dashboard-calendar-day-preview-more',
			text: t('calendar.moreCount', { count: sorted.length - PREVIEW_MAX_TASKS }),
		});
	}

	// Position: anchor to the right of the cell, fall back to left if no room,
	// then clamp vertically inside the viewport.
	const rect = anchor.getBoundingClientRect();
	const margin = 8;
	// Force a layout pass to measure the popup's own size (left/top default to auto).
	const pw = popup.offsetWidth;
	const ph = popup.offsetHeight;
	const vw = activeDocument.documentElement.clientWidth;
	const vh = activeDocument.documentElement.clientHeight;
	const placeRight = rect.right + margin + pw <= vw;
	const left = placeRight
		? rect.right + margin
		: Math.max(margin, rect.left - margin - pw);
	const top = Math.min(Math.max(margin, rect.top), Math.max(margin, vh - ph - margin));
	popup.setCssProps({ left: `${left}px`, top: `${top}px` });
}

/**
 * Sidebar calendar widget: a compact month grid (day number + a dot when the day
 * has tasks) or a week list, with month/week switching and an expand button that
 * opens the full-screen calendar modal. Clicking a day opens its agenda (view /
 * add / toggle tasks). Excluded folders come from the global `calendarExcludeFolders`
 * setting. This is the sidebar replacement for the old calendar *section*.
 * `onOpenNote` (when wired) lets agenda/full-screen task clicks jump to the
 * task's source note, scrolled to its line.
 *
 * Pure presentation: no timer — cross-day refresh is handled by the view's
 * day-rollover full re-render (same approach as the lunar / year-progress widgets).
 *
 * `opts.autoLoad` overrides the phone deferred-scan branch: the mobile widget
 * panel only creates this widget on an explicit tab tap, so there the scan
 * starts immediately instead of behind the manual-load placeholder.
 */
export function renderSidebarCalendar(
	container: HTMLElement,
	settings: DashboardSettings,
	app: App,
	onOpenNote?: (file: TFile, line?: number) => void,
	opts?: { autoLoad?: boolean },
): void {
	const excludeFolders = settings.calendarExcludeFolders ?? [];

	// Drop any hover preview left over from the previous render (the popup lives
	// on activeDocument.body, so the widget re-create below can't reach it).
	closeDayPreview();

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-calendar' });

	const content = widget.createDiv({ cls: 'dashboard-library-content dashboard-calendar-content' });

	// Navigation bar
	const nav = content.createDiv({ cls: 'dashboard-calendar-nav' });
	const prev = nav.createDiv({ cls: 'dashboard-calendar-nav-btn' });
	setIcon(prev, 'chevron-left');
	const labelEl = nav.createDiv({ cls: 'dashboard-calendar-nav-label' });
	const next = nav.createDiv({ cls: 'dashboard-calendar-nav-btn' });
	setIcon(next, 'chevron-right');

	// Single month/week toggle: shows the view you'd switch TO. One button
	// (instead of a two-segment control) keeps room for the expand button in
	// the narrow sidebar.
	const viewToggle = nav.createDiv({ cls: 'dashboard-library-view-toggle dashboard-calendar-view-toggle' });

	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth();
	let view: 'month' | 'week' = 'month';
	let weekStart: Date = mondayOf(now);

	const buildViewToggle = (): void => {
		viewToggle.empty();
		const next: 'month' | 'week' = view === 'month' ? 'week' : 'month';
		const btn = viewToggle.createDiv({
			cls: 'dashboard-library-view-btn dashboard-calendar-view-btn',
			attr: { 'aria-label': next === 'week' ? t('calendar.switchToWeek') : t('calendar.switchToMonth') },
		});
		setIcon(btn, next === 'week' ? 'calendar-range' : 'calendar');
		btn.addEventListener('click', (e) => {
			// The click swaps the icon by emptying this node, detaching `btn`
			// from the DOM before the event bubbles further. A detached target
			// fails the sidebar's `contains(e.target)` check on `root`, so the
			// "click outside collapses" handler would fold an unpinned sidebar.
			// Stop the bubble here; the button's action is self-contained.
			e.stopPropagation();
			if (view === next) return;
			view = next;
			if (next === 'week') weekStart = mondayOf(new Date());
			buildViewToggle();
			void load();
		});
	};
	buildViewToggle();

	nav.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
	const fullBtn = nav.createEl('button', {
		cls: 'dashboard-calendar-today-btn',
		attr: { 'aria-label': t('calendar.fullscreen') },
	});
	setIcon(fullBtn, 'maximize-2');

	const gridHost = content.createDiv({ cls: 'dashboard-calendar-host' });
	let hasLoaded = false;

	const onToggle = async (task: VaultTask, nextChecked: boolean): Promise<void> => {
		try {
			await toggleTaskInFile(app, task, nextChecked);
			invalidatePath(task.path);
		} catch {
			new Notice(t('alltasks.toggleFailed'));
		}
	};

	async function render(): Promise<void> {
		hasLoaded = true;
		// Always include the dashboard file itself: its checkbox lists are the
		// user's live todos AND the day-agenda's fallback write destination. An
		// exclusion covering the dashboard's folder (e.g. 'assets') would
		// otherwise hide dashboard tasks and erase calendar-added ones on the
		// next re-scan.
		const tasks = (await collectVaultTasks(app, excludeFolders, settings.dashboardFile)).filter(isCalendarRelevant);
		const byDay = indexTasksByDay(tasks);
		const onDayClick = (iso: string): void => {
			new DayAgendaModal(app, iso, byDay.get(iso) ?? [], { onToggle, onOpenNote }, settings.dashboardFile).open();
		};
		// Hover preview only on desktop (no hover on touch). Shows the day's task
		// list next to the cell after a short delay; cancelled if the pointer moves on.
		const hoverEnabled = !Platform.isMobile;
		const onDayHover = hoverEnabled
			? (iso: string, anchor: HTMLElement): void => {
				const tasks = byDay.get(iso) ?? [];
				if (tasks.length === 0) return;
				if (hoverTimer !== null) window.clearTimeout(hoverTimer);
				hoverTimer = window.setTimeout(() => {
					hoverTimer = null;
					showDayPreview(anchor, iso, tasks, app);
				}, HOVER_DELAY_MS);
			}
			: undefined;
		const onDayLeave = hoverEnabled
			? (): void => {
				if (hoverTimer !== null) { window.clearTimeout(hoverTimer); hoverTimer = null; }
				closeDayPreview();
			}
			: undefined;
		const { label } = view === 'week'
			? renderWeekGrid(gridHost, weekStart, byDay, { compact: true, app, onDayClick, onDayHover, onDayLeave })
			: renderMonthGrid(gridHost, year, month, byDay, { compact: true, dotMode: true, app, onDayClick, onDayHover, onDayLeave });
		labelEl.textContent = label;
	}

	prev.addEventListener('click', () => { shift(-1); });
	next.addEventListener('click', () => { shift(1); });
	fullBtn.addEventListener('click', (e) => {
		// Keep the bubble inside the sidebar (same rationale as the view toggle).
		e.stopPropagation();
		// Phones defer the vault scan: the first tap loads the grid, then opens
		// fullscreen; later taps go straight to fullscreen.
		if (Platform.isPhone && !hasLoaded) {
			void load().then(openFullscreen);
		} else {
			void openFullscreen();
		}
	});

	async function openFullscreen(): Promise<void> {
		const tasks = (await collectVaultTasks(app, excludeFolders, settings.dashboardFile)).filter(isCalendarRelevant);
		const byDay = indexTasksByDay(tasks);
		new CalendarMonthModal(app, byDay, { onToggle, onOpenNote }, view, view === 'week' ? weekStart : undefined, settings.dashboardFile).open();
	}

	/** Navigate by one month (month view) or one week (week view). */
	function shift(delta: number): void {
		if (view === 'week') {
			const d = new Date(weekStart);
			d.setDate(weekStart.getDate() + delta * 7);
			weekStart = d;
		} else {
			let m = month + delta;
			let y = year;
			while (m < 0) { m += 12; y -= 1; }
			while (m > 11) { m -= 12; y += 1; }
			month = m;
			year = y;
		}
		void load();
	}

	const load = (): Promise<void> => render();

	if (Platform.isPhone && !opts?.autoLoad) {
		// Phones: defer the vault scan to keep the sidebar light. The refresh
		// button loads the inline grid; from there a tap on the expand button
		// opens fullscreen. (Tablets also have .is-mobile but plenty of room,
		// so they take the auto-load branch below like desktop.)
		labelEl.textContent = t('calendar.today');
		gridHost.createDiv({ cls: 'dashboard-library-empty', text: t('calendar.mobileManualLoad') });
		const refreshBtn = gridHost.createEl('button', {
			cls: 'dashboard-calendar-refresh-btn',
			attr: { 'aria-label': t('calendar.refresh'), type: 'button' },
		});
		setIcon(refreshBtn, 'rotate-cw');
		refreshBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void load();
		});
	} else {
		if (!hasLoaded) {
			void render();
		}
	}

	// In-place reload entry point for vault task changes: re-scan and re-render
	// the grid only. Guarded by hasLoaded so phones keep their deferred-scan
	// placeholder until the user explicitly loads the grid.
	widgetReloaders.set(widget, async (resetToToday: boolean): Promise<void> => {
		if (!hasLoaded) return;
		if (resetToToday) {
			const now2 = new Date();
			year = now2.getFullYear();
			month = now2.getMonth();
			view = 'month';
			weekStart = mondayOf(now2);
		}
		// The hover preview anchors to day cells that are about to be replaced.
		closeDayPreview();
		await render();
	});
}
