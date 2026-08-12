import { App, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn, TrackerDataPoint } from './types';
import type { DqlLink, DqlValue, QueryResult, ResultRow } from './dql/types';
import { getLanguage, t } from './i18n';
import { attachNoteHover } from './hover-preview';
import { toggleTaskInFile } from './alltasks-scan';
import { buildPages, invalidatePath } from './dql/page-builder';
import { executeDql } from './dql';
import { coerceNumber, formatValue, kindOf } from './dql/values';

// Module-level singletons mirroring library-section.ts:13-14 — set once per
// render so the inner renderers can route opens + hover previews without
// threading callbacks through every signature.
let dvHoverParent: HoverParent | null = null;
let dvOpener: ((file: TFile) => void) | null = null;

const MAX_ROWS = 500; // hard cap to keep the DOM finite on pathological queries.
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
	onOpenNote: ((file: TFile) => void) | null,
	reloadRegister: (fn: () => void) => void,
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

		renderScanningState(content);

		try {
			const pages = await buildPages(app);
			const outcome = executeDql(config.query, pages);
			if (!outcome.ok) {
				renderErrorState(content, outcome.error.message);
				return;
			}
			if (outcome.empty) {
				renderEmptyState(content, 'dataview.emptyQuery', true);
				return;
			}
			renderResult(content, outcome.result, app, () => { void render(); });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
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

function renderResult(container: HTMLElement, result: QueryResult, app: App, rerender: () => void): void {
	const visible = result.rows.slice(0, MAX_ROWS);
	if (visible.length === 0) {
		renderEmptyState(container, 'dataview.empty');
		return;
	}

	const header = container.createDiv({ cls: 'dashboard-dataview-count' });
	header.createSpan({ text: t('dataview.resultCount', { count: result.rows.length }) });
	if (result.rows.length > MAX_ROWS) {
		header.createSpan({ cls: 'dashboard-dataview-capped', text: t('dataview.capped', { count: MAX_ROWS }) });
	}

	switch (result.queryType) {
		case 'TABLE':
			renderTable(container, result, visible);
			break;
		case 'LIST':
			renderList(container, result, visible);
			break;
		case 'TASK':
			renderTaskList(container, visible, app, rerender);
			break;
		case 'CALENDAR':
			renderCalendar(container, result, visible, app);
			break;
		case 'HEATMAP':
			renderHeatmap(container, visible);
			break;
	}
}

/* ----------------------------- TABLE ----------------------------- */

function renderTable(container: HTMLElement, result: QueryResult, rows: readonly ResultRow[]): void {
	const table = container.createEl('table', { cls: 'dashboard-library-table dashboard-dataview-table' });
	const thead = table.createEl('thead');
	const headRow = thead.createEl('tr');
	for (const col of result.columns) {
		headRow.createEl('th', { text: col.alias });
	}

	const tbody = table.createEl('tbody');
	for (const row of rows) {
		const tr = tbody.createEl('tr');
		attachRowOpen(tr, row);
		if (result.grouped) {
			renderGroupedRow(tr, row, result);
			continue;
		}
		for (const value of row.values) {
			const td = tr.createEl('td');
			renderValueCell(td, value);
		}
	}
	container.appendChild(table);
}

/** For grouped TABLE rows, the first cell is the group key; a second cell lists
 *  the member note names (via the implicit `rows` projection). */
function renderGroupedRow(tr: HTMLElement, row: ResultRow, result: QueryResult): void {
	const keyCell = tr.createEl('td', { cls: 'dashboard-dataview-group-key' });
	renderValueCell(keyCell, row.groupKey ?? null);
	const memberCell = tr.createEl('td');
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
	void result;
}

/* ----------------------------- LIST ----------------------------- */

function renderList(container: HTMLElement, result: QueryResult, rows: readonly ResultRow[]): void {
	const list = container.createDiv({ cls: 'dashboard-library-list dashboard-dataview-list' });
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

		const value = row.values[0] ?? null;
		renderValueCell(item, value, true);
	}
	container.appendChild(list);
}

/* ----------------------------- TASK ----------------------------- */

/** Render TASK rows as interactive checkboxes. Toggling writes the new state
 *  back to the source line (via alltasks-scan.toggleTaskInFile), busts the page
 *  cache so the change is reflected on re-render, then re-runs the query. */
function renderTaskList(container: HTMLElement, rows: readonly ResultRow[], app: App, rerender: () => void): void {
	const list = container.createDiv({ cls: 'dashboard-dataview-tasklist' });
	for (const row of rows) {
		const task = row.task;
		const item = list.createDiv({ cls: 'dashboard-dataview-task' + (task?.checked ? ' is-done' : '') });
		const checkbox = item.createEl('input', { cls: 'dashboard-dataview-task-checkbox', attr: { type: 'checkbox' } });
		checkbox.checked = task?.checked ?? false;
		const label = item.createSpan({ cls: 'dashboard-dataview-task-text' });
		const text = formatValue(row.values[0] ?? null);
		renderTextWithDvLinks(label, text);

		if (task && task.line >= 0) {
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
					rerender();
				})();
			});
		} else {
			checkbox.disabled = true; // no source line to toggle (synthetic row).
		}
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
	if (/\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)/.test(text)) {
		renderTextWithDvLinks(container, text);
		return;
	}
	container.createSpan({ text });
	void asLink;
}

/** Render a string that may contain [[wikilinks]] or markdown links, routing
 *  note links through the section's opener + hover preview. */
function renderTextWithDvLinks(container: HTMLElement, text: string): void {
	const parts = text.split(/(\[\[[^\]]+?\]\]|\[[^\]]+\]\([^)]+\))/g);
	for (const part of parts) {
		const wiki = part.match(/^\[\[([^\]]+)\]\]$/);
		if (wiki) { renderDvLink(container, wiki[1]!); continue; }
		const ext = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
		if (ext) {
			const a = container.createEl('a', { cls: 'dashboard-dataview-extlink', text: ext[1]! });
			a.href = ext[2]!;
			a.target = '_blank';
			a.rel = 'noopener';
			continue;
		}
		if (part) container.appendChild(document.createTextNode(part));
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
		attachNoteHover(appRef, span, file, dvHoverParent);
	}
	span.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (file && dvOpener) dvOpener(file);
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
