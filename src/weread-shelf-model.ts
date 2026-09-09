export type WereadReadingState = 'notStarted' | 'reading' | 'finished';
export type WereadContentType = 'book' | 'audio' | 'article';
export type WereadRecency = 'recent7' | 'recent30' | 'older' | 'never';
export type WereadNoteState = 'highlights' | 'ideas' | 'none';
export type WereadGroupBy = 'none' | 'readingState' | 'contentType' | 'recency' | 'notes';

export interface WereadFacetedBook {
	bookId: string;
	readingState?: WereadReadingState;
	contentType?: WereadContentType;
	lastReadTime?: number;
	noteCount?: number;
	bookmarkCount?: number;
	reviewCount?: number;
}

export interface WereadNotebookSummary {
	bookId: string;
	noteCount: number;
	bookmarkCount: number;
	reviewCount: number;
}

export interface WereadShelfFilters {
	progress?: WereadReadingState[];
	contentTypes?: WereadContentType[];
	recency?: WereadRecency[];
	notes?: WereadNoteState[];
}

export interface WereadBookGroup<T extends WereadFacetedBook> {
	key: string;
	books: T[];
}

const DAY_MS = 86_400_000;

export function mergeNotebookStats<T extends WereadFacetedBook>(
	books: readonly T[],
	notebooks: readonly WereadNotebookSummary[],
): Array<T & Required<Pick<WereadFacetedBook, 'noteCount' | 'bookmarkCount' | 'reviewCount'>>> {
	const byBookId = new Map(notebooks.map(notebook => [notebook.bookId, notebook]));
	return books.map(book => {
		const notebook = byBookId.get(book.bookId);
		return {
			...book,
			noteCount: notebook?.noteCount ?? 0,
			bookmarkCount: notebook?.bookmarkCount ?? 0,
			reviewCount: notebook?.reviewCount ?? 0,
		};
	});
}

export function wereadRecency(book: WereadFacetedBook, now = Date.now()): WereadRecency {
	if (!book.lastReadTime || book.lastReadTime <= 0) return 'never';
	const age = Math.max(0, now - book.lastReadTime);
	if (age <= 7 * DAY_MS) return 'recent7';
	if (age <= 30 * DAY_MS) return 'recent30';
	return 'older';
}

export function primaryNoteState(book: WereadFacetedBook): WereadNoteState {
	if ((book.reviewCount ?? 0) > 0) return 'ideas';
	if ((book.noteCount ?? 0) > 0 || (book.bookmarkCount ?? 0) > 0) return 'highlights';
	return 'none';
}

/**
 * Does this book need a /book/getprogress call? The gateway rate limits that
 * endpoint hard, so only ask when the answer could differ from what the shelf
 * already says: finished books are settled (shelf's finishReading wins, and the
 * bar shows full), never-opened books have nothing to fetch (no reading time =
 * 0%), and audio/article items carry no percent at all. Everything else — the
 * actively-reading subset — is the only set worth the request budget.
 */
export function needsProgressFetch(book: {
	readingState?: WereadReadingState;
	readingTime?: number;
	contentType?: WereadContentType;
}): boolean {
	if (book.contentType !== 'book') return false;
	if (book.readingState === 'finished') return false;
	if (book.readingState === 'notStarted' && !(book.readingTime && book.readingTime > 0)) return false;
	return true;
}

/** The progress-bearing half of a getprogress result, applied to a shelf book. */
export interface WereadProgressPatch {
	progress: number;
	readingState: WereadReadingState;
	readingTime?: number;
	lastReadTime?: number;
}

/**
 * Overlay a progress result (live or cached) onto a shelf book. A shelf-side
 * `finished` verdict survives — getprogress reports the last reading position,
 * which can sit below 100 even for finished books.
 */
export function applyWereadProgressEntry<T extends WereadFacetedBook & { progress?: number; readingTime?: number }>(
	book: T,
	patch: WereadProgressPatch,
): T & { progress: number; readingState: WereadReadingState } {
	return {
		...book,
		progress: patch.progress,
		readingState: book.readingState === 'finished' ? 'finished' : patch.readingState,
		readingTime: patch.readingTime ?? book.readingTime,
		lastReadTime: patch.lastReadTime ?? book.lastReadTime,
	};
}

export function filterWereadBooks<T extends WereadFacetedBook>(
	books: readonly T[],
	filters: WereadShelfFilters,
	now = Date.now(),
): T[] {
	return books.filter(book => {
		const progressOk = !filters.progress?.length
			|| (!!book.readingState && filters.progress.includes(book.readingState));
		const contentOk = !filters.contentTypes?.length
			|| (!!book.contentType && filters.contentTypes.includes(book.contentType));
		const recencyOk = !filters.recency?.length
			|| filters.recency.includes(wereadRecency(book, now));
		const notesOk = !filters.notes?.length
			|| filters.notes.some(state => matchesNoteState(book, state));
		return progressOk && contentOk && recencyOk && notesOk;
	});
}

export function groupWereadBooks<T extends WereadFacetedBook>(
	books: readonly T[],
	groupBy: WereadGroupBy,
	now = Date.now(),
): Array<WereadBookGroup<T>> {
	if (groupBy === 'none') return books.length > 0 ? [{ key: 'all', books: [...books] }] : [];
	const order = groupOrder(groupBy);
	const buckets = new Map<string, T[]>();
	for (const book of books) {
		const key = groupKey(book, groupBy, now);
		const bucket = buckets.get(key) ?? [];
		buckets.set(key, [...bucket, book]);
	}
	return order
		.filter(key => buckets.has(key))
		.map(key => ({ key, books: buckets.get(key) ?? [] }));
}

function matchesNoteState(book: WereadFacetedBook, state: WereadNoteState): boolean {
	if (state === 'ideas') return (book.reviewCount ?? 0) > 0;
	if (state === 'highlights') return (book.noteCount ?? 0) > 0 || (book.bookmarkCount ?? 0) > 0;
	return (book.noteCount ?? 0) === 0
		&& (book.bookmarkCount ?? 0) === 0
		&& (book.reviewCount ?? 0) === 0;
}

function groupKey(book: WereadFacetedBook, groupBy: Exclude<WereadGroupBy, 'none'>, now: number): string {
	if (groupBy === 'readingState') return book.readingState ?? 'notStarted';
	if (groupBy === 'contentType') return book.contentType ?? 'book';
	if (groupBy === 'recency') return wereadRecency(book, now);
	return primaryNoteState(book);
}

function groupOrder(groupBy: Exclude<WereadGroupBy, 'none'>): string[] {
	if (groupBy === 'readingState') return ['reading', 'finished', 'notStarted'];
	if (groupBy === 'contentType') return ['book', 'audio', 'article'];
	if (groupBy === 'recency') return ['recent7', 'recent30', 'older', 'never'];
	return ['ideas', 'highlights', 'none'];
}

/**
 * Reading state for a shelf book without a live getprogress call: the shelf's
 * own finished verdict wins; a persisted progress entry (cross-session cache)
 * refines the rest; books with reading time but no entry count as reading
 * (opened but never enriched); the remainder are not started. Used by the
 * stats widget's shelf-distribution donut, which must not spend request
 * budget the shelf widget's enrichment hasn't already paid for.
 */
export function shelfStateFor(
	book: { readingState?: WereadReadingState; readingTime?: number },
	entry?: { readingState: WereadReadingState },
): WereadReadingState {
	if (book.readingState === 'finished') return 'finished';
	if (entry) return entry.readingState;
	return (book.readingTime ?? 0) > 0 ? 'reading' : 'notStarted';
}
