import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type DashboardSettings, type CountdownConfig } from './types';
import { DashboardSettingTab } from './settings';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './view';
import { BackupService } from './backup-service';
import { setLanguage, t } from './i18n';
import { DataviewGuideModal } from './dataview-guide-modal';
import { teardownBasenameIndex } from './renderer';
import { MediaTagService, sanitizeMediaTags, registerMediaTagService } from './media-tags';

/** All valid style preset keys — single source of truth for migration. */
const VALID_STYLE_PRESETS = ['earth', 'nordic', 'aurora', 'island', 'tundra', 'blossom', 'matcha', 'lilac', 'haze', 'jade', 'carbon', 'onyx', 'mono'] as const;

/** Removed or renamed presets mapped to a sensible replacement. */
const DEPRECATED_STYLE_PRESETS: Readonly<Record<string, string>> = {
	// Removed in favor of similar themes:
	prism: 'blossom',   // rose glass -> Blossom (rose glass)
	dusk: 'lilac',      // purple twilight -> Lilac (Morandi purple)
	sakura: 'blossom',  // cherry blossom pink -> Blossom
	moonlight: 'nordic',// silver blue -> Nordic (blue minimal)
	ember: 'carbon',    // warm smoke -> Eclipse (dark warm)
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

	async onload(): Promise<void> {
			await this.loadSettings();

			this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

		this.backupService = new BackupService(this);
		// The 60s tick is registered so Obsidian clears it on unload automatically.
		this.registerInterval(window.setInterval(() => { void this.backupService.tick(); }, 60_000));

		this.mediaTagService = new MediaTagService(this);
		this.mediaTagService.load();
		registerMediaTagService(this.mediaTagService);

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
				const themes = ['earth', 'nordic', 'aurora', 'island', 'tundra', 'blossom', 'matcha', 'lilac', 'haze', 'jade', 'carbon', 'onyx', 'mono'];
				const idx = themes.indexOf(this.settings.stylePreset);
				const next = themes[(idx + 1) % themes.length] ?? 'earth';
				this.settings = { ...this.settings, stylePreset: next };
				await this.saveSettings();
				this.refreshAllDashboards();
			},
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
	}

	/**
	 * Announcement for the Dataview section + community group. Shown once per
	 * plugin version on startup (after layout ready) — i.e. on install/update
	 * of the plugin, not on every Obsidian launch.
	 */
	private maybeShowDataviewGuide(): void {
		if (this.settings.dataviewGuideShownVersion === this.manifest.version) {
			return;
		}
		this.app.workspace.onLayoutReady(() => {
			new DataviewGuideModal(this.app, () => { void this.markDataviewGuideSeen(); }).open();
		});
	}

	/** Record the current version as having shown the dataview announcement. */
	private async markDataviewGuideSeen(): Promise<void> {
		this.settings = { ...this.settings, dataviewGuideShownVersion: this.manifest.version };
		await this.saveSettings();
	}

	onunload(): void {
		// registerView cleanup is automatic
		teardownBasenameIndex(this.app);
		registerMediaTagService(null);
		void this.mediaTagService.flush();
		this.mediaTagService.destroy();
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
		const loaded = await this.loadData();
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
		this.settings = {
			...DEFAULT_SETTINGS,
			...raw,
			countdowns,
			mediaTags,
		};
		// First install only (no data.json has ever existed): start with the
		// Common Actions bar enabled and the sidebar pinned open. Applied here
		// instead of DEFAULT_SETTINGS so users upgrading from older versions —
		// whose data.json may lack these keys — keep their current state.
		if (loaded === null) {
			this.settings = { ...this.settings, quickNotesEnabled: true };
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
}
