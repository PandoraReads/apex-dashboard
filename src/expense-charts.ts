import type { ExpenseType } from './expense-service';

/** Fixed per-category palettes (index-stable across views, unlike a hash the
 *  preset keys keep their color even when records are sparse). */
const EXPENSE_PALETTE: Record<string, string> = {
	food: '#e74c3c',
	transport: '#e67e22',
	shopping: '#f1c40f',
	housing: '#9b59b6',
	utilities: '#3498db',
	entertainment: '#e91e63',
	medical: '#1abc9c',
	education: '#00bcd4',
	social: '#ff7043',
	other: '#95a5a6',
};

const INCOME_PALETTE: Record<string, string> = {
	salary: '#2ecc71',
	bonus: '#27ae60',
	investment: '#1abc9c',
	sideJob: '#3498db',
	gift: '#f1c40f',
	other: '#95a5a6',
};

const FALLBACK_COLOR = '#95a5a6';

/** Stable color for a preset category key (gray for unknown/dirty keys). */
export function categoryColor(type: ExpenseType, key: string): string {
	const palette = type === 'expense' ? EXPENSE_PALETTE : INCOME_PALETTE;
	return palette[key] ?? FALLBACK_COLOR;
}

/** Bar colors shared by the widget/stats convention. */
export const EXPENSE_BAR_COLOR = 'var(--db-danger, #e74c3c)';
export const INCOME_BAR_COLOR = '#2ecc71';

/** Shared hover tooltip for the hand-rolled charts: a small floating card
 *  inside the chart container (position:relative in CSS), pinned above the
 *  hovered element — immediately visible, unlike the delayed native title. */
function createChartTip(container: HTMLElement): { show(target: Element, text: string): void; hide(): void } {
	const tip = container.createDiv({ cls: 'dashboard-expense-chart-tip' });
	return {
		show(target: Element, text: string): void {
			tip.setText(text);
			tip.addClass('dashboard-expense-chart-tip--visible');
			const cRect = container.getBoundingClientRect();
			const tRect = target.getBoundingClientRect();
			const above = tRect.top - cRect.top >= 34;
			const left = Math.min(Math.max(tRect.left + tRect.width / 2 - cRect.left, 40), Math.max(40, cRect.width - 40));
			tip.style.left = `${Math.round(left)}px`;
			tip.style.top = `${Math.round(above ? tRect.top - cRect.top - 4 : tRect.bottom - cRect.top + 6)}px`;
			tip.style.transform = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
		},
		hide(): void {
			tip.removeClass('dashboard-expense-chart-tip--visible');
		},
	};
}

// ===== Donut (category share) =====

export interface ExpenseSlice {
	key: string;
	label: string;
	value: number;
	/** Slice stroke color (categoryColor of the key). */
	color: string;
}

/** SVG donut of category shares with hover-to-inspect center and a legend
 *  grid (dot + name + % + amount). Mirrors the pomodoro donut technique:
 *  stroke-dasharray segments with a small gap, rotate(-90) origin. */
export function renderExpenseDonut(
	container: HTMLElement,
	slices: ExpenseSlice[],
	formatValue: (n: number) => string,
	emptyText: string,
): void {
	container.empty();
	const total = slices.reduce((sum, s) => sum + s.value, 0);
	if (total <= 0) {
		container.createDiv({ cls: 'dashboard-expense-donut-empty', text: emptyText });
		return;
	}

	const size = 200;
	const strokeWidth = 30;
	const donutR = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * donutR;

	const wrap = container.createDiv({ cls: 'dashboard-expense-donut-wrap' });
	const svg = wrap.createSvg('svg', {
		cls: 'dashboard-expense-donut-svg',
		attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) },
	});
	svg.createSvg('circle', {
		attr: { cx: size / 2, cy: size / 2, r: donutR, fill: 'none', 'stroke-width': strokeWidth },
		cls: 'dashboard-expense-donut-bg',
	});

	const centerValue = svg.createSvg('text', {
		attr: { x: size / 2, y: size / 2 - 6, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
		cls: 'dashboard-expense-donut-center-value',
	});
	centerValue.textContent = formatValue(total);
	const centerLabel = svg.createSvg('text', {
		attr: { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', 'dominant-baseline': 'middle' },
		cls: 'dashboard-expense-donut-center-label',
	});
	centerLabel.textContent = '';

	let offset = 0;
	const gap = slices.length > 1 ? 3 : 0;
	for (const slice of slices) {
		const pct = slice.value / total;
		const dashLen = Math.max(0, circumference * pct - gap);
		const circle = svg.createSvg('circle', {
			cls: 'dashboard-expense-donut-segment',
			attr: {
				cx: size / 2, cy: size / 2, r: donutR, fill: 'none',
				'stroke-width': strokeWidth,
				'stroke-dasharray': `${dashLen} ${circumference - dashLen}`,
				'stroke-dashoffset': String(-offset),
				transform: `rotate(-90 ${size / 2} ${size / 2})`,
				'stroke-linecap': 'butt',
			},
		});
		circle.style.stroke = slice.color;
		offset += dashLen + gap;

		circle.addEventListener('mouseenter', () => {
			circle.setAttribute('stroke-width', String(strokeWidth + 6));
			centerValue.textContent = formatValue(slice.value);
			centerLabel.textContent = `${slice.label} · ${Math.round(pct * 100)}%`;
		});
		circle.addEventListener('mouseleave', () => {
			circle.setAttribute('stroke-width', String(strokeWidth));
			centerValue.textContent = formatValue(total);
			centerLabel.textContent = '';
		});
	}

	const legend = container.createDiv({ cls: 'dashboard-expense-donut-legend dashboard-expense-donut-legend--grid' });
	for (const slice of slices) {
		const pct = Math.round((slice.value / total) * 100);
		const item = legend.createDiv({ cls: 'dashboard-expense-donut-legend-item' });
		const dot = item.createDiv({ cls: 'dashboard-expense-donut-legend-dot' });
		dot.style.backgroundColor = slice.color;
		item.createDiv({ cls: 'dashboard-expense-donut-legend-name', text: slice.label });
		item.createDiv({ cls: 'dashboard-expense-donut-legend-pct', text: `${pct}%` });
		item.createDiv({ cls: 'dashboard-expense-donut-legend-amount', text: formatValue(slice.value) });
	}
}

// ===== Trend bars =====

export interface ExpenseBar {
	label: string;
	/** Primary series (expense in the combined view). */
	value: number;
	/** Optional secondary series drawn beside the primary (income). */
	secondary?: number;
	tooltip: string;
}

/** Hand-rolled SVG bar chart (viewBox 520x130, width 100%): single or paired
 *  bars per slot with native <title> tooltips and thinned x ticks. Mirrors the
 *  pomodoro trend chart geometry. */
export function renderExpenseTrend(
	container: HTMLElement,
	bars: ExpenseBar[],
	primaryColor: string,
	secondaryColor: string,
	emptyText: string,
): void {
	container.empty();
	const hasSecondary = bars.some(b => b.secondary !== undefined && b.secondary > 0);
	const hasAny = bars.some(b => b.value > 0 || (b.secondary ?? 0) > 0);
	if (bars.length === 0 || !hasAny) {
		container.createDiv({ cls: 'dashboard-expense-donut-empty', text: emptyText });
		return;
	}

	const width = 520;
	const height = 130;
	const maxVal = Math.max(...bars.map(b => Math.max(b.value, b.secondary ?? 0)), 1);
	const step = width / bars.length;
	const pairW = hasSecondary ? Math.max(2, Math.min(14, step * 0.32)) : Math.max(2, Math.min(18, step * 0.6));

	const svg = container.createSvg('svg', {
		cls: 'dashboard-expense-trend-svg',
		attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) },
	});
	const tip = createChartTip(container);
	const attachTip = (rect: SVGElement): void => {
		rect.addEventListener('mouseenter', () => tip.show(rect, rect.dataset.tip ?? ''));
		rect.addEventListener('mouseleave', () => tip.hide());
	};

	bars.forEach((b, i) => {
		const slotX = i * step;
		if (hasSecondary) {
			// Paired bars: expense left, income right.
			const h1 = Math.round((b.value / maxVal) * (height - 10));
			const rect1 = svg.createSvg('rect', {
				// Single-token cls only — createSvg feeds it to classList.add on
				// some Obsidian builds and a space throws (see habit heatmap).
				cls: 'dashboard-expense-trend-bar',
				attr: { x: slotX + (step - pairW * 2 - 2) / 2, y: height - h1, width: pairW, height: Math.max(b.value > 0 ? 2 : 0, h1), rx: 2 },
			});
			rect1.style.fill = primaryColor;
			rect1.dataset.tip = b.tooltip;
			attachTip(rect1);

			const v2 = b.secondary ?? 0;
			const h2 = Math.round((v2 / maxVal) * (height - 10));
			const rect2 = svg.createSvg('rect', {
				cls: 'dashboard-expense-trend-bar',
				attr: { x: slotX + (step - pairW * 2 - 2) / 2 + pairW + 2, y: height - h2, width: pairW, height: Math.max(v2 > 0 ? 2 : 0, h2), rx: 2 },
			});
			rect2.style.fill = secondaryColor;
			rect2.dataset.tip = b.tooltip;
			attachTip(rect2);
		} else {
			const h = Math.round((b.value / maxVal) * (height - 10));
			const barW = pairW;
			const rect = svg.createSvg('rect', {
				cls: 'dashboard-expense-trend-bar',
				attr: { x: slotX + (step - barW) / 2, y: height - h, width: barW, height: Math.max(b.value > 0 ? 2 : 0, h), rx: 2 },
			});
			rect.style.fill = primaryColor;
			rect.dataset.tip = b.tooltip;
			attachTip(rect);
		}

		if (bars.length <= 14 || i % Math.ceil(bars.length / 12) === 0) {
			const txt = svg.createSvg('text', {
				attr: { x: slotX + step / 2, y: height + 12, 'text-anchor': 'middle' },
				cls: 'dashboard-expense-trend-tick',
			});
			txt.textContent = b.label;
		}
	});
}

// ===== Ranking (horizontal bars) =====

export interface ExpenseRankRow {
	key: string;
	label: string;
	value: number;
}

/** Category ranking with colored horizontal bars, mirrors the pomodoro
 *  activity ranking layout (head row + proportional bar, min 3% width). */
export function renderExpenseRanking(
	container: HTMLElement,
	rows: ExpenseRankRow[],
	colorOf: (key: string) => string,
	formatValue: (n: number) => string,
	emptyText: string,
): void {
	container.empty();
	if (rows.length === 0) {
		container.createDiv({ cls: 'dashboard-expense-donut-empty', text: emptyText });
		return;
	}
	const maxVal = rows[0]?.value ?? 1;

	for (const row of rows) {
		const item = container.createDiv({ cls: 'dashboard-expense-rank-row' });
		const head = item.createDiv({ cls: 'dashboard-expense-rank-head' });
		const dot = head.createDiv({ cls: 'dashboard-expense-donut-legend-dot' });
		dot.style.backgroundColor = colorOf(row.key);
		head.createDiv({ cls: 'dashboard-expense-rank-name', text: row.label });
		head.createDiv({ cls: 'dashboard-expense-rank-amount', text: formatValue(row.value) });
		const barWrap = item.createDiv({ cls: 'dashboard-expense-rank-bar-wrap' });
		barWrap.createDiv({
			cls: 'dashboard-expense-rank-bar',
		}).style.width = `${Math.max(3, Math.round((row.value / maxVal) * 100))}%`;
		(barWrap.firstElementChild as HTMLElement).style.backgroundColor = colorOf(row.key);
	}
}

// ===== Comparison line chart (expense vs income) =====

/** Two overlaid polylines over the same slots as the trend chart, with a
 *  hover guide line + value tooltip per slot. Slots come from the same
 *  ExpenseBar data the trend chart consumes (value = expense, secondary =
 *  income). */
export function renderExpenseLines(
	container: HTMLElement,
	bars: ExpenseBar[],
	primaryColor: string,
	secondaryColor: string,
	primaryLabel: string,
	secondaryLabel: string,
	emptyText: string,
): void {
	container.empty();
	const hasAny = bars.some(b => b.value > 0 || (b.secondary ?? 0) > 0);
	if (bars.length === 0 || !hasAny) {
		container.createDiv({ cls: 'dashboard-expense-donut-empty', text: emptyText });
		return;
	}

	// Legend row (dot + label per series).
	const legend = container.createDiv({ cls: 'dashboard-expense-lines-legend' });
	for (const [color, label] of [[primaryColor, primaryLabel], [secondaryColor, secondaryLabel]] as const) {
		const item = legend.createDiv({ cls: 'dashboard-expense-donut-legend-item dashboard-expense-lines-legend-item' });
		const dot = item.createDiv({ cls: 'dashboard-expense-donut-legend-dot' });
		dot.style.backgroundColor = color;
		item.createDiv({ cls: 'dashboard-expense-lines-legend-name', text: label });
	}

	const width = 520;
	const height = 120;
	const maxVal = Math.max(...bars.map(b => Math.max(b.value, b.secondary ?? 0)), 1);
	const step = width / bars.length;
	const yOf = (v: number): number => height - Math.round((v / maxVal) * (height - 10));

	const svg = container.createSvg('svg', {
		cls: 'dashboard-expense-lines-svg',
		attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) },
	});

	// Baseline at y=0 grounds the two series.
	svg.createSvg('line', {
		cls: 'dashboard-expense-lines-baseline',
		attr: { x1: 0, y1: height, x2: width, y2: height },
	});

	// Series polylines + small dots on every point.
	for (const [series, color] of [
		[bars.map(b => b.value), primaryColor],
		[bars.map(b => b.secondary ?? 0), secondaryColor],
	] as const) {
		const points = series.map((v, i) => `${i * step + step / 2},${yOf(v)}`).join(' ');
		const line = svg.createSvg('polyline', {
			cls: 'dashboard-expense-lines-line',
			attr: { points },
		});
		line.style.stroke = color;
		series.forEach((v, i) => {
			const dot = svg.createSvg('circle', {
				cls: 'dashboard-expense-lines-dot',
				attr: { cx: i * step + step / 2, cy: yOf(v), r: 2 },
			});
			dot.style.fill = color;
		});
	}

	// Hover guide line, moved to the hovered slot.
	const guide = svg.createSvg('line', {
		cls: 'dashboard-expense-lines-guide',
		attr: { x1: 0, y1: 0, x2: 0, y2: height },
	});
	const tip = createChartTip(container);

	bars.forEach((b, i) => {
		const cx = i * step + step / 2;
		const slot = svg.createSvg('rect', {
			cls: 'dashboard-expense-lines-slot',
			attr: { x: i * step, y: 0, width: step, height },
		});
		slot.addEventListener('mouseenter', () => {
			guide.setAttribute('x1', String(cx));
			guide.setAttribute('x2', String(cx));
			guide.addClass('dashboard-expense-lines-guide--visible');
			tip.show(slot, b.tooltip);
		});
		slot.addEventListener('mouseleave', () => {
			guide.removeClass('dashboard-expense-lines-guide--visible');
			tip.hide();
		});

		if (bars.length <= 14 || i % Math.ceil(bars.length / 12) === 0) {
			const txt = svg.createSvg('text', {
				attr: { x: cx, y: height + 12, 'text-anchor': 'middle' },
				cls: 'dashboard-expense-trend-tick',
			});
			txt.textContent = b.label;
		}
	});
}
