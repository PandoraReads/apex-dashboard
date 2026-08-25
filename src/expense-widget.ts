import { App, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	categoriesFor,
	expenseToday,
	type ExpenseType,
	formatExpenseAmount,
	getExpenseService,
	sanitizeAmountInput,
} from './expense-service';
import { showExpenseStats } from './expense-stats-modal';
import { ExpenseBackfillModal } from './expense-backfill-modal';

/** Category display label; t() falls back to the raw key for dirty data. */
function catLabel(key: string): string {
	return t(`expense.cat.${key}`);
}

/** Mark an input invalid for 600ms (danger color + shake, CSS-driven). */
function flashInvalid(input: HTMLElement): void {
	input.addClass('dashboard-sidebar-expense-invalid');
	window.setTimeout(() => input.removeClass('dashboard-sidebar-expense-invalid'), 600);
}

/**
 * Expense tracker widget: two quick-entry rows (expense / income) plus a
 * shared optional note; every entry records today (the calendar-plus button
 * opens a backfill dialog for past dates). Mutations go through
 * ExpenseService only — the view's subscribe callback refreshes every open
 * widget via refreshExpenseWidget, so entries never patch the DOM directly
 * and all views stay in sync.
 */
export function renderSidebarExpenseWidget(container: HTMLElement, app: App): void {
	const service = getExpenseService();
	if (!service) return;

	const currency = service.getCurrency();

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-expense' });

	// The sidebar's drag-and-drop marks every widget draggable="true"; text
	// selection inside the inputs would then drag the whole card instead.
	widget.addEventListener('dragstart', (e) => {
		if ((e.target as HTMLElement).closest('input, select')) e.preventDefault();
	});

	const top = widget.createDiv({ cls: 'dashboard-sidebar-expense-top' });
	const titleEl = top.createDiv({ cls: 'dashboard-sidebar-expense-title' });
	const titleIcon = titleEl.createDiv({ cls: 'dashboard-sidebar-expense-title-icon' });
	setIcon(titleIcon, 'wallet');
	titleEl.createSpan({ text: t('expense.title') });
	const countEl = top.createDiv({ cls: 'dashboard-sidebar-expense-count' });
	countEl.setAttribute('aria-label', t('expense.netToday'));
	top.createDiv({ cls: 'dashboard-sidebar-expense-top-spacer' });

	const backfillBtn = top.createDiv({ cls: 'dashboard-sidebar-expense-icon-btn' });
	backfillBtn.setAttribute('aria-label', t('expense.backfillTitle'));
	setIcon(backfillBtn, 'calendar-plus');
	backfillBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		new ExpenseBackfillModal(app, (input) => {
			const live = getExpenseService();
			if (!live) return;
			const record = live.addRecord(input);
			if (!record) {
				new Notice(t('expense.invalidAmount'));
				return;
			}
			new Notice(t('expense.added', {
				type: t(record.type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel'),
				amount: `${live.getCurrency()}${formatExpenseAmount(record.amount)}`,
				category: catLabel(record.category),
				date: record.date.slice(5),
			}));
		}).open();
	});

	const statsBtn = top.createDiv({ cls: 'dashboard-sidebar-expense-icon-btn' });
	statsBtn.setAttribute('aria-label', t('expense.statsTitle'));
	setIcon(statsBtn, 'bar-chart-2');
	statsBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		showExpenseStats(widget.ownerDocument);
	});

	const form = widget.createDiv({ cls: 'dashboard-sidebar-expense-form' });

	type RowRefs = { amountInput: HTMLInputElement; select: HTMLSelectElement; totalEl: HTMLElement };
	const rows: Record<ExpenseType, RowRefs> = {} as Record<ExpenseType, RowRefs>;
	/** Row whose inputs were focused last — the note field commits this one. */
	let lastActiveType: ExpenseType = 'expense';

	const buildRow = (type: ExpenseType): void => {
		const row = form.createDiv({ cls: `dashboard-sidebar-expense-row dashboard-sidebar-expense-row--${type}` });

		const head = row.createDiv({ cls: 'dashboard-sidebar-expense-row-head' });
		const label = head.createDiv({ cls: 'dashboard-sidebar-expense-row-label' });
		const labelIcon = label.createDiv({ cls: 'dashboard-sidebar-expense-row-label-icon' });
		setIcon(labelIcon, type === 'expense' ? 'arrow-down-right' : 'arrow-up-right');
		label.createSpan({ text: t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel') });
		const totalEl = head.createDiv({ cls: 'dashboard-sidebar-expense-row-total' });

		const main = row.createDiv({ cls: 'dashboard-sidebar-expense-row-main' });
		main.addEventListener('focusin', () => { lastActiveType = type; });

		main.createDiv({ cls: 'dashboard-sidebar-expense-currency', text: currency });

		const amountInput = main.createEl('input', {
			cls: 'dashboard-sidebar-expense-amount',
			attr: {
				type: 'text',
				inputmode: 'decimal',
				autocomplete: 'off',
				placeholder: '0.00',
				'aria-label': t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel'),
			},
		});
		amountInput.addEventListener('input', () => {
			const sanitized = sanitizeAmountInput(amountInput.value);
			if (sanitized !== amountInput.value) amountInput.value = sanitized;
		});

		const select = main.createEl('select', {
			cls: 'dashboard-sidebar-expense-category',
			attr: { 'aria-label': t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel') },
		});
		for (const key of categoriesFor(type)) {
			select.createEl('option', { text: catLabel(key), attr: { value: key } });
		}
		select.value = service.getLastCategory(type);

		rows[type] = { amountInput, select, totalEl };
	};

	buildRow('expense');
	buildRow('income');

	const noteInput = form.createEl('input', {
		cls: 'dashboard-sidebar-expense-note',
		attr: {
			type: 'text',
			autocomplete: 'off',
			placeholder: t('expense.notePlaceholder'),
			'aria-label': t('expense.notePlaceholder'),
		},
	});

	/** Validate + persist one entry from a row's inputs (always today — past
	 *  dates go through the backfill dialog). */
	const commit = (type: ExpenseType): void => {
		const live = getExpenseService();
		if (!live) return;
		const row = rows[type];
		const raw = row.amountInput.value.trim();
		if (raw.length === 0) return;

		const amount = Number(raw);
		if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e8) {
			flashInvalid(row.amountInput);
			new Notice(t('expense.invalidAmount'));
			return;
		}

		const record = live.addRecord({ type, amount, category: row.select.value, note: noteInput.value, date: expenseToday() });
		if (!record) {
			flashInvalid(row.amountInput);
			new Notice(t('expense.invalidAmount'));
			return;
		}
		row.amountInput.value = '';
		noteInput.value = '';
		new Notice(t('expense.added', {
			type: t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel'),
			amount: `${live.getCurrency()}${formatExpenseAmount(record.amount)}`,
			category: catLabel(record.category),
			date: record.date.slice(5),
		}));
		row.amountInput.focus();
	};

	for (const type of ['expense', 'income'] as const) {
		rows[type].amountInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit(type);
			}
		});
	}
	noteInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit(lastActiveType);
		}
	});

	// Initial derived labels (today's totals + net).
	const totals = service.getTodayTotals();
	rows.expense.totalEl.setText(totals.expense > 0 ? `${currency}${formatExpenseAmount(totals.expense)}` : '');
	rows.income.totalEl.setText(totals.income > 0 ? `${currency}${formatExpenseAmount(totals.income)}` : '');
	const hasAny = totals.expense > 0 || totals.income > 0;
	const net = Math.round((totals.income - totals.expense) * 100) / 100;
	countEl.setText(hasAny
		? `${net < 0 ? '-' : ''}${currency}${formatExpenseAmount(Math.abs(net))}`
		: '');
}

/** Refresh the derived labels of an existing widget (today's totals, net
 *  label, remembered categories). The form itself is never rebuilt — typing
 *  state and focus must survive entries made from any view or the stats
 *  overlay. No-op when the widget is absent or the service is gone. */
export function refreshExpenseWidget(root: HTMLElement): void {
	const widget = root.querySelector<HTMLElement>('.dashboard-sidebar-expense');
	if (!widget || !widget.isConnected) return;
	const service = getExpenseService();
	if (!service) return;

	const totals = service.getTodayTotals();
	const currency = service.getCurrency();

	for (const type of ['expense', 'income'] as const) {
		const totalEl = widget.querySelector<HTMLElement>(
			`.dashboard-sidebar-expense-row--${type} .dashboard-sidebar-expense-row-total`);
		if (totalEl) {
			const value = type === 'expense' ? totals.expense : totals.income;
			totalEl.setText(value > 0 ? `${currency}${formatExpenseAmount(value)}` : '');
		}
		const select = widget.querySelector<HTMLSelectElement>(
			`.dashboard-sidebar-expense-row--${type} .dashboard-sidebar-expense-category`);
		// Skip the focused select: the user is mid-choice, don't yank it.
		if (select && select !== widget.ownerDocument.activeElement) {
			select.value = service.getLastCategory(type);
		}
	}

	const countEl = widget.querySelector<HTMLElement>('.dashboard-sidebar-expense-count');
	if (countEl) {
		const hasAny = totals.expense > 0 || totals.income > 0;
		const net = Math.round((totals.income - totals.expense) * 100) / 100;
		countEl.setText(hasAny
			? `${net < 0 ? '-' : ''}${currency}${formatExpenseAmount(Math.abs(net))}`
			: '');
	}
}
