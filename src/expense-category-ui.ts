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

/** (Re)build a category select's options: known categories, then the two
 *  management entries. Returns the value the select ended up holding. */
export function populateCategorySelect(
	select: HTMLSelectElement,
	service: ExpenseService,
	type: ExpenseType,
	options: CategorySelectOptions = {},
): string {
	const { value, management = true } = options;
	select.empty();
	const cats = service.getCategories(type);
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

/** Prompt for a name and register it; resolves to the new name or null. */
export async function promptAndAddCategory(service: ExpenseService, type: ExpenseType): Promise<string | null> {
	const name = await showPromptDialog(null, {
		title: `${t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel')} · ${t('expense.cat.addTitle')}`,
		placeholder: t('expense.cat.namePlaceholder'),
	});
	if (name === null) return null;
	return announceAdd(service.addCustomCategory(type, name.slice(0, EXPENSE_CATEGORY_NAME_MAX)));
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
 * Category manager overlay: per-direction sections listing the custom names
 * with usage counts and delete buttons, plus an inline add row. Body-level
 * overlay (dashboard-confirm pattern) so it stacks above custom overlays and
 * native modals alike.
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

	function render(): void {
		body.empty();
		for (const type of ['expense', 'income'] as const) {
			const section = body.createDiv({ cls: 'dashboard-expense-catmgr-section' });
			section.createDiv({
				cls: 'dashboard-expense-catmgr-section-title',
				text: t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel'),
			});
			const customs = service.getCustomCategories(type);
			if (customs.length === 0) {
				section.createDiv({ cls: 'dashboard-expense-catmgr-empty', text: t('expense.cat.empty') });
			}
			for (const name of customs) {
				const row = section.createDiv({ cls: 'dashboard-expense-catmgr-row' });
				row.createSpan({ cls: 'dashboard-expense-catmgr-name', text: name });
				row.createSpan({
					cls: 'dashboard-expense-catmgr-usage',
					text: t('expense.cat.usage', { n: service.countCategoryUsage(type, name) }),
				});
				const del = row.createDiv({
					cls: 'dashboard-expense-catmgr-delete',
					attr: { role: 'button', tabindex: '0', 'aria-label': t('common.delete') },
				});
				setIcon(del, 'trash-2');
				const confirmRemove = async (): Promise<void> => {
					const yes = await showConfirmDialog(null, {
						title: t('expense.cat.removeConfirmTitle'),
						message: t('expense.cat.removeConfirmMessage', { name }),
					});
					if (yes && service.removeCustomCategory(type, name)) render();
				};
				del.addEventListener('click', () => { void confirmRemove(); });
			}
			const addRow = section.createDiv({ cls: 'dashboard-expense-catmgr-add' });
			const input = addRow.createEl('input', {
				cls: 'dashboard-prompt-input dashboard-expense-catmgr-input',
				attr: { type: 'text', placeholder: t('expense.cat.namePlaceholder'), autocomplete: 'off' },
			});
			const addBtn = addRow.createEl('button', { cls: 'dashboard-confirm-confirm', text: t('common.add') });
			const submit = (): void => {
				const name = input.value.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX);
				if (name.length === 0) return;
				if (announceAdd(service.addCustomCategory(type, name)) !== null) {
					render();
				} else {
					input.focus();
				}
			};
			addBtn.addEventListener('click', submit);
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			});
		}
	}
	render();
}
