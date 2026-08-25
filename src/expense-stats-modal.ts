import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	expenseToday,
	type ExpenseType,
	formatExpenseAmount,
	getExpenseService,
	type ExpenseService,
} from './expense-service';
import {
	categoryColor,
	EXPENSE_BAR_COLOR,
	INCOME_BAR_COLOR,
	renderExpenseDonut,
	renderExpenseLines,
	renderExpenseRanking,
	renderExpenseTrend,
	type ExpenseBar,
	type ExpenseRankRow,
	type ExpenseSlice,
} from './expense-charts';

type ExpenseRangeKey = 'week' | 'month' | 'year' | 'history';

const RANGES: Array<{ key: ExpenseRangeKey; labelKey: string }> = [
	{ key: 'week', labelKey: 'expense.rangeWeek' },
	{ key: 'month', labelKey: 'expense.rangeMonth' },
	{ key: 'year', labelKey: 'expense.rangeYear' },
	{ key: 'history', labelKey: 'expense.rangeHistory' },
];

const TYPES: Array<{ key: ExpenseType; labelKey: string }> = [
	{ key: 'expense', labelKey: 'expense.typeExpense' },
	{ key: 'income', labelKey: 'expense.typeIncome' },
];

/** Hard cap on rendered record rows (year/history ranges can hold thousands). */
const RECORDS_LIMIT = 50;

function fmtDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

/** Inclusive day count between two 'YYYY-MM-DD' strings. */
function daysInclusive(start: string, end: string): number {
	const a = new Date(start + 'T00:00:00');
	const b = new Date(end + 'T00:00:00');
	return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

interface RangeWindow {
	curStart: string;
	curEnd: string;
	prevStart: string;
	prevEnd: string;
	/** Days elapsed in the current period (clamped to today; full span for
	 *  past periods) — the daily-average denominator. */
	elapsedDays: number;
	/** Calendar year the window covers (heatmap / history label). */
	year: number;
}

/**
 * Mount point for the stats overlay. The `--db-*` theme variables live on
 * `.apex-dashboard-root[data-theme]`, so the overlay must be appended INSIDE
 * that root (not doc.body) or every var() resolves to nothing (same reason as
 * the pomodoro stats overlay).
 */
function mountOverlay(doc: Document): HTMLElement {
	const root = doc.querySelector('.apex-dashboard-root');
	const host = root ?? doc.body;
	return host.createDiv({ cls: 'dashboard-expense-stats-overlay' });
}

/**
 * Expense statistics overlay: week/month/year/history range toggle, expense/
 * income type toggle, KPI cards with period-over-period deltas, category
 * donut, paired daily/monthly trend bars, category ranking, a GitHub-style
 * year heatmap (year + history) and a deletable record list. All mutations
 * re-render through the service's subscribe fan-out; range/year/type state
 * lives in this closure so re-renders never lose it.
 */
export function showExpenseStats(doc: Document): void {
	const serviceOrNull = getExpenseService();
	if (!serviceOrNull) return;
	// Non-null alias: the nested render closures below are hoisted function
	// declarations, which TS types against the declared (nullable) type — an
	// explicit non-null binding sidesteps that entirely.
	const service: ExpenseService = serviceOrNull;

	const currency = service.getCurrency();
	const fmt = (n: number): string => `${currency}${formatExpenseAmount(n)}`;

	const overlay = mountOverlay(doc);
	const modal = overlay.createDiv({ cls: 'dashboard-expense-stats-modal dashboard-expense-stats-modal--wide' });

	let activeRange: ExpenseRangeKey = 'week';
	let activeType: ExpenseType = 'expense';
	let historyYear = new Date().getFullYear();

	let closed = false;
	function close(): void {
		closed = true;
		unsubscribe();
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') close();
	}
	doc.addEventListener('keydown', onKey);

	// ===== Header =====
	const header = modal.createDiv({ cls: 'dashboard-expense-stats-header' });
	const titleWrap = header.createDiv({ cls: 'dashboard-expense-stats-header-titlewrap' });
	titleWrap.createDiv({ cls: 'dashboard-expense-stats-header-title', text: t('expense.statsTitle') });
	const insightEl = titleWrap.createDiv({ cls: 'dashboard-expense-insight' });

	const headerRight = header.createDiv({ cls: 'dashboard-expense-stats-header-right' });

	const rangeToggle = headerRight.createDiv({ cls: 'dashboard-expense-range-toggle' });
	const rangeButtons = RANGES.map(r => rangeToggle.createDiv({
		cls: 'dashboard-expense-range-btn' + (r.key === activeRange ? ' dashboard-expense-range-btn--active' : ''),
		text: t(r.labelKey),
	}));
	rangeButtons.forEach((btn, i) => {
		btn.addEventListener('click', () => {
			activeRange = RANGES[i]!.key;
			renderAll();
		});
	});

	const yearNav = headerRight.createDiv({ cls: 'dashboard-expense-year-nav' });
	const prevYearBtn = yearNav.createDiv({
		cls: 'dashboard-expense-year-nav-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.prevYear') },
	});
	setIcon(prevYearBtn, 'chevron-left');
	const yearLabel = yearNav.createDiv({ cls: 'dashboard-expense-year-nav-label' });
	const nextYearBtn = yearNav.createDiv({
		cls: 'dashboard-expense-year-nav-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.nextYear') },
	});
	setIcon(nextYearBtn, 'chevron-right');
	const shiftYear = (delta: number): void => {
		const years = service.getAvailableYears();
		const min = years[0] ?? historyYear;
		const max = years[years.length - 1] ?? historyYear;
		historyYear = Math.min(Math.max(historyYear + delta, min), max);
		renderAll();
	};
	prevYearBtn.addEventListener('click', () => shiftYear(-1));
	nextYearBtn.addEventListener('click', () => shiftYear(1));

	const typeToggle = headerRight.createDiv({ cls: 'dashboard-expense-type-toggle' });
	const typeButtons = TYPES.map(tp => typeToggle.createDiv({
		cls: 'dashboard-expense-type-btn' + (tp.key === activeType ? ' dashboard-expense-type-btn--active' : ''),
		text: t(tp.labelKey),
	}));
	typeButtons.forEach((btn, i) => {
		btn.addEventListener('click', () => {
			activeType = TYPES[i]!.key;
			renderAll();
		});
	});

	const closeBtn = headerRight.createDiv({ cls: 'dashboard-expense-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	// ===== Body grid =====
	const body = modal.createDiv({ cls: 'dashboard-expense-stats-body' });

	/** Natural-period window for the active range (pomodoro datesForRange
	 *  convention: Monday-anchored week, calendar month/year; history = the
	 *  selected calendar year vs the previous one). */
	function currentWindow(): RangeWindow {
		const today = new Date();
		const todayStr = expenseToday();
		switch (activeRange) {
			case 'week': {
				const daysSinceMonday = (today.getDay() + 6) % 7;
				const monday = addDays(today, -daysSinceMonday);
				const sunday = addDays(monday, 6);
				const clampedEnd = fmtDate(sunday) < todayStr ? fmtDate(sunday) : todayStr;
				return {
					curStart: fmtDate(monday),
					curEnd: fmtDate(sunday),
					prevStart: fmtDate(addDays(monday, -7)),
					prevEnd: fmtDate(addDays(monday, -1)),
					elapsedDays: daysInclusive(fmtDate(monday), clampedEnd),
					year: today.getFullYear(),
				};
			}
			case 'month': {
				const first = new Date(today.getFullYear(), today.getMonth(), 1);
				const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
				return {
					curStart: fmtDate(first),
					curEnd: fmtDate(last),
					prevStart: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
					prevEnd: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)),
					elapsedDays: Math.min(today.getDate(), daysInclusive(fmtDate(first), fmtDate(last))),
					year: today.getFullYear(),
				};
			}
			case 'year': {
				const y = today.getFullYear();
				const first = new Date(y, 0, 1);
				const last = new Date(y, 11, 31);
				return {
					curStart: fmtDate(first),
					curEnd: fmtDate(last),
					prevStart: fmtDate(new Date(y - 1, 0, 1)),
					prevEnd: fmtDate(new Date(y - 1, 11, 31)),
					elapsedDays: Math.min(daysInclusive(fmtDate(first), todayStr), daysInclusive(fmtDate(first), fmtDate(last))),
					year: y,
				};
			}
			case 'history': {
				const y = historyYear;
				const first = new Date(y, 0, 1);
				const last = new Date(y, 11, 31);
				const elapsed = y < today.getFullYear()
					? daysInclusive(fmtDate(first), fmtDate(last))
					: Math.max(1, daysInclusive(fmtDate(first), todayStr));
				return {
					curStart: fmtDate(first),
					curEnd: fmtDate(last),
					prevStart: fmtDate(new Date(y - 1, 0, 1)),
					prevEnd: fmtDate(new Date(y - 1, 11, 31)),
					elapsedDays: elapsed,
					year: y,
				};
			}
		}
	}

	function insightText(win: RangeWindow): string {
		switch (activeRange) {
			case 'week':
				return `${win.curStart.slice(5).replace('-', '.')} - ${win.curEnd.slice(5).replace('-', '.')}`;
			case 'month':
				return win.curStart.slice(0, 7);
			case 'year':
			case 'history':
				return String(win.year);
		}
	}

	/** KPI card with a period-over-period delta. `invert` flips the up/down
	 *  colors: spending MORE should read red, not green. */
	function kpiCard(parent: HTMLElement, value: string, label: string, deltaPct?: number, invert = false): void {
		const card = parent.createDiv({ cls: 'dashboard-expense-stats-card' });
		const valRow = card.createDiv({ cls: 'dashboard-expense-stats-card-value-row' });
		valRow.createDiv({ cls: 'dashboard-expense-stats-card-value', text: value });
		if (deltaPct !== undefined && Number.isFinite(deltaPct)) {
			const rawUp = deltaPct >= 0;
			const up = invert ? !rawUp : rawUp;
			const delta = valRow.createDiv({
				cls: 'dashboard-expense-stats-card-delta'
					+ (up ? ' dashboard-expense-stats-card-delta--up' : ' dashboard-expense-stats-card-delta--down'),
				text: `${rawUp ? '↑' : '↓'} ${Math.abs(Math.round(deltaPct))}%`,
			});
			delta.setAttribute('title', t('pomodoro.vsPrev'));
		}
		card.createDiv({ cls: 'dashboard-expense-stats-card-label', text: label });
	}

	function renderKpis(kpiCol: HTMLElement, win: RangeWindow): void {
		const totals = service.getRangeTotals(win.curStart, win.curEnd);
		const prevTotals = service.getRangeTotals(win.prevStart, win.prevEnd);
		const deltaOf = (cur: number, prev: number): number | undefined =>
			prev > 0 ? ((cur - prev) / prev) * 100 : undefined;
		const count = service.getRecordsInRange(win.curStart, win.curEnd).length;
		const net = Math.round((totals.income - totals.expense) * 100) / 100;
		const dailyAvg = totals.expense / Math.max(1, win.elapsedDays);

		const row1 = kpiCol.createDiv({ cls: 'dashboard-expense-stats-summary' });
		kpiCard(row1, fmt(totals.expense), t('expense.kpiExpenseTotal'), deltaOf(totals.expense, prevTotals.expense), true);
		kpiCard(row1, fmt(totals.income), t('expense.kpiIncomeTotal'), deltaOf(totals.income, prevTotals.income));
		const row2 = kpiCol.createDiv({ cls: 'dashboard-expense-stats-summary' });
		kpiCard(row2, `${net < 0 ? '-' : ''}${fmt(Math.abs(net))}`, t('expense.kpiNet'));
		kpiCard(row2, fmt(dailyAvg), t('expense.kpiDailyAvg'));
		const row3 = kpiCol.createDiv({ cls: 'dashboard-expense-stats-summary' });
		kpiCard(row3, String(count), t('expense.kpiCount'));
	}

	function breakdownSlices(win: RangeWindow): ExpenseSlice[] {
		return [...service.getCategoryBreakdown(win.curStart, win.curEnd, activeType).entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([key, value]) => ({
				key,
				label: t(`expense.cat.${key}`),
				value,
				color: categoryColor(activeType, key),
			}));
	}

	/** Slot series shared by the trend bars and the comparison lines:
	 *  daily slots for week/month, monthly slots for year/history. */
	function buildBars(win: RangeWindow): ExpenseBar[] {
		const isMonthly = activeRange === 'year' || activeRange === 'history';
		if (isMonthly) {
			const expense = service.getMonthlyTotals(win.year, 'expense');
			const income = service.getMonthlyTotals(win.year, 'income');
			return expense.map((e, i) => {
				const inc = income[i]?.amount ?? 0;
				return {
					label: e.month.slice(5),
					value: e.amount,
					secondary: inc,
					tooltip: `${e.month} · ${t('expense.expenseLabel')} ${fmt(e.amount)} / ${t('expense.incomeLabel')} ${fmt(inc)}`,
				};
			});
		}
		const expense = service.getDailyTotals(win.curStart, win.curEnd, 'expense');
		const income = service.getDailyTotals(win.curStart, win.curEnd, 'income');
		return expense.map((e, i) => {
			const inc = income[i]?.amount ?? 0;
			return {
				label: e.date.slice(8),
				value: e.amount,
				secondary: inc,
				tooltip: `${e.date} · ${t('expense.expenseLabel')} ${fmt(e.amount)} / ${t('expense.incomeLabel')} ${fmt(inc)}`,
			};
		});
	}

	function renderMiddleColumn(win: RangeWindow): void {
		const midCol = body.createDiv({ cls: 'dashboard-expense-mid-col' });

		const donutSection = midCol.createDiv({ cls: 'dashboard-expense-stats-section' });
		donutSection.createDiv({ cls: 'dashboard-expense-stats-section-title', text: t('expense.categoryShare') });
		renderExpenseDonut(
			donutSection.createDiv({ cls: 'dashboard-expense-donut-container' }),
			breakdownSlices(win),
			fmt,
			t('expense.noRecords'),
		);

		const rankSection = midCol.createDiv({ cls: 'dashboard-expense-stats-section' });
		rankSection.createDiv({ cls: 'dashboard-expense-stats-section-title', text: t('expense.ranking') });
		const rows: ExpenseRankRow[] = breakdownSlices(win)
			.map(s => ({ key: s.key, label: s.label, value: s.value }));
		renderExpenseRanking(
			rankSection.createDiv({ cls: 'dashboard-expense-rank-container' }),
			rows,
			(key) => categoryColor(activeType, key),
			fmt,
			t('expense.noRecords'),
		);
	}

	function renderRightColumn(win: RangeWindow): void {
		const rightCol = body.createDiv({ cls: 'dashboard-expense-right-col' });

		const trendSection = rightCol.createDiv({ cls: 'dashboard-expense-stats-section' });
		const isMonthly = activeRange === 'year' || activeRange === 'history';
		trendSection.createDiv({
			cls: 'dashboard-expense-stats-section-title',
			text: t(isMonthly ? 'expense.trendMonthly' : 'expense.trendDaily'),
		});
		renderExpenseTrend(
			trendSection.createDiv({ cls: 'dashboard-expense-trend-container' }),
			buildBars(win),
			EXPENSE_BAR_COLOR,
			INCOME_BAR_COLOR,
			t('expense.noRecords'),
		);

		const compareSection = rightCol.createDiv({ cls: 'dashboard-expense-stats-section' });
		compareSection.createDiv({ cls: 'dashboard-expense-stats-section-title', text: t('expense.compare') });
		renderExpenseLines(
			compareSection.createDiv({ cls: 'dashboard-expense-lines-container' }),
			buildBars(win),
			EXPENSE_BAR_COLOR,
			INCOME_BAR_COLOR,
			t('expense.typeExpense'),
			t('expense.typeIncome'),
			t('expense.noRecords'),
		);
	}

	function renderRecords(parent: HTMLElement, win: RangeWindow): void {
		const recordsSection = parent.createDiv({ cls: 'dashboard-expense-stats-section' });
		const recordsHead = recordsSection.createDiv({ cls: 'dashboard-expense-stats-section-title-row' });
		recordsHead.createDiv({ cls: 'dashboard-expense-stats-section-title', text: t('expense.records') });
		const records = service.getRecordsInRange(win.curStart, win.curEnd).reverse();
		const recordsHint = recordsHead.createDiv({ cls: 'dashboard-expense-stats-section-hint' });
		if (records.length > 0) {
			recordsHint.setText(t('expense.recordsCount', { n: records.length })
				+ (records.length > RECORDS_LIMIT ? t('expense.recordsTruncated') : ''));
		}
		if (records.length === 0) {
			recordsSection.createDiv({ cls: 'dashboard-expense-donut-empty', text: t('expense.noRecords') });
			return;
		}

		const scroll = recordsSection.createDiv({ cls: 'dashboard-expense-records-scroll' });
		const table = scroll.createEl('table', { cls: 'dashboard-expense-records-table' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		for (const header of [t('expense.colType'), t('expense.colAmount'), t('expense.colCategory'), t('expense.colNote'), t('expense.colDate'), '']) {
			headRow.createEl('th', { text: header, attr: { scope: 'col' } });
		}
		const tbody = table.createEl('tbody');
		const currentYear = new Date().getFullYear();
		for (const r of records.slice(0, RECORDS_LIMIT)) {
			const row = tbody.createEl('tr');
			const type = row.createEl('td', {
				cls: 'dashboard-expense-records-type dashboard-expense-records-type--' + r.type,
			});
			const typeIcon = type.createDiv({
				attr: { 'aria-label': t(r.type === 'expense' ? 'expense.expenseLabel' : 'expense.incomeLabel') },
			});
			setIcon(typeIcon, r.type === 'expense' ? 'arrow-down-right' : 'arrow-up-right');
			row.createEl('td', {
				cls: 'dashboard-expense-records-amount'
					+ (r.type === 'income' ? ' dashboard-expense-records-amount--income' : ''),
				text: `${r.type === 'income' ? '+' : ''}${fmt(r.amount)}`,
			});
			row.createEl('td', { cls: 'dashboard-expense-records-category', text: t(`expense.cat.${r.category}`) });
			const noteCell = row.createEl('td', { cls: 'dashboard-expense-records-note' });
			if (r.note) {
				noteCell.setText(r.note);
				noteCell.title = r.note;
			}
			row.createEl('td', {
				cls: 'dashboard-expense-records-date',
				text: Number(r.date.slice(0, 4)) === currentYear ? r.date.slice(5) : r.date,
			});
			const actions = row.createEl('td', { cls: 'dashboard-expense-records-actions' });
			const del = actions.createDiv({
				cls: 'dashboard-expense-records-delete',
				attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.deleteRecord') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', (e) => {
				e.stopPropagation();
				// No confirm overlay (per design); the subscribe fan-out
				// re-renders this modal with the entry gone.
				if (service.deleteRecord(r.id)) new Notice(t('expense.recordDeleted'));
			});
		}
	}

	function renderAll(): void {
		// Header controls are built once; only their state syncs here.
		rangeButtons.forEach((btn, i) =>
			btn.toggleClass('dashboard-expense-range-btn--active', RANGES[i]!.key === activeRange));
		typeButtons.forEach((btn, i) =>
			btn.toggleClass('dashboard-expense-type-btn--active', TYPES[i]!.key === activeType));
		yearNav.toggleClass('dashboard-expense-year-nav--visible', activeRange === 'history');
		if (activeRange === 'history') {
			const years = service.getAvailableYears();
			yearLabel.setText(String(historyYear));
			prevYearBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', historyYear <= (years[0] ?? historyYear));
			nextYearBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', historyYear >= (years[years.length - 1] ?? historyYear));
		}

		const win = currentWindow();
		insightEl.setText(insightText(win));

		body.empty();
		// Left: KPI cards + record table; middle: donut + ranking; right:
		// trend bars + income-vs-expense lines.
		const leftCol = body.createDiv({ cls: 'dashboard-expense-kpi-col' });
		renderKpis(leftCol, win);
		renderRecords(leftCol, win);
		renderMiddleColumn(win);
		renderRightColumn(win);
	}

	// Live re-render on any expense data change (entry added / record deleted
	// from any view). A full view re-render can detach the overlay's host
	// root — unsubscribe then instead of holding a dead listener.
	const unsubscribe = service.subscribe(() => {
		if (!overlay.isConnected) {
			unsubscribe();
			return;
		}
		if (!closed) renderAll();
	});

	renderAll();
}
