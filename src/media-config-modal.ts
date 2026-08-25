import { App, Modal } from 'obsidian';
import type { LibraryConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { ExcludeFoldersEditor } from './exclude-folders-editor';

/**
 * Configuration modal for images/videos sections. These sections scan the whole
 * vault by default; the currently supported setting is the excluded-folder set
 * (files inside them never reach the section). Persisted in the column's
 * `libraryConfig.excludeFolders` — the same field the all-tasks and calendar
 * sections use — so the parser round-trips it with no extra handling.
 */
export class MediaConfigModal extends Modal {
	private readonly existing: LibraryConfig | undefined;
	private readonly onSave: (config: LibraryConfig) => void;

	constructor(
		app: App,
		existing: LibraryConfig | undefined,
		onSave: (config: LibraryConfig) => void,
	) {
		super(app);
		this.existing = existing;
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

		// Header
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('media.configure') });

		// Body
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const excludeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		excludeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('exclude.folders') });
		excludeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('exclude.foldersHint') });
		const excludeEditor = new ExcludeFoldersEditor(this.app, excludeSection, this.existing?.excludeFolders ?? []);

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
			// Media sections only consume excludeFolders; keep a complete
			// LibraryConfig shape (viewMode/sortBy/... defaults) so the YAML
			// round-trip never writes `undefined` values.
			const base = this.existing ?? {
				filters: [],
				viewMode: 'grid' as const,
				sortBy: 'modified',
				sortDesc: true,
			};
			const folders = excludeEditor.value;
			this.onSave({ ...base, excludeFolders: folders.length > 0 ? folders : undefined });
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
