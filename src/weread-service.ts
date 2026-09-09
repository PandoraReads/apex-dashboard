import { requestUrl } from 'obsidian';
import { t } from './i18n';
import type {
	WereadContentType,
	WereadFacetedBook,
	WereadReadingState,
} from './weread-shelf-model';

/**
 * Weread (WeChat Read) client for the official Agent Skill API.
 *
 * The official API is a single POST gateway: every capability is selected by an
 * `api_name` field in the JSON body, authenticated with a `wrk-` bearer key.
 * Source: shiquda/weread-cli (which wraps this same gateway).
 *
 *   POST https://i.weread.qq.com/api/agent/gateway
 *   Authorization: Bearer wrk-...
 *   { "api_name": "/shelf/sync", "skill_version": "1.0.4", ...params }
 *
 * Responses are wrapped as { ok, api_name, data }. We surface `data` and throw
 * on `data.errcode` / `data.upgrade_info` / non-ok. requestUrl bypasses CORS, so
 * this works on both desktop and mobile.
 */

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.4';
const MAX_RETRIES = 3;

/** Per-endpoint rate-limit cooldowns (circuit breaker state, app-session scope). */
const cooldowns = new Map<string, number>();
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

/**
 * One client per key for the whole app session. The dashboard re-renders on
 * every edit elsewhere, and a fresh client per render threw away the response
 * cache — so each re-render re-fired the whole per-book progress burst, which
 * is what kept the gateway rate limit permanently armed. Sharing the client
 * keeps the cache (and cooldowns) alive across renders; the header refresh
 * button still clears the cache via clearCache() for a manual fresh fetch.
 */
const sharedClients = new Map<string, WereadClient>();

export function sharedWereadClient(apiKey: string): WereadClient {
	const key = apiKey.trim();
	let client = sharedClients.get(key);
	if (!client) {
		client = new WereadClient(key);
		sharedClients.set(key, client);
	}
	return client;
}

export interface WereadBook extends WereadFacetedBook {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	progress: number;       // 0-100 (100 = finished)
	readingTime?: number;   // seconds
	finished?: boolean;
	/** Reading state derived from progress: notStarted / reading / finished. */
	readingState: WereadReadingState;
	/** Stable shelf item class exposed by /shelf/sync. */
	contentType: WereadContentType;
	/** Latest known reading/update timestamp, normalized to milliseconds. */
	lastReadTime?: number;
	/** Top-level book category/genre, if present in the shelf payload. */
	category?: string;
}

export interface WereadNotebook {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	noteCount: number;      // highlights
	bookmarkCount: number;
	reviewCount: number;
}

export interface WereadBookmark {
	bookId: string;
	chapterUid?: number;
	markText: string;
}

export type WereadStatMode = 'weekly' | 'monthly' | 'annually' | 'overall';

/** One entry of `readStat[]` — display strings straight from the API
 *  (stat: 读过/读完/阅读/笔记, counts: "12本"/"45天"/"120条"). */
export interface WereadReadStatItem {
	stat: string;
	counts: string;
}

/** One entry of `readLongest[]` — top read book or audio album. */
export interface WereadTopReadItem {
	title: string;
	author?: string;
	/** Seconds read in the requested period. */
	readTime: number;
	tags?: string[];
}

/** One entry of `preferCategory[]`. `val` is the API's chart-normalized
 *  weight (max category = 1); readingTime is seconds. */
export interface WereadPreferCategoryItem {
	title: string;
	val: number;
	readingTime: number;
	readingCount: number;
}

/** Parsed /readdata/detail payload. Every extended field is optional at the
 *  API level (returned per mode and data thresholds), so absent data arrives
 *  as empty arrays / undefined and the UI hides or dashes those slots. */
export interface WereadReadStats {
	mode: WereadStatMode;
	/** Total read/listen seconds for the period (authoritative total). */
	totalReadTime: number;
	/** Effective reading days (server rule: >= 1 minute in a day). */
	readDays: number;
	/** Natural-day average seconds (denominator = elapsed days, not readDays). */
	dayAverageReadTime: number;
	/** Delta ratio of the day average vs the previous period (0.2 = +20%). */
	compare?: number;
	readStat: WereadReadStatItem[];
	/** Bucketed series (ascending): weekly/monthly = per day, annually = per
	 *  month, overall = per year. Keys are bucket-start timestamps. */
	readTimes: Array<{ ts: number; seconds: number }>;
	/** Per-day detail the annually mode may return (`dailyReadTimes`); needed
	 *  for day-level lookups (e.g. "seconds read today") where readTimes is
	 *  monthly-grained. */
	dailyReadTimes: Array<{ ts: number; seconds: number }>;
	readLongest: WereadTopReadItem[];
	preferCategory: WereadPreferCategoryItem[];
}

export class WereadClient {
	private readonly apiKey: string;
	private readonly cache = new Map<string, { ts: number; data: unknown }>();
	private static readonly TTL_MS = 60_000;
	/** Progress moves slowly; caching /book/getprogress for 15 min means
	 *  re-renders (which happen on every dashboard edit) stop re-firing the
	 *  per-book burst that chronically tripped the gateway rate limit. */
	private static readonly TTL_BY_API: Record<string, number> = {
		'/book/getprogress': 15 * 60_000,
	};

	constructor(apiKey: string) {
		this.apiKey = apiKey.trim();
	}

	isConfigured(): boolean {
		return this.apiKey.length > 0 && this.apiKey.startsWith('wrk-');
	}

	/** Raw gateway call. Throws on API error, upgrade required, or network failure. */
	private async request<T>(apiName: string, params: Record<string, unknown> = {}): Promise<T> {
		if (!this.isConfigured()) {
			throw new Error('WRONG_KEY');
		}
		// Circuit breaker: the gateway bans for 30-60 min once tripped, and every
		// request during the ban extends it. Fail fast (no network) for a short
		// window instead, so re-renders stop feeding the ban.
		if (Date.now() < (cooldowns.get(apiName) ?? 0)) throw new Error('RATE_LIMITED');
		const cacheKey = `${apiName}:${JSON.stringify(params)}`;
		const cached = this.cache.get(cacheKey);
		const ttl = WereadClient.TTL_BY_API[apiName] ?? WereadClient.TTL_MS;
		if (cached && Date.now() - cached.ts < ttl) {
			return cached.data as T;
		}

		const body = JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params });
		let lastErr: unknown = null;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			let res;
			try {
				res = await requestUrl({
					url: GATEWAY_URL,
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					body,
					throw: false,
				});
			} catch (e) {
				// Network-level failure (DNS/CORS/abort) — retry.
				lastErr = new Error(`NETWORK:${e instanceof Error ? e.message : 'error'}`);
				await sleep(150 * attempt);
				continue;
			}

			const status = res.status;
			const text = typeof res.text === 'string' ? res.text : '';
			let parsed: unknown = null;
			try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

			// 401 = genuine auth failure. 403/499 during bursts are the gateway's
			// rate limit (observed to spread across endpoints for 30-60 min) —
			// mapping those to WRONG_KEY showed a misleading "invalid key" hint.
			// The cooldown entry arms the circuit breaker above.
			if (status === 401) throw new Error('WRONG_KEY');
			if (status === 403 || status === 499) {
				cooldowns.set(apiName, Date.now() + RATE_LIMIT_COOLDOWN_MS);
				throw new Error('RATE_LIMITED');
			}
			if (status >= 400) throw new Error(`HTTP_${status}:${text.slice(0, 120)}`);

			// The gateway may wrap as { ok, data } OR return the payload directly;
			// tolerate both so a shape mismatch doesn't mask the real data.
			const obj = parsed as Record<string, unknown> | null;
			if (obj && obj['ok'] === false) {
				const okErr = obj['errmsg'] ?? obj['errcode'];
			throw new Error(`API:${typeof okErr === 'string' || typeof okErr === 'number' ? okErr : 'rejected'}`);
			}
			const data = (obj && obj['data'] && typeof obj['data'] === 'object')
				? obj['data'] as Record<string, unknown>
				: (obj ?? {});
			// The gateway may signal errors via a non-zero `errcode` even on HTTP 200.
			if (data && typeof data['errcode'] === 'number' && data['errcode'] !== 0) {
				const errPart = data['errmsg'] ?? data['errcode'];
			throw new Error(`API:${typeof errPart === 'string' || typeof errPart === 'number' ? errPart : 'rejected'}`);
			}
			// Skill version too old: carry the official upgrade hint forward so the
			// UI can show it instead of a bare "upgrade required".
			const upgrade = data ? data['upgrade_info'] : undefined;
			if (upgrade) {
				const msg = typeof upgrade === 'object' && upgrade !== null
					? (upgrade as Record<string, unknown>)['message']
					: upgrade;
				throw new Error(typeof msg === 'string' && msg ? `UPGRADE_REQUIRED:${msg}` : 'UPGRADE_REQUIRED');
			}

			this.cache.set(cacheKey, { ts: Date.now(), data });
			return data as unknown as T;
		}
		throw lastErr instanceof Error ? lastErr : new Error('NETWORK_ERROR');
	}

	async fetchShelf(): Promise<WereadBook[]> {
		const data = await this.request<{ books?: ShelfBookRaw[]; albums?: Array<Record<string, unknown>>; mp?: Record<string, unknown> }>('/shelf/sync');
		return parseShelf(data);
	}

	/**
	 * Rich reading statistics for one natural period. All time fields are
	 * SECONDS (the API doc forbids inferring units from field names); extended
	 * profile fields are optional per mode/data thresholds and arrive as empty
	 * arrays when absent. `baseTime` selects a historical period (a timestamp
	 * inside it; the server normalizes to the period start). Cached per
	 * mode+baseTime like every other call.
	 */
	async fetchReadStats(mode: WereadStatMode = 'monthly', baseTime?: number): Promise<WereadReadStats> {
		const params: Record<string, unknown> = { mode };
		if (baseTime !== undefined) params['baseTime'] = baseTime;
		const data = await this.request<Record<string, unknown>>('/readdata/detail', params);
		return parseReadStats(data, mode);
	}

	async fetchNotebooks(): Promise<WereadNotebook[]> {
		const data = await this.request<{ books?: NotebookRaw[]; totalBookCount?: number; hasMore?: number }>(
			'/user/notebooks', { count: 100 },
		);
		return (data.books ?? []).map(parseNotebook).filter((b): b is WereadNotebook => b !== null);
	}

	async fetchBookmarks(bookId: string): Promise<WereadBookmark[]> {
		const data = await this.request<{ updated?: BookmarkRaw[] }>('/book/bookmarklist', { bookId });
		return (data.updated ?? []).map(b => ({
			bookId,
			chapterUid: typeof b.chapterUid === 'number' ? b.chapterUid : undefined,
			markText: String(b.markText ?? ''),
		})).filter(b => b.markText.length > 0);
	}

	/**
	 * Per-book reading progress (0-100). Shelf data lacks this, so it is fetched
	 * per book. The payload nests progress under `book` — see {@link GetProgressRaw}.
	 */
	async fetchProgress(bookId: string): Promise<number> {
		return (await this.fetchProgressDetails(bookId)).progress;
	}

	async fetchProgressDetails(bookId: string): Promise<WereadProgressDetails> {
		const data = await this.request<GetProgressRaw>('/book/getprogress', { bookId });
		return progressDetailsFromGetProgress(data);
	}

	clearCache(): void {
		this.cache.clear();
	}
}

interface ShelfBookRaw {
	bookId?: string;
	title?: string;
	author?: string;
	cover?: string;
	progress?: number;
	readPercent?: number;
	readProgress?: number;
	finished?: number;
	/** Official shelf API's "是否读完" flag (0/1) — more reliable than `finished`. */
	finishReading?: number;
	markStatus?: number;
	category?: string | number;
	readingTime?: number;
	recordReadingTime?: number;
	lastReadTime?: number;
	readUpdateTime?: number;
	updateTime?: number;
	finishReadingTime?: number;
	sort?: number;
	[index: string]: unknown;
}

/**
 * /book/getprogress payload. Progress nests under `book.progress` — the flat
 * `data.progress` the old code read is absent from the real response, which is
 * why progress always came back 0. Flat fields stay as fallbacks for gateway
 * shape drift.
 */
export interface GetProgressRaw {
	book?: {
		progress?: number;
		readProgress?: number;
		readPercent?: number;
		recordReadingTime?: number;
		updateTime?: number;
	};
	/** Legacy flat fields; checked only after `book`. */
	progress?: number;
	readPercent?: number;
}

/** Extract 0-100 progress from a /book/getprogress payload. */
export function progressFromGetProgress(raw: GetProgressRaw): number {
	const book = raw.book;
	const v = book?.progress ?? book?.readProgress ?? book?.readPercent ?? raw.progress ?? raw.readPercent;
	return clampPct(numOr(v, 0));
}

export interface WereadProgressDetails {
	progress: number;
	readingTime?: number;
	lastReadTime?: number;
}

export function progressDetailsFromGetProgress(raw: GetProgressRaw): WereadProgressDetails {
	const book = raw.book;
	return {
		progress: progressFromGetProgress(raw),
		readingTime: optionalNumber(book?.recordReadingTime),
		lastReadTime: latestTimestampMs(book?.updateTime),
	};
}

interface NotebookRaw {
	bookId?: string;
	book?: { title?: string; author?: string; bookId?: string; cover?: string };
	noteCount?: number;
	bookmarkCount?: number;
	reviewCount?: number;
}

interface BookmarkRaw {
	chapterUid?: number;
	markText?: string;
}

/** Exported for the weread progress verify script (shelf → state mapping). */
export function parseShelf(data: { books?: ShelfBookRaw[]; albums?: Array<Record<string, unknown>>; mp?: Record<string, unknown> }): WereadBook[] {
	const rawBooks = data.books ?? [];
	const out: WereadBook[] = [];

	for (const b of rawBooks) {
		const progressRaw = b.progress ?? b.readPercent ?? b.readProgress;
		const finishedFlag = b.finished === 1 || b.finishReading === 1 || b.markStatus === 1;
		// Finished books the shelf reports without a percent still deserve a full
		// bar rather than a misleading 0% (the precise position arrives via
		// getprogress enrichment).
		const progress = progressRaw == null && finishedFlag ? 100 : clampPct(numOr(progressRaw, 0));
		const category = bigCategory(b.bigCategory ?? b.categoryParent ?? b.category);
		out.push({
			bookId: String(b.bookId ?? ''),
			title: String(b.title ?? ''),
			author: String(b.author ?? ''),
			cover: b.cover,
			progress,
			readingState: deriveState(progress, finishedFlag),
			contentType: 'book',
			lastReadTime: latestTimestampMs(b.lastReadTime, b.readUpdateTime, b.updateTime, b.finishReadingTime, b.sort),
			category,
			readingTime: numOr(b.recordReadingTime ?? b.readingTime, 0),
		});
	}

	// Audiobooks (albums): nested under albumInfo.
	for (const a of data.albums ?? []) {
		const info = (a['albumInfo'] ?? {}) as Record<string, unknown>;
		const id = str(info['albumId']);
		const title = str(info['name']);
		if (!id || !title) continue;
		out.push({
			bookId: id,
			title,
			author: str(info['authorName']),
			cover: typeof info['cover'] === 'string' ? info['cover'] : undefined,
			progress: 0,
			readingState: 'notStarted',
			contentType: 'audio',
			lastReadTime: latestTimestampMs(
				a['lastReadTime'],
				a['readUpdateTime'],
				a['updateTime'],
				info['updateTime'],
			),
			category: 'Audiobook',
		});
	}

	// Article collection (mp): a single shelf entry.
	const mp = data.mp;
	if (mp && mp['show'] === 1) {
		const book = (mp['book'] ?? {}) as Record<string, unknown>;
		out.push({
			bookId: str(book['bookId']) || 'mp',
			title: str(book['title']) || 'Articles',
			author: '',
			cover: typeof book['cover'] === 'string' ? book['cover'] : undefined,
			progress: 0,
			readingState: 'notStarted',
			contentType: 'article',
			lastReadTime: latestTimestampMs(mp['updateTime'], book['updateTime']),
			category: 'Articles',
		});
	}

	return out.filter(b => b.bookId.length > 0 && b.title.length > 0);
}

function deriveState(progress: number, finishedFlag: boolean): WereadReadingState {
	if (finishedFlag || progress >= 100) return 'finished';
	if (progress > 0) return 'reading';
	return 'notStarted';
}

/** Take the top-level category from a possibly-hierarchical value (e.g. "大类/小类"). */
function bigCategory(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const top = raw.split(/[/>]/)[0]!.trim();
	return top.length > 0 ? top : undefined;
}

/** Exported for the stats verify script. Tolerant to gateway shape drift:
 *  unknown/absent fields degrade to empty arrays, never throw. */
export function parseReadStats(data: Record<string, unknown>, mode: WereadStatMode): WereadReadStats {
	// readTimes / dailyReadTimes: objects keyed by timestamp -> seconds. Keys
	// may arrive as seconds or ms timestamps; normalize to ms and sort.
	const parseSeries = (raw: unknown): Array<{ ts: number; seconds: number }> => {
		const out: Array<{ ts: number; seconds: number }> = [];
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
				const key = Number(k);
				if (!Number.isFinite(key)) continue;
				out.push({ ts: key < 1e12 ? key * 1000 : key, seconds: numOr(v, 0) });
			}
			out.sort((a, b) => a.ts - b.ts);
		}
		return out;
	};
	const readTimes = parseSeries(data['readTimes']);
	const dailyReadTimes = parseSeries(data['dailyReadTimes']);

	const readStat: WereadReadStatItem[] = Array.isArray(data['readStat'])
		? (data['readStat'] as Array<Record<string, unknown>>)
			.map(s => ({ stat: str(s['stat']), counts: str(s['counts']) }))
			.filter(s => s.stat.length > 0 && s.counts.length > 0)
		: [];

	const readLongest: WereadTopReadItem[] = Array.isArray(data['readLongest'])
		? (data['readLongest'] as Array<Record<string, unknown>>).map(item => {
			const book = (item['book'] ?? item['albumInfo'] ?? {}) as Record<string, unknown>;
			return {
				title: str(book['title'] || book['name']),
				author: str(book['author'] || book['authorName']) || undefined,
				readTime: numOr(item['readTime'], 0),
				tags: Array.isArray(item['tags'])
					? (item['tags'] as unknown[]).map(str).filter(s => s.length > 0)
					: undefined,
			};
		}).filter(b => b.title.length > 0)
		: [];

	const preferCategory: WereadPreferCategoryItem[] = Array.isArray(data['preferCategory'])
		? (data['preferCategory'] as Array<Record<string, unknown>>).map(c => ({
			title: str(c['categoryTitle']) || str(c['parentCategoryTitle']),
			val: numOr(c['val'], 0),
			readingTime: numOr(c['readingTime'], 0),
			readingCount: numOr(c['readingCount'], 0),
		})).filter(c => c.title.length > 0)
		: [];

	const compareRaw = data['compare'];
	return {
		mode,
		totalReadTime: numOr(data['totalReadTime'], 0),
		readDays: numOr(data['readDays'], 0),
		dayAverageReadTime: numOr(data['dayAverageReadTime'], 0),
		compare: typeof compareRaw === 'number' && Number.isFinite(compareRaw) ? compareRaw : undefined,
		readStat,
		readTimes,
		dailyReadTimes,
		readLongest,
		preferCategory,
	};
}

/**
 * Consecutive-day streaks from a DAILY readTimes series (weekly/monthly modes
 * only — annually/overall buckets are coarser). Uses the server's own
 * "effective reading day" rule (>= 60 seconds) so the streak agrees with
 * readDays. `current` is the run ending at the most recent non-future bucket;
 * if that bucket has not qualified yet (today, still early), the run ending
 * yesterday counts — the streak is alive until midnight.
 */
export function computeReadStreaks(
	buckets: ReadonlyArray<{ ts: number; seconds: number }>,
	now = Date.now(),
	thresholdSeconds = 60,
): { current: number; longest: number } {
	if (buckets.length === 0) return { current: 0, longest: 0 };
	// Only buckets that have already elapsed count — a weekly series fetched
	// mid-week carries future days, and a streak including days that have not
	// happened yet is a prediction, not a record.
	let lastIdx = -1;
	for (let i = 0; i < buckets.length; i++) {
		if (buckets[i]!.ts <= now) lastIdx = i;
	}
	if (lastIdx < 0) return { current: 0, longest: 0 };
	const qualified = buckets.map(b => b.seconds >= thresholdSeconds);
	let longest = 0;
	let run = 0;
	for (let i = 0; i <= lastIdx; i++) {
		run = qualified[i] ? run + 1 : 0;
		if (run > longest) longest = run;
	}
	const runEndingAt = (idx: number): number => {
		let n = 0;
		for (let i = idx; i >= 0 && qualified[i]; i--) n++;
		return n;
	};
	const current = qualified[lastIdx] ? runEndingAt(lastIdx) : runEndingAt(lastIdx - 1);
	return { current, longest };
}

/** X-axis label for one readTimes bucket. Weekly = weekday, monthly = day of
 *  month, annually = month, overall = year. */
export function bucketLabel(ts: number, mode: WereadStatMode): string {
	const d = new Date(ts);
	if (mode === 'weekly') {
		// getDay(): 0=Sun..6=Sat; the weekly series starts Monday.
		const names = ['日', '一', '二', '三', '四', '五', '六'];
		return names[d.getDay()] ?? '';
	}
	if (mode === 'monthly') return String(d.getDate());
	if (mode === 'annually') return `${d.getMonth() + 1}月`;
	return String(d.getFullYear());
}

/** The stats heatmap always shows a rolling window of this many days. */
export const HEATMAP_WINDOW_DAYS = 365;

export interface WereadHeatmapCell {
	/** Local midnight of the day. */
	ts: number;
	/** False for the alignment blanks before the window starts (the grid
	 *  begins on the Monday on/before the window start, GitHub-style). */
	inWindow: boolean;
	/** Seconds read that day; 0 when no bucket exists. */
	seconds: number;
	isToday: boolean;
}

/**
 * Day cells for the rolling {@link HEATMAP_WINDOW_DAYS} heatmap: one cell per
 * day from the Monday on/before the window start through today, column-major
 * weeks (7 rows). Date arithmetic goes through Date#setDate so DST shifts
 * cannot drift cells across midnight. Exported for the stats verify script.
 */
export function buildHeatmapCells(
	buckets: ReadonlyArray<{ ts: number; seconds: number }>,
	now = Date.now(),
): WereadHeatmapCell[] {
	const DAY_MS = 86_400_000;
	const dayStart = (ts: number): number => {
		const d = new Date(ts);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	};
	const key = (ts: number): string => {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	};
	const secondsByDay = new Map(buckets.map(b => [key(b.ts), b.seconds]));
	const todayStart = dayStart(now);
	const windowStart = todayStart - (HEATMAP_WINDOW_DAYS - 1) * DAY_MS;
	const startDow = new Date(windowStart).getDay(); // 0=Sun..6=Sat
	const gridStart = windowStart - ((startDow + 6) % 7) * DAY_MS;

	const cells: WereadHeatmapCell[] = [];
	for (let d = new Date(gridStart); d.getTime() <= todayStart; d.setDate(d.getDate() + 1)) {
		const ts = d.getTime();
		const inWindow = ts >= windowStart;
		cells.push({
			ts,
			inWindow,
			seconds: inWindow ? (secondsByDay.get(key(ts)) ?? 0) : 0,
			isToday: ts === todayStart,
		});
	}
	return cells;
}

function parseNotebook(raw: NotebookRaw): WereadNotebook | null {
	const book = raw.book;
	if (!book) return null;
	return {
		bookId: String(raw.bookId ?? book.bookId ?? ''),
		title: String(book.title ?? ''),
		author: String(book.author ?? ''),
		cover: book.cover,
		noteCount: numOr(raw.noteCount, 0),
		bookmarkCount: numOr(raw.bookmarkCount, 0),
		reviewCount: numOr(raw.reviewCount, 0),
	};
}

function numOr(v: unknown, d: number): number {
	return typeof v === 'number' && !isNaN(v) ? v : d;
}

function optionalNumber(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function latestTimestampMs(...values: unknown[]): number | undefined {
	const timestamps = values
		.map(optionalNumber)
		.filter((value): value is number => value !== undefined && value > 0)
		.map(value => value < 1_000_000_000_000 ? value * 1000 : value);
	return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function str(v: unknown): string {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

function clampPct(n: number): number {
	// progress of 1 means 1%, not finished; only 100 = finished.
	return Math.max(0, Math.min(100, Math.round(n)));
}

function sleep(ms: number): Promise<void> {
	return new Promise(r => window.setTimeout(r, ms));
}

/** Distinct, non-empty shelf categories (so the config modal can list the user's real ones). */
export async function fetchWereadCategories(apiKey: string): Promise<string[]> {
	const client = new WereadClient(apiKey);
	if (!client.isConfigured()) return [];
	try {
		const books = await client.fetchShelf();
		const set = new Set<string>();
		for (const b of books) {
			if (b.category && b.category.length > 0) set.add(b.category);
		}
		return [...set].sort();
	} catch {
		return [];
	}
}

/** Format a seconds value into a compact human-readable duration. */
export function formatReadTime(seconds: number): string {
	if (seconds <= 0) return '0m';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m}m`;
}

/**
 * Map a thrown gateway/network error to a user-facing message. Shared by the
 * section renderer and the stats widget so both surfaces word failures the
 * same way. RATE_LIMITED is distinct from WRONG_KEY: 403/499 bursts are the
 * gateway's rate limit, and calling that "invalid key" sends users chasing
 * a key that is fine.
 */
export function wereadErrorMessage(err: unknown): string {
	const code = err instanceof Error ? err.message : '';
	if (code === 'WRONG_KEY') return t('weread.wrongKey');
	if (code === 'RATE_LIMITED') return t('weread.rateLimited');
	if (code === 'UPGRADE_REQUIRED' || code.startsWith('UPGRADE_REQUIRED:')) {
		// Surface the official upgrade hint from `upgrade_info.message` (if any)
		// so the user sees what version / step the gateway asked for.
		const detail = code.startsWith('UPGRADE_REQUIRED:') ? code.slice('UPGRADE_REQUIRED:'.length) : '';
		return detail ? `${t('weread.upgradeRequired')} ${detail}` : t('weread.upgradeRequired');
	}
	if (code.startsWith('NETWORK')) return t('weread.networkError');
	return code || t('weread.loadFailed');
}
