import { App, TFile } from 'obsidian';

/** Recognized task priority levels (parsed from `[priority:: ...]`). */
export type Priority = 'high' | 'medium' | 'low';
/** Grouping dimension for the aggregated task view. */
export type TaskGroupBy = 'date' | 'priority' | 'none';

/**
 * One checkbox task located somewhere in the vault. Carries enough context to
 * display it, bucket it, and write the toggle back to its exact source line.
 */
export interface VaultTask {
	file: TFile;
	path: string;
	/** 0-based line index of the checkbox in the source file. */
	line: number;
	/** Full raw source line (indent + `- [ ]`/`- [x]` + text + markers), kept verbatim so toggling can match it exactly even if the file shifted. */
	originalLine: string;
	checked: boolean;
	/** Display text with all markers (collapsed/reminder/due/priority) stripped. */
	text: string;
	/** Raw `⏰ YYYY-MM-DD HH:MM` reminder value, if present. */
	reminder?: string;
	/** Canonical due date `YYYY-MM-DD` (from ⏰ / `[due::]` / 📅), if any. */
	due?: string;
	/** Multi-day event start `YYYY-MM-DD` (from `[start::]` / 🛫), if any. */
	start?: string;
	/** Multi-day event end `YYYY-MM-DD` (from `[end::]` / 🛬), if any. */
	end?: string;
	/** Start time-of-day `HH:MM` (from ⏰ / `[due::]` / `[start::]` when a time is present). */
	time?: string;
	/** End time-of-day `HH:MM` (from `[end::]` when a time is present). */
	endTime?: string;
	priority?: Priority;
	mtime: number;
	ctime: number;
}

interface CacheEntry {
	mtime: number;
	tasks: VaultTask[];
}

const moduleCache = new Map<string, CacheEntry>();

const COLLAPSED_REGEX = /\s*<!--collapsed-->\s*$/;
/** Plugin's own reminder marker: `⏰ YYYY-MM-DD HH:MM` at end of line. */
const REMINDER_REGEX = /\s*⏰\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/;
/** Dataview-style due date inline field, anywhere in the text. */
const DUE_FIELD_REGEX = /\s*\[due::\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\]/i;
/** Tasks-plugin calendar emoji due date, anywhere in the text. */
const CALENDAR_REGEX = /\s*📅\s*(\d{4}-\d{2}-\d{2})/;
/** Dataview-style start-date inline field, anywhere in the text. */
const START_FIELD_REGEX = /\s*\[start::\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\]/i;
/** Tasks-plugin start emoji. */
const START_EMOJI_REGEX = /\s*🛫\s*(\d{4}-\d{2}-\d{2})/;
/** Dataview-style end-date inline field, anywhere in the text. */
const END_FIELD_REGEX = /\s*\[end::\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\]/i;
/** Tasks-plugin end emoji. */
const END_EMOJI_REGEX = /\s*🛬\s*(\d{4}-\d{2}-\d{2})/;
/** Dataview-style priority inline field, anywhere in the text. */
const PRIORITY_FIELD_REGEX = /\s*\[priority::\s*([^\]]+?)\s*\]/i;
/** Any checkbox line, allowing leading indentation so subtasks are aggregated too. */
const TASK_LINE_REGEX = /^(\s*)- \[([ xX])\]\s*(.+)$/;

/** Normalize a raw `[priority:: ...]` value to a known level. */
function normalizePriority(raw: string): Priority | undefined {
	const v = raw.trim().toLowerCase();
	if (['high', 'hi', 'h', 'urgent', 'u', '1', '!!!', 'p1'].includes(v)) return 'high';
	if (['medium', 'mid', 'm', 'normal', 'n', '2', '!!', 'p2'].includes(v)) return 'medium';
	if (['low', 'l', 'low-priority', '3', '!', 'p3'].includes(v)) return 'low';
	return undefined;
}

/** `HH:MM` from a `YYYY-MM-DD HH:MM`-shaped value (undefined if no time part). */
function hhmm(s: string | undefined): string | undefined {
	return s && s.length >= 16 ? s.slice(11, 16) : undefined;
}

/**
 * Scan one markdown file's content for checkbox tasks. Returns an empty array
 * (never throws) so one bad file can't break the whole section.
 */
export function scanFileTasks(file: TFile, content: string): VaultTask[] {
	const lines = content.split('\n');
	const out: VaultTask[] = [];
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const m = raw.match(TASK_LINE_REGEX);
		if (!m) continue;
		const [, , mark, rest] = m;
		let text = rest ?? '';
		text = text.replace(COLLAPSED_REGEX, '');

		let reminder: string | undefined;
		const rm = text.match(REMINDER_REGEX);
		if (rm) {
			reminder = rm[1];
			text = text.replace(REMINDER_REGEX, '');
		}

		let due: string | undefined;
		const df = text.match(DUE_FIELD_REGEX);
		if (df) {
			due = (df[1] ?? '').slice(0, 10);
			text = text.replace(DUE_FIELD_REGEX, '');
		}
		if (!due) {
			const cal = text.match(CALENDAR_REGEX);
			if (cal) {
				due = cal[1];
				text = text.replace(CALENDAR_REGEX, '');
			}
		}
		// The plugin's ⏰ reminder is the canonical due source when present.
		if (reminder) due = reminder.slice(0, 10);

		let priority: Priority | undefined;
		const pf = text.match(PRIORITY_FIELD_REGEX);
		if (pf) {
			priority = normalizePriority(pf[1] ?? '');
			text = text.replace(PRIORITY_FIELD_REGEX, '');
		}

		// Multi-day event window ([start::] / [end::] or 🛫 / 🛬).
		let start: string | undefined;
		const sf = text.match(START_FIELD_REGEX) ?? text.match(START_EMOJI_REGEX);
		if (sf) {
			start = (sf[1] ?? '').slice(0, 10);
			text = text.replace(START_FIELD_REGEX, '').replace(START_EMOJI_REGEX, '');
		}
		let end: string | undefined;
		const ef = text.match(END_FIELD_REGEX) ?? text.match(END_EMOJI_REGEX);
		if (ef) {
			end = (ef[1] ?? '').slice(0, 10);
			text = text.replace(END_FIELD_REGEX, '').replace(END_EMOJI_REGEX, '');
		}

		// Time-of-day (for the calendar week time-grid): start time from ⏰ / due
		// / start (whichever carries HH:MM), end time from [end::].
		const time = hhmm(reminder) ?? hhmm(df?.[1]) ?? hhmm(sf?.[1]);
		const endTime = hhmm(ef?.[1]);

		out.push({
			file,
			path: file.path,
			line: i,
			originalLine: raw,
			checked: (mark ?? ' ') !== ' ',
			text: text.trim(),
			reminder,
			due,
			start,
			end,
			time,
			endTime,
			priority,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
		});
	}
	return out;
}

/** True if a vault path equals or lives under one of the excluded folders. */
function isExcluded(path: string, normalized: string[]): boolean {
	if (normalized.length === 0) return false;
	const lower = path.toLowerCase();
	return normalized.some(f => lower === f || lower.startsWith(f + '/'));
}

/**
 * Collect every checkbox task across the vault, skipping excluded folders,
 * using an mtime-keyed cache so unchanged files are not re-parsed each render.
 */
export async function collectVaultTasks(app: App, excludeFolders: string[] = []): Promise<VaultTask[]> {
	const normalized = excludeFolders
		.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.map(f => f.toLowerCase());
	const files = app.vault.getMarkdownFiles();
	const stale = new Set(moduleCache.keys());
	const all: VaultTask[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i]!;
		// Yield to the UI thread periodically so scanning a large vault doesn't
		// freeze the app (especially on mobile) — this is what made the section
		// feel stuck/unresponsive and the phone overheat while it churned through
		// every file.
		if (i > 0 && i % 50 === 0) await new Promise<void>(r => window.setTimeout(r, 0));

		if (file.path.startsWith('.')) { stale.delete(file.path); continue; }
		if (isExcluded(file.path, normalized)) { stale.delete(file.path); continue; }
		stale.delete(file.path);

		const cached = moduleCache.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) {
			all.push(...cached.tasks);
			continue;
		}

		// Cheap pre-filter via the metadata cache: skip files Obsidian has already
		// parsed that contain no checkbox tasks at all (the common case — most notes
		// have none). This avoids reading + regex-parsing the vast majority of notes.
		// (Don't cache the empty result: re-checking the metadata cache each scan is
		// cheap and self-heals if the cache was briefly stale after a write.)
		const fc = app.metadataCache.getFileCache(file);
		if (fc && !fc.listItems?.some(li => li.task !== undefined)) {
			continue;
		}

		let content: string;
		try {
			content = await app.vault.cachedRead(file);
		} catch {
			continue;
		}
		const tasks = scanFileTasks(file, content);
		moduleCache.set(file.path, { mtime: file.stat.mtime, tasks });
		all.push(...tasks);
	}
	for (const path of stale) moduleCache.delete(path);
	return all;
}

/** Drop cache entries for a path (e.g. after a failed toggle) so the next scan re-reads. */
export function invalidatePath(path: string): void {
	moduleCache.delete(path);
}

/**
 * Atomically flip a task's checkbox in its source file. Matches the exact
 * original line at its recorded position, then (if the file shifted) by a
 * unique full-line match; refuses to write if the line can't be located
 * unambiguously.
 */
export async function toggleTaskInFile(app: App, task: VaultTask, nextChecked: boolean): Promise<boolean> {
	let wrote = false;
	try {
		await app.vault.process(task.file, (data: string) => {
			const lines = data.split('\n');
			const target = task.originalLine;
			const wantOpen = target.indexOf('- [ ]');
			const wantDone = target.indexOf('- [x]');
			let replacement: string;
			if (nextChecked) {
				replacement = wantOpen === -1 ? target : target.slice(0, wantOpen) + '- [x]' + target.slice(wantOpen + 5);
			} else {
				replacement = wantDone === -1 ? target : target.slice(0, wantDone) + '- [ ]' + target.slice(wantDone + 5);
			}
			if (replacement === target) {
				wrote = false;
				return data;
			}
			let idx = lines[task.line] === target ? task.line : -1;
			if (idx === -1) {
				const hits: number[] = [];
				for (let i = 0; i < lines.length; i++) {
					if (lines[i] === target) hits.push(i);
				}
				if (hits.length === 1) idx = hits[0]!;
			}
			if (idx === -1) {
				wrote = false;
				return data;
			}
			lines[idx] = replacement;
			wrote = true;
			return lines.join('\n');
		});
	} catch (err) {
		console.error('[Dashboard] alltasks toggle failed:', err);
		throw err;
	}
	return wrote;
}

/* ----------------------------- bucketing ----------------------------- */

export type DateBucket = 'overdue' | 'today' | 'week' | 'later' | 'nodue';
export type PriorityBucket = Priority | 'none';

export const DATE_BUCKET_ORDER: DateBucket[] = ['overdue', 'today', 'week', 'later', 'nodue'];
export const PRIORITY_BUCKET_ORDER: PriorityBucket[] = ['high', 'medium', 'low', 'none'];

/** i18n key suffix for each date bucket. */
export const DATE_BUCKET_I18N: Record<DateBucket, string> = {
	overdue: 'Overdue',
	today: 'Today',
	week: 'ThisWeek',
	later: 'Later',
	nodue: 'NoDue',
};
/** i18n key suffix for each priority bucket. */
export const PRIORITY_BUCKET_I18N: Record<PriorityBucket, string> = {
	high: 'High',
	medium: 'Medium',
	low: 'Low',
	none: 'None',
};

function parseDueDate(s: string): Date | null {
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? '0'), Number(m[5] ?? '0'));
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

/** Classify a task's due date into a bucket relative to `now` (local time). */
export function dateBucketOf(due: string | undefined, now: Date = new Date()): DateBucket {
	if (!due) return 'nodue';
	const d = parseDueDate(due);
	if (!d) return 'nodue';
	const today = startOfDay(now).getTime();
	const dueDay = startOfDay(d).getTime();
	if (dueDay < today) return 'overdue';
	if (dueDay === today) return 'today';
	const daysSinceMonday = (now.getDay() + 6) % 7;
	const monday = today - daysSinceMonday * 86400000;
	const nextMonday = monday + 7 * 86400000;
	if (dueDay >= monday && dueDay < nextMonday) return 'week';
	return 'later';
}

export function priorityBucketOf(task: VaultTask): PriorityBucket {
	return task.priority ?? 'none';
}

export interface TaskGroup {
	key: string;
	tasks: VaultTask[];
}

/** Group tasks by the chosen dimension, returning every bucket in fixed order. */
export function groupTasks(tasks: VaultTask[], groupBy: TaskGroupBy): TaskGroup[] {
	if (groupBy === 'none') {
		return [{ key: 'all', tasks }];
	}
	if (groupBy === 'priority') {
		return PRIORITY_BUCKET_ORDER.map(key => ({
			key,
			tasks: tasks.filter(t => priorityBucketOf(t) === key),
		}));
	}
	return DATE_BUCKET_ORDER.map(key => ({
		key,
		tasks: tasks.filter(t => dateBucketOf(t.due) === key),
	}));
}

/* --------------------------- calendar support --------------------------- */

/** Max number of days a multi-day span may cover (guards against pathological ranges). */
const MAX_SPAN_DAYS = 366;

/** A task is calendar-relevant if it carries a due date or a start/end window. */
export function isCalendarRelevant(task: VaultTask): boolean {
	return Boolean(task.due || task.start || task.end);
}

/**
 * Inclusive [start, end] day range (YYYY-MM-DD) a task occupies on a calendar.
 * Falls back to the due date as a single day when no start/end window exists.
 * Returns null for tasks with no date at all.
 */
export function calendarSpan(task: VaultTask): { start: string; end: string } | null {
	if (task.start && task.end) {
		return task.start <= task.end ? { start: task.start, end: task.end } : { start: task.end, end: task.start };
	}
	if (task.start) return { start: task.start, end: task.start };
	if (task.end) return { start: task.end, end: task.end };
	if (task.due) return { start: task.due, end: task.due };
	return null;
}

function addDaysIso(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
	dt.setDate(dt.getDate() + days);
	const yy = dt.getFullYear();
	const mm = String(dt.getMonth() + 1).padStart(2, '0');
	const dd = String(dt.getDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/**
 * Index calendar-relevant tasks by every day they occupy. Multi-day tasks are
 * added to each day in their span (capped at MAX_SPAN_DAYS). Tasks with no date
 * are skipped.
 */
export function indexTasksByDay(tasks: VaultTask[]): Map<string, VaultTask[]> {
	const byDay = new Map<string, VaultTask[]>();
	for (const task of tasks) {
		const span = calendarSpan(task);
		if (!span) continue;
		let cursor = span.start;
		let guard = 0;
		while (guard <= MAX_SPAN_DAYS) {
			const list = byDay.get(cursor);
			if (list) list.push(task);
			else byDay.set(cursor, [task]);
			if (cursor >= span.end) break;
			cursor = addDaysIso(cursor, 1);
			guard++;
		}
	}
	return byDay;
}

/** "YYYY-MM-DD" for a given local Date. */
export function toIsoDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
