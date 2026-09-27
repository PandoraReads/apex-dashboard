import { App, setIcon } from 'obsidian';
import { extractFrontmatterProperties } from './library-section';
import { t } from './i18n';
import type { PropertyFilter, PropertyFilterOperator } from './types';

const PSEUDO_PROPERTIES = new Set(['path', 'created', 'modified']);
const OPERATORS: PropertyFilterOperator[] = ['equals', 'contains', 'notEquals'];

export interface PropertyFiltersEditorOptions {
	/** Property keys hidden from the picker. The folder-section config passes
	 *  'tags' — its dedicated tags section owns that filter, and a second tags
	 *  filter here would AND into a silently empty section. */
	excludeProperties?: string[];
	/** Precomputed property/value map; skips the vault scan when the host modal
	 *  already ran extractFrontmatterProperties for its own pickers. */
	availableProps?: Map<string, Set<string>>;
}

/** Shared visible editor for persistent property filters on library and folder sections. */
export class PropertyFiltersEditor {
	private filters: PropertyFilter[];
	private readonly availableProps: Map<string, Set<string>>;
	private readonly excludedKeys: Set<string>;

	constructor(
		app: App,
		private readonly container: HTMLElement,
		filters: PropertyFilter[] | undefined,
		opts?: PropertyFiltersEditorOptions,
	) {
		this.filters = (filters ?? []).map(filter => ({ ...filter, values: [...filter.values] }));
		this.availableProps = opts?.availableProps ?? extractFrontmatterProperties(app);
		this.excludedKeys = new Set(opts?.excludeProperties ?? []);
		this.render();
	}

	get value(): PropertyFilter[] {
		return this.filters
			.filter(filter => filter.property.trim().length > 0)
			.map(filter => ({ ...filter, values: [...filter.values] }));
	}

	private render(): void {
		this.container.empty();
		if (this.filters.length === 0) {
			this.container.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noPropertyFilters') });
		}

		for (let i = 0; i < this.filters.length; i++) {
			const filter = this.filters[i]!;
			const row = this.container.createDiv({ cls: 'dashboard-library-filter-row' });
			const header = row.createDiv({ cls: 'dashboard-library-filter-header' });
			const propSelect = header.createEl('select', { cls: 'dashboard-library-filter-property' });
			propSelect.createEl('option', { text: t('library.selectProperty'), attr: { value: '' } });
			for (const key of [...this.availableProps.keys()].sort()) {
				if (this.excludedKeys.has(key)) continue;
				const option = propSelect.createEl('option', { text: key, attr: { value: key } });
				if (key === filter.property) option.selected = true;
			}
			propSelect.addEventListener('change', () => {
				filter.property = propSelect.value;
				filter.values = [];
				this.render();
			});

			const operator = filter.operator ?? 'equals';
			if (filter.property && !PSEUDO_PROPERTIES.has(filter.property)) {
				const opSelect = header.createEl('select', { cls: 'dashboard-library-filter-operator' });
				opSelect.title = t('library.filterOperator');
				for (const op of OPERATORS) {
					const option = opSelect.createEl('option', {
						text: t(`library.op${op.charAt(0).toUpperCase()}${op.slice(1)}`),
						attr: { value: op },
					});
					if (op === operator) option.selected = true;
				}
				opSelect.addEventListener('change', () => {
					filter.operator = opSelect.value as PropertyFilterOperator;
					this.render();
				});
			}

			const search = filter.property
				? header.createEl('input', {
					cls: 'dashboard-library-value-search',
					attr: {
						type: 'text',
						placeholder: operator === 'contains' ? t('library.searchValuesContains') : t('library.searchValues'),
					},
				})
				: null;
			const remove = header.createEl('button', { cls: 'dashboard-library-filter-remove', attr: { 'aria-label': t('library.removeFilter') } });
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				this.filters = this.filters.filter((_, index) => index !== i);
				this.render();
			});

			if (!filter.property || !search) continue;
			const knownValues = [...(this.availableProps.get(filter.property) ?? [])].sort();
			const valuesHost = row.createDiv({ cls: 'dashboard-library-value-list' });
			const renderValues = (): void => {
				valuesHost.empty();
				const known = new Set(knownValues);
				const values = [...filter.values.filter(value => !known.has(value)), ...knownValues];
				if (values.length === 0) {
					valuesHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noValues') });
					return;
				}
				const query = search.value.trim().toLowerCase();
				const shown = query ? values.filter(value => value.toLowerCase().includes(query)) : values;
				if (shown.length === 0) {
					valuesHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noMatchingValues') });
					return;
				}
				for (const value of shown) {
					const chip = valuesHost.createDiv({
						cls: 'dashboard-library-filter-chip' + (filter.values.includes(value) ? ' active' : ''),
						text: value,
					});
					chip.addEventListener('click', () => {
						filter.values = filter.values.includes(value)
							? filter.values.filter(item => item !== value)
							: [...filter.values, value];
						renderValues();
					});
				}
			};
			search.addEventListener('input', renderValues);
			if (operator === 'contains') {
				search.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					const value = search.value.trim();
					if (!value || filter.values.includes(value)) return;
					filter.values = [...filter.values, value];
					search.value = '';
					renderValues();
				});
			}
			renderValues();
		}

		this.container.createEl('button', {
			cls: 'dashboard-library-add-filter-btn',
			text: t('library.addFilter'),
		}).addEventListener('click', () => {
			this.filters = [...this.filters, { property: '', values: [] }];
			this.render();
		});
	}
}
