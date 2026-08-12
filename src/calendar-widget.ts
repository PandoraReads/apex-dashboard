import { App, Notice, Platform, setIcon, TFile } from 'obsidian';
import { t } from './i18n';
import type { DashboardSettings } from './types';
import {
	collectVaultTasks,
	indexTasksByDay,
	isCalendarRelevant,
	toggleTaskInFile,
	invalidatePath,
	type VaultTask,
} from './alltasks-scan';
import { renderMonthGrid, renderWeekGrid, mondayOf } from './calendar-grid';
import { CalendarMonthModal, DayAgendaModal } from './calendar-modal';

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
		const { label } = view === 'week'
			? renderWeekGrid(gridHost, weekStart, byDay, { compact: true, app, onDayClick })
			: renderMonthGrid(gridHost, year, month, byDay, { compact: true, dotMode: true, app, onDayClick });
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
