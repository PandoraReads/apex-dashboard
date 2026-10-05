/**
 * Cross-session persistence for RSS sections
 * (`.obsidian/plugins/apex-dashboard/rss.json`, weread-progress.json /
 * habits.json pattern): cached feed payloads, read markers, saved-note paths
 * and web-extracted article markdown. Without it every dashboard open
 * re-fetched every feed and re-extracted every summary-only article.
 *
 * Freshness/merge rules follow weread-progress-store: an entry fetched within
 * {@link FEED_TTL_MS} stands in for the network call (manual refresh
 * bypasses); external writers (iCloud sync, another device) merge per key
 * with newest-wins semantics so no device clobbers another.
 */

import type { App } from 'obsidian';
import type { RssItem } from './rss-xml';

const DATA_FILE = 'rss.json';

/** How long a fetched feed stands in for the network call. */
export const FEED_TTL_MS = 30 * 60_000;
/** A failed fetch retries much sooner than a successful one. */
export const FEED_ERROR_TTL_MS = 5 * 60_000;
/** Items kept per feed (bounding rss.json against feed history). */
export const MAX_ITEMS_PER_FEED = 50;
/** Feeds kept at all (long-gone section configs age out). */
const MAX_FEEDS = 100;
/** Web-extracted markdown older than this drops out (re-extract on demand). */
const WEB_CACHE_PRUNE_MS = 30 * 24 * 60 * 60_000;
/** Read-marker retention, configurable via settings (days; 0 = forever).
 *  Defaults to the historical 180 days until main.ts pushes the setting. */
let readRetentionMs = 180 * 24 * 60 * 60_000;

/** Apply the user's retention setting (days; 0 = keep forever; undefined
 *  restores the 180-day default). */
export function setRssReadRetentionDays(days: number | undefined): void {
	readRetentionMs = days === 0 ? Number.POSITIVE_INFINITY
		: days && days > 0 ? days * 24 * 60 * 60_000
		: 180 * 24 * 60 * 60_000;
}

export interface RssFeedCacheEntry {
	title: string;
	/** Feed site home URL — the base for absolutizing relative article URLs. */
	link?: string;
	items: RssItem[];
	fetchedAt: number;
	/** Last fetch error message; presence makes the entry retry sooner. */
	error?: string;
}

interface RssStoreFile {
	version: 1;
	feeds: Record<string, RssFeedCacheEntry>;
	/** guid -> marked-read timestamp (epoch ms). */
	readGuids: Record<string, number>;
	/** guid -> vault path of the saved note. */
	savedGuids: Record<string, string>;
	/** guid -> web-extracted markdown + fetch time. */
	webCache: Record<string, { markdown: string; fetchedAt: number }>;
}

const emptyFile = (): RssStoreFile => ({ version: 1, feeds: {}, readGuids: {}, savedGuids: {}, webCache: {} });

/* ------------------------------ normalization ---------------------------- */

function normalizeItem(raw: unknown): RssItem | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const guid = typeof r['guid'] === 'string' ? r['guid'] : '';
	if (!guid) return null;
	return {
		guid,
		title: typeof r['title'] === 'string' && r['title'] ? r['title'] : '(untitled)',
		link: typeof r['link'] === 'string' ? r['link'] : '',
		author: typeof r['author'] === 'string' && r['author'] ? r['author'] : undefined,
		pubDate: typeof r['pubDate'] === 'number' && Number.isFinite(r['pubDate']) && r['pubDate'] > 0 ? r['pubDate'] : undefined,
		contentHtml: typeof r['contentHtml'] === 'string' && r['contentHtml'] ? r['contentHtml'] : undefined,
		summaryHtml: typeof r['summaryHtml'] === 'string' && r['summaryHtml'] ? r['summaryHtml'] : undefined,
	};
}

function normalizeFeedEntry(raw: unknown): RssFeedCacheEntry | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const fetchedAt = typeof r['fetchedAt'] === 'number' && r['fetchedAt'] > 0 ? r['fetchedAt'] : 0;
	if (fetchedAt <= 0) return null;
	const items = (Array.isArray(r['items']) ? r['items'] : [])
		.map(normalizeItem)
		.filter((item): item is RssItem => item !== null)
		.slice(0, MAX_ITEMS_PER_FEED);
	return {
		title: typeof r['title'] === 'string' ? r['title'] : '',
		link: typeof r['link'] === 'string' ? r['link'] : undefined,
		items,
		fetchedAt,
		error: typeof r['error'] === 'string' && r['error'] ? r['error'] : undefined,
	};
}

/** Validate an unknown parsed file body; malformed pieces drop out silently. */
export function normalizeRssFile(raw: unknown): RssStoreFile {
	const out = emptyFile();
	if (typeof raw !== 'object' || raw === null) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r['feeds'] === 'object' && r['feeds'] !== null) {
		for (const [url, value] of Object.entries(r['feeds'] as Record<string, unknown>)) {
			const entry = normalizeFeedEntry(value);
			if (entry) out.feeds[url] = entry;
		}
	}
	if (typeof r['readGuids'] === 'object' && r['readGuids'] !== null) {
		for (const [guid, ts] of Object.entries(r['readGuids'] as Record<string, unknown>)) {
			if (typeof ts === 'number' && ts > 0) out.readGuids[guid] = ts;
		}
	}
	if (typeof r['savedGuids'] === 'object' && r['savedGuids'] !== null) {
		for (const [guid, path] of Object.entries(r['savedGuids'] as Record<string, unknown>)) {
			if (typeof path === 'string' && path) out.savedGuids[guid] = path;
		}
	}
	if (typeof r['webCache'] === 'object' && r['webCache'] !== null) {
		for (const [guid, value] of Object.entries(r['webCache'] as Record<string, unknown>)) {
			if (typeof value !== 'object' || value === null) continue;
			const entry = value as Record<string, unknown>;
			const markdown = typeof entry['markdown'] === 'string' ? entry['markdown'] : '';
			const fetchedAt = typeof entry['fetchedAt'] === 'number' ? entry['fetchedAt'] : 0;
			if (markdown && fetchedAt > 0) out.webCache[guid] = { markdown, fetchedAt };
		}
	}
	return out;
}

/** Union/merge two file states: feeds & webCache by newest fetchedAt, guid
 *  maps by union (savedGuids: overlay wins a same-guid conflict). */
export function mergeRssFiles(base: RssStoreFile, overlay: RssStoreFile): RssStoreFile {
	const out = emptyFile();
	for (const [url, entry] of Object.entries(base.feeds)) out.feeds[url] = entry;
	for (const [url, entry] of Object.entries(overlay.feeds)) {
		const existing = out.feeds[url];
		if (!existing || entry.fetchedAt >= existing.fetchedAt) out.feeds[url] = entry;
	}
	for (const [guid, ts] of Object.entries(base.readGuids)) out.readGuids[guid] = ts;
	for (const [guid, ts] of Object.entries(overlay.readGuids)) {
		out.readGuids[guid] = Math.max(out.readGuids[guid] ?? 0, ts);
	}
	Object.assign(out.savedGuids, base.savedGuids, overlay.savedGuids);
	for (const [guid, entry] of Object.entries(base.webCache)) out.webCache[guid] = entry;
	for (const [guid, entry] of Object.entries(overlay.webCache)) {
		const existing = out.webCache[guid];
		if (!existing || entry.fetchedAt >= existing.fetchedAt) out.webCache[guid] = entry;
	}
	return out;
}

/* --------------------------------- store --------------------------------- */

export class RssStore {
	private file: RssStoreFile = emptyFile();
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
			this.file = normalizeRssFile(JSON.parse(raw));
			this.lastWritten = raw;
		} catch {
			this.file = emptyFile();
			this.lastWritten = null;
		}
	}

	/** Explicitly (re)load the disk state — the visibilitychange/focus re-read
	 *  path when another device may have written the file. */
	async reloadFromDisk(): Promise<void> {
		this.loaded = true;
		try {
			const raw = await this.app.vault.adapter.read(this.path);
			this.file = mergeRssFiles(normalizeRssFile(JSON.parse(raw)), this.file);
			this.lastWritten = raw;
		} catch {
			// No file yet (or unreadable): keep in-memory state.
		}
	}

	feedEntry(url: string): RssFeedCacheEntry | undefined {
		return this.file.feeds[url];
	}

	/** True when the entry is missing, stale, or (after an error) past the
	 *  short retry window — i.e. a fetch should run. */
	isStale(url: string, now = Date.now()): boolean {
		const entry = this.file.feeds[url];
		if (!entry) return true;
		const ttl = entry.error ? FEED_ERROR_TTL_MS : FEED_TTL_MS;
		return now - entry.fetchedAt >= ttl;
	}

	setFeed(url: string, entry: RssFeedCacheEntry): void {
		const next = { ...this.file.feeds };
		next[url] = { ...entry, items: entry.items.slice(0, MAX_ITEMS_PER_FEED) };
		this.file = { ...this.file, feeds: next };
		this.prune(Date.now());
		this.scheduleSave();
	}

	isRead(guid: string): boolean {
		return this.file.readGuids[guid] !== undefined;
	}

	markRead(guid: string): void {
		if (this.isRead(guid)) return;
		this.file = { ...this.file, readGuids: { ...this.file.readGuids, [guid]: Date.now() } };
		this.scheduleSave();
	}

	markAllRead(guids: readonly string[]): void {
		const next = { ...this.file.readGuids };
		const now = Date.now();
		let changed = false;
		for (const guid of guids) {
			if (next[guid] === undefined) {
				next[guid] = now;
				changed = true;
			}
		}
		if (!changed) return;
		this.file = { ...this.file, readGuids: next };
		this.scheduleSave();
	}

	savedPath(guid: string): string | undefined {
		return this.file.savedGuids[guid];
	}

	setSaved(guid: string, path: string): void {
		this.file = { ...this.file, savedGuids: { ...this.file.savedGuids, [guid]: path } };
		this.scheduleSave();
	}

	clearSaved(guid: string): void {
		if (this.file.savedGuids[guid] === undefined) return;
		const next = { ...this.file.savedGuids };
		delete next[guid];
		this.file = { ...this.file, savedGuids: next };
		this.scheduleSave();
	}

	cachedWeb(guid: string): string | undefined {
		return this.file.webCache[guid]?.markdown;
	}

	setCachedWeb(guid: string, markdown: string): void {
		this.file = { ...this.file, webCache: { ...this.file.webCache, [guid]: { markdown, fetchedAt: Date.now() } } };
		this.scheduleSave();
	}

	/** Bound growth: drop stale feeds, ancient web extractions and read
	 *  markers; keep saved-note paths (they gate re-download jumps). */
	private prune(now: number): void {
		let feeds = { ...this.file.feeds };
		const urls = Object.keys(feeds);
		if (urls.length > MAX_FEEDS) {
			const byAge = urls.sort((a, b) => feeds[b]!.fetchedAt - feeds[a]!.fetchedAt);
			for (const url of byAge.slice(MAX_FEEDS)) delete feeds[url];
		}
		const webCache: RssStoreFile['webCache'] = {};
		for (const [guid, entry] of Object.entries(this.file.webCache)) {
			if (now - entry.fetchedAt < WEB_CACHE_PRUNE_MS) webCache[guid] = entry;
		}
		const readGuids: RssStoreFile['readGuids'] = {};
		for (const [guid, ts] of Object.entries(this.file.readGuids)) {
			if (now - ts < readRetentionMs) readGuids[guid] = ts;
		}
		this.file = { ...this.file, feeds, webCache, readGuids };
	}

	private scheduleSave(): void {
		this.saveQueue = this.saveQueue.then(() => this.persist());
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
					this.file = mergeRssFiles(normalizeRssFile(JSON.parse(raw)), this.file);
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

let store: RssStore | null = null;

/** App-session singleton — every rss section render shares one store. */
export function getRssStore(app: App): RssStore {
	if (!store) store = new RssStore(app);
	return store;
}
