/**
 * Verifies the "completing a task flickers the UI" fix:
 *
 * Todo cards used to route EVERY checkbox toggle through the notify echo
 * (writeToDisk → notifyCallbacks → refreshSectionInPlace), rebuilding the
 * whole section node per check; the calendar section stacked an optimistic
 * renderGrid with the agenda's onTaskWritten reload AND the broadcast-driven
 * reload (3+ back-to-back grid rebuilds); the day agenda rebuilt its whole
 * dialog per check.
 *
 * 1. Todo cards: the renderer mirrors the toggle into the DOM (cascades,
 *    ancestor recalc, completion-behavior reorder, path re-stamping) and
 *    persists through a QUIET sync path that never notifies. Daily-linked
 *    cards (note = source of truth) keep the loud path.
 * 2. Calendar section: all staleness nudges coalesce into ONE rescan +
 *    re-render (scheduleGridRefresh).
 * 3. Day agenda: in-place row update + row re-ordering; the broadcast nudge
 *    fires only for the dashboard-file blind spot.
 *
 * Run: `npm run test:task-toggle-quiet`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { readTaskPath } from '../src/renderer';

const syncSrc = readFileSync('src/sync.ts', 'utf-8');
const rendererSrc = readFileSync('src/renderer.ts', 'utf-8');
const viewSrc = readFileSync('src/view.ts', 'utf-8');
const sectionSrc = readFileSync('src/calendar-section.ts', 'utf-8');
const modalSrc = readFileSync('src/calendar-modal.ts', 'utf-8');
const typesSrc = readFileSync('src/types.ts', 'utf-8');

// 1. Sync: shared mutation + quiet path that writes WITHOUT the notify echo.
assert.ok(syncSrc.includes('private applyTaskToggle('),
	'toggle mutation extracted so both paths share one implementation');
{
	const quietIdx = syncSrc.indexOf('toggleTaskQuiet(cardId: string, taskPath: TaskPath, checked: boolean): void {');
	assert.ok(quietIdx > 0, 'quiet toggle exists');
	const body = syncSrc.slice(quietIdx, quietIdx + 1500);
	assert.ok(body.includes('writeToDisk(true)'), 'quiet toggle writes silently');
	const mirrorAt = body.indexOf('await this.mirrorTasksToDaily(cardId)');
	const writeAt = body.indexOf('await this.writeToDisk(true)');
	assert.ok(mirrorAt > 0 && writeAt > mirrorAt,
		'daily-linked cards mirror BEFORE the silent write (its vault event triggers the read-back)');
	assert.ok(!body.includes('notifyCallbacks'), 'quiet toggle never notifies');
}

// 2. Renderer: in-place mirror for EVERY card. The mirror must re-stamp task
//    paths after a behavior reorder (edit/drag handlers are path-keyed).
assert.ok(rendererSrc.includes('function mirrorTaskToggleInPlace('),
	'renderer hosts the in-place toggle mirror');
assert.ok(!rendererSrc.includes('card.tasksFromDaily === true'),
	'daily-linked cards no longer keep a loud toggle branch (its notify echo rebuilt the section per check — the flicker)');
assert.ok(!/callbacks\.onCheckboxToggle\(/.test(rendererSrc),
	'the loud checkbox callback is gone from the renderer');
assert.ok(rendererSrc.includes('callbacks.onCheckboxToggleQuiet('),
	'every toggle routes through the quiet callback');
assert.ok(rendererSrc.includes("row.dataset.taskPath = JSON.stringify(p.length === 1 ? [top] : [top, ...p.slice(1)])"),
	'mirror re-stamps shifted task paths');
assert.ok(rendererSrc.includes("'dashboard-task-text--done'"),
	'mirror updates the done styling in place');

// 3. View wiring: the quiet callback routes to the quiet sync method.
assert.ok(viewSrc.includes('onCheckboxToggleQuiet: (cardId: string, taskPath: number[], checked: boolean) => this.sync.toggleTaskQuiet('),
	'view wires the quiet callback');
assert.ok(!viewSrc.includes('onCheckboxToggle:'),
	'view no longer wires a loud checkbox callback');
assert.ok(typesSrc.includes('onCheckboxToggleQuiet(cardId: string, taskPath: number[], checked: boolean): void;'),
	'quiet callback is the checkbox callback on RenderCallbacks');
assert.ok(!typesSrc.includes('onCheckboxToggle(cardId'),
	'the loud callback declaration is removed');

// 3b. Silent writes must still hand the NEW data graph to the view. Skipping
//     the callback entirely left view.data on a superseded object, so the
//     daily-linked signature compared stale-vs-stale and never re-rendered
//     (the "edited the note, card never followed" bug).
{
	const updateSrc = readFileSync('src/render-update.ts', 'utf-8');
	const silentIdx = syncSrc.indexOf('this.notifyCallbacks(\'local-silent\')');
	assert.ok(silentIdx > 0, 'silent writes notify with the local-silent source');
	assert.ok(updateSrc.includes("'local-silent'"), 'the source is part of DashboardUpdateSource');
	assert.ok(/if \(!silent\) \{\s*this\.notifyCallbacks\('local'\);\s*\} else \{/.test(syncSrc),
		'silent writes take the else branch instead of skipping the callback');
	// The view adopts data (assigned above the branch) and returns without painting.
	const adoptIdx = viewSrc.indexOf("if (source === 'local-silent') return;");
	assert.ok(adoptIdx > 0, 'view adopts silent data without rendering');
	assert.ok(adoptIdx > viewSrc.indexOf('this.data = data;'), 'adoption happens after the data swap');
	assert.ok(adoptIdx < viewSrc.indexOf('if (this.suppressNextRender) {'),
		'silent adoption runs BEFORE the one-shot suppression check (must not consume it)');
	assert.ok(updateSrc.includes("if (source === 'local-silent') return { kind: 'none' };"),
		'planDashboardUpdate never schedules a render for silent updates');
}

// 4. Calendar section: coalesced refresh — every nudge funnels into ONE timer.
assert.ok(sectionSrc.includes('function scheduleGridRefresh(): void'),
	'section hosts the coalescing scheduler');
assert.ok(sectionSrc.includes('window.clearTimeout(gridRefreshTimer)'),
	'pending refreshes coalesce instead of stacking');
{
	const toggles = sectionSrc.split('scheduleGridRefresh()').length - 1;
	// onToggle + the two agenda onTaskWritten handlers.
	assert.ok(toggles >= 3, `onToggle and both onTaskWritten handlers use it (found ${toggles})`);
}
assert.ok(!/task\.checked = nextChecked;\s*\r?\n\s*renderGrid\(\)/.test(sectionSrc),
	'onToggle no longer renders the grid immediately');

// 5. Day agenda: in-place row update, no per-check dialog rebuild.
assert.ok(modalSrc.includes('private rowByTask = new Map<VaultTask, HTMLElement>()'),
	'agenda keeps a row registry');
assert.ok(modalSrc.includes('private renderedTasks: VaultTask[] = []'),
	'agenda tracks the rendered list (merged note tasks included)');
{
	// CalendarMonthModal has an identically-signed toggle; anchor the search
	// inside the DayAgendaModal class.
	const classIdx = modalSrc.indexOf('export class DayAgendaModal');
	const toggleIdx = modalSrc.indexOf('private async toggle(task: VaultTask, nextChecked: boolean): Promise<void> {', classIdx);
	assert.ok(toggleIdx > 0, 'agenda toggle exists');
	const body = modalSrc.slice(toggleIdx, toggleIdx + 2200);
	assert.ok(!body.includes('this.onOpen()'), 'toggle no longer rebuilds the dialog');
	assert.ok(body.includes("row.toggleClass('is-done', nextChecked)"), 'row state flips in place');
	assert.ok(body.includes("row.querySelector<HTMLInputElement>('input[type=\"checkbox\"]')"),
		'toggle mirrors the checked state onto the checkbox input (the click handler preventDefaults the native flip)');
	assert.ok(body.includes('for (const t of [...this.renderedTasks].sort(byDayTaskTime(this.iso)))'),
		'rows re-order to the agenda sort (done tasks sink)');
	// The broadcast nudge is gated to the dashboard-file blind spot.
	assert.ok(body.includes("task.path.replace(/\\.md$/i, '') === this.dashboardFile.replace(/\\.md$/i, '')"),
		'broadcast fires only for dashboard-file tasks (vault events cover the rest)');
}

// 6. Task paths are resolved at CLICK time.
//
// Completing a top-level task reorders the list (completion behavior) and the
// in-place mirror re-stamps every row's data-task-path instead of re-rendering.
// A handler that kept the array it was rendered with therefore pointed at
// whatever task now occupied that slot: a few clicks in a row toggled the WRONG
// notes, and the wrong checkboxes got written to disk.
assert.ok(rendererSrc.includes('export function readTaskPath(row: HTMLElement, fallback: readonly number[])'),
	'the renderer exposes a live path reader');
assert.ok(rendererSrc.includes('const currentPath = (): number[] => readTaskPath(item, initialPath);'),
	'every task row resolves its path through the live reader');
assert.ok(!/callbacks\.onCheckboxToggleQuiet\(card\.id, path,/.test(rendererSrc),
	'the checkbox no longer passes the render-time path');
assert.ok(!/callbacks\.onTaskEdit\(card\.id, path,/.test(rendererSrc)
	&& !/callbacks\.onTaskDelete\(card\.id, path\)/.test(rendererSrc)
	&& !/callbacks\.onTaskToggleCollapse\(card\.id, path\)/.test(rendererSrc),
	'edit / delete / collapse read the current path too (all are path-keyed)');
assert.ok(rendererSrc.includes('const toggledPath = currentPath();'),
	'the toggle resolves ONE path per click so the DOM reorder and the model update agree');
assert.ok(rendererSrc.includes('pathOf: () => number[],'),
	'the reminder button takes a getter instead of a frozen path');

// 7. The quiet persist is QUEUED: the daily mirror is a read-modify-write of
//    today's note, and two overlapping toggles could otherwise let the later
//    click write the EARLIER task list back into the note (the source of truth
//    for daily-linked cards), which then reads back into the card as scrambled
//    checks.
assert.ok(syncSrc.includes('private taskPersistQueue: Promise<void> = Promise.resolve();'),
	'the engine serialises quiet task persists');
{
	const idx = syncSrc.indexOf('toggleTaskQuiet(cardId: string, taskPath: TaskPath, checked: boolean): void {');
	assert.ok(idx > 0, 'quiet toggle exists');
	const body = syncSrc.slice(idx, idx + 1200);
	assert.ok(body.includes('this.taskPersistQueue = this.taskPersistQueue'),
		'the persist is chained on that queue instead of fired off');
	assert.ok(body.indexOf('applyTaskToggle') < body.indexOf('this.taskPersistQueue'),
		'the model still updates synchronously — only the note write is queued');
}

// 8. Behaviour of the reader itself (a re-stamped row wins over the stale array).
{
	const row = { dataset: { taskPath: '[2]' } } as unknown as HTMLElement;
	assert.deepEqual(readTaskPath(row, [0]), [2], 'the re-stamped DOM path wins');
	const blank = { dataset: {} } as unknown as HTMLElement;
	assert.deepEqual(readTaskPath(blank, [1, 3]), [1, 3], 'no stamp falls back to the render-time path');
	const broken = { dataset: { taskPath: 'not json' } } as unknown as HTMLElement;
	assert.deepEqual(readTaskPath(broken, [0, 1]), [0, 1], 'a malformed stamp cannot break a click');
	const empty = { dataset: { taskPath: '[]' } } as unknown as HTMLElement;
	assert.deepEqual(readTaskPath(empty, [4]), [4], 'an empty stamp is not a valid task path');
}

console.log('verify-task-toggle-quiet: OK');
