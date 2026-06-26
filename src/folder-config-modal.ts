import { App, Modal, FuzzySuggestModal, TFolder, setIcon } from 'obsidian';
import { t } from './i18n';
import { getAllTags, renderTagsSelector } from './library-section';

/**
 * Configuration modal for a folder section: the folder path plus an optional
 * tag filter. The path can be typed or picked via {@link FolderSuggestModal};
 * tags are multi-select chips (a file shows if it has any selected tag).
 * Reuses the library config modal's styles and tag-selector helper.
 */
export class FolderConfigModal extends Modal {
	private readonly currentPath: string;
	private readonly onSave: (path: string, tags: string[]) => void;
	private selectedTags: string[];
	private pathInput!: HTMLInputElement;

	constructor(
		app: App,
		currentPath: string,
		currentTags: string[],
		onSave: (path: string, tags: string[]) => void,
	) {
		super(app);
		this.currentPath = currentPath;
		this.selectedTags = [...currentTags];
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		// Header
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('folder.configure') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		// Body
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Folder path
		const pathSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		pathSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('folder.path') });

		const inputRow = pathSection.createDiv({ cls: 'dashboard-folder-input-row' });
		this.pathInput = inputRow.createEl('input', {
			cls: 'dashboard-folder-path-input',
			attr: { type: 'text', placeholder: t('folder.pathPlaceholder') },
		});
		this.pathInput.value = this.currentPath;

		const browseBtn = inputRow.createEl('button', {
			cls: 'dashboard-folder-browse-btn',
			text: t('folder.browse'),
		});
		browseBtn.addEventListener('click', () => {
			new FolderSuggestModal(this.app, (folder) => {
				this.pathInput.value = folder.path;
			}).open();
		});

		// Tags filter
		const tagsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		tagsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.tagsFilter') });
		const tagsContainer = tagsSection.createDiv({ cls: 'dashboard-library-filter-values' });
		const allTags = getAllTags(this.app);
		const renderTags = (): void => {
			renderTagsSelector(tagsContainer, allTags, this.selectedTags, (tag) => {
				this.selectedTags = this.selectedTags.includes(tag)
					? this.selectedTags.filter(tg => tg !== tag)
					: [...this.selectedTags, tag];
				renderTags();
			});
		};
		renderTags();

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
			this.onSave(this.pathInput.value.trim(), this.selectedTags);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Fuzzy-search picker over all vault folders (excludes the vault root). */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private readonly onChooseFolder: (folder: TFolder) => void;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChooseFolder = onChoose;
		this.setPlaceholder(t('folder.selectFolder'));
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllLoadedFiles().filter(
			(f): f is TFolder => f instanceof TFolder && f.path !== '/',
		);
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChooseFolder(folder);
	}
}
