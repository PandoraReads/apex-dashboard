import { strict as assert } from 'node:assert';
import { Menu, Modal, Notice } from 'obsidian';
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
	// `name` (filename with extension) matters to the archive flow — the
	// target path is built from it, exactly like a real TFile.
	const filename = path.slice(path.lastIndexOf('/') + 1);
	return { path, name: filename, basename: filename.replace(/\.md$/, ''), stat: { mtime } } as unknown as TFile;
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
			// Cards-view body-image scrape reads note content; empty keeps the
			// cover chain falling through to the placeholder.
			cachedRead: async () => '',
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
	assert.equal(findByClass(host, 'dashboard-pipeline-col-collapse').length, 0, 'stage columns do not have collapse controls');

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
	const resized: Array<{ stageValue: string; width: number }> = [];
	host.addEventListener('dashboard-pipeline-col-width', (event: { detail: { stageValue: string; width: number } }) => resized.push(event.detail));
	const resizeHandle = findByClass(cols[1]!, 'dashboard-pipeline-col-resize')[0]!;
	const pointerDocument = { body: host, addEventListener: () => {}, removeEventListener: () => {} };
	resizeHandle.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 0, pointerId: 1, view: { document: pointerDocument } });
	const resizeShield = findByClass(host, 'dashboard-drag-shield')[0]!;
	resizeShield.dispatchEvent({ type: 'pointermove', clientX: 300, pointerId: 1 });
	resizeShield.dispatchEvent({ type: 'pointerup', clientX: 300, pointerId: 1 });
	assert.equal(cols[1]!.style.width, '300px', 'column width tracks pointer movement');
	assert.equal(resized[0]?.width, 300, 'column width is emitted for persistence');
	const shrinkHandle = findByClass(cols[0]!, 'dashboard-pipeline-col-resize')[0]!;
	shrinkHandle.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 200, pointerId: 2, view: { document: pointerDocument } });
	findByClass(host, 'dashboard-drag-shield')[0]!.dispatchEvent({ type: 'pointermove', clientX: 145, pointerId: 2 });
	findByClass(host, 'dashboard-drag-shield')[0]!.dispatchEvent({ type: 'pointerup', clientX: 145, pointerId: 2 });
	assert.equal(resized[1]?.width, 160, 'column can shrink to the lower width limit');

	const manualItems = [
		{ file: fakeFile('内容创作/a.md', 10), fm: { status: 'idea' } },
		{ file: fakeFile('内容创作/b.md', 20), fm: { status: 'idea' } },
		{ file: fakeFile('内容创作/c.md', 30), fm: { status: 'idea' } },
	];
	const manualHost = new El('div');
	const manualConfig: PipelineConfig = { ...config, sortBy: 'manual', stageOrder: { idea: ['内容创作/b.md', '内容创作/a.md'] } };
	const manualApp = makeApp(manualItems);
	const savedOrders: string[][] = [];
	manualHost.addEventListener('dashboard-pipeline-manual-order', (event: { detail: { orderedPaths: string[] } }) => savedOrders.push(event.detail.orderedPaths));
	renderPipelineSection(manualHost as unknown as HTMLElement, pipelineColumn(manualConfig), manualApp, callbacks, null);
	const ideaCol = findByClass(manualHost, 'dashboard-pipeline-col').find(col => col.dataset.stage === 'idea')!;
	const cardsHost = findByClass(ideaCol, 'dashboard-pipeline-cards')[0]!;
	const orderBefore = Array.from(cardsHost.children).map(card => card.dataset.path);
	assert.deepEqual(orderBefore, ['内容创作/b.md', '内容创作/a.md', '内容创作/c.md'], 'manual sort restores saved card order and appends new cards');
	const dragCard = Array.from(cardsHost.children).find(card => card.dataset.path === '内容创作/c.md')!;
	const firstCard = cardsHost.children[0]!;
	const transfer = { types: ['application/x-apex-libcard'], effectAllowed: '', dropEffect: '', setData: () => {} };
	dragCard.dispatchEvent({ type: 'dragstart', target: dragCard, dataTransfer: transfer });
	firstCard.dispatchEvent({ type: 'dragover', target: firstCard, dataTransfer: transfer, clientY: -1, clientX: 0 });
	assert.ok(firstCard.hasClass('dashboard-pipeline-card--drop-above'), 'manual reorder shows the insertion position above the hovered card');
	ideaCol.dispatchEvent({ type: 'drop', target: ideaCol, dataTransfer: transfer });
	assert.ok(!firstCard.hasClass('dashboard-pipeline-card--drop-above'), 'insertion cue clears after drop');
	assert.deepEqual(savedOrders[0], ['内容创作/c.md', '内容创作/b.md', '内容创作/a.md'], 'manual drag emits the new in-column order for persistence');
	const cardTitles = cards.map(c => c.textContent);
	assert.ok(cardTitles.some(t => t.includes('对标拆解')), 'idea card rendered');
	assert.ok(!cardTitles.some(t => t.includes('随笔')), 'statusless note not rendered');
	// Filter rail: platform values exist on the idea card, so the platform
	// dimension renders as a DROPDOWN button (2026-11-16 round two: value
	// chips moved into the button's menu); the 阶段 group leads the bar.
	const rail = findByClass(host, 'dashboard-pipeline-rail');
	assert.equal(rail.length, 1, 'filter rail rendered when values exist');
	assert.equal(findByClass(rail[0]!, 'dashboard-pipeline-rail-stage').length, 2, 'one stage chip per configured stage');
	assert.equal(findByClass(rail[0]!, 'dashboard-pipeline-rail-value').length, 0, 'value chips live in the dropdown menu, not the bar');
	const dropButtons = findByClass(rail[0]!, 'dashboard-pipeline-rail-drop');
	assert.equal(dropButtons.length, 1, 'one dropdown per dimension WITH values (project is empty → hidden)');
	assert.ok((dropButtons[0]!.textContent ?? '').includes('平台'), 'button carries the dimension label');
	assert.equal(findByClass(rail[0]!, 'dashboard-pipeline-rail-item').length, 4, 'stage-All + 2 stages + the drop button');
	// Round four: the search sits at the bar's RIGHT zone, left of the
	// value dropdowns — rail children: [stages][search][drops cluster].
	const railChildren = rail[0]!.children as unknown as El[];
	assert.equal((railChildren[0]!.className ?? '').includes('dashboard-pipeline-rail-stages'), true, 'stage group leads the bar');
	assert.equal((railChildren[1]!.className ?? '').includes('dashboard-pipeline-search'), true, 'search sits between stages and the dropdowns');
	assert.equal((railChildren[2]!.className ?? '').includes('dashboard-pipeline-rail-drops'), true, 'dropdown cluster closes the bar');
	const dropsCluster = findByClass(rail[0]!, 'dashboard-pipeline-rail-drops')[0]!;
	assert.ok(dropsCluster, 'dropdowns cluster on the right');
	assert.equal(findByClass(dropsCluster, 'dashboard-pipeline-rail-drop').length, 1, 'drop buttons live inside the cluster');
	assert.equal(findByClass(dropsCluster, 'dashboard-pipeline-rail-divider').length, 1, 'divider leads the cluster');
	const railItemsAll = findByClass(host, 'dashboard-pipeline-rail-item');
	assert.ok(railItemsAll.length > 0 && (railItemsAll[1]!.className ?? '').includes('is-active') === false, 'no stray active states');
	assert.ok((findByClass(rail[0]!, 'dashboard-pipeline-rail-stages')[0]!.children[0] as unknown as El)?.textContent?.includes('全部'), 'stage group opens with All');
	assert.equal(findByClass(rail[0]!, 'dashboard-pipeline-search').length, 1, 'search box embedded in the rail');

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
	await settle(800);
	assert.equal(opened.length, 0, 'blank card click never opens the note');

	// Double click on the title: rename claims the gesture, no open fires.
	gTitle.dispatchEvent({ type: 'click', target: gTitle, detail: 1 });
	gTitle.dispatchEvent({ type: 'dblclick', target: gTitle });
	const gEdit = findTag(gTitle, 'input')[0] as (El & { value: string }) | undefined;
	assert.ok(gEdit, 'double click still starts the inline rename');
	gEdit!.dispatchEvent({ type: 'keydown', key: 'Escape', target: gEdit! });
	await settle(800);
	assert.equal(opened.length, 0, 'double click renames instead of opening');

	// Single click on the title: opens once the delay grants the gesture.
	gTitle.dispatchEvent({ type: 'click', target: gTitle, detail: 1 });
	assert.equal(opened.length, 0, 'single click does not open synchronously');
	await settle(800);
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

	// --- Progressive render: first PIPELINE_COLUMN_PAGE_SIZE cards + a
	// load-more pill; the pill expands the column in place. Distinct column
	// name so the module-level limit map never bleeds into the blocks above.
	{
		const many: Array<{ file: TFile; fm: Record<string, unknown> }> = [];
		for (let i = 1; i <= 25; i++) {
			many.push({ file: fakeFile(`内容创作/01-选题/选题${i}.md`, 1000 + i), fm: { status: 'idea' } });
		}
		const appMany = makeApp(many);
		const hostMany = new El('div');
		renderPipelineSection(hostMany as unknown as HTMLElement, { ...pipelineColumn(config), name: '大量流水线' }, appMany, callbacks, null);
		const cardsMany = findByClass(hostMany, 'dashboard-pipeline-card');
		assert.equal(cardsMany.length, 20, 'column renders only the first page of items');
		const pill = findByClass(hostMany, 'dashboard-pipeline-load-more');
		assert.equal(pill.length, 1, 'load-more pill appears past the page');
		assert.equal(pill[0]!.getAttribute('data-hidden-count'), '5', 'hidden count in the pill');
		// Count badge still reports the data total, not the rendered slice.
		assert.deepEqual(findByClass(hostMany, 'dashboard-pipeline-col-count').map(el => el.textContent).sort(), ['0', '25']);
		pill[0]!.click();
		assert.equal(findByClass(hostMany, 'dashboard-pipeline-card').length, 25, 'pill expands the column in place');
		assert.equal(findByClass(hostMany, 'dashboard-pipeline-load-more').length, 0, 'pill gone once everything renders');
	}

	// --- Gesture ownership: a press that begins on a button must not start
	// the card's native drag (the skill buttons run their own pointer drag;
	// without the suppression the whole card drags instead — Rae's report).
	{
		const hostG = new El('div');
		renderPipelineSection(hostG as unknown as HTMLElement, pipelineColumn(config), app, callbacks, null);
		const draftCard = findByClass(hostG, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('流量密码'))!;
		const skillBtn = findByClass(draftCard, 'dashboard-pipeline-skill-btn')[0]!;
		const title = findByClass(draftCard, 'dashboard-pipeline-card-title')[0]!;
		let prevented = 0;
		const dragFrom = (pressed: El): void => {
			pressed.dispatchEvent({ type: 'pointerdown', target: pressed });
			draftCard.dispatchEvent({ type: 'dragstart', target: draftCard, preventDefault: () => { prevented += 1; } });
			draftCard.dispatchEvent({ type: 'pointerup', target: draftCard });
		};
		dragFrom(skillBtn);
		assert.equal(prevented, 1, 'dragstart from a button press is cancelled');
		dragFrom(title);
		assert.equal(prevented, 1, 'dragstart from the card body still drags the card');
	}

	// --- Card-skill reorder gesture: move/up ride the DOCUMENT (capture),
	//     not the button. The button-local version died at lostpointercapture —
	//     the card's canceled dragstart still releases pointer capture, and a
	//     22px button can't host a cross-button drag anyway (Rae's "still
	//     cannot reorder" report, verified against real Chromium).
	{
		const docListeners = new Map<string, Array<(ev: unknown) => void>>();
		const docShim = {
			body: new El('body'),
			addEventListener: (type: string, fn: (ev: unknown) => void): void => {
				const list = docListeners.get(type) ?? [];
				list.push(fn);
				docListeners.set(type, list);
			},
			removeEventListener: (type: string, fn: (ev: unknown) => void): void => {
				const list = docListeners.get(type);
				if (!list) return;
				const i = list.indexOf(fn);
				if (i >= 0) list.splice(i, 1);
			},
		};
		(globalThis as Record<string, unknown>).activeDocument = docShim;
		const docDispatch = (type: string, ev: Record<string, unknown>): void => {
			for (const fn of [...(docListeners.get(type) ?? [])]) fn({ type, preventDefault: () => {}, ...ev });
		};

		const reorderCfg: PipelineConfig = {
			...config,
			skills: [
				{ id: 'r1', label: '甲', icon: 'sparkles', agent: 'claudian', stage: 'idea', scope: 'card', skillName: 'a', promptTemplate: '' },
				{ id: 'r2', label: '乙', icon: 'sparkles', agent: 'claudian', stage: 'idea', scope: 'card', skillName: 'b', promptTemplate: '' },
			],
		};
		const hostR = new El('div');
		let orderEvent: { orderedIds?: string[] } | null = null;
		hostR.addEventListener('dashboard-pipeline-skill-order', (ev: unknown) => {
			orderEvent = (ev as { detail: { orderedIds: string[] } }).detail;
		});
		renderPipelineSection(hostR as unknown as HTMLElement, pipelineColumn(reorderCfg), app, callbacks, null);
		const ideaCard = findByClass(hostR, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('对标拆解'))!;
		const foot = findByClass(ideaCard, 'dashboard-pipeline-card-foot')[0]!;
		const btns = findByClass(foot, 'dashboard-pipeline-skill-btn');
		assert.equal(btns.length, 2, 'two card-scope skill buttons on the idea card');
		// Positioned boxes (own-property overrides of the zero-geometry shim):
		// btn0 [0..40], btn1 [40..80], same 22px-tall row.
		btns[0]!.getBoundingClientRect = () => ({ top: 0, right: 40, bottom: 22, left: 0, width: 40, height: 22 });
		btns[1]!.getBoundingClientRect = () => ({ top: 0, right: 80, bottom: 22, left: 40, width: 40, height: 22 });

		// Press btn0 at x=20; a DOCUMENT-level move to x=70 (right half of
		// btn1 — off the pressed button entirely) crosses the threshold and
		// live-swaps; a document-level pointerup commits the order.
		btns[0]!.dispatchEvent({ type: 'pointerdown', pointerType: 'mouse', button: 0, clientX: 20, target: btns[0]! });
		docDispatch('pointermove', { clientX: 70 });
		assert.deepEqual(
			findByClass(foot, 'dashboard-pipeline-skill-btn').map(b => b.dataset.skillId),
			['r2', 'r1'],
			'live-swap drags the pressed button past its sibling',
		);
		docDispatch('pointerup', { clientX: 70 });
		const committed = orderEvent as { orderedIds?: string[] } | null;
		assert.ok(committed, 'document-level pointerup emits the reorder event');
		assert.deepEqual(committed!.orderedIds, ['r2', 'r1'], 'event carries the new arrangement');
		// Gesture teardown: stray doc events after the up fire nothing new.
		let second = false;
		hostR.addEventListener('dashboard-pipeline-skill-order', () => { second = true; });
		docDispatch('pointermove', { clientX: 10 });
		docDispatch('pointerup', { clientX: 10 });
		assert.ok(!second, 'document listeners detach after the gesture');
	}

	// --- Archive (move-first, verified): the file must physically land in
	// the archive folder BEFORE the status stamp. Three shapes: a clean
	// move; an iCloud-style silent rename no-op that the verify+retry heals;
	// and a rename that never lands — status must NOT be stamped so the
	// card stays on the board and the archive can simply be retried.
	{
		const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
		interface ArchiveDrive {
			app: App;
			files: Map<string, TFile>;
			fm: Map<string, Record<string, unknown>>;
			renames: number;
		}
		const makeDrive = (silentNoOps: number): ArchiveDrive => {
			const files = new Map<string, TFile>();
			const fm = new Map<string, Record<string, unknown>>();
			const drive: ArchiveDrive = { app: null as unknown as App, files, fm, renames: 0 };
			let noOps = silentNoOps;
			files.set('内容创作/01-选题/对标拆解.md', fakeFile('内容创作/01-选题/对标拆解.md', 100));
			fm.set('内容创作/01-选题/对标拆解.md', { status: 'idea' });
			const folders = new Set<string>();
			drive.app = {
				vault: {
					getMarkdownFiles: () => [...files.values()],
					getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? ({ path: p } as TFile) : null),
					createFolder: async (p: string) => { folders.add(p); },
				},
				metadataCache: {
					getFileCache: (f: TFile) => {
						const front = fm.get(f.path);
						return front ? { frontmatter: front } : null;
					},
				},
				fileManager: {
					processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
						const front = fm.get(f.path) ?? {};
						fn(front);
						fm.set(f.path, front);
					},
					// Real Obsidian mutates the TFile in place on rename; the
					// silentNoOps counter swallows the first N calls whole
					// (resolve, no effect) to mimic the iCloud failure.
					renameFile: async (f: TFile, to: string) => {
						drive.renames += 1;
						if (noOps > 0) { noOps -= 1; return; }
						const old = f.path;
						(f as unknown as { path: string }).path = to;
						files.delete(old);
						files.set(to, f);
					},
					trashFile: async () => {},
				},
				plugins: { plugins: {} },
			} as unknown as App;
			return drive;
		};
		const archiveCfg = { ...config, archiveFolder: '00_inbox/09-archive/内容生产' };
		// The stub records every toast; the real obsidian.d.ts doesn't type it.
		const noticeTexts = (): string[] => (Notice as unknown as { messages: string[] }).messages;
		const clickArchive = (host: El): void => {
			const card = findByClass(host, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('对标拆解'))!;
			findByClass(card, 'dashboard-pipeline-archive-btn')[0]!.click();
		};
		const original = '内容创作/01-选题/对标拆解.md';
		const target = '00_inbox/09-archive/内容生产/对标拆解.md';

		// A — clean move: file lands, status stamped exactly once.
		{
			const drive = makeDrive(0);
			const hostA = new El('div');
			renderPipelineSection(hostA as unknown as HTMLElement, pipelineColumn(archiveCfg), drive.app, callbacks, null);
			noticeTexts().length = 0;
			clickArchive(hostA);
			await wait(20);
			assert.ok(drive.files.has(target) && !drive.files.has(original), 'clean archive moves the file');
			assert.equal(drive.fm.get(target)!.status, 'archived', 'status stamped after the move');
			assert.ok(noticeTexts().some(m => m.includes('已归档')), 'success notice shown');
		}

		// B — one silent no-op: the verify+retry heals it; end state identical.
		{
			const drive = makeDrive(1);
			const hostB = new El('div');
			renderPipelineSection(hostB as unknown as HTMLElement, pipelineColumn(archiveCfg), drive.app, callbacks, null);
			noticeTexts().length = 0;
			clickArchive(hostB);
			await wait(20);
			assert.ok(!drive.files.has(target), 'no move before the retry wait');
			assert.equal(drive.fm.get(original)!.status, 'idea', 'status untouched while the move is unverified');
			await wait(320);
			assert.ok(drive.files.has(target), 'retry lands the file in the archive folder');
			assert.equal(drive.fm.get(target)!.status, 'archived', 'status stamped once the move held');
			assert.equal(drive.renames, 2, 'exactly one verify retry fired');
		}

		// C — rename never lands: loud failure, status NOT stamped, file
		// stays put — the card remains on the board for a plain retry.
		{
			const drive = makeDrive(99);
			const hostC = new El('div');
			renderPipelineSection(hostC as unknown as HTMLElement, pipelineColumn(archiveCfg), drive.app, callbacks, null);
			noticeTexts().length = 0;
			clickArchive(hostC);
			await wait(20);
			assert.ok(!drive.files.has(target), 'file never moved');
			await wait(340);
			assert.ok(drive.files.has(original), 'file stays at its original path');
			assert.equal(drive.fm.get(original)!.status, 'idea', 'status never stamped on a failed move');
			assert.ok(noticeTexts().some(m => m.includes('未能移入')), 'loud move-failure notice');
			assert.ok(!noticeTexts().some(m => m.includes('已归档')), 'no false success notice');
		}
	}

	// --- Custom action buttons: hover-ghost LEFT of archive (inline right
	// offset on a 24px pitch), click opens a native dropdown of the configured
	// options with the current value checked, and picking one writes that value
	// into the target frontmatter field — no folder move, no rename. ---
	{
		const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
		const files = new Map<string, TFile>();
		const fm = new Map<string, Record<string, unknown>>();
		const reviewPath = '内容创作/02-草稿/流量密码.md';
		files.set(reviewPath, fakeFile(reviewPath, 200));
		fm.set(reviewPath, { status: 'draft', 审核状态: '通过', flag: '' });
		let renames = 0;
		const driveApp = {
			vault: {
				getMarkdownFiles: () => [...files.values()],
				getAbstractFileByPath: () => null,
				createFolder: async () => {},
			},
			metadataCache: {
				getFileCache: (f: TFile) => {
					const front = fm.get(f.path);
					return front ? { frontmatter: front } : null;
				},
			},
			fileManager: {
				processFrontMatter: async (f: TFile, fn: (o: Record<string, unknown>) => void) => {
					const front = fm.get(f.path) ?? {};
					fn(front);
					fm.set(f.path, front);
				},
				renameFile: async () => { renames += 1; },
				trashFile: async () => {},
			},
			plugins: { plugins: {} },
		} as unknown as App;

		const actionCfg: PipelineConfig = {
			...config,
			actions: [
				{ id: 'act_review', label: '审核', icon: 'square-pen', field: '审核状态', options: ['通过', '驳回', '待复审'] },
				{ id: 'act_flag', label: '标记', icon: 'flag', field: 'flag', options: ['红', '绿'] },
			],
		};
		const host = new El('div');
		renderPipelineSection(host as unknown as HTMLElement, pipelineColumn(actionCfg), driveApp, callbacks, null);

		const card = findByClass(host, 'dashboard-pipeline-card').find(c => (c.textContent ?? '').includes('流量密码'))!;
		assert.ok(card, 'draft card rendered');
		const actionBtns = findByClass(card, 'dashboard-pipeline-action-btn');
		assert.equal(actionBtns.length, 2, 'one button per configured action');
		// mini-dom El has no declared `title`, but the section sets it as the
		// hover tooltip (a real HTMLElement property) — read it back.
		const titleOf = (el: El): string => (el as unknown as { title: string }).title;
		assert.equal(titleOf(actionBtns[0]!), '审核', 'tooltip carries the user-entered button name');
		assert.equal(actionBtns[0]!.getAttribute('aria-label'), '审核');
		assert.equal(titleOf(actionBtns[1]!), '标记');
		// Ghost sits left of archive (CSS right:28) on a 24px pitch, config order.
		assert.equal(actionBtns[0]!.style.right, '52px', 'first action offset left of archive');
		assert.equal(actionBtns[1]!.style.right, '76px', 'second action continues leftward');
		assert.equal(findByClass(card, 'dashboard-pipeline-archive-btn').length, 1, 'archive button still present');

		// Click the review button → native dropdown of its options, current
		// value (通过) checked, the rest not.
		actionBtns[0]!.click();
		const menu = (Menu as unknown as { last: { items: Array<{ title: string; checked: boolean; click(): void }> } }).last;
		assert.ok(menu, 'dropdown opened');
		assert.deepEqual(menu.items.map(i => i.title), ['通过', '驳回', '待复审'], 'dropdown lists the configured options in order');
		assert.equal(menu.items.find(i => i.title === '通过')!.checked, true, 'current field value is checked');
		assert.equal(menu.items.find(i => i.title === '驳回')!.checked, false, 'non-current options unchecked');

		// Pick 驳回 → writes ONLY the target field, no move, success notice.
		const noticeTexts = (Notice as unknown as { messages: string[] }).messages;
		noticeTexts.length = 0;
		menu.items.find(i => i.title === '驳回')!.click();
		await wait(10);
		assert.equal(fm.get(reviewPath)!.审核状态, '驳回', 'picked value written to the target field');
		assert.equal(fm.get(reviewPath)!.status, 'draft', 'stage field untouched by a non-status action');
		assert.equal(renames, 0, 'action buttons never move the file');
		assert.ok(noticeTexts.some(m => m.includes('审核状态') && m.includes('驳回')), 'success notice names field + value');
	}

	// ── Top filter bar (2026-11: the left rail moved above the board). Same
	//    controls, same persistence event — new DOM position. The 阶段 group
	//    (2026-11-16) leads the bar and narrows the board together with the
	//    value chips; the search box sits at the bar's right edge.
	{
		const host = new El('div');
		const filters: Array<{ dim: string; value?: string } | undefined> = [];
		const stagePicks: Array<string | null | undefined> = [];
		host.addEventListener('dashboard-pipeline-filter', (event: { detail: { filter?: { dim: string; value?: string }; stage?: string | null } }) => {
			filters.push(event.detail.filter);
			stagePicks.push(event.detail.stage);
		});
		renderPipelineSection(host as unknown as HTMLElement, pipelineColumn(config), app, callbacks, null);
		const topbar = findByClass(host, 'dashboard-pipeline-topbar');
		assert.equal(topbar.length, 1, 'filter bar renders above the board');
		assert.equal(findByClass(topbar[0]!, 'dashboard-pipeline-rail').length, 1, 'the rail lives inside the top bar');
		assert.equal(findByClass(topbar[0]!, 'dashboard-pipeline-board').length, 0, 'no columns inside the bar');
		// Picking a value now happens in the dropdown's menu (one step from
		// the bar) and emits the same persistence event; the stage axis rides
		// the same event untouched.
		const drop = findByClass(topbar[0]!, 'dashboard-pipeline-rail-drop')[0]!;
		drop.click();
		const dropMenu = (Menu as unknown as { last: { items: Array<{ title: string; checked: boolean; click(): void }> } }).last;
		assert.ok(dropMenu, 'dropdown menu opens');
		assert.deepEqual(dropMenu.items.map(i => i.title), ['全部', '小红书 (1)'], 'menu lists All + the values with counts');
		assert.equal(dropMenu.items[0]!.checked, true, 'All is checked while nothing is picked');
		dropMenu.items.find(i => i.title.includes('小红书'))!.click();
		assert.deepEqual(filters, [{ dim: 'platform', value: '小红书' }], 'menu pick emits the value filter');
		assert.deepEqual(stagePicks, [undefined], 'value pick leaves the stage untouched');
		// The picked value shows on the button after the persist+refresh
		// (simulated by a fresh render with the persisted filter).
		const hostPicked = new El('div');
		renderPipelineSection(hostPicked as unknown as HTMLElement, pipelineColumn({ ...config, filter: { dim: 'platform', value: '小红书' } }), app, callbacks, null);
		const pickedBtn = findByClass(hostPicked, 'dashboard-pipeline-rail-drop')[0]!;
		assert.ok((pickedBtn.textContent ?? '').includes('小红书'), 'picked value shows on the button');
		assert.ok((pickedBtn.className ?? '').includes('is-active'), 'picked button reads active');
		// Stage chips emit the stage payload and stay independent of values.
		const ideaChip = findByClass(topbar[0]!, 'dashboard-pipeline-rail-stage').find(c => (c.textContent ?? '').includes('选题'))!;
		ideaChip.click();
		assert.deepEqual(stagePicks[1], 'idea', 'stage chip emits its value');
		// Clicking the ACTIVE stage chip again clears the pick — the toggle
		// reads the persisted state, so simulate the post-persist re-render.
		const hostStageOn = new El('div');
		const clearPicks: Array<string | null | undefined> = [];
		hostStageOn.addEventListener('dashboard-pipeline-filter', ((e: CustomEvent) => { clearPicks.push((e.detail as { stage?: string | null }).stage); }) as EventListener);
		renderPipelineSection(hostStageOn as unknown as HTMLElement, pipelineColumn({ ...config, stageFilter: 'idea' }), app, callbacks, null);
		const activeChip = findByClass(hostStageOn, 'dashboard-pipeline-rail-stage').find(c => (c.className ?? '').includes('is-active'))!;
		assert.ok((activeChip.textContent ?? '').includes('选题'), 'persisted stage renders active');
		activeChip.click();
		assert.deepEqual(clearPicks, [null], 'second click clears the stage pick');

		// Stage filter narrows the board: only the picked column keeps cards.
		const hostStage = new El('div');
		renderPipelineSection(hostStage as unknown as HTMLElement, pipelineColumn({ ...config, stageFilter: 'draft' }), app, callbacks, null);
		const counts = findByClass(hostStage, 'dashboard-pipeline-col-count').map(el => el.textContent);
		assert.deepEqual(counts, ['0', '1'], 'stage filter empties every other column');

		// Search box: typing narrows by title (debounced transient refresh).
		// Distinct column name so the module-level search term never leaks
		// into the fixtures below.
		const searchColumn = { ...pipelineColumn(config), name: '搜索流水线' } as DashboardColumn;
		const hostSearch = new El('div');
		const refreshed: string[] = [];
		hostSearch.addEventListener('dashboard-pipeline-refresh', (event: { detail: { columnName: string } }) => refreshed.push(event.detail.columnName));
		renderPipelineSection(hostSearch as unknown as HTMLElement, searchColumn, app, callbacks, null);
		const searchInput = findByClass(hostSearch, 'dashboard-pipeline-search')[0] as unknown as El & { value: string };
		searchInput.value = '流量';
		searchInput.dispatchEvent({ type: 'input', target: searchInput });
		await new Promise(r => setTimeout(r, 320));
		assert.deepEqual(refreshed, ['搜索流水线'], 'search asks the section to refresh');
		// The refresh re-renders with the term applied: the fresh render below
		// (same column name) shows only the matching row.
		const hostFiltered = new El('div');
		renderPipelineSection(hostFiltered as unknown as HTMLElement, { ...searchColumn, pipelineConfig: { ...config, view: 'list' } }, app, callbacks, null);
		const titles = findByClass(hostFiltered, 'dashboard-pipeline-list-title-btn').map(el => el.textContent);
		assert.deepEqual(titles, ['流量密码'], 'search term filters rows by title');
	}

	// ── List view (2026-11): one row per card; the configured buttons sit
	//    right of the title in two groups (skills / actions), every button
	//    directly clickable — no ⋯ indirection.
	{
		const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
		const files = new Map<string, TFile>();
		const fmData = new Map<string, Record<string, unknown>>();
		const draftPath = '内容创作/02-草稿/流量密码.md';
		const ideaPath = '内容创作/01-选题/对标拆解.md';
		files.set(draftPath, fakeFile(draftPath, 200));
		fmData.set(draftPath, { status: 'draft', 审核状态: '通过', platform: '公众号' });
		files.set(ideaPath, fakeFile(ideaPath, 100));
		fmData.set(ideaPath, { status: 'idea', tags: ['小红书'], platform: '小红书' });
		const driveApp = {
			vault: {
				getMarkdownFiles: () => [...files.values()],
				getAbstractFileByPath: () => null,
				createFolder: async () => {},
			},
			metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: fmData.get(f.path) ?? {} }) },
			fileManager: {
				processFrontMatter: async (f: TFile, fn: (o: Record<string, unknown>) => void) => {
					const front = fmData.get(f.path) ?? {};
					fn(front);
					fmData.set(f.path, front);
				},
				renameFile: async () => {},
				trashFile: async () => {},
			},
			plugins: { plugins: {} },
		} as unknown as App;
		const listCfg: PipelineConfig = {
			...config, view: 'list',
			actions: [{ id: 'act_review', label: '审核', icon: 'square-pen', field: '审核状态', options: ['通过', '驳回'] }],
		};
		const opened: string[] = [];
		const listCallbacks = { onOpenNoteInPopover: (f: TFile) => { opened.push(f.path); } } as unknown as RenderCallbacks;
		const host = new El('div');
		renderPipelineSection(host as unknown as HTMLElement, pipelineColumn(listCfg), driveApp, listCallbacks, null);
		assert.equal(findByClass(host, 'dashboard-pipeline-board').length, 0, 'list view renders no columns');
		const table = findByClass(host, 'dashboard-pipeline-list')[0]!;
		assert.ok(table, 'list table renders');
		const trs = findTag(table, 'tr');
		assert.equal(trs.length, 3, 'header + one row per card');
		// Columns: title | buttons | platform | stage | due | mtime — the
		// buttons sit RIGHT OF the title, not at the end.
		const ths = findByClass(host, 'dashboard-pipeline-list')[0]!;
		const headCells = Array.from((findTag(ths, 'tr')[0]!).children).map(td => td.textContent);
		assert.deepEqual(headCells, ['标题', '按钮', '平台', '阶段', '截止日期', '更新时间'], 'button column follows the title');
		// The draft row: skill buttons (写草稿) + action buttons (审核), two groups.
		const draftRow = trs.find(tr => (tr.textContent ?? '').includes('流量密码'))!;
		const skillGroup = findByClass(draftRow, 'dashboard-pipeline-list-btn-group--skills')[0]!;
		const actionGroup = findByClass(draftRow, 'dashboard-pipeline-list-btn-group--actions')[0]!;
		assert.ok(skillGroup && actionGroup, 'skills and actions render as separate groups');
		assert.equal(findByClass(skillGroup, 'dashboard-pipeline-skill-btn').length, 1, 'the draft skill button is directly in the row');
		// 1 configured action + the built-in archive/delete pair (Rae,
		// 2026-11-16 round three).
		const rowActionBtns = findByClass(actionGroup, 'dashboard-pipeline-list-action-btn');
		assert.equal(rowActionBtns.length, 3, 'configured action + built-in archive + delete');
		assert.equal(rowActionBtns[0]!.getAttribute('aria-label'), '审核', 'configured action first');
		assert.equal(rowActionBtns[1]!.getAttribute('aria-label'), '归档', 'built-in archive follows');
		assert.equal(rowActionBtns[2]!.getAttribute('aria-label'), '删除条目', 'built-in delete last');
		// Skill click dispatches straight away (preview modal opens — no menu).
		(Menu as unknown as { last: unknown }).last = null;
		(Modal as unknown as { last: unknown }).last = null;
		findByClass(skillGroup, 'dashboard-pipeline-skill-btn')[0]!.click();
		await wait(10);
		assert.ok((Modal as unknown as { last: unknown }).last, 'skill button click opens the prompt modal directly');
		// Action click opens ITS OWN value menu (one step, not a ⋯ menu).
		findByClass(actionGroup, 'dashboard-pipeline-list-action-btn')[0]!.click();
		const actionMenu = (Menu as unknown as { last: { items: Array<{ title: string; checked: boolean; click(): void }> } }).last;
		assert.deepEqual(actionMenu.items.map(i => i.title), ['通过', '驳回'], 'action button opens its own options');
		assert.equal(actionMenu.items.find(i => i.title === '通过')!.checked, true, 'current value checked');
		const noticeTexts = (Notice as unknown as { messages: string[] }).messages;
		noticeTexts.length = 0;
		actionMenu.items.find(i => i.title === '驳回')!.click();
		await wait(10);
		assert.equal(fmData.get(draftPath)!.审核状态, '驳回', 'picked value written from the list row');
		// Title click opens the note.
		findByClass(draftRow, 'dashboard-pipeline-list-title-btn')[0]!.click();
		assert.deepEqual(opened, [draftPath], 'row title opens the note');
		// Stage + platform columns carry the fields.
		assert.ok((draftRow.textContent ?? '').includes('草稿'), 'stage column carries the stage label');
		assert.ok((draftRow.textContent ?? '').includes('公众号'), 'platform column carries the platform');

		// Pagination: 55 cards → 50 rows + a load-more pill that grows the page.
		const many: Array<{ file: TFile; fm: Record<string, unknown> }> = [];
		for (let i = 1; i <= 55; i++) {
			many.push({ file: fakeFile(`内容创作/01-选题/选题${i}.md`, 1000 + i), fm: { status: 'idea', platform: '公众号' } });
		}
		const hostMany = new El('div');
		renderPipelineSection(hostMany as unknown as HTMLElement, { ...pipelineColumn({ ...config, view: 'list' }), name: '列表流水线' }, makeApp(many), callbacks, null);
		assert.equal(findByClass(hostMany, 'dashboard-pipeline-list-title-btn').length, 50, 'first page renders 50 rows');
		const pill = findByClass(hostMany, 'dashboard-pipeline-load-more')[0]!;
		assert.ok(pill, 'load-more pill appears past the page');
		const refreshed: string[] = [];
		hostMany.addEventListener('dashboard-pipeline-refresh', (event: { detail: { columnName: string } }) => refreshed.push(event.detail.columnName));
		pill.click();
		assert.deepEqual(refreshed, ['列表流水线'], 'pill asks the section to refresh with the grown page');

		// The filter bar works in the list view too (same row, above the table).
		assert.equal(findByClass(hostMany, 'dashboard-pipeline-topbar').length, 1, 'filter bar renders above the list');
		// View toggle event contract: renderer dispatches, view.ts persists —
		// verified through the section honoring view: 'list' (above).
	}

	// ── Cards view (2026-11-16, Rae's spec): every item as a Xiaohongshu-style
	//    image-text note — cover (property → body image → placeholder), crafted
	//    title, 更新日期 · 阶段 line, then the list view's button groups.
	{
		const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
		const files = new Map<string, TFile>();
		const fmData = new Map<string, Record<string, unknown>>();
		const bodies = new Map<string, string>();
		const coverPath = '内容创作/02-草稿/封面草稿.md';
		const bodyPath = '内容创作/01-选题/正文有图.md';
		const barePath = '内容创作/01-选题/无图选题.md';
		files.set(coverPath, fakeFile(coverPath, 200));
		fmData.set(coverPath, { status: 'draft', 标题: '三天涨粉一千的方法论', 封面: 'data:image/png;base64,AAAA' });
		bodies.set(coverPath, '# 三天涨粉一千的方法论\n\n正文。');
		files.set(bodyPath, fakeFile(bodyPath, 100));
		fmData.set(bodyPath, { status: 'idea', platform: '小红书' });
		bodies.set(bodyPath, '开头\n\n![](data:image/jpeg;base64,BBBB)\n\n结尾');
		files.set(barePath, fakeFile(barePath, 50));
		fmData.set(barePath, { status: 'idea' });
		bodies.set(barePath, '纯文字笔记，没有任何图片。');
		const driveApp = {
			vault: {
				getMarkdownFiles: () => [...files.values()],
				getAbstractFileByPath: () => null,
				createFolder: async () => {},
				cachedRead: async (f: TFile) => bodies.get(f.path) ?? '',
			},
			metadataCache: {
				getFileCache: (f: TFile) => ({ frontmatter: fmData.get(f.path) ?? {} }),
				getFirstLinkpathDest: () => null,
			},
			fileManager: {
				processFrontMatter: async (f: TFile, fn: (o: Record<string, unknown>) => void) => {
					const front = fmData.get(f.path) ?? {};
					fn(front);
					fmData.set(f.path, front);
				},
				renameFile: async () => {},
				trashFile: async () => {},
			},
			plugins: { plugins: {} },
		} as unknown as App;
		const cardsCfg: PipelineConfig = {
			...config, view: 'cards',
			actions: [{ id: 'act_review', label: '审核', icon: 'square-pen', field: '审核状态', options: ['通过', '驳回'] }],
		};
		const opened: string[] = [];
		const cardsCallbacks = { onOpenNoteInPopover: (f: TFile) => { opened.push(f.path); } } as unknown as RenderCallbacks;
		const bodyEl = new El('body');
		const host = new El('div');
		bodyEl.appendChild(host); // async cover callbacks check isConnected.
		renderPipelineSection(host as unknown as HTMLElement, pipelineColumn(cardsCfg), driveApp, cardsCallbacks, null);
		assert.equal(findByClass(host, 'dashboard-pipeline-board').length, 0, 'cards view renders no columns');
		assert.equal(findByClass(host, 'dashboard-pipeline-list').length, 0, 'cards view renders no table');
		const grid = findByClass(host, 'dashboard-pipeline-notes')[0]!;
		assert.ok(grid, 'cards grid renders');
		const notes = findByClass(host, 'dashboard-pipeline-note');
		assert.equal(notes.length, 3, 'one note card per item');
		// The filter bar still leads the section in the cards view.
		assert.equal(findByClass(host, 'dashboard-pipeline-topbar').length, 1, 'filter bar renders above the cards');

		// Let the async cover resolutions settle.
		await new Promise(r => setImmediate(r));

		const noteOf = (needle: string): El => notes.find(n => (n.textContent ?? '').includes(needle))!;
		// Cover chain A: the 封面 property paints directly (data: URI = no IO).
		const coverNote = noteOf('三天涨粉一千的方法论');
		const coverA = findByClass(coverNote, 'dashboard-pipeline-note-cover')[0]!;
		assert.ok((coverA.style.backgroundImage ?? '').includes('data:image/png;base64,AAAA'), '封面 property paints the cover');
		// Title chain: the 标题 property shows, not the file name.
		assert.equal(findByClass(coverNote, 'dashboard-pipeline-note-title')[0]!.textContent, '三天涨粉一千的方法论', '标题 property wins over the file name');
		// Meta line: 更新日期 + stage label with the stage dot.
		const meta = findByClass(coverNote, 'dashboard-pipeline-note-meta')[0]!;
		assert.equal(findByClass(coverNote, 'dashboard-pipeline-note-date')[0]!.textContent, '1970-01-01', 'meta carries the update date');
		assert.ok((meta.textContent ?? '').includes('草稿'), 'meta carries the stage label');
		assert.ok(findByClass(coverNote, 'dashboard-pipeline-note-stage-dot').length === 1, 'stage dot rendered');
		// Cover chain B: no cover property → first BODY image paints.
		const bodyNote = noteOf('正文有图');
		const coverB = findByClass(bodyNote, 'dashboard-pipeline-note-cover')[0]!;
		assert.ok((coverB.style.backgroundImage ?? '').includes('data:image/jpeg;base64,BBBB'), 'body image paints when no cover property exists');
		// No file-name title fallback check: basename shows when no 标题.
		assert.equal(findByClass(bodyNote, 'dashboard-pipeline-note-title')[0]!.textContent, '正文有图', 'file name is the title fallback');
		// Cover chain C: nothing anywhere → themed placeholder, no background.
		const bareNote = noteOf('无图选题');
		const coverC = findByClass(bareNote, 'dashboard-pipeline-note-cover')[0]!;
		assert.ok((coverC.className ?? '').includes('dashboard-pipeline-note-cover--placeholder'), 'no cover anywhere = placeholder');
		assert.equal(coverC.style.backgroundImage, undefined, 'placeholder paints no image');

		// Buttons: the draft card carries its skill (写草稿) in the bottom row,
		// and its actions (审核 + built-in archive/delete) as the cover's
		// top-right VERTICAL icon stack (Rae, 2026-11-17 — the corner keeps
		// the whole bottom row for skills).
		const skillGroup = findByClass(coverNote, 'dashboard-pipeline-list-btn-group--skills')[0]!;
		const tools = findByClass(coverNote, 'dashboard-pipeline-note-tools')[0]!;
		assert.ok(skillGroup, 'skill group renders in the bottom row');
		assert.ok(tools, 'action tools render as the corner stack');
		assert.equal(findByClass(coverNote, 'dashboard-pipeline-list-btn-group--actions').length, 0, 'no actions group left in the bottom row');
		assert.equal(findByClass(skillGroup, 'dashboard-pipeline-skill-btn').length, 1, 'card-scope skill button on the note');
		// Skill click dispatches straight away (preview modal opens).
		(Modal as unknown as { last: unknown }).last = null;
		findByClass(skillGroup, 'dashboard-pipeline-skill-btn')[0]!.click();
		await wait(10);
		assert.ok((Modal as unknown as { last: unknown }).last, 'skill click dispatches directly');
		// Tool click opens its own value menu.
		const toolBtns = findByClass(tools, 'dashboard-pipeline-note-tool');
		toolBtns[0]!.click();
		const actionMenu = (Menu as unknown as { last: { items: Array<{ title: string; click(): void }> } }).last;
		assert.deepEqual(actionMenu.items.map(i => i.title), ['通过', '驳回'], 'action tool opens its own options');
		const noticeTexts = (Notice as unknown as { messages: string[] }).messages;
		noticeTexts.length = 0;
		actionMenu.items.find(i => i.title === '驳回')!.click();
		await wait(10);
		assert.equal(fmData.get(coverPath)!.审核状态, '驳回', 'picked value written from the note card');
		// Built-ins ride below the configured tools in the same stack.
		assert.equal(toolBtns.length, 3, 'configured tool + built-in archive + delete');
		assert.equal(toolBtns[1]!.getAttribute('aria-label'), '归档', 'built-in archive follows the configured tool');
		assert.equal(toolBtns[2]!.getAttribute('aria-label'), '删除条目', 'built-in delete last');
		// Tool clicks never fall through to the cover's open-note gesture.
		findByClass(tools, 'dashboard-pipeline-note-tool')[0]!.click();
		assert.deepEqual(opened, [], 'tool click does not open the note');

		// Cover click opens the note (the XHS affordance).
		findByClass(coverNote, 'dashboard-pipeline-note-cover')[0]!.click();
		assert.deepEqual(opened, [coverPath], 'cover click opens the note');
		// Title click opens the note too.
		findByClass(coverNote, 'dashboard-pipeline-note-title')[0]!.click();
		assert.deepEqual(opened, [coverPath, coverPath], 'title click opens the note');

		// Pagination: 55 items → 50 cards + a load-more pill that grows the page.
		const many: Array<{ file: TFile; fm: Record<string, unknown> }> = [];
		for (let i = 1; i <= 55; i++) {
			many.push({ file: fakeFile(`内容创作/01-选题/选题${i}.md`, 1000 + i), fm: { status: 'idea' } });
		}
		const hostMany = new El('div');
		renderPipelineSection(hostMany as unknown as HTMLElement, { ...pipelineColumn({ ...config, view: 'cards' }), name: '卡片流水线' }, makeApp(many), callbacks, null);
		assert.equal(findByClass(hostMany, 'dashboard-pipeline-note').length, 50, 'first page renders 50 cards');
		const pill = findByClass(hostMany, 'dashboard-pipeline-load-more')[0]!;
		assert.ok(pill, 'load-more pill appears past the page');
		const refreshed: string[] = [];
		hostMany.addEventListener('dashboard-pipeline-refresh', (event: { detail: { columnName: string } }) => refreshed.push(event.detail.columnName));
		pill.click();
		assert.deepEqual(refreshed, ['卡片流水线'], 'pill asks the section to refresh with the grown page');
	}
}

void main();
