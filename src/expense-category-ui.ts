import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	categoriesFor,
	type AddCategoryResult,
	type ExpenseType,
	EXPENSE_CATEGORY_NAME_MAX,
	type ExpenseService,
} from './expense-service';
import { applyModalTheme } from './modal-theme';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';

/** Sentinel option values appended after the real categories. */
export const CATEGORY_ADD_OPTION = '__add_category__';
export const CATEGORY_MANAGE_OPTION = '__manage_categories__';
/** Sentinel option inside the per-row primary-group select. */
export const PRIMARY_ADD_OPTION = '__add_primary__';

const PRESET_KEYS = new Set<string>([...categoriesFor('expense'), ...categoriesFor('income')]);

/** Display label for a category key: preset keys localize through i18n;
 *  custom names and dirty keys show as-is. */
export function categoryLabel(key: string): string {
	return PRESET_KEYS.has(key) ? t(`expense.cat.${key}`) : key;
}

export interface CategorySelectOptions {
	/** Preferred value (kept when still a known category). */
	value?: string;
	/** Trailing "+ New category…" / "Manage categories…" entries. Default on. */
	management?: boolean;
}

/** (Re)build a category select's options: known categories in display order,
 *  then the two management entries. Returns the value the select ended up
 *  holding. Primary groups never appear here — grouping is a ledger/stats
 *  dimension, not an entry-time choice. */
export function populateCategorySelect(
	select: HTMLSelectElement,
	service: ExpenseService,
	type: ExpenseType,
	options: CategorySelectOptions = {},
): string {
	const { value, management = true } = options;
	select.empty();
	const cats = service.getOrderedCategories(type);
	for (const key of cats) {
		select.createEl('option', { text: categoryLabel(key), attr: { value: key } });
	}
	if (management) {
		select.createEl('option', { text: t('expense.cat.addOption'), attr: { value: CATEGORY_ADD_OPTION } });
		select.createEl('option', { text: t('expense.cat.manageOption'), attr: { value: CATEGORY_MANAGE_OPTION } });
	}
	const applied = value !== undefined && cats.includes(value) ? value : service.getLastCategory(type);
	select.value = applied;
	return applied;
}

/** Surface an AddCategoryResult as a Notice; returns the name when added. */
function announceAdd(result: AddCategoryResult): string | null {
	if (result.ok) return result.name;
	const key = result.reason === 'duplicate'
		? 'expense.cat.exists'
		: result.reason === 'limit'
			? 'expense.cat.limit'
			: 'expense.cat.invalid';
	new Notice(t(key));
	return null;
}

/** Same announcement shape for primary groups (their own limit message). */
function announceAddPrimary(result: AddCategoryResult): string | null {
	if (result.ok) return result.name;
	const key = result.reason === 'duplicate'
		? 'expense.cat.exists'
		: result.reason === 'limit'
			? 'expense.cat.primaryLimit'
			: 'expense.cat.invalid';
	new Notice(t(key));
	return null;
}

/** Prompt for a name and register it; resolves to the new name or null. */
export async function promptAndAddCategory(service: ExpenseService, type: ExpenseType): Promise<string | null> {
	const name = await showPromptDialog(null, {
		title: `${t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel')} · ${t('expense.cat.addTitle')}`,
		placeholder: t('expense.cat.namePlaceholder'),
	});
	if (name === null) return null;
	return announceAdd(service.addCustomCategory(type, name.slice(0, EXPENSE_CATEGORY_NAME_MAX)));
}

/** Prompt for a name and register a primary group; resolves to the name. */
export async function promptAndAddPrimary(service: ExpenseService, type: ExpenseType): Promise<string | null> {
	const name = await showPromptDialog(null, {
		title: `${t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel')} · ${t('expense.cat.addPrimaryTitle')}`,
		placeholder: t('expense.cat.primaryNamePlaceholder'),
	});
	if (name === null) return null;
	return announceAddPrimary(service.addPrimaryCategory(type, name.slice(0, EXPENSE_CATEGORY_NAME_MAX)));
}

/** Immutable index move (splice operates on the fresh copy only). */
function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
	const next = [...list];
	const [item] = next.splice(from, 1);
	if (item !== undefined) next.splice(to, 0, item);
	return next;
}

/**
 * Sentinel handling for a populated category select: intercepts the trailing
 * "+ New category…" / "Manage categories…" entries. The previous selection is
 * restored synchronously so commit paths (Enter in the amount field) never
 * read a sentinel value; a freshly created category is then selected.
 */
export function wireCategorySelect(
	select: HTMLSelectElement,
	service: ExpenseService,
	type: ExpenseType,
): void {
	let lastGood = select.value;
	select.addEventListener('change', () => {
		const value = select.value;
		if (value !== CATEGORY_ADD_OPTION && value !== CATEGORY_MANAGE_OPTION) {
			lastGood = value;
			return;
		}
		select.value = lastGood;
		if (value === CATEGORY_ADD_OPTION) {
			void promptAndAddCategory(service, type).then((name) => {
				if (!name) return;
				lastGood = name;
				populateCategorySelect(select, service, type, { value: name });
			});
			return;
		}
		showCategoryManager(select.ownerDocument, service);
	});
}

/**
 * Category manager overlay: per-direction sections with two sortable lists —
 * the full category set (presets + customs) each with a primary-group select,
 * and the primary groups themselves — plus inline add rows. Body-level
 * overlay (dashboard-confirm pattern) so it stacks above custom overlays and
 * native modals alike. Dragging follows the settings-page pattern (grip arms
 * the row's draggable on pointerdown); up/down buttons cover touch, where
 * HTML5 drag never fires.
 */
export function showCategoryManager(doc: Document, service: ExpenseService): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-confirm-overlay' });
	const card = overlay.createDiv({ cls: 'dashboard-confirm-card dashboard-expense-catmgr' });
	applyModalTheme(card);
	card.createEl('h3', { text: t('expense.cat.manageTitle'), cls: 'dashboard-confirm-title' });
	const body = card.createDiv({ cls: 'dashboard-expense-catmgr-body' });

	function close(): void {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		// A native modal beneath us handles its own Escape — don't take it.
		if (e.key === 'Escape' && !doc.querySelector('.modal-container')) close();
	}
	doc.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	/** Drag-to-reorder wiring for one list (settings-page pattern). The
	 *  drag index lives in this closure, scoped to the rows handed in, so a
	 *  drop can never act on an index from a previous render's rows. */
	function wireSortHandles(rows: HTMLElement[], onReorder: (from: number, to: number) => void): void {
		let dragFrom: number | null = null;
		const clearHints = (row: HTMLElement): void => {
			row.removeClass('dashboard-expense-catmgr-row--drop-before');
			row.removeClass('dashboard-expense-catmgr-row--drop-after');
		};
		rows.forEach((row, i) => {
			const handle = row.createSpan({
				cls: 'dashboard-expense-catmgr-grip',
				attr: { 'aria-label': t('common.drag'), title: t('common.drag') },
			});
			setIcon(handle, 'grip-vertical');
			row.prepend(handle);
			// The ROW is the drag source but only turns draggable while the
			// grip is held, so the row's select and buttons stay interactive.
			handle.addEventListener('pointerdown', () => { row.draggable = true; });
			handle.addEventListener('pointerup', () => { row.draggable = false; });
			row.addEventListener('dragstart', (e) => {
				dragFrom = i;
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', String(i));
				}
				row.addClass('dashboard-expense-catmgr-row--dragging');
			});
			row.addEventListener('dragend', () => {
				row.draggable = false;
				row.removeClass('dashboard-expense-catmgr-row--dragging');
				clearHints(row);
				dragFrom = null;
			});
			row.addEventListener('dragover', (e) => {
				if (dragFrom === null || dragFrom === i) return;
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				const rect = row.getBoundingClientRect();
				const before = e.clientY < rect.top + rect.height / 2;
				clearHints(row);
				row.addClass(before ? 'dashboard-expense-catmgr-row--drop-before' : 'dashboard-expense-catmgr-row--drop-after');
			});
			row.addEventListener('dragleave', () => clearHints(row));
			row.addEventListener('drop', (e) => {
				e.preventDefault();
				const from = dragFrom;
				clearHints(row);
				if (from === null || from === i) return;
				// Insertion point: before this row (upper half) or after it.
				const rect = row.getBoundingClientRect();
				const insertPos = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
				dragFrom = null;
				onReorder(from, from < insertPos ? insertPos - 1 : insertPos);
			});
		});
	}

	/** Compact up/down chevrons (touch fallback — HTML5 drag never fires on
	 *  mobile) committing through the same reorder path as dragging. */
	function addMoveButtons(row: HTMLElement, index: number, count: number, onMove: (from: number, to: number) => void): void {
		const wrap = row.createDiv({ cls: 'dashboard-expense-catmgr-move' });
		const up = wrap.createDiv({
			cls: 'dashboard-expense-catmgr-move-btn',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.cat.moveUp'), title: t('expense.cat.moveUp') },
		});
		setIcon(up, 'chevron-up');
		const down = wrap.createDiv({
			cls: 'dashboard-expense-catmgr-move-btn',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.cat.moveDown'), title: t('expense.cat.moveDown') },
		});
		setIcon(down, 'chevron-down');
		if (index > 0) up.addEventListener('click', () => onMove(index, index - 1));
		else up.addClass('dashboard-expense-catmgr-move-btn--disabled');
		if (index < count - 1) down.addEventListener('click', () => onMove(index, index + 1));
		else down.addClass('dashboard-expense-catmgr-move-btn--disabled');
	}

	/** Inline add row (input + button, Enter submits); shared by both lists. */
	function addRow(section: HTMLElement, placeholder: string, submit: (name: string) => boolean): void {
		const wrap = section.createDiv({ cls: 'dashboard-expense-catmgr-add' });
		const input = wrap.createEl('input', {
			cls: 'dashboard-prompt-input dashboard-expense-catmgr-input',
			attr: { type: 'text', placeholder, autocomplete: 'off' },
		});
		const btn = wrap.createEl('button', { cls: 'dashboard-confirm-confirm', text: t('common.add') });
		const commit = (): void => {
			const name = input.value.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
			if (name.length === 0) return;
			if (submit(name)) {
				render();
			} else {
				input.focus();
			}
		};
		btn.addEventListener('click', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			}
		});
	}

	function render(): void {
		body.empty();
		for (const type of ['expense', 'income'] as const) {
			const section = body.createDiv({ cls: 'dashboard-expense-catmgr-section' });
			section.createDiv({
				cls: 'dashboard-expense-catmgr-section-title',
				text: t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel'),
			});

			// --- Categories (presets + customs, user order) ---
			section.createDiv({ cls: 'dashboard-expense-catmgr-subtitle', text: t('expense.cat.secondarySection') });
			const cats = service.getOrderedCategories(type);
			const catRows = cats.map(() => section.createDiv({ cls: 'dashboard-expense-catmgr-row' }));
			const commitCatOrder = (from: number, to: number): void => {
				if (service.reorderCategories(type, moveItem(cats, from, to))) render();
			};
			wireSortHandles(catRows, commitCatOrder);
			cats.forEach((key, i) => {
				const row = catRows[i]!;
				const isCustom = !categoriesFor(type).includes(key);
				row.createSpan({ cls: 'dashboard-expense-catmgr-name', text: categoryLabel(key) });

				const primarySelect = row.createEl('select', {
					cls: 'dashboard-expense-catmgr-primary',
					attr: { 'aria-label': t('expense.cat.primarySection') },
				});
				primarySelect.createEl('option', { text: t('expense.cat.ungrouped'), attr: { value: '' } });
				for (const p of service.getPrimaryCategories(type)) {
					primarySelect.createEl('option', { text: p, attr: { value: p } });
				}
				primarySelect.createEl('option', { text: t('expense.cat.addPrimaryOption'), attr: { value: PRIMARY_ADD_OPTION } });
				primarySelect.value = service.getCategoryParent(type, key) ?? '';
				let lastGood = primarySelect.value;
				primarySelect.addEventListener('change', () => {
					const value = primarySelect.value;
					if (value === PRIMARY_ADD_OPTION) {
						// Restore synchronously; the async prompt re-renders on
						// completion so no code path ever reads the sentinel.
						primarySelect.value = lastGood;
						void promptAndAddPrimary(service, type).then((name) => {
							if (name) service.setCategoryParent(type, key, name);
							render();
						});
						return;
					}
					lastGood = value;
					service.setCategoryParent(type, key, value === '' ? null : value);
					render();
				});

				row.createSpan({
					cls: 'dashboard-expense-catmgr-usage',
					text: t('expense.cat.usage', { n: service.countCategoryUsage(type, key) }),
				});
				addMoveButtons(row, i, cats.length, commitCatOrder);
				if (isCustom) {
					const del = row.createDiv({
						cls: 'dashboard-expense-catmgr-delete',
						attr: { role: 'button', tabindex: '0', 'aria-label': t('common.delete') },
					});
					setIcon(del, 'trash-2');
					const confirmRemove = async (): Promise<void> => {
						const yes = await showConfirmDialog(null, {
							title: t('expense.cat.removeConfirmTitle'),
							message: t('expense.cat.removeConfirmMessage', { name: categoryLabel(key) }),
						});
						if (yes && service.removeCustomCategory(type, key)) render();
					};
					del.addEventListener('click', () => { void confirmRemove(); });
				}
			});
			addRow(section, t('expense.cat.namePlaceholder'), (name) =>
				announceAdd(service.addCustomCategory(type, name)) !== null);

			// --- Primary groups ---
			section.createDiv({ cls: 'dashboard-expense-catmgr-subtitle', text: t('expense.cat.primarySection') });
			const primaries = service.getPrimaryCategories(type);
			if (primaries.length === 0) {
				section.createDiv({ cls: 'dashboard-expense-catmgr-empty', text: t('expense.cat.primaryEmpty') });
			}
			const primaryRows = primaries.map(() => section.createDiv({ cls: 'dashboard-expense-catmgr-row' }));
			const commitPrimaryOrder = (from: number, to: number): void => {
				if (service.reorderPrimaryCategories(type, moveItem(primaries, from, to))) render();
			};
			wireSortHandles(primaryRows, commitPrimaryOrder);
			primaries.forEach((name, i) => {
				const row = primaryRows[i]!;
				row.createSpan({ cls: 'dashboard-expense-catmgr-name', text: name });
				row.createSpan({
					cls: 'dashboard-expense-catmgr-usage',
					text: t('expense.cat.primaryCount', { n: service.countPrimaryUsage(type, name) }),
				});
				addMoveButtons(row, i, primaries.length, commitPrimaryOrder);
				const del = row.createDiv({
					cls: 'dashboard-expense-catmgr-delete',
					attr: { role: 'button', tabindex: '0', 'aria-label': t('common.delete') },
				});
				setIcon(del, 'trash-2');
				const confirmRemove = async (): Promise<void> => {
					const yes = await showConfirmDialog(null, {
						title: t('expense.cat.primaryRemoveConfirmTitle'),
						message: t('expense.cat.primaryRemoveConfirmMessage', { name, n: service.countPrimaryUsage(type, name) }),
					});
					if (yes && service.removePrimaryCategory(type, name)) render();
				};
				del.addEventListener('click', () => { void confirmRemove(); });
			});
			addRow(section, t('expense.cat.primaryNamePlaceholder'), (name) =>
				announceAddPrimary(service.addPrimaryCategory(type, name)) !== null);
		}
	}
	render();
}
