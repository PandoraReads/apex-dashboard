import { App, Modal } from 'obsidian';
import type { TFile } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { formatNoteDue, parseNoteDue, type NoteDue } from './pipeline-model';

/**
 * Note-level due editor for a workflow card: date + optional time + a
 * reminder-alarm toggle, persisted as the note's `due` / `remind` frontmatter
 * (the same `YYYY-MM-DD( HH:MM)` value shape the [due::] task field uses).
 * Clearing removes both fields.
 */
export class PipelineDueModal extends Modal {
	constructor(
		app: App,
		private readonly file: TFile,
		private readonly frontmatter: Record<string, unknown>,
		private readonly onSaved?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const current = parseNoteDue(this.frontmatter);
		const wrap = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		wrap.createEl('h2', { text: `${this.file.basename} · ${t('pipeline.dueTitle')}` });

		const body = wrap.createDiv({ cls: 'dashboard-modal-body dashboard-pipeline-due-body' });
		const dateRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		dateRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.dueDate') });
		const dateInput = dateRow.createEl('input', {
			cls: 'dashboard-pipeline-cfg-input',
			attr: { type: 'date' },
		}) as HTMLInputElement;
		dateInput.value = current?.date ?? '';

		const timeRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		timeRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.dueTime') });
		const timeInput = timeRow.createEl('input', {
			cls: 'dashboard-pipeline-cfg-input',
			attr: { type: 'time' },
		}) as HTMLInputElement;
		timeInput.value = current?.time ?? '';

		const remindRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		remindRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.dueRemind') });
		const remind = remindRow.createEl('input', {
			cls: 'dashboard-pipeline-cfg-toggle',
			attr: { type: 'checkbox' },
		}) as HTMLInputElement;
		remind.checked = current?.remind === true;
		remindRow.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.dueRemindHint') });

		const footer = wrap.createDiv({ cls: 'dashboard-modal-footer' });
		const clear = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('pipeline.dueClear'),
		});
		clear.addEventListener('click', () => {
			void this.persist(null);
		});
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		const save = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		save.addEventListener('click', () => {
			const date = dateInput.value.trim();
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
			const time = /^\d{2}:\d{2}$/.test(timeInput.value.trim()) ? timeInput.value.trim() : undefined;
			void this.persist({ date, ...(time ? { time } : {}), remind: remind.checked });
		});
	}

	private async persist(due: NoteDue | null): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
				if (due) {
					fm['due'] = formatNoteDue(due);
					if (due.remind) fm['remind'] = true;
					else delete fm['remind'];
				} else {
					delete fm['due'];
					delete fm['remind'];
				}
			});
			this.onSaved?.();
			this.close();
		} catch (err) {
			console.error('[Dashboard] pipeline due save failed:', err);
			// Keep the modal open so the input isn't silently lost.
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
