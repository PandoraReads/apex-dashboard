/**
 * Verifies the "edit a task in the note editor, close it, the calendar task
 * list catches up" hand-off.
 *
 * The in-dashboard note editor (NotePopoverModal) hosts a real MarkdownView:
 * edits live in memory until it flushes on close, and the surfaces that list
 * that note's tasks (calendar grid cells, the day agenda) painted snapshots
 * taken BEFORE the note opened. The view's vault-event fan-out cannot be
 * relied on: it debounces 500ms behind the write (close-then-look sees the old
 * text) and skips the dashboard file itself by design.
 *
 * 1. The editor reports a CHANGE on close: mtime compared against open time,
 *    reported only after MarkdownView.save() flushed and the leaf detached.
 * 2. The view forces the edited path to be re-read from disk (bypassing the
 *    mtime cache and the lazily-reindexed metadata pre-filter) and repaints
 *    the three snapshot surfaces: sidebar calendar, calendar sections, and any
 *    open day agenda. The `dashboard-calendar-refresh` request reuses the same
 *    helper instead of duplicating it.
 * 3. The day agenda can re-read its day and repaints ONLY when what it shows
 *    changed (a no-op popover open must not flash the dialog).
 * 4. The calendar grid skips the rebuild when its scan matches what is on
 *    screen (the same edit echoes back here twice: our nudge + the debounce).
 *
 * Run: `npm run test:calendar-note-edit-refresh`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { tasksSnapshotSignature, type VaultTask } from '../src/alltasks-scan';

const popoverSrc = readFileSync('src/note-popover-modal.ts', 'utf-8');
const viewSrc = readFileSync('src/view.ts', 'utf-8');
const modalSrc = readFileSync('src/calendar-modal.ts', 'utf-8');
const sectionSrc = readFileSync('src/calendar-section.ts', 'utf-8');

const task = (over: Partial<VaultTask> = {}): VaultTask => ({
	file: {} as VaultTask['file'],
	path: 'notes/day.md',
	line: 3,
	originalLine: '- [ ] Alpha',
	checked: false,
	text: 'Alpha',
	mtime: 1,
	ctime: 1,
	...over,
});

// 1. Signature = what the list SHOWS. A rescan rebuilds every object, so the
//    guard compares visible fields only.
{
	assert.equal(
		tasksSnapshotSignature([task()]),
		tasksSnapshotSignature([task({ mtime: 999, ctime: 999, originalLine: '- [ ] Alpha  ' })]),
		'identity/derived fields do not affect the signature');
	assert.notEqual(
		tasksSnapshotSignature([task()]),
		tasksSnapshotSignature([task({ text: 'Alpha edited' })]),
		'edited text changes the signature (the report: stale text stays)');
	assert.notEqual(
		tasksSnapshotSignature([task()]),
		tasksSnapshotSignature([task({ checked: true })]),
		'checked state changes the signature');
	assert.notEqual(
		tasksSnapshotSignature([task()]),
		tasksSnapshotSignature([task(), task({ line: 4, text: 'Beta' })]),
		'added/removed rows change the signature');
	assert.notEqual(
		tasksSnapshotSignature([task(), task({ line: 4, text: 'Beta' })]),
		tasksSnapshotSignature([task({ line: 4, text: 'Beta' }), task()]),
		'order is part of what is shown (the agenda sinks done tasks)');
}

// 2. Editor close contract.
assert.ok(popoverSrc.includes('private readonly onEdited?: (file: TFile) => void'),
	'popover accepts a change callback');
assert.ok(popoverSrc.includes('private openMtime = 0') && popoverSrc.includes('this.openMtime = this.file.stat.mtime'),
	'open time mtime is recorded');
{
	const closeIdx = popoverSrc.indexOf('\tonClose(): void {');
	assert.ok(closeIdx > 0, 'popover onClose exists');
	const body = popoverSrc.slice(closeIdx, closeIdx + 900);
	assert.ok(body.includes('this.detachLeaf(leaf)') && body.includes('detached.then('),
		'the report waits for the flush + detach');
	assert.ok(body.includes('file.stat.mtime === openedAt'),
		'an unedited note reports nothing');
	assert.ok(body.includes('this.onEdited(file)'),
		'an edited note reports the file');
	assert.ok(body.indexOf('this.detachLeaf(leaf)') < body.indexOf('this.contentEl.empty()'),
		'the flush is kicked off before the modal DOM is torn down');
}

// 3. View wiring: force a disk read, then repaint the snapshot surfaces.
{
	assert.ok(viewSrc.includes("import { refreshOpenDayAgendas } from './calendar-modal';"),
		'view reaches the live day agendas');
	assert.ok(viewSrc.includes("import { invalidatePath } from './alltasks-scan';"),
		'view can force a disk re-read');
	assert.ok(viewSrc.includes('this.onNoteEditedInPopover(edited)'),
		'the popover callback is wired');
	const editIdx = viewSrc.indexOf('private onNoteEditedInPopover(');
	assert.ok(editIdx > 0, 'the close handler exists');
	const edit = viewSrc.slice(editIdx, editIdx + 900);
	assert.ok(edit.includes('invalidatePath(file.path)'),
		'the edited note is re-read from disk (cachedRead lags the write)');
	assert.ok(edit.includes('this.refreshCalendarSurfaces()'),
		'and every task surface is repainted');
	const helperIdx = viewSrc.indexOf('private refreshCalendarSurfaces(');
	assert.ok(helperIdx > 0, 'the shared surface refresher exists');
	const helper = viewSrc.slice(helperIdx, helperIdx + 500);
	assert.ok(helper.includes('this.refreshSidebarCalendarNow()'), 'sidebar calendar dots refresh');
	assert.ok(helper.includes('refreshCalendarSections('), 'embedded calendar grids refresh');
	assert.ok(helper.includes('refreshOpenDayAgendas()'), 'open day agendas refresh');
	// The dashboard-calendar-refresh listener goes through the same helper
	// (added by the day-agenda add flow) instead of duplicating the list.
	const listenIdx = viewSrc.indexOf("addEventListener('dashboard-calendar-refresh'");
	assert.ok(listenIdx > 0 && viewSrc.slice(listenIdx, listenIdx + 300).includes('this.refreshCalendarSurfaces()'),
		'the add-flow request and the editor path share one refresher');
	// An agenda open behind a note edited in a TAB has no popover to report:
	// the vault batch nudges it too.
	assert.ok(viewSrc.includes('refreshOpenDayAgendas();'),
		'day agendas also follow plain vault edits');
}

// 4. Day agenda: registry + re-read + repaint-only-on-change.
assert.ok(modalSrc.includes('const liveAgendas = new Set<DayAgendaModal>()'),
	'open agendas are registered');
assert.ok(modalSrc.includes('export function refreshOpenDayAgendas(): void'),
	'the registry is reachable from outside the module');
assert.ok(modalSrc.includes('liveAgendas.add(this)') && modalSrc.includes('liveAgendas.delete(this)'),
	'agendas register on open and drop out on close');
{
	const refreshIdx = modalSrc.indexOf('async refreshFromVault(): Promise<void>');
	assert.ok(refreshIdx > 0, 'the agenda can re-read its day');
	const body = modalSrc.slice(refreshIdx, refreshIdx + 600);
	assert.ok(body.includes('this.scanDayTasks()'), 'it rescans (open-time snapshot is the stale part)');
	assert.ok(body.includes('this.listSignature(next) === this.listSignature(this.renderedTasks)'),
		'and repaints only when the list actually changed');
	assert.ok(body.includes('this.renderDayList(next)'), 'the repaint goes through the list host');
}
{
	const scanIdx = modalSrc.indexOf('private async scanDayTasks(');
	assert.ok(scanIdx > 0, 'the agenda replicates the scan pipeline');
	const body = modalSrc.slice(scanIdx, scanIdx + 900);
	assert.ok(body.includes('collectVaultTasks('), 'vault scan');
	assert.ok(body.includes('indexTasksByDay('), 'per-day index');
	assert.ok(body.includes('filterTasksByDay('), 'the persisted filter applies');
	assert.ok(body.includes('this.loadDailyNoteTasks()'), 'and the daily-note merge still happens');
	assert.ok(body.includes('settings?.calendarExcludeFolders'), 'excluded folders are honored');
}
{
	// The repaint is scoped to the rows host: the add-task inputs above must
	// survive a refresh (typing/half-typed state).
	const idx = modalSrc.indexOf('private renderDayList(');
	assert.ok(idx > 0, 'renderDayList exists');
	const body = modalSrc.slice(idx, idx + 700);
	assert.ok(body.includes('this.listHost'), 'it paints into the dedicated host');
	assert.ok(!body.includes('titleInput'), 'the add-task row is outside the repaint');
	assert.ok(modalSrc.includes("this.listHost = body.createDiv({ cls: 'dashboard-cal-day-list' })"),
		'onOpen owns the host element');
}

// 5. Calendar grid: skip the rebuild when the scan matches the painted grid.
{
	assert.ok(sectionSrc.includes('let renderedSignature = \'\''), 'the grid tracks its painted signature');
	assert.ok(sectionSrc.includes('function scanSignature(): string'), 'scan signature helper exists');
	const renderIdx = sectionSrc.indexOf('function renderGrid(): void {');
	const renderEnd = sectionSrc.indexOf('/** Navigate by one month', renderIdx);
	assert.ok(renderIdx > 0 && renderEnd > renderIdx, 'renderGrid exists');
	const render = sectionSrc.slice(renderIdx, renderEnd);
	assert.ok(render.includes('renderedSignature = scanSignature()'),
		'every paint records what it shows');
	const reloadIdx = sectionSrc.indexOf('async function reloadInPlace(');
	const reload = sectionSrc.slice(reloadIdx, reloadIdx + 700);
	assert.ok(reload.includes('if (scanSignature() === renderedSignature) return'),
		'a no-op rescan does not repaint (double nudge for one edit)');
	assert.ok(reload.indexOf('rescan()') < reload.indexOf('scanSignature()'),
		'the comparison uses the FRESH scan');
}

console.log('verify-calendar-note-edit-refresh: OK');
