import { App, Platform, setIcon } from 'obsidian';
import type { HoverParent, TFile } from 'obsidian';
import type { DashboardData, DashboardColumn, DashboardCard, RenderCallbacks, TaskItem, DocNode, DashboardSettings, CardSize, TrackerStyle } from './types';
import { t, getLanguage } from './i18n';
import { renderLibrarySection } from './library-section';
import type { LibraryConfig } from './types';
import { resolveVaultImage } from './banner';
import { attachFileSuggest } from './file-suggest';
import { showConfirmDialog } from './confirm-dialog';
import { attachNoteHover } from './hover-preview';
import { fetchWeather, getCachedWeather, getWeatherEmoji, getWeatherDescription } from './weather-service';
import { readTrackerData, readTrackerDataForRange, computeStreak, getPeriodRange } from './tracker-service';
import type { PomodoroService } from './pomodoro-service';
import type { ReadingService } from './reading-service';
import { searchBooks, downloadCoverAsBlobUrl } from './book-service';
import { activityColor } from './pomodoro-service';
import { renderSidebarLunarWidget } from './lunar-widget';
import type { HolidayInfo } from './holiday-service';
import { CountdownSettingsModal } from './countdown-modal';
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip);

const chartInstances = new Map<string, Chart>();

function destroyChart(cardId: string): void {
	const chart = chartInstances.get(cardId);
	if (chart) {
		chart.destroy();
		chartInstances.delete(cardId);
	}
}

export function destroyAllCharts(): void {
	for (const [, chart] of chartInstances) {
		chart.destroy();
	}
	chartInstances.clear();
}

function getCSSVar(name: string): string {
	const el = document.querySelector('.apex-dashboard-root');
	if (!el) return '';
	return getComputedStyle(el).getPropertyValue(name).trim();
}

// Determine whether the dashboard accent is light enough that white text on it
// would be unreadable (e.g. the mono/墨白 and carbon themes in dark mode).
function isAccentLight(): boolean {
	const el = document.querySelector('.apex-dashboard-root');
	if (!el) return false;
	return isLightColor(getComputedStyle(el).getPropertyValue('--db-accent').trim());
}

// Accepts "#rgb", "#rrggbb", "rgb(...)" or "rgba(...)"; returns true when the
// color is bright enough that dark text reads better than white.
function isLightColor(color: string): boolean {
	const value = color.trim();
	if (value.startsWith('rgb')) {
		const nums = value.match(/[\d.]+/g);
		if (!nums || nums.length < 3) return false;
		return relativeLuminance(Number(nums[0]), Number(nums[1]), Number(nums[2])) > 0.6;
	}
	const hex = value.replace(/^#/, '');
	if (!/^[0-9a-fA-F]+$/.test(hex)) return false;
	const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
	if (full.length !== 6) return false;
	return relativeLuminance(
		parseInt(full.slice(0, 2), 16),
		parseInt(full.slice(2, 4), 16),
		parseInt(full.slice(4, 6), 16),
	) > 0.6;
}

// WCAG relative luminance (0..1).
function relativeLuminance(r: number, g: number, b: number): number {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

let taskDragSource: { cardId: string; taskPath: number[] } | null = null;
let docDragSource: { cardId: string; docPath: number[] } | null = null;

// Set once per render pass by renderDashboard so the deep doc/wikilink renderers
// can attach hover previews and open the note popover without threading these
// through every function signature. Mirrors the docDragSource module-level idiom.
let activeHoverParent: HoverParent | null = null;
let activeNoteOpener: ((file: TFile) => void) | null = null;

const VAULT_FILE_EXTS = new Set(['md', 'pdf', 'canvas', 'base', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'mp3', 'mp4', 'm4a', 'm4b', 'mov', 'mkv', 'avi']);

function getSearchableFiles(app: App) {
	return app.vault.getFiles()
		.filter(f => !f.path.startsWith('.') && VAULT_FILE_EXTS.has(f.extension));
}

/**
 * Resolve a raw doc/wikilink target to a TFile, trying the path verbatim, with
 * an implicit `.md`, and finally a basename fallback. Centralised so the doc
 * list and inline wikilinks resolve links identically.
 */
function resolveNoteFile(app: App, rawPath: string): TFile | null {
	const direct = app.vault.getFileByPath(rawPath);
	if (direct) return direct;
	const withMd = rawPath.includes('.') ? rawPath : `${rawPath}.md`;
	const tried = app.vault.getFileByPath(withMd);
	if (tried) return tried;
	const basename = rawPath.split('/').pop()?.replace(/\.md$/, '') ?? '';
	if (basename) {
		return getSearchableFiles(app).find(mf => mf.basename === basename) ?? null;
	}
	return null;
}

// ===== Sidebar Widget Rendering =====

export function renderSidebarWeekCalendar(container: HTMLElement): void {
	// Reuse the existing calendar node so cross-day refreshes don't grow the DOM.
	let row = container.querySelector<HTMLElement>('.dashboard-sidebar-week-calendar');
	if (row) {
		row.empty();
	} else {
		row = container.createDiv({ cls: 'dashboard-sidebar-week-calendar' });
	}

	const now = new Date();
	const today = now.getDay();
	const mondayOffset = today === 0 ? -6 : 1 - today;
	const monday = new Date(now);
	monday.setDate(now.getDate() + mondayOffset);

	const lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
	const accentLight = isAccentLight();

	for (let i = 0; i < 7; i++) {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		const isToday = d.toDateString() === now.toDateString();

		const cell = row.createDiv({
			cls: 'dashboard-sidebar-week-cell'
				+ (isToday ? ' dashboard-sidebar-week-cell--today' : '')
				+ (isToday && accentLight ? ' dashboard-sidebar-week-cell--today-on-light' : ''),
		});
		cell.createDiv({
			cls: 'dashboard-sidebar-week-day',
			text: d.toLocaleDateString(lang, { weekday: 'narrow' }),
		});
		cell.createDiv({
			cls: 'dashboard-sidebar-week-date',
			text: String(d.getDate()),
		});
	}
}

// Returns true if the live sidebar week calendar was re-rendered, false if it isn't in the DOM.
export function refreshSidebarWeekCalendar(root: HTMLElement): boolean {
	const scroll = root.querySelector<HTMLElement>('.dashboard-sidebar-scroll');
	if (!scroll) return false;
	renderSidebarWeekCalendar(scroll);
	return true;
}

export function renderSidebarWidgets(
	container: HTMLElement,
	settings: import('./types').DashboardSettings,
	app: App,
	pomodoroService?: PomodoroService,
	readingService?: ReadingService,
	holidayData?: Record<string, HolidayInfo>,
	onWidgetReorder?: (order: string[]) => void,
): void {
	const anyEnabled = settings.widgetWeatherEnabled || settings.widgetHeatmapEnabled || settings.pomodoroEnabled || settings.widgetLunarEnabled || settings.countdownEnabled || settings.readingEnabled;
	if (!anyEnabled) return;

	const widgetArea = container.createDiv({ cls: 'dashboard-sidebar-widgets' });

	const DEFAULT_ORDER = ['lunar', 'weather', 'heatmap', 'pomodoro', 'reading', 'countdown'];
	const order = settings.widgetOrder?.length ? settings.widgetOrder : DEFAULT_ORDER;

	type WidgetEntry = { key: string; render: () => void };
	const enabled: WidgetEntry[] = [];
	if (settings.widgetLunarEnabled) {
		enabled.push({ key: 'lunar', render: () => renderSidebarLunarWidget(widgetArea, holidayData ?? {}, app) });
	}
	if (settings.widgetWeatherEnabled) {
		enabled.push({ key: 'weather', render: () => renderSidebarWeather(widgetArea, settings, app) });
	}
	if (settings.widgetHeatmapEnabled) {
		enabled.push({ key: 'heatmap', render: () => renderSidebarHeatmap(widgetArea, settings, app) });
	}
	if (settings.pomodoroEnabled && pomodoroService) {
		enabled.push({ key: 'pomodoro', render: () => renderSidebarPomodoro(widgetArea, pomodoroService, settings) });
	}
	if (settings.readingEnabled && readingService) {
		enabled.push({ key: 'reading', render: () => renderSidebarReading(widgetArea, readingService) });
	}
	if (settings.countdownEnabled) {
		enabled.push({ key: 'countdown', render: () => renderSidebarCountdown(widgetArea, settings, app) });
	}

	const ordered = sortByOrder(enabled, order);

	for (const { key, render } of ordered) {
		const childCount = widgetArea.children.length;
		render();
		const el = widgetArea.children[childCount] as HTMLElement | undefined;
		if (el) el.dataset.widgetKey = key;
	}

	if (onWidgetReorder) {
		setupWidgetDnD(widgetArea, ordered.map(e => e.key), onWidgetReorder);
	}
}

type WidgetEntry = { key: string; render: () => void };

function sortByOrder(items: WidgetEntry[], order: string[]): WidgetEntry[] {
	const orderMap = new Map(order.map((k, i) => [k, i]));
	const sorted = [...items].sort((a, b) => {
		const ai = orderMap.get(a.key) ?? order.length;
		const bi = orderMap.get(b.key) ?? order.length;
		return ai - bi;
	});
	return sorted;
}

function setupWidgetDnD(
	widgetArea: HTMLElement,
	currentKeys: string[],
	onReorder: (order: string[]) => void,
): void {
	let draggedKey: string | null = null;

	const widgets = () => widgetArea.querySelectorAll('.dashboard-sidebar-widget');

	widgets().forEach(el => {
		const wEl = el as HTMLElement;
		wEl.setAttribute('draggable', 'true');
		wEl.dataset.widgetKey ??= wEl.dataset.widgetKey ?? '';

		wEl.addEventListener('dragstart', (e) => {
			draggedKey = wEl.dataset.widgetKey ?? null;
			wEl.addClass('dashboard-sidebar-widget--dragging');
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', draggedKey ?? '');
			}
		});

		wEl.addEventListener('dragend', () => {
			wEl.removeClass('dashboard-sidebar-widget--dragging');
			widgets().forEach(el2 => el2.removeClass('dashboard-sidebar-widget--drag-over'));
			draggedKey = null;
		});

		wEl.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			if (!draggedKey || wEl.dataset.widgetKey === draggedKey) return;
			widgets().forEach(el2 => el2.removeClass('dashboard-sidebar-widget--drag-over'));
			const rect = wEl.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (e.clientY < midY) {
				wEl.addClass('dashboard-sidebar-widget--drag-over-top');
				wEl.removeClass('dashboard-sidebar-widget--drag-over-bottom');
			} else {
				wEl.addClass('dashboard-sidebar-widget--drag-over-bottom');
				wEl.removeClass('dashboard-sidebar-widget--drag-over-top');
			}
		});

		wEl.addEventListener('dragleave', () => {
			wEl.removeClass('dashboard-sidebar-widget--drag-over-top');
			wEl.removeClass('dashboard-sidebar-widget--drag-over-bottom');
		});

		wEl.addEventListener('drop', (e) => {
			e.preventDefault();
			wEl.removeClass('dashboard-sidebar-widget--drag-over-top');
			wEl.removeClass('dashboard-sidebar-widget--drag-over-bottom');
			if (!draggedKey || wEl.dataset.widgetKey === draggedKey) return;

			const targetKey = wEl.dataset.widgetKey ?? '';
			const rect = wEl.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const insertBefore = e.clientY < midY;

			const keys = [...currentKeys];
			const fromIdx = keys.indexOf(draggedKey);
			if (fromIdx === -1) return;
			keys.splice(fromIdx, 1);
			let toIdx = keys.indexOf(targetKey);
			if (toIdx === -1) return;
			if (!insertBefore) toIdx += 1;
			keys.splice(toIdx, 0, draggedKey);
			onReorder(keys);
		});
	});
}

function renderSidebarWeather(container: HTMLElement, settings: import('./types').DashboardSettings, app: App): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-weather' });
	const cityName = settings.widgetWeatherCity || '';

	widget.createDiv({ cls: 'dashboard-sidebar-weather-loading', text: '...' });

	const config = {
		latitude: settings.widgetWeatherLat || 31.23,
		longitude: settings.widgetWeatherLon || 121.47,
		cityName: cityName || 'Shanghai',
	};

	const cached = getCachedWeather(config);
	if (cached) {
		widget.empty();
		renderSidebarWeatherContent(widget, cached, config.cityName);
		return;
	}

	fetchWeather(config).then(data => {
		widget.empty();
		renderSidebarWeatherContent(widget, data, config.cityName);
	}).catch(() => {
		widget.empty();
		widget.createDiv({ cls: 'dashboard-sidebar-weather-error', text: '--' });
	});
}

function renderSidebarWeatherContent(el: HTMLElement, data: import('./types').WeatherData, cityName: string): void {
	const top = el.createDiv({ cls: 'dashboard-sidebar-weather-top' });
	top.createDiv({ cls: 'dashboard-sidebar-weather-icon', text: getWeatherEmoji(data.weatherCode) });
	const tempWrap = top.createDiv({ cls: 'dashboard-sidebar-weather-temp-wrap' });
	tempWrap.createDiv({ cls: 'dashboard-sidebar-weather-temp', text: `${Math.round(data.temperature)}°` });

	const info = el.createDiv({ cls: 'dashboard-sidebar-weather-info' });
	info.createDiv({ cls: 'dashboard-sidebar-weather-city', text: cityName });
	const descLine = info.createDiv({ cls: 'dashboard-sidebar-weather-desc-line' });
	descLine.createSpan({ cls: 'dashboard-sidebar-weather-desc', text: getWeatherDescription(data.weatherCode) });

	const details = el.createDiv({ cls: 'dashboard-sidebar-weather-details' });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${t('weather.feelsLike') ?? 'Feels like'} ${Math.round(data.feelsLike)}°` });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${t('weather.humidity') ?? 'Humidity'} ${Math.round(data.humidity)}%` });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${Math.round(data.windSpeed)} km/h` });

	if (data.dailyDates.length > 1) {
		const forecast = el.createDiv({ cls: 'dashboard-sidebar-weather-forecast' });
		const count = Math.min(data.dailyDates.length, 5);
		for (let i = 0; i < count; i++) {
			const day = forecast.createDiv({ cls: 'dashboard-sidebar-weather-fday' });
			const d = new Date(data.dailyDates[i]! + 'T00:00:00');
			const dayName = d.toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short' });
			day.createDiv({ cls: 'dashboard-sidebar-weather-fday-name', text: i === 0 ? t('weather.today') ?? 'Today' : dayName });
			day.createDiv({ cls: 'dashboard-sidebar-weather-fday-icon', text: getWeatherEmoji(data.dailyCodes[i]!) });
			const temps = day.createDiv({ cls: 'dashboard-sidebar-weather-fday-temps' });
			temps.createSpan({ cls: 'dashboard-sidebar-weather-fday-high', text: `${Math.round(data.dailyMax[i]!)}°` });
			temps.createSpan({ cls: 'dashboard-sidebar-weather-fday-low', text: `${Math.round(data.dailyMin[i]!)}°` });
		}
	}
}

function renderHeatmapCell(
	cell: HTMLElement,
	point: import('./types').TrackerDataPoint | null,
	minVal: number,
	range: number,
	accentColor: string,
): void {
	cell.style.width = '8px';
	cell.style.height = '8px';
	cell.style.borderRadius = '2px';
	if (point === null || point.value === null) {
		cell.addClass('dashboard-sidebar-heatmap-cell--empty');
		return;
	}
	const intensity = range > 0 ? (point.value - minVal) / range : 1;
	cell.style.backgroundColor = accentColor;
	cell.style.opacity = String(0.15 + Math.max(0, Math.min(1, intensity)) * 0.85);
	cell.title = `${point.date}: ${point.value}`;
}

function renderHeatmapGithubGrid(
	widget: HTMLElement,
	data: import('./types').TrackerDataPoint[],
	minVal: number,
	range: number,
	accentColor: string,
): void {
	const scroll = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-scroll' });
	const grid = scroll.createDiv({ cls: 'dashboard-sidebar-heatmap-grid' });

	const firstDate = data[0] ? new Date(data[0].date + 'T00:00:00') : new Date();
	const startDayOfWeek = firstDate.getDay();
	const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

	const weeks: (import('./types').TrackerDataPoint | null)[][] = [];
	let currentWeek: (import('./types').TrackerDataPoint | null)[] = [];
	for (let i = 0; i < mondayOffset; i++) currentWeek.push(null);
	for (const point of data) {
		currentWeek.push(point);
		if (currentWeek.length === 7) {
			weeks.push(currentWeek);
			currentWeek = [];
		}
	}
	if (currentWeek.length > 0) weeks.push(currentWeek);

	grid.style.display = 'grid';
	grid.style.gridTemplateColumns = `repeat(${weeks.length}, 8px)`;
	grid.style.gridTemplateRows = 'repeat(7, 8px)';
	grid.style.gap = '2px';

	for (const week of weeks) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const cell = grid.createDiv({ cls: 'dashboard-sidebar-heatmap-cell' });
			renderHeatmapCell(cell, week[dayIdx] ?? null, minVal, range, accentColor);
		}
	}
}

function formatHeatmapMonthLabel(monthKey: string): string {
	const d = new Date(`${monthKey}-01T00:00:00`);
	if (isNaN(d.getTime())) return monthKey;
	const lang = getLanguage();
	const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
	return d.toLocaleDateString(locale, { month: 'short' });
}

function renderHeatmapMonthlyRows(
	widget: HTMLElement,
	data: import('./types').TrackerDataPoint[],
	minVal: number,
	range: number,
	accentColor: string,
): void {
	const byMonth = new Map<string, import('./types').TrackerDataPoint[]>();
	for (const p of data) {
		const monthKey = p.date.slice(0, 7);
		const arr = byMonth.get(monthKey);
		if (arr) arr.push(p);
		else byMonth.set(monthKey, [p]);
	}

	const rows = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-months' });
	for (const [monthKey, pts] of byMonth) {
		const row = rows.createDiv({ cls: 'dashboard-sidebar-heatmap-month-row' });
		row.createDiv({ cls: 'dashboard-sidebar-heatmap-month-label', text: formatHeatmapMonthLabel(monthKey) });
		const cells = row.createDiv({ cls: 'dashboard-sidebar-heatmap-month-cells' });
		for (const p of pts) {
			const cell = cells.createDiv({ cls: 'dashboard-sidebar-heatmap-cell' });
			renderHeatmapCell(cell, p, minVal, range, accentColor);
		}
	}
}

function getHeatmapPlugin(app: App) {
	return (app as unknown as {
		plugins: {
			plugins: Record<string, {
				settings?: import('./types').DashboardSettings;
				saveSettings?: () => Promise<void>;
				refreshAllDashboards?: () => void;
			}>;
		};
	}).plugins?.plugins?.['apex-dashboard'];
}

function bindHeatmapTitleEdit(titleEl: HTMLElement, settings: import('./types').DashboardSettings, app: App): void {
	titleEl.style.cursor = 'pointer';
	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const current = titleEl.getText();
		titleEl.empty();
		const input = titleEl.createEl('input', {
			cls: 'dashboard-title-edit-input dashboard-heatmap-title-edit',
			attr: { type: 'text', value: current },
		});
		input.focus();
		input.select();

		const finish = (save: boolean) => {
			const v = input.value.trim();
			const fallback = t('heatmap.title');
			const existing = settings.widgetHeatmapTitle?.trim() || '';
			if (save && v !== existing && v !== fallback) {
				const plugin = getHeatmapPlugin(app);
				if (plugin?.settings) {
					plugin.settings = { ...plugin.settings, widgetHeatmapTitle: v };
					void plugin.saveSettings?.();
					plugin.refreshAllDashboards?.();
					return;
				}
			} else if (save && v === fallback) {
				const plugin = getHeatmapPlugin(app);
				if (plugin?.settings && existing !== '') {
					plugin.settings = { ...plugin.settings, widgetHeatmapTitle: '' };
					void plugin.saveSettings?.();
					plugin.refreshAllDashboards?.();
					return;
				}
			}
			titleEl.empty();
			titleEl.setText(current);
		};

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});
		input.addEventListener('blur', () => finish(true));
	});
}

function renderSidebarHeatmap(container: HTMLElement, settings: import('./types').DashboardSettings, app: App): void {
	if (!settings.widgetTrackerKey) return;

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-heatmap' });

	const header = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-header' });
	const titleEl = header.createDiv({
		cls: 'dashboard-sidebar-heatmap-title',
		text: settings.widgetHeatmapTitle?.trim() || t('heatmap.title'),
	});
	bindHeatmapTitleEdit(titleEl, settings, app);

	const rangeMode = settings.widgetHeatmapRangeMode ?? 'rolling';
	const folder = settings.widgetHeatmapFolder ?? '';
	const key = settings.widgetTrackerKey;

	let data: import('./types').TrackerDataPoint[];
	let expectedCount: number;
	if (rangeMode === 'period') {
		const period = settings.widgetHeatmapPeriod ?? 'month';
		const { start, end } = getPeriodRange(period);
		data = readTrackerDataForRange(app, folder, key, start, end);
		expectedCount = data.length;
	} else {
		data = readTrackerData(app, folder, key, settings.widgetTrackerDays);
		expectedCount = settings.widgetTrackerDays;
	}

	const validPoints = data.filter(p => p.value !== null);
	if (validPoints.length === 0) return;

	const values = data.map(p => p.value).filter((v): v is number => v !== null);
	const minVal = Math.min(...values);
	const maxVal = Math.max(...values);
	const accentColor = getCSSVar('--db-accent') || '#6366f1';
	const range = maxVal - minVal || 1;

	if (rangeMode === 'period') {
		renderHeatmapMonthlyRows(widget, data, minVal, range, accentColor);
	} else {
		renderHeatmapGithubGrid(widget, data, minVal, range, accentColor);
	}

	const summaryMode = settings.widgetTrackerSummary ?? 'streak';
	if (summaryMode === 'off') return;

	const streak = computeStreak(data);
	const completionRate = expectedCount > 0 ? Math.round((validPoints.length / expectedCount) * 100) : 0;

	const stats = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-stats' });

	if (summaryMode === 'streak' || summaryMode === 'both') {
		const streakEl = stats.createSpan({ cls: 'dashboard-sidebar-heatmap-summary' });
		streakEl.createSpan({ cls: 'dashboard-sidebar-heatmap-icon', text: '⚡' });
		streakEl.createSpan({ text: t('heatmap.streak', { count: streak }) });
	}
	if (summaryMode === 'rate' || summaryMode === 'both') {
		const rateEl = stats.createSpan({ cls: 'dashboard-sidebar-heatmap-summary' });
		rateEl.createSpan({ cls: 'dashboard-sidebar-heatmap-icon', text: '✅' });
		rateEl.createSpan({ text: t('heatmap.rate', { rate: completionRate }) });
	}
}

export function renderSidebarPomodoro(
	container: HTMLElement,
	service: PomodoroService,
	settings: import('./types').DashboardSettings,
): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-pomodoro' });

	const state = service.getState();
	const isRunning = state.status === 'running';

	// Top row: today count left + activity selector centered + stats button right
	const topRow = widget.createDiv({ cls: 'dashboard-sidebar-pomodoro-top' });

	const todayCount = service.getTodayCount();
	const statsHint = topRow.createDiv({
		cls: 'dashboard-sidebar-pomodoro-stats-hint',
		text: '🍅 ' + t('pomodoro.today') + ' ' + todayCount,
	});

	topRow.createDiv({ cls: 'dashboard-sidebar-pomodoro-top-spacer' });

	// Activity selector (in title position)
	const currentActivity = service.getActivity();
	const { activityTrigger, updateActivityDisplay } = createActivitySelector(topRow, service, currentActivity);

	const statsBtn = topRow.createDiv({ cls: 'dashboard-sidebar-pomodoro-stats-btn' });
	setIcon(statsBtn, 'bar-chart-2');

	// Ring
	const ringWrap = widget.createDiv({ cls: 'dashboard-sidebar-pomodoro-ring-wrap' });
	const svgSize = 72;
	const strokeWidth = 6;
	const radius = (svgSize - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;

	const svg = ringWrap.createSvg('svg', {
		cls: 'dashboard-sidebar-pomodoro-ring',
		attr: { viewBox: `0 0 ${svgSize} ${svgSize}`, width: String(svgSize), height: String(svgSize) },
	});
	svg.createSvg('circle', {
		cls: 'dashboard-sidebar-pomodoro-ring-bg',
		attr: { cx: svgSize / 2, cy: svgSize / 2, r: radius, 'stroke-width': strokeWidth, fill: 'none' },
	});
	const progressCircle = svg.createSvg('circle', {
		cls: 'dashboard-sidebar-pomodoro-ring-progress',
		attr: {
			cx: svgSize / 2, cy: svgSize / 2, r: radius, 'stroke-width': strokeWidth, fill: 'none',
			'stroke-linecap': 'round', 'stroke-dasharray': circumference, 'stroke-dashoffset': '0',
			transform: `rotate(-90 ${svgSize / 2} ${svgSize / 2})`,
		},
	});
	const timeText = ringWrap.createDiv({
		cls: 'dashboard-sidebar-pomodoro-time',
		text: formatTime(state.remainingSeconds),
	});

	// Dots inside ring, below time
	const dotsWrap = ringWrap.createDiv({ cls: 'dashboard-sidebar-pomodoro-dots' });
	const interval = settings.pomodoroLongBreakInterval;
	for (let i = 0; i < interval; i++) {
		dotsWrap.createDiv({
			cls: 'dashboard-sidebar-pomodoro-dot' + (i < state.completedWorkSessions ? ' dashboard-sidebar-pomodoro-dot--filled' : ''),
		});
	}

	// Start/stop button
	const mainBtn = widget.createEl('button', {
		cls: 'dashboard-sidebar-pomodoro-main-btn',
		text: isRunning ? t('pomodoro.stop') : t('pomodoro.startFocus'),
	});
	if (isRunning) {
		mainBtn.addClass('dashboard-sidebar-pomodoro-main-btn--running');
	}

	// --- Helpers ---
	function updateRing(remaining: number, total: number): void {
		const progress = total > 0 ? remaining / total : 1;
		progressCircle.setAttribute('stroke-dashoffset', String(circumference * (1 - progress)));
		timeText.textContent = formatTime(remaining);
	}
	updateRing(state.remainingSeconds, state.totalSeconds);

	function updateUI(): void {
		const s = service.getState();
		updateRing(s.remainingSeconds, s.totalSeconds);
		const running = s.status === 'running';
		mainBtn.textContent = running ? t('pomodoro.stop') : t('pomodoro.startFocus');
		mainBtn.toggleClass('dashboard-sidebar-pomodoro-main-btn--running', running);
		const dots = dotsWrap.querySelectorAll('.dashboard-sidebar-pomodoro-dot');
		dots.forEach((dot, i) => dot.toggleClass('dashboard-sidebar-pomodoro-dot--filled', i < s.completedWorkSessions));
		const tc = service.getTodayCount();
		statsHint.textContent = t('pomodoro.today') + ' ' + tc;
	}

	service.setOnTick(() => {
		const s = service.getState();
		updateRing(s.remainingSeconds, s.totalSeconds);
	});

	service.setOnComplete(() => updateUI());

	mainBtn.addEventListener('click', () => {
		if (service.getState().status === 'running') {
			service.reset();
			updateUI();
		} else {
			service.start();
			updateUI();
		}
	});

	statsBtn.addEventListener('click', () => {
		showPomodoroStats(widget.ownerDocument, service);
	});
}

function createActivitySelector(
	parent: HTMLElement,
	service: PomodoroService,
	initialActivity: string,
): { activityTrigger: HTMLElement; updateActivityDisplay: (name: string) => void } {
	const wrap = parent.createDiv({ cls: 'dashboard-pomodoro-activity-selector' });

	const trigger = wrap.createDiv({
		cls: 'dashboard-pomodoro-activity-trigger' + (initialActivity ? ' dashboard-pomodoro-activity-trigger--set' : ''),
	});

	let colorDot: HTMLElement | null = null;
	let nameSpan: HTMLElement;

	if (initialActivity) {
		colorDot = trigger.createDiv({ cls: 'dashboard-pomodoro-activity-color-dot' });
		colorDot.style.backgroundColor = activityColor(initialActivity);
		nameSpan = trigger.createSpan({ text: initialActivity });
	} else {
		nameSpan = trigger.createSpan({ text: t('pomodoro.tapToSetActivity'), cls: 'dashboard-pomodoro-activity-placeholder' });
	}

	let panel: HTMLElement | null = null;

	function updateActivityDisplay(name: string): void {
		trigger.empty();
		trigger.toggleClass('dashboard-pomodoro-activity-trigger--set', name.length > 0);
		if (name) {
			const dot = trigger.createDiv({ cls: 'dashboard-pomodoro-activity-color-dot' });
			dot.style.backgroundColor = activityColor(name);
			nameSpan = trigger.createSpan({ text: name });
		} else {
			nameSpan = trigger.createSpan({ text: t('pomodoro.tapToSetActivity'), cls: 'dashboard-pomodoro-activity-placeholder' });
		}
	}

	function closePanel(): void {
		if (panel) {
			panel.remove();
			panel = null;
		}
	}

	function openPanel(): void {
		closePanel();

		panel = wrap.createDiv({ cls: 'dashboard-pomodoro-activity-panel' });

		const input = panel.createEl('input', {
			cls: 'dashboard-pomodoro-activity-panel-input',
			attr: { type: 'text', placeholder: t('pomodoro.inputActivity') },
		});

		const recentActivities = service.getRecentActivities(6);
		if (recentActivities.length > 0) {
			const chipsWrap = panel.createDiv({ cls: 'dashboard-pomodoro-activity-chips' });
			for (const act of recentActivities) {
				const chip = chipsWrap.createDiv({ cls: 'dashboard-pomodoro-activity-chip' });
				const dot = chip.createDiv({ cls: 'dashboard-pomodoro-activity-color-dot' });
				dot.style.backgroundColor = activityColor(act);
				chip.createSpan({ text: act });
				chip.addEventListener('click', (e) => {
					e.stopPropagation();
					service.setActivity(act);
					updateActivityDisplay(act);
					closePanel();
				});
			}
		}

		input.focus();

		const finish = (save: boolean) => {
			const val = input.value.trim();
			if (save && val) {
				service.setActivity(val);
				updateActivityDisplay(val);
			}
			closePanel();
		};

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); finish(true); }
			else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
		});
	}

	trigger.addEventListener('click', (e) => {
		e.stopPropagation();
		if (panel) {
			closePanel();
		} else {
			openPanel();
		}
	});

	// Close panel when clicking outside
	const doc = parent.ownerDocument;
	const onDocClick = (e: MouseEvent) => {
		if (panel && !panel.contains(e.target as Node) && !trigger.contains(e.target as Node)) {
			closePanel();
		}
	};
	doc.addEventListener('click', onDocClick);

	return { activityTrigger: trigger, updateActivityDisplay };
}

export function renderSidebarCountdown(
	container: HTMLElement,
	settings: import('./types').DashboardSettings,
	app: App,
): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-countdown' });

	// Settings button (absolute positioned)
	const settingsBtn = widget.createEl('button', {
		cls: 'dashboard-sidebar-countdown-settings-btn',
		attr: { 'aria-label': t('countdown.settingsTitle') },
	});
	setIcon(settingsBtn, 'settings');

	settingsBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const modal = new CountdownSettingsModal(app, settings, async (updates) => {
			Object.assign(settings, updates);
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings?: import('./types').DashboardSettings; saveSettings?: () => Promise<void>; refreshAllDashboards?: () => void }> } }).plugins?.plugins?.['apex-dashboard'];
			if (plugin?.settings) {
				Object.assign(plugin.settings!, updates);
				await plugin.saveSettings?.();
				plugin.refreshAllDashboards?.();
			}
		});
		modal.open();
	});

	// Content
	const content = widget.createDiv({ cls: 'dashboard-sidebar-countdown-content' });

	const targetDate = settings.countdownTargetDate;
	if (!targetDate) {
		content.createDiv({ cls: 'dashboard-sidebar-countdown-placeholder', text: t('countdown.setTarget') });
		return;
	}

	const target = targetDate.includes('T') ? new Date(targetDate) : new Date(targetDate + 'T00:00:00');
	const now = new Date();

	if (now >= target) {
		if (settings.countdownLabel) {
			content.createDiv({ cls: 'dashboard-sidebar-countdown-until', text: t('countdown.untilLabel', { label: settings.countdownLabel }) });
		}
		content.createDiv({ cls: 'dashboard-sidebar-countdown-expired', text: t('countdown.expired') });
		return;
	}

	const diffMs = target.getTime() - now.getTime();
	const remainDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
	const remainHours = Math.ceil(diffMs / (1000 * 60 * 60));
	const displayMode = settings.countdownDisplayMode;
	const remainMinutes = Math.ceil(diffMs / (1000 * 60));
	const currentVal = displayMode === 'minutes' ? remainMinutes : displayMode === 'hours' ? remainHours : remainDays;

	// "距离xx还有" label above the number
	if (settings.countdownLabel) {
		content.createDiv({ cls: 'dashboard-sidebar-countdown-until', text: t('countdown.untilLabel', { label: settings.countdownLabel }) });
	}

	// Value display with flip
	const flipWrap = content.createDiv({ cls: 'dashboard-sidebar-countdown-flip' });
	const valueEl = flipWrap.createDiv({ cls: 'dashboard-sidebar-countdown-value', text: String(currentVal) });
	flipWrap.createDiv({ cls: 'dashboard-sidebar-countdown-unit', text: displayMode === 'minutes' ? t('countdown.minutes') : displayMode === 'hours' ? t('countdown.hours') : t('countdown.days') });

	// Auto-refresh with flip animation
	let prevVal = currentVal;
	const timer = setInterval(() => {
		const now2 = new Date();
		if (now2 >= target) {
			clearInterval(timer);
			content.empty();
			content.createDiv({ cls: 'dashboard-sidebar-countdown-expired', text: t('countdown.expired') });
			return;
		}
		const diff = target.getTime() - now2.getTime();
		const newVal = displayMode === 'minutes' ? Math.ceil(diff / (1000 * 60)) : displayMode === 'hours' ? Math.ceil(diff / (1000 * 60 * 60)) : Math.ceil(diff / (1000 * 60 * 60 * 24));
		if (newVal !== prevVal) {
			prevVal = newVal;
			valueEl.textContent = String(newVal);
			valueEl.addClass('dashboard-sidebar-countdown-value--flip');
			setTimeout(() => valueEl.removeClass('dashboard-sidebar-countdown-value--flip'), 400);
		}
	}, 60000);
}

function showPomodoroStats(doc: Document, service: PomodoroService): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-pomodoro-stats-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
	doc.addEventListener('keydown', onKey);

	// Header
	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	header.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: t('pomodoro.statsTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	// Summary cards
	const summary = modal.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });

	const totalMin = service.getTotalFocusMinutes();
	const todayMin = service.getTodayFocusMinutes();
	const streak = service.getStreak();

	const totalCard = summary.createDiv({ cls: 'dashboard-pomodoro-stats-card' });
	totalCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-value', text: formatMinutes(totalMin) });
	totalCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-label', text: t('pomodoro.totalFocus') });

	const todayCard = summary.createDiv({ cls: 'dashboard-pomodoro-stats-card' });
	todayCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-value', text: formatMinutes(todayMin) });
	todayCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-label', text: t('pomodoro.todayFocus') });

	const streakCard = summary.createDiv({ cls: 'dashboard-pomodoro-stats-card' });
	streakCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-value', text: String(streak) });
	streakCard.createDiv({ cls: 'dashboard-pomodoro-stats-card-label', text: t('pomodoro.streakDays') });

	// Donut chart section with range toggle
	const donutSection = modal.createDiv({ cls: 'dashboard-pomodoro-stats-section' });

	// Range toggle: Day / Week / Month
	const rangeToggle = donutSection.createDiv({ cls: 'dashboard-pomodoro-range-toggle' });
	const ranges: { key: string; label: string; days: number }[] = [
		{ key: 'day', label: t('pomodoro.rangeDay'), days: 1 },
		{ key: 'week', label: t('pomodoro.rangeWeek'), days: 7 },
		{ key: 'month', label: t('pomodoro.rangeMonth'), days: 30 },
	];
	let activeRange = 'week';

	const toggleButtons = ranges.map(r => {
		const btn = rangeToggle.createDiv({
			cls: 'dashboard-pomodoro-range-btn' + (r.key === activeRange ? ' dashboard-pomodoro-range-btn--active' : ''),
			text: r.label,
		});
		return btn;
	});

	// Donut chart container
	const donutContainer = donutSection.createDiv({ cls: 'dashboard-pomodoro-donut-container' });

	function renderDonut(rangeKey: string): void {
		donutContainer.empty();

		const rangeInfo = ranges.find(r => r.key === rangeKey);
		if (!rangeInfo) return;

		const breakdown = service.getActivityBreakdownByRange(rangeInfo.days);
		const sorted = [...breakdown.entries()].sort((a, b) => b[1] - a[1]);
		const totalRangeMin = sorted.reduce((sum, [, m]) => sum + m, 0);

		if (totalRangeMin === 0) {
			donutContainer.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.noRecords') });
			return;
		}

		// SVG donut chart
		const size = 160;
		const strokeWidth = 28;
		const donutR = (size - strokeWidth) / 2;
		const circumference = 2 * Math.PI * donutR;

		const svg = donutContainer.createSvg('svg', {
			cls: 'dashboard-pomodoro-donut-svg',
			attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) },
		});

		// Background circle
		svg.createSvg('circle', {
			attr: { cx: size / 2, cy: size / 2, r: donutR, fill: 'none', 'stroke-width': strokeWidth },
			cls: 'dashboard-pomodoro-donut-bg',
		});

		// Draw arcs
		let offset = 0;
		const gap = sorted.length > 1 ? 3 : 0;
		for (const [name, mins] of sorted) {
			const pct = mins / totalRangeMin;
			const dashLen = Math.max(0, circumference * pct - gap);
			const circle = svg.createSvg('circle', {
				cls: 'dashboard-pomodoro-donut-segment',
				attr: {
					cx: size / 2, cy: size / 2, r: donutR, fill: 'none',
					'stroke-width': strokeWidth,
					'stroke-dasharray': `${dashLen} ${circumference - dashLen}`,
					'stroke-dashoffset': String(-offset),
					transform: `rotate(-90 ${size / 2} ${size / 2})`,
					'stroke-linecap': 'butt',
				},
			});
			circle.style.stroke = activityColor(name);
			offset += dashLen + gap;
		}

		// Center text: total time
		const centerValue = svg.createSvg('text', {
			attr: {
				x: size / 2, y: size / 2 - 6,
				'text-anchor': 'middle', 'dominant-baseline': 'middle',
			},
			cls: 'dashboard-pomodoro-donut-center-value',
		});
		centerValue.textContent = formatMinutes(totalRangeMin);

		const centerLabel = svg.createSvg('text', {
			attr: {
				x: size / 2, y: size / 2 + 14,
				'text-anchor': 'middle', 'dominant-baseline': 'middle',
			},
			cls: 'dashboard-pomodoro-donut-center-label',
		});
		centerLabel.textContent = rangeInfo.label;

		// Legend with percentages
		const legend = donutContainer.createDiv({ cls: 'dashboard-pomodoro-donut-legend' });
		for (const [name, mins] of sorted) {
			const pct = Math.round((mins / totalRangeMin) * 100);
			const item = legend.createDiv({ cls: 'dashboard-pomodoro-donut-legend-item' });
			const dot = item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
			dot.style.backgroundColor = activityColor(name);
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-name', text: name });
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-pct', text: pct + '%' });
			item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-time', text: formatMinutes(mins) });
		}
	}

	// Toggle handlers
	toggleButtons.forEach((btn, i) => {
		btn.addEventListener('click', () => {
			activeRange = ranges[i]!.key;
			toggleButtons.forEach((b, j) => b.toggleClass('dashboard-pomodoro-range-btn--active', j === i));
			renderDonut(activeRange);
		});
	});

	renderDonut(activeRange);

	// Recent sessions with activity color dots
	const recentRecords = service.getRecentRecords(10);
	if (recentRecords.length > 0) {
		const recentSection = modal.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
		recentSection.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: t('pomodoro.recentSessions') });
		for (const rec of recentRecords) {
			const row = recentSection.createDiv({ cls: 'dashboard-pomodoro-stats-record-row' });
			const actDot = row.createDiv({ cls: 'dashboard-pomodoro-stats-record-dot' });
			actDot.style.backgroundColor = activityColor(rec.activity || t('pomodoro.defaultActivity'));
			const ts = new Date(rec.timestamp);
			const dateStr = ts.getMonth() + 1 + '/' + ts.getDate() + ' ' +
				String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0');
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-date', text: dateStr });
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-activity', text: rec.activity });
			row.createDiv({ cls: 'dashboard-pomodoro-stats-record-duration', text: rec.duration + ' min' });
		}
	}
}

function formatMinutes(minutes: number): string {
	if (minutes < 60) {
		return t('pomodoro.minutes', { count: minutes });
	}
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) return t('pomodoro.hours', { count: hours });
	return t('pomodoro.hours', { count: hours }) + ' ' + t('pomodoro.minutes', { count: mins });
}


function formatTime(seconds: number): string {
	if (seconds >= 3600) {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = seconds % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatReadingDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const mins = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0 && mins > 0) return t('reading.timeHM', { h: hours, m: mins });
	if (hours > 0) return t('reading.hours', { count: hours });
	return t('reading.minutes', { count: Math.max(1, mins) });
}

function formatShortDuration(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	if (h > 0) return `${h}h${m > 0 ? m + 'm' : ''}`;
	return `${Math.max(1, m)}m`;
}

export function renderSidebarReading(
	container: HTMLElement,
	service: ReadingService,
): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-reading' });

	// Title row
	const titleRow = widget.createDiv({ cls: 'dashboard-reading-title-row' });
	titleRow.createDiv({ cls: 'dashboard-reading-title', text: t('reading.title') });
	titleRow.createDiv({ cls: 'dashboard-reading-title-spacer' });
	const addBtn = titleRow.createDiv({ cls: 'dashboard-reading-add-btn' });
	setIcon(addBtn, 'plus');
	const statsBtn = titleRow.createDiv({ cls: 'dashboard-reading-stats-btn' });
	setIcon(statsBtn, 'bar-chart-2');

	// Book cards scroll area
	const scrollArea = widget.createDiv({ cls: 'dashboard-reading-scroll' });

	const state = service.getState();
	const activeBooks = service.getActiveBooks();

	for (const book of activeBooks) {
		const isActive = state.status !== 'idle' && state.currentBook?.title === book.title;
		const isRunning = isActive && state.status === 'running';
		const card = scrollArea.createDiv({
			cls: 'dashboard-reading-book-card' + (isActive ? ' dashboard-reading-book-card--active' : ''),
		});

		// Cover - always show title fallback, async load real cover
		const coverWrap = card.createDiv({ cls: 'dashboard-reading-book-card-cover-wrap' });
		const placeholder = coverWrap.createDiv({ cls: 'dashboard-reading-book-card-cover-placeholder' });
		placeholder.textContent = book.title.length > 8 ? book.title.slice(0, 8) + '..' : book.title;
		if (book.coverUrl) {
			downloadCoverAsBlobUrl(book.coverUrl).then(blobUrl => {
				if (blobUrl) {
					placeholder.style.display = 'none';
					coverWrap.style.backgroundImage = `url(${blobUrl})`;
				}
			});
		}

		// Info area
		const info = card.createDiv({ cls: 'dashboard-reading-book-card-info' });
		info.createDiv({ cls: 'dashboard-reading-book-card-title', text: book.title });
		if (book.author) {
			info.createDiv({ cls: 'dashboard-reading-book-card-author', text: book.author });
		}

		// Timer row
		const timerRow = info.createDiv({ cls: 'dashboard-reading-book-card-timer' });

		if (isActive) {
			timerRow.createDiv({
				cls: 'dashboard-reading-book-card-time dashboard-reading-book-card-time--active',
				text: formatTime(state.elapsedSeconds),
			});
		} else {
			const todaySec = service.getTodaySecondsForBook(book.title);
			timerRow.createDiv({
				cls: 'dashboard-reading-book-card-time',
				text: todaySec > 0 ? formatShortDuration(todaySec) : '--',
			});
		}

		// Play/pause/stop buttons
		const actions = timerRow.createDiv({ cls: 'dashboard-reading-book-card-actions' });

		if (isRunning) {
			const pauseBtn = actions.createDiv({ cls: 'dashboard-reading-book-card-btn dashboard-reading-book-card-btn--pause' });
			setIcon(pauseBtn, 'pause');
			pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); service.pause(); refreshCards(); });
			const stopBtn = actions.createDiv({ cls: 'dashboard-reading-book-card-btn dashboard-reading-book-card-btn--stop' });
			setIcon(stopBtn, 'square');
			stopBtn.addEventListener('click', (e) => { e.stopPropagation(); service.pause(); showEndModal(book); });
		} else if (isActive && state.status === 'paused') {
			const resumeBtn = actions.createDiv({ cls: 'dashboard-reading-book-card-btn dashboard-reading-book-card-btn--play' });
			setIcon(resumeBtn, 'play');
			resumeBtn.addEventListener('click', (e) => { e.stopPropagation(); service.resume(); refreshCards(); });
			const stopBtn = actions.createDiv({ cls: 'dashboard-reading-book-card-btn dashboard-reading-book-card-btn--stop' });
			setIcon(stopBtn, 'square');
			stopBtn.addEventListener('click', (e) => { e.stopPropagation(); showEndModal(book); });
		} else {
			const playBtn = actions.createDiv({ cls: 'dashboard-reading-book-card-btn dashboard-reading-book-card-btn--play' });
			setIcon(playBtn, 'play');
			playBtn.addEventListener('click', (e) => { e.stopPropagation(); service.startReading(book); refreshCards(); });
		}

		// Progress bar
		if (book.totalPages > 0) {
			const progressWrap = info.createDiv({ cls: 'dashboard-reading-book-card-progress' });
			const pct = book.finished ? 100 : Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
			const progressBar = progressWrap.createDiv({ cls: 'dashboard-reading-book-card-progress-bar' });
			progressBar.createDiv({
				cls: 'dashboard-reading-book-card-progress-fill' + (book.finished ? ' dashboard-reading-book-card-progress-fill--done' : ''),
				attr: { style: `width:${pct}%` },
			});
			progressWrap.createDiv({
				cls: 'dashboard-reading-book-card-progress-text',
				text: book.finished ? '100%' : `${book.currentPage}/${book.totalPages}`,
			});
		}

		// Action buttons (edit / remove)
		const editBtn = card.createDiv({ cls: 'dashboard-reading-book-card-action dashboard-reading-book-card-edit' });
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openEditBookInfo(widget.ownerDocument, service, book, () => refreshCards());
		});

		const removeBtn = card.createDiv({ cls: 'dashboard-reading-book-card-action dashboard-reading-book-card-remove' });
		setIcon(removeBtn, 'x');
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			service.removeActiveBook(book.title).then(() => refreshCards());
		});
	}

	// Timer tick - update active timer display
	service.setOnTick(() => {
		const s = service.getState();
		if (s.status === 'running') {
			const activeTime = scrollArea.querySelector('.dashboard-reading-book-card-time--active');
			if (activeTime) activeTime.textContent = formatTime(s.elapsedSeconds);
		}
	});

	addBtn.addEventListener('click', () => {
		openBookSearch(widget.ownerDocument, service, (book) => {
			if (book) service.addActiveBook(book).then(() => refreshCards());
		});
	});

	statsBtn.addEventListener('click', () => {
		showReadingStats(widget.ownerDocument, service);
	});

	function showEndModal(book: import('./reading-service').BookInfo): void {
		const elapsed = service.getElapsedSeconds();
		openEndReadingModal(widget.ownerDocument, service, book, elapsed, () => refreshCards());
	}

	function refreshCards(): void {
		service.setOnTick(null);
		const parent = widget.parentElement!;
		widget.remove();
		renderSidebarReading(parent, service);
	}
}

function openEndReadingModal(
	doc: Document,
	service: ReadingService,
	book: import('./reading-service').BookInfo,
	elapsedSeconds: number,
	onDone: () => void,
): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-reading-end-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-reading-end-modal' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
	doc.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

	// Header
	const header = modal.createDiv({ cls: 'dashboard-reading-end-header' });
	header.createDiv({ cls: 'dashboard-reading-end-title', text: t('reading.endTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-reading-end-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', close);

	// Body
	const body = modal.createDiv({ cls: 'dashboard-reading-end-body' });

	// Date row
	const dateRow = body.createDiv({ cls: 'dashboard-reading-end-row' });
	dateRow.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.endDate') });
	const now = new Date();
	dateRow.createDiv({
		cls: 'dashboard-reading-end-value',
		text: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
	});

	// Duration row
	const durRow = body.createDiv({ cls: 'dashboard-reading-end-row' });
	durRow.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.endDuration') });
	durRow.createDiv({ cls: 'dashboard-reading-end-value', text: formatReadingDuration(elapsedSeconds) });

	// Progress section
	const progressSection = body.createDiv({ cls: 'dashboard-reading-end-section' });
	progressSection.createDiv({ cls: 'dashboard-reading-end-section-title', text: t('reading.endProgress') });

	// Mode toggle: page / percentage
	let progressMode: 'page' | 'pct' = book.totalPages > 0 ? 'page' : 'pct';
	const modeToggle = progressSection.createDiv({ cls: 'dashboard-reading-end-mode-toggle' });
	const pageModeBtn = modeToggle.createDiv({
		cls: 'dashboard-reading-end-mode-btn' + (progressMode === 'page' ? ' dashboard-reading-end-mode-btn--active' : ''),
		text: t('reading.endModePage'),
	});
	const pctModeBtn = modeToggle.createDiv({
		cls: 'dashboard-reading-end-mode-btn' + (progressMode === 'pct' ? ' dashboard-reading-end-mode-btn--active' : ''),
		text: t('reading.endModePct'),
	});

	// Inputs container
	const inputsContainer = progressSection.createDiv({ cls: 'dashboard-reading-end-inputs' });

	function renderInputs(): void {
		inputsContainer.empty();
		const pageRow = inputsContainer.createDiv({ cls: 'dashboard-reading-end-page-row' });

		// Start value (readonly)
		const startCol = pageRow.createDiv({ cls: 'dashboard-reading-end-page-col' });
		startCol.createDiv({ cls: 'dashboard-reading-end-page-label', text: t('reading.endStartPage') });
		const startVal = progressMode === 'pct'
			? (book.totalPages > 0 ? Math.round((book.currentPage / book.totalPages) * 100) : 0)
			: book.currentPage;
		const suffix = progressMode === 'pct' ? '%' : '';
		startCol.createDiv({ cls: 'dashboard-reading-end-page-readonly', text: `${startVal}${suffix}` });

		pageRow.createDiv({ cls: 'dashboard-reading-end-page-arrow' });

		// End value (input)
		const endCol = pageRow.createDiv({ cls: 'dashboard-reading-end-page-col' });
		endCol.createDiv({ cls: 'dashboard-reading-end-page-label', text: t('reading.endEndPage') });
		const endInput = endCol.createEl('input', {
			cls: 'dashboard-reading-end-page-input',
			attr: {
				type: 'number',
				min: '0',
				max: progressMode === 'pct' ? '100' : '',
				placeholder: progressMode === 'pct' ? '0%' : '0',
			},
		});
		endInput.focus();

		// Total pages row (page mode, unknown total)
		if (progressMode === 'page' && !book.totalPages) {
			const totalRow = inputsContainer.createDiv({ cls: 'dashboard-reading-end-total-row' });
			totalRow.createDiv({ cls: 'dashboard-reading-end-page-label', text: t('reading.endTotalPages') });
			totalRow.createEl('input', {
				cls: 'dashboard-reading-end-page-input dashboard-reading-end-page-input--total',
				attr: { type: 'number', min: '0', placeholder: '?' },
			});
		}
	}
	renderInputs();

	pageModeBtn.addEventListener('click', () => {
		progressMode = 'page';
		pageModeBtn.addClass('dashboard-reading-end-mode-btn--active');
		pctModeBtn.removeClass('dashboard-reading-end-mode-btn--active');
		renderInputs();
	});
	pctModeBtn.addEventListener('click', () => {
		progressMode = 'pct';
		pctModeBtn.addClass('dashboard-reading-end-mode-btn--active');
		pageModeBtn.removeClass('dashboard-reading-end-mode-btn--active');
		renderInputs();
	});

	// Finished checkbox
	const finishedRow = body.createDiv({ cls: 'dashboard-reading-end-finished' });
	const checkbox = finishedRow.createEl('input', {
		cls: 'dashboard-reading-end-checkbox',
		attr: { type: 'checkbox', id: 'reading-finished' },
	});
	const checkLabel = finishedRow.createEl('label', {
		cls: 'dashboard-reading-end-checkbox-label',
		attr: { for: 'reading-finished' },
	});
	checkLabel.textContent = t('reading.endMarkFinished');

	// Footer
	const footer = modal.createDiv({ cls: 'dashboard-reading-end-footer' });

	footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--cancel',
		text: t('reading.endCancel'),
	}).addEventListener('click', close);

	footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--discard',
		text: t('reading.endDiscard'),
	}).addEventListener('click', () => {
		service.discardSession();
		close();
		onDone();
	});

	footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--confirm',
		text: t('reading.endConfirm'),
	}).addEventListener('click', async () => {
		const endInput = inputsContainer.querySelector('.dashboard-reading-end-page-input:not(.dashboard-reading-end-page-input--total)') as HTMLInputElement | null;
		const totalInput = inputsContainer.querySelector('.dashboard-reading-end-page-input--total') as HTMLInputElement | null;
		const endVal = parseInt(endInput?.value || '0') || 0;
		const finished = checkbox.checked;

		let endPage: number;
		let totalPages = book.totalPages;

		if (progressMode === 'pct') {
			if (totalPages > 0) {
				endPage = Math.round((Math.min(endVal, 100) / 100) * totalPages);
			} else {
				endPage = Math.min(endVal, 100);
				totalPages = 100;
			}
		} else {
			endPage = endVal;
			if (totalInput) {
				totalPages = parseInt(totalInput.value) || 0;
			}
		}

		await service.finishSession(endPage, totalPages, finished);
		close();
		onDone();
	});
}

function openEditBookInfo(
	doc: Document,
	service: ReadingService,
	book: import('./reading-service').BookInfo,
	onDone: () => void,
): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-reading-end-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-reading-end-modal' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
	doc.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

	const header = modal.createDiv({ cls: 'dashboard-reading-end-header' });
	header.createDiv({ cls: 'dashboard-reading-end-title', text: t('reading.editTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-reading-end-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', close);

	const body = modal.createDiv({ cls: 'dashboard-reading-end-body' });

	body.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.editBookName') });
	const titleInput = body.createEl('input', {
		cls: 'dashboard-reading-end-input',
		attr: { type: 'text' },
	});
	titleInput.value = book.title;

	body.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.editAuthorName') });
	const authorInput = body.createEl('input', {
		cls: 'dashboard-reading-end-input',
		attr: { type: 'text' },
	});
	authorInput.value = book.author;

	body.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.editTotalPages') });
	const pagesInput = body.createEl('input', {
		cls: 'dashboard-reading-end-input',
		attr: { type: 'number', min: '0' },
	});
	pagesInput.value = String(book.totalPages || '');

	body.createDiv({ cls: 'dashboard-reading-end-label', text: t('reading.editCoverUrl') });
	const coverInput = body.createEl('input', {
		cls: 'dashboard-reading-end-input',
		attr: { type: 'text', placeholder: t('reading.editCoverPlaceholder') },
	});
	coverInput.value = book.coverUrl;

	const footer = modal.createDiv({ cls: 'dashboard-reading-end-footer' });
	const saveBtn = footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--confirm',
		text: t('reading.editConfirm'),
	});
	footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--cancel',
		text: t('reading.endCancel'),
	}).addEventListener('click', close);

	const deleteBtn = footer.createEl('button', {
		cls: 'dashboard-reading-end-btn dashboard-reading-end-btn--delete',
		text: t('reading.editDeleteBook'),
	});
	deleteBtn.addEventListener('click', async () => {
		await service.removeActiveBook(book.title);
		close();
		onDone();
	});

	saveBtn.addEventListener('click', async () => {
		const newTitle = titleInput.value.trim();
		if (!newTitle) return;

		await service.updateBookInfo(book.title, {
			title: newTitle,
			author: authorInput.value.trim(),
			coverUrl: coverInput.value.trim(),
			totalPages: parseInt(pagesInput.value) || 0,
		});
		close();
		onDone();
	});

	titleInput.focus();
}

function openBookSearch(
	doc: Document,
	service: ReadingService,
	onSelect: (book: import('./reading-service').BookInfo | null) => void,
): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-reading-book-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-reading-book-modal' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
	doc.addEventListener('keydown', onKey);

	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

	const header = modal.createDiv({ cls: 'dashboard-reading-book-header' });
	header.createDiv({ cls: 'dashboard-reading-book-header-title', text: t('reading.selectBook') });
	const closeBtn = header.createDiv({ cls: 'dashboard-reading-book-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', close);

	const inputArea = modal.createDiv({ cls: 'dashboard-reading-book-input-area' });
	const input = inputArea.createEl('input', {
		cls: 'dashboard-reading-book-input',
		attr: { type: 'text', placeholder: t('reading.searchBook') },
	});
	input.focus();

	const resultsArea = modal.createDiv({ cls: 'dashboard-reading-book-results' });

	// Manual input row (always at bottom)
	const manualRow = resultsArea.createDiv({ cls: 'dashboard-reading-book-manual' });
	manualRow.createDiv({ cls: 'dashboard-reading-book-manual-label', text: t('reading.manualInput') });
	const manualInput = manualRow.createEl('input', {
		cls: 'dashboard-reading-book-manual-input',
		attr: { type: 'text', placeholder: t('reading.manualPlaceholder') },
	});
	const manualBtn = manualRow.createEl('button', {
		cls: 'dashboard-reading-book-manual-btn',
		text: 'OK',
	});
	manualBtn.addEventListener('click', () => {
		const val = manualInput.value.trim();
		if (val) {
			onSelect({ title: val, author: '', coverUrl: '', isbn: '', source: 'manual', currentPage: 0, totalPages: 0, finished: false });
			close();
		}
	});

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searching = false;

	input.addEventListener('input', () => {
		if (searchTimer) clearTimeout(searchTimer);
		const query = input.value.trim();

		// Remove previous search results (keep manual row)
		while (resultsArea.firstChild && resultsArea.firstChild !== manualRow) {
			resultsArea.removeChild(resultsArea.firstChild!);
		}

		if (!query) return;

		const indicator = resultsArea.createDiv({ cls: 'dashboard-reading-book-searching', text: t('reading.searching') });
		resultsArea.insertBefore(indicator, manualRow);

		searchTimer = setTimeout(async () => {
			if (searching) return;
			searching = true;

			let results: import('./book-service').BookSearchResult[] = [];
			try {
				results = await searchBooks(query);
			} catch {
				results = [];
			}
			searching = false;

			// Remove previous results
			while (resultsArea.firstChild && resultsArea.firstChild !== manualRow) {
				resultsArea.removeChild(resultsArea.firstChild!);
			}

			if (results.length === 0) {
				const noResult = resultsArea.createDiv({ cls: 'dashboard-reading-book-no-results', text: t('reading.noResults') });
				resultsArea.insertBefore(noResult, manualRow);
				return;
			}

			for (const book of results) {
				const item = resultsArea.createDiv({ cls: 'dashboard-reading-book-item' });
				if (book.coverUrl) {
					const c = item.createDiv({ cls: 'dashboard-reading-book-item-cover' });
					downloadCoverAsBlobUrl(book.coverUrl).then(url => { if (url) c.style.backgroundImage = `url(${url})`; });
				} else {
					item.createDiv({ cls: 'dashboard-reading-book-item-nocover' });
				}
				const info = item.createDiv({ cls: 'dashboard-reading-book-item-info' });
				info.createDiv({ cls: 'dashboard-reading-book-item-title', text: book.title });
				if (book.author) {
					info.createDiv({ cls: 'dashboard-reading-book-item-author', text: book.author });
				}
				item.addEventListener('click', () => {
					onSelect({
						title: book.title, author: book.author, coverUrl: book.coverUrl,
						isbn: book.isbn, source: 'google', currentPage: 0, totalPages: 0, finished: false,
					});
					close();
				});
				resultsArea.insertBefore(item, manualRow);
			}
		}, 500);
	});
}

function showReadingStats(doc: Document, service: ReadingService): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-pomodoro-stats-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
	doc.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	header.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: t('reading.statsTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', close);

	const content = modal.createDiv({ cls: 'dashboard-reading-stats-content' });

	function renderContent(): void {
		content.empty();

		// Summary card
		const summaryCard = content.createDiv({ cls: 'dashboard-reading-stats-card' });
		const summaryGrid = summaryCard.createDiv({ cls: 'dashboard-reading-stats-summary' });
		const totalItem = summaryGrid.createDiv({ cls: 'dashboard-reading-stats-summary-item' });
		totalItem.createDiv({ cls: 'dashboard-reading-stats-summary-value', text: formatReadingDuration(service.getTotalSeconds()) });
		totalItem.createDiv({ cls: 'dashboard-reading-stats-summary-label', text: t('reading.totalReading') });
		const todayItem = summaryGrid.createDiv({ cls: 'dashboard-reading-stats-summary-item' });
		todayItem.createDiv({ cls: 'dashboard-reading-stats-summary-value', text: formatReadingDuration(service.getTodaySeconds()) });
		todayItem.createDiv({ cls: 'dashboard-reading-stats-summary-label', text: t('reading.todayReading') });
		const bookItem = summaryGrid.createDiv({ cls: 'dashboard-reading-stats-summary-item' });
		bookItem.createDiv({ cls: 'dashboard-reading-stats-summary-value', text: String(service.getBookCountInRange(365)) });
		bookItem.createDiv({ cls: 'dashboard-reading-stats-summary-label', text: t('reading.bookCount') });
		const streakItem = summaryGrid.createDiv({ cls: 'dashboard-reading-stats-summary-item' });
		streakItem.createDiv({ cls: 'dashboard-reading-stats-summary-value', text: String(service.getStreak()) });
		streakItem.createDiv({ cls: 'dashboard-reading-stats-summary-label', text: t('reading.streakDays') });

		// Book list card
		const bookCard = content.createDiv({ cls: 'dashboard-reading-stats-card' });
		bookCard.createDiv({ cls: 'dashboard-reading-stats-card-title', text: t('reading.bookList') });
		const rangeToggle = bookCard.createDiv({ cls: 'dashboard-reading-stats-range' });
		const ranges: { key: string; label: string; days: number }[] = [
			{ key: 'week', label: t('reading.rangeWeek'), days: 7 },
			{ key: 'month', label: t('reading.rangeMonth'), days: 30 },
			{ key: 'year', label: t('reading.rangeYear'), days: 365 },
		];
		let activeRange = 'month';
		const toggleButtons = ranges.map(r => rangeToggle.createDiv({
			cls: 'dashboard-reading-stats-range-btn' + (r.key === activeRange ? ' dashboard-reading-stats-range-btn--active' : ''),
			text: r.label,
		}));
		const bookListContainer = bookCard.createDiv({ cls: 'dashboard-reading-book-list' });

		function renderBookList(rangeKey: string): void {
			bookListContainer.empty();
			const rangeInfo = ranges.find(r => r.key === rangeKey);
			if (!rangeInfo) return;
			const books = service.getBookBreakdownInRange(rangeInfo.days);
			if (books.length === 0) {
				bookListContainer.createDiv({ cls: 'dashboard-reading-stats-empty', text: t('reading.noRecords') });
				return;
			}
			for (const book of books) {
				const row = bookListContainer.createDiv({ cls: 'dashboard-reading-book-list-row' });
				if (book.coverUrl) {
					const c = row.createDiv({ cls: 'dashboard-reading-book-list-cover' });
					downloadCoverAsBlobUrl(book.coverUrl).then(url => {
						if (url) c.style.backgroundImage = `url(${url})`;
					});
				} else {
					row.createDiv({ cls: 'dashboard-reading-book-list-nocover' });
				}
				const info = row.createDiv({ cls: 'dashboard-reading-book-list-info' });
				info.createDiv({ cls: 'dashboard-reading-book-list-title', text: book.title });
				if (book.author) info.createDiv({ cls: 'dashboard-reading-book-list-author', text: book.author });
				const meta = row.createDiv({ cls: 'dashboard-reading-book-list-meta' });
				meta.createDiv({ cls: 'dashboard-reading-book-list-duration', text: formatReadingDuration(book.totalSeconds) });
				meta.createDiv({ cls: 'dashboard-reading-book-list-sessions', text: t('reading.times', { count: book.sessions }) });
				const del = meta.createDiv({ cls: 'dashboard-reading-stats-record-del' });
				setIcon(del, 'trash-2');
				del.addEventListener('click', async (e) => {
					e.stopPropagation();
					await service.deleteBookRecords(book.title);
					renderBookList(rangeKey);
				});
			}
		}
		toggleButtons.forEach((btn, i) => {
			btn.addEventListener('click', () => {
				activeRange = ranges[i]!.key;
				toggleButtons.forEach((b, j) => b.toggleClass('dashboard-reading-stats-range-btn--active', j === i));
				renderBookList(activeRange);
			});
		});
		renderBookList(activeRange);

		// Recent records card
		const recentRecords = service.getRecentRecords(10);
		if (recentRecords.length > 0) {
			const recentCard = content.createDiv({ cls: 'dashboard-reading-stats-card' });
			recentCard.createDiv({ cls: 'dashboard-reading-stats-card-title', text: t('reading.recentRecords') });
			for (const rec of recentRecords) {
				const row = recentCard.createDiv({ cls: 'dashboard-reading-stats-record' });
				const ts = new Date(rec.timestamp);
				const dateText = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
				row.createDiv({ cls: 'dashboard-reading-stats-record-date', text: dateText });
				row.createDiv({ cls: 'dashboard-reading-stats-record-book', text: rec.bookTitle });
				row.createDiv({ cls: 'dashboard-reading-stats-record-dur', text: formatReadingDuration(rec.durationSeconds) });
				const del = row.createDiv({ cls: 'dashboard-reading-stats-record-del' });
				setIcon(del, 'trash-2');
				del.addEventListener('click', async (e) => {
					e.stopPropagation();
					await service.deleteRecord(rec.timestamp);
					renderContent();
				});
			}
		}
	}

	renderContent();
}



export function renderDashboard(
	container: HTMLElement,
	data: DashboardData,
	callbacks: RenderCallbacks,
	app: App,
	settings?: DashboardSettings,
	hoverParent: HoverParent | null = null,
): void {
	activeHoverParent = hoverParent;
	activeNoteOpener = callbacks.onOpenNoteInPopover ?? null;

	container.empty();
	container.addClass('dashboard-kanban');

	for (const column of data.columns) {
		const section = renderSection(column, callbacks, app, data, settings);
		container.appendChild(section);
	}

	const addColBtn = container.createDiv({ cls: 'dashboard-add-section' });
	addColBtn.setText(t('renderer.addSection'));
	addColBtn.setAttribute('role', 'button');
	addColBtn.addEventListener('click', () => {
		if (addColBtn.querySelector('input')) return;
		addColBtn.empty();

		let selectedType = 'projects';

		const row = addColBtn.createDiv({ cls: 'dashboard-add-section-row' });

		const input = row.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('renderer.sectionName') },
		});

		const typePicker = row.createDiv({ cls: 'dashboard-section-type-picker' });
		const typeOptions = [
			{ value: 'projects', label: t('renderer.typeNotes') },
			{ value: 'todo', label: t('renderer.typeTodo') },
			{ value: 'memo', label: t('renderer.typeMemo') },
			{ value: 'notes', label: t('renderer.typeNotesPlain') },
			{ value: 'library', label: t('renderer.typeLibrary') },
		];

		for (const opt of typeOptions) {
			const btn = typePicker.createEl('button', {
				cls: 'dashboard-section-type-btn' + (opt.value === selectedType ? ' active' : ''),
				text: opt.label,
				attr: { 'data-type': opt.value },
			});
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
			});
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				selectedType = opt.value;
				typePicker.querySelectorAll('.dashboard-section-type-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		const confirmBtn = row.createEl('button', {
			cls: 'dashboard-section-confirm-btn',
			attr: { 'aria-label': t('common.save') },
		});
		setIcon(confirmBtn, 'check');
		confirmBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			finish();
		});

		const finish = () => {
			const name = input.value.trim();
			input.value = '';
			if (name) {
				callbacks.onColumnAdd(name, selectedType);
			}
			addColBtn.empty();
			addColBtn.setText(t('renderer.addSection'));
		};

		input.addEventListener('input', () => {
			const name = input.value.trim().toLowerCase();
			if (name === 'memo') {
				selectedType = 'memo';
			} else if (name === 'todo') {
				selectedType = 'todo';
			} else {
				return;
			}
			typePicker.querySelectorAll('.dashboard-section-type-btn').forEach(b => {
				b.toggleClass('active', b.getAttribute('data-type') === selectedType);
			});
		});

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish();
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				addColBtn.empty();
				addColBtn.setText(t('renderer.addSection'));
			}
		});

		input.focus();
	});
}

const COLLAPSED_KEY = 'apex-dashboard-collapsed';

function getCollapsedSections(): Set<string> {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (!raw) return new Set();
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return new Set();
	}
}

function saveCollapsedSections(collapsed: Set<string>): void {
	localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

function renderSection(column: DashboardColumn, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): HTMLElement {
	const el = document.createElement('div');
	el.addClass('dashboard-section-row');
	el.dataset.column = column.name;
	const sectionType = getSectionType(column);
	el.dataset.sectionType = sectionType;

	const collapsed = getCollapsedSections();
	if (collapsed.has(column.name)) {
		el.addClass('dashboard-section-row--collapsed');
	}

	const header = el.createDiv({ cls: 'dashboard-section-header' });

	const titleWrap = header.createDiv({ cls: 'dashboard-section-title-wrap' });
	const toggle = titleWrap.createDiv({ cls: 'dashboard-section-toggle' });
	toggle.setAttribute('role', 'button');
	toggle.setAttribute('aria-label', 'Toggle section');
	const titleEl = titleWrap.createEl('h3', { text: column.name, cls: 'dashboard-section-title' });

	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const currentName = titleEl.getText();
		titleEl.empty();
		const input = titleEl.createEl('input', {
			cls: 'dashboard-section-rename-input',
			attr: { type: 'text', value: currentName },
		});
		input.focus();
		input.select();

		const finish = (save: boolean) => {
			const newName = input.value.trim();
			if (save && newName && newName !== currentName) {
				callbacks.onColumnRename(currentName, newName);
			} else {
				titleEl.empty();
				titleEl.setText(currentName);
			}
		};

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});

		input.addEventListener('blur', () => {
			finish(true);
		});
	});
	titleEl.style.cursor = 'pointer';

	toggle.addEventListener('click', (e) => {
		e.stopPropagation();
		const isNowCollapsed = el.hasClass('dashboard-section-row--collapsed');
		if (isNowCollapsed) {
			el.removeClass('dashboard-section-row--collapsed');
			collapsed.delete(column.name);
		} else {
			el.addClass('dashboard-section-row--collapsed');
			collapsed.add(column.name);
		}
		saveCollapsedSections(collapsed);
	});

		const headerActions = header.createDiv({ cls: 'dashboard-section-header-actions' });

	if (sectionType === 'todo') {
		const templateBtn = headerActions.createEl('button', {
			cls: 'dashboard-section-add-btn',
			attr: { 'aria-label': t('template.addFromTemplate') },
		});
		setIcon(templateBtn, 'layout-template');
		templateBtn.addEventListener('click', () => callbacks.onAddFromTemplate(column.name));
	}

	// Library section: render differently
	if (sectionType === 'library') {
		const configBtn = headerActions.createEl('button', {
			cls: 'dashboard-section-add-btn',
			attr: { 'aria-label': t('library.configure') },
		});
		setIcon(configBtn, 'settings');
		configBtn.addEventListener('click', () => {
			const event = new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true });
			el.dispatchEvent(event);
		});

		renderLibrarySection(el, column, app, (config) => {
			callbacks.onLibraryConfigChange(column.name, config);
		}, activeHoverParent, activeNoteOpener);
		return el;
	}

	const addCardBtn = headerActions.createEl('button', {
		cls: 'dashboard-section-add-btn',
		attr: { 'aria-label': t('renderer.addCardTo', { column: column.name }) },
	});
	setIcon(addCardBtn, 'plus');
	addCardBtn.addEventListener('click', () => callbacks.onCardAdd(column.name));

	const cardsContainer = el.createDiv({ cls: 'dashboard-section-cards' });

	for (const card of column.cards) {
		try {
			const cardEl = renderCard(card, column.name, sectionType, callbacks, app, data, settings);
			cardsContainer.appendChild(cardEl);
		} catch (err) {
			console.error('[Dashboard] renderCard error:', card.id, card.type, err);
		}
	}

	return el;
}

function renderCard(card: DashboardCard, columnName: string, sectionType: string, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): HTMLElement {
	const el = document.createElement('div');
	el.addClass('dashboard-card', `dashboard-card--${card.type}`);
	el.dataset.cardId = card.id;
	el.dataset.cardType = card.type;
	el.setAttribute('role', 'article');
	el.setAttribute('aria-label', card.title);

	if (card.color) {
		el.dataset.hasColor = 'true';
		el.style.setProperty('--db-card-accent', card.color);
	}

	const isMemo = sectionType === 'memo';
	const isTask = card.type === 'task' || sectionType === 'todo';
	const isWeather = card.type === 'weather';
	const isTracker = card.type === 'tracker';
	const isWidget = isWeather || isTracker;
	const isProjectLike = !isMemo && !isTask && !isWidget;
	const isDashboardSection = sectionType === 'dashboard';
	const showCover = isProjectLike && !isDashboardSection && sectionType !== 'notes';

	if (showCover) {
		el.addClass('dashboard-card--cover');
	}

	if (card.coverImage && showCover) {
		const resolved = resolveVaultImage(app, card.coverImage);
		if (resolved) {
			const cover = el.createDiv({ cls: 'dashboard-project-cover' });
			cover.style.backgroundImage = `url("${resolved}")`;
			cover.setAttribute('draggable', 'true');
		} else {
			const cover = el.createDiv({ cls: 'dashboard-project-cover dashboard-project-cover--default' });
			cover.setAttribute('draggable', 'true');
		}
	} else if (showCover) {
		const cover = el.createDiv({ cls: 'dashboard-project-cover dashboard-project-cover--default' });
		cover.setAttribute('draggable', 'true');
	}

	const header = el.createDiv({ cls: 'dashboard-card-header' });
	header.setAttribute('draggable', 'true');

	// Mobile: tap header to toggle card action buttons
	header.addEventListener('touchstart', () => {
		const wasActive = header.hasClass('dashboard-card-header--touched');
		document.querySelectorAll('.dashboard-card-header--touched').forEach(el => {
			el.removeClass('dashboard-card-header--touched');
		});
		if (!wasActive) {
			header.addClass('dashboard-card-header--touched');
		}
	}, { passive: true });

	const titleEl = header.createEl('h4', { text: card.title, cls: 'dashboard-card-title' });

	const skipEditBtn = isMemo || isTask || (isWidget && isDashboardSection);

	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const currentTitle = titleEl.getText();
		titleEl.empty();
		const input = titleEl.createEl('input', {
			cls: 'dashboard-title-edit-input',
			attr: { type: 'text', value: currentTitle },
		});
		input.focus();
		input.select();

		const finish = (save: boolean) => {
			const newTitle = input.value.trim();
			if (save && newTitle && newTitle !== currentTitle) {
				callbacks.onCardTitleEdit(card.id, newTitle);
			} else {
				titleEl.empty();
				titleEl.setText(currentTitle);
			}
		};

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});

		input.addEventListener('blur', () => {
			finish(true);
		});
	});
	titleEl.style.cursor = 'pointer';

	const actions = header.createDiv({ cls: 'dashboard-card-actions' });

	// Dashboard grid layout for widget cards
	if (isWidget && isDashboardSection) {
		const currentSize: CardSize = card.size || 'M';
		const sizeToGrid: Record<CardSize, { cols: number; rows: number }> = {
			S: { cols: 1, rows: 1 },
			M: { cols: 2, rows: 1 },
			L: { cols: 2, rows: 2 },
		};
		const grid = sizeToGrid[currentSize];
		el.style.gridColumn = `span ${grid.cols}`;
		el.style.gridRow = `span ${grid.rows}`;

		// Size selector button for dashboard widgets only
		const sizeBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn dashboard-card-btn--size',
			attr: { 'aria-label': 'Card size' },
		});
		sizeBtn.setText(t('widget.size' + currentSize));
		sizeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const sizes: CardSize[] = ['S', 'M', 'L'];
			const nextIdx = (sizes.indexOf(currentSize) + 1) % sizes.length;
			const nextSize = sizes[nextIdx]!;
			callbacks.onCardSizeChange(card.id, nextSize);
		});
	}

	if (isMemo && (card.type === 'generic' || card.type === 'note') || isWidget) {
		const colorBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn dashboard-card-btn--color',
			attr: { 'aria-label': t('renderer.setMemoColor') },
		});
		setIcon(colorBtn, 'palette');
		if (card.color) {
			colorBtn.style.color = card.color;
		}
		colorBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const input = document.createElement('input');
			input.type = 'color';
			input.value = card.color || '#f59e0b';
			input.style.position = 'absolute';
			input.style.opacity = '0';
			input.style.width = '0';
			input.style.height = '0';
			document.body.appendChild(input);
			input.addEventListener('input', () => {
				callbacks.onMemoColorChange(card, input.value);
			});
			input.addEventListener('change', () => {
				if (input.value) {
					callbacks.onMemoColorChange(card, input.value);
				}
				input.remove();
			});
			input.addEventListener('blur', () => {
				input.remove();
			});
			input.click();
		});
	}

	if (!skipEditBtn) {
		const editBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn',
			attr: { 'aria-label': t('renderer.editCard') },
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onCardEdit(card);
		});
	}

	if (isMemo) {
		const saveBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn',
			attr: { 'aria-label': t('renderer.saveMemoAsNote') },
		});
		setIcon(saveBtn, 'file-down');
		saveBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onMemoSaveAsNote(card);
		});
	}

	const deleteBtn = actions.createEl('button', {
		cls: 'dashboard-card-btn dashboard-card-btn--danger',
		attr: { 'aria-label': t('renderer.deleteCard') },
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onCardDelete(card.id);
	});

	const body = el.createDiv({ cls: 'dashboard-card-body' });

	// When this is a project-like card, allow dropping docs onto the card body
	if (isProjectLike) {
		body.addEventListener('dragover', (e) => {
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			body.addClass('dashboard-card-body--doc-drop');
		});

		body.addEventListener('dragleave', (e) => {
			if (!body.contains(e.relatedTarget as Node)) {
				body.removeClass('dashboard-card-body--doc-drop');
			}
		});

		body.addEventListener('drop', (e) => {
			body.removeClass('dashboard-card-body--doc-drop');
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			if (e.defaultPrevented) return;
			e.preventDefault();
			const destPath = [card.docs.length];
			callbacks.onDocMoveToCard(docDragSource.cardId, docDragSource.docPath, card.id, destPath, 'before');
		});
	}

	renderCardBody(body, card, columnName, sectionType, callbacks, app, data, settings);

	if (card.dueDate) {
		const due = el.createDiv({ cls: 'dashboard-card-due' });
		due.createSpan({ text: card.dueDate });
	}

	if (isMemo) {
		if (card.width > 0) {
			const w = Math.max(200, Math.min(600, card.width));
			el.style.flex = `0 0 ${w}px`;
			el.style.minWidth = `${w}px`;
			el.style.maxWidth = `${w}px`;
		}
	}

	// Dashboard grid layout for widget cards (styles only, button already created above)
	if (isWidget && isDashboardSection) {
		// grid styles already set above when creating the size button
	} else if (isMemo || isTask || isProjectLike) {
		const minW = 200;
		const maxW = 600;
		if (!isMemo && card.width > 0) {
			const w = Math.max(minW, Math.min(500, card.width));
			el.style.flex = `0 0 ${w}px`;
			el.style.minWidth = `${w}px`;
			el.style.maxWidth = `${w}px`;
		}
		const handle = el.createDiv({ cls: 'dashboard-card-resize-handle' });
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startWidth = el.offsetWidth;
			el.addClass('dashboard-card--resizing');

			const onMove = (ev: MouseEvent) => {
				const delta = ev.clientX - startX;
				const newWidth = Math.max(minW, Math.min(maxW, startWidth + delta));
				el.style.flex = `0 0 ${newWidth}px`;
				el.style.minWidth = `${newWidth}px`;
				el.style.maxWidth = `${newWidth}px`;
			};

			const onUp = (ev: MouseEvent) => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				el.removeClass('dashboard-card--resizing');
				const finalWidth = Math.max(minW, Math.min(maxW, startWidth + (ev.clientX - startX)));
				if (finalWidth !== card.width) {
					callbacks.onCardWidthChange(card.id, finalWidth);
				}
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	return el;
}

function renderCardBody(container: HTMLElement, card: DashboardCard, columnName: string, sectionType: string, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): void {
	if (card.type === 'weather') {
		renderWeatherBody(container, card, app);
		return;
	}

	if (card.type === 'tracker') {
		renderTrackerBody(container, card, app, settings);
		return;
	}

	const isMemo = sectionType === 'memo';
	const isTaskCard = card.type === 'task' || sectionType === 'todo';

	if (isTaskCard) {
		renderTaskBody(container, card, callbacks, app);
		return;
	}

	if (isMemo) {
		renderMemoBody(container, card, callbacks, app);
		return;
	}

	// All non-memo, non-task cards render as project body
	renderProjectBody(container, card, callbacks, app);
}

function renderTaskItem(
	list: HTMLElement,
	task: TaskItem,
	path: number[],
	card: DashboardCard,
	callbacks: RenderCallbacks,
	app: App,
	depth: number,
): void {
	const item = list.createDiv({ cls: 'dashboard-task-item' });
	if (depth > 0) item.addClass('dashboard-task-item--child');
	item.style.marginLeft = `${depth * 18}px`;
	item.setAttribute('draggable', 'true');
	item.dataset.taskPath = JSON.stringify(path);
	item.dataset.cardId = card.id;

	const clearDragClasses = () => {
		item.removeClass('dashboard-task-item--drag-top');
		item.removeClass('dashboard-task-item--drag-bottom');
		item.removeClass('dashboard-task-item--drag-nest');
	};

	// Mobile gestures: tap (show buttons), long-press (drag), quick-swipe (nest/unnest)
	let touchState: {
		startX: number;
		startY: number;
		startT: number;
		moved: boolean;
		dragging: boolean;
		timer: number | null;
	} | null = null;

	item.addEventListener('touchstart', (e) => {
		const tch = e.touches[0];
		if (!tch) return;
		touchState = {
			startX: tch.clientX,
			startY: tch.clientY,
			startT: Date.now(),
			moved: false,
			dragging: false,
			timer: null,
		};
		touchState.timer = window.setTimeout(() => {
			if (touchState && !touchState.moved) {
				touchState.dragging = true;
				item.addClass('dashboard-task-item--dragging');
			}
		}, 500);
	}, { passive: true });

	item.addEventListener('touchmove', (e) => {
		if (!touchState) return;
		const tch = e.touches[0];
		if (!tch) return;
		const dx = tch.clientX - touchState.startX;
		const dy = tch.clientY - touchState.startY;
		if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
			touchState.moved = true;
			if (touchState.timer) {
				clearTimeout(touchState.timer);
				touchState.timer = null;
			}
		}
		if (!touchState.dragging && touchState.moved && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
			item.style.transform = `translateX(${Math.max(-40, Math.min(40, dx * 0.5))}px)`;
		}
	}, { passive: true });

	item.addEventListener('touchend', (e) => {
		const ts = touchState;
		touchState = null;
		item.style.transform = '';
		if (!ts) return;
		if (ts.timer) clearTimeout(ts.timer);
		if (ts.dragging) {
			item.removeClass('dashboard-task-item--dragging');
			return;
		}
		const tch = e.changedTouches[0];
		const dx = tch ? tch.clientX - ts.startX : 0;
		const dy = tch ? tch.clientY - ts.startY : 0;
		const dt = Date.now() - ts.startT;
		const isSwipe = dt < 500 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5;
		if (isSwipe) {
			if (dx > 0) callbacks.onTaskNest(card.id, path);
			else callbacks.onTaskUnnest(card.id, path);
			return;
		}
		if (!ts.moved) {
			const wasActive = item.hasClass('dashboard-task-item--touched');
			document.querySelectorAll('.dashboard-task-item--touched').forEach(el => {
				el.removeClass('dashboard-task-item--touched');
			});
			if (!wasActive) item.addClass('dashboard-task-item--touched');
		}
	}, { passive: true });

	item.addEventListener('touchcancel', () => {
		if (touchState?.timer) clearTimeout(touchState.timer);
		touchState = null;
		item.style.transform = '';
		item.removeClass('dashboard-task-item--dragging');
	}, { passive: true });

	const hasChildren = (task.children?.length ?? 0) > 0;
	if (hasChildren) {
		const toggle = item.createDiv({ cls: 'dashboard-task-toggle dashboard-task-toggle--active' });
		toggle.setAttribute('role', 'button');
		toggle.setAttribute('aria-label', task.collapsed ? t('renderer.expandTask') : t('renderer.collapseTask'));
		setIcon(toggle, task.collapsed ? 'chevron-right' : 'chevron-down');
		toggle.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onTaskToggleCollapse(card.id, path);
		});
	}

	const checkbox = item.createEl('input', {
		cls: 'dashboard-task-checkbox',
		attr: { type: 'checkbox' },
	});
	checkbox.checked = task.checked;
	checkbox.addEventListener('change', () => {
		callbacks.onCheckboxToggle(card.id, path, checkbox.checked);
	});

	const label = item.createSpan({
		cls: task.checked ? 'dashboard-task-text dashboard-task-text--done' : 'dashboard-task-text',
	});
	renderTextWithLinks(label, task.text, app);
	label.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const currentText = label.getText();
		label.empty();
		item.setAttribute('draggable', 'false');

		const textarea = label.createEl('textarea', {
			cls: 'dashboard-task-edit-textarea',
			text: task.text,
		});

		const autoResize = () => {
			textarea.style.height = 'auto';
			textarea.style.height = textarea.scrollHeight + 'px';
		};
		autoResize();
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);

		const finish = (save: boolean) => {
			const newText = textarea.value.trim();
			if (save && newText && newText !== task.text) {
				callbacks.onTaskEdit(card.id, path, newText);
			} else {
				label.empty();
				label.setText(currentText);
			}
			item.setAttribute('draggable', 'true');
		};

		textarea.addEventListener('input', autoResize);
		textarea.addEventListener('keydown', (ke) => {
			if (ke.key === 'Enter' && !ke.shiftKey) {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});
		textarea.addEventListener('blur', () => finish(true));
	});

	const delBtn = item.createEl('button', {
		cls: 'dashboard-task-delete',
		attr: { 'aria-label': t('renderer.deleteTask') },
	});
	setIcon(delBtn, 'x');
	delBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onTaskDelete(card.id, path);
	});

	const reminderBtn = createReminderButton(item, card.id, path, task, callbacks);
	item.appendChild(reminderBtn);

	item.addEventListener('dragstart', (e) => {
		e.stopPropagation();
		taskDragSource = { cardId: card.id, taskPath: path };
		item.addClass('dashboard-task-item--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', JSON.stringify(path));
		}
	});

	item.addEventListener('dragend', () => {
		item.removeClass('dashboard-task-item--dragging');
		document.querySelectorAll(
			'.dashboard-task-item--drag-top,.dashboard-task-item--drag-bottom,.dashboard-task-item--drag-nest'
		).forEach(el => el.removeClass('dashboard-task-item--drag-top', 'dashboard-task-item--drag-bottom', 'dashboard-task-item--drag-nest'));
		taskDragSource = null;
	});

	item.addEventListener('dragover', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (!taskDragSource) return;
		const sameNode = taskDragSource.cardId === card.id &&
			JSON.stringify(taskDragSource.taskPath) === JSON.stringify(path);
		if (sameNode) return;
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		document.querySelectorAll(
			'.dashboard-task-item--drag-top,.dashboard-task-item--drag-bottom,.dashboard-task-item--drag-nest'
		).forEach(el => el.removeClass('dashboard-task-item--drag-top', 'dashboard-task-item--drag-bottom', 'dashboard-task-item--drag-nest'));
		const rect = item.getBoundingClientRect();
		const ratio = (e.clientY - rect.top) / rect.height;
		if (ratio < 0.3) item.addClass('dashboard-task-item--drag-top');
		else if (ratio > 0.7) item.addClass('dashboard-task-item--drag-bottom');
		else item.addClass('dashboard-task-item--drag-nest');
	});

	item.addEventListener('dragleave', () => {
		clearDragClasses();
	});

	item.addEventListener('drop', (e) => {
		e.preventDefault();
		e.stopPropagation();
		clearDragClasses();
		if (!taskDragSource) return;
		const sameNode = taskDragSource.cardId === card.id &&
			JSON.stringify(taskDragSource.taskPath) === JSON.stringify(path);
		if (sameNode) return;

		const rect = item.getBoundingClientRect();
		const ratio = (e.clientY - rect.top) / rect.height;
		const src = taskDragSource;

		if (src.cardId === card.id) {
			if (ratio < 0.3) callbacks.onTaskReorder(card.id, src.taskPath, path, true);
			else if (ratio > 0.7) callbacks.onTaskReorder(card.id, src.taskPath, path, false);
			else callbacks.onTaskNest(card.id, src.taskPath);
		} else {
			const mode: 'before' | 'after' | 'nest' = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'nest';
			callbacks.onTaskMoveToCard(src.cardId, src.taskPath, card.id, path, mode);
		}
	});

	if (task.children && task.children.length > 0 && !task.collapsed) {
		for (let i = 0; i < task.children.length; i++) {
			renderTaskItem(list, task.children[i]!, [...path, i], card, callbacks, app, depth + 1);
		}
	}
}

function renderTaskBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
	const list = container.createDiv({ cls: 'dashboard-task-list' });
	list.dataset.cardId = card.id;

	// When the list is empty, make it a drop target so tasks can be dragged in
	list.addEventListener('dragover', (e) => {
		if (!taskDragSource) return;
		if (taskDragSource.cardId === card.id) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		list.addClass('dashboard-task-list--drop-target');
	});

	list.addEventListener('dragleave', (e) => {
		if (!list.contains(e.relatedTarget as Node)) {
			list.removeClass('dashboard-task-list--drop-target');
		}
	});

	list.addEventListener('drop', (e) => {
		e.preventDefault();
		list.removeClass('dashboard-task-list--drop-target');
		if (!taskDragSource) return;
		if (taskDragSource.cardId === card.id) return;
		callbacks.onTaskMoveToCard(taskDragSource.cardId, taskDragSource.taskPath, card.id, [card.tasks.length], 'before');
	});

	card.tasks.forEach((task, i) => renderTaskItem(list, task, [i], card, callbacks, app, 0));

	const addRow = container.createDiv({ cls: 'dashboard-task-add' });
	const input = addRow.createEl('input', {
		cls: 'dashboard-task-input',
		attr: { type: 'text', placeholder: t('renderer.addTask') },
	});
	const taskSuggest = attachFileSuggest(input, app);
	input.addEventListener('keydown', (e) => {
		if (taskSuggest.isActive()) return;
		if (e.key === 'Enter' && input.value.trim()) {
			callbacks.onTaskAdd(card.id, input.value.trim());
			input.value = '';
		}
	});

	if (card.tasks.length > 0) {
		const checkedCount = card.tasks.filter(t => t.checked).length;
		const total = card.tasks.length;
		const percent = Math.round((checkedCount / total) * 100);

		const progressWrap = container.createDiv({ cls: 'dashboard-progress' });
		const bar = progressWrap.createDiv({ cls: 'dashboard-progress-bar' });
		bar.createDiv({
			cls: 'dashboard-progress-fill',
			attr: { style: `width: ${percent}%` },
		});
		progressWrap.createSpan({
			cls: 'dashboard-progress-text',
			text: `${percent}%`,
		});
	}
}

function renderMemoBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
	const text = [card.blockquote, card.body].filter(Boolean).join('\n');
	let dirty = false;

	// View mode: rendered text with clickable links
	const view = container.createDiv({ cls: 'dashboard-memo-view' });
	renderMemoViewContent(view, text, app);
	view.addEventListener('click', () => {
		view.style.display = 'none';
		textarea.style.display = '';
		textarea.focus();
	});

	// Edit mode: textarea (hidden by default)
	const textarea = container.createEl('textarea', {
		cls: 'dashboard-memo-textarea',
		text: text,
		attr: { placeholder: t('renderer.writeThoughts') },
	});
	textarea.style.display = 'none';

	attachFileSuggest(textarea, app);

	textarea.addEventListener('input', () => {
		dirty = true;
	});

	const save = () => {
		if (!dirty) return;
		dirty = false;
		const value = textarea.value;
		const lines = value.split('\n');
		const quoteLines: string[] = [];
		const bodyLines: string[] = [];

		for (const line of lines) {
			if (line.startsWith('> ')) {
				quoteLines.push(line.slice(2));
			} else {
				bodyLines.push(line);
			}
		}

		callbacks.onMemoUpdate(card, {
			body: bodyLines.join('\n').trim(),
			blockquote: quoteLines.join('\n'),
		});
	};

	textarea.addEventListener('blur', () => {
		save();
		// If re-render didn't happen (not dirty), switch to view manually
		if (document.body.contains(view)) {
			renderMemoViewContent(view, textarea.value, app);
			view.style.display = '';
			textarea.style.display = 'none';
		}
	});
}

function renderMemoViewContent(container: HTMLElement, text: string, app: App): void {
	container.empty();
	if (!text) {
		container.addClass('dashboard-memo-view--empty');
		container.setText(t('renderer.writeThoughts'));
		return;
	}
	container.removeClass('dashboard-memo-view--empty');

	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (i > 0) container.createEl('br');
		const line = lines[i]!;
		if (line.startsWith('> ')) {
			const quote = container.createDiv({ cls: 'dashboard-note-quote' });
			quote.setText(line.slice(2));
		} else {
			renderTextWithLinks(container, line, app);
		}
	}
}

function renderNoteBody(container: HTMLElement, card: DashboardCard): void {
	if (card.blockquote) {
		const quote = container.createDiv({ cls: 'dashboard-note-quote' });
		quote.setText(card.blockquote);
	}
	if (card.body) {
		container.createDiv({ cls: 'dashboard-note-body', text: card.body });
	}
}

function renderLinkBody(container: HTMLElement, card: DashboardCard): void {
	const link = container.createEl('a', {
		cls: 'dashboard-link-url',
		attr: { href: card.url, target: '_blank', rel: 'noopener' },
		text: card.url,
	});
	if (card.body) {
		container.createDiv({ cls: 'dashboard-link-desc', text: card.body });
	}
}

	function renderProjectBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
		const collectDocPaths = (docs: DocNode[]): string[] => {
			const out: string[] = [];
			const walk = (nodes: DocNode[]) => {
				for (const n of nodes) {
					out.push(n.path);
					if (n.children) walk(n.children);
				}
			};
			walk(docs);
			return out;
		};

		const clearDragClasses = () => {
			document.querySelectorAll(
				'.dashboard-task-item--drag-top,.dashboard-task-item--drag-bottom,.dashboard-task-item--drag-nest,.dashboard-task-item--drag-over,.dashboard-task-item--dragging'
			).forEach(el => {
				(el as HTMLElement).removeClass(
					'dashboard-task-item--drag-top',
					'dashboard-task-item--drag-bottom',
					'dashboard-task-item--drag-nest',
					'dashboard-task-item--drag-over',
					'dashboard-task-item--dragging',
				);
			});
		};

		const docList = container.createDiv({ cls: 'dashboard-project-docs' });
		docList.dataset.cardId = card.id;

		// Empty list drop target so docs can be dragged in (appends at top-level end)
		docList.addEventListener('dragover', (e) => {
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			docList.addClass('dashboard-project-docs--drop-target');
		});

		docList.addEventListener('dragleave', (e) => {
			if (!docList.contains(e.relatedTarget as Node)) {
				docList.removeClass('dashboard-project-docs--drop-target');
			}
		});

		docList.addEventListener('drop', (e) => {
			e.preventDefault();
			docList.removeClass('dashboard-project-docs--drop-target');
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			const destPath = [card.docs.length];
			callbacks.onDocMoveToCard(docDragSource.cardId, docDragSource.docPath, card.id, destPath, 'before');
		});

		const renderDocItem = (doc: DocNode, path: number[], depth: number) => {
			const docItem = docList.createDiv({ cls: 'dashboard-project-doc-item' });
			if (depth > 0) docItem.addClass('dashboard-project-doc-item--child');
			docItem.style.marginLeft = `${depth * 18}px`;
			docItem.setAttribute('draggable', 'true');
			docItem.dataset.docPath = JSON.stringify(path);

			const hasChildren = (doc.children?.length ?? 0) > 0;
			if (hasChildren) {
				const toggle = docItem.createDiv({ cls: 'dashboard-task-toggle dashboard-task-toggle--active' });
				toggle.setAttribute('role', 'button');
				toggle.setAttribute('aria-label', doc.collapsed ? t('renderer.expandDoc') : t('renderer.collapseDoc'));
				setIcon(toggle, doc.collapsed ? 'chevron-right' : 'chevron-down');
				toggle.addEventListener('click', (e) => {
					e.stopPropagation();
					callbacks.onDocToggleCollapse(card.id, path);
				});
			}

			const resolved = resolveNoteFile(app, doc.path);
			docItem.createSpan({ text: resolved?.basename ?? doc.path.split('/').pop() ?? doc.path, cls: 'dashboard-project-doc-name' });

			if (resolved && !Platform.isMobile && activeHoverParent) {
				attachNoteHover(app, docItem, resolved, activeHoverParent);
			}

			const removeBtn = docItem.createEl('button', {
				cls: 'dashboard-project-doc-remove',
				attr: { 'aria-label': t('renderer.removeDoc') },
			});
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const confirmed = await showConfirmDialog(app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				});
				if (!confirmed) return;
				callbacks.onDocDelete(card.id, path);
			});

			docItem.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName === 'BUTTON') return;
				if (!resolved) return;
				if (Platform.isMobile) {
					void app.workspace.getLeaf(false).openFile(resolved);
				} else {
					activeNoteOpener?.(resolved);
				}
			});

			docItem.addEventListener('dragstart', (e) => {
				e.stopPropagation();
				docDragSource = { cardId: card.id, docPath: path };
				docItem.addClass('dashboard-task-item--dragging');
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', JSON.stringify(path));
				}
			});

			docItem.addEventListener('dragend', () => {
				docItem.removeClass('dashboard-task-item--dragging');
				clearDragClasses();
				docDragSource = null;
			});

			docItem.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (!docDragSource) return;
				const sameNode = docDragSource.cardId === card.id &&
					JSON.stringify(docDragSource.docPath) === JSON.stringify(path);
				if (sameNode) return;
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				clearDragClasses();
				const rect = docItem.getBoundingClientRect();
				const ratio = (e.clientY - rect.top) / rect.height;
				if (ratio < 0.3) docItem.addClass('dashboard-task-item--drag-top');
				else if (ratio > 0.7) docItem.addClass('dashboard-task-item--drag-bottom');
				else docItem.addClass('dashboard-task-item--drag-nest');
			});

			docItem.addEventListener('dragleave', () => {
				docItem.removeClass('dashboard-task-item--drag-top');
				docItem.removeClass('dashboard-task-item--drag-bottom');
				docItem.removeClass('dashboard-task-item--drag-nest');
			});

			docItem.addEventListener('drop', (e) => {
				e.preventDefault();
				e.stopPropagation();
				clearDragClasses();
				if (!docDragSource) return;
				const sameNode = docDragSource.cardId === card.id &&
					JSON.stringify(docDragSource.docPath) === JSON.stringify(path);
				if (sameNode) return;

				const rect = docItem.getBoundingClientRect();
				const ratio = (e.clientY - rect.top) / rect.height;
				const src = docDragSource;

				if (src.cardId === card.id) {
					if (ratio < 0.3) callbacks.onDocReorder(card.id, src.docPath, path, true);
					else if (ratio > 0.7) callbacks.onDocReorder(card.id, src.docPath, path, false);
					else callbacks.onDocNest(card.id, src.docPath);
				} else {
					const mode: 'before' | 'after' | 'nest' = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'nest';
					callbacks.onDocMoveToCard(src.cardId, src.docPath, card.id, path, mode);
				}
			});

			if (hasChildren && !doc.collapsed) {
				doc.children!.forEach((child, i) => renderDocItem(child, [...path, i], depth + 1));
			}
		};

		card.docs.forEach((doc, i) => renderDocItem(doc, [i], 0));

		const addDocRow = container.createDiv({ cls: 'dashboard-project-add-doc' });
		const docInput = addDocRow.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('renderer.addDocument') },
		});

		const docResults = addDocRow.createDiv({ cls: 'dashboard-project-doc-results' });

		docInput.addEventListener('input', () => {
			docResults.empty();
			const q = docInput.value.toLowerCase().trim();
			if (!q) return;

			const currentPaths = collectDocPaths(card.docs);
			const files = getSearchableFiles(app)
				.filter(f => !f.path.startsWith('.'))
				.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
				.filter(f => !currentPaths.includes(f.path))
				.slice(0, 50);

			for (const file of files) {
				const item = docResults.createDiv({ cls: 'dashboard-project-doc-result' });
				item.setText(file.basename);
				item.addEventListener('click', () => {
					callbacks.onDocAdd(card.id, file.path);
				});
			}
		});

		docInput.addEventListener('blur', () => {
			setTimeout(() => docResults.empty(), 200);
		});
	}

function renderHabitBody(container: HTMLElement, card: DashboardCard): void {
	const streakEl = container.createDiv({ cls: 'dashboard-habit-streak' });
	streakEl.createSpan({ cls: 'dashboard-habit-icon', text: '🔥' });
	streakEl.createSpan({ text: t('renderer.dayStreak', { count: card.streak }) });

	if (card.body) {
		container.createDiv({ cls: 'dashboard-habit-body', text: card.body });
	}
}

function getSectionType(column: DashboardColumn): string {
	if (column.sectionType) return column.sectionType;
	const lower = column.name.toLowerCase();
	if (lower === 'memo') return 'memo';
	if (lower === 'todo') return 'todo';
	if (lower === 'projects') return 'projects';
	if (lower === 'notes') return 'notes';
	if (lower === 'dashboard') return 'dashboard';
	if (lower === 'library') return 'library';
	if (column.cards.length > 0) {
		const types = new Set(column.cards.map(c => c.type));
		const dashboardTypes = new Set(['chart', 'weather', 'tracker']);
		if ([...types].every(t => dashboardTypes.has(t)) && types.size > 0) return 'dashboard';
		if (types.has('task') && types.size === 1) return 'todo';
		if (types.has('task') && !types.has('project')) return 'todo';
		if (types.has('project') && types.size === 1) return 'projects';
		if (types.has('generic') && !types.has('project') && !types.has('task')) return 'memo';
	}
	return 'projects';
}

function renderTextWithLinks(container: HTMLElement, text: string, app: App): void {
	const parts = text.split(/(\[\[[^\]]+?\]\]|\[[^\]]+\]\([^)]+\))/g);
	for (const part of parts) {
		const wikiMatch = part.match(/^\[\[([^\]]+)\]\]$/);
		if (wikiMatch) {
			renderWikilink(container, wikiMatch[1]!, app);
			continue;
		}
		const extMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
		if (extMatch) {
			renderExternalLink(container, extMatch[1]!, extMatch[2]!);
			continue;
		}
		if (part) {
			container.appendChild(document.createTextNode(part));
		}
	}
}

function renderWikilink(container: HTMLElement, content: string, app: App): void {
	let alias: string | undefined;
	let linkPart = content;

	const pipeIdx = content.indexOf('|');
	if (pipeIdx !== -1) {
		alias = content.slice(pipeIdx + 1);
		linkPart = content.slice(0, pipeIdx);
	}

	let path = linkPart;
	let fragment: string | undefined;

	const hashIdx = linkPart.indexOf('#');
	if (hashIdx !== -1) {
		path = linkPart.slice(0, hashIdx);
		fragment = linkPart.slice(hashIdx + 1);
	}

	const noteName = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	let displayName: string;
	if (alias) {
		displayName = alias;
	} else if (fragment) {
		displayName = `${noteName} > ${fragment}`;
	} else {
		displayName = noteName;
	}

	const link = container.createSpan({
		cls: 'dashboard-wikilink',
		text: displayName,
	});

	const file = resolveNoteFile(app, path);

	if (file && !Platform.isMobile && activeHoverParent) {
		attachNoteHover(app, link, file, activeHoverParent);
	}

	link.addEventListener('click', (e) => {
		e.stopPropagation();
		if (!file) return;
		if (Platform.isMobile) {
			void app.workspace.getLeaf(false).openFile(file, {
				eState: fragment ? { line: 0 } : undefined,
			});
		} else {
			activeNoteOpener?.(file);
		}
	});
}

function renderExternalLink(container: HTMLElement, text: string, url: string): void {
	const link = container.createSpan({
		cls: 'dashboard-external-link',
		text: text,
	});
	link.addEventListener('click', (e) => {
		e.stopPropagation();
		window.open(url, '_blank');
	});
}

function isReminderOverdue(reminder: string): boolean {
	const now = new Date();
	const parts = reminder.trim().split(/\s+/);
	if (parts.length < 2) return false;
	const dateStr = parts[0]!;
	const timeStr = parts[1]!;
	const [year, month, day] = dateStr.split('-').map(Number);
	const [hour, min] = timeStr.split(':').map(Number);
	if (!year || !month || !day) return false;
	const due = new Date(year, month - 1, day, hour ?? 0, min ?? 0);
	return now >= due;
}

function createReminderButton(
	taskItem: HTMLElement,
	cardId: string,
	taskPath: number[],
	task: TaskItem,
	callbacks: RenderCallbacks,
): HTMLElement {
	const btn = document.createElement('button');
	btn.setAttribute('draggable', 'false');
	btn.addClass('dashboard-task-reminder-btn');

	if (task.reminder) {
		btn.addClass('dashboard-task-reminder-btn--active');
		setIcon(btn, 'bell-ring');
		btn.setAttribute('aria-label', t('reminder.editReminder'));
		if (!task.checked && isReminderOverdue(task.reminder)) {
			btn.addClass('dashboard-task-reminder-btn--overdue');
		}
	} else {
		setIcon(btn, 'bell');
		btn.setAttribute('aria-label', t('reminder.setReminder'));
	}

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		showReminderPopup(btn, cardId, taskPath, task, callbacks);
	});

	return btn;
}

function showReminderPopup(
	anchorBtn: HTMLElement,
	cardId: string,
	taskPath: number[],
	task: TaskItem,
	callbacks: RenderCallbacks,
): void {
	closeAllReminderPopups();

	const popup = document.body.createDiv({ cls: 'dashboard-task-reminder-popup' });

	// Inherit theme variables from dashboard root (popup is on body, outside theme scope)
	const dashboardRoot = anchorBtn.closest('.apex-dashboard-root') as HTMLElement;
	if (dashboardRoot) {
		const rs = getComputedStyle(dashboardRoot);
		const themeVars = ['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
			'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font'];
		themeVars.forEach(v => {
			const val = rs.getPropertyValue(v).trim();
			if (val) popup.style.setProperty(v, val);
		});
	}

	const rect = anchorBtn.getBoundingClientRect();
	popup.style.position = 'fixed';
	popup.style.top = `${rect.bottom + 4}px`;

	const popupWidth = 240;
	if (rect.left + popupWidth > window.innerWidth) {
		popup.style.right = `${window.innerWidth - rect.right}px`;
	} else {
		popup.style.left = `${rect.left}px`;
	}

	// Scroll & resize tracking — reposition popup when content moves
	const updatePopupPosition = () => {
		const r = anchorBtn.getBoundingClientRect();
		if (r.height === 0 || r.bottom < 0 || r.top > window.innerHeight
			|| r.right < 0 || r.left > window.innerWidth) {
			closeAllReminderPopups();
			return;
		}
		popup.style.top = `${r.bottom + 4}px`;
		if (r.left + popupWidth > window.innerWidth) {
			popup.style.right = `${window.innerWidth - r.right}px`;
			popup.style.left = 'auto';
		} else {
			popup.style.left = `${r.left}px`;
			popup.style.right = 'auto';
		}
	};
	document.addEventListener('scroll', updatePopupPosition, { passive: true, capture: true });
	window.addEventListener('resize', updatePopupPosition);
	(popup as any).__reminderCleanup = () => {
		document.removeEventListener('scroll', updatePopupPosition, { capture: true });
		window.removeEventListener('resize', updatePopupPosition);
	};

	// Parse initial values
	let selectedYear: number;
	let selectedMonth: number;
	let selectedDay: number;
	let selectedHour = 9;
	let selectedMin = 0;

	const now = new Date();
	if (task.reminder) {
		const parts = task.reminder.trim().split(/\s+/);
		const dp = parts[0]?.split('-').map(Number) ?? [];
		const tp = parts[1]?.split(':').map(Number) ?? [];
		selectedYear = dp[0] ?? now.getFullYear();
		selectedMonth = (dp[1] ?? now.getMonth() + 1) - 1;
		selectedDay = dp[2] ?? now.getDate();
		selectedHour = tp[0] ?? 9;
		selectedMin = tp[1] ?? 0;
	} else {
		selectedYear = now.getFullYear();
		selectedMonth = now.getMonth();
		selectedDay = now.getDate();
	}

	const viewYear = { value: selectedYear };
	const viewMonth = { value: selectedMonth };

	const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	// Calendar nav
	const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
	const prevBtn = calNav.createEl('button', { text: '<' });
	const monthLabel = calNav.createEl('span');
	const nextBtn = calNav.createEl('button', { text: '>' });

	// Calendar grid
	const calGrid = popup.createDiv({ cls: 'dashboard-task-reminder-calendar' });

	// Time picker
	const timeRow = popup.createDiv({ cls: 'dashboard-task-reminder-time' });
	const hourSelect = timeRow.createEl('select');
	for (let h = 0; h < 24; h++) {
		const opt = hourSelect.createEl('option', { text: String(h).padStart(2, '0'), attr: { value: String(h) } });
		if (h === selectedHour) opt.selected = true;
	}
	timeRow.createSpan({ text: ':' });
	const minSelect = timeRow.createEl('select');
	for (let m = 0; m < 60; m++) {
		const opt = minSelect.createEl('option', { text: String(m).padStart(2, '0'), attr: { value: String(m) } });
		if (m === selectedMin) opt.selected = true;
	}

	// Action buttons
	const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
	const saveBtn = btnRow.createEl('button', { cls: 'mod-cta', text: t('common.save') });
	if (task.reminder) {
		btnRow.createEl('button', { cls: 'dashboard-task-reminder-clear', text: t('reminder.clearReminder') });
	}

	const renderCalendar = () => {
		calGrid.empty();
		const y = viewYear.value;
		const m = viewMonth.value;
		monthLabel.setText(`${y}-${String(m + 1).padStart(2, '0')}`);

		for (const d of dayNames) {
			calGrid.createDiv({ cls: 'dashboard-task-reminder-calendar-header', text: d });
		}

		const firstDay = new Date(y, m, 1).getDay();
		const daysInMonth = new Date(y, m + 1, 0).getDate();
		const daysInPrev = new Date(y, m, 0).getDate();

		const today = new Date();
		const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

		for (let i = firstDay - 1; i >= 0; i--) {
			const d = daysInPrev - i;
			calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
		}

		for (let d = 1; d <= daysInMonth; d++) {
			const cls = ['dashboard-task-reminder-calendar-day'];
			if (isCurrentMonth && d === today.getDate()) cls.push('dashboard-task-reminder-calendar-day--today');
			if (y === selectedYear && m === selectedMonth && d === selectedDay) cls.push('dashboard-task-reminder-calendar-day--selected');

			const dayBtn = calGrid.createEl('button', { cls: cls.join(' '), text: String(d) });
			dayBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				selectedYear = y;
				selectedMonth = m;
				selectedDay = d;
				renderCalendar();
			});
		}

		const totalCells = firstDay + daysInMonth;
		const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
		for (let d = 1; d <= remaining; d++) {
			calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
		}
	};

	prevBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		viewMonth.value--;
		if (viewMonth.value < 0) { viewMonth.value = 11; viewYear.value--; }
		renderCalendar();
	});

	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		viewMonth.value++;
		if (viewMonth.value > 11) { viewMonth.value = 0; viewYear.value++; }
		renderCalendar();
	});

	saveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const h = parseInt(hourSelect.value, 10);
		const m = parseInt(minSelect.value, 10);
		const reminder = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		callbacks.onTaskReminderEdit(cardId, taskPath, reminder);
		closeAllReminderPopups();
	});

	btnRow.querySelector('.dashboard-task-reminder-clear')?.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onTaskReminderEdit(cardId, taskPath, undefined);
		closeAllReminderPopups();
	});

	const outsideClick = (ev: MouseEvent) => {
		if (!popup.contains(ev.target as Node)) {
			closeAllReminderPopups();
			document.removeEventListener('mousedown', outsideClick);
		}
	};
	setTimeout(() => document.addEventListener('mousedown', outsideClick), 0);

	renderCalendar();
}

function closeAllReminderPopups(): void {
	document.querySelectorAll('.dashboard-task-reminder-popup').forEach(el => {
		const popup = el as HTMLElement & { __reminderCleanup?: () => void };
		popup.__reminderCleanup?.();
		popup.remove();
	});
}


function renderWeatherBody(container: HTMLElement, card: DashboardCard, app: App): void {
	if (!card.weatherConfig) return;

	const el = container.createDiv({ cls: 'dashboard-weather' });

	const cached = getCachedWeather(card.weatherConfig);
	if (cached) {
		renderWeatherContent(el, cached, card.weatherConfig.cityName);
	} else {
		el.createDiv({ cls: 'dashboard-weather-loading', text: '...' });
		fetchWeather(card.weatherConfig).then(data => {
			el.empty();
			renderWeatherContent(el, data, card.weatherConfig!.cityName);
		}).catch(() => {
			el.empty();
			el.createDiv({ cls: 'dashboard-weather-error', text: t('weather.fetchError') });
		});
	}
}

function renderWeatherContent(el: HTMLElement, data: import('./types').WeatherData, cityName: string): void {
	const current = el.createDiv({ cls: 'dashboard-weather-current' });
	const tempWrap = current.createDiv({ cls: 'dashboard-weather-temp-wrap' });
	tempWrap.createDiv({ cls: 'dashboard-weather-temp', text: `${Math.round(data.temperature)}\u00B0` });
	tempWrap.createDiv({ cls: 'dashboard-weather-icon', text: getWeatherEmoji(data.weatherCode) });

	const details = current.createDiv({ cls: 'dashboard-weather-details' });
	details.createDiv({ cls: 'dashboard-weather-city', text: cityName });
	details.createDiv({ cls: 'dashboard-weather-desc', text: getWeatherDescription(data.weatherCode) });
	const metaLine = details.createDiv({ cls: 'dashboard-weather-wind' });
	metaLine.createSpan({ text: `${t('weather.feelsLike')} ${Math.round(data.feelsLike)}\u00B0  ${t('weather.humidity')} ${Math.round(data.humidity)}%  ${t('weather.wind')} ${Math.round(data.windSpeed)} km/h` });

	if (data.dailyDates.length > 0) {
		const forecast = el.createDiv({ cls: 'dashboard-weather-forecast' });
		const count = Math.min(data.dailyDates.length, 5);
		for (let i = 0; i < count; i++) {
			const day = forecast.createDiv({ cls: 'dashboard-weather-day' });
			const d = new Date(data.dailyDates[i]! + 'T00:00:00');
			const dayName = d.toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short' });
			day.createDiv({ cls: 'dashboard-weather-day-name', text: dayName });
			day.createDiv({ cls: 'dashboard-weather-day-icon', text: getWeatherEmoji(data.dailyCodes[i]!) });
			day.createDiv({ cls: 'dashboard-weather-day-temps', text: `${Math.round(data.dailyMax[i]!)}\u00B0 / ${Math.round(data.dailyMin[i]!)}\u00B0` });
		}
	}
}

function renderTrackerBody(container: HTMLElement, card: DashboardCard, app: App, settings?: import('./types').DashboardSettings): void {
	if (!card.trackerConfig) return;

	const config = card.trackerConfig;
		const size: CardSize = card.size || 'M';
	const style: TrackerStyle = config.style || 'line';
	destroyChart(card.id);

	const el = container.createDiv({ cls: `dashboard-tracker dashboard-tracker--${size}` });

	const data = readTrackerData(app, '', config.key, config.days);
	const validPoints = data.filter(p => p.value !== null);

	if (validPoints.length === 0) {
		el.createDiv({ cls: 'dashboard-tracker-empty', text: t('tracker.noData') + ': ' + config.key });
		return;
	}

	const values = data.map(p => p.value);
	const minVal = Math.min(...values.filter((v): v is number => v !== null));
	const maxVal = Math.max(...values.filter((v): v is number => v !== null));
	const sum = validPoints.reduce((s, p) => s + p.value!, 0);
	const avg = (sum / validPoints.length).toFixed(1);
	const latest = validPoints[validPoints.length - 1]!.value as number;
	const prev = validPoints.length > 1 ? validPoints[validPoints.length - 2]!.value as number : latest;
	const trendDir = latest > prev ? 'up' : latest < prev ? 'down' : 'flat';
	const trendPct = prev !== 0 ? ((latest - prev) / Math.abs(prev) * 100).toFixed(1) : '0';

	// Streak: consecutive days with data (from latest backward, today optional)
	const streak = computeStreak(data);

	if (size === 'S') {
		const row = el.createDiv({ cls: 'dashboard-tracker-compact' });
		row.createDiv({ cls: 'dashboard-tracker-compact-value', text: String(latest) });
		const arrow = row.createDiv({ cls: `dashboard-tracker-trend dashboard-tracker-trend--${trendDir}` });
		arrow.setText(trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→');
		if (config.key) {
			row.createDiv({ cls: 'dashboard-tracker-compact-label', text: config.key });
		}
		return;
	}

	const accentColor = getCSSVar('--db-accent') || '#6366f1';

	// Dispatch by style
	if (style === 'heatmap') {
		renderTrackerHeatmap(el, data, minVal, maxVal, size, accentColor);
	} else if (style === 'bar') {
		renderTrackerBarChart(el, data, size, accentColor, card.id);
	} else {
		renderTrackerLineChart(el, data, size, accentColor, card.id);
	}

	// Stats
	const stats = el.createDiv({ cls: 'dashboard-tracker-stats' });
	const addStat = (label: string, value: string | number) => {
		const stat = stats.createDiv({ cls: 'dashboard-tracker-stat' });
		stat.createSpan({ cls: 'dashboard-tracker-stat-label', text: label });
		stat.createSpan({ cls: 'dashboard-tracker-stat-value', text: String(value) });
	};
	addStat(t('tracker.current'), latest);
	addStat(t('tracker.avg'), avg);

	if (size === 'M') {
		addStat(t('tracker.trend'), `${trendDir === 'up' ? '+' : ''}${trendPct}%`);
	}

	if (size === 'L') {
		addStat(t('tracker.trend'), `${trendDir === 'up' ? '+' : ''}${trendPct}%`);
		addStat(t('tracker.streak'), `${streak}d`);
		addStat(t('tracker.min'), minVal);
		addStat(t('tracker.max'), maxVal);
	}
}

function renderTrackerLineChart(el: HTMLElement, data: import('./types').TrackerDataPoint[], size: CardSize, accentColor: string, cardId: string): void {
	const chartWrap = el.createDiv({ cls: 'dashboard-tracker-chart' });
	const canvasEl = chartWrap.createEl('canvas', { cls: 'dashboard-chart-canvas' });
	const ctx = canvasEl.getContext('2d');
	if (!ctx) return;

	const chart = new Chart(ctx, {
		type: 'line',
		data: {
			labels: data.map(p => p.date.slice(5)),
			datasets: [{
				data: data.map(p => p.value),
				borderColor: accentColor,
				backgroundColor: `${accentColor}22`,
				fill: true,
				tension: 0.4,
				pointRadius: size === 'L' ? 3 : 0,
				pointHoverRadius: 5,
				pointBackgroundColor: accentColor,
				borderWidth: 2,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, tooltip: { enabled: true } },
			scales: {
				x: { display: false },
				y: { display: false },
			},
			animation: { duration: 600 },
		},
	});
	chartInstances.set(cardId, chart);
}

function renderTrackerBarChart(el: HTMLElement, data: import('./types').TrackerDataPoint[], size: CardSize, accentColor: string, cardId: string): void {
	const chartWrap = el.createDiv({ cls: 'dashboard-tracker-chart' });
	const canvasEl = chartWrap.createEl('canvas', { cls: 'dashboard-chart-canvas' });
	const ctx = canvasEl.getContext('2d');
	if (!ctx) return;

	const textColor = getCSSVar('--db-text-muted') || '#888';
	const validVals = data.filter(p => p.value !== null).map(p => p.value!);
	const barMax = validVals.length > 0 ? Math.max(...validVals) : 1;

	const chart = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: data.map(p => p.date.slice(5)),
			datasets: [{
				data: data.map(p => p.value ?? 0),
				backgroundColor: data.map(p => {
					if (p.value === null) return 'transparent';
					const intensity = barMax > 0 ? p.value / barMax : 0;
					return `${accentColor}${Math.round(40 + intensity * 180).toString(16).padStart(2, '0')}`;
				}),
				borderRadius: 2,
				barPercentage: 0.8,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, tooltip: { enabled: true } },
			scales: {
				x: { display: false },
				y: { display: size === 'L', grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
			},
			animation: { duration: 600 },
		},
	});
	chartInstances.set(cardId, chart);
}

function renderTrackerHeatmap(el: HTMLElement, data: import('./types').TrackerDataPoint[], minVal: number, maxVal: number, size: CardSize, accentColor: string): void {
	const heatmap = el.createDiv({ cls: 'dashboard-tracker-heatmap' });

	const range = maxVal - minVal || 1;
	const cellSize = size === 'M' ? 10 : 14;
	const gap = 2;

	// Organize data into weeks (columns), days are rows (Mon-Sun)
	// Each column = 1 week, from oldest to newest
	const firstDate = data[0] ? new Date(data[0].date + 'T00:00:00') : new Date();
	const startDayOfWeek = firstDate.getDay(); // 0=Sun, 1=Mon...
	const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // days from Monday

	// Build week columns
	const weeks: (import('./types').TrackerDataPoint | null)[][] = [];
	let currentWeek: (import('./types').TrackerDataPoint | null)[] = [];

	// Pad first week with nulls to align to Monday
	for (let i = 0; i < mondayOffset; i++) {
		currentWeek.push(null);
	}

	for (const point of data) {
		currentWeek.push(point);
		if (currentWeek.length === 7) {
			weeks.push(currentWeek);
			currentWeek = [];
		}
	}
	if (currentWeek.length > 0) {
		weeks.push(currentWeek);
	}

	// Limit visible weeks based on size
	const maxWeeks = size === 'M' ? 15 : size === 'L' ? 26 : 52;
	const visibleWeeks = weeks.slice(-maxWeeks);

	const grid = heatmap.createDiv({ cls: 'dashboard-tracker-heatmap-grid' });
	grid.style.display = 'grid';
	grid.style.gridTemplateColumns = `repeat(${visibleWeeks.length}, ${cellSize}px)`;
	grid.style.gridTemplateRows = `repeat(7, ${cellSize}px)`;
	grid.style.gap = `${gap}px`;

	// Day labels (Mon, Tue, ... Sun) for L size
	if (size === 'L') {
		const labels = heatmap.createDiv({ cls: 'dashboard-tracker-heatmap-labels' });
		const dayNames = ['M', '', 'W', '', 'F', '', 'S'];
		for (const name of dayNames) {
			labels.createDiv({ cls: 'dashboard-tracker-heatmap-day-label', text: name });
		}
	}

	for (const week of visibleWeeks) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const point = week[dayIdx] ?? null;
			const cell = grid.createDiv({ cls: 'dashboard-tracker-heatmap-cell' });
			cell.style.width = `${cellSize}px`;
			cell.style.height = `${cellSize}px`;
			cell.style.borderRadius = `${Math.max(2, cellSize / 4)}px`;

			if (point === null || point.value === null) {
				cell.addClass('dashboard-tracker-heatmap-cell--empty');
			} else {
				const intensity = (point.value - minVal) / range;
				const alpha = 0.15 + intensity * 0.85;
				cell.style.backgroundColor = accentColor;
				cell.style.opacity = String(alpha);
				cell.title = `${point.date}: ${point.value}`;
			}
		}
	}
}
