import { App } from 'obsidian';
import type { HeatmapPeriod, TrackerDataPoint } from './types';

export function readTrackerDataForRange(
	app: App,
	folder: string,
	key: string,
	startDate: Date,
	endDate: Date,
): TrackerDataPoint[] {
	const points: TrackerDataPoint[] = [];
	const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
	const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
	const cleanFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : '';

	while (d.getTime() <= end.getTime()) {
		const dateStr = formatDateString(d);
		const filePath = cleanFolder ? `${cleanFolder}/${dateStr}.md` : `${dateStr}.md`;

		const file = app.vault.getFileByPath(filePath);
		if (!file) {
			points.push({ date: dateStr, value: null });
			d.setDate(d.getDate() + 1);
			continue;
		}

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm || !(key in fm)) {
			points.push({ date: dateStr, value: null });
			d.setDate(d.getDate() + 1);
			continue;
		}

		const raw: unknown = fm[key];
		const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
		points.push({ date: dateStr, value: isNaN(num) ? null : num });
		d.setDate(d.getDate() + 1);
	}

	return points;
}

export function readTrackerData(
	app: App,
	journalPath: string,
	key: string,
	days: number,
): TrackerDataPoint[] {
	const now = new Date();
	const start = new Date(now);
	start.setDate(start.getDate() - (days - 1));
	return readTrackerDataForRange(app, journalPath, key, start, now);
}

export function computeStreak(points: TrackerDataPoint[]): number {
	if (points.length === 0) return 0;

	const byDate = new Map<string, boolean>();
	for (const p of points) byDate.set(p.date, p.value !== null);

	const today = new Date();
	let expected = formatDateString(today);
	if (!byDate.get(expected)) {
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		expected = formatDateString(yesterday);
	}

	let streak = 0;
	let cursor = new Date(expected + 'T00:00:00');
	while (byDate.get(formatDateString(cursor))) {
		streak++;
		cursor.setDate(cursor.getDate() - 1);
	}
	return streak;
}

export function getPeriodRange(
	period: HeatmapPeriod,
	now: Date = new Date(),
): { start: Date; end: Date } {
	const y = now.getFullYear();
	const m = now.getMonth();

	let start: Date;
	let naturalEnd: Date;
	if (period === 'month') {
		start = new Date(y, m, 1);
		naturalEnd = new Date(y, m + 1, 0);
	} else if (period === 'quarter') {
		const qStartMonth = Math.floor(m / 3) * 3;
		start = new Date(y, qStartMonth, 1);
		naturalEnd = new Date(y, qStartMonth + 3, 0);
	} else {
		start = new Date(y, 0, 1);
		naturalEnd = new Date(y, 11, 31);
	}

	const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = naturalEnd.getTime() < todayEnd.getTime() ? naturalEnd : todayEnd;
	return { start, end };
}

/** Past N days ending today (inclusive). N = 365 or 366 depending on leap year. */
export function pastYearRange(now: Date = new Date()): { start: Date; end: Date } {
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);
	start.setDate(start.getDate() - 364); // 365 days including today
	return { start, end };
}

/** Jan 1 → Dec 31 of the current year. */
export function thisYearRange(now: Date = new Date()): { start: Date; end: Date } {
	const y = now.getFullYear();
	return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
}

export function suggestTrackerKeys(app: App, journalPath?: string): string[] {
	const keys = new Set<string>();

	let files = app.vault.getMarkdownFiles();

	if (journalPath) {
		files = files.filter(f => f.path.startsWith(journalPath + '/'));
	}

	files = files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 50);

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (fm) {
			for (const k of Object.keys(fm)) {
				if (typeof fm[k] === 'number' || !isNaN(parseFloat(String(fm[k])))) {
					keys.add(k);
				}
			}
		}
	}

	return [...keys].sort();
}

function formatDateString(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
