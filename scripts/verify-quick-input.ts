import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { chunkSkillKeys, renderSidebarSkillWidget } from '../src/skill-widget';
import { renderSidebarFileSearchWidget, renderSidebarQuickCaptureWidget } from '../src/capture-search-widgets';
import { renderQuickNoteRegion } from '../src/quick-note-section';
import { DEFAULT_SETTINGS, type DashboardSettings, type RenderCallbacks } from '../src/types';
import type { TFile } from 'obsidian';

/**
 * Quick-input surfaces (3.7.x wave):
 *  1. Skill widget rows: keys chunk into STRUCTURAL rows of at most five
 *     (gear included) — the classic 4 skills + gear stay one row; more wrap.
 *  2. Quick-note bar box purpose: capture mode keeps the auto-grow textarea;
 *     search mode swaps in a one-line field whose typing feeds a results
 *     dropdown, and Enter opens the active hit through the callback.
 *  3. The two standalone widgets render the shared pill (field + round key);
 *     the search widget lists matches inside the card and opens on click.
 *
 * Run: `npm run test:quick-input`
 */

const fakeFile = (path: string, ext = 'md', mtime = 1_000): TFile =>
	({
		path,
		basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''),
		extension: ext,
		stat: { mtime },
	}) as TFile;

const FILES: TFile[] = [
	fakeFile('dashboard.md', 'md', 5_000),
	fakeFile('Notes/dashboard-config.md', 'md', 4_000),
	fakeFile('Notes/reading.md', 'md', 3_000),
	fakeFile('attachments/poster.png', 'png', 2_000),
	fakeFile('.obsidian/hidden.md', 'md', 9_000),
	fakeFile('Notes/ignoreme.txt', 'txt', 8_000),
];

function fakeApp(): { vault: unknown; workspace: unknown; opened: TFile[] } {
	const opened: TFile[] = [];
	return {
		opened,
		vault: {
			getFiles: () => FILES,
			// getRecentDocs walks markdown files by mtime.
			getMarkdownFiles: () => FILES.filter(f => f.extension === 'md'),
			getFileByPath: (path: string) => FILES.find(f => f.path === path) ?? null,
		},
		workspace: { getLeaf: () => ({ openFile: async (f: TFile) => { opened.push(f); } }) },
	};
}

function skillButtons(n: number): DashboardSettings['skillWidgetButtons'] {
	return Array.from({ length: n }, (_, i) => ({
		id: `s${i}`, label: `Skill ${i}`, icon: 'sparkles', target: 'claudian' as const,
		skillName: '', promptTemplate: '',
	}));
}

function main(): void {
	// Body-level popovers mirror theme tokens through applyModalTheme, which
	// reads the Obsidian global activeDocument — absent in Node. A null-root
	// stub makes it early-return (no theming under test).
	(globalThis as { activeDocument?: unknown }).activeDocument = { querySelector: () => null };

	// ── 1. Skill key rows ──────────────────────────────────────────────────
	assert.deepEqual(chunkSkillKeys([1, 2, 3, 4, 5, 6, 7]), [[1, 2, 3, 4, 5], [6, 7]]);
	assert.deepEqual(chunkSkillKeys([1]), [[1]]);
	assert.deepEqual(chunkSkillKeys([], 5), []);

	const app = fakeApp();
	const asHost = (el: El): HTMLElement => el as unknown as HTMLElement;
	let host = new El('div');
	renderSidebarSkillWidget(asHost(host), app as never, { ...DEFAULT_SETTINGS, skillWidgetButtons: skillButtons(4) });
	let bar = findByClass(host, 'dashboard-sidebar-skills')[0]!;
	let rows = bar.querySelectorAll('.dashboard-skills-row');
	assert.equal(rows.length, 1, '4 skills + gear = one row');
	assert.equal(rows[0]!.querySelectorAll('.dashboard-skills-orb').length, 5);
	assert.ok(!bar.hasClass('dashboard-sidebar-skills--multi'), 'single row keeps the pill (no multi class)');

	host = new El('div');
	renderSidebarSkillWidget(asHost(host), app as never, { ...DEFAULT_SETTINGS, skillWidgetButtons: skillButtons(7) });
	bar = findByClass(host, 'dashboard-sidebar-skills')[0]!;
	rows = bar.querySelectorAll('.dashboard-skills-row');
	assert.equal(rows.length, 2, '7 skills + gear = two rows');
	assert.equal(rows[0]!.querySelectorAll('.dashboard-skills-orb').length, 5, 'first row caps at five keys');
	const lastRowKeys = rows[1]!.querySelectorAll('.dashboard-skills-orb');
	assert.equal(lastRowKeys.length, 3, 'second row: 2 skills + gear');
	// The gear is the LAST key of the LAST row.
	assert.ok(lastRowKeys[lastRowKeys.length - 1]!.hasClass('dashboard-skills-orb--cog'));
	assert.ok(bar.hasClass('dashboard-sidebar-skills--multi'), 'multi-row strip carries the card-radius class');

	host = new El('div');
	renderSidebarSkillWidget(asHost(host), app as never, { ...DEFAULT_SETTINGS, skillWidgetButtons: skillButtons(11) });
	bar = findByClass(host, 'dashboard-sidebar-skills')[0]!;
	rows = bar.querySelectorAll('.dashboard-skills-row');
	assert.equal(rows.length, 3, '11 skills + gear = three rows');

	// ── 2. Quick-note bar box purpose ──────────────────────────────────────
	const captured: string[] = [];
	const openedByCallback: TFile[] = [];
	const callbacks = {
		onQuickNoteCapture: (text: string) => { captured.push(text); },
		onQuickSearchOpen: (file: TFile) => { openedByCallback.push(file); },
	} as unknown as RenderCallbacks;

	// Capture mode (default): the auto-grow textarea is the box.
	let region = new El('div');
	renderQuickNoteRegion(asHost(region), { ...DEFAULT_SETTINGS, quickNotesEnabled: true, quickCaptureEnabled: true }, callbacks, app as never);
	assert.ok(findByClass(region, 'dashboard-quicknote-capture-input').length > 0);
	assert.equal(region.querySelectorAll('textarea').length, 1, 'capture mode renders a textarea');

	// Search mode: one-line input + dropdown; typing filters, Enter opens.
	region = new El('div');
	renderQuickNoteRegion(asHost(region), { ...DEFAULT_SETTINGS, quickNotesEnabled: true, quickCaptureEnabled: true, quickCaptureMode: 'search' }, callbacks, app as never);
	assert.equal(region.querySelectorAll('textarea').length, 0, 'search mode has no textarea');
	const searchInput = findByClass(region, 'dashboard-quicknote-search-input')[0]!;
	assert.ok(searchInput, 'search input rendered');
	const pop = findByClass(region, 'dashboard-quicknote-search-pop')[0]!;
	assert.equal(pop.children.length, 0, 'dropdown starts empty');

	searchInput.value = 'dash';
	searchInput.dispatchEvent({ type: 'input', target: searchInput });
	let items = pop.querySelectorAll('.dashboard-docsearch-item');
	// Hidden + unsupported extensions filtered out; shorter basename first.
	assert.equal(items.length, 2, `two md matches for "dash", got ${items.length}`);
	const firstName = findByClass(items[0] as El, 'dashboard-docsearch-name')[0]!;
	assert.equal(firstName.textContent, 'dashboard', 'shorter basename ranks first');

	searchInput.dispatchEvent({ type: 'keydown', target: searchInput, key: 'Enter' });
	assert.equal(openedByCallback.length, 1, 'Enter opens the active hit');
	assert.equal(openedByCallback[0]!.path, 'dashboard.md');

	// No match: dropdown folds.
	searchInput.value = 'zzz-nothing';
	searchInput.dispatchEvent({ type: 'input', target: searchInput });
	assert.equal(pop.querySelectorAll('.dashboard-docsearch-item').length, 0);

	// ── 3. Standalone widgets ──────────────────────────────────────────────
	const widgetHost = new El('div');
	renderSidebarQuickCaptureWidget(asHost(widgetHost), app as never, { ...DEFAULT_SETTINGS });
	assert.ok(findByClass(widgetHost, 'dashboard-capturebar-input').length > 0, 'capture widget has the field');
	assert.equal(widgetHost.querySelectorAll('.dashboard-capturebar-key').length, 1, 'capture widget has one confirm key');
	// Capture bar's leading glyph is a static pencil (no button semantics).
	const pencil = findByClass(widgetHost, 'dashboard-capturebar-glyph--static')[0]!;
	assert.ok(pencil, 'capture bar carries the static pencil glyph');
	assert.equal(widgetHost.querySelectorAll('button.dashboard-capturebar-glyph').length, 0, 'capture glyph is not a button');

	// File search: results open as a FLOATING popover (body-level in the real
	// DOM; the mini-dom ownerDocument stub roots it at the tree top — the
	// search host here), never embedded in the card.
	const searchHost = new El('div');
	renderSidebarFileSearchWidget(asHost(searchHost), app as never);
	const field = findByClass(searchHost, 'dashboard-capturebar-input')[0]!;
	const key = findByClass(searchHost, 'dashboard-capturebar-key')[0]!;
	field.value = 'reading';
	key.dispatchEvent({ type: 'click', target: key });
	let pop2 = findByClass(searchHost, 'dashboard-filesearch-pop')[0]!;
	assert.ok(pop2, 'floating results popover opened');
	assert.ok(pop2.hasClass('is-open'));
	const resultItems = pop2.querySelectorAll('.dashboard-docsearch-item');
	assert.equal(resultItems.length, 1, `one hit for "reading", got ${resultItems.length}`);
	resultItems[0]!.dispatchEvent({ type: 'click', target: resultItems[0] as El });
	assert.equal(app.opened.length, 1, 'result click opens the file');
	assert.equal(app.opened[0]!.path, 'Notes/reading.md');
	// The pill row still holds no results node of its own (results are not
	// embedded in the card body).
	assert.equal(findByClass(searchHost, 'dashboard-capturebar-results').length, 0, 'no in-card results list');

	// ── 4. The ➕ opens the recently viewed files ──────────────────────────
	const plusBtn = searchHost.querySelectorAll('button.dashboard-capturebar-glyph')[0]!;
	assert.ok(plusBtn, 'search bar carries the plus button');
	plusBtn.dispatchEvent({ type: 'click', target: plusBtn });
	pop2 = findByClass(searchHost, 'dashboard-filesearch-pop')[0]!;
	assert.ok(pop2, 'recent-files popover opened');
	const recentItems = pop2.querySelectorAll('.dashboard-docsearch-item');
	// Markdown-only, hidden excluded, newest mtime first.
	assert.equal(recentItems.length, 3, `three recent md files, got ${recentItems.length}`);
	const firstRecent = findByClass(recentItems[0] as El, 'dashboard-docsearch-name')[0]!;
	assert.equal(firstRecent.textContent, 'dashboard', 'newest file leads the recents');
	assert.ok(findByClass(pop2, 'dashboard-filesearch-meta').length > 0, 'recents carry the relative-time meta');
	recentItems[1]!.dispatchEvent({ type: 'click', target: recentItems[1] as El });
	assert.equal(app.opened[app.opened.length - 1]!.path, 'Notes/dashboard-config.md', 'recent pick opens the file');

	console.log('verify-quick-input: all assertions passed');
}

main();
