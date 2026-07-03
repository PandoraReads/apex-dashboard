import { App, Modal, setIcon } from 'obsidian';
import type { TickTickTask } from './ticktick-service';
import { t } from './i18n';
import { parseTickDate } from './ticktick-service';
import { DEFAULT_TICKTICK_TZ, fromTzInputs, isValidTz, tzParts } from './ticktick-tz';

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
	private readonly tz: string;

	constructor(app: App, task: TickTickTask, onSave: (fields: { dueDate?: string; priority?: number }) => void | Promise<void>, timezone: string) {
		super(app);
		this.task = task;
		this.onSave = onSave;
		this.tz = isValidTz(timezone) ? timezone : DEFAULT_TICKTICK_TZ;
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
			attr: { type: 'date', value: due ? toDateInput(due, this.tz) : '' },
		});
		const timeInput = dueRow.createEl('input', {
			cls: 'dashboard-library-config-number',
			attr: { type: 'time', value: due ? toTimeInput(due, this.tz) : '09:00' },
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
						fields.dueDate = fromTzInputs(dateInput.value, timeInput.value || '09:00', this.tz);
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

function toDateInput(d: Date, tz: string): string {
	const p = tzParts(d, tz);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function toTimeInput(d: Date, tz: string): string {
	const p = tzParts(d, tz);
	return `${pad(p.hour)}:${pad(p.minute)}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');
