/**
 * Verifies the immersive free-grid engine (src/immersive-grid.ts) plus its
 * parser round-trip and the layout gate:
 *
 * 1. packImmersive: skyline bottom-left placement — no overlap (occupancy
 *    matrix), vertical compactness (no floating tiles), leftmost tie-break,
 *    wide tiles bridge earlier columns, over-wide tiles clamp to the board,
 *    deterministic output, order stability (moving one tile only affects
 *    later ones).
 * 2. normalizeImmersive: orphan removal, id dedupe (first wins), new ids
 *    appended in present order with default sizes, span clamping, changed
 *    flag (equal list => unchanged).
 * 3. defaultWidgetSize: tier caps, album per-instance ratio, prefix keys,
 *    fixed table, unknown fallback.
 * 4. Parser round-trip: serialize -> parse returns the same list (ids with
 *    ':' and Chinese names), garbage entries dropped, empty/absent list ->
 *    undefined, serialize omits the block when empty.
 * 5. effectiveLayout: phones always 'side'; desktop passes the mode through.
 * 6. Height model: pxToRows/rowsToPx, legacy 92px-scale h migration, clamp
 *    bounds (fine rows, IMM_MIN_ROWS floor, IMM_MAX_H ceiling).
 *
 * Run: `npm run test:immersive-grid`
 */
import { strict as assert } from 'node:assert';
import { parse, serialize } from '../src/parser';
import {
	IMM_COLS,
	IMM_MAX_H,
	IMM_MIN_ROWS,
	DEFAULT_SECTION_SPAN,
	clampSpanW,
	clampSpanH,
	defaultWidgetSize,
	effectiveLayout,
	migrateLegacyHeight,
	normalizeImmersive,
	packImmersive,
	pxToRows,
	rowsToPx,
	sectionItemId,
	widgetItemId,
	type ImmersiveItem,
} from '../src/immersive-grid';

/** Build an occupancy matrix from packed output; asserts nothing itself. */
const occupancy = (packed: ReturnType<typeof packImmersive>, cols: number, rows: number): number[][] => {
	const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
	for (const tile of packed) {
		for (let r = tile.row; r < tile.row + tile.h; r++) {
			for (let c = tile.col; c < tile.col + tile.w; c++) {
				grid[r]![c]! += 1;
			}
		}
	}
	return grid;
};

const gridRows = (packed: ReturnType<typeof packImmersive>): number =>
	packed.reduce((max, t) => Math.max(max, t.row + t.h), 0);

const tile = (id: string, w: number, h: number): ImmersiveItem => ({ id, w, h });

const run = (): void => {
	// --- 1. packImmersive: skyline placement --------------------------------
	{
		// Two half-width tiles side by side on row 0; the next lands on the
		// SHORTER (right) side at its skyline row — lowest landing wins.
		const packed = packImmersive([tile('a', 6, 2), tile('b', 6, 1), tile('c', 6, 1)]);
		assert.deepEqual(packed.map(t => [t.col, t.row]), [[0, 0], [6, 0], [6, 1]],
			'equal-width halves sit side by side; next tile lands on the shorter side');
		// No overlap anywhere (a ragged bottom edge is fine — heights differ).
		const grid = occupancy(packed, IMM_COLS, gridRows(packed));
		assert.ok(grid.every(row => row.every(cell => cell <= 1)), 'no cell covered twice (no overlap)');
		// Vertical compactness: nothing hovers above an empty cell.
		for (let c = 0; c < IMM_COLS; c++) {
			let seen = false;
			for (let r: number = grid.length - 1; r >= 0; r--) {
				const cell = grid[r]![c]!;
				if (cell === 1) seen = true;
				else assert.equal(seen, false, `column ${c} has a floating tile (hole at row ${r})`);
			}
		}
	}
	{
		// Skyline bridging: the next wide tile lands at the LOWEST row it can
		// bridge across.
		const packed = packImmersive([tile('a', 6, 3), tile('b', 3, 1), tile('c', 6, 2)]);
		const a = packed[0]!, b = packed[1]!, c = packed[2]!;
		assert.deepEqual([a.col, a.row], [0, 0]);
		assert.deepEqual([b.col, b.row], [6, 0], 'narrow tile takes the right half');
		assert.deepEqual([c.col, c.row], [6, 1], 'wide tile bridges to the lower right side');
	}
	{
		// Leftmost tie-break: empty board, two w3 tiles -> both row 0, x 0 and 3.
		const packed = packImmersive([tile('a', 3, 1), tile('b', 3, 1)]);
		assert.deepEqual(packed.map(t => [t.col, t.row]), [[0, 0], [3, 0]], 'ties resolve leftmost');
	}
	{
		// Over-wide clamps to the full board width.
		const packed = packImmersive([tile('a', 99, 2)]);
		assert.equal(packed[0]!.w, IMM_COLS, 'over-wide tile clamps to the board');
		assert.equal(packed[0]!.col, 0);
		// Determinism + prefix stability: moving the LAST tile earlier only
		// changes positions of tiles after its new index.
		const list = [tile('a', 4, 2), tile('b', 4, 2), tile('c', 4, 2)];
		const p1 = packImmersive(list);
		const p2 = packImmersive(list);
		assert.deepEqual(p1, p2, 'same input packs identically');
		const moved = [list[0]!, list[2]!, list[1]!];
		const p3 = packImmersive(moved);
		assert.deepEqual(p3[0], p1[0], 'the untouched first tile keeps its position');
		assert.notDeepEqual(p3.slice(1), p1.slice(1), 'later tiles reflow after a reorder');
	}
	{
		// Full-width tile forces everything else below it.
		const packed = packImmersive([tile('full', 12, 2), tile('s', 3, 1)]);
		assert.deepEqual([packed[1]!.col, packed[1]!.row], [0, 2], 'full-width tile pushes the next below');
	}

	// --- 2. normalizeImmersive ----------------------------------------------
	{
		const def = (id: string): { w: number; h: number } =>
			id.startsWith('section:') ? DEFAULT_SECTION_SPAN : { w: 3, h: 40 };
		// Orphans dropped, new ids appended, dupes keep the first, clamp
		// applied. Pure clamp — NO migration here (the parser's `cap` field
		// rename owns that; re-migrating would inflate small caps).
		const saved: ImmersiveItem[] = [
			tile('widget:weather', 4, 29),
			tile('section:已删除', 6, 80),          // orphan
			tile('widget:pomodoro', 2, 20),
			tile('widget:pomodoro', 9, 90),         // duplicate id
			tile('widget:bad-span', 999, 0),        // clamped
		];
		const present = ['widget:weather', 'widget:pomodoro', 'section:待办', 'widget:bad-span'];
		const { items, changed } = normalizeImmersive(saved, present, def);
		assert.deepEqual(items, [
			{ id: 'widget:weather', w: 4, h: 29 },
			{ id: 'widget:pomodoro', w: 2, h: 20 },
			{ id: 'widget:bad-span', w: 12, h: IMM_MIN_ROWS },
			{ id: 'section:待办', w: 6, h: 80 },
		], 'orphans dropped, first dupe kept, new section appended last, spans clamped');
		assert.equal(changed, true, 'list differs from saved -> changed');
		// Idempotent second pass: unchanged (the old in-normalize migration
		// re-inflated small caps here — the regression this pins down).
		const again = normalizeImmersive(items, present, def);
		assert.deepEqual(again.items, items);
		assert.equal(again.changed, false, 'reconciled list re-normalizes unchanged');
		// No saved list at all -> all defaults, changed.
		const fresh = normalizeImmersive(undefined, ['widget:lunar'], def);
		assert.deepEqual(fresh.items, [{ id: 'widget:lunar', w: 3, h: 40 }]);
		assert.equal(fresh.changed, true);
	}

	// --- 3. defaultWidgetSize ----------------------------------------------
	{
		assert.deepEqual(defaultWidgetSize('habit', { habit: 'full' }), { w: 3, h: 28 });
		assert.deepEqual(defaultWidgetSize('habit', {}), { w: 3, h: 19 }, 'habit defaults two-thirds');
		assert.deepEqual(defaultWidgetSize('reading', { reading: 'third' }), { w: 3, h: 10 });
		assert.deepEqual(defaultWidgetSize('album-7', { albums: [{ id: 7, heightRatio: 'half' }] }), { w: 4, h: 15 });
		assert.deepEqual(defaultWidgetSize('album-7', {}), { w: 4, h: 28 }, 'album legacy default full');
		assert.deepEqual(defaultWidgetSize('countdown-x', {}), { w: 3, h: 10 });
		assert.deepEqual(defaultWidgetSize('anniversary-y', {}), { w: 3, h: 10 });
		assert.deepEqual(defaultWidgetSize('calendar', {}), { w: 4, h: 28 });
		assert.deepEqual(defaultWidgetSize('quickActions', {}), { w: 4, h: 28 });
		assert.deepEqual(defaultWidgetSize('weather', {}), { w: 3, h: 19 });
		assert.deepEqual(defaultWidgetSize('mystery', {}), { w: 3, h: 40 }, 'unknown key falls back small');
		assert.deepEqual(DEFAULT_SECTION_SPAN, { w: 6, h: 80 }, 'section default: half board, generous cap');
		// Item id helpers.
		assert.equal(widgetItemId('weather'), 'widget:weather');
		assert.equal(sectionItemId('待办'), 'section:待办');
	}

	// --- 4. Parser round-trip -----------------------------------------------
	{
		const data = {
			banner: { quote: '', author: '', image: '', images: [] },
			quickActions: [],
			columns: [],
			immersive: [
				tile('section:备忘录:工作', 6, 80),
				tile('widget:album-3', 4, 66),
				tile('widget:weather', 3, 40),
			],
		} as Parameters<typeof serialize>[0];
		const md = serialize(data);
		assert.ok(md.includes('\nimmersive:'), 'serialize writes the immersive block');
		assert.ok(md.includes('cap: 80'), 'serialize writes the fine-row CAP field (the version marker)');
		assert.ok(md.includes('id: "section:备忘录:工作"'), 'ids with colons and CJK stay quoted');
		const back = parse(md);
		assert.deepEqual(back.immersive, data.immersive, 'round-trip preserves order, ids and fine-row caps');
		// Idempotence at the file level: parse(serialize(parse(md))) is stable —
		// a small cap survives a save/load cycle without re-inflation.
		const back2 = parse(serialize(back));
		assert.deepEqual(back2.immersive, data.immersive, 'second round-trip stable');
		// Garbage entries dropped; usable ones survive with clamped spans.
		const dirty = parse([
			'---',
			'dashboard: true',
			'banner:',
			'  quote: ""',
			'  author: ""',
			'immersive:',
			'  - id: "widget:x"',
			'    w: 4',
			'    cap: 52',
			'  - w: 3',
			'    cap: 40',
			'  - id: "widget:y"',
			'    w: -5',
			'    cap: "big"',
			'quickActions: []',
			'columns: []',
			'---',
			'',
		].join('\n'));
		assert.deepEqual(dirty.immersive, [
			{ id: 'widget:x', w: 4, h: 52 },
			{ id: 'widget:y', w: 1, h: 40 },
		], 'entry without id dropped; numeric caps clamp to bounds, non-numeric fall back');
		// Legacy coarse `h` (no `cap`) migrates ONCE through the parser and
		// serializes back as `cap` — never re-inflated afterwards.
		const legacy = parse([
			'---',
			'dashboard: true',
			'banner:',
			'  quote: ""',
			'  author: ""',
			'immersive:',
			'  - id: "widget:old"',
			'    w: 3',
			'    h: 4',
			'quickActions: []',
			'columns: []',
			'---',
			'',
		].join('\n'));
		assert.equal(legacy.immersive![0]!.h, pxToRows(4 * 92), 'legacy 92px-scale h rescales onto fine rows');
		const upgraded = serialize(legacy);
		assert.ok(upgraded.includes('cap: ' + pxToRows(4 * 92)), 'legacy entry upgrades to cap on save');
		assert.deepEqual(parse(upgraded).immersive, legacy.immersive, 'upgraded file is stable');
		// Absent / empty -> undefined; serialize omits the block.
		const absent = parse('---\ndashboard: true\nbanner:\n  quote: ""\n  author: ""\ncolumns: []\n---\n');
		assert.equal(absent.immersive, undefined, 'absent block parses to undefined');
		const noBlock = serialize({ ...data, immersive: undefined });
		assert.ok(!noBlock.includes('\nimmersive:'), 'empty list writes no block');
		const emptyList = serialize({ ...data, immersive: [] });
		assert.ok(!emptyList.includes('\nimmersive:'), 'empty array writes no block');
	}

	// --- 5. effectiveLayout gate --------------------------------------------
	{
		assert.equal(effectiveLayout('immersive', false), 'immersive');
		assert.equal(effectiveLayout('immersive', true), 'side', 'phones never leave the side shape');
		assert.equal(effectiveLayout('stacked', true), 'side');
		assert.equal(effectiveLayout('stacked', false), 'stacked');
		assert.equal(effectiveLayout('side', false), 'side');
		assert.equal(effectiveLayout('side', true), 'side');
	}

	// --- 5b. Per-workspace layout field round-trip ----------------------------
	{
		const board = { banner: { quote: '', author: '', image: '', images: [] }, quickActions: [], columns: [] };
		const md = serialize({ ...board, layout: 'immersive' });
		assert.ok(md.includes('\nlayout: immersive'), 'serialize writes the per-workspace layout');
		assert.equal(parse(md).layout, 'immersive', 'layout round-trips');
		const plain = serialize(board);
		assert.ok(!plain.includes('\nlayout:'), 'absent layout writes no line (legacy files byte-stable)');
		assert.equal(parse(plain).layout, undefined, 'absent layout parses to undefined (global default rules)');
		const junk = parse('---\ndashboard: true\nlayout: diagonal\nbanner:\n  quote: ""\n  author: ""\ncolumns: []\n---\n');
		assert.equal(junk.layout, undefined, 'unknown layout value is ignored');
	}

	// --- 6. Height model: px<->rows, legacy migration, clamps ----------------
	{
		assert.equal(pxToRows(0), IMM_MIN_ROWS, 'zero content takes the floor rows');
		assert.equal(pxToRows(100), 11, 'content px -> fine rows incl. the tile gap');
		assert.equal(pxToRows(183), Math.ceil(193 / 10));
		assert.equal(rowsToPx(11), 100, 'rows -> growable px (gap excluded)');
		assert.equal(rowsToPx(pxToRows(250)), 250, 'px -> rows -> px is lossless at track pitch');
		assert.equal(migrateLegacyHeight(2), pxToRows(184), 'legacy h=2 (92px rows) rescales');
		assert.equal(migrateLegacyHeight(45), 45, 'fine-row values pass through');
		// clampSpanW unchanged.
		assert.equal(clampSpanW(5), 5);
		assert.equal(clampSpanW(0), 1, 'below the floor clamps');
		assert.equal(clampSpanW(99), IMM_COLS, 'above the ceiling clamps');
		assert.equal(clampSpanW('x'), 3, 'dirty value falls back');
		assert.equal(clampSpanW(undefined), 3);
		assert.equal(clampSpanW(4.6), 5, 'fractional spans round');
		// clampSpanH: PURE clamp, no legacy migration (runtime fine-row values
		// pass through untouched — migration lives at the normalize boundary).
		assert.equal(clampSpanH(52), 52, 'fine-row cap passes through');
		assert.equal(clampSpanH(3), 3, 'small measured spans are NOT re-migrated');
		assert.equal(clampSpanH(2), 2, 'legacy values stay raw here too');
		assert.equal(clampSpanH(0), 1, 'floor clamps');
		assert.equal(clampSpanH(9999), IMM_MAX_H, 'ceiling clamps');
		assert.equal(clampSpanH(null), 40, 'dirty value falls back');
		assert.equal(clampSpanH('x'), 40);
	}
};

run();
console.log('immersive grid: ALL PASS');
