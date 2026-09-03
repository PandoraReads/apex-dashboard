import { App, Notice, PluginSettingTab, setIcon, Setting, type SettingDefinitionItem, type TextComponent } from 'obsidian';
import type DashboardPlugin from './main';
import { type DashboardSettings, type CountdownConfig, type BackupPeriod } from './types';
import { t, setLanguage, type Language } from './i18n';
import { geocodeCity } from './weather-service';
import { CountdownSettingsModal } from './countdown-modal';
import { MultiFolderSelectModal } from './folder-config-modal';
import { TickTickLoginModal } from './ticktick-login-modal';
import { ThemeStudioModal } from './theme-studio-modal';
import { QuickNoteConfigModal } from './quick-note-config-modal';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';
import { normalizeWorkspacePath } from './workspace-registry';
import { DEFAULT_TICKTICK_TZ, isValidTz } from './ticktick-tz';
import { PathPickerModal } from './path-picker-modal';
import { SUPPORT_IMAGE_DATA_URL } from './assets/support-image';

export type { DashboardSettings };

/** The three settings pages, shared by the declarative (1.13+) navigable
 *  definitions and the pre-1.13 fallback tab bar. */
type SettingsPage = 'general' | 'widgets' | 'coffee';

export class DashboardSettingTab extends PluginSettingTab {
	plugin: DashboardPlugin;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings bridge (Obsidian 1.13+): one inline group whose
	 * first row is a horizontal tab bar (常规 / 小组件 / Buy Me a Coffee,
	 * defaulting to 常规). Every section stays a real definition row — tagged
	 * with its page and hidden via CSS while another tab is active — so
	 * Obsidian's unified settings search keeps indexing them all. Tab clicks
	 * only toggle row visibility in place; `update()` re-renders through the
	 * same callbacks and re-applies `activePage`, so no drift between the
	 * declarative path and the pre-1.13 fallback.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		// Each section renders inside one definition row. Obsidian styles rows
		// as horizontal flex (.setting-item), which would lay the section's
		// many rows out sideways — mark the host so CSS neutralizes it back
		// to a plain block container (styles.css), stacking vertically like
		// the pre-1.13 fallback tab. The .setting-item class itself stays so
		// Obsidian's search/scroll machinery keeps working.
		const asBlock = (setting: Setting) => {
			setting.settingEl.addClass('dashboard-settings-section');
			setting.settingEl.empty();
		};
		// Tag a section row with its page and hide it when another tab is
		// active (re-evaluated on every update() re-render).
		const onPage = (page: SettingsPage) => (setting: Setting) => {
			setting.settingEl.dataset.settingsPage = page;
			setting.settingEl.toggleClass('dashboard-settings-page-hidden', this.activePage !== page);
		};
		return [
			{
				type: 'group',
				items: [
					{
						name: t('settings.general'),
						searchable: false, // the tab bar, not a setting
						render: (setting) => {
							asBlock(setting);
							this.renderTabBar(setting.settingEl);
						},
					},
					{
						name: t('settings.general'),
						desc: t('settings.languageDesc'),
						aliases: [t('settings.language'), t('settings.stylePreset'), t('settings.recentCount'), t('quickNote.title'), t('settings.workspaceList')],
						render: (setting) => {
							asBlock(setting);
							onPage('general')(setting);
							this.renderGeneralSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.dataServices'),
						desc: t('settings.wereadApiKeyDesc'),
						aliases: [t('settings.wereadApiKey'), t('settings.ticktickRegion'), t('settings.ticktickCookie')],
						render: (setting) => {
							asBlock(setting);
							onPage('general')(setting);
							this.renderServiceSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.backup'),
						desc: t('settings.backupEnabledDesc'),
						aliases: [t('settings.backupPeriod'), t('settings.restoreLatest')],
						render: (setting) => {
							asBlock(setting);
							onPage('general')(setting);
							this.renderBackupSettings(setting.settingEl);
						},
					},
					{
						name: "crafted by Pandora's Digital Garden",
						searchable: false, // a footer, not a setting
						render: (setting) => {
							asBlock(setting);
							onPage('general')(setting);
							setting.settingEl.createDiv({ cls: 'dashboard-settings-footer', text: "crafted by Pandora's Digital Garden" });
						},
					},
					{
						name: t('settings.widgetTheme'),
						desc: t('settings.widgetWeatherEnabledDesc'),
						aliases: [t('settings.widgetWeatherEnabled'), t('settings.widgetQuickActionsEnabled'), t('settings.countdownEnabled'), t('settings.pomodoroEnabled'), t('settings.readingEnabled'), t('settings.widgetHabitEnabled'), t('settings.widgetExpenseEnabled')],
						render: (setting) => {
							asBlock(setting);
							onPage('widgets')(setting);
							this.renderWeatherSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.widgetCalendar'),
						desc: t('settings.widgetCalendarEnabledDesc'),
						aliases: [t('settings.widgetCalendarExclude')],
						render: (setting) => {
							asBlock(setting);
							onPage('widgets')(setting);
							this.renderCalendarSettings(setting.settingEl);
						},
					},
					{
						// Continuation of the widgetTheme block (pomodoro,
						// reading, habit, expense, countdown) — rendered between
						// the calendar section above and the lunar/year sections
						// below. The cards stay searchable through the
						// widgetTheme entry's aliases.
						name: t('settings.widgetTheme'),
						searchable: false,
						render: (setting) => {
							asBlock(setting);
							onPage('widgets')(setting);
							this.renderWidgetSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.widgetLunar'),
						desc: t('settings.widgetLunarEnabledDesc'),
						render: (setting) => {
							asBlock(setting);
							onPage('widgets')(setting);
							this.renderLunarSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.widgetYearProgress'),
						desc: t('settings.widgetYearProgressEnabledDesc'),
						render: (setting) => {
							asBlock(setting);
							onPage('widgets')(setting);
							this.renderYearProgressSettings(setting.settingEl);
						},
					},
					{
						name: t('settings.tabAbout'),
						searchable: false, // pure content, not a setting
						render: (setting) => {
							asBlock(setting);
							onPage('coffee')(setting);
							this.renderCoffeeSettings(setting.settingEl);
						},
					},
				],
			},
		];
	}

	/** The three pages, shared by the declarative tab bar and the pre-1.13
	 *  fallback (and remembered across update() re-renders). */
	private activePage: SettingsPage = 'general';

	private settingsTabs(): Array<{ key: SettingsPage; label: string; icon: string }> {
		return [
			{ key: 'general', label: t('settings.tabGeneral'), icon: 'settings' },
			{ key: 'widgets', label: t('settings.tabWidgets'), icon: 'layout-grid' },
			{ key: 'coffee', label: t('settings.tabAbout'), icon: 'user-round' },
		];
	}

	/** Horizontal tab bar. In the declarative path a click flips row
	 *  visibility in place (no re-render, scroll kept); the fallback passes
	 *  onSwitch to redraw the active page. */
	private renderTabBar(host: HTMLElement, onSwitch?: () => void): void {
		const bar = host.createDiv({ cls: 'dashboard-settings-tabs' });
		for (const tab of this.settingsTabs()) {
			const btn = bar.createDiv({
				cls: 'dashboard-settings-tab' + (tab.key === this.activePage ? ' active' : ''),
			});
			setIcon(btn.createSpan({ cls: 'dashboard-settings-tab-icon' }), tab.icon);
			btn.createSpan({ text: tab.label });
			btn.addEventListener('click', () => {
				this.activePage = tab.key;
				if (onSwitch) {
					onSwitch();
					return;
				}
				// Declarative path: toggle the tagged section rows in place.
				this.containerEl.querySelectorAll<HTMLElement>('[data-settings-page]').forEach((row) => {
					row.toggleClass('dashboard-settings-page-hidden', row.dataset.settingsPage !== this.activePage);
				});
				bar.querySelectorAll('.dashboard-settings-tab').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}
	}

	/** Fallback renderer for Obsidian < 1.13 (declarative API absent): the
	 *  same horizontal tab bar, switching by redrawing the active page. */
	display(): void {
		this.renderFallback();
	}

	private renderFallback(): void {
		const { containerEl } = this;
		containerEl.empty();

		const barHost = containerEl.createDiv();
		this.renderTabBar(barHost, () => this.renderFallback());

		const host = containerEl.createDiv({ cls: 'dashboard-settings-tab-body' });
		if (this.activePage === 'general') {
			this.renderGeneralSettings(host);
			this.renderServiceSettings(host);
			this.renderBackupSettings(host);
			containerEl.createDiv({ cls: 'dashboard-settings-footer', text: "crafted by Pandora's Digital Garden" });
		} else if (this.activePage === 'widgets') {
			this.renderWeatherSettings(host);
			this.renderCalendarSettings(host);
			this.renderWidgetSettings(host);
			this.renderLunarSettings(host);
			this.renderYearProgressSettings(host);
		} else {
			this.renderCoffeeSettings(host);
		}
	}

	/** Redraw when the sections themselves change (a widget toggled on/off,
	 *  countdown added, ...). update() arrived with the declarative API in
	 *  1.13; older builds have no definitions to rebuild from and redraw via
	 *  display() instead. */
	private refresh(): void {
		const tab = this as unknown as { update?: () => void };
		if (typeof tab.update === 'function') tab.update();
		else this.renderFallback();
	}

	/** Top block: language, style, quick notes, paths. Shared by display()
	 *  (pre-1.13) and the declarative General section (1.13+). */
	private renderGeneralSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.language'))
			.setDesc(t('settings.languageDesc'))
			.addDropdown(dropdown => dropdown
				.addOptions({
					en: t('settings.languageEn'),
					zh: t('settings.languageZh'),
				})
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					const lang = value as Language;
					this.plugin.settings = {
						...this.plugin.settings,
						language: lang,
					};
					setLanguage(lang);
					await this.plugin.saveSettings();
					this.refresh();
					this.plugin.refreshAllDashboards();
				}));

		new Setting(containerEl)
			.setName(t('settings.stylePreset'))
			.setDesc(t('settings.stylePresetDesc'))
			.addDropdown(dropdown => dropdown
				.addOptions({
					earth: t('settings.styleEarth'),
					nordic: t('settings.styleNordic'),
					aurora: t('settings.styleAurora'),
					island: t('settings.styleIsland'),
					tundra: t('settings.styleTundra'),
					blossom: t('settings.styleBlossom'),
					matcha: t('settings.styleMatcha'),
					lilac: t('settings.styleLilac'),
					neon: t('settings.styleNeon'),
					volt: t('settings.styleVolt'),
					magma: t('settings.styleMagma'),
					onyx: t('settings.styleOnyx'),
					mono: t('settings.styleMono'),
				})
				.setValue(this.plugin.settings.stylePreset)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						stylePreset: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));

		new Setting(containerEl)
			.setName(t('themeStudio.title'))
			.setDesc(t('themeStudio.settingsDesc'))
			.addButton(btn => btn
				.setButtonText(t('themeStudio.open'))
				.setCta()
				.onClick(() => {
					new ThemeStudioModal(this.app, this.plugin).open();
				}));

		new Setting(containerEl)
			.setName(t('quickNote.title'))
			.setDesc(t('quickNote.settingsDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.quickNotesEnabled)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, quickNotesEnabled: value };
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}))
			.addButton(btn => btn
				.setButtonText(t('quickNote.config'))
				.onClick(() => {
					new QuickNoteConfigModal(this.app, this.plugin).open();
				}));

		const recentSetting = new Setting(containerEl)
			.setName(t('settings.recentCount') + '  ' + this.plugin.settings.recentDocCount)
			.setDesc(t('settings.recentCountDesc'))
			.addSlider(slider => slider
				.setLimits(3, 15, 1)
				.setValue(this.plugin.settings.recentDocCount)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						recentDocCount: value,
					};
					await this.plugin.saveSettings();
					recentSetting.nameEl.setText(t('settings.recentCount') + '  ' + value);
				}));

		this.renderWorkspaceSettings(containerEl);

		let memoInput: TextComponent | undefined;
		new Setting(containerEl)
			.setName(t('settings.memoSavePath'))
			.setDesc(t('settings.memoSavePathDesc'))
			.addText(text => {
				memoInput = text;
				text
					.setPlaceholder('Memos')
					.setValue(this.plugin.settings.memoSavePath)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							memoSavePath: value.trim(),
						};
						await this.plugin.saveSettings();
					});
			})
			// Browse button: pick an existing folder instead of typing its path.
			.addExtraButton(btn => btn
				.setIcon('folder-search')
				.setTooltip(t('pathPicker.pickFolder'))
				.onClick(() => {
					new PathPickerModal(this.app, 'folder', (path) => {
						this.plugin.settings = {
							...this.plugin.settings,
							memoSavePath: path,
						};
						void this.plugin.saveSettings();
						memoInput?.setValue(path);
					}).open();
				}));

		let archiveInput: TextComponent | undefined;
		new Setting(containerEl)
			.setName(t('settings.taskArchivePath'))
			.setDesc(t('settings.taskArchivePathDesc'))
			.addText(text => {
				archiveInput = text;
				text
					.setPlaceholder('Archive/Done.md')
					.setValue(this.plugin.settings.taskArchivePath)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							taskArchivePath: value.trim(),
						};
						await this.plugin.saveSettings();
					});
			})
			.addExtraButton(btn => btn
				.setIcon('file-search')
				.setTooltip(t('pathPicker.pickFile'))
				.onClick(() => {
					new PathPickerModal(this.app, 'file', (path) => {
						this.plugin.settings = {
							...this.plugin.settings,
							taskArchivePath: path,
						};
						void this.plugin.saveSettings();
						archiveInput?.setValue(path);
					}).open();
				}));

		new Setting(containerEl)
			.setName(t('settings.disableNotePopover'))
			.setDesc(t('settings.disableNotePopoverDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.disableNotePopover)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, disableNotePopover: value };
					await this.plugin.saveSettings();
				}));
	}

	/** Workspace registry management: draggable rows (reorder), a path input
	 *  per workspace (retarget after moving the file outside Obsidian), rename
	 *  and remove. Activation happens via the banner pills / commands. */
	private renderWorkspaceSettings(containerEl: HTMLElement): void {
		const files = this.plugin.settings.workspaceFiles;
		const names = this.plugin.settings.workspaceNames ?? [];
		const active = normalizeWorkspacePath(this.plugin.settings.dashboardFile);

		// Standalone divider (own element — themes can't round/clip it) ahead
		// of the group heading.
		containerEl.createDiv({ cls: 'dashboard-settings-divider' });
		new Setting(containerEl)
			.setName(t('settings.workspaceList'))
			.setDesc(t('settings.workspaceListDesc'))
			.setHeading();

		/** Index of the row being dragged; null when idle. */
		let dragIndex: number | null = null;

		files.forEach((file, i) => {
			const name = names[i]?.trim() ?? '';
			const label = name || `#${i + 1}`;
			const isActive = normalizeWorkspacePath(file) === active;
			const setting = new Setting(containerEl)
				.setName(isActive ? `${label} · ${t('workspace.active')}` : label);
			const rowEl = setting.settingEl;
			rowEl.addClass('dashboard-workspace-row');

			// Path input: commit on Enter/blur only (not per keystroke); the
			// refresh on failure restores the stored value.
			setting.addText(text => {
				text.setPlaceholder('Dashboard').setValue(file);
				text.inputEl.addClass('dashboard-workspace-path-input');
				const commit = async () => {
					const value = text.inputEl.value;
					if (normalizeWorkspacePath(value) === normalizeWorkspacePath(file)) return;
					await this.plugin.retargetWorkspace(file, value);
					this.refresh();
				};
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void commit();
					}
				});
				text.inputEl.addEventListener('blur', () => { void commit(); });
			});

			setting.addExtraButton(btn => btn
				.setIcon('pencil')
				.setTooltip(t('workspace.renameTitle'))
				.onClick(async () => {
					const next = await showPromptDialog(this.app, {
						title: t('workspace.renameTitle'),
						placeholder: t('workspace.namePlaceholder'),
						defaultValue: name,
					});
					if (next !== null) {
						await this.plugin.renameWorkspace(file, next);
						this.refresh();
					}
				}));

			setting.addExtraButton(btn => btn
				.setIcon('trash-2')
				.setTooltip(files.length <= 1 ? t('workspace.lastCannotRemove') : t('workspace.removeTitle'))
				.setDisabled(files.length <= 1)
				.onClick(async () => {
					const confirmed = await showConfirmDialog(this.app, {
						title: t('workspace.removeTitle'),
						message: t('workspace.removeConfirm', { name: label, file: `${file}.md` }),
					});
					if (confirmed) {
						await this.plugin.removeWorkspace(file);
						this.refresh();
					}
				}));

			// Drag handle, prepended at the row's left edge. The ROW is the drag
			// source but only becomes draggable while the handle is pressed, so
			// text selection inside the path input is unaffected.
			const handle = createSpan({
				cls: 'dashboard-workspace-drag-handle',
				attr: { 'aria-label': t('workspace.dragReorder'), title: t('workspace.dragReorder') },
			});
			setIcon(handle, 'grip-vertical');
			rowEl.prepend(handle);
			handle.addEventListener('pointerdown', () => { rowEl.draggable = true; });
			handle.addEventListener('pointerup', () => { rowEl.draggable = false; });

			const clearIndicator = () => {
				rowEl.removeClass('dashboard-workspace-row--drop-before');
				rowEl.removeClass('dashboard-workspace-row--drop-after');
			};

			rowEl.addEventListener('dragstart', (e) => {
				dragIndex = i;
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', String(i));
				}
				rowEl.addClass('dashboard-workspace-row--dragging');
			});
			rowEl.addEventListener('dragend', () => {
				rowEl.draggable = false;
				rowEl.removeClass('dashboard-workspace-row--dragging');
				clearIndicator();
				dragIndex = null;
			});
			rowEl.addEventListener('dragover', (e) => {
				if (dragIndex === null || dragIndex === i) return;
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				const before = e.offsetY < rowEl.offsetHeight / 2;
				clearIndicator();
				rowEl.addClass(before ? 'dashboard-workspace-row--drop-before' : 'dashboard-workspace-row--drop-after');
			});
			rowEl.addEventListener('dragleave', clearIndicator);
			rowEl.addEventListener('drop', (e) => {
				e.preventDefault();
				const from = dragIndex;
				clearIndicator();
				if (from === null || from === i) return;
				// Insertion point: before this row (upper half) or after it.
				const insertPos = e.offsetY < rowEl.offsetHeight / 2 ? i : i + 1;
				const to = from < insertPos ? insertPos - 1 : insertPos;
				void this.plugin.reorderWorkspaces(from, to).then(() => this.refresh());
			});
		});

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText(t('workspace.add'))
				.setIcon('plus')
				.onClick(async () => {
					const fallback = t('workspace.defaultName', { n: files.length + 1 });
					const name = await showPromptDialog(this.app, {
						title: t('workspace.newTitle'),
						placeholder: t('workspace.namePlaceholder'),
						defaultValue: fallback,
					});
					if (name !== null) {
						await this.plugin.createWorkspace(name === '' ? fallback : name);
						this.refresh();
					}
				}));
	}

	/** Widgets tab, part 1: the section heading + weather card. Kept separate
	 *  from {@link renderWidgetSettings} so the calendar section can sit
	 *  directly beneath the weather card in the tab's card order. */
	private renderWeatherSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.widgetTheme')).setHeading();

		// --- Quick buttons card ---
		const quickActionsCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(quickActionsCard)
			.setName(t('settings.widgetQuickActionsEnabled'))
			.setDesc(t('settings.widgetQuickActionsEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetQuickActionsEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetQuickActionsEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));

		// --- Weather card ---
		const weatherCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(weatherCard)
			.setName(t('settings.widgetWeatherEnabled'))
			.setDesc(t('settings.widgetWeatherEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetWeatherEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetWeatherEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));

		if (this.plugin.settings.widgetWeatherEnabled) {
			new Setting(weatherCard)
				.setName(t('settings.widgetWeatherCity'))
				.setDesc(t('settings.widgetWeatherCityDesc'))
				.addText(text => {
					text
						.setPlaceholder(t('settings.widgetWeatherCityPlaceholder'))
						.setValue(this.plugin.settings.widgetWeatherCity)
						.onChange(async (value) => {
							this.plugin.settings = {
								...this.plugin.settings,
								widgetWeatherCity: value.trim(),
							};
							await this.plugin.saveSettings();
							// The suggestion click path updates lat/lon and refreshes
							// itself; manual typing only changes the display label, so
							// refresh here to redraw the widget with the new name.
							this.plugin.refreshAllDashboards();
						});
					this.attachCitySuggest(text.inputEl);
				});
		}
	}

	/** Widgets tab, part 2: pomodoro, reading, habit, expense, countdown.
	 *  Countdown renders after the expense card (the tab order is weather →
	 *  calendar → these five, with countdown last). */
	private renderWidgetSettings(containerEl: HTMLElement): void {
		// --- Pomodoro card ---
		const pomodoroCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(pomodoroCard)
			.setName(t('settings.pomodoroEnabled'))
			.setDesc(t('settings.pomodoroEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						pomodoroEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));

		if (this.plugin.settings.pomodoroEnabled) {
			const workSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroWork') + '  ' + this.plugin.settings.pomodoroWorkMinutes + ' min')
				.addSlider(slider => slider
					.setLimits(15, 60, 5)
					.setValue(this.plugin.settings.pomodoroWorkMinutes)
						.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroWorkMinutes: value,
						};
						await this.plugin.saveSettings();
						workSetting.nameEl.setText(t('settings.pomodoroWork') + '  ' + value + ' min');
					}));

			const shortSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroShortBreak') + '  ' + this.plugin.settings.pomodoroShortBreakMinutes + ' min')
				.addSlider(slider => slider
					.setLimits(1, 15, 1)
					.setValue(this.plugin.settings.pomodoroShortBreakMinutes)
						.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroShortBreakMinutes: value,
						};
						await this.plugin.saveSettings();
						shortSetting.nameEl.setText(t('settings.pomodoroShortBreak') + '  ' + value + ' min');
					}));

			const longSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroLongBreak') + '  ' + this.plugin.settings.pomodoroLongBreakMinutes + ' min')
				.addSlider(slider => slider
					.setLimits(5, 30, 5)
					.setValue(this.plugin.settings.pomodoroLongBreakMinutes)
						.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroLongBreakMinutes: value,
						};
						await this.plugin.saveSettings();
						longSetting.nameEl.setText(t('settings.pomodoroLongBreak') + '  ' + value + ' min');
					}));

			const intervalSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroInterval') + '  ' + this.plugin.settings.pomodoroLongBreakInterval)
				.addSlider(slider => slider
					.setLimits(2, 6, 1)
					.setValue(this.plugin.settings.pomodoroLongBreakInterval)
						.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroLongBreakInterval: value,
						};
						await this.plugin.saveSettings();
						intervalSetting.nameEl.setText(t('settings.pomodoroInterval') + '  ' + value);
					}));

			const goalSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroGoal') + '  ' + this.plugin.settings.pomodoroDailyGoal + ' 🍅')
				.addSlider(slider => slider
					.setLimits(1, 16, 1)
					.setValue(this.plugin.settings.pomodoroDailyGoal)
						.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroDailyGoal: value,
						};
						await this.plugin.saveSettings();
						goalSetting.nameEl.setText(t('settings.pomodoroGoal') + '  ' + value + ' 🍅');
					}));

			new Setting(pomodoroCard)
				.setName(t('settings.pomodoroAutoStart'))
				.setDesc(t('settings.pomodoroAutoStartDesc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.pomodoroAutoStartBreak)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroAutoStartBreak: value,
						};
						await this.plugin.saveSettings();
					}));

			new Setting(pomodoroCard)
				.setName(t('settings.pomodoroSound'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.pomodoroSoundEnabled)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroSoundEnabled: value,
						};
						await this.plugin.saveSettings();
					}));

			new Setting(pomodoroCard)
				.setName(t('settings.pomodoroMiniPanel'))
				.setDesc(t('settings.pomodoroMiniPanelDesc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.pomodoroMiniPanelEnabled)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroMiniPanelEnabled: value,
						};
						await this.plugin.saveSettings();
					}));
		}

		// --- Reading card ---
		const readingCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(readingCard)
			.setName(t('settings.readingEnabled'))
			.setDesc(t('settings.readingEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.readingEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						readingEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));

		if (this.plugin.settings.readingEnabled) {
			new Setting(readingCard)
				.setName(t('settings.readingSound'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.readingSoundEnabled)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							readingSoundEnabled: value,
						};
						await this.plugin.saveSettings();
					}));
		}

		// --- Habit card ---
		const habitCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(habitCard)
			.setName(t('settings.widgetHabitEnabled'))
			.setDesc(t('settings.widgetHabitEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetHabitEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetHabitEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));

		// --- Expense tracker card ---
		const expenseCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(expenseCard)
			.setName(t('settings.widgetExpenseEnabled'))
			.setDesc(t('settings.widgetExpenseEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetExpenseEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetExpenseEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));
		new Setting(expenseCard)
			.setName(t('settings.expenseCurrency'))
			.setDesc(t('settings.expenseCurrencyDesc'))
			.addText(text => text
				.setPlaceholder('¥')
				.setValue(this.plugin.settings.expenseCurrency)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, expenseCurrency: value.trim() };
					await this.plugin.saveSettings();
					// The sidebar signature includes the currency, so a change
					// must rebuild the widget (and its derived labels).
					this.plugin.refreshAllDashboards();
				}));

		// --- Countdown card ---
		const countdownCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(countdownCard)
			.setName(t('settings.countdownEnabled'))
			.setDesc(t('settings.countdownEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.countdownEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						countdownEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));

		if (this.plugin.settings.countdownEnabled) {
			this.renderCountdownList(countdownCard);
		}
	}

	/** About Author page (the former Buy Me a Coffee): centered bio, projects,
	 *  social links, contact, and the bundled support image. Layout follows
	 *  COFFEE_PAGE_DRAFT.md as edited by the author; the support image is
	 *  base64-bundled (src/assets/support-image.ts) so it renders offline. */
	private renderCoffeeSettings(containerEl: HTMLElement): void {
		const wrap = containerEl.createDiv({ cls: 'dashboard-about' });

		wrap.createDiv({ cls: 'dashboard-about-intro-line1', text: t('about.intro1') });
		wrap.createDiv({ cls: 'dashboard-about-intro-line', text: t('about.intro2') });
		wrap.createDiv({ cls: 'dashboard-about-intro-line', text: t('about.intro3') });

		wrap.createDiv({ cls: 'dashboard-about-divider' });

		const projects: Array<[string, string]> = [
			['Apex Dashboard', t('about.projApexDesc')],
			['Language Made Easy', t('about.projLmeDesc')],
			['HiLighter', t('about.projHiLighterDesc')],
		];
		this.renderAboutSection(wrap, t('about.building'), section => {
			for (const [name, desc] of projects) {
				const row = section.createDiv({ cls: 'dashboard-about-project' });
				row.createSpan({ cls: 'dashboard-about-project-name', text: name });
				row.createSpan({ cls: 'dashboard-about-project-sep', text: '｜' });
				row.createSpan({ cls: 'dashboard-about-project-desc', text: desc });
			}
		});

		this.renderAboutSection(wrap, t('about.follow'), section => {
			section.createDiv({ cls: 'dashboard-about-follow-name', text: t('about.followName') });
			section.createDiv({ cls: 'dashboard-about-follow-platforms', text: t('about.followPlatforms') });
		});

		this.renderAboutSection(wrap, t('about.contact'), section => {
			const wechatRow = section.createDiv({ cls: 'dashboard-about-contact-row' });
			wechatRow.createSpan({ cls: 'dashboard-about-contact-label', text: `${t('about.wechat')}：` });
			const wechatCode = wechatRow.createSpan({ cls: 'dashboard-about-code', text: 'PandoraReads' });
			// Tap to copy — the handle is also the community-group contact.
			wechatCode.addEventListener('click', () => {
				void navigator.clipboard?.writeText('PandoraReads');
				new Notice(t('about.copied'));
			});
			const ghRow = section.createDiv({ cls: 'dashboard-about-contact-row' });
			ghRow.createSpan({ cls: 'dashboard-about-contact-label', text: 'GitHub：' });
			ghRow.createEl('a', {
				cls: 'dashboard-about-link',
				text: t('about.githubUser'),
				attr: { href: 'https://github.com/PandoraReads' },
			});
			const mailRow = section.createDiv({ cls: 'dashboard-about-contact-row' });
			mailRow.createSpan({ cls: 'dashboard-about-contact-label', text: `${t('about.email')}：` });
			mailRow.createEl('a', {
				cls: 'dashboard-about-link',
				text: 'pandorabooks2020@gmail.com',
				attr: { href: 'mailto:pandorabooks2020@gmail.com' },
			});
		});

		this.renderAboutSection(wrap, t('about.support'), section => {
			section.createDiv({ cls: 'dashboard-about-support-thanks', text: t('about.supportThanks') });
			const img = section.createEl('img', {
				cls: 'dashboard-about-support-img',
				attr: { src: SUPPORT_IMAGE_DATA_URL, alt: t('about.support') },
			});
			// Open full-size in a new window so the codes stay scannable.
			img.addEventListener('click', () => window.open(SUPPORT_IMAGE_DATA_URL, '_blank'));
		});
	}

	private renderAboutSection(wrap: HTMLElement, heading: string, fill: (section: HTMLElement) => void): void {
		const section = wrap.createDiv({ cls: 'dashboard-about-section' });
		section.createDiv({ cls: 'dashboard-about-section-title', text: heading });
		fill(section);
	}

	/** Data-service sections (Weread / TickTick): content sources rendered as
	 *  their own dashboard sections, NOT sidebar widgets — they live on the
	 *  General settings page, not the Widgets page. */
	private renderServiceSettings(containerEl: HTMLElement): void {
		// --- Weread (WeChat Read) card ---
		const wereadCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(wereadCard)
			.setName(t('settings.wereadApiKey'))
			.setDesc(t('settings.wereadApiKeyDesc'))
			.addText(text => text
				.setValue(this.plugin.settings.wereadApiKey)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, wereadApiKey: value.trim() };
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));
		new Setting(wereadCard)
			.setName(t('settings.wereadGetKey'))
			.setDesc(t('settings.wereadGetKeyDesc'))
			.addButton(btn => btn
				.setButtonText(t('settings.wereadGetKey'))
				.onClick(() => window.open('https://weread.qq.com/r/weread-skills', '_blank')));
		new Setting(wereadCard)
			.setName(t('settings.wereadImportPath'))
			.setDesc(t('settings.wereadImportPathDesc'))
			.addText(text => text
				.setPlaceholder('Weread/划线')
				.setValue(this.plugin.settings.wereadImportPath)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, wereadImportPath: value.trim().replace(/^\/+|\/+$/g, '') };
					await this.plugin.saveSettings();
				}));

		// --- TickTick card ---
		const ticktickCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(ticktickCard)
			.setName(t('settings.ticktickRegion'))
			.setDesc(t('settings.ticktickRegionDesc'))
			.addDropdown(d => d
				.addOption('dida365', t('settings.ticktickRegionDida'))
				.addOption('ticktick', t('settings.ticktickRegionTick'))
				.setValue(this.plugin.settings.ticktickRegion)
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, ticktickRegion: value as 'dida365' | 'ticktick' };
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));
		new Setting(ticktickCard)
			.setName(t('settings.ticktickCookie'))
			.setDesc(t('settings.ticktickCookieDesc'))
			.addButton(btn => btn
				.setButtonText(t('settings.ticktickGetCookie'))
				.setCta()
				.onClick(() => {
					new TickTickLoginModal(
						this.app,
						this.plugin.settings.ticktickRegion,
						this.plugin.settings.ticktickDeviceVersion,
						async (token, csrf) => {
							this.plugin.settings = { ...this.plugin.settings, ticktickCookie: token, ticktickCsrf: csrf };
							await this.plugin.saveSettings();
							this.plugin.refreshAllDashboards();
							this.refresh();
						},
					).open();
				}))
			.addButton(btn => btn
				.setButtonText(t('settings.ticktickClearCookie'))
				.setDisabled(!this.plugin.settings.ticktickCookie)
				.onClick(() => {
					void (async () => {
						this.plugin.settings = { ...this.plugin.settings, ticktickCookie: '', ticktickCsrf: '' };
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
						this.refresh();
					})();
				}));
		new Setting(ticktickCard)
			.setName(t('settings.ticktickCookieStatus'))
			.setDesc(this.plugin.settings.ticktickCookie ? t('settings.ticktickCookieSet') : t('settings.ticktickCookieEmpty'));
		new Setting(ticktickCard)
			.setName(t('settings.ticktickDeviceVersion'))
			.setDesc(t('settings.ticktickDeviceVersionDesc'))
			.addText(text => text
				.setValue(this.plugin.settings.ticktickDeviceVersion ?? '')
				.onChange(async (value) => {
					this.plugin.settings = { ...this.plugin.settings, ticktickDeviceVersion: value.trim() || undefined };
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));
		new Setting(ticktickCard)
			.setName(t('settings.ticktickTimezone'))
			.setDesc(t('settings.ticktickTimezoneDesc'))
			.addText(text => text
				.setPlaceholder(DEFAULT_TICKTICK_TZ)
				.setValue(this.plugin.settings.ticktickTimezone)
				.onChange(async (value) => {
					const tz = value.trim() || DEFAULT_TICKTICK_TZ;
					if (!isValidTz(tz)) {
						new Notice(t('settings.ticktickTimezoneInvalid'));
						this.refresh();
						return;
					}
					this.plugin.settings = { ...this.plugin.settings, ticktickTimezone: tz };
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
				}));
	}


	private renderCountdownList(containerEl: HTMLElement): void {
		const list = this.plugin.settings.countdowns ?? [];

		for (const cd of list) {
			const summary = cd.label || cd.targetDate || t('countdown.untitled');
			new Setting(containerEl)
				.setName(summary)
				.setDesc(cd.targetDate ? `${cd.targetDate} · ${t(`countdown.${cd.displayMode}`)}` : t('countdown.setTarget'))
				.addExtraButton(btn => btn
					.setIcon('pencil')
					.setTooltip(t('common.edit'))
					.onClick(() => this.editCountdown(cd)))
				.addExtraButton(btn => btn
					.setIcon('trash-2')
					.setTooltip(t('common.delete'))
					.onClick(async () => {
						this.plugin.settings = {
							...this.plugin.settings,
							countdowns: list.filter(c => c.id !== cd.id),
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
						this.refresh();
					}));
		}

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText(t('countdown.add'))
				.setIcon('plus')
				.onClick(() => this.editCountdown(null)));
	}

	private editCountdown(existing: CountdownConfig | null): void {
		const baseline: CountdownConfig = existing ?? {
			id: `cd-${Date.now()}`,
			label: '',
			targetDate: '',
			displayMode: 'days',
			reminderDays: 0,
		};
		const modal = new CountdownSettingsModal(this.app, baseline, (updated) => {
			void this.applyCountdownUpdate(updated);
		});
		modal.open();
	}

	private async applyCountdownUpdate(updated: CountdownConfig): Promise<void> {
		const current = this.plugin.settings.countdowns ?? [];
		const exists = current.some(c => c.id === updated.id);
		this.plugin.settings = {
			...this.plugin.settings,
			countdowns: exists
				? current.map(c => c.id === updated.id ? updated : c)
				: [...current, updated],
		};
		await this.plugin.saveSettings();
		this.plugin.refreshAllDashboards();
		this.refresh();
	}

	private renderLunarSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.widgetLunar')).setHeading();

		const lunarCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(lunarCard)
			.setName(t('settings.widgetLunarEnabled'))
			.setDesc(t('settings.widgetLunarEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetLunarEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetLunarEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));
	}

	private renderYearProgressSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.widgetYearProgress')).setHeading();

		const card = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(card)
			.setName(t('settings.widgetYearProgressEnabled'))
			.setDesc(t('settings.widgetYearProgressEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetYearProgressEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetYearProgressEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));
	}

	private renderCalendarSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.widgetCalendar')).setHeading();

		const card = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(card)
			.setName(t('settings.widgetCalendarEnabled'))
			.setDesc(t('settings.widgetCalendarEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetCalendarEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetCalendarEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.refresh();
				}));

		if (!this.plugin.settings.widgetCalendarEnabled) return;

		// Excluded folders — tasks under these folders are hidden from the calendar.
		const excludeSetting = new Setting(card)
			.setName(t('settings.widgetCalendarExclude'))
			.setDesc(t('settings.widgetCalendarExcludeDesc'));
		const excludeRow = excludeSetting.controlEl.createDiv({ cls: 'dashboard-settings-folder-chips' });
		// The add row is a SIBLING of excludeRow, not a child: renderChips()
		// empties excludeRow on every change, which used to wipe the manual
		// input + browse controls along with the chips.
		const addControl = excludeSetting.controlEl.createDiv({ cls: 'dashboard-settings-folder-add' });

		const removeFolder = async (folder: string): Promise<void> => {
			this.plugin.settings = {
				...this.plugin.settings,
				calendarExcludeFolders: (this.plugin.settings.calendarExcludeFolders ?? []).filter(f => f !== folder),
			};
			await this.plugin.saveSettings();
			this.plugin.refreshAllDashboards();
			renderChips();
		};

		const renderChips = (): void => {
			excludeRow.empty();
			const folders = this.plugin.settings.calendarExcludeFolders ?? [];
			for (const folder of folders) {
				const chip = excludeRow.createDiv({ cls: 'dashboard-settings-folder-chip' });
				chip.createSpan({ text: folder });
				const removeBtn = chip.createEl('button', {
					cls: 'dashboard-settings-folder-chip-remove',
					attr: { 'aria-label': t('common.remove', { name: folder }) },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => { void removeFolder(folder); });
			}
		};
		renderChips();

		const input = addControl.createEl('input', {
			cls: 'dashboard-settings-folder-input',
			attr: { type: 'text', placeholder: t('folder.selectFolder') },
		});
		const browseBtn = addControl.createEl('button', { cls: 'dashboard-settings-folder-browse' });
		setIcon(browseBtn, 'folder');
		browseBtn.addEventListener('click', () => {
			// Multi-select picker: manage the whole excluded set in one place.
			// Manual typing above stays for paths outside the folder tree.
			new MultiFolderSelectModal(this.app, this.plugin.settings.calendarExcludeFolders ?? [], (folders) => {
				void (async () => {
					this.plugin.settings = {
						...this.plugin.settings,
						calendarExcludeFolders: folders,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					renderChips();
				})();
			}, { parentCoversChildren: true }).open();
		});
		const addBtn = addControl.createEl('button', { cls: 'dashboard-settings-folder-add-btn', text: t('common.add') });
		const addFolder = async (): Promise<void> => {
			const folder = input.value.trim();
			if (!folder) return;
			const folders = this.plugin.settings.calendarExcludeFolders ?? [];
			if (folders.includes(folder)) { input.value = ''; return; }
			this.plugin.settings = {
				...this.plugin.settings,
				calendarExcludeFolders: [...folders, folder],
			};
			input.value = '';
			await this.plugin.saveSettings();
			this.plugin.refreshAllDashboards();
			renderChips();
		};
		addBtn.addEventListener('click', () => { void addFolder(); });
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); void addFolder(); }
		});

		// Where calendar-added tasks land in the day's daily note.
		new Setting(card)
			.setName(t('settings.widgetCalendarTaskPosition'))
			.setDesc(t('settings.widgetCalendarTaskPositionDesc'))
			.addDropdown(d => d
				.addOption('start', t('settings.widgetCalendarTaskPositionStart'))
				.addOption('end', t('settings.widgetCalendarTaskPositionEnd'))
				.setValue(this.plugin.settings.calendarTaskInsertPosition)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						calendarTaskInsertPosition: value as 'start' | 'end',
					};
					await this.plugin.saveSettings();
				}));
	}

	private renderBackupSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.backup')).setHeading();

		const card = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });

		const backupDir = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/backups`;

		new Setting(card)
			.setName(t('settings.backupEnabled'))
			.setDesc(t('settings.backupEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.backupEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						backupEnabled: value,
					};
					await this.plugin.saveSettings();
					this.refresh();
				}));

		new Setting(card)
			.setName(t('settings.backupPeriod'))
			.setDesc(t('settings.backupPeriodDesc'))
			.addDropdown(d => d
				.addOption('hourly', t('settings.backupPeriodHourly'))
				.addOption('daily', t('settings.backupPeriodDaily'))
				.addOption('weekly', t('settings.backupPeriodWeekly'))
				.addOption('monthly', t('settings.backupPeriodMonthly'))
				.setValue(this.plugin.settings.backupPeriod)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						backupPeriod: value as BackupPeriod,
					};
					await this.plugin.saveSettings();
				}));

		new Setting(card)
			.setName(t('settings.backupMaxCount'))
			.setDesc(t('settings.backupMaxCountDesc'))
			.addDropdown(d => d
				.addOption('5', '5')
				.addOption('10', '10')
				.addOption('20', '20')
				.addOption('30', '30')
				.addOption('50', '50')
				.setValue(String(this.plugin.settings.backupMaxCount))
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						backupMaxCount: Number(value),
					};
					await this.plugin.saveSettings();
				}));

		new Setting(card)
			.setName(t('settings.backupNow'))
			.setDesc(t('settings.backupLocationDesc', { path: backupDir }))
			.addButton(btn => btn
				.setButtonText(t('settings.backupNow'))
				.onClick(() => {
					void this.plugin.backupService?.runBackupNow();
				}));

		new Setting(card)
			.setName(t('settings.restoreLatest'))
			.setDesc(t('settings.restoreLatestDesc'))
			.addButton(btn => btn
				.setButtonText(t('settings.restoreLatest'))
				.onClick(() => {
					void (async () => {
						const confirmed = await showConfirmDialog(this.app, {
							title: t('settings.restoreConfirmTitle'),
							message: t('settings.restoreConfirmMessage'),
							confirmLabel: t('settings.restoreLatest'),
							destructive: false,
						});
						if (!confirmed) return;
						await this.plugin.backupService?.restoreLatestNow();
					})();
				}));
	}

	private attachCitySuggest(inputEl: HTMLInputElement): void {
		let dropdown: HTMLElement | null = null;
		let debounceTimer: number | null = null;

		const close = () => {
			if (dropdown) { dropdown.remove(); dropdown = null; }
		};

		inputEl.addEventListener('input', () => {
			if (debounceTimer) window.clearTimeout(debounceTimer);
			const query = inputEl.value.trim();
			if (query.length < 2) { close(); return; }

			debounceTimer = window.setTimeout(() => {
				void this.suggestCities(inputEl, query, dropdown, close).then(next => {
					dropdown = next;
				});
			}, 300);
		});

		inputEl.addEventListener('blur', () => {
			window.setTimeout(close, 200);
		});
	}

	private async suggestCities(
		inputEl: HTMLInputElement,
		query: string,
		dropdown: HTMLElement | null,
		close: () => void,
	): Promise<HTMLElement | null> {
		const results = await geocodeCity(query);
		close();
		if (results.length === 0) return dropdown;

		// Global createDiv(), NOT inputEl.ownerDocument.createDiv: the
		// Node.createEl extension appends the new element to its receiver —
		// on a Document that throws HierarchyRequestError, which killed this
		// dropdown before it ever rendered. The global helper stays detached;
		// we append to body explicitly below.
		const next = createDiv({ cls: 'dashboard-city-suggest' });
		Object.assign(next.style, {
			position: 'absolute',
			zIndex: '100',
			background: 'var(--background-secondary)',
			border: '1px solid var(--background-modifier-border)',
			borderRadius: '6px',
			boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
			maxHeight: '200px',
			overflowY: 'auto',
			width: inputEl.getBoundingClientRect().width + 'px',
		});

		const rect = inputEl.getBoundingClientRect();
		next.style.left = rect.left + 'px';
		next.style.top = (rect.bottom + 4) + 'px';

		for (const r of results) {
			const item = next.createDiv({ cls: 'dashboard-city-suggest-item' });
			const label = r.admin1 ? `${r.name}, ${r.admin1}, ${r.country}` : `${r.name}, ${r.country}`;
			item.textContent = label;
			Object.assign(item.style, {
				padding: '6px 10px',
				cursor: 'pointer',
				fontSize: '0.85em',
				borderBottom: '1px solid var(--background-modifier-border)',
			});
			item.addEventListener('mouseenter', () => {
				item.setCssProps({ background: 'var(--background-modifier-hover)' });
			});
			item.addEventListener('mouseleave', () => {
				item.setCssProps({ background: '' });
			});
			item.addEventListener('click', () => {
				void (async () => {
					inputEl.value = r.name;
					this.plugin.settings = {
						...this.plugin.settings,
						widgetWeatherCity: r.name,
						widgetWeatherLat: r.latitude,
						widgetWeatherLon: r.longitude,
					};
					await this.plugin.saveSettings();
					close();
					this.plugin.refreshAllDashboards();
				})();
			});
		}

		inputEl.ownerDocument.body.appendChild(next);
		return next;
	}
}
