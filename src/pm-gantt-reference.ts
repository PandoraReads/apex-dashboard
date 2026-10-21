import { App, Menu, Modal, Notice, normalizePath, type TFile } from 'obsidian';
import { parseGanttBlocks, newGanttSource, type GanttTemplate } from './pm-gantt-source';
import { parseProjectBody } from './pm-model';
import { showPromptDialog } from './prompt-dialog';
import { ensureFolder } from './daily-notes';
import { applyModalTheme } from './modal-theme';
import { t } from './i18n';
export interface GanttReference { path: string; chartId: string; kind: 'project' | 'chart' }
export class GanttReferenceModal extends Modal {
	constructor(app: App, private choose: (ref: GanttReference) => void) { super(app); }
	onOpen(): void {
		applyModalTheme(this.containerEl);
		this.contentEl.createEl('h3', { text: t('gantt.sourceTitle') });
		const search = this.contentEl.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'search', placeholder: t('gantt.selectNote') } });
		const notes = this.contentEl.createDiv({ cls: 'dashboard-gantt-picker' });
		const charts = this.contentEl.createDiv();
		let generation = 0;
		const select = async (file: TFile): Promise<void> => {
			const ticket = ++generation;
			try {
				const content = await this.app.vault.read(file);
				if (ticket !== generation) return;
				charts.empty();
				const blocks = parseGanttBlocks(content);
				const body = parseProjectBody(content);
				const options = [...(body.todos.length || body.milestones.length ? [{ id: 'project', title: file.basename, kind: 'project' as const }] : []), ...blocks.map(block => ({ ...block, kind: 'chart' as const }))];
				if (!options.length) charts.createDiv({ text: t('gantt.missing') });
				for (const block of options) charts.createEl('button', { text: `${block.title} · ${block.id}` }).addEventListener('click', () => { this.choose({ path: file.path, chartId: block.id, kind: block.kind }); this.close(); });
			} catch (error) { if (ticket === generation) { charts.empty(); charts.createDiv({ text: error instanceof Error ? error.message : t('gantt.missing') }); } }
		};
		const render = (): void => {
			generation++; charts.empty(); notes.empty();
			const files = this.app.vault.getMarkdownFiles().filter(f => f.path.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
			for (const file of files.slice(0, 100)) notes.createEl('button', { text: file.path }).addEventListener('click', () => { void select(file); });
		};
		search.addEventListener('input', render); render();
	}
}
export async function createGanttReference(app: App, root: string, template: GanttTemplate = 'blank'): Promise<GanttReference | null> {
	const defaultName = template === 'project' ? '项目时间表.md' : '时间表.md';
	const name = await showPromptDialog(app, { title: t('gantt.newSource'), defaultValue: root ? `${root}/${defaultName}` : defaultName });
	if (!name?.trim()) return null;
	const path = normalizePath(name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`);
	if (!path || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.') || /^[a-z]+:/i.test(path)) { new Notice(t('gantt.invalid')); return null; }
	try {
		if (app.vault.getAbstractFileByPath(path)) throw new Error(t('gantt.duplicate'));
		const folder = path.slice(0, path.lastIndexOf('/'));
		if (path.includes('/')) await ensureFolder(app, folder);
		const content = newGanttSource(path.split('/').pop()!.replace(/\.md$/, ''), template);
		await app.vault.create(path, content);
		return { path, chartId: parseGanttBlocks(content)[0]!.id, kind: 'chart' };
	} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return null; }
}
