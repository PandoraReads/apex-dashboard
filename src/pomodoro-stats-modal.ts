import { setIcon } from 'obsidian';
import { t } from './i18n';
import {
	PomodoroService, PomodoroRecord,
	activityColor,
} from './pomodoro-service';
import { openPomodoroTagManager } from './pomodoro-tag-manager';

export type PomodoroRangeKey = 'day' | 'week' | 'month' | 'year' | 'all';

interface RangeInfo {
	key: PomodoroRangeKey;
	labelKey: string;
}

const RANGES: RangeInfo[] = [
	{ key: 'day', labelKey: 'pomodoro.rangeDay' },
	{ key: 'week', labelKey: 'pomodoro.rangeWeek' },
	{ key: 'month', labelKey: 'pomodoro.rangeMonth' },
	{ key: 'year', labelKey: 'pomodoro.rangeYear' },
	{ key: 'all', labelKey: 'pomodoro.rangeAll' },
];

/**
 * Landscape (≈1000×640) focus-statistics overlay. Three columns:
 *  left  — KPI cards (today/week/avg/streak/total/best-day)
 *  mid   — donut time distribution + adaptive trend chart
 *  right — activity ranking bars, 12-week heatmap, recent records
 *
 * All charts are hand-rolled SVG to match the plugin's zero-dependency style.
 * Below 900px viewport width the grid collapses to a single column (mobile).
 */
export function showPomodoroStats(doc: Document, service: PomodoroService): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-pomodoro-stats-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal dashboard-pomodoro-stats-modal--wide' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
	doc.addEventListener('keydown', onKey);

	// ===== Header: title / range toggle / tag-manage / close =====
	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	header.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: t('pomodoro.statsTitle') });

	const headerRight = header.createDiv({ cls: 'dashboard-pomodoro-stats-header-right' });

	const rangeToggle = headerRight.createDiv({ cls: 'dashboard-pomodoro-range-toggle' });
	const toggleButtons = RANGES.map(r => rangeToggle.createDiv({
		cls: 'dashboard-pomodoro-range-btn' + (r.key === 'week' ? ' dashboard-pomodoro-range-btn--active' : ''),
		text: t(r.labelKey),
	}));

	const manageBtn = headerRight.createDiv({ cls: 'dashboard-pomodoro-stats-icon-btn' });
	manageBtn.setAttribute('aria-label', t('pomodoro.tagManage'));
	setIcon(manageBtn, 'settings-2');
	manageBtn.addEventListener('click', () => {
		openPomodoroTagManager(doc, service, () => renderAll());
	});

	const closeBtn = headerRight.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	// ===== Body grid =====
	const body = modal.createDiv({ cls: 'dashboard-pomodoro-stats-body' });
	const kpiCol = body.createDiv({ cls: 'dashboard-pomodoro-kpi-col' });
	const midCol = body.createDiv({ cls: 'dashboard-pomodoro-mid-col' });
	const rightCol = body.createDiv({ cls: 'dashboard-pomodoro-right-col' });

	let activeRange: PomodoroRangeKey = 'week';

	// --- Date-window helpers (natural periods, same convention as the donut) ---
	function datesForRange(key: PomodoroRangeKey): { curStart: string; prevStart: string; prevEnd: string; dayCount: number } {
		const fmt = (d: Date) => {
			const y = d.getFullYear();
			const m = String(d.getMonth() + 1).padStart(2, '0');
			const day = String(d.getDate()).padStart(2, '0');
			return `${y}-${m}-${day}`;
		};
		const today = new Date();
		const daysSinceMonday = (today.getDay() + 6) % 7;
		const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
		switch (key) {
			case 'day':
				return { curStart: fmt(today), prevStart: fmt(addDays(today, -1)), prevEnd: fmt(addDays(today, -1)), dayCount: 1 };
			case 'week': {
				const monday = addDays(today, -daysSinceMonday);
				return { curStart: fmt(monday), prevStart: fmt(addDays(monday, -7)), prevEnd: fmt(addDays(monday, -1)), dayCount: 7 };
			}
			case 'month': {
				const first = new Date(today.getFullYear(), today.getMonth(), 1);
				const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
				const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
				const dayCount = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
				return { curStart: fmt(first), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd), dayCount };
			}
			case 'year': {
				const first = new Date(today.getFullYear(), 0, 1);
				const prevEnd = new Date(today.getFullYear() - 1, 11, 31);
				const prevStart = new Date(today.getFullYear() - 1, 0, 1);
				const dayCount = 365;
				return { curStart: fmt(first), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd), dayCount };
			}
			case 'all':
				return { curStart: '0000-01-01', prevStart: '0000-01-01', prevEnd: '0000-01-01', dayCount: 365 };
		}
	}

	function rangeBreakdown(key: PomodoroRangeKey): Map<string, number> {
		switch (key) {
			case 'day': return service.getActivityBreakdownByRange(1);
			case 'week': return service.getActivityBreakdownByCalendarWeek();
			case 'month': return service.getActivityBreakdownByCalendarMonth();
			case 'year': return service.getActivityBreakdownByCalendarYear();
			case 'all': return service.getActivityBreakdown();
		}
	}

	function kpiCard(parent: HTMLElement, value: string, label: string, deltaPct?: number): HTMLElement {
		const card = parent.createDiv({ cls: 'dashboard-pomodoro-stats-card' });
		const valRow = card.createDiv({ cls: 'dashboard-pomodoro-stats-card-value-row' });
		valRow.createDiv({ cls: 'dashboard-pomodoro-stats-card-value', text: value });
		if (deltaPct !== undefined && Number.isFinite(deltaPct)) {
			const up = deltaPct >= 0;
			const delta = valRow.createDiv({
				cls: 'dashboard-pomodoro-stats-card-delta'
					+ (up ? ' dashboard-pomodoro-stats-card-delta--up' : ' dashboard-pomodoro-stats-card-delta--down'),
				text: `${up ? '↑' : '↓'} ${Math.abs(Math.round(deltaPct))}%`,
			});
			delta.setAttribute('title', t('pomodoro.vsPrev'));
		}
		card.createDiv({ cls: 'dashboard-pomodoro-stats-card-label', text: label });
		return card;
	}

	function renderKpis(): void {
		kpiCol.empty();

		const { curStart, prevStart, prevEnd, dayCount } = datesForRange(activeRange);
		const totals = service.getRangeTotals(curStart, prevStart, prevEnd);

		const todayMin = service.getTodayFocusMinutes();
		const streak = service.getStreak();
		const totalMin = service.getTotalFocusMinutes();

		const activeDays = Math.max(1, dayCount);
		const avgMin = Math.round(totals.current / Math.min(dayCount, daysElapsedSince(curStart)));

		const daily = service.getDailyMinutes(Math.min(dayCount, 365));
		const bestMin = daily.reduce((m, d) => Math.max(m, d.minutes), 0);

		// Best-day trophy card at the top
		const trophy = kpiCol.createDiv({ cls: 'dashboard-pomodoro-kpi-trophy' });
		setIcon(trophy.createSpan({ cls: 'dashboard-pomodoro-kpi-trophy-icon' }), 'trophy');
		const trophyText = trophy.createDiv({ cls: 'dashboard-pomodoro-kpi-trophy-text' });
		trophyText.createDiv({ cls: 'dashboard-pomodoro-kpi-trophy-value', text: formatMinutes(bestMin) });
		trophyText.createDiv({ cls: 'dashboard-pomodoro-kpi-trophy-label', text: t('pomodoro.bestDay') });

		const delta = totals.previous > 0 ? ((totals.current - totals.previous) / totals.previous) * 100 : undefined;
		const summary = kpiCol.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
		kpiCard(summary, formatMinutes(totals.current), rangeLabel(), delta);
		kpiCard(summary, formatMinutes(todayMin), t('pomodoro.todayFocus'));
		kpiCard(summary, formatMinutes(avgMin), t('pomodoro.avgPerDay'));
		kpiCard(summary, String(streak), t('pomodoro.streakDays'));
		kpiCard(summary, formatMinutes(totalMin), t('pomodoro.totalFocus'));
		void activeDays;
	}

	function rangeLabel(): string {
		switch (activeRange) {
			case 'day': return t('pomodoro.todayFocus');
			case 'week': return t('pomodoro.weekFocus');
			case 'month': return t('pomodoro.rangeMonth');
			case 'year': return t('pomodoro.rangeYear');
			case 'all': return t('pomodoro.totalFocus');
		}
	}

	// --- Mid column: donut ---
	const donutSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	donutSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.timeDistribution') });
	const donutContainer = donutSection.createDiv({ cls: 'dashboard-pomodoro-donut-container dashboard-pomodoro-donut-container--wide' });

	function renderDonut(): void {
		donutContainer.empty();
		const breakdown = rangeBreakdown(activeRange);
		const sorted = [...breakdown.entries()].sort((a, b) => b[1] - a[1]);
		const totalRangeMin = sorted.reduce((sum, [, m]) => sum + m, 0);

		if (totalRangeMin === 0) {
			donutContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}

		const size = 200;
		const strokeWidth = 32;
		const donutR = (size - strokeWidth) / 2;
		const circumference = 2 * Math.PI * donutR;

		const wrap = donutContainer.createDiv({ cls: 'dashboard-pomodoro-donut-wrap' });
		const svg = wrap.createSvg('svg', {
			cls: 'dashboard-pomodoro-donut-svg',
			attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) },
		});
		svg.createSvg('circle', {
			attr: { cx: size / 2, cy: size / 2, r: donutR, fill: 'none', 'stroke-width': strokeWidth },
			cls: 'dashboard-pomodoro-donut-bg',
		});

		const centerValue = svg.createSvg('text', {
			attr: { x: size / 2, y: size / 2 - 6, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
			cls: 'dashboard-pomodoro-donut-center-value',
		});
		centerValue.textContent = formatMinutes(totalRangeMin);
		const centerLabel = svg.createSvg('text', {
			attr: { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
			cls: 'dashboard-pomodoro-donut-center-label',
		});
		centerLabel.textContent = '';

		let offset = 0;
		const gap = sorted.length > 1 ? 3 : 0;
		for (const [name, mins] of sorted) {
			const pct = mins / totalRangeMin;
			const dashLen = Math.max(0, circumference * pct - gap);
			const circle = svg.createSvg('circle', {
				cls: 'dashboard-pomodoro-donut-segment',
				attr: {
					cx: size / 2, cy: size / 2, r: donutR, fill: 'none',
					'stroke-width': strokeWidth,
					'stroke-dasharray': `${dashLen} ${circumference - dashLen}`,
					'stroke-dashoffset': String(-offset),
					transform: `rotate(-90 ${size / 2} ${size / 2})`,
					'stroke-linecap': 'butt',
				},
			});
			circle.style.stroke = activityColor(name);
			offset += dashLen + gap;

			circle.addEventListener('mouseenter', () => {
				circle.setAttribute('stroke-width', String(strokeWidth + 6));
				centerValue.textContent = formatMinutes(mins);
				centerLabel.textContent = `${name} · ${Math.round(pct * 100)}%`;
			});
			circle.addEventListener('mouseleave', () => {
				circle.setAttribute('stroke-width', String(strokeWidth));
				centerValue.textContent = formatMinutes(totalRangeMin);
				centerLabel.textContent = '';
			});
		}

		const legend = donutContainer.createDiv({ cls: 'dashboard-pomodoro-donut-legend dashboard-pomodoro-donut-legend--grid' });
		for (const [name, mins] of sorted) {
			const pct = Math.round((mins / totalRangeMin) * 100);
			const item = legend.createDiv({ cls: 'dashboard-pomodoro-donut-legend-item' });
			const dot = item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
			dot.style.backgroundColor = activityColor(name);
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-name', text: name });
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-pct', text: pct + '%' });
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-time', text: formatMinutes(mins) });
		}
	}

	// --- Mid column: trend chart (adaptive granularity) ---
	const trendSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const trendTitle = trendSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.trend') });
	const trendContainer = trendSection.createDiv({ cls: 'dashboard-pomodoro-trend-container' });

	function renderTrend(): void {
		trendContainer.empty();
		trendTitle.textContent = trendTitleText();

		let bars: { label: string; minutes: number; tooltip: string }[];
		if (activeRange === 'day') {
			bars = service.getTodayHourlyMinutes().map(h => ({
				label: String(h.hour).padStart(2, '0'),
				minutes: h.minutes,
				tooltip: `${String(h.hour).padStart(2, '0')}:00 · ${formatMinutes(h.minutes)}`,
			}));
		} else if (activeRange === 'all') {
			bars = service.getMonthlyMinutes().map(m => ({
				label: m.month.slice(2), // YY-MM
				minutes: m.minutes,
				tooltip: `${m.month} · ${formatMinutes(m.minutes)}`,
			}));
		} else {
			const { dayCount } = datesForRange(activeRange);
			const daily = service.getDailyMinutes(Math.min(dayCount, 31));
			bars = daily.map(d => ({
				label: d.date.slice(8), // day of month
				minutes: d.minutes,
				tooltip: `${d.date} · ${formatMinutes(d.minutes)}`,
			}));
		}

		if (bars.length === 0 || bars.every(b => b.minutes === 0)) {
			trendContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}

		const width = 520;
		const height = 120;
		const maxMin = Math.max(...bars.map(b => b.minutes), 1);
		const step = width / bars.length;
		const barW = Math.max(2, Math.min(18, step * 0.6));

		const svg = trendContainer.createSvg('svg', {
			cls: 'dashboard-pomodoro-trend-svg',
			attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) },
		});

		bars.forEach((b, i) => {
			const h = Math.round((b.minutes / maxMin) * (height - 10));
			const x = i * step + (step - barW) / 2;
			const rect = svg.createSvg('rect', {
				cls: 'dashboard-pomodoro-trend-bar',
				attr: {
					x, y: height - h, width: barW, height: Math.max(b.minutes > 0 ? 2 : 0, h), rx: 2,
				},
			});
			rect.style.fill = 'var(--db-accent)';

			const title = svg.createSvg('title');
			title.textContent = b.tooltip;
			rect.appendChild(title);

			if (bars.length <= 14 || i % Math.ceil(bars.length / 12) === 0) {
				const txt = svg.createSvg('text', {
					attr: { x: x + barW / 2, y: height + 12, 'text-anchor': 'middle' },
					cls: 'dashboard-pomodoro-trend-tick',
				});
				txt.textContent = b.label;
			}
		});
	}

	function trendTitleText(): string {
		switch (activeRange) {
			case 'day': return t('pomodoro.todayChart');
			case 'week': return t('pomodoro.weekChart');
			case 'month': return t('pomodoro.monthChart');
			case 'year': return t('pomodoro.yearChart');
			case 'all': return t('pomodoro.allChart');
		}
	}

	// --- Right column: activity ranking ---
	const rankSection = rightCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	rankSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.activityRanking') });
	const rankContainer = rankSection.createDiv({ cls: 'dashboard-pomodoro-rank-container' });

	function renderRanking(): void {
		rankContainer.empty();
		const breakdown = rangeBreakdown(activeRange);
		const sorted = [...breakdown.entries()].sort((a, b) => b[1] - a[1]);
		const maxMin = sorted[0]?.[1] ?? 1;

		if (sorted.length === 0) {
			rankContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}

		for (const [name, mins] of sorted) {
			const row = rankContainer.createDiv({ cls: 'dashboard-pomodoro-rank-row' });
			const head = row.createDiv({ cls: 'dashboard-pomodoro-rank-head' });
			const dot = head.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
			dot.style.backgroundColor = activityColor(name);
			head.createDiv({ cls: 'dashboard-pomodoro-rank-name', text: name });
			head.createDiv({ cls: 'dashboard-pomodoro-rank-time', text: formatMinutes(mins) });
			const barWrap = row.createDiv({ cls: 'dashboard-pomodoro-rank-bar-wrap' });
			barWrap.createDiv({
				cls: 'dashboard-pomodoro-rank-bar',
			}).style.width = `${Math.max(3, Math.round((mins / maxMin) * 100))}%`;
			(barWrap.firstElementChild as HTMLElement).style.backgroundColor = activityColor(name);
		}
	}

	// --- Right column: heatmap (12 weeks) ---
	const heatSection = rightCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const heatHead = heatSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title-row' });
	heatHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.heatmap') });
	heatHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-hint', text: t('pomodoro.heatmapHint') });
	const heatContainer = heatSection.createDiv({ cls: 'dashboard-pomodoro-heatmap-container' });

	function renderHeatmap(): void {
		heatContainer.empty();
		const daily = service.getHeatmapMinutes();
		const maxMin = Math.max(...daily.map(d => d.minutes), 1);

		const cell = 11;
		const gap = 3;
		const cols = 12; // weeks
		const rows = 7;  // days
		const width = cols * (cell + gap);
		const height = rows * (cell + gap);

		const svg = heatContainer.createSvg('svg', {
			cls: 'dashboard-pomodoro-heatmap-svg',
			attr: { viewBox: `0 0 ${width} ${height}`, width: '100%' },
		});

		daily.forEach((d, i) => {
			const col = Math.floor(i / rows);
			const row = i % rows;
			const x = col * (cell + gap);
			const y = row * (cell + gap);
			const rect = svg.createSvg('rect', {
				cls: 'dashboard-pomodoro-heatmap-cell'
					+ (d.minutes > 0 ? ' dashboard-pomodoro-heatmap-cell--active' : ''),
				attr: { x, y, width: cell, height: cell, rx: 2.5 },
			});
			if (d.minutes > 0) {
				const level = Math.min(1, d.minutes / maxMin);
				rect.style.fill = 'var(--db-accent)';
				rect.style.opacity = String(0.25 + level * 0.75);
			}
			const title = svg.createSvg('title');
			title.textContent = `${d.date} · ${formatMinutes(d.minutes)}`;
			rect.appendChild(title);
		});
	}

	// --- Right column: recent records ---
	const recentSection = rightCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	recentSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.recentSessions') });
	const recentContainer = recentSection.createDiv({ cls: 'dashboard-pomodoro-recent-container' });

	function renderRecent(): void {
		recentContainer.empty();
		const records = service.getRecentRecords(10);
		if (records.length === 0) {
			recentContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}
		for (const rec of records as PomodoroRecord[]) {
			const row = recentContainer.createDiv({ cls: 'dashboard-pomodoro-stats-record-row' });
			const actDot = row.createDiv({ cls: 'dashboard-pomodoro-stats-record-dot' });
			actDot.style.backgroundColor = activityColor(rec.activity || t('pomodoro.defaultActivity'));
			const ts = new Date(rec.timestamp);
			const dateStr = (ts.getMonth() + 1) + '/' + ts.getDate() + ' ' +
				String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0');
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-date', text: dateStr });
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-activity', text: rec.activity });
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-duration', text: rec.duration + ' min' });
		}
	}

	function renderAll(): void {
		renderKpis();
		renderDonut();
		renderTrend();
		renderRanking();
		renderHeatmap();
		renderRecent();
	}

	toggleButtons.forEach((btn, i) => {
		btn.addEventListener('click', () => {
			activeRange = RANGES[i]!.key;
			toggleButtons.forEach((b, j) => b.toggleClass('dashboard-pomodoro-range-btn--active', j === i));
			renderAll();
		});
	});

	renderAll();
}

function daysElapsedSince(startStr: string): number {
	const start = new Date(startStr + 'T00:00:00');
	if (Number.isNaN(start.getTime())) return 1;
	const diff = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
	return Math.max(1, diff);
}

function formatMinutes(minutes: number): string {
	if (minutes < 60) {
		return t('pomodoro.minutes', { count: minutes });
	}
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) return t('pomodoro.hours', { count: hours });
	return t('pomodoro.hours', { count: hours }) + ' ' + t('pomodoro.minutes', { count: mins });
}
