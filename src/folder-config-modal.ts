import { App, Modal, TFolder } from 'obsidian';
import { t } from './i18n';
import { extractFrontmatterProperties, getAllTags, renderTagsSelector } from './library-section';
import { applyModalTheme } from './modal-theme';
import { ExcludeFoldersEditor } from './exclude-folders-editor';

export interface FolderConfigResult {
	folders: string[];
	/** Folders whose files are hidden from the section (path-prefix match). */
	excludeFolders: string[];
	tags: string[];
	/** Kanban grouping key: frontmatter property name. */
	groupBy: string | undefined;
	/** Kanban grouping mode: property (groupBy) or top-level subfolders. */
	groupMode: 'property' | 'folder';
	showProperties: boolean;
	propertyLimit: number;
}

/**
 * Configuration modal for a folder section: the folder path plus an optional
 * tag filter, kanban "group by" selector (by property or by subfolder), and
 * card property display settings.
 */
export class FolderConfigModal extends Modal {
	private folders: string[];
	private readonly initialExcludeFolders: string[];
	private selectedTags: string[];
	private groupBy: string;
	private groupMode: 'property' | 'folder';
	private showProperties: boolean;
	private propertyLimit: number;
	private readonly onSave: (result: FolderConfigResult) => void;

	constructor(
		app: App,
		currentFolders: string[],
		currentExcludeFolders: string[] | undefined,
		currentTags: string[],
		currentGroupBy: string | undefined,
		currentShowProperties: boolean | undefined,
		currentPropertyLimit: number | undefined,
		onSave: (result: FolderConfigResult) => void,
		currentGroupMode?: 'property' | 'folder',
	) {
		super(app);
		this.folders = [...currentFolders];
		this.initialExcludeFolders = [...(currentExcludeFolders ?? [])];
		this.selectedTags = [...currentTags];
		this.groupBy = currentGroupBy ?? '';
		this.groupMode = currentGroupMode ?? 'property';
		this.showProperties = currentShowProperties !== false;
		this.propertyLimit = currentPropertyLimit ?? 6;
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('folder.configure') });

		// Body
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Folder paths
		const pathSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		pathSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('folder.path') });

		const chipsHost = pathSection.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const addRow = pathSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const pathInput = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('folder.pathPlaceholder') },
		});
		const browseBtn = addRow.createEl('button', {
			cls: 'dashboard-media-folder-browse',
			text: t('folder.browse'),
		});
		browseBtn.addEventListener('click', () => {
			// Multi-select: pick every source folder at once. Sources are OR unions,
			// so parents/children stay independently tickable.
			new MultiFolderSelectModal(this.app, this.folders, (folders) => {
				this.folders = folders;
				renderFolderChips();
			}).open();
		});
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.add'),
		});

		const renderFolderChips = (): void => {
			chipsHost.empty();
			if (this.folders.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('folder.noFolders') });
				return;
			}
			for (const folder of this.folders) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: folder });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					this.folders = this.folders.filter(f => f !== folder);
					renderFolderChips();
				});
			}
		};
		const addFolder = (): void => {
			const folder = pathInput.value.trim().replace(/^\/+|\/+$/g, '');
			pathInput.value = '';
			if (!folder) return;
			if (this.folders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.folders = [...this.folders, folder];
			renderFolderChips();
		};
		addBtn.addEventListener('click', addFolder);
		pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFolder(); } });
		renderFolderChips();

		// Excluded folders: files inside them are hidden even when they live
		// under a scanned source folder above.
		const excludeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		excludeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('exclude.folders') });
		excludeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('exclude.foldersHint') });
		const excludeEditor = new ExcludeFoldersEditor(this.app, excludeSection, this.initialExcludeFolders);

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

		// Kanban group-by: property vs subfolder mode. The property picker only
		// applies in property mode, so it hides when subfolder grouping is on.
		const groupSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		groupSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.kanbanGroupBy') });
		const modeToggle = groupSection.createDiv({ cls: 'dashboard-library-view-toggle dashboard-library-config-view-toggle' });
		const propertyBtn = modeToggle.createDiv({
			cls: 'dashboard-library-view-btn' + (this.groupMode === 'property' ? ' active' : ''),
			attr: { 'aria-label': t('library.groupByProperty') },
		});
		propertyBtn.createSpan({ text: t('library.groupByProperty') });
		const folderBtn = modeToggle.createDiv({
			cls: 'dashboard-library-view-btn' + (this.groupMode === 'folder' ? ' active' : ''),
			attr: { 'aria-label': t('library.groupByFolder') },
		});
		folderBtn.createSpan({ text: t('library.groupByFolder') });

		const propertyControls = groupSection.createDiv({ cls: 'dashboard-library-config-groupby-controls' });
		propertyControls.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.kanbanGroupByHint') });
		const groupSelect = propertyControls.createEl('select', { cls: 'dashboard-library-filter-property' });
		groupSelect.createEl('option', { text: t('library.noGroup'), attr: { value: '' } });
		const propKeys = [...extractFrontmatterProperties(this.app).keys()].sort();
		for (const key of propKeys) {
			const opt = groupSelect.createEl('option', { text: key, attr: { value: key } });
			if (key === this.groupBy) opt.selected = true;
		}
		groupSelect.addEventListener('change', () => { this.groupBy = groupSelect.value; });

		const folderHint = groupSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.groupByFolderHint') });
		const applyMode = (): void => {
			propertyBtn.toggleClass('active', this.groupMode === 'property');
			folderBtn.toggleClass('active', this.groupMode === 'folder');
			propertyControls.toggleClass('is-hidden', this.groupMode !== 'property');
			folderHint.toggleClass('is-hidden', this.groupMode !== 'folder');
		};
		propertyBtn.addEventListener('click', () => { this.groupMode = 'property'; applyMode(); });
		folderBtn.addEventListener('click', () => { this.groupMode = 'folder'; applyMode(); });
		applyMode();

		// Card properties (grid view)
		const propsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		propsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.cardProperties') });

		const propsRow = propsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		const showPropsBox = propsRow.createEl('input', {
			cls: 'dashboard-library-config-checkbox',
			attr: { type: 'checkbox' },
		});
		showPropsBox.checked = this.showProperties;
		showPropsBox.addEventListener('change', () => { this.showProperties = showPropsBox.checked; });
		propsRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('library.showProperties') });

		const limitRow = propsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		limitRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('library.propertyLimit') });
		const limitInput = limitRow.createEl('input', {
			cls: 'dashboard-library-config-number',
			attr: { type: 'number', min: '0', max: '20', step: '1' },
		});
		limitInput.value = String(this.propertyLimit);
		limitInput.addEventListener('change', () => {
			this.propertyLimit = Math.max(0, Math.min(20, Math.floor(Number(limitInput.value) || 6)));
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
			this.onSave({
				folders: this.folders,
				excludeFolders: excludeEditor.value,
				tags: this.selectedTags,
				groupBy: this.groupBy || undefined,
				groupMode: this.groupMode,
				showProperties: this.showProperties,
				propertyLimit: this.propertyLimit,
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Multi-select folder picker: a filterable checkbox list of every vault folder,
 * for managing a whole folder set in one place (e.g. the calendar's excluded
 * folders, or the library/media/folder-section source folders). The modal stays
 * open, lets the user tick several folders, and returns the complete selection
 * on confirm.
 *
 * With `parentCoversChildren` (exclusion-style consumers, which match by path
 * prefix), checking a parent folder already covers its subfolders - descendants
 * of a checked folder are dimmed and locked with a hint instead of offering a
 * redundant checkbox. Source/inclusion consumers (folder OR unions) pass false
 * so parents and children can be ticked independently.
 */
export class MultiFolderSelectModal extends Modal {
	private readonly initialSelected: string[];
	private readonly onConfirmFolders: (folders: string[]) => void;
	private readonly parentCoversChildren: boolean;

	constructor(
		app: App,
		selected: string[],
		onConfirm: (folders: string[]) => void,
		opts?: { parentCoversChildren?: boolean },
	) {
		super(app);
		this.initialSelected = [...selected];
		this.onConfirmFolders = onConfirm;
		this.parentCoversChildren = opts?.parentCoversChildren ?? false;
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('folder.selectFolders') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		if (this.parentCoversChildren) {
			body.createDiv({ cls: 'dashboard-library-config-hint', text: t('folder.parentExcludesHint') });
		}

		// Selection state, keyed by lowercased path (matching is case-insensitive
		// downstream). displayFor keeps the original casing to persist, preferring
		// the vault's canonical path once a row is checked.
		const selectedLower = new Set(this.initialSelected.map(f => f.toLowerCase()));
		const displayFor = new Map<string, string>(
			this.initialSelected.map(f => [f.toLowerCase(), f] as const),
		);

		const allFolders = this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== '/')
			.map(f => f.path)
			.sort();

		/** A folder is covered when some *other* selected folder is an ancestor
		 *  of it - checking it would change nothing. Only meaningful in exclusion
		 *  mode (path-prefix matching); source consumers keep every row active. */
		const isCoveredBy = (path: string): boolean => {
			if (!this.parentCoversChildren) return false;
			const lower = path.toLowerCase();
			for (const s of selectedLower) {
				if (s !== lower && lower.startsWith(s + '/')) return true;
			}
			return false;
		};

		const searchRow = body.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const searchInput = searchRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('folder.searchPlaceholder') },
		});

		const listHost = body.createDiv({ cls: 'dashboard-folder-multi-list' });
		const countEl = body.createDiv({ cls: 'dashboard-folder-multi-count' });

		const renderCount = (): void => {
			countEl.textContent = t('folder.selectedCount', { count: selectedLower.size });
		};

		const renderList = (): void => {
			listHost.empty();
			const query = searchInput.value.trim().toLowerCase();
			const visible = query
				? allFolders.filter(p => p.toLowerCase().includes(query))
				: allFolders;
			if (visible.length === 0) {
				listHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('folder.noMatches') });
				return;
			}
			for (const path of visible) {
				const lower = path.toLowerCase();
				const checked = selectedLower.has(lower);
				const covered = isCoveredBy(path);

				const row = listHost.createDiv({
					cls: 'dashboard-folder-multi-row'
						+ (checked ? ' is-checked' : '')
						+ (covered ? ' is-covered' : ''),
				});
				const box = row.createEl('input', {
					attr: { type: 'checkbox' },
				});
				box.checked = checked;
				box.disabled = covered;
				row.createSpan({ cls: 'dashboard-folder-multi-row-name', text: path });
				if (covered) {
					row.createSpan({ cls: 'dashboard-folder-multi-covered-note', text: t('folder.coveredByParent') });
				}

				const toggle = (): void => {
					if (covered) return;
					if (selectedLower.has(lower)) {
						selectedLower.delete(lower);
					} else {
						selectedLower.add(lower);
						displayFor.set(lower, path);
					}
					renderList();
					renderCount();
				};
				// The checkbox is presentation-only (pointer-events: none in CSS):
				// the row owns the click so box and row can't double-toggle.
				row.addEventListener('click', () => toggle());
			}
		};
		searchInput.addEventListener('input', () => renderList());
		renderList();
		renderCount();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') })
			.addEventListener('click', () => {
				// Map back to display casing; entries without a row (typed by hand,
				// or folders deleted from the vault) fall back to their stored form.
				const folders = [...selectedLower].map(l => displayFor.get(l) ?? l);
				this.onConfirmFolders(folders);
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
