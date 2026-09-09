import { App, Modal, setIcon } from 'obsidian';
import type { WereadConfig, WereadStatItem, WereadWidget } from './types';
import type {
	WereadContentType,
	WereadGroupBy,
	WereadNoteState,
	WereadReadingState,
	WereadRecency,
} from './weread-shelf-model';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { ALL_STAT_ITEMS, DEFAULT_STAT_ITEMS, STAT_ITEM_LABEL_KEYS, normalizeStatItems } from './weread-stats';

const VIEW_OPTIONS: Array<{ value: WereadWidget['view']; labelKey: string }> = [
	{ value: 'shelf', labelKey: 'weread.viewShelf' },
	{ value: 'stats', labelKey: 'weread.viewStats' },
	{ value: 'notes', labelKey: 'weread.viewNotes' },
];
const PROGRESS_OPTIONS: Array<{ value: WereadReadingState; labelKey: string }> = [
	{ value: 'notStarted', labelKey: 'weread.progressNotStarted' },
	{ value: 'reading', labelKey: 'weread.progressReading' },
	{ value: 'finished', labelKey: 'weread.progressFinished' },
];
const CONTENT_TYPE_OPTIONS: Array<{ value: WereadContentType; labelKey: string }> = [
	{ value: 'book', labelKey: 'weread.contentBook' },
	{ value: 'audio', labelKey: 'weread.contentAudio' },
	{ value: 'article', labelKey: 'weread.contentArticle' },
];
const RECENCY_OPTIONS: Array<{ value: WereadRecency; labelKey: string }> = [
	{ value: 'recent7', labelKey: 'weread.recent7' },
	{ value: 'recent30', labelKey: 'weread.recent30' },
	{ value: 'older', labelKey: 'weread.recentOlder' },
	{ value: 'never', labelKey: 'weread.recentNever' },
];
const NOTE_OPTIONS: Array<{ value: WereadNoteState; labelKey: string }> = [
	{ value: 'highlights', labelKey: 'weread.notesHighlights' },
	{ value: 'ideas', labelKey: 'weread.notesIdeas' },
	{ value: 'none', labelKey: 'weread.notesNone' },
];
const GROUP_OPTIONS: Array<{ value: WereadGroupBy; labelKey: string }> = [
	{ value: 'readingState', labelKey: 'weread.groupReadingState' },
	{ value: 'contentType', labelKey: 'weread.groupContentType' },
	{ value: 'recency', labelKey: 'weread.groupRecency' },
	{ value: 'notes', labelKey: 'weread.groupNotes' },
	{ value: 'none', labelKey: 'weread.groupNone' },
];

/**
 * Configuration modal for a weread section. Manages an ordered list of widgets
 * (add / remove / reorder / per-widget type + shelf filter + optional title),
 * rendered top-to-bottom in the section. Shelf widgets expose four stable
 * facets from the official API plus a matching visual grouping selector.
 */
export class WereadConfigModal extends Modal {
	private widgets: WereadWidget[];
	private readonly onSave: (config: WereadConfig) => void;

	constructor(app: App, config: WereadConfig, onSave: (config: WereadConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.widgets = (config.widgets?.length
			? config.widgets
			: [{ id: 'w1', view: 'shelf' as const, groupBy: 'readingState' as const }])
			.map(w => ({ ...w }));
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('weread.configure') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({ cls: 'dashboard-library-config-section-title', text: t('weread.widgetsLabel') });

		const list = body.createDiv({ cls: 'dashboard-weread-cfg-list' });

		const render = (): void => {
			list.empty();
			this.widgets.forEach((w, i) => {
				const update = (patch: Partial<WereadWidget>, rerender = true): void => {
					this.widgets = this.widgets.map((widget, index) => index === i ? { ...widget, ...patch } : widget);
					if (rerender) render();
				};
				const row = list.createDiv({ cls: 'dashboard-weread-cfg-row' });

				const main = row.createDiv({ cls: 'dashboard-weread-cfg-main' });

				// Optional title
				const titleInput = main.createEl('input', {
					cls: 'dashboard-weread-cfg-title',
					attr: { type: 'text', placeholder: t('weread.widgetTitlePlaceholder'), value: w.title ?? '' },
				});
				titleInput.addEventListener('change', () => {
					const v = titleInput.value.trim();
					update({ title: v.length > 0 ? v : undefined }, false);
				});

				// View selector
				const viewSelect = main.createEl('select', { cls: 'dashboard-library-filter-property' });
				for (const v of VIEW_OPTIONS) {
					const opt = viewSelect.createEl('option', { text: t(v.labelKey), attr: { value: v.value } });
					if (w.view === v.value) opt.selected = true;
				}
				viewSelect.addEventListener('change', () => {
					update({ view: viewSelect.value as WereadWidget['view'] });
				});

				// Shelf facets are independent. Empty selection within a facet means all.
				if (w.view === 'shelf') {
					const grouping = main.createDiv({ cls: 'dashboard-weread-cfg-grouping' });
					grouping.createDiv({ cls: 'dashboard-weread-cfg-filter-label', text: t('weread.groupBy') });
					const groupSelect = grouping.createEl('select', { cls: 'dashboard-library-filter-property' });
					for (const option of GROUP_OPTIONS) {
						const element = groupSelect.createEl('option', { text: t(option.labelKey), attr: { value: option.value } });
						if ((w.groupBy ?? 'readingState') === option.value) element.selected = true;
					}
					groupSelect.addEventListener('change', () => update({ groupBy: groupSelect.value as WereadGroupBy }));

					const panel = main.createDiv({ cls: 'dashboard-weread-cfg-filter-panel' });
					panel.createDiv({ cls: 'dashboard-weread-cfg-filter-panel-title', text: t('weread.filters') });
					renderFacet(panel, t('weread.filterProgress'), PROGRESS_OPTIONS, w.progressFilters, values => update({ progressFilters: values }));
					renderFacet(panel, t('weread.filterContentType'), CONTENT_TYPE_OPTIONS, w.contentTypeFilters, values => update({ contentTypeFilters: values }));
					renderFacet(panel, t('weread.filterRecency'), RECENCY_OPTIONS, w.recencyFilters, values => update({ recencyFilters: values }));
					renderFacet(panel, t('weread.filterNotes'), NOTE_OPTIONS, w.noteFilters, values => update({ noteFilters: values }));
				}

				// Stats widgets: per-block visibility + drag-to-reorder.
				if (w.view === 'stats') {
					renderStatsItemsPanel(main, w.statsItems, values => update({ statsItems: values }));
				}

				// Reorder / remove
				const ops = row.createDiv({ cls: 'dashboard-weread-cfg-ops' });
				const upBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': 'Move up' } });
				setIcon(upBtn, 'chevron-up');
				upBtn.disabled = i === 0;
				upBtn.addEventListener('click', () => this.swap(i, i - 1, render));
				const downBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': 'Move down' } });
				setIcon(downBtn, 'chevron-down');
				downBtn.disabled = i === this.widgets.length - 1;
				downBtn.addEventListener('click', () => this.swap(i, i + 1, render));
				const rmBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': t('common.delete') } });
				setIcon(rmBtn, 'trash-2');
				rmBtn.addEventListener('click', () => {
					this.widgets = this.widgets.filter((_, idx) => idx !== i);
					render();
				});
			});
		};

		// Add widget
		body.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm dashboard-weread-cfg-add',
			text: t('weread.addWidget'),
		}).addEventListener('click', () => {
			this.widgets = [...this.widgets, { id: `w${Date.now()}`, view: 'shelf', groupBy: 'readingState' }];
			render();
		});

		render();

		body.createDiv({ cls: 'dashboard-library-config-hint', text: t('weread.configHint') });

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
			this.onSave({ widgets: this.widgets.length > 0 ? this.widgets : [{ id: 'w1', view: 'shelf', groupBy: 'readingState' }] });
			this.close();
		});
	}

	private swap(a: number, b: number, rerender: () => void): void {
		if (b < 0 || b >= this.widgets.length) return;
		const next = [...this.widgets];
		const tmp = next[a]!;
		next[a] = next[b]!;
		next[b] = tmp;
		this.widgets = next;
		rerender();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function renderFacet<T extends string>(
	parent: HTMLElement,
	label: string,
	options: Array<{ value: T; labelKey: string }>,
	selected: T[] | undefined,
	onChange: (values: T[] | undefined) => void,
): void {
	const group = parent.createDiv({ cls: 'dashboard-weread-cfg-filter-group' });
	group.createDiv({ cls: 'dashboard-weread-cfg-filter-label', text: label });
	const chips = group.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
	for (const option of options) {
		const active = selected?.includes(option.value) ?? false;
		const chip = chips.createDiv({ cls: 'dashboard-weread-cfg-chip' + (active ? ' active' : '') });
		chip.createSpan({ text: t(option.labelKey) });
		chip.addEventListener('click', () => onChange(toggleValue(selected, option.value)));
	}
}

/**
 * Stats-block editor: one row per block — checkbox toggles visibility, drag
 * handle reorders. Hidden rows sit below the visible ones and only carry the
 * checkbox (a hidden block has no position to drag to). Reordering or
 * unchecking every drift from the default order is stored on the widget;
 * a list that still equals the default is omitted so old files stay clean.
 */
function renderStatsItemsPanel(
	parent: HTMLElement,
	stored: WereadStatItem[] | undefined,
	onChange: (values: WereadStatItem[] | undefined) => void,
): void {
	const panel = parent.createDiv({ cls: 'dashboard-weread-cfg-filter-panel' });
	panel.createDiv({ cls: 'dashboard-weread-cfg-filter-panel-title', text: t('weread.statsItems') });
	panel.createDiv({ cls: 'dashboard-library-config-hint', text: t('weread.statsItemsHint') });

	const visible = normalizeStatItems(stored);
	// Hidden options come from ALL_STAT_ITEMS, not the default set — a
	// non-default block (preferCategory) must stay opt-in via this list.
	const hidden = ALL_STAT_ITEMS.filter(item => !visible.includes(item));
	const list = panel.createDiv({ cls: 'dashboard-weread-cfg-stats-list' });

	const commit = (next: WereadStatItem[]): void => {
		const isDefault = next.length === DEFAULT_STAT_ITEMS.length
			&& next.every((item, idx) => item === DEFAULT_STAT_ITEMS[idx]);
		onChange(isDefault ? undefined : next);
	};

	let dragIndex: number | null = null;

	visible.forEach((item, i) => {
		const row = list.createDiv({ cls: 'dashboard-weread-cfg-stats-row' });

		const handle = row.createSpan({ cls: 'dashboard-weread-cfg-stats-handle' });
		setIcon(handle, 'grip-vertical');
		// The ROW is the drag source but only while the handle is pressed, so
		// the checkbox stays clickable (settings.ts workspace-row idiom).
		handle.addEventListener('pointerdown', () => { row.draggable = true; });
		handle.addEventListener('pointerup', () => { row.draggable = false; });

		const clearIndicators = (): void => {
			row.removeClass('dashboard-weread-cfg-stats-row--drop-before');
			row.removeClass('dashboard-weread-cfg-stats-row--drop-after');
		};
		row.addEventListener('dragstart', (e) => {
			dragIndex = i;
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', String(i));
			}
			row.addClass('dashboard-weread-cfg-stats-row--dragging');
		});
		row.addEventListener('dragend', () => {
			row.draggable = false;
			row.removeClass('dashboard-weread-cfg-stats-row--dragging');
			clearIndicators();
			dragIndex = null;
		});
		row.addEventListener('dragover', (e) => {
			if (dragIndex === null || dragIndex === i) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			row.addClass(e.offsetY < row.offsetHeight / 2
				? 'dashboard-weread-cfg-stats-row--drop-before'
				: 'dashboard-weread-cfg-stats-row--drop-after');
		});
		row.addEventListener('dragleave', clearIndicators);
		row.addEventListener('drop', (e) => {
			e.preventDefault();
			const from = dragIndex;
			clearIndicators();
			if (from === null || from === i) return;
			const insertPos = e.offsetY < row.offsetHeight / 2 ? i : i + 1;
			const to = from < insertPos ? insertPos - 1 : insertPos;
			const next = [...visible];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved!);
			commit(next);
		});

		appendStatsRowControls(row, item, true, () => commit(visible.filter(v => v !== item)));
	});

	for (const item of hidden) {
		const row = list.createDiv({ cls: 'dashboard-weread-cfg-stats-row dashboard-weread-cfg-stats-row--hidden' });
		// Placeholder keeps hidden rows aligned with the handle column.
		row.createSpan({ cls: 'dashboard-weread-cfg-stats-handle dashboard-weread-cfg-stats-handle--placeholder' });
		appendStatsRowControls(row, item, false, () => commit([...visible, item]));
	}
}

function appendStatsRowControls(
	row: HTMLElement,
	item: WereadStatItem,
	checked: boolean,
	onToggle: () => void,
): void {
	const check = row.createEl('input', {
		cls: 'dashboard-weread-cfg-stats-check',
		attr: { type: 'checkbox' },
	});
	check.checked = checked;
	check.addEventListener('change', onToggle);
	row.createSpan({ cls: 'dashboard-weread-cfg-stats-label', text: t(STAT_ITEM_LABEL_KEYS[item]) });
}

function toggleValue<T>(values: readonly T[] | undefined, value: T): T[] | undefined {
	if (values?.includes(value)) {
		const next = values.filter(item => item !== value);
		return next.length > 0 ? next : undefined;
	}
	return [...(values ?? []), value];
}
