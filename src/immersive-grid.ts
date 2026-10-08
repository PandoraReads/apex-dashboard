/**
 * Immersive-layout free-grid primitives.
 *
 * The immersive layout mixes widget cards and section cards in ONE free
 * grid (`.dashboard-kanban` under `[data-layout="immersive"]`, 12 columns).
 * Arrangement state is a plain ordered list of `ImmersiveItem` tiles
 * (`widget:<key>` / `section:<name>`, column span + row span) persisted in
 * the workspace file's frontmatter; grid coordinates are ALWAYS derived by
 * the packer and never stored, so a column-count change or an orphan sweep
 * can never leave stale coordinates behind.
 *
 * Packing is skyline bottom-left: tiles are placed in list order, each at
 * the lowest landing row over any feasible x position (ties: leftmost x).
 * The result is vertically compact with no floating tiles and stable under
 * reordering — "drag to reorder" is a pure array splice, and repacking after
 * a resize only shifts later tiles.
 *
 * All functions are pure and free of Obsidian imports (jiti-testable
 * standalone), mirroring widget-span.ts / column-pairs.ts.
 */

import type { DashboardLayoutMode, ImmersiveItem, WidgetHeightRatio } from './types';
import type { StackedRatios } from './widget-span';

export type { ImmersiveItem } from './types';

/** Grid columns of the immersive board. Also the max column span. */
export const IMM_COLS = 12;

/* Height model: tiles are CONTENT-FIT ("贴合") — the renderer measures each
 * tile's natural height and places it on a fine 10px row grid (row-gap 0; the
 * visual vertical gap is the tile's own bottom margin). A tile's stored `h`
 * is therefore a MAXIMUM (the cap beyond which the tile scrolls inside),
 * not a fixed size. */
/** Fine row pitch in px (one grid-auto-rows track). */
export const IMM_ROW_UNIT = 10;
/** Visual vertical gap between tiles (tile margin-bottom; inside the span). */
export const IMM_TILE_GAP = 10;
/** Fewest rows a tile may occupy. */
export const IMM_MIN_ROWS = 3;
/** Max row cap (240 rows = 2400px — guards hand-edited frontmatter). */
export const IMM_MAX_H = 240;

/** Fallback span when a tile's stored span is missing/garbage. */
const FALLBACK_W = 3;
const FALLBACK_H = 40;

/** Content px → row tracks (the tile's bottom gap rides inside the span). */
export function pxToRows(px: number): number {
	if (!Number.isFinite(px) || px <= 0) return IMM_MIN_ROWS;
	return Math.max(IMM_MIN_ROWS, Math.ceil((px + IMM_TILE_GAP) / IMM_ROW_UNIT));
}

/** Row tracks → the px height a tile may grow to (margin excluded). */
export function rowsToPx(rows: number): number {
	return Math.max(0, rows) * IMM_ROW_UNIT - IMM_TILE_GAP;
}

/** Default tile size for section cards (half the board; height CAP generous —
 *  content-fit shrinks below it, only very long sections hit the cap). */
export const DEFAULT_SECTION_SPAN: { w: number; h: number } = { w: 6, h: 80 };

/** Stacked tier → immersive FIXED height (fine rows). The stacked strip's
 *  unit is 45px per row (6 rows of (300-30)/6); widget tiles reuse those
 *  canonical sizes so both layouts read the same card proportions. */
const TIER_H: Record<WidgetHeightRatio, number> = { full: 28, twoThirds: 19, half: 15, third: 10 };

/** Fixed sizes (width span + height in fine rows) for FIXED widget keys —
 *  the stacked spans (45px/row) mapped onto the 10px grid: quickActions/
 *  calendar 6 rows = 280px, weather 4 = 190px, pomodoro/expense/music 3 =
 *  145px, lunar/yearProgress 2 = 100px. countdown-* / anniversary-* are
 *  prefix-matched. Unknown keys fall back to the small card. */
const WIDGET_DEFAULTS: Record<string, { w: number; h: number }> = {
	quickActions: { w: 4, h: 28 },
	quickCapture: { w: 2, h: 6 },
	fileSearch: { w: 2, h: 8 },
	calendar: { w: 4, h: 28 },
	weather: { w: 3, h: 19 },
	pomodoro: { w: 3, h: 15 },
	reading: { w: 3, h: 15 },
	habit: { w: 3, h: 19 },
	expense: { w: 3, h: 15 },
	music: { w: 3, h: 15 },
	lunar: { w: 3, h: 10 },
	yearProgress: { w: 3, h: 10 },
	skills: { w: 2, h: 6 },
};

/** Saved h values from the pre-content-fit build were coarse 92px rows
 *  (2..12). Rescale them onto the fine grid so an early adopter's caps keep
 *  their intended pixel height. Values above the legacy ceiling are already
 *  fine rows. */
export function migrateLegacyHeight(h: number): number {
	return h <= 12 ? pxToRows(h * 92) : h;
}

export function widgetItemId(key: string): string {
	return `widget:${key}`;
}

export function sectionItemId(name: string): string {
	return `section:${name}`;
}

/** Pure phone-fallback of the layout gate (renderer.resolveEffectiveLayout
 *  delegates here; tests drive it without Platform). */
export function effectiveLayout(layoutMode: DashboardLayoutMode, isPhone: boolean): 'side' | 'stacked' | 'immersive' {
	return isPhone ? 'side' : layoutMode;
}

/** Column span 1..IMM_COLS; dirty/missing values fall back to the small-card
 *  width — same defence posture as clampSidebarWidth. */
export function clampSpanW(w: unknown): number {
	const n = typeof w === 'number' && Number.isFinite(w) ? w : FALLBACK_W;
	return Math.min(IMM_COLS, Math.max(1, Math.round(n)));
}

/** Row cap clamp (pure 1..IMM_MAX_H — NO legacy migration here: the packer
 *  also clamps runtime-measured fine-row values, and re-migrating those
 *  would inflate small measurements. Migration happens once, at the
 *  normalize boundary below). */
export function clampSpanH(h: unknown): number {
	const n = typeof h === 'number' && Number.isFinite(h) ? h : FALLBACK_H;
	return Math.min(IMM_MAX_H, Math.max(1, Math.round(n)));
}

/** A tile with its resolved grid position (0-based col/row). */
export interface PackedItem extends ImmersiveItem {
	col: number;
	row: number;
}

/** Skyline bottom-left packing over `cols` columns, in list order: each tile
 *  lands at the lowest feasible row (leftmost x on ties). A tile wider than
 *  the board is clamped to the full width. Pure and deterministic — same
 *  input, same output; moving one tile only affects the tiles after it. */
export function packImmersive(items: readonly ImmersiveItem[], cols = IMM_COLS): PackedItem[] {
	const width = Math.max(1, Math.min(IMM_COLS, Math.round(cols)));
	const heights = new Array<number>(width).fill(0);
	const packed: PackedItem[] = [];
	for (const item of items) {
		const w = Math.min(width, clampSpanW(item.w));
		const h = clampSpanH(item.h);
		let bestX = 0;
		let bestRow = Infinity;
		for (let x = 0; x + w <= width; x++) {
			let landing = 0;
			for (let i = x; i < x + w; i++) {
				if (heights[i]! > landing) landing = heights[i]!;
			}
			if (landing < bestRow) {
				bestRow = landing;
				bestX = x;
			}
		}
		for (let i = bestX; i < bestX + w; i++) {
			heights[i] = bestRow + h;
		}
		packed.push({ ...item, w, h, col: bestX, row: bestRow });
	}
	return packed;
}

/** Reconcile the saved arrangement with the tiles that actually exist now.
 *  ① drops orphans (deleted sections / unmounted widgets);
 *  ② dedupes repeated ids (hand-edited file), keeping the first;
 *  ③ appends new ids in `presentIds` order with their default size;
 *  ④ clamps every span.
 *  `changed` tells whether the result differs from `saved` (callers persist
 *  the cleaned list lazily, only on the next user mutation). */
export function normalizeImmersive(
	saved: ImmersiveItem[] | undefined,
	presentIds: readonly string[],
	defaultSizeOf: (id: string) => { w: number; h: number },
): { items: ImmersiveItem[]; changed: boolean } {
	const present = new Set(presentIds);
	const items: ImmersiveItem[] = [];
	const seen = new Set<string>();
	if (saved) {
		for (const raw of saved) {
			if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
			if (!present.has(raw.id) || seen.has(raw.id)) continue;
			seen.add(raw.id);
			// Pure clamp — legacy-scale migration already happened at the
			// parser boundary (the `cap` field rename); re-migrating here
			// would inflate small fine-row caps on every second load.
			const coords = (typeof raw.x === 'number' && typeof raw.y === 'number')
				? { x: Math.max(0, Math.min(IMM_COLS - 1, Math.round(raw.x))), y: Math.max(0, Math.round(raw.y)) }
				: {};
			items.push({ id: raw.id, w: clampSpanW(raw.w), h: Math.max(IMM_MIN_ROWS, clampSpanH(raw.h)), ...(raw.fixed === true ? { fixed: true } : {}), ...coords });
		}
	}
	for (const id of presentIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const def = defaultSizeOf(id);
		items.push({ id, w: clampSpanW(def.w), h: Math.max(IMM_MIN_ROWS, clampSpanH(def.h)) });
	}
	const changed = !saved || saved.length !== items.length
		|| items.some((item, i) => {
			const prev = saved[i]!;
			return prev.id !== item.id || clampSpanW(prev.w) !== item.w || clampSpanH(prev.h) !== item.h;
		});
	return { items, changed };
}

/** Default tile size for one widget key (the multi-instance prefixes and the
 *  tiered keys resolve through their settings, mirroring buildStackedSpanSpecs
 *  in widget-span.ts). */
export function defaultWidgetSize(key: string, ratios: StackedRatios): { w: number; h: number } {
	if (key === 'habit') {
		return { w: 3, h: TIER_H[ratios.habit ?? 'twoThirds'] ?? 19 };
	}
	if (key === 'reading') {
		return { w: 3, h: TIER_H[ratios.reading ?? 'half'] ?? 15 };
	}
	if (key.startsWith('album-')) {
		const cfg = (ratios.albums ?? []).find(a => String(a.id) === key.slice('album-'.length));
		return { w: 4, h: TIER_H[cfg?.heightRatio ?? 'full'] ?? 28 };
	}
	if (key.startsWith('countdown-') || key.startsWith('anniversary-')) {
		return { w: 3, h: 10 };
	}
	return WIDGET_DEFAULTS[key] ?? { w: FALLBACK_W, h: FALLBACK_H };
}

/** Full-board placement: tiles carrying explicit x/y are placed there (and
 *  become obstacles); the rest sky-pack around the obstacles in list order.
 *  This is the single placement authority for layout, previews and drops. */
export function planImmersive(items: readonly ImmersiveItem[], cols = IMM_COLS): PackedItem[] {
	const width = Math.max(1, Math.min(IMM_COLS, Math.round(cols)));
	const heights = new Array<number>(width).fill(0);
	const packed: PackedItem[] = [];
	const flow: { item: ImmersiveItem; index: number }[] = [];
	items.forEach((item, index) => {
		if (typeof item.x === 'number' && typeof item.y === 'number') {
			const w = Math.min(width, clampSpanW(item.w));
			const x = Math.max(0, Math.min(width - w, Math.round(item.x)));
			const y = Math.max(0, Math.round(item.y));
			const h = clampSpanH(item.h);
			for (let i = x; i < x + w; i++) {
				const top = y + h;
				if (heights[i]! < top) heights[i]! = top;
			}
			packed[index] = { ...item, w, h, col: x, row: y };
		} else {
			flow.push({ item, index });
		}
	});
	for (const { item, index } of flow) {
		const w = Math.min(width, clampSpanW(item.w));
		const h = clampSpanH(item.h);
		let bestX = 0;
		let bestRow = Infinity;
		for (let x = 0; x + w <= width; x++) {
			let landing = 0;
			for (let i = x; i < x + w; i++) {
				if (heights[i]! > landing) landing = heights[i]!;
			}
			if (landing < bestRow) {
				bestRow = landing;
				bestX = x;
			}
		}
		for (let i = bestX; i < bestX + w; i++) heights[i]! = bestRow + h;
		packed[index] = { ...item, w, h, col: bestX, row: bestRow };
	}
	return packed;
}

/** True when self's rect overlaps any other tile's. */
export function overlapsAny(self: { x: number; y: number; w: number; h: number }, others: readonly { x: number; y: number; w: number; h: number }[]): boolean {
	return others.some(o => self.x < o.x + o.w && o.x < self.x + self.w
		&& self.y < o.y + o.h && o.y < self.y + self.h);
}

/** Resolve a free placement for an intended drop: if the exact spot is
 *  free, keep it; otherwise find the NEAREST free cell (by Manhattan
 *  distance from the intent) — beside, above or below obstacles alike.
 *  The old gravity-only rule pushed overlaps straight DOWN, so a card
 *  dropped "back at the top" over a full-width section kept falling below
 *  it and could never return (the trapped-at-the-bottom bug). */
export function resolvePlacement(
	self: { x: number; y: number; w: number; h: number },
	others: readonly { x: number; y: number; w: number; h: number }[],
): { x: number; y: number } {
	if (!overlapsAny(self, others)) return { x: self.x, y: self.y };
	const spanY = Math.max(self.y + self.h, ...others.map(o => o.y + o.h)) + 24;
	let best: { x: number; y: number; d: number } | null = null;
	for (let y = 0; y <= spanY; y++) {
		for (let x = 0; x + self.w <= IMM_COLS; x++) {
			if (overlapsAny({ x, y, w: self.w, h: self.h }, others)) continue;
			// Distance from the INTENT, not from origin — the spot nearest
			// where the user pointed wins (scan order breaks ties: topmost,
			// then leftmost).
			const d = Math.abs(x - self.x) + Math.abs(y - self.y);
			if (best === null || d < best.d) best = { x, y, d };
		}
	}
	return best ? { x: best.x, y: best.y } : { x: self.x, y: spanY };
}
