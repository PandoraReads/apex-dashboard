import { App, Modal, setIcon } from 'obsidian';
import type { LibraryConfig } from './types';
import { t } from './i18n';
import { FolderSuggestModal } from './folder-config-modal';

/**
 * Configuration modal for the all-tasks section: excludes vault folders from
 * aggregation, and sets the default grouping dimension + default view. Mirrors
 * the structure of {@link LibraryConfigModal} but with task-specific fields.
 */
export class AllTasksConfigModal extends Modal {
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
		containerEl.style.background = 'transparent';
		containerEl.style.backgroundColor = 'transparent';
		containerEl.style.border = 'none';
		containerEl.style.boxShadow = 'none';

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		// Header
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('alltasks.configTitle') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Exclude folders
		const excludeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		excludeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('alltasks.excludeFolders') });
		excludeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('alltasks.excludeFoldersHint') });

		const chipsHost = excludeSection.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const addRow = excludeSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const pathInput = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('alltasks.excludeFolderPlaceholder') },
		});
		const browseBtn = addRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		browseBtn.addEventListener('click', () => {
			new FolderSuggestModal(this.app, (folder) => {
				pathInput.value = folder.path;
			}).open();
		});
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('alltasks.addExclude'),
		});

		const renderChips = (): void => {
			chipsHost.empty();
			const folders = this.getExcludes();
			if (folders.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('alltasks.noExcludes') });
				return;
			}
			for (const folder of folders) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: folder });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					this.setExcludes(folders.filter(f => f !== folder));
					renderChips();
				});
			}
		};

		const addFolder = (): void => {
			const folder = pathInput.value.trim().replace(/^\/+|\/+$/g, '');
			pathInput.value = '';
			if (!folder) return;
			const folders = this.getExcludes();
			if (folders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.setExcludes([...folders, folder]);
			renderChips();
		};
		addBtn.addEventListener('click', addFolder);
		pathInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				addFolder();
			}
		});
		renderChips();

		// Default group by
		const groupSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		groupSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('alltasks.defaultGroupBy') });
		const groupSelect = groupSection.createEl('select', { cls: 'dashboard-library-filter-property' });
		const groupOptions: { value: string; label: string }[] = [
			{ value: 'date', label: t('alltasks.groupDate') },
			{ value: 'priority', label: t('alltasks.groupPriority') },
			{ value: 'none', label: t('alltasks.groupNone') },
		];
		const effectiveGroup = this.config.taskGroupBy ?? 'date';
		for (const opt of groupOptions) {
			const o = groupSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
			if (opt.value === effectiveGroup) o.selected = true;
		}
		groupSelect.addEventListener('change', () => {
			this.config.taskGroupBy = groupSelect.value as LibraryConfig['taskGroupBy'];
		});

		// Default view
		const viewSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		viewSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('alltasks.defaultView') });
		const viewSelect = viewSection.createEl('select', { cls: 'dashboard-library-filter-property' });
		const viewOptions: { value: string; label: string }[] = [
			{ value: 'list', label: t('alltasks.viewList') },
			{ value: 'kanban', label: t('alltasks.viewKanban') },
		];
		const effectiveView = this.config.viewMode === 'kanban' ? 'kanban' : 'list';
		for (const opt of viewOptions) {
			const o = viewSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
			if (opt.value === effectiveView) o.selected = true;
		}
		viewSelect.addEventListener('change', () => {
			this.config.viewMode = viewSelect.value === 'kanban' ? 'kanban' : 'list';
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

	onClose(): void {
		this.contentEl.empty();
	}

	private getExcludes(): string[] {
		return this.config.excludeFolders ?? [];
	}

	private setExcludes(folders: string[]): void {
		this.config.excludeFolders = folders;
	}
}
