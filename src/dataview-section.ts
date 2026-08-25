import { App, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn, DataviewConfig, TrackerDataPoint } from './types';
import type { DqlLink, DqlValue, QueryResult, ResultRow } from './dql/types';
import { getLanguage, t } from './i18n';
import { attachNoteHover } from './hover-preview';
import { toggleTaskInFile } from './alltasks-scan';
import { buildPages, invalidatePath } from './dql/page-builder';
import { executeDql } from './dql';
import { coerceNumber, dqlCompare, formatDate, formatValue, kindOf } from './dql/values';
import { normalizeExcludeFolders, isUnderExcludedFolder } from './exclude-folders';

// Module-level singletons mirroring library-section.ts:13-14 — set once per
// render so the inner renderers can route opens + hover previews without
// threading callbacks through every signature.
let dvHoverParent: HoverParent | null = null;
let dvOpener: ((file: TFile, subpath?: string) => void) | null = null;

const MAX_ROWS = 500; // hard cap to keep the DOM finite on pathological queries.
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const HEATMAP_CELL_GAP = 3;
const HEATMAP_MIN_CELL = 10;
const HEATMAP_MAX_CELL = 20;

/**
 * Render a Dataview (DQL) section. Builds the query once on open, then on each
 * manual refresh (the refresh button re-runs the closure). Manual refresh only
 * — deliberately NOT wired into the vault-change debounce (per design).
 */
export function renderDataviewSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	hoverParent: HoverParent | null,
	onOpenNote: ((file: TFile, subpath?: string) => void) | null,
	reloadRegister: (fn: () => void) => void,
	onConfigChange: ((config: DataviewConfig) => void) | null = null,
): void {
	dvHoverParent = hoverParent;
	dvOpener = onOpenNote;

	const config = column.dataviewConfig ?? { query: '' };
	const content = el.createDiv({ cls: 'dashboard-dataview-content' });
	let hasRun = false;

	const render = async (): Promise<void> => {
		content.empty();
		hasRun = true;

		if (config.query.trim().length === 0) {
			renderEmptyState(content, 'dataview.emptyQuery', true);
			return;
		}

		// Scanning placeholder: replaced (not appended to) once the query finishes.
		renderScanningState(content);

		try {
			const pages = await buildPages(app);
			// Excluded folders: drop their pages before the query runs, so FROM /
			// WHERE / GROUP BY never see them.
			const excluded = normalizeExcludeFolders(config.excludeFolders ?? []);
			const visiblePages = excluded.length > 0
				? pages.filter(p => !isUnderExcludedFolder(p.file.path, excluded))
				: pages;
			const outcome = executeDql(config.query, visiblePages);
			// Drop the spinner before rendering the outcome — every render* below
			// appends into `content`, so without this reset it would spin forever.
			content.empty();
			if (!outcome.ok) {
				renderErrorState(content, outcome.error.message);
				return;
			}
			if (outcome.empty) {
				renderEmptyState(content, 'dataview.emptyQuery', true);
				return;
			}
			renderResult(content, outcome.result, app, () => { void render(); }, config, onConfigChange);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			content.empty();
			renderErrorState(content, message);
		}
	};

	reloadRegister(() => { void render(); });
	if (Platform.isMobile) {
		renderEmptyState(content, 'dataview.mobileManualRun', 'dataview.mobileManualRunHint');
	} else if (!hasRun) {
		void render();
	}
}

/* ----------------------------- states ----------------------------- */

function renderEmptyState(container: HTMLElement, key: string, hint: boolean | string = false): void {
	const wrap = container.createDiv({ cls: 'dashboard-dataview-empty' });
	wrap.createDiv({ cls: 'dashboard-dataview-empty-icon' });
	wrap.createDiv({ cls: 'dashboard-dataview-empty-text', text: t(key) });
	if (hint) {
		wrap.createDiv({ cls: 'dashboard-dataview-empty-hint', text: t(typeof hint === 'string' ? hint : 'dataview.configureHint') });
	}
}

function renderScanningState(container: HTMLElement): void {
	const wrap = container.createDiv({ cls: 'dashboard-dataview-scanning' });
	const spinner = wrap.createDiv({ cls: 'dashboard-dataview-spinner' });
	setIcon(spinner, 'loader-circle');
	wrap.createSpan({ text: t('dataview.scanning') });
}

function renderErrorState(container: HTMLElement, message: string): void {
	const wrap = container.createDiv({ cls: 'dashboard-dataview-error' });
	const icon = wrap.createDiv({ cls: 'dashboard-dataview-error-icon' });
	setIcon(icon, 'alert-triangle');
	wrap.createDiv({ cls: 'dashboard-dataview-error-text', text: t('dataview.parseError', { message }) });
}

/* ----------------------------- result dispatch ----------------------------- */

/** Paginated types get the toolbar (filter + page size + view mode) + scrolling
 *  body + footer pagination; the aggregate views (CALENDAR/HEATMAP) are always
 *  one screenful, so they keep the simple count header and just scroll. */
const PAGINATED_TYPES = new Set<QueryResult['queryType']>(['TABLE', 'LIST', 'TASK']);

/** Client-side view state for one rendered result. Not persisted — a refresh
 *  re-runs the query and resets it (same as re-opening a database tool). */
interface ViewState {
	filter: string;
	/** Column index + direction for TABLE header sort; null = query order. */
	sortCol: number | null;
	sortDir: 'asc' | 'desc';
}

/** Normalized column model for paginated rendering: whatever the query shape
 *  (TABLE/LIST/TASK), rows are described as value columns plus optional
 *  source-note columns appended for provenance. Shared by both view modes. */
interface DisplayColumns {
	/** Header labels for the value columns (projection, no source). */
	valueColumns: string[];
	/** True when the query has an implicit leading file-link column (TABLE
	 *  without WITHOUT ID) that should merge with the source "Note" column. */
	hasImplicitFileCol: boolean;
}

/** Derive the normalized column model from the query result. */
function displayColumns(result: QueryResult): DisplayColumns {
	if (result.queryType === 'TABLE') {
		const valueColumns = result.columns.map(c => c.alias);
		const hasImplicitFileCol = !valueColumns.includes('file') ? false
			: result.columns[0]?.alias === 'file';
		return { valueColumns, hasImplicitFileCol };
	}
	if (result.queryType === 'LIST') {
		// LIST with no projection: the evaluator's values[0] IS the file link,
		// so it doubles as the implicit note column. LIST with a projection:
		// values[0] is the projected value — label the value column with the
		// query's own alias/expression label (auto-adapts, like TABLE).
		const nonFile = result.columns.filter(c => c.alias !== 'file');
		if (nonFile.length === 0) {
			return { valueColumns: ['file'], hasImplicitFileCol: true };
		}
		return { valueColumns: nonFile.map(c => c.alias), hasImplicitFileCol: false };
	}
	// TASK: values[0] is the task text — the note column is always synthesized.
	return {
		valueColumns: [t('dataview.taskCol')],
		hasImplicitFileCol: false,
	};
}

/** Source-note metadata for one row (null for synthetic GROUP BY rows). */
interface SourceInfo {
	readonly title: string;
	readonly path: string;
	readonly created: string;
}

function sourceInfoOf(row: ResultRow): SourceInfo | null {
	const page = row.page;
	if (!page) return null;
	const path = page.file.path;
	const title = page.file.basename;
	const createdField = page.fields['file.cday'] ?? page.fields['file.ctime'];
	const created = createdField && kindOf(createdField) === 'date'
		? formatDate(createdField as import('./dql/types').DqlDate)
		: '';
	return { title, path, created };
}

/** Extract the searchable text for one row (all projected values joined;
 *  TASK rows also match against the raw task text; source info included). */
function rowSearchText(row: ResultRow): string {
	const parts = row.values.map(v => formatValue(v));
	if (row.task) parts.push(row.task.text);
	const src = sourceInfoOf(row);
	if (src) parts.push(src.title, src.path, src.created);
	return parts.join(' ').toLowerCase();
}

/** Compare rows for TABLE header sorting. nulls always sort last regardless
 *  of direction (dqlCompare puts null first; we wrap to flip that in asc too,
 *  matching the database-tool convention). */
function compareRowsForSort(a: ResultRow, b: ResultRow, col: number, dir: 'asc' | 'desc'): number {
	const va = a.values[col] ?? null;
	const vb = b.values[col] ?? null;
	const aNull = va === null || va === undefined;
	const bNull = vb === null || vb === undefined;
	if (aNull && bNull) return 0;
	if (aNull) return 1; // nulls last, both directions
	if (bNull) return -1;
	const cmp = dqlCompare(va, vb) ?? 0;
	return dir === 'asc' ? cmp : -cmp;
}

function renderResult(
	container: HTMLElement,
	result: QueryResult,
	app: App,
	rerender: () => void,
	config: DataviewConfig,
	onConfigChange: ((config: DataviewConfig) => void) | null,
): void {
	if (result.rows.length === 0) {
		renderEmptyState(container, 'dataview.empty');
		return;
	}
	const capped = result.rows.slice(0, MAX_ROWS);

	if (!PAGINATED_TYPES.has(result.queryType)) {
		const header = container.createDiv({ cls: 'dashboard-dataview-count' });
		header.createSpan({ text: t('dataview.resultCount', { count: result.rows.length }) });
		if (result.rows.length > MAX_ROWS) {
			header.createSpan({ cls: 'dashboard-dataview-capped', text: t('dataview.capped', { count: MAX_ROWS }) });
		}
		const body = container.createDiv({ cls: 'dashboard-dataview-body' });
		renderResultBody(body, result, capped, app, rerender);
		return;
	}

	/* ----- view state + the row pipeline: filter → sort → paginate ----- */
	const view: ViewState = { filter: '', sortCol: null, sortDir: 'asc' };
	const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
	let currentPage = 1;

	const applyPipeline = (): ResultRow[] => {
		let rows = capped;
		const needle = view.filter.trim().toLowerCase();
		if (needle.length > 0) rows = rows.filter(r => rowSearchText(r).includes(needle));
		if (view.sortCol !== null) {
			const col = view.sortCol;
			const dir = view.sortDir;
			rows = [...rows].sort((a, b) => compareRowsForSort(a, b, col, dir));
		}
		return rows;
	};

	/* ----- toolbar: filter | count | spacer | page-size | view toggle ----- */
	const toolbar = container.createDiv({ cls: 'dashboard-dataview-toolbar' });

	const searchInput = toolbar.createEl('input', {
		cls: 'dashboard-dataview-search',
		attr: { type: 'text', placeholder: t('dataview.filterPlaceholder'), spellcheck: 'false' },
	});
	searchInput.addEventListener('input', () => {
		view.filter = searchInput.value;
		currentPage = 1;
		drawPage();
	});

	const countEl = toolbar.createSpan({ cls: 'dashboard-dataview-count' });
	toolbar.createDiv({ cls: 'dashboard-dataview-toolbar-spacer' });

	const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
	for (const size of PAGE_SIZE_OPTIONS) {
		const opt = pageSizeSelect.createEl('option', {
			text: t('dataview.pageSize', { count: size }),
			attr: { value: String(size) },
		});
		if (size === pageSize) opt.selected = true;
	}
	pageSizeSelect.addEventListener('change', () => {
		const newSize = parseInt(pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
		if (onConfigChange) onConfigChange({ ...config, pageSize: newSize });
		// Optimistic: redraw with the new size immediately (the persisted config
		// catches up via refreshSectionInPlace without losing this state's query).
		currentPage = 1;
		drawPage(newSize);
	});

	// View-mode toggle: table / list / auto presentation (persisted preference).
	// Mirrors the library section's segmented view toggle. `config` is treated
	// read-only; the current mode is held in a local override merged on draw.
	const currentViewMode = config.viewMode ?? 'auto';
	let viewModeOverride: 'table' | 'list' | 'auto' | null = null;
	const effectiveConfig = (): DataviewConfig => viewModeOverride ? { ...config, viewMode: viewModeOverride } : config;
	const viewToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle dashboard-dataview-view-toggle' });
	const setViewMode = (mode: 'table' | 'list' | 'auto'): void => {
		viewModeOverride = mode;
		if (onConfigChange) onConfigChange({ ...config, viewMode: mode });
		viewToggle.querySelectorAll('.dashboard-library-view-btn').forEach(b => b.removeClass('active'));
		const activeBtn = viewToggle.querySelector(`[data-view="${mode}"]`);
		activeBtn?.addClass('active');
		currentPage = 1;
		drawPage();
	};
	const VIEW_MODE_ICONS: Record<'table' | 'list' | 'auto', string> = {
		table: 'table',
		list: 'list',
		auto: 'sparkles',
	};
	for (const mode of ['table', 'list', 'auto'] as const) {
		const btn = viewToggle.createDiv({
			cls: 'dashboard-library-view-btn' + (mode === currentViewMode ? ' active' : ''),
		});
		btn.dataset.view = mode;
		setIcon(btn, VIEW_MODE_ICONS[mode]);
		btn.title = mode === 'table' ? t('dataview.viewTable')
			: mode === 'list' ? t('dataview.viewList')
				: t('dataview.viewAuto');
		btn.addEventListener('click', () => setViewMode(mode));
	}

	/* ----- layout: scrolling body + footer pagination ----- */
	const paginated = container.createDiv({ cls: 'dashboard-dataview-pages' });
	const body = paginated.createDiv({ cls: 'dashboard-dataview-body' });

	const drawPage = (pageSz: number = pageSize): void => {
		const rows = applyPipeline();
		const totalPages = Math.max(1, Math.ceil(rows.length / pageSz));
		if (currentPage > totalPages) currentPage = totalPages;

		countEl.empty();
		if (view.filter.trim().length > 0) {
			countEl.createSpan({ text: t('dataview.filteredCount', { shown: rows.length, total: capped.length }) });
		} else {
			countEl.createSpan({ text: t('dataview.resultCount', { count: capped.length }) });
			if (result.rows.length > MAX_ROWS) {
				countEl.createSpan({ cls: 'dashboard-dataview-capped', text: t('dataview.capped', { count: MAX_ROWS }) });
			}
		}

		body.empty();
		const start = (currentPage - 1) * pageSz;
		const pageRows = rows.slice(start, start + pageSz);
		if (pageRows.length === 0) {
			renderEmptyState(body, 'dataview.noMatch');
		} else {
			renderResultBody(body, result, pageRows, app, rerender, view, effectiveConfig(), (nextView) => {
				view.sortCol = nextView.sortCol;
				view.sortDir = nextView.sortDir;
				currentPage = 1;
				drawPage();
			}, start);
		}

		paginated.querySelector('.dashboard-dataview-pagination')?.remove();
		const footer = paginated.createDiv({ cls: 'dashboard-dataview-pagination' });
		renderDvPagination(footer, currentPage, totalPages, (page) => {
			currentPage = page;
			drawPage();
		});
	};
	drawPage();
}

/** Render one page of rows into the scrolling body. For the paginated types
 *  the persisted viewMode decides the presentation: 'auto' renders each query
 *  type in its native Dataview shape (TABLE -> compact source-free table,
 *  LIST/TASK -> bullet list); 'table'/'list' force one layout across all query
 *  shapes - the underlying row data is the same, only the layout differs.
 *  TASK keeps its interactive checkboxes in every mode (the table mode renders
 *  them in the first cell). */
function renderResultBody(
	container: HTMLElement,
	result: QueryResult,
	rows: readonly ResultRow[],
	app: App,
	rerender: () => void,
	view?: ViewState,
	config?: DataviewConfig,
	onSortChange?: (next: ViewState) => void,
	rowOffset = 0,
): void {
	if (rows.length === 0) {
		renderEmptyState(container, 'dataview.empty');
		return;
	}
	switch (result.queryType) {
		case 'TABLE':
		case 'LIST':
		case 'TASK': {
			const mode = config?.viewMode ?? 'auto';
			if (mode === 'list') {
				renderList(container, result, rows, config, rerender);
			} else if (mode === 'auto' && result.queryType !== 'TABLE') {
				// Native LIST/TASK shape: bullet list with bold group headers.
				renderFreeList(container, result, rows, rerender);
			} else if (mode === 'auto') {
				// Native TABLE look: keep the sortable header, drop the database
				// furniture (source columns) - the query's implicit file column
				// becomes the "File" column, exactly like Dataview's own tables.
				renderTable(container, result, rows, view, { ...(config ?? { query: '' }), showSource: false }, onSortChange, rowOffset, rerender);
			} else {
				renderTable(container, result, rows, view, config, onSortChange, rowOffset, rerender);
			}
			break;
		}
		case 'CALENDAR':
			renderCalendar(container, result, rows, app);
			break;
		case 'HEATMAP':
			renderHeatmap(container, rows);
			break;
	}
}

/** Footer pagination for paginated result types. Reuses the library section's
 *  pagination CSS classes so both sections stay visually identical. */
function renderDvPagination(container: HTMLElement, currentPage: number, totalPages: number, onPageChange: (page: number) => void): void {
	if (totalPages <= 1) return;
	const nav = container.createDiv({ cls: 'dashboard-library-pagination-nav' });

	const prev = nav.createDiv({
		cls: 'dashboard-library-pagination-btn' + (currentPage <= 1 ? ' disabled' : ''),
		text: '<',
	});
	if (currentPage > 1) prev.addEventListener('click', () => onPageChange(currentPage - 1));

	const maxVisible = 5;
	let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
	const endPage = Math.min(totalPages, startPage + maxVisible - 1);
	startPage = Math.max(1, endPage - maxVisible + 1);

	if (startPage > 1) {
		const first = nav.createDiv({ cls: 'dashboard-library-pagination-page', text: '1' });
		first.addEventListener('click', () => onPageChange(1));
		if (startPage > 2) nav.createDiv({ cls: 'dashboard-library-pagination-ellipsis', text: '...' });
	}
	for (let i = startPage; i <= endPage; i++) {
		const page = nav.createDiv({
			cls: 'dashboard-library-pagination-page' + (i === currentPage ? ' active' : ''),
			text: String(i),
		});
		if (i !== currentPage) page.addEventListener('click', () => onPageChange(i));
	}
	if (endPage < totalPages) {
		if (endPage < totalPages - 1) nav.createDiv({ cls: 'dashboard-library-pagination-ellipsis', text: '...' });
		const last = nav.createDiv({ cls: 'dashboard-library-pagination-page', text: String(totalPages) });
		last.addEventListener('click', () => onPageChange(totalPages));
	}

	const next = nav.createDiv({
		cls: 'dashboard-library-pagination-btn' + (currentPage >= totalPages ? ' disabled' : ''),
		text: '>',
	});
	if (currentPage < totalPages) next.addEventListener('click', () => onPageChange(currentPage + 1));
}

/* ----------------------------- TABLE (any query shape) ----------------------------- */

/** Header sort cycle for a clicked column: new column -> asc; same column
 *  asc -> desc; same column desc -> back to query order. */
function nextSortState(current: ViewState, clickedCol: number): ViewState {
	if (current.sortCol !== clickedCol) return { ...current, sortCol: clickedCol, sortDir: 'asc' };
	if (current.sortDir === 'asc') return { ...current, sortDir: 'desc' };
	return { ...current, sortCol: null, sortDir: 'asc' };
}

/** Column layout for one render: [rownum?] [✓?] [value...] [note] [path] [created].
 *  TASK queries get a dedicated leading checkbox column so the task text and
 *  note title each keep their own column (no misalignment). When the query
 *  carries an implicit file-link column (TABLE without WITHOUT ID, bare LIST),
 *  it doubles as the source "Note" column. Value columns are sortable; the
 *  checkbox and source columns are derived and not. */
interface TableLayout {
	/** Header labels in render order (empty string = icon-only checkbox col). */
	readonly labels: string[];
	/** Header indices that are sortable, in order. */
	readonly sortableIdx: readonly number[];
	/** For each sortable header index, the row.values index it maps to. */
	readonly sortValueIdx: readonly number[];
	/** TASK queries: leading checkbox column. */
	readonly checkboxCol: boolean;
	/** Where the source "Note" cell content comes from. */
	readonly noteFrom: 'values0' | 'synth' | 'none';
	readonly showSource: boolean;
	/** Width hints per column, same length as `labels`. `undefined` = share the
	 *  remaining space; strings are CSS widths for <col>. Fixed table layout
	 *  keeps long content from squeezing other columns. */
	readonly colWidths: readonly (string | undefined)[];
}

function tableLayout(result: QueryResult, config: DataviewConfig | undefined, showRowNumbers: boolean): TableLayout {
	const dc = displayColumns(result);
	const showSource = config?.showSource !== false;
	const isTask = result.queryType === 'TASK';
	const labels: string[] = [];
	const colWidths: (string | undefined)[] = [];
	const sortableIdx: number[] = [];
	const sortValueIdx: number[] = [];
	if (showRowNumbers) { labels.push('#'); colWidths.push('34px'); }
	if (isTask) { labels.push(''); colWidths.push('30px'); } // checkbox column

	const valueLabels = dc.hasImplicitFileCol ? dc.valueColumns.slice(1) : dc.valueColumns;
	let valueIdx = dc.hasImplicitFileCol ? 1 : 0;
	valueLabels.forEach((label, i) => {
		labels.push(label);
		// First value column (the task text / primary value) caps at 30% so it
		// cannot swallow the table; other value columns share the remainder.
		colWidths.push(i === 0 ? '30%' : undefined);
		sortableIdx.push(labels.length - 1);
		sortValueIdx.push(valueIdx++);
	});

	let noteFrom: TableLayout['noteFrom'] = 'none';
	if (showSource) {
		noteFrom = dc.hasImplicitFileCol ? 'values0' : 'synth';
		labels.push(t('dataview.colFile')); colWidths.push('22%');
		labels.push(t('dataview.colPath')); colWidths.push('28%');
		labels.push(t('dataview.colCreated')); colWidths.push('96px');
	} else if (dc.hasImplicitFileCol) {
		// Source hidden, but the query's own file column still deserves a spot.
		noteFrom = 'values0';
		labels.push(dc.valueColumns[0]!); colWidths.push(undefined);
	}
	return { labels, sortableIdx, sortValueIdx, checkboxCol: isTask, noteFrom, showSource, colWidths };
}

function renderTable(
	container: HTMLElement,
	result: QueryResult,
	rows: readonly ResultRow[],
	view?: ViewState,
	config?: DataviewConfig,
	onSortChange?: (next: ViewState) => void,
	rowOffset = 0,
	rerender?: () => void,
): void {
	const table = container.createEl('table', { cls: 'dashboard-library-table dashboard-dataview-table' });
	if (config?.striped) table.addClass('is-striped');
	if (config?.density === 'compact') table.addClass('is-compact');
	const showRowNumbers = config?.rowNumbers === true;
	const layout = tableLayout(result, config, showRowNumbers);
	const dc = displayColumns(result);
	const valueStart = dc.hasImplicitFileCol ? 1 : 0;

	/* ----- fixed column widths (colgroup must precede thead) ----- */
	const colgroup = table.createEl('colgroup');
	for (const w of layout.colWidths) {
		const col = colgroup.createEl('col');
		if (w) col.style.width = w;
	}

	/* ----- header ----- */
	const thead = table.createEl('thead');
	const headRow = thead.createEl('tr');
	const sortCol = view?.sortCol ?? null;
	const sortDir = view?.sortDir ?? 'asc';
	const activeHeaderIdx = sortCol === null ? -1 : layout.sortValueIdx.indexOf(sortCol);
	for (let ci = 0; ci < layout.labels.length; ci++) {
		const th = headRow.createEl('th', { text: layout.labels[ci]! });
		const sortSlot = layout.sortableIdx.indexOf(ci);
		if (sortSlot === -1) {
			th.addClass('is-source-col');
			if (layout.checkboxCol && layout.labels[ci] === '') th.addClass('dashboard-dataview-check-head');
			if (layout.showSource && ci === layout.labels.length - 1) th.addClass('is-datetime');
			continue;
		}
		th.addClass('is-sortable');
		const active = ci === activeHeaderIdx;
		if (active) th.addClass(sortDir === 'desc' ? 'is-sorted-desc' : 'is-sorted-asc');
		const indicator = th.createSpan({ cls: 'dashboard-dataview-sort-ind' });
		setIcon(indicator, active ? (sortDir === 'desc' ? 'chevron-down' : 'chevron-up') : 'chevrons-up-down');
		const valueIdx = layout.sortValueIdx[sortSlot]!;
		th.addEventListener('click', () => {
			if (!onSortChange || !view) return;
			onSortChange(nextSortState({ ...view }, valueIdx));
		});
		th.title = active
			? (sortDir === 'asc' ? t('dataview.sortDesc') : t('dataview.sortClear'))
			: t('dataview.sortAsc');
	}

	/* ----- body: cells rendered strictly in header order ----- */
	const tbody = table.createEl('tbody');
	for (let ri = 0; ri < rows.length; ri++) {
		const row = rows[ri]!;
		const tr = tbody.createEl('tr');
		attachRowOpen(tr, row);
		if (showRowNumbers) {
			tr.createEl('td', { cls: 'dashboard-dataview-rownum', text: String(rowOffset + ri + 1) });
		}
		if (result.grouped) {
			renderGroupedRow(tr, row, result, layout);
			continue;
		}

		const src = sourceInfoOf(row);
		if (layout.checkboxCol) {
			const td = tr.createEl('td', { cls: 'dashboard-dataview-check-col' });
			if (row.task) {
				renderTaskCell(td, row.task, appRef, () => rerender?.());
			}
		}
		for (let vi = valueStart; vi < row.values.length; vi++) {
			const value = row.values[vi]!;
			const td = tr.createEl('td');
			if (value !== null && value !== undefined && kindOf(value) === 'number') td.addClass('is-numeric');
			// Inner wrapper carries the 2-line clamp; td must stay table-cell
			// (changing its display breaks the fixed table column layout).
			renderValueCell(td.createDiv({ cls: 'dashboard-dataview-cell' }), value);
		}
		if (layout.noteFrom !== 'none') {
			const noteTd = tr.createEl('td', { cls: 'dashboard-dataview-src-note' });
			if (layout.noteFrom === 'values0') {
				renderValueCell(noteTd.createDiv({ cls: 'dashboard-dataview-cell' }), row.values[0] ?? null);
			} else {
				noteTd.setText(src?.title ?? '—');
			}
		}
		if (layout.showSource) {
			const pathTd = tr.createEl('td', { cls: 'dashboard-dataview-src-path', text: src?.path ?? '—' });
			pathTd.title = src?.path ?? '';
			tr.createEl('td', { cls: 'dashboard-dataview-src-created', text: src?.created ?? '—' });
		}
	}
	container.appendChild(table);
}

/** One TASK checkbox inside a cell: toggles the source line and busts the page
 *  cache so the change is reflected on the next query run. */
function renderTaskCell(td: HTMLElement, task: NonNullable<ResultRow['task']>, app: App, onToggled: () => void): void {
	const checkbox = td.createEl('input', { cls: 'dashboard-dataview-task-checkbox', attr: { type: 'checkbox' } });
	checkbox.checked = task.checked;
	if (task.line >= 0) {
		checkbox.addEventListener('change', () => {
			void (async (): Promise<void> => {
				const next = checkbox.checked;
				checkbox.disabled = true;
				const file = app.vault.getAbstractFileByPath(task.path);
				if (file instanceof TFile) {
					const wrote = await toggleTaskInFile(app, { ...task, file, mtime: file.stat.mtime, ctime: file.stat.ctime }, next);
					if (wrote) invalidatePath(task.path);
				}
				checkbox.disabled = false;
				onToggled();
			})();
		});
	} else {
		checkbox.disabled = true; // no source line to toggle (synthetic row).
	}
}

/** For grouped TABLE rows, the first cell is the group key; the following
 *  cells list the member note names (via the implicit `rows` projection). */
function renderGroupedRow(tr: HTMLElement, row: ResultRow, result: QueryResult, layout: TableLayout): void {
	const keyCell = tr.createEl('td', { cls: 'dashboard-dataview-group-key' });
	renderValueCell(keyCell, row.groupKey ?? null);
	const memberCell = tr.createEl('td', { cls: 'dashboard-dataview-group-members-cell' });
	if (row.rows && row.rows.length > 0) {
		for (const member of row.rows) {
			const item = memberCell.createDiv({ cls: 'dashboard-dataview-group-member' });
			const linkValue = member.values[0] ?? null;
			renderValueCell(item, linkValue);
		}
	} else {
		// No nested rows pre-projected: fall back to the raw value columns.
		for (let i = 1; i < row.values.length; i++) {
			renderValueCell(memberCell, row.values[i]!);
		}
	}
	// Pad trailing cells so colspan alignment holds when sources are shown.
	for (let i = 2; i < layout.labels.length; i++) tr.createEl('td');
	void result;
}

/* ----------------------------- LIST (any query shape) ----------------------------- */

function renderList(container: HTMLElement, result: QueryResult, rows: readonly ResultRow[], config?: DataviewConfig, rerender?: () => void): void {
	const list = container.createDiv({ cls: 'dashboard-library-list dashboard-dataview-list' });
	if (config?.striped) list.addClass('is-striped');
	if (config?.density === 'compact') list.addClass('is-compact');
	const showSource = config?.showSource !== false;
	const dc = displayColumns(result);
	for (const row of rows) {
		const item = list.createDiv({ cls: 'dashboard-library-list-item dashboard-dataview-list-item' });
		attachRowOpen(item, row);

		if (result.grouped && row.groupKey !== undefined) {
			const group = item.createDiv({ cls: 'dashboard-dataview-list-group' });
			renderValueCell(group, row.groupKey);
			const members = item.createDiv({ cls: 'dashboard-dataview-list-members' });
			if (row.rows) for (const member of row.rows) {
				const m = members.createDiv({ cls: 'dashboard-dataview-list-member' });
				renderValueCell(m, member.values[0] ?? null);
			}
			continue;
		}

		const main = item.createDiv({ cls: 'dashboard-dataview-list-main' });
		if (result.queryType === 'TASK' && row.task) {
			main.addClass('dashboard-dataview-task-row');
			renderTaskCell(main, row.task, appRef, () => rerender?.());
			const label = main.createSpan({ cls: 'dashboard-dataview-task-text' + (row.task.checked ? ' is-done' : '') });
			renderDvInline(label, formatValue(row.values[0] ?? null));
		} else {
			// First projected value as the primary line. For a bare LIST (or
			// TABLE's implicit file column) values[0] IS the note link — render it
			// as the main line; otherwise start at the first projected value.
			const valueStart = dc.hasImplicitFileCol ? 1 : 0;
			renderValueCell(main, row.values[valueStart] ?? row.values[0] ?? null, true);
			// TABLE queries in list mode: append the remaining value columns,
			// separated by a muted dot.
			if (result.queryType === 'TABLE' || dc.hasImplicitFileCol) {
				for (let i = valueStart + 1; i < row.values.length; i++) {
					main.createSpan({ cls: 'dashboard-dataview-list-sep', text: '·' });
					renderValueCell(main, row.values[i]!, true);
				}
			}
		}
		if (showSource) {
			const src = sourceInfoOf(row);
			if (src) {
				item.createDiv({
					cls: 'dashboard-dataview-list-source',
					text: `${src.path} · ${src.created}`,
				});
			}
		}
	}
	container.appendChild(list);
}

/* ----------------------------- FREE (native Dataview shape) ----------------------------- */

/** Auto ("free") mode for LIST/TASK queries: the presentation Dataview itself
 *  would produce. Each row is a bullet whose main line is the note link with
 *  the projected value after an en-dash (`- [[Note]] - value`); TASK rows keep
 *  their interactive checkbox and render the full task line as inline
 *  markdown. GROUP BY rows become a bold group header with a nested bullet
 *  list beneath, mirroring Dataview's grouped LIST output. */
function renderFreeList(
	container: HTMLElement,
	result: QueryResult,
	rows: readonly ResultRow[],
	rerender?: () => void,
): void {
	const list = container.createEl('ul', { cls: 'dashboard-dataview-free-list' });
	const dc = displayColumns(result);

	const renderFreeItem = (host: HTMLElement, row: ResultRow): void => {
		const li = host.createEl('li', { cls: 'dashboard-dataview-free-item' });
		const main = li.createDiv({ cls: 'dashboard-dataview-free-main' });

		if (result.queryType === 'TASK' && row.task) {
			main.addClass('dashboard-dataview-task-row');
			renderTaskCell(main, row.task, appRef, () => rerender?.());
			const label = main.createSpan({ cls: 'dashboard-dataview-task-text' + (row.task.checked ? ' is-done' : '') });
			renderDvInline(label, row.task.text);
			return;
		}

		// Bare LIST: values[0] IS the file link - the link alone is the bullet
		// line, remaining values follow after an en-dash. LIST with a projection:
		// Dataview renders `- [[Note]] - value`, so re-attach the source link
		// unless the query explicitly asked `WITHOUT ID`.
		if (result.queryType === 'TASK') {
			// Synthetic TASK row with no payload: plain text fallback.
			renderDvInline(main, formatValue(row.values[0] ?? null));
			return;
		}
		const bareList = dc.hasImplicitFileCol;
		const withoutId = result.withoutId === true;
		if (!bareList && !withoutId) {
			const src = sourceInfoOf(row);
			if (src) renderValueCell(main, { kind: 'link', path: src.path });
		}
		if (bareList) renderValueCell(main, row.values[0] ?? null, true);
		const from = bareList ? 1 : 0;
		for (let i = from; i < row.values.length; i++) {
			// Separator only between items (a leading dash before the very first
			// value would look like a stray bullet marker).
			if (main.childElementCount > 0) main.createSpan({ cls: 'dashboard-dataview-free-sep', text: '–' });
			renderValueCell(main, row.values[i]!, true);
		}
	};

	for (const row of rows) {
		if (result.grouped && row.groupKey !== undefined) {
			const li = list.createEl('li', { cls: 'dashboard-dataview-free-group' });
			const title = li.createDiv({ cls: 'dashboard-dataview-free-group-title' });
			renderValueCell(title, row.groupKey);
			const nested = li.createEl('ul', { cls: 'dashboard-dataview-free-list is-nested' });
			if (row.rows && row.rows.length > 0) {
				for (const member of row.rows) renderFreeItem(nested, member);
			} else {
				renderFreeItem(nested, row);
			}
			continue;
		}
		renderFreeItem(list, row);
	}
	container.appendChild(list);
}


/* ----------------------------- CALENDAR ----------------------------- */

/** Render a CALENDAR query as a month grid with a dot per matching note on its
 *  resolved date. Lightweight local grid (7 columns) — reuses theme tokens. */
function renderCalendar(container: HTMLElement, result: QueryResult, rows: readonly ResultRow[], app: App): void {
	void app;
	const wrap = container.createDiv({ cls: 'dashboard-dataview-calendar' });

	// Resolve each row's date from its calendar field (default file.cday).
	const dated: Array<{ ts: number; row: ResultRow }> = [];
	for (const row of rows) {
		const ts = rowDateTs(row, result);
		if (ts !== null) dated.push({ ts, row });
	}
	if (dated.length === 0) {
		renderEmptyState(wrap, 'dataview.calendarNoDates');
		return;
	}

	// Default view = the month of the most-recent dated row.
	let cursor = monthStart(dated.reduce((a, b) => a.ts > b.ts ? a : b).ts);
	const byDay = new Map<string, ResultRow[]>();
	const reindex = (): void => {
		byDay.clear();
		for (const d of dated) {
			const key = dayKey(d.ts);
			const arr = byDay.get(key) ?? [];
			arr.push(d.row);
			byDay.set(key, arr);
		}
	};
	reindex();

	const grid = wrap.createDiv({ cls: 'dashboard-dataview-calendar-grid' });
	const draw = (): void => {
		grid.empty();
		const titleRow = grid.createDiv({ cls: 'dashboard-dataview-calendar-header' });
		const prev = titleRow.createEl('button', { cls: 'dashboard-dataview-calendar-nav' });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => { cursor = shiftMonth(cursor, -1); draw(); });
		titleRow.createDiv({ cls: 'dashboard-dataview-calendar-title', text: monthLabel(cursor) });
		const next = titleRow.createEl('button', { cls: 'dashboard-dataview-calendar-nav' });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => { cursor = shiftMonth(cursor, 1); draw(); });

		const weekdayRow = grid.createDiv({ cls: 'dashboard-dataview-calendar-weekdays' });
		for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
			weekdayRow.createDiv({ cls: 'dashboard-dataview-calendar-wd', text: wd });
		}

		const cells = grid.createDiv({ cls: 'dashboard-dataview-calendar-cells' });
		const start = new Date(cursor);
		const lead = start.getDay(); // 0=Sun
		const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
		for (let i = 0; i < lead; i++) cells.createDiv({ cls: 'dashboard-dataview-calendar-cell is-blank' });
		for (let day = 1; day <= daysInMonth; day++) {
			const ts = new Date(start.getFullYear(), start.getMonth(), day).getTime();
			const dayRows = byDay.get(dayKey(ts)) ?? [];
			const cell = cells.createDiv({ cls: 'dashboard-dataview-calendar-cell' + (dayRows.length ? ' has-dots' : '') });
			cell.createDiv({ cls: 'dashboard-dataview-calendar-day', text: String(day) });
			if (dayRows.length) {
				const dots = cell.createDiv({ cls: 'dashboard-dataview-calendar-dots' });
				for (let d = 0; d < Math.min(dayRows.length, 3); d++) {
					dots.createDiv({ cls: 'dashboard-dataview-calendar-dot' });
				}
				if (dayRows.length > 3) dots.createDiv({ cls: 'dashboard-dataview-calendar-more', text: '+' + (dayRows.length - 3) });
				// Click opens the first matching note.
				const first = dayRows[0]!;
				cell.addEventListener('click', () => {
					if (first.page?.file && dvOpener) dvOpener(first.page.file);
				});
			}
		}
	};
	draw();
	container.appendChild(wrap);
}

/** Extract the epoch ms for a calendar row. When the query named a date field
 *  (`CALENDAR <expr>`), the evaluator stored its resolved DqlDate at values[1] —
 *  prefer it (and return null if the note lacks that field, rather than silently
 *  falling back to file.cday). Only when no field was given do we walk the
 *  file.day/cday/ctime fallback chain. */
function rowDateTs(row: ResultRow, result: QueryResult): number | null {
	if (result.calendarField && row.values.length > 1) {
		const v = row.values[1];
		if (v && kindOf(v) === 'date') return (v as { ts: number }).ts;
		return null;
	}
	const page = row.page;
	if (!page) return null;
	for (const key of ['file.day', 'file.cday', 'file.ctime']) {
		const v = page.fields[key];
		if (v && kindOf(v) === 'date') return (v as { ts: number }).ts;
	}
	return null;
}

function monthStart(ts: number): number {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function shiftMonth(ts: number, delta: number): number {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
}

function dayKey(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function monthLabel(ts: number): string {
	const d = new Date(ts);
	const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	return `${names[d.getMonth()]} ${d.getFullYear()}`;
}

/* ----------------------------- HEATMAP ----------------------------- */

function renderHeatmap(container: HTMLElement, rows: readonly ResultRow[]): void {
	const totals = new Map<string, number>();
	for (const row of rows) {
		const value = coerceNumber(row.values[0] ?? null);
		const dateValue = row.values[1] ?? null;
		if (value === null || !dateValue || kindOf(dateValue) !== 'date') continue;
		const date = ymdKey((dateValue as { ts: number }).ts);
		totals.set(date, (totals.get(date) ?? 0) + value);
	}
	if (totals.size === 0) {
		renderEmptyState(container, 'dataview.heatmapNoData');
		return;
	}

	const dates = [...totals.keys()].sort();
	const latestYear = Number(dates[dates.length - 1]!.slice(0, 4));
	const year = Number.isFinite(latestYear) ? latestYear : new Date().getFullYear();
	const data = fillYearHeatmapData(totals, year);
	const validPoints = data.filter((p): p is TrackerDataPoint & { value: number } => p.value !== null);
	if (validPoints.length === 0) {
		renderEmptyState(container, 'dataview.heatmapNoData');
		return;
	}

	const values = validPoints.map(p => p.value);
	const minVal = Math.min(...values);
	const maxVal = Math.max(...values);
	const valueRange = maxVal - minVal || 1;
	const accent = dvCssVar('--db-accent') || dvCssVar('--interactive-accent') || '#6366f1';
	const body = container.createDiv({ cls: 'dashboard-heatmap-section-body dashboard-dataview-heatmap-body' });
	renderDataviewYearGrid(body, buildDataviewWeekColumns(data), minVal, valueRange, accent);
}

function fillYearHeatmapData(totals: Map<string, number>, year: number): TrackerDataPoint[] {
	const points: TrackerDataPoint[] = [];
	const cursor = new Date(year, 0, 1);
	while (cursor.getFullYear() === year) {
		const date = ymdKey(cursor.getTime());
		points.push({ date, value: totals.get(date) ?? null });
		cursor.setDate(cursor.getDate() + 1);
	}
	return points;
}

function dvCssVar(name: string): string {
	const root = activeDocument.querySelector('.apex-dashboard-root');
	const el = root instanceof HTMLElement ? root : activeDocument.body;
	return getComputedStyle(el).getPropertyValue(name).trim();
}

function buildDataviewWeekColumns(data: TrackerDataPoint[]): Array<Array<TrackerDataPoint | null>> {
	const cols: Array<Array<TrackerDataPoint | null>> = [];
	if (data.length === 0) return cols;
	const first = new Date(data[0]!.date + 'T00:00:00');
	const firstDow = first.getDay();
	const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;
	let col: Array<TrackerDataPoint | null> = [];
	for (let i = 0; i < mondayOffset; i++) col.push(null);
	for (const p of data) {
		col.push(p);
		if (col.length === 7) {
			cols.push(col);
			col = [];
		}
	}
	if (col.length > 0) cols.push(col);
	return cols;
}

function chooseDataviewCellSize(containerWidth: number, weekCount: number): number {
	if (weekCount <= 0 || containerWidth <= 0) return HEATMAP_MIN_CELL;
	const available = containerWidth - (weekCount - 1) * HEATMAP_CELL_GAP;
	const ideal = Math.floor(available / weekCount);
	return Math.max(HEATMAP_MIN_CELL, Math.min(HEATMAP_MAX_CELL, ideal));
}

function renderDataviewYearGrid(
	host: HTMLElement,
	weekCols: Array<Array<TrackerDataPoint | null>>,
	minVal: number,
	valueRange: number,
	accent: string,
): void {
	const wrap = host.createDiv({ cls: 'dashboard-heatmap-year' });
	const width = wrap.parentElement?.clientWidth ?? 800;
	const cell = chooseDataviewCellSize(width, weekCols.length);
	wrap.style.setProperty('--hm-cell', `${cell}px`);

	const monthRow = wrap.createDiv({ cls: 'dashboard-heatmap-months-top' });
	const grid = wrap.createDiv({ cls: 'dashboard-heatmap-grid' });

	const monthLabels = computeDataviewMonthLabels(weekCols);
	monthRow.style.gridTemplateColumns = `repeat(${weekCols.length}, ${cell}px)`;
	for (let i = 0; i < weekCols.length; i++) {
		const slot = monthRow.createDiv({ cls: 'dashboard-heatmap-month-label-top' });
		const label = monthLabels[i];
		if (label) slot.setText(label);
	}

	for (const col of weekCols) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const point = col[dayIdx] ?? null;
			const cellEl = grid.createDiv({ cls: 'dashboard-sidebar-heatmap-cell' });
			if (point === null || point.value === null) {
				cellEl.addClass('dashboard-sidebar-heatmap-cell--empty');
			} else {
				const intensity = valueRange > 0 ? (point.value - minVal) / valueRange : 1;
				const clamped = Math.max(0, Math.min(1, intensity));
				cellEl.style.backgroundColor = accent;
				cellEl.style.opacity = String(0.35 + clamped * 0.65);
				cellEl.style.filter = `brightness(${1 + clamped * 0.5}) saturate(1.4)`;
				cellEl.title = `${point.date}: ${point.value}`;
			}
		}
	}
}

function computeDataviewMonthLabels(weekCols: Array<Array<TrackerDataPoint | null>>): Array<string | null> {
	const labels: Array<string | null> = [];
	let lastMonth = '';
	const locale = getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
	for (const col of weekCols) {
		const firstPoint = col.find((p): p is TrackerDataPoint => p !== null);
		const monthKey = firstPoint ? firstPoint.date.slice(0, 7) : '';
		if (monthKey && monthKey !== lastMonth) {
			const d = new Date(`${monthKey}-01T00:00:00`);
			labels.push(Number.isNaN(d.getTime()) ? monthKey : d.toLocaleDateString(locale, { month: 'short' }));
			lastMonth = monthKey;
		} else {
			labels.push(null);
		}
	}
	return labels;
}

function ymdKey(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/* ----------------------------- value cell rendering ----------------------------- */

/** Render one DQL value into a cell. Strings may embed [[wikilinks]] / md links;
 *  links are rendered clickable; everything else is plain text (never innerHTML). */
function renderValueCell(container: HTMLElement, value: DqlValue, asLink = false): void {
	if (value === null || value === undefined) {
		container.createSpan({ cls: 'dashboard-dataview-null', text: '—' });
		return;
	}
	if (kindOf(value) === 'link') {
		renderLinkValue(container, value as DqlLink);
		return;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			container.createSpan({ cls: 'dashboard-dataview-null', text: '—' });
			return;
		}
		for (let i = 0; i < value.length; i++) {
			if (i > 0) container.append(', ');
			renderValueCell(container, value[i]!);
		}
		return;
	}
	const text = formatValue(value);
	// Strings render as inline markdown (links, emphasis, code, highlight) -
	// the same shape Dataview itself produces for field values.
	renderDvInline(container.createSpan({ cls: 'dashboard-dataview-text' }), text);
	void asLink;
}

/** One combined scanner for inline markdown + links, matching Dataview's value
 *  rendering: note links and external links first (so `[[a|b]]` / `[t](u)` win
 *  over emphasis), then bold/italic/code/highlight/strikethrough wraps. */
const INLINE_TOKEN_RE = /(\[\[[^\]]+?\]\]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*?\*|`[^`]+`|==[^=]+==|~~[^~]+~~)/g;

/** Render a string as inline markdown: wikilinks/external links route through
 *  the section's openers; **bold** / *italic* / `code` / ==highlight== /
 *  ~~strike~~ become semantic elements. Pure DOM construction (never
 *  innerHTML), so user-authored query output cannot inject markup. */
function renderDvInline(container: HTMLElement, text: string): void {
	const parts = text.split(INLINE_TOKEN_RE);
	for (const part of parts) {
		if (!part) continue;
		if (part.startsWith('[[') && part.endsWith(']]')) {
			renderDvLink(container, part.slice(2, -2));
			continue;
		}
		if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
			renderDvInline(container.createEl('strong'), part.slice(2, -2));
			continue;
		}
		if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
			renderDvInline(container.createEl('strong'), part.slice(2, -2));
			continue;
		}
		if (part.startsWith('==') && part.endsWith('==') && part.length > 4) {
			renderDvInline(container.createEl('mark', { cls: 'dashboard-dataview-mark' }), part.slice(2, -2));
			continue;
		}
		if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
			renderDvInline(container.createEl('s'), part.slice(2, -2));
			continue;
		}
		if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
			renderDvInline(container.createEl('em'), part.slice(1, -1));
			continue;
		}
		if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
			container.createEl('code', { cls: 'dashboard-dataview-code', text: part.slice(1, -1) });
			continue;
		}
		const ext = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
		if (ext) {
			const a = container.createEl('a', { cls: 'dashboard-dataview-extlink', text: ext[1]! });
			a.href = ext[2]!;
			a.target = '_blank';
			a.rel = 'noopener';
			continue;
		}
		container.appendText(part);
	}
}

/** Render a Link-typed value (or a parsed [[...]] target) as a clickable note link. */
function renderLinkValue(container: HTMLElement, link: DqlLink): void {
	renderDvLink(container, `${link.path}${link.display ? `|${link.display}` : ''}`);
}

/** Core note-link renderer. Resolves the path to a TFile, wires hover preview,
 *  and routes clicks through the section opener (note popover). */
function renderDvLink(container: HTMLElement, content: string): void {
	let alias: string | undefined;
	let linkPart = content;
	const pipeIdx = content.indexOf('|');
	if (pipeIdx !== -1) {
		alias = content.slice(pipeIdx + 1);
		linkPart = content.slice(0, pipeIdx);
	}
	let path = linkPart;
	let fragment: string | undefined;
	const hashIdx = linkPart.indexOf('#');
	if (hashIdx !== -1) {
		path = linkPart.slice(0, hashIdx);
		fragment = linkPart.slice(hashIdx + 1);
	}
	const noteName = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	const displayName = alias ?? (fragment ? `${noteName} > ${fragment}` : noteName);

	const file = resolveDvFile(path);
	const span = container.createSpan({ cls: 'dashboard-wikilink', text: displayName });
	if (file && dvHoverParent && !Platform.isMobile) {
		attachNoteHover(appRef, span, file, dvHoverParent, fragment ? `#${fragment}` : undefined);
	}
	span.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (file && dvOpener) dvOpener(file, fragment ? `#${fragment}` : undefined);
	});
}

// The renderer passes `app` at render time; stash it for the link helpers.
let appRef: App = null as never;
export function setDataviewApp(app: App): void { appRef = app; }

/** Resolve a vault path to a TFile, tolerating a missing .md extension. */
function resolveDvFile(path: string): TFile | null {
	const cleaned = path.replace(/\.md$/i, '');
	// Direct path lookup first.
	const direct = appRef.vault.getAbstractFileByPath(path) ?? appRef.vault.getAbstractFileByPath(cleaned + '.md');
	if (direct instanceof TFile) return direct;
	// Fall back to a basename match across markdown files (O(n) but rare).
	const files = appRef.vault.getMarkdownFiles();
	for (const f of files) {
		if (f.basename.toLowerCase() === cleaned.split('/').pop()!.toLowerCase()) return f;
	}
	return null;
}

/** Make the whole row open its source note on click (TABLE rows + LIST items). */
function attachRowOpen(el: HTMLElement, row: ResultRow): void {
	const file = row.page?.file ?? null;
	if (!file) return;
	el.addClass('is-clickable');
	if (dvHoverParent && !Platform.isMobile) {
		attachNoteHover(appRef, el, file, dvHoverParent);
	}
	el.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		// Don't hijack clicks on inner links/chips — let those resolve on their own.
		if (target.closest('a, .dashboard-wikilink, .dashboard-dataview-task-checkbox')) return;
		if (dvOpener) dvOpener(file);
	});
}

// Re-export so the view can bust the page cache after an external task toggle.
export { invalidatePath };
