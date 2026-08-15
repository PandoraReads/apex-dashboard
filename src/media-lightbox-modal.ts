import { App, Modal, setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
import { resolveVaultImage } from './banner';
import { releaseVideoMedia } from './media-section';
import { MediaTagEditModal } from './media-tag-editor-modal';
import { t } from './i18n';

/** Tag access hooks so the lightbox can show/edit per-file tags without
 *  owning the store. onTagsChange commits the new list. */
export interface MediaTagHooks {
	getTags(file: TFile): string[];
	getAllTags(): string[];
	onTagsChange(file: TFile, tags: string[]): void;
}

/**
 * Full-screen lightbox for browsing a list of image or video files.
 * Images show large; videos play inline (controls + autoplay). Left/right
 * arrows (buttons or keyboard) step through the list; Esc / background click
 * closes. Media src comes from {@link resolveVaultImage} which works for both.
 * With tagHooks set, a tag bar below the caption shows and edits per-file
 * tags; saving updates the bar in place so the playing video never restarts.
 */
export class MediaLightboxModal extends Modal {
	private readonly files: TFile[];
	private index: number;
	private readonly kind: 'image' | 'video';
	private readonly tagHooks?: MediaTagHooks;

	constructor(app: App, files: TFile[], startIndex: number, kind: 'image' | 'video', tagHooks?: MediaTagHooks) {
		super(app);
		this.files = files;
		this.index = files.length === 0 ? 0 : Math.max(0, Math.min(startIndex, files.length - 1));
		this.kind = kind;
		this.tagHooks = tagHooks;
	}

	onOpen(): void {
		const { contentEl, containerEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-media-lightbox');
		// Tag every layer so CSS can override Obsidian's default modal sizing and
		// let the media fill + center in the viewport.
		modalEl.addClass('dashboard-media-lightbox-modal');
		containerEl.addClass('dashboard-media-lightbox-container');

		// Keyboard navigation (Esc is handled by Modal already)
		this.scope.register([], 'ArrowLeft', () => { this.show(this.index - 1); return false; });
		this.scope.register([], 'ArrowRight', () => { this.show(this.index + 1); return false; });

		this.renderCurrent();
	}

	private renderCurrent(): void {
		const { contentEl } = this;
		// Release the previously shown video (pause + clear src + load) before
		// wiping the DOM so navigating between items never stacks decoders.
		releaseVideoMedia(contentEl);
		contentEl.empty();
		const file = this.files[this.index];
		if (!file) {
			contentEl.createDiv({ cls: 'dashboard-media-lightbox-empty', text: '—' });
			return;
		}
		const src = resolveVaultImage(this.app, file.path);
		if (!src) return;

		const stage = contentEl.createDiv({ cls: 'dashboard-media-lightbox-stage' });
		if (this.kind === 'image') {
			stage.createEl('img', {
				cls: 'dashboard-media-lightbox-img',
				attr: { src, alt: file.basename },
			});
		} else {
			stage.createEl('video', {
				cls: 'dashboard-media-lightbox-video',
				attr: { src, controls: '', autoplay: '', playsinline: '' },
			});
		}

		contentEl.createDiv({
			cls: 'dashboard-media-lightbox-caption',
			text: `${file.basename}  (${this.index + 1} / ${this.files.length})`,
		});

		if (this.tagHooks) {
			const tagBar = contentEl.createDiv({ cls: 'dashboard-media-lightbox-tags' });
			this.renderTagBar(tagBar, file);
		}

		const prevBtn = contentEl.createDiv({ cls: 'dashboard-media-lightbox-nav dashboard-media-lightbox-nav--prev' });
		setIcon(prevBtn, 'chevron-left');
		if (this.index <= 0) prevBtn.addClass('is-disabled');
		prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.show(this.index - 1); });

		const nextBtn = contentEl.createDiv({ cls: 'dashboard-media-lightbox-nav dashboard-media-lightbox-nav--next' });
		setIcon(nextBtn, 'chevron-right');
		if (this.index >= this.files.length - 1) nextBtn.addClass('is-disabled');
		nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.show(this.index + 1); });

		// Click the backdrop (not the media) to close
		contentEl.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target === contentEl || target.classList.contains('dashboard-media-lightbox-stage')) {
				this.close();
			}
		});
	}

	/** Tag pills + an add button under the caption. Rebuilt in place on save —
	 *  never via renderCurrent(), which would restart a playing video. */
	private renderTagBar(bar: HTMLElement, file: TFile): void {
		bar.empty();
		const hooks = this.tagHooks!;
		for (const tag of hooks.getTags(file)) {
			bar.createSpan({ cls: 'dashboard-media-lightbox-tag', text: tag });
		}
		const addBtn = bar.createDiv({ cls: 'dashboard-media-lightbox-tag dashboard-media-lightbox-tag--add' });
		setIcon(addBtn.createSpan({ cls: 'dashboard-media-lightbox-tag-icon' }), 'plus');
		addBtn.createSpan({ text: t('media.editTags') });
		addBtn.setAttribute('role', 'button');
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new MediaTagEditModal(
				this.app,
				file,
				hooks.getTags(file),
				hooks.getAllTags(),
				(tags) => {
					hooks.onTagsChange(file, tags);
					this.renderTagBar(bar, file);
				},
			).open();
		});
	}

	private show(index: number): void {
		if (index < 0 || index >= this.files.length) return;
		this.index = index;
		this.renderCurrent();
	}

	onClose(): void {
		releaseVideoMedia(this.contentEl);
		this.contentEl.empty();
	}
}
