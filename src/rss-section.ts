/**
 * RSS section renderer: a mixed reverse-chronological list across all
 * configured feeds (source chip + title + date + per-row download), with an
 * in-section toolbar (unread/all filter, mark-all-read). Like web-section and
 * dataview-section there is deliberately no vault-event wiring — feed content
 * refreshes on staleness (rss-store TTL) or the header refresh button, and an
 * epoch guard drops late async callbacks from superseded renders.
 */

import { App, Notice, setIcon } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import { getRssStore, type RssStore } from './rss-store';
import { feedKey, refreshFeeds, resolveArticleMarkdown, type RssTextFetcher } from './rss-service';
import type { RssItem } from './rss-xml';
import { RssArticleModal } from './rss-article-modal';
import { saveRssArticle } from './rss-note';
import { momentOf } from './datetime';
import { captureScrollStates, restoreScrollStates } from './scroll-preserve';
import { createToolbarDropdown, type ToolbarDropdownItem } from './toolbar-dropdown';
import { renderPagination } from './library-section';

/** Test seams only — production call sites (renderer) pass neither. */
export interface RssRenderOptions {
	fetcher?: RssTextFetcher;
	store?: RssStore;
}

/** Page sizes (library-section idiom): the toolbar select persists one of
 *  these onto the section config. */
const RSS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];
const RSS_DEFAULT_PAGE_SIZE = 20;

interface RssRow {
	feedUrl: string;
	feedTitle: string;
	/** Configured group label ('' when the feed is ungrouped). */
	feedGroup: string;
	item: RssItem;
}

/** Dropdown key prefix for a per-group filter bucket. */
const GROUP_KEY = 'group:';
/** Dropdown key prefix for a per-feed filter bucket (groupBy: 'feed'). */
const FEED_KEY = 'feed:';

/** Effective group labels: the managed list in config order first, then any
 *  group a feed references that the list lost (hand-edited files, a deleted
 *  group with a dangling reference) — those still form working buckets. */
export function rssGroupNames(config: { groups?: string[]; feeds: ReadonlyArray<{ group?: string }> }): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const push = (name: string): void => {
		if (!name || seen.has(name)) return;
		seen.add(name);
		out.push(name);
	};
	for (const group of config.groups ?? []) push(group.trim());
	for (const feed of config.feeds) push((feed.group ?? '').trim());
	return out;
}

export function renderRssSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	reloadRegister: (fn: () => void) => void,
	options?: RssRenderOptions,
): void {
	const config = column.rssConfig ?? { feeds: [], downloadFolder: '' };
	const store = options?.store ?? getRssStore(app);
	const content = el.createDiv({ cls: 'dashboard-rss-content' });

	// Async-race guard: every run() bumps the epoch; late callbacks from a
	// superseded run (refresh, in-place section rebuild) compare and drop.
	let epoch = 0;
	// Toolbar filter: 'all' | 'unread' | `group:<name>` (feed groups are the
	// third filter dimension, configured per source in the section config).
	let filterKey: string = 'all';
	// Pagination (library idiom): page resets on filter changes; a page-size
	// change rebuilds the whole section (config round trip) and starts at 1.
	let currentPage = 1;
	let pending = true;
	let refreshing = false;

	const feedLinkOf = (feedUrl: string): string => store.feedEntry(feedUrl)?.link ?? '';

	function collectRows(): RssRow[] {
		const rows: RssRow[] = [];
		for (const source of config.feeds) {
			const key = feedKey(source.url);
			const entry = store.feedEntry(key);
			const title = source.name?.trim() || entry?.title || source.url;
			const group = source.group?.trim() ?? '';
			for (const item of entry?.items ?? []) rows.push({ feedUrl: key, feedTitle: title, feedGroup: group, item });
		}
		rows.sort((a, b) => (b.item.pubDate ?? 0) - (a.item.pubDate ?? 0));
		return rows;
	}

	/** Filter predicate for the active toolbar bucket. */
	function rowMatches(row: RssRow): boolean {
		if (filterKey === 'unread') return !store.isRead(row.item.guid);
		if (filterKey.startsWith(GROUP_KEY)) return row.feedGroup === filterKey.slice(GROUP_KEY.length);
		if (filterKey.startsWith(FEED_KEY)) return row.feedUrl === filterKey.slice(FEED_KEY.length);
		return true;
	}

	/** Buckets beyond all/unread, per the config's groupBy: managed groups
	 *  (default), one bucket per feed source, or nothing. Feed buckets come
	 *  from the CONFIG (not cached rows) so they exist before the first
	 *  fetch lands; their counts come from the rows collected for this
	 *  render (0 until the first fetch stores items). */
	function bucketItems(rows: readonly RssRow[]): ToolbarDropdownItem[] {
		if (config.groupBy === 'none') return [];
		if (config.groupBy === 'feed') {
			return config.feeds.map((source): ToolbarDropdownItem => {
				const key = feedKey(source.url);
				const label = source.name?.trim() || store.feedEntry(key)?.title || source.url;
				return {
					key: `${FEED_KEY}${key}`,
					label,
					icon: 'rss',
					count: rows.filter(row => row.feedUrl === key).length,
				};
			});
		}
		return rssGroupNames(config).map((group): ToolbarDropdownItem => ({
			key: `${GROUP_KEY}${group}`,
			label: group,
			icon: 'folder',
			count: rows.filter(row => row.feedGroup === group).length,
		}));
	}

	function renderEmptyConfig(): void {
		content.empty();
		const wrap = content.createDiv({ cls: 'dashboard-rss-empty-config' });
		const icon = wrap.createDiv({ cls: 'dashboard-rss-empty-config-icon' });
		setIcon(icon, 'rss');
		wrap.createDiv({ cls: 'dashboard-rss-empty-config-text', text: t('rss.noFeeds') });
		wrap.createDiv({ cls: 'dashboard-rss-empty-config-hint', text: t('rss.configureHint') });
		const configure = wrap.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('rss.configure'),
			attr: { type: 'button' },
		});
		configure.addEventListener('click', () => {
			el.dispatchEvent(new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true }));
		});
	}

	function renderList(): void {
		content.empty();
		if (config.feeds.length === 0) {
			renderEmptyConfig();
			return;
		}

		const toolbar = content.createDiv({ cls: 'dashboard-rss-toolbar' });
		// One dropdown covers the filter dimensions: everything, unread only,
		// and one bucket per configured group / feed source (groupBy). Every
		// line carries its item count (all/unread included).
		const allRows = collectRows();
		const unreadCount = allRows.filter(row => !store.isRead(row.item.guid)).length;
		const filterItems: ToolbarDropdownItem[] = [
			{ key: 'all', label: t('rss.all'), icon: 'inbox', count: allRows.length },
			{ key: 'unread', label: t('rss.unreadOnly'), icon: 'mail', count: unreadCount },
			...bucketItems(allRows),
		];
		const currentFilterKey = filterItems.some(item => item.key === filterKey) ? filterKey : 'all';
		createToolbarDropdown(toolbar, currentFilterKey, filterItems, key => {
			filterKey = key;
			currentPage = 1; // a new bucket starts from its first page
			renderList();
		});

		if (unreadCount > 0 && currentFilterKey !== 'unread') {
			toolbar.createSpan({ cls: 'dashboard-rss-count', text: t('rss.unreadCount', { count: String(unreadCount) }) });
		}

		const markBtn = toolbar.createDiv({
			cls: 'dashboard-rss-markread',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('rss.markAllRead'), title: t('rss.markAllRead') },
		});
		setIcon(markBtn, 'check-check');
		markBtn.addEventListener('click', () => {
			// The whole filtered set, not just the visible page — "mark all"
			// that matches the current bucket.
			store.markAllRead(collectRows().filter(rowMatches).map(row => row.item.guid));
			renderList();
		});

		if (refreshing) {
			toolbar.createSpan({ cls: 'dashboard-rss-refreshing', text: t('rss.loading') });
		}

		// Page size (library-section idiom): a plain select whose change rides
		// a CustomEvent to view.ts, which persists it and rebuilds the section.
		toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
		const pageSize = config.pageSize ?? RSS_DEFAULT_PAGE_SIZE;
		const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
		for (const size of RSS_PAGE_SIZE_OPTIONS) {
			const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: String(size) }), attr: { value: String(size) } });
			if (size === pageSize) opt.selected = true;
		}
		pageSizeSelect.addEventListener('change', () => {
			const newSize = parseInt(pageSizeSelect.value) || RSS_DEFAULT_PAGE_SIZE;
			el.dispatchEvent(new CustomEvent('dashboard-rss-page-size', {
				detail: { columnName: column.name, pageSize: newSize },
				bubbles: true,
			}));
		});

		const list = content.createDiv({ cls: 'dashboard-rss-list' });
		const filteredRows = allRows.filter(rowMatches);
		const effectivePageSize = config.pageSize ?? RSS_DEFAULT_PAGE_SIZE;
		const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
		if (currentPage > totalPages) currentPage = totalPages;
		const rows = filteredRows.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
		if (rows.length === 0) {
			list.createDiv({
				cls: 'dashboard-rss-empty',
				text: pending || refreshing ? t('rss.loading') : t('rss.noItems'),
			});
		}
		for (const row of rows) renderRow(list, row);

		// Pagination (the library section's shared control + classes).
		if (totalPages > 1) {
			const paginationArea = content.createDiv({ cls: 'dashboard-library-pagination' });
			renderPagination(paginationArea, currentPage, totalPages, filteredRows.length, page => {
				currentPage = page;
				renderList();
				// A page flip reads best from the top of the new page.
				const listEl = content.querySelector('.dashboard-rss-list');
				if (listEl) listEl.scrollTop = 0;
			});
		}

		// Feed failures surface in the CONFIG modal (per-source status), not
		// here — the paginated list stays clean content only.
	}

	function formatRssDate(pubDate?: number): string {
		if (!pubDate) return '';
		const m = momentOf(pubDate);
		return m.isValid() ? m.format('YYYY-MM-DD') : '';
	}

	function renderRow(list: HTMLElement, row: RssRow): void {
		const { item, feedTitle, feedUrl } = row;
		const savedPath = store.savedPath(item.guid);
		const rowEl = list.createDiv({
			cls: `dashboard-rss-item${store.isRead(item.guid) ? ' is-read' : ''}`,
			attr: { role: 'button', tabindex: '0' },
		});
		rowEl.dataset.guid = item.guid;
		rowEl.createDiv({ cls: 'dashboard-rss-dot' });
		const main = rowEl.createDiv({ cls: 'dashboard-rss-item-main' });
		main.createDiv({ cls: 'dashboard-rss-item-title', text: item.title });
		const meta = main.createDiv({ cls: 'dashboard-rss-item-meta' });
		// Date first, feed label second — the trailing label is the one that
		// shrinks (see the meta row's CSS).
		const date = formatRssDate(item.pubDate);
		if (date) meta.createSpan({ cls: 'dashboard-rss-item-date', text: date });
		meta.createSpan({ cls: 'dashboard-rss-item-feed', text: feedTitle });

		const saveBtn = rowEl.createEl('button', {
			cls: 'dashboard-rss-item-save',
			attr: {
				type: 'button',
				'aria-label': savedPath ? t('rss.openNote') : t('rss.download'),
				title: savedPath ? t('rss.openNote') : t('rss.download'),
			},
		});
		setIcon(saveBtn, savedPath ? 'file-text' : 'download');
		saveBtn.addEventListener('click', (ev) => {
			ev.stopPropagation();
			void handleSaveClick(feedTitle, feedUrl, item, saveBtn);
		});

		rowEl.addEventListener('click', () => openReader(row, rowEl));
		rowEl.addEventListener('keydown', (ev) => {
			const key = (ev as KeyboardEvent).key;
			if (key === 'Enter' || key === ' ') {
				ev.preventDefault();
				openReader(row, rowEl);
			}
		});
	}

	function openReader(row: RssRow, rowEl?: HTMLElement): void {
		// Read marking is in-place: only the row's class flips, the list never
		// rebuilds from a click (scroll position and hover stay untouched).
		if (!store.isRead(row.item.guid)) {
			store.markRead(row.item.guid);
			rowEl?.addClass('is-read');
		}
		new RssArticleModal({
			app,
			store,
			feedTitle: row.feedTitle,
			feedLink: feedLinkOf(row.feedUrl),
			item: row.item,
			downloadFolder: config.downloadFolder,
			fetcher: options?.fetcher,
			onDownloaded: (guid, path) => syncSaveButtons(guid, path),
		}).open();
	}

	/** Flip every rendered row for `guid` to the already-saved state (the
	 *  download may have happened inside the reader modal). */
	function syncSaveButtons(guid: string, path: string): void {
		void path;
		for (const itemEl of Array.from(content.querySelectorAll('.dashboard-rss-item'))) {
			if (itemEl.getAttribute('data-guid') !== guid) continue;
			const btn = itemEl.querySelector('.dashboard-rss-item-save');
			if (btn) {
				setIcon(btn as HTMLElement, 'file-text');
				btn.setAttribute('aria-label', t('rss.openNote'));
				btn.setAttribute('title', t('rss.openNote'));
			}
		}
	}

	async function handleSaveClick(feedTitle: string, feedUrl: string, item: RssItem, btn: HTMLElement): Promise<void> {
		const existing = store.savedPath(item.guid);
		if (existing) {
			const file = app.vault.getAbstractFileByPath(existing);
			if (file) {
				void app.workspace.openLinkText(existing, '');
				return;
			}
			// Note was deleted outside the plugin — forget the mapping and
			// fall through to a fresh save.
			store.clearSaved(item.guid);
		}
		btn.addClass('is-busy');
		try {
			const resolved = await resolveArticleMarkdown(
				store,
				{ title: feedTitle, link: feedLinkOf(feedUrl) },
				item,
				{ fetcher: options?.fetcher },
			);
			if (!resolved.markdown) {
				new Notice(t('rss.saveFailed'));
				return;
			}
			const file = await saveRssArticle(app, {
				folder: config.downloadFolder,
				feedTitle,
				item,
				markdown: resolved.markdown,
			});
			store.setSaved(item.guid, file.path);
			setIcon(btn, 'file-text');
			btn.setAttribute('aria-label', t('rss.openNote'));
			btn.setAttribute('title', t('rss.openNote'));
			new Notice(t('rss.savedNotice', { name: file.basename }));
		} catch (err) {
			console.error('[Dashboard] rss article save failed:', err);
			new Notice(t('rss.saveFailed'));
		} finally {
			btn.removeClass('is-busy');
		}
	}

	function rerenderListPreservingScroll(): void {
		const states = captureScrollStates(content);
		renderList();
		restoreScrollStates(content, states);
	}

	async function run(force: boolean): Promise<void> {
		const my = ++epoch;
		await store.load();
		pending = false;
		if (epoch !== my) return;
		renderList();
		const stale = config.feeds.some(source => store.isStale(feedKey(source.url)));
		if (force || stale) {
			refreshing = true;
			rerenderListPreservingScroll();
			await refreshFeeds(store, config.feeds, { force, fetcher: options?.fetcher });
			refreshing = false;
			if (epoch !== my) return;
			rerenderListPreservingScroll();
		}
	}

	reloadRegister(() => {
		void run(true);
	});

	void run(false);
}
