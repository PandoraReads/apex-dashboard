import { App, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { LibraryConfig, PropertyFilter, LibraryViewMode } from './types';
import { t, getLanguage } from './i18n';
import { attachNoteHover } from './hover-preview';
import { showConfirmDialog } from './confirm-dialog';
import { normalizeExcludeFolders, isUnderExcludedFolder } from './exclude-folders';
import { KANBAN_FILE_DRAG_TYPE } from './dnd';
import { resolveCoverAsObjectUrl } from './book-service';
import { applyModalTheme } from './modal-theme';
import { GALLERY_COVER_PLACEHOLDER_DATA_URL } from './assets/gallery-cover-placeholder';

// Set once per render by renderLibrarySection so the grid/list/table/kanban
// renderers can route opens through the note popover and attach hover previews
// without threading these through every function signature. Mirrors the
// renderer.ts module-level idiom.
let libHoverParent: HoverParent | null = null;
let libOpener: ((file: TFile) => void) | null = null;

export interface LibraryFileResult {
	file: TFile;
	basename: string;
	mtime: number;
	ctime: number;
	frontmatter: Record<string, unknown>;
	preview: string;
	tags: string[];
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function extractFrontmatterProperties(app: App): Map<string, Set<string>> {
	const props = new Map<string, Set<string>>();
	props.set('tags', new Set());
	props.set('modified', new Set());
	props.set('created', new Set());
	props.set('path', new Set());

	for (const file of app.vault.getMarkdownFiles()) {
		if (file.path.startsWith('.')) continue;
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) continue;

		const fm = cache.frontmatter;
		for (const [key, value] of Object.entries(fm)) {
			if (key === 'position') continue;
			if (!props.has(key)) props.set(key, new Set());
			const set = props.get(key)!;
			if (Array.isArray(value)) {
				for (const item of value) {
					if (item != null) set.add(String(item));
				}
			} else if (value != null) {
				set.add(String(value));
			}
		}

		// Tags from frontmatter and inline
		const tagsSet = props.get('tags')!;
		if (fm.tags) {
			if (Array.isArray(fm.tags)) {
				for (const tag of fm.tags) tagsSet.add(String(tag));
			} else {
				tagsSet.add(String(fm.tags));
			}
		}
		if (cache.tags) {
			for (const tag of cache.tags) tagsSet.add(tag.tag);
		}
	}

	return props;
}

export function getAllTags(app: App): string[] {
	return [...(extractFrontmatterProperties(app).get('tags') ?? [])].sort();
}

/** Render clickable tag chips; toggling a tag calls onToggle(tag). Caller owns selection state. */
export function renderTagsSelector(
	container: HTMLElement,
	allTags: string[],
	selectedTags: string[],
	onToggle: (tag: string) => void,
): void {
	container.empty();
	if (allTags.length === 0) {
		container.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noTags') });
		return;
	}
	for (const tag of allTags) {
		const chip = container.createDiv({
			cls: 'dashboard-library-filter-chip' + (selectedTags.includes(tag) ? ' active' : ''),
			text: tag,
		});
		chip.addEventListener('click', () => onToggle(tag));
	}
}

export function queryVaultFiles(app: App, config: LibraryConfig): LibraryFileResult[] {
	const files = app.vault.getMarkdownFiles();
	const results: LibraryFileResult[] = [];

	// Folder section: restrict to files under any configured folder (recursive, OR).
	const scanFolders = (config.folders ?? [])
		.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
		.filter(f => f.length > 0);

	// Excluded folders: files inside them never reach the section (library scans
	// and folder sections alike).
	const excluded = normalizeExcludeFolders(config.excludeFolders ?? []);

	for (const file of files) {
		if (file.path.startsWith('.')) continue;
		if (isUnderExcludedFolder(file.path, excluded)) continue;

		if (scanFolders.length > 0) {
			const lp = file.path.toLowerCase();
			if (!scanFolders.some(f => lp.startsWith(f.toLowerCase() + '/'))) continue;
		}

		const cache = app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

		// Apply filters (AND logic)
		let matches = true;
		for (const filter of config.filters) {
			if (!evaluateFilter(file, fm, filter, cache)) {
				matches = false;
				break;
			}
		}
		if (!matches) continue;

		const tags: string[] = [];
		if (cache?.tags) {
			for (const tag of cache.tags) tags.push(tag.tag);
		}

		results.push({
			file,
			basename: file.basename,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			frontmatter: fm,
			preview: '',
			tags,
		});
	}

	// Sort
	sortResults(results, config.sortBy, config.sortDesc);

	return results;
}

function evaluateFilter(
	file: TFile,
	fm: Record<string, unknown>,
	filter: PropertyFilter,
	cache: ReturnType<typeof import('obsidian').App.prototype.metadataCache.getFileCache>,
): boolean {
		if (filter.values.length === 0 && !filter.dateRange) return true;

	const prop = filter.property;

	if (prop === 'tags') {
		const fileTags: string[] = [];
		if (fm.tags) {
			if (Array.isArray(fm.tags)) {
				fileTags.push(...fm.tags.map(String));
			} else {
				fileTags.push(str(fm.tags));
			}
		}
		if (cache?.tags) {
			for (const tag of cache.tags) fileTags.push(tag.tag);
		}
		return fileTags.some(tag => filter.values.includes(tag));
	}

	if (prop === 'modified' || prop === 'created') {
		const ts = prop === 'modified' ? file.stat.mtime : file.stat.ctime;
		const dateStr = new Date(ts).toISOString().slice(0, 10);
		if (filter.dateRange) {
			if (filter.dateRange.start && dateStr < filter.dateRange.start) return false;
			if (filter.dateRange.end && dateStr > filter.dateRange.end) return false;
			return true;
		}
		return filter.values.includes(dateStr);
	}

	if (prop === 'path') {
		return filter.values.some(v => file.path.toLowerCase().includes(v.toLowerCase()));
	}

	// Frontmatter property
	const value = fm[prop];
	if (value == null) return false;

	if (Array.isArray(value)) {
		return value.some(item => filter.values.includes(String(item)));
	}

	return filter.values.includes(str(value));
}

function str(v: unknown): string {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

/** Local-time YYYY-MM-DD for a timestamp. Local dates keep "last N days"
    windows and calendar-picked ranges consistent for timezone offsets where
    UTC would shift the day (e.g. late-evening edits in UTC+8). */
function localDateKey(ts: number): string {
	const d = new Date(ts);
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

async function loadPreview(app: App, file: TFile): Promise<string> {
	const cache = app.metadataCache.getFileCache(file);
	const position = cache?.frontmatter?.position as { end: { line: number } } | undefined;
	if (!position) return '';
	const startLine = position.end.line + 1;
	const raw = await app.vault.cachedRead(file);
	const lines = raw.split('\n');
	const previewLines: string[] = [];
	for (let i = startLine; i < lines.length && previewLines.length < 3; i++) {
		const line = lines[i]!.replace(/^#+\s*/, '').trim();
		if (line && !line.startsWith('---') && !line.startsWith('```')) previewLines.push(line);
	}
	return previewLines.join(' ').slice(0, 120);
}

function sortResults(results: LibraryFileResult[], sortBy: string, desc: boolean): void {
	results.sort((a, b) => {
		let cmp = 0;
		if (sortBy === 'name') {
			cmp = a.basename.localeCompare(b.basename);
		} else if (sortBy === 'modified') {
			cmp = a.mtime - b.mtime;
		} else if (sortBy === 'created') {
			cmp = a.ctime - b.ctime;
		} else {
			const aVal = a.frontmatter[sortBy];
			const bVal = b.frontmatter[sortBy];
			cmp = comparePropertyValues(aVal, bVal);
		}
		return desc ? -cmp : cmp;
	});
}

function comparePropertyValues(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	const sa = str(a);
	const sb = str(b);
	const na = Number(sa);
	const nb = Number(sb);
	if (!isNaN(na) && !isNaN(nb)) return na - nb;
	return sa.localeCompare(sb);
}

function formatDate(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) {
		const diffH = Math.floor(diffMs / (1000 * 60 * 60));
		if (diffH === 0) {
			const diffM = Math.floor(diffMs / (1000 * 60));
			return diffM <= 1 ? t('recent.justNow') : t('recent.minutesAgo', { count: diffM });
		}
		return t('recent.hoursAgo', { count: diffH });
	}
	if (diffDays < 30) return t('recent.daysAgo', { count: diffDays });
	const lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
	return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
}

// ===== Calendar Popup =====

let activeCalendarPopup: HTMLElement | null = null;

function closeCalendarPopup(): void {
	if (activeCalendarPopup) {
		activeCalendarPopup.remove();
		activeCalendarPopup = null;
	}
}

/**
 * Quick-filter date range picker: one calendar where the first click picks the
 * start date and the second the end date (earlier/later order auto-swapped;
 * completing the pair commits immediately). The bottom buttons let a lone
 * first click be saved as an open-ended range, or bail out.
 */
function showCalendarPopup(
	anchor: HTMLElement,
	initialStart: string,
	initialEnd: string,
	onSelect: (start: string, end: string) => void,
): void {
	closeCalendarPopup();

	const popup = activeDocument.body.createDiv({ cls: 'dashboard-task-reminder-popup dashboard-library-calendar-popup' });

	// Mirror the active dashboard's full --db-* token set (theme + light/dark
	// + user overrides) onto the popup — it lives on <body>, outside the root.
	applyModalTheme(popup);

	// Opaque surface: the old glass card token let the page bleed through and
	// made the dates unreadable. Prefer the dedicated modal surfaces (dark
	// themes define them); fall back to the always-opaque --db-bg and finally
	// Obsidian's own background — never a hardcoded color.
	popup.setCssProps({
		background: 'var(--db-bg-modal, var(--db-bg, var(--background-primary)))',
		color: 'var(--db-text, var(--text-normal))',
		borderColor: 'var(--db-border-card, var(--background-modifier-border))',
	});

	const rect = anchor.getBoundingClientRect();
	popup.setCssProps({
		position: 'fixed',
		top: `${rect.bottom + 4}px`,
	});
	const popupWidth = 240;
	if (rect.left + popupWidth > window.innerWidth) {
		popup.style.right = `${window.innerWidth - rect.right}px`;
	} else {
		popup.style.left = `${rect.left}px`;
	}

	let rangeStart = initialStart;
	let rangeEnd = initialEnd;
	// First click of an in-progress pair, waiting for the end-date click.
	let pendingStart: string | null = null;

	const now = new Date();
	const anchorDate = initialStart || initialEnd;
	const dp = anchorDate.split('-').map(Number);
	const viewYear = { value: dp[0] && Number.isFinite(dp[0]) ? dp[0] : now.getFullYear() };
	const viewMonth = { value: dp[1] && Number.isFinite(dp[1]) ? (dp[1] - 1) : now.getMonth() };
	const lang = getLanguage();
	const dayNames = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
	const prevBtn = calNav.createEl('button', { text: '<' });
	const monthLabel = calNav.createSpan();
	const nextBtn = calNav.createEl('button', { text: '>' });

	const calGrid = popup.createDiv({ cls: 'dashboard-task-reminder-calendar' });
	const statusLine = popup.createDiv({ cls: 'dashboard-library-calendar-status' });

	const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
	btnRow.createEl('button', { cls: 'mod-cta', text: t('common.save') });
	btnRow.createEl('button', { text: t('common.cancel') });

	const fmt = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

	const renderStatus = () => {
		if (pendingStart) statusLine.setText(`${pendingStart} ~ …`);
		else if (rangeStart || rangeEnd) statusLine.setText(`${rangeStart || '…'} ~ ${rangeEnd || '…'}`);
		else statusLine.setText(t('library.pickRangeHint'));
	};

	const renderCalendar = () => {
		calGrid.empty();
		renderStatus();
		const y = viewYear.value;
		const m = viewMonth.value;
		monthLabel.setText(`${y}-${String(m + 1).padStart(2, '0')}`);

		for (const d of dayNames) {
			calGrid.createDiv({ cls: 'dashboard-task-reminder-calendar-header', text: d });
		}

		const firstDay = new Date(y, m, 1).getDay();
		const daysInMonth = new Date(y, m + 1, 0).getDate();
		const daysInPrev = new Date(y, m, 0).getDate();
		const today = new Date();
		const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

		for (let i = firstDay - 1; i >= 0; i--) {
			const d = daysInPrev - i;
			calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
		}

		const hasRange = !!(rangeStart && rangeEnd);
		for (let d = 1; d <= daysInMonth; d++) {
			const ds = fmt(y, m, d);
			const cls = ['dashboard-task-reminder-calendar-day'];
			if (isCurrentMonth && d === today.getDate()) cls.push('dashboard-task-reminder-calendar-day--today');
			if (ds === rangeStart || ds === rangeEnd || ds === pendingStart) cls.push('dashboard-task-reminder-calendar-day--selected');
			else if (hasRange && ds > rangeStart && ds < rangeEnd) cls.push('dashboard-task-reminder-calendar-day--in-range');
			const dayBtn = calGrid.createEl('button', { cls: cls.join(' '), text: String(d) });
			dayBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (pendingStart === null) {
					pendingStart = ds;
					renderCalendar();
					return;
				}
				// Second click completes the pair; earlier/later auto-swaps and a
				// same-day double click is a single-day range.
				const s = pendingStart < ds ? pendingStart : ds;
				const en = pendingStart < ds ? ds : pendingStart;
				pendingStart = null;
				rangeStart = s;
				rangeEnd = en;
				onSelect(s, en);
				closeCalendarPopup();
			});
		}

		const totalCells = firstDay + daysInMonth;
		const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
		for (let d = 1; d <= remaining; d++) {
			calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
		}
	};

	prevBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		viewMonth.value--;
		if (viewMonth.value < 0) { viewMonth.value = 11; viewYear.value--; }
		renderCalendar();
	});

	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		viewMonth.value++;
		if (viewMonth.value > 11) { viewMonth.value = 0; viewYear.value++; }
		renderCalendar();
	});

	btnRow.querySelector('.mod-cta')!.addEventListener('click', (e) => {
		e.stopPropagation();
		// A lone first click commits as an open-ended range.
		onSelect(pendingStart ?? rangeStart, rangeEnd);
		closeCalendarPopup();
	});

	btnRow.querySelectorAll('button')[1]!.addEventListener('click', (e) => {
		e.stopPropagation();
		closeCalendarPopup();
	});

	const outsideClick = (ev: MouseEvent) => {
		if (!popup.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) {
			closeCalendarPopup();
			activeDocument.removeEventListener('mousedown', outsideClick);
		}
	};
	window.setTimeout(() => activeDocument.addEventListener('mousedown', outsideClick), 0);

	activeCalendarPopup = popup;
	renderCalendar();
}

// ===== Rendering =====

export function renderLibrarySection(
	el: HTMLElement,
	column: { name: string; color: string; sectionType?: string; libraryConfig?: LibraryConfig },
	app: App,
	onConfigChange: (config: LibraryConfig) => void,
	hoverParent: HoverParent | null = null,
	onOpenNote: ((file: TFile) => void) | null = null,
): void {
	libHoverParent = hoverParent;
	libOpener = onOpenNote;
	const config = column.libraryConfig ?? {
		filters: [] as PropertyFilter[],
		viewMode: 'grid' as LibraryViewMode,
		sortBy: 'modified',
		sortDesc: true,
	};
	const isFolder = column.sectionType === 'folder';

	const sectionContent = el.createDiv({ cls: 'dashboard-library-content' });

	// Toolbar
	const toolbar = sectionContent.createDiv({ cls: 'dashboard-library-toolbar' });

	// Search
	const searchInput = toolbar.createEl('input', {
		cls: 'dashboard-library-search',
		attr: { type: 'text', placeholder: t('library.searchPlaceholder') },
	});

	// Sort
	const sortSelect = toolbar.createEl('select', { cls: 'dashboard-library-sort' });
	const sortOptions = [
		{ value: 'modified', label: t('library.sortModified') },
		{ value: 'created', label: t('library.sortCreated') },
		{ value: 'name', label: t('library.sortName') },
	];
	for (const opt of sortOptions) {
		const option = sortSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
		if (opt.value === config.sortBy) option.selected = true;
	}

	// Sort direction toggle
	const sortDirBtn = toolbar.createDiv({ cls: 'dashboard-library-sort-dir' });
	setIcon(sortDirBtn, config.sortDesc ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow');

	// View mode toggle
	const viewToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const viewModes: LibraryViewMode[] = ['grid', 'gallery', 'list', 'table', 'kanban'];
	const viewIcons: Record<string, string> = { grid: 'layout-grid', gallery: 'image', list: 'list', table: 'table', kanban: 'columns' };

	// Card size toggle (small / medium / large) — meaningful only for the two
	// card views, so it hides while list/table/kanban is active.
	const cardViews: LibraryViewMode[] = ['grid', 'gallery'];
	const sizeToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle dashboard-library-size-toggle' });
	const sizeLabels: Record<NonNullable<LibraryConfig['cardSize']>, string> = { small: 'S', medium: 'M', large: 'L' };
	const buildSizeToggle = (): void => {
		sizeToggle.empty();
		const current = config.cardSize ?? 'medium';
		for (const s of ['small', 'medium', 'large'] as const) {
			const btn = sizeToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (s === current ? ' active' : ''),
				attr: { 'aria-label': t(`library.size${s.charAt(0).toUpperCase()}${s.slice(1)}`) },
			});
			btn.textContent = sizeLabels[s];
			btn.addEventListener('click', () => {
				const newConfig = { ...config, cardSize: s };
				onConfigChange(newConfig);
				Object.assign(config, { cardSize: s });
				buildSizeToggle();
				renderContent(config);
			});
		}
	};
	const applySizeToggleVisibility = (mode: LibraryViewMode): void => {
		sizeToggle.toggleClass('is-hidden', !cardViews.includes(mode));
	};
	buildSizeToggle();
	applySizeToggleVisibility(config.viewMode);

	for (const mode of viewModes) {
		const btn = viewToggle.createDiv({
			cls: 'dashboard-library-view-btn' + (mode === config.viewMode ? ' active' : ''),
		});
		setIcon(btn, viewIcons[mode] ?? 'file');
		btn.title = t('library.view' + mode.charAt(0).toUpperCase() + mode.slice(1));
		btn.dataset.viewMode = mode;
		btn.addEventListener('click', () => {
			viewToggle.querySelectorAll('.dashboard-library-view-btn').forEach(b => b.removeClass('active'));
			btn.addClass('active');
			const newConfig = { ...config, viewMode: mode };
			onConfigChange(newConfig);
			Object.assign(config, { viewMode: mode });
			applySizeToggleVisibility(mode);
			currentPage = 1;
			renderContent(config);
		});
	}

		// Quick date filter button
		const filterBtn = toolbar.createDiv({ cls: 'dashboard-library-filter-btn' });
		setIcon(filterBtn, 'filter');
		filterBtn.title = t('library.quickFilter');

		// Quick date filter state (separate from config.filters)
		let quickProp: 'created' | 'modified' = config.quickDateFilter?.property ?? 'created';
		let quickStart = config.quickDateFilter?.start ?? '';
		let quickEnd = config.quickDateFilter?.end ?? '';
		// Rolling "last N days" window (0 = off). Takes precedence over fixed dates.
		let quickDays = config.quickDateFilter?.days ?? 0;

		// Popup
		let filterPopup: HTMLElement | null = null;
	// Legacy funnel folders (folderFilter): the quick-filter popup no longer
	// edits them, but they still filter and the popup's clear button drops them.
	let funnelFolders: string[] = [...(config.folderFilter ?? [])];


		function applyQuickFilter(): void {
			config.quickDateFilter = (quickStart || quickEnd || quickDays > 0)
				? {
					property: quickProp,
					// A rolling window owns the range; fixed dates only apply when it is off.
					start: quickDays > 0 ? '' : quickStart,
					end: quickDays > 0 ? '' : quickEnd,
					...(quickDays > 0 ? { days: quickDays } : {}),
				}
				: undefined;
			onConfigChange({ ...config });
			currentPage = 1;
			renderContent(config);
			updateFilterBtnState();
		}

		function applyFunnelFolders(): void {
			config.folderFilter = funnelFolders.length > 0 ? [...funnelFolders] : undefined;
			onConfigChange({ ...config });
			currentPage = 1;
			renderContent(config);
			updateFilterBtnState();
		}

		function openPopup(): void {
			closePopup();
			filterPopup = activeDocument.body.createDiv({ cls: 'dashboard-library-filter-popup' });

			// Mirror the active dashboard's --db-* tokens onto the popup — it
			// lives on <body>, outside the themed root.
			applyModalTheme(filterPopup);

			// Position below the filter button
			const rect = filterBtn.getBoundingClientRect();
			filterPopup.setCssProps({
				position: 'fixed',
				top: `${rect.bottom + 4}px`,
				left: `${rect.left}px`,
				zIndex: '10000',
			});

			// Popup title
			filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-title', text: t('library.quickFilterTitle') });

			// Property selector + single date-range button in one row
			const propRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row dashboard-library-quickfilter-row--main' });
			const propSelect = propRow.createEl('select', { cls: 'dashboard-library-filter-popup-prop' });
			propSelect.createEl('option', { text: t('library.created'), attr: { value: 'created' } });
			propSelect.createEl('option', { text: t('library.modified'), attr: { value: 'modified' } });
			propSelect.value = quickProp;
			propSelect.addEventListener('change', () => {
				quickProp = propSelect.value as 'created' | 'modified';
			});
			const rangeBtn = propRow.createEl('button', {
				cls: 'dashboard-library-filter-date-btn dashboard-library-filter-range-btn' + (quickStart || quickEnd ? ' has-value' : ''),
				text: (quickStart || quickEnd) ? `${quickStart || '…'} ~ ${quickEnd || '…'}` : t('library.filterDateRange'),
			});
			rangeBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				showCalendarPopup(rangeBtn, quickStart, quickEnd, (start, end) => {
					quickStart = start;
					quickEnd = end;
					quickDays = 0; // an explicit range replaces the rolling window
					applyQuickFilter();
					if (activeDocument.body.contains(filterBtn)) openPopup();
				});
			});

			// Quick rolling-window presets: "last N days". Evaluated relative to
			// today on every render, so a preset chosen last week still means
			// "recently" instead of pointing at a stale fixed range. Clicking an
			// active preset again turns it off.
			const rangeRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			rangeRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('library.quickRange') });
			const rangeChips = rangeRow.createDiv({ cls: 'dashboard-library-filter-popup-dates' });
			for (const days of [3, 7, 30]) {
				const chip = rangeChips.createEl('button', {
					cls: 'dashboard-library-filter-date-btn' + (quickDays === days ? ' has-value' : ''),
					text: t('library.lastNDays', { n: days }),
				});
				chip.addEventListener('click', (ev) => {
					ev.stopPropagation();
					quickDays = quickDays === days ? 0 : days;
					if (quickDays > 0) {
						quickStart = '';
						quickEnd = '';
					}
					applyQuickFilter();
					if (activeDocument.body.contains(filterBtn)) openPopup();
				});
			}

			// Clear button. Also drops legacy funnel folders configured by older
			// versions (the popup no longer edits them).
			if (quickStart || quickEnd || quickDays > 0 || funnelFolders.length > 0) {
				const clearBtn = filterPopup.createEl('button', {
					cls: 'dashboard-library-filter-popup-clear',
					text: t('library.clearFilters'),
				});
				clearBtn.addEventListener('click', (ev) => {
					ev.stopPropagation();
					quickStart = '';
					quickEnd = '';
					quickDays = 0;
					funnelFolders = [];
					applyQuickFilter();
					applyFunnelFolders();
					closePopup();
				});
			}
		}

		function closePopup(): void {
			if (filterPopup) {
				filterPopup.remove();
				filterPopup = null;
			}
		}

		function updateFilterBtnState(): void {
			filterBtn.classList.toggle('active', !!(quickStart || quickEnd || quickDays > 0 || (config.folderFilter?.length ?? 0) > 0));
		}

		filterBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (filterPopup) {
				closePopup();
			} else {
				openPopup();
			}
		});

		activeDocument.addEventListener('click', (e) => {
			if (!filterPopup) return;
			const target = e.target as Node;
			if (filterPopup.contains(target) || filterBtn.contains(target)) return;
			if (target.instanceOf(Element) && target.closest('.modal-container')) return;
			closePopup();
		});

		// An active filter highlights the button (accent color); the details
		// live only inside the popup, so the toolbar stays uncluttered.
		updateFilterBtnState();


	// Spacer
	toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });

	// File count
	const countEl = toolbar.createDiv({ cls: 'dashboard-library-count' });

	// Page size selector
	const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
	const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
	for (const size of PAGE_SIZE_OPTIONS) {
		const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: size }), attr: { value: String(size) } });
		if (size === pageSize) opt.selected = true;
	}
	pageSizeSelect.addEventListener('change', () => {
		const newSize = parseInt(pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
		Object.assign(config, { pageSize: newSize });
		onConfigChange({ ...config });
		currentPage = 1;
		renderContent(config);
	});

	// Configure button
	const configBtn = toolbar.createDiv({ cls: 'dashboard-library-config-btn' });
	setIcon(configBtn, 'settings');
	configBtn.title = t('library.configure');

	// Content area
	const contentArea = sectionContent.createDiv({ cls: 'dashboard-library-files' });

	// Pagination area
	const paginationArea = sectionContent.createDiv({ cls: 'dashboard-library-pagination' });

	let currentPage = 1;

	async function deleteLibraryFileWithConfirm(file: TFile): Promise<void> {
		const confirmed = await showConfirmDialog(app, {
			title: t('common.confirmDelete'),
			message: t('library.confirmDelete', { name: file.basename }),
		});
		if (!confirmed) return;
		try {
			await trashLibraryFile(app, file);
			new Notice(t('library.deleted'));
			renderContent(config);
		} catch (err) {
			console.error('[Dashboard] library delete failed:', err);
			new Notice(t('library.deleteFailed'));
		}
	}

	function renderContent(currentConfig: LibraryConfig): void {
		contentArea.empty();
		paginationArea.empty();
		// Tag the current view so CSS can give the kanban its own (Trello-style)
		// scrolling layout without affecting grid/list/table.
		contentArea.dataset.viewMode = currentConfig.viewMode;

		let results = queryVaultFiles(app, currentConfig);

		// Apply search
		const search = searchInput.value.trim().toLowerCase();
		if (search) {
			results = results.filter(r => r.basename.toLowerCase().includes(search));
		}

			// Apply quick date filter
			if (currentConfig.quickDateFilter) {
				const qdf = currentConfig.quickDateFilter;
				// A rolling "last N days" window is computed against today at
				// render time, so the preset never goes stale; otherwise the
				// fixed calendar range applies. Both compare in local dates.
				const days = typeof qdf.days === 'number' && qdf.days > 0 ? qdf.days : 0;
				const startStr = days > 0 ? localDateKey(Date.now() - (days - 1) * 86400000) : qdf.start;
				const endStr = days > 0 ? localDateKey(Date.now()) : qdf.end;
				if (startStr || endStr) {
					results = results.filter(r => {
						const ts = qdf.property === 'modified' ? r.mtime : r.ctime;
						const dateStr = localDateKey(ts);
						if (startStr && dateStr < startStr) return false;
						if (endStr && dateStr > endStr) return false;
						return true;
					});
				}
			}

			// Apply folder funnel filter (OR across selected folders)
			if (currentConfig.folderFilter && currentConfig.folderFilter.length > 0) {
				const ff = currentConfig.folderFilter
					.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
					.filter(f => f.length > 0);
				if (ff.length > 0) {
					results = results.filter(r => {
						const lp = r.file.path.toLowerCase();
						return ff.some(f => lp.startsWith(f.toLowerCase() + '/'));
					});
				}
			}

		const totalResults = results.length;
		countEl.textContent = t('library.fileCount', { count: totalResults });

		if (totalResults === 0 && currentConfig.filters.length === 0 && !(currentConfig.folders && currentConfig.folders.length)) {
			contentArea.createDiv({ cls: 'dashboard-library-empty', text: t('library.noConfig') });
			return;
		}

		if (totalResults === 0) {
			contentArea.createDiv({ cls: 'dashboard-library-empty', text: t('library.noFiles') });
			return;
		}

		// Paginate (kanban skips pagination — it scrolls horizontally instead)
		const isKanban = currentConfig.viewMode === 'kanban';
		const effectivePageSize = isKanban ? totalResults : (currentConfig.pageSize ?? DEFAULT_PAGE_SIZE);
		const totalPages = isKanban ? 1 : Math.ceil(totalResults / effectivePageSize);
		if (currentPage > totalPages) currentPage = totalPages;
		if (currentPage < 1) currentPage = 1;

		const startIdx = isKanban ? 0 : (currentPage - 1) * effectivePageSize;
		const endIdx = isKanban ? totalResults : Math.min(startIdx + effectivePageSize, totalResults);
		const pageResults = results.slice(startIdx, endIdx);

		switch (currentConfig.viewMode) {
			case 'grid':
				renderGridView(contentArea, pageResults, app, isFolder, currentConfig);
				break;
			case 'gallery':
				renderGalleryView(contentArea, pageResults, app, isFolder, currentConfig);
				break;
			case 'list':
				renderListView(contentArea, pageResults, app);
				break;
			case 'table':
				renderTableView(contentArea, pageResults, app, currentConfig, (f) => { void deleteLibraryFileWithConfirm(f); });
				break;
			case 'kanban':
				renderKanbanView(contentArea, pageResults, app, currentConfig);
				break;
		}

		// Render pagination controls (kanban scrolls horizontally, no pagination)
		if (!isKanban && totalPages > 1) {
			renderPagination(paginationArea, currentPage, totalPages, totalResults, (page) => {
				currentPage = page;
				renderContent(currentConfig);
				// Scroll to top of section content
				sectionContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			});
		}
	}

	// Search handler
	let searchTimer: number | null = null;
	searchInput.addEventListener('input', () => {
		if (searchTimer) window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			currentPage = 1;
			renderContent(config);
		}, 200);
	});

	// Sort handlers
	sortSelect.addEventListener('change', () => {
		config.sortBy = sortSelect.value;
		onConfigChange(config);
		currentPage = 1;
		renderContent(config);
	});

	sortDirBtn.addEventListener('click', () => {
		config.sortDesc = !config.sortDesc;
		setIcon(sortDirBtn, config.sortDesc ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow');
		onConfigChange(config);
		currentPage = 1;
		renderContent(config);
	});

	// Config button handler - will be wired in view.ts via custom event
	configBtn.addEventListener('click', () => {
		const event = new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true });
		el.dispatchEvent(event);
	});

	// Initial render
	renderContent(config);
}

export function renderPagination(
	container: HTMLElement,
	currentPage: number,
	totalPages: number,
	totalResults: number,
	onPageChange: (page: number) => void,
): void {
	const nav = container.createDiv({ cls: 'dashboard-library-pagination-nav' });

	// Previous button
	const prevBtn = nav.createDiv({
		cls: 'dashboard-library-pagination-btn' + (currentPage <= 1 ? ' disabled' : ''),
		text: '<',
	});
	if (currentPage > 1) {
		prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
	}

	// Page buttons
	const maxVisible = 5;
	let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
	const endPage = Math.min(totalPages, startPage + maxVisible - 1);
	startPage = Math.max(1, endPage - maxVisible + 1);

	if (startPage > 1) {
		const firstBtn = nav.createDiv({ cls: 'dashboard-library-pagination-page', text: '1' });
		firstBtn.addEventListener('click', () => onPageChange(1));
		if (startPage > 2) {
			nav.createDiv({ cls: 'dashboard-library-pagination-ellipsis', text: '...' });
		}
	}

	for (let i = startPage; i <= endPage; i++) {
		const pageBtn = nav.createDiv({
			cls: 'dashboard-library-pagination-page' + (i === currentPage ? ' active' : ''),
			text: String(i),
		});
		if (i !== currentPage) {
			pageBtn.addEventListener('click', () => onPageChange(i));
		}
	}

	if (endPage < totalPages) {
		if (endPage < totalPages - 1) {
			nav.createDiv({ cls: 'dashboard-library-pagination-ellipsis', text: '...' });
		}
		const lastBtn = nav.createDiv({ cls: 'dashboard-library-pagination-page', text: String(totalPages) });
		lastBtn.addEventListener('click', () => onPageChange(totalPages));
	}

	// Next button
	const nextBtn = nav.createDiv({
		cls: 'dashboard-library-pagination-btn' + (currentPage >= totalPages ? ' disabled' : ''),
		text: '>',
	});
	if (currentPage < totalPages) {
		nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
	}
}

function openFile(app: App, file: TFile): void {
	if (!Platform.isMobile && libOpener) {
		libOpener(file);
	} else {
		void app.workspace.getLeaf(false).openFile(file);
	}
}

/** Attach the native hover preview to a library item (desktop only). */
function attachItemHover(app: App, el: HTMLElement, file: TFile): void {
	if (!Platform.isMobile && libHoverParent) {
		attachNoteHover(app, el, file, libHoverParent);
	}
}

/** Move a note to the trash (recoverable) via the file manager so the user's
 *  "delete to trash vs permanent" preference is respected. */
async function trashLibraryFile(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}

function renderGridView(container: HTMLElement, results: LibraryFileResult[], app: App, showTags: boolean, config: LibraryConfig): void {
	renderFileCards(container, results, app, showTags, config, { covers: false });
}

/** Gallery view: the familiar card grid with a frontmatter-driven cover
 *  image on top of each card (see {@link extractCoverValue}). */
function renderGalleryView(container: HTMLElement, results: LibraryFileResult[], app: App, showTags: boolean, config: LibraryConfig): void {
	renderFileCards(container, results, app, showTags, config, { covers: true });
}

interface FileCardRenderOptions {
	/** Gallery mode: render cover slots and drop the cover field from badges. */
	covers: boolean;
}

/** Turn a cover slot into a themed placeholder: the bundled default image when
 *  available, otherwise a faint image icon over a soft accent wash. Used when
 *  a note carries no cover info at all, or when its cover fails to resolve. */
function renderPlaceholderCover(coverEl: HTMLElement): void {
	coverEl.addClass('dashboard-library-card-cover--placeholder');
	if (GALLERY_COVER_PLACEHOLDER_DATA_URL) {
		coverEl.style.backgroundImage = `url(${GALLERY_COVER_PLACEHOLDER_DATA_URL})`;
	} else {
		setIcon(coverEl, 'image');
	}
}

function renderFileCards(container: HTMLElement, results: LibraryFileResult[], app: App, showTags: boolean, config: LibraryConfig, opts: FileCardRenderOptions): void {
	// Card size narrows/widens the auto-fill column track (covers follow via
	// aspect-ratio). 'medium' is the un-suffixed default, so legacy sections
	// keep the exact old layout.
	const sizeClass = config.cardSize && config.cardSize !== 'medium' ? ` dashboard-library-cards--${config.cardSize}` : '';
	const grid = container.createDiv({ cls: (opts.covers ? 'dashboard-library-gallery' : 'dashboard-library-grid') + sizeClass });
	const showProperties = config.showProperties !== false;
	const propertyLimit = Math.max(0, config.propertyLimit ?? 6);

	for (const result of results) {
		const card = grid.createDiv({ cls: 'dashboard-library-card' });
		attachItemHover(app, card, result.file);
		card.addEventListener('click', () => openFile(app, result.file));

		// Cover slot (gallery only). Created up-front so the async fill has a
		// stable target; removed again when nothing resolves. The winning field
		// is dropped from the property badges below so a rendered cover never
		// also shows up as a "封面: x.png" text badge.
		let badgeFrontmatter = result.frontmatter;
		if (opts.covers) {
			const cover = extractCoverValue(result.frontmatter);
			if (cover) {
				badgeFrontmatter = omitFrontmatterKey(result.frontmatter, cover.key);
				const coverEl = card.createDiv({ cls: 'dashboard-library-card-cover' });
				void resolveLibraryCover(cover.value, result.file, app).then(url => {
					if (!coverEl.isConnected) return;
					if (url) coverEl.style.backgroundImage = `url(${url})`;
					// Resolution failed (bad path, offline remote): the note
					// effectively has no cover — fall through to the placeholder.
					else renderPlaceholderCover(coverEl);
				});
			} else {
				// No cover info at all: a themed placeholder keeps gallery
				// cards a uniform height instead of a bare title card.
				renderPlaceholderCover(card.createDiv({ cls: 'dashboard-library-card-cover' }));
			}
		}

		card.createDiv({ cls: 'dashboard-library-card-title', text: result.basename });

		// Tags (folder section) or path + creation time on the meta row
		const metaRow = card.createDiv({ cls: 'dashboard-library-card-meta' });
		if (showTags) {
			if (result.tags.length > 0) {
				const tagsRow = metaRow.createDiv({ cls: 'dashboard-library-card-tags' });
				const maxTags = 2;
				for (const tag of result.tags.slice(0, maxTags)) {
					tagsRow.createDiv({ cls: 'dashboard-library-card-tag', text: tag });
				}
				if (result.tags.length > maxTags) {
					tagsRow.createDiv({
						cls: 'dashboard-library-card-tag dashboard-library-card-tag--more',
						text: `+${result.tags.length - maxTags}`,
					});
				}
			}
		} else {
			const parts = result.file.path.split('/');
			if (parts.length > 1) {
				metaRow.createDiv({ cls: 'dashboard-library-card-path', text: parts.slice(0, -1).join('/') + '/' });
			}
		}
		metaRow.createDiv({ cls: 'dashboard-library-card-date', text: formatDate(result.ctime) });

		// Async body preview
		const previewEl = card.createDiv({ cls: 'dashboard-library-card-preview dashboard-library-card-preview--loading' });
		loadPreview(app, result.file).then(text => {
			if (!previewEl.isConnected) return;
			previewEl.removeClass('dashboard-library-card-preview--loading');
			if (text) {
				previewEl.textContent = text;
			} else {
				previewEl.remove();
			}
		}).catch(() => {
			if (previewEl.isConnected) previewEl.remove();
		});

		// Frontmatter property badges (excludes position; tags are rendered above
		// for folder sections). Capped to keep cards a uniform, bounded size.
		// visibleProperties is the primary mode: a card matching at least one
		// picked property shows exactly those (uncapped); only cards matching
		// none fall back to the automatic first-propertyLimit slice, so the two
		// settings complement each other.
		const hasPicks = (config.visibleProperties?.length ?? 0) > 0;
		if (showProperties && (propertyLimit > 0 || hasPicks)) {
			const badges = card.createDiv({ cls: 'dashboard-library-badges' });
			const keys = selectBadgeKeys(badgeFrontmatter, config.visibleProperties, propertyLimit);
			for (const key of keys) {
				const val = formatBadgeValue(badgeFrontmatter[key]);
				if (val === null) continue;
				const badge = badges.createDiv({ cls: 'dashboard-library-badge' });
				badge.createDiv({ cls: 'dashboard-library-badge-key', text: key });
				badge.createDiv({ cls: 'dashboard-library-badge-val', text: val });
			}
			if (keys.length === 0) badges.remove();
		}
	}
}

/** Immutable single-key omission; returns the original object when the key is
 *  absent so the no-cover path allocates nothing. */
function omitFrontmatterKey(frontmatter: Record<string, unknown>, key: string): Record<string, unknown> {
	if (!(key in frontmatter)) return frontmatter;
	const next: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(frontmatter)) {
		if (k !== key) next[k] = v;
	}
	return next;
}

export interface CoverCandidate {
	/** The frontmatter key the reference came from (to drop it from badges). */
	key: string;
	/** Normalized reference string ready for {@link resolveLibraryCover}. */
	value: string;
}

const IMAGE_REF_RE = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#]|$)/i;

/** Does this string reference an image file (by extension or data: URI)? */
function isImageRef(value: string): boolean {
	return value.startsWith('data:image/') || IMAGE_REF_RE.test(value);
}

/** Coerce a frontmatter value into a cover reference string, unwrapping the
 *  shapes note properties commonly hold: quoted strings, wikilink/embed
 *  syntax (`![[cover.png]]`, alias split), markdown images, `<img>` tags and
 *  lists (first image-shaped entry wins). Null when nothing usable is in
 *  there. */
function normalizeCoverValue(value: unknown): string | null {
	if (value == null || value instanceof Date) return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const normalized = normalizeCoverValue(item);
			if (normalized && isImageRef(normalized)) return normalized;
		}
		return null;
	}
	if (typeof value === 'object') return null;
	let s = str(value).trim();
	if (!s) return null;
	s = s.replace(/^["']+|["']+$/g, '').trim();
	const wikilink = /^!?\[\[([^[\]]+)\]\]$/.exec(s);
	if (wikilink) {
		s = wikilink[1]!.split('|')[0]!.trim();
	} else {
		const mdImage = /^!\[[^\]]*\]\(([^()]+)\)$/.exec(s);
		if (mdImage) {
			s = mdImage[1]!.trim();
		} else {
			const imgTag = /^<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(s);
			if (imgTag) s = imgTag[1]!.trim();
		}
	}
	return s.length > 0 ? s : null;
}

/**
 * Pick the cover reference for a note, if any. Explicit keys win (`封面` /
 * `cover`, case-insensitive — any non-empty value counts); otherwise the
 * first remaining field whose value looks like an image file (extension or
 * data: URI; `tags`/`position` skipped). The winning key is returned too so
 * the gallery view can drop it from the property badges.
 */
export function extractCoverValue(frontmatter: Record<string, unknown>): CoverCandidate | null {
	for (const [key, value] of Object.entries(frontmatter)) {
		if (key !== '封面' && key.toLowerCase() !== 'cover') continue;
		const normalized = normalizeCoverValue(value);
		if (normalized) return { key, value: normalized };
	}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (key === 'tags' || key === 'position') continue;
		const normalized = normalizeCoverValue(value);
		if (normalized && isImageRef(normalized)) return { key, value: normalized };
	}
	return null;
}

/**
 * Resolve a cover reference (see {@link extractCoverValue}) into a URL usable
 * in CSS url(). Absolute-ish references (http/data/file/drive-letter) go
 * straight to the shared resolver; vault-shaped ones resolve Obsidian-style
 * first (bare filename / wikilink target, relative to the note) and fall back
 * to the resolver's vault-root / disk handling. '' when nothing loads, so the
 * caller drops the cover slot and the card stays in its no-cover layout.
 */
async function resolveLibraryCover(raw: string, file: TFile, app: App): Promise<string> {
	if (/^(https?:|data:|file:)/i.test(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
		return resolveCoverAsObjectUrl(raw, app);
	}
	const dest = app.metadataCache.getFirstLinkpathDest(raw, file.path);
	if (dest) return resolveCoverAsObjectUrl(dest.path, app);
	return resolveCoverAsObjectUrl(raw, app);
}

/**
 * Which frontmatter keys a card should show as badges, and in what order.
 *
 * Primary mode (`visibleProperties` non-empty): the picked keys the note
 * actually has, in pick order — all of them, uncapped; keys missing from the
 * note (or with empty/unformattable values) are skipped.
 *
 * Fallback mode (note hits no pick, or no picks at all): the note's own key
 * order, capped at `autoLimit` formattable keys — identical to the historical
 * behavior, so existing sections render unchanged.
 */
export function selectBadgeKeys(
	frontmatter: Record<string, unknown>,
	visibleProperties: readonly string[] | undefined,
	autoLimit: number,
): string[] {
	const showable = (key: string, value: unknown): boolean =>
		key !== 'tags' && key !== 'position' && formatBadgeValue(value) !== null;

	const picks = visibleProperties ?? [];
	const hits = picks.filter(key => key in frontmatter && showable(key, frontmatter[key]));
	if (hits.length > 0) return hits;

	const auto: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (auto.length >= autoLimit) break;
		if (showable(key, value)) auto.push(key);
	}
	return auto;
}

/** Coerce a frontmatter value into a compact badge string, or null to hide it. */
function formatBadgeValue(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	if (Array.isArray(value)) {
		const items = value.map(v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))).filter(v => v.length > 0);
		return items.length > 0 ? items.join(', ') : null;
	}
	if (typeof value === 'object') {
		try {
			const s = JSON.stringify(value).replace(/"/g, '').trim();
			return s.length > 0 && s.length <= 60 ? s : null;
		} catch {
			return null;
		}
	}
	const s = str(value).trim();
	return s.length > 0 ? s : null;
}

function renderListView(container: HTMLElement, results: LibraryFileResult[], app: App): void {
	const list = container.createDiv({ cls: 'dashboard-library-list' });

	for (const result of results) {
		const item = list.createDiv({ cls: 'dashboard-library-list-item' });
		attachItemHover(app, item, result.file);
		item.addEventListener('click', () => openFile(app, result.file));

		item.createDiv({ cls: 'dashboard-library-list-name', text: result.basename });
		item.createDiv({ cls: 'dashboard-library-list-spacer' });
		item.createDiv({ cls: 'dashboard-library-list-date', text: formatDate(result.ctime) });
	}
}

function startCellEdit(
	td: HTMLElement,
	file: TFile,
	prop: string,
	originalValue: unknown,
	app: App,
): void {
	if (td.querySelector('input, select')) return;

	const isArr = Array.isArray(originalValue);
	const displayValue = originalValue == null ? '' : isArr
		? (originalValue as unknown[]).map(String).join(', ')
		: str(originalValue);

	td.empty();
	td.removeClass('dashboard-library-table-empty');

	const input = td.createEl('input', {
		cls: 'dashboard-library-table-edit-input',
		attr: { type: 'text', value: displayValue },
	});
	input.focus();
	input.select();

	const finish = (save: boolean) => {
		if (!input.isConnected) return;
		const raw = input.value.trim();
		input.remove();

		if (!save) {
			td.textContent = displayValue || '—';
			if (!displayValue) td.addClass('dashboard-library-table-empty');
			return;
		}

		// Parse value
		let newValue: unknown;
		if (raw === '') {
			newValue = null;
		} else if (isArr) {
			newValue = raw.split(',').map(s => s.trim()).filter(Boolean);
		} else {
			const num = Number(raw);
			newValue = !isNaN(num) && raw !== '' ? num : raw;
		}

		// Write via processFrontMatter
		void app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (newValue === null) {
				delete fm[prop];
			} else {
				fm[prop] = newValue;
			}
		});

		// Update display
		if (newValue === null) {
			td.textContent = '—';
			td.addClass('dashboard-library-table-empty');
		} else if (Array.isArray(newValue)) {
			td.textContent = newValue.join(', ');
		} else {
			td.textContent = str(newValue);
		}
	};

	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault(); finish(true); }
		else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
	});
	input.addEventListener('blur', () => finish(true));
}

function renderTableView(container: HTMLElement, results: LibraryFileResult[], app: App, config: LibraryConfig, onDelete: (file: TFile) => void): void {
	// Determine which property columns to show
	const propKeys = new Set<string>();
	for (const filter of config.filters) {
		if (filter.property !== 'tags' && filter.property !== 'modified' && filter.property !== 'created' && filter.property !== 'path') {
			propKeys.add(filter.property);
		}
	}
	// Also collect common properties from results
	for (const result of results.slice(0, 20)) {
		for (const key of Object.keys(result.frontmatter)) {
			if (key === 'position') continue;
			propKeys.add(key);
			if (propKeys.size >= 6) break;
		}
	}

	const columns = ['name', 'modified', ...propKeys];

	const table = container.createEl('table', { cls: 'dashboard-library-table' });
	const thead = table.createEl('thead');
	const headerRow = thead.createEl('tr');
	for (const col of columns) {
		const th = headerRow.createEl('th', {
			text: col === 'name' ? t('library.sortName') : col === 'modified' ? t('library.sortModified') : col,
		});
		th.dataset.sortKey = col;
	}
	// Action column (delete button) — empty label, rightmost
	const actionTh = headerRow.createEl('th', { cls: 'dashboard-library-table-op-col' });
	actionTh.setAttribute('aria-label', t('library.delete'));

	const tbody = table.createEl('tbody');
	for (const result of results) {
		const tr = tbody.createEl('tr');

		for (const col of columns) {
			const td = tr.createEl('td');
			if (col === 'name') {
				td.textContent = result.basename;
				td.addClass('dashboard-library-table-name');
				attachItemHover(app, td, result.file);
				td.addEventListener('click', (e) => {
					e.stopPropagation();
					openFile(app, result.file);
				});
			} else if (col === 'modified') {
				td.textContent = formatDate(result.mtime);
			} else {
				const value = result.frontmatter[col];
				if (value == null) {
					td.addClass('dashboard-library-table-empty');
					td.textContent = '—';
				} else if (Array.isArray(value)) {
					td.textContent = value.map(String).join(', ');
				} else {
					td.textContent = str(value);
				}
				td.addClass('dashboard-library-table-editable');
				td.addEventListener('dblclick', (e) => {
					e.stopPropagation();
					startCellEdit(td, result.file, col, value, app);
				});
			}
		}

		// Delete action cell (rightmost)
		const opTd = tr.createEl('td', { cls: 'dashboard-library-table-op' });
		const delBtn = opTd.createEl('button', {
			cls: 'dashboard-library-table-delete',
			attr: { 'aria-label': t('library.delete') },
		});
		delBtn.title = t('library.delete');
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			onDelete(result.file);
		});
	}
}

/** Normalized parent path of a (possibly backslash-separated) vault path;
 *  '' at vault root. */
function parentOf(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	return normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
}

/** Shared core of folderGroupKey/folderGroupPath: normalize a file path and
 * locate the first configured scan folder containing its parent. Returns the
 * matched root (normalized) and the parent relative to it ('' when the file
 * sits directly inside the root). */
function scanRootMatch(filePath: string, scanFolders: string[]): { root: string; rel: string } | null {
	const parent = parentOf(filePath);
	for (const root of scanFolders) {
		const r = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
		if (!r) continue;
		// Case-insensitive prefix match, same rule the scanner uses.
		const rel = parent.toLowerCase().startsWith(r.toLowerCase() + '/')
			? parent.slice(r.length + 1)
			: (parent.toLowerCase() === r.toLowerCase() ? '' : null);
		if (rel !== null) return { root: r, rel };
	}
	return null;
}

/** Kanban folder-mode grouping key for one file: the top-level subfolder under
 * the first configured scan folder that contains it. Files directly inside a
 * scan folder group under that folder's own name; files matching no scan
 * folder (defensive — a library section hand-set to folder mode) fall back to
 * the first segment of their parent path, or undefined at vault root. */
export function folderGroupKey(filePath: string, scanFolders: string[]): string | undefined {
	const m = scanRootMatch(filePath, scanFolders);
	if (m) {
		if (m.rel === '') {
			// Directly inside the scan folder: the folder itself is the group.
			return m.root.split('/').filter(Boolean).pop() ?? m.root;
		}
		return m.rel.split('/')[0] ?? '';
	}
	const parent = parentOf(filePath);
	if (parent === '') return undefined;
	return parent.split('/')[0] ?? undefined;
}

/** Reverse of folderGroupKey: the real folder path a group key maps to for one
 * file — the matched scan root itself when the file sits directly inside it,
 * otherwise root + '/' + the file's group segment. Mirrors folderGroupKey's
 * fallback (first parent segment) so a folder-mode library section without
 * scan folders still drops into real folders; undefined only where
 * folderGroupKey is (vault root). The root is sliced back out of the file's
 * real parent (not the config entry), so the vault API sees true casing even
 * when a scan folder was renamed after configuration. */
function folderGroupPath(filePath: string, scanFolders: string[]): string | undefined {
	const m = scanRootMatch(filePath, scanFolders);
	if (m) {
		const parent = parentOf(filePath);
		if (m.rel === '') return parent;
		const trueRoot = parent.slice(0, parent.length - m.rel.length - 1);
		return `${trueRoot}/${m.rel.split('/')[0]}`;
	}
	const parent = parentOf(filePath);
	if (parent === '') return undefined;
	return parent.split('/')[0] ?? undefined;
}

/** One drag in flight within a single kanban render. Scoped per render call so
 *  two library sections on one board never see each other's drags (a card
 *  dragged over the OTHER section's kanban finds no state and is declined). */
interface KanbanDragState {
	file: TFile | null;
	cardEl: HTMLElement | null;
}

/** Group key → drop-target folder path, derived from the group members' real
 *  parents via folderGroupPath (reverse of folderGroupKey). First member wins:
 *  when two scan roots have same-named subfolders they merge into one group,
 *  and the target is whichever member sorts first — deterministic per render.
 *  The not-set column never gets an entry, so it rejects drops. */
function buildKanbanGroupFolders(results: LibraryFileResult[], scanFolders: string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const result of results) {
		const key = folderGroupKey(result.file.path, scanFolders);
		if (key === undefined || map.has(key)) continue;
		const folder = folderGroupPath(result.file.path, scanFolders);
		if (folder !== undefined) map.set(key, folder);
	}
	return map;
}

/** Folder-kanban grouping: keys whose folder is a proper ancestor of another
 *  group's folder. Those groups are suppressed (their files fall to the
 *  not-set column) so a parent folder never shows as a group alongside its
 *  own children — e.g. files directly in a scan root stop forming a
 *  root-named column next to the root's subfolders. */
function ancestorGroupKeys(groupFolders: Map<string, string>): Set<string> {
	const paths = [...groupFolders.values()].map(p => p.toLowerCase().replace(/\/+$/, ''));
	const suppressed = new Set<string>();
	for (const [key, path] of groupFolders) {
		const lp = path.toLowerCase().replace(/\/+$/, '');
		if (paths.some(other => other !== lp && other.startsWith(lp + '/'))) suppressed.add(key);
	}
	return suppressed;
}

/** Make one kanban card draggable (desktop, folder-grouping only). Tags the
 *  drag with the shared custom MIME type so foreign drop targets (dnd.ts) can
 *  recognize and decline it at dragover time. */
function attachKanbanCardDrag(card: HTMLElement, file: TFile, state: KanbanDragState): void {
	card.setAttribute('draggable', 'true');
	card.title = t('library.kanbanDragHint');
	card.addEventListener('dragstart', (e) => {
		state.file = file;
		state.cardEl = card;
		card.addClass('dashboard-library-kanban-card--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Custom type only: a bare text/plain payload would insert literal
			// text wherever else the card gets dropped (editor, search, ...).
			e.dataTransfer.setData(KANBAN_FILE_DRAG_TYPE, file.path);
		}
	});
	card.addEventListener('dragend', () => {
		state.file = null;
		state.cardEl = null;
		card.removeClass('dashboard-library-kanban-card--dragging');
		activeDocument.querySelectorAll('.dashboard-library-kanban-col--drag-over')
			.forEach(el => (el as HTMLElement).removeClass('dashboard-library-kanban-col--drag-over'));
	});
}

/** Wire one kanban column as a drop target (desktop, folder-grouping only).
 *  groupKey undefined marks the not-set column, which declines drops
 *  (dropEffect none) — its files are vault-root/scan-orphans with no target
 *  folder. Drags lacking the kanban marker pass through untouched so memo
 *  cards, section grips and OS file drops keep their dnd.ts behavior. */
function attachKanbanColumnDrop(
	col: HTMLElement,
	groupKey: string | undefined,
	groupFolders: Map<string, string>,
	app: App,
	state: KanbanDragState,
): void {
	const onDragOver = (e: DragEvent) => {
		if (!e.dataTransfer || !e.dataTransfer.types.includes(KANBAN_FILE_DRAG_TYPE)) return;
		// Claim the event so the enclosing .dashboard-section-row dragover in
		// dnd.ts doesn't highlight the whole section row behind the kanban.
		e.preventDefault();
		e.stopPropagation();
		const target = state.file ? groupFolders.get(groupKey ?? '') : undefined;
		e.dataTransfer.dropEffect = target ? 'move' : 'none';
		col.toggleClass('dashboard-library-kanban-col--drag-over', !!target);
	};
	const onDragLeave = (e: DragEvent) => {
		const rect = col.getBoundingClientRect();
		if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
			col.removeClass('dashboard-library-kanban-col--drag-over');
		}
	};
	const onDrop = (e: DragEvent) => {
		if (!state.file || !state.cardEl) return;
		e.preventDefault();
		e.stopPropagation();
		col.removeClass('dashboard-library-kanban-col--drag-over');
		const targetFolder = groupFolders.get(groupKey ?? '');
		if (targetFolder) void moveKanbanCard(app, state.file, targetFolder, state.cardEl, col);
	};
	col.addEventListener('dragover', onDragOver);
	col.addEventListener('dragleave', onDragLeave);
	col.addEventListener('drop', onDrop);
}

/** Files with a kanban move still awaiting renameFile. A second drop of the
 *  same file inside that window would read pre-rename vault state (stale path,
 *  stale conflict check) and could double-move — consult this and bail. */
const kanbanMovesInFlight = new Set<TFile>();

/** Move a kanban card's file into the target group folder's root (flatten).
 *  Optimistically reparents the card so it doesn't sit in the old column for
 *  the ~500ms vault-event debounce before refreshScanningSections re-renders;
 *  rolls the DOM back if the rename fails. */
async function moveKanbanCard(
	app: App,
	file: TFile,
	targetFolder: string,
	cardEl: HTMLElement,
	targetCol: HTMLElement,
): Promise<void> {
	const newPath = `${targetFolder}/${file.name}`;
	// Already at the group root (dropped on its own column): silent no-op.
	if (file.path === newPath) return;
	// A previous drop of this file is still renaming — let it finish.
	if (kanbanMovesInFlight.has(file)) return;
	// The group map can hold a folder deleted since the section rendered.
	if (!app.vault.getAbstractFileByPath(targetFolder)) {
		new Notice(t('library.moveFailed'));
		return;
	}
	if (app.vault.getAbstractFileByPath(newPath)) {
		new Notice(t('library.moveNameConflict', { name: file.basename, folder: targetFolder }));
		return;
	}
	const originParent = cardEl.parentNode;
	const originNext = cardEl.nextSibling;
	kanbanMovesInFlight.add(file);
	targetCol.appendChild(cardEl);
	refreshKanbanColumnCount(targetCol);
	if (originParent instanceof HTMLElement) refreshKanbanColumnCount(originParent);
	try {
		// renameFile respects the user's "auto-update internal links" setting.
		await app.fileManager.renameFile(file, newPath);
		new Notice(t('library.moved', { name: file.basename, folder: targetFolder }));
	} catch (err) {
		if (originParent) originParent.insertBefore(cardEl, originNext);
		if (originParent instanceof HTMLElement) refreshKanbanColumnCount(originParent);
		refreshKanbanColumnCount(targetCol);
		console.error('[Dashboard] library kanban move failed:', err);
		new Notice(t('library.moveFailed'));
	} finally {
		kanbanMovesInFlight.delete(file);
	}
}

/** Rewrite a column title so its count matches the cards now in the DOM
 *  (covers the optimistic-move window before the debounced re-render). */
function refreshKanbanColumnCount(col: HTMLElement): void {
	const title = col.querySelector(':scope > .dashboard-library-kanban-col-title');
	const label = col.dataset.groupLabel;
	if (!title || !label) return;
	const count = col.querySelectorAll(':scope > .dashboard-library-kanban-card').length;
	title.setText(`${label} (${count})`);
}

function renderKanbanView(container: HTMLElement, results: LibraryFileResult[], app: App, config: LibraryConfig): void {
	const groupBy = config.kanbanGroupBy ?? 'tags';
	const byFolder = config.groupMode === 'folder';
	// Folder-grouping kanbans support drag-to-move on desktop only; the not-set
	// column still allows dragging OUT (filing loose files) but rejects drops.
	const dragEnabled = byFolder && !Platform.isMobile;
	const groupFolders = dragEnabled ? buildKanbanGroupFolders(results, config.folders ?? []) : new Map<string, string>();
	const dragState: KanbanDragState = { file: null, cardEl: null };
	const kanban = container.createDiv({ cls: 'dashboard-library-kanban' });

	// Group results
	const groups = new Map<string, LibraryFileResult[]>();
	const noGroup: LibraryFileResult[] = [];
	// Key → real folder per folder-group (collected during grouping so ancestor
	// groups can be suppressed once every group is known).
	const groupFolderPaths = new Map<string, string>();

	for (const result of results) {
		if (byFolder) {
			const key = folderGroupKey(result.file.path, config.folders ?? []);
			if (key === undefined) {
				noGroup.push(result);
				continue;
			}
			if (!groupFolderPaths.has(key)) {
				const path = folderGroupPath(result.file.path, config.folders ?? []);
				if (path !== undefined) groupFolderPaths.set(key, path);
			}
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(result);
			continue;
		}
		const value = result.frontmatter[groupBy];
		if (value == null) {
			noGroup.push(result);
			continue;
		}
		if (Array.isArray(value)) {
			for (const v of value) {
				const key = String(v);
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key)!.push(result);
			}
		} else {
			const key = str(value);
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(result);
		}
	}

	// Folder groups read best alphabetically (they mirror the folder tree);
	// property groups keep their first-occurrence order. First suppress
	// ancestor groups (a folder that is another group's parent) — their files
	// fall to the not-set column, so parents never appear alongside children.
	if (byFolder) {
		for (const key of ancestorGroupKeys(groupFolderPaths)) {
			const direct = groups.get(key);
			if (direct) noGroup.push(...direct);
			groups.delete(key);
		}
		const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
		groups.clear();
		for (const entry of sorted) groups.set(entry[0], entry[1]);
	}

	// Render columns
	for (const [groupName, groupResults] of groups) {
		const col = kanban.createDiv({ cls: 'dashboard-library-kanban-col' });
		col.createDiv({ cls: 'dashboard-library-kanban-col-title', text: `${groupName} (${groupResults.length})` });
		if (dragEnabled) {
			col.dataset.groupLabel = groupName;
			attachKanbanColumnDrop(col, groupName, groupFolders, app, dragState);
		}
		for (const result of groupResults) {
			const card = col.createDiv({ cls: 'dashboard-library-kanban-card' });
			attachItemHover(app, card, result.file);
			card.addEventListener('click', () => openFile(app, result.file));
			if (dragEnabled) attachKanbanCardDrag(card, result.file, dragState);
			card.createDiv({ cls: 'dashboard-library-kanban-card-title', text: result.basename });
			card.createDiv({ cls: 'dashboard-library-kanban-card-date', text: formatDate(result.mtime) });
		}
	}

	if (noGroup.length > 0) {
		const col = kanban.createDiv({ cls: 'dashboard-library-kanban-col' });
		col.createDiv({ cls: 'dashboard-library-kanban-col-title', text: `${t('library.notSet')} (${noGroup.length})` });
		if (dragEnabled) {
			// groupKey undefined → no map entry → this column declines drops,
			// while its cards stay draggable out into real groups.
			col.dataset.groupLabel = t('library.notSet');
			attachKanbanColumnDrop(col, undefined, groupFolders, app, dragState);
		}
		for (const result of noGroup) {
			const card = col.createDiv({ cls: 'dashboard-library-kanban-card' });
			attachItemHover(app, card, result.file);
			card.addEventListener('click', () => openFile(app, result.file));
			if (dragEnabled) attachKanbanCardDrag(card, result.file, dragState);
			card.createDiv({ cls: 'dashboard-library-kanban-card-title', text: result.basename });
		}
	}
}
