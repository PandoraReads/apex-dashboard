import { App, Modal, setIcon } from 'obsidian';
import type { TickTickTask } from './ticktick-service';
import { t } from './i18n';
import { parseTickDate } from './ticktick-service';

const PRIORITIES: Array<{ value: number; labelKey: string }> = [
	{ value: 0, labelKey: 'ticktick.prioNone' },
	{ value: 1, labelKey: 'ticktick.prioLow' },
	{ value: 3, labelKey: 'ticktick.prioMedium' },
	{ value: 5, labelKey: 'ticktick.prioHigh' },
];

/** Edit a task's due date and priority. onSave receives the changed fields. */
export class TickTickTaskEditModal extends Modal {
	private readonly task: TickTickTask;
	private readonly onSave: (fields: { dueDate?: string; priority?: number }) => void | Promise<void>;

	constructor(app: App, task: TickTickTask, onSave: (fields: { dueDate?: string; priority?: number }) => void | Promise<void>) {
		super(app);
		this.task = task;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: this.task.title || t('ticktick.editTask') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Due date (date + time inputs)
		const due = parseTickDate(this.task.dueDate);
		const dueRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		dueRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('ticktick.dueDate') });
		const dateInput = dueRow.createEl('input', {
			cls: 'dashboard-task-input dashboard-section-name-input',
			attr: { type: 'date', value: due ? toDateInput(due) : '' },
		});
		const timeInput = dueRow.createEl('input', {
			cls: 'dashboard-library-config-number',
			attr: { type: 'time', value: due ? toTimeInput(due) : '09:00' },
		});

		// Priority
		const prioRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		prioRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('ticktick.priority') });
		const prioSelect = prioRow.createEl('select', { cls: 'dashboard-library-filter-property' });
		for (const p of PRIORITIES) {
			const opt = prioSelect.createEl('option', { text: t(p.labelKey), attr: { value: String(p.value) } });
			if (this.task.priority === p.value) opt.selected = true;
		}

		// Clear due button
		const clearRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		clearRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('ticktick.clearDue') })
			.addEventListener('click', () => { dateInput.value = ''; });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') })
			.addEventListener('click', () => {
				void (async () => {
					const fields: { dueDate?: string; priority?: number } = {
						priority: parseInt(prioSelect.value, 10),
					};
					if (dateInput.value) {
						const d = new Date(`${dateInput.value}T${timeInput.value || '09:00'}`);
						if (!isNaN(d.getTime())) fields.dueDate = toTickDateLocal(d);
					} else {
						fields.dueDate = ''; // clear
					}
					await this.onSave(fields);
					this.close();
				})();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function toDateInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** TickTick format: yyyy-MM-dd'T'HH:mm:ss+HHMM (offset without colon). */
function toTickDateLocal(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? '+' : '-';
	const abs = Math.abs(off);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
