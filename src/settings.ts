import { App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type DashboardPlugin from './main';
import { DEFAULT_SETTINGS, type DashboardSettings } from './types';
import { t, setLanguage, type Language } from './i18n';
import { suggestTrackerKeys } from './tracker-service';
import { geocodeCity } from './weather-service';

export type { DashboardSettings };

export class DashboardSettingTab extends PluginSettingTab {
	plugin: DashboardPlugin;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
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
					this.display();
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
					haze: t('settings.styleHaze'),
					ember: t('settings.styleEmber'),
					jade: t('settings.styleJade'),
					carbon: t('settings.styleCarbon'),
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

		const recentSetting = new Setting(containerEl)
			.setName(t('settings.recentCount') + '  ' + this.plugin.settings.recentDocCount)
			.setDesc(t('settings.recentCountDesc'))
			.addSlider(slider => slider
				.setLimits(3, 15, 1)
				.setValue(this.plugin.settings.recentDocCount)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						recentDocCount: value,
					};
					await this.plugin.saveSettings();
					recentSetting.nameEl.setText(t('settings.recentCount') + '  ' + value);
				}));

		new Setting(containerEl)
			.setName(t('settings.dashboardFile'))
			.setDesc(t('settings.dashboardFileDesc'))
			.addText(text => text
				.setPlaceholder('dashboard or path/to/dashboard')
				.setValue(this.plugin.settings.dashboardFile)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						dashboardFile: value.trim() || DEFAULT_SETTINGS.dashboardFile,
					};
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.memoSavePath'))
			.setDesc(t('settings.memoSavePathDesc'))
			.addText(text => text
				.setPlaceholder('memos')
				.setValue(this.plugin.settings.memoSavePath)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						memoSavePath: value.trim(),
					};
					await this.plugin.saveSettings();
				}));
		this.renderWidgetSettings(containerEl);

		this.renderLunarSettings(containerEl);

		containerEl.createDiv({ cls: 'dashboard-settings-footer', text: "crafted by Pandora's Digital Garden" });
	}

	private renderWidgetSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: t('settings.widgetTheme'), cls: 'dashboard-settings-section-title' });

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
					this.display();
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
						});
					this.attachCitySuggest(text.inputEl);
				});
		}

		// --- Heatmap card ---
		const heatmapCard = containerEl.createDiv({ cls: 'dashboard-widget-settings-card' });
		new Setting(heatmapCard)
			.setName(t('settings.widgetHeatmapEnabled'))
			.setDesc(t('settings.widgetHeatmapEnabledDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.widgetHeatmapEnabled)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetHeatmapEnabled: value,
					};
					await this.plugin.saveSettings();
					this.plugin.refreshAllDashboards();
					this.display();
				}));

		if (this.plugin.settings.widgetHeatmapEnabled) {
			const folderSetting = new Setting(heatmapCard)
				.setName(t('settings.widgetHeatmapFolder'))
				.setDesc(t('settings.widgetHeatmapFolderPlaceholder'))
				.addText(text => text
					.setPlaceholder(t('settings.widgetHeatmapFolderPlaceholder'))
					.setValue(this.plugin.settings.widgetHeatmapFolder)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetHeatmapFolder: value.trim().replace(/^\/+|\/+$/g, ''),
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
					}));

			new Setting(heatmapCard)
				.setName(t('settings.widgetHeatmapTitle'))
				.setDesc(t('settings.widgetHeatmapTitlePlaceholder'))
				.addText(text => text
					.setPlaceholder(t('settings.widgetHeatmapTitlePlaceholder'))
					.setValue(this.plugin.settings.widgetHeatmapTitle)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetHeatmapTitle: value,
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
					}));

			new Setting(heatmapCard)
				.setName(t('settings.widgetHeatmapRangeMode'))
				.addDropdown(dropdown => dropdown
					.addOptions({
						'rolling': t('rangeMode.rolling'),
						'period': t('rangeMode.period'),
					})
					.setValue(this.plugin.settings.widgetHeatmapRangeMode ?? 'rolling')
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetHeatmapRangeMode: value as 'rolling' | 'period',
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
						this.display();
					}));

			if ((this.plugin.settings.widgetHeatmapRangeMode ?? 'rolling') === 'rolling') {
				new Setting(heatmapCard)
					.setName(t('settings.widgetTrackerDays'))
					.addDropdown(dropdown => dropdown
						.addOptions({
							'30': t('settings.days30'),
							'90': t('settings.days90'),
							'180': t('settings.days180'),
							'365': t('settings.days365'),
						})
						.setValue(String(this.plugin.settings.widgetTrackerDays))
						.onChange(async (value) => {
							this.plugin.settings = {
								...this.plugin.settings,
								widgetTrackerDays: parseInt(value, 10),
							};
							await this.plugin.saveSettings();
							this.plugin.refreshAllDashboards();
						}));
			} else {
				new Setting(heatmapCard)
					.setName(t('settings.widgetHeatmapPeriod'))
					.addDropdown(dropdown => dropdown
						.addOptions({
							'month': t('period.month'),
							'quarter': t('period.quarter'),
							'year': t('period.year'),
						})
						.setValue(this.plugin.settings.widgetHeatmapPeriod ?? 'month')
						.onChange(async (value) => {
							this.plugin.settings = {
								...this.plugin.settings,
								widgetHeatmapPeriod: value as 'month' | 'quarter' | 'year',
							};
							await this.plugin.saveSettings();
							this.plugin.refreshAllDashboards();
						}));
			}

			const trackerKeySetting = new Setting(heatmapCard)
				.setName(t('settings.widgetTrackerKey'))
				.addText(text => text
					.setPlaceholder(t('settings.widgetTrackerKeyPlaceholder'))
					.setValue(this.plugin.settings.widgetTrackerKey)
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetTrackerKey: value.trim(),
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
					}));

			const suggestions = suggestTrackerKeys(this.app, this.plugin.settings.widgetHeatmapFolder || undefined);
			if (suggestions.length > 0) {
				trackerKeySetting.descEl.empty();
				const hintLine = trackerKeySetting.descEl.createDiv({ cls: 'tracker-key-hint' });
				hintLine.createSpan({ text: t('settings.widgetTrackerSuggested') + ' ' });
				for (const k of suggestions.slice(0, 6)) {
					const tag = hintLine.createEl('button', { cls: 'tracker-key-tag', text: k });
					tag.addEventListener('click', async () => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetTrackerKey: k,
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
						this.display();
					});
				}
			}

			new Setting(heatmapCard)
				.setName(t('settings.widgetTrackerSummary'))
				.addDropdown(dropdown => dropdown
					.addOptions({
						'streak': t('settings.summaryStreak'),
						'rate': t('settings.summaryRate'),
						'both': t('settings.summaryBoth'),
						'off': t('settings.summaryOff'),
					})
					.setValue(this.plugin.settings.widgetTrackerSummary ?? 'streak')
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							widgetTrackerSummary: value as 'streak' | 'rate' | 'both' | 'off',
						};
						await this.plugin.saveSettings();
						this.plugin.refreshAllDashboards();
					}));
		}

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
					this.display();
				}));

		if (this.plugin.settings.pomodoroEnabled) {
			const workSetting = new Setting(pomodoroCard)
				.setName(t('settings.pomodoroWork') + '  ' + this.plugin.settings.pomodoroWorkMinutes + ' min')
				.addSlider(slider => slider
					.setLimits(15, 60, 5)
					.setValue(this.plugin.settings.pomodoroWorkMinutes)
					.setDynamicTooltip()
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
					.setDynamicTooltip()
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
					.setDynamicTooltip()
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
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings = {
							...this.plugin.settings,
							pomodoroLongBreakInterval: value,
						};
						await this.plugin.saveSettings();
						intervalSetting.nameEl.setText(t('settings.pomodoroInterval') + '  ' + value);
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
		}

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
				}));

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
	}

	private renderLunarSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: t('settings.widgetLunar'), cls: 'dashboard-settings-section-title' });

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
					this.display();
				}));
	}

	private attachCitySuggest(inputEl: HTMLInputElement): void {
		let dropdown: HTMLElement | null = null;
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const close = () => {
			if (dropdown) { dropdown.remove(); dropdown = null; }
		};

		inputEl.addEventListener('input', () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			const query = inputEl.value.trim();
			if (query.length < 2) { close(); return; }

			debounceTimer = setTimeout(async () => {
				const results = await geocodeCity(query);
				close();
				if (results.length === 0) return;

				dropdown = inputEl.ownerDocument.createElement('div');
				dropdown.className = 'dashboard-city-suggest';
				Object.assign(dropdown.style, {
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
				dropdown.style.left = rect.left + 'px';
				dropdown.style.top = (rect.bottom + 4) + 'px';

				for (const r of results) {
					const item = dropdown.createDiv({ cls: 'dashboard-city-suggest-item' });
					const label = r.admin1 ? `${r.name}, ${r.admin1}, ${r.country}` : `${r.name}, ${r.country}`;
					item.textContent = label;
					Object.assign(item.style, {
						padding: '6px 10px',
						cursor: 'pointer',
						fontSize: '0.85em',
						borderBottom: '1px solid var(--background-modifier-border)',
					});
					item.addEventListener('mouseenter', () => {
						item.style.background = 'var(--background-modifier-hover)';
					});
					item.addEventListener('mouseleave', () => {
						item.style.background = '';
					});
					item.addEventListener('click', async () => {
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
					});
				}

				inputEl.ownerDocument.body.appendChild(dropdown);
			}, 300);
		});

		inputEl.addEventListener('blur', () => {
			setTimeout(close, 200);
		});
	}
}
