import { t } from './i18n';
import type { PomodoroService } from './pomodoro-service';

/**
 * Focus garden: a pseudo-3D, top-down plot of land for the pomodoro stats
 * mid column.
 *
 * Mechanics — every completed pomodoro is BOTH one seed AND one nutrient:
 *   - Seeds plant back-to-front across a 6x3 grid, so the oldest growth
 *     looms at the back and fresh sprouts sit near the viewer.
 *   - Nutrients feed the oldest tree first through growth stages
 *     (cumulative 1/3/6/10/15 nutrients = sprout/sapling/young/mature/grand);
 *     the front rows therefore read as the garden's recent history.
 *
 * The pseudo-3D comes from layering, not perspective math: a grass slab with
 * a dirt front face, rows shrinking and rising toward the back, a brick
 * offset per row, and a fixed bottom-right shadow on every plant.
 *
 * All art is hand-rolled SVG in a 320x180 viewBox that scales with the card.
 * cls values are single tokens (createSvg feeds them to classList on some
 * Obsidian builds; multi-token strings throw).
 */

/** Cumulative nutrients to reach stage 1..5 (stage 0 = bare seed). */
const STAGE_COSTS = [1, 3, 6, 10, 15];
/** Field grid. */
const COLS = 6;
const ROWS = 3;
const SPOTS = COLS * ROWS;

/** Crown radius (viewBox units) by stage, pre-scale. */
const CROWN_R = [0, 0, 5, 7.5, 10, 13];

interface SpotLayout {
	stage: number;
	x: number;
	y: number;
	scale: number;
}

interface GardenModel {
	spots: SpotLayout[];
	/** All-time seeds (may exceed the field; the field just runs full). */
	seeds: number;
	/** Trees at mature or grand stage. */
	trees: number;
}

function buildModel(total: number): GardenModel {
	const planted = Math.min(total, SPOTS);
	let nutrients = total;
	const spots: SpotLayout[] = [];
	let trees = 0;
	for (let i = 0; i < SPOTS; i++) {
		const row = Math.floor(i / COLS);
		const col = i % COLS;
		let stage = -1;
		if (i < planted) {
			stage = 0;
			const alloc = Math.min(STAGE_COSTS[STAGE_COSTS.length - 1]!, nutrients);
			nutrients -= alloc;
			for (const th of STAGE_COSTS) {
				if (alloc >= th) stage++;
			}
			if (stage >= 4) trees++;
		}
		spots.push({
			stage,
			x: 40 + col * 48 + (row % 2) * 14,
			y: 84 + row * 24,
			scale: 0.72 + row * 0.14,
		});
	}
	return { spots, seeds: total, trees };
}

/** Mount the garden into `container` (emptied first). */
export function renderPomodoroGarden(container: HTMLElement, service: PomodoroService): void {
	container.empty();
	const model = buildModel(service.getTotalCount());

	const svg = container.createSvg('svg', {
		cls: 'dashboard-pomodoro-garden-svg',
		attr: { viewBox: '0 0 320 180' },
	});

	// Land: dirt front face below, grass slab on top — reads as a thick plot.
	svg.createSvg('rect', {
		attr: { x: 16, y: 112, width: 288, height: 34, rx: 10, fill: '#6b4a33' },
	});
	svg.createSvg('rect', {
		attr: { x: 16, y: 116, width: 288, height: 10, fill: '#5a3d2a', opacity: 0.5 },
	});
	svg.createSvg('rect', {
		attr: { x: 16, y: 62, width: 288, height: 58, rx: 16, fill: '#7fae62' },
	});
	svg.createSvg('rect', {
		attr: { x: 24, y: 68, width: 272, height: 24, rx: 12, fill: '#8bbc6e', opacity: 0.55 },
	});

	// Furrow strips per row (subtle planting beds, back rows compressed).
	for (let row = 0; row < ROWS; row++) {
		const y = 84 + row * 24;
		const inset = 6 + row * 6;
		svg.createSvg('rect', {
			attr: { x: 28 + inset, y: y - 8, width: 264 - inset * 2, height: 16, rx: 8, fill: '#6f9e54', opacity: 0.6 },
		});
	}

	for (const spot of model.spots) {
		drawSpot(svg, spot);
	}

	const stats = container.createDiv({ cls: 'dashboard-pomodoro-garden-stats' });
	stats.createSpan({ text: t('pomodoro.gardenSeeds', { count: String(model.seeds) }) });
	stats.createSpan({ text: t('pomodoro.gardenTrees', { count: String(model.trees) }) });
}

function drawSpot(svg: SVGSVGElement, spot: SpotLayout): void {
	const { x, y, scale: s, stage } = spot;

	if (stage < 0) {
		// Empty soil patch — room for the next seed.
		svg.createSvg('ellipse', { attr: { cx: x, cy: y, rx: 9 * s, ry: 3.6 * s, fill: 'rgba(0,0,0,0.14)' } });
		return;
	}

	// Fixed bottom-right shadow sells the top-left sun.
	svg.createSvg('ellipse', {
		attr: { cx: x + 2, cy: y + 2, rx: Math.max(6, CROWN_R[stage]! * s * 0.95), ry: Math.max(2.4, CROWN_R[stage]! * s * 0.38), fill: 'rgba(0,0,0,0.16)' },
	});

	if (stage === 0) {
		// Seed: a small mound with the seed showing.
		svg.createSvg('ellipse', { attr: { cx: x, cy: y, rx: 5.5 * s, ry: 2.4 * s, fill: '#8a5a3b' } });
		svg.createSvg('ellipse', { attr: { cx: x, cy: y - 1, rx: 1.6 * s, ry: 1.1 * s, fill: '#d9b382' } });
		return;
	}

	if (stage === 1) {
		// Sprout: stem plus two leaves.
		svg.createSvg('path', {
			attr: { d: `M ${x} ${y} L ${x} ${y - 5 * s}`, stroke: '#3f8f4f', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none' },
		});
		for (const side of [-1, 1] as const) {
			svg.createSvg('ellipse', {
				attr: {
					cx: x + side * 3.4 * s, cy: y - 5.5 * s, rx: 3.4 * s, ry: 1.8 * s,
					fill: '#58b368', transform: `rotate(${side * 32} ${x + side * 3.4 * s} ${y - 5.5 * s})`,
				},
			});
		}
		return;
	}

	// Sapling → grand: concentric top-down crowns (dark rim, body, highlight).
	const r = CROWN_R[stage]! * s;
	svg.createSvg('circle', { attr: { cx: x, cy: y, r, fill: '#37a24d' } });
	svg.createSvg('circle', { attr: { cx: x - r * 0.16, cy: y - r * 0.16, r: r * 0.74, fill: '#51cf66' } });
	svg.createSvg('circle', { attr: { cx: x - r * 0.3, cy: y - r * 0.3, r: r * 0.32, fill: '#7fd98a', opacity: 0.85 } });
	if (stage >= 5) {
		// Grand trees bear fruit in the theme accent.
		for (const [fx, fy] of [[-0.32, 0.18], [0.28, -0.18], [0.05, 0.42]] as const) {
			svg.createSvg('circle', { attr: { cx: x + r * fx, cy: y + r * fy, r: 1.7, fill: 'var(--db-accent)' } });
		}
	}
}
