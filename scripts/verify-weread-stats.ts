/**
 * Verifies the weread reading-stats data layer (official /readdata/detail
 * contract, per Tencent/WeChatReading skills/readdata.md):
 *
 * 1. parseReadStats — full weekly payload (readTimes keyed by SECONDS
 *    timestamps, readStat display strings, readLongest book vs albumInfo,
 *    preferCategory incl. parent-title fallback, compare ratio) parses into
 *    the rich stats shape; missing/junk fields degrade to empty, never throw.
 * 2. computeReadStreaks — consecutive-day runs over daily buckets with the
 *    server's >= 60s "effective reading day" rule; today-not-yet-qualified
 *    falls back to yesterday's run (streak alive until midnight); future
 *    buckets are ignored.
 * 3. bucketLabel — x-axis labels per mode (weekday / day / month / year).
 *
 * All timestamps are built from local dates so the suite is timezone-robust.
 *
 * Run: `npm run test:weread-stats`
 */
import { strict as assert } from 'node:assert';
import {
	buildHeatmapCells,
	bucketLabel,
	computeReadStreaks,
	HEATMAP_WINDOW_DAYS,
	parseReadStats,
} from '../src/weread-service';
import { shelfStateFor } from '../src/weread-shelf-model';
import { normalizeStatItems } from '../src/weread-stats';
import type { WereadStatItem } from '../src/types';

// ---------- 1. parseReadStats ----------
const full = parseReadStats({
	baseTime: 1757059200,
	totalReadTime: 36000,
	readDays: 5,
	dayAverageReadTime: 5142,
	compare: 0.2,
	readTimes: {
		'1757145600': 0,
		'1757059200': 7200,
		'1757232000': 60,
		'not-a-number': 999,
	},
	readStat: [
		{ stat: '读过', counts: '3本', scheme: '' },
		{ stat: '读完', counts: '1本' },
		{ stat: '笔记', counts: '12条' },
		{ stat: '', counts: 'x' },
	],
	readLongest: [
		{ book: { bookId: 'b1', title: '书名', author: '作者' }, readTime: 12000, tags: ['笔记最多'] },
		{ albumInfo: { albumId: 'a1', name: '有声书', authorName: '主播' }, readTime: 3000 },
	],
	preferCategory: [
		{ categoryTitle: '文学', val: 1, readingTime: 20000, readingCount: 5 },
		{ categoryTitle: '', parentCategoryTitle: '科技', val: 0.5, readingTime: 10000 },
	],
}, 'weekly');

assert.equal(full.mode, 'weekly');
assert.equal(full.totalReadTime, 36000, 'total seconds');
assert.equal(full.readDays, 5);
assert.equal(full.dayAverageReadTime, 5142);
assert.equal(full.compare, 0.2, 'compare ratio passes through');
assert.deepEqual(
	full.readTimes,
	[
		{ ts: 1757059200 * 1000, seconds: 7200 },
		{ ts: 1757145600 * 1000, seconds: 0 },
		{ ts: 1757232000 * 1000, seconds: 60 },
	],
	'readTimes: seconds keys normalized to ms, sorted ascending, junk key dropped',
);
assert.deepEqual(
	full.readStat.map(s => `${s.stat}=${s.counts}`),
	['读过=3本', '读完=1本', '笔记=12条'],
	'readStat display strings kept verbatim, empty stat dropped',
);
assert.equal(full.readLongest[0]?.title, '书名', 'readLongest book entry');
assert.equal(full.readLongest[0]?.tags?.[0], '笔记最多');
assert.equal(full.readLongest[1]?.title, '有声书', 'album entry takes albumInfo.name');
assert.equal(full.readLongest[1]?.author, '主播', 'album author takes authorName');
assert.equal(full.preferCategory[0]?.title, '文学');
assert.equal(full.preferCategory[1]?.title, '科技', 'missing categoryTitle falls back to parent');

const empty = parseReadStats({}, 'overall');
assert.equal(empty.totalReadTime, 0);
assert.equal(empty.compare, undefined, 'absent compare stays undefined');
assert.deepEqual(empty.readTimes, [], 'no readTimes -> empty series');
assert.deepEqual(empty.readStat, []);
assert.deepEqual(empty.readLongest, []);
assert.deepEqual(empty.preferCategory, []);
assert.deepEqual(parseReadStats({ readTimes: [1, 2], readStat: 'junk' }, 'monthly').readTimes, [], 'array readTimes / junk shapes degrade to empty');
console.log('parseReadStats: PASS');

// ---------- 2. computeReadStreaks ----------
const day = (n: number): number => new Date(2026, 8, n).getTime(); // Sep 2026, local midnight
const noonOf = (n: number): number => day(n) + 12 * 3600_000;

const buckets = [
	{ ts: day(1), seconds: 90 },
	{ ts: day(2), seconds: 90 },
	{ ts: day(3), seconds: 90 },
	{ ts: day(4), seconds: 90 },
	{ ts: day(5), seconds: 0 },
	{ ts: day(6), seconds: 90 },
	{ ts: day(7), seconds: 90 },
	{ ts: day(8), seconds: 90 },
	{ ts: day(9), seconds: 90 },
	{ ts: day(10), seconds: 90 }, // future relative to now below
];
const now = noonOf(9);
assert.deepEqual(
	computeReadStreaks(buckets, now),
	{ current: 4, longest: 4 },
	'gap resets runs; current counts through today, future bucket ignored',
);
assert.deepEqual(
	computeReadStreaks(buckets.map(b => b.ts === day(9) ? { ...b, seconds: 0 } : b), now),
	{ current: 3, longest: 4 },
	'today not yet qualified -> streak alive through yesterday',
);
assert.deepEqual(
	computeReadStreaks([{ ts: day(9), seconds: 30 }], now),
	{ current: 0, longest: 0 },
	'under the 60s effective-reading threshold does not count',
);
assert.deepEqual(computeReadStreaks([], now), { current: 0, longest: 0 }, 'empty series');
console.log('computeReadStreaks: PASS');

// ---------- 3. bucketLabel ----------
assert.equal(bucketLabel(day(7), 'weekly'), '一', '2026-09-07 is a Monday');
assert.equal(bucketLabel(day(9), 'weekly'), '三', '2026-09-09 is a Wednesday');
assert.equal(bucketLabel(day(9), 'monthly'), '9');
assert.equal(bucketLabel(day(9), 'annually'), '9月');
assert.equal(bucketLabel(day(9), 'overall'), '2026');
console.log('bucketLabel: PASS');

// ---------- 4. rolling 365-day heatmap cells ----------
// dailyReadTimes parses alongside readTimes (annually mode detail).
const withDaily = parseReadStats({
	totalReadTime: 100,
	dailyReadTimes: { '1757059200': 600, '1757145600': 90 },
}, 'annually');
assert.deepEqual(
	withDaily.dailyReadTimes,
	[{ ts: 1757059200 * 1000, seconds: 600 }, { ts: 1757145600 * 1000, seconds: 90 }],
	'dailyReadTimes normalized and sorted',
);
assert.equal(parseReadStats({}, 'annually').dailyReadTimes.length, 0, 'absent dailyReadTimes -> empty');

// Cell grid: 365 window days + alignment blanks, Monday-start weeks, today
// flagged, missing buckets at 0, blanks excluded from the window.
const nowNoon = new Date(2026, 8, 9, 12).getTime(); // Wednesday
const dayTs = (n: number, offsetDays: number): number => new Date(2026, 8, n + offsetDays).getTime();
const heat = buildHeatmapCells([
	{ ts: dayTs(9, 0), seconds: 7200 },    // today
	{ ts: dayTs(8, 0), seconds: 30 },      // yesterday, under threshold
	{ ts: dayTs(2, 0), seconds: 1800 },    // a week-old day
], nowNoon);
const inWindow = heat.filter(c => c.inWindow);
assert.equal(inWindow.length, HEATMAP_WINDOW_DAYS, 'exactly 365 window cells');
// Grid start is a Monday but the last column ends at today, so the total is
// blanks + window (the final week is partial, GitHub-style).
assert.equal(heat.filter(c => !c.inWindow).length, 2, 'two alignment blanks before the Wednesday window start');
assert.equal(new Date(heat[0]!.ts).getDay(), 1, 'grid starts on a Monday');
assert.equal(heat[heat.length - 1]!.isToday, true, 'last cell is today');
assert.equal(heat.find(c => c.isToday)?.seconds, 7200, 'today carries its bucket');
assert.equal(inWindow.find(c => c.ts === dayTs(8, 0))?.seconds, 30, 'yesterday carries its bucket');
assert.equal(inWindow.find(c => c.ts === dayTs(4, 0))?.seconds, 0, 'missing bucket -> 0 seconds');
assert.equal(buildHeatmapCells([], nowNoon).filter(c => c.inWindow).length, HEATMAP_WINDOW_DAYS, 'no buckets still yields the full window at level 0');

// Shelf state overlay: finished wins, persisted entry refines, reading time
// marks reading, otherwise not started.
assert.equal(shelfStateFor({ readingState: 'finished' }, { readingState: 'reading' }), 'finished', 'shelf finished verdict survives the entry');
assert.equal(shelfStateFor({ readingState: 'reading' }, { readingState: 'notStarted' }), 'notStarted', 'entry refines a non-finished shelf state');
assert.equal(shelfStateFor({ readingState: 'reading', readingTime: 3600 }), 'reading', 'no entry + reading time -> reading');
assert.equal(shelfStateFor({ readingState: 'reading', readingTime: 0 }), 'notStarted', 'no entry + no reading time -> not started');
assert.equal(shelfStateFor({ readingState: 'notStarted', readingTime: 120 }, { readingState: 'reading' }), 'reading', 'entry upgrades a shelf notStarted');
console.log('heatmap cells + shelf overlay: PASS');

// ---------- 5. default stats blocks ----------
// Default = overview, most read, trend; preferCategory stays a valid opt-in.
// 'bogus' is cast on purpose: stored configs may carry unknown ids after a
// downgrade and must drop out instead of throwing.
assert.deepEqual(normalizeStatItems(undefined), ['kpi', 'topRead', 'trend'], 'default blocks');
assert.deepEqual(normalizeStatItems([]), ['kpi', 'topRead', 'trend'], 'empty stored -> default');
assert.deepEqual(normalizeStatItems(['kpi', 'preferCategory']), ['kpi', 'preferCategory'], 'stored preferCategory stays renderable');
assert.deepEqual(normalizeStatItems(['kpi', 'bogus' as WereadStatItem]), ['kpi'], 'unknown ids drop out');
assert.deepEqual(normalizeStatItems(['bogus' as WereadStatItem]), ['kpi', 'topRead', 'trend'], 'all-unknown -> default');
console.log('default stats blocks: PASS');

console.log('weread stats: ALL PASS');
