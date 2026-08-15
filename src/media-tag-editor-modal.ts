import { App, Notice, TFile } from 'obsidian';
import { Modal } from 'obsidian';
import { t } from './i18n';
import { MEDIA_TAG_MAX_LEN, MEDIA_TAG_MAX_PER_FILE, normalizeTags } from './media-tags';

/**
 * Small modal to edit the tag list of one media file. Shared by all three
 * entry points (lightbox tag bar, tile button, table Tags column). Tag state
 * is committed only on Save via the onSave callback.
 */
export class MediaTagEditModal extends Modal {
	private file: TFile;
	private tags: string[];
	private readonly allKnownTags: string[];
	private readonly onSave: (tags: string[]) => void;

	constructor(
		app: App,
		file: TFile,
		currentTags: string[],
		allKnownTags: string[],
		onSave: (tags: string[]) => void,
	) {
		super(app);
		this.file = file;
		this.tags = [...currentTags];
		this.allKnownTags = [...allKnownTags];
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.addClass('dashboard-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		contentEl.createEl('h2', { text: t('media.editTagsTitle', { name: this.file.basename }) });
		contentEl.createDiv({ cls: 'dashboard-media-tagedit-path', text: this.file.path });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// Current tags as removable chips
		const listField = form.createDiv();
		listField.createEl('label', { text: t('media.editTags') });
		const chipsHost = listField.createDiv({ cls: 'dashboard-media-tagedit-chips' });

		const renderChips = (): void => {
			chipsHost.empty();
			if (this.tags.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-modal-docs-empty', text: t('library.noTags') });
				return;
			}
			for (const tag of this.tags) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-media-tagedit-chip' });
				chip.createSpan({ text: tag });
				const x = chip.createSpan({ cls: 'dashboard-media-tagedit-chip-x', text: '×' });
				x.setAttribute('role', 'button');
				x.addEventListener('click', () => {
					this.tags = this.tags.filter(tg => tg !== tag);
					renderChips();
					renderQuickPick();
				});
			}
		};

		// Add via input
		const addField = form.createDiv();
		addField.createEl('label', { text: t('media.addTagPlaceholder') });
		const input = addField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('media.addTagPlaceholder') },
		});

		const addTag = (): void => {
			const tag = input.value.trim();
			if (!tag) return;
			if (tag.length > MEDIA_TAG_MAX_LEN) {
				new Notice(t('media.tagTooLong', { count: MEDIA_TAG_MAX_LEN }));
				return;
			}
			if (this.tags.length >= MEDIA_TAG_MAX_PER_FILE) {
				new Notice(t('media.tagLimitReached', { count: MEDIA_TAG_MAX_PER_FILE }));
				return;
			}
			if (!this.tags.includes(tag)) {
				this.tags = [...this.tags, tag];
				renderChips();
				renderQuickPick();
			}
			input.value = '';
			input.focus();
		};
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); addTag(); }
		});
		addField.createEl('button', { cls: 'dashboard-media-tagedit-add', text: t('common.add') }).addEventListener('click', addTag);

		// Quick pick from tags already in use elsewhere
		const pickField = form.createDiv();
		pickField.createEl('label', { text: t('media.existingTags') });
		const pickHost = pickField.createDiv({ cls: 'dashboard-media-tagedit-pick' });
		const renderQuickPick = (): void => {
			pickHost.empty();
			const candidates = this.allKnownTags.filter(tag => !this.tags.includes(tag));
			if (candidates.length === 0) {
				pickHost.createDiv({ cls: 'dashboard-modal-docs-empty', text: t('library.noTags') });
				return;
			}
			for (const tag of candidates) {
				const chip = pickHost.createDiv({ cls: 'dashboard-library-filter-chip', text: tag });
				chip.addEventListener('click', () => {
					if (this.tags.length >= MEDIA_TAG_MAX_PER_FILE) {
						new Notice(t('media.tagLimitReached', { count: MEDIA_TAG_MAX_PER_FILE }));
						return;
					}
					this.tags = [...this.tags, tag];
					renderChips();
					renderQuickPick();
				});
			}
		};
		renderQuickPick();
		renderChips();

		// Actions
		const actions = contentEl.createDiv({ cls: 'dashboard-modal-actions' });
		actions.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-cta', text: t('common.save') }).addEventListener('click', () => {
			this.onSave(normalizeTags(this.tags));
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
