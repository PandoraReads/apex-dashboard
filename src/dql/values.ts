import type {
	DqlDate, DqlDuration, DqlLink, DqlObject, DqlValue,
} from './types';

/* ----------------------------- constructors ----------------------------- */

export function makeDate(ts: number): DqlDate {
	// Truncate to milliseconds; clamp to a sane epoch range so malformed inputs
	// (NaN, huge numbers) don't poison comparisons downstream.
	const safe = Number.isFinite(ts) ? Math.trunc(ts) : 0;
	return { kind: 'date', ts: safe };
}

export function makeDuration(ms: number): DqlDuration {
	return { kind: 'duration', ms: Number.isFinite(ms) ? ms : 0 };
}

export function makeLink(path: string, display?: string, embed = false): DqlLink {
	return { kind: 'link', path, display, embed };
}

export function makeObject(entries: Record<string, DqlValue>): DqlObject {
	return { kind: 'object', entries };
}

/* ----------------------------- truthiness & equality ----------------------------- */

/** Dataview truthiness: null/false/0/"" are falsy, everything else truthy. */
export function truthy(v: DqlValue): boolean {
	if (v === null) return false;
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v.length > 0;
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'object') {
		const k = (v as { kind?: string }).kind;
		if (k === 'date' || k === 'duration') return true;
		if (k === 'link') return (v as DqlLink).path.length > 0;
		if (k === 'object') return Object.keys((v as DqlObject).entries).length > 0;
	}
	return true;
}

/** Structural equality across DQL value types. */
export function dqlEquals(a: DqlValue, b: DqlValue): boolean {
	if (a === null || b === null) return a === b;
	const ta = kindOf(a);
	const tb = kindOf(b);
	if (ta !== tb) return false;
	switch (ta) {
		case 'boolean': return a === b;
		case 'number': return a === b;
		case 'string': return a === b;
		case 'date': return (a as DqlDate).ts === (b as DqlDate).ts;
		case 'duration': return (a as DqlDuration).ms === (b as DqlDuration).ms;
		case 'link': return (a as DqlLink).path === (b as DqlLink).path;
		case 'list': {
			const aa = a as DqlValue[];
			const bb = b as DqlValue[];
			return aa.length === bb.length && aa.every((x, i) => dqlEquals(x, bb[i]!));
		}
		case 'object': {
			const aa = (a as DqlObject).entries;
			const bb = (b as DqlObject).entries;
			const ka = Object.keys(aa);
			const kb = Object.keys(bb);
			return ka.length === kb.length && ka.every(k => k in bb && dqlEquals(aa[k]!, bb[k]!));
		}
		default:
			return false;
	}
}

export type ValueKind = 'null' | 'boolean' | 'number' | 'string' | 'date' | 'duration' | 'link' | 'list' | 'object';

export function kindOf(v: DqlValue): ValueKind {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return 'boolean';
	if (typeof v === 'number') return 'number';
	if (typeof v === 'string') return 'string';
	if (Array.isArray(v)) return 'list';
	if (typeof v === 'object') {
		const k = (v as { kind?: string }).kind;
		if (k === 'date') return 'date';
		if (k === 'duration') return 'duration';
		if (k === 'link') return 'link';
		return 'object';
	}
	return 'null';
}

/** Total ordering for SORT/comparisons. Different types rank by a fixed
 *  precedence so SORT is always deterministic; same-type uses natural order.
 *  Returns null when the comparison is undefined (type mismatch on `<` etc.)
 *  so the evaluator can treat it as "no row match" rather than crashing. */
export function dqlCompare(a: DqlValue, b: DqlValue): number | null {
	// null sorts before everything.
	if (a === null && b === null) return 0;
	if (a === null) return -1;
	if (b === null) return 1;

	const ta = kindOf(a);
	const tb = kindOf(b);
	if (ta !== tb) {
		// Cross-type: order by type precedence, stable and predictable.
		return TYPE_ORDER[ta] - TYPE_ORDER[tb];
	}
	switch (ta) {
		case 'boolean': return a === b ? 0 : a ? 1 : -1;
		case 'number': return (a as number) - (b as number);
		case 'string': return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
		case 'date': return (a as DqlDate).ts - (b as DqlDate).ts;
		case 'duration': return (a as DqlDuration).ms - (b as DqlDuration).ms;
		case 'link': {
			const pa = (a as DqlLink).path;
			const pb = (b as DqlLink).path;
			return pa < pb ? -1 : pa > pb ? 1 : 0;
		}
		case 'list': return 0; // lists are not orderable; keep stable.
		case 'object': return 0;
		default: return 0;
	}
}

const TYPE_ORDER: Record<ValueKind, number> = {
	null: 0, boolean: 1, number: 2, date: 3, duration: 4, string: 5, link: 6, list: 7, object: 8,
};

/* ----------------------------- coercion helpers ----------------------------- */

export function coerceNumber(v: DqlValue): number | null {
	if (v === null) return null;
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v === 'string') {
		const n = Number(v.trim());
		return v.trim() !== '' && Number.isFinite(n) ? n : null;
	}
	if (kindOf(v) === 'date') return (v as DqlDate).ts;
	if (kindOf(v) === 'duration') return (v as DqlDuration).ms;
	return null;
}

export function coerceString(v: DqlValue): string {
	if (v === null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return formatValue(v);
}

export function asList(v: DqlValue): DqlValue[] {
	if (v === null) return [];
	return Array.isArray(v) ? v : [v];
}

/* ----------------------------- formatting ----------------------------- */

/** Render a value to a single-line display string for TABLE cells, etc. */
export function formatValue(v: DqlValue): string {
	if (v === null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number') return String(v);
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	switch (kindOf(v)) {
		case 'date': return formatDate(v as DqlDate);
		case 'duration': return formatDuration(v as DqlDuration);
		case 'link': {
			const link = v as DqlLink;
			return link.display ?? link.path;
		}
		case 'list': return (v as DqlValue[]).map(formatValue).join(', ');
		case 'object': {
			const entries = (v as DqlObject).entries;
			return Object.keys(entries).map(k => `${k}: ${formatValue(entries[k]!)}`).join(', ');
		}
	}
	return '';
}

const PAD2 = (n: number): string => String(n).padStart(2, '0');

/** ISO `YYYY-MM-DD HH:MM` (time omitted when exactly midnight). */
export function formatDate(d: DqlDate): string {
	const dt = new Date(d.ts);
	const y = dt.getFullYear();
	const m = PAD2(dt.getMonth() + 1);
	const day = PAD2(dt.getDate());
	const hh = dt.getHours();
	const mm = dt.getMinutes();
	if (hh === 0 && mm === 0) return `${y}-${m}-${day}`;
	return `${y}-${m}-${day} ${PAD2(hh)}:${PAD2(mm)}`;
}

export function formatDuration(d: DqlDuration): string {
	const totalMs = d.ms;
	const days = Math.trunc(totalMs / 86_400_000);
	const hours = Math.trunc((totalMs % 86_400_000) / 3_600_000);
	const minutes = Math.trunc((totalMs % 3_600_000) / 60_000);
	const seconds = Math.trunc((totalMs % 60_000) / 1000);
	const parts: string[] = [];
	if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
	if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
	if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
	if (seconds && parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
	return parts.length ? parts.join(' ') : '0 seconds';
}
