import { strict as assert } from 'node:assert';
import { Modal } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import type { App, TFile } from 'obsidian';
import type { DashboardColumn, PipelineConfig, RenderCallbacks } from '../src/types';
import { renderPipelineSection } from '../src/pipeline-section';

// Pipeline board render smoke: stage columns + unfiled column, card chips,
// card/stage skill buttons, drag wiring, and the unconfigured empty state.
// The pure grouping logic is covered by verify-pipeline; this exercises the
// DOM the section actually builds against the mini-dom harness.

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// pipeline-section paces title clicks through window.setTimeout.
(globalThis as { window?: unknown }).window = globalThis;

function fakeFile(path: string, mtime: number): TFile {
	return { path, basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), stat: { mtime } } as unknown as TFile;
}

function makeApp(entries: Array<{ file: TFile; fm: Record<string, unknown> }>): App {
	const byPath = new Map(entries.map(({ file, fm }) => [file.path, fm]));
	const renames: Array<{ from: string; to: string }> = [];
	(globalThis as Record<string, unknown>).__pipeRenames = renames;
	return {
		vault: {
			getMarkdownFiles: () => entries.map(e => e.file),
			getAbstractFileByPath: () => null,
			createFolder: async () => {},
		},
		__renames: renames,
		metadataCache: {
			getFileCache: (f: TFile) => {
				const fm = byPath.get(f.path);
				return fm ? { frontmatter: fm } : null;
			},
		},
		fileManager: {
			processFrontMatter: async () => {},
			renameFile: async (file: { path: string }, to: string) => { renames.push({ from: file.path, to }); },
			trashFile: async () => {},
		},
		plugins: { plugins: {} },
	} as unknown as App;
}

const callbacks = { onOpenNoteInPopover: () => {} } as unknown as RenderCallbacks;

const config: PipelineConfig = {
	rootFolder: '内容创作',
	statusField: 'status',
	stages: [
		{ value: 'idea', label: '选题', color: '#f59e0b' },
		{ value: 'draft', label: '草稿', color: '#3b82f6', folder: '02-草稿' },
	],
	skills: [
		{ id: 's1', label: '搜集选题', icon: 'lightbulb', agent: 'claudian', stage: 'idea', scope: 'stage', skillName: 'gen-topics', promptTemplate: '' },
		{ id: 's2', label: '写草稿', icon: 'pencil', agent: 'claudian', stage: 'draft', scope: 'card', skillName: 'write-draft', promptTemplate: '$write-draft\n\n文件: {path}' },
	],
};

function pipelineColumn(cfg?: PipelineConfig): DashboardColumn {
	return { name: '内容流水线', color: '#10b981', sectionType: 'pipeline', cards: [], ...(cfg ? { pipelineConfig: cfg } : {}) };
}

async function main(): Promise<void> {
	const app = makeApp([
		{ file: fakeFile('内容创作/01-选题/对标拆解.md', 100), fm: { status: 'idea', tags: ['小红书'], platform: '小红书', 栏目: '方法论' } },
		{ file: fakeFile('内容创作/02-草稿/流量密码.md', 200), fm: { status: 'draft' } },
		{ file: fakeFile('内容创作/随笔.md', 300), fm: {} },
		{ file: fakeFile('其他/x.md', 400), fm: { status: 'idea' } },
	]);

	const host = new El('div');
	renderPipelineSection(host as unknown as HTMLElement, pipelineColumn(config), app, callbacks, null);

	// STRICT scope: only the two stage columns render. The statusless note
	// inside the root and the matching note outside it never appear.
	const cols = findByClass(host, 'dashboard-pipeline-col');
	assert.equal(cols.length, 2, 'stage columns only, no catch-all column');
	// Trello-style header: bare label + a separate count badge.
	const titles = findByClass(host, 'dashboard-pipeline-col-title').map(el => el.textContent);
	assert.deepEqual(titles.sort(), ['草稿', '选题']);
	const counts = findByClass(host, 'dashboard-pipeline-col-count').map(el => el.textContent);
	assert.deepEqual(counts.sort(), ['1', '1']);

	// One ghost "add card" button per column (list bottom).
	assert.equal(findByClass(host, 'dashboard-pipeline-col-add').length, 2, 'add-card at every column bottom');

	// Cards: idea card (chips: platform + tag), draft card (no chips).
	// All draggable (desktop stub Platform.isMobile=false); each carries a
	// stage-color label strip (Trello label idiom).
	const cards = findByClass(host, 'dashboard-pipeline-card');
	assert.equal(cards.length, 2, 'unmatched notes are invisible');
	assert.equal(findByClass(host, 'dashboard-pipeline-card-label').length, 0, 'no per-card color strip (columns carry the stage)');
	// Footer: due + checklist + archive buttons on every card (left), skills right.
	assert.equal(findByClass(host, 'dashboard-pipeline-foot-btn').length, 4, 'due + checklist per card');
	assert.equal(findByClass(host, 'dashboard-pipeline-todo-toggle').length, 2, 'checklist toggle per card');
	assert.equal(findByClass(host, 'dashboard-pipeline-archive-btn').length, 2, 'archive button per card');
	assert.ok(cards.every(c => c.getAttribute('draggable') === 'true'), 'cards draggable on desktop');
	const cardTitles = cards.map(c => c.textContent);
	assert.ok(cardTitles.some(t => t.includes('对标拆解')), 'idea card rendered');
	assert.ok(!cardTitles.some(t => t.includes('随笔')), 'statusless note not rendered');
	// Filter rail: platform values exist on the idea card, so the rail lists
	// them (dimension defaults to platform); nothing selected.
	const rail = findByClass(host, 'dashboard-pipeline-rail');
	assert.equal(rail.length, 1, 'filter rail rendered when values exist');
	assert.equal(findByClass(rail[0]!, 'dashboard-pipeline-rail-item').length, 2, '"All" + one platform value');
	const railItemsAll = findByClass(host, 'dashboard-pipeline-rail-item');
	assert.ok(railItemsAll.length > 0 && (railItemsAll[0]!.className ?? '').includes('is-active'), '"All" is the active default');
	assert.ok((railItemsAll[0]!.textContent ?? '').includes('全部'), 'first rail entry is All');

	const chips = findByClass(host, 'dashboard-pipeline-chip');
	assert.equal(chips.length, 2, 'platform chip + tag chip on the idea card only');

	// Skill buttons: 1 stage-scope (idea head) + 1 card-scope (draft card).
	const skillBtns = findByClass(host, 'dashboard-pipeline-skill-btn');
	assert.equal(skillBtns.length, 2);

	// Card-scope direct send (per-skill flag): fires without the preview
	// modal; the legacy section-wide flag only fills in for unset skills.
	{
		const spyModal = (Modal as unknown as { last: unknown });
		const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
		const hostA = new El('div');
		renderPipelineSection(hostA as unknown as HTMLElement, pipelineColumn({ ...config, skills: config.skills.map(s => s.id === 's2' ? { ...s, directSend: true } : s) }), app, callbacks, null);
		spyModal.last = null;
		// The card-scope button lives inside the draft card's foot.
		const draftCard = findByClass(hostA, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('流量密码'))!;
		const cardBtn = findByClass(draftCard, 'dashboard-pipeline-skill-btn')[0]!;
		cardBtn.click();
		await wait(30);
		assert.ok(!spyModal.last, 'per-skill directSend fires without the preview modal');

		const hostB = new El('div');
		renderPipelineSection(hostB as unknown as HTMLElement, pipelineColumn({ ...config, directSend: true, skills: config.skills.map(s => s.id === 's2' ? { ...s, directSend: false } : s) }), app, callbacks, null);
		spyModal.last = null;
		const draftCardB = findByClass(hostB, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('流量密码'))!;
		findByClass(draftCardB, 'dashboard-pipeline-skill-btn')[0]!.click();
		await wait(30);
		assert.ok(spyModal.last, 'explicit per-skill false beats the legacy section-wide flag');
	}

	// Both stages have items here; Trello empty lists show no placeholder.

	// --- Unconfigured column: empty state + configure entry point. Both a
	//     missing config and a missing root folder must land here (an unset
	//     root would otherwise scan the whole vault). ---
	const host2 = new El('div');
	renderPipelineSection(host2 as unknown as HTMLElement, pipelineColumn(), app, callbacks, null);
	assert.equal(findByClass(host2, 'dashboard-pipeline-empty').length, 1);
	assert.equal(findByClass(host2, 'dashboard-pipeline-empty-hint').length, 1);
	const emptyEl = findByClass(host2, 'dashboard-pipeline-empty')[0]!;
	assert.ok(findTag(emptyEl, 'button').length > 0, 'configure button present');
	// Double-click the card title -> inline input -> Enter renames the file.
	const titleEl = findByClass(host, 'dashboard-pipeline-card-title')
		.find(el => (el.textContent ?? '').includes('对标拆解'))!;
	assert.ok(titleEl, 'title to rename');
	titleEl.dispatchEvent({ type: 'dblclick', target: titleEl });
	const edit = findTag(titleEl, 'input')[0] as (El & { value: string }) | undefined;
	assert.ok(edit, 'inline rename input opens');
	edit!.value = '对标拆解·升级版';
	edit!.dispatchEvent({ type: 'keydown', key: 'Enter', target: edit! });
	await new Promise(r => setTimeout(r, 10));
	assert.deepEqual((app as unknown as { __renames: Array<{ from: string; to: string }> }).__renames, [
		{ from: '内容创作/01-选题/对标拆解.md', to: '内容创作/01-选题/对标拆解·升级版.md' },
	], 'Enter commits the file rename');

	// --- Title gestures (fresh board, recording open callback): single click
	//     opens the note after the disambiguation delay, double click claims
	//     the burst for rename, and blank card areas never open anything. ---
	const opened: string[] = [];
	const recording = { onOpenNoteInPopover: (f: TFile) => { opened.push(f.path); } } as unknown as RenderCallbacks;
	const hostG = new El('div');
	renderPipelineSection(hostG as unknown as HTMLElement, pipelineColumn(config), app, recording, null);
	const gCard = findByClass(hostG, 'dashboard-pipeline-card')[0]!;
	const gTitle = findByClass(hostG, 'dashboard-pipeline-card-title')[0]!;
	const settle = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

	// Blank card click: the old accidental-open path is gone.
	gCard.dispatchEvent({ type: 'click', target: gCard });
	await settle(360);
	assert.equal(opened.length, 0, 'blank card click never opens the note');

	// Double click on the title: rename claims the gesture, no open fires.
	gTitle.dispatchEvent({ type: 'click', target: gTitle, detail: 1 });
	gTitle.dispatchEvent({ type: 'dblclick', target: gTitle });
	const gEdit = findTag(gTitle, 'input')[0] as (El & { value: string }) | undefined;
	assert.ok(gEdit, 'double click still starts the inline rename');
	gEdit!.dispatchEvent({ type: 'keydown', key: 'Escape', target: gEdit! });
	await settle(360);
	assert.equal(opened.length, 0, 'double click renames instead of opening');

	// Single click on the title: opens once the delay grants the gesture.
	gTitle.dispatchEvent({ type: 'click', target: gTitle, detail: 1 });
	assert.equal(opened.length, 0, 'single click does not open synchronously');
	await settle(360);
	assert.deepEqual(opened, ['内容创作/01-选题/对标拆解.md'], 'single click opens the note after the delay');

	// Custom filter dimensions: config picks 栏目 → the rail lists its values
	// and shows the property's own name as the (single) dimension.
	const hostCustom = new El('div');
	renderPipelineSection(hostCustom as unknown as HTMLElement, pipelineColumn({ ...config, filterFields: ['栏目'] }), app, callbacks, null);
	const customRail = findByClass(hostCustom, 'dashboard-pipeline-rail');
	assert.equal(customRail.length, 1, 'rail renders for a custom dimension');
	assert.equal(findByClass(customRail[0]!, 'dashboard-pipeline-rail-dims').length, 0, 'single dimension hides the switcher');
	const customItems = findByClass(customRail[0]!, 'dashboard-pipeline-rail-item');
	assert.ok(customItems.length >= 2, 'All + the 栏目 value listed');

	// Default skin is 马卡龙 (trello) even without an explicit boardStyle.
	assert.equal(findByClass(host, 'dashboard-pipeline--trello').length, 1, 'default config renders the trello skin');

	// Trello skin: config boardStyle wraps the board with the modifier class.
	const hostTrello = new El('div');
	renderPipelineSection(hostTrello as unknown as HTMLElement, pipelineColumn({ ...config, boardStyle: 'trello' }), app, callbacks, null);
	assert.equal(findByClass(hostTrello, 'dashboard-pipeline--trello').length, 1, 'trello skin class applied on the board body');

	const hostSolid = new El('div');
	renderPipelineSection(hostSolid as unknown as HTMLElement, pipelineColumn({ ...config, boardStyle: 'solid' }), app, callbacks, null);
	assert.equal(findByClass(hostSolid, 'dashboard-pipeline--solid').length, 1, 'solid skin class applied');

	const hostBlush = new El('div');
	renderPipelineSection(hostBlush as unknown as HTMLElement, pipelineColumn({ ...config, boardStyle: 'blush' }), app, callbacks, null);
	assert.equal(findByClass(hostBlush, 'dashboard-pipeline--blush').length, 1, 'blush skin class applied');

	const host3 = new El('div');
	renderPipelineSection(host3 as unknown as HTMLElement, pipelineColumn({ ...config, rootFolder: '' }), app, callbacks, null);
	assert.equal(findByClass(host3, 'dashboard-pipeline-empty').length, 1, 'empty root folder stays unconfigured');
}

void main();
