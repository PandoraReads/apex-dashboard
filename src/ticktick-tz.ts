/**
 * Timezone helpers for the TickTick section.
 *
 * TickTick dates are absolute instants ("yyyy-MM-dd'T'HH:mm:ssZ"). To present
 * them as the user expects we render their wall-clock components (Y/M/D H:M)
 * in a configurable IANA timezone instead of the runtime's local timezone,
 * which may differ from the user's TickTick account timezone.
 *
 * Uses Intl.DateTimeFormat (no extra dependency). Formatters are cached.
 */

export const DEFAULT_TICKTICK_TZ = 'Asia/Shanghai';

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
	let fmt = fmtCache.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
		fmtCache.set(tz, fmt);
	}
	return fmt;
}

/** True when `tz` is a valid IANA timezone Intl can resolve. */
export function isValidTz(tz: string): boolean {
	try {
		partsFormatter(tz);
		return true;
	} catch {
		return false;
	}
}

export interface TzParts {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
	hour: number; // 0-23
	minute: number; // 0-59
	second: number; // 0-59
}

/** Wall-clock components of an instant in the given timezone. */
export function tzParts(d: Date, tz: string): TzParts {
	const parts = partsFormatter(tz).formatToParts(d);
	const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '0';
	// hour '2-digit' with hour12:false can emit "24" at midnight in some engines; normalize.
	return {
		year: Number(get('year')),
		month: Number(get('month')),
		day: Number(get('day')),
		hour: Number(get('hour')) % 24,
		minute: Number(get('minute')),
		second: Number(get('second')),
	};
}

/** Stable day integer (YYYYMMDD) of an instant in the given timezone. */
export function tzDayNum(d: Date, tz: string): number {
	const { year, month, day } = tzParts(d, tz);
	return year * 10000 + month * 100 + day;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYYMMDD stamp (e.g. "20260703") of an instant in the given timezone. */
export function tzStamp(d: Date, tz: string): string {
	const { year, month, day } = tzParts(d, tz);
	return `${year}${pad(month)}${pad(day)}`;
}

/** yyyy-MM-dd'T'HH:mm:ss+HHMM with wall-clock in the given timezone. */
export function toTzTickDate(d: Date, tz: string): string {
	const p = tzParts(d, tz);
	// Beijing-style fixed offset derived from the rendered wall-clock, so the
	// string round-trips to the same instant regardless of runtime locale.
	const utcInstant = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	const offsetMin = Math.round((utcInstant - d.getTime()) / 60000);
	const sign = offsetMin >= 0 ? '+' : '-';
	const abs = Math.abs(offsetMin);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** Offset (minutes east of UTC) of the given timezone at the given instant. */
export function tzOffsetMin(d: Date, tz: string): number {
	const p = tzParts(d, tz);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((asUtc - d.getTime()) / 60000);
}

/**
 * Build a TickTick date string (yyyy-MM-dd'T'HH:mm:ss+HHMM) from a wall-clock
 * date+time the user typed, interpreted in the given timezone. Handles DST by
 * probing the offset twice.
 */
export function fromTzInputs(dateStr: string, timeStr: string, tz: string): string {
	const dateParts = dateStr.split('-');
	const timeParts = (timeStr || '09:00').split(':');
	const y = Number(dateParts[0] ?? 0);
	const m = Number(dateParts[1] ?? 1);
	const d = Number(dateParts[2] ?? 1);
	const h = Number(timeParts[0] ?? 0);
	const mi = Number(timeParts[1] ?? 0);
	// Probe: treat the typed wall-clock as UTC, read what offset the tz reports,
	// then shift so the typed values become the tz's wall-clock.
	const probe = Date.UTC(y, m - 1, d, h, mi);
	const firstOff = tzOffsetMin(new Date(probe), tz);
	const instant = probe - firstOff * 60000;
	const off = tzOffsetMin(new Date(instant), tz);
	const sign = off >= 0 ? '+' : '-';
	const abs = Math.abs(off);
	return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
