import { App, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	expenseToday,
	type ExpenseType,
	formatExpenseAmount,
	getExpenseService,
	sanitizeAmountInput,
} from './expense-service';
import { categoryLabel, populateCategorySelect, wireCategorySelect } from './expense-category-ui';
import { showExpenseStats } from './expense-stats-modal';
import { ExpenseBackfillModal } from './expense-backfill-modal';

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
				category: categoryLabel(record.category),
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

	type RowRefs = { amountInput: HTMLInputElement; select: HTMLSelectElement };
	const rows: Record<ExpenseType, RowRefs> = {} as Record<ExpenseType, RowRefs>;
	/** Row whose inputs were focused last — the note field commits this one. */
	let lastActiveType: ExpenseType = 'expense';

	const buildRow = (type: ExpenseType): void => {
		const row = form.createDiv({ cls: `dashboard-sidebar-expense-row dashboard-sidebar-expense-row--${type}` });

		// Single-line row: type label leads the amount (the old separate head
		// line doubled the widget height; per-type daily totals were dropped
		// here too — they squeezed the line and misaligned the category
		// selects between rows; the title row keeps the day's net).
		const main = row.createDiv({ cls: 'dashboard-sidebar-expense-row-main' });
		main.addEventListener('focusin', () => { lastActiveType = type; });

		const label = main.createDiv({ cls: 'dashboard-sidebar-expense-row-label' });
		const labelIcon = label.createDiv({ cls: 'dashboard-sidebar-expense-row-label-icon' });
		setIcon(labelIcon, type === 'expense' ? 'arrow-down-right' : 'arrow-up-right');
		label.createSpan({ text: t(type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel') });

		// Currency + amount sit on a ledger-style underline (see styles.css);
		// the category select keeps its boxed look and stands beside the line.
		const amountWrap = main.createDiv({ cls: 'dashboard-sidebar-expense-amount-wrap' });
		amountWrap.createDiv({ cls: 'dashboard-sidebar-expense-currency', text: currency });

		const amountInput = amountWrap.createEl('input', {
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
		populateCategorySelect(select, service, type);
		wireCategorySelect(select, service, type);

		rows[type] = { amountInput, select };
	};

	buildRow('expense');
	buildRow('income');

	// Note row: the input fills the line, a Log button sits at its right and
	// commits whichever row was focused last (same rule as the note's Enter).
	const noteWrap = form.createDiv({ cls: 'dashboard-sidebar-expense-note-wrap' });
	const noteInput = noteWrap.createEl('input', {
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
			category: categoryLabel(record.category),
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

	const submitBtn = noteWrap.createEl('button', {
		cls: 'dashboard-sidebar-expense-submit',
		text: t('expense.submit'),
		attr: { type: 'button', 'aria-label': t('expense.submit') },
	});
	// Empty amount on a button click (unlike Enter, where silence is fine)
	// flashes the row so the click doesn't feel dead.
	submitBtn.addEventListener('click', () => {
		const type = lastActiveType;
		if (rows[type].amountInput.value.trim() === '') {
			flashInvalid(rows[type].amountInput);
			return;
		}
		commit(type);
	});

	// Initial derived labels (today's net on the title row).
	const totals = service.getTodayTotals();
	const hasAny = totals.expense > 0 || totals.income > 0;
	const net = Math.round((totals.income - totals.expense) * 100) / 100;
	countEl.setText(hasAny
		? `${net < 0 ? '-' : ''}${currency}${formatExpenseAmount(Math.abs(net))}`
		: '');
}

/** Refresh the derived labels of an existing widget (today's totals, net
 *  label, remembered categories). Custom categories may have changed in any
 *  view, so option lists are rebuilt too. The form itself is never rebuilt —
 *  typing state and focus must survive entries made from any view or the
 *  stats overlay. No-op when the widget is absent or the service is gone. */
export function refreshExpenseWidget(root: HTMLElement): void {
	const widget = root.querySelector<HTMLElement>('.dashboard-sidebar-expense');
	if (!widget || !widget.isConnected) return;
	const service = getExpenseService();
	if (!service) return;

	const totals = service.getTodayTotals();
	const currency = service.getCurrency();

	for (const type of ['expense', 'income'] as const) {
		const select = widget.querySelector<HTMLSelectElement>(
			`.dashboard-sidebar-expense-row--${type} .dashboard-sidebar-expense-category`);
		// Skip the focused select: the user is mid-choice, don't yank it.
		if (select && select !== widget.ownerDocument.activeElement) {
			populateCategorySelect(select, service, type);
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
