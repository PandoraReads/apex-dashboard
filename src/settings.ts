import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DashboardPlugin from './main';
import { DEFAULT_SETTINGS, type DashboardSettings, type CountdownConfig } from './types';
import { t, setLanguage, type Language } from './i18n';
import { geocodeCity } from './weather-service';
import { CountdownSettingsModal } from './countdown-modal';
import { TickTickLoginModal } from './ticktick-login-modal';
import { DEFAULT_TICKTICK_TZ, isValidTz } from './ticktick-tz';

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
				.setPlaceholder('Dashboard or path/to/dashboard')
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
				.setPlaceholder('Memos')
				.setValue(this.plugin.settings.memoSavePath)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						memoSavePath: value.trim(),
					};
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settings.taskArchivePath'))
			.setDesc(t('settings.taskArchivePathDesc'))
			.addText(text => text
				.setPlaceholder('Archive/Done.md')
				.setValue(this.plugin.settings.taskArchivePath)
				.onChange(async (value) => {
					this.plugin.settings = {
						...this.plugin.settings,
						taskArchivePath: value.trim(),
					};
					await this.plugin.saveSettings();
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

		this.renderWidgetSettings(containerEl);

		this.renderLunarSettings(containerEl);

		containerEl.createDiv({ cls: 'dashboard-settings-footer', text: "crafted by Pandora's Digital Garden" });
	}

	private renderWidgetSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.widgetTheme')).setHeading();

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
					this.display();
				}));

		if (this.plugin.settings.countdownEnabled) {
			this.renderCountdownList(countdownCard);
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
							this.display();
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
						this.display();
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
						this.display();
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
						this.display();
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
		this.display();
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
					this.display();
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

		const next = inputEl.ownerDocument.createElement('div');
		next.className = 'dashboard-city-suggest';
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
