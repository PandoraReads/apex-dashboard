import { Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { startGuardedDrag } from './drag-guard';
import type { TableColumnRow } from './library-section';

/**
 * Toolbar "table columns" picker for library/folder sections (the eye button
 * in table view): a vertical list of the section's properties, each row with
 * a drag handle (reorder — pointer-based, so mouse and touch both work) and
 * an eye toggle (show/hide). Everything defaults visible; hiding is the
 * exceptional act. The caller persists the final row sequence through its
 * onConfigChange channel.
 */
export class TableColumnsModal extends Modal {
	private rows: TableColumnRow[];
	private readonly onSave: (rows: TableColumnRow[]) => void;
	private listEl: HTMLElement | null = null;

	constructor(
		app: import('obsidian').App,
		rows: readonly TableColumnRow[],
		onSave: (rows: TableColumnRow[]) => void,
	) {
		super(app);
		this.rows = rows.map(r => ({ key: r.key, hidden: r.hidden }));
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
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('library.tableProperties') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.tablePropertiesHint') });
		if (this.rows.length === 0) {
			body.createDiv({ cls: 'dashboard-library-empty', text: t('library.noFiles') });
		} else {
			this.listEl = body.createDiv({ cls: 'dashboard-table-cols-list' });
			this.renderRows();
		}

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave(this.rows.map(r => ({ ...r })));
			this.close();
		});
	}

	private renderRows(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		this.rows.forEach((row, index) => {
			const item = list.createDiv({
				cls: 'dashboard-table-cols-row' + (row.hidden ? ' is-off' : ''),
				attr: { 'data-key': row.key },
			});
			this.wireDragHandle(item);
			item.createDiv({ cls: 'dashboard-table-cols-name', text: row.key });
			const eye = item.createDiv({
				cls: 'dashboard-table-cols-eye' + (row.hidden ? ' is-off' : ''),
				attr: {
					role: 'button',
					'aria-pressed': String(!row.hidden),
					'aria-label': row.hidden ? t('library.tableColsShow') : t('library.tableColsHide'),
				},
			});
			setIcon(eye, row.hidden ? 'eye-off' : 'eye');
			eye.addEventListener('click', () => {
				const target = this.rows[index]!;
				target.hidden = !target.hidden;
				this.renderRows();
			});
		});
	}

	/** Pointer-based row drag (mouse + touch share pointer events), riding
	 *  the shared guarded-drag shield: a body-level overlay with pointer
	 *  capture plus document-level listeners keeps the move/up stream alive
	 *  no matter what sits under the cursor (the same net the resize handles
	 *  use — handle-local listeners stall the moment capture hiccups, which
	 *  froze the drag). The row's DOM node moves live between its siblings;
	 *  on release the row array is re-read from the DOM order. */
	private wireDragHandle(item: HTMLElement): void {
		const handle = item.createDiv({
			cls: 'dashboard-table-cols-handle',
			attr: { role: 'button', 'aria-label': t('library.tableColsReorder') },
		});
		setIcon(handle, 'grip-vertical');
		handle.addEventListener('pointerdown', (ev) => {
			const e = ev as PointerEvent;
			item.addClass('is-dragging');
			startGuardedDrag(e, {
				cursor: 'grabbing',
				onMove: (mv: PointerEvent): void => {
					const y = mv.clientY;
					const parent = item.parentElement;
					if (!parent) return;
					// Insert before the first sibling whose vertical midpoint the
					// pointer is above; past every row, park at the end.
					for (const sibling of Array.from(parent.children) as HTMLElement[]) {
						if (sibling === item) continue;
						const r = sibling.getBoundingClientRect();
						if (y < r.top + r.height / 2) {
							parent.insertBefore(item, sibling);
							return;
						}
					}
					parent.appendChild(item);
				},
				onUp: (): void => {
					item.removeClass('is-dragging');
					this.syncRowsFromDom();
				},
			});
		});
	}

	/** Rebuild the row array from the list's DOM order (drag's source of
	 *  truth), keeping each key's current hidden state. */
	private syncRowsFromDom(): void {
		const list = this.listEl;
		if (!list) return;
		const hiddenOf = new Map(this.rows.map(r => [r.key, r.hidden]));
		this.rows = (Array.from(list.children) as HTMLElement[])
			.map(el => el.dataset.key ?? '')
			.filter(key => key.length > 0)
			.map(key => ({ key, hidden: hiddenOf.get(key) ?? false }));
	}

	onClose(): void {
		this.contentEl.empty();
		this.listEl = null;
	}
}
