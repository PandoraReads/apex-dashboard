/**
 * Verifies the DQL engine's dataview-parity batch (post-3.9.7):
 *
 * 1. New functions: striptime / weekday / durationformat / datepath /
 *    localtime / truncate / ljust / rjust / substring / abs / regexreplace /
 *    econtains, and the expanded dateformat tokens (EEEE/MMM/w/a/...).
 * 2. TASK query fields: scheduled/start/end/completion/status/line/path are
 *    now parsed (the vault scanner already had them) and filterable — the
 *    classic Tasks-plugin query shapes work.
 * 3. GROUP BY `rows`: member access distributes over the list —
 *    rows.file.link maps, sum(rows.rating) aggregates, length(rows) counts,
 *    join(rows.file.link, ...) renders.
 * 4. Implicit list indexing: file.tasks.text maps across task objects.
 * 5. file.tags carries parent hierarchy (#a/b answers for #a) while
 *    file.etags stays exact (Dataview semantics).
 * 6. Object literals accept dataview's single-colon `{a: 1}` spelling.
 * 7. meta(link) resolves the target page's fields via the page index.
 * 8. The shipped sample query shapes still parse and run.
 *
 * Run: `npm run test:dql`
 */
import { strict as assert } from 'node:assert';
import type { CachedMetadata, TFile } from 'obsidian';
import { executeDql } from '../src/dql/index';
import type { DqlValue, Page } from '../src/dql/types';
import { buildPageFields } from '../src/dql/page-builder';
import { dqlEquals, makeLink } from '../src/dql/values';

/* ----------------------------- helpers ----------------------------- */

function fakeFile(path: string, basename = path): TFile {
	return {
		path,
		basename,
		stat: { ctime: 1_700_000_000_000, mtime: 1_700_000_000_000, size: 100 },
	} as unknown as TFile;
}

function page(path: string, fields: Record<string, DqlValue>): Page {
	return { file: fakeFile(path), fields };
}

function firstValues(dql: string, pages: readonly Page[], index = 0): readonly DqlValue[] {
	const r = executeDql(dql, pages);
	assert.ok(r.ok && !r.empty, `query failed: ${dql} → ${!r.ok ? r.error.message : 'empty'}`);
	const row = r.result.rows[index];
	assert.ok(row, 'no result row');
	return row.values;
}

function tableValue(dql: string, pages: readonly Page[], index = 0): DqlValue {
	// values[0] is the implicit file column; queries here project one field.
	return firstValues(dql, pages, index)[1]!;
}

function rowCount(dql: string, pages: readonly Page[]): number {
	const r = executeDql(dql, pages);
	assert.ok(r.ok && !r.empty, `query failed: ${dql} → ${!r.ok ? r.error.message : 'empty'}`);
	return r.result.rows.length;
}

const tag = (t: string): DqlValue => makeLink('#' + t, '#' + t);

/* ----------------------------- fixture pages ----------------------------- */

const bookPages: Page[] = [
	page('a.md', { 'file.link': makeLink('a.md', 'a'), 'file.name': 'a', 'file.path': 'a.md', rating: 5, genre: 'sf', status: 'read', 'file.tags': [tag('x')], 'file.tasks': [] }),
	page('b.md', { 'file.link': makeLink('b.md', 'b'), 'file.name': 'b', 'file.path': 'b.md', rating: 3, genre: 'sf', status: 'unread', 'file.tags': [tag('x')], 'file.tasks': [] }),
	page('c.md', { 'file.link': makeLink('c.md', 'c'), 'file.name': 'c', 'file.path': 'c.md', rating: 4, genre: 'romance', status: 'read', 'file.tags': [tag('x')], 'file.tasks': [] }),
];

const TASK_BODY = [
	'- [ ] 买菜 ⏳ 2026-11-10',
	'- [x] 写周报 [due:: 2026-11-05] ✅ 2026-11-06',
	'- [x] 旧事 [start:: 2026-11-01]',
].join('\n');

const taskCache: CachedMetadata = {
	frontmatter: { tags: ['project/sub'], rating: 4 },
	tags: [{ tag: '#inline/one', position: { start: { line: 1, col: 0, offset: 0 }, end: { line: 1, col: 0, offset: 0 } } }],
};

const taskFields = buildPageFields(fakeFile('journal/test.md', 'test'), taskCache, TASK_BODY);
const taskPages: Page[] = [page('journal/test.md', taskFields)];

/* ----------------------------- 1. new functions ----------------------------- */

// striptime: local-midnight truncation (expected built the same way).
const stripTs = tableValue('TABLE striptime(date("2026-11-09 15:30"))', bookPages) as { ts: number };
assert.equal(stripTs.ts, new Date(2026, 10, 9, 0, 0, 0).getTime(), 'striptime truncates to local midnight');

// weekday: luxon-style 1=Mon..7=Sun. 2026-11-09 is a Monday.
assert.equal(tableValue('TABLE weekday(date("2026-11-09"))', bookPages), 1, 'weekday: Monday = 1');
assert.equal(tableValue('TABLE weekday(date("2026-11-08"))', bookPages), 7, 'weekday: Sunday = 7');

// dateformat expanded tokens: 2026-11-08 is a Sunday in November.
const fmt = tableValue('TABLE dateformat(date("2026-11-08"), "EEEE EEE E w MMM M d yyyy a")', bookPages) as string;
assert.ok(fmt.startsWith('Sunday Sun 7'), `dateformat EEEE/EEE/E: got "${fmt}"`);
assert.ok(fmt.includes('Nov 11 8 2026'), `dateformat MMM/M/d/yyyy: got "${fmt}"`);

// durationformat tokens, including luxon-style quoted literals.
assert.equal(tableValue(`TABLE durationformat(dur("1 d 2 h"), "d'd' h'h'")`, bookPages), "1'd' 2'h'");
assert.equal(tableValue('TABLE durationformat(dur("2 h 5 m 3 s"), "hh:mm:ss")', bookPages), '02:05:03');

// datepath: pull the date out of a filename per a token format.
const dp = tableValue('TABLE datepath(file.path, "yyyy-MM-dd")', [page('Journal/2026-11-08.md', { 'file.path': 'Journal/2026-11-08.md' })]) as { ts: number } | null;
assert.ok(dp && dp.ts > 0, 'datepath parses yyyy-MM-dd from a path');
assert.equal(tableValue('TABLE year(datepath("2026-11-08.md", "yyyy-MM-dd"))', bookPages), 2026);

// localtime is a compatibility passthrough (values are already local).
assert.equal(tableValue('TABLE localtime(3)', bookPages), 3);

// string helpers.
assert.equal(tableValue('TABLE truncate("hello world", 5)', bookPages), 'hello...');
assert.equal(JSON.stringify(tableValue('TABLE ljust("ab", 5) + "|"', bookPages)), '"ab   |"');
assert.equal(JSON.stringify(tableValue('TABLE "|" + rjust("ab", 5)', bookPages)), '"|   ab"');
assert.equal(tableValue('TABLE substring("hello", 1, 3)', bookPages), 'el');
assert.equal(tableValue('TABLE abs(3 - 8)', bookPages), 5);
assert.equal(tableValue('TABLE regexreplace("\\\\d+", "#", "a1b22")', bookPages), 'a#b#');

// econtains: exact membership.
assert.equal(tableValue('TABLE econtains(["a", "b"], "a")', bookPages), true);
assert.equal(tableValue('TABLE econtains(["ab", "b"], "a")', bookPages), false);

/* ----------------------------- 2. TASK fields ----------------------------- */

assert.equal(firstValues('TASK FROM "journal" WHERE scheduled != null', taskPages)[0], '买菜', 'scheduled marker (⏳) filterable');
assert.equal(firstValues('TASK FROM "journal" WHERE completion != null', taskPages)[0], '写周报', 'completion (✅) filterable');
assert.equal(firstValues('TASK FROM "journal" WHERE start != null', taskPages)[0], '旧事', 'start ([start::]) filterable');
assert.equal(firstValues('TASK FROM "journal" WHERE due != null', taskPages)[0], '写周报', 'due ([due::]) filterable');
assert.equal(firstValues('TASK FROM "journal" WHERE status = "x"', taskPages)[0], '写周报', 'status = "x" matches completed');
assert.equal(firstValues('TASK FROM "journal" WHERE status = " "', taskPages)[0], '买菜', 'status = " " matches open');
assert.equal(rowCount('TASK FROM "journal" WHERE line != null', taskPages), 3, 'line field present');
assert.equal(rowCount('TASK FROM "journal" WHERE path = "journal/test.md"', taskPages), 3, 'path field filterable');

// The classic "scheduled up to a date" window shape.
assert.equal(rowCount('TASK WHERE scheduled != null AND scheduled <= date("2026-11-10")', [
	// A second page with a task scheduled far out proves the window works.
	...taskPages,
	page('later.md', buildPageFields(fakeFile('later.md'), {}, '- [ ] 远期 ⏳ 2027-01-01')),
]), 1, 'scheduled <= date(...) window');

/* ----------------------------- 3. GROUP BY rows ----------------------------- */

const grouped = firstValues('TABLE genre, sum(rows.rating), length(rows) GROUP BY genre', bookPages);
assert.equal(grouped[1], 'sf');
assert.equal(grouped[2], 8, 'sum(rows.rating) aggregates across members');
assert.equal(grouped[3], 2, 'length(rows) counts members');

const rowLinks = tableValue('TABLE rows.file.link GROUP BY genre', bookPages) as DqlValue[];
assert.deepEqual((rowLinks as Array<{ path: string }>).map(l => l.path), ['a.md', 'b.md'], 'rows.file.link maps across the group');

assert.equal(tableValue('TABLE join(rows.file.link, " · ") GROUP BY genre', bookPages), 'a · b', 'join(rows.file.link, sep) renders');
assert.equal(tableValue('TABLE average(rows.rating) GROUP BY genre', bookPages), 4, 'average(rows.rating) works');

// Grouped rendering still carries raw member rows for the renderer.
const groupedResult = executeDql('TABLE genre GROUP BY genre', bookPages);
assert.ok(groupedResult.ok && !groupedResult.empty && groupedResult.result.rows[0]!.rows, 'member rows attached for grouped rendering');

/* ----------------------------- 4. implicit list indexing ----------------------------- */

const texts = tableValue('TABLE file.tasks.text', taskPages) as DqlValue[];
assert.deepEqual(texts, ['买菜', '写周报', '旧事'], 'file.tasks.text distributes over task objects');

/* ----------------------------- 5. tags vs etags ----------------------------- */

const tagPaths = (v: DqlValue): string[] => (v as Array<{ path: string }>).map(l => l.path.replace(/^#/, ''));
assert.deepEqual(tagPaths(taskFields['file.tags']!).sort(), ['inline', 'inline/one', 'project', 'project/sub'],
	'file.tags includes parent hierarchy');
assert.deepEqual(tagPaths(taskFields['file.etags']!).sort(), ['inline/one', 'project/sub'],
	'file.etags stays exact');

/* ----------------------------- 6. object literal single colon ----------------------------- */

const obj = tableValue('TABLE {a: 1, b: "x"}', bookPages) as { entries: Record<string, DqlValue> };
assert.equal(obj.entries['a'], 1);
assert.equal(obj.entries['b'], 'x');

/* ----------------------------- 7. meta(link) ----------------------------- */

assert.equal(tableValue('TABLE meta(link("b.md")).status', bookPages), 'unread', 'meta resolves target page fields');
assert.equal(tableValue('TABLE meta(link("b")).rating', bookPages), 3, 'meta resolves without .md suffix');

/* ----------------------------- 8. sample shapes still run ----------------------------- */

for (const q of [
	'TABLE file.name, rating WHERE rating >= 4 SORT rating DESC LIMIT 10',
	'LIST FROM #x WHERE contains(file.name, "a")',
	'TASK FROM "journal" WHERE !completed',
	'CALENDAR file.cday',
]) {
	const r = executeDql(q, bookPages);
	assert.ok(r.ok && !r.empty, `sample shape failed: ${q}`);
}
// rows.<field> maps to raw values (spot equality via dqlEquals).
const mv = tableValue('TABLE rows.rating GROUP BY genre', bookPages) as DqlValue[];
assert.ok(dqlEquals(mv[0]!, 5), 'rows.rating maps to values');

console.log('verify-dql: all assertions passed');
