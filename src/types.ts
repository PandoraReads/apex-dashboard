import type { Language } from './i18n';
import type { TFile } from 'obsidian';

export interface DashboardSettings {
	dashboardFile: string;
	recentDocCount: number;
	language: Language;
	stylePreset: string;
	widgetWeatherEnabled: boolean;
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
	/** Year-progress widget: shows how much % of the current year has elapsed. */
	widgetYearProgressEnabled: boolean;
	widgetOrder: string[];
	/** Weread (WeChat Read) official API key (wrk-...), shared account-wide. */
	wereadApiKey: string;
	/** Folder where weread highlights are imported as notes. */
	wereadImportPath: string;
	/** TickTick account region (dida365 = China, ticktick = international). */
	ticktickRegion: 'dida365' | 'ticktick';
	/** TickTick session token (the `t` cookie value), account-wide. */
	ticktickCookie: string;
	/** TickTick CSRF token (the `_csrf_token` cookie), required for writes. */
	ticktickCsrf: string;
	/** TickTick x-device version override (when the web client rotates, bump this). */
	ticktickDeviceVersion?: string;
	/** IANA timezone used to render TickTick dates (defaults to Asia/Shanghai). */
	ticktickTimezone: string;
	/** Skip the note popover: open notes directly in a tab on card click. */
	disableNotePopover: boolean;
	/** User-defined color overrides applied on top of the active theme. */
	customColors: CustomColors;
	/** Global dashboard background image (vault path or URL). Empty = none. */
	bgImage: string;
	/** Background dimming overlay 0-100 (keeps text readable over busy images). */
	bgDim: number;
	/** Background blur in px 0-30 (depth-of-field over the image). */
	bgBlur: number;
	/** Background fill mode. */
	bgSize: BgSize;
	/** Surface (card/section/sidebar) opacity 0-100. null = theme default. */
	surfaceOpacity: number | null;
	/** Frosted-glass blur in px 0-20. null = theme default. */
	glassBlur: number | null;
	/** Corner-radius base in px 0-22 (drives sm/md/lg). null = theme default. */
	radiusScale: number | null;
	/** Quick Notes region master toggle (pinned top of the kanban). */
	quickNotesEnabled: boolean;
	/** Quick-create presets (template + folder + filename). Global (Layer 1). */
	quickNotePresets: QuickNotePreset[];
	/** Inline capture box shown in the Quick Notes region. */
	quickCaptureEnabled: boolean;
	/** Note path to append captures to. Empty = create a new fleeting note. */
	quickCaptureTarget: string;
	/** Folder for new fleeting notes when no capture target is set. */
	quickCaptureFolder: string;
	/** Template path applied to new fleeting notes created in the capture folder. Empty = none. */
	quickCaptureTemplate: string;
	/** Pinned-note shortcuts rendered as one-click open buttons. */
	pinnedNotes: PinnedNote[];
	/** Show a "Today" button that creates/opens the core Daily Notes note. */
	quickDailyEnabled: boolean;
	/** Last plugin version that showed the Quick Notes first-run guide. Empty = never shown. */
	quickNoteGuideShownVersion: string;
	countdownEnabled: boolean;
	/** Multiple countdowns managed in settings; rendered in the sidebar. */
	countdowns: CountdownConfig[];
	readingEnabled: boolean;
	readingSoundEnabled: boolean;
	taskTemplates: TaskTemplate[];
	memoSavePath: string;
	taskArchivePath: string;
	/** Periodic dashboard-file backup toggle + cadence. Snapshots are written
	 *  into the plugin folder under backups/ (see BackupService). */
	backupEnabled: boolean;
	backupPeriod: BackupPeriod;
	backupMaxCount: number;
	/** Epoch ms of the last successful periodic backup (runtime state). */
	backupLastRun?: number;
}

/** Cadence for the periodic dashboard backup. */
export type BackupPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * User-defined color overrides for the active theme. Each field maps 1:1 to a
 * `--db-*` CSS custom property (see CUSTOM_COLOR_TOKENS in appearance.ts). Only
 * non-empty values are applied inline on the root, overriding the `[data-theme]`
 * block via specificity; absent fields fall back to the theme.
 */
export interface CustomColors {
	/** Primary accent (buttons, highlights, progress, links). `--db-accent` */
	accent?: string;
	/** Lighter accent variant. `--db-accent-light` */
	accentLight?: string;
	/** Page background base color. `--db-bg` */
	bg?: string;
	/** Card surface color. `--db-bg-card` */
	bgCard?: string;
	/** Section surface color. `--db-bg-section` */
	bgSection?: string;
	/** Primary text color. `--db-text` */
	text?: string;
	/** Muted/secondary text color. `--db-text-muted` */
	textMuted?: string;
	/** Card border color. `--db-border-card` */
	borderCard?: string;
}

/** How a dashboard background image fills the background layer. */
export type BgSize = 'cover' | 'contain';

/** One "quick-create" button in the Quick Notes region: creates a note from a
 *  template file into a folder, with `{{date}}`/`{{time}}`/`{{title}}` resolved. */
export interface QuickNotePreset {
	id: string;
	/** Button label. */
	label: string;
	/** Lucide icon name (e.g. 'calendar-days'). */
	icon: string;
	/** Vault path to a template file. Empty = create a blank note. */
	templatePath: string;
	/** Destination folder (vault root if empty). Created if missing. */
	folder: string;
	/** Filename pattern, supports {{date}}, {{date:F}}, {{time}}, {{title}}. */
	filename: string;
}

/** A pinned note shortcut in the Quick Notes region: one-click open. */
export interface PinnedNote {
	id: string;
	label: string;
	/** Lucide icon name. */
	icon: string;
	/** Vault path to the note. */
	path: string;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	dashboardFile: 'dashboard',
	recentDocCount: 5,
	language: 'zh',
	stylePreset: 'earth',
	widgetWeatherEnabled: false,
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
	widgetYearProgressEnabled: false,
	widgetOrder: ['weather', 'lunar', 'pomodoro', 'reading', 'countdown', 'yearProgress'],
	wereadApiKey: '',
	wereadImportPath: 'Weread/划线',
	ticktickRegion: 'dida365',
	ticktickCookie: '',
	ticktickCsrf: '',
	ticktickTimezone: 'Asia/Shanghai',
	disableNotePopover: false,
	customColors: {},
	bgImage: '',
	bgDim: 40,
	bgBlur: 0,
	bgSize: 'cover',
	surfaceOpacity: null,
	glassBlur: null,
	radiusScale: null,
	quickNotesEnabled: false,
	quickNotePresets: [] as QuickNotePreset[],
	quickCaptureEnabled: false,
	quickCaptureTarget: '',
	quickCaptureFolder: '',
	quickCaptureTemplate: '',
	pinnedNotes: [] as PinnedNote[],
	quickDailyEnabled: false,
	quickNoteGuideShownVersion: '',
	countdownEnabled: false,
	countdowns: [] as CountdownConfig[],
	readingEnabled: false,
	readingSoundEnabled: true,
	taskTemplates: [],
	memoSavePath: '',
	taskArchivePath: '归档/已完成.md',
	backupEnabled: false,
	backupPeriod: 'daily',
	backupMaxCount: 10,
};

export interface QuoteItem {
	quote: string;
	author: string;
}

/** Banner display mode: classic poster+quote, or the stats dashboard. */
export type BannerMode = 'quote' | 'stats';

/** Configuration for the stats banner. Columns are role-fixed (scale / activity
 *  / productivity), so this only holds cross-cutting options. */
export type BannerLeftStat =
	| 'totalNotes' | 'tagsCount' | 'totalLinks'
	| 'newThisMonth' | 'newThisWeek'
	| 'totalTasks' | 'doneTasks' | 'pendingTasks';

export type BannerCenterStat = 'streak' | 'taskCompletion' | 'connectivity' | 'newThisWeek';

export type BannerRightStat = 'taskCompletion' | 'connectivity' | 'orphanRate' | 'avgLinksPerNote';

export interface BannerStatsConfig {
	/** Daily-notes folder for the streak metric. Empty/undefined = auto-detect
	 *  the core Daily notes plugin. */
	dailyFolder?: string;
	dailyFormat?: string;
	/** Accent color override; undefined = follow theme. */
	accent?: string;
	/** Background blur in px (0–16). */
	blur?: number;
	/** Background darkness 0–100 (higher = darker). */
	darkness?: number;
	/** Show secondary content (left strip, center heatmap, right bars). */
	showDetails?: boolean;
	/** Per-column visibility (default all true). */
	showLeft?: boolean;
	showCenter?: boolean;
	showRight?: boolean;
	/** Stat featured in each column. */
	leftStat?: BannerLeftStat;
	centerStat?: BannerCenterStat;
	/** Progress metrics shown in the right column, in order. */
	rightStats?: BannerRightStat[];
}

export interface BannerData {
	mode?: BannerMode;
	quote: string;
	author: string;
	image: string;
	quoteColor?: string;
	quotes?: QuoteItem[];
	images?: string[];
	statsConfig?: BannerStatsConfig;
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
	/** Grid card view: show note frontmatter properties as key:value badges. Defaults to true. */
	showProperties?: boolean;
	/** Grid card view: max number of property badges per card. Defaults to 6. */
	propertyLimit?: number;
	quickDateFilter?: { property: 'created' | 'modified'; start: string; end: string };
	/** Folder section: scan scope. A file shows if it lives under any of these folders (recursive). Legacy single `folder` is normalized into this array on parse. */
	folders?: string[];
	/** Library/folder funnel: persistent folder-prefix filter (OR across entries). */
	folderFilter?: string[];
	/** All-tasks section: vault folders whose tasks are excluded from aggregation. */
	excludeFolders?: string[];
	/** All-tasks section: dimension used to group tasks into list sections / kanban columns. */
	taskGroupBy?: 'date' | 'priority' | 'none';
}

/**
 * Heatmap section config. Renders a GitHub-style year heatmap (week columns,
 * 7 day rows, month labels on top) over one of two ranges.
 */
export interface HeatmapConfig {
	folder: string;
	trackerKey: string;
	title?: string;
	/** pastYear = last 365/366 days ending today; thisYear = Jan 1→Dec 31. */
	period: 'pastYear' | 'thisYear';
}

/** One countdown entry. Multiple countdowns are managed in settings (countdowns[]). */
export interface CountdownConfig {
	id: string;
	label: string;
	targetDate: string;
	displayMode: 'days' | 'hours' | 'minutes';
	reminderDays: number;
}

/** One widget within a weread section (a section stacks multiple, top-to-bottom). */
export interface WereadWidget {
	id: string;
	view: 'shelf' | 'stats' | 'notes';
	/** Shelf progress filter (multi-select): 'notStarted' | 'reading' | 'finished'. Empty = all. */
	progressFilters?: string[];
	/** Shelf category filter (multi-select, real top-level categories). Empty = all. */
	categoryFilters?: string[];
	title?: string;
}

/** Weread (WeChat Read) section config. The API key is account-wide (wereadApiKey). */
export interface WereadConfig {
	/** Ordered widgets rendered top-to-bottom. */
	widgets: WereadWidget[];
}

/** TickTick section config. View toggles between 'today' (combined dashboard)
 * and 'lists' (project cards). Credentials are account-wide (DashboardSettings.ticktick*). */
export interface TickTickConfig {
	view: 'today' | 'lists';
	/** Project IDs hidden in 'lists' view. */
	hiddenProjects?: string[];
	/** Per-project card width in 'lists' view (px), persisted on resize. */
	projectWidths?: Record<string, number>;
}

/** Dataview (DQL) section config. The raw DQL query string is the sole required
 *  field; `title` optionally overrides the column name in the section header. */
export interface DataviewConfig {
	/** Raw DQL query, e.g. `TABLE file.name FROM "Books" WHERE rating >= 4 SORT file.name`. */
	query: string;
	/** Optional display title override (defaults to column name). */
	title?: string;
}

export interface DashboardColumn {
	name: string;
	color: string;
	sectionType?: string;
	cards: DashboardCard[];
	libraryConfig?: LibraryConfig;
	/** Heatmap section config (sectionType 'heatmap'). */
	heatmapConfig?: HeatmapConfig;
	/** Weread section config (sectionType 'weread'). */
	wereadConfig?: WereadConfig;
	/** TickTick section config (sectionType 'ticktick'). */
	ticktickConfig?: TickTickConfig;
	/** Dataview section config (sectionType 'dataview'). */
	dataviewConfig?: DataviewConfig;
	/** User-set max height in px (drag-resize, desktop only). */
	height?: number;
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
	onOpenNoteInPopover(this: void, file: TFile): void;
	onCardDelete(cardId: string): void;
	onCheckboxToggle(cardId: string, taskPath: number[], checked: boolean): void;
	onTaskAdd(cardId: string, text: string, parentPath?: number[]): void;
	onTaskDelete(cardId: string, taskPath: number[]): void;
	onTaskReorder(cardId: string, fromPath: number[], toPath: number[], before: boolean): void;
	onTaskMoveToCard(srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest'): void;
	onTaskEdit(cardId: string, taskPath: number[], newText: string): void;
	onCardAdd(columnName: string): void;
	onColumnAdd(name: string, sectionType?: string): void;
	onRequestAddSection(): void;
	onColumnMove(fromIndex: number, toIndex: number): void;
	onColumnHeightChange(name: string, height: number): void;
	onBannerEdit(): void;
	onQuickActionAdd(): void;
	onQuickActionRemove(index: number): void;
	onMoveCard(cardId: string, targetColumn: string, targetIndex: number): void;
	onMemoUpdate(card: DashboardCard, updates: { body: string; blockquote: string }): void;
	onMemoSaveAsNote(card: DashboardCard): void;
	onTaskSaveToDaily(card: DashboardCard): void;
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
	onColumnDelete(columnName: string): void;
	onTaskReminderEdit(cardId: string, taskPath: number[], reminder: string | undefined): void;
	onTaskNest(cardId: string, taskPath: number[]): void;
	onTaskNestInto(cardId: string, srcPath: number[], destPath: number[]): void;
	onTaskUnnest(cardId: string, taskPath: number[]): void;
	onTaskToggleCollapse(cardId: string, taskPath: number[]): void;
	onAddFromTemplate(columnName: string): void;
	onArchiveTasks(columnName: string): void;
	onLibraryConfigChange(columnName: string, config: LibraryConfig): void;
	onQuickNoteCreate(preset: QuickNotePreset): void;
	onQuickNoteCapture(text: string): void;
	onOpenPinnedNote(note: PinnedNote): void;
	onQuickNoteDaily(): void;
	onQuickNoteConfig(): void;
}
