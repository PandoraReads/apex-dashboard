import { App, Modal, Notice, type TFile } from 'obsidian';
import { parseGanttBlocks, addGanttTask, editGanttTask, removeGanttTask, updateGanttBlock } from './pm-gantt-source';
import { PmScheduleModal } from './pm-schedule-modal';
import { showPromptDialog } from './prompt-dialog';
import { showConfirmDialog } from './confirm-dialog';
import { applyModalTheme } from './modal-theme';
import { t } from './i18n';

export class PmTimelineModal extends Modal {
	constructor(app: App, private file: TFile, private chartId: string, private changed: () => void) { super(app); }
	onOpen(): void { applyModalTheme(this.containerEl); void this.render(); }
	private async mutate(transform: (content: string) => string): Promise<void> {
		try { await this.app.vault.process(this.file, transform); this.changed(); await this.render(); }
		catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
	}
	private async render(): Promise<void> {
		try {
			const block = parseGanttBlocks(await this.app.vault.read(this.file)).find(b => b.id === this.chartId);
			this.contentEl.empty();
			if (!block) { this.contentEl.createDiv({ text: t('gantt.missing') }); return; }
			this.contentEl.createEl('h3', { text: block.title });
			for (const task of block.tasks) {
				const row = this.contentEl.createDiv({ cls: 'dashboard-gantt-editor-row' });
				const checkbox = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': task.text } });
				checkbox.checked = task.checked;
				checkbox.addEventListener('change', () => void this.mutate(c => editGanttTask(c, block.id, task.id!, { checked: checkbox.checked })));
				const title = row.createEl('button', { text: task.text });
				title.addEventListener('click', () => { void showPromptDialog(this.app, { title: t('pm.editTask'), defaultValue: task.text }).then(text => { if (text?.trim()) void this.mutate(c => editGanttTask(c, block.id, task.id!, { text })); }); });
				row.createEl('button', { text: t('gantt.schedule') }).addEventListener('click', () => new PmScheduleModal(this.app, task, task.kind === 'milestone', async patch => {
					await this.app.vault.process(this.file, c => updateGanttBlock(c, block.id, task.id!, patch, task)); this.changed(); await this.render();
				}).open());
				row.createEl('button', { text: t('pm.groupView') }).addEventListener('click', () => { void showPromptDialog(this.app, { title: t('pm.groupView'), defaultValue: task.group || '' }).then(group => { if (group !== null) void this.mutate(c => editGanttTask(c, block.id, task.id!, { group })); }); });
				row.createEl('button', { text: t('common.delete') }).addEventListener('click', () => { void showConfirmDialog(this.app, { title: t('common.confirmDelete'), message: task.text }).then(yes => { if (yes) void this.mutate(c => removeGanttTask(c, block.id, task.id!)); }); });
			}
			for (const milestone of [false, true]) this.contentEl.createEl('button', { text: t(milestone ? 'pm.addMilestone' : 'pm.addTodo') }).addEventListener('click', () => {
				void showPromptDialog(this.app, { title: t(milestone ? 'pm.addMilestone' : 'pm.addTodo') }).then(text => { if (text?.trim()) void this.mutate(c => addGanttTask(c, block.id, text, milestone)); });
			});
		} catch (error) { this.contentEl.empty(); this.contentEl.createDiv({ text: error instanceof Error ? error.message : t('gantt.missing') }); }
	}
}
