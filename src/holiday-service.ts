import { App, requestUrl } from 'obsidian';

export interface HolidayInfo {
	type: number;
	name: string;
	holiday: boolean;
	wage: number;
	date: string;
}

interface HolidayCache {
	year: number;
	data: Record<string, HolidayInfo>;
	fetchedAt: number;
}

const CACHE_KEY = 'apex-dashboard-holiday-cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;

let memoryCache: HolidayCache | null = null;

function isValidCache(obj: unknown): obj is HolidayCache {
	if (!obj || typeof obj !== 'object') return false;
	const c = obj as Record<string, unknown>;
	return typeof c.year === 'number'
		&& typeof c.fetchedAt === 'number'
		&& typeof c.data === 'object' && c.data !== null;
}

function loadDiskCache(app: App): HolidayCache | null {
	try {
		const raw = app.loadLocalStorage(CACHE_KEY) as string | null;
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isValidCache(parsed)) return null;
		if (Date.now() - parsed.fetchedAt > CACHE_TTL) return null;
		return parsed;
	} catch {
		return null;
	}
}

function saveDiskCache(app: App, cache: HolidayCache): void {
	try {
		app.saveLocalStorage(CACHE_KEY, JSON.stringify(cache));
	} catch {
		// ignore storage errors
	}
}

function isValidApiEntry(obj: unknown): boolean {
	return obj !== null && typeof obj === 'object';
}

export async function fetchHolidayData(app: App, year: number): Promise<Record<string, HolidayInfo>> {
	const diskCache = loadDiskCache(app);
	if (diskCache && diskCache.year === year) {
		memoryCache = diskCache;
		return diskCache.data;
	}

	if (memoryCache && memoryCache.year === year) {
		return memoryCache.data;
	}

	try {
		const url = `https://timor.tech/api/holiday/year/${year}/`;
		const resp = await requestUrl({
			url,
			method: 'GET',
			headers: { 'Accept': 'application/json' },
		});
		if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);

		const json: unknown = resp.json;
		if (!json || typeof json !== 'object') return {};

		const data: Record<string, HolidayInfo> = {};
		for (const [date, info] of Object.entries(json as Record<string, unknown>)) {
			if (!isValidApiEntry(info)) continue;
			const e = info as Record<string, unknown>;
			const typeObj = typeof e.type === 'object' && e.type !== null ? e.type as Record<string, unknown> : null;

			const holidayPart = typeof e.holiday === 'boolean'
				? e.holiday
				: (typeObj?.type === 2 || typeObj?.type === 3);

			data[date] = {
				type: typeof typeObj?.type === 'number' ? typeObj.type : 0,
				name: typeof typeObj?.name === 'string' ? typeObj.name : (typeof e.name === 'string' ? e.name : ''),
				holiday: holidayPart,
				wage: typeof e.wage === 'number' ? e.wage : 1,
				date: date,
			};
		}

		const cache: HolidayCache = { year, data, fetchedAt: Date.now() };
		memoryCache = cache;
		saveDiskCache(app, cache);
		return data;
	} catch {
		return {};
	}
}

export function getHolidayForDate(date: string, data: Record<string, HolidayInfo>): HolidayInfo | null {
	return data[date] ?? null;
}
