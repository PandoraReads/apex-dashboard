import { App, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { LibraryConfig, PropertyFilter, LibraryViewMode } from './types';
import { t, getLanguage } from './i18n';
import { attachNoteHover } from './hover-preview';
import { MultiFolderSelectModal } from './folder-config-modal';
import { showConfirmDialog } from './confirm-dialog';

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

	for (const file of files) {
		if (file.path.startsWith('.')) continue;

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

function showCalendarPopup(anchor: HTMLElement, initialValue: string, onSelect: (date: string) => void): void {
	closeCalendarPopup();

		const popup = activeDocument.body.createDiv({ cls: 'dashboard-task-reminder-popup dashboard-library-calendar-popup' });

	const dashboardRoot = anchor.closest('.apex-dashboard-root') as HTMLElement;
	if (dashboardRoot) {
		const rs = getComputedStyle(dashboardRoot);
		const themeVars = ['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
			'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font'];
		themeVars.forEach(v => {
			const val = rs.getPropertyValue(v).trim();
			if (val) popup.style.setProperty(v, val);
		});
	}

	popup.setCssProps({
		background: 'var(--db-bg-card, rgba(255, 255, 255, 0.06))',
		backdropFilter: 'blur(16px)',
		color: 'var(--db-text, var(--text-normal))',
		borderColor: 'var(--db-border-card, rgba(255,255,255,0.1))',
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

	let selectedYear: number;
	let selectedMonth: number;
	let selectedDay: number;

	const now = new Date();
	if (initialValue) {
		const dp = initialValue.split('-').map(Number);
		selectedYear = dp[0] ?? now.getFullYear();
		selectedMonth = (dp[1] ?? now.getMonth() + 1) - 1;
		selectedDay = dp[2] ?? now.getDate();
	} else {
		selectedYear = now.getFullYear();
		selectedMonth = now.getMonth();
		selectedDay = now.getDate();
	}

	const viewYear = { value: selectedYear };
	const viewMonth = { value: selectedMonth };
	const lang = getLanguage();
	const dayNames = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
	const prevBtn = calNav.createEl('button', { text: '<' });
	const monthLabel = calNav.createSpan();
	const nextBtn = calNav.createEl('button', { text: '>' });

	const calGrid = popup.createDiv({ cls: 'dashboard-task-reminder-calendar' });

	const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
	btnRow.createEl('button', { cls: 'mod-cta', text: t('common.save') });
	btnRow.createEl('button', { text: t('common.cancel') });

	const renderCalendar = () => {
		calGrid.empty();
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

		for (let d = 1; d <= daysInMonth; d++) {
			const cls = ['dashboard-task-reminder-calendar-day'];
			if (isCurrentMonth && d === today.getDate()) cls.push('dashboard-task-reminder-calendar-day--today');
			if (y === selectedYear && m === selectedMonth && d === selectedDay) cls.push('dashboard-task-reminder-calendar-day--selected');
			const dayBtn = calGrid.createEl('button', { cls: cls.join(' '), text: String(d) });
			dayBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				selectedYear = y;
				selectedMonth = m;
				selectedDay = d;
				renderCalendar();
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
		const date = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
		onSelect(date);
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
	const viewModes: LibraryViewMode[] = ['grid', 'list', 'table', 'kanban'];
	const viewIcons: Record<string, string> = { grid: 'layout-grid', list: 'list', table: 'table', kanban: 'columns' };
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
			currentPage = 1;
			renderContent(config);
		});
	}

		// Quick date filter button
		const filterBtn = toolbar.createDiv({ cls: 'dashboard-library-filter-btn' });
		setIcon(filterBtn, 'filter');
		filterBtn.title = t('library.quickFilter');

		// Filter tag
		const filterTag = toolbar.createDiv({ cls: 'dashboard-library-filter-tags' });

		// Quick date filter state (separate from config.filters)
		let quickProp: 'created' | 'modified' = config.quickDateFilter?.property ?? 'created';
		let quickStart = config.quickDateFilter?.start ?? '';
		let quickEnd = config.quickDateFilter?.end ?? '';
		// Rolling "last N days" window (0 = off). Takes precedence over fixed dates.
		let quickDays = config.quickDateFilter?.days ?? 0;

		// Popup
		let filterPopup: HTMLElement | null = null;
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
			renderFilterTag();
			updateFilterBtnState();
		}

		function applyFunnelFolders(): void {
			config.folderFilter = funnelFolders.length > 0 ? [...funnelFolders] : undefined;
			onConfigChange({ ...config });
			currentPage = 1;
			renderContent(config);
			renderFilterTag();
			updateFilterBtnState();
		}

		function openPopup(): void {
			closePopup();
			filterPopup = activeDocument.body.createDiv({ cls: 'dashboard-library-filter-popup' });

			// Inherit theme from dashboard
			const dashboardRoot = filterBtn.closest('.apex-dashboard-root') as HTMLElement;
			if (dashboardRoot) {
				const rs = getComputedStyle(dashboardRoot);
				['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
					'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font',
					'--db-bg-input', '--db-bg-hover', '--db-bg-btn', '--db-text-normal', '--db-border-input'].forEach(v => {
					const val = rs.getPropertyValue(v).trim();
					if (val) filterPopup!.style.setProperty(v, val);
				});
			}

			// Position below the filter button
			const rect = filterBtn.getBoundingClientRect();
			filterPopup.setCssProps({
				position: 'fixed',
				top: `${rect.bottom + 4}px`,
				left: `${rect.left}px`,
				zIndex: '10000',
			});

			// Property selector
			const propRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			propRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('library.filterProperty') });
			const propSelect = propRow.createEl('select', { cls: 'dashboard-library-filter-popup-prop' });
			propSelect.createEl('option', { text: t('library.created'), attr: { value: 'created' } });
			propSelect.createEl('option', { text: t('library.modified'), attr: { value: 'modified' } });
			propSelect.value = quickProp;
			propSelect.addEventListener('change', () => {
				quickProp = propSelect.value as 'created' | 'modified';
			});

			// Date range
			const dateRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			dateRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('library.filterDateRange') });
			const dateWrap = dateRow.createDiv({ cls: 'dashboard-library-filter-popup-dates' });
			const startBtn = dateWrap.createEl('button', {
				cls: 'dashboard-library-filter-date-btn' + (quickStart ? ' has-value' : ''),
				text: quickStart || t('library.dateStart'),
			});
			const endBtn = dateWrap.createEl('button', {
				cls: 'dashboard-library-filter-date-btn' + (quickEnd ? ' has-value' : ''),
				text: quickEnd || t('library.dateEnd'),
			});

			startBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				showCalendarPopup(startBtn, quickStart, (date) => {
					quickStart = date;
					quickDays = 0; // an explicit range replaces the rolling window
					applyQuickFilter();
					if (activeDocument.body.contains(filterBtn)) openPopup();
				});
			});
			endBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				showCalendarPopup(endBtn, quickEnd, (date) => {
					quickEnd = date;
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

			// Folder filter
			const folderRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			folderRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('media.filterFolder') });
			const folderChipsHost = folderRow.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
			const folderAddRow = folderRow.createDiv({ cls: 'dashboard-media-folder-input-row' });
			const folderInput = folderAddRow.createEl('input', {
				cls: 'dashboard-media-filter-folder',
				attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder') },
			});
			const folderBrowseBtn = folderAddRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
			folderBrowseBtn.addEventListener('click', () => {
				// Multi-select: pick every funnel folder at once. Funnel folders are OR
				// unions, so parents/children stay independently tickable.
				new MultiFolderSelectModal(app, funnelFolders, (folders) => {
					funnelFolders = folders;
					applyFunnelFolders();
					renderFolderChips();
				}).open();
			});
			const renderFolderChips = (): void => {
				folderChipsHost.empty();
				if (funnelFolders.length === 0) {
					folderChipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('folder.noFolders') });
					return;
				}
				for (const folder of funnelFolders) {
					const chip = folderChipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
					chip.createSpan({ text: folder });
					const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
					x.addEventListener('click', () => {
						funnelFolders = funnelFolders.filter(f => f !== folder);
						applyFunnelFolders();
						renderFolderChips();
					});
				}
			};
			const addFunnelFolder = (): void => {
				const folder = folderInput.value.trim().replace(/^\/+|\/+$/g, '');
				folderInput.value = '';
				if (!folder) return;
				if (funnelFolders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
				funnelFolders = [...funnelFolders, folder];
				applyFunnelFolders();
				renderFolderChips();
			};
			folderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFunnelFolder(); } });
			renderFolderChips();

			// Clear button
			if (quickStart || quickEnd || quickDays > 0 || funnelFolders.length > 0) {
				const clearBtn = filterPopup.createEl('button', {
					cls: 'dashboard-library-filter-popup-clear',
					text: t('reminder.clearReminder'),
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

		function renderFilterTag(): void {
			filterTag.empty();
			if (quickDays > 0) {
				const propLabel = t(quickProp === 'modified' ? 'library.modified' : 'library.created');
				const tag = filterTag.createDiv({
					cls: 'dashboard-library-filter-tag',
					text: `${propLabel} · ${t('library.lastNDays', { n: quickDays })}`,
				});
				const x = tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' });
				x.addEventListener('click', () => {
					quickDays = 0;
					applyQuickFilter();
				});
			} else if (quickStart || quickEnd) {
				const start = quickStart || '...';
				const end = quickEnd || '...';
				const tag = filterTag.createDiv({
					cls: 'dashboard-library-filter-tag',
					text: `${quickProp}: ${start} ~ ${end}`,
				});
				const x = tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' });
				x.addEventListener('click', () => {
					quickStart = '';
					quickEnd = '';
					applyQuickFilter();
					openPopup();
				});
			}
			for (const folder of funnelFolders) {
				const tag = filterTag.createDiv({ cls: 'dashboard-library-filter-tag' });
				const label = tag.createSpan({ cls: 'dashboard-library-filter-tag-label', text: folder.split('/').filter(Boolean).pop() ?? folder });
				label.title = folder;
				const x = tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' });
				x.addEventListener('click', () => {
					funnelFolders = funnelFolders.filter(f => f !== folder);
					applyFunnelFolders();
				});
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

		renderFilterTag();
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
	const grid = container.createDiv({ cls: 'dashboard-library-grid' });
	const showProperties = config.showProperties !== false;
	const propertyLimit = Math.max(0, config.propertyLimit ?? 6);

	for (const result of results) {
		const card = grid.createDiv({ cls: 'dashboard-library-card' });
		attachItemHover(app, card, result.file);
		card.addEventListener('click', () => openFile(app, result.file));

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
		if (showProperties && propertyLimit > 0) {
			const badges = card.createDiv({ cls: 'dashboard-library-badges' });
			let count = 0;
			for (const [key, rawValue] of Object.entries(result.frontmatter)) {
				if (count >= propertyLimit) break;
				if (key === 'position' || key === 'tags') continue;
				const val = formatBadgeValue(rawValue);
				if (val === null) continue;
				const badge = badges.createDiv({ cls: 'dashboard-library-badge' });
				badge.createDiv({ cls: 'dashboard-library-badge-key', text: key });
				badge.createDiv({ cls: 'dashboard-library-badge-val', text: val });
				count++;
			}
			if (count === 0) badges.remove();
		}
	}
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

function renderKanbanView(container: HTMLElement, results: LibraryFileResult[], app: App, config: LibraryConfig): void {
	const groupBy = config.kanbanGroupBy ?? 'tags';
	const kanban = container.createDiv({ cls: 'dashboard-library-kanban' });

	// Group results
	const groups = new Map<string, LibraryFileResult[]>();
	const noGroup: LibraryFileResult[] = [];

	for (const result of results) {
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

	// Render columns
	for (const [groupName, groupResults] of groups) {
		const col = kanban.createDiv({ cls: 'dashboard-library-kanban-col' });
		col.createDiv({ cls: 'dashboard-library-kanban-col-title', text: `${groupName} (${groupResults.length})` });
		for (const result of groupResults) {
			const card = col.createDiv({ cls: 'dashboard-library-kanban-card' });
			attachItemHover(app, card, result.file);
			card.addEventListener('click', () => openFile(app, result.file));
			card.createDiv({ cls: 'dashboard-library-kanban-card-title', text: result.basename });
			card.createDiv({ cls: 'dashboard-library-kanban-card-date', text: formatDate(result.mtime) });
		}
	}

	if (noGroup.length > 0) {
		const col = kanban.createDiv({ cls: 'dashboard-library-kanban-col' });
		col.createDiv({ cls: 'dashboard-library-kanban-col-title', text: `${t('library.notSet')} (${noGroup.length})` });
		for (const result of noGroup) {
			const card = col.createDiv({ cls: 'dashboard-library-kanban-card' });
			attachItemHover(app, card, result.file);
			card.addEventListener('click', () => openFile(app, result.file));
			card.createDiv({ cls: 'dashboard-library-kanban-card-title', text: result.basename });
		}
	}
}
