import type { Language } from './i18n';
import type { CalendarTaskFilter } from './alltasks-scan';
import type { TFile } from 'obsidian';
import type {
	WereadContentType,
	WereadGroupBy,
	WereadNoteState,
	WereadReadingState,
	WereadRecency,
} from './weread-shelf-model';

export type DashboardLayoutMode = 'side' | 'stacked';

/** Fixed destination override for calendar-added tasks. */
export interface CalendarTaskTarget {
	kind: 'file' | 'folder';
	path: string;
}

export interface DashboardSettings {
	/** Path of the ACTIVE workspace file (no .md extension). */
	dashboardFile: string;
	/** All workspace board files in switcher order (button i+1). Paths follow
	    the dashboardFile convention (no leading '/', no .md extension). */
	workspaceFiles: string[];
	/** Optional display names, parallel to workspaceFiles ('' = number only). */
	workspaceNames?: string[];
	recentDocCount: number;
	language: Language;
	stylePreset: string;
	/** Board arrangement: widgets in a left rail ('side', default) or a
	    horizontal strip under the banner ('stacked'). Desktop/tablet only;
	    phones keep their own layout regardless of this value. */
	layoutMode: DashboardLayoutMode;
	widgetWeatherEnabled: boolean;
	widgetWeatherCity: string;
	widgetWeatherLat: number;
	widgetWeatherLon: number;
	pomodoroEnabled: boolean;
	pomodoroWorkMinutes: number;
	pomodoroShortBreakMinutes: number;
	pomodoroLongBreakMinutes: number;
	pomodoroLongBreakInterval: number;
	/** Daily pomodoro completion goal (count), shown as "1/8" in KPIs/gauge. */
	pomodoroDailyGoal: number;
	pomodoroAutoStartBreak: boolean;
	pomodoroSoundEnabled: boolean;
	/** Floating body-level mini countdown panel shown while a pomodoro runs. */
	pomodoroMiniPanelEnabled: boolean;
	widgetLunarEnabled: boolean;
	/** Year-progress widget: shows how much % of the current year has elapsed. */
	widgetYearProgressEnabled: boolean;
	/** Calendar widget: a month/week calendar of vault tasks in the sidebar. */
	widgetCalendarEnabled: boolean;
	/** Folders whose tasks are excluded from the calendar widget/section. */
	calendarExcludeFolders: string[];
	/** Active task filter in the full-screen calendar modal ('all' default).
	    Persisted memory only — the sidebar widget stays unfiltered. */
	calendarTaskFilter: CalendarTaskFilter;
	/** Where calendar-added tasks land in the day's daily note: right below
	    frontmatter ('start') or at the bottom ('end'). */
	calendarTaskInsertPosition: 'start' | 'end';
	/** Optional fixed destination for calendar-added tasks: a specific file
	    (task inserted per calendarTaskInsertPosition) or a folder (one note
	    per day, named YYYY-MM-DD, created on first task). Unset = the
	    historical daily-note chain (clicked day → today → dashboard → create). */
	calendarTaskTarget?: CalendarTaskTarget;
	/** Habit check-in widget: boolean daily check-offs tracked per habit. */
	widgetHabitEnabled: boolean;
	/** Expense tracker widget: quick expense/income entry in the sidebar. */
	widgetExpenseEnabled: boolean;
	/** Currency symbol shown before amounts in the expense widget/stats (e.g. ¥, $). */
	expenseCurrency: string;
	/** Photo-album widget: auto-rotating slideshow of a vault folder's images.
	 *  Legacy single-album fields (widgetAlbum*) still load in old data.json
	 *  files and are migrated to albums[] on load. */
	widgetAlbumEnabled: boolean;
	/** Vault folder whose images the album rotates through ('' = unset). */
	widgetAlbumFolder: string;
	/** Seconds each photo stays on screen before auto-advancing. */
	widgetAlbumIntervalSec: number;
	/** Include images from subfolders of the album folder. */
	widgetAlbumRecursive: boolean;
	/** Panel aspect ratio of the album frame ('1:1' square, '3:4' portrait). */
	widgetAlbumRatio: '1:1' | '3:4';
	/** Photo transition animation between slides ('fade' default). */
	widgetAlbumTransition: 'fade' | 'slide-left' | 'slide-right' | 'zoom';
	/** Album widgets (multiple): one slideshow card per entry. */
	albums: AlbumConfig[];
	/** Anniversary ("纪念日") widgets master toggle (entries in anniversaries[]). */
	anniversaryEnabled: boolean;
	/** Anniversary entries: elapsed time since a historical date each. */
	anniversaries: AnniversaryConfig[];
	/** Singleton widget card backgrounds (undefined = none). */
	quickActionsBackground?: WidgetBackground;
	pomodoroBackground?: WidgetBackground;
	habitBackground?: WidgetBackground;
	musicBackground?: WidgetBackground;
	yearProgressBackground?: WidgetBackground;
	/** Music player widget: search & play NetEase free songs in the sidebar
	    (desktop only; no account, VIP tracks are skipped). */
	widgetMusicEnabled: boolean;
	/** Player volume 0-1. */
	musicVolume: number;
	/** Repeat mode of the music player. */
	musicRepeatMode: MusicRepeatMode;
	/** Persisted playlist; cover URLs are lazily backfilled and then saved. */
	musicPlaylist: MusicTrack[];
	/** Highlighted track index restored on restart; playback never auto-resumes. */
	musicCurrentIndex: number;
	/** Quick-buttons ("快捷按钮") rendered as a draggable sidebar widget. */
	widgetQuickActionsEnabled: boolean;
	/** Optional custom background color for the quick-buttons widget (user
	 *  picked via the palette button; undefined = theme default). */
	quickButtonsBgColor?: string;
	/** Optional custom button color for the quick-buttons widget (palette
	 *  picker; undefined = theme default). */
	quickButtonsBtnColor?: string;
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
	/** Global dashboard text size. 'medium' (default) keeps the inherited
	    base size; 'small'/'large' scale it (em-based sizes cascade from the
	    root, so titles/body/banner/widgets grow or shrink together). */
	fontScale: 'small' | 'medium' | 'large';
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
	/** Where captured lines land in the note: after frontmatter ('start') or at the bottom ('end'). */
	quickCapturePosition: 'start' | 'end';
	/** Pinned-note shortcuts rendered as one-click open buttons. */
	pinnedNotes: PinnedNote[];
	/** Quick-command shortcuts rendered as one-click execute buttons. */
	quickCommands: QuickCommand[];
	/** Show a "Today" button that creates/opens the core Daily Notes note. */
	quickDailyEnabled: boolean;
	/** Last plugin version that showed the Quick Notes first-run guide. Empty = never shown. */
	quickNoteGuideShownVersion: string;
	/** Last plugin version that showed the Dataview + community-group announcement. Empty = never shown. */
	dataviewGuideShownVersion: string;
	countdownEnabled: boolean;
	/** Multiple countdowns managed in settings; rendered in the sidebar. */
	countdowns: CountdownConfig[];
	/** User-defined tags for media files (images/videos sections), keyed by
	 *  vault path. Managed by MediaTagService; optional so old data.json loads. */
	mediaTags?: Record<string, string[]>;
	readingEnabled: boolean;
	readingSoundEnabled: boolean;
	taskTemplates: TaskTemplate[];
	memoSavePath: string;
	taskArchivePath: string;
	/** Library sections: folder where the toolbar "new note" button creates notes
	 *  (frontmatter pre-filled to match the section's filters). '' = vault root. */
	libraryNewNotePath: string;
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
 *
 * Value grammar (mirrors the widget-background foreground dropdown): `'light'`
 * / `'dark'` are one-click preset sentinels resolved per field via
 * resolveCustomColorValue; any other non-empty string is a concrete CSS color
 * (`#rrggbb`, or `rgba(...)` once its alpha slider drops below 100).
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

/** A quick-command shortcut in the Common Actions bar: one-click execute. */
export interface QuickCommand {
	id: string;
	/** Button label. */
	label: string;
	/** Lucide icon name. */
	icon: string;
	/** Obsidian command id (e.g. 'editor:toggle-pin'). */
	commandId: string;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	dashboardFile: 'dashboard',
	workspaceFiles: ['dashboard'],
	workspaceNames: [''],
	recentDocCount: 5,
	language: 'zh',
	stylePreset: 'mono',
	layoutMode: 'side',
	widgetWeatherEnabled: false,
	widgetWeatherCity: 'Shanghai',
	widgetWeatherLat: 31.23,
	widgetWeatherLon: 121.47,
	pomodoroEnabled: true,
	pomodoroWorkMinutes: 25,
	pomodoroShortBreakMinutes: 5,
	pomodoroLongBreakMinutes: 15,
	pomodoroLongBreakInterval: 4,
	pomodoroDailyGoal: 8,
	pomodoroAutoStartBreak: true,
	pomodoroSoundEnabled: true,
	pomodoroMiniPanelEnabled: true,
	widgetLunarEnabled: true,
	widgetYearProgressEnabled: false,
	widgetCalendarEnabled: false,
	calendarExcludeFolders: [],
	calendarTaskFilter: 'all',
	calendarTaskInsertPosition: 'start',
	widgetHabitEnabled: false,
	widgetExpenseEnabled: false,
	expenseCurrency: '¥',
	widgetAlbumEnabled: false,
	widgetAlbumFolder: '',
	widgetAlbumIntervalSec: 8,
	widgetAlbumRecursive: true,
	widgetAlbumRatio: '1:1',
	widgetAlbumTransition: 'fade',
	albums: [],
	anniversaryEnabled: false,
	anniversaries: [],
	widgetMusicEnabled: false,
	musicVolume: 0.8,
	musicRepeatMode: 'list',
	musicPlaylist: [] as MusicTrack[],
	musicCurrentIndex: -1,
	widgetQuickActionsEnabled: true,
	widgetOrder: ['quickActions', 'weather', 'lunar', 'pomodoro', 'reading', 'countdown', 'yearProgress', 'calendar', 'habit', 'expense', 'album', 'music'],
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
	fontScale: 'medium',
	quickNotesEnabled: false,
	quickNotePresets: [] as QuickNotePreset[],
	quickCaptureEnabled: false,
	quickCaptureTarget: '',
	quickCaptureFolder: '',
	quickCaptureTemplate: '',
	quickCapturePosition: 'start',
	pinnedNotes: [] as PinnedNote[],
	quickCommands: [] as QuickCommand[],
	quickDailyEnabled: false,
	quickNoteGuideShownVersion: '',
	dataviewGuideShownVersion: '',
	countdownEnabled: false,
	countdowns: [] as CountdownConfig[],
	mediaTags: {},
	readingEnabled: false,
	readingSoundEnabled: true,
	taskTemplates: [],
	memoSavePath: '',
	taskArchivePath: '归档/已完成.md',
	libraryNewNotePath: '',
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
	/** Whether the center streak counts daily notes (default) or any note
	 *  creation activity across the vault. */
	streakFromDaily?: boolean;
	/** Folders excluded from all stats (matched by path prefix,
	 *  case-insensitive). */
	excludeFolders?: string[];
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
	/** Center heatmap data source: vault note activity (default) or habit
	 *  check-ins from the habit widget. */
	heatmapSource?: 'notes' | 'habit';
	/** Which habit feeds the center heatmap when heatmapSource === 'habit'.
	 *  'all' = daily count of completed habits; otherwise a habit id. */
	heatmapHabitId?: string;
}

export interface BannerData {
	mode?: BannerMode;
	quote: string;
	author: string;
	image: string;
	quoteColor?: string;
	/** CSS font-family for the quote/author text; empty = theme default. */
	quoteFont?: string;
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
	/** Original note appearance when a note is moved into a mixed sticky section. */
	noteStyle?: 'cover' | 'plain';
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

export type LibraryViewMode = 'grid' | 'gallery' | 'list' | 'table' | 'kanban';

export interface PropertyFilter {
	property: string;
	values: string[];
	/** How checked values compare against a file's property value.
	 *  equals (default): exact match, OR across values.
	 *  contains: substring match (case-insensitive), values may be free text.
	 *  notEquals: exclude files whose value exactly equals any checked value. */
	operator?: PropertyFilterOperator;
	dateRange?: { start: string; end: string };
}

export type PropertyFilterOperator = 'equals' | 'contains' | 'notEquals';

export interface LibraryConfig {
	filters: PropertyFilter[];
	viewMode: LibraryViewMode;
	sortBy: string;
	sortDesc: boolean;
	kanbanGroupBy?: string;
	/** Kanban grouping mode: by frontmatter property (default, keyed by
	 *  kanbanGroupBy) or by the file's top-level subfolder under the configured
	 *  scan folders (folder sections). */
	groupMode?: 'property' | 'folder';
	/** Kanban view: show each card's cover image (same extraction as the
	    gallery view — 封面/cover keys first, any image-shaped value fallback).
	    Defaults to false. */
	kanbanShowCovers?: boolean;
	pageSize?: number;
	/** Grid card view: show note frontmatter properties as key:value badges. Defaults to true. */
	showProperties?: boolean;
	/** Grid card view: max number of property badges per card. Defaults to 6.
	    Applies to cards that hit none of `visibleProperties` (fallback mode). */
	propertyLimit?: number;
	/** Grid/gallery card size. Defaults to 'medium'. Only affects the card
	    views — list/table/kanban ignore it. */
	cardSize?: 'small' | 'medium' | 'large';
	/** Grid card view: hand-picked properties to show (order preserved). A card
	    matching at least one shows exactly those matches; a card matching none
	    falls back to the automatic first-`propertyLimit` display. Empty/undefined
	    = automatic mode for every card. */
	visibleProperties?: string[];
	/** Quick date filter. When `days` is set it is a rolling "last N days"
	    window evaluated relative to today (start/end ignored); otherwise the
	    fixed start/end date range applies. */
	quickDateFilter?: { property: 'created' | 'modified'; start: string; end: string; days?: number };
	/** Folder section: scan scope. A file shows if it lives under any of these folders (recursive). Legacy single `folder` is normalized into this array on parse. */
	folders?: string[];
	/** Library/folder funnel: persistent folder-prefix filter (OR across entries). */
	folderFilter?: string[];
	/** Folders excluded from this section's data (all-tasks aggregation, library
	 *  scans, images/videos scans). Matched by path prefix, case-insensitive;
	 *  files inside them never reach the section. */
	excludeFolders?: string[];
	/** Media sections (images/videos): when non-empty, ONLY files under these
	 *  folders reach the section (excludes still subtract within the scope).
	 *  Empty = whole vault. */
	includeFolders?: string[];
	/** New notes created from this section's toolbar button start from this
	 *  template note's content ({{title}} / {{date:...}} substituted). Empty = bare note. */
	templatePath?: string;
	/** All-tasks section: dimension used to group tasks into list sections / kanban columns. */
	taskGroupBy?: 'date' | 'priority' | 'none';
}

/** One countdown entry. Multiple countdowns are managed in settings (countdowns[]). */
export interface CountdownConfig {
	id: string;
	label: string;
	targetDate: string;
	displayMode: 'days' | 'hours' | 'minutes';
	reminderDays: number;
	/** Optional decorative card background. */
	background?: WidgetBackground;
}

/** Stacked-layout card height ratios: exact fractions of the calendar unit
 *  (the 6-row widget grid: 6 / 4 / 3 / 2 rows). */
export type WidgetHeightRatio = 'full' | 'twoThirds' | 'half' | 'third';

/** Optional decorative background for a widget card: image + readability
 *  controls (image opacity, black dimming overlay, blur). */
export interface WidgetBackground {
	/** Vault path or http(s) URL of the image ('' = none). */
	image: string;
	/** Image opacity 0-100 (100 = solid). */
	opacity: number;
	/** Black dimming overlay 0-100 (keeps the card text readable). */
	dim: number;
	/** Background blur 0-20 px. */
	blur: number;
	/** Text/icon color scheme over the image: 'light' | 'dark' | custom
	 *  '#rrggbb' | undefined (follow the theme). */
	foreground?: string;
}

/** Factory with sane defaults (solid image, mild dim, no blur). */
export const DEFAULT_WIDGET_BACKGROUND = (): WidgetBackground => ({ image: '', opacity: 100, dim: 30, blur: 0 });

/** One photo-album widget entry. Multiple albums are managed in settings
 *  (albums[]); each renders its own slideshow card in the sidebar. */
export interface AlbumConfig {
	id: number;
	/** Vault folder the slideshow rotates through. */
	folder: string;
	/** Seconds each photo stays on screen. */
	intervalSec: number;
	/** Include images from subfolders. */
	recursive: boolean;
	/** Frame aspect ratio ('1:1' square, '3:4' portrait). */
	ratio: '1:1' | '3:4';
	/** Transition animation between slides. */
	transition: 'fade' | 'slide-left' | 'slide-right' | 'zoom';
	/** Stacked-layout card height ratio (side layout ignores it). */
	heightRatio: WidgetHeightRatio;
}

/** One anniversary ("纪念日") entry: elapsed time since a historical date,
 *  with an optional same-day-every-year reminder. */
export interface AnniversaryConfig {
	id: string;
	label: string;
	/** Historical date the elapsed time is measured from (YYYY-MM-DD or
	 *  YYYY-MM-DDTHH:mm). */
	startDate: string;
	/** Elapsed display granularity: calendar years/months/days, total days,
	 *  or days + hours. */
	precision: 'ymd' | 'days' | 'hours';
	/** Fire a reminder once a year on the anniversary's month/day. */
	annualReminder: boolean;
	/** Optional decorative card background. */
	background?: WidgetBackground;
}

/** One playable NetEase track. Shared by search results, playlist imports and
    the persisted sidebar playlist. `fee` drives playability: 0/8 are free,
    1/2/4 need an account the widget deliberately does not have. */
export interface MusicTrack {
	/** NetEase song id. */
	id: number;
	/** Song title. */
	name: string;
	/** artists[].name joined with ' / '. */
	artist: string;
	/** Album name. */
	album: string;
	/** Song duration in milliseconds (API original). */
	durationMs: number;
	/** NetEase fee flag: 0|8 free, 1 VIP, 2|4 album purchase. */
	fee: number;
	/** Cover URL, lazily backfilled from /api/song/detail then persisted. */
	picUrl?: string;
}

/** Repeat mode of the music player widget. */
export type MusicRepeatMode = 'list' | 'one' | 'shuffle';

/** One widget within a weread section (a section stacks multiple, top-to-bottom). */
export interface WereadWidget {
	id: string;
	view: 'shelf' | 'stats' | 'notes';
	/** Stats widget: ordered list of visible blocks (order = display order).
	 *  Absent = all blocks in the default order. Hidden blocks are simply
	 *  missing from the list. */
	statsItems?: WereadStatItem[];
	/** Shelf progress filter (multi-select): 'notStarted' | 'reading' | 'finished'. Empty = all. */
	progressFilters?: WereadReadingState[];
	/** Stable shelf item classes: electronic book, audio, or article collection. */
	contentTypeFilters?: WereadContentType[];
	/** Disjoint activity buckets based on the latest reading timestamp. */
	recencyFilters?: WereadRecency[];
	/** Note/highlight state from the notebooks endpoint. */
	noteFilters?: WereadNoteState[];
	/** Optional visual shelf grouping. Defaults to readingState for new widgets. */
	groupBy?: WereadGroupBy;
	/** Legacy genre filter retained for existing dashboard files. */
	categoryFilters?: string[];
	title?: string;
}

/** Blocks of the weread stats widget. */
export type WereadStatItem = 'kpi' | 'trend' | 'topRead' | 'preferCategory';

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
 *  field; `title` optionally overrides the column name in the section header.
 *  The display fields (pageSize/density/striped/rowNumbers) are view-layer
 *  preferences — the query result itself is unaffected by them. */
export interface DataviewConfig {
	/** Raw DQL query, e.g. `TABLE file.name FROM "Books" WHERE rating >= 4 SORT file.name`. */
	query: string;
	/** Optional display title override (defaults to column name). */
	title?: string;
	/** Rows per page for TABLE/LIST/TASK results (default 50). */
	pageSize?: number;
	/** Presentation mode: 'auto' renders each query type in its native Dataview
	 *  shape (TABLE -> compact table, LIST -> bullet list with bold group
	 *  headers, TASK -> checkbox list); 'table'/'list' force one layout across
	 *  all query shapes. Only affects rendering, never the query. Default 'auto'. */
	viewMode?: 'table' | 'list' | 'auto';
	/** Show the source-note columns/summary (title, path, created date).
	 *  Default on. */
	showSource?: boolean;
	/** Row density: 'normal' (comfortable) or 'compact' (halved paddings). */
	density?: 'normal' | 'compact';
	/** Zebra-striping on table rows / list items (default off). */
	striped?: boolean;
	/** Prepend a row-number column to TABLE results (default off). */
	rowNumbers?: boolean;
	/** Vault folders excluded from the query's page set (matched by path prefix,
	 *  case-insensitive). Pages under them are dropped before the query runs, so
	 *  FROM / WHERE / GROUP BY never see them. */
	excludeFolders?: string[];
}

/** Web embed section config (sectionType 'web'). The URL is the sole required
 *  field; the section embeds that page as an iframe (or, on desktop, an
 *  Electron webview for sites that refuse framing — see web-precheck). */
export interface WebEmbedConfig {
	/** Page to embed. Must be a valid http(s) URL once normalized
	 *  (normalizeWebUrl in web-precheck adds the https:// scheme when missing). */
	url: string;
	/** Display zoom, 0.5–2 (default 1). Shrinks dense web apps (Keep-style)
	 *  so they fit a half-width section. iframe -> css zoom, webview ->
	 *  setZoomFactor after dom-ready. */
	zoom?: number;
}

export interface DashboardColumn {
	name: string;
	color: string;
	sectionType?: string;
	cards: DashboardCard[];
	libraryConfig?: LibraryConfig;
	/** Weread section config (sectionType 'weread'). */
	wereadConfig?: WereadConfig;
	/** TickTick section config (sectionType 'ticktick'). */
	ticktickConfig?: TickTickConfig;
	/** Dataview section config (sectionType 'dataview'). */
	dataviewConfig?: DataviewConfig;
	/** Web embed section config (sectionType 'web'). */
	webConfig?: WebEmbedConfig;
	/** User-set max height in px (drag-resize, desktop only). */
	height?: number;
	/** Side-by-side pairing: two adjacent `half` columns render as one row
	 *  (drag a section beside another, desktop only). Maintained by
	 *  src/column-pairs.ts; adjacency is the pairing identity. */
	half?: boolean;
	/** Width split of a paired row: the LEFT member's share in percent
	 *  (20–80, default 50), set by dragging the pair's divider. Only read on
	 *  a left half member; cleared together with `half` by the pair
	 *  transforms. Desktop only. */
	width?: number;
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
	/** subpath is the raw `#heading` / `#^block` fragment of a wikilink, when present. */
	onOpenNoteInPopover(this: void, file: TFile, subpath?: string): void;
	/** Open a note scrolled to a 1-based line (calendar section/agenda task jumps). */
	onOpenNoteAtLine?(this: void, file: TFile, line?: number): void;
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
	/** Pair the dragged section beside the target (its ex-partner, if any,
	 *  falls back to a full-width row). Indices in current-array space. */
	onColumnMoveBeside(fromIndex: number, targetIndex: number, side: 'left' | 'right'): void;
	onColumnHeightChange(name: string, height: number): void;
	/** Persist a dragged pair-divider split (left member's share, percent). */
	onColumnWidthChange(name: string, widthPct: number): void;
	onBannerEdit(): void;
	onQuickActionAdd(): void;
	onQuickActionRemove(index: number): void;
	onMoveCard(cardId: string, targetColumn: string, targetIndex: number): void;
	onMemoUpdate(card: DashboardCard, updates: Pick<DashboardCard, 'body' | 'blockquote'> & Partial<Pick<DashboardCard, 'tasks' | 'docs' | 'wikiLink' | 'url' | 'type'>>): void;
	onMemoSaveAsNote(card: DashboardCard): void;
	onTaskSaveToDaily(card: DashboardCard): void;
	onDocAdd(cardId: string, path: string): void;
	/** Per-card "new note" (notes/projects sections): create a vault note and
	 *  attach it to the card's doc list. */
	onCardNewNote(cardId: string): void;
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
	/** columnIndex is the identity of the exact section the user acted on; with
	 *  duplicate names it disambiguates which same-named column is meant. */
	onColumnRename(oldName: string, newName: string, columnIndex?: number): void;
	onColumnDelete(columnName: string, columnIndex?: number): void;
	onTaskReminderEdit(cardId: string, taskPath: number[], reminder: string | undefined): void;
	onTaskNest(cardId: string, taskPath: number[]): void;
	onTaskNestInto(cardId: string, srcPath: number[], destPath: number[]): void;
	onTaskUnnest(cardId: string, taskPath: number[]): void;
	onTaskToggleCollapse(cardId: string, taskPath: number[]): void;
	onAddFromTemplate(columnName: string): void;
	onArchiveTasks(columnName: string): void;
	onLibraryConfigChange(columnName: string, config: LibraryConfig): void;
	onDataviewConfigChange(columnName: string, config: DataviewConfig): void;
	onQuickNoteCreate(preset: QuickNotePreset): void;
	onQuickNoteCapture(text: string): void;
	onOpenPinnedNote(note: PinnedNote): void;
	onQuickCommand(cmd: QuickCommand): void;
	onQuickNoteDaily(): void;
	onQuickNoteConfig(): void;
}
