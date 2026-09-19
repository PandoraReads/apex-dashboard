/**
 * Pure period-window math for the expense stats overlay (jiti-testable: no
 * Obsidian or i18n imports). Week windows are Monday-anchored, months and
 * years are calendar periods — the same convention the pomodoro stats view
 * uses. `today` is passed in as a 'YYYY-MM-DD' string so every branch stays
 * deterministic and directly testable.
 */

export type PeriodKind = 'week' | 'month' | 'year';

export interface RangeWindow {
	curStart: string;
	curEnd: string;
	prevStart: string;
	prevEnd: string;
	/** Days elapsed in the current period (clamped to today; full span for
	 *  past periods) — the daily-average denominator. */
	elapsedDays: number;
	/** Calendar year the window starts in (history label / monthly series). */
	year: number;
}

export function fmtDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

/** Parse a 'YYYY-MM-DD' string into a local-midnight Date. */
export function parseLocalDate(s: string): Date {
	return new Date(s + 'T00:00:00');
}

/** Inclusive day count between two 'YYYY-MM-DD' strings. */
export function daysInclusive(start: string, end: string): number {
	const a = parseLocalDate(start);
	const b = parseLocalDate(end);
	return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function mondayOf(d: Date): Date {
	const daysSinceMonday = (d.getDay() + 6) % 7;
	return addDays(d, -daysSinceMonday);
}

/**
 * The natural period of `kind` containing `anchor`, plus the previous period
 * of the same length for period-over-period comparisons. elapsedDays is full
 * span for past periods and today's day-index when the period contains today.
 */
export function windowFor(kind: PeriodKind, anchor: string, today: string): RangeWindow {
	const anchorDate = parseLocalDate(anchor);
	switch (kind) {
		case 'week': {
			const monday = mondayOf(anchorDate);
			return finishWindow(monday, addDays(monday, 6), addDays(monday, -7), addDays(monday, -1), today);
		}
		case 'month': {
			const y = anchorDate.getFullYear();
			const m = anchorDate.getMonth();
			const first = new Date(y, m, 1);
			return finishWindow(first, new Date(y, m + 1, 0), new Date(y, m - 1, 1), new Date(y, m, 0), today);
		}
		case 'year': {
			const y = anchorDate.getFullYear();
			const first = new Date(y, 0, 1);
			return finishWindow(first, new Date(y, 11, 31), new Date(y - 1, 0, 1), new Date(y - 1, 11, 31), today);
		}
	}
}

function finishWindow(
	curStartDate: Date,
	curEndDate: Date,
	prevStartDate: Date,
	prevEndDate: Date,
	today: string,
): RangeWindow {
	const curStart = fmtDate(curStartDate);
	const curEnd = fmtDate(curEndDate);
	// Past periods span their full length; a period containing today counts
	// up to today. The max(1) keeps future-side anchors from going negative.
	const elapsedDays = Math.max(1, daysInclusive(curStart, curEnd < today ? curEnd : today));
	return {
		curStart,
		curEnd,
		prevStart: fmtDate(prevStartDate),
		prevEnd: fmtDate(prevEndDate),
		elapsedDays,
		year: curStartDate.getFullYear(),
	};
}

/**
 * Anchor of the period `delta` steps away from `anchor`'s period. Month and
 * year anchors normalize to the first day of the target period — shifting
 * from 03-31 must land on 02-01, not the Date-overflow 03-02.
 */
export function periodShift(kind: PeriodKind, anchor: string, delta: 1 | -1): string {
	const anchorDate = parseLocalDate(anchor);
	switch (kind) {
		case 'week':
			return fmtDate(addDays(mondayOf(anchorDate), 7 * delta));
		case 'month':
			return fmtDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + delta, 1));
		case 'year':
			return fmtDate(new Date(anchorDate.getFullYear() + delta, 0, 1));
	}
}

/** Human label for the history navigator: full start~end dates for a week,
 *  'YYYY-MM' for a month, the bare year otherwise. */
export function periodLabel(kind: PeriodKind, win: RangeWindow): string {
	switch (kind) {
		case 'week':
			return `${win.curStart} ~ ${win.curEnd}`;
		case 'month':
			return win.curStart.slice(0, 7);
		case 'year':
			return String(win.year);
	}
}
