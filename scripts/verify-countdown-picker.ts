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
const documentListeners = new Map<string, Array<(event: unknown) => void>>();
const fakeWindow = { innerWidth: 1920, setTimeout: (fn: () => void) => { fn(); return 0; } };
const fakeDocument = {
	body: bodyEl,
	defaultView: fakeWindow,
	activeElement: null as unknown,
	addEventListener(type: string, fn: (event: unknown) => void): void {
		documentListeners.set(type, [...(documentListeners.get(type) ?? []), fn]);
	},
	removeEventListener(type: string, fn: (event: unknown) => void): void {
		documentListeners.set(type, (documentListeners.get(type) ?? []).filter(listener => listener !== fn));
	},
};
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: bodyEl,
};
(globalThis as unknown as Record<string, unknown>).window = fakeWindow;

const app = {} as unknown as App;

let saved: { targetDate?: string } | undefined;
const modal = new CountdownSettingsModal(
	app,
	{ id: 'x', label: 'L', targetDate: '2026-09-15T08:30', displayMode: 'days', reminderDays: 0 },
	r => { saved = { ...r } as { targetDate?: string }; },
);
Object.defineProperty(modal.contentEl, 'ownerDocument', { configurable: true, get: () => fakeDocument });
bodyEl.appendChild(modal.contentEl as unknown as El);
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
const timeTriggers = findByClass(timeRow, 'dashboard-countdown-time-picker-trigger');
assert.equal(timeTriggers.length, 2, 'hour and minute picker buttons are inside popup');
timeTriggers[0]!.click();
const hourOptions = findByClass(popup, 'dashboard-countdown-time-options--hour')[0]!;
findByClass(hourOptions, 'dashboard-countdown-time-option').find(option => option.textContent === '14')!.click();
assert.equal(findByClass(bodyEl, 'dashboard-countdown-calendar-popup').length, 1,
	'picking an hour keeps the date panel open');

dayButtons().find(b => b.textContent === '20')!.click();
// Simulate time change: hour 14, minute 45 (exact-minute branch).
timeTriggers[1]!.click();
const minuteOptions = findByClass(popup, 'dashboard-countdown-time-options--minute')[0]!;
findByClass(minuteOptions, 'dashboard-countdown-time-option').find(option => option.textContent === '45')!.click();
assert.equal(findByClass(bodyEl, 'dashboard-countdown-calendar-popup').length, 1,
	'picking a minute keeps the date panel open');

// Popup Save commits the date; modal Save assembles date + time.
findTag(findByClass(popup, 'dashboard-task-reminder-popup-btns')[0]!, 'button')
	.find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.ok(!findByClass(bodyEl, 'dashboard-countdown-calendar-popup').length, 'popup closes on save');

const footer = findByClass(content, 'dashboard-modal-footer')[0]!;
findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!.click();
assert.equal((saved as { targetDate?: string } | undefined)?.targetDate, '2025-04-20T14:45',
	'save carries date picked via ym panel plus in-popup time');

const malformed = new CountdownSettingsModal(
	app,
	{ id: 'broken', label: 'Broken', targetDate: undefined as unknown as string, displayMode: 'days', reminderDays: 0 },
	() => {},
);
assert.doesNotThrow(() => malformed.onOpen(), 'missing saved date no longer crashes the picker');
bodyEl.appendChild(malformed.contentEl as unknown as El);
findByClass(malformed.contentEl as unknown as El, 'dashboard-countdown-date-trigger')[0]!.click();
assert.ok(findByClass(bodyEl, 'dashboard-countdown-calendar-popup').length > 0,
	'malformed legacy date still opens a usable date picker');
malformed.onClose();

console.log('countdown picker: ALL PASS');
