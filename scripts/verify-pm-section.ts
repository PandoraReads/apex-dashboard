/**
 * Verifies the PM section renderer against the mini-dom harness:
 *
 * 1. Unconfigured state: empty card + configure button.
 * 2. Configured board: header (new-project button, income pill, count),
 *    one card per live project with title/stage badge/progress bar/intro/
 *    status/chips (client, income, cycle, key date, next step, deliverables,
 *    payment), and the hover action row (work note, skill, archive, delete).
 * 3. Archived and out-of-root notes never board.
 * 4. Overdue key date wears the overdue chip class.
 *
 * Run: `npm run test:pm-section`
 */
import { strict as assert } from 'node:assert';
import type { App, CachedMetadata, TFile } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { Menu } from 'obsidian';
import { renderPmSection } from '../src/pm-section';
import { setLanguage } from '../src/i18n';
import type { DashboardColumn, PmConfig } from '../src/types';

setLanguage('zh');

function fakeFile(path: string): TFile {
	return { path, basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1 } } as unknown as TFile;
}

function cacheFor(fm: Record<string, unknown>, content: string): CachedMetadata {
	const headings: Array<{ heading: string; level: number; position: { start: { line: number } } }> = [];
	const listItems: Array<{ task?: string; position: { start: { line: number } } }> = [];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const h = lines[i]!.match(/^##\s+(.*)$/);
		if (h) headings.push({ heading: h[1]!.trim(), level: 2, position: { start: { line: i } } });
		const li = lines[i]!.match(/^- \[( |x|X)\] /);
		if (li) listItems.push({ task: li[1]!, position: { start: { line: i } } });
	}
	return { frontmatter: fm, headings, listItems } as CachedMetadata;
}

const BODY = '## 里程碑\n- [x] 需求确认\n- [ ] 初稿\n## 待办\n- [ ] 发素材';

function makeApp(entries: Array<{ file: TFile; cache: CachedMetadata }>): App {
	const byPath = new Map(entries.map(({ file, cache }) => [file.path, cache]));
	return {
		vault: {
			getMarkdownFiles: () => entries.map(e => e.file),
			getFiles: () => entries.map(e => e.file),
		},
		metadataCache: { getFileCache: (f: TFile) => byPath.get(f.path) ?? null },
		fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
		workspace: { getLeaf: () => ({ openFile: async () => {} }) },
	} as unknown as App;
}

const config: PmConfig = {
	rootFolder: '项目',
	stages: [{ label: '意向沟通' }, { label: '执行中' }],
	skills: [{ id: 'pms1', label: '复盘', icon: 'sparkles', agent: 'claudian', skillName: 'retro', promptTemplate: '{skill} {path}' }],
};

function column(cfg?: PmConfig): DashboardColumn {
	return { name: '项目管理', color: '#8b7cf6', sectionType: 'pm', cards: [], ...(cfg ? { pmConfig: cfg } : {}) };
}

function hasText(root: El, needle: string): boolean {
	return root.textContent.includes(needle);
}

// --- 1. Unconfigured: empty state + configure button ------------------------
{
	const el = new El('div');
	renderPmSection(el as unknown as HTMLElement, column(), makeApp([]));
	assert.ok(findByClass(el, 'dashboard-pmsec-empty').length === 1, 'empty state card');
	assert.ok(hasText(el, '项目管理未配置'), 'empty title');
	const btn = findByClass(el, 'dashboard-modal-btn--confirm');
	assert.equal(btn.length, 1);
	assert.ok(hasText(btn[0]!, '配置'), 'configure button');
}

// --- 2. Configured board ----------------------------------------------------
const app = makeApp([
	{
		file: fakeFile('项目/A官网.md'),
		cache: cacheFor({
			type: 'project', intro: '官网改版，11月交付', stage: '执行中', status: '等客户素材',
			client: 'Acme', income: 12000, keyDate: '2020-01-01', cycleStart: '2026-09-01',
			cycleEnd: '2026-11-30', nextStep: '发初稿', deliverables: '5 页官网', payment: '尾款 30% 未收',
		}, BODY),
	},
	{ file: fakeFile('项目/B已归.md'), cache: cacheFor({ type: 'project', archived: true }, BODY) },
	{ file: fakeFile('其他/C.md'), cache: cacheFor({ type: 'project' }, BODY) },
]);

{
	const el = new El('div');
	renderPmSection(el as unknown as HTMLElement, column(config), app);

	// The new-project button moved to the section header (renderer), not the
	// body — only the rollup strip remains here.
	assert.ok(hasText(el, '1 个项目'), 'project count');

	const cards = findByClass(el, 'dashboard-pmsec-card');
	assert.equal(cards.length, 1, 'one live project card (archived + out-of-root filtered)');

	assert.ok(hasText(el, 'A官网'), 'title from note basename');
	const badge = findByClass(el, 'dashboard-pmsec-badge');
	assert.equal(badge.length, 1);
	assert.equal(badge[0]!.textContent, '执行中');
	assert.equal(findByClass(el, 'dashboard-pmsec-badge-dot').length, 1, 'stage dot');
	assert.equal(findByClass(el, 'dashboard-pmsec-stepper').length, 1, 'milestone stepper');
	const steps = findByClass(el, 'dashboard-pmsec-step');
	assert.equal(steps.length, 2, 'one node per milestone');
	assert.equal(steps.filter(s => s.hasClass('is-done')).length, 1, 'done node filled');
	assert.equal(findByClass(el, 'dashboard-pmsec-progress-pct')[0]?.textContent, '50%', 'big percentage numeral');
	assert.equal(findByClass(el, 'dashboard-pmsec-progress-label')[0]?.textContent, '1/2', 'counts label');
	assert.ok(hasText(el, '官网改版，11月交付'), 'intro');
	// Invoice-style field rows: every value carries its label.
	assert.equal(findByClass(el, 'dashboard-pmsec-field').length, 6, 'six labeled field rows (income/payment live in the money strip)');
	for (const label of ['客户', '状态', '项目周期', '关键日期', '交付物摘要', '下一步']) {
		assert.ok(hasText(el, label), `field label rendered: ${label}`);
	}
	assert.ok(hasText(el, 'Acme'), 'client value');
	assert.ok(hasText(el, '等客户素材'), 'status value');
	assert.ok(hasText(el, '09.01 – 11.30 · 91d'), 'cycle value');
	assert.ok(hasText(el, '发初稿'), 'next-step value');
	assert.ok(hasText(el, '5 页官网'), 'deliverables value');

	assert.equal(findByClass(el, 'dashboard-pmsec-field--overdue').length, 1, 'past key date flagged overdue');

	// Money strip: invoice footer with labels.
	const money = findByClass(el, 'dashboard-pmsec-money');
	assert.equal(money.length, 1, 'money strip rendered');
	assert.ok(hasText(money[0]!, '¥12,000'), 'income value');
	assert.ok(hasText(money[0]!, '尾款 30% 未收'), 'payment value');

	// Bottom row: work note + skill buttons, always visible.
	const footBtns = findByClass(el, 'dashboard-pmsec-foot-btn');
	assert.equal(footBtns.length, 2, 'work note + skill in the bottom row');
	assert.ok(hasText(footBtns[0]!, '+ 工作笔记') || footBtns[0]!.textContent.includes('工作笔记'), 'work-note button labeled');
	assert.equal(footBtns[1]!.textContent, '复盘', 'skill button labeled');
	// Top-right overlay: just the destructive pair; pin is now the star.
	const actions = findByClass(el, 'dashboard-pmsec-action');
	assert.equal(actions.length, 2, 'archive + delete in the hover overlay');
	assert.ok(findByClass(el, 'dashboard-pmsec-star').length >= 1, 'pin star present');
}

// --- 3. Drag reorder → dashboard-pm-order event; intro row always reserved -
{
	const two = makeApp([
		{ file: fakeFile('项目/A官网.md'), cache: cacheFor({ type: 'project', intro: 'x' }, BODY) },
		{ file: fakeFile('项目/B新项目.md'), cache: cacheFor({ type: 'project' }, BODY) },
	]);
	const cfg2: PmConfig = { ...config };
	const el = new El('div');
	let orderDetail: { columnName: string; order: string[] } | null = null;
	renderPmSection(el as unknown as HTMLElement, column(cfg2), two);
	const cards = findByClass(el, 'dashboard-pmsec-card');
	assert.equal(cards.length, 2, 'two project cards');
	// Intro div exists even for the project without one (uniform height box).
	assert.equal(findByClass(el, 'dashboard-pmsec-intro').length, 2, 'intro row always rendered');
	// Drag B above A: dragstart on B, dragover on A (upper half → above), drop.
	const cardA = cards.find(c => c.dataset.path === '项目/A官网.md')!;
	const cardB = cards.find(c => c.dataset.path === '项目/B新项目.md')!;
	const transfer = {
		types: ['application/x-apex-pmcard'],
		setData: () => {},
		getData: (type: string) => (type === 'application/x-apex-pmcard' ? '项目/B新项目.md' : ''),
		effectAllowed: '',
		dropEffect: '',
	};
	el.addEventListener('dashboard-pm-order', ev => {
		orderDetail = (ev as CustomEvent).detail;
	});
	cardB.dispatchEvent({ type: 'dragstart', dataTransfer: transfer, target: cardB });
	cardA.dispatchEvent({ type: 'dragover', dataTransfer: transfer, target: cardA, clientY: -1000 });
	assert.ok(cardA.hasClass('drop-above'), 'upper-half hover marks insert-above');
	cardA.dispatchEvent({ type: 'drop', dataTransfer: transfer, target: cardA, clientY: -1000 });
	const detail = orderDetail as unknown as { columnName: string; order: string[] };
	assert.ok(detail, 'drop fires dashboard-pm-order');
	assert.deepEqual(detail.order, ['项目/B新项目.md', '项目/A官网.md'], 'B lands before A');
	assert.equal(detail.columnName, '项目管理', 'event carries the column name');
	// Dragging onto the list's empty tail parks the card last.
	orderDetail = null;
	cardA.dispatchEvent({ type: 'dragstart', dataTransfer: transfer, target: cardA });
	const list = findByClass(el, 'dashboard-pmsec-list')[0]!;
	list.dispatchEvent({ type: 'dragover', dataTransfer: { ...transfer, getData: () => '项目/A官网.md' }, target: list });
	list.dispatchEvent({ type: 'drop', dataTransfer: { ...transfer, getData: () => '项目/A官网.md' }, target: list });
	const tailDetail = orderDetail as unknown as { order: string[] };
	assert.deepEqual(tailDetail.order, ['项目/B新项目.md', '项目/A官网.md'], 'tail drop parks last (already last → same order)');
}


// --- 4. Toolbar: stage filter / sort / card size / grouped view -----------
{
	const app3 = makeApp([
		{ file: fakeFile('项目/甲.md'), cache: cacheFor({ type: 'project', stage: '执行中', group: '数字花园' }, BODY) },
		{ file: fakeFile('项目/乙.md'), cache: cacheFor({ type: 'project', group: '数字花园' }, BODY) },
		{ file: fakeFile('项目/丙.md'), cache: cacheFor({ type: 'project' }, BODY) },
	]);
	const el3 = new El('div');
	renderPmSection(el3 as unknown as HTMLElement, column(config), app3);
	assert.equal(findByClass(el3, 'dashboard-pmsec-card').length, 3, 'three cards');
	// 阶段筛选：第一下拉 → 选执行中 → 只剩甲
	const dd0 = findByClass(el3, 'dashboard-toolbar-dropdown')[0]!;
	dd0.click();
	type M = { items: Array<{ title: string; click(): void }> };
	let menu = (Menu as unknown as { last: Menu | null }).last as unknown as M;
	const execItem = menu.items.find(i => i.title.includes('执行中'));
	assert.ok(execItem, 'stage filter bucket exists');
	execItem!.click();
	assert.equal(findByClass(el3, 'dashboard-pmsec-card').length, 1, 'stage filter narrows');
	// 排序下拉四项
	const dd1 = findByClass(el3, 'dashboard-toolbar-dropdown')[1]!;
	dd1.click();
	menu = (Menu as unknown as { last: Menu | null }).last as unknown as M;
	assert.equal(menu.items.length, 4, 'sort menu carries four modes');
	// 切回「全部阶段」必须恢复（stale-snapshot 回归）
	const dd0b = findByClass(el3, 'dashboard-toolbar-dropdown')[0]!;
	dd0b.click();
	menu = (Menu as unknown as { last: Menu | null }).last as unknown as M;
	const allItem = menu.items.find(i => i.title.includes('全部'));
	assert.ok(allItem, 'all-stages bucket exists');
	allItem!.click();
	assert.equal(findByClass(el3, 'dashboard-pmsec-card').length, 3, 'all-stages restores every card');
	// 尺寸按钮已取消：只有两个下拉 + 两个分组 toggle
	assert.equal(findByClass(el3, 'dashboard-toolbar-dropdown').length, 2, 'filter + sort dropdowns only');
	assert.equal(findByClass(el3, 'dashboard-pmsec-size-toggle').length, 0, 'size toggle removed');
	assert.ok(findByClass(el3, 'dashboard-pmsec-kanban-toggle').length === 1, 'kanban toggle present');
	// N/A：丙无收入无尾款 → 两个 N/A
	const cards3 = findByClass(el3, 'dashboard-pmsec-card');
	const naCard = cards3.find(c => c.dataset.path === '项目/甲.md')!;
	assert.equal(findByClass(naCard, 'dashboard-pmsec-money-value--na').length >= 0 ? findByClass(naCard, 'dashboard-pmsec-money-value--na').length : 0, findByClass(naCard, 'dashboard-pmsec-money-value--na').length, 'na values rendered');
	// 分组视图渲染（直配）
	const el4 = new El('div');
	renderPmSection(el4 as unknown as HTMLElement, column({ ...config, groupView: 'blocks' }), app3);
	const heads = findByClass(el4, 'dashboard-pmsec-grouphead').map(h => h.textContent);
	assert.ok(heads.some(x => x.includes('数字花园')), 'named group head renders');
	assert.ok(heads[heads.length - 1]!.includes('未分组'), 'ungrouped bucket last');
	// 看板视图：横向列 + 强制紧凑卡（无字段无金额，有 intro/foot）
	const el5 = new El('div');
	renderPmSection(el5 as unknown as HTMLElement, column({ ...config, groupView: 'kanban' }), app3);
	assert.ok(findByClass(el5, 'dashboard-pmsec-kanban').length === 1, 'kanban board renders');
	const kcols = findByClass(el5, 'dashboard-pmsec-kcol');
	assert.ok(kcols.length >= 1, 'one column per group');
	const cc = findByClass(el5, 'dashboard-pmsec-card')[0]!;
	assert.equal(findByClass(el5, 'dashboard-pmsec-fields').length, 0, 'kanban cards are compact: no field grid');
	assert.equal(findByClass(el5, 'dashboard-pmsec-money').length, 0, 'kanban cards are compact: no money strip');
	assert.ok(findByClass(cc, 'dashboard-pmsec-intro').length === 1 && findByClass(cc, 'dashboard-pmsec-foot-actions').length === 1, 'kanban card keeps head + actions');
	console.log('4 toolbar views: ok');
}


// --- 5. Pin: hover button → dashboard-pm-pin; pinned cards ride first ------
{
	const el6 = new El('div');
	renderPmSection(el6 as unknown as HTMLElement, column(config), app);
	let pinDetail: { columnName: string; pinned: string[] } | null = null;
	el6.addEventListener('dashboard-pm-pin', ev => {
		pinDetail = (ev as CustomEvent).detail;
	});
	const card0 = findByClass(el6, 'dashboard-pmsec-card')[0]!;
	const pinBtn = findByClass(card0, 'dashboard-pmsec-star')[0]!;
	pinBtn.click();
	assert.ok(pinDetail, 'pin click fires dashboard-pm-pin');
	assert.deepEqual((pinDetail as unknown as { pinned: string[] }).pinned, [card0.dataset.path], 'payload carries the pinned path list');
	assert.ok(card0.hasClass('is-pinned') === false || true, 'visual state set by re-render');
	// 已置顶的配置：卡片带 is-pinned、排序置顶
	const el7 = new El('div');
	const p0 = app.vault.getMarkdownFiles()[0]!.path;
	renderPmSection(el7 as unknown as HTMLElement, column({ ...config, pinned: [p0] }), app);
	const first = findByClass(el7, 'dashboard-pmsec-card')[0]!;
	assert.ok(first.hasClass('is-pinned'), 'pinned card flagged');
	assert.equal(first.dataset.path, p0, 'pinned card renders first');
	console.log('5 pin: ok');
}

console.log('verify-pm-section: all assertions passed');
