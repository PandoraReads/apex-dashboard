import { App, Modal, setIcon } from 'obsidian';
import type { WereadConfig, WereadWidget } from './types';
import { t } from './i18n';

const VIEW_OPTIONS: Array<{ value: WereadWidget['view']; labelKey: string }> = [
	{ value: 'shelf', labelKey: 'weread.viewShelf' },
	{ value: 'stats', labelKey: 'weread.viewStats' },
	{ value: 'notes', labelKey: 'weread.viewNotes' },
];
const PROGRESS_OPTIONS: Array<{ value: string; labelKey: string }> = [
	{ value: 'notStarted', labelKey: 'weread.progressNotStarted' },
	{ value: 'reading', labelKey: 'weread.progressReading' },
	{ value: 'finished', labelKey: 'weread.progressFinished' },
];

/**
 * Configuration modal for a weread section. Manages an ordered list of widgets
 * (add / remove / reorder / per-widget type + shelf filter + optional title),
 * rendered top-to-bottom in the section. The shelf filter lists the user's real
 * shelf categories (plus the reading-state filters).
 */
export class WereadConfigModal extends Modal {
	private widgets: WereadWidget[];
	private readonly categories: string[];
	private readonly onSave: (config: WereadConfig) => void;

	constructor(app: App, config: WereadConfig, categories: string[], onSave: (config: WereadConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.categories = categories;
		this.widgets = (config.widgets?.length ? config.widgets : [{ id: 'w1', view: 'shelf' as const }]).map(w => ({ ...w }));
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('weread.configure') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({ cls: 'dashboard-library-config-section-title', text: t('weread.widgetsLabel') });

		const list = body.createDiv({ cls: 'dashboard-weread-cfg-list' });

		const render = (): void => {
			list.empty();
			this.widgets.forEach((w, i) => {
				const row = list.createDiv({ cls: 'dashboard-weread-cfg-row' });

				const main = row.createDiv({ cls: 'dashboard-weread-cfg-main' });

				// Optional title
				const titleInput = main.createEl('input', {
					cls: 'dashboard-weread-cfg-title',
					attr: { type: 'text', placeholder: t('weread.widgetTitlePlaceholder'), value: w.title ?? '' },
				});
				titleInput.addEventListener('change', () => {
					const v = titleInput.value.trim();
					w.title = v.length > 0 ? v : undefined;
				});

				// View selector
				const viewSelect = main.createEl('select', { cls: 'dashboard-library-filter-property' });
				for (const v of VIEW_OPTIONS) {
					const opt = viewSelect.createEl('option', { text: t(v.labelKey), attr: { value: v.value } });
					if (w.view === v.value) opt.selected = true;
				}
				viewSelect.addEventListener('change', () => {
					w.view = viewSelect.value as WereadWidget['view'];
					render();
				});

				// Shelf filters (multi-select, two independent lists). None selected = all.
				if (w.view === 'shelf') {
					const progressGroup = main.createDiv({ cls: 'dashboard-weread-cfg-filter-group' });
					progressGroup.createDiv({ cls: 'dashboard-weread-cfg-filter-label', text: t('weread.filterProgress') });
					const progressChips = progressGroup.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
					for (const opt of PROGRESS_OPTIONS) {
						const active = w.progressFilters?.includes(opt.value) ?? false;
						const chip = progressChips.createDiv({ cls: 'dashboard-weread-cfg-chip' + (active ? ' active' : '') });
						chip.createSpan({ text: t(opt.labelKey) });
						chip.addEventListener('click', () => {
							const set = new Set(w.progressFilters ?? []);
							if (set.has(opt.value)) set.delete(opt.value); else set.add(opt.value);
							w.progressFilters = set.size > 0 ? [...set] : undefined;
							render();
						});
					}

					if (this.categories.length > 0) {
						const catGroup = main.createDiv({ cls: 'dashboard-weread-cfg-filter-group' });
						catGroup.createDiv({ cls: 'dashboard-weread-cfg-filter-label', text: t('weread.filterCategory') });
						const catChips = catGroup.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
						for (const cat of this.categories) {
							const active = w.categoryFilters?.includes(cat) ?? false;
							const chip = catChips.createDiv({ cls: 'dashboard-weread-cfg-chip' + (active ? ' active' : '') });
							chip.createSpan({ text: cat });
							chip.addEventListener('click', () => {
								const set = new Set(w.categoryFilters ?? []);
								if (set.has(cat)) set.delete(cat); else set.add(cat);
								w.categoryFilters = set.size > 0 ? [...set] : undefined;
								render();
							});
						}
					}
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
			this.widgets = [...this.widgets, { id: `w${Date.now()}`, view: 'shelf' }];
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
			this.onSave({ widgets: this.widgets.length > 0 ? this.widgets : [{ id: 'w1', view: 'shelf' }] });
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
