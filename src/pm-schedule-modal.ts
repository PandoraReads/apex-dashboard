import { App, Modal, Notice, type TFile } from 'obsidian';
import type { PipelineTask } from './pipeline-model';
import { updateSchedule, type SchedulePatch } from './pm-schedule';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export type ScheduleSave = (patch: SchedulePatch) => Promise<void>;
export function projectScheduleSave(app: App, file: TFile, task: PipelineTask, changed: () => void): ScheduleSave {
	return async patch => {
		await app.vault.process(file, content => updateSchedule(content, task, patch));
		changed();
	};
}
export class PmScheduleModal extends Modal {
	constructor(app: App, private task: PipelineTask, private milestone: boolean, private save: ScheduleSave) { super(app); }
	onOpen(): void {
		applyModalTheme(this.containerEl);
		this.modalEl.addClass('dashboard-gantt-schedule-shell');
		this.contentEl.addClass('dashboard-gantt-schedule-content');
		const host = this.contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-gantt-schedule-modal' });
		host.createEl('h3', { text: this.task.text });
		const mode = this.milestone ? host.createEl('select', { cls: 'dashboard-modal-input dashboard-gantt-mode-select', attr: { 'aria-label': t('gantt.range') } }) : null;
		if (mode) {
			mode.createEl('option', { value: 'point', text: t('gantt.point') });
			mode.createEl('option', { value: 'range', text: t('gantt.range') });
			mode.value = (this.task.start || this.task.scheduled) && this.task.end ? 'range' : 'point';
		}
		const inputs: Partial<Record<keyof SchedulePatch, HTMLInputElement>> = {};
		const rows: Partial<Record<keyof SchedulePatch, HTMLElement>> = {};
		for (const key of ['start', 'end', 'due', 'scheduled'] as const) {
			const row = host.createDiv({ cls: 'dashboard-gantt-date-row' });
			rows[key] = row;
			row.createEl('label', { text: t(`gantt.${key}`) });
			const input = row.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'datetime-local', 'aria-label': t(`gantt.${key}`) } });
			const value = key === 'end' && mode?.value === 'point' ? this.task.end || this.task.deadline || this.task.scheduled || this.task.start : key === 'due' ? this.task.deadline : this.task[key];
			input.value = value ? `${value.slice(0, 10)}T${value.slice(11) || '00:00'}` : '';
			input.dataset.originalValue = value || '';
			inputs[key] = input;
		}
		const updateMode = (): void => {
			if (!mode) return;
			rows.start!.hidden = mode.value === 'point';
			rows.due!.hidden = true;
			rows.scheduled!.hidden = true;
		};
		mode?.addEventListener('change', updateMode);
		updateMode();
		const error = host.createDiv({ cls: 'dashboard-gantt-error', attr: { role: 'alert' } });
		const actions = host.createDiv({ cls: 'dashboard-modal-footer' });
		const clear = actions.createEl('button', { text: t('gantt.clear') });
		clear.addEventListener('click', () => Object.values(inputs).forEach(input => { input.value = ''; }));
		const save = actions.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') });
		save.addEventListener('click', () => {
			const patch: SchedulePatch = Object.fromEntries(Object.entries(inputs).map(([key, input]) => {
				const original = input!.dataset.originalValue || '';
				const initialDisplay = original ? `${original.slice(0, 10)}T${original.slice(11) || '00:00'}` : '';
				if (input!.value === initialDisplay) return [key, original];
				const changed = input!.value.replace('T', ' ');
				return [key, !original.includes(' ') && changed.endsWith(' 00:00') ? changed.slice(0, 10) : changed];
			}));
			if (mode?.value === 'point') { patch.start = ''; patch.scheduled = ''; }
			for (const key of Object.keys(patch) as Array<keyof SchedulePatch>) {
				const value = key === 'due' ? this.task.deadline : this.task[key];
				if ((value || '') === patch[key]) delete patch[key];
			}
			save.disabled = true;
			void this.save(patch).then(() => this.close()).catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				error.setText(message); new Notice(message); save.disabled = false;
			});
		});
	}
}
