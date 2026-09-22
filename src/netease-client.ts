import { requestUrl } from 'obsidian';
import type { MusicTrack } from './types';

// ---------- API response shapes ----------
// `requestUrl(...).json` is typed `any`; these interfaces model NetEase's
// legacy web GET endpoints so structured access doesn't leak `any` downstream.

/** Raw song node shared by the search / playlist / song-detail endpoints. */
export interface NeteaseSong {
	id?: number;
	name?: string;
	duration?: number;
	fee?: number;
	artists?: { name?: string }[];
	album?: { name?: string; picUrl?: string };
}

interface NeteaseSearchResponse { result?: { songs?: NeteaseSong[] }; }

interface NeteasePlaylistResponse { result?: { name?: string; tracks?: NeteaseSong[] }; }

interface NeteaseSongDetailResponse { songs?: NeteaseSong[]; }

export interface NeteaseSongUrlEntry {
	freeTrialInfo?: unknown;
	url?: string | null;
	code?: number;
	br?: number;
	size?: number;
	type?: string;
}

interface NeteaseSongUrlResponse { data?: NeteaseSongUrlEntry[]; }

interface NeteaseLyricResponse { lrc?: { lyric?: string }; }

const NETEASE_BASE = 'https://music.163.com';

/** Headers the legacy web endpoints require: requests without a browser-like
    Referer are rejected. The UA is a fixed constant (reading navigator is
    banned by lint and unnecessary here). */
const NETEASE_HEADERS: Record<string, string> = {
	'Referer': 'https://music.163.com',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/** 128 kbps MP3, the highest unauthenticated streams NetEase hands out. */
const BITRATE = 128000;

/** Song URLs are signed with expi=1200s; cache a little under that. */
const SONG_URL_TTL = 18 * 60 * 1000;

/** Lyric cache capacity (LRU-ish: FIFO eviction, lyrics never change). */
const LYRIC_CACHE_CAP = 50;

/** Cover URL cache capacity. */
const COVER_CACHE_CAP = 500;

interface CachedSongUrl {
	info: SongUrlInfo;
	fetchedAt: number;
}

const songUrlCache = new Map<number, CachedSongUrl>();
const lyricCache = new Map<number, LyricLine[]>();
const coverCache = new Map<number, string>();

// ---------- Pure helpers (unit-tested in scripts/verify-music-client.ts) ----------

export interface LyricLine {
	timeMs: number;
	text: string;
}

export interface SongUrlInfo {
	/** https CDN URL, or null when the track needs an account entitlement (VIP / album purchase) or is only a trial. */
	url: string | null;
	/** NetEase code: 200 = ok, -110 = no permission. */
	code: number;
	br?: number;
	size?: number;
	type?: string;
}

/** Anonymous users can play fee 0|8; signed-in users defer to server entitlement. */
export function isPlayableByFee(fee: number | undefined, signedIn = false): boolean {
	return signedIn || fee === 0 || fee === 8;
}

/** The URL API hands back http:// CDN links; the Obsidian page is a secure
    context, so they must be upgraded before hitting an <audio> src. */
export function toHttps(url: string): string {
	return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

/** Map one raw song node to a MusicTrack; null when the node is unusable. */
export function mapSearchSong(raw: NeteaseSong): MusicTrack | null {
	if (typeof raw.id !== 'number' || typeof raw.name !== 'string') return null;
	const artists = Array.isArray(raw.artists)
		? raw.artists.map(a => (typeof a?.name === 'string' ? a.name : '')).filter(Boolean)
		: [];
	return {
		id: raw.id,
		name: raw.name,
		artist: artists.join(' / '),
		album: typeof raw.album?.name === 'string' ? raw.album.name : '',
		durationMs: typeof raw.duration === 'number' ? raw.duration : 0,
		fee: typeof raw.fee === 'number' ? raw.fee : 0,
		picUrl: typeof raw.album?.picUrl === 'string' && raw.album.picUrl ? raw.album.picUrl : undefined,
	};
}

/** Map one raw /api/song/enhance/player/url entry. */
export function mapSongUrl(raw: NeteaseSongUrlEntry): SongUrlInfo {
	const url = !raw.freeTrialInfo && (raw.code === undefined || raw.code === 200) && typeof raw.url === 'string' && raw.url ? toHttps(raw.url) : null;
	return {
		url,
		code: typeof raw.code === 'number' ? raw.code : (url ? 200 : -1),
		br: typeof raw.br === 'number' ? raw.br : undefined,
		size: typeof raw.size === 'number' ? raw.size : undefined,
		type: typeof raw.type === 'string' ? raw.type : undefined,
	};
}

/** True when the URL API denied the track on entitlement grounds (business
 *  code -110, url null). The server flakes on these checks intermittently —
 *  even for accounts that hold the entitlement — so callers should retry
 *  these a few times before treating the track as unplayable. */
export function isEntitlementDenial(info: SongUrlInfo): boolean {
	return info.url === null && info.code === -110;
}

const LRC_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;

function lrcTagToMs(min: string, sec: string, frac: string | undefined): number {
	const minutes = Number(min);
	const seconds = Number(sec);
	const millis = Number((frac ?? '').padEnd(3, '0'));
	return minutes * 60_000 + seconds * 1000 + (Number.isFinite(millis) ? millis : 0);
}

/** Parse an LRC body: one line may carry several [mm:ss(.xxx)] tags (expands
    to one entry each); metadata tags ([by:], [offset:], ...) and tagless or
    empty lines are dropped. Output is sorted by time. */
export function parseLrc(text: string): LyricLine[] {
	const out: LyricLine[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line.startsWith('[')) continue;
		const times: number[] = [];
		let rest = line;
		while (true) {
			const match = LRC_TAG.exec(rest);
			if (!match) break;
			times.push(lrcTagToMs(match[1]!, match[2]!, match[3]));
			rest = rest.slice(match[0].length);
		}
		const lyricText = rest.trim();
		if (times.length === 0 || !lyricText) continue;
		for (const timeMs of times) out.push({ timeMs, text: lyricText });
	}
	out.sort((a, b) => a.timeMs - b.timeMs);
	return out;
}

/** Pull a playlist id out of a pasted link or bare number. Accepts the share
    forms music.163.com/#/playlist?id=123, /playlist/123 and a plain "123".
    An ?id= is only trusted on links that actually mention "playlist" — song
    and share links carry ids too and would import the wrong resource. */
export function extractPlaylistId(input: string): string | null {
	const s = input.trim();
	if (!s) return null;
	if (/^\d{1,20}$/.test(s)) return s;
	if (!/playlist/.test(s)) return null;
	const queryId = /[?&]id=(\d{1,20})/.exec(s);
	if (queryId) return queryId[1] ?? null;
	const pathId = /playlist\/(\d{1,20})/.exec(s);
	if (pathId) return pathId[1] ?? null;
	return null;
}

/** Merge fetched picUrls into a track list without mutating the input. */
export function mergePicUrls(tracks: MusicTrack[], details: MusicTrack[]): MusicTrack[] {
	const byId = new Map(details.map(d => [d.id, d] as const));
	return tracks.map(t => {
		const picUrl = byId.get(t.id)?.picUrl;
		return picUrl ? { ...t, picUrl } : t;
	});
}

// ---------- Networked fetchers (throw on invalid responses; callers degrade) ----------

export async function searchMusic(keyword: string, limit = 30): Promise<MusicTrack[]> {
	const s = keyword.trim();
	if (!s) return [];
	const url = `${NETEASE_BASE}/api/search/get/web?s=${encodeURIComponent(s)}&type=1&offset=0&limit=${limit}`;
	const resp = await requestUrl({ url, headers: NETEASE_HEADERS });
	const json = resp.json as NeteaseSearchResponse;
	const songs = json.result?.songs;
	if (!Array.isArray(songs)) throw new Error('Invalid NetEase search response');
	const tracks: MusicTrack[] = [];
	for (const raw of songs) {
		const track = mapSearchSong(raw);
		if (track) tracks.push(track);
	}
	return tracks;
}

export interface NeteasePlaylist {
	name: string;
	tracks: MusicTrack[];
}

export async function fetchPlaylist(id: string): Promise<NeteasePlaylist> {
	const url = `${NETEASE_BASE}/api/playlist/detail?id=${encodeURIComponent(id)}`;
	const resp = await requestUrl({ url, headers: NETEASE_HEADERS });
	const json = resp.json as NeteasePlaylistResponse;
	const result = json.result;
	const tracksRaw = result?.tracks;
	if (!result || !Array.isArray(tracksRaw)) throw new Error('Invalid NetEase playlist response');
	const tracks: MusicTrack[] = [];
	for (const raw of tracksRaw) {
		const track = mapSearchSong(raw);
		if (track) tracks.push(track);
	}
	return { name: typeof result.name === 'string' ? result.name : '', tracks };
}

export async function fetchSongUrl(id: number, cookie = '', forceFresh = false): Promise<SongUrlInfo> {
	const cached = cookie || forceFresh ? undefined : songUrlCache.get(id);
	if (cached && Date.now() - cached.fetchedAt < SONG_URL_TTL) return cached.info;
	const url = `${NETEASE_BASE}/api/song/enhance/player/url?ids=${encodeURIComponent(JSON.stringify([id]))}&br=${BITRATE}`;
	const resp = await requestUrl({ url, headers: cookie ? { ...NETEASE_HEADERS, Cookie: cookie } : NETEASE_HEADERS, throw: false });
	if (resp.status === 401) throw new Error('AUTH_EXPIRED');
	if (resp.status >= 400) throw new Error('NetEase playback request failed');
	const json = resp.json as NeteaseSongUrlResponse & { code?: number };
	if (json.code === 301 || json.code === 302) throw new Error('AUTH_EXPIRED');
	const entry = json.data?.[0];
	if (entry?.code === 301 || entry?.code === 302) throw new Error('AUTH_EXPIRED');
	if (!entry) throw new Error('Invalid NetEase song url response');
	const info = mapSongUrl(entry);
	if (!cookie) songUrlCache.set(id, { info, fetchedAt: Date.now() });
	return info;
}

export async function fetchLyric(id: number): Promise<LyricLine[]> {
	const cached = lyricCache.get(id);
	if (cached) return cached;
	const url = `${NETEASE_BASE}/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`;
	const resp = await requestUrl({ url, headers: NETEASE_HEADERS });
	const json = resp.json as NeteaseLyricResponse;
	const text = json.lrc?.lyric;
	const lines = typeof text === 'string' ? parseLrc(text) : [];
	if (lyricCache.size >= LYRIC_CACHE_CAP) {
		const oldest = lyricCache.keys().next().value as number | undefined;
		if (oldest !== undefined) lyricCache.delete(oldest);
	}
	lyricCache.set(id, lines);
	return lines;
}

/** Fetch full song details (batched, 50 per request) — the source of picUrls. */
export async function fetchSongDetails(ids: number[]): Promise<MusicTrack[]> {
	const out: MusicTrack[] = [];
	for (let i = 0; i < ids.length; i += 50) {
		const chunk = ids.slice(i, i + 50);
		const url = `${NETEASE_BASE}/api/song/detail?ids=${encodeURIComponent(JSON.stringify(chunk))}`;
		const resp = await requestUrl({ url, headers: NETEASE_HEADERS });
		const json = resp.json as NeteaseSongDetailResponse;
		if (!Array.isArray(json.songs)) throw new Error('Invalid NetEase song detail response');
		for (const raw of json.songs) {
			const track = mapSearchSong(raw);
			if (track) out.push(track);
		}
	}
	return out;
}

/** Backfill missing cover URLs on a track list (cache-first, then one batched
    detail fetch for whatever is still unknown). */
export async function backfillCovers(tracks: MusicTrack[]): Promise<MusicTrack[]> {
	const missing = [...new Set(tracks.filter(t => !t.picUrl && !coverCache.has(t.id)).map(t => t.id))];
	if (missing.length > 0) {
		const details = await fetchSongDetails(missing);
		for (const detail of details) {
			if (!detail.picUrl) continue;
			if (coverCache.size >= COVER_CACHE_CAP) {
				const oldest = coverCache.keys().next().value as number | undefined;
				if (oldest !== undefined) coverCache.delete(oldest);
			}
			coverCache.set(detail.id, detail.picUrl);
		}
	}
	return tracks.map(t => t.picUrl ? t : { ...t, picUrl: coverCache.get(t.id) ?? t.picUrl });
}
