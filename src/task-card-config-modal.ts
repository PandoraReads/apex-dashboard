import { App, Modal } from 'obsidian';
import type { DashboardCard, TaskCardConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/**
 * Per-card config for a todo-list card (the gear button on the card).
 *
 * The settings outgrew the native dropdown menu — completion behavior, the
 * daily-note task source and the heading level used when the card title is
 * written into a note — so they live in one dialog with an explicit Save.
 */
export class TaskCardConfigModal extends Modal {
	private readonly card: DashboardCard;
	private readonly onSave: (config: TaskCardConfig) => void;

	private behavior: 'stay' | 'end' | 'afterUnfinished';
	private fromDaily: boolean;
	private headingLevel: 1 | 2 | 3 | 4 | 5 | 6;

	constructor(app: App, card: DashboardCard, onSave: (config: TaskCardConfig) => void) {
		super(app);
		this.card = card;
		this.onSave = onSave;
		this.behavior = card.taskCompleteBehavior ?? 'end';
		this.fromDaily = card.tasksFromDaily === true;
		this.headingLevel = card.dailyHeadingLevel ?? 3;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('taskConfig.title') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const form = body.createDiv({ cls: 'dashboard-modal-form' });

		// Completion behavior: where a checked task lands in the list.
		const behaviorField = form.createDiv();
		behaviorField.createEl('label', { text: t('taskConfig.behavior') });
		const behaviorSelect = behaviorField.createEl('select', { cls: 'dashboard-modal-input' });
		for (const value of ['stay', 'end', 'afterUnfinished'] as const) {
			behaviorSelect.createEl('option', { attr: { value }, text: t(`taskBehavior.${value}`) });
		}
		behaviorSelect.value = this.behavior;
		behaviorSelect.addEventListener('change', () => {
			const v = behaviorSelect.value;
			this.behavior = v === 'stay' || v === 'afterUnfinished' ? v : 'end';
		});
		behaviorField.createDiv({ cls: 'dashboard-modal-hint', text: t('taskConfig.behaviorDesc') });

		// Daily-note source: on = the note's title block owns the task list.
		const sourceField = form.createDiv();
		const sourceToggle = sourceField.createDiv({ cls: 'dashboard-modal-check-row' });
		const sourceCheck = sourceToggle.createEl('input', { attr: { type: 'checkbox' } });
		sourceCheck.checked = this.fromDaily;
		const sourceLabel = sourceToggle.createEl('label', { text: t('renderer.tasksFromDaily') });
		sourceLabel.addEventListener('click', () => {
			sourceCheck.checked = !sourceCheck.checked;
			sourceCheck.dispatchEvent(new Event('change'));
		});
		sourceCheck.addEventListener('change', () => { this.fromDaily = sourceCheck.checked; });
		sourceField.createDiv({ cls: 'dashboard-modal-hint', text: t('taskConfig.tasksFromDailyDesc') });

		// Heading depth of the card title inside the daily note.
		const headingField = form.createDiv();
		headingField.createEl('label', { text: t('taskConfig.headingLevel') });
		const headingSelect = headingField.createEl('select', { cls: 'dashboard-modal-input' });
		for (const level of [1, 2, 3, 4, 5, 6] as const) {
			headingSelect.createEl('option', {
				attr: { value: String(level) },
				text: headingOptionLabel(level),
			});
		}
		headingSelect.value = String(this.headingLevel);
		headingSelect.addEventListener('change', () => {
			const n = Number(headingSelect.value);
			this.headingLevel = (n >= 1 && n <= 6 ? n : 3) as 1 | 2 | 3 | 4 | 5 | 6;
		});
		headingField.createDiv({ cls: 'dashboard-modal-hint', text: t('taskConfig.headingLevelDesc') });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		const saveBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		saveBtn.addEventListener('click', () => {
			this.onSave({
				taskCompleteBehavior: this.behavior,
				tasksFromDaily: this.fromDaily,
				dailyHeadingLevel: this.headingLevel,
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Heading-level option label, e.g. `### · H3`. */
export function headingOptionLabel(level: number): string {
	return `${'#'.repeat(level)} · H${level}`;
}
