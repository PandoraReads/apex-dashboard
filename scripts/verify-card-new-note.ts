import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import { renderSection } from '../src/renderer';
import { sectionNewNoteFolder } from '../src/library-new-note';
import { NotesSectionConfigModal } from '../src/notes-config-modal';
import type { DashboardCard, DashboardColumn, LibraryConfig, RenderCallbacks } from '../src/types';

// Per-card "new note" on notes (no cover) and projects (cover) sections: the
// button renders first in each card's actions row (left of edit + delete),
// fires onCardNewNote with the card id, and is absent on memo/sticky sections
// and task cards. Both section types also get a header settings gear that
// dispatches the config event (template + save folder, see view.ts), and
// sectionNewNoteFolder maps the saved config to the creation folder
// (vault root when unset).

// Obsidian globals absent in Node (see verify-path-picker / verify-calendar-section
// for the idiom): activeDocument for theme/hover queries, window for blur
// timers, and the bare global createDiv() renderSection's root element uses.
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
};
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// Node's native CustomEvent keeps `detail` behind a prototype getter that
// mini-dom's Object.assign-based dispatchEvent cannot copy — install the
// own-property stand-in (same trick as verify-library-new-note).
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
	type: string;
	detail: unknown;
	bubbles: boolean;
	constructor(type: string, o?: { detail?: unknown; bubbles?: boolean }) {
		this.type = type;
		this.detail = o?.detail;
		this.bubbles = o?.bubbles ?? false;
	}
};

const makeApp = (): App => ({
	vault: {
		getFileByPath: () => null,
		getMarkdownFiles: () => [],
	},
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App);

const makeCard = (over: Partial<DashboardCard> = {}): DashboardCard =>
	({
		id: 'c1',
		type: 'generic',
		column: 'notes',
		title: '卡片',
		body: '',
		tasks: [],
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
		...over,
	} as unknown as DashboardCard);

const makeColumn = (sectionType: string, cards: DashboardCard[], libraryConfig?: LibraryConfig): DashboardColumn =>
	({ id: 'col1', name: sectionType, sectionType, cards, libraryConfig } as unknown as DashboardColumn);

/** Buttons of the card's top-right actions row, in render order. */
const actionButtons = (section: El): El[] => {
	const card = findByClass(section, 'dashboard-card')[0]!;
	const actions = findByClass(card, 'dashboard-card-actions')[0]!;
	return findTag(actions, 'button');
};

const hasNewNote = (btns: El[]): boolean => btns.some(b => b.hasClass('dashboard-card-btn--newnote'));

function main(): void {
	const called: string[] = [];
	const callbacks = {
		onCardNewNote: (cardId: string) => { called.push(cardId); },
	} as unknown as RenderCallbacks;
	const app = makeApp();

	// 1. notes section (无封面): new-note button is FIRST in the actions row,
	//    ahead of the pre-existing edit + delete pair; clicking reports the id.
	{
		const section = renderSection(makeColumn('notes', [makeCard()]), callbacks, app) as unknown as El;
		assert.equal(findByClass(section, 'dashboard-card--cover').length, 0, '1: notes cards stay cover-less');
		const btns = actionButtons(section);
		assert.equal(btns.length, 3, '1: three action buttons (new note, edit, delete)');
		assert.ok(btns[0]!.hasClass('dashboard-card-btn--newnote'), '1: new note renders leftmost');
		assert.ok(!btns[1]!.hasClass('dashboard-card-btn--newnote'), '1: edit stays in the middle');
		assert.ok(btns[2]!.hasClass('dashboard-card-btn--danger'), '1: delete stays rightmost');
		btns[0]!.click();
		assert.deepEqual(called, ['c1'], '1: click fires onCardNewNote with the card id');
	}

	// 2. projects section (有封面): same button on cover cards.
	{
		const section = renderSection(makeColumn('projects', [makeCard()]), callbacks, app) as unknown as El;
		assert.ok(findByClass(section, 'dashboard-card--cover').length > 0, '2: projects cards carry a cover');
		const btns = actionButtons(section);
		assert.equal(btns.length, 3, '2: three action buttons');
		assert.ok(btns[0]!.hasClass('dashboard-card-btn--newnote'), '2: new note renders leftmost');
	}

	// 3. Memo cards (generic note styling) and sticky sections keep their
	//    original action sets — no new-note button leaks in.
	{
		const memo = renderSection(makeColumn('memo', [makeCard()]), callbacks, app) as unknown as El;
		assert.ok(!hasNewNote(actionButtons(memo)), '3: memo card has no new-note button');
		const sticky = renderSection(makeColumn('sticky', [makeCard()]), callbacks, app) as unknown as El;
		assert.ok(!hasNewNote(actionButtons(sticky)), '3: sticky project card has no new-note button');
	}

	// 4. A task card inside a notes section is not project-like: no button.
	{
		const section = renderSection(
			makeColumn('notes', [makeCard({ id: 't1', type: 'task' })]),
			callbacks,
			app,
		) as unknown as El;
		assert.ok(!hasNewNote(actionButtons(section)), '4: task card has no new-note button');
	}

	// 5. Header settings gear: rendered on notes/projects sections, dispatches
	//    the config event with the column name (view.ts opens the settings
	//    modal); memo sections keep their original header buttons.
	{
		let eventDetail: { columnName?: string } | undefined;
		const section = renderSection(makeColumn('notes', [makeCard()]), callbacks, app) as unknown as El;
		(section as unknown as {
			addEventListener: (type: string, fn: (ev: { detail?: { columnName?: string } }) => void) => void;
		}).addEventListener('dashboard-library-config', (ev) => { eventDetail = ev.detail; });

		const gear = findTag(section, 'button').find(b => b.getAttribute('aria-label') === '分区设置');
		assert.ok(gear, '5: settings gear rendered on notes section');
		gear!.click();
		assert.equal(eventDetail?.columnName, 'notes', '5: gear dispatches the config event with column name');

		const projects = renderSection(makeColumn('projects', [makeCard()]), callbacks, app) as unknown as El;
		const gear2 = findTag(projects, 'button').find(b => b.getAttribute('aria-label') === '分区设置');
		assert.ok(gear2, '5: settings gear rendered on projects section');

		const memo = renderSection(makeColumn('memo', [makeCard()]), callbacks, app) as unknown as El;
		assert.ok(!findTag(memo, 'button').some(b => b.getAttribute('aria-label') === '分区设置'), '5: memo section has no gear');
	}

	// 6. sectionNewNoteFolder: the configured save folder wins (trimmed);
	//    unset config means vault root (empty string).
	{
		assert.equal(sectionNewNoteFolder({ filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true, folders: [' /Projects/Sub/ '] }), 'Projects/Sub', '6: configured folder trimmed');
		assert.equal(sectionNewNoteFolder({ filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true, folders: [] }), '', '6: empty folders = vault root');
		assert.equal(sectionNewNoteFolder(undefined), '', '6: no config = vault root');
	}

	// 7. NotesSectionConfigModal: current values prefill, save returns the
	//    (trimmed) inputs — the browse pickers write into the same inputs.
	{
		const saved: Array<{ templatePath: string; folder: string }> = [];
		const modal = new NotesSectionConfigModal(
			app,
			{ templatePath: 'Templates/note.md', folder: 'Projects' },
			(settings) => { saved.push(settings); },
		);
		modal.onOpen();
		const content = modal.contentEl as unknown as El;
		const inputs = findTag(content, 'input');
		assert.equal(inputs.length, 2, '7: template + folder inputs rendered');
		assert.equal(inputs[0]!.value, 'Templates/note.md', '7: template prefilled');
		assert.equal(inputs[1]!.value, 'Projects', '7: folder prefilled');

		inputs[0]!.value = '  T2.md  ';
		const saveBtn = findTag(content, 'button').filter(b => b.textContent === '保存')[0]
			?? findTag(content, 'button').filter(b => b.textContent === 'Save')[0]!;
		saveBtn.click();
		assert.deepEqual(saved, [{ templatePath: 'T2.md', folder: 'Projects' }], '7: save emits trimmed input values');
	}

	console.log('verify-card-new-note: all 7 checks passed');
}

main();
