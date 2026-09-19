import { Menu, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import {
	expenseToday,
	type ExpenseType,
	formatExpenseAmount,
	getExpenseService,
	regroupBreakdownByPrimary,
	type ExpenseService,
	UNGROUPED_PRIMARY,
} from './expense-service';
import { categoryLabel } from './expense-category-ui';
import { showExpenseLedger } from './expense-ledger-modal';
import {
	categoryColor,
	EXPENSE_BAR_COLOR,
	EXPENSE_FALLBACK_COLOR,
	INCOME_BAR_COLOR,
	renderExpenseDonut,
	renderExpenseLines,
	renderExpenseRanking,
	renderExpenseTrend,
	type ExpenseBar,
	type ExpenseRankRow,
	type ExpenseSlice,
} from './expense-charts';
import { periodLabel, periodShift, type PeriodKind, type RangeWindow, windowFor } from './expense-period';

type ExpenseRangeKey = 'week' | 'month' | 'year' | 'history';

const RANGES: Array<{ key: ExpenseRangeKey; labelKey: string }> = [
	{ key: 'week', labelKey: 'expense.rangeWeek' },
	{ key: 'month', labelKey: 'expense.rangeMonth' },
	{ key: 'year', labelKey: 'expense.rangeYear' },
	{ key: 'history', labelKey: 'expense.rangeHistory' },
];

/** Granularity sub-toggle shown inside the history range (reuses the range
 *  label words — 周/月/年 read the same in both toggles). */
const HISTORY_KINDS: Array<{ key: PeriodKind; labelKey: string }> = [
	{ key: 'week', labelKey: 'expense.rangeWeek' },
	{ key: 'month', labelKey: 'expense.rangeMonth' },
	{ key: 'year', labelKey: 'expense.rangeYear' },
];

const TYPES: Array<{ key: ExpenseType; labelKey: string }> = [
	{ key: 'expense', labelKey: 'expense.typeExpense' },
	{ key: 'income', labelKey: 'expense.typeIncome' },
];

/** Hard cap on rendered record rows (year/history ranges can hold thousands);
 *  the "view all" entry opens the full ledger for everything beyond it.
 *  Sized against the records-scroll max-height (500px ≈ 19 visible rows). */
const RECORDS_LIMIT = 50;

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
 * donut (per category or per primary group), paired daily/monthly trend
 * bars, category ranking, and a deletable record list. The history range
 * carries its own granularity sub-toggle (week/month/year) with a ‹ label ›
 * navigator for arbitrary past periods. All mutations re-render through the
 * service's subscribe fan-out; range/kind/anchor/type state lives in this
 * closure so re-renders never lose it.
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
	// History sub-dimension: which period granularity the history range shows
	// and an anchor date inside the viewed period. Switching the kind resets
	// the anchor to today; the closure keeps both across re-renders.
	let historyKind: PeriodKind = 'year';
	let historyAnchor = expenseToday();
	// Category aggregation granularity for the donut + ranking.
	let categoryLevel: 'secondary' | 'primary' = 'secondary';

	let closed = false;
	function close(): void {
		closed = true;
		unsubscribe();
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		// Escape belongs to whatever sits above us first (ledger overlay,
		// confirm/prompt cards, native modals and menus — the period dropdown)
		// — never close two layers at once.
		if (e.key === 'Escape'
			&& !doc.querySelector('.dashboard-expense-ledger-overlay, .dashboard-confirm-overlay, .modal-container, .menu')) {
			close();
		}
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

	// History granularity sub-toggle (visible only while the history range is
	// active; built once, state-synced in renderAll like the other headers).
	const subrangeToggle = headerRight.createDiv({ cls: 'dashboard-expense-subrange-toggle' });
	const kindButtons = HISTORY_KINDS.map(k => subrangeToggle.createDiv({
		cls: 'dashboard-expense-subrange-btn' + (k.key === historyKind ? ' dashboard-expense-subrange-btn--active' : ''),
		text: t(k.labelKey),
	}));
	kindButtons.forEach((btn, i) => {
		btn.addEventListener('click', () => {
			if (historyKind === HISTORY_KINDS[i]!.key) return;
			historyKind = HISTORY_KINDS[i]!.key;
			historyAnchor = expenseToday();
			renderAll();
		});
	});

	// Period navigator (year-nav class family reused): ‹ label › where the
	// label is the week's date span, the month, or the year. Clicking the
	// label opens a dropdown of every viewable period (jump instead of
	// stepping ‹ ›).
	const yearNav = headerRight.createDiv({ cls: 'dashboard-expense-year-nav' });
	const prevYearBtn = yearNav.createDiv({
		cls: 'dashboard-expense-year-nav-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.prevPeriod') },
	});
	setIcon(prevYearBtn, 'chevron-left');
	const yearLabel = yearNav.createDiv({
		cls: 'dashboard-expense-year-nav-label',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.pickPeriod'), title: t('expense.pickPeriod') },
	});
	const nextYearBtn = yearNav.createDiv({
		cls: 'dashboard-expense-year-nav-btn',
		attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.nextPeriod') },
	});
	setIcon(nextYearBtn, 'chevron-right');
	/** Earliest viewable period start: Jan 1 of the oldest year with data. */
	const minHistoryDate = (): string => {
		const years = service.getAvailableYears();
		return `${years[0] ?? new Date().getFullYear()}-01-01`;
	};
	/** Forward stops at the current period; backward at the oldest data. */
	const canShift = (delta: 1 | -1): boolean => {
		const today = expenseToday();
		const next = windowFor(historyKind, periodShift(historyKind, historyAnchor, delta), today);
		return delta > 0 ? next.curStart <= today : next.curEnd >= minHistoryDate();
	};
	const shiftPeriod = (delta: 1 | -1): void => {
		if (!canShift(delta)) return;
		historyAnchor = periodShift(historyKind, historyAnchor, delta);
		renderAll();
	};
	prevYearBtn.addEventListener('click', () => shiftPeriod(-1));
	nextYearBtn.addEventListener('click', () => shiftPeriod(1));
	/** Dropdown of every viewable period, newest first, current checked —
	 *  the same min/max bounds the ‹ › buttons enforce. Native Menu for the
	 *  theme-styled scrolling list (weeks can run into the hundreds). */
	const openPeriodMenu = (ev: MouseEvent): void => {
		const today = expenseToday();
		const floor = minHistoryDate();
		const currentStart = windowFor(historyKind, historyAnchor, today).curStart;
		const menu = new Menu();
		// Walk back period by period from the viewed one; the canShift(-1)
		// floor (period end below the oldest data year) terminates the loop.
		// The hard cap only guards a pathological clock/data combination.
		let anchor = currentStart;
		for (let i = 0; i < 2000; i++) {
			const win = windowFor(historyKind, anchor, today);
			menu.addItem(item => {
				item.setTitle(periodLabel(historyKind, win))
					.setChecked(win.curStart === currentStart)
					.onClick(() => {
						historyAnchor = win.curStart;
						renderAll();
					});
			});
			if (win.curEnd < floor) break;
			anchor = periodShift(historyKind, anchor, -1);
		}
		menu.showAtMouseEvent(ev);
	};
	yearLabel.addEventListener('click', (e) => {
		e.stopPropagation();
		openPeriodMenu(e);
	});

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

	/** Natural-period window for the active range (expense-period math):
	 *  Monday-anchored week, calendar month/year; the history range shows the
	 *  period of the selected kind containing the history anchor. */
	function currentWindow(): RangeWindow {
		const today = expenseToday();
		if (activeRange === 'history') return windowFor(historyKind, historyAnchor, today);
		return windowFor(activeRange, today, today);
	}

	function insightText(win: RangeWindow): string {
		if (activeRange === 'history') return periodLabel(historyKind, win);
		switch (activeRange) {
			case 'week':
				return `${win.curStart.slice(5).replace('-', '.')} - ${win.curEnd.slice(5).replace('-', '.')}`;
			case 'month':
				return win.curStart.slice(0, 7);
			case 'year':
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
		const net = Math.round((totals.income - totals.expense) * 100) / 100;
		const dailyAvg = totals.expense / Math.max(1, win.elapsedDays);

		const row1 = kpiCol.createDiv({ cls: 'dashboard-expense-stats-summary' });
		kpiCard(row1, fmt(totals.expense), t('expense.kpiExpenseTotal'), deltaOf(totals.expense, prevTotals.expense), true);
		kpiCard(row1, fmt(totals.income), t('expense.kpiIncomeTotal'), deltaOf(totals.income, prevTotals.income));
		const row2 = kpiCol.createDiv({ cls: 'dashboard-expense-stats-summary' });
		kpiCard(row2, `${net < 0 ? '-' : ''}${fmt(Math.abs(net))}`, t('expense.kpiNet'));
		kpiCard(row2, fmt(dailyAvg), t('expense.kpiDailyAvg'));
	}

	/** Donut/ranking slices: per-category totals, optionally regrouped up to
	 *  primary groups (unmapped categories pool into the gray ungrouped
	 *  bucket; group names are display names and never pass through t()). */
	function breakdownSlices(win: RangeWindow): ExpenseSlice[] {
		const raw = service.getCategoryBreakdown(win.curStart, win.curEnd, activeType);
		const totals = categoryLevel === 'primary'
			? regroupBreakdownByPrimary(raw, cat => service.getCategoryParent(activeType, cat))
			: raw;
		const labelOf = (key: string): string =>
			key === UNGROUPED_PRIMARY ? t('expense.cat.ungrouped')
				: categoryLevel === 'primary' ? key : categoryLabel(key);
		return [...totals.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([key, value]) => ({
				key,
				label: labelOf(key),
				value,
				color: key === UNGROUPED_PRIMARY ? EXPENSE_FALLBACK_COLOR : categoryColor(activeType, key),
			}));
	}

	/** Slot series shared by the trend bars and the comparison lines:
	 *  daily slots for week/month (any history kind except year), monthly
	 *  slots for year. */
	function buildBars(win: RangeWindow): ExpenseBar[] {
		const kind = activeRange === 'history' ? historyKind : activeRange;
		if (kind === 'year') {
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
		const donutHead = donutSection.createDiv({ cls: 'dashboard-expense-stats-section-title-row' });
		donutHead.createDiv({ cls: 'dashboard-expense-stats-section-title', text: t('expense.categoryShare') });
		// Aggregation granularity: plain categories or their primary groups
		// (drives donut + ranking together — both eat breakdownSlices).
		const levelToggle = donutHead.createDiv({ cls: 'dashboard-expense-level-toggle' });
		for (const lv of [
			{ key: 'secondary', labelKey: 'expense.levelSecondary' },
			{ key: 'primary', labelKey: 'expense.levelPrimary' },
		] as const) {
			const btn = levelToggle.createDiv({
				cls: 'dashboard-expense-level-btn' + (lv.key === categoryLevel ? ' dashboard-expense-level-btn--active' : ''),
				text: t(lv.labelKey),
			});
			btn.addEventListener('click', () => {
				if (categoryLevel === lv.key) return;
				categoryLevel = lv.key;
				renderAll();
			});
		}
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
			(key) => key === UNGROUPED_PRIMARY ? EXPENSE_FALLBACK_COLOR : categoryColor(activeType, key),
			fmt,
			t('expense.noRecords'),
		);
	}

	function renderRightColumn(win: RangeWindow): void {
		const rightCol = body.createDiv({ cls: 'dashboard-expense-right-col' });

		const trendSection = rightCol.createDiv({ cls: 'dashboard-expense-stats-section' });
		const isMonthly = (activeRange === 'history' ? historyKind : activeRange) === 'year';
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
		// Newest first: getRecordsInRange sorts ascending, reverse flips it.
		const records = service.getRecordsInRange(win.curStart, win.curEnd).reverse();
		// Full ledger entry: every record, filterable/sortable/editable.
		const viewAll = recordsHead.createDiv({
			cls: 'dashboard-expense-records-viewall',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('expense.viewAll') },
		});
		viewAll.createSpan({ text: t('expense.viewAll') });
		const viewAllIcon = viewAll.createDiv({ cls: 'dashboard-expense-records-viewall-icon' });
		setIcon(viewAllIcon, 'chevron-right');
		viewAll.addEventListener('click', (e) => {
			e.stopPropagation();
			showExpenseLedger(doc);
		});
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
			row.createEl('td', { cls: 'dashboard-expense-records-category', text: categoryLabel(r.category) });
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
		const isHistory = activeRange === 'history';
		subrangeToggle.toggleClass('dashboard-expense-subrange-toggle--visible', isHistory);
		yearNav.toggleClass('dashboard-expense-year-nav--visible', isHistory);
		if (isHistory) {
			kindButtons.forEach((btn, i) =>
				btn.toggleClass('dashboard-expense-subrange-btn--active', HISTORY_KINDS[i]!.key === historyKind));
			const win = windowFor(historyKind, historyAnchor, expenseToday());
			yearLabel.setText(periodLabel(historyKind, win));
			yearLabel.toggleClass('dashboard-expense-year-nav-label--wide', historyKind === 'week');
			prevYearBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', !canShift(-1));
			nextYearBtn.toggleClass('dashboard-expense-year-nav-btn--disabled', !canShift(1));
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
