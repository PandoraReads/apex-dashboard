import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { App, Modal } from 'obsidian';
import { renderGanttChart, type GanttGroup } from '../src/pm-gantt-chart';
import { PmScheduleModal } from '../src/pm-schedule-modal';
import { FIVE_STAGE_PRESET } from '../src/pm-stages';
import { setLanguage } from '../src/i18n';
setLanguage('zh');
const body = new El('body');
(globalThis as Record<string, unknown>).activeDocument = { body, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} };
const changes: unknown[] = [];
const kindChanges: unknown[] = [];
const group: GanttGroup = { key: 'A', title: 'A', file: { path: 'Projects/A.md' } as never, cycleStart: '2026-10-21', cycleEnd: '2026-10-25', onOpen: () => {}, onAdd: milestone => changes.push({ add: milestone }), rows: [
 { task: { line: 1, text: '编写', checked: false, start: '2026-10-21', end: '2026-10-23', id: 'one' }, milestone: false, save: async p => { changes.push(p); }, toggle: async () => { changes.push('todo-toggle'); } },
 { task: { line: 2, text: '发布', checked: true, end: '2026-10-25' }, milestone: true, save: async () => {} },
 { task: { line: 3, text: '未排期', checked: false }, milestone: false, save: async () => {} },
] };
const host = new El('div');
renderGanttChart(host as never, {} as App, [group], 'day', ['gantt-open::A::todos', 'gantt-open::A::milestones'], key => changes.push(key), 'all', undefined, (key, filter) => kindChanges.push({ key, filter }));
assert.equal(findByClass(host, 'dashboard-gantt-task').length, 3);
assert.equal(findByClass(host, 'dashboard-gantt-unscheduled').length, 1);
assert.equal(findByClass(host, 'dashboard-gantt-subgroup').length, 0, 'default todo and milestone headers are omitted from expanded lists');
assert(findByClass(host, 'dashboard-gantt-axis-week-band').length > 0, 'date axis is divided into repeating weekly color bands');
assert.equal(findByClass(host, 'dashboard-gantt-task-checkbox').length, 2, 'todo rows expose completion checkboxes');
assert.equal(findByClass(host, 'dashboard-gantt-milestone-icon').length, 1, 'milestone rows expose a dedicated icon');
assert.equal(findByClass(host, 'dashboard-gantt-kind-card').length, 2, 'project navigation has milestone and todo cards');
assert.equal(findByClass(host, 'dashboard-gantt-kind-add').length, 2, 'each kind card has its own add button');
assert.equal(findByClass(host, 'dashboard-gantt-source').length, 0, 'project paths are omitted from the navigation card');
findByClass(host, 'dashboard-gantt-kind-toggle')[0]!.dispatchEvent({ type: 'click' });
assert.deepEqual(kindChanges[0], { key: 'gantt-open::A::milestones', filter: 'milestones' });
const todoCheckbox = findByClass(host, 'dashboard-gantt-task-checkbox')[0]!;
todoCheckbox.checked = true;
todoCheckbox.dispatchEvent({ type: 'change' });
assert.equal(changes[0], 'todo-toggle', 'todo checkbox invokes its persistence callback');
const initiallyCollapsed = new El('div');
renderGanttChart(initiallyCollapsed as never, {} as App, [group], 'day', [], () => {});
assert.equal(findByClass(initiallyCollapsed, 'dashboard-gantt-task').length, 0, 'kind lists start collapsed in the all view');
const crossWeek = new El('div');
const crossWeekGroup: GanttGroup = { ...group, rows: [
	{ task: { line: 4, text: '跨周任务', checked: false, start: '2026-10-25', end: '2026-11-02' }, milestone: false, save: async () => {} },
] };
renderGanttChart(crossWeek as never, {} as App, [crossWeekGroup], 'day', ['gantt-open::A::todos'], () => {});
const crossWeekTaskBar = findByClass(crossWeek, 'dashboard-gantt-bar').find(bar => bar.getAttribute('title')?.startsWith('跨周任务'))!;
const weeklySegments = findByClass(crossWeekTaskBar, 'dashboard-gantt-week-segment');
assert.equal(weeklySegments.length, 3, 'a task spanning three calendar weeks renders three color blocks');
assert.equal(new Set(weeklySegments.map(segment => segment.className.split(' ').find(name => /^dashboard-gantt-week-[0-5]$/.test(name)))).size, 3, 'adjacent weeks use distinct colors');
const projectOnly = new El('div');
renderGanttChart(projectOnly as never, {} as App, [group], 'day', [], () => {}, 'projects');
assert.equal(findByClass(projectOnly, 'dashboard-gantt-task').length, 0, 'project filter hides task rows');
assert(findByClass(projectOnly, 'dashboard-gantt-bar').some(bar => bar.hasClass('is-cycle')), 'project filter keeps the project cycle bar');
const todosOnly = new El('div');
renderGanttChart(todosOnly as never, {} as App, [group], 'day', [], () => {}, 'todos');
assert.equal(findByClass(todosOnly, 'dashboard-gantt-task').length, 2, 'todo filter shows only todo rows, including unscheduled todos');
assert.equal(findByClass(todosOnly, 'dashboard-gantt-task').filter(task => task.textContent.includes('发布')).length, 0);
const milestonesOnly = new El('div');
renderGanttChart(milestonesOnly as never, {} as App, [group], 'day', [], () => {}, 'milestones');
assert.equal(findByClass(milestonesOnly, 'dashboard-gantt-task').length, 1, 'milestone filter shows only milestone rows');
assert(milestonesOnly.textContent.includes('发布'));
const bar = findByClass(host, 'dashboard-gantt-edge--start')[0]!.parentElement!;
bar.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 100 });
const shield = findByClass(body, 'dashboard-drag-shield')[0]!;
shield.dispatchEvent({ type: 'pointermove', clientX: 160 });
shield.dispatchEvent({ type: 'pointerup', clientX: 160 });
assert.deepEqual(changes[1], { start: '2026-10-23', end: '2026-10-25' });
bar.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 100 });
const cancelledShield = findByClass(body, 'dashboard-drag-shield')[0]!;
cancelledShield.dispatchEvent({ type: 'pointermove', clientX: 130 });
cancelledShield.dispatchEvent({ type: 'pointercancel' });
assert.equal((bar as unknown as { cssProps?: Record<string, string> }).cssProps?.transform, '', 'cancelled drags must restore the original position');
assert.equal(changes.length, 2, 'cancelled drags must not save');
const folded = new El('div');
renderGanttChart(folded as never, {} as App, [group], 'week', ['A'], () => {});
assert.equal(findByClass(folded, 'dashboard-gantt-task').length, 0);
assert(findByClass(folded, 'dashboard-gantt-bar').length >= 3);
const modal = new PmScheduleModal({} as App, { line: 1, text: '旧节点', checked: false, due: '2026-10-25', deadline: '2026-10-25' }, true, async p => { changes.push(p); });
modal.onOpen();
const el = modal.contentEl as unknown as El;
const rows = findByClass(el, 'dashboard-gantt-date-row');
assert.equal((rows[1]!.children[1] as El).value, '2026-10-25T00:00');
assert.equal((rows[0] as unknown as { hidden: boolean }).hidden, true);
const save = findByClass(el, 'dashboard-modal-btn--confirm')[0]!;
save.dispatchEvent({ type: 'click' });
assert.deepEqual(changes[2], { end: '2026-10-25' });
const midnight = new PmScheduleModal({} as App, { line: 2, text: '节点', checked: false, deadline: '2026-10-25 00:00', due: '2026-10-25 00:00' }, false, async p => { changes.push(p); });
midnight.onOpen();
const midnightEl = midnight.contentEl as unknown as El;
(findByClass(midnightEl, 'dashboard-gantt-date-row')[1]!.children[1] as El).value = '2026-10-26T00:00';
findByClass(midnightEl, 'dashboard-modal-btn--confirm')[0]!.dispatchEvent({ type: 'click' });
assert.deepEqual(changes[3], { end: '2026-10-26' });
// ── Five-stage rail + band + click-to-locate ───────────────────────────────
const stageList = FIVE_STAGE_PRESET;
const stageGroup: GanttGroup = { ...group, key: 'S', stage: '开发',
	stageWindows: [
		{ label: '需求', start: '2026-10-21', end: '2026-10-23', source: 'tasks' },
		{ label: '方案', start: '2026-10-24', end: '2026-10-25', source: 'plan' },
		{ label: '开发', start: '2026-10-26', end: '2026-10-30', source: 'derived' },
	],
	rows: [
		{ task: { line: 5, text: 'r1', checked: false, group: '需求', start: '2026-10-21', end: '2026-10-22' }, milestone: false, group: '需求', save: async () => {} },
		{ task: { line: 6, text: 'r2', checked: false, group: '开发', start: '2026-10-26', end: '2026-10-27' }, milestone: false, group: '开发', save: async () => {} },
		{ task: { line: 7, text: 'r3', checked: false }, milestone: false, save: async () => {} },
	] };
const stageHost = new El('div');
renderGanttChart(stageHost as never, {} as App, [stageGroup], 'day', ['gantt-open::S::todos', 'gantt-open::S::milestones'], () => {}, 'all', undefined, undefined, stageList);
const railSegs = findByClass(stageHost, 'dashboard-gantt-stage-rail-seg');
assert.equal(railSegs.length, 5, 'rail renders one segment per configured stage');
assert.ok(railSegs[2]!.hasClass('is-now') && railSegs[2]!.textContent.includes('开发'), 'rail marks the current stage');
assert.equal(railSegs.filter(seg => seg.hasClass('is-past')).length, 2, 'stages before the current one are filled');
assert.ok(railSegs[4]!.textContent.includes('UAT'), 'rail segments carry their stage label');
const stagerow = findByClass(stageHost, 'dashboard-gantt-stagerow');
assert.equal(stagerow.length, 1, 'the stage band renders its own row under the project row');
const bandSegs = findByClass(stageHost, 'dashboard-gantt-stage-seg');
assert.equal(bandSegs.length, 3, 'one band segment per resolved stage window');
assert.equal(bandSegs.filter(seg => seg.hasClass('is-derived')).length, 1, 'derived windows carry the estimate style');
assert.ok(bandSegs[0]!.textContent.includes('需求'), 'band segments carry their stage label');
// Click-to-locate: pop this stage's rows, dim the project's other grouped rows.
bandSegs[0]!.click();
assert.equal(findByClass(stageHost, 'is-stage-hit').length, 2, 'the stage subgroup header and its task row light up');
assert.equal(findByClass(stageHost, 'is-stage-dim').length, 2, 'other stage rows dim');
assert.ok(bandSegs[0]!.classList.contains('is-focus'), 'the clicked segment keeps a focus ring');
// Click the same segment again to cancel.
bandSegs[0]!.click();
assert.equal(findByClass(stageHost, 'is-stage-hit').length, 0, 'second click cancels the focus');
assert.equal(findByClass(stageHost, 'is-stage-dim').length, 0);
// Clicking outside any segment also clears.
const devSeg = bandSegs[2]!;
devSeg.click();
assert.equal(findByClass(stageHost, 'is-stage-hit').length, 2, '开发 lights up (subgroup header + its task row)');
assert.equal(findByClass(stageHost, 'is-stage-dim').length, 2, 'the 需求 rows dim instead');
// A stage window with no tagged rows focuses cleanly (nothing pops, nothing dims).
const planSeg = bandSegs[1]!;
planSeg.click();
assert.equal(findByClass(stageHost, 'is-stage-hit').length, 0, '方案 has no tagged rows to pop');
findByClass(stageHost, 'dashboard-gantt-axis')[0]!.click();
assert.equal(findByClass(stageHost, 'is-stage-hit').length, 0, 'clicking elsewhere clears the stage focus');
// The band is projects/all only, and stageList gates rail + band entirely.
const todosStageHost = new El('div');
renderGanttChart(todosStageHost as never, {} as App, [stageGroup], 'day', [], () => {}, 'todos', undefined, undefined, stageList);
assert.equal(findByClass(todosStageHost, 'dashboard-gantt-stagerow').length, 0, 'no stage band in the todos filter');
const noStageListHost = new El('div');
renderGanttChart(noStageListHost as never, {} as App, [stageGroup], 'day', [], () => {}, 'all');
assert.equal(findByClass(noStageListHost, 'dashboard-gantt-stage-rail').length, 0, 'no rail without a stage list');
assert.equal(findByClass(noStageListHost, 'dashboard-gantt-stagerow').length, 0, 'no band without a stage list');

process.stdout.write('Gantt UI assertions passed\n');
