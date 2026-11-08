import type { DqlValue } from './types';
import { evalError, type Result } from './types';
import {
	asList, coerceNumber, coerceString, dqlCompare, dqlEquals, formatValue, kindOf,
	makeDate, makeDuration, makeLink, makeObject, truthy,
} from './values';

/** A built-in DQL function. Args are already-evaluated values; arity is
 *  validated by the evaluator before apply() is called. Functions return a
 *  Result so failures degrade gracefully (a bad arg yields null, not a throw).
 *  `fail` here means "this function returned an error value" — the evaluator
 *  treats it as null for the calling expression. */
export interface DqlFunction {
	readonly name: string;
	readonly minArgs: number;
	readonly maxArgs: number;
	apply(args: readonly DqlValue[]): Result<DqlValue>;
}

/** Convenience wrapper for functions with a fixed arity and pure value logic. */
function fn(name: string, arity: number, apply: (args: readonly DqlValue[]) => DqlValue): DqlFunction {
	return { name, minArgs: arity, maxArgs: arity, apply: (a) => ({ ok: true, value: apply(a) }) };
}

function variadic(name: string, minArgs: number, apply: (args: readonly DqlValue[]) => DqlValue): DqlFunction {
	return { name, minArgs, maxArgs: Number.POSITIVE_INFINITY, apply: (a) => ({ ok: true, value: apply(a) }) };
}

/* ----------------------------- constructors ----------------------------- */

const dateFn: DqlFunction = {
	name: 'date',
	minArgs: 1,
	maxArgs: 1,
	apply(args): Result<DqlValue> {
		const arg = args[0] ?? null;
		const resolved = resolveDateToken(arg);
		if (resolved !== undefined) return { ok: true, value: resolved };
		if (arg === null) return { ok: true, value: null };
		const s = coerceString(arg);
		const ts = parseDate(s);
		if (ts === null) return evalError<DqlValue>(`date(): cannot parse "${s}" as a date.`);
		return { ok: true, value: makeDate(ts) };
	},
};

/** Resolve the pseudo-tokens `today`/`now`/`tomorrow`/`yesterday` that
 *  `date(today)` etc. produce. Returns undefined if `arg` isn't one. */
function resolveDateToken(arg: DqlValue): DqlValue | undefined {
	if (typeof arg !== 'string') return undefined;
	const now = new Date();
	const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const iso = (d: Date): number => d.getTime();
	switch (arg.toLowerCase()) {
		case 'today': return makeDate(midnight(now));
		case 'now': return makeDate(iso(now));
		case 'tomorrow': { const t = new Date(now); t.setDate(t.getDate() + 1); return makeDate(midnight(t)); }
		case 'yesterday': { const t = new Date(now); t.setDate(t.getDate() - 1); return makeDate(midnight(t)); }
		default: return undefined;
	}
}

/** Parse common date formats: ISO `YYYY-MM-DD[THH:MM[:SS]]`, `YYYY/MM/DD`,
 *  and bare `YYYY-MM-DD HH:MM`. Returns epoch ms or null. */
export function parseDate(input: string): number | null {
	const s = input.trim();
	if (!s) return null;
	// ISO 8601 (with optional time + timezone).
	const iso = Date.parse(s);
	if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(s)) return iso;
	// YYYY/MM/DD
	const slashed = s.replace(/\//g, '-');
	if (slashed !== s) {
		const t = Date.parse(slashed);
		if (!Number.isNaN(t)) return t;
	}
	return null;
}

const numberFn = fn('number', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : n;
});

const stringFn = fn('string', 1, (a) => coerceString(a[0]!));

const linkFn: DqlFunction = {
	name: 'link',
	minArgs: 1,
	maxArgs: 2,
	apply(args) {
		const a = args[0]!;
		const path = kindOf(a) === 'link' ? (a as { path: string }).path : coerceString(a);
		return { ok: true, value: makeLink(path, args[1] !== undefined ? coerceString(args[1]) : undefined) };
	},
};

const elinkFn: DqlFunction = {
	name: 'elink',
	minArgs: 1,
	maxArgs: 2,
	apply(args) {
		return { ok: true, value: { kind: 'link', path: coerceString(args[0]!), display: args[1] !== undefined ? coerceString(args[1]) : undefined } };
	},
};

const typeofFn = fn('typeof', 1, (a) => {
	const k = kindOf(a[0]!);
	return k === 'list' ? 'array' : k;
});

/** datepath(path, format): parse the date embedded in a filename/path
 *  according to a token format ("yyyy", "MM", "dd" recognized; everything
 *  else must match literally). Returns null when no date fits. */
const datepathFn: DqlFunction = {
	name: 'datepath',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const path = coerceString(args[0]!);
		const fmt = coerceString(args[1]!);
		const pattern = fmt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			.replace('yyyy', '(\\d{4})')
			.replace('yy', '(\\d{2})')
			.replace('MM', '(\\d{1,2})')
			.replace('dd', '(\\d{1,2})');
		const m = new RegExp(pattern).exec(path);
		if (!m) return { ok: true, value: null };
		const year = m[1]!.length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
		const ts = parseDate(`${year}-${m[2]}-${m[3]}`);
		return { ok: true, value: ts === null ? null : makeDate(ts) };
	},
};

const striptimeFn: DqlFunction = {
	name: 'striptime',
	minArgs: 1,
	maxArgs: 1,
	apply(args) {
		const v = args[0]!;
		if (kindOf(v) !== 'date') return { ok: true, value: null };
		const d = new Date((v as { ts: number }).ts);
		return { ok: true, value: makeDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) };
	},
};

/** localtime(): our date values are already local-wall-time, so this is a
 *  documented passthrough (kept for query compatibility with Dataview). */
const localtimeFn: DqlFunction = {
	name: 'localtime',
	minArgs: 1,
	maxArgs: 1,
	apply(args) {
		return { ok: true, value: args[0] ?? null };
	},
};

const defaultFn = variadic('default', 2, (a) => {
	for (const v of a) if (v !== null && v !== undefined) return v;
	return null;
});

/* ----------------------------- numeric ----------------------------- */

const roundFn = fn('round', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : Math.round(n);
});
const floorFn = fn('floor', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : Math.floor(n);
});
const ceilFn = fn('ceil', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : Math.ceil(n);
});
const truncFn = fn('trunc', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : Math.trunc(n);
});
/* Dataview's numeric aggregators are LIST-based: sum(rows.rating) aggregates
 *  the list's elements. We also keep the variadic form (sum(1, 2, 3)) for
 *  convenience — single-array argument switches to element aggregation. */
function aggregateArgs(args: readonly DqlValue[]): readonly DqlValue[] {
	if (args.length === 1 && Array.isArray(args[0])) return args[0];
	return args;
}

const minFn = variadic('min', 1, (a) => {
	let best: number | null = null;
	for (const v of aggregateArgs(a)) { const n = coerceNumber(v); if (n !== null && (best === null || n < best)) best = n; }
	return best;
});
const maxFn = variadic('max', 1, (a) => {
	let best: number | null = null;
	for (const v of aggregateArgs(a)) { const n = coerceNumber(v); if (n !== null && (best === null || n > best)) best = n; }
	return best;
});
const sumFn = variadic('sum', 1, (a) => {
	let total = 0;
	for (const v of aggregateArgs(a)) { const n = coerceNumber(v); if (n !== null) total += n; }
	return total;
});
const averageFn = variadic('average', 1, (a) => {
	let total = 0; let count = 0;
	for (const v of aggregateArgs(a)) { const n = coerceNumber(v); if (n !== null) { total += n; count++; } }
	return count === 0 ? null : total / count;
});

const absFn = fn('abs', 1, (a) => {
	const n = coerceNumber(a[0]!);
	return n === null ? null : Math.abs(n);
});

/* ----------------------------- duration ----------------------------- */

/** dur("7 days") / dur("3 hours") → DqlDuration in ms. Supports combinations
 *  like "1 day 2 hours". */
const durFn: DqlFunction = {
	name: 'dur',
	minArgs: 1,
	maxArgs: 1,
	apply(args) {
		const raw = coerceString(args[0]!);
		const ms = parseDuration(raw);
		if (ms === null) return evalError<DqlValue>(`dur(): cannot parse "${raw}".`);
		return { ok: true, value: makeDuration(ms) };
	},
};

const DURATION_UNITS: Readonly<Record<string, number>> = {
	ms: 1, millisecond: 1, milliseconds: 1,
	s: 1000, sec: 1000, second: 1000, seconds: 1000,
	m: 60_000, min: 60_000, minute: 60_000, minutes: 60_000,
	h: 3_600_000, hr: 3_600_000, hour: 3_600_000, hours: 3_600_000,
	d: 86_400_000, day: 86_400_000, days: 86_400_000,
	w: 604_800_000, wk: 604_800_000, week: 604_800_000, weeks: 604_800_000,
	mo: 2_592_000_000, month: 2_592_000_000, months: 2_592_000_000,
	y: 31_536_000_000, yr: 31_536_000_000, year: 31_536_000_000, years: 31_536_000_000,
};

export function parseDuration(input: string): number | null {
	const s = input.trim();
	if (!s) return null;
	const re = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g;
	let total = 0;
	let matched = false;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null) {
		matched = true;
		const unit = m[2]!.toLowerCase();
		const factor = DURATION_UNITS[unit];
		if (factor === undefined) return null;
		total += Number(m[1]) * factor;
	}
	return matched ? total : null;
}

/** durationformat(dur, "d'd' h'h' m'm'"): luxon-style duration tokens.
 *  Single letters are the unit initial (y M w d h m s); runs of the same
 *  letter zero-pad (SSS = milliseconds). Anything else passes through. */
const durationformatFn: DqlFunction = {
	name: 'durationformat',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const ms = coerceNumber(args[0]!);
		const fmt = coerceString(args[1]!);
		if (ms === null || kindOf(args[0]!) === 'date') return { ok: true, value: '' };
		return { ok: true, value: formatDurationTokens(ms, fmt) };
	},
};

function formatDurationTokens(ms: number, fmt: string): string {
	// Luxon quoting: 'xx' runs pass through verbatim (so "d'd'" keeps the
	// quoted d literal while the bare d is the day token); tokens only
	// substitute in unquoted segments.
	return replaceTokens(fmt, tok => durationToken(tok, ms), /([yMwdhmsS])\1*/g);
}

function durationToken(tok: string, ms: number): string {
	const rest = Math.abs(ms);
	const t = tok[0]!;
	let n: number;
	switch (t) {
		case 'y': n = Math.floor(rest / 31_536_000_000); break;
		case 'M': n = Math.floor((rest % 31_536_000_000) / 2_592_000_000); break;
		case 'w': n = Math.floor((rest % 2_592_000_000) / 604_800_000); break;
		case 'd': n = Math.floor((rest % 604_800_000) / 86_400_000); break;
		case 'h': n = Math.floor((rest % 86_400_000) / 3_600_000); break;
		case 'm': n = Math.floor((rest % 3_600_000) / 60_000); break;
		case 's': n = Math.floor((rest % 60_000) / 1000); break;
		default: n = rest % 1000;
	}
	const s = String(n);
	return tok.length > 1 ? s.padStart(tok.length, '0') : s;
}

/** Split on 'quoted' runs; substitute via `mapper` only in unquoted segments. */
function replaceTokens(fmt: string, mapper: (token: string) => string, tokenPattern: RegExp): string {
	const parts = fmt.split(/('(?:[^']|'')*')/);
	return parts
		.map((part, i) => (i % 2 === 1 ? part.replace(/''/g, "'") : part.replace(tokenPattern, mapper)))
		.join('');
}

/* ----------------------------- string ----------------------------- */

const containsFn: DqlFunction = {
	name: 'contains',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const [haystack, needle] = args as [DqlValue, DqlValue];
		if (haystack === null) return { ok: true, value: false };
		if (Array.isArray(haystack)) return { ok: true, value: haystack.some(x => dqlEquals(x, needle)) };
		if (kindOf(haystack) === 'object') {
			const entries = (haystack as { entries: Record<string, DqlValue> }).entries;
			const key = coerceString(needle);
			return { ok: true, value: key in entries };
		}
		return { ok: true, value: coerceString(haystack).includes(coerceString(needle)) };
	},
};

const icontainsFn = fn('icontains', 2, (a) =>
	coerceString(a[0]!).toLowerCase().includes(coerceString(a[1]!).toLowerCase()));

const startswithFn = fn('startswith', 2, (a) => coerceString(a[0]!).startsWith(coerceString(a[1]!)));
const endswithFn = fn('endswith', 2, (a) => coerceString(a[0]!).endsWith(coerceString(a[1]!)));
const lowerFn = fn('lower', 1, (a) => coerceString(a[0]!).toLowerCase());
const upperFn = fn('upper', 1, (a) => coerceString(a[0]!).toUpperCase());
const lengthFn = fn('length', 1, (a) => {
	const v = a[0]!;
	if (v === null) return 0;
	if (typeof v === 'string') return v.length;
	if (Array.isArray(v)) return v.length;
	if (kindOf(v) === 'object') return Object.keys((v as { entries: Record<string, DqlValue> }).entries).length;
	return 0;
});

const replaceFn = fn('replace', 3, (a) => {
	const s = coerceString(a[0]!);
	const from = coerceString(a[1]!);
	const to = coerceString(a[2]!);
	return s.split(from).join(to);
});

const regexmatchFn: DqlFunction = {
	name: 'regexmatch',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const pattern = coerceString(args[0]!);
		const text = args[1] ?? null;
		if (text === null) return { ok: true, value: false };
		const target = kindOf(text) === 'link' ? (text as { path: string }).path : coerceString(text);
		try {
			return { ok: true, value: new RegExp(pattern).test(target) };
		} catch {
			return evalError<DqlValue>(`regexmatch(): invalid pattern "${pattern}".`);
		}
	},
};

const splitFn = fn('split', 2, (a) => coerceString(a[0]!).split(coerceString(a[1]!)));

/** Dataview-compatible truncation: cut at `length`, append "...". */
const truncateFn = fn('truncate', 2, (a) => {
	const s = coerceString(a[0]!);
	const n = Math.max(0, Math.trunc(coerceNumber(a[1]!) ?? 0));
	return s.length > n ? s.slice(0, n) + '...' : s;
});

const ljustFn = fn('ljust', 2, (a) => {
	const s = coerceString(a[0]!);
	const n = Math.max(0, Math.trunc(coerceNumber(a[1]!) ?? 0));
	return s.length >= n ? s : s + ' '.repeat(n - s.length);
});

const rjustFn = fn('rjust', 2, (a) => {
	const s = coerceString(a[0]!);
	const n = Math.max(0, Math.trunc(coerceNumber(a[1]!) ?? 0));
	return s.length >= n ? s : ' '.repeat(n - s.length) + s;
});

const substringFn: DqlFunction = {
	name: 'substring',
	minArgs: 2,
	maxArgs: 3,
	apply(args) {
		const s = coerceString(args[0]!);
		const start = Math.trunc(coerceNumber(args[1]!) ?? 0);
		const end = args[2] !== undefined && args[2] !== null ? Math.trunc(coerceNumber(args[2]!) ?? s.length) : s.length;
		return { ok: true, value: s.slice(start, end) };
	},
};

/** regexreplace(pattern, replacement, text) — dataview arg order. */
const regexreplaceFn: DqlFunction = {
	name: 'regexreplace',
	minArgs: 3,
	maxArgs: 3,
	apply(args) {
		const pattern = coerceString(args[0]!);
		const replacement = coerceString(args[1]!);
		const text = coerceString(args[2]!);
		try {
			return { ok: true, value: text.replace(new RegExp(pattern, 'g'), replacement) };
		} catch {
			return evalError<DqlValue>(`regexreplace(): invalid pattern "${pattern}".`);
		}
	},
};

/** econtains: exact membership for lists (dataview distinguishes it from the
 *  substring-flavored `contains` for strings; ours already uses exact equality
 *  on lists, so this is the list-exact form, non-list = plain equality). */
const econtainsFn: DqlFunction = {
	name: 'econtains',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const [haystack, needle] = args as [DqlValue, DqlValue];
		if (Array.isArray(haystack)) return { ok: true, value: haystack.some(x => dqlEquals(x, needle)) };
		return { ok: true, value: dqlEquals(haystack, needle) };
	},
};

const extractFn: DqlFunction = {
	name: 'extract',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const pattern = coerceString(args[0]!);
		const text = coerceString(args[1]!);
		try {
			const match = new RegExp(pattern).exec(text);
			if (!match) return { ok: true, value: null };
			// Return named groups as object if present, else the capture groups.
			if (match.groups) {
				const entries: Record<string, DqlValue> = {};
				for (const [k, v] of Object.entries(match.groups)) entries[k] = v ?? null;
				return { ok: true, value: makeObject(entries) };
			}
			return { ok: true, value: match.slice(1) };
		} catch {
			return evalError<DqlValue>(`extract(): invalid pattern "${pattern}".`);
		}
	},
};

/* ----------------------------- date/time accessors ----------------------------- */

function datePart(arg: DqlValue | undefined, getter: (d: Date) => number): number | null {
	if (arg === undefined || arg === null) return null;
	if (kindOf(arg) !== 'date') return null;
	return getter(new Date((arg as { ts: number }).ts));
}

const yearFn = fn('year', 1, (a) => datePart(a[0], d => d.getFullYear()));
const monthFn = fn('month', 1, (a) => datePart(a[0], d => d.getMonth() + 1));
const dayFn = fn('day', 1, (a) => datePart(a[0], d => d.getDate()));
const hourFn = fn('hour', 1, (a) => datePart(a[0], d => d.getHours()));
const minuteFn = fn('minute', 1, (a) => datePart(a[0], d => d.getMinutes()));
const secondFn = fn('second', 1, (a) => datePart(a[0], d => d.getSeconds()));
const weeknumberFn = fn('weeknumber', 1, (a) => {
	const arg = a[0] ?? null;
	if (arg === null || kindOf(arg) !== 'date') return null;
	return isoWeekNumber(new Date((arg as { ts: number }).ts));
});

/** ISO 8601 week number (Monday start), shared by weeknumber() and the
 *  `w` dateformat token. */
function isoWeekNumber(d: Date): number {
	const target = new Date(d.valueOf());
	target.setHours(0, 0, 0, 0);
	target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
	const week1 = new Date(target.getFullYear(), 0, 4);
	return 1 + Math.round(((target.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/** luxon-style weekday number: 1 = Monday … 7 = Sunday. */
const weekdayFn: DqlFunction = {
	name: 'weekday',
	minArgs: 1,
	maxArgs: 1,
	apply(args) {
		const v = args[0] ?? null;
		if (v === null || kindOf(v) !== 'date') return { ok: true, value: null };
		return { ok: true, value: (new Date((v as { ts: number }).ts).getDay() + 6) % 7 + 1 };
	},
};

const dateformatFn: DqlFunction = {
	name: 'dateformat',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		const date = args[0]!;
		const fmt = coerceString(args[1]!);
		if (date === null || kindOf(date) !== 'date') return { ok: true, value: '' };
		return { ok: true, value: applyDateFormat(new Date((date as { ts: number }).ts), fmt) };
	},
};

/** dateformat token scan — the common luxon tokens. Longest-token-first
 *  alternation in the regex keeps `MMMM` from matching as `MM`+`MM`. English
 *  month/weekday names (the engine is locale-neutral; Dataview localizes via
 *  luxon, we stay deterministic). */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_S = MONTH_NAMES.map(m => m.slice(0, 3));
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_NAMES_S = WEEKDAY_NAMES.map(w => w.slice(0, 3));

function applyDateFormat(d: Date, fmt: string): string {
	const PAD = (n: number, w = 2) => String(n).padStart(w, '0');
	return replaceTokens(fmt, tok => {
		switch (tok) {
			case 'yyyy': return String(d.getFullYear());
			case 'yy': return String(d.getFullYear()).slice(-2);
			case 'MMMM': return MONTH_NAMES[d.getMonth()]!;
			case 'MMM': return MONTH_NAMES_S[d.getMonth()]!;
			case 'MM': return PAD(d.getMonth() + 1);
			case 'M': return String(d.getMonth() + 1);
			case 'dd': return PAD(d.getDate());
			case 'd': return String(d.getDate());
			case 'HH': return PAD(d.getHours());
			case 'H': return String(d.getHours());
			case 'mm': return PAD(d.getMinutes());
			case 'm': return String(d.getMinutes());
			case 'ss': return PAD(d.getSeconds());
			case 's': return String(d.getSeconds());
			case 'EEEE': return WEEKDAY_NAMES[(d.getDay() + 6) % 7]!;
			case 'EEE': return WEEKDAY_NAMES_S[(d.getDay() + 6) % 7]!;
			case 'EE': case 'E': return String((d.getDay() + 6) % 7 + 1);
			case 'a': return d.getHours() < 12 ? 'AM' : 'PM';
			case 'w': return String(isoWeekNumber(d));
			default: return tok;
		}
	}, /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|mm|m|ss|s|EEEE|EEE|EE|E|a|w/g);
}

/* ----------------------------- list / object ----------------------------- */

const nonnullFn = variadic('nonnull', 1, (a) => {
	const list = asList(a[0]!);
	return list.filter(x => x !== null);
});

const allFn: DqlFunction = {
	name: 'all',
	minArgs: 1,
	maxArgs: Number.POSITIVE_INFINITY,
	apply(args) {
		// all(list) → every truthy; all(a, b, ...) → all truthy.
		if (args.length === 1 && Array.isArray(args[0])) {
			return { ok: true, value: (args[0]).every(truthy) };
		}
		return { ok: true, value: args.every(truthy) };
	},
};
const anyFn: DqlFunction = {
	name: 'any',
	minArgs: 1,
	maxArgs: Number.POSITIVE_INFINITY,
	apply(args) {
		if (args.length === 1 && Array.isArray(args[0])) {
			return { ok: true, value: (args[0]).some(truthy) };
		}
		return { ok: true, value: args.some(truthy) };
	},
};
const noneFn: DqlFunction = {
	name: 'none',
	minArgs: 1,
	maxArgs: Number.POSITIVE_INFINITY,
	apply(args) {
		const list = args.length === 1 && Array.isArray(args[0]) ? (args[0]) : args;
		return { ok: true, value: !list.some(truthy) };
	},
};

const joinFn: DqlFunction = {
	name: 'join',
	minArgs: 1,
	maxArgs: 2,
	apply(args) {
		const list = asList(args[0]!);
		const sep = args[1] !== undefined ? coerceString(args[1]) : ', ';
		return { ok: true, value: list.map(formatValue).filter(s => s !== '').join(sep) };
	},
};

const filterFn: DqlFunction = {
	name: 'filter',
	minArgs: 2,
	maxArgs: 2,
	apply(args) {
		// filter(list, predicate) — predicate is a DqlValue; we only support a
		// limited form where the 2nd arg is a value to test equality against, OR
		// a regex string. Full lambda support is out of scope.
		const list = asList(args[0]!);
		const pred = args[1]!;
		if (typeof pred === 'string') {
			try {
				const re = new RegExp(pred);
				return { ok: true, value: list.filter(x => re.test(coerceString(x))) };
			} catch { /* fall through */ }
		}
		return { ok: true, value: list.filter(x => dqlEquals(x, pred)) };
	},
};

const sliceFn = fn('slice', 2, (a) => {
	const list = asList(a[0]!);
	const n = coerceNumber(a[1]!) ?? 0;
	return n >= 0 ? list.slice(n) : list.slice(n);
});

const reverseFn = fn('reverse', 1, (a) => asList(a[0]!).slice().reverse());

const sortFn: DqlFunction = {
	name: 'sort',
	minArgs: 1,
	maxArgs: 1,
	apply(args) {
		const list = asList(args[0]!).slice();
		list.sort((x, y) => dqlCompare(x, y) ?? 0);
		return { ok: true, value: list };
	},
};

const uniqueFn = fn('unique', 1, (a) => {
	const list = asList(a[0]!);
	const out: DqlValue[] = [];
	for (const v of list) if (!out.some(o => dqlEquals(o, v))) out.push(v);
	return out;
});

const flatFn = fn('flat', 1, (a) => {
	const list = asList(a[0]!);
	const out: DqlValue[] = [];
	for (const v of list) {
		if (Array.isArray(v)) out.push(...v); else out.push(v);
	}
	return out;
});

/* ----------------------------- utility ----------------------------- */

const choiceFn: DqlFunction = {
	name: 'choice',
	minArgs: 2,
	maxArgs: 3,
	apply(args) {
		const cond = args[0]!;
		if (truthy(cond)) return { ok: true, value: args[1] ?? null };
		return { ok: true, value: args[2] ?? null };
	},
};

const objectFn = variadic('object', 0, (a) => {
	const entries: Record<string, DqlValue> = {};
	for (let i = 0; i + 1 < a.length; i += 2) {
		entries[coerceString(a[i]!)] = a[i + 1]!;
	}
	return makeObject(entries);
});

const metaFn = fn('meta', 1, (a) => {
	// meta() on a link returns a minimal object; mainly a passthrough for now.
	return a[0] ?? null;
});

const containswordFn = fn('containsword', 2, (a) => {
	const s = ' ' + coerceString(a[0]!).toLowerCase() + ' ';
	return s.includes(' ' + coerceString(a[1]!).toLowerCase() + ' ');
});

/* ----------------------------- registry ----------------------------- */

const FUNCTIONS: readonly DqlFunction[] = [
	// constructors
	dateFn, numberFn, stringFn, linkFn, elinkFn, typeofFn, defaultFn, datepathFn,
	striptimeFn, localtimeFn,
	// numeric
	roundFn, floorFn, ceilFn, truncFn, minFn, maxFn, sumFn, averageFn, absFn,
	// duration
	durFn, durationformatFn,
	// string
	containsFn, icontainsFn, startswithFn, endswithFn, lowerFn, upperFn, lengthFn,
	replaceFn, regexmatchFn, regexreplaceFn, splitFn, extractFn,
	truncateFn, ljustFn, rjustFn, substringFn, econtainsFn,
	// date
	yearFn, monthFn, dayFn, hourFn, minuteFn, secondFn, weeknumberFn, weekdayFn, dateformatFn,
	// list/object
	nonnullFn, allFn, anyFn, noneFn, joinFn, filterFn, sliceFn, reverseFn, sortFn, uniqueFn, flatFn,
	// utility
	choiceFn, objectFn, metaFn, containswordFn,
];

const REGISTRY = new Map<string, DqlFunction>(FUNCTIONS.map(f => [f.name, f]));

export function lookupFunction(name: string): DqlFunction | undefined {
	return REGISTRY.get(name.toLowerCase());
}
