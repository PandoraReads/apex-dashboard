import { Notice } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';

export type ReadingStatus = 'idle' | 'running' | 'paused';

export interface ReadingState {
	status: ReadingStatus;
	elapsedSeconds: number;
	currentBook: BookInfo | null;
}

export interface BookInfo {
	title: string;
	author: string;
	coverUrl: string;
	isbn: string;
	source: 'google' | 'manual';
	currentPage: number;
	totalPages: number;
	finished: boolean;
}

export interface ReadingRecord {
	timestamp: string;
	bookTitle: string;
	bookAuthor: string;
	coverUrl: string;
	durationSeconds: number;
	isbn: string;
	startPage: number;
	endPage: number;
	finished: boolean;
}

export interface ReadingDayRecord {
	date: string;
	records: ReadingRecord[];
}

interface ReadingData {
	activeBooks: BookInfo[];
	sessions: ReadingDayRecord[];
}

const DATA_FILE = 'reading.json';
const MAX_SESSION_DAYS = 730;

export class ReadingService {
	private status: ReadingStatus = 'idle';
	private startedAt = 0;
	private pausedElapsed = 0;
	private currentBook: BookInfo | null = null;
	private tickInterval: number | null = null;
	private onTickCallback: (() => void) | null = null;
	private activeBooks: BookInfo[] = [];
	private sessions: ReadingDayRecord[] = [];
	private loaded = false;

	constructor(private plugin: DashboardPlugin) {}

	getApp(): import('obsidian').App {
		return this.plugin.app;
	}

	async loadSessions(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				const data = JSON.parse(raw) as ReadingData | ReadingDayRecord[];
				if (Array.isArray(data)) {
					this.sessions = data;
					this.activeBooks = [];
				} else {
					this.sessions = data.sessions ?? [];
					this.activeBooks = (data.activeBooks ?? []).map(normalizeBook);
				}
			}
		} catch {
			this.sessions = [];
			this.activeBooks = [];
		}
		this.pruneOldSessions();
	}

	private async saveSessions(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const dir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
			const path = `${dir}/${DATA_FILE}`;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
			const data: ReadingData = {
				activeBooks: this.activeBooks,
				sessions: this.sessions,
			};
			await adapter.write(path, JSON.stringify(data));
		} catch {
			// silent fail
		}
	}

	private pruneOldSessions(): void {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - MAX_SESSION_DAYS);
		const cutoffStr = formatDate(cutoff);
		this.sessions = this.sessions.filter(s => s.date >= cutoffStr);
	}

	// --- Active books ---

	getActiveBooks(): BookInfo[] {
		return [...this.activeBooks];
	}

	async addActiveBook(book: BookInfo): Promise<void> {
		if (this.activeBooks.some(b => b.title === book.title && b.isbn === book.isbn)) return;
		this.activeBooks = [...this.activeBooks, normalizeBook(book)];
		await this.saveSessions();
	}

	async removeActiveBook(title: string): Promise<void> {
		if (this.currentBook?.title === title) {
			this.forceReset();
		}
		this.activeBooks = this.activeBooks.filter(b => b.title !== title);
		await this.saveSessions();
	}

	async updateBookInfo(originalTitle: string, updates: Partial<Pick<BookInfo, 'title' | 'author' | 'coverUrl' | 'isbn' | 'source' | 'totalPages'>>): Promise<void> {
		const oldBook = this.activeBooks.find(b => b.title === originalTitle);
		if (!oldBook) return;
		const newTitle = updates.title ?? originalTitle;
		const updated = { ...oldBook, ...updates, title: newTitle };
		this.activeBooks = this.activeBooks.map(b => b.title === originalTitle ? updated : b);
		if (this.currentBook?.title === originalTitle) {
			this.currentBook = updated;
		}
		await this.saveSessions();
	}

	async deleteRecord(timestamp: string): Promise<void> {
		this.sessions = this.sessions.map(s => ({
			...s,
			records: s.records.filter(r => r.timestamp !== timestamp),
		})).filter(s => s.records.length > 0);
		await this.saveSessions();
	}

	async deleteBookRecords(bookTitle: string): Promise<void> {
		this.sessions = this.sessions.map(s => ({
			...s,
			records: s.records.filter(r => r.bookTitle !== bookTitle),
		})).filter(s => s.records.length > 0);
		await this.saveSessions();
	}

	async updateBookProgress(title: string, endPage: number, totalPages: number, finished: boolean): Promise<void> {
		this.activeBooks = this.activeBooks.map(b => {
			if (b.title !== title) return b;
			return {
				...b,
				currentPage: finished ? (totalPages || endPage) : endPage,
				totalPages: totalPages || b.totalPages,
				finished,
			};
		});
		await this.saveSessions();
	}

	// --- Timer ---

	getElapsedSeconds(): number {
		if (this.status === 'idle') return 0;
		if (this.status === 'paused') return Math.floor(this.pausedElapsed / 1000);
		return Math.floor((Date.now() - this.startedAt + this.pausedElapsed) / 1000);
	}

	getState(): ReadingState {
		return {
			status: this.status,
			elapsedSeconds: this.getElapsedSeconds(),
			currentBook: this.currentBook,
		};
	}

	startReading(book: BookInfo): void {
		if (this.status === 'running' && this.currentBook?.title === book.title) return;

		if (this.status !== 'idle' && this.currentBook?.title !== book.title) {
			this.forceReset();
		}

		this.currentBook = book;
		this.pausedElapsed = 0;
		this.startedAt = Date.now();
		this.status = 'running';
		this.ensureTickInterval();
		this.notifyTick();
	}

	pause(): void {
		if (this.status !== 'running') return;
		this.pausedElapsed += Date.now() - this.startedAt;
		this.status = 'paused';
		this.clearTickInterval();
		this.notifyTick();
	}

	resume(): void {
		if (this.status !== 'paused') return;
		this.startedAt = Date.now();
		this.status = 'running';
		this.ensureTickInterval();
		this.notifyTick();
	}

	private forceReset(): void {
		this.status = 'idle';
		this.startedAt = 0;
		this.pausedElapsed = 0;
		this.currentBook = null;
		this.clearTickInterval();
	}

	async finishSession(endPage: number, totalPages: number, finished: boolean): Promise<ReadingRecord | null> {
		if (this.status === 'idle') return null;

		const elapsedMs = this.status === 'running'
			? this.pausedElapsed + (Date.now() - this.startedAt)
			: this.pausedElapsed;

		const durationSeconds = Math.floor(elapsedMs / 1000);
		if (durationSeconds < 1) {
			this.forceReset();
			this.notifyTick();
			return null;
		}

		const startPage = this.currentBook?.currentPage ?? 0;

		const record: ReadingRecord = {
			timestamp: new Date().toISOString(),
			bookTitle: this.currentBook?.title ?? t('reading.unnamedBook'),
			bookAuthor: this.currentBook?.author ?? '',
			coverUrl: this.currentBook?.coverUrl ?? '',
			durationSeconds,
			isbn: this.currentBook?.isbn ?? '',
			startPage,
			endPage,
			finished,
		};

		await this.recordSession(record);

		if (this.currentBook) {
			await this.updateBookProgress(this.currentBook.title, endPage, totalPages, finished);
		}

		this.playSound();
		new Notice(t('reading.sessionSaved', { minutes: Math.max(1, Math.round(durationSeconds / 60)) }));

		this.forceReset();
		this.notifyTick();
		return record;
	}

	discardSession(): void {
		this.forceReset();
		this.notifyTick();
	}

	setOnTick(cb: (() => void) | null): void {
		this.onTickCallback = cb;
	}

	destroy(): void {
		this.clearTickInterval();
		this.onTickCallback = null;
	}

	private ensureTickInterval(): void {
		if (this.tickInterval) return;
		this.tickInterval = window.setInterval(() => this.tick(), 1000);
	}

	private clearTickInterval(): void {
		if (this.tickInterval) {
			window.clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
	}

	private tick(): void {
		if (this.status !== 'running') return;
		this.notifyTick();
	}

	private notifyTick(): void {
		this.onTickCallback?.();
	}

	private async recordSession(record: ReadingRecord): Promise<void> {
		const today = formatDate(new Date());
		const existing = this.sessions.find(s => s.date === today);
		if (existing) {
			this.sessions = this.sessions.map(s =>
				s.date === today
					? { ...s, records: [...s.records, record] }
					: s
			);
		} else {
			this.sessions = [...this.sessions, { date: today, records: [record] }];
		}
		await this.saveSessions();
	}

	private playSound(): void {
		if (!this.plugin.settings.readingSoundEnabled) return;
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 660;
			osc.type = 'sine';
			gain.gain.setValueAtTime(0.25, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
			osc.start(ctx.currentTime);
			osc.stop(ctx.currentTime + 0.6);
			osc.onended = () => ctx.close();
		} catch {
			// Web Audio not available
		}
	}

	// --- Statistics ---

	getTodaySeconds(): number {
		const today = formatDate(new Date());
		const session = this.sessions.find(s => s.date === today);
		if (!session) return 0;
		return session.records.reduce((sum, r) => sum + r.durationSeconds, 0);
	}

	getTodaySecondsForBook(bookTitle: string): number {
		const today = formatDate(new Date());
		const session = this.sessions.find(s => s.date === today);
		if (!session) return 0;
		return session.records
			.filter(r => r.bookTitle === bookTitle)
			.reduce((sum, r) => sum + r.durationSeconds, 0);
	}

	getTotalSeconds(): number {
		return this.sessions.reduce(
			(sum, s) => sum + s.records.reduce((rs, r) => rs + r.durationSeconds, 0), 0
		);
	}

	getBookCountInRange(days: number): number {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);
		const cutoffStr = formatDate(cutoff);
		const books = new Set<string>();
		for (const s of this.sessions) {
			if (s.date < cutoffStr) continue;
			for (const r of s.records) {
				books.add(r.bookTitle);
			}
		}
		return books.size;
	}

	getBookBreakdownInRange(days: number): { title: string; author: string; coverUrl: string; totalSeconds: number; sessions: number }[] {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);
		const cutoffStr = formatDate(cutoff);
		const map = new Map<string, { title: string; author: string; coverUrl: string; totalSeconds: number; sessions: number }>();
		for (const s of this.sessions) {
			if (s.date < cutoffStr) continue;
			for (const r of s.records) {
				const existing = map.get(r.bookTitle);
				if (existing) {
					map.set(r.bookTitle, {
						...existing,
						totalSeconds: existing.totalSeconds + r.durationSeconds,
						sessions: existing.sessions + 1,
					});
				} else {
					map.set(r.bookTitle, {
						title: r.bookTitle,
						author: r.bookAuthor,
						coverUrl: r.coverUrl,
						totalSeconds: r.durationSeconds,
						sessions: 1,
					});
				}
			}
		}
		return [...map.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);
	}

	getRecentRecords(limit: number): ReadingRecord[] {
		const allRecords: ReadingRecord[] = [];
		for (const s of this.sessions) {
			allRecords.push(...s.records);
		}
		allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		return allRecords.slice(0, limit);
	}

	getStreak(): number {
		const sorted = [...this.sessions]
			.filter(s => s.records.length > 0)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (sorted.length === 0) return 0;

		let streak = 0;
		let expected = formatDate(new Date());

		if (sorted.length > 0 && sorted[0]!.date !== expected) {
			const d = new Date();
			d.setDate(d.getDate() - 1);
			expected = formatDate(d);
		}

		for (const s of sorted) {
			if (s.date === expected) {
				streak++;
				const d = new Date(expected + 'T00:00:00');
				d.setDate(d.getDate() - 1);
				expected = formatDate(d);
			} else if (s.date < expected) {
				break;
			}
		}

		return streak;
	}
}

function normalizeBook(b: BookInfo): BookInfo {
	return {
		title: b.title ?? '',
		author: b.author ?? '',
		coverUrl: b.coverUrl ?? '',
		isbn: b.isbn ?? '',
		source: b.source ?? 'manual',
		currentPage: b.currentPage ?? 0,
		totalPages: b.totalPages ?? 0,
		finished: b.finished ?? false,
	};
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
