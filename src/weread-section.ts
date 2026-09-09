import { App, Notice, setIcon, TFile } from 'obsidian';
import type { DashboardColumn, WereadConfig, WereadWidget } from './types';
import { t } from './i18n';
import { WereadClient, sharedWereadClient, wereadErrorMessage } from './weread-service';
import { renderWereadStats } from './weread-stats';
import {
	applyWereadProgressEntry,
	filterWereadBooks,
	groupWereadBooks,
	mergeNotebookStats,
	needsProgressFetch,
} from './weread-shelf-model';
import { getWereadProgressStore, type WereadProgressEntry, type WereadProgressStore } from './weread-progress-store';
import type { WereadGroupBy } from './weread-shelf-model';

/** Min book card width + grid gap, used to estimate how many columns fit. */
const SHELF_CARD_MIN = 110;
const SHELF_GAP = 8;
/** Reasonable row height for a book card (cover + title + author + progress). */
const SHELF_ROW_HEIGHT = 200;

/**
 * Weread section renderer. A section stacks one or more {@link WereadWidget}s
 * (e.g. stats on top, shelf below). Data is fetched via {@link WereadClient}
 * (official Agent Skill API); the account-wide key is plugin settings.wereadApiKey.
 *
 * The section exposes a `reload` callback (used by the header refresh button) via
 * {@link onReloadReady}. Shelf widgets paginate client-side.
 */
export function renderWereadSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	apiKey: string,
	importPath: string,
	onReloadReady?: (reload: () => void) => void,
): void {
	const widgets = normalizedWidgets(column.wereadConfig);
	// Shared app-session client: keeps the response cache (and rate-limit
	// cooldowns) alive across the frequent dashboard re-renders.
	const client = sharedWereadClient(apiKey);
	// Cross-session progress cache (weread-progress.json): after a restart,
	// fresh persisted entries stand in for the getprogress burst entirely.
	const store = getWereadProgressStore(app);
	const host = el.createDiv({ cls: 'dashboard-weread-widgets' });
	const pageState: Record<string, number> = {};

	const loadAll = async (force: boolean): Promise<void> => {
		if (force) client.clearCache();
		host.empty();

		if (!client.isConfigured()) {
			renderHint(host, t('weread.noKey'), t('weread.noKeyHint'));
			return;
		}

		for (const w of widgets) {
			const block = host.createDiv({ cls: 'dashboard-weread-widget' });
			if (w.title) block.createDiv({ cls: 'dashboard-weread-widget-title', text: w.title });
			const content = block.createDiv({ cls: 'dashboard-weread-content' });
			renderHint(content, t('weread.loading'), '');

			try {
				if (w.view === 'stats') {
					// The stats widget owns its lifecycle (period toggle
					// re-fetches internally); it renders its own loading and
					// error states inside the body.
					renderWereadStats(content, client, w, store);
				} else if (w.view === 'notes') {
					const notebooks = await client.fetchNotebooks();
					content.empty();
					renderNotebooks(content, client, notebooks, app, importPath, pageState, w.id);
				} else {
					let allBooks: WereadBookLike[] = await client.fetchShelf();
					if (w.noteFilters?.length || w.groupBy === 'notes') {
						const notebooks = await client.fetchNotebooks();
						allBooks = mergeNotebookStats(allBooks, notebooks);
					}
					// Always enrich: shelf data carries no per-book progress, so
					// every book needs its /book/getprogress call for a real bar —
					// not just when a progress filter would silently drop books.
					// Fresh persisted entries stand in for the call (see the
					// store); force (header refresh) bypasses freshness.
					renderHint(content, t('weread.loadingProgress'), '');
					allBooks = await enrichProgress(client, store, allBooks, force);
					content.empty();
					const books = filterWereadBooks(allBooks, {
						progress: w.progressFilters,
						contentTypes: w.contentTypeFilters,
						recency: w.recencyFilters,
						notes: w.noteFilters,
					});
					drawShelf(content, w, books, pageState);
				}
			} catch (err) {
				content.empty();
				renderHint(content, t('weread.loadFailed'), wereadErrorMessage(err));
			}
		}
	};

	if (onReloadReady) onReloadReady(() => { void loadAll(true); });
	void loadAll(false);
}

function normalizedWidgets(cfg?: WereadConfig): WereadWidget[] {
	if (cfg?.widgets?.length) return cfg.widgets;
	return [{ id: 'w1', view: 'shelf', groupBy: 'readingState' }];
}

function drawShelf(content: HTMLElement, w: WereadWidget, books: WereadBookLike[], pageState: Record<string, number>): void {
	content.empty();
	if (books.length === 0) {
		renderHint(content, t('weread.empty'), t('weread.emptyHint'));
		return;
	}

	const groupBy = w.groupBy ?? 'readingState';
	const orderedBooks = groupWereadBooks(books, groupBy).flatMap(group => group.books);
	const pageSize = computeShelfCapacity(content);
	// If the page size changed (window/section resized), start from page 1 so
	// the user doesn't land past the new last page or see a half-empty page.
	pageState[w.id] = pageState[w.id] ?? 1;
	const totalPages = Math.max(1, Math.ceil(orderedBooks.length / pageSize));
	const page = Math.min(pageState[w.id] ?? 1, totalPages);

	renderShelfGroups(content, orderedBooks.slice((page - 1) * pageSize, page * pageSize), groupBy);

	if (totalPages > 1) {
		const pager = content.createDiv({ cls: 'dashboard-weread-pager' });
		const prev = pager.createEl('button', { cls: 'dashboard-weread-pager-btn', attr: { type: 'button', 'aria-label': 'Previous' } });
		prev.createSpan({ text: '‹' });
		pager.createSpan({ cls: 'dashboard-weread-pager-info', text: `${page} / ${totalPages}` });
		const next = pager.createEl('button', { cls: 'dashboard-weread-pager-btn', attr: { type: 'button', 'aria-label': 'Next' } });
		next.createSpan({ text: '›' });
		prev.disabled = page <= 1;
		next.disabled = page >= totalPages;
		prev.addEventListener('click', () => { pageState[w.id] = Math.max(1, page - 1); drawShelf(content, w, books, pageState); });
		next.addEventListener('click', () => { pageState[w.id] = Math.min(totalPages, page + 1); drawShelf(content, w, books, pageState); });
	}
}

/**
 * Estimate how many book cards fit the section right now: columns from the
 * section's actual width, rows from its max-height (the drag-resized value or
 * the type default). Wide/tall sections show more books per page; resizing the
 * window or the section recomputes. Falls back to 12 if unknown.
 */
function computeShelfCapacity(content: HTMLElement): number {
	const section = content.closest('.dashboard-section-row');
	if (!section) return 12;
	const width = section.clientWidth;
	const maxH = parseInt(getComputedStyle(section).maxHeight, 10) || 800;
	const cols = Math.max(1, Math.floor((width + SHELF_GAP) / (SHELF_CARD_MIN + SHELF_GAP)));
	// Subtract header + section padding + pager overhead.
	const availH = Math.max(SHELF_ROW_HEIGHT, maxH - 130);
	const rows = Math.max(1, Math.floor(availH / SHELF_ROW_HEIGHT));
	return Math.max(6, Math.min(cols * rows, 60));
}

function renderHint(content: HTMLElement, title: string, hint: string): void {
	const wrap = content.createDiv({ cls: 'dashboard-weread-hint' });
	wrap.createDiv({ cls: 'dashboard-weread-hint-title', text: title });
	if (hint) wrap.createDiv({ cls: 'dashboard-weread-hint-desc', text: hint });
}

/**
 * Fetch per-book progress (concurrency-limited) and set progress + readingState.
 * A shelf-side `finished` verdict (finishReading) survives: getprogress reports
 * the last reading position, which can sit below 100 even for finished books.
 *
 * Request budget: only books whose progress the shelf cannot already answer
 * (see needsProgressFetch) are fetched, a fresh persisted entry (cross-session
 * cache) stands in for the call unless `force`, and the first RATE_LIMITED
 * aborts the remaining batches — every request during a gateway ban extends
 * it, so the circuit breaker in WereadClient plus this stop keep re-renders
 * from feeding the ban. Aborted books fall back to any (even stale) persisted
 * entry, then shelf-derived values.
 */
async function enrichProgress(
	client: WereadClient,
	store: WereadProgressStore,
	books: WereadBookLike[],
	force = false,
): Promise<WereadBookLike[]> {
	await store.load();
	const enriched: WereadBookLike[] = [];
	const fetched: Record<string, WereadProgressEntry> = {};
	const limit = 8;
	let rateLimited = false;
	for (let i = 0; i < books.length && !rateLimited; i += limit) {
		const batch = books.slice(i, i + limit);
		const next = await Promise.all(batch.map(async (book): Promise<WereadBookLike> => {
			if (!needsProgressFetch(book)) return book;
			if (!force) {
				const cached = store.freshEntry(book.bookId);
				if (cached) return applyWereadProgressEntry(book, cached);
			}
			try {
				const details = await client.fetchProgressDetails(book.bookId);
				const readingState = details.progress >= 100 || book.readingState === 'finished'
					? 'finished'
					: details.progress > 0 ? 'reading' : 'notStarted';
				fetched[book.bookId] = {
					progress: details.progress,
					readingState,
					readingTime: details.readingTime,
					lastReadTime: details.lastReadTime,
					ts: Date.now(),
				};
				return {
					...book,
					progress: details.progress,
					readingState,
					readingTime: details.readingTime ?? book.readingTime,
					lastReadTime: details.lastReadTime ?? book.lastReadTime,
				};
			} catch (err) {
				if (err instanceof Error && err.message === 'RATE_LIMITED') rateLimited = true;
				// A stale persisted entry still beats a blank shelf bar.
				const stale = store.entry(book.bookId);
				return stale ? applyWereadProgressEntry(book, stale) : book;
			}
		}));
		enriched.push(...next);
		if (!rateLimited && i + limit < books.length) await sleepMs(200);
	}
	store.put(fetched);
	return enriched;
}

function sleepMs(ms: number): Promise<void> {
	return new Promise(r => window.setTimeout(r, ms));
}

function renderShelfGroups(content: HTMLElement, books: WereadBookLike[], groupBy: WereadGroupBy): void {
	if (groupBy === 'none') {
		renderShelf(content, books);
		return;
	}
	const groups = content.createDiv({ cls: 'dashboard-weread-groups' });
	for (const group of groupWereadBooks(books, groupBy)) {
		const section = groups.createDiv({ cls: `dashboard-weread-group dashboard-weread-group--${group.key}` });
		const head = section.createDiv({ cls: 'dashboard-weread-group-head' });
		const icon = head.createDiv({ cls: 'dashboard-weread-group-icon' });
		setIcon(icon, groupIcon(group.key));
		head.createDiv({ cls: 'dashboard-weread-group-name', text: groupLabel(group.key) });
		head.createDiv({ cls: 'dashboard-weread-group-count', text: String(group.books.length) });
		renderShelf(section, group.books);
	}
}

function renderShelf(content: HTMLElement, books: WereadBookLike[]): void {
	const grid = content.createDiv({ cls: 'dashboard-weread-grid' });
	for (const book of books) {
		const card = grid.createDiv({ cls: 'dashboard-weread-book' });
		if (book.cover) {
			card.createDiv({ cls: 'dashboard-weread-book-cover' }).style.backgroundImage = `url("${book.cover}")`;
		} else {
			card.createDiv({ cls: 'dashboard-weread-book-cover dashboard-weread-book-cover--placeholder' });
		}
		const info = card.createDiv({ cls: 'dashboard-weread-book-info' });
		info.createDiv({ cls: 'dashboard-weread-book-title', text: book.title });
		info.createDiv({ cls: 'dashboard-weread-book-author', text: book.author });
		const meta = info.createDiv({ cls: 'dashboard-weread-book-meta' });
		meta.createDiv({ cls: 'dashboard-weread-book-kind', text: contentTypeLabel(book.contentType) });
		const noteTotal = (book.noteCount ?? 0) + (book.reviewCount ?? 0);
		if (noteTotal > 0) meta.createDiv({ cls: 'dashboard-weread-book-notes', text: t('weread.noteBadge', { count: String(noteTotal) }) });
		const bar = info.createDiv({ cls: 'dashboard-weread-progress' });
		bar.createDiv({ cls: 'dashboard-weread-progress-fill' }).style.width = `${book.progress}%`;
		const progressMeta = info.createDiv({ cls: 'dashboard-weread-progress-meta' });
		progressMeta.createDiv({ cls: 'dashboard-weread-book-state', text: readingStateLabel(book.readingState) });
		progressMeta.createDiv({ cls: 'dashboard-weread-book-pct', text: `${book.progress}%` });
	}
}

function groupLabel(key: string): string {
	const labels: Record<string, string> = {
		reading: 'weread.progressReading',
		finished: 'weread.progressFinished',
		notStarted: 'weread.progressNotStarted',
		book: 'weread.contentBook',
		audio: 'weread.contentAudio',
		article: 'weread.contentArticle',
		recent7: 'weread.recent7',
		recent30: 'weread.recent30',
		older: 'weread.recentOlder',
		never: 'weread.recentNever',
		highlights: 'weread.notesHighlights',
		ideas: 'weread.notesIdeas',
		none: 'weread.notesNone',
	};
	return t(labels[key] ?? 'weread.groupNone');
}

function groupIcon(key: string): string {
	if (key === 'reading') return 'book-open';
	if (key === 'finished') return 'check-circle';
	if (key === 'audio') return 'headphones';
	if (key === 'article') return 'file-text';
	if (key === 'recent7' || key === 'recent30') return 'history';
	if (key === 'ideas') return 'message-square';
	if (key === 'highlights') return 'highlighter';
	return 'book';
}

function contentTypeLabel(contentType?: WereadBookLike['contentType']): string {
	if (contentType === 'audio') return t('weread.contentAudio');
	if (contentType === 'article') return t('weread.contentArticle');
	return t('weread.contentBook');
}

function readingStateLabel(state?: WereadBookLike['readingState']): string {
	if (state === 'finished') return t('weread.progressFinished');
	if (state === 'reading') return t('weread.progressReading');
	return t('weread.progressNotStarted');
}

function renderNotebooks(content: HTMLElement, client: WereadClient, notebooks: WereadNotebookLike[], app: App, importPath: string, pageState: Record<string, number>, widgetId: string): void {
	content.empty();
	if (notebooks.length === 0) {
		renderHint(content, t('weread.noNotes'), '');
		return;
	}
	const PAGE = 10;
	const totalPages = Math.max(1, Math.ceil(notebooks.length / PAGE));
	let page = pageState[widgetId] ?? 1;
	if (page > totalPages) page = totalPages;
	pageState[widgetId] = page;

	const list = content.createDiv({ cls: 'dashboard-weread-notebooks' });
	for (const nb of notebooks.slice((page - 1) * PAGE, page * PAGE)) {
		const row = list.createDiv({ cls: 'dashboard-weread-notebook' });
		const head = row.createDiv({ cls: 'dashboard-weread-notebook-head' });
		const meta = head.createDiv({ cls: 'dashboard-weread-notebook-meta' });
		meta.createDiv({ cls: 'dashboard-weread-book-title', text: nb.title });
		meta.createDiv({ cls: 'dashboard-weread-notebook-count', text: t('weread.noteCount', { n: String(nb.noteCount) }) });

		const importBtn = head.createEl('button', {
			cls: 'dashboard-weread-notebook-import',
			attr: { type: 'button', 'aria-label': t('weread.importHighlights'), title: t('weread.importHighlights') },
		});
		setIcon(importBtn, 'file-down');
		importBtn.addEventListener('click', (e) => { e.stopPropagation(); void doImportHighlights(client, app, importPath, nb, importBtn); });

		const chevron = head.createDiv({ cls: 'dashboard-weread-notebook-chevron' });
		setIcon(chevron, 'chevron-right');
		const detailEl = row.createDiv({ cls: 'dashboard-weread-notebook-detail' });
		const toggleDetail = async (): Promise<void> => {
			if (detailEl.dataset.loaded === 'true') {
				const willOpen = !detailEl.hasClass('dashboard-weread-notebook-detail--open');
				detailEl.toggleClass('dashboard-weread-notebook-detail--open', willOpen);
				setIcon(chevron, willOpen ? 'chevron-down' : 'chevron-right');
				return;
			}
			if (detailEl.dataset.loading === 'true') return;
			detailEl.dataset.loading = 'true';
			setIcon(chevron, 'loader');
			try {
				const marks = await client.fetchBookmarks(nb.bookId);
				renderHighlightDetail(detailEl, chevron, marks);
			} catch {
				setIcon(chevron, 'chevron-right');
				new Notice(t('weread.loadFailed'));
			} finally {
				detailEl.dataset.loading = '';
			}
		};
		head.addEventListener('click', () => { void toggleDetail(); });
	}

	if (totalPages > 1) {
		const pager = content.createDiv({ cls: 'dashboard-weread-pager' });
		const prev = pager.createEl('button', { cls: 'dashboard-weread-pager-btn', attr: { type: 'button', 'aria-label': 'Previous' } });
		prev.createSpan({ text: '‹' });
		pager.createSpan({ cls: 'dashboard-weread-pager-info', text: `${page} / ${totalPages}` });
		const next = pager.createEl('button', { cls: 'dashboard-weread-pager-btn', attr: { type: 'button', 'aria-label': 'Next' } });
		next.createSpan({ text: '›' });
		prev.disabled = page <= 1;
		next.disabled = page >= totalPages;
		prev.addEventListener('click', () => { pageState[widgetId] = Math.max(1, page - 1); renderNotebooks(content, client, notebooks, app, importPath, pageState, widgetId); });
		next.addEventListener('click', () => { pageState[widgetId] = Math.min(totalPages, page + 1); renderNotebooks(content, client, notebooks, app, importPath, pageState, widgetId); });
	}
}

function renderHighlightDetail(detailEl: HTMLElement, chevron: HTMLElement, marks: WereadBookmarkLike[]): void {
	detailEl.empty();
	if (marks.length === 0) {
		detailEl.createDiv({ cls: 'dashboard-weread-hint-desc', text: t('weread.noHighlights') });
	} else {
		for (const m of marks) {
			detailEl.createDiv({ cls: 'dashboard-weread-highlight', text: m.markText });
		}
	}
	detailEl.dataset.loaded = 'true';
	detailEl.addClass('dashboard-weread-notebook-detail--open');
	setIcon(chevron, 'chevron-down');
}

async function doImportHighlights(client: WereadClient, app: App, importPath: string, nb: WereadNotebookLike, btn: HTMLElement): Promise<void> {
	btn.setAttribute('disabled', '');
	try {
		const marks = await client.fetchBookmarks(nb.bookId);
		if (marks.length === 0) {
			new Notice(t('weread.noHighlights'));
			return;
		}
		const path = await importHighlightsToObsidian(app, importPath, nb, marks);
		new Notice(t('weread.importDone', { n: String(marks.length), name: nb.title, path }));
	} catch {
		new Notice(t('weread.importFailed'));
	} finally {
		btn.removeAttribute('disabled');
	}
}

/** Write a book's highlights to a markdown note. Returns the vault path. */
async function importHighlightsToObsidian(app: App, importPath: string, nb: WereadNotebookLike, marks: WereadBookmarkLike[]): Promise<string> {
	const folder = importPath.trim().replace(/^\/+|\/+$/g, '');
	const safeTitle = sanitizeFileName(nb.title);
	const path = folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`;

	if (folder) {
		await ensureFolder(app, folder);
	}

	const lines: string[] = [];
	lines.push('---');
	lines.push('source: weread');
	lines.push(`bookId: ${yamlScalar(nb.bookId)}`);
	lines.push(`title: ${yamlScalar(nb.title)}`);
	if (nb.author) lines.push(`author: ${yamlScalar(nb.author)}`);
	lines.push(`highlightCount: ${marks.length}`);
	lines.push('---');
	lines.push('');
	lines.push(`# ${nb.title}`);
	if (nb.author) { lines.push(''); lines.push(`*${nb.author}*`); }
	lines.push('');
	marks.forEach((m, i) => { lines.push(`${i + 1}. ${m.markText}`); lines.push(''); });
	const content = lines.join('\n');

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing && existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(path, content);
	}
	return path;
}

function sanitizeFileName(name: string): string {
	return (name || 'untitled').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'untitled';
}

/**
 * Recursively ensure a folder exists. Obsidian's `vault.createFolder` only
 * creates a single level, so a nested default like "Weread/划线" must be built
 * one segment at a time — otherwise highlight import fails on fresh vaults.
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
	const trimmed = folder.replace(/^\/+|\/+$/g, '');
	if (!trimmed) return;
	let current = '';
	for (const part of trimmed.split('/').filter(Boolean)) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try { await app.vault.createFolder(current); } catch { /* race or already exists */ }
		}
	}
}

function yamlScalar(v: string): string {
	return `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Local structural aliases to keep the render functions decoupled from the
// service's exported interfaces (which carry optional fields).
type WereadBookLike = {
	bookId: string;
	title: string;
	author: string;
	cover?: string;
	progress: number;
	finished?: boolean;
	readingTime?: number;
	category?: string;
	readingState: 'notStarted' | 'reading' | 'finished';
	contentType: 'book' | 'audio' | 'article';
	lastReadTime?: number;
	noteCount?: number;
	bookmarkCount?: number;
	reviewCount?: number;
};
type WereadNotebookLike = { bookId: string; title: string; author: string; noteCount: number; bookmarkCount: number; reviewCount: number };
type WereadBookmarkLike = { bookId: string; chapterUid?: number; markText: string };
