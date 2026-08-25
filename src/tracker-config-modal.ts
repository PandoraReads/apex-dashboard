import { App, Modal } from 'obsidian';
import type { TrackerConfig, TrackerStyle } from './types';
import { suggestTrackerKeys } from './tracker-service';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export class TrackerConfigModal extends Modal {
	private onSave: (title: string, config: TrackerConfig) => void;

	private keyValue = '';
	private daysValue = 30;
	private styleValue: TrackerStyle = 'line';

	constructor(
		app: App,
		onSave: (title: string, config: TrackerConfig) => void,
	) {
		super(app);
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
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('tracker.configTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Frontmatter key
		const keySection = body.createDiv({ cls: 'dashboard-library-config-section' });
		keySection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('tracker.keyLabel') });
		const keyInput = keySection.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('tracker.keyPlaceholder') },
		});
		keyInput.addEventListener('input', () => {
			this.keyValue = keyInput.value.trim();
		});

		// Suggested keys
		const suggestions = suggestTrackerKeys(this.app);
		if (suggestions.length > 0) {
			const sugWrap = keySection.createDiv({ cls: 'tracker-key-suggestions' });
			sugWrap.createDiv({ cls: 'tracker-key-suggestions-label', text: t('tracker.keySuggestions') });
			const tagRow = sugWrap.createDiv({ cls: 'tracker-key-tags' });
			for (const k of suggestions.slice(0, 8)) {
				const tag = tagRow.createEl('button', { cls: 'tracker-key-tag', text: k });
				tag.addEventListener('click', () => {
					this.keyValue = k;
					keyInput.value = k;
				});
			}
		}

		// Chart style selector
		const styleSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		styleSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('tracker.styleLabel') });
		const styleRow = styleSection.createDiv({ cls: 'dashboard-library-view-toggle' });

		const styleOptions: { value: TrackerStyle; label: string }[] = [
			{ value: 'line', label: t('tracker.styleLine') },
			{ value: 'heatmap', label: t('tracker.styleHeatmap') },
			{ value: 'bar', label: t('tracker.styleBar') },
		];

		for (const opt of styleOptions) {
			const btn = styleRow.createEl('button', {
				cls: 'dashboard-library-view-btn' + (opt.value === this.styleValue ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => {
				this.styleValue = opt.value;
				styleRow.querySelectorAll('.dashboard-library-view-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		// Days selector
		const daysSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		daysSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('tracker.daysLabel') });
		const daysRow = daysSection.createDiv({ cls: 'dashboard-library-view-toggle' });

		const dayOptions = [
			{ value: 7, label: t('tracker.days7') },
			{ value: 14, label: t('tracker.days14') },
			{ value: 30, label: t('tracker.days30') },
			{ value: 90, label: t('tracker.days90') },
			{ value: 180, label: t('tracker.days180') },
			{ value: 365, label: t('tracker.days365') },
		];

		for (const opt of dayOptions) {
			const btn = daysRow.createEl('button', {
				cls: 'dashboard-library-view-btn' + (opt.value === this.daysValue ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => {
				this.daysValue = opt.value;
				daysRow.querySelectorAll('.dashboard-library-view-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		// Actions
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
			if (!this.keyValue) return;
			this.onSave(this.keyValue, { key: this.keyValue, days: this.daysValue, style: this.styleValue });
			this.close();
		});

		keyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveBtn.click();
			}
		});

		keyInput.focus();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
