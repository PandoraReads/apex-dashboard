import type { App } from 'obsidian';
import type { WereadReadingState } from './weread-shelf-model';

/**
 * Cross-session persistence for per-book weread progress
 * (`.obsidian/plugins/apex-dashboard/weread-progress.json`, expense.json /
 * habits.json pattern). Without it every Obsidian start re-fired the
 * /book/getprogress burst for the whole reading subset — the gateway bans for
 * 30-60 min once tripped, so a daily-opened dashboard kept the limit armed
 * permanently.
 *
 * An entry counts as fresh for {@link PROGRESS_FRESH_MS}; fresh entries stand
 * in for the network call. The header refresh button bypasses freshness
 * (force). External writers (iCloud sync, another device) merge per bookId
 * with the newest fetch timestamp winning, so no device clobbers another.
 */

const DATA_FILE = 'weread-progress.json';

/** How long a persisted progress entry stands in for a network call. */
export const PROGRESS_FRESH_MS = 6 * 60 * 60_000;
/** Drop entries untouched for this long — books long gone from the shelf. */
const PRUNE_AFTER_MS = 180 * 24 * 60 * 60_000;

export interface WereadProgressEntry {
	progress: number;
	readingState: WereadReadingState;
	readingTime?: number;
	lastReadTime?: number;
	/** When the gateway returned this entry. */
	ts: number;
}

interface ProgressFile {
	version: 1;
	entries: Record<string, WereadProgressEntry>;
}

const emptyFile = (): ProgressFile => ({ version: 1, entries: {} });

function normalizeEntry(raw: unknown): WereadProgressEntry | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const e = raw as Record<string, unknown>;
	const progress = typeof e['progress'] === 'number' ? e['progress'] : NaN;
	const state = e['readingState'];
	if (!(progress >= 0 && progress <= 100)) return null;
	if (state !== 'notStarted' && state !== 'reading' && state !== 'finished') return null;
	const ts = typeof e['ts'] === 'number' && e['ts'] > 0 ? e['ts'] : 0;
	return {
		progress: Math.round(progress),
		readingState: state,
		readingTime: typeof e['readingTime'] === 'number' ? e['readingTime'] : undefined,
		lastReadTime: typeof e['lastReadTime'] === 'number' ? e['lastReadTime'] : undefined,
		ts,
	};
}

/** Validate an unknown parsed file body; malformed pieces drop out silently. */
export function normalizeProgressFile(raw: unknown): ProgressFile {
	const out = emptyFile();
	if (typeof raw !== 'object' || raw === null) return out;
	const entries = (raw as Record<string, unknown>)['entries'];
	if (typeof entries !== 'object' || entries === null) return out;
	for (const [bookId, value] of Object.entries(entries as Record<string, unknown>)) {
		const entry = normalizeEntry(value);
		if (entry) out.entries[bookId] = entry;
	}
	return out;
}

/** Union by bookId; the entry with the newer fetch `ts` wins. */
export function mergeProgressFiles(base: ProgressFile, overlay: ProgressFile): ProgressFile {
	const out = emptyFile();
	for (const [id, entry] of Object.entries(base.entries)) out.entries[id] = entry;
	for (const [id, entry] of Object.entries(overlay.entries)) {
		const existing = out.entries[id];
		if (!existing || entry.ts >= existing.ts) out.entries[id] = entry;
	}
	return out;
}

export class WereadProgressStore {
	private file: ProgressFile = emptyFile();
	private loaded = false;
	private lastWritten: string | null = null;
	/** Serialized write queue — at most one write ever in flight. */
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(private readonly app: App) {}

	private get path(): string {
		return `${this.app.vault.configDir}/plugins/apex-dashboard/${DATA_FILE}`;
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const raw = await this.app.vault.adapter.read(this.path);
			this.file = normalizeProgressFile(JSON.parse(raw));
			this.lastWritten = raw;
		} catch {
			this.file = emptyFile();
			this.lastWritten = null;
		}
	}

	entry(bookId: string): WereadProgressEntry | undefined {
		return this.file.entries[bookId];
	}

	/** The entry for `bookId` when fetched within the freshness window. */
	freshEntry(bookId: string, now = Date.now()): WereadProgressEntry | undefined {
		const entry = this.file.entries[bookId];
		return entry && entry.ts > 0 && now - entry.ts < PROGRESS_FRESH_MS ? entry : undefined;
	}

	/** Merge fetched entries (newest ts wins) and queue a debounced save. */
	put(entries: Record<string, WereadProgressEntry>): void {
		if (Object.keys(entries).length === 0) return;
		this.file = mergeProgressFiles(this.file, { version: 1, entries });
		this.prune(Date.now());
		this.saveQueue = this.saveQueue.then(() => this.persist());
	}

	/** Bound growth: entries older than the prune window drop out. */
	private prune(now: number): void {
		const kept: Record<string, WereadProgressEntry> = {};
		for (const [id, entry] of Object.entries(this.file.entries)) {
			if (entry.ts > 0 && now - entry.ts < PRUNE_AFTER_MS) kept[id] = entry;
		}
		this.file = { version: 1, entries: kept };
	}

	private async persist(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const path = this.path;
			// Merge the disk state first when someone else wrote since our last
			// write — blind full-file saves revert the other device's entries.
			try {
				const raw = await adapter.read(path);
				if (raw !== this.lastWritten) {
					this.file = mergeProgressFiles(normalizeProgressFile(JSON.parse(raw)), this.file);
				}
			} catch {
				// No file yet (or unreadable): write our state as-is.
			}
			const json = JSON.stringify(this.file);
			await adapter.write(path, json);
			this.lastWritten = json;
		} catch {
			// silent fail: an unwriteable file must not break rendering
		}
	}
}

let store: WereadProgressStore | null = null;

/** App-session singleton — every weread section render shares one store. */
export function getWereadProgressStore(app: App): WereadProgressStore {
	if (!store) store = new WereadProgressStore(app);
	return store;
}
