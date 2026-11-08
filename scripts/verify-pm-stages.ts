import { strict as assert } from 'node:assert';
import { parseTasks } from '../src/pipeline-model';
import { renameProjectTask } from '../src/pm-model';
import { FIVE_STAGE_PRESET, FIVE_STAGE_WEIGHTS, pmStagePlan, resolveStageWindows } from '../src/pm-stages';

// ── [group::] parsing round-trip ────────────────────────────────────────────
const content = [
	'## 待办',
	'- [ ] 需求访谈 [group:: 需求] [start:: 2026-10-01] [end:: 2026-10-03] ^t1',
	'- [ ] 概要设计 [group:: 方案] [due:: 2026-10-08]',
	'- [x] 已归档杂事 [group:: 联调]',
	'- [ ] 无分组任务 [end:: 2026-10-20]',
].join('\n');
const tasks = parseTasks(content);
assert.equal(tasks.length, 4);
assert.equal(tasks[0]!.group, '需求', 'group marker is parsed');
assert.equal(tasks[0]!.text, '需求访谈', 'group marker is stripped from display text');
assert.equal(tasks[0]!.start, '2026-10-01');
assert.equal(tasks[1]!.group, '方案');
assert.equal(tasks[3]!.group, undefined, 'tasks without [group::] carry no group');
// Rename keeps the marker verbatim (board edit path).
const renamed = renameProjectTask(content, 2, '概要设计 v2');
assert.match(renamed.split('\n')[2]!, /\[group:: 方案\]/, 'rename preserves the group marker');
assert.match(renamed.split('\n')[2]!, /\[due:: 2026-10-08\]/, 'rename preserves date markers');
assert.match(renamed.split('\n')[2]!, /概要设计 v2/);

// ── pmStagePlan: both frontmatter forms ─────────────────────────────────────
const mapForm = pmStagePlan({
	stagePlan: { 需求: { start: '2026-10-01', end: '2026-10-09' }, UAT: { end: '2026-12-31' } },
});
assert.deepEqual(mapForm['需求'], { start: '2026-10-01', end: '2026-10-09' });
assert.deepEqual(mapForm['UAT'], { end: '2026-12-31' }, 'end-only plan entries survive');
const stringForm = pmStagePlan({ 阶段计划: { SIT: '2026-11-20..2026-12-05', 开发: '2026-10-10' } });
assert.deepEqual(stringForm['SIT'], { start: '2026-11-20', end: '2026-12-05' }, 'compact A..B strings parse');
assert.deepEqual(stringForm['开发'], { start: '2026-10-10' }, 'single date = start-only');
assert.deepEqual(pmStagePlan({ stagePlan: { 坏: { start: 'not-a-date' }, 空: {} } }), {}, 'invalid dates drop silently');
assert.deepEqual(pmStagePlan({ stagePlan: 'nope' }), {}, 'non-object plans parse to empty');

// ── resolveStageWindows priority: tasks > plan > derived ────────────────────
const stages = FIVE_STAGE_PRESET;
assert.equal(stages.length, 5);
assert.equal(FIVE_STAGE_WEIGHTS.reduce((a, b) => a + b, 0), 100);

// 1) Task-tagged spans win over everything else.
const taskWins = resolveStageWindows({
	frontmatter: { cycleStart: '2026-10-01', cycleEnd: '2026-12-31', stagePlan: { 需求: { start: '2026-11-01', end: '2026-11-02' } } },
	tasks: [
		{ line: 0, text: 'a', checked: false, group: '需求', start: '2026-10-01', end: '2026-10-03' },
		{ line: 1, text: 'b', checked: false, group: '需求', end: '2026-10-06' },
	],
}, stages);
const reqWin = taskWins.find(w => w.label === '需求')!;
assert.equal(reqWin.source, 'tasks');
assert.equal(reqWin.start, '2026-10-01', 'window opens at the stage\'s earliest anchor');
assert.equal(reqWin.end, '2026-10-06', 'window closes at the stage\'s latest anchor');
assert.equal(taskWins.find(w => w.label === '方案')!.source, 'derived', 'other stages fall back to the cycle split');

// 2) Plan beats derived when no tasks tag the stage.
const planBeatsDerived = resolveStageWindows({
	frontmatter: { cycleStart: '2026-10-01', cycleEnd: '2026-12-31', stagePlan: { SIT: { start: '2026-11-20', end: '2026-12-05' } } },
	tasks: [],
}, stages);
const sitWin = planBeatsDerived.find(w => w.label === 'SIT')!;
assert.equal(sitWin.source, 'plan');
assert.deepEqual([sitWin.start, sitWin.end], ['2026-11-20', '2026-12-05']);

// 3) Group tags that name no configured stage contribute nothing.
const unknownGroup = resolveStageWindows({
	frontmatter: {},
	tasks: [{ line: 0, text: 'x', checked: false, group: '联调', start: '2026-10-01', end: '2026-10-02' }],
}, stages);
assert.deepEqual(unknownGroup, [], 'unknown group labels are not stage windows');

// ── deriveFromCycle: weighted split via resolveStageWindows ─────────────────
// Cross-month cycle 2026-10-01..2026-12-30 = 91 days; five stages 15/15/40/15/15.
const derived = resolveStageWindows({ frontmatter: { cycleStart: '2026-10-01', cycleEnd: '2026-12-30' }, tasks: [] }, stages);
assert.equal(derived.length, 5);
assert.ok(derived.every(w => w.source === 'derived'));
assert.equal(derived[0]!.start, '2026-10-01', 'first stage opens at cycle start');
assert.equal(derived[4]!.end, '2026-12-30', 'last stage closes at cycle end');
for (let i = 1; i < derived.length; i++) {
	assert.equal(derived[i]!.start, shiftCheck(derived[i - 1]!.end!), `stage ${i} starts the day after stage ${i - 1} ends (no gaps)`);
}
const buildDays = (Date.parse(`${derived[2]!.end!}T12:00:00Z`) - Date.parse(`${derived[2]!.start!}T12:00:00Z`)) / 86_400_000 + 1;
assert.ok(Math.round(buildDays) === 36 || Math.round(buildDays) === 37, `开发 spans ~40% of 91 days (${buildDays}), got ${Math.round(buildDays)}`);
// Single-day cycle: stages that fit clip to the same day; the tail stages
// that no longer fit get nothing (documented deriveFromCycle behavior).
const oneDay = resolveStageWindows({ frontmatter: { cycleStart: '2026-10-01', cycleEnd: '2026-10-01' }, tasks: [] }, stages);
assert.ok(oneDay.length >= 1 && oneDay.length < 5, 'a single day cannot hold five stages');
assert.ok(oneDay.every(w => w.start === '2026-10-01' && w.end === '2026-10-01'));
// No cycle, no plan, no tasks: no windows at all (rail-only project).
assert.deepEqual(resolveStageWindows({ frontmatter: {}, tasks: [] }, stages), [], 'no dates anywhere means no windows');
// Inverted cycle is ignored, not crashed on.
assert.deepEqual(resolveStageWindows({ frontmatter: { cycleStart: '2026-12-01', cycleEnd: '2026-10-01' }, tasks: [] }, stages), []);
// Non-five stage lists split evenly and still tile the cycle.
const threeStages = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
const even = resolveStageWindows({ frontmatter: { cycleStart: '2026-10-01', cycleEnd: '2026-10-30' }, tasks: [] }, threeStages);
assert.equal(even.length, 3);
assert.equal(even[2]!.end, '2026-10-30');

function shiftCheck(day: string): string {
	const next = new Date(`${day}T12:00:00Z`);
	next.setUTCDate(next.getUTCDate() + 1);
	return next.toISOString().slice(0, 10);
}

process.stdout.write('PM stages assertions passed\n');
