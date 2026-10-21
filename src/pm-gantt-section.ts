import { App, Menu, Notice } from 'obsidian';
import type { PmConfig } from './types';
import { parseProjectBody, pmField, insertProjectTask, type PmProject } from './pm-model';
import { toggleTaskLine } from './pipeline-model';
import { locateScheduleTask } from './pm-schedule';
import { PmBoardModal, notifyPmChanged } from './pm-board-modal';
import { projectScheduleSave } from './pm-schedule-modal';
import { renderGanttChart, type GanttFilter, type GanttGroup } from './pm-gantt-chart';
import { editGanttTask, parseGanttBlocks, updateGanttBlock } from './pm-gantt-source';
import { GanttReferenceModal, createGanttReference, type GanttReference } from './pm-gantt-reference';
import { PmTimelineModal } from './pm-timeline-modal';
import { showPromptDialog } from './prompt-dialog';
import { t } from './i18n';

export function renderPmGantt(host: HTMLElement, controlsHost: HTMLElement, app: App, projects: readonly PmProject[], config: PmConfig, savePrefs: (prefs: Partial<PmConfig>) => void): void {
	const controls = controlsHost.createDiv({ cls: 'dashboard-gantt-controls' });
	const scales = controls.createDiv({ cls: 'dashboard-gantt-control-group dashboard-gantt-scales' });
	const scale = config.ganttScale || 'week';
	for (const value of ['day', 'week', 'month'] as const) {
		const btn = scales.createEl('button', { cls: value === scale ? 'active' : '', text: t(`gantt.${value}`), attr: { 'aria-pressed': String(value === scale) } });
		btn.addEventListener('click', () => savePrefs({ ganttScale: value }));
	}
	const filterGroup = controls.createDiv({ cls: 'dashboard-gantt-control-group dashboard-gantt-filters' });
	const filter = config.ganttFilter || 'all';
	const projectButton = filterGroup.createEl('button', { cls: filter === 'projects' ? 'active dashboard-gantt-project-filter' : 'dashboard-gantt-project-filter', text: `${t('gantt.filter.projects')} ▾`, attr: { 'aria-pressed': String(filter === 'projects'), 'aria-haspopup': 'menu' } });
	projectButton.addEventListener('click', event => {
		const menu = new Menu();
		menu.addItem(item => item.setTitle(t('gantt.filter.allProjects')).setChecked(!config.ganttProjectPath).onClick(() => savePrefs({ ganttFilter: 'projects', ganttProjectPath: undefined })));
		menu.addSeparator();
		for (const project of projects) {
			menu.addItem(item => item.setTitle(project.file.basename).setChecked(config.ganttProjectPath === project.file.path).onClick(() => savePrefs({ ganttFilter: 'projects', ganttProjectPath: project.file.path })));
		}
		menu.showAtMouseEvent(event);
	});
	for (const value of ['todos', 'milestones', 'all'] as const) {
		const btn = filterGroup.createEl('button', { cls: value === filter ? 'active' : '', text: t(`gantt.filter.${value}`), attr: { 'aria-pressed': String(value === filter) } });
		btn.addEventListener('click', () => savePrefs({ ganttFilter: value }));
	}
	controls.createDiv({ cls: 'dashboard-gantt-toolbar-spacer' });
	const actions = controls.createDiv({ cls: 'dashboard-gantt-control-group dashboard-gantt-actions' });
	const chart = host.createDiv({ cls: 'dashboard-gantt-host' });
	actions.createEl('button', { text: t('gantt.today') }).addEventListener('click', () => chart.dispatchEvent(new CustomEvent('dashboard-gantt-today')));
	const choose = (ref: GanttReference): void => {
		if ((config.ganttSources || []).some(s => s.path === ref.path && s.chartId === ref.chartId && (s.kind || (s.chartId === 'project' ? 'project' : 'chart')) === ref.kind) || (ref.kind === 'project' && projects.some(p => p.file.path === ref.path))) { new Notice(t('gantt.duplicate')); return; }
		savePrefs({ ganttSources: [...(config.ganttSources || []), ref] });
	};
	actions.createEl('button', { text: t('gantt.addSource') }).addEventListener('click', () => new GanttReferenceModal(app, choose).open());
	actions.createEl('button', { text: t('gantt.newSource') }).addEventListener('click', event => {
		const menu = new Menu();
		for (const template of ['blank', 'project'] as const) {
			menu.addItem(item => item.setTitle(t(template === 'blank' ? 'gantt.templateBlank' : 'gantt.templateProject')).onClick(() => {
				void createGanttReference(app, config.rootFolder, template).then(ref => { if (ref) choose(ref); });
			}));
		}
		menu.showAtMouseEvent(event);
	});
	const load = async (): Promise<void> => {
		const errors: string[] = [];
		const makeProject = async (project: PmProject): Promise<GanttGroup> => {
			const content = await app.vault.cachedRead(project.file);
			const body = parseProjectBody(content);
			return {
				key: project.file.path, title: project.file.basename, file: project.file,
				cycleStart: pmField(project.frontmatter, 'cycleStart'), cycleEnd: pmField(project.frontmatter, 'cycleEnd'), keyDate: pmField(project.frontmatter, 'keyDate'),
				rows: [...body.milestones.map(task => ({ task, milestone: true })), ...body.todos.map(task => ({ task, milestone: false }))].map(row => ({ ...row,
					save: projectScheduleSave(app, project.file, row.task, notifyPmChanged),
					toggle: async () => { await app.vault.process(project.file, content => toggleTaskLine(content, locateScheduleTask(content, row.task))); notifyPmChanged(); },
				})),
				onOpen: () => new PmBoardModal(app, project.file, config).open(),
				onAdd: milestone => { void showPromptDialog(app, { title: t(milestone ? 'pm.addMilestone' : 'pm.addTodo') }).then(async text => {
					if (text?.trim()) { await app.vault.process(project.file, c => insertProjectTask(c, milestone ? 'milestone' : 'todo', text)); notifyPmChanged(); }
				}).catch((e: unknown) => new Notice(String(e))); },
			};
		};
		const groups: GanttGroup[] = [];
		// Bound concurrency and keep large vaults from issuing unbounded reads.
		for (let i = 0; i < projects.length; i += 8) {
			const batch = await Promise.allSettled(projects.slice(i, i + 8).map(makeProject));
			for (const result of batch) if (result.status === 'fulfilled') groups.push(result.value); else errors.push(String(result.reason));
		}
		for (const ref of config.ganttSources || []) {
			const file = app.vault.getFileByPath(ref.path);
			try {
				if (!file) throw new Error(t('gantt.missing'));
				let group: GanttGroup;
				if ((ref.kind || (ref.chartId === 'project' ? 'project' : 'chart')) === 'project') group = await makeProject({ file, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter || {}, milestones: { done: 0, total: 0 }, todos: { done: 0, total: 0 } });
				else {
					const block = parseGanttBlocks(await app.vault.cachedRead(file)).find(b => b.id === ref.chartId);
					if (!block) throw new Error(t('gantt.missing'));
					group = { key: `${ref.path}#${ref.chartId}`, title: block.title, file,
						rows: block.tasks.map(task => ({ task, group: task.group, milestone: task.kind === 'milestone', save: async patch => { await app.vault.process(file, c => updateGanttBlock(c, block.id, task.id!, patch, task)); notifyPmChanged(); }, toggle: async () => { await app.vault.process(file, content => editGanttTask(content, block.id, task.id!, { checked: !task.checked })); notifyPmChanged(); } })),
						onOpen: () => new PmTimelineModal(app, file, block.id, notifyPmChanged).open() };
				}
				groups.push({ ...group, onRemove: () => savePrefs({ ganttSources: (config.ganttSources || []).filter(s => s !== ref) }) });
			} catch (error) {
				const box = host.createDiv({ cls: 'dashboard-gantt-error', text: `${ref.path} · ${ref.chartId}: ${error instanceof Error ? error.message : String(error)}` });
				box.createEl('button', { text: t('gantt.removeSource') }).addEventListener('click', () => savePrefs({ ganttSources: (config.ganttSources || []).filter(s => s !== ref) }));
			}
		}
		chart.empty();
		for (const message of errors) chart.createDiv({ cls: 'dashboard-gantt-error', text: message });
		if (config.ganttProjectPath && !projects.some(project => project.file.path === config.ganttProjectPath)) savePrefs({ ganttProjectPath: undefined });
		renderGanttChart(chart, app, groups, scale, config.ganttCollapsed || [], key => {
			const collapsed = config.ganttCollapsed || [];
			savePrefs({ ganttCollapsed: collapsed.includes(key) ? collapsed.filter(k => k !== key) : [...collapsed, key] });
		}, (config.ganttFilter || 'all') as GanttFilter, config.ganttProjectPath, (key, nextFilter) => {
			const collapsed = config.ganttCollapsed || [];
			const isOpen = config.ganttFilter === nextFilter || ((config.ganttFilter || 'all') === 'all' && collapsed.includes(key));
			savePrefs({ ganttFilter: 'all', ganttCollapsed: isOpen ? collapsed.filter(item => item !== key) : [...collapsed, key] });
		});
	};
	void load().catch((error: unknown) => chart.createDiv({ cls: 'dashboard-gantt-error', text: error instanceof Error ? error.message : String(error) }));
}
