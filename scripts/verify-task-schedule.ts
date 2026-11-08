/**
 * Verifies the todo card's schedule markers (deadline 📅 / scheduled ⏳ with
 * the optional ⏰ alarm):
 *
 * 1. Parser round-trip: a task carrying all three markers plus collapsed
 *    survives serialize → parse → serialize byte-identical, with the marker
 *    emojis stripped from the displayed text.
 * 2. Parsing real-world file forms: Tasks-plugin mid-line 📅 (trailing tags
 *    stay in the text), date-only ⏰ (no time part), and each marker alone.
 * 3. Calendar interop: scanFileTasks folds the emoji markers exactly as the
 *    popup writes them — 📅 is the due day, ⏳ the scheduled day, an explicit
 *    📅 deadline is not shadowed by an earlier ⏰ alarm, and a ⏳+⏰ pair is
 *    one planned day (no phantom due day).
 * 4. Card UI: the alarm button reflects the strongest marker (bell-ring /
 *    calendar-clock / hourglass), overdue deadline pulses, and the popup's
 *    time row + mode dropdown edit one marker at a time — Save/Clear emit
 *    patches carrying only the active mode's key; choosing a time adds the
 *    ⏰ alarm on the same day, "no time" writes none.
 *
 * Run: `npm run test:task-schedule`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import { parse, serialize } from '../src/parser';
import { scanFileTasks } from '../src/alltasks-scan';
import { serializeTasksForNote } from '../src/task-tree';
import { renderSection } from '../src/renderer';
import type { DashboardCard, DashboardColumn, RenderCallbacks, TaskSchedulePatch } from '../src/types';

// ---------- 1. Parser round-trip ----------

const md = (taskLine: string): string => [
	'---',
	'columns:',
	'  - name: 待办',
	'---',
	'',
	'## 待办',
	'',
	'### 卡片',
	'id: c1',
	'',
	taskLine,
].join('\n');

const taskOf = (markdown: string) => parse(markdown).columns[0]!.cards[0]!.tasks[0]!;

// All three markers + collapsed: serialize is idempotent and keeps the marker
// order 📅 → ⏳ → ⏰ → <!--collapsed-->.
{
	const line = '- [ ] 发布文章 📅 2026-11-10 ⏳ 2026-11-08 ⏰ 2026-11-08 09:30 <!--collapsed-->';
	const once = serialize(parse(md(line)));
	assert.ok(once.includes(line), '1a: full-marker line round-trips verbatim');
	assert.equal(serialize(parse(once)), once, '1b: serialize idempotent');
	const t = taskOf(md(line));
	assert.equal(t.text, '发布文章', '1c: marker emojis stripped from text');
	assert.equal(t.dueDate, '2026-11-10', '1d: dueDate parsed');
	assert.equal(t.scheduledDate, '2026-11-08', '1e: scheduledDate parsed');
	assert.equal(t.reminder, '2026-11-08 09:30', '1f: reminder parsed with time');
	assert.equal(t.collapsed, true, '1g: collapsed survives alongside markers');
}

// ---------- 2. Real-world file forms ----------

// Tasks-plugin style: 📅 mid-line with a trailing tag. The emoji moves to the
// end on next save; the tag stays part of the text.
{
	const t = taskOf(md('- [ ] Fix login 📅 2026-11-12 #bug'));
	assert.equal(t.dueDate, '2026-11-12', '2a: mid-line 📅 parsed');
	assert.equal(t.text, 'Fix login #bug', '2b: tag kept, emoji stripped');
}

// Date-only ⏰ (calendar anchors a day without a time): parses as reminder
// without a time part instead of leaking into the card text.
{
	const t = taskOf(md('- [ ] 纯日期 ⏰ 2026-11-09'));
	assert.equal(t.reminder, '2026-11-09', '2c: date-only ⏰ parsed');
	assert.equal(t.text, '纯日期', '2d: date-only ⏰ stripped from text');
}

// Scheduled alone, checked task, subtask markers — all independent.
{
	const t = taskOf(md('- [x] 已完成 ⏳ 2026-11-05'));
	assert.equal(t.scheduledDate, '2026-11-05', '2e: scheduled parsed on done task');
	assert.ok(serialize(parse(md('- [x] 已完成 ⏳ 2026-11-05'))).includes('- [x] 已完成 ⏳ 2026-11-05'), '2f: checked round-trip');
}

// Daily-note export keeps all markers so archived tasks stay on the calendar.
{
	const out = serializeTasksForNote([{ text: '导出', checked: false, dueDate: '2026-11-10', scheduledDate: '2026-11-08', reminder: '2026-11-08 09:30' }]);
	assert.equal(out, '- [ ] 导出 📅 2026-11-10 ⏳ 2026-11-08 ⏰ 2026-11-08 09:30', '2g: note export carries all markers');
}

// ---------- 3. Calendar interop (scanFileTasks) ----------

const scanOne = (line: string) => {
	const f = Object.assign(new TFile(), { path: 'x.md', stat: { mtime: 1, ctime: 1 } }) as TFile;
	return scanFileTasks(f, `${line}\n`)[0]!;
};

{
	const v = scanOne('- [ ] t 📅 2026-11-10 ⏳ 2026-11-08');
	assert.equal(v.due, '2026-11-10', '3a: 📅 feeds the due day');
	assert.equal(v.scheduled, '2026-11-08', '3b: ⏳ feeds the scheduled day');
	// Both markers set (writer order: emoji dates first, ⏰ last): the
	// explicit deadline wins over the earlier alarm for the due day.
	const both = scanOne('- [ ] t 📅 2026-11-10 ⏰ 2026-11-08 09:00');
	assert.equal(both.due, '2026-11-10', '3c: explicit 📅 beats ⏰ for due');
	assert.equal(both.reminder, '2026-11-08 09:00', '3d: ⏰ still kept as reminder');
	assert.equal(both.time, '09:00', '3e: ⏰ hour still feeds the week grid');
	// Alarm-only tasks keep the historical fold into due.
	const alarmOnly = scanOne('- [ ] t ⏰ 2026-11-08 09:00');
	assert.equal(alarmOnly.due, '2026-11-08', '3f: ⏰-only still anchors due');
	// A ⏳+⏰ pair is one planned day with an alarm — no phantom due day.
	const pair = scanOne('- [ ] t ⏳ 2026-11-08 ⏰ 2026-11-08 09:00');
	assert.equal(pair.scheduled, '2026-11-08', '3g: ⏳ feeds the scheduled day');
	assert.equal(pair.due, undefined, '3h: ⏳+⏰ pair claims no due day');
	assert.equal(pair.reminder, '2026-11-08 09:00', '3i: ⏰ kept as the alarm');
	assert.equal(pair.time, '09:00', '3j: alarm hour feeds the week grid');
}

// ---------- 4. Card UI (button states + popup mode switcher) ----------

const stubBody = new El('body');
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	// Only the popup-close sweep needs this; back it with the real body tree.
	querySelectorAll: (sel: string) =>
		sel === '.dashboard-task-reminder-popup' ? findByClass(stubBody, 'dashboard-task-reminder-popup') : [],
	addEventListener: () => {},
	removeEventListener: () => {},
	body: stubBody,
};
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as unknown as Record<string, unknown>).addEventListener = (() => {}) as unknown as typeof addEventListener;
(globalThis as unknown as Record<string, unknown>).removeEventListener = (() => {}) as unknown as typeof removeEventListener;
(globalThis as unknown as { createDiv: unknown }).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
(globalThis as unknown as { createEl: unknown }).createEl = (tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): El => {
	const el = new El(tag);
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
	return el;
};

const app = {
	vault: { getFileByPath: () => null, getMarkdownFiles: () => [] },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App;

const makeCard = (tasks: DashboardCard['tasks']): DashboardCard =>
	({
		id: 'c1',
		type: 'task',
		column: '待办',
		title: '卡片',
		body: '',
		tasks,
		docs: [],
		url: '',
		wikiLink: '',
		progress: 0,
		streak: 0,
		dueDate: '',
		blockquote: '',
		color: '',
		coverImage: '',
		width: 0,
		size: 'M',
		gridCols: 0,
		gridRows: 0,
		gridCol: 0,
		gridRow: 0,
	} as unknown as DashboardCard);

const renderTaskCard = (tasks: DashboardCard['tasks']): El =>
	renderSection(
		{ id: 'col1', name: '待办', sectionType: 'memo', cards: [makeCard(tasks)] } as unknown as DashboardColumn,
		{} as RenderCallbacks,
		app,
	) as unknown as El;

/** The reminder button of the first task row. */
const reminderBtnOf = (section: El): El =>
	findByClass(section, 'dashboard-task-reminder-btn')[0]!;

/** The one open popup on the stub body. */
const popupOf = (): El => {
	const popups = findByClass(stubBody, 'dashboard-task-reminder-popup');
	assert.equal(popups.length, 1, 'exactly one popup open');
	return popups[0]!;
};

/** [hour, minute, mode] selects of the popup's time row. */
const timeSelects = (popup: El): El[] => findTag(findByClass(popup, 'dashboard-task-reminder-time')[0]!, 'select');

/** Set a select's value and fire its change listener (mini-dom has no live
 *  option binding; the renderer seeds `.value` the same way). */
const pick = (sel: El, value: string): void => {
	(sel as unknown as { value: string }).value = value;
	(sel as unknown as { dispatchEvent: (ev: { type: string }) => boolean }).dispatchEvent({ type: 'change' });
};

{
	// 4a. An alarm wins the icon; deadline-only shows calendar-clock;
	// scheduled-only shows hourglass; no marker keeps the plain bell.
	const both = reminderBtnOf(renderTaskCard([{ text: 'A', checked: false, reminder: '2026-11-08 09:00', dueDate: '2026-11-10' }]));
	assert.ok(both.hasClass('dashboard-task-reminder-btn--active'), '4a: markers set → active');
	assert.equal(both.dataset.icon, 'bell-ring', '4b: reminder wins the icon');
	assert.equal(reminderBtnOf(renderTaskCard([{ text: 'B', checked: false, dueDate: '2026-11-10' }])).dataset.icon, 'calendar-clock', '4c: deadline-only → calendar-clock');
	assert.equal(reminderBtnOf(renderTaskCard([{ text: 'B2', checked: false, scheduledDate: '2026-11-08' }])).dataset.icon, 'hourglass', '4d: scheduled-only → hourglass');
	const none = reminderBtnOf(renderTaskCard([{ text: 'C', checked: false }]));
	assert.ok(!none.hasClass('dashboard-task-reminder-btn--active'), '4e: no marker → idle bell');
	assert.equal(none.dataset.icon, 'bell', '4f: plain bell when nothing set');
}

// 4d-4l. Popup flow: open on a deadline task → dropdown preselects 截止 with
// the alarm time seeded; switch the dropdown → selection jumps to that mode's
// day; save patches only that mode's key (the other mode's alarm survives);
// clear removes the mode's marker together with its own alarm.
{
	const patches: TaskSchedulePatch[] = [];
	const callbacks = {
		onTaskScheduleEdit: (_cardId: string, _path: number[], patch: TaskSchedulePatch) => { patches.push(patch); },
	} as unknown as RenderCallbacks;
	const section = renderSection(
		{ id: 'col1', name: '待办', sectionType: 'memo', cards: [makeCard([{ text: 'D', checked: false, dueDate: '2026-11-10', scheduledDate: '2026-11-08', reminder: '2026-11-10 09:30' }])] } as unknown as DashboardColumn,
		callbacks,
		app,
	) as unknown as El;

	reminderBtnOf(section).click();
	let popup = popupOf();
	const [hour, min, modeSel] = timeSelects(popup) as [El, El, El];
	assert.equal((modeSel as unknown as { value: string }).value, 'deadline', '4d: deadline preselected');
	assert.equal((hour as unknown as { value: string }).value, '09', '4e: alarm hour seeded from ⏰');
	assert.ok(!min.hasClass('is-hidden'), '4f: minute picker visible with an alarm time');
	assert.ok(!findByClass(popup, 'dashboard-task-reminder-clear')[0]!.hasClass('is-hidden'), '4g: clear offered when the mode has a value');
	assert.equal(findByClass(popup, 'dashboard-task-reminder-preview')[0]!.textContent, '📅 2026-11-10 ⏰ 09:30', '4h: preview shows marker + alarm');

	// Switch the dropdown to 计划: selection jumps to the scheduled day; the
	// alarm belongs to the deadline day, so time resets to "no time".
	pick(modeSel, 'scheduled');
	assert.equal(findByClass(popup, 'dashboard-task-reminder-preview')[0]!.textContent, '⏳ 2026-11-08', '4i: preview follows mode + its date');
	assert.ok(min.hasClass('is-hidden'), '4j: minute picker hidden on "no time"');
	findTag(popup, 'button').find(b => b.hasClass('mod-cta'))!.click();
	assert.equal(patches.length, 1, '4k: one patch emitted');
	assert.deepEqual(patches[0], { scheduledDate: '2026-11-08' }, '4l: patch carries only scheduledDate (deadline alarm untouched)');

	// Reopen and clear the deadline: its marker goes together with its alarm.
	reminderBtnOf(section).click();
	popup = popupOf();
	findByClass(popup, 'dashboard-task-reminder-clear')[0]!.click();
	assert.deepEqual(patches[1], { dueDate: undefined, reminder: undefined }, '4m: clear removes the deadline and its alarm');
	assert.ok('dueDate' in patches[1]! && 'reminder' in patches[1]!, '4n: both clear keys present in the patch');
	assert.ok(!('scheduledDate' in patches[1]!), '4o: scheduled marker survives');
	assert.equal(findByClass(stubBody, 'dashboard-task-reminder-popup').length, 0, '4o2: popup closed after clear');
}

// 4p-4t. Plain task: dropdown defaults to 截止 with "no time" (no alarm); a
// chosen time writes the ⏰ alarm on the same day.
{
	const patches: TaskSchedulePatch[] = [];
	const callbacks = {
		onTaskScheduleEdit: (_cardId: string, _path: number[], patch: TaskSchedulePatch) => { patches.push(patch); },
	} as unknown as RenderCallbacks;
	const section = renderSection(
		{ id: 'col1', name: '待办', sectionType: 'memo', cards: [makeCard([{ text: 'E', checked: false }])] } as unknown as DashboardColumn,
		callbacks,
		app,
	) as unknown as El;

	reminderBtnOf(section).click();
	const popup = popupOf();
	const [hour, min, modeSel] = timeSelects(popup) as [El, El, El];
	assert.equal((modeSel as unknown as { value: string }).value, 'deadline', '4p: plain task defaults to deadline');
	assert.equal((hour as unknown as { value: string }).value, '', '4q: no alarm time by default');
	assert.ok(min.hasClass('is-hidden'), '4r: minute picker hidden until an hour is chosen');
	// Simulate the user picking 09:45. The day defaults to today.
	pick(hour, '9');
	pick(min, '45');
	assert.ok(findByClass(popup, 'dashboard-task-reminder-preview')[0]!.textContent.endsWith('⏰ 09:45'), '4s: preview tracks the selects');
	findTag(popup, 'button').find(b => b.hasClass('mod-cta'))!.click();
	const now = new Date();
	const pad2 = (n: number) => String(n).padStart(2, '0');
	const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
	assert.deepEqual(patches[0], { dueDate: todayIso, reminder: `${todayIso} 09:45` }, '4t: save = deadline day + ⏰ alarm');
}

// 4u-4w. A bare legacy ⏰ reads as a deadline: date and time seeded, saving
// converts it to 📅 + ⏰ on the same day.
{
	const patches: TaskSchedulePatch[] = [];
	const callbacks = {
		onTaskScheduleEdit: (_cardId: string, _path: number[], patch: TaskSchedulePatch) => { patches.push(patch); },
	} as unknown as RenderCallbacks;
	const section = renderSection(
		{ id: 'col1', name: '待办', sectionType: 'memo', cards: [makeCard([{ text: 'H', checked: false, reminder: '2026-11-09 14:00' }])] } as unknown as DashboardColumn,
		callbacks,
		app,
	) as unknown as El;

	reminderBtnOf(section).click();
	const popup = popupOf();
	const [hour, , modeSel] = timeSelects(popup) as [El, El, El];
	assert.equal((modeSel as unknown as { value: string }).value, 'deadline', '4u: bare ⏰ opens as deadline');
	assert.equal((hour as unknown as { value: string }).value, '14', '4v: ⏰ time seeded');
	assert.equal(findByClass(popup, 'dashboard-task-reminder-preview')[0]!.textContent, '📅 2026-11-09 ⏰ 14:00', '4w: preview shows the conversion');
	findTag(popup, 'button').find(b => b.hasClass('mod-cta'))!.click();
	assert.deepEqual(patches[0], { dueDate: '2026-11-09', reminder: '2026-11-09 14:00' }, '4x: save keeps day + alarm');
}

// 4q. A past deadline pulses; a past scheduled day does not.
{
	assert.ok(reminderBtnOf(renderTaskCard([{ text: 'F', checked: false, dueDate: '2020-01-01' }])).hasClass('dashboard-task-reminder-btn--overdue'), '4q: overdue deadline pulses');
	assert.ok(!reminderBtnOf(renderTaskCard([{ text: 'G', checked: false, scheduledDate: '2020-01-01' }])).hasClass('dashboard-task-reminder-btn--overdue'), '4r: planned day never pulses');
}

console.log('verify-task-schedule: all scenarios OK');
