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
	/** Show each task's time-of-day label (week view). */
	showTimes?: boolean;
}

const COMPACT_MAX_PER_DAY = 3;

/** The `HH:MM` time-of-day for a task, from its captured `time` (⏰/due/start) or the raw reminder. */
export function taskTime(task: VaultTask): string | undefined {
	return task.time ?? (task.reminder && task.reminder.length >= 16 ? task.reminder.slice(11, 16) : undefined);
}

/** Sort comparator: tasks with an earlier time-of-day first; untimed last. */
export function byTaskTime(a: VaultTask, b: VaultTask): number {
	const ta = taskTime(a) ?? '99:99';
	const tb = taskTime(b) ?? '99:99';
	return ta < tb ? -1 : ta > tb ? 1 : 0;
}

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

function monthAbbr(month: number): string {
	const names = t('calendar.months').split(',').map(s => s.trim());
	const fallback = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return (names.length === 12 ? names : fallback)[month] ?? fallback[month] ?? '';
}

/** Monday-anchored start of the week containing `d` (local time). */
export function mondayOf(d: Date): Date {
	const offset = d.getDay() === 0 ? -6 : 1 - d.getDay();
	const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	m.setDate(m.getDate() + offset);
	return m;
}

/** Friendly range label for a Monday-anchored week, e.g. "Jun 22 – Jun 28, 2026". */
function weekLabel(weekStart: Date): string {
	const end = new Date(weekStart);
	end.setDate(weekStart.getDate() + 6);
	const s = `${monthAbbr(weekStart.getMonth())} ${weekStart.getDate()}`;
	const e = `${monthAbbr(end.getMonth())} ${end.getDate()}`;
	return `${s} – ${e}, ${end.getFullYear()}`;
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

const WEEK_COMPACT_MAX = 6;

/**
 * Render a Monday-anchored week as a vertical list of 7 day rows. Each row
 * shows that day's tasks (more per day than the compact month grid — the point
 * of the week view). Compact mode caps the list and opens the day agenda on
 * header click; full mode renders every task interactively.
 */
export function renderWeekGrid(
	container: HTMLElement,
	weekStart: Date,
	byDay: Map<string, VaultTask[]>,
	opts: MonthGridOptions,
): { label: string } {
	container.empty();

	const todayIso = toIsoDate(new Date());
	const labels = weekdayLabels();
	const wrap = container.createDiv({ cls: 'dashboard-calendar dashboard-calendar--week' + (opts.compact ? ' is-compact' : ' is-full') });
	// Show each task's time-of-day and order tasks within a day by that time.
	const weekOpts: MonthGridOptions = { ...opts, showTimes: true };

	for (let i = 0; i < 7; i++) {
		const d = new Date(weekStart);
		d.setDate(weekStart.getDate() + i);
		const iso = toIsoDate(d);
		const isToday = iso === todayIso;
		const dayTasks = (byDay.get(iso) ?? []).slice().sort(byTaskTime);

		const dayRow = wrap.createDiv({
			cls: 'dashboard-calendar-week-row'
				+ (isToday ? ' is-today' : '')
				+ (dayTasks.length > 0 ? ' has-tasks' : ''),
		});
		const head = dayRow.createDiv({ cls: 'dashboard-calendar-week-row-head' });
		const nameWrap = head.createDiv({ cls: 'dashboard-calendar-week-row-namewrap' });
		nameWrap.createDiv({ cls: 'dashboard-calendar-week-row-name', text: labels[i] ?? '' });
		nameWrap.createDiv({ cls: 'dashboard-calendar-week-row-date', text: `${d.getMonth() + 1}/${d.getDate()}` });
		if (dayTasks.length > 0) {
			head.createDiv({ cls: 'dashboard-calendar-week-row-count', text: String(dayTasks.length) });
		}

		const list = dayRow.createDiv({ cls: 'dashboard-calendar-cell-list dashboard-calendar-week-row-list' });
		const shown = opts.compact ? dayTasks.slice(0, WEEK_COMPACT_MAX) : dayTasks;
		for (const task of shown) {
			list.appendChild(renderDayTask(task, weekOpts));
		}
		if (opts.compact && dayTasks.length > WEEK_COMPACT_MAX) {
			list.createDiv({
				cls: 'dashboard-calendar-more',
				text: t('calendar.moreCount', { count: dayTasks.length - WEEK_COMPACT_MAX }),
			});
		}

		if (opts.compact && opts.onDayClick) {
			head.addClass('is-clickable');
			head.addEventListener('click', () => opts.onDayClick?.(iso));
		}
	}

	return { label: weekLabel(weekStart) };
}

const TIMEGRID_HOUR_PX = 48;

function hhmmToMin(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const m = s.match(/^(\d{1,2}):(\d{2})$/);
	return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/**
 * Render a Monday-anchored week as a Google-Calendar-style time grid (for the
 * full-screen modal): a left hour axis + 7 day columns, with each timed task
 * positioned by its start time and sized by its duration. Untimed tasks go in
 * an all-day strip; a red "now" line marks the current time. The view auto-
 * scrolls to the first event (or 7:00).
 */
export function renderWeekTimeGrid(
	container: HTMLElement,
	weekStart: Date,
	byDay: Map<string, VaultTask[]>,
	opts: MonthGridOptions,
): { label: string } {
	container.empty();

	const now = new Date();
	const todayIso = toIsoDate(now);
	const labels = weekdayLabels();
	const wrap = container.createDiv({ cls: 'dashboard-calgrid' });

	const days: { iso: string; date: Date }[] = [];
	for (let i = 0; i < 7; i++) {
		const d = new Date(weekStart);
		d.setDate(weekStart.getDate() + i);
		days.push({ iso: toIsoDate(d), date: d });
	}

	// Header row: corner + 7 day headers.
	const head = wrap.createDiv({ cls: 'dashboard-calgrid-head' });
	head.createDiv({ cls: 'dashboard-calgrid-corner' });
	for (let i = 0; i < days.length; i++) {
		const { iso, date } = days[i]!;
		const h = head.createDiv({ cls: 'dashboard-calgrid-dayhead' + (iso === todayIso ? ' is-today' : '') });
		h.createDiv({ cls: 'dashboard-calgrid-dayhead-wd', text: labels[i] ?? '' });
		h.createDiv({ cls: 'dashboard-calgrid-dayhead-date', text: `${date.getMonth() + 1}/${date.getDate()}` });
	}

	// All-day strip: untimed tasks of each day as chips.
	const allDay = wrap.createDiv({ cls: 'dashboard-calgrid-allday' });
	allDay.createDiv({ cls: 'dashboard-calgrid-allday-corner', text: t('calendar.allDay') });
	for (const { iso } of days) {
		const cell = allDay.createDiv({ cls: 'dashboard-calgrid-allday-cell' });
		const allDayTasks = (byDay.get(iso) ?? []).filter(task => !taskTime(task));
		for (const task of allDayTasks.slice(0, 3)) {
			cell.createDiv({ cls: 'dashboard-calgrid-allday-chip' + (task.checked ? ' is-done' : ''), text: task.text });
		}
		if (allDayTasks.length > 3) {
			cell.createDiv({ cls: 'dashboard-calgrid-allday-more', text: `+${allDayTasks.length - 3}` });
		}
	}

	// Scrollable body: hour axis + 7 day columns + now line.
	const scroll = wrap.createDiv({ cls: 'dashboard-calgrid-scroll' });
	const body = scroll.createDiv({ cls: 'dashboard-calgrid-body' });

	const hours = body.createDiv({ cls: 'dashboard-calgrid-hours' });
	for (let h = 0; h < 24; h++) {
		hours.createDiv({ cls: 'dashboard-calgrid-hour', text: `${String(h).padStart(2, '0')}:00` });
	}

	let earliestMin: number | undefined;
	for (const { iso } of days) {
		const col = body.createDiv({ cls: 'dashboard-calgrid-daycol' + (iso === todayIso ? ' is-today' : '') });
		for (const task of byDay.get(iso) ?? []) {
			const tm = taskTime(task);
			if (!tm) continue; // untimed -> all-day strip
			const startMin = hhmmToMin(tm);
			if (startMin === undefined) continue;
			let endMin = hhmmToMin(task.endTime) ?? startMin + 60;
			if (endMin <= startMin) endMin = startMin + 30;
			endMin = Math.min(endMin, 24 * 60);
			if (earliestMin === undefined || startMin < earliestMin) earliestMin = startMin;

			const ev = col.createDiv({
				cls: 'dashboard-calgrid-event'
					+ (task.checked ? ' is-done' : '')
					+ (task.priority ? ` prio-${task.priority}` : ''),
			});
			ev.setCssProps({
				top: `${Math.round(startMin * TIMEGRID_HOUR_PX / 60)}px`,
				height: `${Math.max(Math.round((endMin - startMin) * TIMEGRID_HOUR_PX / 60), 20)}px`,
			});
			ev.createDiv({ cls: 'dashboard-calgrid-event-time', text: tm });
			const title = ev.createDiv({ cls: 'dashboard-calgrid-event-title' });
			renderTextWithLinks(title, task.text, opts.app);

			if (!opts.compact && opts.onToggle) {
				const check = ev.createEl('input', { cls: 'dashboard-calgrid-event-check', attr: { type: 'checkbox' } });
				check.checked = task.checked;
				check.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opts.onToggle?.(task, !task.checked); });
			}
			if (opts.onOpenNote) {
				ev.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).tagName === 'INPUT') return;
					opts.onOpenNote?.(task.file);
				});
			}
		}
	}

	// "Now" line across today's column area (only if today is in this week).
	if (days.some(d => d.iso === todayIso)) {
		const nowMin = now.getHours() * 60 + now.getMinutes();
		const nl = body.createDiv({ cls: 'dashboard-calgrid-nowline' });
		nl.setCssProps({ top: `${Math.round(nowMin * TIMEGRID_HOUR_PX / 60)}px` });
	}

	// Land on the first event (or 7:00).
	const targetMin = earliestMin !== undefined ? Math.max(0, earliestMin - 60) : 7 * 60;
	const targetTop = Math.round(targetMin * TIMEGRID_HOUR_PX / 60);
	window.requestAnimationFrame(() => { scroll.scrollTop = targetTop; });

	return { label: weekLabel(weekStart) };
}

/** Render one task inside a calendar day cell. */
function renderDayTask(task: VaultTask, opts: MonthGridOptions): HTMLElement {
	const row = createDiv();
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

	if (opts.showTimes) {
		const tm = taskTime(task);
		if (tm) row.createDiv({ cls: 'dashboard-calendar-event-time', text: tm });
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
