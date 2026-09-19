/**
 * Verifies the paired-section ("双排") width drag:
 *
 * 1. column-pairs transforms clear `width` wherever they clear `half`
 *    (unpartner / move-to-own-row / normalize self-heal / move-beside
 *    eviction) — a stale split must never leak onto a full-width row.
 * 2. Parser round-trip — `width` (left member's share %) persists beside
 *    `half`, is dropped without it, and out-of-range values are rejected.
 * 3. applyPairWidth — the left member owns the split (basis var + divider
 *    handle + pair-left anchor class), the right member mirrors the
 *    complement; 50% default; out-of-range storage clamps.
 *
 * Run: `npm run test:pair-width`
 */
import { strict as assert } from 'node:assert';
import { unpartnerAt, moveToOwnRow, moveBeside, normalizeColumnPairs } from '../src/column-pairs';
import { parse, serialize } from '../src/parser';
import { applyPairWidth } from '../src/renderer';
import { El, findByClass } from './mini-dom';
import type { DashboardColumn, DashboardData, RenderCallbacks } from '../src/types';

// ---------- 1. column-pairs clears width with half ----------

const col = (name: string, half?: boolean, width?: number): { name: string; half?: boolean; width?: number } =>
	({ name, ...(half ? { half } : {}), ...(width != null ? { width } : {}) });

// unpartnerAt clears width on BOTH actors.
const unp = unpartnerAt([col('A', true, 40), col('B', true)], 0);
assert.equal(unp[0]!.width, undefined, 'unpartnerAt clears the actor width');
assert.equal(unp[1]!.width, undefined, 'unpartnerAt clears the partner width (right member mirror gone)');

// moveToOwnRow: the moved column loses width even mid-run.
const own = moveToOwnRow([col('A', true, 40), col('B', true), col('C')], 0, 2);
assert.equal(own.find(c => c.name === 'A')!.width, undefined, 'moveToOwnRow clears the moved width');
assert.equal(own.find(c => c.name === 'B')!.width, undefined, 'moveToOwnRow clears the ex-partner width');

// normalizeColumnPairs (parse-time self-heal): orphan halves drop width.
const healed = normalizeColumnPairs([col('A', true, 40), col('B')]);
assert.equal(healed[0]!.width, undefined, 'normalize clears an orphan half width');
assert.equal(healed[0]!.half, undefined, 'normalize clears the orphan half flag');

// moveBeside: evicted ex-partners drop width; the pair keeps functioning.
const beside = moveBeside([col('A', true, 40), col('B', true), col('C')], 2, 1, 'right');
const evicted = beside.find(c => c.name === 'A')!;
assert.equal(evicted.half, undefined, 'moveBeside evicts the ex-partner');
assert.equal(evicted.width, undefined, 'moveBeside clears the evicted width');

console.log('column-pairs width clearing: PASS');

// ---------- 2. Parser round-trip ----------

const md = (extra: string): string => [
	'---',
	'columns:',
	"  - name: A",
	"    color: '#111111'",
	'    half: true',
	extra,
	"  - name: B",
	"    color: '#222222'",
	'    half: true',
	'---',
	'',
	'## A',
	'',
	'## B',
].join('\n');

// Valid split persists and survives the round-trip.
const data = parse(md('    width: 40'));
assert.equal(data.columns[0]!.width, 40, 'width parses beside half');
const round = parse(serialize(data));
assert.equal(round.columns[0]!.width, 40, 'width survives serialize -> parse');

// Width without half is dropped (parse keeps it def-only, parseColumns gates).
const noHalf = parse(md('    width: 40').replace('    half: true\n', ''));
assert.equal(noHalf.columns[0]!.width, undefined, 'width without half dropped');

// Out-of-range values rejected at parse.
for (const bad of [5, 95, -1, 101]) {
	assert.equal(parse(md(`    width: ${bad}`)).columns[0]!.width, undefined, `out-of-range width ${bad} dropped`);
}

console.log('parser width round-trip: PASS');

// ---------- 3. applyPairWidth rendering ----------

const callbacks = { onColumnWidthChange: (_n: string, _p: number) => {} } as unknown as RenderCallbacks;
const dataPair: DashboardData = {
	banner: { quote: '', author: '', image: '' },
	quickActions: [],
	columns: [
		{ name: 'A', color: '', cards: [], half: true, width: 40 },
		{ name: 'B', color: '', cards: [], half: true },
	],
};

const makeEl = (column: DashboardColumn, data: DashboardData): El => {
	const el = new El('div');
	el.addClass('dashboard-section-row--half');
	applyPairWidth(el as unknown as HTMLElement, column, data, callbacks);
	return el;
};

const leftEl = makeEl(dataPair.columns[0]!, dataPair);
assert.ok(leftEl.hasClass('dashboard-section-row--pair-left'), 'left member anchors the divider');
assert.equal(leftEl.style.getPropertyValue('--db-pair-basis'), '40%', 'left basis var from stored width');
assert.equal(findByClass(leftEl, 'dashboard-pair-width-handle').length, 1, 'divider handle on the left member');

const rightEl = makeEl(dataPair.columns[1]!, dataPair);
assert.ok(!rightEl.hasClass('dashboard-section-row--pair-left'), 'right member does not anchor');
assert.equal(rightEl.style.getPropertyValue('--db-pair-basis'), '60%', 'right mirrors the complement');
assert.equal(findByClass(rightEl, 'dashboard-pair-width-handle').length, 0, 'no divider on the right member');

// Default 50/50 without a stored split.
const dataEven: DashboardData = {
	...dataPair,
	columns: [
		{ name: 'A', color: '', cards: [], half: true },
		{ name: 'B', color: '', cards: [], half: true },
	],
};
assert.equal(makeEl(dataEven.columns[0]!, dataEven).style.getPropertyValue('--db-pair-basis'), '50%', 'default split 50%');
assert.equal(makeEl(dataEven.columns[1]!, dataEven).style.getPropertyValue('--db-pair-basis'), '50%', 'default mirror 50%');

// Out-of-range storage clamps at render (hand-edited file).
const dataClamp: DashboardData = {
	...dataPair,
	columns: [
		{ name: 'A', color: '', cards: [], half: true, width: 500 },
		{ name: 'B', color: '', cards: [], half: true },
	],
};
assert.equal(makeEl(dataClamp.columns[0]!, dataClamp).style.getPropertyValue('--db-pair-basis'), '80%', 'clamp high');
assert.equal(makeEl(dataClamp.columns[1]!, dataClamp).style.getPropertyValue('--db-pair-basis'), '20%', 'mirror clamps low');

console.log('applyPairWidth rendering: PASS');
console.log('verify-pair-width: all assertions passed');
