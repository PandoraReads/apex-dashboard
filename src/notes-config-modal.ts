import { Modal } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { PathPickerModal } from './path-picker-modal';

/** Per-section new-note settings as edited by {@link NotesSectionConfigModal}.
 *  Empty strings mean "unset" (bare note / vault root). */
export interface NotesSectionSettings {
	templatePath: string;
	folder: string;
}

/**
 * Section settings for notes (cover) and notes (no-cover) sections: the
 * template applied to notes created from the section's cards, and the folder
 * they are saved into (vault root when unset). Persisted through the column's
 * libraryConfig (templatePath + folders[0]) so the existing sync/parser
 * plumbing round-trips it.
 */
export class NotesSectionConfigModal extends Modal {
	private readonly cfg: NotesSectionSettings;
	private readonly onSave: (settings: NotesSectionSettings) => void;

	constructor(
		app: import('obsidian').App,
		current: NotesSectionSettings,
		onSave: (settings: NotesSectionSettings) => void,
	) {
		super(app);
		this.cfg = { ...current };
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('notesCfg.title') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// New-note template (vault file; body + non-conflicting frontmatter seed
		// the created note).
		const tplSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		tplSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.newNoteTemplate') });
		tplSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('notesCfg.templateHint') });
		const tplRow = tplSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const tplInput = tplRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: 'Templates/note.md' },
		});
		tplInput.value = this.cfg.templatePath;
		tplRow.createEl('button', {
			cls: 'dashboard-media-folder-browse',
			text: t('folder.browse'),
		}).addEventListener('click', () => {
			new PathPickerModal(this.app, 'file', (path) => {
				this.cfg.templatePath = path;
				tplInput.value = path;
			}).open();
		});
		tplInput.addEventListener('change', () => { this.cfg.templatePath = tplInput.value.trim(); });

		// Save folder (created when missing; vault root when unset).
		const folderSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		folderSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('notesCfg.folder') });
		folderSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('notesCfg.folderHint') });
		const folderRow = folderSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const folderInput = folderRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('notesCfg.folderPlaceholder') },
		});
		folderInput.value = this.cfg.folder;
		folderRow.createEl('button', {
			cls: 'dashboard-media-folder-browse',
			text: t('folder.browse'),
		}).addEventListener('click', () => {
			new PathPickerModal(this.app, 'folder', (path) => {
				this.cfg.folder = path;
				folderInput.value = path;
			}).open();
		});
		folderInput.addEventListener('change', () => { this.cfg.folder = folderInput.value.trim(); });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			// Inputs are authoritative (the browse picker writes into them too).
			this.onSave({
				templatePath: tplInput.value.trim(),
				folder: folderInput.value.trim(),
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
