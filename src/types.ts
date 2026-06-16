import type { Language } from './i18n';
import type { TFile } from 'obsidian';

export interface DashboardSettings {
	dashboardFile: string;
	recentDocCount: number;
	language: Language;
	stylePreset: string;
	widgetWeatherEnabled: boolean;
	widgetHeatmapEnabled: boolean;
	widgetTrackerKey: string;
	widgetTrackerDays: number;
	widgetTrackerSummary: 'streak' | 'rate' | 'both' | 'off';
	widgetHeatmapFolder: string;
	widgetHeatmapTitle: string;
	widgetHeatmapRangeMode: HeatmapRangeMode;
	widgetHeatmapPeriod: HeatmapPeriod;
	widgetWeatherCity: string;
	widgetWeatherLat: number;
	widgetWeatherLon: number;
	pomodoroEnabled: boolean;
	pomodoroWorkMinutes: number;
	pomodoroShortBreakMinutes: number;
	pomodoroLongBreakMinutes: number;
	pomodoroLongBreakInterval: number;
	pomodoroAutoStartBreak: boolean;
	pomodoroSoundEnabled: boolean;
	widgetLunarEnabled: boolean;
	widgetOrder: string[];
	countdownEnabled: boolean;
	countdownTargetDate: string;
	countdownDisplayMode: 'days' | 'hours' | 'minutes';
	countdownReminderDays: number;
	countdownLabel: string;
	readingEnabled: boolean;
	readingSoundEnabled: boolean;
	taskTemplates: TaskTemplate[];
	memoSavePath: string;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	dashboardFile: 'dashboard',
	recentDocCount: 5,
	language: 'en',
	stylePreset: 'earth',
	widgetWeatherEnabled: false,
	widgetHeatmapEnabled: false,
	widgetTrackerKey: '',
	widgetTrackerDays: 30,
	widgetTrackerSummary: 'streak',
	widgetHeatmapFolder: '',
	widgetHeatmapTitle: '',
	widgetHeatmapRangeMode: 'rolling',
	widgetHeatmapPeriod: 'month',
	widgetWeatherCity: 'Shanghai',
	widgetWeatherLat: 31.23,
	widgetWeatherLon: 121.47,
	pomodoroEnabled: true,
	pomodoroWorkMinutes: 25,
	pomodoroShortBreakMinutes: 5,
	pomodoroLongBreakMinutes: 15,
	pomodoroLongBreakInterval: 4,
	pomodoroAutoStartBreak: true,
	pomodoroSoundEnabled: true,
	widgetLunarEnabled: true,
	widgetOrder: ['weather', 'lunar', 'heatmap', 'pomodoro', 'reading', 'countdown'],
	countdownEnabled: false,
	countdownTargetDate: '',
	countdownDisplayMode: 'days',
	countdownReminderDays: 0,
	countdownLabel: '',
	readingEnabled: false,
	readingSoundEnabled: true,
	taskTemplates: [],
	memoSavePath: '',
};

export interface QuoteItem {
	quote: string;
	author: string;
}

export interface BannerData {
	quote: string;
	author: string;
	image: string;
	quoteColor?: string;
	quotes?: QuoteItem[];
	images?: string[];
}

export interface QuickAction {
	name: string;
	icon: string;
	type: 'file' | 'command';
	target: string;
}

export const PRESET_ACTIONS: QuickAction[] = [
	{ name: 'New Journal', icon: 'calendar-plus', type: 'command', target: 'daily-notes' },
	{ name: 'New Note', icon: 'plus-circle', type: 'command', target: 'file-explorer:new-file' },
];

export interface ColumnDef {
	name: string;
	color: string;
}

export type CardType = 'task' | 'note' | 'link' | 'project' | 'habit' | 'generic' | 'weather' | 'tracker';

export interface WeatherConfig {
	latitude: number;
	longitude: number;
	cityName: string;
}

export interface WeatherData {
	temperature: number;
	weatherCode: number;
	windSpeed: number;
	humidity: number;
	feelsLike: number;
	dailyMax: number[];
	dailyMin: number[];
	dailyCodes: number[];
	dailyDates: string[];
	fetchedAt: number;
}

export type TrackerStyle = 'line' | 'heatmap' | 'bar';

export type HeatmapRangeMode = 'rolling' | 'period';
export type HeatmapPeriod = 'month' | 'quarter' | 'year';

export interface TrackerConfig {
	key: string;
	days: number;
	style: TrackerStyle;
}

export interface TrackerDataPoint {
	date: string;
	value: number | null;
}

export interface TaskItem {
	text: string;
	checked: boolean;
	reminder?: string;
	children?: TaskItem[];
	collapsed?: boolean;
}

export interface DocNode {
	path: string;
	children?: DocNode[];
	collapsed?: boolean;
}

export interface TaskTemplate {
	id: string;
	name: string;
	tasks: string[];
}

export type CardSize = 'S' | 'M' | 'L';

export interface DashboardCard {
	id: string;
	title: string;
	type: CardType;
	column: string;
	body: string;
	tasks: TaskItem[];
	docs: DocNode[];
	url: string;
	wikiLink: string;
	progress: number;
	streak: number;
	dueDate: string;
	blockquote: string;
	color: string;
	coverImage: string;
	width: number;
	size: CardSize;
	gridCols: number;
	gridRows: number;
	gridCol: number;
	gridRow: number;
	chartConfig?: never;
	weatherConfig?: WeatherConfig;
	trackerConfig?: TrackerConfig;
}

export type LibraryViewMode = 'grid' | 'list' | 'table' | 'kanban';

export interface PropertyFilter {
	property: string;
	values: string[];
	dateRange?: { start: string; end: string };
}

export interface LibraryConfig {
	filters: PropertyFilter[];
	viewMode: LibraryViewMode;
	sortBy: string;
	sortDesc: boolean;
	kanbanGroupBy?: string;
		pageSize?: number;
		quickDateFilter?: { property: 'created' | 'modified'; start: string; end: string };
}

export interface DashboardColumn {
	name: string;
	color: string;
	sectionType?: string;
	cards: DashboardCard[];
	libraryConfig?: LibraryConfig;
}

export interface DashboardData {
	banner: BannerData;
	quickActions: QuickAction[];
	quickActionOrder?: string[];
	hiddenPresets?: string[];
	columns: DashboardColumn[];
}

export interface RenderCallbacks {
	onCardEdit(card: DashboardCard): void;
	onOpenNoteInPopover(file: TFile): void;
	onCardDelete(cardId: string): void;
	onCheckboxToggle(cardId: string, taskPath: number[], checked: boolean): void;
	onTaskAdd(cardId: string, text: string, parentPath?: number[]): void;
	onTaskDelete(cardId: string, taskPath: number[]): void;
	onTaskReorder(cardId: string, fromPath: number[], toPath: number[], before: boolean): void;
	onTaskMoveToCard(srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest'): void;
	onTaskEdit(cardId: string, taskPath: number[], newText: string): void;
	onCardAdd(columnName: string): void;
	onColumnAdd(name: string, sectionType?: string): void;
	onBannerEdit(): void;
	onQuickActionAdd(): void;
	onQuickActionRemove(index: number): void;
	onMoveCard(cardId: string, targetColumn: string, targetIndex: number): void;
	onMemoUpdate(card: DashboardCard, updates: { body: string; blockquote: string }): void;
	onMemoSaveAsNote(card: DashboardCard): void;
	onDocAdd(cardId: string, path: string): void;
	onDocDelete(cardId: string, docPath: number[]): void;
	onDocReorder(cardId: string, fromPath: number[], toPath: number[], before: boolean): void;
	onDocMoveToCard(srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest'): void;
	onDocNest(cardId: string, docPath: number[]): void;
	onDocToggleCollapse(cardId: string, docPath: number[]): void;
	onMemoColorChange(card: DashboardCard, color: string): void;
	onProjectCoverChange(card: DashboardCard, imagePath: string): void;
	onCardTitleEdit(cardId: string, newTitle: string): void;
	onCardWidthChange(cardId: string, width: number): void;
	onCardSizeChange(cardId: string, size: CardSize): void;
	onCardGridChange(cardId: string, gridCols: number, gridRows: number): void;
	onCardGridMove(cardId: string, gridCol: number, gridRow: number): void;
	onFileDrop(cardId: string, filePath: string): void;
	onColumnRename(oldName: string, newName: string): void;
	onTaskReminderEdit(cardId: string, taskPath: number[], reminder: string | undefined): void;
	onTaskNest(cardId: string, taskPath: number[]): void;
	onTaskUnnest(cardId: string, taskPath: number[]): void;
	onTaskToggleCollapse(cardId: string, taskPath: number[]): void;
	onAddFromTemplate(columnName: string): void;
	onLibraryConfigChange(columnName: string, config: LibraryConfig): void;
}
