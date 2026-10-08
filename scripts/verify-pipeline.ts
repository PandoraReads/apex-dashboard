import { strict as assert } from 'node:assert';
import type { App, TFile } from 'obsidian';
import type { DashboardData, PipelineConfig, PipelineStage } from '../src/types';
import {
	cardChips,
	cardSkillVars,
	chipColorFor,
	formatNoteDue,
	parseNoteDue,
	parseTasks,
	distinctFieldValues,
	filterByField,
	PROJECT_FIELD_KEYS,
	railValueColors,
	splitFieldValues,
	PLATFORM_FIELD_KEYS,
	sortStageItems,
	taskProgress,
	toggleTaskLine,
	collectPipelineItems,
	defaultPipelineStages,
	isPathInPipelineRoot,
	itemPropertyChip,
	itemTags,
	resolvePipelineStage,
	stageFolderPath,
	stageSkillVars,
type PipelineItem,
} from '../src/pipeline-model';
import { parse, serialize } from '../src/parser';

function fakeFile(path: string, mtime: number, ctime = mtime): TFile {
	return { path, basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), stat: { mtime, ctime } } as unknown as TFile;
}

function fakeApp(files: Array<{ file: TFile; fm: Record<string, unknown> }>): { vault: { getMarkdownFiles(): TFile[] }; metadataCache: { getFileCache(f: TFile): { frontmatter?: Record<string, unknown> } | null } } {
	const byPath = new Map(files.map(({ file, fm }) => [file.path, fm]));
	return {
		vault: { getMarkdownFiles: () => files.map(f => f.file) },
		metadataCache: {
			getFileCache: (f: TFile) => {
				const fm = byPath.get(f.path);
				return fm ? { frontmatter: fm } : null;
			},
		},
	};
}

const stages: PipelineStage[] = [
	{ value: 'idea', label: '选题', color: '#f59e0b', folder: '01-选题' },
	{ value: 'draft', label: '草稿', color: '#3b82f6' },
	{ value: 'done', label: '已复盘', color: '#64748b', folder: '05-已复盘' },
];

const config: PipelineConfig = {
	rootFolder: '内容创作',
	statusField: 'status',
	stages,
	skills: [],
};

/** Same as `config` but with the serializer-default status field. */
function config2(): PipelineConfig {
	return { ...config, statusField: 'status' };
}

function main(): void {
	// --- Stage resolution: trimmed + case-insensitive, null on miss/empty. ---
	assert.equal(resolvePipelineStage(stages, 'Draft')?.value, 'draft');
	assert.equal(resolvePipelineStage(stages, ' done ')?.value, 'done');
	assert.equal(resolvePipelineStage(stages, 'unknown'), null);
	assert.equal(resolvePipelineStage(stages, undefined), null);

	// --- Root scoping: prefix match on folder boundaries only. ---
	assert.equal(isPathInPipelineRoot('内容创作/02-草稿/a.md', '内容创作'), true);
	assert.equal(isPathInPipelineRoot('内容创作2/a.md', '内容创作'), false);
	assert.equal(isPathInPipelineRoot('anywhere/a.md', ''), true);

	// --- Stage folders resolve under the root; rootless stays null. ---
	const [ideaStage, draftStage, doneStage] = stages;
	assert.ok(ideaStage && draftStage && doneStage);
	assert.equal(stageFolderPath(config, ideaStage), '内容创作/01-选题');
	assert.equal(stageFolderPath(config, draftStage), null);
	assert.equal(stageFolderPath({ ...config, rootFolder: '' }, ideaStage), '01-选题');

	// --- Grouping: by stage only. STRICT scope — notes whose status matches
	//     no stage (missing or unknown) never appear, wherever they live. ---
	const a = fakeFile('内容创作/01-选题/alpha.md', 100);
	const b = fakeFile('内容创作/01-选题/beta.md', 300);
	const c = fakeFile('内容创作/x.md', 200);
	const d = fakeFile('其他/other.md', 999);
	const app = fakeApp([
		{ file: a, fm: { status: 'IDEA' } },
		{ file: b, fm: { status: 'idea' } },
		{ file: c, fm: { platform: '小红书' } },
		{ file: d, fm: { status: 'idea' } },
	]);
	const model = collectPipelineItems(app as unknown as App, config);
	assert.deepEqual(model.byStage.get('idea')!.map(i => i.file.basename), ['beta', 'alpha']);
	assert.equal(model.byStage.get('draft')!.length, 0);
	// Statusless note inside the root: invisible on the board.
	assert.equal([...model.byStage.values()].flat().some(i => i.file.path === c.path), false);
	// Matching note outside the root: invisible too (scope beats status).
	assert.equal([...model.byStage.values()].flat().some(i => i.file.path === d.path), false);
	// Excluded folders (template stashes) never board either.
	const tmpl = fakeFile('内容创作/模板/骨架.md', 50);
	const modelEx = collectPipelineItems(fakeApp([
		{ file: a, fm: { status: 'idea' } },
		{ file: tmpl, fm: { status: 'idea' } },
	]) as unknown as App, { ...config, excludeFolders: ['内容创作/模板/'] });
	assert.deepEqual(modelEx.byStage.get('idea')!.map(i => i.file.basename), ['alpha']);

	// --- Chips: configured keys render "key: value"; default = platform + tags. ---
	const colored = cardChips({ platform: '小红书', tags: ['a'] });
	assert.deepEqual(colored.map(c => ({ text: c.text, isProperty: c.isProperty })), [
		{ text: '小红书', isProperty: true },
		{ text: 'a', isProperty: false },
	]);
	assert.ok(colored[0]!.color, 'property chip carries a color');
	assert.equal(chipColorFor('小红书'), chipColorFor('小红书'), 'same value = same color');
	assert.ok(chipColorFor('a') !== chipColorFor('b') || chipColorFor('b') !== chipColorFor('c'), 'palette distributes');
	assert.deepEqual(cardChips({ platform: '小红书', 栏目: '方法论', tags: ['a'] }, ['栏目']), [
		{ text: '方法论', isProperty: true, color: chipColorFor('方法论') },
	]);
	assert.deepEqual(cardChips({ 栏目: '' }, ['栏目']), []);

	// --- Chips: tags (array / string), platform, caps. ---
	assert.deepEqual(itemTags({ tags: ['a', 'b'] }), ['a', 'b']);
	assert.deepEqual(itemTags({ tags: 'a, b，c' }), ['a', 'b', 'c']);
	assert.deepEqual(itemTags({ tag: 'solo' }), ['solo']);
	assert.deepEqual(itemTags({}), []);
	assert.equal(itemPropertyChip({ platform: '小红书' }), '小红书');
	assert.equal(itemPropertyChip({}), null);

	// --- Skill vars. ---
	const item = model.byStage.get('idea')![0]!;
	assert.ok(item);
	assert.deepEqual(cardSkillVars(item, config), {
		path: '内容创作/01-选题/beta.md',
		title: 'beta',
		stage: '选题',
		folder: '内容创作',
	});
	assert.deepEqual(stageSkillVars(stages[1]!, config), { path: '', title: '', stage: '草稿', folder: '内容创作' });

	// --- Checklist: progress from cache chars, parsing + toggling lines. ---
	assert.deepEqual(taskProgress([{ task: ' ' }, { task: 'x' }, { task: 'X' }, {}]), { done: 2, total: 3 });
	assert.deepEqual(taskProgress(undefined), { done: 0, total: 0 });
	const noteBody = [
		'# T',
		'- [ ] 写初稿 [due:: 2026-10-08 14:00]',
		'- [x] 收集素材',
		'- 普通行',
		'  - [ ] 子任务',
	].join('\n');
	const tasks = parseTasks(noteBody);
	assert.equal(tasks.length, 3);
	assert.deepEqual(tasks[0], { line: 1, text: '写初稿', checked: false, due: '2026-10-08 14:00' });
	assert.equal(tasks[1]!.checked, true);
	assert.equal(tasks[2]!.line, 4);
	assert.ok(toggleTaskLine(noteBody, 1).split('\n')[1]!.includes('- [x]'));
	assert.ok(toggleTaskLine(noteBody, 2).split('\n')[2]!.includes('- [ ]'));
	assert.equal(toggleTaskLine(noteBody, 3), noteBody, 'non-task line unchanged');

	// --- Note-level due: parse + format round-trip. ---
	const due = parseNoteDue({ due: '2026-10-08 14:30', remind: true });
	assert.deepEqual(due, { date: '2026-10-08', time: '14:30', remind: true });
	assert.equal(formatNoteDue(due!), '2026-10-08 14:30');
	assert.equal(parseNoteDue({ due: '2026-10-08' })!.time, undefined);
	assert.equal(parseNoteDue({ due: 'not a date' }), null);
	assert.equal(parseNoteDue({ remind: true }), null, 'no due value means no alarm');

	// --- Within-stage ordering: mtime (default), ctime, platform. ---
	const s1 = { file: fakeFile('a.md', 100, 50), stage: stages[0]!, frontmatter: {} };
	const s2 = { file: fakeFile('b.md', 300, 200), stage: stages[0]!, frontmatter: { platform: 'wechat' } };
	const s3 = { file: fakeFile('c.md', 200, 400), stage: stages[0]!, frontmatter: { platform: 'bilibili' } };
	const s4 = { file: fakeFile('d.md', 50, 350), stage: stages[0]!, frontmatter: {} };
	assert.deepEqual(sortStageItems([s1, s2, s3, s4], undefined).map(i => i.file.basename), ['b', 'c', 'a', 'd'], 'default mtime desc');
	assert.deepEqual(sortStageItems([s1, s2, s3, s4], 'ctime').map(i => i.file.basename), ['c', 'd', 'b', 'a'], 'ctime desc');
	assert.deepEqual(sortStageItems([s1, s2, s3, s4], 'platform').map(i => i.file.basename), ['c', 'b', 'a', 'd'], 'platform: grouped (bilibili < wechat), newest inside, blanks last');

	// --- Project dimension reads any alias (项目 / project / 相关项目). ---
	const aliasItems: PipelineItem[] = [
		{ file: fakeFile('内容创作/p1.md', 1), stage: stages[0]!, frontmatter: { 项目: 'LME' } },
		{ file: fakeFile('内容创作/p2.md', 2), stage: stages[0]!, frontmatter: { project: '个人IP' } },
		{ file: fakeFile('内容创作/p3.md', 3), stage: stages[0]!, frontmatter: { 相关项目: 'LME' } },
		{ file: fakeFile('内容创作/p4.md', 4), stage: stages[0]!, frontmatter: { project: 'LME' } },
	];
	assert.deepEqual(distinctFieldValues(aliasItems, PROJECT_FIELD_KEYS), [
		{ value: 'LME', count: 3 },
		{ value: '个人IP', count: 1 },
	], 'aliases merge; first non-empty wins per note');
	const aliasModel = { byStage: new Map([['idea', aliasItems]]) };
	assert.equal(filterByField(aliasModel, PROJECT_FIELD_KEYS, 'LME').byStage.get('idea')!.length, 3);
	assert.equal(filterByField(aliasModel, PROJECT_FIELD_KEYS, '个人IP').byStage.get('idea')!.length, 1);

	// Rail colors: latte MONOCHROME ramp — one hue, lightness deepens
	// downward, ink flips at the readability threshold.
	const lOf = (c: string) => Number(c.match(/hsl\(178deg 38% (\d+)%\)/)?.[1] ?? -1);
	const c0 = railValueColors(0, 3);
	const c1 = railValueColors(1, 3);
	const c2 = railValueColors(2, 3);
	assert.ok(lOf(c0.bg) < lOf(c1.bg) && lOf(c1.bg) < lOf(c2.bg), 'lightness ascends (deep turquoise → pale tiffany)');
	assert.equal(c0.ink, '#ffffff', 'deep end carries white ink');
	assert.equal(c2.ink, '#33484d', 'pale end carries slate ink');

	// Multi-value fields: arrays and comma strings split into individual
	// values — the rail lists each value, a note matches either filter.
	assert.deepEqual(splitFieldValues(['小红书', '公众号']), ['小红书', '公众号']);
	assert.deepEqual(splitFieldValues('小红书，公众号'), ['小红书', '公众号']);
	assert.deepEqual(splitFieldValues('  单值  '), ['单值']);
	assert.deepEqual(splitFieldValues(undefined), []);
	const multiItems: PipelineItem[] = [
		{ file: fakeFile('内容创作/m1.md', 1), stage: stages[0]!, frontmatter: { platform: ['小红书', '公众号'] } },
		{ file: fakeFile('内容创作/m2.md', 2), stage: stages[0]!, frontmatter: { platform: '小红书' } },
	];
	assert.deepEqual(distinctFieldValues(multiItems, PLATFORM_FIELD_KEYS), [
		{ value: '小红书', count: 2 },
		{ value: '公众号', count: 1 },
	], 'multi-value note counts under EACH value');
	const multiModel = { byStage: new Map([['idea', multiItems]]) };
	assert.equal(filterByField(multiModel, PLATFORM_FIELD_KEYS, '公众号').byStage.get('idea')!.length, 1, 'note matches its second value too');
	assert.equal(cardChips({ platform: ['小红书', '公众号'] }).length, 2, 'one colored chip per value');

	// Platform dimension aliases: 平台 / platform merge the same way.
	const platItems: PipelineItem[] = [
		{ file: fakeFile('内容创作/w1.md', 1), stage: stages[0]!, frontmatter: { 平台: '小红书' } },
		{ file: fakeFile('内容创作/w2.md', 2), stage: stages[0]!, frontmatter: { platform: '公众号' } },
		{ file: fakeFile('内容创作/w3.md', 3), stage: stages[0]!, frontmatter: { platform: '小红书' } },
	];
	assert.deepEqual(distinctFieldValues(platItems, PLATFORM_FIELD_KEYS), [
		{ value: '小红书', count: 2 },
		{ value: '公众号', count: 1 },
	], 'platform aliases merge');

	// --- Filter rail: distinct values + filtering the grouped model. ---
	const railItems: PipelineItem[] = [
		{ file: fakeFile('内容创作/a.md', 1), stage: stages[0]!, frontmatter: { platform: '公众号' } },
		{ file: fakeFile('内容创作/b.md', 2), stage: stages[0]!, frontmatter: { platform: '公众号' } },
		{ file: fakeFile('内容创作/c.md', 3), stage: stages[0]!, frontmatter: { platform: '小红书' } },
		{ file: fakeFile('内容创作/d.md', 4), stage: stages[0]!, frontmatter: { note: 'no platform' } },
	];
	assert.deepEqual(distinctFieldValues(railItems, 'platform').map(v => v.value), ['公众号', '小红书'], 'count desc, blanks skipped');
	assert.equal(distinctFieldValues(railItems, 'platform')[0]!.count, 2);
	assert.deepEqual(distinctFieldValues(railItems, 'project'), [], 'no values = no rail');
	const grouped = collectPipelineItems(fakeApp([
		{ file: railItems[0]!.file, fm: { status: 'idea', platform: '公众号' } },
		{ file: railItems[2]!.file, fm: { status: 'idea', platform: '小红书' } },
	]) as unknown as App, config);
	assert.equal(grouped.byStage.get('idea')!.length, 2, 'both notes land in the idea stage');
	const filtered = filterByField(grouped, 'platform', '公众号');
	assert.deepEqual(filtered.byStage.get('idea')!.map(i => i.file.basename), ['a']);
	assert.equal(filterByField(grouped, 'platform', null).byStage.get('idea')!.length, 2, 'null = unfiltered');

	// --- Default stages: 5 slugs, stable order. ---
	assert.deepEqual(defaultPipelineStages({ idea: 'a', draft: 'b', review: 'c', pending: 'd', retro: 'e' }).map(s => s.value), ['idea', 'draft', 'review', 'done', 'published'], 'Rae live order: done=待发布, published=待复盘');
	assert.equal(defaultPipelineStages({ idea: 'a', draft: 'b', review: 'c', pending: 'd', retro: 'e' })[0]!.folder, '00-选题库');

	// --- Parser round-trip: pipeline config survives serialize -> parse. ---
	const data = {
		banner: { quote: '', author: '', image: '' },
		quickActions: [],
		columns: [
			{
				name: '内容流水线',
				color: '#10b981',
				sectionType: 'pipeline',
				cards: [],
				pipelineConfig: {
					rootFolder: '内容创作',
					statusField: 'status',
					stages: stages.map((stage, i) => i === 0 ? { ...stage, width: 240 } : stage),
					excludeFolders: ['内容创作/模板'],
					cardProperties: ['栏目', '平台'],
					boardStyle: 'trello' as const,
					archiveFolder: '内容创作/99-归档',
					sortBy: 'ctime' as const,
					filter: { dim: 'platform', value: '公众号' } as { dim: string; value: string },
					filterFields: ['平台', '栏目'] as string[],
					skills: [{
						id: 'sk_1', label: '写草稿', icon: 'pencil', agent: 'codex' as const,
						stage: 'draft', scope: 'card' as const, skillName: 'write-draft',
						promptTemplate: '$write-draft\n\n文件: {path}\n{input}',
					}],
					templatePath: 'Templates/item.md',
					directSend: true,
				},
			},
		],
	};
	const md = serialize(data as unknown as DashboardData);
	const parsed = parse(md);
	const col = parsed.columns[0];
	assert.ok(col);
	assert.equal(col.sectionType, 'pipeline');
	assert.equal(col.pipelineConfig?.rootFolder, '内容创作');
	assert.equal(col.pipelineConfig?.statusField, 'status');
	assert.deepEqual(col.pipelineConfig?.stages, stages.map((stage, i) => i === 0 ? { ...stage, width: 240 } : stage));
	const skill = col.pipelineConfig?.skills[0];
	assert.ok(skill);
	assert.equal(skill.label, '写草稿');
	assert.equal(skill.agent, 'codex', 'Codex target survives pipeline serialization');
	assert.equal(skill.scope, 'card');
	assert.equal(skill.promptTemplate, '$write-draft\n\n文件: {path}\n{input}');
	assert.equal(col.pipelineConfig?.templatePath, 'Templates/item.md');
	assert.equal(col.pipelineConfig?.directSend, true);
	assert.equal(col.pipelineConfig?.stages[0]?.width, 240, 'stage width round-trips');
	assert.deepEqual(col.pipelineConfig?.excludeFolders, ['内容创作/模板']);
	assert.deepEqual(col.pipelineConfig?.cardProperties, ['栏目', '平台']);
	assert.equal(col.pipelineConfig?.boardStyle, 'trello');
	const solidMd = serialize({ ...data, columns: [{ ...data.columns[0]!, pipelineConfig: { ...config2(), boardStyle: 'solid' as const } }] } as unknown as DashboardData);
	assert.equal(parse(solidMd).columns[0]!.pipelineConfig?.boardStyle, 'solid', 'solid round-trips');
	const blushMd = serialize({ ...data, columns: [{ ...data.columns[0]!, pipelineConfig: { ...config2(), boardStyle: 'blush' as const } }] } as unknown as DashboardData);
	assert.equal(parse(blushMd).columns[0]!.pipelineConfig?.boardStyle, 'blush', 'blush round-trips');
	assert.equal(col.pipelineConfig?.archiveFolder, '内容创作/99-归档');
	assert.equal(col.pipelineConfig?.sortBy, 'ctime');
	assert.deepEqual(col.pipelineConfig?.filter, { dim: 'platform', value: '公众号' });
	assert.deepEqual(col.pipelineConfig?.filterFields, ['平台', '栏目']);
	// Idempotent: re-serializing the parsed data is byte-identical.
	assert.equal(serialize(parsed as unknown as DashboardData), md);
	// The 'status' default is omitted on write and restored on read.
	const defaultFieldMd = serialize({ ...data, columns: [{ ...data.columns[0]!, pipelineConfig: { ...config2() } }] } as unknown as DashboardData);
	assert.ok(!defaultFieldMd.includes('statusField'), 'default field not serialized');
	assert.equal(parse(defaultFieldMd).columns[0]!.pipelineConfig?.statusField, 'status');
	assert.ok(serialize({ ...data, columns: [{ ...data.columns[0]!, pipelineConfig: { ...config2(), statusField: '状态' } }] } as unknown as DashboardData).includes('statusField: "状态"'), 'non-default field persists');
}

main();
