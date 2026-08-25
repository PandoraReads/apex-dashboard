import { App, Modal } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

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
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-reminder-modal' });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const msg = body.createDiv({ cls: 'dashboard-reminder-message' });
		msg.textContent = t('reminder.dueNotice', { task: this.taskText });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('reminder.dismiss'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
		}).addEventListener('click', () => {
			this.close();
			this.onDismiss();
		});
		footer.createEl('button', {
			text: t('reminder.snooze'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		}).addEventListener('click', () => {
			this.close();
			this.onSnooze();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
