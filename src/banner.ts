import { App, Modal, setIcon } from 'obsidian';
import type { BannerData, QuoteItem } from './types';
import { t } from './i18n';

export function getActiveQuote(banner: BannerData): QuoteItem {
	if (banner.quotes && banner.quotes.length > 0) {
		return banner.quotes[0]!;
	}
	return { quote: banner.quote, author: banner.author };
}

export function getActiveImage(banner: BannerData): string {
	if (banner.images && banner.images.length > 0) {
		return banner.images[0]!;
	}
	return banner.image;
}

export function renderBanner(
	container: HTMLElement,
	banner: BannerData,
	onEdit: () => void,
	app: App,
): HTMLElement {
	const el = container.createDiv({ cls: 'dashboard-banner' });

	const activeImage = getActiveImage(banner);
	if (activeImage) {
		const resolved = resolveVaultImage(app, activeImage);
		if (resolved) {
			el.style.backgroundImage = `url("${resolved}")`;
		}
	}

	const overlay = el.createDiv({ cls: 'dashboard-banner-overlay' });
	const content = overlay.createDiv({ cls: 'dashboard-banner-content' });

	const active = getActiveQuote(banner);

	// Allow an empty quotes collection — Banner then shows only the background image.
	if (active.quote || active.author) {
		const quoteText = content.createEl('p', {
			cls: 'dashboard-banner-quote',
			text: active.quote,
		});

		const authorText = content.createEl('cite', {
			cls: 'dashboard-banner-author',
			text: active.author,
		});

		if (banner.quoteColor) {
			quoteText.style.color = banner.quoteColor;
			authorText.style.color = banner.quoteColor;
			quoteText.style.textShadow = `0 1px 3px rgba(0,0,0,0.3)`;
			authorText.style.textShadow = `0 1px 2px rgba(0,0,0,0.2)`;
		}
	}

	const editBtn = overlay.createEl('button', {
		cls: 'dashboard-banner-edit-btn',
		attr: { 'aria-label': t('banner.editLabel') },
	});
	setIcon(editBtn, 'wand');
	editBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		onEdit();
	});

	return el;
}

export function resolveVaultImage(app: App, relativePath: string): string | null {
	if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
		return relativePath;
	}

	const file = app.vault.getFileByPath(relativePath);
	if (!file) return null;

	const adapter = app.vault.adapter;
	if ('getResourcePath' in adapter && typeof (adapter as { getResourcePath: (path: string) => string }).getResourcePath === 'function') {
		return (adapter as { getResourcePath: (path: string) => string }).getResourcePath(relativePath);
	}

	const parts = relativePath.split('/');
	const encoded = parts.map(p => encodeURIComponent(p)).join('/');
	return `app://local/${encoded}`;
}

export class BannerEditModal extends Modal {
	private banner: BannerData;
	private onSave: (updates: Partial<BannerData>) => void;
	private theme: string;
	private quotes: QuoteItem[];
	private images: string[];

	constructor(app: App, banner: BannerData, onSave: (updates: Partial<BannerData>) => void, theme?: string) {
		super(app);
		this.banner = banner;
		this.onSave = onSave;
		this.theme = theme ?? 'earth';
		this.quotes = banner.quotes && banner.quotes.length > 0
			? banner.quotes.map(q => ({ ...q }))
			: [{ quote: banner.quote, author: banner.author }];
		this.images = banner.images && banner.images.length > 0
			? [...banner.images]
			: banner.image ? [banner.image] : [];
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal', 'dashboard-modal--compact');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		contentEl.createEl('h2', { text: t('banner.editTitle') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// === Quotes section ===
		const quotesSection = form.createDiv({ cls: 'dashboard-modal-quotes' });
		quotesSection.createEl('label', { text: t('banner.quotesLabel'), cls: 'dashboard-modal-quotes-label' });
		const quotesList = quotesSection.createDiv({ cls: 'dashboard-modal-quotes-list' });

		const renderQuotes = () => {
			quotesList.empty();
			for (let i = 0; i < this.quotes.length; i++) {
				const item = this.quotes[i]!;
				const row = quotesList.createDiv({ cls: 'dashboard-modal-quote-item' });

				const fields = row.createDiv({ cls: 'dashboard-modal-quote-fields' });

				const qInput = fields.createEl('textarea', {
					cls: 'dashboard-modal-input dashboard-modal-quote-input',
					attr: { rows: '2', placeholder: t('banner.quote') },
				});
				qInput.value = item.quote;
				qInput.addEventListener('input', () => {
					this.quotes[i] = { ...this.quotes[i]!, quote: qInput.value };
				});

				const aInput = fields.createEl('input', {
					cls: 'dashboard-modal-input dashboard-modal-author-input',
					attr: { type: 'text', placeholder: t('banner.author') },
				});
				aInput.value = item.author;
				aInput.addEventListener('input', () => {
					this.quotes[i] = { ...this.quotes[i]!, author: aInput.value };
				});

				if (this.quotes.length > 1) {
					const delBtn = row.createEl('button', {
						cls: 'dashboard-modal-quote-delete',
						attr: { 'aria-label': t('banner.deleteQuote') },
					});
					setIcon(delBtn, 'x');
					delBtn.addEventListener('click', () => {
						this.quotes.splice(i, 1);
						renderQuotes();
					});
				}
			}
		};

		renderQuotes();

		const addQuoteBtn = quotesSection.createEl('button', {
			cls: 'dashboard-modal-quote-add',
			text: t('banner.addQuote'),
		});
		addQuoteBtn.addEventListener('click', () => {
			this.quotes.push({ quote: '', author: '' });
			renderQuotes();
			const last = quotesList.querySelector<HTMLTextAreaElement>('.dashboard-modal-quote-item:last-child textarea');
			if (last) last.focus();
		});

		// === Images section ===
		const imagesSection = form.createDiv({ cls: 'dashboard-modal-images' });
		imagesSection.createEl('label', { text: t('banner.imagesLabel'), cls: 'dashboard-modal-images-label' });
		const imagesList = imagesSection.createDiv({ cls: 'dashboard-modal-images-list' });

		const renderImages = () => {
			imagesList.empty();
			for (let i = 0; i < this.images.length; i++) {
				const row = imagesList.createDiv({ cls: 'dashboard-modal-image-item' });

				const imgInput = row.createEl('input', {
					cls: 'dashboard-modal-input dashboard-modal-image-input',
					attr: { type: 'text', placeholder: 'attachments/banner.jpg' },
				});
				imgInput.value = this.images[i]!;
				imgInput.addEventListener('input', () => {
					this.images[i] = imgInput.value;
				});

				if (this.images.length > 1) {
					const delBtn = row.createEl('button', {
						cls: 'dashboard-modal-image-delete',
						attr: { 'aria-label': t('banner.deleteImage') },
					});
					setIcon(delBtn, 'x');
					delBtn.addEventListener('click', () => {
						this.images.splice(i, 1);
						renderImages();
					});
				}
			}
		};

		renderImages();

		const addImageBtn = imagesSection.createEl('button', {
			cls: 'dashboard-modal-image-add',
			text: t('banner.addImage'),
		});
		addImageBtn.addEventListener('click', () => {
			this.images.push('');
			renderImages();
			const last = imagesList.querySelector<HTMLInputElement>('.dashboard-modal-image-item:last-child input');
			if (last) last.focus();
		});

		// === Quote Color ===
		const colorSection = form.createDiv({ cls: 'dashboard-modal-quote-color' });
		colorSection.createEl('label', { text: t('banner.quoteColor'), cls: 'dashboard-modal-quote-color-label' });
		const colorRow = colorSection.createDiv({ cls: 'dashboard-modal-quote-color-row' });

		const colorInput = colorRow.createEl('input', {
			cls: 'dashboard-modal-color-input',
			attr: { type: 'color' },
		});
		colorInput.value = this.banner.quoteColor || '#ffffff';

		const colorResetBtn = colorRow.createEl('button', {
			cls: 'dashboard-modal-color-reset',
			text: t('banner.resetColor'),
		});
		colorResetBtn.addEventListener('click', () => {
			colorInput.value = '#ffffff';
		});

		// === Actions ===
		const actions = form.createDiv({ cls: 'dashboard-modal-actions' });

		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			const validQuotes = this.quotes.filter(q => q.quote.trim());
			const validImages = this.images.filter(s => s.trim());
			const updates: Partial<BannerData> = {};

			if (validQuotes.length > 0) {
				updates.quote = validQuotes[0]!.quote;
				updates.author = validQuotes[0]!.author;
				updates.quotes = validQuotes.length > 1 ? validQuotes : undefined;
			} else {
				// Empty quotes allowed — Banner will show only the background image.
				updates.quote = '';
				updates.author = '';
				updates.quotes = undefined;
			}
			if (validImages.length > 0) {
				updates.image = validImages[0]!;
				updates.images = validImages.length > 1 ? validImages : undefined;
			} else {
				updates.image = '';
				updates.images = undefined;
			}

			const colorVal = colorInput.value;
			updates.quoteColor = colorVal === '#ffffff' ? undefined : colorVal;

			this.onSave(updates);
			this.close();
		});

		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
