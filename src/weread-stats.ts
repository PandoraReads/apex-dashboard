import { t } from './i18n';
import {
	buildHeatmapCells,
	bucketLabel,
	computeReadStreaks,
	formatReadTime,
	wereadErrorMessage,
} from './weread-service';
import type { WereadClient, WereadHeatmapCell, WereadReadStats, WereadStatMode } from './weread-service';
import { shelfStateFor } from './weread-shelf-model';
import type { WereadReadingState } from './weread-shelf-model';
import type { WereadProgressStore } from './weread-progress-store';
import type { WereadStatItem } from './types';

/**
 * Weread "阅读统计" widget: period toggle + KPIs + reading trend (with
 * streak badges) + top-read list + preferred-category bars.
 *
 * All data comes from one /readdata/detail call per mode (cached 60s per mode
 * by the shared client). Extended fields are threshold-gated server-side, so
 * every section renders only when its data exists and KPI slots dash out.
 *
 * The selected period lives in module memory: it survives the dashboard's
 * frequent full re-renders and resets to the default on app restart.
 *
 * Blocks (KPI overview, trend, top read, preferred categories) render in the
 * user's configured order, two per row, and can be hidden per widget
 * (WereadWidget.statsItems, managed in the config modal).
 */

const MODES: Array<{ mode: WereadStatMode; labelKey: string }> = [
	{ mode: 'weekly', labelKey: 'weread.statsWeekly' },
	{ mode: 'monthly', labelKey: 'weread.statsMonthly' },
	{ mode: 'annually', labelKey: 'weread.statsAnnually' },
	{ mode: 'overall', labelKey: 'weread.statsOverall' },
];

const DEFAULT_MODE: WereadStatMode = 'overall';

/** Every known block id — the validity whitelist for stored configs, so a
 *  block can be non-default (opt-in) without becoming unloadable. */
export const ALL_STAT_ITEMS: readonly WereadStatItem[] = ['kpi', 'trend', 'topRead', 'preferCategory'];

/** Display order used when a widget has no statsItems yet: overview, most
 *  read, trend — preferCategory stays opt-in via the config modal. */
export const DEFAULT_STAT_ITEMS: readonly WereadStatItem[] = ['kpi', 'topRead', 'trend'];

export const STAT_ITEM_LABEL_KEYS: Record<WereadStatItem, string> = {
	kpi: 'weread.statsItemKpi',
	trend: 'weread.trendTitle',
	topRead: 'weread.topRead',
	preferCategory: 'weread.preferCategory',
};

/** Stored list -> render list: drop unknown ids, keep order, default = all
 *  default blocks. */
export function normalizeStatItems(items: WereadStatItem[] | undefined): WereadStatItem[] {
	if (!items || items.length === 0) return [...DEFAULT_STAT_ITEMS];
	const valid = items.filter(item => ALL_STAT_ITEMS.includes(item));
	return valid.length > 0 ? [...new Set(valid)] : [...DEFAULT_STAT_ITEMS];
}

/** Widget id -> chosen period. Session-scoped by design (see header). */
const modeMemory: Record<string, WereadStatMode> = {};

export function renderWereadStats(content: HTMLElement, client: WereadClient, widget: { id: string; statsItems?: WereadStatItem[] }, store: WereadProgressStore): void {
	content.empty();
	const wrap = content.createDiv({ cls: 'dashboard-weread-stats-wrap' });
	const toggle = wrap.createDiv({ cls: 'dashboard-weread-stats-toggle' });
	const body = wrap.createDiv({ cls: 'dashboard-weread-stats-body' });

	let active = modeMemory[widget.id] ?? DEFAULT_MODE;

	const drawToggle = (): void => {
		toggle.empty();
		for (const { mode, labelKey } of MODES) {
			const btn = toggle.createEl('button', {
				cls: 'dashboard-weread-stats-toggle-btn' + (mode === active ? ' active' : ''),
				attr: { type: 'button', 'aria-pressed': mode === active ? 'true' : 'false' },
			});
			btn.createSpan({ text: t(labelKey) });
			btn.addEventListener('click', () => {
				if (mode === active) return;
				active = mode;
				modeMemory[widget.id] = mode;
				drawToggle();
				void load(mode);
			});
		}
	};

	const load = async (mode: WereadStatMode): Promise<void> => {
		hint(body, t('weread.loading'));
		try {
			const stats = await client.fetchReadStats(mode);
			const extras = await buildKpiExtras(client, store, stats);
			drawStats(body, stats, normalizeStatItems(widget.statsItems), extras);
		} catch (err) {
			hint(body, t('weread.loadFailed'), wereadErrorMessage(err));
		}
	};

	drawToggle();
	void load(active);
}

function hint(el: HTMLElement, title: string, desc = ''): void {
	el.empty();
	const wrap = el.createDiv({ cls: 'dashboard-weread-hint' });
	wrap.createDiv({ cls: 'dashboard-weread-hint-title', text: title });
	if (desc) wrap.createDiv({ cls: 'dashboard-weread-hint-desc', text: desc });
}

function drawStats(body: HTMLElement, stats: WereadReadStats, items: WereadStatItem[], extras: KpiExtras): void {
	body.empty();
	// One renderer per block id; the user's order drives the DOM order, and
	// each renderer no-ops when the server withheld its data (threshold-gated).
	const renderers: Record<WereadStatItem, (block: HTMLElement) => void> = {
		kpi: block => drawKpiBlock(block, stats, extras),
		trend: block => drawTrendBlock(block, stats),
		topRead: block => drawTopReadBlock(block, stats),
		preferCategory: block => drawPreferCategoryBlock(block, stats),
	};
	for (const item of items) {
		const block = body.createDiv({
			cls: 'dashboard-weread-stats-block'
				// The KPI overview keeps the full row: donut + rows want the width.
				+ (item === 'kpi' ? ' dashboard-weread-stats-block--wide' : ''),
		});
		renderers[item](block);
	}
}

/** Everything the KPI panel shows beyond the /readdata/detail payload itself. */
interface KpiExtras {
	/** Shelf distribution for the donut; null hides the zone entirely. */
	shelfCounts: { finished: number; reading: number; notStarted: number; total: number } | null;
	/** Daily buckets merged from every source we have (current mode's daily
	 *  series + this year's and last year's annually dailyReadTimes), feeding
	 *  the rolling 365-day heatmap. */
	yearBuckets: Array<{ ts: number; seconds: number }>;
}

/**
 * Secondary data for the KPI panel. Every piece degrades on failure (donut
 * hides, heatmap dashes out) — a rate-limited or missing side source must
 * never blank the primary stats. The extra fetches reuse the shared client's
 * 60s per-mode cache, so they are free while toggling.
 */
async function buildKpiExtras(client: WereadClient, store: WereadProgressStore, stats: WereadReadStats): Promise<KpiExtras> {
	// Shelf distribution — shelf sync + persisted progress overlay only, no
	// getprogress budget (the shelf widget's enrichment already paid for it).
	let shelfCounts: KpiExtras['shelfCounts'] = null;
	try {
		await store.load();
		const shelf = await client.fetchShelf();
		const counts = { finished: 0, reading: 0, notStarted: 0, total: shelf.length };
		for (const book of shelf) {
			counts[shelfStateFor(book, store.entry(book.bookId))]++;
		}
		if (counts.total > 0) shelfCounts = counts;
	} catch {
		// shelf unavailable (rate limit, offline) — donut hides
	}

	// Rolling 365-day daily series: union of the current mode's daily buckets
	// (weekly/monthly readTimes, annually dailyReadTimes) with the annually
	// daily detail of this year and last — the window reaching back into the
	// previous year is what the mode payloads alone cannot cover.
	const byDay = new Map<string, { ts: number; seconds: number }>();
	const addSeries = (series: ReadonlyArray<{ ts: number; seconds: number }>): void => {
		for (const b of series) {
			const d = new Date(b.ts);
			byDay.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, {
				ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
				seconds: b.seconds,
			});
		}
	};
	if (stats.mode === 'weekly' || stats.mode === 'monthly') addSeries(stats.readTimes);
	if (stats.dailyReadTimes.length > 0) addSeries(stats.dailyReadTimes);
	try {
		addSeries((await client.fetchReadStats('annually')).dailyReadTimes);
	} catch {
		// heatmap falls back to what we already have
	}
	try {
		addSeries((await client.fetchReadStats('annually', Date.now() - 365 * 86_400_000)).dailyReadTimes);
	} catch {
		// same
	}

	return {
		shelfCounts,
		yearBuckets: [...byDay.values()].sort((a, b) => a.ts - b.ts),
	};
}

function drawKpiBlock(block: HTMLElement, stats: WereadReadStats, extras: KpiExtras): void {
	// Three-column panel: the shelf-distribution donut keeps a compact tinted
	// left zone; the rolling 365-day read-days heatmap owns the wide middle;
	// total time and note count stack as plain text stats on the right. One
	// card, internal hairlines only.
	const panel = block.createDiv({ cls: 'dashboard-weread-stat-panel' });

	if (extras.shelfCounts) {
		const shelfZone = panel.createDiv({ cls: 'dashboard-weread-stat-panel-shelf' });
		renderShelfDonut(shelfZone, extras.shelfCounts);
	}

	// Middle: read days as a rolling 365-day heatmap, period-independent.
	const midZone = panel.createDiv({ cls: 'dashboard-weread-stat-panel-mid' });
	midZone.createDiv({ cls: 'dashboard-weread-stat-label', text: t('weread.readDays') });
	const heatCells = renderDaysHeatmap(midZone, extras.yearBuckets);
	// Qualifying days (the server's >= 1 minute effective-reading rule) within
	// the window — the number the heatmap itself shows.
	const readDays = heatCells.filter(c => c.inWindow && c.seconds >= 60).length;
	midZone.createDiv({ cls: 'dashboard-weread-stat-value', text: String(readDays) });
	midZone.createDiv({ cls: 'dashboard-weread-kpi-caption-extra', text: t('weread.last365') });

	// Right: total time on top, note count below — plain values, no ratios.
	const rightZone = panel.createDiv({ cls: 'dashboard-weread-stat-panel-right' });
	const timeCell = rightZone.createDiv({ cls: 'dashboard-weread-stat-panel-cell' });
	timeCell.createDiv({ cls: 'dashboard-weread-stat-label', text: t('weread.totalTime') });
	timeCell.createDiv({ cls: 'dashboard-weread-stat-value', text: formatReadTime(stats.totalReadTime) });

	const notesCell = rightZone.createDiv({ cls: 'dashboard-weread-stat-panel-cell' });
	notesCell.createDiv({ cls: 'dashboard-weread-stat-label', text: t('weread.statNotes') });
	// readStat counts are display strings ("12条") — show verbatim, dash when
	// the server withheld the item (data threshold not met).
	notesCell.createDiv({
		cls: 'dashboard-weread-stat-value',
		text: stats.readStat.find(s => s.stat === '笔记')?.counts ?? '—',
	});
}

/** Intensity level 0-4 for one bucket's seconds (banner-heatmap thresholds). */
function heatLevel(seconds: number): number {
	if (seconds >= 3600) return 4;
	if (seconds >= 1800) return 3;
	if (seconds >= 60) return 2;
	if (seconds > 0) return 1;
	return 0;
}

/**
 * Rolling 365-day heatmap (banner-heatmap visual language): one cell per day,
 * column-major weeks so the grid reads like a contribution graph. Days the
 * API has no bucket for render at level 0; alignment blanks before the
 * window start render hollow; today gets a ring. Returns the cells rendered.
 */
function renderDaysHeatmap(container: HTMLElement, buckets: ReadonlyArray<{ ts: number; seconds: number }>): WereadHeatmapCell[] {
	if (buckets.length === 0) {
		container.createDiv({ cls: 'dashboard-weread-kpi-caption-extra', text: '—' });
		return [];
	}
	const cells = buildHeatmapCells(buckets);
	const weeks = Math.ceil(cells.length / 7);
	const grid = container.createDiv({ cls: 'dashboard-weread-heatmap' });
	grid.style.gridTemplateColumns = `repeat(${weeks}, minmax(0, 1fr))`;
	for (const cell of cells) {
		const cls = cell.inWindow
			? 'dashboard-weread-heatmap-cell dashboard-weread-heatmap-cell--l' + heatLevel(cell.seconds)
				+ (cell.isToday ? ' dashboard-weread-heatmap-cell--today' : '')
			: 'dashboard-weread-heatmap-cell dashboard-weread-heatmap-cell--blank';
		const el = grid.createDiv({ cls });
		const d = new Date(cell.ts);
		const tip = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} · ${formatReadTime(cell.seconds)}`;
		el.setAttribute('title', tip);
		el.setAttribute('aria-label', tip);
	}
	return cells;
}

const DONUT_ORDER: Array<{ state: WereadReadingState; labelKey: string }> = [
	{ state: 'finished', labelKey: 'weread.progressFinished' },
	{ state: 'reading', labelKey: 'weread.progressReading' },
	{ state: 'notStarted', labelKey: 'weread.progressNotStarted' },
];

/** Shelf donut (SVG stroke-dasharray arcs) with the total in the center and a
 *  color/label/count legend below — the same state colors the shelf groups
 *  use, so the donut reads as a summary of the shelf widget. */
function renderShelfDonut(
	zone: HTMLElement,
	counts: { finished: number; reading: number; notStarted: number; total: number },
): void {
	zone.createDiv({ cls: 'dashboard-weread-stat-label', text: t('weread.shelfStates') });

	const size = 108;
	const stroke = 13;
	const r = (size - stroke) / 2 - 1;
	const c = 2 * Math.PI * r;
	const wrap = zone.createDiv({ cls: 'dashboard-weread-donut-wrap' });
	const svg = wrap.createSvg('svg', {
		cls: 'dashboard-weread-donut-svg',
		attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) },
	});
	const center = wrap.createDiv({ cls: 'dashboard-weread-donut-center' });
	center.createDiv({ cls: 'dashboard-weread-donut-total', text: String(counts.total) });
	center.createDiv({ cls: 'dashboard-weread-donut-unit', text: t('weread.shelfTotalUnit') });

	const total = Math.max(1, counts.total);
	let offset = 0;
	for (const { state } of DONUT_ORDER) {
		const n = counts[state];
		if (n <= 0) continue;
		const len = (n / total) * c;
		// 1.5px visual gap between segments; skip degenerate slivers.
		const segLen = Math.max(0.5, len - 1.5);
		svg.createSvg('circle', {
			// Single-token cls (see trend note): the modifier alone carries styling.
			cls: `dashboard-weread-donut-seg--${state}`,
			attr: {
				cx: size / 2,
				cy: size / 2,
				r,
				fill: 'none',
				'stroke-width': stroke,
				'stroke-dasharray': `${segLen} ${c - segLen}`,
				'stroke-dashoffset': -offset,
				transform: `rotate(-90 ${size / 2} ${size / 2})`,
			},
		});
		offset += len;
	}

	const legend = zone.createDiv({ cls: 'dashboard-weread-legend' });
	for (const { state, labelKey } of DONUT_ORDER) {
		const item = legend.createDiv({ cls: 'dashboard-weread-legend-item' });
		item.createDiv({ cls: `dashboard-weread-legend-dot--${state}` });
		item.createSpan({ cls: 'dashboard-weread-legend-label', text: t(labelKey) });
		item.createSpan({ cls: 'dashboard-weread-legend-count', text: String(counts[state]) });
	}
}

function drawTrendBlock(block: HTMLElement, stats: WereadReadStats): void {
	if (stats.readTimes.length === 0) return;
	const section = block.createDiv({ cls: 'dashboard-weread-stats-section' });
	const head = section.createDiv({ cls: 'dashboard-weread-stats-section-head' });
	head.createDiv({ cls: 'dashboard-weread-stats-section-title', text: t('weread.trendTitle') });
	if (stats.mode === 'weekly' || stats.mode === 'monthly') {
		const { current, longest } = computeReadStreaks(stats.readTimes);
		if (longest > 0) {
			head.createDiv({
				cls: 'dashboard-weread-streak',
				text: t('weread.streakBadge', { cur: String(current), long: String(longest) }),
			});
		}
	}
	renderTrend(section, stats);
}

function drawTopReadBlock(block: HTMLElement, stats: WereadReadStats): void {
	if (stats.readLongest.length === 0) return;
	const section = block.createDiv({ cls: 'dashboard-weread-stats-section' });
	section.createDiv({ cls: 'dashboard-weread-stats-section-title', text: t('weread.topRead') });
	const list = section.createDiv({ cls: 'dashboard-weread-topread' });
	for (const item of stats.readLongest.slice(0, 3)) {
		const row = list.createDiv({ cls: 'dashboard-weread-topread-row' });
		const meta = row.createDiv({ cls: 'dashboard-weread-topread-meta' });
		meta.createDiv({ cls: 'dashboard-weread-topread-title', text: item.title });
		if (item.author) meta.createDiv({ cls: 'dashboard-weread-topread-author', text: item.author });
		row.createDiv({ cls: 'dashboard-weread-topread-time', text: formatReadTime(item.readTime) });
	}
}

function drawPreferCategoryBlock(block: HTMLElement, stats: WereadReadStats): void {
	if (stats.preferCategory.length === 0) return;
	const section = block.createDiv({ cls: 'dashboard-weread-stats-section' });
	section.createDiv({ cls: 'dashboard-weread-stats-section-title', text: t('weread.preferCategory') });
	const list = section.createDiv({ cls: 'dashboard-weread-prefercat' });
	const cats = stats.preferCategory.slice(0, 5);
	// Normalize by readingTime (authoritative seconds); val is the API's
	// own chart weight but its scale isn't documented, so only fall back
	// to it when every readingTime is zero.
	const maxTime = Math.max(...cats.map(c => c.readingTime), 0);
	const maxVal = Math.max(...cats.map(c => c.val), 0);
	for (const cat of cats) {
		const row = list.createDiv({ cls: 'dashboard-weread-prefercat-row' });
		row.createDiv({ cls: 'dashboard-weread-prefercat-name', text: cat.title });
		const barWrap = row.createDiv({ cls: 'dashboard-weread-prefercat-bar-wrap' });
		const ratio = maxTime > 0 ? cat.readingTime / maxTime : maxVal > 0 ? cat.val / maxVal : 0;
		const pct = Math.max(3, Math.min(100, Math.round(ratio * 100)));
		barWrap.createDiv({ cls: 'dashboard-weread-prefercat-bar' }).style.width = `${pct}%`;
		row.createDiv({
			cls: 'dashboard-weread-prefercat-val',
			text: cat.readingTime > 0 ? formatReadTime(cat.readingTime) : `${cat.readingCount}本`,
		});
	}
}

/** SVG bar trend, expense-charts pattern: no chart library, native <title>
 *  tooltips, thinned x labels. Bars carry the accent via a CSS var so themes
 *  apply without JS color lookups. */
function renderTrend(container: HTMLElement, stats: WereadReadStats): void {
	const buckets = stats.readTimes;
	const width = 520;
	const height = 110;
	const maxVal = Math.max(...buckets.map(b => b.seconds), 1);
	const step = width / buckets.length;
	const barW = Math.max(2, Math.min(18, step * 0.6));

	const svg = container.createSvg('svg', {
		// Single-token cls only — createSvg feeds it to classList.add on some
		// Obsidian builds and a space throws (see habit heatmap).
		cls: 'dashboard-weread-trend-svg',
		attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) },
	});

	const labelEvery = buckets.length <= 14 ? 1 : Math.ceil(buckets.length / 12);
	buckets.forEach((b, i) => {
		const slotX = i * step;
		const h = Math.round((b.seconds / maxVal) * (height - 10));
		const rect = svg.createSvg('rect', {
			cls: 'dashboard-weread-trend-bar',
			attr: {
				x: slotX + (step - barW) / 2,
				y: height - h,
				width: barW,
				height: Math.max(b.seconds > 0 ? 2 : 0, h),
				rx: 2,
			},
		});
		const tip = svg.createSvg('title');
		tip.textContent = `${bucketLabel(b.ts, stats.mode)} · ${formatReadTime(b.seconds)}`;
		rect.appendChild(tip);

		if (i % labelEvery === 0) {
			const txt = svg.createSvg('text', {
				cls: 'dashboard-weread-trend-tick',
				attr: { x: slotX + step / 2, y: height + 12, 'text-anchor': 'middle' },
			});
			txt.textContent = bucketLabel(b.ts, stats.mode);
		}
	});
}
