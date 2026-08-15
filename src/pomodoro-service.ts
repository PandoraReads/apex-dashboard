import { Notice } from 'obsidian';
import type DashboardPlugin from './main';
import type { DashboardSettings } from './types';
import { t } from './i18n';

export type PomodoroPhase = 'work' | 'short-break' | 'long-break';
export type PomodoroStatus = 'idle' | 'running' | 'paused';

export interface PomodoroState {
	phase: PomodoroPhase;
	status: PomodoroStatus;
	remainingSeconds: number;
	totalSeconds: number;
	completedWorkSessions: number;
}

export interface PomodoroSession {
	date: string;
	completed: number;
	records?: PomodoroRecord[];
}

export interface PomodoroRecord {
	timestamp: string;
	activity: string;
	/** Actual focused minutes (pauses excluded), not the configured duration. */
	duration: number;
	/** Times the work phase was paused (focus interruptions). */
	interruptions?: number;
	/** Actual break minutes taken after this work phase (0 = skipped/none). */
	breakMinutes?: number;
	/** True when the following break ran to completion (rest adherence). */
	breakCompleted?: boolean;
}

/** User-managed tag metadata. History records only carry the name; pin/color live here. */
export interface PomodoroTag {
	name: string;
	pinned: boolean;
}

/** v2 data layout. v1 was a bare PomodoroSession[]; loadSessions migrates it. */
export interface PomodoroData {
	version: 2;
	currentActivity: string;
	tags: PomodoroTag[];
	sessions: PomodoroSession[];
}

const DATA_FILE = 'pomodoro.json';
const MAX_SESSION_DAYS = 365;

function emptyData(): PomodoroData {
	return { version: 2, currentActivity: '', tags: [], sessions: [] };
}

/** Normalize a parsed pomodoro.json of either version into v2 shape. */
function normalizeData(raw: unknown): PomodoroData {
	if (Array.isArray(raw)) {
		// v1: bare session array
		return { ...emptyData(), sessions: raw as PomodoroSession[] };
	}
	if (raw && typeof raw === 'object') {
		const obj = raw as Partial<PomodoroData>;
		return {
			version: 2,
			currentActivity: typeof obj.currentActivity === 'string' ? obj.currentActivity : '',
			tags: Array.isArray(obj.tags)
				? obj.tags.filter((tg): tg is PomodoroTag => !!tg && typeof tg.name === 'string')
					.map(tg => ({ name: tg.name, pinned: tg.pinned === true }))
				: [],
			sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
		};
	}
	return emptyData();
}

export class PomodoroService {
	private phase: PomodoroPhase = 'work';
	private status: PomodoroStatus = 'idle';
	private startedAt = 0;
	private currentActivity = '';
	private pausedRemaining = 0;
	private durationMs = 0;
	/** Wall-clock ms accumulated across pauses for the current work phase. */
	private focusedMs = 0;
	private workPhaseResumedAt = 0;
	/** Pauses of the current work phase (focus interruptions). */
	private interruptions = 0;
	/** Pending work record awaiting its break-adherence outcome. */
	private pendingBreak: { record: PomodoroRecord; breakPhaseStartedAt: number } | null = null;
	private completedWorkSessions = 0;
	private tickInterval: number | null = null;
	private onTickCallback: (() => void) | null = null;
	private onCompleteCallback: (() => void) | null = null;
	private data: PomodoroData = emptyData();
	private loaded = false;

	constructor(private plugin: DashboardPlugin) {}

	async loadSessions(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (await adapter.exists(path)) {
				this.data = normalizeData(JSON.parse(await adapter.read(path)));
			}
		} catch {
			this.data = emptyData();
		}
		this.currentActivity = this.data.currentActivity;
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
			this.data = { ...this.data, currentActivity: this.currentActivity };
			await adapter.write(path, JSON.stringify(this.data));
		} catch {
			// silent fail
		}
	}

	private pruneOldSessions(): void {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - MAX_SESSION_DAYS);
		const cutoffStr = formatDate(cutoff);
		this.data = { ...this.data, sessions: this.data.sessions.filter(s => s.date >= cutoffStr) };
	}

	private get sessions(): PomodoroSession[] {
		return this.data.sessions;
	}

	private getSettings(): DashboardSettings {
		return this.plugin.settings;
	}

	private getPhaseDurationMs(phase: PomodoroPhase): number {
		const s = this.getSettings();
		switch (phase) {
			case 'work': return s.pomodoroWorkMinutes * 60 * 1000;
			case 'short-break': return s.pomodoroShortBreakMinutes * 60 * 1000;
			case 'long-break': return s.pomodoroLongBreakMinutes * 60 * 1000;
		}
	}

	private getRemainingSeconds(): number {
		if (this.status !== 'running') return Math.ceil(this.pausedRemaining / 1000);
		const elapsed = Date.now() - this.startedAt;
		return Math.max(0, Math.ceil((this.durationMs - elapsed) / 1000));
	}

	getState(): PomodoroState {
		const totalSeconds = Math.round(this.durationMs / 1000) || Math.round(this.getPhaseDurationMs(this.phase) / 1000);
		return {
			phase: this.phase,
			status: this.status,
			remainingSeconds: this.getRemainingSeconds(),
			totalSeconds,
			completedWorkSessions: this.completedWorkSessions,
		};
	}

	start(): void {
		if (this.status === 'running') return;

		if (this.status === 'paused') {
			this.durationMs = this.pausedRemaining;
			this.startedAt = Date.now();
			if (this.phase === 'work') this.workPhaseResumedAt = this.startedAt;
		} else {
			this.durationMs = this.getPhaseDurationMs(this.phase);
			this.startedAt = Date.now();
			if (this.phase === 'work') {
				this.focusedMs = 0;
				this.workPhaseResumedAt = this.startedAt;
			}
		}

		this.status = 'running';
		this.ensureTickInterval();
		this.notifyTick();
	}

	pause(): void {
		if (this.status !== 'running') return;
		this.pausedRemaining = Math.max(0, this.durationMs - (Date.now() - this.startedAt));
		if (this.phase === 'work') {
			if (this.workPhaseResumedAt) {
				this.focusedMs += Date.now() - this.workPhaseResumedAt;
				this.workPhaseResumedAt = 0;
			}
			this.interruptions++;
		}
		this.status = 'paused';
		this.clearTickInterval();
		this.notifyTick();
	}

	reset(): void {
		this.status = 'idle';
		this.phase = 'work';
		this.durationMs = this.getPhaseDurationMs('work');
		this.pausedRemaining = 0;
		this.startedAt = 0;
		this.focusedMs = 0;
		this.workPhaseResumedAt = 0;
		this.interruptions = 0;
		// A manual reset during a break counts as a skipped break.
		if (this.pendingBreak) {
			this.pendingBreak.record.breakMinutes = 0;
			this.pendingBreak.record.breakCompleted = false;
			void this.flushPendingBreak();
		}
		this.completedWorkSessions = 0;
		this.clearTickInterval();
		this.notifyTick();
	}

	skip(): void {
		this.transitionToNextPhase();
	}

	setOnTick(cb: (() => void) | null): void {
		this.onTickCallback = cb;
	}

	setOnComplete(cb: (() => void) | null): void {
		this.onCompleteCallback = cb;
	}

	destroy(): void {
		this.clearTickInterval();
		this.onTickCallback = null;
		this.onCompleteCallback = null;
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
		const remaining = this.getRemainingSeconds();
		if (remaining <= 0) {
			this.onPhaseComplete();
			return;
		}
		this.notifyTick();
	}

	private notifyTick(): void {
		this.onTickCallback?.();
	}

	/** Actual focused ms for the current work phase, including the running stretch. */
	private currentFocusedMs(): number {
		let total = this.focusedMs;
		if (this.phase === 'work' && this.status === 'running' && this.workPhaseResumedAt) {
			total += Date.now() - this.workPhaseResumedAt;
		}
		return total;
	}

	private onPhaseComplete(): void {
		const completedPhase = this.phase;

		if (completedPhase === 'work') {
			this.completedWorkSessions++;
			// Actual focused minutes: the timer ran the full phase, but pauses
			// extended the wall clock — record what was really spent focusing.
			const focusedMin = Math.max(1, Math.round(this.currentFocusedMs() / 60000));
			void this.recordSession(focusedMin);
			this.playSound();
			new Notice(t('pomodoro.workComplete'));
		} else {
			// Break ran to completion — settle the pending work record's adherence.
			if (this.pendingBreak) {
				this.pendingBreak.record.breakMinutes = Math.round(
					(Date.now() - this.pendingBreak.breakPhaseStartedAt) / 60000);
				this.pendingBreak.record.breakCompleted = true;
				void this.flushPendingBreak();
			}
			this.playSound();
			new Notice(t('pomodoro.breakComplete'));
		}

		this.onCompleteCallback?.();
		this.transitionToNextPhase();
	}

	private transitionToNextPhase(): void {
		// Leaving a break phase without completing it (skip / start-focus) marks
		// the pending work record's break as not taken.
		if (this.phase !== 'work' && this.pendingBreak) {
			this.pendingBreak.record.breakMinutes = 0;
			this.pendingBreak.record.breakCompleted = false;
			void this.flushPendingBreak();
		}

		if (this.phase === 'work') {
			const settings = this.getSettings();
			if (this.completedWorkSessions >= settings.pomodoroLongBreakInterval) {
				this.phase = 'long-break';
				this.completedWorkSessions = 0;
			} else {
				this.phase = 'short-break';
			}
		} else {
			this.phase = 'work';
		}

		this.durationMs = this.getPhaseDurationMs(this.phase);
		this.startedAt = 0;
		this.pausedRemaining = this.durationMs;
		this.focusedMs = 0;
		this.workPhaseResumedAt = 0;
		this.interruptions = 0;

		// pomodoroAutoStartBreak honored on every phase boundary: when off,
		// park in paused-ready instead of running so the user consciously starts.
		if (this.getSettings().pomodoroAutoStartBreak) {
			this.status = 'running';
			this.startedAt = Date.now();
			if (this.phase === 'work') this.workPhaseResumedAt = this.startedAt;
			this.ensureTickInterval();
		} else {
			this.status = 'paused';
			this.clearTickInterval();
		}

		this.notifyTick();
	}

	private async recordSession(focusedMin: number): Promise<void> {
		const today = formatDate(new Date());
		const record: PomodoroRecord = {
			timestamp: new Date().toISOString(),
			activity: this.currentActivity || t('pomodoro.defaultActivity'),
			duration: focusedMin,
			interruptions: this.interruptions,
		};
		this.appendRecord(today, record);
		// Hold the record until the following break resolves (completed / skipped)
		// so breakMinutes/breakCompleted land in the same write.
		this.pendingBreak = { record, breakPhaseStartedAt: Date.now() };
		await this.saveSessions();
	}

	/** Rewrite the pending work record (now carrying break adherence) in place. */
	private async flushPendingBreak(): Promise<void> {
		const pending = this.pendingBreak;
		this.pendingBreak = null;
		if (!pending) return;
		const date = pending.record.timestamp.slice(0, 10);
		this.data = {
			...this.data,
			sessions: this.data.sessions.map(s => s.date === date
				? {
					...s,
					records: (s.records ?? []).map(r =>
						r.timestamp === pending.record.timestamp ? { ...r, ...pending.record } : r),
				}
				: s),
		};
		await this.saveSessions();
	}

	private appendRecord(date: string, record: PomodoroRecord): void {
		const existing = this.data.sessions.find(s => s.date === date);
		const sessions = existing
			? this.data.sessions.map(s =>
				s.date === date
					? { ...s, completed: s.completed + 1, records: [...(s.records ?? []), record] }
					: s
			)
			: [...this.data.sessions, { date, completed: 1, records: [record] }];
		this.data = { ...this.data, sessions };
	}

	private playSound(): void {
		if (!this.getSettings().pomodoroSoundEnabled) return;
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 800;
			osc.type = 'sine';
			gain.gain.setValueAtTime(0.3, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
			osc.start(ctx.currentTime);
			osc.stop(ctx.currentTime + 0.8);
			osc.onended = () => ctx.close();
		} catch {
			// Web Audio not available
		}
	}

	setActivity(activity: string): void {
		this.currentActivity = activity;
		void this.saveSessions();
	}

	getActivity(): string {
		return this.currentActivity;
	}

	/** Configured work-phase length in minutes (goal baseline math in stats). */
	getWorkMinutes(): number {
		return this.getSettings().pomodoroWorkMinutes;
	}

	// ===== Tag management =====

	getTags(): PomodoroTag[] {
		// Pinned first, then rest, both alphabetical for stable UI order.
		return [...this.data.tags].sort((a, b) =>
			(a.pinned === b.pinned) ? a.name.localeCompare(b.name) : (a.pinned ? -1 : 1));
	}

	private findTag(name: string): PomodoroTag | undefined {
		return this.data.tags.find(tg => tg.name === name);
	}

	private upsertTag(name: string): void {
		if (!name || this.findTag(name)) return;
		this.data = { ...this.data, tags: [...this.data.tags, { name, pinned: false }] };
	}

	async renameTag(oldName: string, newName: string): Promise<boolean> {
		const trimmed = newName.trim();
		if (!trimmed || trimmed === oldName) return false;
		if (this.findTag(trimmed)) return false; // target name already exists
		this.data = {
			...this.data,
			currentActivity: this.currentActivity === oldName ? trimmed : this.currentActivity,
			tags: this.data.tags.map(tg => tg.name === oldName ? { ...tg, name: trimmed } : tg),
			sessions: this.data.sessions.map(s => ({
				...s,
				records: s.records?.map(r => r.activity === oldName ? { ...r, activity: trimmed } : r),
			})),
		};
		this.currentActivity = this.data.currentActivity;
		await this.saveSessions();
		return true;
	}

	/** Delete tag metadata; its history records fall back to the default activity. */
	async deleteTag(name: string): Promise<void> {
		this.data = {
			...this.data,
			currentActivity: this.currentActivity === name ? '' : this.currentActivity,
			tags: this.data.tags.filter(tg => tg.name !== name),
			sessions: this.data.sessions.map(s => ({
				...s,
				records: s.records?.map(r => r.activity === name ? { ...r, activity: t('pomodoro.defaultActivity') } : r),
			})),
		};
		this.currentActivity = this.data.currentActivity;
		await this.saveSessions();
	}

	/** Merge srcName's history into destName and drop srcName. */
	async mergeTags(srcName: string, destName: string): Promise<boolean> {
		if (srcName === destName || !this.findTag(destName)) return false;
		this.data = {
			...this.data,
			currentActivity: this.currentActivity === srcName ? destName : this.currentActivity,
			tags: this.data.tags.filter(tg => tg.name !== srcName),
			sessions: this.data.sessions.map(s => ({
				...s,
				records: s.records?.map(r => r.activity === srcName ? { ...r, activity: destName } : r),
			})),
		};
		this.currentActivity = this.data.currentActivity;
		await this.saveSessions();
		return true;
	}

	async setTagPinned(name: string, pinned: boolean): Promise<void> {
		this.upsertTag(name);
		this.data = {
			...this.data,
			tags: this.data.tags.map(tg => tg.name === name ? { ...tg, pinned } : tg),
		};
		await this.saveSessions();
	}

	// ===== Read queries =====

	getTodayCount(): number {
		const today = formatDate(new Date());
		return this.sessions.find(s => s.date === today)?.completed ?? 0;
	}

	getTotalCount(): number {
		return this.sessions.reduce((sum, s) => sum + s.completed, 0);
	}

	getTotalFocusMinutes(): number {
		return this.sessions.reduce((sum, s) => sum + sessionMinutes(s, this.getSettings().pomodoroWorkMinutes), 0);
	}

	getTodayFocusMinutes(): number {
		const today = formatDate(new Date());
		const session = this.sessions.find(s => s.date === today);
		if (!session) return 0;
		return sessionMinutes(session, this.getSettings().pomodoroWorkMinutes);
	}

	getActivityBreakdown(): Map<string, number> {
		const breakdown = new Map<string, number>();
		for (const s of this.sessions) {
			for (const [name, mins] of sessionActivityEntries(s, this.getSettings().pomodoroWorkMinutes)) {
				breakdown.set(name, (breakdown.get(name) ?? 0) + mins);
			}
		}
		return breakdown;
	}

	/** Recent activity names for the widget selector: pinned first, then most recently used. */
	getRecentActivities(limit: number): string[] {
		const pinned = this.getTags().filter(tg => tg.pinned).map(tg => tg.name);
		const recent: string[] = [];
		const seen = new Set<string>(pinned);
		const sorted = [...this.sessions].sort((a, b) => b.date.localeCompare(a.date));
		for (const s of sorted) {
			if (!s.records) continue;
			const recs = [...s.records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
			for (const r of recs) {
				if (r.activity && !seen.has(r.activity)) {
					seen.add(r.activity);
					recent.push(r.activity);
				}
				if (pinned.length + recent.length >= limit) break;
			}
			if (pinned.length + recent.length >= limit) break;
		}
		return [...pinned, ...recent].slice(0, limit);
	}

	getActivityBreakdownByRange(days: number): Map<string, number> {
		return this.collectSince(daysAgo(days));
	}

	/** Activity breakdown for the current calendar week (Monday → Sunday). */
	getActivityBreakdownByCalendarWeek(): Map<string, number> {
		const today = new Date();
		// getDay(): 0=Sun..6=Sat. Shift so Monday=0 for "days since Monday".
		const daysSinceMonday = (today.getDay() + 6) % 7;
		const monday = new Date(today);
		monday.setDate(today.getDate() - daysSinceMonday);
		return this.collectSince(formatDate(monday));
	}

	/** Activity breakdown for the current calendar month (1st → end of month). */
	getActivityBreakdownByCalendarMonth(): Map<string, number> {
		const today = new Date();
		const first = new Date(today.getFullYear(), today.getMonth(), 1);
		return this.collectSince(formatDate(first));
	}

	/** Activity breakdown for the current calendar year (Jan 1 → today). */
	getActivityBreakdownByCalendarYear(): Map<string, number> {
		const today = new Date();
		return this.collectSince(formatDate(new Date(today.getFullYear(), 0, 1)));
	}

	private collectSince(cutoffStr: string): Map<string, number> {
		const breakdown = new Map<string, number>();
		for (const s of this.sessions) {
			if (s.date < cutoffStr) continue;
			for (const [name, mins] of sessionActivityEntries(s, this.getSettings().pomodoroWorkMinutes)) {
				breakdown.set(name, (breakdown.get(name) ?? 0) + mins);
			}
		}
		return breakdown;
	}

	getRecentRecords(limit: number): PomodoroRecord[] {
		const allRecords: PomodoroRecord[] = [];
		for (const s of this.sessions) {
			if (s.records) {
				allRecords.push(...s.records);
			}
		}
		allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		return allRecords.slice(0, limit);
	}

	getDailyMinutes(days: number): { date: string; minutes: number }[] {
		const result: { date: string; minutes: number }[] = [];
		const sessionMap = new Map(this.sessions.map(s => [s.date, s]));
		for (let i = days - 1; i >= 0; i--) {
			const dateStr = daysAgoStr(i);
			const session = sessionMap.get(dateStr);
			result.push({ date: dateStr, minutes: session ? sessionMinutes(session, this.getSettings().pomodoroWorkMinutes) : 0 });
		}
		return result;
	}

	// ===== Insight queries (KPIs, quality metrics, distributions) =====

	/** Today's completed pomodoro count against the configured daily goal. */
	getTodayGoal(): { completed: number; goal: number } {
		return { completed: this.getTodayCount(), goal: Math.max(1, this.getSettings().pomodoroDailyGoal) };
	}

	/** Mean focused minutes over the trailing 7 days (today included), 0..N. */
	getRecent7AvgMinutes(): number {
		const daily = this.getDailyMinutes(7);
		return Math.round(daily.reduce((sum, d) => sum + d.minutes, 0) / daily.length);
	}

	/** Today's interruptions (pauses) across all completed work phases. */
	getTodayInterruptions(): number {
		const today = formatDate(new Date());
		return this.sessions.find(s => s.date === today)?.records
			?.reduce((sum, r) => sum + (r.interruptions ?? 0), 0) ?? 0;
	}

	/** Break adherence % over the trailing 30 days: completed breaks / breaks due. */
	getBreakAdherence(days = 30): number | null {
		let due = 0;
		let taken = 0;
		const cutoff = daysAgo(days);
		for (const s of this.sessions) {
			if (s.date < cutoff) continue;
			for (const r of s.records ?? []) {
				if (r.breakCompleted === undefined) continue; // legacy records: unknown
				due++;
				if (r.breakCompleted) taken++;
			}
		}
		return due > 0 ? Math.round((taken / due) * 100) : null;
	}

	/**
	 * Focus-efficiency score 0-100 for today: completeness toward the daily
	 * goal, penalized by interruptions (5 pts each, floor 0). Only counts
	 * completed pomodoros.
	 */
	getTodayScore(): number {
		const { completed, goal } = this.getTodayGoal();
		const completeness = Math.min(1, completed / goal);
		const penalty = Math.min(40, this.getTodayInterruptions() * 5);
		return Math.max(0, Math.round(completeness * 100 - penalty));
	}

	/** Hour-of-day focus minutes aggregated over all history: favorite slots. */
	getHourDistribution(): { hour: number; minutes: number }[] {
		const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0 }));
		for (const s of this.sessions) {
			for (const r of s.records ?? []) {
				buckets[new Date(r.timestamp).getHours()]!.minutes += r.duration;
			}
		}
		return buckets;
	}

	/** Most productive hour-of-day (by total minutes), null when no records. */
	getPeakHour(): number | null {
		const dist = this.getHourDistribution();
		let peak: { hour: number; minutes: number } | null = null;
		for (const b of dist) {
			if (b.minutes > 0 && (!peak || b.minutes > peak.minutes)) peak = b;
		}
		return peak?.hour ?? null;
	}

	/** Records within a date (YYYY-MM-DD), chronological. For day drill-down. */
	getRecordsForDate(date: string): PomodoroRecord[] {
		const session = this.sessions.find(s => s.date === date);
		return [...(session?.records ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	}

	/** Today's timeline entries: each work record plus its break outcome. */
	getTodayTimeline(): PomodoroRecord[] {
		return this.getRecordsForDate(formatDate(new Date()));
	}

	/** One-line insight for the stats header: streak-aware, delta-aware. */
	getInsight(): string {
		const today = this.getTodayCount();
		const streak = this.getStreak();
		const goal = this.getTodayGoal();

		if (today === 0 && streak === 0) {
			return t('pomodoro.insightStart');
		}
		if (today > 0 && today >= goal.goal) {
			return t('pomodoro.insightGoalHit', { count: today, goal: goal.goal });
		}
		if (today > 0) {
			return t('pomodoro.insightToday', { count: today, streak });
		}
		// No pomodoro today yet — did the user focus yesterday?
		const yesterday = this.sessions.find(s => s.date === daysAgo(1));
		if (yesterday && yesterday.completed > 0) {
			return t('pomodoro.insightKeepStreak', { streak });
		}
		return t('pomodoro.insightResume');
	}


	/** Daily (or monthly) totals for the trend chart across the stored history. */
	getMonthlyMinutes(): { month: string; minutes: number }[] {
		const byMonth = new Map<string, number>();
		for (const s of this.sessions) {
			const month = s.date.slice(0, 7); // YYYY-MM
			byMonth.set(month, (byMonth.get(month) ?? 0) + sessionMinutes(s, this.getSettings().pomodoroWorkMinutes));
		}
		return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, minutes]) => ({ month, minutes }));
	}

	/** Hour-of-day bucketed minutes for today (0..23), for the day-granularity trend. */
	getTodayHourlyMinutes(): { hour: number; minutes: number }[] {
		const today = formatDate(new Date());
		const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0 }));
		const session = this.sessions.find(s => s.date === today);
		if (!session?.records) return buckets;
		for (const r of session.records) {
			const h = new Date(r.timestamp).getHours();
			buckets[h] = { ...buckets[h]!, minutes: buckets[h]!.minutes + r.duration };
		}
		return buckets;
	}

	/** Daily totals for the last 12 weeks (84 days ending today), for the heatmap. */
	getHeatmapMinutes(): { date: string; minutes: number }[] {
		return this.getDailyMinutes(84);
	}

	/** Minutes in a period plus the immediately preceding equal period, for delta badges. */
	getRangeTotals(currentStart: string, previousStart: string, previousEnd: string): { current: number; previous: number } {
		const sum = (from: string, to: string) => this.sessions
			.filter(s => s.date >= from && s.date <= to)
			.reduce((acc, s) => acc + sessionMinutes(s, this.getSettings().pomodoroWorkMinutes), 0);
		return { current: sum(currentStart, formatDate(new Date())), previous: sum(previousStart, previousEnd) };
	}

	getStreak(): number {
		const sorted = [...this.sessions]
			.filter(s => s.completed > 0)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (sorted.length === 0) return 0;

		let streak = 0;
		let expected = formatDate(new Date());

		// If today has no sessions yet, start checking from yesterday
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

// ===== Session helpers (shared by the read queries) =====

/** Total focused minutes of a session; falls back to configured length for legacy records. */
function sessionMinutes(s: PomodoroSession, fallbackMinutes: number): number {
	if (s.records && s.records.length > 0) return s.records.reduce((sum, r) => sum + r.duration, 0);
	return s.completed * fallbackMinutes;
}

/** Per-activity minute entries of a session; legacy sessions bucket into the default activity. */
function sessionActivityEntries(s: PomodoroSession, fallbackMinutes: number): [string, number][] {
	if (s.records && s.records.length > 0) {
		return s.records.map(r => [r.activity || t('pomodoro.defaultActivity'), r.duration] as [string, number]);
	}
	return [[t('pomodoro.defaultActivity'), s.completed * fallbackMinutes]];
}

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return formatDate(d);
}

function daysAgoStr(days: number): string {
	return daysAgo(days);
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

const ACTIVITY_PALETTE = [
	'#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
	'#3498db', '#9b59b6', '#e91e63', '#00bcd4', '#ff7043',
];

export function activityColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
	}
	return ACTIVITY_PALETTE[Math.abs(hash) % ACTIVITY_PALETTE.length] ?? ACTIVITY_PALETTE[0]!;
}
