import { App, Modal, setIcon } from 'obsidian';
import type { HeatmapConfig } from './types';
import { t } from './i18n';
import { suggestTrackerKeys } from './tracker-service';
import { FolderSuggestModal } from './folder-config-modal';

/**
 * Configuration modal for a heatmap section. Edits the per-section
 * {@link HeatmapConfig} (folder, tracker key, title, range mode, period/days).
 * Tracker-key suggestions come from {@link suggestTrackerKeys}.
 */
export class HeatmapConfigModal extends Modal {
	private config: HeatmapConfig;
	private readonly onSave: (config: HeatmapConfig) => void;

	constructor(app: App, config: HeatmapConfig, onSave: (config: HeatmapConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.config = { ...config };
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('heatmap.configure') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Folder
		const folderSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		folderSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('heatmap.folder') });
		const folderRow = folderSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const folderInput = folderRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('heatmap.folderPlaceholder'), value: this.config.folder ?? '' },
		});
		const browseBtn = folderRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('folder.browse') });
		const setFolder = (path: string): void => {
			this.config.folder = path.trim().replace(/^\/+|\/+$/g, '');
			renderKeys();
		};
		browseBtn.addEventListener('click', () => {
			new FolderSuggestModal(this.app, (folder) => {
				folderInput.value = folder.path;
				setFolder(folder.path);
			}).open();
		});
		folderInput.addEventListener('change', () => { setFolder(folderInput.value); });

		// Tracker key + suggestions (re-computed whenever the folder changes, so
		// the chips reflect the selected folder's real trackable properties).
		const keySection = body.createDiv({ cls: 'dashboard-library-config-section' });
		keySection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('heatmap.key') });
		const keyInput = keySection.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('heatmap.keyPlaceholder'), value: this.config.trackerKey ?? '' },
		});
		keyInput.addEventListener('change', () => {
			this.config.trackerKey = keyInput.value.trim();
		});
		const chipsHost = keySection.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });

		const renderKeys = (): void => {
			chipsHost.empty();
			const keys = suggestTrackerKeys(this.app, this.config.folder || undefined);
			if (keys.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('heatmap.noKeys') });
				return;
			}
			for (const key of keys) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: key });
				chip.addEventListener('click', () => {
					this.config.trackerKey = key;
					keyInput.value = key;
				});
			}
		};
		renderKeys();

		// Period: past year (last 365/366 days) or this year (Jan 1 → Dec 31).
		const periodSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		periodSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('heatmap.periodLabel') });
		const periodSelect = periodSection.createEl('select', { cls: 'dashboard-library-filter-property' });
		const pyOpt = periodSelect.createEl('option', { text: t('heatmap.period_pastYear'), attr: { value: 'pastYear' } });
		const tyOpt = periodSelect.createEl('option', { text: t('heatmap.period_thisYear'), attr: { value: 'thisYear' } });
		const period: HeatmapConfig['period'] = this.config.period === 'thisYear' ? 'thisYear' : 'pastYear';
		(period === 'thisYear' ? tyOpt : pyOpt).selected = true;
		periodSelect.addEventListener('change', () => {
			this.config.period = periodSelect.value === 'thisYear' ? 'thisYear' : 'pastYear';
		});

		// Footer
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave(this.config);
			this.close();
		});
	}

	private textField(parent: HTMLElement, label: string, placeholder: string, value: string, onInput: (v: string) => void): void {
		const section = parent.createDiv({ cls: 'dashboard-library-config-section' });
		section.createDiv({ cls: 'dashboard-library-config-section-title', text: label });
		const input = section.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder, value },
		});
		input.addEventListener('change', () => onInput(input.value.trim()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
