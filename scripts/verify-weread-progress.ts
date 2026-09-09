/**
 * Regression: weread progress bar always 0 and "在读" filter empty.
 *
 * Root causes (bug report 2026-08 / resumed 2026-09-09):
 * 1. /book/getprogress nests progress under `data.book.progress` — the old
 *    flat `data.progress` read never existed, so every book showed 0% and
 *    collapsed to notStarted (hence empty 在读 filter).
 * 2. The shelf's "是否读完" field is `finishReading`, which the shelf parser
 *    never looked at.
 * 3. enrichProgress only ran when a progress filter was active, so unfiltered
 *    shelves never fetched real progress at all.
 *
 * Covers the pure halves of those fixes:
 * - progressFromGetProgress: nested book.progress wins, sibling/flat fallbacks,
 *   missing → 0, clamped to 0-100.
 * - parseShelf: finishReading/finished/markStatus → finished state; finished
 *   without a shelf percent still gets a full bar; plain books keep percent.
 *
 * Run: `npm run test:weread-progress`
 */
import { strict as assert } from 'node:assert';
import { parseShelf, progressDetailsFromGetProgress, progressFromGetProgress } from '../src/weread-service';
import { generateDefaultMarkdown, parse, serialize } from '../src/parser';
import type { WereadWidget } from '../src/types';
import {
	applyWereadProgressEntry,
	filterWereadBooks,
	groupWereadBooks,
	mergeNotebookStats,
	needsProgressFetch,
} from '../src/weread-shelf-model';
import {
	mergeProgressFiles,
	normalizeProgressFile,
	PROGRESS_FRESH_MS,
} from '../src/weread-progress-store';

// ---------- 1. progressFromGetProgress ----------
assert.equal(progressFromGetProgress({ book: { progress: 45 } }), 45, 'nested book.progress is the primary path');
assert.equal(progressFromGetProgress({ book: { readProgress: 63 } }), 63, 'nested book.readProgress fallback');
assert.equal(progressFromGetProgress({ book: { readPercent: 7 } }), 7, 'nested book.readPercent fallback');
assert.equal(progressFromGetProgress({ book: { progress: 45 }, progress: 99 }), 45, 'nested beats flat when both exist');
assert.equal(progressFromGetProgress({ progress: 30 }), 30, 'flat fallback still works');
assert.equal(progressFromGetProgress({}), 0, 'missing payload → 0');
assert.equal(progressFromGetProgress({ book: { progress: 150 } }), 100, 'clamped to 100');
assert.equal(progressFromGetProgress({ book: { progress: -3 } }), 0, 'clamped to 0');
assert.deepEqual(
	progressDetailsFromGetProgress({ book: { progress: 45, recordReadingTime: 3600, updateTime: 1_725_840_000 } }),
	{ progress: 45, readingTime: 3600, lastReadTime: 1_725_840_000_000 },
	'progress details retain reading time and normalize update time',
);
console.log('progressFromGetProgress: PASS');

// ---------- 2. parseShelf: finished detection + full-bar fallback ----------
const shelf = parseShelf({
	books: [
		// The reported case: finishReading=1, no shelf percent.
		{ bookId: 'b1', title: 'Finished no pct', author: 'a', finishReading: 1 },
		// finishReading=1 but shelf also carries a percent — keep the percent.
		{ bookId: 'b2', title: 'Finished with pct', author: 'a', finishReading: 1, readPercent: 87 },
		// Legacy finished flag still honored.
		{ bookId: 'b3', title: 'Legacy finished', author: 'a', finished: 1 },
		// markStatus path.
		{ bookId: 'b4', title: 'Marked finished', author: 'a', markStatus: 1 },
		// Mid-read.
		{ bookId: 'b5', title: 'Reading', author: 'a', readPercent: 42 },
		// Untouched.
		{ bookId: 'b6', title: 'Not started', author: 'a' },
	],
});
const byTitle = (t: string) => shelf.find(b => b.title === t)!;

assert.equal(byTitle('Finished no pct').readingState, 'finished', 'finishReading=1 → finished');
assert.equal(byTitle('Finished no pct').progress, 100, 'finished without shelf percent gets a full bar');
assert.equal(byTitle('Finished with pct').readingState, 'finished', 'finishReading wins over partial percent');
assert.equal(byTitle('Finished with pct').progress, 87, 'explicit shelf percent is kept for finished books');
assert.equal(byTitle('Legacy finished').readingState, 'finished', 'legacy finished=1 still finished');
assert.equal(byTitle('Marked finished').readingState, 'finished', 'markStatus=1 still finished');
assert.equal(byTitle('Reading').readingState, 'reading', 'partial percent → reading');
assert.equal(byTitle('Reading').progress, 42, 'reading percent preserved');
assert.equal(byTitle('Not started').readingState, 'notStarted', 'no signals → notStarted');

// The filter contract: every state value filterBooks matches against.
for (const state of ['notStarted', 'reading', 'finished'] as const) {
	assert.ok(shelf.some(b => b.readingState === state), `shelf produces a ${state} example`);
}
console.log('parseShelf finishReading: PASS');

// ---------- 3. reliable shelf facets ----------
const now = Date.UTC(2026, 8, 9, 12);
const facetShelf = parseShelf({
	books: [
		{ bookId: 'reading', title: 'Reading book', author: 'a', readPercent: 35, lastReadTime: now / 1000 - 2 * 86400 },
		{ bookId: 'finished', title: 'Finished book', author: 'a', finishReading: 1, updateTime: now / 1000 - 15 * 86400 },
		{ bookId: 'old', title: 'Old book', author: 'a', readPercent: 10, updateTime: now / 1000 - 60 * 86400 },
		{ bookId: 'never', title: 'Never read', author: 'a' },
	],
	albums: [{ albumInfo: { albumId: 'audio', name: 'Audio title', authorName: 'speaker' } }],
	mp: { show: 1, book: { bookId: 'article', title: 'Article collection' } },
});

assert.equal(facetShelf.find(b => b.bookId === 'reading')?.contentType, 'book', 'books[] -> book');
assert.equal(facetShelf.find(b => b.bookId === 'audio')?.contentType, 'audio', 'albums[] -> audio');
assert.equal(facetShelf.find(b => b.bookId === 'article')?.contentType, 'article', 'mp -> article');
assert.equal(facetShelf.find(b => b.bookId === 'reading')?.lastReadTime, now - 2 * 86400_000, 'seconds timestamp -> milliseconds');

const faceted = mergeNotebookStats(facetShelf, [
	{ bookId: 'reading', noteCount: 3, bookmarkCount: 0, reviewCount: 0 },
	{ bookId: 'finished', noteCount: 1, bookmarkCount: 0, reviewCount: 2 },
]);
assert.equal(faceted.find(b => b.bookId === 'reading')?.noteCount, 3, 'notebook counts join by bookId');
assert.equal(facetShelf.find(b => b.bookId === 'reading')?.noteCount, undefined, 'merge keeps shelf input immutable');

const filtered = filterWereadBooks(faceted, {
	progress: ['reading'],
	contentTypes: ['book'],
	recency: ['recent7'],
	notes: ['highlights'],
}, now);
assert.deepEqual(filtered.map(b => b.bookId), ['reading'], 'four facets combine with AND');

const readingGroups = groupWereadBooks(faceted, 'readingState', now);
assert.deepEqual(readingGroups.map(g => g.key), ['reading', 'finished', 'notStarted'], 'reading groups use product order');
const contentGroups = groupWereadBooks(faceted, 'contentType', now);
assert.deepEqual(contentGroups.map(g => g.key), ['book', 'audio', 'article'], 'content groups separate shelf item types');
assert.deepEqual(
	filterWereadBooks(faceted, { notes: ['ideas'] }, now).map(b => b.bookId),
	['finished'],
	'idea filter uses personal review counts',
);
assert.deepEqual(
	filterWereadBooks(faceted, { recency: ['recent30'] }, now).map(b => b.bookId),
	['finished'],
	'recency buckets are disjoint',
);
console.log('weread shelf facets: PASS');

// ---------- 3b. enrichment targeting (rate-limit request budget) ----------
// Only books whose progress the shelf cannot already answer get a
// /book/getprogress call — the gateway rate limits that endpoint hard.
assert.equal(
	needsProgressFetch({ contentType: 'book', readingState: 'reading', readingTime: 3600 }),
	true,
	'actively reading book is fetched',
);
assert.equal(
	needsProgressFetch({ contentType: 'book', readingState: 'reading', readingTime: 0 }),
	true,
	'book marked reading (dipped into) is fetched even without shelf reading time',
);
assert.equal(
	needsProgressFetch({ contentType: 'book', readingState: 'finished', readingTime: 99999 }),
	false,
	'finished book (finishReading from shelf) needs no fetch',
);
assert.equal(
	needsProgressFetch({ contentType: 'book', readingState: 'notStarted', readingTime: 0 }),
	false,
	'never-opened book needs no fetch',
);
assert.equal(
	needsProgressFetch({ contentType: 'book', readingState: 'notStarted', readingTime: 120 }),
	true,
	'notStarted but has reading time (opened, no percent yet) is fetched',
);
assert.equal(
	needsProgressFetch({ contentType: 'audio', readingState: 'reading', readingTime: 500 }),
	false,
	'audio items carry no percent to fetch',
);
assert.equal(
	needsProgressFetch({ contentType: 'article', readingState: 'reading' }),
	false,
	'article items carry no percent to fetch',
);
console.log('needsProgressFetch: PASS');

// ---------- 3c. cross-session progress store ----------
// weread-progress.json: normalize junk safely, merge by newest fetch ts
// (iCloud / other devices), fresh entries within the TTL window.
const parsed = normalizeProgressFile({
	version: 1,
	entries: {
		ok: { progress: 42, readingState: 'reading', readingTime: 100, ts: 1000 },
		badState: { progress: 10, readingState: 'weird', ts: 1000 },
		badProgress: { progress: 999, readingState: 'reading', ts: 1000 },
		noTs: { progress: 5, readingState: 'reading' },
	},
});
assert.equal(parsed.entries['ok']?.progress, 42, 'well-formed entry survives normalize');
assert.ok(!('badState' in parsed.entries), 'unknown readingState drops out');
assert.ok(!('badProgress' in parsed.entries), 'out-of-range progress drops out');
assert.equal(parsed.entries['noTs']?.ts, 0, 'missing ts tolerated (never fresh)');
assert.deepEqual(normalizeProgressFile(null).entries, {}, 'null body -> empty file');
assert.deepEqual(normalizeProgressFile('junk').entries, {}, 'non-object body -> empty file');

const merged = mergeProgressFiles(
	{ version: 1, entries: { a: { progress: 10, readingState: 'reading', ts: 100 }, b: { progress: 20, readingState: 'reading', ts: 500 } } },
	{ version: 1, entries: { a: { progress: 15, readingState: 'reading', ts: 200 }, c: { progress: 30, readingState: 'reading', ts: 300 } } },
);
assert.equal(merged.entries['a']?.progress, 15, 'newer ts wins per bookId');
assert.equal(merged.entries['b']?.progress, 20, 'base-only entry kept');
assert.equal(merged.entries['c']?.progress, 30, 'overlay-only entry kept');

// Freshness window semantics (what makes a persisted entry stand in for the call).
const nowMs = Date.now();
const storeLike = normalizeProgressFile({
	entries: {
		fresh: { progress: 55, readingState: 'reading', ts: nowMs - PROGRESS_FRESH_MS / 2 },
		stale: { progress: 66, readingState: 'reading', ts: nowMs - PROGRESS_FRESH_MS - 1 },
	},
});
assert.ok(storeLike.entries['fresh'] && nowMs - storeLike.entries['fresh']!.ts < PROGRESS_FRESH_MS, 'recent entry is fresh');
assert.ok(storeLike.entries['stale'] && nowMs - storeLike.entries['stale']!.ts >= PROGRESS_FRESH_MS, 'aged entry is stale');

// Applying a cached entry: progress/state/lastReadTime overlay, shelf finished verdict survives.
const applied = applyWereadProgressEntry(
	{ bookId: 'x', readingState: 'reading', contentType: 'book', readingTime: 50, lastReadTime: 1 },
	{ progress: 77, readingState: 'reading', readingTime: 90, lastReadTime: 2 },
);
assert.equal(applied.progress, 77, 'cached progress applied');
assert.equal(applied.lastReadTime, 2, 'cached lastReadTime wins');
assert.equal(applied.readingTime, 90, 'cached readingTime wins');
const finishedKept = applyWereadProgressEntry(
	{ bookId: 'y', readingState: 'finished', contentType: 'book' },
	{ progress: 87, readingState: 'reading' },
);
assert.equal(finishedKept.readingState, 'finished', 'shelf finished verdict survives a below-100 cached entry');
const missingKept = applyWereadProgressEntry(
	{ bookId: 'z', readingState: 'reading', contentType: 'book', readingTime: 5, lastReadTime: 6 },
	{ progress: 12, readingState: 'reading' },
);
assert.equal(missingKept.readingTime, 5, 'absent cached fields fall back to shelf values');
assert.equal(missingKept.lastReadTime, 6, 'absent cached lastReadTime falls back to shelf');
console.log('progress store: PASS');

// ---------- 4. dashboard config round-trip ----------
const base = parse(generateDefaultMarkdown());
const firstColumn = base.columns[0]!;
const widgetConfig: WereadWidget = {
	id: 'w-filtered',
	view: 'shelf',
	progressFilters: ['reading'],
	contentTypeFilters: ['book', 'audio'],
	recencyFilters: ['recent7', 'recent30'],
	noteFilters: ['highlights', 'ideas'],
	groupBy: 'contentType',
};
const roundTrip = parse(serialize({
	...base,
	columns: [{ ...firstColumn, sectionType: 'weread', wereadConfig: { widgets: [widgetConfig] } }],
}));
assert.deepEqual(
	roundTrip.columns[0]?.wereadConfig?.widgets[0],
	{ ...widgetConfig, categoryFilters: undefined, title: undefined },
	'four facets and grouping survive save/reload',
);
console.log('weread config round-trip: PASS');

console.log('weread progress: ALL PASS');
