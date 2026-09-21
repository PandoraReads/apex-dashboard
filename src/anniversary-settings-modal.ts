import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { formatElapsed, parseAnniversaryDate } from './anniversary-widget';
import { WidgetBackgroundModal } from './widget-background';
import type { AnniversaryConfig } from './types';

/** Create/edit one anniversary ("纪念日") entry: a historical date plus the
 *  elapsed display precision and the annual reminder switch. Edits stay local
 *  until Save commits them through onSave. */
export class AnniversarySettingsModal extends Modal {
	private readonly cfg: AnniversaryConfig;
	private readonly onSave: (cfg: AnniversaryConfig) => void;
	private preview: Setting | null = null;

	constructor(app: App, cfg: AnniversaryConfig, onSave: (cfg: AnniversaryConfig) => void) {
		super(app);
		this.cfg = { ...cfg };
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const title = container.createDiv({ cls: 'dashboard-modal-title', text: t('anniversary.editTitle') });
		title.setCssProps({ fontSize: '1em' });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		new Setting(body)
			.setName(t('anniversary.label'))
			.setDesc(t('anniversary.labelDesc'))
			.addText(text => text
				.setPlaceholder(t('anniversary.labelPlaceholder'))
				.setValue(this.cfg.label)
				.onChange(v => { this.cfg.label = v.trim(); }));

		new Setting(body)
			.setName(t('anniversary.startDate'))
			.setDesc(t('anniversary.startDateDesc'))
			.addText(text => {
				// Native date input: Obsidian's Chromium renders a real
				// calendar picker, localized by the OS, value always
				// YYYY-MM-DD. A hand-rolled time part (if ever present) is
				// preserved on top of the picked date.
				text.inputEl.type = 'date';
				text
					.setValue(this.cfg.startDate.split('T')[0] ?? '')
					.onChange(v => {
						const timePart = this.cfg.startDate.includes('T')
							? this.cfg.startDate.split('T')[1] : '';
						this.cfg.startDate = v ? `${v}${timePart ? 'T' + timePart : ''}` : '';
						this.updatePreview();
					});
			});

		new Setting(body)
			.setName(t('anniversary.precision'))
			.setDesc(t('anniversary.precisionDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('ymd', t('anniversary.precisionYmd'))
				.addOption('days', t('anniversary.precisionDays'))
				.addOption('hours', t('anniversary.precisionHours'))
				.setValue(this.cfg.precision)
				.onChange(v => { this.cfg.precision = v as AnniversaryConfig['precision']; this.updatePreview(); }));

		new Setting(body)
			.setName(t('anniversary.annualReminder'))
			.setDesc(t('anniversary.annualReminderDesc'))
			.addToggle(toggle => toggle
				.setValue(this.cfg.annualReminder)
				.onChange(v => { this.cfg.annualReminder = v; }));

		// Card background: the nested modal edits this.cfg.background in
		// place (cfg is a local copy); the parent Save commits it with the
		// rest of the entry.
		new Setting(body)
			.setName(t('wbg.set'))
			.setDesc(this.cfg.background?.image ?? '')
			.addButton(btn => btn
				.setButtonText(this.cfg.background ? t('common.edit') : t('wbg.set'))
				.onClick(() => {
					new WidgetBackgroundModal(this.app, this.cfg.background, (bg) => {
						this.cfg.background = bg;
					}).open();
				}));

		// Live preview of the widget's value line for the current inputs.
		this.preview = new Setting(body)
			.setName(t('anniversary.preview'))
			.setDesc('--');
		this.updatePreview();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			text: t('common.save'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		}).addEventListener('click', () => {
			this.close();
			this.onSave(this.cfg);
		});
	}

	private updatePreview(): void {
		if (!this.preview) return;
		const start = parseAnniversaryDate(this.cfg.startDate);
		this.preview.setDesc(start
			? formatElapsed(start, new Date(), this.cfg.precision)
			: t('anniversary.invalidDate'));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
