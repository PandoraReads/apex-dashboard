import { App, Notice, setIcon, TFile } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import { renderTextWithLinks } from './renderer';
import { renderPagination } from './library-section';
import {
	collectVaultTasks,
	toggleTaskInFile,
	groupTasks,
	dateBucketOf,
	DATE_BUCKET_I18N,
	PRIORITY_BUCKET_I18N,
	type VaultTask,
	type TaskGroupBy,
} from './alltasks-scan';

type Status = 'open' | 'all' | 'done';
type ViewMode = 'list' | 'kanban';

const PAGE_SIZE_OPTIONS = [20, 50, 100];

interface SectionDefaults {
	excludeFolders: string[];
	groupBy: TaskGroupBy;
	viewMode: ViewMode;
}

function readDefaults(column: DashboardColumn): SectionDefaults {
	const cfg = column.libraryConfig;
	return {
		excludeFolders: cfg?.excludeFolders ?? [],
		groupBy: cfg?.taskGroupBy ?? 'date',
		viewMode: cfg?.viewMode === 'kanban' ? 'kanban' : 'list',
	};
}

function formatDate(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function groupLabel(key: string, groupBy: TaskGroupBy): string {
	if (groupBy === 'priority') return t(`alltasks.priority${PRIORITY_BUCKET_I18N[key as keyof typeof PRIORITY_BUCKET_I18N]}`);
	if (groupBy === 'date') return t(`alltasks.bucket${DATE_BUCKET_I18N[key as keyof typeof DATE_BUCKET_I18N]}`);
	return t('alltasks.allTasks');
}

/**
 * Render the all-vault tasks section. Toolbar offers search, status filter
 * (Open/All/Done), group-by (Date/Priority/None), view (List/Kanban), sort and
 * page size. List mode groups tasks under collapsible bucket headers; Kanban
 * mode lays buckets out as columns. Toggling a checkbox writes back to the
 * source file. Persistent config (excluded folders + default group/view) comes
 * from the column's libraryConfig; toolbar selections are session-local.
 */
export async function renderAllTasksSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	_onHoverParent: HoverParent | null,
	onOpenNote?: (file: TFile) => void,
): Promise<void> {
	const defaults = readDefaults(column);

	const content = el.createDiv({ cls: 'dashboard-library-content dashboard-alltasks-content' });

	// Session-local toolbar state (initialized from persisted defaults).
	let status: Status = 'open';
	let groupBy: TaskGroupBy = defaults.groupBy;
	let viewMode: ViewMode = defaults.viewMode;
	let sortBy = 'file';
	let sortDesc = false;
	let pageSize = 50;
	let currentPage = 1;
	const collapsed = new Set<string>();

	// Toolbar
	const toolbar = content.createDiv({ cls: 'dashboard-library-toolbar' });
	const searchInput = toolbar.createEl('input', {
		cls: 'dashboard-library-search',
		attr: { type: 'text', placeholder: t('alltasks.searchPlaceholder') },
	});

	// Status filter
	const statusToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle dashboard-alltasks-status' });
	const statusOptions: { value: Status; label: string }[] = [
		{ value: 'open', label: t('alltasks.statusOpen') },
		{ value: 'all', label: t('alltasks.statusAll') },
		{ value: 'done', label: t('alltasks.statusDone') },
	];
	const buildStatusToggle = (): void => {
		statusToggle.empty();
		for (const opt of statusOptions) {
			const btn = statusToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (opt.value === status ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => { status = opt.value; currentPage = 1; buildStatusToggle(); void render(); });
		}
	};
	buildStatusToggle();

	// Group by
	const groupToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const groupOptions: { value: TaskGroupBy; label: string }[] = [
		{ value: 'date', label: t('alltasks.groupDate') },
		{ value: 'priority', label: t('alltasks.groupPriority') },
		{ value: 'none', label: t('alltasks.groupNone') },
	];
	const buildGroupToggle = (): void => {
		groupToggle.empty();
		for (const opt of groupOptions) {
			const btn = groupToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (opt.value === groupBy ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => { groupBy = opt.value; currentPage = 1; buildGroupToggle(); void render(); });
		}
	};
	buildGroupToggle();

	// View mode
	const viewToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const viewIcons: Record<ViewMode, string> = { list: 'list', kanban: 'columns' };
	const buildViewToggle = (): void => {
		viewToggle.empty();
		(['list', 'kanban'] as ViewMode[]).forEach((mode) => {
			const btn = viewToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (mode === viewMode ? ' active' : ''),
			});
			setIcon(btn, viewIcons[mode]);
			btn.addEventListener('click', () => { viewMode = mode; buildViewToggle(); void render(); });
		});
	};
	buildViewToggle();

	// Sort
	const sortSelect = toolbar.createEl('select', { cls: 'dashboard-library-sort' });
	const sortOptions = [
		{ value: 'file', label: t('alltasks.sortFile') },
		{ value: 'due', label: t('alltasks.sortDue') },
		{ value: 'priority', label: t('alltasks.sortPriority') },
		{ value: 'modified', label: t('library.sortModified') },
	];
	for (const opt of sortOptions) {
		sortSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	const sortDirBtn = toolbar.createDiv({ cls: 'dashboard-library-sort-dir' });
	const updateSortIcon = (): void => setIcon(sortDirBtn, sortDesc ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow');
	updateSortIcon();
	sortDirBtn.addEventListener('click', () => { sortDesc = !sortDesc; updateSortIcon(); currentPage = 1; void render(); });

	const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
	function sortTasks(tasks: VaultTask[]): VaultTask[] {
		const arr = [...tasks];
		arr.sort((a, b) => {
			let cmp = 0;
			if (sortBy === 'modified') cmp = a.mtime - b.mtime;
			else if (sortBy === 'due') cmp = (a.due ?? '9999').localeCompare(b.due ?? '9999');
			else if (sortBy === 'priority') cmp = (priorityRank[a.priority ?? 'none'] ?? 3) - (priorityRank[b.priority ?? 'none'] ?? 3);
			else cmp = a.path.localeCompare(b.path) || a.line - b.line;
			return sortDesc ? -cmp : cmp;
		});
		return arr;
	}

	// Page size + count
	toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
	const countEl = toolbar.createDiv({ cls: 'dashboard-library-count' });
	const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
	for (const size of PAGE_SIZE_OPTIONS) {
		const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: size }), attr: { value: String(size) } });
		if (size === pageSize) opt.selected = true;
	}
	pageSizeSelect.addEventListener('change', () => {
		pageSize = parseInt(pageSizeSelect.value) || 50;
		currentPage = 1;
		void render();
	});

	const resultArea = content.createDiv({ cls: 'dashboard-alltasks-area' });
	const paginationArea = content.createDiv({ cls: 'dashboard-library-pagination' });

	async function collectFiltered(): Promise<VaultTask[]> {
		let results = await collectVaultTasks(app, defaults.excludeFolders);
		const q = searchInput.value.trim().toLowerCase();
		if (q) {
			results = results.filter(r => r.text.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
		}
		if (status === 'open') results = results.filter(r => !r.checked);
		else if (status === 'done') results = results.filter(r => r.checked);
		return sortTasks(results);
	}

	async function render(): Promise<void> {
		resultArea.empty();
		paginationArea.empty();

		const results = await collectFiltered();
		countEl.textContent = t('alltasks.taskCount', { count: results.length });

		if (results.length === 0) {
			resultArea.createDiv({ cls: 'dashboard-library-empty', text: t('alltasks.empty') });
			return;
		}

		if (viewMode === 'kanban') {
			renderKanban(resultArea, results);
			return;
		}

		if (groupBy === 'none') {
			renderFlatList(resultArea, results);
		} else {
			renderGroupedList(resultArea, results);
		}
	}

	function renderFlatList(host: HTMLElement, tasks: VaultTask[]): void {
		const totalPages = Math.ceil(tasks.length / pageSize);
		if (currentPage > totalPages) currentPage = totalPages;
		if (currentPage < 1) currentPage = 1;
		const start = (currentPage - 1) * pageSize;
		const page = tasks.slice(start, start + pageSize);

		const list = host.createDiv({ cls: 'dashboard-alltasks-list' });
		for (const task of page) {
			list.appendChild(renderTaskRow(task, app, onOpenNote, (next) => { void onToggle(task, next); }));
		}
		if (totalPages > 1) {
			renderPagination(paginationArea, currentPage, totalPages, tasks.length, (p) => { currentPage = p; void render(); });
		}
	}

	function renderGroupedList(host: HTMLElement, tasks: VaultTask[]): void {
		const groups = groupTasks(tasks, groupBy).filter(g => g.tasks.length > 0);
		if (groups.length === 0) {
			host.createDiv({ cls: 'dashboard-library-empty', text: t('alltasks.empty') });
			return;
		}
		const stack = host.createDiv({ cls: 'dashboard-alltasks-groups' });
		for (const group of groups) {
			const isCollapsed = collapsed.has(group.key);
			const section = stack.createDiv({ cls: 'dashboard-alltasks-group' + (isCollapsed ? ' is-collapsed' : '') });
			const header = section.createDiv({ cls: 'dashboard-alltasks-group-header' });
			const chevron = header.createDiv({ cls: 'dashboard-alltasks-group-chevron' });
			setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
			header.createDiv({ cls: 'dashboard-alltasks-group-title', text: groupLabel(group.key, groupBy) });
			header.createDiv({ cls: 'dashboard-alltasks-group-count', text: String(group.tasks.length) });
			header.addEventListener('click', () => {
				if (collapsed.has(group.key)) collapsed.delete(group.key);
				else collapsed.add(group.key);
				void render();
			});
			if (!isCollapsed) {
				const list = section.createDiv({ cls: 'dashboard-alltasks-list' });
				for (const task of group.tasks) {
					list.appendChild(renderTaskRow(task, app, onOpenNote, (next) => { void onToggle(task, next); }));
				}
			}
		}
	}

	function renderKanban(host: HTMLElement, tasks: VaultTask[]): void {
		const groups = groupTasks(tasks, groupBy);
		const board = host.createDiv({ cls: 'dashboard-library-kanban dashboard-alltasks-kanban' });
		for (const group of groups) {
			const col = board.createDiv({ cls: 'dashboard-library-kanban-col' });
			col.createDiv({
				cls: 'dashboard-library-kanban-col-title',
				text: `${groupLabel(group.key, groupBy)} (${group.tasks.length})`,
			});
			if (group.tasks.length === 0) {
				col.createDiv({ cls: 'dashboard-library-kanban-card dashboard-alltasks-kanban-empty', text: '—' });
			}
			for (const task of group.tasks) {
				col.appendChild(renderTaskCard(task, app, onOpenNote, (next) => { void onToggle(task, next); }));
			}
		}
	}

	async function onToggle(task: VaultTask, nextChecked: boolean): Promise<void> {
		try {
			const wrote = await toggleTaskInFile(app, task, nextChecked);
			if (!wrote) new Notice(t('alltasks.toggleStale'));
			await render();
		} catch {
			new Notice(t('alltasks.toggleFailed'));
			await render();
		}
	}

	searchInput.addEventListener('input', () => { currentPage = 1; void render(); });
	sortSelect.addEventListener('change', () => { sortBy = sortSelect.value; currentPage = 1; void render(); });

	await render();
}

/** Render a single task row (list view): checkbox + priority badge + text + due + source chip. */
function renderTaskRow(
	task: VaultTask,
	app: App,
	onOpenNote: ((file: TFile) => void) | undefined,
	onToggle: (nextChecked: boolean) => void,
): HTMLElement {
	const row = document.createElement('div');
	row.className = 'dashboard-alltasks-row' + (task.checked ? ' is-done' : '');

	const check = row.createEl('input', { cls: 'dashboard-alltasks-check', attr: { type: 'checkbox' } });
	check.checked = task.checked;
	check.addEventListener('click', (e) => { e.preventDefault(); onToggle(!task.checked); });

	appendPriorityBadge(row, task.priority);

	const body = row.createDiv({ cls: 'dashboard-alltasks-body' });
	const textEl = body.createDiv({ cls: 'dashboard-alltasks-text' });
	renderTextWithLinks(textEl, task.text, app);

	const source = row.createDiv({ cls: 'dashboard-alltasks-source' });
	if (task.due) {
		const overdue = !task.checked && dateBucketOf(task.due) === 'overdue';
		source.createDiv({ cls: 'dashboard-alltasks-due' + (overdue ? ' is-overdue' : ''), text: task.due });
	}
	const chip = source.createDiv({ cls: 'dashboard-alltasks-chip', text: task.file.basename });
	chip.title = task.path;
	chip.setAttribute('role', 'button');
	chip.addEventListener('click', (e) => { e.stopPropagation(); onOpenNote?.(task.file); });
	source.createDiv({ cls: 'dashboard-alltasks-date', text: formatDate(task.mtime) });

	return row;
}

/** Render a compact task card (kanban view). */
function renderTaskCard(
	task: VaultTask,
	app: App,
	onOpenNote: ((file: TFile) => void) | undefined,
	onToggle: (nextChecked: boolean) => void,
): HTMLElement {
	const card = document.createElement('div');
	card.className = 'dashboard-library-kanban-card dashboard-alltasks-card' + (task.checked ? ' is-done' : '');

	const top = card.createDiv({ cls: 'dashboard-alltasks-card-top' });
	const check = top.createEl('input', { cls: 'dashboard-alltasks-check', attr: { type: 'checkbox' } });
	check.checked = task.checked;
	check.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onToggle(!task.checked); });
	appendPriorityBadge(top, task.priority);
	const openBtn = top.createDiv({ cls: 'dashboard-alltasks-card-open', attr: { 'aria-label': task.file.basename } });
	setIcon(openBtn, 'external-link');
	openBtn.addEventListener('click', (e) => { e.stopPropagation(); onOpenNote?.(task.file); });

	const title = card.createDiv({ cls: 'dashboard-library-kanban-card-title dashboard-alltasks-card-title' });
	renderTextWithLinks(title, task.text, app);

	const meta = card.createDiv({ cls: 'dashboard-library-kanban-card-date' });
	if (task.due) {
		const overdue = !task.checked && dateBucketOf(task.due) === 'overdue';
		meta.createSpan({ cls: 'dashboard-alltasks-due' + (overdue ? ' is-overdue' : ''), text: task.due });
	}
	meta.createSpan({ cls: 'dashboard-alltasks-card-source', text: task.file.basename });

	return card;
}

function appendPriorityBadge(host: HTMLElement, priority: VaultTask['priority']): void {
	if (!priority) return;
	host.createDiv({ cls: `dashboard-alltasks-prio dashboard-alltasks-prio--${priority}`, text: priority[0]!.toUpperCase() });
}
