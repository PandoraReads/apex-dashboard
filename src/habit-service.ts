import type DashboardPlugin from './main';

/** One check-in habit owned by the user. */
export interface Habit {
	id: string;
	name: string;
	/** 'YYYY-MM-DD', local time. */
	createdAt: string;
}

/** v1 data layout, stored at .obsidian/plugins/apex-dashboard/habits.json. */
export interface HabitData {
	version: 1;
	habits: Habit[];
	/** Completed habit ids keyed by local date 'YYYY-MM-DD'. */
	records: Record<string, string[]>;
}

export const DATA_FILE = 'habits.json';
const MAX_RECORD_DAYS = 730;
/** Shared with the widget so its validation Notice matches the service. */
export const HABIT_MAX_NAME_LENGTH = 50;
const MAX_NAME_LENGTH = HABIT_MAX_NAME_LENGTH;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyData(): HabitData {
	return { version: 1, habits: [], records: {} };
}

/** Union of two datasets, `session` winning per-habit-id conflicts. Used when
 *  a load that failed at startup succeeds on a later retry: the disk copy and
 *  everything changed in-session are merged so neither side is lost. */
function mergeData(disk: HabitData, session: HabitData): HabitData {
	const byId = new Map(disk.habits.map(h => [h.id, h] as const));
	for (const h of session.habits) byId.set(h.id, h);
	const habits = [...byId.values()];
	const ids = new Set(habits.map(h => h.id));
	const seen = new Map<string, Set<string>>();
	for (const source of [disk, session]) {
		for (const [date, idList] of Object.entries(source.records)) {
			if (!DATE_RE.test(date)) continue;
			const set = seen.get(date) ?? new Set<string>();
			seen.set(date, set);
			for (const id of idList) {
				if (ids.has(id)) set.add(id);
			}
		}
	}
	const records: Record<string, string[]> = {};
	for (const [date, set] of seen) {
		if (set.size > 0) records[date] = [...set];
	}
	return { version: 1, habits, records };
}

/** Normalize a parsed habits.json: keep only well-formed habits and record
 *  entries so a hand-edited or corrupted file degrades to partial data. */
function normalizeData(raw: unknown): HabitData {
	if (!raw || typeof raw !== 'object') return emptyData();
	const obj = raw as Partial<HabitData>;
	const habits = Array.isArray(obj.habits)
		? obj.habits.filter((h): h is Habit =>
			!!h && typeof h === 'object'
			&& typeof h.id === 'string' && h.id.length > 0
			&& typeof h.name === 'string' && h.name.length > 0
			&& typeof h.createdAt === 'string' && DATE_RE.test(h.createdAt))
		: [];
	const habitIds = new Set(habits.map(h => h.id));
	const records: Record<string, string[]> = {};
	if (obj.records && typeof obj.records === 'object') {
		for (const [date, ids] of Object.entries(obj.records)) {
			if (!DATE_RE.test(date) || !Array.isArray(ids)) continue;
			const valid = ids.filter((id): id is string =>
				typeof id === 'string' && habitIds.has(id));
			if (valid.length > 0) records[date] = valid;
		}
	}
	return { version: 1, habits, records };
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Local-time 'YYYY-MM-DD' (shared by the widget and stats modal). */
export function habitFormatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Local-time 'YYYY-MM-DD' for today (shared by the widget and stats modal). */
export function habitToday(): string {
	return formatDate(new Date());
}

/** Local-time 'YYYY-MM-DD' for yesterday (the backfill modal's only target). */
export function habitYesterday(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return formatDate(d);
}

function todayStr(): string {
	return formatDate(new Date());
}

/** Whole days between two 'YYYY-MM-DD' dates (b - a), both inclusive of day
 *  boundaries; used by the 30-day rate denominator. */
function daysBetween(a: string, b: string): number {
	const da = new Date(a + 'T00:00:00');
	const db = new Date(b + 'T00:00:00');
	return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function makeHabitId(): string {
	return `hb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ===== Module-level singleton (media-tags pattern) =====
// The banner render layer (banner-stats.ts / banner.ts) has no view/plugin
// reference to pass a service through, so the plugin instance registers the
// live service here at onload and clears it at unload.

let activeService: HabitService | null = null;

export function registerHabitService(service: HabitService | null): void {
	activeService = service;
}

export function getHabitService(): HabitService | null {
	return activeService;
}

/**
 * Boolean daily check-in tracker. Habits and their per-day completion are
 * persisted as a standalone JSON file (pomodoro/reading pattern); all
 * mutations go through this service so every consumer (sidebar widget, stats
 * overlay, banner heatmap) reads one shared dataset via subscribe().
 */
export class HabitService {
	private data: HabitData = emptyData();
	private loaded = false;
	private loadFailed = false;
	/** Raw file content of this instance's last successful write; a disk read
	 *  that differs means an external writer (sync / another device)
	 *  intervened and the next write must merge instead of clobber. */
	private lastWritten: string | null = null;
	private syncInFlight = false;
	private listeners = new Set<() => void>();

	private focusDoc: Document | null = null;
	private focusHandler = (): void => {
		if (this.focusDoc?.visibilityState === 'visible') void this.syncFromDisk();
	};

	constructor(private plugin: DashboardPlugin) {
		// Data files only ever load at startup; without re-reading, a session
		// open all day never sees another device's records and its next save
		// clobbers them. On focus (window switch / mobile foreground)
		// re-read and union. Listener is per-service (not plugin-lifetime):
		// pomodoro/reading instances live and die with their view.
		this.focusDoc = activeDocument;
		this.focusDoc.addEventListener('visibilitychange', this.focusHandler);
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				this.data = normalizeData(JSON.parse(raw));
				this.lastWritten = raw;
			}
		} catch (error) {
			// Distinguish the two failure kinds: a JSON parse error means the
			// file is unusable (start fresh); an adapter/IO error (mobile file
			// lock, transient fs hiccup) leaves the on-disk file intact — flag
			// it so the next save cannot overwrite it with the empty state.
			this.data = emptyData();
			this.loadFailed = !(error instanceof SyntaxError);
		}
		this.pruneOldRecords();
	}

	/** Serialized write queue — at most one write is ever in flight. The old
	 *  fire-and-forget saves raced on the same file: an earlier-serialized
	 *  snapshot completing after a newer write silently reverted every mutation
	 *  made in between (observed: habits created in quick succession shrinking
	 *  back to one after a reload). Content serializes at execution time, so a
	 *  write delayed behind earlier ones still persists the freshest state. */
	private saveQueue: Promise<void> = Promise.resolve();

	private save(): void {
		this.saveQueue = this.saveQueue.then(() => this.persist());
	}

	private async persist(): Promise<void> {
		// A non-parse load failure must not brick persistence for the whole
		// session; re-attempt the read and merge before deciding to skip.
		if (this.loadFailed && !(await this.retryFailedLoad())) return;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const dir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
			const path = `${dir}/${DATA_FILE}`;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			// Merge the disk state first when someone else wrote since our
			// last write — blind full-file saves are what made check-ins
			// "not sync" (last writer silently reverted the other device).
			// Deletions stay deleted: without an external change the union
			// never runs, so a removed habit is not resurrected.
			try {
				if (await adapter.exists(path)) {
					const raw = await adapter.read(path);
					if (raw !== this.lastWritten) {
						this.data = mergeData(normalizeData(JSON.parse(raw)), this.data);
					}
				}
			} catch {
				// Disk unreadable at save time: write our state as before.
			}
			const json = JSON.stringify(this.data);
			await adapter.write(path, json);
			this.lastWritten = json;
		} catch {
			// silent fail: an unwriteable habits.json must not break check-ins in-session
		}
	}

	/** Re-attempt the initial read after a non-parse load failure (iCloud file
	 *  not yet downloaded, transient mobile file lock). One such error used to
	 *  disable saving for the entire session — every habit added then silently
	 *  vanished on the next reload. On success the disk state merges with the
	 *  in-session state (union by habit id and by record id). Returns false
	 *  while the file is still unreadable: saving stays skipped rather than
	 *  clobbering a file we cannot see. */
	private async retryFailedLoad(): Promise<boolean> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			let disk = emptyData();
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				disk = normalizeData(JSON.parse(raw));
				this.lastWritten = raw;
			}
			this.data = mergeData(disk, this.data);
			this.loadFailed = false;
			// The merge may resurrect habits the UI has not seen yet.
			this.notify();
			return true;
		} catch (error) {
			this.loadFailed = !(error instanceof SyntaxError);
			return !this.loadFailed;
		}
	}

	/** Re-read the file and union external changes into memory (another
	 *  device's check-ins arriving via sync). Notifies listeners when the
	 *  merge changed anything, and writes the union back so a lagging device
	 *  heals on its next focus. */
	async syncFromDisk(): Promise<void> {
		if (!this.loaded || this.syncInFlight) return;
		this.syncInFlight = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (!(await adapter.exists(path))) return;
			const raw = await adapter.read(path);
			if (raw === this.lastWritten) return;
			this.data = mergeData(normalizeData(JSON.parse(raw)), this.data);
			this.pruneOldRecords();
			this.notify();
			this.save();
		} catch {
			// Transient read error (file mid-sync): the next focus retries.
		} finally {
			this.syncInFlight = false;
		}
	}

	/** Register a data-changed listener; returns its unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	destroy(): void {
		this.listeners.clear();
		this.focusDoc?.removeEventListener('visibilitychange', this.focusHandler);
		this.focusDoc = null;
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	private pruneOldRecords(): void {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - MAX_RECORD_DAYS);
		const cutoffStr = formatDate(cutoff);
		const records = Object.fromEntries(
			Object.entries(this.data.records).filter(([date]) => date >= cutoffStr),
		);
		this.data = { ...this.data, records };
	}

	// ===== Habit CRUD =====

	getHabits(): Habit[] {
		return [...this.data.habits];
	}

	/** Add a habit; null when the name is empty, a duplicate (case-insensitive)
	 *  or over 50 chars — callers surface the reason as a Notice. */
	addHabit(name: string): Habit | null {
		const trimmed = name.trim();
		if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
		if (this.data.habits.some(h => h.name.toLowerCase() === trimmed.toLowerCase())) return null;
		const habit: Habit = { id: makeHabitId(), name: trimmed, createdAt: todayStr() };
		this.data = { ...this.data, habits: [...this.data.habits, habit] };
		this.save();
		this.notify();
		return habit;
	}

	/** Rename a habit; false when not found or the new name fails validation. */
	renameHabit(id: string, name: string): boolean {
		const trimmed = name.trim();
		if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return false;
		if (this.data.habits.some(h => h.id !== id && h.name.toLowerCase() === trimmed.toLowerCase())) return false;
		if (!this.data.habits.some(h => h.id === id)) return false;
		this.data = {
			...this.data,
			habits: this.data.habits.map(h => h.id === id ? { ...h, name: trimmed } : h),
		};
		this.save();
		this.notify();
		return true;
	}

	/** Remove a habit and sweep its ids out of every record day (no dangling
	 *  data; a banner referencing the dead id falls back to note activity). */
	removeHabit(id: string): void {
		if (!this.data.habits.some(h => h.id === id)) return;
		const records: Record<string, string[]> = {};
		for (const [date, ids] of Object.entries(this.data.records)) {
			const kept = ids.filter(i => i !== id);
			if (kept.length > 0) records[date] = kept;
		}
		this.data = {
			...this.data,
			habits: this.data.habits.filter(h => h.id !== id),
			records,
		};
		this.save();
		this.notify();
	}

	/** Move the habit at index `from` to insert slot `to` (wireDrag convention:
	 *  both pre-removal indexes — dropping on the bottom half of a later card
	 *  passes that card's index + 1). The order drives the sidebar widget's
	 *  list and the stats overlay's cards alike. */
	moveHabit(from: number, to: number): void {
		const habits = this.data.habits;
		if (from < 0 || from >= habits.length || to < 0 || to > habits.length || from === to) return;
		const next = [...habits];
		const moved = next.splice(from, 1)[0];
		if (!moved) return;
		next.splice(to > from ? to - 1 : to, 0, moved);
		this.data = { ...this.data, habits: next };
		this.save();
		this.notify();
	}

	// ===== Check-in queries =====

	isDone(habitId: string, date?: string): boolean {
		const key = date ?? todayStr();
		return this.data.records[key]?.includes(habitId) === true;
	}

	/** Toggle a habit's completion for a date (default today) and notify. */
	toggle(habitId: string, date?: string): void {
		const key = date ?? todayStr();
		const ids = this.data.records[key] ?? [];
		const next = ids.includes(habitId)
			? ids.filter(i => i !== habitId)
			: [...ids, habitId];
		const records = { ...this.data.records };
		if (next.length > 0) {
			records[key] = next;
		} else {
			delete records[key];
		}
		this.data = { ...this.data, records };
		this.save();
		this.notify();
	}

	/** Habit ids completed on a date (feeds the "x/y today" sub-label). */
	getDoneOn(date: string): string[] {
		return [...(this.data.records[date] ?? [])];
	}

	/** Mark habits done on a date without toggling anything off (backfill
	 *  path: making up a missed day must never erase an existing record).
	 *  One immutable update, one save and one notify for the whole batch;
	 *  returns how many ids were actually added — 0 means nothing changed. */
	markDoneMany(habitIds: readonly string[], date: string): number {
		if (!DATE_RE.test(date)) return 0;
		const known = new Set(this.data.habits.map(h => h.id));
		const merged = new Set(this.data.records[date] ?? []);
		let added = 0;
		for (const id of habitIds) {
			if (!known.has(id) || merged.has(id)) continue;
			merged.add(id);
			added++;
		}
		if (added === 0) return 0;
		this.data = {
			...this.data,
			records: { ...this.data.records, [date]: [...merged] },
		};
		this.save();
		this.notify();
		return added;
	}

	/** Consecutive completed days ending today (or yesterday when today is not
	 *  yet checked — the streak survives the day rollover either way). */
	getStreak(habitId: string): number {
		const doneDays = new Set(
			Object.keys(this.data.records).filter(date =>
				this.data.records[date]!.includes(habitId)),
		);
		if (doneDays.size === 0) return 0;

		let streak = 0;
		const cursor = new Date();
		if (!doneDays.has(formatDate(cursor))) {
			cursor.setDate(cursor.getDate() - 1);
			if (!doneDays.has(formatDate(cursor))) return 0;
		}
		while (doneDays.has(formatDate(cursor))) {
			streak++;
			cursor.setDate(cursor.getDate() - 1);
		}
		return streak;
	}

	/** Completion rate over the last 30 days as a 0-100 integer. The
	 *  denominator is min(30, days since the habit was created, inclusive) so
	 *  a brand-new habit shows 100% on its first check-in, not 3%. */
	getRate30(habitId: string): number {
		const habit = this.data.habits.find(h => h.id === habitId);
		const today = todayStr();
		const start = habit ? habit.createdAt : today;
		const span = Math.min(30, daysBetween(start, today) + 1);
		if (!Number.isFinite(span) || span <= 0) return 0;

		let done = 0;
		const cursor = new Date();
		for (let i = 0; i < span; i++) {
			if (this.data.records[formatDate(cursor)]?.includes(habitId)) done++;
			cursor.setDate(cursor.getDate() - 1);
		}
		return Math.round((done / span) * 100);
	}

	/** Total days this habit has ever been checked (survives rate windows). */
	getTotal(habitId: string): number {
		return Object.values(this.data.records)
			.filter(ids => ids.includes(habitId))
			.length;
	}

	/** Daily completion series, oldest→today, `days` long. The target 'all'
	 *  counts completed habits per day; any other string is a habit id and
	 *  yields a 0/1 series. */
	getHeatmapDays(target: string, days: number): number[] {
		const series: number[] = [];
		const cursor = new Date();
		cursor.setDate(cursor.getDate() - (days - 1));
		for (let i = 0; i < days; i++) {
			const ids = this.data.records[formatDate(cursor)] ?? [];
			if (target === 'all') {
				series.push(ids.length);
			} else {
				series.push(ids.includes(target) ? 1 : 0);
			}
			cursor.setDate(cursor.getDate() + 1);
		}
		return series;
	}
}
