/**
 * Verifies the countdown picker's two-level calendar + in-popup time:
 *
 * 1. Popup opens with a day grid; the month label is a toggle button.
 * 2. Clicking the label swaps to the year-month panel (year stepper + 12
 *    months); picking a month returns to that month's day grid.
 * 3. < > navigate months in the day grid and years in the ym panel.
 * 4. The time row lives inside the popup; changing it updates the instance
 *    and one Save commits date + time to targetDate via the modal's Save.
 * 5. The standalone time row is gone from the modal form.
 *
 * Run: `npm run test:countdown-picker`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { CountdownSettingsModal } from '../src/countdown-modal';
import { El, findByClass, findTag } from './mini-dom';

// The popup mounts on activeDocument.body — give the stub a live El body.
const bodyEl = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: bodyEl,
};
(globalThis as unknown as Record<string, unknown>).window = { innerWidth: 1920, setTimeout: () => 0 };

const app = {} as unknown as App;

let saved: { targetDate?: string } | undefined;
const modal = new CountdownSettingsModal(
	app,
	{ id: 'x', label: 'L', targetDate: '2026-09-15T08:30', displayMode: 'days', reminderDays: 0 },
	r => { saved = { ...r } as { targetDate?: string }; },
);
modal.onOpen();
const content = modal.contentEl as unknown as El;

// 5. The standalone time row is gone; date trigger remains.
assert.ok(findByClass(content, 'dashboard-countdown-date-trigger').length === 1, 'date trigger present');
assert.equal(findByClass(content, 'dashboard-countdown-time-wrap').length, 0, 'standalone time row removed');

// Open the popup.
findByClass(content, 'dashboard-countdown-date-trigger')[0]!.click();
let popup = findByClass(bodyEl, 'dashboard-countdown-calendar-popup')[0]!;
assert.ok(popup, 'popup opens');

const label = (): El => findTag(popup, 'button').find(b => b.hasClass('dashboard-countdown-cal-label'))!;
const dayButtons = (): El[] => findByClass(popup, 'dashboard-task-reminder-calendar-day')
	.filter(b => !b.hasClass('dashboard-task-reminder-calendar-day--other-month'));
const ymCells = (): El[] => findByClass(popup, 'dashboard-countdown-ym-cell');
const navArrows = (): El[] => findTag(findByClass(popup, 'dashboard-task-reminder-calendar-nav')[0]!, 'button')
	.filter(b => !b.hasClass('dashboard-countdown-cal-label'));

// 1. Day grid for the stored month, stored day selected, label shows it.
assert.equal(label().textContent, '2026-09', 'label shows stored month');
assert.ok(dayButtons().some(b => b.textContent === '15' && b.hasClass('dashboard-task-reminder-calendar-day--selected')),
	'stored day selected');

// 2. Toggle to the year-month panel: just the 12 month cells — the top nav
// (already showing the year, arrows stepping by years) replaces any in-panel
// year stepper.
label().click();
assert.equal(ymCells().length, 12, 'ym panel shows 12 months');
assert.equal(findByClass(popup, 'dashboard-task-reminder-calendar-nav').length, 1, 'single nav: no duplicate year bar');
assert.equal(label().textContent, '2026', 'top label shows the year in ym panel');
assert.ok(ymCells().some(c => c.textContent === '9月' && c.hasClass('dashboard-task-reminder-calendar-day--selected')),
	'stored month selected in ym panel');

// 3. Arrows step YEARS while the ym panel is open (top nav only).
navArrows()[1]!.click(); // '>'
assert.equal(label().textContent, '2027', 'year steps forward');
navArrows()[0]!.click(); // '<'
navArrows()[0]!.click(); // '<' -> 2025
assert.equal(label().textContent, '2025', 'year steps back');

// Pick March 2025 -> day grid of that month.
ymCells().find(c => c.textContent === '3月')!.click();
assert.equal(label().textContent, '2025-03', 'picking a month lands on its day grid');

// Arrows step MONTHS in the day grid.
navArrows()[1]!.click();
assert.equal(label().textContent, '2025-04', 'arrow steps month in day grid');

// 4. Time row inside the popup; pick a day, change time, commit both.
const timeRow = findByClass(popup, 'dashboard-countdown-popup-time')[0]!;
const selects = findTag(timeRow, 'select');
assert.equal(selects.length, 2, 'hour and minute selects inside popup');
assert.equal(findTag(selects[0]!, 'option').filter(o => o.selected).length > 0, true, 'hour options render');

dayButtons().find(b => b.textContent === '20')!.click();
// Simulate time change: hour 14, minute 45 (exact-minute branch).
selects[0]!.value = '14';
selects[0]!.dispatchEvent({ type: 'change' });
selects[1]!.value = '45';
selects[1]!.dispatchEvent({ type: 'change' });

// Popup Save commits the date; modal Save assembles date + time.
findTag(findByClass(popup, 'dashboard-task-reminder-popup-btns')[0]!, 'button')
	.find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.ok(!findByClass(bodyEl, 'dashboard-countdown-calendar-popup').length, 'popup closes on save');

const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.equal((saved as { targetDate?: string } | undefined)?.targetDate, '2025-04-20T14:45',
	'save carries date picked via ym panel plus in-popup time');

console.log('countdown picker: ALL PASS');
