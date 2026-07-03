import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type DashboardSettings, type CountdownConfig } from './types';
import { DashboardSettingTab } from './settings';
import { DashboardView, DASHBOARD_VIEW_TYPE } from './view';
import { setLanguage, t } from './i18n';

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

	async onload(): Promise<void> {
			await this.loadSettings();

			this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

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

		this.addSettingTab(new DashboardSettingTab(this.app, this));
	}

	onunload(): void {
		// registerView cleanup is automatic
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
		const raw = (await this.loadData() ?? {}) as Record<string, unknown> & Partial<DashboardSettings>;
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
		this.settings = {
			...DEFAULT_SETTINGS,
			...raw,
			countdowns,
		};
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
}
