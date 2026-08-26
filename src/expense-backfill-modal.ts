import { App, Modal, Notice } from 'obsidian';
import { t } from './i18n';
import {
	expenseToday,
	type ExpenseType,
	EXPENSE_MAX_NOTE_LENGTH,
	getExpenseService,
	type ExpenseRecord,
	sanitizeAmountInput,
} from './expense-service';
import { populateCategorySelect, wireCategorySelect } from './expense-category-ui';
import { applyModalTheme } from './modal-theme';

/** Values the backfill modal collects before handing them to the caller. */
export interface ExpenseBackfillInput {
	type: ExpenseType;
	amount: number;
	category: string;
	note?: string;
	date: string;
}

export interface ExpenseBackfillOptions {
	/** Edit mode: prefill every field from this record (title switches to
	 *  "Edit record"); the caller decides between add and update. */
	initial?: ExpenseRecord;
	/** Raise the modal above the expense overlays (stats z 1000 / ledger z
	 *  1010) when opened from inside one. */
	aboveOverlay?: boolean;
}

/**
 * Backfill dialog: one expense/income entry for any past date (the sidebar
 * widget only records today), or an existing record's editor when `initial`
 * is given. TrackerConfigModal skeleton — themed config modal, Enter submits,
 * the type toggle swaps the category select's options (which also carries the
 * "+ New category…" / "Manage categories…" entries).
 */
export class ExpenseBackfillModal extends Modal {
	private onSave: (input: ExpenseBackfillInput) => void;
	private options: ExpenseBackfillOptions;

	private typeValue: ExpenseType = 'expense';
	private categorySelect: HTMLSelectElement | null = null;

	constructor(app: App, onSave: (input: ExpenseBackfillInput) => void, options: ExpenseBackfillOptions = {}) {
		super(app);
		this.onSave = onSave;
		this.options = options;
		if (options.initial) this.typeValue = options.initial.type;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		if (this.options.aboveOverlay) containerEl.addClass('dashboard-modal--above-overlay');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const service = getExpenseService();
		const currency = service?.getCurrency() ?? '¥';
		const initial = this.options.initial;

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({
			cls: 'dashboard-modal-title',
			text: t(initial ? 'expense.editTitle' : 'expense.backfillTitle'),
		});

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Date (defaults to today; the native picker caps it at today).
		const dateSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		dateSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('expense.dateLabel') });
		const dateInput = dateSection.createEl('input', {
			cls: 'dashboard-modal-input dashboard-expense-backfill-date',
			attr: { type: 'date', value: initial?.date ?? expenseToday(), max: expenseToday() },
		});

		// Expense / income toggle.
		const typeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		typeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('expense.colType') });
		const typeRow = typeSection.createDiv({ cls: 'dashboard-library-view-toggle' });
		const typeOptions: { value: ExpenseType; labelKey: string }[] = [
			{ value: 'expense', labelKey: 'expense.typeExpense' },
			{ value: 'income', labelKey: 'expense.typeIncome' },
		];

		// Amount + category share one row (compact modal width).
		const entrySection = body.createDiv({ cls: 'dashboard-library-config-section' });
		const entryRow = entrySection.createDiv({ cls: 'dashboard-expense-backfill-row' });
		entryRow.createDiv({ cls: 'dashboard-expense-backfill-currency', text: currency });
		const amountInput = entryRow.createEl('input', {
			cls: 'dashboard-modal-input dashboard-expense-backfill-amount',
			attr: {
				type: 'text',
				inputmode: 'decimal',
				autocomplete: 'off',
				placeholder: '0.00',
				...(initial ? { value: String(initial.amount) } : {}),
			},
		});
		amountInput.addEventListener('input', () => {
			const sanitized = sanitizeAmountInput(amountInput.value);
			if (sanitized !== amountInput.value) amountInput.value = sanitized;
		});
		const select = entryRow.createEl('select', {
			cls: 'dashboard-modal-input dashboard-expense-backfill-category',
			attr: { 'aria-label': t('expense.colCategory') },
		});
		this.categorySelect = select;

		/** Rebuild the options when the direction toggle changes (custom
		 *  categories included via populateCategorySelect). */
		const rebuildOptions = (type: ExpenseType): void => {
			if (!service) return;
			select.empty();
			populateCategorySelect(select, service, type, initial ? { value: initial.category } : {});
		};
		rebuildOptions(this.typeValue);
		if (service) wireCategorySelect(select, service, this.typeValue);

		for (const opt of typeOptions) {
			const btn = typeRow.createEl('button', {
				cls: 'dashboard-library-view-btn' + (opt.value === this.typeValue ? ' active' : ''),
				text: t(opt.labelKey),
			});
			btn.addEventListener('click', () => {
				this.typeValue = opt.value;
				typeRow.querySelectorAll('.dashboard-library-view-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				rebuildOptions(opt.value);
			});
		}

		// Optional note.
		const noteSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		noteSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('expense.colNote') });
		const noteInput = noteSection.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: {
				type: 'text',
				autocomplete: 'off',
				placeholder: t('expense.notePlaceholder'),
				...(initial?.note ? { value: initial.note } : {}),
			},
		});

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		const saveBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		saveBtn.addEventListener('click', () => this.submit(dateInput, amountInput, noteInput));
		for (const input of [amountInput, noteInput]) {
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					saveBtn.click();
				}
			});
		}

		amountInput.focus();
		if (initial) amountInput.select();
	}

	/** Validate the collected fields and hand them to the caller. */
	private submit(dateInput: HTMLInputElement, amountInput: HTMLInputElement, noteInput: HTMLInputElement): void {
		const date = dateInput.value || expenseToday();
		if (date > expenseToday()) {
			new Notice(t('expense.futureDate'));
			return;
		}
		const amount = Number(amountInput.value.trim());
		if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e8) {
			new Notice(t('expense.invalidAmount'));
			return;
		}
		const note = noteInput.value.trim().slice(0, EXPENSE_MAX_NOTE_LENGTH);
		this.onSave({
			type: this.typeValue,
			amount,
			category: this.categorySelect?.value ?? 'other',
			...(note ? { note } : {}),
			date,
		});
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.categorySelect = null;
	}
}
