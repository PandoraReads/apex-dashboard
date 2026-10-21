import { renameGanttReferences } from './pm-gantt-rename';
import { parseNoteFrontmatter } from './pm-model';
import { MarkdownRenderChild, Menu, Notice, TFile } from 'obsidian';
import type DashboardPlugin from './main';
import { editGanttTask, parseGanttBlocks, updateGanttBlock } from './pm-gantt-source';
import { renderGanttChart, type GanttScale, type GanttGroup } from './pm-gantt-chart';
import { PmTimelineModal } from './pm-timeline-modal';
import { parse } from './parser';
import { notifyPmChanged } from './pm-board-modal';
import { t } from './i18n';

async function addToWorkspace(plugin: DashboardPlugin, source: string, chartId: string, event: MouseEvent): Promise<void> {
	const menu = new Menu();
	let count = 0;
	for (const [index, path] of plugin.settings.workspaceFiles.entries()) {
		const file = plugin.app.vault.getFileByPath(`${path}.md`);
		if (!file) continue;
		const data = parse(await plugin.app.vault.cachedRead(file));
		for (const column of data.columns.filter(c => c.sectionType === 'pm')) {
			count++;
			menu.addItem(item => item.setTitle(`${plugin.settings.workspaceNames?.[index] || path} → ${column.name}`).onClick(() => {
				void plugin.app.fileManager.processFrontMatter(file, fm => {
					const frontmatter = fm as Record<string, unknown>;
					const columns = Array.isArray(frontmatter.columns) ? frontmatter.columns as Array<Record<string, unknown>> : undefined;
					const target = columns?.find(c => c.name === column.name);
					if (!target) throw new Error(t('gantt.noTarget'));
					const pm = (target.pm || {}) as Record<string, unknown>;
					const sources = (Array.isArray(pm.ganttSources) ? pm.ganttSources : []) as Array<{ path: string; chartId: string; kind?: 'project' | 'chart' }>;
					if (sources.some(s => s.path === source && s.chartId === chartId && (s.kind || (s.chartId === 'project' ? 'project' : 'chart')) === 'chart')) throw new Error(t('gantt.duplicate'));
					target.pm = { ...pm, viewMode: 'gantt', ganttSources: [...sources, { path: source, chartId, kind: 'chart' }] };
				}).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
			}));
		}
	}
	if (!count) { new Notice(t('gantt.noTarget')); return; }
	menu.showAtMouseEvent(event);
}
class GanttEmbed extends MarkdownRenderChild {
	private scale: GanttScale = 'week';
	private collapsed: string[] = [];
	private generation = 0;
	constructor(el: HTMLElement, private plugin: DashboardPlugin, private sourcePath: string, private chartId: string) { super(el); }
	onload(): void {
		this.registerEvent(this.plugin.app.vault.on('modify', file => { if (file.path === this.sourcePath) void this.render(); }));
		this.registerEvent(this.plugin.app.vault.on('rename', (file, old) => { if (old === this.sourcePath) { this.sourcePath = file.path; void this.render(); } }));
		this.registerEvent(this.plugin.app.vault.on('delete', file => { if (file.path === this.sourcePath) { this.generation++; this.containerEl.empty(); this.containerEl.createDiv({ text: t('gantt.missing') }); } }));
		void this.render();
	}
	onunload(): void { this.generation++; }
	private async render(): Promise<void> {
		const generation = ++this.generation;
		try {
			const file = this.plugin.app.vault.getFileByPath(this.sourcePath);
			if (!file) throw new Error(t('gantt.missing'));
			const block = parseGanttBlocks(await this.plugin.app.vault.cachedRead(file)).find(b => b.id === this.chartId);
			if (generation !== this.generation) return;
			if (!block) throw new Error(t('gantt.missing'));
			this.containerEl.empty(); this.containerEl.addClass('dashboard-gantt-embed');
			const controls = this.containerEl.createDiv({ cls: 'dashboard-gantt-controls' });
			controls.createEl('button', { text: t('gantt.addTo') }).addEventListener('click', event => { void addToWorkspace(this.plugin, file.path, block.id, event).catch((e: unknown) => new Notice(String(e))); });
			for (const scale of ['day', 'week', 'month'] as const) controls.createEl('button', { text: t(`gantt.${scale}`) }).addEventListener('click', () => { this.scale = scale; void this.render(); });
			const group: GanttGroup = { key: block.id, title: block.title, file,
				rows: block.tasks.map(task => ({ task, group: task.group, milestone: task.kind === 'milestone', save: async patch => { await this.plugin.app.vault.process(file, c => updateGanttBlock(c, block.id, task.id!, patch, task)); notifyPmChanged(); }, toggle: async () => { await this.plugin.app.vault.process(file, c => editGanttTask(c, block.id, task.id!, { checked: !task.checked })); notifyPmChanged(); } })),
				onOpen: () => new PmTimelineModal(this.plugin.app, file, block.id, notifyPmChanged).open() };
			renderGanttChart(this.containerEl, this.plugin.app, [group], this.scale, this.collapsed, key => {
				this.collapsed = this.collapsed.includes(key) ? this.collapsed.filter(k => k !== key) : [...this.collapsed, key]; void this.render();
			}, 'all', undefined, key => {
				this.collapsed = this.collapsed.includes(key) ? this.collapsed.filter(k => k !== key) : [...this.collapsed, key]; void this.render();
			});
		} catch (error) { if (generation === this.generation) { this.containerEl.empty(); this.containerEl.createDiv({ cls: 'dashboard-gantt-error', text: error instanceof Error ? error.message : String(error) }); } }
	}
}
export function registerGanttFeatures(plugin: DashboardPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('apex-gantt', (source, el, ctx) => {
		try {
			const blocks = parseGanttBlocks('```apex-gantt\n' + source + '\n```');
			if (!blocks[0]) throw new Error(t('gantt.invalid'));
			ctx.addChild(new GanttEmbed(el, plugin, ctx.sourcePath, blocks[0].id));
		} catch (error) { el.createDiv({ cls: 'dashboard-gantt-error', text: error instanceof Error ? error.message : String(error) }); }
	});
	// Only known workspace files are touched; frontmatter writes preserve body and layout.
	let queue: Promise<void> = Promise.resolve();
	plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
		queue = queue.then(async () => {
			for (const path of plugin.settings.workspaceFiles) {
				const workspace = plugin.app.vault.getFileByPath(`${path}.md`);
				if (!(workspace instanceof TFile)) continue;
				try {
					const fm = parseNoteFrontmatter(await plugin.app.vault.cachedRead(workspace));
					if (renameGanttReferences(fm, oldPath, file.path) === fm) continue;
					await plugin.app.fileManager.processFrontMatter(workspace, current => {
						const currentRecord = current as Record<string, unknown>;
						const next = renameGanttReferences(currentRecord, oldPath, file.path);
						if (next !== currentRecord) currentRecord.columns = next.columns;
					});
				} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
			}
		}).catch((error: unknown) => { new Notice(error instanceof Error ? error.message : String(error)); });
	}));
}
