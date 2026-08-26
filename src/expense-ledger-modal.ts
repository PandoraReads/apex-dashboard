import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	type ExpenseRecord,
	type ExpenseService,
	type ExpenseType,
	expenseToday,
	formatExpenseAmount,
	getExpenseService,
} from './expense-service';
import { categoryLabel } from './expense-category-ui';
import { ExpenseBackfillModal } from './expense-backfill-modal';
import { showConfirmDialog } from './confirm-dialog';
import { CSV_HEADER, parseCsv, serializeCsv } from './expense-csv';

/** Sortable table columns (the checkbox and actions cells are fixed). */
type SortKey = 'date' | 'type' | 'category' | 'amount' | 'note';
type TypeFilter = 'all' | ExpenseType;

const PAGE_SIZE = 50;

const COLUMNS: Array<{ key: SortKey; labelKey: string; cls: string }> = [
	{ key: 'date', labelKey: 'expense.colDate', cls: 'dashboard-expense-ledger-th-date' },
	{ key: 'amount', labelKey: 'expense.colAmount', cls: 'dashboard-expense-ledger-th-amount' },
	{ key: 'type', labelKey: 'expense.colType', cls: 'dashboard-expense-ledger-th-type' },
	{ key: 'category', labelKey: 'expense.colCategory', cls: 'dashboard-expense-ledger-th-category' },
	{ key: 'note', labelKey: 'expense.colNote', cls: 'dashboard-expense-ledger-th-note' },
];

/** Mount point for the ledger overlay: inside .apex-dashboard-root so the
 *  --db-* theme variables resolve (same reason as the stats overlay). */
function mountOverlay(doc: Document): HTMLElement {
	const root = doc.querySelector('.apex-dashboard-root');
	const host = root ?? doc.body;
	return host.createDiv({ cls: 'dashboard-expense-ledger-overlay' });
}

/**
 * Full ledger overlay ("view all" from the stats modal): every income/expense
 * record in an Excel-style grid — column sorting, type/category/date/search
 * filters, per-row edit (the backfill dialog in edit mode), batch delete with
 * confirm, CSV import/export, and pagination for large datasets. Live-updates
 * through the service's subscribe fan-out.
 */
export function showExpenseLedger(doc: Document): void {
	const serviceOrNull = getExpenseService();
	if (!serviceOrNull) return;
	const service: ExpenseService = serviceOrNull;

	const currency = service.getCurrency();
	const fmt = (n: number): string => `${currency}${formatExpenseAmount(n)}`;

	// ===== View state (closure-held, survives re-renders) =====
	let typeFilter: TypeFilter = 'all';
	let categoryFilter = '';
	let dateFrom = '';
	let dateTo = '';
	let search = '';
	let sortKey: SortKey = 'date';
	let sortAsc = false; // date desc = newest first, the default view
	let page = 0;
	const selected = new Set<string>();

	const overlay = mountOverlay(doc);
	const modal = overlay.createDiv({ cls: 'dashboard-expense-ledger-modal' });

	let closed = false;
	function close(): void {
		closed = true;
		unsubscribe();
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		// Confirm/prompt cards and native (edit) modals own Escape first.
		if (e.key === 'Escape'
			&& !doc.querySelector('.dashboard-confirm-overlay, .modal-container')) {
			close();
		}
	}
	doc.addEventListener('keydown', onKey);

	// ===== Header =====
	const header = modal.createDiv({ cls: 'dashboard-expense-stats-header' });
	header.createDiv({ cls: 'dashboard-expense-stats-header-title', text: t('expense.ledger.title') });
	const closeBtn = header.createDiv({ cls: 'dashboard-expense-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	// ===== Toolbar (built once; controls mutate state and re-render) =====
	const toolbar = modal.createDiv({ cls: 'dashboard-expense-ledger-toolbar' });
	const filtersGroup = toolbar.createDiv({ cls: 'dashboard-expense-ledger-filters' });

	const typeSelect = filtersGroup.createEl('select', { cls: 'dashboard-expense-ledger-select' });
	for (const opt of [
		{ value: 'all', label: t('expense.ledger.filterAll') },
		{ value: 'expense', label: t('expense.typeExpense') },
		{ value: 'income', label: t('expense.typeIncome') },
	] as const) {
		typeSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	typeSelect.addEventListener('change', () => {
		typeFilter = typeSelect.value as TypeFilter;
		page = 0;
		renderTable();
	});

	const categorySelect = filtersGroup.createEl('select', {
		cls: 'dashboard-expense-ledger-select dashboard-expense-ledger-select--category',
		attr: { 'aria-label': t('expense.colCategory') },
	});
	/** Options: every known category of both directions plus any dirty keys
	 *  still present in records (removed customs keep filtering). */
	function rebuildCategoryFilter(): void {
		const keys: string[] = [];
		const seen = new Set<string>();
		const push = (key: string): void => {
			if (seen.has(key)) return;
			seen.add(key);
			keys.push(key);
		};
		for (const type of ['expense', 'income'] as const) {
			for (const key of service.getCategories(type)) push(key);
		}
		for (const r of service.getRecords()) push(r.category);
		categorySelect.empty();
		categorySelect.createEl('option', { text: t('expense.colCategory'), attr: { value: '' } });
		for (const key of keys) {
			categorySelect.createEl('option', { text: categoryLabel(key), attr: { value: key } });
		}
		categorySelect.value = seen.has(categoryFilter) ? categoryFilter : '';
		categoryFilter = categorySelect.value;
	}
	rebuildCategoryFilter();
	categorySelect.addEventListener('change', () => {
		categoryFilter = categorySelect.value;
		page = 0;
		renderTable();
	});

	const dateFromInput = filtersGroup.createEl('input', {
		cls: 'dashboard-expense-ledger-date',
		attr: { type: 'date', 'aria-label': t('expense.ledger.dateFrom'), max: expenseToday() },
	});
	dateFromInput.addEventListener('change', () => {
		dateFrom = dateFromInput.value;
		page = 0;
		renderTable();
	});
	const dateToInput = filtersGroup.createEl('input', {
		cls: 'dashboard-expense-ledger-date',
		attr: { type: 'date', 'aria-label': t('expense.ledger.dateTo'), max: expenseToday() },
	});
	dateToInput.addEventListener('change', () => {
		dateTo = dateToInput.value;
		page = 0;
		renderTable();
	});

	const searchInput = filtersGroup.createEl('input', {
		cls: 'dashboard-expense-ledger-search',
		attr: { type: 'text', autocomplete: 'off', placeholder: t('expense.ledger.searchPlaceholder') },
	});
	searchInput.addEventListener('input', () => {
		search = searchInput.value;
		page = 0;
		renderTable();
	});

	const clearBtn = filtersGroup.createEl('button', {
		cls: 'dashboard-expense-ledger-btn dashboard-expense-ledger-btn--ghost',
		text: t('expense.ledger.clearFilters'),
	});
	clearBtn.addEventListener('click', () => {
		typeFilter = 'all';
		categoryFilter = '';
		dateFrom = '';
		dateTo = '';
		search = '';
		page = 0;
		typeSelect.value = 'all';
		rebuildCategoryFilter();
		dateFromInput.value = '';
		dateToInput.value = '';
		searchInput.value = '';
		renderTable();
	});

	const actionsGroup = toolbar.createDiv({ cls: 'dashboard-expense-ledger-actions' });

	// Import: hidden native file input; the button just clicks it.
	const fileInput = actionsGroup.createEl('input', {
		cls: 'dashboard-expense-ledger-file',
		attr: { type: 'file', accept: '.csv,text/csv,text/plain' },
	});
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (!file) return;
		void file.text()
			.then((text) => importCsvText(text))
			.catch(() => new Notice(t('expense.ledger.importFailed')));
	});
	const importBtn = actionsGroup.createEl('button', {
		cls: 'dashboard-expense-ledger-btn',
		text: t('expense.ledger.import'),
		attr: { title: t('expense.ledger.importHint') },
	});
	importBtn.addEventListener('click', () => fileInput.click());

	const exportBtn = actionsGroup.createEl('button', {
		cls: 'dashboard-expense-ledger-btn',
		text: t('expense.ledger.export'),
		attr: { title: t('expense.ledger.exportHint') },
	});
	exportBtn.addEventListener('click', () => void exportCsv());

	const batchDeleteBtn = actionsGroup.createEl('button', {
		cls: 'dashboard-expense-ledger-btn dashboard-expense-ledger-btn--danger',
		text: t('expense.ledger.deleteSelected', { n: 0 }),
	});
	batchDeleteBtn.addEventListener('click', () => void deleteSelected());

	// ===== Table =====
	const tableWrap = modal.createDiv({ cls: 'dashboard-expense-ledger-wrap' });
	const table = tableWrap.createEl('table', { cls: 'dashboard-expense-ledger-table' });
	const thead = table.createEl('thead');
	const tbody = table.createEl('tbody');

	const comparators: Record<SortKey, (a: ExpenseRecord, b: ExpenseRecord) => number> = {
		date: (a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1)),
		type: (a, b) => t(a.type === 'expense' ? 'expense.typeExpense' : 'expense.typeIncome')
			.localeCompare(t(b.type === 'expense' ? 'expense.typeExpense' : 'expense.typeIncome')),
		category: (a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category)),
		amount: (a, b) => a.amount - b.amount,
		note: (a, b) => (a.note ?? '').localeCompare(b.note ?? ''),
	};

	function filteredRecords(): ExpenseRecord[] {
		const q = search.trim().toLowerCase();
		const rows = service.getRecords().filter(r => {
			if (typeFilter !== 'all' && r.type !== typeFilter) return false;
			if (categoryFilter && r.category !== categoryFilter) return false;
			if (dateFrom && r.date < dateFrom) return false;
			if (dateTo && r.date > dateTo) return false;
			if (q && !`${r.note ?? ''} ${categoryLabel(r.category)}`.toLowerCase().includes(q)) return false;
			return true;
		});
		const dir = sortAsc ? 1 : -1;
		return rows.sort((a, b) => comparators[sortKey](a, b) * dir || comparators.date(a, b) * dir);
	}

	function renderHead(): void {
		thead.empty();
		const row = thead.createEl('tr');
		const checkTh = row.createEl('th', { cls: 'dashboard-expense-ledger-th-check' });
		const headerCheck = checkTh.createEl('input', { attr: { type: 'checkbox' } });
		headerCheck.addClass('dashboard-expense-ledger-check');
		headerCheck.setAttribute('aria-label', t('expense.ledger.selectAllPage'));
		// Reflect the current page's selection (re-render re-creates this box).
		const pageRows = pageSlice();
		headerCheck.checked = pageRows.length > 0 && pageRows.every(r => selected.has(r.id));
		headerCheck.indeterminate = !headerCheck.checked && pageRows.some(r => selected.has(r.id));
		headerCheck.addEventListener('change', () => {
			for (const r of pageSlice()) {
				if (headerCheck.checked) selected.add(r.id);
				else selected.delete(r.id);
			}
			renderTable();
		});
		for (const col of COLUMNS) {
			const th = row.createEl('th', {
				cls: `dashboard-expense-ledger-th ${col.cls}`,
				attr: { scope: 'col', title: t('expense.ledger.sortBy', { col: t(col.labelKey) }) },
			});
			th.createSpan({ text: t(col.labelKey) });
			if (sortKey === col.key) {
				th.createSpan({
					cls: 'dashboard-expense-ledger-sort',
					text: sortAsc ? '↑' : '↓',
				});
			}
			th.addEventListener('click', () => {
				if (sortKey === col.key) sortAsc = !sortAsc;
				else {
					sortKey = col.key;
					// Dates read best newest-first; everything else ascends.
					sortAsc = col.key !== 'date';
				}
				renderTable();
			});
		}
		row.createEl('th', { cls: 'dashboard-expense-ledger-th-actions' });
	}

	let lastFiltered: ExpenseRecord[] = [];
	function pageSlice(): ExpenseRecord[] {
		return lastFiltered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
	}

	function renderTable(): void {
		lastFiltered = filteredRecords();
		const pageCount = Math.max(1, Math.ceil(lastFiltered.length / PAGE_SIZE));
		page = Math.min(Math.max(page, 0), pageCount - 1);
		renderHead();
		tbody.empty();

		if (lastFiltered.length === 0) {
			const row = tbody.createEl('tr');
			const cell = row.createEl('td', {
				cls: 'dashboard-expense-ledger-empty',
				attr: { colspan: String(COLUMNS.length + 2) },
			});
			cell.setText(t(service.getRecords().length === 0 ? 'expense.ledger.emptyAll' : 'expense.ledger.emptyFiltered'));
			renderFooter(pageCount);
			syncActionButtons();
			return;
		}

		for (const r of pageSlice()) {
			const row = tbody.createEl('tr');
			if (selected.has(r.id)) row.addClass('dashboard-expense-ledger-row--selected');

			const checkCell = row.createEl('td', { cls: 'dashboard-expense-ledger-td-check' });
			const check = checkCell.createEl('input', { attr: { type: 'checkbox' } });
			check.addClass('dashboard-expense-ledger-check');
			check.checked = selected.has(r.id);
			check.setAttribute('aria-label', t('expense.ledger.selectRow'));
			check.addEventListener('change', () => {
				if (check.checked) selected.add(r.id);
				else selected.delete(r.id);
				renderTable();
			});

			row.createEl('td', { cls: 'dashboard-expense-ledger-td-date', text: r.date });
			row.createEl('td', {
				cls: 'dashboard-expense-ledger-td-amount'
					+ (r.type === 'income' ? ' dashboard-expense-records-amount--income' : ''),
				text: `${r.type === 'income' ? '+' : ''}${fmt(r.amount)}`,
			});

			const typeCell = row.createEl('td', {
				cls: `dashboard-expense-ledger-td-type dashboard-expense-records-type--${r.type}`,
			});
			const typeIcon = typeCell.createDiv({ cls: 'dashboard-expense-ledger-type-icon' });
			setIcon(typeIcon, r.type === 'expense' ? 'arrow-down-right' : 'arrow-up-right');
			typeCell.createSpan({ text: t(r.type === 'expense' ? 'expense.typeExpense' : 'expense.typeIncome') });

			row.createEl('td', { cls: 'dashboard-expense-ledger-td-category', text: categoryLabel(r.category) });
			const noteCell = row.createEl('td', { cls: 'dashboard-expense-ledger-td-note' });
			if (r.note) {
				noteCell.setText(r.note);
				noteCell.title = r.note;
			}
			const actions = row.createEl('td', { cls: 'dashboard-expense-ledger-td-actions' });
			const edit = actions.createDiv({
				cls: 'dashboard-expense-ledger-action',
				attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.ledger.editRecord') },
			});
			setIcon(edit, 'pencil');
			edit.addEventListener('click', (e) => {
				e.stopPropagation();
				openEditor(r);
			});
			const del = actions.createDiv({
				cls: 'dashboard-expense-ledger-action',
				attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.deleteRecord') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', (e) => {
				e.stopPropagation();
				// No confirm for a single row (same rule as the stats list);
				// batch delete below carries the confirm.
				if (service.deleteRecord(r.id)) new Notice(t('expense.recordDeleted'));
			});
		}

		renderFooter(pageCount);
		syncActionButtons();
	}

	// ===== Footer (totals + pagination) =====
	const footer = modal.createDiv({ cls: 'dashboard-expense-ledger-footer' });
	const footerInfo = footer.createDiv({ cls: 'dashboard-expense-ledger-footer-info' });
	const pager = footer.createDiv({ cls: 'dashboard-expense-ledger-pager' });
	const prevBtn = pager.createDiv({
		cls: 'dashboard-expense-year-nav-btn dashboard-expense-ledger-pager-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.ledger.prevPage') },
	});
	setIcon(prevBtn, 'chevron-left');
	const pageLabel = pager.createDiv({ cls: 'dashboard-expense-ledger-pager-label' });
	const nextBtn = pager.createDiv({
		cls: 'dashboard-expense-year-nav-btn dashboard-expense-ledger-pager-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.ledger.nextPage') },
	});
	setIcon(nextBtn, 'chevron-right');
	prevBtn.addEventListener('click', () => {
		page = Math.max(0, page - 1);
		renderTable();
		tableWrap.scrollTop = 0;
	});
	nextBtn.addEventListener('click', () => {
		page = Math.min(Math.ceil(lastFiltered.length / PAGE_SIZE) - 1, page + 1);
		renderTable();
		tableWrap.scrollTop = 0;
	});

	function renderFooter(pageCount: number): void {
		let expense = 0;
		let income = 0;
		for (const r of lastFiltered) {
			if (r.type === 'expense') expense += r.amount;
			else income += r.amount;
		}
		footerInfo.setText(t('expense.ledger.footerTotals', {
			n: lastFiltered.length,
			e: fmt(expense),
			i: fmt(income),
		}));
		pageLabel.setText(t('expense.ledger.page', { p: page + 1, total: pageCount }));
		prevBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', page <= 0);
		nextBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', page >= pageCount - 1);
	}

	function syncActionButtons(): void {
		const n = selected.size;
		batchDeleteBtn.textContent = t('expense.ledger.deleteSelected', { n });
		batchDeleteBtn.toggleClass('dashboard-expense-ledger-btn--disabled', n === 0);
		batchDeleteBtn.disabled = n === 0;
		exportBtn.disabled = lastFiltered.length === 0;
	}

	// ===== Row actions =====

	function openEditor(record: ExpenseRecord): void {
		new ExpenseBackfillModal(service.getApp(), (input) => {
			const updated = service.updateRecord(record.id, input);
			if (!updated) new Notice(t('expense.invalidAmount'));
		}, { initial: record, aboveOverlay: true }).open();
	}

	async function deleteSelected(): Promise<void> {
		const ids = [...selected];
		if (ids.length === 0) return;
		const yes = await showConfirmDialog(null, {
			title: t('expense.ledger.batchDeleteTitle'),
			message: t('expense.ledger.batchDeleteMessage', { n: ids.length }),
		});
		if (!yes) return;
		const n = service.deleteRecords(ids);
		selected.clear();
		if (n > 0) new Notice(t('expense.ledger.recordsDeleted', { n }));
	}

	// ===== CSV import / export =====

	/** Column aliases accepted in a header row (canonical export plus common
	 *  Chinese headers). */
	const HEADER_ALIASES: Record<string, readonly string[]> = {
		date: ['date', 'day', '日期', '记账日期'],
		type: ['type', 'direction', '类型', '收支'],
		category: ['category', '分类', '类别', '类目'],
		amount: ['amount', '金额', '支出金额'],
		note: ['note', '备注', 'memo', '摘要'],
	};

	function normalizeImportDate(raw: string): string {
		const cleaned = raw.trim().replace(/[/.]/g, '-');
		const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
		if (!match) return '';
		const [, y = '', m = '', d = ''] = match;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}

	function normalizeImportType(raw: string): ExpenseType | null {
		const value = raw.trim().toLowerCase();
		if (['expense', '支出', '花费', '开销'].includes(value)) return 'expense';
		if (['income', '收入', '所得'].includes(value)) return 'income';
		return null;
	}

	/** Resolve a CSV category cell to a record key: exact custom name, preset
	 *  key, or current-locale preset label (case-insensitive); an unknown
	 *  name registers itself as a custom category of that direction. */
	function resolveImportCategory(raw: string, type: ExpenseType): string {
		const name = raw.trim();
		if (name.length === 0) return 'other';
		const known = service.getCategories(type);
		const lower = name.toLowerCase();
		const direct = known.find(k => k === name || k.toLowerCase() === lower);
		if (direct) return direct;
		const byLabel = known.find(k => categoryLabel(k).toLowerCase() === lower);
		if (byLabel) return byLabel;
		const added = service.addCustomCategory(type, name);
		return added.ok ? added.name : 'other';
	}

	function importCsvText(text: string): void {
		const rows = parseCsv(text);
		if (rows.length === 0) {
			new Notice(t('expense.ledger.importFailed'));
			return;
		}
		// Header row: first cell matching any date alias.
		let index = 0;
		const first = rows[0]!.map(c => c.trim().toLowerCase());
		const colOf = (field: string): number =>
			first.findIndex(cell => HEADER_ALIASES[field]!.includes(cell));
		if (colOf('date') !== -1) index = 1;
		const iDate = colOf('date') === -1 ? 0 : colOf('date');
		const iType = colOf('type') === -1 ? 1 : colOf('type');
		const iCategory = colOf('category') === -1 ? 2 : colOf('category');
		const iAmount = colOf('amount') === -1 ? 3 : colOf('amount');
		const iNote = colOf('note') === -1 ? 4 : colOf('note');

		const entries: Array<{ type: ExpenseType; amount: number; category: string; note?: string; date: string }> = [];
		for (const row of rows.slice(index)) {
			const cell = (i: number): string => (row[i] ?? '').trim();
			const type = normalizeImportType(cell(iType));
			const date = normalizeImportDate(cell(iDate));
			const amount = Number(cell(iAmount).replace(/[^0-9.-]/g, ''));
			if (type === null || date.length === 0) continue;
			const note = cell(iNote).slice(0, 50);
			entries.push({
				type,
				amount,
				category: resolveImportCategory(cell(iCategory), type),
				...(note ? { note } : {}),
				date,
			});
		}
		if (entries.length === 0) {
			new Notice(t('expense.ledger.importFailed'));
			return;
		}
		const { added, skipped } = service.importRows(entries);
		new Notice(t('expense.ledger.imported', { n: added })
			+ (skipped > 0 ? t('expense.ledger.importSkipped', { n: skipped }) : ''));
	}

	async function exportCsv(): Promise<void> {
		if (lastFiltered.length === 0) return;
		const lines = [
			[...CSV_HEADER],
			...lastFiltered.map(r => [r.date, r.type, categoryLabel(r.category), formatExpenseAmount(r.amount), r.note ?? '']),
		];
		// BOM so Excel detects UTF-8 (parseCsv strips it on the way back in).
		const path = `expense-export-${expenseToday()}.csv`;
		try {
			await service.writeVaultFile(path, '\uFEFF' + serializeCsv(lines));
			new Notice(t('expense.ledger.exported', { n: lastFiltered.length, path }));
		} catch {
			new Notice(t('expense.ledger.exportFailed'));
		}
	}

	// ===== Live updates =====
	const unsubscribe = service.subscribe(() => {
		if (!overlay.isConnected) {
			unsubscribe();
			return;
		}
		if (closed) return;
		const alive = new Set(service.getRecords().map(r => r.id));
		for (const id of [...selected]) {
			if (!alive.has(id)) selected.delete(id);
		}
		rebuildCategoryFilter();
		renderTable();
	});

	renderTable();
}
