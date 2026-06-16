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

function loadDiskCache(): HolidayCache | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!isValidCache(parsed)) return null;
		if (Date.now() - parsed.fetchedAt > CACHE_TTL) return null;
		return parsed;
	} catch {
		return null;
	}
}

function saveDiskCache(cache: HolidayCache): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {
		// ignore storage errors
	}
}

function isValidApiEntry(obj: unknown): boolean {
	return obj !== null && typeof obj === 'object';
}

export async function fetchHolidayData(year: number): Promise<Record<string, HolidayInfo>> {
	const diskCache = loadDiskCache();
	if (diskCache && diskCache.year === year) {
		memoryCache = diskCache;
		return diskCache.data;
	}

	if (memoryCache && memoryCache.year === year) {
		return memoryCache.data;
	}

	try {
		const url = `https://timor.tech/api/holiday/year/${year}/`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000);
		const resp = await fetch(url, {
			headers: { 'Accept': 'application/json' },
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

		const json = await resp.json();
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
		saveDiskCache(cache);
		return data;
	} catch {
		return {};
	}
}

export function getHolidayForDate(date: string, data: Record<string, HolidayInfo>): HolidayInfo | null {
	return data[date] ?? null;
}
