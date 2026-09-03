import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, type DashboardSettings, type CountdownConfig } from './types';
import { DashboardSettingTab } from './settings';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './view';
import { BackupService } from './backup-service';
import { setLanguage, t } from './i18n';
import { DataviewGuideModal } from './dataview-guide-modal';

/** Version of the CURRENT announcement content (DataviewGuideModal). The
 *  announcement pops only when the user's stored version differs from this —
 *  bump it together with the modal's text when a new announcement ships.
 *  Patch releases that keep the old content stay silent. Current content
 *  shipped with 2.2.0. */
const ANNOUNCE_VERSION = '2.2.0';

import { teardownBasenameIndex } from './renderer';
import { MediaTagService, sanitizeMediaTags, registerMediaTagService } from './media-tags';
import { HabitService, registerHabitService } from './habit-service';
import { ExpenseService, registerExpenseService } from './expense-service';
import { generateDefaultMarkdown } from './parser';
import {
	alignWorkspaceNames,
	migrateWorkspaces,
	nextWorkspacePath,
	normalizeWorkspacePath,
	pruneMissingWorkspaces,
} from './workspace-registry';

/** All valid style preset keys — single source of truth for migration. */
const VALID_STYLE_PRESETS = ['earth', 'nordic', 'aurora', 'island', 'tundra', 'blossom', 'matcha', 'lilac', 'neon', 'volt', 'magma', 'onyx', 'mono'] as const;

/** Removed or renamed presets mapped to a sensible replacement. */
const DEPRECATED_STYLE_PRESETS: Readonly<Record<string, string>> = {
	// Removed in favor of similar themes:
	prism: 'blossom',   // rose glass -> Blossom (rose glass)
	dusk: 'lilac',      // purple twilight -> Lilac (Morandi purple)
	sakura: 'blossom',  // cherry blossom pink -> Blossom
	moonlight: 'nordic',// silver blue -> Nordic (blue minimal)
	ember: 'magma',      // warm smoke -> Magma (dark + warm orange)
	haze: 'volt',       // dark cyan glow -> Volt (dark + electric cyan)
	jade: 'matcha',     // green bamboo -> Matcha (Morandi green)
	carbon: 'mono',     // industrial monochrome -> Mono (b/w minimal)
};

/**
 * Normalize a saved style preset: map removed/renamed presets to a valid
 * replacement, and fall back to the default if the value is unknown.
 */
function migrateStylePreset(preset: string): string {
	if ((VALID_STYLE_PRESETS as readonly string[]).includes(preset)) {
		return preset;
	}
	return DEPRECATED_STYLE_PRESETS[preset] ?? DEFAULT_SETTINGS.stylePreset;
}

/**
 * Migrate the legacy single-countdown fields (countdownTargetDate etc.) into
 * the new countdowns[] list. Existing list entries are preserved as-is.
 */
function migrateCountdowns(raw: Record<string, unknown>): CountdownConfig[] {
	if (Array.isArray(raw.countdowns)) {
		return (raw.countdowns as CountdownConfig[]).filter(c => c && typeof c.id === 'string');
	}
	const targetDate = typeof raw.countdownTargetDate === 'string' ? raw.countdownTargetDate : '';
	if (!targetDate) return [];
	return [{
		id: 'migrated',
		label: typeof raw.countdownLabel === 'string' ? raw.countdownLabel : '',
		targetDate,
		displayMode: raw.countdownDisplayMode === 'hours' || raw.countdownDisplayMode === 'minutes' ? raw.countdownDisplayMode : 'days',
		reminderDays: typeof raw.countdownReminderDays === 'number' ? raw.countdownReminderDays : 0,
	}];
}

export default class DashboardPlugin extends Plugin {
	settings!: DashboardSettings;
	backupService!: BackupService;
	mediaTagService!: MediaTagService;
	habitService!: HabitService;
	expenseService!: ExpenseService;

	async onload(): Promise<void> {
			await this.loadSettings();

			this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

		this.backupService = new BackupService(this);
		// The 60s tick is registered so Obsidian clears it on unload automatically.
		this.registerInterval(window.setInterval(() => { void this.backupService.tick(); }, 60_000));

		this.mediaTagService = new MediaTagService(this);
		this.mediaTagService.load();
		registerMediaTagService(this.mediaTagService);

		// Await the loads so habits.json / expense.json are ready before any view
		// first renders. Both load in parallel: each is an independent file, and
		// on mobile either can block on an iCloud download — serial awaits would
		// stack both waits into startup latency.
		this.habitService = new HabitService(this);
		this.expenseService = new ExpenseService(this);
		await Promise.all([this.habitService.load(), this.expenseService.load()]);
		registerHabitService(this.habitService);
		registerExpenseService(this.expenseService);

		this.addRibbonIcon('home', t('main.openDashboard'), () => this.openDashboard());

		this.addCommand({
			id: 'open-dashboard',
			name: t('main.openDashboard'),
			callback: () => this.openDashboard(),
		});

		this.addCommand({
			id: 'cycle-theme',
			name: t('main.cycleTheme'),
			callback: async () => {
				const themes = ['earth', 'nordic', 'aurora', 'island', 'tundra', 'blossom', 'matcha', 'lilac', 'neon', 'volt', 'magma', 'onyx', 'mono'];
				const idx = themes.indexOf(this.settings.stylePreset);
				const next = themes[(idx + 1) % themes.length] ?? 'earth';
				this.settings = { ...this.settings, stylePreset: next };
				await this.saveSettings();
				this.refreshAllDashboards();
			},
		});

		this.addCommand({
			id: 'next-workspace',
			name: t('main.nextWorkspace'),
			callback: () => this.cycleWorkspace(1),
		});

		this.addCommand({
			id: 'previous-workspace',
			name: t('main.prevWorkspace'),
			callback: () => this.cycleWorkspace(-1),
		});

		this.addCommand({
			id: 'toggle-note-popover',
			name: t('main.toggleNotePopover'),
			callback: async () => {
				const value = !this.settings.disableNotePopover;
				this.settings = { ...this.settings, disableNotePopover: value };
				await this.saveSettings();
				new Notice(value ? t('main.notePopoverOff') : t('main.notePopoverOn'));
			},
		});

		this.addCommand({
			id: 'add-section',
			name: t('main.addSection'),
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
				if (leaves.length === 0) {
					new Notice(t('main.openDashboard'));
					return;
				}
				const leaf = leaves[0]!;
				if (leaf.view instanceof DashboardView) {
					void leaf.view.addSection();
				}
			},
		});

		this.addCommand({
			id: 'toggle-banner-mode',
			name: t('main.toggleBannerMode'),
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
				if (leaves.length === 0) {
					new Notice(t('main.openDashboard'));
					return;
				}
				const leaf = leaves[0]!;
				if (leaf.view instanceof DashboardView) {
					void leaf.view.toggleBannerMode();
				}
			},
		});

		this.addSettingTab(new DashboardSettingTab(this.app, this));

		this.maybeShowDataviewGuide();

		// Registry hygiene: drop entries whose file vanished (sync lag, manual
		// deletion). After layout ready so the vault file index is settled.
		this.app.workspace.onLayoutReady(() => { void this.pruneWorkspaceRegistry(); });
		// Keep the registry following the file explorer: renames/deletes of a
		// workspace file update the list (and the active entry) so the engine
		// watchers never point at a path that no longer exists.
		this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
			if (file instanceof TFile) void this.handleWorkspaceFileRenamed(file, oldPath);
		}));
		this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
			if (file instanceof TFile) void this.handleWorkspaceFileDeleted(file);
		}));
	}

	/**
	 * Announcement for the Dataview section + community group. Shown once per
	 * ANNOUNCEMENT content version on startup (after layout ready) — i.e. only
	 * when the announcement text actually changed, not on every plugin update.
	 */
	private maybeShowDataviewGuide(): void {
		if (this.settings.dataviewGuideShownVersion === ANNOUNCE_VERSION) {
			return;
		}
		this.app.workspace.onLayoutReady(() => {
			new DataviewGuideModal(this.app, () => { void this.markDataviewGuideSeen(); }).open();
		});
	}

	/** Record the current announcement content as seen. */
	private async markDataviewGuideSeen(): Promise<void> {
		this.settings = { ...this.settings, dataviewGuideShownVersion: ANNOUNCE_VERSION };
		await this.saveSettings();
	}

	onunload(): void {
		// registerView cleanup is automatic
		teardownBasenameIndex(this.app);
		registerMediaTagService(null);
		void this.mediaTagService.flush();
		this.mediaTagService.destroy();
		registerHabitService(null);
		this.habitService.destroy();
		registerExpenseService(null);
		this.expenseService.destroy();
	}

	private async openDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.setActiveLeaf(existing[0]!, { focus: true });
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
	}

	async loadSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		const raw = (loaded ?? {}) as Record<string, unknown> & Partial<DashboardSettings>;
		// Migrate old widgetTheme combo to individual flags
		if ('widgetTheme' in raw && typeof raw.widgetTheme === 'string') {
			const theme = raw.widgetTheme;
			raw.widgetWeatherEnabled = theme !== 'off';
			delete raw.widgetTheme;
		}
		// Migrate removed/renamed style presets so saved settings stay valid
		if (typeof raw.stylePreset === 'string') {
			raw.stylePreset = migrateStylePreset(raw.stylePreset);
		}
		// Migrate single-countdown flat fields to the countdowns[] list
		const countdowns = migrateCountdowns(raw);
		// Sanitize the media tag map (drop malformed entries, empty lists)
		const mediaTags = sanitizeMediaTags(raw.mediaTags);
		// Validate the workspace registry (files list + active entry)
		const workspace = migrateWorkspaces(raw);
		this.settings = {
			...DEFAULT_SETTINGS,
			...raw,
			countdowns,
			mediaTags,
			workspaceFiles: workspace.files,
			workspaceNames: workspace.names,
			dashboardFile: workspace.active,
		};
		// First install only (no data.json has ever existed): start with the
		// Common Actions bar enabled and the sidebar pinned open. Applied here
		// instead of DEFAULT_SETTINGS so users upgrading from older versions —
		// whose data.json may lack these keys — keep their current state.
		if (loaded === null) {
			this.settings = { ...this.settings, quickNotesEnabled: true, widgetHabitEnabled: true };
			this.app.saveLocalStorage('apex-dashboard-sidebar-pinned', 'true');
			await this.saveSettings();
		}
		setLanguage(this.settings.language);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshAllDashboards(): void {
		const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof DashboardView) {
				void leaf.view.refresh();
			}
		}
	}

	/** Reload every open dashboard view from disk (used after a backup restore). */
	async reloadAllDashboards(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof DashboardView) {
				await leaf.view.reloadFromDisk();
			}
		}
	}

	// --- Multi-workspace orchestration -------------------------------------

	/** Serializes registry mutations + engine repoints: rapid clicks or a vault
	 *  rename/delete racing a user switch must never interleave two switchFile()
	 *  sequences on the same engine (duplicate watchers, duplicate renders). */
	private workspaceOps: Promise<void> = Promise.resolve();

	private runWorkspaceOp(op: () => Promise<void>): Promise<void> {
		const run = this.workspaceOps.then(op);
		this.workspaceOps = run.catch((err: unknown) => {
			console.error('Workspace operation failed:', err);
		});
		return this.workspaceOps;
	}

	/** File-existence check against the vault, extensionless path in. */
	private workspaceFileExists(path: string): boolean {
		const withExt = path.endsWith('.md') ? path : `${path}.md`;
		return !!this.app.vault.getFileByPath(withExt);
	}

	/** Switch the active workspace. `path` is a registry path (no .md). */
	async switchWorkspace(path: string): Promise<void> {
		return this.runWorkspaceOp(() => this.doSwitchWorkspace(path));
	}

	private async doSwitchWorkspace(path: string): Promise<void> {
		const target = normalizeWorkspacePath(path);
		if (!target || target === normalizeWorkspacePath(this.settings.dashboardFile)) return;
		if (!this.settings.workspaceFiles.includes(target)) return;
		this.settings = { ...this.settings, dashboardFile: target };
		// Persist BEFORE re-pointing engines: a crash mid-switch then reopens
		// on the new workspace instead of resurrecting the old one.
		await this.saveSettings();
		await this.repointAllViews();
	}

	/** Point every open dashboard view's engine at the (already-updated)
	 *  active workspace file and reload. Serial on purpose: each engine drains
	 *  its own queued writes into the OLD file before re-pointing, so two open
	 *  views never cross-write between workspace files. */
	private async repointAllViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof DashboardView) {
				await leaf.view.applyWorkspaceSwitch();
			}
		}
	}

	/** Create a new workspace file with default board content, register it and
	 *  switch to it. */
	async createWorkspace(name: string): Promise<void> {
		return this.runWorkspaceOp(() => this.doCreateWorkspace(name));
	}

	private async doCreateWorkspace(name: string): Promise<void> {
		const trimmed = name.trim();
		const path = nextWorkspacePath(
			this.settings.workspaceFiles,
			trimmed,
			(p) => this.workspaceFileExists(p),
		);
		try {
			const withExt = path.endsWith('.md') ? path : `${path}.md`;
			await this.app.vault.create(withExt, generateDefaultMarkdown());
		} catch (err) {
			console.error('Workspace file creation failed:', err);
			new Notice(t('workspace.createFailed'));
			return;
		}
		const names = alignWorkspaceNames(this.settings.workspaceFiles, this.settings.workspaceNames);
		this.settings = {
			...this.settings,
			workspaceFiles: [...this.settings.workspaceFiles, path],
			workspaceNames: [...names, trimmed],
			dashboardFile: path,
		};
		await this.saveSettings();
		await this.repointAllViews();
		new Notice(t('workspace.created', { name: trimmed || path }));
	}

	/** Rename a workspace's display name (tooltip/label only, file untouched). */
	async renameWorkspace(path: string, name: string): Promise<void> {
		const target = normalizeWorkspacePath(path);
		const idx = this.settings.workspaceFiles.indexOf(target);
		if (idx < 0) return;
		const trimmed = name.trim();
		const names = alignWorkspaceNames(this.settings.workspaceFiles, this.settings.workspaceNames);
		if (names[idx] === trimmed) return;
		this.settings = {
			...this.settings,
			workspaceNames: names.map((n, i) => (i === idx ? trimmed : n)),
		};
		await this.saveSettings();
		// Only labels change — a plain refresh rebuilds the banner switcher.
		this.refreshAllDashboards();
	}

	/** Unregister a workspace (the md file itself is kept on disk). Removing the
	 *  active workspace switches to the first remaining one. */
	async removeWorkspace(path: string): Promise<void> {
		return this.runWorkspaceOp(() => this.doRemoveWorkspace(path));
	}

	private async doRemoveWorkspace(path: string): Promise<void> {
		const files = this.settings.workspaceFiles;
		if (files.length <= 1) return;
		const target = normalizeWorkspacePath(path);
		const idx = files.indexOf(target);
		if (idx < 0) return;
		const names = alignWorkspaceNames(files, this.settings.workspaceNames);
		const nextFiles = files.filter((_, i) => i !== idx);
		const nextActive = target === normalizeWorkspacePath(this.settings.dashboardFile)
			? nextFiles[0]!
			: this.settings.dashboardFile;
		this.settings = {
			...this.settings,
			workspaceFiles: nextFiles,
			workspaceNames: names.filter((_, i) => i !== idx),
			dashboardFile: nextActive,
		};
		await this.saveSettings();
		await this.repointAllViews();
	}

	/** Reorder the workspace registry (banner pill order). Both indices refer
	 *  to the CURRENT registry order. */
	async reorderWorkspaces(from: number, to: number): Promise<void> {
		return this.runWorkspaceOp(() => this.doReorderWorkspaces(from, to));
	}

	private async doReorderWorkspaces(from: number, to: number): Promise<void> {
		const files = [...this.settings.workspaceFiles];
		const names = alignWorkspaceNames(files, this.settings.workspaceNames);
		if (from < 0 || from >= files.length || to < 0 || to >= files.length || from === to) return;
		const [movedFile] = files.splice(from, 1);
		const [movedName] = names.splice(from, 1);
		files.splice(to, 0, movedFile!);
		names.splice(to, 0, movedName!);
		this.settings = { ...this.settings, workspaceFiles: files, workspaceNames: names };
		await this.saveSettings();
		// Active workspace unchanged — only the pill order/numbers re-render.
		this.refreshAllDashboards();
	}

	/** Point a registered workspace at a new file location (e.g. after the user
	 *  moved the md outside Obsidian, where the vault rename listener cannot
	 *  follow). The target file must already exist and not be registered. */
	async retargetWorkspace(oldPath: string, newPath: string): Promise<void> {
		return this.runWorkspaceOp(() => this.doRetargetWorkspace(oldPath, newPath));
	}

	private async doRetargetWorkspace(oldPath: string, newPath: string): Promise<void> {
		const target = normalizeWorkspacePath(oldPath);
		const next = normalizeWorkspacePath(newPath);
		const idx = this.settings.workspaceFiles.indexOf(target);
		if (idx < 0 || !next || next === target) return;
		if (this.settings.workspaceFiles.includes(next)) {
			new Notice(t('workspace.pathExists'));
			return;
		}
		if (!this.workspaceFileExists(next)) {
			new Notice(t('workspace.pathNotFound', { file: `${next}.md` }));
			return;
		}
		const files = this.settings.workspaceFiles.map((p, i) => (i === idx ? next : p));
		const names = alignWorkspaceNames(this.settings.workspaceFiles, this.settings.workspaceNames);
		const active = normalizeWorkspacePath(this.settings.dashboardFile);
		const activeChanged = active === target;
		this.settings = {
			...this.settings,
			workspaceFiles: files,
			workspaceNames: names,
			dashboardFile: activeChanged ? next : this.settings.dashboardFile,
		};
		await this.saveSettings();
		if (activeChanged) {
			await this.repointAllViews();
		} else {
			this.refreshAllDashboards();
		}
	}

	/** Switch to the adjacent workspace (wraps around; no-op with one). */
	private cycleWorkspace(delta: 1 | -1): void {
		const files = this.settings.workspaceFiles;
		if (files.length < 2) return;
		const active = normalizeWorkspacePath(this.settings.dashboardFile);
		const idx = Math.max(0, files.indexOf(active));
		const next = files[(idx + delta + files.length) % files.length]!;
		void this.switchWorkspace(next);
	}

	/** Drop registry entries whose board file no longer exists. The active
	 *  entry is never pruned (SyncEngine recreates it), so no repoint is needed. */
	private async pruneWorkspaceRegistry(): Promise<void> {
		const active = normalizeWorkspacePath(this.settings.dashboardFile);
		const pruned = pruneMissingWorkspaces(
			this.settings.workspaceFiles,
			alignWorkspaceNames(this.settings.workspaceFiles, this.settings.workspaceNames),
			active,
			(p) => this.workspaceFileExists(p),
		);
		if (pruned.files.length === this.settings.workspaceFiles.length) return;
		this.settings = {
			...this.settings,
			workspaceFiles: pruned.files,
			workspaceNames: pruned.names,
		};
		await this.saveSettings();
		// Refresh so the banner switcher drops the vanished buttons.
		this.refreshAllDashboards();
	}

	/** A workspace file renamed in the file explorer: follow it in the registry
	 *  (and as the active path when applicable), then re-point the engines —
	 *  they still hold the same TFile, but their modify watcher captured the
	 *  old path string and must be re-registered. */
	private handleWorkspaceFileRenamed(file: TFile, oldPath: string): Promise<void> {
		return this.runWorkspaceOp(() => this.doHandleWorkspaceFileRenamed(file, oldPath));
	}

	private async doHandleWorkspaceFileRenamed(file: TFile, oldPath: string): Promise<void> {
		const oldEntry = normalizeWorkspacePath(oldPath);
		const idx = this.settings.workspaceFiles.indexOf(oldEntry);
		if (idx < 0) return;
		const newEntry = normalizeWorkspacePath(file.path);
		const names = alignWorkspaceNames(this.settings.workspaceFiles, this.settings.workspaceNames);
		const active = normalizeWorkspacePath(this.settings.dashboardFile);
		this.settings = {
			...this.settings,
			workspaceFiles: this.settings.workspaceFiles.map((p, i) => (i === idx ? newEntry : p)),
			workspaceNames: names,
			dashboardFile: active === oldEntry ? newEntry : this.settings.dashboardFile,
		};
		await this.saveSettings();
		await this.repointAllViews();
	}

	/** A workspace file deleted in the file explorer: drop it from the registry
	 *  and, when it was active, fall back to the first remaining workspace. */
	private handleWorkspaceFileDeleted(file: TFile): Promise<void> {
		return this.runWorkspaceOp(() => this.doHandleWorkspaceFileDeleted(file));
	}

	private async doHandleWorkspaceFileDeleted(file: TFile): Promise<void> {
		const entry = normalizeWorkspacePath(file.path);
		const files = this.settings.workspaceFiles;
		const idx = files.indexOf(entry);
		if (idx < 0) return;
		if (files.length <= 1) {
			// Last workspace file gone: reset to the default entry. The engine's
			// findOrCreateFile() recreates a default board rather than crashing
			// on an empty registry.
			this.settings = {
				...this.settings,
				workspaceFiles: ['dashboard'],
				workspaceNames: [''],
				dashboardFile: 'dashboard',
			};
		} else {
			const names = alignWorkspaceNames(files, this.settings.workspaceNames);
			const nextFiles = files.filter((_, i) => i !== idx);
			const active = normalizeWorkspacePath(this.settings.dashboardFile);
			this.settings = {
				...this.settings,
				workspaceFiles: nextFiles,
				workspaceNames: names.filter((_, i) => i !== idx),
				dashboardFile: active === entry ? nextFiles[0]! : this.settings.dashboardFile,
			};
		}
		await this.saveSettings();
		await this.repointAllViews();
	}
}
