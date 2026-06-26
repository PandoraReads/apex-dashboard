import { App, Modal } from 'obsidian';
import type { LibraryConfig } from './types';
import { t } from './i18n';
import { FolderSuggestModal } from './folder-config-modal';

/**
 * Configuration modal for the calendar section: only the excluded-folders list
 * (which vault folders are skipped when aggregating dated tasks).
 */
export class CalendarConfigModal extends Modal {
	private config: LibraryConfig;
	private readonly onSave: (config: LibraryConfig) => void;

	constructor(app: App, config: LibraryConfig, onSave: (config: LibraryConfig) => void) {
		super(app);
		this.config = { ...config, excludeFolders: [...(config.excludeFolders ?? [])] };
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		containerEl.setCssProps({
			background: 'transparent',
			backgroundColor: 'transparent',
			border: 'none',
			boxShadow: 'none',
		});

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('calendar.configTitle') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const section = body.createDiv({ cls: 'dashboard-library-config-section' });
		section.createDiv({ cls: 'dashboard-library-config-section-title', text: t('alltasks.excludeFolders') });
		section.createDiv({ cls: 'dashboard-library-config-hint', text: t('calendar.excludeHint') });

		const chipsHost = section.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const addRow = section.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const pathInput = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('alltasks.excludeFolderPlaceholder') },
		});
		const browseBtn = addRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		browseBtn.addEventListener('click', () => {
			new FolderSuggestModal(this.app, (folder) => { pathInput.value = folder.path; }).open();
		});
		const addBtn = addRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('alltasks.addExclude') });

		const renderChips = (): void => {
			chipsHost.empty();
			const folders = this.config.excludeFolders ?? [];
			if (folders.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('alltasks.noExcludes') });
				return;
			}
			for (const folder of folders) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: folder });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					this.config.excludeFolders = folders.filter(f => f !== folder);
					renderChips();
				});
			}
		};

		const addFolder = (): void => {
			const folder = pathInput.value.trim().replace(/^\/+|\/+$/g, '');
			pathInput.value = '';
			if (!folder) return;
			const folders = this.config.excludeFolders ?? [];
			if (folders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.config.excludeFolders = [...folders, folder];
			renderChips();
		};
		addBtn.addEventListener('click', addFolder);
		pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFolder(); } });
		renderChips();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') })
			.addEventListener('click', () => { this.onSave(this.config); this.close(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
