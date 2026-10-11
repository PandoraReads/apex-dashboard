/**
 * Verifies the PM section's DOM-free core (src/pm-model.ts) plus its parser
 * round-trip:
 *
 * 1. collectPmProjects: strict `type: project` matching, archived filtered,
 *    exclude folders honored, stage-order + keyDate sorting, cache-driven
 *    milestone/todo progress.
 * 2. pmField/pmIncome/pmKeyDate/pmCycleText: English keys written, Chinese
 *    aliases accepted; overdue detection.
 * 3. parseProjectBody: the two standard sections (zh + en headings), line
 *    keys stable for toggles, [due::] markers surfaced.
 * 4. insertProjectTask/removeProjectTask/projectBodyTemplate: section
 *    creation when missing, append-inside-section, line removal.
 * 5. Parser: `pm:` config block round-trip (stages/skills/excludes; defaults
 *    omitted for idempotency), sectionType 'pm' survives parse, no card
 *    body serialized.
 *
 * Run: `npm run test:pm-model`
 */
import { strict as assert } from 'node:assert';
import type { CachedMetadata, TFile } from 'obsidian';
import {
	collectPmProjects, collectArchivedPmProjects, pmField, pmIncome, pmKeyDate, isKeyDateOverdue, pmCycleText,
	sumIncome, parseProjectBody, insertProjectTask, removeProjectTask, projectBodyTemplate,
	projectFolder, keyDateCountdown, pmCustomFields,
	orderPmProjects,
} from '../src/pm-model';
import { parse, serialize, defaultPmStages } from '../src/parser';
import { parseTasks } from '../src/pipeline-model';
import type { PmConfig } from '../src/types';

function fakeFile(path: string): TFile {
	return {
		path,
		basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
		stat: { mtime: 1, ctime: 1 },
	} as unknown as TFile;
}

/** Cache with frontmatter + a `## 里程碑`/`## 待办` body shape derived from
 *  the same content string the body parser sees (line numbers line up). */
function fakeApp(files: Array<{ file: TFile; cache: CachedMetadata }>): { vault: { getMarkdownFiles(): TFile[] }; metadataCache: { getFileCache(f: TFile): CachedMetadata | null } } {
	const byPath = new Map(files.map(({ file, cache }) => [file.path, cache]));
	return {
		vault: { getMarkdownFiles: () => files.map(f => f.file) },
		metadataCache: { getFileCache: (f: TFile) => byPath.get(f.path) ?? null },
	};
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

const config: PmConfig = {
	rootFolder: '项目',
	stages: [
		{ label: '意向沟通' },
		{ label: '执行中' },
		{ label: '已完结' },
	],
};

const BODY_A = '## 里程碑\n- [x] 需求确认\n- [ ] 初稿\n## 待办\n- [ ] 发素材 [due:: 2026-10-20]';
const BODY_B = '## Milestones\n- [x] kick-off\n## Todos\n- [x] ship it';

const files = [
	{
		file: fakeFile('项目/A官网.md'),
		cache: cacheFor({
			type: 'project', intro: '官网改版，11月交付', stage: '执行中', status: '等客户素材',
			client: 'Acme', income: 12000, keyDate: '2026-10-15 09:30', remind: true,
			cycleStart: '2026-09-01', cycleEnd: '2026-11-30', nextStep: '发初稿',
			deliverables: '5 页官网 + 部署', payment: '尾款 30% 未收',
		}, BODY_A),
	},
	{
		file: fakeFile('项目/B手册.md'),
		cache: cacheFor({ type: 'Project', 阶段: '意向沟通', 收入: '3,500' }, BODY_B),
	},
	{ file: fakeFile('项目/C归档.md'), cache: cacheFor({ type: 'project', archived: true }, BODY_A) },
	{ file: fakeFile('项目/普通笔记.md'), cache: cacheFor({ type: 'note' }, BODY_A) },
	{ file: fakeFile('其他/D.md'), cache: cacheFor({ type: 'project' }, BODY_A) },
];

const app = fakeApp(files);
const projects = collectPmProjects(app as never, config);

// --- 1. Collect: strict type matching, archived/other-folder filtered. ---
assert.equal(projects.length, 2, 'only the two live projects under 项目 board');
assert.equal(projects[0]!.file.path, '项目/B手册.md', 'stage order: 意向沟通 before 执行中');
assert.equal(projects[1]!.file.path, '项目/A官网.md');

// Archived collection: the flagged note (inside the root) + notes under the
// archive folder even when it sits OUTSIDE the root.
const archived = collectArchivedPmProjects(app as never, config);
assert.equal(archived.length, 1, 'archived project collected');
assert.equal(archived[0]!.file.path, '项目/C归档.md');
assert.deepEqual(archived[0]!.milestones, { done: 1, total: 2 }, 'archived panel counts stay readable');
const archivedOutside = collectArchivedPmProjects(app as never, { ...config, archiveFolder: '归档箱' });
assert.equal(archivedOutside.length, 1, 'archive folder outside the root would also be scanned');
void archivedOutside;

// Custom info entries: the frontmatter `custom` map, insertion-ordered.
assert.deepEqual(
	pmCustomFields({ custom: { 联系人: '张三', 预算来源: 2000, 空: '' } }),
	[{ key: '联系人', value: '张三' }, { key: '预算来源', value: '2000' }],
	'custom map parsed, empties dropped, values stringified',
);
assert.deepEqual(pmCustomFields({ custom: 'oops' }), [], 'non-object custom ignored');
assert.deepEqual(pmCustomFields({}), [], 'absent custom → empty');

// Key-date countdown badge text.
assert.equal(keyDateCountdown({ date: '2026-10-15', remind: false }, new Date('2026-10-10T12:00'))?.text, '5 天后');
assert.equal(keyDateCountdown({ date: '2026-10-08', remind: false }, new Date('2026-10-10T12:00'))?.text, '已逾期 2 天');
assert.equal(keyDateCountdown({ date: '2026-10-10', remind: false }, new Date('2026-10-10T12:00'))?.text, '就是今天');

// Cache-driven progress.
assert.deepEqual(projects[1]!.milestones, { done: 1, total: 2 }, 'milestone progress from cache');
assert.deepEqual(projects[1]!.todos, { done: 0, total: 1 });
assert.deepEqual(projects[0]!.milestones, { done: 1, total: 1 }, 'en headings recognized');

// Exclude folders.
const excluded = collectPmProjects(app as never, { ...config, excludeFolders: ['项目'] });
assert.equal(excluded.length, 0, 'excluded folder removes everything');

// --- 2. Field reads: aliases + derived values. ---
const fmA = projects[1]!.frontmatter;
assert.equal(pmField(fmA, 'intro'), '官网改版，11月交付');
assert.equal(pmField(projects[0]!.frontmatter, 'stage'), '意向沟通', 'zh stage alias');
assert.equal(pmIncome(projects[0]!.frontmatter), 3500, 'zh income alias with thousands separator');
assert.equal(sumIncome(projects), 15500);
const kd = pmKeyDate(fmA);
assert.ok(kd && kd.date === '2026-10-15' && kd.time === '09:30' && kd.remind === true);
assert.equal(isKeyDateOverdue({ date: '2026-01-01', remind: false }, new Date('2026-10-10')), true);
assert.equal(isKeyDateOverdue({ date: '2099-01-01', remind: false }, new Date('2026-10-10')), false);
assert.equal(pmCycleText(fmA), '09.01 – 11.30 · 91d');

// --- 3. Body parsing: sections, line keys, due markers. ---
const bodyA = parseProjectBody(BODY_A);
assert.equal(bodyA.milestones.length, 2);
assert.equal(bodyA.milestones[0]!.text, '需求确认');
assert.equal(bodyA.milestones[0]!.checked, true);
assert.equal(bodyA.milestones[0]!.line, 1, 'line key for toggles');
assert.equal(bodyA.todos[0]!.due, '2026-10-20', '[due::] surfaced');
const bodyB = parseProjectBody(BODY_B);
assert.equal(bodyB.milestones[0]!.text, 'kick-off', 'en headings recognized');
assert.equal(bodyB.todos[0]!.checked, true);

// --- 4. Body editing helpers. ---
let content = projectBodyTemplate(['需求确认', '初稿']);
assert.ok(content.startsWith('## 里程碑\n- [ ] 需求确认\n- [ ] 初稿'));
assert.ok(content.includes('## 待办'));
content = insertProjectTask(content, 'todo', '发素材 [due:: 2026-10-20]');
assert.ok(content.includes('- [ ] 发素材 [due:: 2026-10-20]'));
const parsed = parseProjectBody(content);
assert.equal(parsed.todos.length, 1);
content = insertProjectTask('## 里程碑\n- [ ] a\n', 'milestone', 'b');
assert.ok(content.includes('- [ ] a\n- [ ] b'), 'append inside the section');
const bare = insertProjectTask('# 标题\n\n正文', 'todo', '新待办');
assert.ok(bare.includes('## 待办\n- [ ] 新待办'), 'missing section created at EOF');
const removed = removeProjectTask('## 里程碑\n- [ ] a\n- [ ] b\n', 1);
assert.equal(removed, '## 里程碑\n- [ ] b\n');
assert.equal(removeProjectTask('## 里程碑\n正文', 1), '## 里程碑\n正文', 'non-task line untouched');

// Project folder: sanitization.
assert.equal(projectFolder('项目', 'A/B 官网'), '项目/A-B 官网');

// --- 5. Parser round-trip. ---
const cfg: PmConfig = {
	rootFolder: '项目',
	stages: [{ label: '执行中', color: '#8b7cf6' }, { label: '已完结' }],
	archiveFolder: '项目/99-归档',
	workNoteTemplate: 'Templates/工作笔记',
	skills: [{
		id: 'pms_1', label: '复盘', icon: 'sparkles', agent: 'claudian',
		skillName: 'retro', promptTemplate: '{skill} {path}', directSend: true,
	}],
	excludeFolders: ['项目/模板'],
};
const md = [
	'---',
	'dashboard: true',
	'columns:',
	'  - name: 项目管理',
	'    color: "#8b7cf6"',
	'    type: pm',
	'    pm:',
	'      rootFolder: "项目"',
	'      stages:',
	`        - label: "执行中"`,
	`          color: "#8b7cf6"`,
	`        - label: "已完结"`,
	'      workNoteTemplate: "Templates/工作笔记"',
	'      archiveFolder: "项目/99-归档"',
	'      skills:',
	'        - label: "复盘"',
	'          icon: "sparkles"',
	'          agent: claudian',
	'          skillName: "retro"',
	'          promptTemplate: "{skill} {path}"',
	'          directSend: true',
	'      excludeFolders:',
	'        - "项目/模板"',
	'---',
	'',
	'## 项目管理',
	'',
].join('\n');
const data = parse(md);
assert.equal(data.columns[0]!.sectionType, 'pm');
const round = data.columns[0]!.pmConfig!;
assert.equal(round.rootFolder, cfg.rootFolder);
assert.deepEqual(round.stages, cfg.stages);
assert.equal(round.workNoteTemplate, cfg.workNoteTemplate);
assert.equal(round.archiveFolder, cfg.archiveFolder);
assert.equal(round.skills?.[0]!.skillName, 'retro');
assert.equal(round.skills?.[0]!.directSend, true);
assert.deepEqual(round.excludeFolders, cfg.excludeFolders);
// Two-step stability: serialize injects the default banner on the first
// pass (the input md carried none); from then on bytes are stable.
const once = serialize(data);
assert.equal(serialize(parse(once)), once, 'pm config round-trips byte-stable');
assert.ok(once.includes('    pm:'), 'pm block serialized');
assert.ok(!once.includes('### '), 'no card bodies serialized for pm');

// Defaults: parse seeds stages when absent; serialize omits them (idempotent).
const bareMd = md.replace(/      stages:[\s\S]*?      workNoteTemplate/, '      workNoteTemplate');
const bareData = parse(bareMd);
assert.deepEqual(bareData.columns[0]!.pmConfig!.stages, defaultPmStages(), 'missing stages seeded with localized defaults');
assert.ok(!serialize(bareData).includes('stages:'), 'default-equal stages omitted on serialize');

// ── Manual drag order: orderPmProjects + parser round-trip ───────────────
{
	const mk = (path: string) => ({ file: fakeFile(path), frontmatter: {}, milestones: { done: 0, total: 0 }, todos: { done: 0, total: 0 } });
	const projects = [mk('P/a.md'), mk('P/b.md'), mk('P/c.md'), mk('P/d.md')];
	assert.deepEqual(orderPmProjects(projects, undefined).map(p => p.file.path), ['P/a.md', 'P/b.md', 'P/c.md', 'P/d.md'], 'no order = passthrough');
	assert.deepEqual(orderPmProjects(projects, ['P/c.md', 'P/a.md']).map(p => p.file.path), ['P/c.md', 'P/a.md', 'P/b.md', 'P/d.md'], 'known reorder, unknown append in incoming order');
	assert.deepEqual(orderPmProjects(projects, ['P/zz-gone.md', 'P/d.md']).map(p => p.file.path), ['P/d.md', 'P/a.md', 'P/b.md', 'P/c.md'], 'stale entries ignored');
	// Parser: order serializes as a flow list and round-trips.
	const withOrder = parse(serialize({ ...bareData, columns: [{ ...bareData.columns[0]!, pmConfig: { ...bareData.columns[0]!.pmConfig!, order: ['P/c.md', 'P/a.md'] } }] }));
	assert.deepEqual(withOrder.columns[0]!.pmConfig!.order, ['P/c.md', 'P/a.md'], 'order round-trips');
	assert.ok(serialize(withOrder).includes('order:'), 'order serialized');
	const noOrder = parse(serialize(bareData));
	assert.equal(noOrder.columns[0]!.pmConfig!.order, undefined, 'no order stays unset');
	const withPin = parse(serialize({ ...bareData, columns: [{ ...bareData.columns[0]!, pmConfig: { ...bareData.columns[0]!.pmConfig!, pinned: ['P/b.md', 'P/a.md'] } }] }));
	assert.deepEqual(withPin.columns[0]!.pmConfig!.pinned, ['P/b.md', 'P/a.md'], 'pinned round-trips');
}

// Scheduled/start markers parse like due (display strips, chip keeps value).
{
	const tasks = parseTasks('## 待办\n- [ ] 发素材 [scheduled:: 2026-12-01 09:30]\n- [ ] 开会 [start:: 2026-12-02]\n');
	assert.equal(tasks[0]!.text, '发素材', 'scheduled marker stripped from text');
	assert.equal(tasks[0]!.due, '2026-12-01 09:30', 'scheduled value feeds the chip');
	assert.equal(tasks[1]!.due, '2026-12-02', 'start marker parses too');
}

console.log('verify-pm-model: all assertions passed');
