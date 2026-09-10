import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { renderCalendarSection, refreshCalendarSections } from '../src/calendar-section';
import { readCalendarTaskFilter } from '../src/calendar-modal';
import { toIsoDate } from '../src/alltasks-scan';
import type { DashboardSettings } from '../src/types';

// Calendar section: the sidebar widget's enlarged view embedded as a board
// section. Scans the vault (respecting calendarExcludeFolders), renders the
// full month grid / week time grid, toggles write back to the source file,
// and vault-change refreshes re-render the grid IN PLACE (navigation kept).

const isoOf = (d: Date): string => toIsoDate(d);

interface MemFile {
	path: string;
	basename: string;
	stat: { mtime: number; ctime: number; size: number };
}

function makeVault(files: Record<string, string>): { app: App; store: Map<string, string>; fileOf: (p: string) => MemFile } {
	const store = new Map(Object.entries(files));
	const mtime = new Map(Object.keys(files).map(p => [p, 1_000]));
	const fileOf = (path: string): MemFile => {
		const f = new TFile() as unknown as MemFile;
		f.path = path;
		f.basename = path.split('/').pop()!.replace(/\.md$/, '');
		f.stat = { mtime: mtime.get(path) ?? 1_000, ctime: 1_000, size: 0 };
		return f;
	};
	const app = {
		vault: {
			getMarkdownFiles: () => [...store.keys()].map(fileOf),
			cachedRead: async (f: MemFile) => store.get(f.path) ?? '',
			// Write-back path used by toggleTaskInFile: run the transform, store
			// the result, bump mtime so the next scan re-reads the file.
			process: async (f: MemFile, cb: (data: string) => string) => {
				const next = cb(store.get(f.path) ?? '');
				store.set(f.path, next);
				mtime.set(f.path, (mtime.get(f.path) ?? 1_000) + 1);
				return next;
			},
		},
		metadataCache: {
			getFileCache: (_f: MemFile) => undefined,
		},
	};
	return { app: app as unknown as App, store, fileOf };
}

const SETTINGS = {
	dashboardFile: 'dashboard',
	calendarExcludeFolders: ['secret'],
} as unknown as DashboardSettings;

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 10));

async function main(): Promise<void> {
	// Globals the rendered grid touches: bare createDiv() in calendar-grid's
	// task rows, requestAnimationFrame in the week time grid's auto-scroll, and
	// REAL timers for the hover preview's 350ms delay. activeDocument hosts the
	// body-level hover popup (querySelector -> null keeps applyModalTheme inert).
	(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
		const el = new El('div');
		if (o?.cls) el.addClass(...o.cls.split(/\s+/));
		if (o?.text !== undefined) el.textContent = o.text;
		return el;
	};
	(globalThis as { window?: unknown }).window = {
		requestAnimationFrame: () => 0,
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	};
	const previewBody = new El('body');
	(globalThis as { activeDocument?: unknown }).activeDocument = {
		body: previewBody,
		querySelector: (): null => null,
		documentElement: { clientWidth: 900, clientHeight: 700 },
	};

	const today = new Date();
	const todayIso = isoOf(today);
	// Same day previous month, clamped so Feb 30-style rollovers can't leak
	// into the current month's grid area.
	const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), 28));
	const prevIso = isoOf(prevDate);

	// 1. Month view: structure, scan, exclusion.
	const { app, store } = makeVault({
		'notes/plan.md': `# Plan\n\n- [ ] Alpha 📅 ${todayIso}\n`,
		'notes/timed.md': `# Timed\n\n- [ ] Beta ⏰ ${todayIso} 09:30\n`,
		'secret/hidden.md': `# Hidden\n\n- [ ] Omega 📅 ${todayIso}\n`,
	});
	const sectionEl = new El('div');
	renderCalendarSection(sectionEl as unknown as HTMLElement, app, SETTINGS);
	await flush();

	const host = findByClass(sectionEl, 'dashboard-calendar-section')[0]!;
	assert.ok(host, '1: section host rendered');
	const body = findByClass(host, 'dashboard-calendar-section-body')[0]!;
	assert.ok(body, '1: grid body rendered');
	assert.equal(findByClass(body, 'dashboard-calendar-cell').length, 42, '1: full month grid (42 cells)');
	const events = findByClass(body, 'dashboard-calendar-event');
	assert.ok(events.some(e => e.textContent.includes('Alpha')), '1: vault task shown');
	assert.ok(events.some(e => e.textContent.includes('Beta')), '1: timed task shown');
	assert.ok(!events.some(e => e.textContent.includes('Omega')), '1: excluded-folder task hidden');
	const viewBtns = findByClass(host, 'dashboard-library-view-btn');
	assert.equal(viewBtns.length, 2, '1: month|week toggle');
	assert.ok(viewBtns[0]!.hasClass('active'), '1: month active initially');
	assert.ok(!findByClass(host, 'dashboard-calendar-filter-btn')[0]!.hasClass('is-filtered'), '1: filter defaults to all');
	const labelEl = findByClass(host, 'dashboard-calendar-nav-label')[0]!;
	const initialLabel = labelEl.textContent;
	assert.ok(initialLabel.length > 0, '1: month label shown');

	// 2. Inline toggle writes back to the source file and re-renders.
	const betaCheck = findByClass(body, 'dashboard-calendar-check')
		.find(c => (c.parent ? c.parent.textContent.includes('Beta') : false))!;
	assert.ok(betaCheck, '2: checkbox rendered for full-mode task');
	betaCheck.click();
	await flush();
	assert.ok((store.get('notes/timed.md') ?? '').includes(`- [x] Beta ⏰ ${todayIso} 09:30`), '2: file updated to checked');
	const body2 = findByClass(host, 'dashboard-calendar-section-body')[0]!;
	assert.ok(findByClass(body2, 'dashboard-calendar-event').some(e => e.hasClass('is-done')), '2: row re-rendered as done');

	// 3. Week view toggle: time grid with 7 day columns and the timed event.
	viewBtns[1]!.click(); // -> week
	await flush();
	const body3 = findByClass(host, 'dashboard-calendar-section-body')[0]!;
	assert.ok(findByClass(body3, 'dashboard-calgrid').length > 0, '3: week time grid rendered');
	assert.equal(findByClass(body3, 'dashboard-calgrid-dayhead').length, 7, '3: 7 day headers');
	assert.ok(findByClass(body3, 'dashboard-calgrid-event').some(e => e.textContent.includes('Beta')), '3: timed task positioned in grid');
	assert.ok(viewBtns[1]!.hasClass('active'), '3: week button active');
	viewBtns[0]!.click(); // -> month
	await flush();

	// 4. In-place refresh preserves navigation and picks up new tasks.
	const prevBtn = findByClass(host, 'dashboard-calendar-nav-btn')[0]!;
	prevBtn.click(); // previous month
	await flush();
	const labelAfterPrev = findByClass(host, 'dashboard-calendar-nav-label')[0]!.textContent;
	assert.notEqual(labelAfterPrev, initialLabel, '4: prev navigation moved the view');

	store.set('notes/gamma.md', `# Gamma\n\n- [ ] Gamma 📅 ${prevIso}\n`);
	const kanban = new El('div');
	kanban.appendChild(host);
	assert.equal(refreshCalendarSections(kanban as unknown as HTMLElement), true, '4: refresh found the live section');
	await flush();
	const body4 = findByClass(host, 'dashboard-calendar-section-body')[0]!;
	assert.ok(findByClass(body4, 'dashboard-calendar-event').some(e => e.textContent.includes('Gamma')), '4: new task appears after rescan');
	assert.equal(findByClass(host, 'dashboard-calendar-nav-label')[0]!.textContent, labelAfterPrev, '4: navigation preserved across refresh');

	// 5. Filter helpers normalize without a reachable plugin instance.
	assert.equal(readCalendarTaskFilter({} as App), 'all', '5: filter normalizes to all');

	// 6. Hover preview: resting on a month cell pops the day's COMPLETE task
	//    list (no cap — 12 tasks all listed), leave closes it, and so does any
	//    grid re-render (navigation).
	{
		const lines = Array.from({ length: 12 }, (_, i) =>
			`- [ ] Task${String(i + 1).padStart(2, '0')} ⏰ ${todayIso} 09:${String(i).padStart(2, '0')}`);
		store.set('notes/many.md', `# Many\n\n${lines.join('\n')}\n`);
		// Rescan so the grid (and preview) sees the new file; then jump back to
		// the current month (scenario 4 left the view on the previous one).
		refreshCalendarSections(kanban as unknown as HTMLElement);
		await flush();
		findByClass(host, 'dashboard-modal-btn')[0]!.click(); // nav's Today button
		await flush();
		const body6 = findByClass(host, 'dashboard-calendar-section-body')[0]!;
		const todayCell = findByClass(body6, 'dashboard-calendar-cell').find(c => c.hasClass('is-today'))!;
		assert.ok(todayCell, '6: today cell found');

		todayCell.dispatchEvent({ type: 'mouseenter' });
		await new Promise(r => setTimeout(r, 450));
		const popup = findByClass(previewBody, 'dashboard-calendar-day-preview')[0]!;
		assert.ok(popup, '6: preview popup opened after hover delay');
		const rows = findByClass(popup, 'dashboard-calendar-event');
		// Alpha + Beta (scenario 1) + the 12 new ones = 14: the FULL day list.
		assert.equal(rows.length, 14, '6: ALL of the day\'s tasks listed (no cap)');
		for (let i = 1; i <= 12; i++) {
			assert.ok(popup.textContent.includes(`Task${String(i).padStart(2, '0')}`), `6: Task${i} present`);
		}

		todayCell.dispatchEvent({ type: 'mouseleave' });
		assert.equal(findByClass(previewBody, 'dashboard-calendar-day-preview').length, 0, '6: leave closes popup');

		todayCell.dispatchEvent({ type: 'mouseenter' });
		await new Promise(r => setTimeout(r, 450));
		assert.equal(findByClass(previewBody, 'dashboard-calendar-day-preview').length, 1, '6: reopened');
		findByClass(host, 'dashboard-calendar-nav-btn')[1]!.click(); // next month
		await flush();
		assert.equal(findByClass(previewBody, 'dashboard-calendar-day-preview').length, 0, '6: navigation closes stale popup');
	}

	console.log('verify-calendar-section: 6 scenarios OK');
}

void main();
