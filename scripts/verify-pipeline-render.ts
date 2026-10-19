import { strict as assert } from 'node:assert';
import { Modal, Notice } from 'obsidian';
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
}

void main();
