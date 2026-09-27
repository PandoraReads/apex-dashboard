/**
 * Verifies the unified notes-section cover toggle (the retired separate
 * "notes"/无封面 section type):
 *
 * 1. Legacy migration: frontmatter `type: notes` (and the bare `## notes`
 *    heading-name fallback) parse as projects + showCover:false, so old
 *    dashboards render exactly as before; serialize persists
 *    `type: projects` + `showCover: false` and the round trip is stable.
 * 2. Default projects sections keep covers and write no showCover key.
 * 3. Rendering: showCover:false cards carry no cover markup but keep the
 *    retired type's other affordances (per-card new-note button, header
 *    settings gear); sticky per-card noteStyle still decides on its own.
 * 4. AddSectionModal no longer offers the 'notes' type.
 * 5. NotesSectionConfigModal: the show-cover checkbox prefills from the
 *    current setting and save returns the edited value.
 * 6. SyncEngine.updateNotesSectionConfig persists templates + folder +
 *    showCover together; new cards in a coverless section keep the legacy
 *    笔记本 default title, covered ones keep 新项目.
 * 7. Dragging a card into a sticky section stays 'plain' when the source
 *    section is coverless, 'cover' when it shows covers.
 *
 * Run: `npm run test:notes-cover`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import type { DashboardCard, DashboardColumn, RenderCallbacks } from '../src/types';
import { El, findByClass, findTag } from './mini-dom';
import { parse, serialize } from '../src/parser';
import { renderSection } from '../src/renderer';
import { moveDashboardCard } from '../src/card-move';
import { SECTION_TYPE_OPTIONS } from '../src/add-section-modal';
import { NotesSectionConfigModal } from '../src/notes-config-modal';
import { SyncEngine } from '../src/sync';
import { t } from '../src/i18n';
import type { DashboardSettings } from '../src/types';

// Obsidian globals absent in Node (see verify-card-new-note for the idiom).
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
		type: 'project',
		column: 'X',
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
		coverImage: 'cover.png',
		width: 0,
		size: 'M',
		gridCols: 0,
		gridRows: 0,
		gridCol: 0,
		gridRow: 0,
		...over,
	} as unknown as DashboardCard);

const makeColumn = (over: Partial<DashboardColumn> = {}): DashboardColumn =>
	({ name: 'X', color: '', sectionType: 'projects', cards: [makeCard()], ...over } as unknown as DashboardColumn);

const callbacks = {} as unknown as RenderCallbacks;

function main(): void {
	const app = makeApp();

	// 1. Legacy migration: `type: notes` columns (explicit and heading-name
	//    fallback) become projects + showCover:false; serialize persists the
	//    migrated form and re-parsing it is stable.
	{
		const data = parse(`---
columns:
  - name: 摘记
    type: notes
  - name: 项目
    type: projects
  - name: notes
---
## 摘记
### 卡A
id: n1
type: project
## 项目
### 卡B
id: p1
type: project
## notes
### 卡C
id: n2
type: project
`);
		const byName = (name: string) => data.columns.find(c => c.name === name)!;
		assert.equal(byName('摘记').sectionType, 'projects', '1: explicit notes column migrates to projects');
		assert.equal(byName('摘记').showCover, false, '1: migrated column opts out of covers');
		assert.equal(byName('项目').sectionType, 'projects', '1: projects column unchanged');
		assert.equal(byName('项目').showCover, undefined, '1: projects column keeps the cover default');
		assert.equal(byName('notes').sectionType, 'projects', '1: heading-name fallback migrates too');
		assert.equal(byName('notes').showCover, false, '1: heading-name fallback opts out of covers');

		const out = serialize(data);
		assert.match(out, /- name: 摘记\n    color: "#6366f1"\n    type: projects\n    showCover: false/, '1: serialize writes type projects + showCover false');
		assert.doesNotMatch(out, /type: notes\b/, '1: serialize never writes the retired type');
		const again = serialize(parse(out));
		assert.equal(again, out, '1: migration round trip is stable');
	}

	// 2. Default sections: no showCover key on disk, cover markup rendered.
	{
		const section = renderSection(makeColumn(), callbacks, app) as unknown as El;
		assert.ok(findByClass(section, 'dashboard-card--cover').length > 0, '2: default projects card carries a cover');
		assert.ok(findByClass(section, 'dashboard-project-cover').length > 0, '2: cover element rendered');
		const out = serialize({ banner: { quote: '', author: '' } as never, quickActions: [], columns: [makeColumn()] });
		assert.doesNotMatch(out, /showCover/, '2: default writes no showCover key');
	}

	// 3. Coverless rendering: no cover markup, but the per-card new-note
	//    button and header settings gear survive; sticky noteStyle still
	//    decides per card. The parse→render bridge proves an old `type: notes`
	//    section renders coverless through the whole pipeline.
	{
		const parsed = parse(`---
columns:
  - name: 摘记
    type: notes
---
## 摘记
### 卡A
id: n1
type: project
`);
		const fromDisk = renderSection(parsed.columns[0]!, callbacks, app) as unknown as El;
		assert.equal(findByClass(fromDisk, 'dashboard-card--cover').length, 0, '3: parsed legacy notes section renders coverless');

		const section = renderSection(makeColumn({ showCover: false }), callbacks, app) as unknown as El;
		assert.equal(findByClass(section, 'dashboard-card--cover').length, 0, '3: coverless card has no cover class');
		assert.equal(findByClass(section, 'dashboard-project-cover').length, 0, '3: no cover element rendered');
		const gearLabel = t('notesCfg.title');
		assert.ok(findTag(section, 'button').some(b => b.getAttribute('aria-label') === gearLabel), '3: settings gear still rendered');
		assert.ok(findByClass(section, 'dashboard-card-btn--newnote').length > 0, '3: per-card new-note button still rendered');

		const sticky = renderSection(makeColumn({ sectionType: 'sticky', cards: [makeCard({ noteStyle: 'plain' }), makeCard({ id: 'c2', noteStyle: 'cover' })] }), callbacks, app) as unknown as El;
		const stickyCards = findByClass(sticky, 'dashboard-card');
		assert.equal(stickyCards.filter(c => c.hasClass('dashboard-card--cover')).length, 1, '3: sticky decides covers per card noteStyle');
	}

	// 4. The add-section picker no longer offers the retired type.
	{
		assert.ok(!SECTION_TYPE_OPTIONS.some(o => o.value === 'notes'), '4: picker has no notes option');
		assert.ok(SECTION_TYPE_OPTIONS.some(o => o.value === 'projects'), '4: picker still offers projects');
	}

	// 5. Config modal: checkbox prefills, unchecking flows into the save payload.
	{
		const saved: Array<{ templatePaths: string[]; folder: string; showCover: boolean }> = [];
		const modal = new NotesSectionConfigModal(
			app,
			{ templatePaths: [], folder: '', showCover: false },
			(settings) => { saved.push(settings); },
		);
		modal.onOpen();
		const content = modal.contentEl as unknown as El;
		const box = findTag(content, 'input').find(i => i.getAttribute('type') === 'checkbox')!;
		assert.ok(box, '5: show-cover checkbox rendered');
		assert.equal(box.checked, false, '5: unchecked prefilled for coverless section');

		box.checked = true;
		box.dispatchEvent({ type: 'change', target: box });
		const saveBtn = findTag(content, 'button').find(b => b.textContent === t('common.save'))!;
		saveBtn.click();
		assert.deepEqual(saved[saved.length - 1]?.showCover, true, '5: save returns the toggled value');
	}

	// 7. Sticky conversion keys off the source section's cover setting.
	{
		const boardWith = (source: DashboardColumn) => ({ banner: {} as never, quickActions: [], columns: [
			source,
			makeColumn({ name: '便签', sectionType: 'sticky', cards: [] }),
		] } as never);
		const plain = moveDashboardCard(boardWith(makeColumn({ name: '无封面', showCover: false })) as never, 'c1', '便签', 0);
		assert.equal(plain.columns[1]!.cards[0]!.noteStyle, 'plain', '7: coverless source drags in as plain');
		const cover = moveDashboardCard(boardWith(makeColumn({ name: '有封面' })) as never, 'c1', '便签', 0);
		assert.equal(cover.columns[1]!.cards[0]!.noteStyle, 'cover', '7: covered source drags in as cover');
	}

	console.log('verify-notes-cover: parser migration, rendering, picker, modal and move checks passed');
}

main();

async function verifySync(): Promise<void> {
	const initial = `---
columns:
  - name: 摘记
    type: notes
  - name: Projects
    type: projects
---
## 摘记
### 卡A
id: n1
type: project
## Projects
### 卡B
id: p1
type: project
`;
	let disk = initial;
	const file = Object.assign(new TFile(), { path: 'test-board.md', basename: 'test-board' });
	const app = { vault: {
		getFileByPath: () => file,
		read: async () => disk,
		modify: async (_file: unknown, text: string) => { disk = text; },
		on: () => ({}), offref: () => {},
		adapter: { exists: async () => true, write: async () => {}, list: async () => ({ files: [] }) },
	} } as unknown as App;
	const sync = new SyncEngine(app, { dashboardFile: 'test-board' } as DashboardSettings);
	await sync.init();

	// 6a. Saving settings without touching the checkbox keeps the section
	//     coverless (showCover persisted as false, not dropped).
	await sync.updateNotesSectionConfig('摘记', {
		filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true,
		templatePaths: ['Templates/note.md'], folders: ['摘记笔记'],
	}, false);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.match(disk, /templatePaths:/, '6a: templates persisted');
	assert.match(disk, /- "摘记笔记"/, '6a: folder persisted');
	assert.match(disk, /type: projects\n    showCover: false/, '6a: coverless opt-out persisted');
	assert.equal(parse(disk).columns.find(c => c.name === '摘记')?.showCover, false, '6a: re-parse keeps showCover false');

	// 6b. Default card titles: coverless keeps the legacy 笔记本, covered
	//     keeps the projects default.
	await sync.addCard('摘记');
	await new Promise<void>(resolve => setImmediate(resolve));
	const titles = parse(disk).columns.find(c => c.name === '摘记')!.cards.map(c => c.title);
	assert.ok(titles.includes(t('sync.notesTitle')), '6b: coverless default title preserved');

	// 6c. Re-checking covers drops the opt-out from disk.
	await sync.updateNotesSectionConfig('摘记', {
		filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true,
	}, true);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(parse(disk).columns.find(c => c.name === '摘记')?.showCover, undefined, '6c: default restored');

	await sync.addCard('Projects');
	await new Promise<void>(resolve => setImmediate(resolve));
	const projectTitles = parse(disk).columns.find(c => c.name === 'Projects')!.cards.map(c => c.title);
	assert.ok(projectTitles.includes(t('sync.projectTitle')), '6c: covered default title unchanged');

	sync.destroy();
	process.stdout.write('verify-notes-cover: settings persistence and default titles OK\n');
}
void verifySync().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
