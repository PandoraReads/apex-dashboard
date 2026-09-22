/**
 * Stacked-layout widget span primitives.
 *
 * The stacked widget strip is a 6-row column-major CSS grid
 * (`.dashboard-sidebar-widgets-row`): each card occupies N of the 6 rows, so
 * the four `WidgetHeightRatio` tiers are exact fractions — full 6, two-thirds
 * 4, half 3, third 2 (4+2, 3+3 and 2+2+2 all tile one column).
 *
 * Cards come in two flavours:
 * - FIXED: the span is pinned by the per-type CSS rules in styles.css
 *   (`[data-widget-key=...]`, ~2874-2925). `STACKED_FIXED_SPANS` below is the
 *   source of truth for the packing simulation and MUST be kept in sync with
 *   those rules.
 * - TIERED: habit / reading / album-<id> carry a user-picked preferred tier.
 *   The renderer writes the resolved span as an inline `--db-widget-span`
 *   custom property; the CSS rules consume `var(--db-widget-span, <default>)`
 *   so a missing variable falls back to the historical span.
 *
 * Adaptive packing ("首选档 + 放不下自动换挡"): cards are placed in DOM order,
 * filling columns top-down. A tiered card whose preferred span does not fit
 * the rows left in the current column DOWNSHIFTS to the column remainder when
 * that remainder is exactly one of its allowed tiers — the column then tiles
 * perfectly. Otherwise it starts a fresh column. Spans never grow, and
 * leftover rows no allowed tier can fill stay empty (the sparse
 * `grid-auto-flow: column` placement leaves the same gap).
 *
 * All functions are pure and free of Obsidian imports (jiti-testable
 * standalone), mirroring column-pairs.ts.
 */

import type { WidgetHeightRatio } from './types';

/** Rows of the 6-row widget grid per height ratio. */
export const RATIO_SPAN: Record<WidgetHeightRatio, number> = { full: 6, twoThirds: 4, half: 3, third: 2 };

/** Every tier a TIERED card may adapt to (all four fractions). */
export const ALL_TIERS: number[] = [6, 4, 3, 2];

/** Fixed stacked spans for non-tiered widget keys. MUST mirror the per-type
 *  `grid-row: span N` rules in styles.css (~2874-2925) — update both sides
 *  together. countdown-* / anniversary-* are prefix-matched in the CSS but
 *  fixed (span 2); the packer handles those prefixes explicitly. */
export const STACKED_FIXED_SPANS: Record<string, number> = {
	quickActions: 6,
	calendar: 6,
	weather: 4,
	pomodoro: 3,
	expense: 3,
	music: 3,
	lunar: 2,
	yearProgress: 2,
};

/** One card's packing spec, in DOM order. */
export interface StackedSpanSpec {
	key: string;
	/** Span the user picked (tiered) or the fixed CSS span. */
	preferred: number;
	/** Tiers the card may downshift to when its preferred does not fit;
	 *  omitted (or empty) = fixed card, never adapts. */
	allowed?: number[];
}

/** Inputs of the tier settings the packer needs, decoupled from the full
 *  DashboardSettings shape so this module stays standalone. */
export interface StackedRatios {
	habit?: WidgetHeightRatio;
	reading?: WidgetHeightRatio;
	albums?: { id: number | string; heightRatio?: WidgetHeightRatio }[];
}

/** True when a widget key carries a user-pickable height tier. */
export function isTieredWidgetKey(key: string): boolean {
	return key === 'habit' || key === 'reading' || key.startsWith('album-');
}

/** Build one spec per key (DOM order). `keys` comes from the renderer's
 *  `buildOrder`, NOT the saved widgetOrder: in stacked mode quickActions is
 *  promoted to the front, and the packing must simulate what the grid sees. */
export function buildStackedSpanSpecs(keys: readonly string[], ratios: StackedRatios): StackedSpanSpec[] {
	const albumById = new Map((ratios.albums ?? []).map(a => [String(a.id), a]));
	return keys.map(key => {
		if (key === 'habit') {
			return { key, preferred: RATIO_SPAN[ratios.habit ?? 'twoThirds'] ?? 4, allowed: ALL_TIERS };
		}
		if (key === 'reading') {
			return { key, preferred: RATIO_SPAN[ratios.reading ?? 'half'] ?? 3, allowed: ALL_TIERS };
		}
		if (key.startsWith('album-')) {
			// Missing/legacy heightRatio falls back to full, matching the
			// renderer's historical `RATIO_SPAN[cfg.heightRatio] ?? 6`.
			const cfg = albumById.get(key.slice('album-'.length));
			return { key, preferred: RATIO_SPAN[cfg?.heightRatio ?? 'full'] ?? 6, allowed: ALL_TIERS };
		}
		if (key.startsWith('countdown-') || key.startsWith('anniversary-')) {
			return { key, preferred: 2 };
		}
		// Closed set of enabled keys; 6 is pure defence for an unknown one.
		return { key, preferred: STACKED_FIXED_SPANS[key] ?? 6 };
	});
}

/** Resolve the effective grid spans for a stacked strip.
 *
 * Sparse column-first simulation of `grid-auto-flow: column` (no `dense`):
 * each card keeps its preferred span while the current column has room; a
 * misfit tiered card downshifts to the column remainder when that remainder
 * is one of its allowed tiers, otherwise it starts a fresh column. Returns
 * one span per spec, in input order — the renderer writes these straight to
 * the cards, so the grid's own placement reproduces the simulation exactly. */
export function resolveStackedSpans(specs: readonly StackedSpanSpec[]): number[] {
	const ROWS = 6;
	const spans: number[] = [];
	let remaining = ROWS;
	for (const spec of specs) {
		let span = spec.preferred;
		if (span > remaining) {
			if (spec.allowed?.includes(remaining)) {
				// Exact-fit downshift: the remainder is one of this card's
				// tiers, so the column tiles perfectly with no leftover rows.
				span = remaining;
			} else {
				remaining = ROWS; // fresh column; span keeps the preferred value
			}
		}
		remaining -= span;
		spans.push(span);
	}
	return spans;
}

/** Side-layout sidebar width (px). Dirty/missing values resolve to the
 *  historical default — same defence as clampPairWidth. */
export function clampSidebarWidth(v: unknown): number {
	const n = typeof v === 'number' && Number.isFinite(v) ? v : 220;
	return Math.min(420, Math.max(180, n));
}

/** Stacked-layout widget strip unit height (px). Below ~300 the calendar card
 *  grows an internal scrollbar (accepted); the floor keeps cards legible. */
export function clampWidgetUnitHeight(v: unknown): number {
	const n = typeof v === 'number' && Number.isFinite(v) ? v : 300;
	return Math.min(560, Math.max(240, n));
}
