import { App, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import type { DashboardColumn } from './types';
import { resolveVaultImage } from './banner';
import { t } from './i18n';
import { showConfirmDialog } from './confirm-dialog';
import { MediaLightboxModal } from './media-lightbox-modal';
import { renderPagination } from './library-section';
import { FolderSuggestModal } from './folder-config-modal';

/** Image file extensions shown in an images section (excludes pdf). */
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
/** Video file extensions shown in a videos section. */
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);

const PAGE_SIZE_OPTIONS = [20, 50, 100];

type MediaViewMode = 'grid' | 'list' | 'table';
type ThumbSize = 'small' | 'medium' | 'large';

interface MediaFileResult {
	file: TFile;
	basename: string;
	path: string;
	mtime: number;
	ctime: number;
	ext: string;
	size: number;
}

function extsFor(sectionType: string): Set<string> | null {
	if (sectionType === 'images') return IMAGE_EXTS;
	if (sectionType === 'videos') return VIDEO_EXTS;
	return null;
}

function isMediaSection(sectionType: string): boolean {
	return sectionType === 'images' || sectionType === 'videos';
}

function queryMediaFiles(app: App, exts: Set<string>): MediaFileResult[] {
	const results: MediaFileResult[] = [];
	for (const file of app.vault.getFiles()) {
		if (file.path.startsWith('.')) continue;
		if (!exts.has(file.extension)) continue;
		results.push({
			file,
			basename: file.basename,
			path: file.path,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			ext: file.extension,
			size: file.stat.size,
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

function formatDate(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Human-readable file size for the static video placeholder badge. */
function formatFileSize(bytes: number): string {
	if (!bytes || bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let val = bytes / 1024;
	let i = 0;
	while (val >= 1024 && i < units.length - 1) {
		val /= 1024;
		i++;
	}
	return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
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

/** Static placeholder shown for video tiles until (desktop) a real `<video>` is
 *  lazily mounted, or always (mobile, where no `<video>` is ever created). */
function renderVideoThumbPlaceholder(parent: HTMLElement, result: MediaFileResult, showSize: boolean): void {
	const ph = parent.createDiv({ cls: 'dashboard-media-thumb dashboard-media-thumb--video-placeholder' });
	setIcon(ph.createDiv({ cls: 'dashboard-media-thumb-icon' }), 'film');
	if (showSize) {
		const size = formatFileSize(result.size);
		if (size) ph.createDiv({ cls: 'dashboard-media-size-badge', text: size });
	}
}

/** Notes that link to or embed the given media file (backlinks via resolvedLinks). */
function getMediaBacklinks(app: App, file: TFile): TFile[] {
	const target = file.path;
	const out: TFile[] = [];
	const resolved = app.metadataCache.resolvedLinks;
	for (const [srcPath, targets] of Object.entries(resolved)) {
		if (targets[target]) {
			const src = app.vault.getFileByPath(srcPath);
			if (src) out.push(src);
		}
	}
	out.sort((a, b) => a.basename.localeCompare(b.basename));
	return out;
}

/** Render backlinks as clickable chips that open the note in a popover. */
function appendBacklinks(container: HTMLElement, files: TFile[], onOpenNote?: (file: TFile) => void): void {
	if (files.length === 0) {
		container.createDiv({ cls: 'dashboard-media-no-links', text: '—' });
		return;
	}
	const wrap = container.createDiv({ cls: 'dashboard-media-backlinks' });
	for (const f of files.slice(0, 5)) {
		const chip = wrap.createDiv({ cls: 'dashboard-media-backlink', text: f.basename });
		chip.title = f.path;
		chip.setAttribute('role', 'button');
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			onOpenNote?.(f);
		});
	}
	if (files.length > 5) {
		wrap.createDiv({ cls: 'dashboard-media-backlink dashboard-media-backlink--more', text: `+${files.length - 5}` });
	}
}

/** Rename a media file; fileManager.renameFile updates all [[links]]/![[embeds]] automatically. */
async function renameMediaFile(app: App, file: TFile, newBasename: string): Promise<void> {
	const name = newBasename.trim();
	if (!name || name === file.basename) return;
	const parentPath = file.parent ? file.parent.path : '';
	const newPath = parentPath ? `${parentPath}/${name}.${file.extension}` : `${name}.${file.extension}`;
	await app.fileManager.renameFile(file, newPath);
}

/** Move a media file to the trash (recoverable) via the file manager so the
 *  user's "delete to trash vs permanent" preference is respected. */
async function trashMediaFile(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}

/**
 * Render an images or videos section: compact toolbar (search + sort +
 * direction + grid/list/table toggle + count) over a paginated view.
 * Grid shows a thumbnail wall; list/table add delete buttons; table lets you
 * rename a file (updating backlinks). Clicking a thumbnail opens the lightbox.
 */
export function renderMediaSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	_hoverParent: HoverParent | null,
	onOpenNote?: (file: TFile) => void,
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

	// View mode toggle (reuses library's view-toggle styling)
	let viewMode: MediaViewMode = 'grid';
	const viewToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const viewIcons: Record<MediaViewMode, string> = { grid: 'layout-grid', list: 'list', table: 'table' };
	const buildViewToggle = (): void => {
		viewToggle.empty();
		(['grid', 'list', 'table'] as MediaViewMode[]).forEach((mode) => {
			const btn = viewToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (mode === viewMode ? ' active' : ''),
			});
			setIcon(btn, viewIcons[mode]);
			btn.addEventListener('click', () => { viewMode = mode; currentPage = 1; buildViewToggle(); render(); });
		});
	};
	buildViewToggle();

	// Thumbnail size toggle (small / medium / large) — affects the grid view
	let thumbSize: ThumbSize = 'medium';
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
			btn.addEventListener('click', () => { thumbSize = s; buildSizeToggle(); render(); });
		});
	};
	buildSizeToggle();

	// Filter funnel: date range (created/modified) + folder path
	const filterBtn = toolbar.createDiv({ cls: 'dashboard-library-filter-btn' });
	setIcon(filterBtn, 'filter');
	filterBtn.title = t('media.quickFilter');
	const filterTagBar = toolbar.createDiv({ cls: 'dashboard-library-filter-tags' });

	let filterProp: 'created' | 'modified' = 'modified';
	let filterStart = '';
	let filterEnd = '';
	let filterFolder = '';
	let filterPopup: HTMLElement | null = null;
	let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	const folderNorm = (f: string): string => f.trim().replace(/^\/+|\/+$/g, '');

	function mediaPassesFilters(r: MediaFileResult): boolean {
		if (filterStart || filterEnd) {
			const ts = filterProp === 'created' ? r.ctime : r.mtime;
			const d = formatDate(ts);
			if (filterStart && d < filterStart) return false;
			if (filterEnd && d > filterEnd) return false;
		}
		const folder = folderNorm(filterFolder);
		if (folder && !r.path.toLowerCase().startsWith(folder.toLowerCase() + '/')) return false;
		return true;
	}

	function hasMediaFilter(): boolean {
		return !!(filterStart || filterEnd || folderNorm(filterFolder));
	}

	function renderMediaFilterTags(): void {
		filterTagBar.empty();
		if (filterStart || filterEnd) {
			const start = filterStart || '...';
			const end = filterEnd || '...';
			const tag = filterTagBar.createDiv({ cls: 'dashboard-library-filter-tag', text: `${filterProp}: ${start} ~ ${end}` });
			tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => { filterStart = ''; filterEnd = ''; refreshMedia(); });
		}
		const folder = folderNorm(filterFolder);
		if (folder) {
			const tag = filterTagBar.createDiv({ cls: 'dashboard-library-filter-tag', text: folder });
			tag.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => { filterFolder = ''; refreshMedia(); });
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
		const folderInputWrap = folderRow.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const folderInput = folderInputWrap.createEl('input', { cls: 'dashboard-media-filter-folder', attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder'), value: filterFolder } });
		folderInput.addEventListener('change', () => { filterFolder = folderInput.value; refreshMedia(); });
		const browseBtn = folderInputWrap.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		browseBtn.addEventListener('click', () => {
			new FolderSuggestModal(app, (folder) => {
				folderInput.value = folder.path;
				filterFolder = folder.path;
				refreshMedia();
			}).open();
		});
		folderRow.createDiv({ cls: 'dashboard-library-config-hint', text: t('media.filterFolderHint') });

		if (hasMediaFilter()) {
			const clearBtn = filterPopup.createEl('button', { cls: 'dashboard-library-filter-popup-clear', text: t('reminder.clearReminder') });
			clearBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				filterStart = ''; filterEnd = ''; filterFolder = '';
				refreshMedia();
				closeMediaPopup();
			});
		}

		// Outside-click-to-close: registered when the popup opens and removed
		// when it closes (closeMediaPopup) so it never accumulates across renders.
		outsideClickHandler = (e: MouseEvent): void => {
			if (filterPopup && !filterPopup.contains(e.target as Node) && !filterBtn.contains(e.target as Node)) {
				closeMediaPopup();
			}
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

		let results = queryMediaFiles(app, exts!);
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

		const openLightbox = (pageIndex: number): void => {
			new MediaLightboxModal(app, results.map(r => r.file), start + pageIndex, kind).open();
		};

		// One lazy mounter per render: desktop video tiles mount a real <video>
		// only when scrolled into view; mobile stays on static placeholders
		// (mounter is null) so no decoder is ever created on the board.
		const mounter = createLazyVideoMounter();
		if (mounter) sectionMounters.set(el, mounter);
		else sectionMounters.delete(el);

		if (viewMode === 'grid') {
			renderMediaGrid(resultArea, page, app, kind, thumbSize, openLightbox, (f) => { void deleteWithConfirm(f); }, mounter);
		} else if (viewMode === 'list') {
			renderMediaList(resultArea, page, app, kind, openLightbox, (f) => { void deleteWithConfirm(f); }, onOpenNote, mounter);
		} else {
			renderMediaTable(resultArea, page, app, kind, openLightbox, (f) => { void deleteWithConfirm(f); }, render, onOpenNote);
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

function renderMediaGrid(
	container: HTMLElement,
	results: MediaFileResult[],
	app: App,
	kind: 'image' | 'video',
	thumbSize: ThumbSize,
	onOpen: (index: number) => void,
	onDelete: (file: TFile) => void,
	mounter: LazyVideoMounter | null,
): void {
	const grid = container.createDiv({ cls: `dashboard-media-grid dashboard-media-grid--${thumbSize}` });

	for (let i = 0; i < results.length; i++) {
		const result = results[i]!;
		const src = resolveVaultImage(app, result.path);
		const item = grid.createDiv({ cls: 'dashboard-media-item' });

		if (src) {
			if (kind === 'image') {
				item.createEl('img', {
					cls: 'dashboard-media-thumb',
					attr: { src, alt: result.basename, loading: 'lazy' },
				});
			} else {
				// Static placeholder first; on desktop a real <video> is lazily
				// mounted only when this tile scrolls into view (mounter.observe),
				// on mobile no <video> is ever created on the board.
				renderVideoThumbPlaceholder(item, result, true);
				if (mounter) mounter.observe(item, src);
				const play = item.createDiv({ cls: 'dashboard-media-play' });
				setIcon(play, 'play');
			}
		} else {
			item.createDiv({ cls: 'dashboard-media-thumb dashboard-media-thumb--broken' });
		}

		const name = item.createDiv({ cls: 'dashboard-media-name', text: result.basename });
		name.title = `${result.path}\n${formatDate(result.mtime)}`;

		const delBtn = item.createEl('button', {
			cls: 'dashboard-qa-remove dashboard-media-delete',
			attr: { 'aria-label': t('media.delete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(result.file); });

		item.addEventListener('click', () => onOpen(i));
		item.setAttribute('role', 'button');
	}
}

function renderMediaList(
	container: HTMLElement,
	results: MediaFileResult[],
	app: App,
	kind: 'image' | 'video',
	onOpen: (index: number) => void,
	onDelete: (file: TFile) => void,
	onOpenNote?: (file: TFile) => void,
	mounter: LazyVideoMounter | null = null,
): void {
	const list = container.createDiv({ cls: 'dashboard-media-list' });
	for (let i = 0; i < results.length; i++) {
		const result = results[i]!;
		const row = list.createDiv({ cls: 'dashboard-media-list-row' });
		row.setAttribute('role', 'button');

		// Small thumbnail
		const src = resolveVaultImage(app, result.path);
		const thumb = row.createDiv({ cls: 'dashboard-media-list-thumb' });
		if (src) {
			if (kind === 'image') {
				thumb.createEl('img', { attr: { src, alt: result.basename, loading: 'lazy' } });
			} else {
				renderVideoThumbPlaceholder(thumb, result, false);
				if (mounter) mounter.observe(thumb, src);
			}
		}

		const info = row.createDiv({ cls: 'dashboard-media-list-info' });
		info.createDiv({ cls: 'dashboard-media-list-name', text: result.basename });
		info.createDiv({ cls: 'dashboard-media-list-meta', text: `${result.path} · ${formatDate(result.mtime)}` });
		appendBacklinks(info, getMediaBacklinks(app, result.file), onOpenNote);

		const delBtn = row.createEl('button', {
			cls: 'dashboard-library-page-btn dashboard-media-delete',
			attr: { 'aria-label': t('media.delete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(result.file); });

		row.addEventListener('click', () => onOpen(i));
	}
}

function renderMediaTable(
	container: HTMLElement,
	results: MediaFileResult[],
	app: App,
	kind: 'image' | 'video',
	onOpen: (index: number) => void,
	onDelete: (file: TFile) => void,
	refresh: () => void,
	onOpenNote?: (file: TFile) => void,
): void {
	const wrap = container.createDiv({ cls: 'dashboard-media-table-wrap' });
	const table = wrap.createEl('table', { cls: 'dashboard-library-table dashboard-media-table' });

	const thead = table.createEl('thead');
	const headRow = thead.createEl('tr');
	headRow.createEl('th', { text: t('media.colName'), cls: 'dashboard-media-table-name-col' });
	[t('media.colModified'), t('media.colCreated'), t('media.colPath'), t('media.colLinks'), ''].forEach((label) => {
		headRow.createEl('th', { text: label });
	});

	const tbody = table.createEl('tbody');
	for (let i = 0; i < results.length; i++) {
		const result = results[i]!;
		const tr = tbody.createEl('tr');

		const nameTd = tr.createEl('td', { cls: 'dashboard-library-table-name dashboard-media-table-name-col', text: result.basename });
		nameTd.title = result.basename;
		nameElClick(nameTd, result, app, refresh);
		tr.createEl('td', { text: formatDate(result.mtime) });
		tr.createEl('td', { text: formatDate(result.ctime) });
		const pathTd = tr.createEl('td', { cls: 'dashboard-media-table-path', text: result.path });
		pathTd.title = result.path;

		const linksTd = tr.createEl('td', { cls: 'dashboard-media-table-links' });
		appendBacklinks(linksTd, getMediaBacklinks(app, result.file), onOpenNote);

		const opTd = tr.createEl('td', { cls: 'dashboard-media-table-op' });
		const openBtn = opTd.createEl('button', {
			cls: 'dashboard-library-page-btn',
			attr: { 'aria-label': result.basename },
		});
		openBtn.title = result.basename;
		setIcon(openBtn, kind === 'video' ? 'play' : 'maximize-2');
		openBtn.addEventListener('click', (e) => { e.stopPropagation(); onOpen(i); });

		const delBtn = opTd.createEl('button', {
			cls: 'dashboard-library-page-btn dashboard-media-delete',
			attr: { 'aria-label': t('media.delete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(result.file); });
	}
}

/** Double-click the name cell to rename the file (backlinks update automatically). */
function nameElClick(td: HTMLElement, result: MediaFileResult, app: App, refresh: () => void): void {
	td.addClass('dashboard-media-table-name-cell');
	td.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		if (td.querySelector('input')) return;
		const original = result.basename;
		td.empty();
		const input = td.createEl('input', {
			cls: 'dashboard-library-table-edit-input',
			attr: { type: 'text', value: original },
		});
		input.focus();
		input.select();

		const finish = async (save: boolean): Promise<void> => {
			if (!input.isConnected) return;
			const raw = input.value.trim();
			input.remove();
			if (!save || !raw || raw === original) {
				td.textContent = original;
				return;
			}
			td.textContent = raw;
			try {
				await renameMediaFile(app, result.file, raw);
				refresh();
			} catch (err) {
				console.error('[Dashboard] media rename failed:', err);
				new Notice(t('media.renameFailed'));
				td.textContent = original;
			}
		};

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') { ke.preventDefault(); void finish(true); }
			else if (ke.key === 'Escape') { ke.preventDefault(); void finish(false); }
		});
		input.addEventListener('blur', () => { void finish(true); });
	});
}

export { isMediaSection };
