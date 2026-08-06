import { Notice } from 'obsidian';
import type DashboardPlugin from './main';
import type { BackupPeriod } from './types';
import { t } from './i18n';

/** Milliseconds covered by each backup cadence. */
const PERIOD_MS: Record<BackupPeriod, number> = {
	hourly: 60 * 60 * 1000,
	daily: 24 * 60 * 60 * 1000,
	weekly: 7 * 24 * 60 * 60 * 1000,
	monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Periodic snapshot service for the dashboard markdown file.
 *
 * Distinct from the per-write safety net in SyncEngine.createBackup (which
 * guards against corruption on every save to .dashboard-backup/ at the vault
 * root): this takes point-in-time snapshots on a user-chosen cadence and stores
 * them inside the plugin folder so they survive alongside the plugin itself.
 *
 * A single 60s tick polls the clock — this survives laptop sleep / Obsidian
 * restarts far better than a single long setInterval, and matches the
 * granularity of the existing day-rollover checker.
 */
export class BackupService {
	private readonly plugin: DashboardPlugin;
	private static readonly TICK_MS = 60_000;

	constructor(plugin: DashboardPlugin) {
		this.plugin = plugin;
	}

	/** Tick cadence used by the owning plugin (main.ts registers it). */
	static get tickIntervalMs(): number {
		return BackupService.TICK_MS;
	}

	/** Absolute vault path of the backup directory inside the plugin folder. */
	private get backupDir(): string {
		return `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/backups`;
	}

	/** Poll: back up only if enabled and the cadence has elapsed since the last run. */
	async tick(): Promise<void> {
		const settings = this.plugin.settings;
		if (!settings.backupEnabled) return;
		const interval = PERIOD_MS[settings.backupPeriod] ?? PERIOD_MS.daily;
		const last = settings.backupLastRun ?? 0;
		if (Date.now() - last < interval) return;
		await this.runBackup();
	}

	/**
	 * Take a snapshot now, regardless of cadence. Used by the "Back up now"
	 * button and by the tick. Failures are swallowed (with a Notice) so they
	 * never break the editor flow.
	 */
	async runBackup(): Promise<boolean> {
		const app = this.plugin.app;
		const settings = this.plugin.settings;
		try {
			const rawPath = (settings.dashboardFile ?? 'dashboard').trim();
			const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
			const file = app.vault.getFileByPath(path);
			if (!file) return false;
			const content = await app.vault.read(file);

			const adapter = app.vault.adapter;
			const dir = this.backupDir;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupPath = `${dir}/dashboard-${stamp}.md`;
			await adapter.write(backupPath, content);

			await this.prune(dir, settings.backupMaxCount && settings.backupMaxCount > 0 ? settings.backupMaxCount : 10);

			this.plugin.settings = { ...this.plugin.settings, backupLastRun: Date.now() };
			await this.plugin.saveSettings();
			return true;
		} catch (err) {
			console.error('Dashboard backup failed:', err);
			return false;
		}
	}

	/** Keep only the newest `max` snapshots. */
	private async prune(dir: string, max: number): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const listing = await adapter.list(dir);
			const backups = listing.files
				.filter(f => f.startsWith(`${dir}/dashboard-`) && f.endsWith('.md'))
				.sort();
			while (backups.length > max) {
				const oldest = backups.shift();
				if (oldest) await adapter.remove(oldest);
			}
		} catch {
			// Pruning is best-effort.
		}
	}

	/** User-triggered snapshot with feedback. */
	async runBackupNow(): Promise<void> {
		const ok = await this.runBackup();
		new Notice(ok ? t('backup.done') : t('backup.failed'));
	}

	/**
	 * Sorted list (oldest→newest) of dashboard backup file paths, or null if the
	 * backup directory does not exist yet. ISO-stamped filenames sort
	 * chronologically, so the last element is the most recent snapshot.
	 */
	async listBackups(): Promise<string[] | null> {
		const adapter = this.plugin.app.vault.adapter;
		const dir = this.backupDir;
		if (!(await adapter.exists(dir))) return null;
		const listing = await adapter.list(dir);
		return listing.files
			.filter(f => f.startsWith(`${dir}/dashboard-`) && f.endsWith('.md'))
			.sort();
	}

	/**
	 * Overwrite the dashboard file with the most recent backup snapshot, then
	 * reload any open dashboard views so the restored content shows immediately.
	 * Handles both "current file was overwritten with bad content" (modify) and
	 * "current file was deleted" (create). Returns false if there is no backup.
	 */
	async restoreLatest(): Promise<boolean> {
		const app = this.plugin.app;
		const settings = this.plugin.settings;
		try {
			const backups = await this.listBackups();
			if (!backups || backups.length === 0) return false;
			const latest = backups[backups.length - 1]!;
			const content = await app.vault.adapter.read(latest);

			const rawPath = (settings.dashboardFile ?? 'dashboard').trim();
			const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
			const existing = app.vault.getFileByPath(path);
			if (existing) {
				await app.vault.modify(existing, content);
			} else {
				await app.vault.create(path, content);
			}

			await this.plugin.reloadAllDashboards();
			return true;
		} catch (err) {
			console.error('Dashboard restore failed:', err);
			return false;
		}
	}

	/** User-triggered restore with feedback. */
	async restoreLatestNow(): Promise<boolean> {
		const backups = await this.listBackups();
		if (!backups || backups.length === 0) {
			new Notice(t('backup.noBackup'));
			return false;
		}
		const ok = await this.restoreLatest();
		new Notice(ok ? t('backup.restored') : t('backup.failed'));
		return ok;
	}
}
