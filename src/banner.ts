import { App, Modal, setIcon } from 'obsidian';
import type { BannerData, BannerStatsConfig, QuoteItem } from './types';
import { t } from './i18n';
import { renderBannerStats, resolveStatsConfig, LEFT_STAT_OPTIONS, CENTER_STAT_OPTIONS, RIGHT_STAT_OPTIONS } from './banner-stats';
import { getDailyNotesConfig } from './daily-notes';
import { MultiFolderSelectModal } from './folder-config-modal';
import { getHabitService } from './habit-service';

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

	// Stats mode: three-column data panel over the (blurred, darkened) poster image.
	if (banner.mode === 'stats') {
		el.addClass('dashboard-banner--stats');
		const activeImage = getActiveImage(banner);
		if (activeImage) {
			const resolved = resolveVaultImage(app, activeImage);
			if (resolved) el.style.backgroundImage = `url("${resolved}")`;
		}
		renderBannerStats(el, banner.statsConfig, app);
		createBannerEditButton(el, onEdit);
		return el;
	}

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

	createBannerEditButton(overlay, onEdit);

	return el;
}

/** The wand button that opens the banner editor. Shared by both banner modes;
 *  positioned absolutely so it works whether it hangs off the banner or its overlay. */
function createBannerEditButton(parent: HTMLElement, onEdit: () => void): HTMLButtonElement {
	const btn = parent.createEl('button', {
		cls: 'dashboard-banner-edit-btn',
		attr: { 'aria-label': t('banner.editLabel') },
	});
	setIcon(btn, 'wand');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onEdit();
	});
	return btn;
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
	private mode: 'quote' | 'stats';
	private statsDraft: BannerStatsConfig;
	private quoteColorDraft: string;
	private form!: HTMLDivElement;

	constructor(app: App, banner: BannerData, onSave: (updates: Partial<BannerData>) => void, theme?: string) {
		super(app);
		this.banner = banner;
		this.onSave = onSave;
		this.theme = theme ?? 'earth';
		this.mode = banner.mode === 'stats' ? 'stats' : 'quote';
		this.statsDraft = resolveStatsConfig(banner.statsConfig);
		this.quoteColorDraft = banner.quoteColor || '#ffffff';
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

		this.renderModeHeader(contentEl);
		this.renderModeToggle(contentEl);
		this.form = contentEl.createDiv({ cls: 'dashboard-modal-form' });
		this.renderBody();
		this.renderActions(contentEl);
	}

	/** One-line heading above the mode toggle explaining it switches the view. */
	private renderModeHeader(host: HTMLElement): void {
		const header = host.createDiv({ cls: 'dashboard-modal-mode-header' });
		header.createDiv({ cls: 'dashboard-modal-mode-title', text: t('banner.mode.header') });
		header.createDiv({ cls: 'dashboard-modal-mode-hint', text: t('banner.mode.hint') });
	}

	/** Segmented Poster/Quotes ↔ Statistics control at the top of the modal. */
	private renderModeToggle(host: HTMLElement): void {
		const bar = host.createDiv({ cls: 'dashboard-modal-mode-toggle' });
		const make = (key: 'quote' | 'stats', icon: string, label: string): void => {
			const btn = bar.createEl('button', {
				cls: 'dashboard-modal-mode-btn' + (this.mode === key ? ' active' : ''),
				attr: { type: 'button' },
			});
			setIcon(btn, icon);
			btn.createSpan({ text: label });
			btn.addEventListener('click', () => {
				if (this.mode === key) return;
				this.mode = key;
				bar.querySelectorAll('.dashboard-modal-mode-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				this.renderBody();
			});
		};
		make('quote', 'image', t('banner.mode.quote'));
		make('stats', 'bar-chart-3', t('banner.mode.stats'));
	}

	private renderBody(): void {
		this.form.empty();
		if (this.mode === 'stats') {
			this.renderStatsBody();
		} else {
			this.renderQuoteBody();
		}
	}

	private renderQuoteBody(): void {
		// === Quotes section ===
		const quotesSection = this.form.createDiv({ cls: 'dashboard-modal-quotes' });
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
		const imagesSection = this.form.createDiv({ cls: 'dashboard-modal-images' });
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
		const colorSection = this.form.createDiv({ cls: 'dashboard-modal-quote-color' });
		colorSection.createEl('label', { text: t('banner.quoteColor'), cls: 'dashboard-modal-quote-color-label' });
		const colorRow = colorSection.createDiv({ cls: 'dashboard-modal-quote-color-row' });

		const colorInput = colorRow.createEl('input', {
			cls: 'dashboard-modal-color-input',
			attr: { type: 'color' },
		});
		colorInput.value = this.quoteColorDraft;
		colorInput.addEventListener('input', () => {
			this.quoteColorDraft = colorInput.value;
		});

		const colorResetBtn = colorRow.createEl('button', {
			cls: 'dashboard-modal-color-reset',
			text: t('banner.resetColor'),
		});
		colorResetBtn.addEventListener('click', () => {
			colorInput.value = '#ffffff';
			this.quoteColorDraft = '#ffffff';
		});
	}

	private renderStatsBody(): void {
		// === Columns: visibility + per-column stat ===
		const colsSection = this.form.createDiv({ cls: 'dashboard-modal-stats-cols' });
		colsSection.createEl('label', { text: t('banner.stats.columns'), cls: 'dashboard-modal-stats-label' });

		const leftRow = colsSection.createDiv({ cls: 'dashboard-modal-stats-col-row' });
		this.addVisibilityCheckbox(leftRow, 'showLeft', t('banner.stats.colLeft'));
		this.addStatDropdown(leftRow, 'leftStat', LEFT_STAT_OPTIONS);

		const centerRow = colsSection.createDiv({ cls: 'dashboard-modal-stats-col-row' });
		this.addVisibilityCheckbox(centerRow, 'showCenter', t('banner.stats.colCenter'));
		this.addStatDropdown(centerRow, 'centerStat', CENTER_STAT_OPTIONS);

		const rightRow = colsSection.createDiv({ cls: 'dashboard-modal-stats-col-row dashboard-modal-stats-col-row--top' });
		this.addVisibilityCheckbox(rightRow, 'showRight', t('banner.stats.colRight'));
		const rightMetrics = rightRow.createDiv({ cls: 'dashboard-modal-stats-right-metrics' });
		rightMetrics.createDiv({ cls: 'dashboard-modal-stats-right-title', text: t('banner.stats.rightMetrics') });
		for (const key of RIGHT_STAT_OPTIONS) {
			const lab = rightMetrics.createEl('label', { cls: 'dashboard-modal-stats-checkbox' });
			const cb = lab.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = (this.statsDraft.rightStats ?? []).includes(key);
			cb.addEventListener('change', () => {
				const set = new Set(this.statsDraft.rightStats ?? []);
				if (cb.checked) set.add(key); else set.delete(key);
				this.statsDraft.rightStats = RIGHT_STAT_OPTIONS.filter(k => set.has(k));
			});
			lab.createSpan({ text: t(`banner.stats.${key}`) });
		}

		// === Heatmap source: note activity or habit check-ins (center column) ===
		const heatSection = this.form.createDiv({ cls: 'dashboard-modal-stats-cols' });
		heatSection.createEl('label', { text: t('banner.stats.heatSource'), cls: 'dashboard-modal-stats-label' });

		const heatRow = heatSection.createDiv({ cls: 'dashboard-modal-stats-col-row' });
		const sourceSelect = heatRow.createEl('select', { cls: 'dropdown dashboard-modal-stats-select' });
		const SOURCE_KEYS: Array<['notes' | 'habit', string]> = [
			['notes', 'banner.stats.heatSourceNotes'],
			['habit', 'banner.stats.heatSourceHabit'],
		];
		for (const [value, key] of SOURCE_KEYS) {
			const o = sourceSelect.createEl('option', { value, text: t(key) });
			if ((this.statsDraft.heatmapSource ?? 'notes') === value) o.selected = true;
		}

		const habitSelect = heatRow.createEl('select', { cls: 'dropdown dashboard-modal-stats-select' });
		const heatHint = heatSection.createDiv({ cls: 'dashboard-modal-stats-hint' });

		const renderHabitOptions = (): void => {
			const habits = getHabitService()?.getHabits() ?? [];
			habitSelect.empty();
			habitSelect.createEl('option', { value: 'all', text: t('banner.stats.heatHabitAll') });
			for (const h of habits) {
				habitSelect.createEl('option', { value: h.id, text: h.name });
			}
			// Dangling id (saved habit deleted since): fall back to the rollup.
			const current = this.statsDraft.heatmapHabitId ?? 'all';
			const valid = current === 'all' || habits.some(h => h.id === current);
			if (!valid) this.statsDraft.heatmapHabitId = 'all';
			habitSelect.value = valid ? current : 'all';

			const isHabit = this.statsDraft.heatmapSource === 'habit';
			habitSelect.disabled = !isHabit || habits.length === 0;
			heatHint.setText(isHabit && habits.length === 0 ? t('banner.stats.heatHabitNone') : '');
		};

		sourceSelect.addEventListener('change', () => {
			this.statsDraft.heatmapSource = sourceSelect.value === 'habit' ? 'habit' : undefined;
			renderHabitOptions();
		});
		habitSelect.addEventListener('change', () => {
			this.statsDraft.heatmapHabitId = habitSelect.value;
		});
		renderHabitOptions();

		// === Appearance: blur / darkness / accent ===
		const appearSection = this.form.createDiv({ cls: 'dashboard-modal-stats-appear' });
		appearSection.createEl('label', { text: t('banner.stats.appearance'), cls: 'dashboard-modal-stats-label' });
		this.addSlider(appearSection, 'banner.stats.blur', this.statsDraft.blur ?? 2, 0, 16, v => { this.statsDraft.blur = v; });
		this.addSlider(appearSection, 'banner.stats.darkness', this.statsDraft.darkness ?? 20, 0, 100, v => { this.statsDraft.darkness = v; });

		const accentRow = appearSection.createDiv({ cls: 'dashboard-modal-stats-accent-row' });
		accentRow.createDiv({ cls: 'dashboard-modal-stats-inline-label', text: t('banner.stats.accent') });
		const accentInput = accentRow.createEl('input', { cls: 'dashboard-modal-color-input', attr: { type: 'color' } });
		accentInput.value = this.statsDraft.accent || '#bff038';
		accentInput.addEventListener('input', () => { this.statsDraft.accent = accentInput.value; });
		const accentReset = accentRow.createEl('button', { cls: 'dashboard-modal-color-reset', text: t('banner.resetColor') });
		accentReset.addEventListener('click', () => {
			accentInput.value = '#bff038';
			this.statsDraft.accent = undefined;
		});

		// === Streak source ===
		const dailySection = this.form.createDiv({ cls: 'dashboard-modal-stats-daily' });
		dailySection.createEl('label', { text: t('banner.stats.dailyFolder'), cls: 'dashboard-modal-stats-label' });
		const detected = getDailyNotesConfig(this.app);
		const folderInput = dailySection.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: {
				type: 'text',
				placeholder: detected
					? t('banner.stats.autoDetected', { folder: detected.folder || '/' })
					: t('banner.stats.manualHint'),
			},
		});
		folderInput.value = this.statsDraft.dailyFolder ?? '';
		folderInput.addEventListener('input', () => {
			this.statsDraft.dailyFolder = folderInput.value.trim() || undefined;
		});
		dailySection.createDiv({ cls: 'dashboard-modal-stats-hint', text: t('banner.stats.dailyFolderHint') });

		const useDailyLabel = dailySection.createEl('label', { cls: 'dashboard-modal-stats-checkbox' });
		const useDailyCheck = useDailyLabel.createEl('input', { attr: { type: 'checkbox' } });
		useDailyCheck.checked = this.statsDraft.streakFromDaily !== false;
		useDailyCheck.addEventListener('change', () => {
			this.statsDraft.streakFromDaily = useDailyCheck.checked;
		});
		useDailyLabel.createSpan({ text: t('banner.stats.streakFromDaily') });

		// === Excluded folders ===
		const excludeSection = this.form.createDiv({ cls: 'dashboard-modal-stats-daily' });
		excludeSection.createEl('label', { text: t('banner.stats.excludeFolders'), cls: 'dashboard-modal-stats-label' });
		excludeSection.createDiv({ cls: 'dashboard-modal-stats-hint', text: t('banner.stats.excludeFoldersHint') });

		// Chips host is separate from the add row so re-rendering chips on
		// remove never wipes the manual input/browse controls.
		const chipsHost = excludeSection.createDiv({ cls: 'dashboard-settings-folder-chips' });
		const renderExcludeChips = (): void => {
			chipsHost.empty();
			for (const folder of this.statsDraft.excludeFolders ?? []) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-settings-folder-chip' });
				chip.createSpan({ text: folder });
				const removeBtn = chip.createEl('button', {
					cls: 'dashboard-settings-folder-chip-remove',
					attr: { 'aria-label': t('common.remove', { name: folder }) },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => {
					this.statsDraft = {
						...this.statsDraft,
						excludeFolders: (this.statsDraft.excludeFolders ?? []).filter(f => f !== folder),
					};
					renderExcludeChips();
				});
			}
		};
		renderExcludeChips();

		const addControl = excludeSection.createDiv({ cls: 'dashboard-settings-folder-add' });
		const excludeFolderInput = addControl.createEl('input', {
			cls: 'dashboard-settings-folder-input',
			attr: { type: 'text', placeholder: t('folder.selectFolder') },
		});
		const addExcludedFolder = (): void => {
			const folder = excludeFolderInput.value.trim();
			if (!folder) return;
			const folders = this.statsDraft.excludeFolders ?? [];
			if (!folders.includes(folder)) {
				this.statsDraft = { ...this.statsDraft, excludeFolders: [...folders, folder] };
			}
			excludeFolderInput.value = '';
			renderExcludeChips();
		};
		const browseBtn = addControl.createEl('button', { cls: 'dashboard-settings-folder-browse' });
		setIcon(browseBtn, 'folder');
		browseBtn.addEventListener('click', () => {
			// Multi-select picker: manage the whole excluded set in one place.
			// Manual typing above stays for paths outside the folder tree.
			new MultiFolderSelectModal(this.app, this.statsDraft.excludeFolders ?? [], (folders) => {
				this.statsDraft = { ...this.statsDraft, excludeFolders: folders };
				renderExcludeChips();
			}, { parentCoversChildren: true }).open();
		});
		const addBtn = addControl.createEl('button', { cls: 'dashboard-settings-folder-add-btn', text: t('common.add') });
		addBtn.addEventListener('click', addExcludedFolder);
		excludeFolderInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				addExcludedFolder();
			}
		});

		// === Details ===
		const subSection = this.form.createDiv({ cls: 'dashboard-modal-stats-sub' });
		const subLabel = subSection.createEl('label', { cls: 'dashboard-modal-stats-checkbox' });
		const subCheck = subLabel.createEl('input', { attr: { type: 'checkbox' } });
		subCheck.checked = this.statsDraft.showDetails !== false;
		subCheck.addEventListener('change', () => {
			this.statsDraft.showDetails = subCheck.checked;
		});
		subLabel.createSpan({ text: t('banner.stats.showDetails') });
	}

	private addVisibilityCheckbox(host: HTMLElement, key: 'showLeft' | 'showCenter' | 'showRight', label: string): void {
		const lab = host.createEl('label', { cls: 'dashboard-modal-stats-vis' });
		const cb = lab.createEl('input', { attr: { type: 'checkbox' } });
		cb.checked = this.statsDraft[key] !== false;
		cb.addEventListener('change', () => { this.statsDraft[key] = cb.checked; });
		lab.createSpan({ text: label });
	}

	private addStatDropdown(host: HTMLElement, key: 'leftStat' | 'centerStat', options: readonly string[]): void {
		const select = host.createEl('select', { cls: 'dropdown dashboard-modal-stats-select' });
		const current = this.statsDraft[key] as string | undefined;
		for (const opt of options) {
			const o = select.createEl('option', { value: opt, text: t(`banner.stats.${opt}`) });
			if (opt === current) o.selected = true;
		}
		select.addEventListener('change', () => {
			(this.statsDraft as unknown as Record<string, string>)[key] = select.value;
		});
	}

	private addSlider(host: HTMLElement, labelKey: string, value: number, min: number, max: number, onChange: (v: number) => void): void {
		const row = host.createDiv({ cls: 'dashboard-modal-stats-slider' });
		row.createDiv({ cls: 'dashboard-modal-stats-inline-label', text: t(labelKey) });
		const slider = row.createEl('input', {
			cls: 'dashboard-modal-stats-range',
			attr: { type: 'range', min: String(min), max: String(max), value: String(value) },
		});
		const valLabel = row.createDiv({ cls: 'dashboard-modal-stats-slider-val', text: String(value) });
		slider.addEventListener('input', () => {
			const v = Number(slider.value);
			valLabel.textContent = String(v);
			onChange(v);
		});
	}

	private renderActions(host: HTMLElement): void {
		const actions = host.createDiv({ cls: 'dashboard-modal-actions' });
		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => this.save());
		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	private save(): void {
		const updates: Partial<BannerData> = { mode: this.mode };
		if (this.mode === 'stats') {
			updates.statsConfig = {
				dailyFolder: this.statsDraft.dailyFolder,
				dailyFormat: this.statsDraft.dailyFormat,
				streakFromDaily: this.statsDraft.streakFromDaily,
				excludeFolders: this.statsDraft.excludeFolders,
				accent: this.statsDraft.accent,
				blur: this.statsDraft.blur,
				darkness: this.statsDraft.darkness,
				showDetails: this.statsDraft.showDetails,
				showLeft: this.statsDraft.showLeft,
				showCenter: this.statsDraft.showCenter,
				showRight: this.statsDraft.showRight,
				leftStat: this.statsDraft.leftStat,
				centerStat: this.statsDraft.centerStat,
				rightStats: this.statsDraft.rightStats ? [...this.statsDraft.rightStats] : undefined,
				// Notes (default) omits both keys so the frontmatter stays clean.
				heatmapSource: this.statsDraft.heatmapSource === 'habit' ? 'habit' : undefined,
				heatmapHabitId: this.statsDraft.heatmapSource === 'habit'
					? (this.statsDraft.heatmapHabitId ?? 'all')
					: undefined,
			};
		} else {
			const validQuotes = this.quotes.filter(q => q.quote.trim());
			const validImages = this.images.filter(s => s.trim());
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
			updates.quoteColor = this.quoteColorDraft === '#ffffff' ? undefined : this.quoteColorDraft;
		}
		this.onSave(updates);
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
