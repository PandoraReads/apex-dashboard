import { App, Modal, setIcon } from 'obsidian';
import type { LibraryConfig } from './types';
import { extractFrontmatterProperties } from './library-section';
import { t } from './i18n';

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
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		// Body
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Filters
		const filtersSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		filtersSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('library.property') });

		const filtersContainer = filtersSection.createDiv({ cls: 'dashboard-library-config-filters' });

		const renderFilters = (): void => {
			filtersContainer.empty();

			for (let i = 0; i < this.config.filters.length; i++) {
				const filter = this.config.filters[i]!;
				if (filter.property === 'tags') continue; // managed by the dedicated Tags section
				const row = filtersContainer.createDiv({ cls: 'dashboard-library-filter-row' });
				const header = row.createDiv({ cls: 'dashboard-library-filter-header' });

				// Property selector (left of the search box in the header row)
				const propSelect = header.createEl('select', { cls: 'dashboard-library-filter-property' });
				const propKeys = [...this.availableProps.keys()].sort().filter(k => k !== 'tags');
				propSelect.createEl('option', { text: t('library.selectProperty'), attr: { value: '' } });
				for (const key of propKeys) {
					const opt = propSelect.createEl('option', { text: key, attr: { value: key } });
					if (key === filter.property) opt.selected = true;
				}

				propSelect.addEventListener('change', () => {
					filter.property = propSelect.value;
					filter.values = [];
					renderFilters();
				});

				// Value search box (right of the property dropdown)
				let searchInput: HTMLInputElement | null = null;
				if (filter.property) {
					searchInput = header.createEl('input', {
						cls: 'dashboard-library-value-search',
						attr: { type: 'text', placeholder: t('library.searchValues') },
					});
				}

				// Remove button (far right of the header row)
				const removeBtn = header.createEl('button', {
					cls: 'dashboard-library-filter-remove',
					attr: { 'aria-label': t('library.removeFilter') },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => {
					this.config.filters = this.config.filters.filter((_, idx) => idx !== i);
					renderFilters();
				});

				// Value chips (below the header)
				if (filter.property && searchInput) {
					const availableValues = this.availableProps.get(filter.property);
					const sorted = availableValues ? [...availableValues].sort() : [];
					const valuesList = row.createDiv({ cls: 'dashboard-library-value-list' });

					const renderValues = (): void => {
						valuesList.empty();
						if (sorted.length === 0) {
							valuesList.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noValues') });
							return;
						}
						if (!searchInput) return;
						const query = searchInput.value.trim().toLowerCase();
						const visible = query ? sorted.filter(v => v.toLowerCase().includes(query)) : sorted;
						if (visible.length === 0) {
							valuesList.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noMatchingValues') });
							return;
						}
						for (const val of visible) {
							const chip = valuesList.createDiv({
								cls: 'dashboard-library-filter-chip' + (filter.values.includes(val) ? ' active' : ''),
								text: val,
							});
							chip.addEventListener('click', () => {
								const idx = filter.values.indexOf(val);
								if (idx >= 0) {
									filter.values = filter.values.filter(v => v !== val);
								} else {
									filter.values = [...filter.values, val];
								}
								renderValues();
							});
						}
					};

					searchInput.addEventListener('input', renderValues);
					renderValues();
				}
			}
		};

		renderFilters();

		// Add filter button
		const addFilterBtn = filtersSection.createEl('button', {
			cls: 'dashboard-library-add-filter-btn',
			text: t('library.addFilter'),
		});
		addFilterBtn.addEventListener('click', () => {
			this.config.filters = [...this.config.filters, { property: '', values: [] }];
			renderFilters();
		});

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
}
