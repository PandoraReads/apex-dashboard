import { requestUrl } from 'obsidian';

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

export interface WereadBook {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	progress: number;       // 0-100 (100 = finished)
	readingTime?: number;   // seconds
	finished?: boolean;
	/** Reading state derived from progress: notStarted / reading / finished. */
	readingState?: 'notStarted' | 'reading' | 'finished';
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

export interface WereadStats {
	totalReadTime: number;   // seconds
	dayAverageReadTime: number;
	readDays: number;
}

export interface WereadSectionData {
	books: WereadBook[];
	notebooks: WereadNotebook[];
	bookmarks: WereadBookmark[];
	stats: WereadStats | null;
}

export class WereadClient {
	private readonly apiKey: string;
	private readonly cache = new Map<string, { ts: number; data: unknown }>();
	private static readonly TTL_MS = 60_000;

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
		const cacheKey = `${apiName}:${JSON.stringify(params)}`;
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.ts < WereadClient.TTL_MS) {
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

			if (status === 401 || status === 403) throw new Error('WRONG_KEY');
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

	async fetchReadData(mode: 'weekly' | 'monthly' | 'annually' | 'overall' = 'overall'): Promise<WereadStats> {
		const data = await this.request<{ totalReadTime?: number; dayAverageReadTime?: number; readDays?: number }>(
			'/readdata/detail', { mode },
		);
		return {
			totalReadTime: numOr(data.totalReadTime, 0),
			dayAverageReadTime: numOr(data.dayAverageReadTime, 0),
			readDays: numOr(data.readDays, 0),
		};
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

	/** Per-book reading progress (0-100). Shelf data lacks this, so it is fetched per book. */
	async fetchProgress(bookId: string): Promise<number> {
		const data = await this.request<{ progress?: number; readPercent?: number } & Record<string, unknown>>('/book/getprogress', { bookId });
		const raw = data.progress ?? data.readPercent;
		return clampPct(numOr(raw, 0));
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
	markStatus?: number;
	category?: string | number;
	readingTime?: number;
	recordReadingTime?: number;
	[index: string]: unknown;
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

function parseShelf(data: { books?: ShelfBookRaw[]; albums?: Array<Record<string, unknown>>; mp?: Record<string, unknown> }): WereadBook[] {
	const rawBooks = data.books ?? [];
	const out: WereadBook[] = [];

	for (const b of rawBooks) {
		const progressRaw = b.progress ?? b.readPercent ?? b.readProgress;
		const progress = clampPct(numOr(progressRaw, 0));
		const category = bigCategory(b.bigCategory ?? b.categoryParent ?? b.category);
		out.push({
			bookId: String(b.bookId ?? ''),
			title: String(b.title ?? ''),
			author: String(b.author ?? ''),
			cover: b.cover,
			progress,
			readingState: deriveState(progress, b.finished, b.markStatus),
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
			category: 'Articles',
		});
	}

	return out.filter(b => b.bookId.length > 0 && b.title.length > 0);
}

function deriveState(progress: number, finished?: number, markStatus?: number): 'notStarted' | 'reading' | 'finished' {
	if (finished === 1 || markStatus === 1 || progress >= 100) return 'finished';
	if (progress > 0) return 'reading';
	return 'notStarted';
}

/** Take the top-level category from a possibly-hierarchical value (e.g. "大类/小类"). */
function bigCategory(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const top = raw.split(/[/>]/)[0]!.trim();
	return top.length > 0 ? top : undefined;
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
