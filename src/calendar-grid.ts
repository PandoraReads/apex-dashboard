import { App, setIcon, TFile } from 'obsidian';
import { t } from './i18n';
import { renderTextWithLinks } from './renderer';
import {
	dateBucketOf,
	toIsoDate,
	type VaultTask,
} from './alltasks-scan';

/** Options controlling how a month grid is rendered and how its tasks behave. */
export interface MonthGridOptions {
	/** Compact mode (in-column): tiny cells, capped task list, tasks non-interactive. */
	compact: boolean;
	app: App;
	onToggle?: (task: VaultTask, nextChecked: boolean) => void;
	onOpenNote?: (file: TFile) => void;
	/** Compact mode: clicking a day cell opens its agenda. */
	onDayClick?: (iso: string) => void;
}

const COMPACT_MAX_PER_DAY = 3;

function weekdayLabels(): string[] {
	// Monday-first, to match the alltasks week bucketing.
	const raw = t('calendar.weekdays');
	const labels = raw.split(',').map(s => s.trim());
	return labels.length === 7 ? labels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

function monthLabel(year: number, month: number): string {
	const names = t('calendar.months').split(',').map(s => s.trim());
	const fallback = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const name = (names.length === 12 ? names : fallback)[month] ?? fallback[month];
	return `${name} ${year}`;
}

/**
 * Render a Monday-first month grid (6 rows x 7 cols). Each day cell lists the
 * tasks occupying it (from the day-indexed map). Compact mode caps the list and
 * makes tasks non-interactive (cell click opens the day agenda); full mode
 * renders every task with an interactive checkbox.
 */
export function renderMonthGrid(
	container: HTMLElement,
	year: number,
	month: number,
	byDay: Map<string, VaultTask[]>,
	opts: MonthGridOptions,
): { label: string } {
	container.empty();

	const todayIso = toIsoDate(new Date());
	const firstOfMonth = new Date(year, month, 1);
	// Monday-first offset: JS getDay() is Sun=0..Sat=6 → Mon=0..Sun=6.
	const leading = (firstOfMonth.getDay() + 6) % 7;
	const gridStart = new Date(year, month, 1 - leading);

	const wrap = container.createDiv({ cls: 'dashboard-calendar' + (opts.compact ? ' is-compact' : ' is-full') });

	// Weekday header
	const head = wrap.createDiv({ cls: 'dashboard-calendar-weekdays' });
	for (const label of weekdayLabels()) {
		head.createDiv({ cls: 'dashboard-calendar-weekday', text: label });
	}

	// Body grid
	const body = wrap.createDiv({ cls: 'dashboard-calendar-body' });
	for (let i = 0; i < 42; i++) {
		const d = new Date(gridStart);
		d.setDate(gridStart.getDate() + i);
		const iso = toIsoDate(d);
		const inMonth = d.getMonth() === month;
		const isToday = iso === todayIso;
		const dayTasks = byDay.get(iso) ?? [];

		const cell = body.createDiv({
			cls: 'dashboard-calendar-cell'
				+ (inMonth ? '' : ' is-outside')
				+ (isToday ? ' is-today' : '')
				+ (dayTasks.length > 0 ? ' has-tasks' : ''),
		});

		cell.createDiv({ cls: 'dashboard-calendar-cell-num', text: String(d.getDate()) });

		const list = cell.createDiv({ cls: 'dashboard-calendar-cell-list' });
		const shown = opts.compact ? dayTasks.slice(0, COMPACT_MAX_PER_DAY) : dayTasks;
		for (const task of shown) {
			list.appendChild(renderDayTask(task, opts));
		}
		if (opts.compact && dayTasks.length > COMPACT_MAX_PER_DAY) {
			list.createDiv({
				cls: 'dashboard-calendar-more',
				text: t('calendar.moreCount', { count: dayTasks.length - COMPACT_MAX_PER_DAY }),
			});
		}

		if (opts.compact && opts.onDayClick) {
			cell.addEventListener('click', () => opts.onDayClick?.(iso));
		}
	}

	return { label: monthLabel(year, month) };
}

/** Render one task inside a calendar day cell. */
function renderDayTask(task: VaultTask, opts: MonthGridOptions): HTMLElement {
	const row = document.createElement('div');
	const multi = Boolean(task.start && task.end);
	row.className = 'dashboard-calendar-event'
		+ (task.checked ? ' is-done' : '')
		+ (multi ? ' is-multi' : '')
		+ (task.priority ? ` prio-${task.priority}` : '');

	if (!opts.compact && opts.onToggle) {
		const check = row.createEl('input', { cls: 'dashboard-calendar-check', attr: { type: 'checkbox' } });
		check.checked = task.checked;
		check.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opts.onToggle?.(task, !task.checked); });
	}

	const text = row.createDiv({ cls: 'dashboard-calendar-event-text' });
	const overDue = !task.checked && dateBucketOf(task.due) === 'overdue';
	renderTextWithLinks(text, task.text, opts.app);

	if (opts.compact) {
		// nothing else; the cell-level click handler opens the day agenda
	} else if (opts.onOpenNote) {
		row.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT') return;
			e.stopPropagation();
			opts.onOpenNote?.(task.file);
		});
	}

	if (overDue) row.addClass('is-overdue');
	if (multi) {
		const mark = row.createDiv({ cls: 'dashboard-calendar-multi-mark', attr: { 'aria-label': `${task.start} → ${task.end}` } });
		setIcon(mark, 'arrow-right-left');
	}

	return row;
}

export { monthLabel };
