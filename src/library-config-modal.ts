import { App, Modal, setIcon } from 'obsidian';
import type { LibraryConfig, PropertyFilter } from './types';
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
		containerEl.style.background = "transparent";
		containerEl.style.backgroundColor = "transparent";
		containerEl.style.border = "none";
		containerEl.style.boxShadow = "none";

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
				const row = filtersContainer.createDiv({ cls: 'dashboard-library-filter-row' });

				// Property selector
				const propSelect = row.createEl('select', { cls: 'dashboard-library-filter-property' });
				const propKeys = [...this.availableProps.keys()].sort();
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

				// Value chips
				if (filter.property) {
					const valuesWrap = row.createDiv({ cls: 'dashboard-library-filter-values' });
					const availableValues = this.availableProps.get(filter.property);
					if (availableValues && availableValues.size > 0) {
						const sorted = [...availableValues].sort();
						for (const val of sorted) {
							const chip = valuesWrap.createDiv({
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
								renderFilters();
							});
						}

					} else {
						valuesWrap.createDiv({ cls: 'dashboard-library-filter-empty', text: 'No values found' });
					}
				}

				// Remove button
				const removeBtn = row.createEl('button', {
					cls: 'dashboard-library-filter-remove',
					attr: { 'aria-label': t('library.removeFilter') },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => {
					this.config.filters = this.config.filters.filter((_, idx) => idx !== i);
					renderFilters();
				});
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
		const groupSelect = kanbanSection.createEl('select', { cls: 'dashboard-library-filter-property' });
		groupSelect.createEl('option', { text: t('library.noGroup'), attr: { value: '' } });
		for (const key of [...this.availableProps.keys()].sort()) {
			const opt = groupSelect.createEl('option', { text: key, attr: { value: key } });
			if (key === this.config.kanbanGroupBy) opt.selected = true;
		}
		groupSelect.addEventListener('change', () => {
			this.config.kanbanGroupBy = groupSelect.value || undefined;
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
