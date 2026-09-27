import { App, Modal } from 'obsidian';
import type { LibraryConfig } from './types';
import { extractFrontmatterProperties } from './library-section';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { ExcludeFoldersEditor } from './exclude-folders-editor';
import { PropertyFiltersEditor } from './property-filters-editor';
import { VisiblePropertiesEditor } from './visible-properties-editor';
import { TemplateFilesEditor } from './template-files-editor';
import { sectionTemplatePaths } from './library-new-note';

export class LibraryConfigModal extends Modal {
	private config: LibraryConfig;
	private availableProps: Map<string, Set<string>>;
	private onSave: (config: LibraryConfig) => void;

	constructor(
		app: App,
		config: LibraryConfig,
		onSave: (config: LibraryConfig) => void,
	) {
		super(app);
		this.config = { ...config, filters: config.filters.map(f => ({ ...f, values: [...f.values] })) };
		this.onSave = onSave;
		this.availableProps = extractFrontmatterProperties(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		containerEl.setCssProps({
			background: 'transparent',
			backgroundColor: 'transparent',
			border: 'none',
			boxShadow: 'none',
		});

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		// Header
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('library.configTitle') });

		// Body
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Filters — shared with the folder-section config (PropertyFiltersEditor).
		// 'tags' stays pickable here: evaluateFilter's tags branch and the value
		// extractor make it filter like any other property.
		const filtersSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		filtersSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.property') });
		const filterEditor = new PropertyFiltersEditor(
			this.app,
			filtersSection.createDiv({ cls: 'dashboard-library-config-filters' }),
			this.config.filters,
			{ availableProps: this.availableProps },
		);


		// Kanban group by
		const kanbanSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		kanbanSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.kanbanGroupBy') });
		kanbanSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.kanbanGroupByHint') });
		const groupSelect = kanbanSection.createEl('select', { cls: 'dashboard-library-filter-property' });
		const effectiveGroup = this.config.kanbanGroupBy ?? 'tags';
		groupSelect.createEl('option', { text: t('library.noGroup'), attr: { value: '' } });
		for (const key of [...this.availableProps.keys()].sort()) {
			const opt = groupSelect.createEl('option', { text: key, attr: { value: key } });
			if (key === effectiveGroup) opt.selected = true;
		}
		groupSelect.addEventListener('change', () => {
			this.config.kanbanGroupBy = groupSelect.value || undefined;
		});

		// Kanban card covers: same 封面/cover extraction as the gallery view.
		const coversRow = kanbanSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		const coversBox = coversRow.createEl('input', {
			cls: 'dashboard-library-config-checkbox',
			attr: { type: 'checkbox' },
		});
		coversBox.checked = this.config.kanbanShowCovers === true;
		coversBox.addEventListener('change', () => {
			this.config.kanbanShowCovers = coversBox.checked ? true : undefined;
		});
		coversRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('library.kanbanShowCovers') });

		// Excluded folders: files inside them never reach the section's data.
		const excludeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		excludeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('exclude.folders') });
		excludeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('exclude.foldersHint') });
		const excludeEditor = new ExcludeFoldersEditor(this.app, excludeSection, this.config.excludeFolders ?? []);

		// Card properties (grid view)
		const propsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		propsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.cardProperties') });

		const propsRow = propsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		const showPropsBox = propsRow.createEl('input', {
			cls: 'dashboard-library-config-checkbox',
			attr: { type: 'checkbox' },
		});
		showPropsBox.checked = this.config.showProperties !== false;
		showPropsBox.addEventListener('change', () => {
			this.config.showProperties = showPropsBox.checked ? undefined : false;
		});
		propsRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('library.showProperties') });

		const limitRow = propsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		limitRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('library.propertyLimit') });
		const limitInput = limitRow.createEl('input', {
			cls: 'dashboard-library-config-number',
			attr: { type: 'number', min: '0', max: '20', step: '1' },
		});
		limitInput.value = String(this.config.propertyLimit ?? 6);
		limitInput.addEventListener('change', () => {
			const n = Math.max(0, Math.min(20, Math.floor(Number(limitInput.value) || 6)));
			limitInput.value = String(n);
			this.config.propertyLimit = n;
		});

		// Pinned properties: picked keys show first (all of them); only cards
		// hitting none fall back to the automatic slice above.
		const pinnedEditor = new VisiblePropertiesEditor(this.app, propsSection, this.config.visibleProperties ?? []);

		// Footer
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());

		// New-note templates: the body of any of these notes seeds notes created
		// by the toolbar "+" (frontmatter merged from the section's filter
		// props). Several templates turn the button into a picker menu.
		const tplSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		tplSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.newNoteTemplate') });
		tplSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.newNoteTemplateHint') });
		const tplEditor = new TemplateFilesEditor(this.app, tplSection, sectionTemplatePaths(this.config));

		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			const folders = excludeEditor.value;
			const picked = pinnedEditor.value;
			const templates = tplEditor.value;
			this.onSave({
				...this.config,
				// The shared editor owns the rows (it works on copies); its value
				// is the saved truth — half-configured rows (no property picked)
				// drop out here instead of persisting as no-op filters.
				filters: filterEditor.value,
				excludeFolders: folders.length > 0 ? folders : undefined,
				visibleProperties: picked.length > 0 ? picked : undefined,
				templatePaths: templates.length > 0 ? templates : undefined,
				templatePath: templates[0],
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
