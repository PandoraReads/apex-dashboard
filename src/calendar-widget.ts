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
import { renderMonthGrid, renderWeekGrid, mondayOf, taskTime, byTaskTime } from './calendar-grid';
import { CalendarMonthModal, DayAgendaModal } from './calendar-modal';
import { renderTextWithLinks } from './renderer';

/** Module-level hover-preview state, so only one popup ever exists and it can be
 *  torn down across re-renders. Mirrors the single-popup discipline used elsewhere
 *  (e.g. note-popover) rather than a per-cell instance. */
let hoverTimer: number | null = null;
let hoverPopup: HTMLElement | null = null;
const HOVER_DELAY_MS = 350;
const PREVIEW_MAX_TASKS = 8;

/** Close and discard the active hover preview, cancelling any pending show. */
export function closeDayPreview(): void {
	if (hoverTimer !== null) { window.clearTimeout(hoverTimer); hoverTimer = null; }
	if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
}

/** Render one compact, non-interactive task row for the preview list. Visually
 *  matches the calendar's task rows (time prefix, priority bar, overdue tint). */
function renderPreviewTask(task: VaultTask, app: App): HTMLElement {
	const row = createDiv();
	const overDue = !task.checked && dateBucketOf(task.due) === 'overdue';
	row.className = 'dashboard-calendar-event'
		+ (task.checked ? ' is-done' : '')
		+ (task.priority ? ` prio-${task.priority}` : '')
		+ (overDue ? ' is-overdue' : '');
	const tm = taskTime(task);
	if (tm) row.createDiv({ cls: 'dashboard-calendar-event-time', text: tm });
	const text = row.createDiv({ cls: 'dashboard-calendar-event-text' });
	renderTextWithLinks(text, task.text, app);
	return row;
}

/** Build and position the preview popup near `anchor`, listing the day's tasks.
 *  Clamps to the viewport so it never spills off-screen. */
function showDayPreview(iso: string, anchor: HTMLElement, tasks: VaultTask[], app: App): void {
	// A newer hover superseded this one while its timer was pending.
	if (hoverTimer !== null) { window.clearTimeout(hoverTimer); hoverTimer = null; }

	closeDayPreview();
	const popup = activeDocument.body.createDiv({ cls: 'dashboard-calendar-day-preview' });
	hoverPopup = popup;

	// Date header, formatted from the ISO string to avoid Date.now() (banned in some contexts).
	const [y, m, d] = iso.split('-').map(Number);
	const dateLabel = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	popup.createDiv({ cls: 'dashboard-calendar-day-preview-date', text: dateLabel });

	const list = popup.createDiv({ cls: 'dashboard-calendar-day-preview-list' });
	const sorted = tasks.slice().sort(byTaskTime);
	const shown = sorted.slice(0, PREVIEW_MAX_TASKS);
	for (const task of shown) {
		list.appendChild(renderPreviewTask(task, app));
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
 *
 * Pure presentation: no timer — cross-day refresh is handled by the view's
 * day-rollover full re-render (same approach as the lunar / year-progress widgets).
 */
export function renderSidebarCalendar(
	container: HTMLElement,
	settings: DashboardSettings,
	app: App,
	onOpenNote?: (file: TFile) => void,
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

	// Month | Week view toggle
	const viewToggle = nav.createDiv({ cls: 'dashboard-library-view-toggle dashboard-calendar-view-toggle' });

	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth();
	let view: 'month' | 'week' = 'month';
	let weekStart: Date = mondayOf(now);

	const buildViewToggle = (): void => {
		viewToggle.empty();
		(['month', 'week'] as const).forEach((v) => {
			const btn = viewToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (v === view ? ' active' : ''),
				attr: { 'aria-label': v === 'month' ? t('calendar.viewMonth') : t('calendar.viewWeek') },
			});
			setIcon(btn, v === 'month' ? 'calendar' : 'calendar-range');
			btn.addEventListener('click', () => {
				if (view === v) return;
				view = v;
				if (v === 'week') weekStart = mondayOf(new Date());
				buildViewToggle();
				void load();
			});
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
		const tasks = (await collectVaultTasks(app, excludeFolders)).filter(isCalendarRelevant);
		const byDay = indexTasksByDay(tasks);
		const onDayClick = (iso: string): void => {
			new DayAgendaModal(app, iso, byDay.get(iso) ?? [], { onToggle, onOpenNote }).open();
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
					showDayPreview(iso, anchor, tasks, app);
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
			? renderWeekGrid(gridHost, weekStart, byDay, { compact: true, app, onDayClick })
			: renderMonthGrid(gridHost, year, month, byDay, { compact: true, dotMode: true, app, onDayClick, onDayHover, onDayLeave });
		labelEl.textContent = label;
	}

	prev.addEventListener('click', () => { shift(-1); });
	next.addEventListener('click', () => { shift(1); });

	async function openFullscreen(): Promise<void> {
		const tasks = (await collectVaultTasks(app, excludeFolders)).filter(isCalendarRelevant);
		const byDay = indexTasksByDay(tasks);
		new CalendarMonthModal(app, byDay, { onToggle, onOpenNote }, view, view === 'week' ? weekStart : undefined).open();
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

	if (Platform.isMobile) {
		// Mobile: defer the vault scan to keep the sidebar light. The expand
		// button loads the inline grid; from there a second tap opens fullscreen.
		labelEl.textContent = t('calendar.today');
		gridHost.createDiv({ cls: 'dashboard-library-empty', text: t('calendar.mobileManualLoad') });
		let loadedOnce = false;
		fullBtn.addEventListener('click', () => {
			if (!loadedOnce) {
				loadedOnce = true;
				void load().then(openFullscreen);
			} else {
				void openFullscreen();
			}
		});
	} else {
		fullBtn.addEventListener('click', () => { void openFullscreen(); });
		if (!hasLoaded) {
			void render();
		}
	}
}
