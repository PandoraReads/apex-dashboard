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
	duration: number;
}

const DATA_FILE = 'pomodoro.json';
const MAX_SESSION_DAYS = 365;

export class PomodoroService {
	private phase: PomodoroPhase = 'work';
	private status: PomodoroStatus = 'idle';
	private startedAt = 0;
	private currentActivity = '';
	private pausedRemaining = 0;
	private durationMs = 0;
	private completedWorkSessions = 0;
	private tickInterval: number | null = null;
	private onTickCallback: (() => void) | null = null;
	private onCompleteCallback: (() => void) | null = null;
	private sessions: PomodoroSession[] = [];
	private loaded = false;

	constructor(private plugin: DashboardPlugin) {}

	async loadSessions(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${DATA_FILE}`;
			if (await adapter.exists(path)) {
				const raw = await adapter.read(path);
				this.sessions = JSON.parse(raw) as PomodoroSession[];
			}
		} catch {
			this.sessions = [];
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
			await adapter.write(path, JSON.stringify(this.sessions));
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
		} else {
			this.durationMs = this.getPhaseDurationMs(this.phase);
			this.startedAt = Date.now();
		}

		this.status = 'running';
		this.ensureTickInterval();
		this.notifyTick();
	}

	pause(): void {
		if (this.status !== 'running') return;
		this.pausedRemaining = Math.max(0, this.durationMs - (Date.now() - this.startedAt));
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

	private onPhaseComplete(): void {
		const completedPhase = this.phase;

		if (completedPhase === 'work') {
			this.completedWorkSessions++;
			void this.recordSession();
			this.playSound();
			new Notice(t('pomodoro.workComplete'));
		} else {
			this.playSound();
			new Notice(t('pomodoro.breakComplete'));
		}

		this.onCompleteCallback?.();
		this.transitionToNextPhase();
	}

	private transitionToNextPhase(): void {
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

		this.status = 'running';
		this.startedAt = Date.now();
		this.ensureTickInterval();

		this.notifyTick();
	}

	private async recordSession(): Promise<void> {
		const today = formatDate(new Date());
		const durationMin = this.getSettings().pomodoroWorkMinutes;
		const record: PomodoroRecord = {
			timestamp: new Date().toISOString(),
			activity: this.currentActivity || t('pomodoro.defaultActivity'),
			duration: durationMin,
		};
		const existing = this.sessions.find(s => s.date === today);
		if (existing) {
			this.sessions = this.sessions.map(s =>
				s.date === today
					? { ...s, completed: s.completed + 1, records: [...(s.records ?? []), record] }
					: s
			);
		} else {
			this.sessions = [...this.sessions, { date: today, completed: 1, records: [record] }];
		}
		await this.saveSessions();
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
	}

	getActivity(): string {
		return this.currentActivity;
	}

	getTodayCount(): number {
		const today = formatDate(new Date());
		return this.sessions.find(s => s.date === today)?.completed ?? 0;
	}

	getTotalCount(): number {
		return this.sessions.reduce((sum, s) => sum + s.completed, 0);
	}

	getTotalFocusMinutes(): number {
		let total = 0;
		for (const s of this.sessions) {
			if (s.records) {
				for (const r of s.records) {
					total += r.duration;
				}
			} else {
				total += s.completed * this.getSettings().pomodoroWorkMinutes;
			}
		}
		return total;
	}

	getTodayFocusMinutes(): number {
		const today = formatDate(new Date());
		const session = this.sessions.find(s => s.date === today);
		if (!session) return 0;
		if (session.records) {
			return session.records.reduce((sum, r) => sum + r.duration, 0);
		}
		return session.completed * this.getSettings().pomodoroWorkMinutes;
	}

	getActivityBreakdown(): Map<string, number> {
		const breakdown = new Map<string, number>();
		for (const s of this.sessions) {
			if (s.records) {
				for (const r of s.records) {
					breakdown.set(r.activity, (breakdown.get(r.activity) ?? 0) + r.duration);
				}
			} else {
				const mins = s.completed * this.getSettings().pomodoroWorkMinutes;
				breakdown.set('', (breakdown.get('') ?? 0) + mins);
			}
		}
		return breakdown;
	}

	getRecentActivities(limit: number): string[] {
		const seen = new Set<string>();
		const result: string[] = [];
		const sorted = [...this.sessions].sort((a, b) => b.date.localeCompare(a.date));
		for (const s of sorted) {
			if (!s.records) continue;
			const recs = [...s.records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
			for (const r of recs) {
				if (r.activity && !seen.has(r.activity)) {
					seen.add(r.activity);
					result.push(r.activity);
				}
				if (result.length >= limit) return result;
			}
		}
		return result;
	}

	getActivityBreakdownByRange(days: number): Map<string, number> {
		const breakdown = new Map<string, number>();
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);
		const cutoffStr = formatDate(cutoff);
		for (const s of this.sessions) {
			if (s.date < cutoffStr) continue;
			if (s.records) {
				for (const r of s.records) {
					breakdown.set(r.activity || t('pomodoro.defaultActivity'), (breakdown.get(r.activity || t('pomodoro.defaultActivity')) ?? 0) + r.duration);
				}
			} else {
				const mins = s.completed * this.getSettings().pomodoroWorkMinutes;
				const key = t('pomodoro.defaultActivity');
				breakdown.set(key, (breakdown.get(key) ?? 0) + mins);
			}
		}
		return breakdown;
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

	private collectSince(cutoffStr: string): Map<string, number> {
		const breakdown = new Map<string, number>();
		for (const s of this.sessions) {
			if (s.date < cutoffStr) continue;
			if (s.records) {
				for (const r of s.records) {
					breakdown.set(r.activity || t('pomodoro.defaultActivity'), (breakdown.get(r.activity || t('pomodoro.defaultActivity')) ?? 0) + r.duration);
				}
			} else {
				const mins = s.completed * this.getSettings().pomodoroWorkMinutes;
				const key = t('pomodoro.defaultActivity');
				breakdown.set(key, (breakdown.get(key) ?? 0) + mins);
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
			const d = new Date();
			d.setDate(d.getDate() - i);
			const dateStr = formatDate(d);
			const session = sessionMap.get(dateStr);
			let minutes = 0;
			if (session) {
				if (session.records) {
					minutes = session.records.reduce((sum, r) => sum + r.duration, 0);
				} else {
					minutes = session.completed * this.getSettings().pomodoroWorkMinutes;
				}
			}
			result.push({ date: dateStr, minutes });
		}
		return result;
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
