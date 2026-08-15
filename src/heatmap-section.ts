import { App } from 'obsidian';
import type { DashboardColumn, TrackerDataPoint } from './types';
import { t, getLanguage } from './i18n';
import { readTrackerDataForRange, computeStreak, pastYearRange, thisYearRange } from './tracker-service';

/** Layout constants for the GitHub-style heatmap. */
const CELL_GAP = 3;
const MIN_CELL = 10;
const MAX_CELL = 20;

/**
 * Heatmap section renderer — a GitHub-style year heatmap: month labels across
 * the top, week columns going left→right, 7 day rows top→bottom (Mon→Sun).
 * Range is pastYear (last 365/366 days) or thisYear (Jan 1→Dec 31). Cells size
 * to fill the section width.
 */
export function renderHeatmapSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	onStatsReady?: (getter: () => { streak: number; total: number; rate: number }) => void,
): void {
	const cfg = column.heatmapConfig;
	if (!cfg || !cfg.trackerKey) {
		el.createDiv({ cls: 'dashboard-library-empty', text: t('heatmap.empty') });
		return;
	}

	const body = el.createDiv({ cls: 'dashboard-heatmap-section-body' });

	const title = (cfg.title ?? '').trim();
	if (title) body.createDiv({ cls: 'dashboard-heatmap-section-title', text: title });

	const range = cfg.period === 'thisYear' ? thisYearRange() : pastYearRange();
	const data = readTrackerDataForRange(app, cfg.folder ?? '', cfg.trackerKey, range.start, range.end);

	const validPoints = data.filter(p => p.value !== null);
	if (validPoints.length === 0) {
		body.createDiv({ cls: 'dashboard-library-empty', text: t('heatmap.noData') });
		return;
	}

	// Build week columns (Mon-first). Each week is 7 slots (null before start/after end).
	const weekCols = buildWeekColumns(data);

	const values = validPoints.map(p => p.value as number);
	const minVal = Math.min(...values);
	const maxVal = Math.max(...values);
	const valueRange = maxVal - minVal || 1;
	const accent = cssVar('--db-accent') || cssVar('--interactive-accent') || '#6366f1';

	// Layout: just the heatmap grid (stats shown via header button popup).
	const totalDays = data.length;
	const streak = computeStreak(data);
	const rate = totalDays > 0 ? Math.round((validPoints.length / totalDays) * 100) : 0;

	if (onStatsReady) {
		onStatsReady(() => ({ streak, total: validPoints.length, rate }));
	}

	renderYearGrid(body, weekCols, minVal, valueRange, accent);
}

function cssVar(name: string): string {
	const root = activeDocument.querySelector('.apex-dashboard-root');
	const el = root instanceof HTMLElement ? root : activeDocument.body;
	return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Group daily points into week columns (Mon-first), aligning the first week to Monday. */
function buildWeekColumns(data: TrackerDataPoint[]): Array<Array<TrackerDataPoint | null>> {
	const cols: Array<Array<TrackerDataPoint | null>> = [];
	if (data.length === 0) return cols;
	const first = new Date(data[0]!.date + 'T00:00:00');
	const firstDow = first.getDay(); // 0=Sun..6=Sat
	const mondayOffset = firstDow === 0 ? 6 : firstDow - 1; // leading empties so col starts Mon
	let col: Array<TrackerDataPoint | null> = [];
	for (let i = 0; i < mondayOffset; i++) col.push(null);
	for (const p of data) {
		col.push(p);
		if (col.length === 7) {
			cols.push(col);
			col = [];
		}
	}
	if (col.length > 0) cols.push(col);
	return cols;
}

/** Pick a square cell size so the grid fills the section width without too much gap. */
function chooseCellSize(containerWidth: number, weekCount: number): number {
	if (weekCount <= 0 || containerWidth <= 0) return MIN_CELL;
	const available = containerWidth - (weekCount - 1) * CELL_GAP;
	const ideal = Math.floor(available / weekCount);
	return Math.max(MIN_CELL, Math.min(MAX_CELL, ideal));
}

/**
 * Render the GitHub-style year grid: a month-label row on top, then week columns.
 * Cells are absolutely placed via a CSS grid of (weekCount × 7) using a computed
 * cell size; empty leading/trailing slots render as the muted "no data" cell.
 */
function renderYearGrid(
	host: HTMLElement,
	weekCols: Array<Array<TrackerDataPoint | null>>,
	minVal: number,
	valueRange: number,
	accent: string,
): void {
	const wrap = host.createDiv({ cls: 'dashboard-heatmap-year' });
	// Measure container width, then pick a cell size that fills it.
	const width = wrap.parentElement?.clientWidth ?? 800;
	const cell = chooseCellSize(Math.max(0, width - 28), weekCols.length);
	wrap.style.setProperty('--hm-cell', `${cell}px`);

	const monthRow = wrap.createDiv({ cls: 'dashboard-heatmap-months-top' });
	const gridRow = wrap.createDiv({ cls: 'dashboard-heatmap-grid-row' });
	const weekdayLabels = gridRow.createDiv({ cls: 'dashboard-heatmap-weekdays' });
	const weekdayNames = getLanguage() === 'zh'
		? ['一', '', '三', '', '五', '', '日']
		: ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
	for (const name of weekdayNames) {
		weekdayLabels.createDiv({ cls: 'dashboard-heatmap-weekday-label', text: name });
	}
	const grid = gridRow.createDiv({ cls: 'dashboard-heatmap-grid' });

	const monthLabels = computeMonthLabels(weekCols);
	// monthRow columns set via direct style (repeat count must be a literal int,
	// so it can't go through a CSS variable).
	monthRow.style.gridTemplateColumns = `repeat(${weekCols.length}, ${cell}px)`;
	for (let i = 0; i < weekCols.length; i++) {
		const slot = monthRow.createDiv({ cls: 'dashboard-heatmap-month-label-top' });
		const label = monthLabels[i];
		if (label) slot.setText(label);
	}

	for (const col of weekCols) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const point = col[dayIdx] ?? null;
			const cellEl = grid.createDiv({ cls: 'dashboard-sidebar-heatmap-cell' });
			if (point === null || point.value === null) {
				cellEl.addClass('dashboard-sidebar-heatmap-cell--empty');
			} else {
				const intensity = valueRange > 0 ? (point.value - minVal) / valueRange : 1;
				const clamped = Math.max(0, Math.min(1, intensity));
				cellEl.style.backgroundColor = accent;
				cellEl.style.opacity = String(0.35 + clamped * 0.65);
				cellEl.style.filter = `brightness(${1 + clamped * 0.5}) saturate(1.4)`;
				cellEl.title = `${point.date}: ${point.value}`;
			}
		}
	}
}

/**
 * For each week column, return a month label only on the first column that starts
 * a new month (so labels sit above the right columns, like GitHub).
 */
function computeMonthLabels(weekCols: Array<Array<TrackerDataPoint | null>>): Array<string | null> {
	const labels: Array<string | null> = [];
	let lastMonth = '';
	const locale = getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
	for (const col of weekCols) {
		const firstPoint = col.find((p): p is TrackerDataPoint => p !== null);
		const monthKey = firstPoint ? firstPoint.date.slice(0, 7) : '';
		if (monthKey && monthKey !== lastMonth) {
			const d = new Date(`${monthKey}-01T00:00:00`);
			labels.push(isNaN(d.getTime()) ? monthKey : d.toLocaleDateString(locale, { month: 'short' }));
			lastMonth = monthKey;
		} else {
			labels.push(null);
		}
	}
	return labels;
}
