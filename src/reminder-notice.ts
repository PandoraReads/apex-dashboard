import { App, Modal } from 'obsidian';
import { t } from './i18n';

export class ReminderNoticeModal extends Modal {
	private readonly taskText: string;
	private readonly onDismiss: () => void;
	private readonly onSnooze: () => void;

	constructor(app: App, taskText: string, onDismiss: () => void, onSnooze: () => void) {
		super(app);
		this.taskText = taskText;
		this.onDismiss = onDismiss;
		this.onSnooze = onSnooze;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-modal', 'dashboard-reminder-modal');

		const msg = contentEl.createDiv({ cls: 'dashboard-reminder-message' });
		msg.textContent = t('reminder.dueNotice', { task: this.taskText });

		const actions = contentEl.createDiv({ cls: 'dashboard-reminder-actions' });

		const snoozeBtn = actions.createEl('button', {
			text: t('reminder.snooze'),
			cls: 'dashboard-reminder-snooze',
		});
		snoozeBtn.addEventListener('click', () => {
			this.close();
			this.onSnooze();
		});

		const dismissBtn = actions.createEl('button', {
			text: t('reminder.dismiss'),
			cls: 'dashboard-reminder-dismiss',
		});
		dismissBtn.addEventListener('click', () => {
			this.close();
			this.onDismiss();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
