import { setIcon } from 'obsidian';
import { t } from './i18n';
import {
	PomodoroService,
	activityColor,
} from './pomodoro-service';
import { openPomodoroTagManager } from './pomodoro-tag-manager';
import { renderPomodoroGarden } from './pomodoro-garden';

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

/** Heatmap color steps: [threshold minutes, color] — zero falls back to faint. */
const HEAT_STEPS: [number, string][] = [
	[46, 'var(--db-accent)'],
	[16, 'color-mix(in srgb, var(--db-accent) 65%, var(--db-bg-hover))'],
	[1, 'color-mix(in srgb, var(--db-accent) 35%, var(--db-bg-hover))'],
];

function heatColor(minutes: number): string {
	for (const [min, color] of HEAT_STEPS) {
		if (minutes >= min) return color;
	}
	return '';
}

/**
 * Mount point for the stats overlay. The `--db-*` theme variables live on
 * `.apex-dashboard-root[data-theme]`, so the overlay must be appended INSIDE
 * that root (not doc.body) or every var() resolves to nothing and the charts
 * render blank. The root has no transform/filter, so the overlay's
 * position:fixed still anchors to the viewport.
 */
function mountOverlay(doc: Document): HTMLElement {
	const root = doc.querySelector('.apex-dashboard-root');
	const host = root ?? doc.body;
	return host.createDiv({ cls: 'dashboard-pomodoro-stats-overlay' });
}

/**
 * Landscape (≈1040×680) focus-statistics overlay.
 *
 * Layout:
 *  header — title + one-line insight + range toggle + tag-manage + close
 *  left   — KPI column grouped "today state" (large) / "history" (compact)
 *  mid    — goal gauge (single activity) or activity donut + adaptive trend
 *           chart with daily-goal baseline + hour-of-day distribution strip
 *  right  — activity ranking (click to filter trend) + 12-week gradient
 *           heatmap + today timeline
 *
 * All charts are hand-rolled SVG (zero dependencies). Under 900px viewport
 * width the grid collapses to a single column (mobile).
 */
export function showPomodoroStats(doc: Document, service: PomodoroService): void {
	const overlay = mountOverlay(doc);
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal dashboard-pomodoro-stats-modal--wide' });

	/** Activity filter applied to trend/ranking; null = all activities. */
	let activityFilter: string | null = null;

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
	doc.addEventListener('keydown', onKey);

	// ===== Header =====
	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	const titleWrap = header.createDiv({ cls: 'dashboard-pomodoro-stats-header-titlewrap' });
	titleWrap.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: t('pomodoro.statsTitle') });
	const insightEl = titleWrap.createDiv({ cls: 'dashboard-pomodoro-insight' });

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

	// Close sits directly on the header (not inside headerRight) so the
	// mobile layout can keep it on the title line while the range toggle
	// drops to its own row below.
	const closeBtn = header.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	// Activity-filter chip row (hidden by default via CSS; shown when a filter is active)
	const filterBar = modal.createDiv({ cls: 'dashboard-pomodoro-filterbar' });

	// ===== Body grid =====
	const body = modal.createDiv({ cls: 'dashboard-pomodoro-stats-body' });
	const kpiCol = body.createDiv({ cls: 'dashboard-pomodoro-kpi-col' });
	const midCol = body.createDiv({ cls: 'dashboard-pomodoro-mid-col' });
	const rightCol = body.createDiv({ cls: 'dashboard-pomodoro-right-col' });

	let activeRange: PomodoroRangeKey = 'week';

	// --- Date-window helpers (natural periods) ---
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

	// ===== Left column: grouped KPIs =====
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

		// --- Group 1: today's state (large, hero numbers) ---
		const todayGroup = kpiCol.createDiv({ cls: 'dashboard-pomodoro-kpi-group' });
		todayGroup.createDiv({ cls: 'dashboard-pomodoro-kpi-group-title', text: t('pomodoro.kpiTodayGroup') });

		const goal = service.getTodayGoal();
		const hero = todayGroup.createDiv({ cls: 'dashboard-pomodoro-kpi-hero dashboard-pomodoro-kpi-hero--gauge' });
		// Goal editor entry: a small pencil pinned to the card's top-right
		// corner (it used to sit inline after "/ N", oversized and pushing
		// the centered numbers off balance).
		const goalEditBtn = hero.createDiv({
			cls: 'dashboard-pomodoro-kpi-hero-edit',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('pomodoro.editGoal') },
		});
		setIcon(goalEditBtn, 'pencil');
		goalEditBtn.addEventListener('click', () => showGoalEditor());
		goalEditBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showGoalEditor(); }
		});

		// Goal gauge (the 270-degree arc design that used to lead the mid
		// column, relocated here when the focus garden took that slot).
		const heroPct = goal.goal > 0 ? Math.min(1, goal.completed / goal.goal) : 0;
		const gSize = 132;
		const gStroke = 15;
		const gCx = gSize / 2;
		const gCy = gSize / 2 + 4;
		const gR = (gSize - gStroke * 2) / 2 - 6;
		const gStart = 135;
		const gSweep = 270;
		const heroSvg = hero.createSvg('svg', {
			cls: 'dashboard-pomodoro-kpi-hero-gauge',
			attr: { viewBox: `0 0 ${gSize} ${gSize}`, width: String(gSize), height: String(gSize) },
		});
		heroSvg.createSvg('path', {
			cls: 'dashboard-pomodoro-donut-bg',
			attr: {
				d: describeArc(gCx, gCy, gR, gStart, gStart + gSweep),
				fill: 'none', 'stroke-width': gStroke, 'stroke-linecap': 'round',
			},
		});
		if (goal.completed > 0) {
			const valArc = heroSvg.createSvg('path', {
				attr: {
					d: describeArc(gCx, gCy, gR, gStart, gStart + gSweep * heroPct),
					fill: 'none', 'stroke-width': gStroke, 'stroke-linecap': 'round',
				},
			});
			valArc.style.stroke = heroPct >= 1 ? '#2ecc71' : 'var(--db-accent)';
		}
		const heroCenter = heroSvg.createSvg('text', {
			attr: { x: gCx, y: gCy - 3, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
			cls: 'dashboard-pomodoro-kpi-hero-gauge-value',
		});
		heroCenter.textContent = `${goal.completed}/${goal.goal}`;
		const heroCenterLabel = heroSvg.createSvg('text', {
			attr: { x: gCx, y: gCy + 17, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
			cls: 'dashboard-pomodoro-donut-center-label',
		});
		heroCenterLabel.textContent = t('pomodoro.todayPomodoros');
		hero.createDiv({
			cls: 'dashboard-pomodoro-kpi-hero-label',
			text: t('pomodoro.todayPomodoros') + ' · ' + Math.round(heroPct * 100) + '%',
		});

		const todayRow = todayGroup.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
		kpiCard(todayRow, formatMinutes(service.getTodayFocusMinutes()), t('pomodoro.todayFocus'));
		const score = service.getTodayScore();
		const scoreCard = kpiCard(todayRow, String(score), t('pomodoro.efficiencyScore'));
		scoreCard.toggleClass('dashboard-pomodoro-stats-card--good', score >= 80);

		const todayRow2 = todayGroup.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
		const inter = service.getTodayInterruptions();
		const interCard = kpiCard(todayRow2, String(inter), t('pomodoro.interruptions'));
		interCard.toggleClass('dashboard-pomodoro-stats-card--warn', inter >= 3);
		const adherence = service.getBreakAdherence();
		kpiCard(todayRow2, adherence === null ? '—' : adherence + '%', t('pomodoro.breakAdherence'));

		// Streak with encouragement
		const streak = service.getStreak();
		const streakRow = todayGroup.createDiv({ cls: 'dashboard-pomodoro-kpi-streak' });
		setIcon(streakRow.createSpan({ cls: 'dashboard-pomodoro-kpi-streak-icon' }), 'flame');
		streakRow.createDiv({ cls: 'dashboard-pomodoro-kpi-streak-value', text: String(streak) });
		streakRow.createDiv({ cls: 'dashboard-pomodoro-kpi-streak-label', text: t('pomodoro.streakDays') });
		streakRow.createDiv({ cls: 'dashboard-pomodoro-kpi-streak-hint', text: streakText(streak) });

		// --- Group 2: focus forest (history) ---
		const histGroup = kpiCol.createDiv({ cls: 'dashboard-pomodoro-kpi-group dashboard-pomodoro-kpi-group--hist' });
		histGroup.createDiv({ cls: 'dashboard-pomodoro-kpi-group-title', text: t('pomodoro.kpiHistoryGroup') });

		const { curStart, prevStart, prevEnd } = datesForRange(activeRange);
		const totals = service.getRangeTotals(curStart, prevStart, prevEnd);
		const delta = totals.previous > 0 ? ((totals.current - totals.previous) / totals.previous) * 100 : undefined;

		const histRow = histGroup.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
		kpiCard(histRow, formatMinutes(totals.current), rangeLabel(), delta);
		kpiCard(histRow, formatMinutes(service.getRecent7AvgMinutes()), t('pomodoro.avg7'));
		const histRow2 = histGroup.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
		kpiCard(histRow2, formatMinutes(service.getTotalFocusMinutes()), t('pomodoro.totalFocus'));

		const daily = service.getDailyMinutes(365);
		const bestMin = daily.reduce((m, d) => Math.max(m, d.minutes), 0);
		kpiCard(histRow2, formatMinutes(bestMin), t('pomodoro.bestDay'));
	}

	/** Inline popover under the hero card to change the daily pomodoro goal. */
	function showGoalEditor(): void {
		// One at a time
		modal.querySelector('.dashboard-pomodoro-goal-editor')?.remove();
		const editor = kpiCol.createDiv({ cls: 'dashboard-pomodoro-goal-editor' });
		editor.createDiv({ cls: 'dashboard-pomodoro-goal-editor-label', text: t('pomodoro.editGoalLabel') });
		const controls = editor.createDiv({ cls: 'dashboard-pomodoro-goal-editor-controls' });

		const decBtn = controls.createEl('button', { cls: 'dashboard-pomodoro-goal-editor-step' });
		setIcon(decBtn, 'minus');
		const valueEl = controls.createDiv({ cls: 'dashboard-pomodoro-goal-editor-value' });
		const incBtn = controls.createEl('button', { cls: 'dashboard-pomodoro-goal-editor-step' });
		setIcon(incBtn, 'plus');

		const settings = service.getGoalSettings();
		valueEl.textContent = String(settings.pomodoroDailyGoal);

		const apply = (value: number) => {
			const clamped = Math.max(1, Math.min(16, value));
			settings.pomodoroDailyGoal = clamped;
			valueEl.textContent = String(clamped);
			void service.saveGoalSettings();
		};
		decBtn.addEventListener('click', () => apply(settings.pomodoroDailyGoal - 1));
		incBtn.addEventListener('click', () => apply(settings.pomodoroDailyGoal + 1));

		// Dismiss on outside click
		window.setTimeout(() => {
			const onDown = (e: MouseEvent) => {
				if (!editor.contains(e.target as Node)) {
					editor.remove();
					doc.removeEventListener('mousedown', onDown);
					renderAll();
				}
			};
			doc.addEventListener('mousedown', onDown);
		}, 0);
	}

	function streakText(streak: number): string {
		if (streak <= 0) return t('pomodoro.streakRestart');
		if (streak === 1) return t('pomodoro.streakDay1');
		if (streak < 3) return t('pomodoro.streakDay2');
		if (streak < 7) return t('pomodoro.streakDay3');
		return t('pomodoro.streakWeek');
	}

	function rangeLabel(): string {
		switch (activeRange) {
			case 'day': return t('pomodoro.todayFocus');
			case 'week': return t('pomodoro.weekFocus');
			case 'month': return t('pomodoro.monthFocus');
			case 'year': return t('pomodoro.yearFocus');
			case 'all': return t('pomodoro.totalFocus');
		}
	}

	// ===== Mid column =====
	// The focus garden leads the mid column (it replaced the old goal-gauge
	// card; today's goal now lives as a gauge in the left column's hero).
	const gardenSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const gardenHead = gardenSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title-row' });
	gardenHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.gardenTitle') });
	gardenHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-hint', text: t('pomodoro.gardenHint') });
	const gardenContainer = gardenSection.createDiv({ cls: 'dashboard-pomodoro-garden' });

	const donutSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const donutTitle = donutSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: '' });
	const donutContainer = donutSection.createDiv({ cls: 'dashboard-pomodoro-donut-container dashboard-pomodoro-donut-container--wide' });

	function renderGarden(): void {
		renderPomodoroGarden(gardenContainer, service);
	}

	function renderDonut(): void {
		donutContainer.empty();
		const breakdown = rangeBreakdown(activeRange);
		const sorted = [...breakdown.entries()].sort((a, b) => b[1] - a[1]);
		const totalRangeMin = sorted.reduce((sum, [, m]) => sum + m, 0);

		// Zero or a single activity carries no distribution — the goal gauge
		// moved to the left column's hero, so this card simply hides.
		if (sorted.length <= 1) {
			donutTitle.textContent = t('pomodoro.timeDistribution');
			donutSection.addClass('dashboard-pomodoro-stats-section--hidden');
			return;
		}
		donutSection.removeClass('dashboard-pomodoro-stats-section--hidden');
		donutTitle.textContent = t('pomodoro.timeDistribution');
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

	/** SVG path for an arc between two angles (degrees, 0 = 3 o'clock). */
	function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
		const polar = (angle: number): [number, number] => {
			const rad = (angle * Math.PI) / 180;
			return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
		};
		const [sx, sy] = polar(startAngle);
		const [ex, ey] = polar(endAngle);
		const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
		return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
	}

	// --- Trend chart (adaptive granularity + goal baseline + drill-down) ---
	const trendSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const trendTitle = trendSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.trend') });
	const trendContainer = trendSection.createDiv({ cls: 'dashboard-pomodoro-trend-container' });

	function renderTrend(): void {
		trendContainer.empty();
		trendTitle.textContent = trendTitleText() + (activityFilter ? ` · ${activityFilter}` : '');

		let bars: { label: string; minutes: number; tooltip: string; date?: string }[];
		if (activeRange === 'day') {
			bars = service.getTodayHourlyMinutes().map(h => ({
				label: String(h.hour).padStart(2, '0'),
				minutes: h.minutes,
				tooltip: `${String(h.hour).padStart(2, '0')}:00 · ${formatMinutes(h.minutes)}`,
			}));
		} else if (activeRange === 'all') {
			bars = service.getMonthlyMinutes().map(m => ({
				label: m.month.slice(2),
				minutes: m.minutes,
				tooltip: `${m.month} · ${formatMinutes(m.minutes)}`,
			}));
		} else {
			const { dayCount } = datesForRange(activeRange);
			const daily = service.getDailyMinutes(Math.min(dayCount, 31));
			bars = daily.map(d => ({
				label: d.date.slice(8),
				minutes: d.minutes,
				tooltip: `${d.date} · ${formatMinutes(d.minutes)}`,
				date: d.date,
			}));
			// Activity filter: recompute per-day minutes for the selected tag only.
			if (activityFilter) {
				bars = bars.map(b => {
					const recs = b.date ? service.getRecordsForDate(b.date) : [];
					const mins = recs.filter(r => r.activity === activityFilter).reduce((s, r) => s + r.duration, 0);
					return { ...b, minutes: mins, tooltip: `${b.date} · ${activityFilter} · ${formatMinutes(mins)}` };
				});
			}
		}

		if (bars.length === 0 || bars.every(b => b.minutes === 0)) {
			trendContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}

		const width = 520;
		const height = 168;
		const goal = service.getTodayGoal();
		const workMin = service.getWorkMinutes();
		// Daily goal baseline in minutes (only meaningful on day-granularity bars)
		const goalMinutes = goal.goal * workMin;
		const showBaseline = bars.some(b => b.date) && !activityFilter;
		const maxMin = Math.max(...bars.map(b => b.minutes), showBaseline ? goalMinutes : 0, 1);
		const step = width / bars.length;
		const barW = Math.max(2, Math.min(18, step * 0.6));

		const svg = trendContainer.createSvg('svg', {
			cls: 'dashboard-pomodoro-trend-svg',
			attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) },
		});

		// Goal baseline (dashed) — a bar without a reference point.
		if (showBaseline) {
			const y = height - Math.round((goalMinutes / maxMin) * (height - 10));
			if (y > 0 && y < height) {
				svg.createSvg('line', {
					cls: 'dashboard-pomodoro-trend-goal-line',
					attr: { x1: 0, y1: y, x2: width, y2: y, 'stroke-dasharray': '5 4' },
				});
				const gl = svg.createSvg('text', {
					attr: { x: width - 2, y: y - 4, 'text-anchor': 'end' },
					cls: 'dashboard-pomodoro-trend-goal-label',
				});
				gl.textContent = t('pomodoro.goalBaseline', { count: goal.goal });
			}
		}

		bars.forEach((b, i) => {
			const h = Math.round((b.minutes / maxMin) * (height - 10));
			const x = i * step + (step - barW) / 2;
			const rect = svg.createSvg('rect', {
				// Single-token cls only — createSvg feeds it to classList.add on
				// some Obsidian builds and a space throws (see habit heatmap).
				cls: 'dashboard-pomodoro-trend-bar',
				attr: {
					x, y: height - h, width: barW, height: Math.max(b.minutes > 0 ? 2 : 0, h), rx: 2,
				},
			});
			if (b.date) rect.addClass('dashboard-pomodoro-trend-bar--clickable');
			rect.style.fill = activityFilter ? activityColor(activityFilter) : 'var(--db-accent)';

			const title = svg.createSvg('title');
			title.textContent = b.tooltip + (b.date ? ' · ' + t('pomodoro.clickToDrill') : '');
			rect.appendChild(title);

			if (b.date) {
				rect.addEventListener('click', () => showDayDrilldown(b.date!));
			}

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

	// --- Hour-of-day distribution strip ---
	const hourSection = midCol.createDiv({ cls: 'dashboard-pomodoro-stats-section dashboard-pomodoro-hour-section' });
	const hourHead = hourSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title-row' });
	hourHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.hourDistribution') });
	const peak = service.getPeakHour();
	if (peak !== null) {
		hourHead.createDiv({
			cls: 'dashboard-pomodoro-stats-section-hint',
			text: t('pomodoro.peakHour', { hour: `${String(peak).padStart(2, '0')}:00` }),
		});
	}
	const hourContainer = hourSection.createDiv({ cls: 'dashboard-pomodoro-hour-container' });

	function renderHourDistribution(): void {
		hourContainer.empty();
		const dist = service.getHourDistribution();
		const maxMin = Math.max(...dist.map(d => d.minutes), 1);
		const peakHour = dist.reduce((m, d) => d.minutes > m.minutes ? d : m, dist[0]!).hour;

		for (const b of dist) {
			const cell = hourContainer.createDiv({
				cls: 'dashboard-pomodoro-hour-cell'
					+ (b.hour === peakHour && b.minutes > 0 ? ' dashboard-pomodoro-hour-cell--peak' : ''),
			});
			cell.setAttribute('title', `${String(b.hour).padStart(2, '0')}:00 · ${formatMinutes(b.minutes)}`);
			const bar = cell.createDiv({ cls: 'dashboard-pomodoro-hour-bar' });
			bar.style.height = `${Math.max(3, Math.round((b.minutes / maxMin) * 44))}px`;
			if (b.minutes === 0) bar.addClass('dashboard-pomodoro-hour-bar--empty');
			cell.createDiv({ cls: 'dashboard-pomodoro-hour-tick', text: b.hour % 6 === 0 ? String(b.hour) : '' });
		}
	}

	// ===== Right column (visual order: timeline, heatmap, ranking) =====
	const timelineSection = rightCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const timelineHead = timelineSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title-row' });
	timelineHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.todayTimeline') });
	// What this section means, right in the header — "why is it empty" is the
	// most common question when the day has no completed pomodoros yet.
	timelineHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-hint', text: t('pomodoro.todayTimelineHint') });
	const timelineContainer = timelineSection.createDiv({ cls: 'dashboard-pomodoro-timeline-container' });

	const heatSection = rightCol.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const heatHead = heatSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title-row' });
	heatHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.heatmap') });
	heatHead.createDiv({ cls: 'dashboard-pomodoro-stats-section-hint', text: t('pomodoro.heatmapHint') });
	const heatWrap = heatSection.createDiv({ cls: 'dashboard-pomodoro-heatmap-wrap' });
	const heatContainer = heatWrap.createDiv({ cls: 'dashboard-pomodoro-heatmap-container' });
	const heatLegend = heatSection.createDiv({ cls: 'dashboard-pomodoro-heatmap-legend' });

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
			const row = rankContainer.createDiv({
				cls: 'dashboard-pomodoro-rank-row' + (activityFilter === name ? ' dashboard-pomodoro-rank-row--active' : ''),
				attr: { role: 'button', tabindex: '0' },
			});
			row.setAttribute('title', t('pomodoro.filterByActivity'));
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

			const toggleFilter = () => {
				activityFilter = activityFilter === name ? null : name;
				renderFilterBar();
				renderTrend();
				renderRanking();
			};
			row.addEventListener('click', toggleFilter);
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter(); }
			});
		}
	}

	function renderFilterBar(): void {
		filterBar.empty();
		if (!activityFilter) {
			filterBar.removeClass('dashboard-pomodoro-filterbar--visible');
			return;
		}
		filterBar.addClass('dashboard-pomodoro-filterbar--visible');
		const chip = filterBar.createDiv({ cls: 'dashboard-pomodoro-filterbar-chip' });
		const dot = chip.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
		dot.style.backgroundColor = activityColor(activityFilter);
		chip.createSpan({ text: t('pomodoro.filterActive', { name: activityFilter }) });
		const clear = filterBar.createDiv({ cls: 'dashboard-pomodoro-filterbar-clear' });
		setIcon(clear, 'x');
		clear.setAttribute('role', 'button');
		clear.addEventListener('click', () => {
			activityFilter = null;
			renderFilterBar();
			renderTrend();
			renderRanking();
		});
	}

	// --- Heatmap (12 weeks, 4-step gradient) — section DOM created with the
	// right column above (visual slot 2); only the renderer lives here. ---
	function renderHeatmap(): void {
		heatContainer.empty();
		heatLegend.empty();
		const daily = service.getHeatmapMinutes();

		// Wrapping div grid (banner heatmap pattern) instead of SVG: cells flow
		// oldest→today at a fixed pitch and FILL the column width — the old
		// fixed-168px SVG canvas huddled in the middle of a ~300px column, and
		// a width:100% SVG inside the scrollable body could still collapse to
		// 0 height on the first paint (blank right column until a re-render).
		const grid = heatContainer.createDiv({ cls: 'dashboard-pomodoro-heatmap-grid' });
		let activeInLastWeek = 0;
		daily.forEach((d, i) => {
			if (i >= daily.length - 7 && d.minutes > 0) activeInLastWeek++;
			const cell = grid.createDiv({ cls: 'dashboard-pomodoro-heatmap-cell' });
			cell.setAttribute('title', `${d.date} · ${formatMinutes(d.minutes)}`);
			const color = heatColor(d.minutes);
			if (color) cell.style.backgroundColor = color;
		});

		// Empty-week guidance: a wall of faint cells frustrates new users.
		if (activeInLastWeek === 0 && daily.every(d => d.minutes === 0)) {
			heatWrap.createDiv({
				cls: 'dashboard-pomodoro-heatmap-empty',
				text: t('pomodoro.heatmapEmptyHint'),
			});
		}

		// 4-step gradient legend
		const legendItems = [
			{ label: '0', color: '' },
			{ label: '1-15', color: heatColor(1) },
			{ label: '16-45', color: heatColor(16) },
			{ label: '46+', color: heatColor(46) },
		];
		heatLegend.createSpan({ cls: 'dashboard-pomodoro-heatmap-legend-label', text: t('pomodoro.less') });
		for (const item of legendItems) {
			const sw = heatLegend.createDiv({ cls: 'dashboard-pomodoro-heatmap-legend-swatch' });
			if (item.color) sw.style.backgroundColor = item.color;
		}
		heatLegend.createSpan({ cls: 'dashboard-pomodoro-heatmap-legend-label', text: t('pomodoro.more') });
	}

	// --- Today timeline (work → break rhythm) — section DOM created with the
	// right column above (visual slot 1); only the renderer lives here. ---
	function renderTimeline(): void {
		timelineContainer.empty();
		const records = service.getTodayTimeline();
		if (records.length === 0) {
			const empty = timelineContainer.createDiv({ cls: 'dashboard-pomodoro-timeline-empty' });
			empty.createDiv({ cls: 'dashboard-pomodoro-timeline-empty-text', text: t('pomodoro.timelineEmpty') });
			const startBtn = empty.createEl('button', { cls: 'dashboard-pomodoro-timeline-start', text: t('pomodoro.startFocus') });
			startBtn.addEventListener('click', () => close());
			return;
		}

		for (const rec of records) {
			const item = timelineContainer.createDiv({ cls: 'dashboard-pomodoro-timeline-item' });
			const head = item.createDiv({ cls: 'dashboard-pomodoro-timeline-head' });
			const time = new Date(rec.timestamp);
			head.createDiv({
				cls: 'dashboard-pomodoro-timeline-time',
				text: String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0'),
			});
			head.createDiv({ cls: 'dashboard-pomodoro-timeline-activity' }, el => {
				const dot = el.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
				dot.style.backgroundColor = activityColor(rec.activity || t('pomodoro.defaultActivity'));
				el.createSpan({ text: rec.activity || t('pomodoro.defaultActivity') });
			});
			head.createDiv({ cls: 'dashboard-pomodoro-timeline-duration', text: formatMinutes(rec.duration) });
			const done = head.createDiv({ cls: 'dashboard-pomodoro-timeline-done' });
			setIcon(done, 'check');
			done.setAttribute('title', t('pomodoro.timelineDone'));

			// Break rhythm line (only when the new fields exist)
			if (rec.breakCompleted !== undefined) {
				const sub = item.createDiv({ cls: 'dashboard-pomodoro-timeline-sub' });
				setIcon(sub.createSpan({ cls: 'dashboard-pomodoro-timeline-sub-icon' }), rec.breakCompleted ? 'coffee' : 'zap-off');
				sub.createSpan({
					text: rec.breakCompleted
						? t('pomodoro.breakTaken', { count: rec.breakMinutes ?? 0 })
						: t('pomodoro.breakSkipped'),
				});
				if (rec.interruptions && rec.interruptions > 0) {
					sub.createSpan({ cls: 'dashboard-pomodoro-timeline-interruptions', text: ' · ' + t('pomodoro.interrupted', { count: rec.interruptions }) });
				}
			}
		}
	}

	// --- Day drill-down overlay (click a trend bar) ---
	function showDayDrilldown(date: string): void {
		const records = service.getRecordsForDate(date);
		if (records.length === 0) return;

		const panel = modal.createDiv({ cls: 'dashboard-pomodoro-drilldown' });
		const head = panel.createDiv({ cls: 'dashboard-pomodoro-drilldown-head' });
		head.createDiv({ cls: 'dashboard-pomodoro-drilldown-title', text: date });
		const closeDd = head.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
		setIcon(closeDd, 'x');
		closeDd.addEventListener('click', () => panel.remove());

		const list = panel.createDiv({ cls: 'dashboard-pomodoro-drilldown-list' });
		for (const rec of records) {
			const row = list.createDiv({ cls: 'dashboard-pomodoro-stats-record-row' });
			const actDot = row.createDiv({ cls: 'dashboard-pomodoro-stats-record-dot' });
			actDot.style.backgroundColor = activityColor(rec.activity || t('pomodoro.defaultActivity'));
			const ts = new Date(rec.timestamp);
			row.createDiv({
				cls: 'dashboard-pomodoro-stats-record-date',
				text: String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0'),
			});
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-activity', text: rec.activity });
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-duration', text: rec.duration + ' min' });
			if (rec.interruptions && rec.interruptions > 0) {
				row.createDiv({ cls: 'dashboard-pomodoro-stats-record-interruptions', text: '⏸ ' + rec.interruptions });
			}
		}
		// Click outside closes
		window.setTimeout(() => {
			const onDown = (e: MouseEvent) => {
				if (!panel.contains(e.target as Node)) {
					panel.remove();
					doc.removeEventListener('mousedown', onDown);
				}
			};
			doc.addEventListener('mousedown', onDown);
		}, 0);
	}

	function renderAll(): void {
		insightEl.textContent = service.getInsight();
		renderKpis();
		renderGarden();
		renderDonut();
		renderTrend();
		renderHourDistribution();
		renderRanking();
		renderHeatmap();
		renderTimeline();
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

function formatMinutes(minutes: number): string {
	if (minutes < 60) {
		return t('pomodoro.minutes', { count: minutes });
	}
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) return t('pomodoro.hours', { count: hours });
	return t('pomodoro.hours', { count: hours }) + ' ' + t('pomodoro.minutes', { count: mins });
}
