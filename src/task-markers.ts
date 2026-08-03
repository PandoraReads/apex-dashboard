import type { TaskItem } from './types';

/**
 * Shared markers for Tasks-plugin compatible task metadata:
 * priority 🔺⏫🔼🔽⏬, created ➕, completed ✅.
 * Used by the dashboard serializer/parser, note-save service and vault scanner
 * so every read/write path speaks the exact same syntax.
 */

/** Sort weight: higher = more urgent. Absent priority (normal) sits between medium and low. */
/** Weight for a possibly-undefined priority (normal = 2). */

const DATE = '\\d{4}-\\d{2}-\\d{2}';
const CREATED_REGEX = new RegExp(`\\s*➕\\s*(${DATE})`);
const COMPLETED_REGEX = new RegExp(`\\s*✅\\s*(${DATE})`);

export interface TaskMarkers {
	createdAt?: string;
	completedAt?: string;
}

/**
 * Strip ➕/✅/priority markers from raw task text and return them separately.
 * Safe to call on text without any markers (returns text unchanged).
 */
export function extractTaskMarkers(raw: string): { text: string; markers: TaskMarkers } {
	let text = raw;
	const markers: TaskMarkers = {};

	const cm = text.match(CREATED_REGEX);
	if (cm?.[1]) {
		markers.createdAt = cm[1];
		text = text.replace(CREATED_REGEX, '');
	}
	const xm = text.match(COMPLETED_REGEX);
	if (xm?.[1]) {
		markers.completedAt = xm[1];
		text = text.replace(COMPLETED_REGEX, '');
	}

	return { text: text.trim(), markers };
}

/** Append a task's ➕/✅/priority markers to a line, in canonical order. */
export function appendTaskMarkers(line: string, task: Pick<TaskItem, 'priority' | 'createdAt' | 'completedAt'>): string {
	let out = line;

	if (task.createdAt) out += ` ➕ ${task.createdAt}`;
	if (task.completedAt) out += ` ✅ ${task.completedAt}`;
	return out;
}

/** Today's date as YYYY-MM-DD (local time). */
export function todayStr(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Recursively fill missing createdAt on every task (legacy tasks predate the
 * timestamp feature). Returns true when anything changed so callers can persist.
 */
export function backfillCreatedAt(tasks: TaskItem[], date: string = todayStr()): boolean {
	let changed = false;
	for (const task of tasks) {
		if (!task.createdAt) {
			task.createdAt = date;
			changed = true;
		}
		if (task.children && backfillCreatedAt(task.children, date)) changed = true;
	}
	return changed;
}
