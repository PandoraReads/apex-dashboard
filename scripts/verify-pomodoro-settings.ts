import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { Modal, Notice } from 'obsidian';
import { PomodoroService } from '../src/pomodoro-service';
import { renderSidebarPomodoro } from '../src/renderer';
import { showPomodoroStats } from '../src/pomodoro-stats-modal';
import { PomodoroSettingsModal } from '../src/pomodoro-settings-modal';
import { DEFAULT_SETTINGS, type DashboardSettings, type WidgetBackground } from '../src/types';

/**
 * Settings consolidation (3.7.x wave): the pomodoro card's gear opens ONE
 * settings dialog covering the stopwatch reminder cadence (was a bell key on
 * the card, stopwatch mode only), tag management (was a header button in the
 * stats panel) and the card background.
 *
 *  1. Stopwatch-mode card: no bell key anymore; gear present next to stats.
 *  2. Gear opens PomodoroSettingsModal with all three sections; editing the
 *     reminder persists through the plugin handle (immediate, no Save step).
 *  3. Tag chips live inside the modal: expand → rename → history rewritten.
 *  4. Stats panel: the top-right tag-management entry is gone.
 *
 * Run: `npm run test:pomodoro-settings`
 */

/** The card ring and stats gauges build SVG through El.createSvg, which
 *  mini-dom doesn't ship — a structural stand-in is enough for assertions.
 *  ownerDocument gets a prototype getter (real DOM has it on every element;
 *  the activity selector and stats entry read it). */
function patchDomExtras(docStub: unknown): void {
	const proto = El.prototype as unknown as {
		createSvg?(tag: string, o?: { cls?: string; attr?: Record<string, string> }): El;
	};
	proto.createSvg = function (this: El, tag: string, o?: { cls?: string; attr?: Record<string, string> }): El {
		const el = new El(tag);
		this.appendChild(el);
		if (o?.cls) el.addClass(...o.cls.split(/\s+/));
		for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
		return el;
	};
	Object.defineProperty(El.prototype, 'ownerDocument', { get: () => docStub });
	// Real-DOM parity the stats panel reads (rank bar recolors via it).
	Object.defineProperty(El.prototype, 'firstElementChild', { get(this: El): El | null { return this.children[0] ?? null; } });
}

const isoDay = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main(): Promise<void> {
	// Globals the render path touches (modal-theme, service timers).
	const docStub = {
		querySelector: (): null => null,
		body: new El('body'),
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
		visibilityState: 'visible',
	};
	patchDomExtras(docStub);
	(globalThis as { activeDocument?: unknown }).activeDocument = docStub;
	(globalThis as { window?: unknown }).window = {
		setTimeout: globalThis.setTimeout.bind(globalThis) as (fn: () => void, ms?: number) => number,
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
		setInterval: (): number => 0,
		clearInterval: (): void => {},
	};
	(globalThis as Record<string, unknown>).Image = class { src = ''; };

	// ── Fixture: plugin handle + service with tags and today's records ─────
	const files = new Map<string, string>();
	const today = isoDay(new Date());
	files.set('.obsidian/plugins/apex-dashboard/pomodoro.json', JSON.stringify({
		version: 2,
		currentActivity: '',
		tags: [
			{ name: '写作', pinned: true },
			{ name: '阅读', pinned: false },
		],
		sessions: [{
			date: today,
			completed: 2,
			records: [
				{ timestamp: `${today}T09:00:00`, activity: '写作', duration: 25, interruptions: 0 },
				{ timestamp: `${today}T10:00:00`, activity: '阅读', duration: 30, interruptions: 1 },
			],
		}],
	}));

	let saves = 0;
	let refreshes = 0;
	const settings: DashboardSettings = {
		...DEFAULT_SETTINGS,
		pomodoroMode: 'stopwatch',
		pomodoroStopwatchReminderMinutes: 30,
	};
	const pluginHandle = {
		settings,
		saveSettings: async (): Promise<void> => { saves += 1; },
		refreshAllDashboards: (): void => { refreshes += 1; },
	};
	const servicePlugin = {
		settings,
		app: { vault: { adapter: {
			exists: async (p: string) => files.has(p),
			read: async (p: string) => files.get(p) ?? '',
			write: async (p: string, c: string) => { files.set(p, c); },
			mkdir: async () => {},
		}, configDir: '.obsidian' } },
		manifest: { id: 'apex-dashboard' },
		saveSettings: async () => {},
	};
	const service = new PomodoroService(servicePlugin as never);
	await service.loadSessions();

	const app = {
		plugins: { plugins: { 'apex-dashboard': pluginHandle } },
	};
	const bgChanges: Array<WidgetBackground | undefined> = [];

	// ── 1. Stopwatch card chrome ───────────────────────────────────────────
	const host = new El('div');
	renderSidebarPomodoro(host as unknown as HTMLElement, service, settings, app as never, bg => bgChanges.push(bg));
	const topRow = findByClass(host, 'dashboard-sidebar-pomodoro-top')[0]!;
	assert.equal(findByClass(host, 'dashboard-sidebar-pomodoro-mode-btn').length, 0,
		'mode toggle moved off the card into the settings modal');
	const rightCluster = findByClass(host, 'dashboard-sidebar-pomodoro-top-right')[0]!;
	assert.ok(rightCluster, 'right cluster wraps the button pair');
	const ariaLabels = topRow.querySelectorAll('[aria-label]')
		.map(c => c.getAttribute('aria-label') ?? '')
		.join('|');
	assert.ok(!ariaLabels.includes('提醒一次') && !ariaLabels.includes('不提醒') && !ariaLabels.includes('切换为'),
		`no bell or mode keys on the card, got labels: ${ariaLabels}`);
	const gear = findByClass(host, 'dashboard-widget-inline-cfg-btn')[0]!;
	assert.ok(gear, 'inline settings gear present');
	assert.equal(gear.getAttribute('aria-label'), '番茄钟设置', 'gear labels the settings dialog');
	assert.ok(findByClass(rightCluster, 'dashboard-sidebar-pomodoro-stats-btn')[0], 'stats key in the cluster');

	// ── 2. Gear opens the settings modal ───────────────────────────────────
	gear.click();
	const lastModal = (Modal as unknown as { last: Modal | null }).last;
	assert.ok(lastModal instanceof PomodoroSettingsModal, 'gear opened PomodoroSettingsModal');
	(lastModal as PomodoroSettingsModal).onOpen();
	const body = (lastModal as unknown as { contentEl: El }).contentEl;

	const reminder = findByClass(body, 'dashboard-pomodoro-settings-reminder')[0]!;
	assert.ok(reminder, 'reminder field rendered in the modal');
	assert.equal(reminder.value, '30', 'reminder field seeded from settings');

	// Mode check rows: stopwatch checked (fixture), ticking timer flips the
	// setting; the active row refuses to untick; a live run blocks the switch.
	const timerCb = body.querySelector('[id="pn-mode-timer"]')!;
	const stopwatchCb = body.querySelector('[id="pn-mode-stopwatch"]')!;
	assert.ok(timerCb && stopwatchCb, 'mode check rows rendered');
	assert.equal(stopwatchCb.checked, true, 'stopwatch row checked from settings');
	assert.equal(timerCb.checked, false, 'timer row unchecked');

	timerCb.checked = true;
	timerCb.dispatchEvent({ type: 'change', target: timerCb });
	assert.equal(pluginHandle.settings.pomodoroMode, 'timer', 'ticking timer flips the setting');
	assert.equal(stopwatchCb.checked, false, 'the other row unticks (sync)');
	stopwatchCb.checked = false;
	stopwatchCb.dispatchEvent({ type: 'change', target: stopwatchCb });
	assert.equal(stopwatchCb.checked, true, 'active row refuses to untick');
	stopwatchCb.checked = true;
	stopwatchCb.dispatchEvent({ type: 'change', target: stopwatchCb });
	assert.equal(pluginHandle.settings.pomodoroMode, 'stopwatch', 'ticking stopwatch flips back');

	service.start();
	timerCb.checked = true;
	timerCb.dispatchEvent({ type: 'change', target: timerCb });
	assert.equal(pluginHandle.settings.pomodoroMode, 'stopwatch', 'live run blocks the mode switch');
	const notices = (Notice as unknown as { messages: string[] }).messages;
	assert.ok(notices.some(m => m.includes('先停止当前计时')), `busy toast shown, got ${JSON.stringify(notices)}`);
	assert.equal(timerCb.checked, false, 'blocked attempt re-syncs the rows');
	service.reset();

	assert.ok(findByClass(body, 'dashboard-pomodoro-tagmanager-chip').length >= 2, 'tag chips rendered in the modal');
	assert.ok(findByClass(body, 'dashboard-pomodoro-settings-bg-desc')[0], 'background row rendered');

	reminder.value = '45';
	reminder.dispatchEvent({ type: 'change', target: reminder });
	assert.equal(pluginHandle.settings.pomodoroStopwatchReminderMinutes, 45, 'reminder edit persists');
	// 2 mode flips above + this reminder edit = 3 saves so far.
	assert.equal(saves, 3, 'settings saved');
	await new Promise(resolve => setTimeout(resolve, 5)); // refresh rides saveSettings().then()
	assert.equal(refreshes, 3, 'dashboards refreshed');

	reminder.value = '999';
	reminder.dispatchEvent({ type: 'change', target: reminder });
	assert.equal(pluginHandle.settings.pomodoroStopwatchReminderMinutes, 240, 'reminder clamps at 240');
	reminder.value = '';
	reminder.dispatchEvent({ type: 'change', target: reminder });
	assert.equal(pluginHandle.settings.pomodoroStopwatchReminderMinutes, 0, 'empty clears to 0 (never remind)');
	assert.equal(reminder.value, '', 'empty stays empty (0 renders as blank)');

	// ── 3. Tag rename inside the modal ─────────────────────────────────────
	const chips = () => findByClass(body, 'dashboard-pomodoro-tagmanager-chip');
	const chipWriting = chips().find(c => c.textContent.includes('写作'))!;
	assert.ok(chipWriting, '写作 chip present');
	chipWriting.dispatchEvent({ type: 'click', target: chipWriting });
	const rows = findByClass(body, 'dashboard-pomodoro-tagmanager-row--open');
	assert.equal(rows.length, 1, 'chip expands its action bar');
	const renameBtn = findByClass(rows[0]!, 'dashboard-pomodoro-tagmanager-action')
		.find(b => b.textContent.includes('重命名'))!;
	renameBtn.dispatchEvent({ type: 'click', target: renameBtn });
	const prompt = findByClass(body, 'dashboard-pomodoro-tagmanager-prompt')[0]!;
	assert.ok(prompt, 'rename prompt row appears inline');
	const promptInput = findByClass(prompt, 'dashboard-pomodoro-tagmanager-prompt-input')[0]!;
	assert.equal(promptInput.value, '写作', 'rename prompt seeded with the current name');
	promptInput.value = '写作练习';
	const okBtn = findByClass(prompt, 'dashboard-pomodoro-tagmanager-prompt-ok')[0]!;
	okBtn.dispatchEvent({ type: 'click', target: okBtn });
	await new Promise(resolve => setTimeout(resolve, 30)); // tag writes ride an async queue
	assert.ok(service.getTags().some(tg => tg.name === '写作练习' && tg.pinned), 'rename persisted with pin kept');
	// 3 reminder edits (45 / clamp 240 / clear 0) + 2 mode flips + this rename
	// = 6 refreshes (the blocked switch saves nothing).
	assert.equal(refreshes, 6, 'tag mutation refreshed the dashboards');
	// The modal list re-rendered under the same host.
	assert.ok(chips().some(c => c.textContent.includes('写作练习')), 'modal chips reflect the rename');

	// ── 4. Stats panel: no tag-manage entry ────────────────────────────────
	const statsBody = new El('body');
	const statsDoc = {
		querySelector: (): null => null,
		body: statsBody,
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
	};
	showPomodoroStats(statsDoc as never, service);
	assert.equal(findByClass(statsBody, 'dashboard-pomodoro-stats-icon-btn').length, 0,
		'stats header no longer renders the tag-manage button');
	assert.ok(findByClass(statsBody, 'dashboard-pomodoro-range-toggle')[0], 'range toggle still there');
	assert.ok(findByClass(statsBody, 'dashboard-pomodoro-stats-close')[0], 'close button still there');

	service.destroy();
	console.log('verify-pomodoro-settings: all assertions passed');
}

void main();
