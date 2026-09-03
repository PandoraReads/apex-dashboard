import { App, setIcon, TFile } from 'obsidian';
import { t, getLanguage } from './i18n';
import { renderTextWithLinks } from './renderer';
import {
	calendarSpan,
	dateBucketOf,
	taskDayKind,
	toIsoDate,
	type VaultTask,
} from './alltasks-scan';

/** Options controlling how a month grid is rendered and how its tasks behave. */
export interface MonthGridOptions {
	/** Compact mode (in-column): tiny cells, capped task list, tasks non-interactive. */
	compact: boolean;
	app: App;
	onToggle?: (task: VaultTask, nextChecked: boolean) => void;
	/** Open a task's source note, optionally scrolling to the task's line. */
	onOpenNote?: (file: TFile, line?: number) => void;
	/** Compact mode: clicking a day cell opens its agenda. */
	onDayClick?: (iso: string) => void;
	/** Dot mode: show a single dot when the day has tasks (no task text). Implies
	 *  compact-style clickable cells. Typically paired with onDayHover so the
	 *  hidden tasks surface on hover. */
	dotMode?: boolean;
	/** Show each task's time-of-day label (week view). */
	showTimes?: boolean;
	/** Dot mode: the pointer enters a day cell that has tasks. `anchor` is the cell
	 *  element — used by the caller to position a preview popup near it. */
	onDayHover?: (iso: string, anchor: HTMLElement) => void;
	/** Dot mode: the pointer left a day cell (or the grid). Caller hides its popup. */
	onDayLeave?: () => void;
	/** Full-screen month mode: a continuous multi-day bar was clicked. Opens the
	 *  day agenda of the bar's first visible day. */
	onBarClick?: (iso: string) => void;
	/** Full-screen mode: the day number (month cells) or day header (week time
	 * grid) was clicked. Opens that day's agenda ready to add tasks. */
	onDayNumClick?: (iso: string) => void;
}

const COMPACT_MAX_PER_DAY = 3;

/** The `HH:MM` time-of-day for a task, from its captured `time` (⏰/due/start) or the raw reminder. */
export function taskTime(task: VaultTask): string | undefined {
	return task.time ?? (task.reminder && task.reminder.length >= 16 ? task.reminder.slice(11, 16) : undefined);
}

/** Time-of-day label for a task on a specific calendar day: the time carried by
 * the marker that anchored it to that day (scheduled/completion days use their
 * own marker's time; every other day falls back to the shared start time). */
export function taskDayTime(task: VaultTask, iso: string): string | undefined {
	const kind = taskDayKind(task, iso);
	if (kind === 'scheduled') return task.scheduledTime;
	if (kind === 'completion') return task.completionTime;
	return taskTime(task);
}

/** Sort comparator for one day's task list: active tasks before completed ones,
 * then by that day's time-of-day; untimed last. */
export function byDayTaskTime(iso: string): (a: VaultTask, b: VaultTask) => number {
	return (a, b) => {
		const done = Number(a.checked) - Number(b.checked);
		if (done !== 0) return done;
		const ta = taskDayTime(a, iso) ?? '99:99';
		const tb = taskDayTime(b, iso) ?? '99:99';
		return ta < tb ? -1 : ta > tb ? 1 : 0;
	};
}

/** Append the small origin marker (scheduled ⏳ / completed ✅) to a task row
 * when that day's anchor is one of those kinds. Shared by the month grid, week
 * grid, day agenda and hover preview so all four read identically. */
export function appendDayOriginMark(row: HTMLElement, task: VaultTask, iso: string): void {
	const kind = taskDayKind(task, iso);
	if (kind === 'scheduled') {
		const mark = row.createDiv({
			cls: 'dashboard-calendar-mark dashboard-calendar-mark--scheduled',
			attr: { 'aria-label': t('calendar.markerScheduled'), title: t('calendar.markerScheduled') },
		});
		setIcon(mark, 'hourglass');
	} else if (kind === 'completion') {
		const mark = row.createDiv({
			cls: 'dashboard-calendar-mark dashboard-calendar-mark--done',
			attr: { 'aria-label': t('calendar.markerDone'), title: t('calendar.markerDone') },
		});
		setIcon(mark, 'check-circle');
	}
}

function weekdayLabels(): string[] {
	// Monday-first, to match the alltasks week bucketing.
	const raw = t('calendar.weekdays');
	const labels = raw.split(',').map(s => s.trim());
	return labels.length === 7 ? labels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

/** Make a day-number element (month cell number, week day header) open that
 *  day's agenda: clickable + keyboard-activated, with an affordance hint. */
function wireDayTrigger(el: HTMLElement, iso: string, handler: (iso: string) => void): void {
	el.addClass('is-clickable');
	el.setAttribute('role', 'button');
	el.setAttribute('tabindex', '0');
	const label = t('calendar.dayNumAddTask');
	el.setAttribute('aria-label', label);
	el.setAttribute('title', label);
	const open = (): void => handler(iso);
	el.addEventListener('click', (e) => { e.stopPropagation(); open(); });
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
	});
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

/** Max stacked bar lanes per week row in the full-screen month view; a span
 * that would need a fifth lane degrades to a normal row on its first day.
 * The rendered lane height lives in styles.css (--dashboard-bar-lane). */
const MAX_BAR_LANES = 4;

interface BarEntry {
	task: VaultTask;
	/** 0-based column of the bar's first visible day within the week. */
	fromCol: number;
	/** Column span (days) within the week. */
	len: number;
	/** True when the span continues before/after the visible week. */
	contLeft: boolean;
	contRight: boolean;
	/** ISO of the bar's first visible day (click target). */
	firstIso: string;
}

/**
 * Render a Monday-first month grid (6 rows x 7 cols). Each day cell lists the
 * tasks occupying it (from the day-indexed map). Compact mode caps the list and
 * makes tasks non-interactive (cell click opens the day agenda); full mode
 * renders every task with an interactive checkbox — and groups multi-day spans
 * into continuous bars that cross day cells (one bar per task per week instead
 * of a duplicated row in every cell).
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

	const wrap = container.createDiv({ cls: 'dashboard-calendar' + ((opts.compact || opts.dotMode) ? ' is-compact' : ' is-full') });

	// Weekday header
	const head = wrap.createDiv({ cls: 'dashboard-calendar-weekdays' });
	for (const label of weekdayLabels()) {
		head.createDiv({ cls: 'dashboard-calendar-weekday', text: label });
	}

	const useBars = !opts.compact && !opts.dotMode;
	const body = wrap.createDiv({ cls: 'dashboard-calendar-body' + (useBars ? ' dashboard-calendar-body--bars' : '') });

	const renderCell = (dayCell: HTMLElement, d: Date, cellTasks: VaultTask[]): void => {
		const iso = toIsoDate(d);
		const inMonth = d.getMonth() === month;
		const isToday = iso === todayIso;
		dayCell.className = 'dashboard-calendar-cell'
			+ (inMonth ? '' : ' is-outside')
			+ (isToday ? ' is-today' : '')
			+ (cellTasks.length > 0 ? ' has-tasks' : '');

		const numEl = dayCell.createDiv({ cls: 'dashboard-calendar-cell-num', text: String(d.getDate()) });
		// Full-screen mode: the day number opens the day agenda (add tasks /
		// see the day's list). Compact & dot modes keep the whole-cell click.
		if (!opts.compact && !opts.dotMode && opts.onDayNumClick) {
			wireDayTrigger(numEl, iso, opts.onDayNumClick);
		}

		if (opts.dotMode) {
			// Narrow-sidebar mode: just a dot when the day has tasks; days whose
			// only entries are completed tasks get a muted dot.
			if (cellTasks.length > 0) {
				const onlyDone = cellTasks.every(task => task.checked);
				dayCell.createDiv({ cls: 'dashboard-calendar-cell-dot' + (onlyDone ? ' is-done' : '') });
			}
		} else {
			const sorted = cellTasks.slice().sort(byDayTaskTime(iso));
			const list = dayCell.createDiv({ cls: 'dashboard-calendar-cell-list' });
			const shown = opts.compact ? sorted.slice(0, COMPACT_MAX_PER_DAY) : sorted;
			for (const task of shown) {
				list.appendChild(renderDayTask(task, iso, opts));
			}
			if (opts.compact && sorted.length > COMPACT_MAX_PER_DAY) {
				list.createDiv({
					cls: 'dashboard-calendar-more',
					text: t('calendar.moreCount', { count: sorted.length - COMPACT_MAX_PER_DAY }),
				});
			}
		}

		if ((opts.compact || opts.dotMode) && opts.onDayClick) {
			dayCell.addClass('is-clickable');
			dayCell.addEventListener('click', () => opts.onDayClick?.(iso));
		}

		// Dot mode hover preview: only fire for cells that actually have tasks,
		// so empty days stay quiet.
		if (opts.dotMode && cellTasks.length > 0 && opts.onDayHover) {
			dayCell.addEventListener('mouseenter', () => opts.onDayHover?.(iso, dayCell));
			dayCell.addEventListener('mouseleave', () => opts.onDayLeave?.());
			dayCell.addEventListener('focus', () => opts.onDayHover?.(iso, dayCell));
			dayCell.addEventListener('blur', () => opts.onDayLeave?.());
		}
	};

	if (!useBars) {
		// Flat 42-cell grid (compact/dot sidebar and the deprecated section).
		for (let i = 0; i < 42; i++) {
			const d = new Date(gridStart);
			d.setDate(gridStart.getDate() + i);
			renderCell(body.createDiv(), d, byDay.get(toIsoDate(d)) ?? []);
		}
		return { label: monthLabel(year, month) };
	}

	// Full-screen mode: 6 week blocks. Each week is [bar strip][7 day cells] so
	// multi-day spans render as one continuous bar (same 7-column template as
	// the cells) instead of a duplicated row in every cell it covers.
	for (let w = 0; w < 6; w++) {
		const weekDays: { iso: string; date: Date }[] = [];
		for (let i = 0; i < 7; i++) {
			const d = new Date(gridStart);
			d.setDate(gridStart.getDate() + w * 7 + i);
			weekDays.push({ iso: toIsoDate(d), date: d });
		}

		// Collect this week's multi-day spans and strip them from the cell lists.
		const spanEntries = new Map<VaultTask, BarEntry>();
		for (const { iso, date } of weekDays) {
			for (const task of byDay.get(iso) ?? []) {
				if (spanEntries.has(task)) continue;
				const span = calendarSpan(task);
				if (!span || span.start === span.end) continue;
				spanEntries.set(task, clampBarToWeek(task, span, date));
			}
		}
		const packed = packBarLanes([...spanEntries.values()]);
		// Bars that didn't fit under MAX_BAR_LANES degrade to a normal row on
		// their first visible day (all other days lose their duplicate row).
		const degraded = new Map<VaultTask, string>();
		for (const bar of packed) {
			if (bar.lane === -1) degraded.set(bar.task, bar.firstIso);
		}

		const week = body.createDiv({ cls: 'dashboard-calendar-week' });
		const laneCount = Math.max(0, ...packed.map(bar => bar.lane + 1));

		// Bar strip: a real (non-absolute) block sized to the lane count, so the
		// cells below never need padding tricks to clear it.
		const barLayer = week.createDiv({ cls: 'dashboard-calendar-barlayer' });
		barLayer.setCssProps({ '--bar-lanes': String(laneCount) });
		for (const bar of packed) {
			if (bar.lane !== -1) renderBar(barLayer, bar, opts);
		}

		const days = week.createDiv({ cls: 'dashboard-calendar-week-days' });
		for (const { iso, date } of weekDays) {
			const cellTasks = (byDay.get(iso) ?? []).filter(task => {
				const entry = spanEntries.get(task);
				if (!entry) return true;
				return degraded.get(task) === iso;
			});
			renderCell(days.createDiv(), date, cellTasks);
		}
	}

	return { label: monthLabel(year, month) };
}

/** Clamp a task's multi-day span to the visible week (columns + continuation). */
function clampBarToWeek(task: VaultTask, span: { start: string; end: string }, anyVisibleDay: Date): BarEntry {
	// anyVisibleDay is one of the week's days; recompute Monday from it.
	const monday = new Date(anyVisibleDay);
	const offset = anyVisibleDay.getDay() === 0 ? -6 : 1 - anyVisibleDay.getDay();
	monday.setDate(anyVisibleDay.getDate() + offset);
	const weekStartIso = toIsoDate(monday);
	const weekEndIso = toIsoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
	const fromIso = span.start < weekStartIso ? weekStartIso : span.start;
	const endIso = span.end > weekEndIso ? weekEndIso : span.end;
	const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
	const fromCol = dayDiff(weekStartIso, fromIso);
	const len = dayDiff(fromIso, endIso) + 1;
	return {
		task,
		fromCol: Math.max(0, Math.min(6, fromCol)),
		len: Math.max(1, Math.min(7, len)),
		contLeft: span.start < weekStartIso,
		contRight: span.end > weekEndIso,
		firstIso: fromIso,
	};
}

/** Greedy lane packing: earliest-starting (then longest) bars first; each bar
 * takes the first lane whose last bar ends before it starts. Bars beyond
 * MAX_BAR_LANES get lane = -1 (degrade to a normal row on the first day). */
function packBarLanes(bars: BarEntry[]): Array<BarEntry & { lane: number }> {
	const sorted = bars.slice().sort((a, b) => (a.fromCol - b.fromCol) || (b.len - a.len));
	const laneEnds: number[] = [];
	const out: Array<BarEntry & { lane: number }> = [];
	for (const bar of sorted) {
		let lane = laneEnds.findIndex(end => end < bar.fromCol);
		if (lane === -1 && laneEnds.length < MAX_BAR_LANES) {
			lane = laneEnds.length;
		}
		if (lane === -1 || lane >= MAX_BAR_LANES) {
			out.push({ ...bar, lane: -1 });
			continue;
		}
		laneEnds[lane] = bar.fromCol + bar.len - 1;
		out.push({ ...bar, lane });
	}
	return out;
}

/** Render one continuous multi-day bar into the week's bar strip. */
function renderBar(layer: HTMLElement, bar: BarEntry & { lane: number }, opts: MonthGridOptions): void {
	const { task } = bar;
	const el = layer.createDiv({
		cls: 'dashboard-calendar-bar'
			+ (task.checked ? ' is-done' : '')
			+ (task.priority ? ` prio-${task.priority}` : '')
			+ (bar.contLeft ? ' is-cont-left' : '')
			+ (bar.contRight ? ' is-cont-right' : ''),
		attr: { role: 'button', tabindex: '0' },
	});
	el.setCssProps({
		'--bar-cs': String(bar.fromCol + 1),
		'--bar-len': String(bar.len),
		'--bar-row': String(bar.lane + 1),
	});

	const rangeLabel = `${monthDayLabel(parseIso(task.start ?? bar.firstIso))}–${monthDayLabel(parseIso(task.end ?? bar.firstIso))}`;
	let aria = t('calendar.barLabel', { task: task.text, range: rangeLabel });
	if (bar.contLeft) aria += ` · ${t('calendar.barContLeft')}`;
	if (bar.contRight) aria += ` · ${t('calendar.barContRight')}`;
	el.setAttribute('aria-label', aria);
	el.setAttribute('title', task.text);

	const tm = taskDayTime(task, bar.firstIso);
	if (tm) el.createDiv({ cls: 'dashboard-calendar-bar-time', text: tm });
	const text = el.createDiv({ cls: 'dashboard-calendar-bar-text' });
	renderTextWithLinks(text, task.text, opts.app);

	if (opts.onBarClick) {
		const open = (): void => opts.onBarClick?.(bar.firstIso);
		el.addEventListener('click', (e) => { e.stopPropagation(); open(); });
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
		});
	}
}

/** Local Date from an ISO day string. */
function parseIso(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Compact day label for bar aria-labels: zh "8月24日", else "Aug 24". */
function monthDayLabel(d: Date): string {
	return getLanguage() === 'zh'
		? `${monthAbbr(d.getMonth())}${d.getDate()}日`
		: `${monthAbbr(d.getMonth())} ${d.getDate()}`;
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
		const dayTasks = (byDay.get(iso) ?? []).slice().sort(byDayTaskTime(iso));

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
			list.appendChild(renderDayTask(task, iso, weekOpts));
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

		// Hover preview: anchored on the day header. Useful in the week view
		// because tasks are capped at WEEK_COMPACT_MAX and long titles truncate,
		// so the preview surfaces the hidden/rest of the day's tasks. Only wired
		// when the header is already interactive (compact + onDayClick).
		if (opts.compact && dayTasks.length > 0 && opts.onDayHover) {
			head.addEventListener('mouseenter', () => opts.onDayHover?.(iso, head));
			head.addEventListener('mouseleave', () => opts.onDayLeave?.());
			head.addEventListener('focus', () => opts.onDayHover?.(iso, head));
			head.addEventListener('blur', () => opts.onDayLeave?.());
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
		// The day header opens that day's agenda (same as month day numbers).
		if (opts.onDayNumClick) wireDayTrigger(h, iso, opts.onDayNumClick);
	}

	// All-day strip: untimed tasks of each day as chips (click jumps to source).
	// Sorted with done last so completion-day entries don't crowd out active ones.
	const allDay = wrap.createDiv({ cls: 'dashboard-calgrid-allday' });
	allDay.createDiv({ cls: 'dashboard-calgrid-allday-corner', text: t('calendar.allDay') });
	for (const { iso } of days) {
		const cell = allDay.createDiv({ cls: 'dashboard-calgrid-allday-cell' });
		const allDayTasks = (byDay.get(iso) ?? [])
			.filter(task => !taskDayTime(task, iso))
			.sort(byDayTaskTime(iso));
		for (const task of allDayTasks.slice(0, 3)) {
			const chip = cell.createDiv({ cls: 'dashboard-calgrid-allday-chip' + (task.checked ? ' is-done' : ''), text: task.text });
			if (opts.onOpenNote) {
				chip.addClass('is-jumpable');
				chip.addEventListener('click', () => opts.onOpenNote?.(task.file, task.line));
			}
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
			const tm = taskDayTime(task, iso);
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
				ev.addClass('is-jumpable');
				ev.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('input, a')) return;
					opts.onOpenNote?.(task.file, task.line);
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

/** Render one task inside a calendar day cell. `iso` is the day the task is
 * being rendered on — it picks the day's time label and origin marker (a task
 * can occupy several days for different reasons). */
function renderDayTask(task: VaultTask, iso: string, opts: MonthGridOptions): HTMLElement {
	const row = createDiv();
	const kind = taskDayKind(task, iso);
	const multi = Boolean(task.start && task.end) && kind === 'span';
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
		const tm = taskDayTime(task, iso);
		if (tm) row.createDiv({ cls: 'dashboard-calendar-event-time', text: tm });
	}

	const text = row.createDiv({ cls: 'dashboard-calendar-event-text' });
	const overDue = !task.checked && dateBucketOf(task.due) === 'overdue';
	renderTextWithLinks(text, task.text, opts.app);
	appendDayOriginMark(row, task, iso);

	if (opts.compact) {
		// nothing else; the cell-level click handler opens the day agenda
	} else if (opts.onOpenNote) {
		row.addClass('is-jumpable');
		row.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			// Leave checkboxes (their own handler) and inline links alone.
			if (target.tagName === 'INPUT' || target.closest('a')) return;
			e.stopPropagation();
			opts.onOpenNote?.(task.file, task.line);
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
