import { App, Notice, setIcon, TFile } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
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
 * Render the calendar section: a compact in-column month grid (each day cell
 * shows its tasks, click a day for its agenda) with month navigation and a
 * full-screen button. Excluded folders come from the column's libraryConfig.
 * Toggling a task writes back to its source file; the vault modify event then
 * refreshes the grid.
 */
export async function renderCalendarSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	_onHoverParent: HoverParent | null,
	onOpenNote?: (file: TFile) => void,
): Promise<void> {
	const excludeFolders = column.libraryConfig?.excludeFolders ?? [];
	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth();
	let view: 'month' | 'week' = 'month';
	let weekStart: Date = mondayOf(now);

	const content = el.createDiv({ cls: 'dashboard-library-content dashboard-calendar-content' });

	// Navigation bar
	const nav = content.createDiv({ cls: 'dashboard-calendar-nav' });
	const prev = nav.createDiv({ cls: 'dashboard-calendar-nav-btn' });
	setIcon(prev, 'chevron-left');
	const labelEl = nav.createDiv({ cls: 'dashboard-calendar-nav-label' });
	const next = nav.createDiv({ cls: 'dashboard-calendar-nav-btn' });
	setIcon(next, 'chevron-right');

	// Month | Week view toggle
	const viewToggle = nav.createDiv({ cls: 'dashboard-library-view-toggle dashboard-calendar-view-toggle' });
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
				void render();
			});
		});
	};
	buildViewToggle();

	nav.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
	const todayBtn = nav.createEl('button', { cls: 'dashboard-calendar-today-btn', text: t('calendar.today') });
	const fullBtn = nav.createEl('button', { cls: 'dashboard-calendar-today-btn', attr: { 'aria-label': t('calendar.fullscreen') } });
	setIcon(fullBtn, 'maximize-2');

	const gridHost = content.createDiv({ cls: 'dashboard-calendar-host' });

	const onToggle = async (task: VaultTask, nextChecked: boolean): Promise<void> => {
		try {
			await toggleTaskInFile(app, task, nextChecked);
			invalidatePath(task.path);
		} catch {
			new Notice(t('alltasks.toggleFailed'));
		}
	};

	async function render(): Promise<void> {
		const tasks = (await collectVaultTasks(app, excludeFolders)).filter(isCalendarRelevant);
		const byDay = indexTasksByDay(tasks);
		const onDayClick = (iso: string): void => {
			new DayAgendaModal(app, iso, byDay.get(iso) ?? [], { onToggle, onOpenNote }).open();
		};
		const { label } = view === 'week'
			? renderWeekGrid(gridHost, weekStart, byDay, { compact: true, app, onDayClick })
			: renderMonthGrid(gridHost, year, month, byDay, { compact: true, app, onDayClick });
		labelEl.textContent = label;
	}

	prev.addEventListener('click', () => { shift(-1); });
	next.addEventListener('click', () => { shift(1); });
	todayBtn.addEventListener('click', () => { resetToToday(); void render(); });
	fullBtn.addEventListener('click', () => {
		void openFullscreen();
	});

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
		void render();
	}

	function resetToToday(): void {
		const t0 = new Date();
		year = t0.getFullYear();
		month = t0.getMonth();
		weekStart = mondayOf(t0);
	}

	await render();
}
