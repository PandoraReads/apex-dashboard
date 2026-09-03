import { App, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import { showConfirmDialog } from './confirm-dialog';
import { MediaLightboxModal } from './media-lightbox-modal';
import { MediaTagEditModal } from './media-tag-editor-modal';
import type { MediaTagService } from './media-tags';
import { renderPagination, renderTagsSelector, folderGroupKey } from './library-section';
import { MultiFolderSelectModal } from './folder-config-modal';
import { normalizeExcludeFolders, isUnderExcludedFolder } from './exclude-folders';
import {
	type MediaFileResult,
	renderMediaGrid,
	renderMediaList,
	formatDate,
} from './media-views';
import { trashMediaFile } from './media-utils';

/** Image file extensions shown in an images section (excludes pdf). */
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
/** Video file extensions shown in a videos section. */
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);

const PAGE_SIZE_OPTIONS = [20, 50, 100];

type MediaViewMode = 'grid' | 'list';
type ThumbSize = 'small' | 'medium' | 'large';

/** localStorage key for the persisted thumbnail-size preference. */
const THUMB_SIZE_STORAGE_KEY = 'apex-dashboard-media-thumb-size';

/** Read the stored thumbnail size, defaulting to medium on absent/garbage. */
function readStoredThumbSize(app: App): ThumbSize {
	const stored = app.loadLocalStorage(THUMB_SIZE_STORAGE_KEY) as string | null;
	return stored === 'small' || stored === 'large' ? stored : 'medium';
}

/** Toolbar grouping mode for media sections (runtime state, like viewMode). */
export type MediaGroupMode = 'none' | 'folder' | 'tag';

/** One rendered media group: header key, its items in display order, and the
 * group's start offset into the flattened display order (lightbox indexing). */
export interface MediaGroup {
	key: string;
	items: MediaFileResult[];
	offset: number;
}

/** Group filtered+sorted media results for display. Folder mode keys by the
 * top-level vault folder (`folderGroupKey` with no scan roots — media scans the
 * whole vault); tag mode fans a file out into one bucket per tag. Buckets sort
 * alphabetically (numeric-aware); the not-set bucket always goes last. */
export function groupMediaResults(results: MediaFileResult[], mode: MediaGroupMode): MediaGroup[] {
	if (mode === 'none') return [];
	const buckets = new Map<string, MediaFileResult[]>();
	const notSet: MediaFileResult[] = [];
	for (const r of results) {
		if (mode === 'folder') {
			const key = folderGroupKey(r.path, []);
			if (key === undefined) { notSet.push(r); continue; }
			const list = buckets.get(key) ?? [];
			list.push(r);
			buckets.set(key, list);
		} else {
			const tags = r.tags;
			if (tags.length === 0) { notSet.push(r); continue; }
			for (const tag of tags) {
				const list = buckets.get(tag) ?? [];
				list.push(r);
				buckets.set(tag, list);
			}
		}
	}
	const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
	const groups: MediaGroup[] = [];
	let offset = 0;
	for (const [key, items] of sorted) {
		groups.push({ key, items, offset });
		offset += items.length;
	}
	if (notSet.length > 0) groups.push({ key: t('library.notSet'), items: notSet, offset });
	return groups;
}

function extsFor(sectionType: string): Set<string> | null {
	if (sectionType === 'images') return IMAGE_EXTS;
	if (sectionType === 'videos') return VIDEO_EXTS;
	return null;
}

function isMediaSection(sectionType: string): boolean {
	return sectionType === 'images' || sectionType === 'videos';
}

function queryMediaFiles(app: App, exts: Set<string>, excludeFolders: string[], tagService?: MediaTagService): MediaFileResult[] {
	const excluded = normalizeExcludeFolders(excludeFolders);
	const results: MediaFileResult[] = [];
	for (const file of app.vault.getFiles()) {
		if (file.path.startsWith('.')) continue;
		if (isUnderExcludedFolder(file.path, excluded)) continue;
		if (!exts.has(file.extension)) continue;
		results.push({
			file,
			basename: file.basename,
			path: file.path,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			ext: file.extension,
			size: file.stat.size,
			tags: tagService?.getTags(file.path) ?? [],
		});
	}
	return results;
}

function sortMedia(results: MediaFileResult[], sortBy: string, desc: boolean): void {
	results.sort((a, b) => {
		let cmp = 0;
		if (sortBy === 'name') {
			cmp = a.basename.localeCompare(b.basename);
		} else if (sortBy === 'created') {
			cmp = a.ctime - b.ctime;
		} else {
			cmp = a.mtime - b.mtime;
		}
		return desc ? -cmp : cmp;
	});
}

/**
 * Release every `<video>` under `root`: pause, clear src, and reload so the
 * platform frees the underlying media decoder/buffer. Removing the node from
 * the DOM alone does NOT release the decoder promptly on mobile WebViews, which
 * is the root cause of the runaway memory growth across re-renders.
 */
export function releaseVideoMedia(root: HTMLElement): void {
	const vids = Array.from(root.querySelectorAll('video'));
	for (const v of vids) {
		try { v.pause(); } catch { /* ignore */ }
		v.removeAttribute('src');
		try { v.load(); } catch { /* ignore */ }
	}
}

/** Lazy mounter for desktop video thumbnails: only visible tiles hold a live
 *  `<video>` decoder; tiles scrolled out of view are released. One mounter per
 *  section render; mobile never creates one (static placeholders only). */
interface LazyVideoMounter {
	observe(tile: HTMLElement, src: string): void;
	disconnect(): void;
}

/** Per-section mounter registry so an in-place section replacement (renderer
 *  refresh) can disconnect the old observer + release videos before swap. */
const sectionMounters = new WeakMap<HTMLElement, LazyVideoMounter>();

/** Tear down a media section's video resources: disconnect its lazy mounter
 *  (if any) and release every `<video>` under it. Called before re-render and
 *  before the renderer replaces the section element in place. */
export function destroyMediaSection(sectionEl: HTMLElement): void {
	const mounter = sectionMounters.get(sectionEl);
	if (mounter) {
		mounter.disconnect();
		sectionMounters.delete(sectionEl);
	}
	releaseVideoMedia(sectionEl);
}

function createLazyVideoMounter(): LazyVideoMounter | null {
	if (Platform.isMobile || typeof IntersectionObserver === 'undefined') return null;
	const mounted = new WeakSet<HTMLElement>();
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			const tile = entry.target as HTMLElement;
			if (!tile.isConnected) continue;
			if (entry.isIntersecting) {
				if (mounted.has(tile)) continue;
				const src = tile.dataset.lazyVideoSrc;
				if (!src) continue;
				mountVideoInTile(tile, src);
				mounted.add(tile);
			} else {
				if (!mounted.has(tile)) continue;
				releaseVideoMedia(tile);
				tile.querySelector('video')?.remove();
				tile.removeClass('is-video-mounted');
				mounted.delete(tile);
			}
		}
	}, { rootMargin: '300px' });

	return {
		observe(tile, src) {
			tile.dataset.lazyVideoSrc = src;
			observer.observe(tile);
		},
		disconnect() { observer.disconnect(); },
	};
}

/** Create the `<video>` element inside a lazy tile. CSS hides the placeholder
 *  via the `.is-video-mounted` class on the tile once the real `<video>` is
 *  appended (no direct style mutation needed). */
function mountVideoInTile(tile: HTMLElement, src: string): void {
	tile.addClass('is-video-mounted');
	tile.createEl('video', {
		cls: 'dashboard-media-thumb',
		attr: { src, preload: 'metadata', muted: '', playsinline: '' },
	});
}

/**
 * Render an images or videos section: compact toolbar (search + sort +
 * direction + grid/list/table toggle + count) over a paginated view.
 * Grid shows a thumbnail wall; list/table add delete buttons; table lets you
 * rename a file (updating backlinks). Clicking a thumbnail opens the lightbox.
 * With a tagService, files carry user tags: filterable via the filter popup's
 * tag chips row, editable via tile buttons / table Tags column / the lightbox
 * tag bar. Tag edits persist debounced and only re-render this section.
 */
export function renderMediaSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	_hoverParent: HoverParent | null,
	onOpenNote?: (file: TFile) => void,
	tagService?: MediaTagService,
): void {
	const sectionType = column.sectionType ?? '';
	const exts = extsFor(sectionType);
	const kind: 'image' | 'video' = sectionType === 'videos' ? 'video' : 'image';
	if (!exts) return;

	const content = el.createDiv({ cls: 'dashboard-library-content dashboard-media-content' });

	// Toolbar
	const toolbar = content.createDiv({ cls: 'dashboard-library-toolbar' });
	const searchInput = toolbar.createEl('input', {
		cls: 'dashboard-library-search',
		attr: { type: 'text', placeholder: t('library.searchPlaceholder') },
	});
	const sortSelect = toolbar.createEl('select', { cls: 'dashboard-library-sort' });
	const sortOptions = [
		{ value: 'modified', label: t('library.sortModified') },
		{ value: 'created', label: t('library.sortCreated') },
		{ value: 'name', label: t('library.sortName') },
	];
	let sortBy = 'modified';
	let sortDesc = true;
	for (const opt of sortOptions) {
		sortSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	const sortDirBtn = toolbar.createDiv({ cls: 'dashboard-library-sort-dir' });
	const updateSortIcon = () => setIcon(sortDirBtn, sortDesc ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow');
	updateSortIcon();
	sortDirBtn.addEventListener('click', () => { sortDesc = !sortDesc; updateSortIcon(); currentPage = 1; render(); });

	// Group-by select (runtime state like the other toolbar toggles): none /
	// top-level folder / tag. Grouped rendering shows everything and hides the
	// paginator, so the choice stays orthogonal to sort/filter/view/size.
	let groupBy: MediaGroupMode = 'none';
	const collapsedGroups = new Set<string>();
	const groupSelect = toolbar.createEl('select', {
		cls: 'dashboard-library-sort dashboard-media-group-select',
		attr: { 'aria-label': t('media.groupBy'), title: t('media.groupBy') },
	});
	for (const opt of [
		{ value: 'none', label: t('media.groupNone') },
		{ value: 'folder', label: t('media.groupByFolder') },
		{ value: 'tag', label: t('media.groupByTag') },
	] as const) {
		groupSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	groupSelect.addEventListener('change', () => { groupBy = groupSelect.value as MediaGroupMode; currentPage = 1; render(); });

	// View mode toggle (reuses library's view-toggle styling)
	let viewMode: MediaViewMode = 'grid';
	const viewToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const viewIcons: Record<MediaViewMode, string> = { grid: 'layout-grid', list: 'list' };
	const buildViewToggle = (): void => {
		viewToggle.empty();
		(['grid', 'list'] as MediaViewMode[]).forEach((mode) => {
			const btn = viewToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (mode === viewMode ? ' active' : ''),
			});
			setIcon(btn, viewIcons[mode]);
			btn.addEventListener('click', () => { viewMode = mode; currentPage = 1; buildViewToggle(); render(); });
		});
	};
	buildViewToggle();

	// Thumbnail size toggle (small / medium / large) — affects the grid view.
	// The choice persists via localStorage (same channel the note popover uses
	// for its edit/preview mode), shared across every media section.
	let thumbSize: ThumbSize = readStoredThumbSize(app);
	const sizeToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle dashboard-media-size-toggle' });
	const sizeLabels: Record<ThumbSize, string> = { small: 'S', medium: 'M', large: 'L' };
	const buildSizeToggle = (): void => {
		sizeToggle.empty();
		(['small', 'medium', 'large'] as ThumbSize[]).forEach((s) => {
			const btn = sizeToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (s === thumbSize ? ' active' : ''),
				attr: { 'aria-label': t('media.size' + s.charAt(0).toUpperCase() + s.slice(1)) },
			});
			btn.textContent = sizeLabels[s];
			btn.addEventListener('click', () => {
				thumbSize = s;
				app.saveLocalStorage(THUMB_SIZE_STORAGE_KEY, s);
				buildSizeToggle();
				render();
			});
		});
	};
	buildSizeToggle();

	// Filter funnel: tags + date range (created/modified) + folder path
	const filterBtn = toolbar.createDiv({ cls: 'dashboard-library-filter-btn' });
	setIcon(filterBtn, 'filter');
	filterBtn.title = t('media.quickFilter');
	const filterTagBar = toolbar.createDiv({ cls: 'dashboard-library-filter-tags' });

	let filterProp: 'created' | 'modified' = 'modified';
	let filterStart = '';
	let filterEnd = '';
	let filterFolders: string[] = [];
	let filterTags: string[] = [];
	let filterPopup: HTMLElement | null = null;
	let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	const folderNorm = (f: string): string => f.trim().replace(/^\/+|\/+$/g, '');

	function mediaPassesFilters(r: MediaFileResult): boolean {
		if (filterTags.length > 0 && !r.tags.some(tag => filterTags.includes(tag))) return false;
		if (filterStart || filterEnd) {
			const ts = filterProp === 'created' ? r.ctime : r.mtime;
			const d = formatDate(ts);
			if (filterStart && d < filterStart) return false;
			if (filterEnd && d > filterEnd) return false;
		}
		const folders = filterFolders.map(folderNorm).filter(Boolean);
		if (folders.length > 0) {
			const lp = r.path.toLowerCase();
			if (!folders.some(f => lp.startsWith(f.toLowerCase() + '/'))) return false;
		}
		return true;
	}

	function hasMediaFilter(): boolean {
		return !!(filterStart || filterEnd || filterFolders.length > 0 || filterTags.length > 0);
	}

	function renderMediaFilterTags(): void {
		filterTagBar.empty();
		for (const tag of filterTags) {
			const chip = filterTagBar.createDiv({ cls: 'dashboard-library-filter-tag dashboard-library-filter-tag--tag' });
			chip.createSpan({ cls: 'dashboard-library-filter-tag-label', text: `#${tag}` });
			chip.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => {
				filterTags = filterTags.filter(tg => tg !== tag);
				refreshMedia();
			});
		}
		if (filterStart || filterEnd) {
			const start = filterStart || '...';
			const end = filterEnd || '...';
			const tag = filterTagBar.createDiv({ cls: 'dashboard-library-filter-tag', text: `${filterProp}: ${start} ~ ${end}` });
			tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => { filterStart = ''; filterEnd = ''; refreshMedia(); });
		}
		for (const folder of filterFolders) {
			const norm = folderNorm(folder);
			if (!norm) continue;
			const tag = filterTagBar.createDiv({ cls: 'dashboard-library-filter-tag' });
			const label = tag.createSpan({ cls: 'dashboard-library-filter-tag-label', text: norm.split('/').filter(Boolean).pop() ?? norm });
			label.title = norm;
			tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => { filterFolders = filterFolders.filter(f => f !== folder); refreshMedia(); });
		}
	}

	function refreshMedia(): void {
		currentPage = 1;
		render();
		renderMediaFilterTags();
		filterBtn.classList.toggle('active', hasMediaFilter());
	}

	function closeMediaPopup(): void {
		if (outsideClickHandler) {
			activeDocument.removeEventListener('click', outsideClickHandler);
			outsideClickHandler = null;
		}
		if (filterPopup) { filterPopup.remove(); filterPopup = null; }
	}

	function toggleFilterTag(tag: string, chipsHost: HTMLElement): void {
		filterTags = filterTags.includes(tag)
			? filterTags.filter(tg => tg !== tag)
			: [...filterTags, tag];
		refreshMedia();
		if (filterPopup) {
			renderTagsSelector(chipsHost, tagService?.getAllTags() ?? [], filterTags, (tg) => toggleFilterTag(tg, chipsHost));
		}
	}

	function openMediaPopup(): void {
		closeMediaPopup();
		filterPopup = activeDocument.body.createDiv({ cls: 'dashboard-library-filter-popup' });
		const dashboardRoot = filterBtn.closest<HTMLElement>('.apex-dashboard-root');
		if (dashboardRoot) {
			const rs = getComputedStyle(dashboardRoot);
			['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
				'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font',
				'--db-bg-input', '--db-bg-hover', '--db-bg-btn', '--db-text-normal', '--db-border-input'].forEach(v => {
				const val = rs.getPropertyValue(v).trim();
				if (val) filterPopup!.style.setProperty(v, val);
			});
		}
		const rect = filterBtn.getBoundingClientRect();
		filterPopup.setCssProps({
			position: 'fixed',
			top: `${rect.bottom + 4}px`,
			left: `${rect.left}px`,
			zIndex: '10000',
		});

		if (tagService) {
			const tagRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			tagRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('media.filterTags') });
			const tagChipsHost = tagRow.createDiv({ cls: 'dashboard-library-filter-chips' });
			renderTagsSelector(tagChipsHost, tagService.getAllTags(), filterTags, (tag) => toggleFilterTag(tag, tagChipsHost));
		}

		const propRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
		propRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('library.filterProperty') });
		const propSelect = propRow.createEl('select', { cls: 'dashboard-library-filter-popup-prop' });
		propSelect.createEl('option', { text: t('library.created'), attr: { value: 'created' } });
		propSelect.createEl('option', { text: t('library.modified'), attr: { value: 'modified' } });
		propSelect.value = filterProp;
		propSelect.addEventListener('change', () => { filterProp = propSelect.value as 'created' | 'modified'; refreshMedia(); });

		const dateRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
		dateRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('library.filterDateRange') });
		const dateWrap = dateRow.createDiv({ cls: 'dashboard-media-filter-dates' });
		const startInput = dateWrap.createEl('input', { cls: 'dashboard-media-filter-date', attr: { type: 'date', value: filterStart } });
		startInput.addEventListener('change', () => { filterStart = startInput.value; refreshMedia(); });
		const endInput = dateWrap.createEl('input', { cls: 'dashboard-media-filter-date', attr: { type: 'date', value: filterEnd } });
		endInput.addEventListener('change', () => { filterEnd = endInput.value; refreshMedia(); });

		const folderRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
		folderRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('media.filterFolder') });
		const folderChipsHost = folderRow.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const folderAddRow = folderRow.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const folderInput = folderAddRow.createEl('input', { cls: 'dashboard-media-filter-folder', attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder') } });
		const folderBrowseBtn = folderAddRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		folderBrowseBtn.addEventListener('click', () => {
			// Multi-select: pick every filter folder at once. Filter folders are OR
			// unions, so parents/children stay independently tickable.
			new MultiFolderSelectModal(app, filterFolders, (folders) => {
				filterFolders = folders;
				refreshMedia();
				renderFolderChips();
			}).open();
		});
		const renderFolderChips = (): void => {
			folderChipsHost.empty();
			if (filterFolders.length === 0) {
				folderChipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('folder.noFolders') });
				return;
			}
			for (const folder of filterFolders) {
				const chip = folderChipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: folderNorm(folder) });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					filterFolders = filterFolders.filter(f => f !== folder);
					refreshMedia();
					renderFolderChips();
				});
			}
		};
		const addFilterFolder = (): void => {
			const folder = folderNorm(folderInput.value);
			folderInput.value = '';
			if (!folder) return;
			if (filterFolders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			filterFolders = [...filterFolders, folder];
			refreshMedia();
			renderFolderChips();
		};
		folderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFilterFolder(); } });
		renderFolderChips();
		folderRow.createDiv({ cls: 'dashboard-library-config-hint', text: t('media.filterFolderHint') });

		if (hasMediaFilter()) {
			const clearBtn = filterPopup.createEl('button', { cls: 'dashboard-library-filter-popup-clear', text: t('reminder.clearReminder') });
			clearBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				filterStart = ''; filterEnd = ''; filterFolders = []; filterTags = [];
				refreshMedia();
				closeMediaPopup();
			});
		}

		// Outside-click-to-close: registered when the popup opens and removed
		// when it closes (closeMediaPopup) so it never accumulates across renders.
		outsideClickHandler = (e: MouseEvent): void => {
			if (!filterPopup) return;
			const target = e.target as Node;
			if (filterPopup.contains(target) || filterBtn.contains(target)) return;
			if (target.instanceOf(Element) && target.closest('.modal-container')) return;
			closeMediaPopup();
		};
		window.setTimeout(() => activeDocument.addEventListener('click', outsideClickHandler!), 0);
	}

	filterBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (filterPopup) closeMediaPopup(); else openMediaPopup();
	});

	let pageSize = 20;
	toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
	const countEl = toolbar.createDiv({ cls: 'dashboard-library-count' });
	const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
	for (const size of PAGE_SIZE_OPTIONS) {
		const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: size }), attr: { value: String(size) } });
		if (size === pageSize) opt.selected = true;
	}
	pageSizeSelect.addEventListener('change', () => {
		pageSize = parseInt(pageSizeSelect.value) || 20;
		currentPage = 1;
		render();
	});

	const resultArea = content.createDiv({ cls: 'dashboard-media-area' });
	const paginationArea = content.createDiv({ cls: 'dashboard-library-pagination' });

	let currentPage = 1;

	async function deleteWithConfirm(file: TFile): Promise<void> {
		const confirmed = await showConfirmDialog(app, {
			title: t('common.confirmDelete'),
			message: t('media.confirmDelete', { name: file.basename }),
		});
		if (!confirmed) return;
		try {
			await trashMediaFile(app, file);
			new Notice(t('media.deleted'));
			render();
		} catch (err) {
			console.error('[Dashboard] media delete failed:', err);
		}
	}

	function render(): void {
		// Teardown: disconnect the previous lazy mounter and release every
		// <video> decoder before clearing the DOM, so re-renders (search/sort/
		// page/filter) don't leak decoders — the main cause of memory growth.
		const prevMounter = sectionMounters.get(el);
		if (prevMounter) prevMounter.disconnect();
		releaseVideoMedia(resultArea);
		resultArea.empty();
		paginationArea.empty();

		let results = queryMediaFiles(app, exts!, column.libraryConfig?.excludeFolders ?? [], tagService);
		const q = searchInput.value.trim().toLowerCase();
		if (q) {
			results = results.filter(r => r.basename.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
		}
		results = results.filter(mediaPassesFilters);
		sortMedia(results, sortBy, sortDesc);

		countEl.textContent = t('library.fileCount', { count: results.length });

		if (results.length === 0) {
			resultArea.createDiv({
				cls: 'dashboard-library-empty',
				text: t(kind === 'video' ? 'media.noVideos' : 'media.noImages'),
			});
			return;
		}

		const totalPages = Math.ceil(results.length / pageSize);
		if (currentPage > totalPages) currentPage = totalPages;
		if (currentPage < 1) currentPage = 1;
		const start = (currentPage - 1) * pageSize;
		const page = results.slice(start, start + pageSize);

		const openTagEditor = (result: MediaFileResult): void => {
			if (!tagService) return;
			new MediaTagEditModal(
				app,
				result.file,
				tagService.getTags(result.path),
				tagService.getAllTags(),
				(tags) => {
					if (tagService.setTags(result.path, tags)) render();
				},
			).open();
		};

		const tagHooks = tagService ? {
			getTags: (file: TFile) => tagService.getTags(file.path),
			getAllTags: () => tagService.getAllTags(),
			onTagsChange: (file: TFile, tags: string[]) => { tagService.setTags(file.path, tags); },
		} : undefined;

		const openLightbox = (pageIndex: number): void => {
			new MediaLightboxModal(app, results.map(r => r.file), start + pageIndex, kind, tagHooks).open();
		};

		// One lazy mounter per render: desktop video tiles mount a real <video>
		// only when scrolled into view; mobile stays on static placeholders
		// (mounter is null) so no decoder is ever created on the board.
		const mounter = createLazyVideoMounter();
		if (mounter) sectionMounters.set(el, mounter);
		else sectionMounters.delete(el);

		const deleteCb = (f: TFile): void => { void deleteWithConfirm(f); };

		// Grouped rendering: headers + per-group grid/list, everything shown,
		// no paginator (slicing pages would tear the groups apart). The lightbox
		// walks the flattened group order, so next/prev match what's on screen.
		if (groupBy !== 'none') {
			const groups = groupMediaResults(results, groupBy);
			const displayFiles = groups.flatMap(g => g.items.map(r => r.file));
			const openGroupLightbox = (displayIndex: number): void => {
				new MediaLightboxModal(app, displayFiles, displayIndex, kind, tagHooks).open();
			};
			for (const group of groups) {
				const collapsed = collapsedGroups.has(group.key);
				const header = resultArea.createDiv({
					cls: 'dashboard-media-group-header' + (collapsed ? ' is-collapsed' : ''),
				});
				const chevron = header.createDiv({ cls: 'dashboard-media-group-chevron' });
				setIcon(chevron, collapsed ? 'chevron-right' : 'chevron-down');
				header.createDiv({ cls: 'dashboard-media-group-name', text: group.key });
				header.createDiv({ cls: 'dashboard-media-group-count', text: String(group.items.length) });
				const body = resultArea.createDiv({ cls: 'dashboard-media-group-body' });
				if (collapsed) body.addClass('is-hidden');
				// Collapse in place (no vault re-query): flip the set and the
				// two elements' classes/chevron directly.
				header.addEventListener('click', () => {
					if (collapsedGroups.has(group.key)) {
						collapsedGroups.delete(group.key);
						header.removeClass('is-collapsed');
						body.removeClass('is-hidden');
						setIcon(chevron, 'chevron-down');
					} else {
						collapsedGroups.add(group.key);
						header.addClass('is-collapsed');
						body.addClass('is-hidden');
						setIcon(chevron, 'chevron-right');
					}
				});
				const onOpen = (i: number): void => openGroupLightbox(group.offset + i);
				if (viewMode === 'grid') {
					renderMediaGrid(body, group.items, app, kind, thumbSize, onOpen, deleteCb, mounter, openTagEditor);
				} else {
					renderMediaList(body, group.items, app, kind, onOpen, deleteCb, render, onOpenNote, mounter, openTagEditor);
				}
			}
			return;
		}

		if (viewMode === 'grid') {
			renderMediaGrid(resultArea, page, app, kind, thumbSize, openLightbox, deleteCb, mounter, openTagEditor);
		} else {
			renderMediaList(resultArea, page, app, kind, openLightbox, deleteCb, render, onOpenNote, mounter, openTagEditor);
		}

		if (totalPages > 1) {
			renderPagination(paginationArea, currentPage, totalPages, results.length, (p) => {
				currentPage = p;
				render();
			});
		}
	}

	searchInput.addEventListener('input', () => { currentPage = 1; render(); });
	sortSelect.addEventListener('change', () => { sortBy = sortSelect.value; currentPage = 1; render(); });

	render();
}

export { isMediaSection };
