import { Events, HoverParent, HoverPopover, ItemView, MarkdownView, Notice, Platform, setIcon, WorkspaceLeaf, TAbstractFile, TFile } from 'obsidian';
import { nowMoment } from './datetime';
import type DashboardPlugin from './main';
import type { AppWithCommands } from './obsidian-internal';
import type { DashboardData, DashboardCard, DashboardColumn, QuickAction, BannerData, LibraryConfig, QuickNotePreset, PinnedNote, QuickCommand, SkillShortcut, DataviewConfig, ImmersiveItem } from './types';
import { SyncEngine } from './sync';
import { renderDashboard, destroyAllCharts, renderSidebarWidgets, sidebarWidgetSignature, isStackedLayout, resolveEffectiveLayout, refreshSidebarWeatherWidget, renderSidebarWeekCalendar, renderSidebarPomodoro, renderSidebarReading, refreshScanningSections, refreshMediaSections, renderSection, refreshWeatherCards, invalidateScanningSectionSignatures } from './renderer';
import { renderImmersiveRoot, setupImmersiveDnD, attachImmersiveResizeHandle, attachImmersiveWidgetDelete, refitImmersiveGrid, openImmersiveAddMenu, setupImmersiveTileMenu } from './immersive';
import { defaultWidgetSize, widgetItemId } from './immersive-grid';
import type { PreserveScope } from './preserve-scope';
import { refreshSidebarTaskCalendar, renderSidebarCalendar } from './calendar-widget';
import { refreshCalendarSections } from './calendar-section';
import { renderSidebarHabitWidget, refreshHabitWidget } from './habit-widget';
import { renderSidebarExpenseWidget, refreshExpenseWidget } from './expense-widget';
import { refreshAlbumWidgets, destroyAlbumWidgets } from './album-widget';
import { destroyAnniversaryTimers, parseAnniversaryDate, anniversaryDateThisYear, lunarAnniversaryThisYear, lunarYearsBetween } from './anniversary-widget';
import { refreshMusicWidget } from './music-widget';
import { getMusicService } from './music-service';
import { getHabitService } from './habit-service';
import { getExpenseService } from './expense-service';
import { renderBanner, BannerEditModal, startBannerImageRotation, BANNER_IMAGE_ROTATION_MS as BANNER_IMAGE_ROTATION_MS_SHARED } from './banner';
import { renderWorkspaceSwitcher } from './workspace-switcher';
import { refreshBannerStats } from './banner-stats';
import { applyAppearance } from './appearance';
import { createNoteFromPreset, captureThought, openPinnedNote, openTodayNote, renderQuickNoteRegion } from './quick-note-section';
import { QuickNoteConfigModal } from './quick-note-config-modal';
import { getRecentDocs, renderRecentDocs } from './recent';
import { renderQuickActions, AddActionModal, DocSearchModal } from './quick-actions';
import { AgentPromptModal } from './agent-prompt-modal';
import { rememberSkillNames } from './skill-registry';
import { PipelineConfigModal } from './pipeline-config-modal';
import { setupDragAndDrop } from './dnd';
import { startGuardedDrag } from './drag-guard';
import { clampSidebarWidth, clampWidgetUnitHeight } from './widget-span';
import { CardEditModal } from './card-edit-modal';
import { NotePopoverModal, revealMarkdownLine } from './note-popover-modal';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';
import { clearWeatherCache } from './weather-service';
import { renderSidebarLunarWidget, loadHolidayData } from './lunar-widget';
import type { HolidayInfo } from './holiday-service';
import { WidgetTypeModal, type WidgetType } from './widget-type-modal';
import { StickyCardTypeModal } from './sticky-card-type-modal';
import { AddSectionModal } from './add-section-modal';
import { WeatherConfigModal } from './weather-config-modal';
import { LibraryConfigModal } from './library-config-modal';
import { FolderConfigModal, folderResultToLibraryConfig } from './folder-config-modal';
import { buildNewNoteProps, sectionNewNoteFolder, createNoteWithProps, pickFolderFromMenu, sectionTemplatePaths, pickTemplateFromMenu } from './library-new-note';
import { NotesSectionConfigModal } from './notes-config-modal';
import { DataviewConfigModal } from './dataview-config-modal';
import { WebConfigModal } from './web-config-modal';
import { RssConfigModal } from './rss-config-modal';
import { MediaConfigModal } from './media-config-modal';
import { WereadConfigModal } from './weread-config-modal';
import { fetchTickTickProjects } from './ticktick-config-modal';
import { TickTickFilterModal } from './ticktick-filter-modal';
import { TrackerConfigModal } from './tracker-config-modal';
import { TemplatePickerModal } from './template-modal';
import { PomodoroService } from './pomodoro-service';
import { createPomodoroMiniPanel, type PomodoroMiniPanel } from './pomodoro-mini-panel';
import { createReadingMiniTimer, type ReadingMiniTimer } from './reading-mini-timer';
import { ReadingService } from './reading-service';
import { ReminderNoticeModal } from './reminder-notice';
import { parseNoteDue } from './pipeline-model';
import { t } from './i18n';
import { archiveCompleted, serializeTasksForNote } from './task-tree';
import { getOrCreateDailyNote, ensureFolder } from './daily-notes';
import { createMemoNote } from './memo-note';
import type { App } from 'obsidian';
import { dashboardMarkdownPath, planDashboardUpdate, type DashboardUpdateSource } from './render-update';
import { captureScrollStates, restoreScrollStates, captureRootScrollState, restoreRootScrollState } from './scroll-preserve';
import { fileKind } from './file-types';

interface DailyNotesOptions {
	folder?: string;
	format?: string;
}

interface DailyNotesPlugin {
	enabled?: boolean;
	instance?: { options?: DailyNotesOptions };
}

/** Read the core "Daily notes" plugin handle (folder/format live on instance.options). */
function getDailyNotesPlugin(app: App): DailyNotesPlugin | undefined {
	const internalPlugins = (app as unknown as {
		internalPlugins?: { getPluginById?: (id: string) => DailyNotesPlugin | undefined };
	}).internalPlugins;
	return internalPlugins?.getPluginById?.('daily-notes');
}

/** Insert `block` right after the YAML frontmatter (or at the very top when there
 *  is none), preserving the original frontmatter text verbatim. */
function prependAfterFrontmatter(md: string, block: string): string {
	const fmMatch = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	if (fmMatch) {
		const header = fmMatch[0];
		const body = md.slice(header.length).replace(/^\s+/, '');
		return body ? `${header}${block}\n\n${body}` : `${header}${block}\n`;
	}
	const body = md.replace(/^\s+/, '');
	return body ? `${block}\n\n${body}` : `${block}\n`;
}

export const DASHBOARD_VIEW_TYPE = 'apex-dashboard-view';

export class DashboardView extends ItemView implements HoverParent {
	private plugin: DashboardPlugin;
	private sync: SyncEngine;
	private data: DashboardData | null = null;
	private cleanupFns: Array<() => void> = [];
	private dndCleanupFns: Array<() => void> = [];
	private suppressNextRender = false;
	private vaultEventRefs: Array<{ evt: Events; ref: unknown }> = [];
	private bannerStatsTimer: number | null = null;
	private bannerStatsEl: HTMLElement | null = null;
	/** Vault changes accumulated across one debounce window: every changed
	 *  file path (renames contribute old AND new), plus a broad flag for
	 *  folder-level events whose own path carries no section-scope meaning.
	 *  One shared trailing debounce fans them out — see scheduleVaultRefresh. */
	private vaultChangePaths = new Set<string>();
	private vaultChangeBroad = false;
	/** Newly created .md paths whose first metadataCache index hasn't landed
	 *  yet (see registerVaultListeners). */
	private pendingMdIndexPaths = new Set<string>();
	/** Md paths from the last flushed refresh batch: a metadataCache 'changed'
	 *  arriving for one of these means the cache was NOT ready when the
	 *  rebuild ran (frontmatter writes — pin/due/checklist — can index slower
	 *  than the 500ms vault debounce), so that rebuild read stale data and a
	 *  corrective pass is needed (see registerVaultListeners). */
	private mdCacheLagPaths = new Set<string>();
	private vaultRefreshTimer: number | null = null;
	private readonly VAULT_REFRESH_DEBOUNCE = 500;
	private readonly BANNER_STATS_DEBOUNCE = 800;
	/** True after the first `metadataCache` `resolved` event corrected the
	 *  banner stats following startup. One-shot to avoid repeat recomputes. */
	private bannerStatsResolvedOnce = false;
	private bannerQuoteIndex = 0;
	private static readonly BANNER_QUOTE_ROTATION_MS = 60 * 60 * 1000; // 1 hour (on the hour)
	// Poster cadence shared with the immersive background layer (banner.ts).
	private static readonly BANNER_IMAGE_ROTATION_MS = BANNER_IMAGE_ROTATION_MS_SHARED;
	private static readonly REMINDER_CHECK_MS = 60 * 1000; // 1 minute
	private static readonly BANNER_QUOTE_OFFSET_MS = 60 * 60 * 1000; // offset by 1 hour from image
	private reminderTimer: number | null = null;
	private firedReminders = new Set<string>();
	private sidebarPinned = this.app.loadLocalStorage('apex-dashboard-sidebar-pinned') === 'true';
	private sidebarExpanded = false;
	private bannerCollapsed = this.app.loadLocalStorage('apex-dashboard-banner-collapsed') === 'true';
	private pendingScrollCardId: string | null = null;
	private pendingScrollToLastCardOfColumn: string | null = null;
	private pomodoroService: PomodoroService | null = null;
	private pomodoroMiniPanel: PomodoroMiniPanel | null = null;
	private readingMiniTimer: ReadingMiniTimer | null = null;
	private readingService: ReadingService | null = null;
	private habitUnsubscribe: (() => void) | null = null;
	private expenseUnsubscribe: (() => void) | null = null;
	private musicUnsubscribe: (() => void) | null = null;
	private pomodoroUnsubscribe: (() => void) | null = null;
	private readingUnsubscribe: (() => void) | null = null;
	private holidayData: Record<string, HolidayInfo> = {};
	private mobileWidgetExpanded: 'pomodoro' | 'reading' | 'lunar' | 'calendar' | 'habit' | 'expense' | null = null;
	private mobileWidgetTabsOpen: boolean = false;
	private static readonly WEATHER_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
	private weatherRefreshTimer: number | null = null;
	private static readonly DAY_ROLLOVER_CHECK_MS = 60 * 1000; // 1 minute
	private dayRolloverTimer: number | null = null;
	private lastRenderedDay = new Date().toDateString();
	/** Sidebar widgets DOM detached from the previous render, re-attached when the
	 *  widget signature (see sidebarWidgetSignature) is unchanged - so dashboard
	 *  data mutations never rebuild the widgets. Null right after consumption. */
	private sidebarWidgetsEl: HTMLElement | null = null;
	private sidebarWidgetsSig: string | null = null;
	/** Immersive layout: per-widget card elements detached from the previous
	 *  grid, re-attached tile-by-tile when the widget signature is unchanged
	 *  (the grid has no whole-area container to preserve — cards are individual
	 *  tiles). Same signature gate as sidebarWidgetsEl. */
	private immWidgetEls: Map<string, HTMLElement> = new Map();
	/** The immersive arrangement as last rendered (order + spans) — the commit
	 *  baseline for optimistic drag/resize updates. */
	private immItems: import('./types').ImmersiveItem[] = [];
	private isOpening = false;
	private isOpen = false;
	private lifecycleRevision = 0;
	private pendingInitialData: DashboardData | null = null;

	// HoverParent contract: Obsidian assigns/clears this when showing a Page
	// Preview popover over a dashboard link. Declared so the dashboard can act as
	// the hover owner for `hover-link` events.
	hoverPopover: HoverPopover | null = null;

	// The currently-open centered note editor popover, if any. Tracked so it can
	// be torn down (detaching its embedded leaf) when the view closes.
	private popoverModal: NotePopoverModal | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.sync = new SyncEngine(this.app, this.plugin.settings);
		this.sync.onDataUpdate((data, source) => {
			this.handleDataUpdate(data, source);
		});
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	/** Per-workspace layout switch (settings picker / switcher menu): write
	 *  THIS board file's `layout:` override. The engine echo re-renders the
	 *  whole board via planDashboardUpdate's layout trigger; other open views
	 *  on the same file pick it up through their own file watchers. */
	async setBoardLayout(layout: import('./types').DashboardLayoutMode | undefined): Promise<void> {
		await this.sync.updateLayout(layout);
	}

	/** The board file this view is currently rendering (settings UI reads the
	 *  active layout from here). */
	getBoardData(): DashboardData | null {
		return this.sync.getData();
	}

	getDisplayText(): string {
		return t('main.dashboard');
	}

	getIcon(): string {
		return 'home';
	}

	async onOpen(): Promise<void> {
		if (this.isOpening || this.isOpen) return;
		this.isOpening = true;
		const revision = ++this.lifecycleRevision;
		this.sync.updateSettings(this.plugin.settings);
		await this.sync.init();
		if (revision !== this.lifecycleRevision) return;
		// The banner "streak" auto-detects the Daily Notes core plugin, whose
		// internal-plugins state may report as not-yet-enabled during the very
		// first render. Re-compute once the metadata cache has fully resolved so
		// the number never flashes an incorrect value from the startup race.
		// One-shot guard: `resolved` can fire repeatedly on large vaults.
		this.registerEvent(this.app.metadataCache.on('resolved', () => {
			if (this.bannerStatsResolvedOnce) return;
			this.bannerStatsResolvedOnce = true;
			// Sections rendered before the cache resolved may hold partially
			// indexed frontmatter; their path+mtime signatures cannot see that,
			// so drop them to force a rebuild on the next vault event.
			invalidateScanningSectionSignatures();
			this.debouncedRefreshBannerStats();
		}));
		this.pomodoroService = new PomodoroService(this.plugin);
		this.readingService = new ReadingService(this.plugin);
		const holidayDataPromise = loadHolidayData(this.app);
		// Load both data files in parallel — on mobile either can block on an
		// iCloud download, and the old serial awaits stacked both waits into
		// view-open time. Holiday data may require a network request, so it must
		// never hold the first dashboard render hostage.
		await Promise.all([
			this.pomodoroService.loadSessions(),
			this.readingService.loadSessions(),
		]);
		if (revision !== this.lifecycleRevision) return;
		// Body-level floating countdown pill; polls the service on its own so
		// it survives sidebar re-renders and stays up while other tabs show.
		this.pomodoroMiniPanel = createPomodoroMiniPanel(
			this.plugin,
			this.pomodoroService,
			this.containerEl.ownerDocument,
		);
		// Tiny top-right elapsed-time pill while a reading session runs; its
		// stop button opens the same end-of-reading flow as the sidebar card.
		this.readingMiniTimer = createReadingMiniTimer(
			this.readingService,
			this.containerEl.ownerDocument,
		);
		// Habit data is plugin-level: every open view subscribes so a check-in
		// in one view refreshes the widget and banner in all of them.
		this.habitUnsubscribe = getHabitService()?.subscribe(() => this.onHabitChanged()) ?? null;
		this.expenseUnsubscribe = getExpenseService()?.subscribe(() => this.onExpenseChanged()) ?? null;
		// Music is desktop-only (no service on mobile → null subscription).
		this.musicUnsubscribe = getMusicService()?.subscribe(() => this.onMusicChanged()) ?? null;
		// Focus re-sync merges another device's records and notifies — refresh
		// the pomodoro/reading widgets without restarting the timers.
		this.pomodoroUnsubscribe = this.pomodoroService.subscribe(() => this.onPomodoroDataChanged());
		this.readingUnsubscribe = this.readingService.subscribe(() => this.onReadingDataChanged());
		this.registerVaultListeners();
		this.startReminderChecker();
		this.startWeatherRefresh();
		this.startDayRolloverChecker();
		this.isOpen = true;
		this.isOpening = false;
		const initialData = this.pendingInitialData ?? this.sync.getData();
		this.pendingInitialData = null;
		if (initialData) this.render(initialData);
		void holidayDataPromise.then((data) => {
			if (revision !== this.lifecycleRevision || !this.isOpen) return;
			this.holidayData = data;
			this.refreshLunarWidgetsInPlace();
		});
	}

	async onClose(): Promise<void> {
		this.lifecycleRevision++;
		this.isOpening = false;
		this.isOpen = false;
		this.pendingInitialData = null;
		this.popoverModal?.close();
		this.popoverModal = null;
		this.runCleanup();
		this.unregisterVaultListeners();
		this.stopReminderChecker();
		this.stopWeatherRefresh();
		this.stopDayRolloverChecker();
		this.pomodoroMiniPanel?.destroy();
		this.pomodoroMiniPanel = null;
		this.readingMiniTimer?.destroy();
		this.readingMiniTimer = null;
		this.pomodoroService?.destroy();
		this.pomodoroService = null;
		this.readingService?.destroy();
		this.readingService = null;
		this.habitUnsubscribe?.();
		this.habitUnsubscribe = null;
		this.expenseUnsubscribe?.();
		this.expenseUnsubscribe = null;
		this.musicUnsubscribe?.();
		this.musicUnsubscribe = null;
		this.pomodoroUnsubscribe?.();
		this.pomodoroUnsubscribe = null;
		this.readingUnsubscribe?.();
		this.readingUnsubscribe = null;
		this.sync.destroy();
	}

	private handleDataUpdate(data: DashboardData, source: DashboardUpdateSource): void {
		const previous = this.data;
		this.data = data;
		if (this.isOpening || !this.isOpen) {
			this.pendingInitialData = data;
			return;
		}
		if (this.suppressNextRender) {
			this.suppressNextRender = false;
			return;
		}

		const plan = planDashboardUpdate(previous, data, source);
		if (plan.kind === 'none') return;
		if (plan.kind === 'sections') {
			// A height-only change on a calendar or web section is already live
			// in the DOM (the resize handle writes the inline height as it
			// drags); rebuilding would reset the calendar's month/week navigation
			// or reload the web section's embedded page for no gain.
			// Skip those; every other change re-renders as usual.
			const buildable = plan.names.filter((name) => {
				if (!previous) return true;
				const idx = data.columns.findIndex(c => c.name === name);
				const before = previous.columns[idx];
				const after = data.columns[idx];
				if (!before || !after || (after.sectionType !== 'calendar' && after.sectionType !== 'web')) return true;
				return JSON.stringify({ ...before, height: undefined }) !== JSON.stringify({ ...after, height: undefined });
			});
			if (buildable.length === 0) return;
			const refreshed = buildable.every((name) => this.refreshSectionInPlace(name));
			if (refreshed) return;
		}
		this.render(data);
	}

	async refresh(): Promise<void> {
		this.sync.updateSettings(this.plugin.settings);
		const data = this.sync.getData();
		if (data) {
			this.render(data);
		}
	}

	/** Reload the dashboard file from disk (e.g. after a backup restore) and
	 *  re-render. The sync engine re-reads and notifies, which triggers render. */
	async reloadFromDisk(): Promise<void> {
		await this.sync.reloadFromDisk();
	}

	/** Re-point this view's engine at the (already-updated) active workspace and
	 *  reload. Called by the plugin after any workspace switch/registry change.
	 *  Settings objects are replaced (not mutated) on every save, so the fresh
	 *  reference must be pushed into the engine before it re-resolves the file. */
	async applyWorkspaceSwitch(): Promise<void> {
		this.sync.updateSettings(this.plugin.settings);
		await this.sync.switchFile();
	}

	async addSection(): Promise<void> {
		const name = await showPromptDialog(this.app, { title: t('renderer.sectionName') });
		if (name) {
			void this.sync.addColumn(name);
		}
	}

	/** Flip the banner between poster & quotes and the stats dashboard.
	 *  updateBanner persists the new mode and re-renders via the sync callback. */
	async toggleBannerMode(): Promise<void> {
		const data = this.sync.getData();
		if (!data) return;
		const nextMode = data.banner.mode === 'stats' ? 'quote' : 'stats';
		await this.sync.updateBanner({ mode: nextMode });
		new Notice(nextMode === 'stats' ? t('main.bannerModeStats') : t('main.bannerModeQuote'));
	}

	private render(data: DashboardData): void {
		// Snapshot EVERY scrolled container (stacked region, board, sidebar
		// rail, widget deck, card decks, task lists, widget internals — and the
		// root itself, which scrolls on mobile) before any teardown. Keyed by
		// card/widget/column anchors, so the replay at the end survives
		// reorders. The previous targeted saves missed the stacked widget deck:
		// detaching/re-attaching the widgets container resets scroll state, so
		// every re-render jumped the deck back to its first column. This must
		// run BEFORE the widgets detach below, while the deck is still in the
		// tree.
		const prevRoot = this.containerEl.children[1] as HTMLElement | undefined;
		const savedRootScroll = captureRootScrollState(prevRoot ?? createDiv());
		const layout = resolveEffectiveLayout(this.plugin.settings, this.data);
		// Detach the sidebar widgets before tearing the rest down. If their
		// inputs (signature below) are unchanged, this exact node is re-attached
		// in renderSidebar instead of being rebuilt - dashboard data mutations
		// then cost nothing for the widgets (calendar keeps its month navigation,
		// countdowns keep ticking, no vault re-scan). The immersive grid has no
		// whole-area container: its cards are individual tiles, so they detach
		// into a per-key map instead (renderImmersiveRoot re-attaches them).
		if (layout === 'immersive') {
			this.immWidgetEls = new Map();
			const prevGrid = prevRoot?.querySelector<HTMLElement>('.dashboard-imm .dashboard-kanban');
			prevGrid?.querySelectorAll<HTMLElement>(':scope > [data-widget-key]').forEach(el => {
				el.remove();
				const key = el.dataset.widgetKey;
				if (key) this.immWidgetEls.set(key, el);
			});
		} else {
			const oldWidgets = prevRoot?.querySelector('.dashboard-sidebar-widgets');
			if (oldWidgets instanceof HTMLElement) {
				oldWidgets.remove();
				this.sidebarWidgetsEl = oldWidgets;
			}
		}
		const widgetSig = sidebarWidgetSignature(
			this.plugin.settings,
			!!this.pomodoroService,
			!!this.readingService,
			!!this.holidayData && Object.keys(this.holidayData).length > 0,
			JSON.stringify([data.quickActions, data.quickActionOrder, data.hiddenPresets]),
			data,
		);
		const preserveWidgets = layout === 'immersive'
			? this.immWidgetEls.size > 0 && this.sidebarWidgetsSig === widgetSig
			: !!this.sidebarWidgetsEl && this.sidebarWidgetsSig === widgetSig;

		// The live-DOM scope destroy functions must leave alone: one element
		// (side/stacked widgets area) or a per-card set (immersive tiles).
		const preserveScope: HTMLElement | Set<HTMLElement> | null = preserveWidgets
			? (layout === 'immersive' ? new Set(this.immWidgetEls.values()) : this.sidebarWidgetsEl)
			: null;
		this.runCleanup(preserveScope);
		this.data = data;
		this.firedReminders.clear();
		this.sidebarWidgetsSig = widgetSig;

		const container = this.containerEl.children[1] as HTMLElement;

		// Sweep any touch-drag ghost clones stranded on activeDocument.body from a prior
		// interrupted drag (touchcancel). They live outside the container, so
		// container.empty() cannot reach them.
		activeDocument.body.querySelectorAll(':scope > .dashboard-card--ghost').forEach((el) => el.remove());

		container.empty();
		container.addClass('apex-dashboard-root');
		container.setAttribute('data-theme', this.plugin.settings.stylePreset);
		// Layout mode rides on an attribute so CSS owns the switch. Phones
		// always report 'side' (resolveEffectiveLayout excludes them) so their
		// DOM and CSS stay byte-identical regardless of this desktop-only
		// setting. The immersive layout replaces the banner/sidebar pipeline
		// entirely (see renderImmersiveRoot); before that lands it renders
		// through the side-shaped path, and only [data-layout="stacked"] CSS
		// keys off this attribute.
		container.setAttribute('data-layout', resolveEffectiveLayout(this.plugin.settings, this.data));

		// Apply user appearance overrides (background image layer + custom colors).
		// Must run after data-theme so inline `--db-*` overrides win by specificity,
		// and before banner/main are created so the bg layer sits behind content.
		applyAppearance(container, this.app, this.plugin.settings);

		// The immersive layout replaces the whole banner/sidebar pipeline: the
		// poster becomes a fixed full-bleed background, the week calendar and
		// quick-notes bar move into a pinned top region, and widgets + sections
		// mix in one free grid (still on a .dashboard-kanban host, so every
		// kanban-rooted mechanism keeps working).
		let boardHost: HTMLElement;
		if (layout === 'immersive') {
			const imm = renderImmersiveRoot({
				container,
				data,
				settings: this.plugin.settings,
				app: this.app,
				plugin: this.plugin,
				services: {
					pomodoroService: this.pomodoroService ?? undefined,
					readingService: this.readingService ?? undefined,
					holidayData: this.holidayData ?? undefined,
					onOpenNote: (file, line) => this.openNote(file, undefined, line),
					renderQuickActions: (host) => this.renderQuickActionsWidget(host),
				},
				callbacks: this.createCallbacks(),
				hoverParent: this,
				reuseWidgets: preserveWidgets ? this.immWidgetEls : null,
				getItems: () => this.immItems,
				onEditBanner: () => this.openBannerEditModal(data),
				registerCleanup: fn => this.cleanupFns.push(fn),
			});
			this.immItems = imm.items;
			this.immWidgetEls = imm.widgetEls;
			this.bannerStatsEl = null;
			boardHost = imm.grid;
			setupImmersiveDnD(imm.grid, () => this.immItems, next => this.commitImmersiveItems(next), this.dndCleanupFns);
			setupImmersiveTileMenu(imm.grid, id => void this.removeImmersiveItem(id), this.dndCleanupFns);
			this.attachImmersiveResizeHandles(imm.grid);
		} else {
			const bannerEl = renderBanner(
				container,
				data.banner,
				() => this.openBannerEditModal(data),
				this.app,
			);
			// Capture the stats panel (only present in stats mode) so vault changes
			// can refresh it in place without a full re-render.
			this.bannerStatsEl = bannerEl.querySelector('.dashboard-banner-stats');

			this.renderMobileActions(bannerEl);
			// Workspace switcher — banner, at the top-left corner of the stats
			// view's CENTER column (the CSS mirrors the stats grid: 20px panel
			// padding + 1/5 of the content width = the center column's left edge).
			// Rebuilt every render so the active highlight always matches settings.
			renderWorkspaceSwitcher(bannerEl, this.plugin);

			// Sidebar pin — desktop-only, bottom-left corner of the banner. Moved
			// here out of the quick-actions header because quick buttons became a
			// hideable sidebar widget (the pin must survive hiding them).
			this.renderBannerPinButton(bannerEl);

			if (this.bannerCollapsed && window.innerWidth > 640) {
				bannerEl.addClass('dashboard-banner--collapsed');
			}
			this.setupBannerBehavior(bannerEl);

			// Banner quote rotation
			this.setupBannerRotation(container, data.banner);

			this.renderMobileWidgetBar(container);

			const mainLayout = container.createDiv({ cls: 'dashboard-main' });

			// Stacked layout: the quick-notes work bar (capture pill, today note,
			// chips) moves OUT of the kanban to sit directly under the banner,
			// above the widget strip — the kanban sits below the strip there, so
			// its usual top slot would land the bar beneath the widgets. The side
			// layout keeps rendering it inside the kanban as before.
			//
			// Scroll model: the bar stays PINNED, while the widget deck and the
			// board scroll TOGETHER inside one region below it (the user wheels
			// through widgets and sections as one page). The side layout keeps the
			// old split (rail scrolls alone, board scrolls alone).
			const stacked = isStackedLayout(this.plugin.settings, this.data);
			if (stacked && this.plugin.settings.quickNotesEnabled) {
				renderQuickNoteRegion(mainLayout, this.plugin.settings, this.createCallbacks());
			}
			const contentHost = stacked
				? mainLayout.createDiv({ cls: 'dashboard-scroll-region' })
				: mainLayout;

			// Rail state classes apply in BOTH layouts: in stacked mode they carry
			// strip semantics instead (collapse to a slim bar, expand on click,
			// pin keeps it open) via the [data-layout="stacked"] CSS overrides.
			const sidebar = contentHost.createDiv({ cls: 'dashboard-sidebar' });
			if (this.sidebarPinned) {
				sidebar.addClass('dashboard-sidebar--pinned');
			} else if (this.sidebarExpanded) {
				sidebar.addClass('dashboard-sidebar--expanded');
			} else {
				sidebar.addClass('dashboard-sidebar--collapsed');
			}
			this.applySidebarSizing(sidebar);
			this.renderSidebar(sidebar, container, preserveWidgets ? this.sidebarWidgetsEl : null);
			this.setupSidebarBehavior(sidebar, container);

			// Two-layer board: a NON-scrolling wrapper around the scrolling
			// .dashboard-kanban. (The switcher itself lives on the banner; the split
			// stays because it gives the scroll layer a clean, non-scrolling host.)
			const kanbanWrapper = contentHost.createDiv({ cls: 'dashboard-kanban-wrapper' });
			const kanban = kanbanWrapper.createDiv({ cls: 'dashboard-kanban' });
			renderDashboard(kanban, data, this.createCallbacks(), this.app, this.plugin.settings, this, { skipQuickNotes: stacked });
			boardHost = kanban;
		}
		// The immersive grid owns section geometry; its section grip becomes a
		// whole-tile reorder handle (setupImmersiveDnD), so the side/stacked
		// grip-reorder wiring is skipped there. Card drags stay armed in both.
		setupDragAndDrop(boardHost, this.createCallbacks(), this.dndCleanupFns, { skipSectionGrip: layout === 'immersive' });
		this.attachBoardEventDelegation(boardHost);

		// Replay the pre-render scroll snapshot onto the rebuilt tree. Keys that
		// no longer resolve (a genuinely new structure) are skipped inside the
		// restore; the pendingScroll blocks below may then re-scroll on purpose.
		restoreRootScrollState(container, savedRootScroll);

		// Scroll to newly added card
		if (this.pendingScrollCardId) {
			const cardEl = container.querySelector(`[data-card-id="${this.pendingScrollCardId}"]`);
			if (cardEl) {
				window.requestAnimationFrame(() => {
					cardEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
				});
			}
			this.pendingScrollCardId = null;
		}
		if (this.pendingScrollToLastCardOfColumn) {
			const colName = this.pendingScrollToLastCardOfColumn;
			const sectionRow = container.querySelector(`[data-column="${colName}"]`);
			if (sectionRow) {
				const cards = sectionRow.querySelectorAll('.dashboard-card');
				const lastCard = cards[cards.length - 1];
				if (lastCard) {
					window.requestAnimationFrame(() => {
						lastCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
					});
				}
			}
			this.pendingScrollToLastCardOfColumn = null;
		}

		this.renderScrollToTop(container);
	}

	/** Quick-buttons widget card builder — one implementation shared by the
	 *  sidebar rail (side/stacked) and the immersive grid. */
	private renderQuickActionsWidget(container: HTMLElement): void {
		if (!this.data) return;
		renderQuickActions(
			container,
			this.data.quickActions,
			(action) => { void this.executeAction(action); },
			(index) => {
				void showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) void this.sync.removeQuickAction(index);
				});
			},
			() => this.openAddActionModal(),
			this.data.quickActionOrder,
			(order) => { void this.sync.reorderQuickActions(order); },
			(key) => {
				void showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) void this.sync.removeQuickActionByKey(key);
				});
			},
			this.data.hiddenPresets,
			(action) => this.openEditActionModal(action),
			{
				bg: this.plugin.settings.quickButtonsBgColor,
				btn: this.plugin.settings.quickButtonsBtnColor,
				onChange: (kind, color) => {
					void (async () => {
						this.plugin.settings = {
							...this.plugin.settings,
							...(kind === 'bg'
								? { quickButtonsBgColor: color ?? undefined }
								: { quickButtonsBtnColor: color ?? undefined }),
						};
						await this.plugin.saveSettings();
					})();
				},
			},
		);
	}

	/** Section-internal events bubbling to the board host (the kanban, shared
	 *  by the side/stacked wrapper and the immersive grid). Registered once per
	 *  render on whichever host the active layout produced. */
	private attachBoardEventDelegation(board: HTMLElement): void {
		// Library config event delegation
		board.addEventListener('dashboard-library-config', ((e: CustomEvent) => {
			const { columnName } = e.detail as { columnName: string };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col?.sectionType === 'folder') {
				this.openFolderConfigModal(columnName);
			} else if (col?.sectionType === 'weread') {
				this.openWereadConfigModal(columnName);
			} else if (col?.sectionType === 'dataview') {
				this.openDataviewConfigModal(columnName);
			} else if (col?.sectionType === 'web') {
				this.openWebConfigModal(columnName);
			} else if (col?.sectionType === 'rss') {
				this.openRssConfigModal(columnName);
			} else if (col?.sectionType === 'pipeline') {
				this.openPipelineConfigModal(columnName);
			} else if (col?.sectionType === 'images' || col?.sectionType === 'videos') {
				this.openMediaConfigModal(columnName);
			} else if (col?.sectionType === 'projects') {
				this.openNotesSectionConfigModal(columnName);
			} else {
				this.openLibraryConfigModal(columnName);
			}
		}) as EventListener);

		// RSS page-size change — dispatched from the section toolbar select.
		board.addEventListener('dashboard-rss-page-size', ((e: CustomEvent) => {
			const { columnName, pageSize } = e.detail as { columnName: string; pageSize: number };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col?.rssConfig && typeof pageSize === 'number') {
				const next = { ...col.rssConfig, pageSize };
				void this.sync.updateRssConfig(columnName, next).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			}
		}) as EventListener);

		// Pipeline value-filter rail pick — persists into the section config
		// and refreshes in place (the config change also busts the signature).
		board.addEventListener('dashboard-pipeline-filter', ((e: CustomEvent) => {
			const { columnName, filter } = e.detail as { columnName: string; filter?: { dim: string; value?: string } };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (!col?.pipelineConfig) return;
			const next = { ...col.pipelineConfig, filter };
			void this.sync.updatePipelineConfig(columnName, next).then(() => {
				this.refreshSectionInPlace(columnName);
			});
		}) as EventListener);

		// Pipeline card sort — native-menu pick persists and refreshes in place.
		board.addEventListener('dashboard-pipeline-sort', ((e: CustomEvent) => {
			const { columnName, sortBy } = e.detail as { columnName: string; sortBy?: 'ctime' | 'platform' };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (!col?.pipelineConfig) return;
			const next = { ...col.pipelineConfig, sortBy };
			void this.sync.updatePipelineConfig(columnName, next).then(() => {
				this.refreshSectionInPlace(columnName);
			});
		}) as EventListener);

		// Pipeline column width — dragged column edge persists per stage.
		board.addEventListener('dashboard-pipeline-col-width', ((e: CustomEvent) => {
			const { columnName, stageValue, width } = e.detail as { columnName: string; stageValue: string; width: number };
			const col = this.data?.columns.find(c => c.name === columnName);
			const config = col?.pipelineConfig;
			if (!config || typeof width !== 'number') return;
			const next = {
				...config,
				stages: config.stages.map(stage => stage.value === stageValue ? { ...stage, width } : stage),
			};
			void this.sync.updatePipelineConfig(columnName, next);
		}) as EventListener);

		// Library/folder "new note" button — dispatched from the section toolbar.
		board.addEventListener('dashboard-library-new-note', ((e: CustomEvent) => {
			const { columnName, x, y } = e.detail as { columnName: string; x?: number; y?: number };
			const pos = (typeof x === 'number' && typeof y === 'number') ? { x, y } : undefined;
			void this.handleLibraryNewNote(columnName, pos);
		}) as EventListener);

		// TickTick view toggle (today/lists) — dispatched from header buttons.
		board.addEventListener('dashboard-ticktick-view', ((e: CustomEvent) => {
			const { columnName, view } = e.detail as { columnName: string; view: 'today' | 'lists' };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col) {
				const config = col.ticktickConfig ?? { view: 'today' as const };
				this.suppressNextRender = true;
				void this.sync.updateTickTickConfig(columnName, { ...config, view }).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			}
		}) as EventListener);

		// TickTick project filter (lists view).
		board.addEventListener('dashboard-ticktick-filter', ((e: CustomEvent) => {
			const { columnName } = e.detail as { columnName: string };
			void this.openTickTickFilterModal(columnName);
		}) as EventListener);

		// TickTick project card resize (lists view).
		board.addEventListener('dashboard-ticktick-resize', ((e: CustomEvent) => {
			const { columnName, projectWidths } = e.detail as { columnName: string; projectWidths: Record<string, number> };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col?.ticktickConfig) {
				this.suppressNextRender = true;
				void this.sync.updateTickTickConfig(columnName, { ...col.ticktickConfig, projectWidths }).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			}
		}) as EventListener);
	}

	/** Corner resize grips + hover delete buttons for every current grid tile
	 *  (both idempotent — a tile that already carries them is skipped).
	 *  Re-run after refreshSectionInPlace swaps a section node. */
	private attachImmersiveResizeHandles(grid: HTMLElement): void {
		for (const child of Array.from(grid.children)) {
			const el = child as HTMLElement;
			const id = el.dataset?.immId;
			if (!id) continue;
			attachImmersiveResizeHandle(el, id, () => this.immItems, next => this.commitImmersiveItems(next));
			if (id.startsWith('widget:')) {
				attachImmersiveWidgetDelete(el, removeId => void this.removeImmersiveItem(removeId));
			}
		}
	}

	/** Apply a user-dragged immersive arrangement optimistically (content-fit
	 *  repack: measure → cap → pack → pure DOM moves; live widgets keep
	 *  running) and persist it. The engine write's own render echo is
	 *  swallowed via suppressNextRender and the vault-watcher reload no-ops on
	 *  the serialize-equality check — the handleMoveCard recipe. */
	private commitImmersiveItems(next: ImmersiveItem[]): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const grid = root?.querySelector<HTMLElement>('.dashboard-imm .dashboard-kanban');
		if (grid) {
			// force: a reorder changes no heights, but the DOM order must be
			// rewritten (the fit's unchanged-measurements shortcut would skip).
			refitImmersiveGrid(grid, next, true);
		}
		this.immItems = next;
		this.suppressNextRender = true;
		void this.sync.updateImmersive(next);
	}

	private renderMobileActions(bannerEl: HTMLElement): void {
		const actions = bannerEl.createDiv({ cls: 'dashboard-mobile-actions' });

		const linksBtn = actions.createEl('button', {
			cls: 'dashboard-mobile-action-btn',
			attr: { 'aria-label': t('mobile.quickActions') },
		});
		setIcon(linksBtn, 'zap');
		linksBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openMobileDrawer('quickActions');
		});

		const recentBtn = actions.createEl('button', {
			cls: 'dashboard-mobile-action-btn',
			attr: { 'aria-label': t('mobile.recent') },
		});
		setIcon(recentBtn, 'clock');
		recentBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openMobileDrawer('recent');
		});

		// On mobile, tapping right half of banner reveals the edit button
		const overlay = bannerEl.querySelector('.dashboard-banner-overlay') as HTMLElement;
		if (overlay) {
			overlay.addEventListener('click', (e) => {
				const rect = overlay.getBoundingClientRect();
				const tapX = e.clientX - rect.left;
				if (tapX > rect.width * 0.5) {
					const editBtn = overlay.querySelector('.dashboard-banner-edit-btn') as HTMLElement;
					if (editBtn) {
						editBtn.addClass('dashboard-banner-edit-btn--mobile-visible');
					}
				}
			});
		}
	}

	private renderMobileWidgetBar(container: HTMLElement): void {
		this.mobileWidgetTabsOpen = false;
		this.mobileWidgetExpanded = null;

		const bar = container.createDiv({ cls: 'dashboard-mobile-widget-bar' });

		// Thin strip: collapsed state, tap to expand tabs
		const strip = bar.createDiv({ cls: 'dashboard-mobile-widget-strip' });
		strip.createDiv({ cls: 'dashboard-mobile-widget-strip-hint' });
		strip.addEventListener('click', (e) => {
			e.stopPropagation();
			this.mobileWidgetTabsOpen = !this.mobileWidgetTabsOpen;
			if (!this.mobileWidgetTabsOpen) {
				this.mobileWidgetExpanded = null;
			}
			this.refreshMobileWidgetPanel(bar);
		});

		// Tab row: hidden by default, revealed by tapping strip
		const tabs = bar.createDiv({ cls: 'dashboard-mobile-widget-tabs' });

		const widgets: Array<{ key: 'pomodoro' | 'reading' | 'lunar' | 'calendar' | 'habit' | 'expense'; label: string; icon: string }> = [
			{ key: 'lunar', label: t('mobile.lunar'), icon: 'moon' },
			...(this.plugin.settings.widgetCalendarEnabled
				? [{ key: 'calendar' as const, label: t('mobile.calendar'), icon: 'calendar' }]
				: []),
			{ key: 'pomodoro', label: t('mobile.pomodoro'), icon: 'hourglass' },
			...(this.plugin.settings.widgetHabitEnabled
				? [{ key: 'habit' as const, label: t('mobile.habit'), icon: 'check-circle-2' }]
				: []),
			...(this.plugin.settings.widgetExpenseEnabled
				? [{ key: 'expense' as const, label: t('mobile.expense'), icon: 'wallet' }]
				: []),
			{ key: 'reading', label: t('mobile.reading'), icon: 'book-open' },
		];

		bar.createDiv({ cls: 'dashboard-mobile-widget-panel' });

		for (const w of widgets) {
			const btn = tabs.createEl('button', {
				cls: 'dashboard-mobile-widget-btn',
				attr: { 'aria-label': w.label },
			});
			setIcon(btn, w.icon);

			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.mobileWidgetExpanded === w.key) {
					this.mobileWidgetExpanded = null;
				} else {
					this.mobileWidgetExpanded = w.key;
				}
				this.refreshMobileWidgetPanel(bar);
			});

			btn.dataset.widgetKey = w.key;
		}

		this.refreshMobileWidgetPanel(bar);
	}

	private refreshMobileWidgetPanel(bar: HTMLElement): void {
		const strip = bar.querySelector('.dashboard-mobile-widget-strip');
		const tabs = bar.querySelector('.dashboard-mobile-widget-tabs');
		const panel = bar.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (!strip || !tabs || !panel) return;

		// Toggle strip active state
		strip.classList.toggle('dashboard-mobile-widget-strip--active', this.mobileWidgetTabsOpen);

		// Toggle tabs visibility
		tabs.classList.toggle('dashboard-mobile-widget-tabs--open', this.mobileWidgetTabsOpen);

		// Update button active states
		tabs.querySelectorAll('.dashboard-mobile-widget-btn').forEach((btn) => {
			const el = btn as HTMLElement;
			el.classList.toggle('active', el.dataset.widgetKey === this.mobileWidgetExpanded);
		});

		// Render panel content
		panel.empty();

		if (!this.mobileWidgetExpanded) {
			panel.removeClass('dashboard-mobile-widget-panel--open');
			return;
		}

		panel.addClass('dashboard-mobile-widget-panel--open');

		if (this.mobileWidgetExpanded === 'pomodoro' && this.pomodoroService) {
			renderSidebarPomodoro(panel, this.pomodoroService, this.plugin.settings, this.app);
		} else if (this.mobileWidgetExpanded === 'reading' && this.readingService) {
			renderSidebarReading(panel, this.readingService);
		} else if (this.mobileWidgetExpanded === 'lunar') {
			renderSidebarLunarWidget(panel, this.holidayData, this.app);
		} else if (this.mobileWidgetExpanded === 'calendar') {
			// The tab tap is explicit intent: autoLoad skips the phone deferred-scan
			// placeholder so the grid (and its dots) appear without a second tap.
			renderSidebarCalendar(
				panel,
				this.plugin.settings,
				this.app,
				(file, line) => this.openNote(file, undefined, line),
				{ autoLoad: true },
			);
		} else if (this.mobileWidgetExpanded === 'habit') {
			renderSidebarHabitWidget(panel, this.app);
		} else if (this.mobileWidgetExpanded === 'expense') {
			renderSidebarExpenseWidget(panel, this.app);
		}
	}

	private setupBannerBehavior(bannerEl: HTMLElement): void {
		const pinBtn = bannerEl.createEl('button', {
			cls: 'dashboard-banner-pin-btn',
			attr: { 'aria-label': 'Toggle banner' },
		});
		setIcon(pinBtn, 'bookmark');

		pinBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (window.innerWidth <= 640) return;
			this.bannerCollapsed = !this.bannerCollapsed;
			bannerEl.toggleClass('dashboard-banner--collapsed', this.bannerCollapsed);
			this.app.saveLocalStorage('apex-dashboard-banner-collapsed', String(this.bannerCollapsed));
		});

		const onResize = () => {
			if (window.innerWidth <= 640 && this.bannerCollapsed) {
				bannerEl.removeClass('dashboard-banner--collapsed');
			} else if (this.bannerCollapsed) {
				bannerEl.addClass('dashboard-banner--collapsed');
			}
		};
		window.addEventListener('resize', onResize);
		this.cleanupFns.push(() => window.removeEventListener('resize', onResize));
	}

	private setupBannerRotation(container: HTMLElement, banner: BannerData): void {
		// Quote rotation — stats mode has no quote text to rotate.
		if (banner.mode !== 'stats') {
			const quotes = banner.quotes;
			if (quotes && quotes.length > 1) {
				// Offset by 1 hour so quote and image swaps don't overlap
				const quoteIndex = Math.floor((Date.now() + DashboardView.BANNER_QUOTE_OFFSET_MS) / DashboardView.BANNER_QUOTE_ROTATION_MS) % quotes.length;
				this.bannerQuoteIndex = quoteIndex;

				const quoteEl = container.querySelector('.dashboard-banner-quote') as HTMLElement;
				const authorEl = container.querySelector('.dashboard-banner-author') as HTMLElement;
				if (quoteEl && authorEl) {
					const initial = quotes[quoteIndex]!;
					quoteEl.textContent = initial.quote;
					authorEl.textContent = initial.author;

					const rotateQuote = () => {
						this.bannerQuoteIndex = (this.bannerQuoteIndex + 1) % quotes.length;
						const next = quotes[this.bannerQuoteIndex]!;

						quoteEl.addClass('dashboard-banner-quote--fading');
						authorEl.addClass('dashboard-banner-author--fading');

						window.setTimeout(() => {
							quoteEl.textContent = next.quote;
							authorEl.textContent = next.author;
							quoteEl.removeClass('dashboard-banner-quote--fading');
							authorEl.removeClass('dashboard-banner-author--fading');
						}, 400);
					};

					const quoteTimer = window.setInterval(rotateQuote, DashboardView.BANNER_QUOTE_ROTATION_MS);
					this.cleanupFns.push(() => window.clearInterval(quoteTimer));
				}
			}
		}

		// Image rotation — applies to both quote and stats modes (stats uses the
		// same .dashboard-banner background, so it rotates identically). The
		// shared time-seed rotator also drives the immersive background layer.
		const bannerEl = container.querySelector('.dashboard-banner') as HTMLElement | null;
		if (bannerEl) {
			startBannerImageRotation(bannerEl, banner, this.app, DashboardView.BANNER_IMAGE_ROTATION_MS, fn => this.cleanupFns.push(fn));
		}
	}

	private openMobileDrawer(type: 'quickActions' | 'recent'): void {
		this.closeMobileDrawer();

		const root = this.containerEl.children[1] as HTMLElement;
		if (!root) return;

		const firstSection = root.querySelector('.dashboard-section-row') as HTMLElement;
		const drawerTop = firstSection ? firstSection.getBoundingClientRect().top : 0;

		const drawer = root.createDiv({ cls: 'dashboard-mobile-drawer' });
		drawer.style.top = `${drawerTop}px`;

		const content = drawer.createDiv({ cls: 'dashboard-mobile-drawer-content' });

		if (type === 'quickActions') {
			content.createEl('h4', { text: t('mobile.quickActions'), cls: 'dashboard-mobile-drawer-title' });
			if (this.data) {
				renderQuickActions(
					content,
					this.data.quickActions,
					(action) => { void this.executeAction(action); this.closeMobileDrawer(); },
					(index) => {
						void (async () => {
							const confirmed = await showConfirmDialog(this.app, {
								title: t('common.confirmDelete'),
								message: t('common.confirmDeleteMessage'),
							});
							if (!confirmed) return;
							void this.sync.removeQuickAction(index);
						})();
					},
					() => this.openAddActionModal(),
					this.data.quickActionOrder,
					(order) => { void this.sync.reorderQuickActions(order); },
					(key) => {
						void (async () => {
							const confirmed = await showConfirmDialog(this.app, {
								title: t('common.confirmDelete'),
								message: t('common.confirmDeleteMessage'),
							});
							if (!confirmed) return;
							void this.sync.removeQuickActionByKey(key);
						})();
					},
					this.data.hiddenPresets,
					undefined,
				);
			}
		} else {
			content.createEl('h4', { text: t('mobile.recent'), cls: 'dashboard-mobile-drawer-title' });
			const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
			renderRecentDocs(content, docs, (path) => { void this.navigateToPath(path); });
		}

		const backdrop = drawer.createDiv({ cls: 'dashboard-mobile-drawer-backdrop' });
		backdrop.addEventListener('click', () => this.closeMobileDrawer());

		window.requestAnimationFrame(() => {
			content.addClass('dashboard-mobile-drawer-content--open');
		});
	}

	private closeMobileDrawer(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		if (!root) return;
		const existing = root.querySelector('.dashboard-mobile-drawer');
		if (existing) existing.remove();
	}

	private renderSidebar(sidebar: HTMLElement, root: HTMLElement, reuseWidgets: HTMLElement | null): void {
		if (!this.data) return;

		const scroll = sidebar.createDiv({ cls: 'dashboard-sidebar-scroll' });

		// Week calendar and recent docs are CSS-hidden in stacked mode, so skip
		// building them there: the recent-docs list costs a full markdown-file
		// mtime sort per render, and the debounced refresh already no-ops when
		// the .dashboard-recent block is absent.
		if (!isStackedLayout(this.plugin.settings, this.data)) {
			renderSidebarWeekCalendar(scroll);
		}

		// Quick buttons participate in the widget drag/reorder system now; the
		// renderer adds them to the widget area like any other sidebar widget.
		// Shared with the immersive grid (same builder, same callbacks).
		const renderQuickActionsWidget = (container: HTMLElement): void => this.renderQuickActionsWidget(container);

		// Preserve: reuse the detached widgets DOM when the signature matched.
		// Either way, track the live element for the next render's detach step.
		this.sidebarWidgetsEl = renderSidebarWidgets(
			scroll,
			this.plugin.settings,
			this.app,
			this.pomodoroService ?? undefined,
			this.readingService ?? undefined,
			this.holidayData,
			(order) => {
				void (async () => {
					this.plugin.settings = {
						...this.plugin.settings,
						widgetOrder: order,
					};
					await this.plugin.saveSettings();
					this.render(this.data!);
				})();
			},
			reuseWidgets,
			(file, line) => this.openNote(file, undefined, line),
			renderQuickActionsWidget,
			this.data,
		);

		if (!isStackedLayout(this.plugin.settings, this.data)) {
			const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
			renderRecentDocs(
				scroll,
				docs,
				(path) => { void this.navigateToPath(path); },
			);
		}
	}

	/** Desktop-only sidebar pin, anchored at the banner's bottom-left corner.
	 *  Distinct from the banner-collapse bookmark button (top-right,
	 *  .dashboard-banner-pin-btn): this one pins/unpins the sidebar. Works in
	 *  both layouts — in stacked mode it pins the widget strip open instead of
	 *  the left rail. */
	private renderBannerPinButton(bannerEl: HTMLElement): void {
		if (Platform.isMobile) return;
		const pinBtn = bannerEl.createEl('button', {
			cls: 'dashboard-sidebar-pin-btn',
			attr: { 'aria-label': 'Toggle sidebar pin' },
		});
		const update = () => {
			setIcon(pinBtn, this.sidebarPinned ? 'pin' : 'pin-off');
			pinBtn.toggleClass('dashboard-sidebar-pin-btn--active', this.sidebarPinned);
		};
		update();
		pinBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.sidebarPinned = !this.sidebarPinned;
			this.app.saveLocalStorage('apex-dashboard-sidebar-pinned', String(this.sidebarPinned));
			const sidebar = this.containerEl.querySelector('.dashboard-sidebar');
			if (sidebar) {
				if (this.sidebarPinned) {
					sidebar.addClass('dashboard-sidebar--pinned');
					sidebar.removeClass('dashboard-sidebar--expanded');
					sidebar.removeClass('dashboard-sidebar--collapsed');
					this.sidebarExpanded = false;
				} else {
					sidebar.removeClass('dashboard-sidebar--pinned');
					sidebar.addClass('dashboard-sidebar--collapsed');
					this.sidebarExpanded = false;
				}
			}
			update();
		});
	}

	private setupSidebarBehavior(sidebar: HTMLElement, root: HTMLElement): void {
		// Create slim indicator (visible only when collapsed)
		sidebar.createDiv({ cls: 'dashboard-sidebar-slim-indicator' });

		// Use capture phase so child handlers can't stopPropagation before we see it
		sidebar.addEventListener('mousedown', (e: MouseEvent) => {
			if (this.sidebarPinned) return;
			if (sidebar.hasClass('dashboard-sidebar--collapsed')) {
				e.preventDefault();
				e.stopPropagation();
				sidebar.removeClass('dashboard-sidebar--collapsed');
				sidebar.addClass('dashboard-sidebar--expanded');
				this.sidebarExpanded = true;
			}
		}, true);

		// Click outside to collapse
		const outsideHandler = (e: MouseEvent) => {
			if (this.sidebarPinned) return;
			if (!this.sidebarExpanded) return;
			if (sidebar.contains(e.target as Node)) return;
			sidebar.removeClass('dashboard-sidebar--expanded');
			sidebar.addClass('dashboard-sidebar--collapsed');
			this.sidebarExpanded = false;
		};
		root.addEventListener('click', outsideHandler);
		this.cleanupFns.push(() => root.removeEventListener('click', outsideHandler));

		// Resize handles (desktop only): the stacked strip drags its unit
		// height, the side rail drags its width. Phones have neither surface
		// (the rail is display:none under 641px, the strip does not exist).
		// The handles are direct sidebar children, so the collapsed state's
		// `> *:not(.slim-indicator)` hiding rule keeps them unreachable there.
		if (Platform.isMobile) return;
		if (isStackedLayout(this.plugin.settings, this.data)) {
			this.attachStripHeightHandle(sidebar);
		} else {
			this.attachSidebarWidthHandle(sidebar);
		}
	}

	/** Write the persisted area sizing as CSS variables on the sidebar element.
	 *  Runs every render and deliberately stays OUT of the widget signature:
	 *  both values apply as plain custom properties (--db-sidebar-w /
	 *  --db-widget-unit-h), so committing a drag never rebuilds the widgets
	 *  DOM (live timers and listeners survive). Writing on the OUTER sidebar
	 *  also covers the widgets-reuse path, where the inner strip is a
	 *  re-attached node from a previous render. */
	private applySidebarSizing(sidebar: HTMLElement): void {
		const s = this.plugin.settings;
		if (isStackedLayout(s)) {
			sidebar.setCssProps({ '--db-widget-unit-h': `${clampWidgetUnitHeight(s.widgetUnitHeight)}px` });
		} else if (!Platform.isMobile) {
			// Unitless: the stylesheet multiplies by 1px for the width and by
			// 1/220 for the proportional content scale (see the CSS comment).
			sidebar.setCssProps({ '--db-sidebar-w': String(clampSidebarWidth(s.sidebarWidth)) });
		}
	}

	/** Stacked layout: drag the strip's bottom edge to scale the 6-row grid
	 *  unit (--db-widget-unit-h). Every card keeps its row fraction, so the
	 *  whole strip grows/shrinks proportionally. Live frames write the CSS
	 *  variable only; the value is persisted on release — the zero-writes-
	 *  mid-drag discipline of the section height handle. */
	private attachStripHeightHandle(sidebar: HTMLElement): void {
		const handle = sidebar.createDiv({ cls: 'dashboard-sidebar-strip-handle' });
		handle.setAttribute('aria-label', t('view.stripResizeHint'));
		handle.addEventListener('pointerdown', (e) => {
			const startY = e.clientY;
			// Settings anchor, not offsetHeight: the collapsed strip's rendered
			// height carries no usable unit value.
			const startH = clampWidgetUnitHeight(this.plugin.settings.widgetUnitHeight);
			sidebar.addClass('dashboard-sidebar--resizing');
			const shieldHost = sidebar.closest('.apex-dashboard-root') ?? sidebar.parentElement;
			shieldHost?.addClass('dashboard-frames-muted');
			let last = startH;
			startGuardedDrag(e, {
				cursor: 'ns-resize',
				onMove: (ev) => {
					// A re-render can tear the sidebar down mid-drag; resizing a
					// detached element is stale work.
					if (!sidebar.isConnected) {
						sidebar.removeClass('dashboard-sidebar--resizing');
						shieldHost?.removeClass('dashboard-frames-muted');
						return;
					}
					last = clampWidgetUnitHeight(startH + (ev.clientY - startY));
					sidebar.style.setProperty('--db-widget-unit-h', `${last}px`);
				},
				onUp: () => {
					sidebar.removeClass('dashboard-sidebar--resizing');
					shieldHost?.removeClass('dashboard-frames-muted');
					const finalH = Math.round(last);
					if (finalH === startH) return;
					this.commitSidebarSizing({ widgetUnitHeight: finalH }, '--db-widget-unit-h', `${finalH}px`);
				},
			});
		});
	}

	/** Side layout: drag the rail's right edge to resize the widget column
	 *  (--db-sidebar-w, unitless). Card content adapts through pure CSS: the
	 *  widgets area scales its em-based root font-size with the width ratio
	 *  and the fluid internals (flex/percent/ellipsis) reflow — no re-render,
	 *  no JS layout work. */
	private attachSidebarWidthHandle(sidebar: HTMLElement): void {
		const handle = sidebar.createDiv({ cls: 'dashboard-sidebar-width-handle' });
		handle.setAttribute('aria-label', t('view.sidebarResizeHint'));
		handle.addEventListener('pointerdown', (e) => {
			const startX = e.clientX;
			const startW = clampSidebarWidth(this.plugin.settings.sidebarWidth);
			sidebar.addClass('dashboard-sidebar--resizing');
			const shieldHost = sidebar.closest('.apex-dashboard-root') ?? sidebar.parentElement;
			shieldHost?.addClass('dashboard-frames-muted');
			let last = startW;
			startGuardedDrag(e, {
				cursor: 'col-resize',
				onMove: (ev) => {
					if (!sidebar.isConnected) {
						sidebar.removeClass('dashboard-sidebar--resizing');
						shieldHost?.removeClass('dashboard-frames-muted');
						return;
					}
					last = clampSidebarWidth(startW + (ev.clientX - startX));
					sidebar.style.setProperty('--db-sidebar-w', String(last));
				},
				onUp: () => {
					sidebar.removeClass('dashboard-sidebar--resizing');
					shieldHost?.removeClass('dashboard-frames-muted');
					const finalW = Math.round(last);
					if (finalW === startW) return;
					this.commitSidebarSizing({ sidebarWidth: finalW }, '--db-sidebar-w', String(finalW));
				},
			});
		});
	}

	/** Persist a committed resize and mirror the value onto every OTHER open
	 *  dashboard view's sidebar — a cheap setProperty sweep, because a full
	 *  refreshAllDashboards would rebuild boards for a pure CSS change. Other
	 *  views also pick the value up on their next render from settings. */
	private commitSidebarSizing(
		patch: { sidebarWidth?: number; widgetUnitHeight?: number },
		cssVar: string,
		value: string,
	): void {
		this.plugin.settings = { ...this.plugin.settings, ...patch };
		void this.plugin.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
			const other = leaf.view as DashboardView | undefined;
			if (!other || other === this) continue;
			other.containerEl.querySelectorAll<HTMLElement>('.dashboard-sidebar')
				.forEach(el => el.style.setProperty(cssVar, value));
		}
	}

	private createCallbacks() {
		return {
			onCardEdit: (card: DashboardCard) => this.openCardEditModal(card),
			onOpenNoteInPopover: (file: TFile, subpath?: string) => this.openNote(file, subpath),
			onOpenNoteAtLine: (file: TFile, line?: number) => this.openNote(file, undefined, line),
			onCardDelete: async (cardId: string) => {
				const confirmed = await showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				});
				if (!confirmed) return;
				void this.sync.deleteCard(cardId);
				new Notice(t('card.deleted'));
			},
			onCardPinTop: (cardId: string, columnName: string) => {
				// One-click pin-to-top on sticky cards: reuse the optimistic
				// same-column move path. Already first -> skip the pointless write.
				const col = this.data?.columns.find(c => c.name === columnName);
				if (!col || col.cards[0]?.id === cardId) return;
				void this.handleMoveCard(cardId, columnName, 0);
			},
			onCheckboxToggle: (cardId: string, taskPath: number[], checked: boolean) => this.sync.toggleTask(cardId, taskPath, checked),
			onTaskAdd: (cardId: string, text: string, parentPath?: number[]) => this.sync.addTask(cardId, text, parentPath),
			onTaskDelete: async (cardId: string, taskPath: number[]) => {
				const confirmed = await showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				});
				if (!confirmed) return;
				void this.sync.deleteTask(cardId, taskPath);
			},
			onTaskReorder: (cardId: string, fromPath: number[], toPath: number[], before: boolean) => this.sync.reorderTask(cardId, fromPath, toPath, before),
			onTaskMoveToCard: (srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest') => this.sync.moveTaskToCard(srcCardId, fromPath, destCardId, destPath, mode),
			onTaskEdit: (cardId: string, taskPath: number[], text: string) => this.sync.editTask(cardId, taskPath, text),
			onTaskNest: (cardId: string, taskPath: number[]) => this.sync.nestTask(cardId, taskPath),
			onTaskNestInto: (cardId: string, srcPath: number[], destPath: number[]) => this.sync.nestTaskInto(cardId, srcPath, destPath),
			onTaskUnnest: (cardId: string, taskPath: number[]) => this.sync.unnestTask(cardId, taskPath),
			onTaskToggleCollapse: (cardId: string, taskPath: number[]) => this.sync.toggleCollapseTaskQuiet(cardId, taskPath),
			onMemoUpdate: (card: DashboardCard, updates: Pick<DashboardCard, 'body' | 'blockquote'> & Partial<Pick<DashboardCard, 'tasks' | 'docs' | 'wikiLink' | 'url' | 'type'>>) => this.sync.updateMemoCard(card.id, updates),
			onMemoSaveAsNote: (card: DashboardCard) => this.saveMemoAsNote(card),
			onTaskSaveToDaily: (card: DashboardCard) => this.saveTasksToDaily(card),
			onDocAdd: (cardId: string, path: string) => this.sync.addDocToCard(cardId, path),
			onCardNewNote: (cardId: string, pos?: { x: number; y: number }) => { void this.handleCardNewNote(cardId, pos); },
			onDocDelete: (cardId: string, docPath: number[]) => this.sync.deleteDoc(cardId, docPath),
			onDocReorder: (cardId: string, fromPath: number[], toPath: number[], before: boolean) => this.sync.reorderDocs(cardId, fromPath, toPath, before),
			onDocMoveToCard: (srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest') => this.sync.moveDocToCard(srcCardId, fromPath, destCardId, destPath, mode),
			onDocNest: (cardId: string, docPath: number[]) => this.sync.nestDoc(cardId, docPath),
			onDocToggleCollapse: (cardId: string, docPath: number[]) => this.sync.toggleCollapseDocQuiet(cardId, docPath),
			onCardAdd: (colName: string) => {
				const column = this.data?.columns.find(col => col.name === colName);
				const effectiveType = column?.sectionType ?? colName.toLowerCase();
				if (effectiveType === 'dashboard') {
					this.openWidgetTypeModal(colName);
				} else if (effectiveType === 'sticky') {
					// Sticky sections mix memo and todo cards: ask which one to create.
					// (Retired memo/todo section types migrate to sticky at parse time.)
					this.openStickyCardTypeModal(colName);
				} else {
					this.openProjectSearchModal(colName);
				}
			},
				onColumnAdd: (name: string, sectionType?: string) => {
					void this.addColumnWithType(name, sectionType);
				},
				onRequestAddSection: () => this.openAddSectionModal(),
			onBannerEdit: () => {
				if (this.data) this.openBannerEditModal(this.data);
			},
			onQuickActionAdd: () => this.openAddActionModal(),
			onQuickActionRemove: (index: number) => {
				void showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) void this.sync.removeQuickAction(index);
				});
			},
			onQuickNoteCreate: (preset: QuickNotePreset) => void createNoteFromPreset(this.app, preset),
			onQuickNoteCapture: (text: string) => void captureThought(this.app, this.plugin.settings, text),
			onOpenPinnedNote: (note: PinnedNote) => openPinnedNote(this.app, note),
			onQuickCommand: (cmd: QuickCommand) => {
				const commands = (this.app as AppWithCommands).commands;
				// Stale id (plugin disabled/uninstalled): warn instead of silently no-op'ing.
				if (!commands.commands[cmd.commandId]) {
					new Notice(t('quickNote.commandNotFound'));
					return;
				}
				commands.executeCommandById(cmd.commandId);
			},
			onSkillShortcut: (shortcut: SkillShortcut) => new AgentPromptModal(this.app, {
				label: shortcut.label,
				skillName: shortcut.skillName,
				promptTemplate: shortcut.promptTemplate,
				inputPlaceholder: shortcut.inputPlaceholder,
			}, shortcut.target, {}).open(),
			onQuickNoteDaily: () => void openTodayNote(this.app),
			onQuickNoteConfig: () => new QuickNoteConfigModal(this.app, this.plugin).open(),
			onMoveCard: (cardId: string, targetCol: string, targetIdx: number) => this.handleMoveCard(cardId, targetCol, targetIdx),
			onMemoColorChange: (card: DashboardCard, color: string) => this.sync.updateMemoColor(card.id, color),
			onProjectCoverChange: (card: DashboardCard, imagePath: string) => this.sync.updateProjectCover(card.id, imagePath),
				onCardTitleEdit: (cardId: string, newTitle: string) => this.sync.updateCard(cardId, { title: newTitle }),
				onCardWidthChange: (cardId: string, width: number) => this.sync.updateCardWidth(cardId, width),
					onCardSizeChange: (cardId: string, size: string) => this.sync.updateCardSize(cardId, size as import('./types').CardSize),
				onCardGridChange: (cardId: string, gridCols: number, gridRows: number) => this.sync.updateCardGrid(cardId, gridCols, gridRows),
				onCardGridMove: (cardId: string, gridCol: number, gridRow: number) => this.sync.updateCardGridMove(cardId, gridCol, gridRow),
				onFileDrop: (cardId: string, filePath: string) => this.handleFileDrop(cardId, filePath),
				onColumnRename: (oldName: string, newName: string, columnIndex?: number) => { void this.sync.renameColumn(oldName, newName, columnIndex); },
				onColumnDelete: (columnName: string, columnIndex?: number) => this.deleteColumn(columnName, columnIndex),
				onColumnMove: (fromIndex: number, toIndex: number) => { void this.sync.moveColumn(fromIndex, toIndex); },
				onColumnMoveBeside: (fromIndex: number, targetIndex: number, side: 'left' | 'right') => { void this.sync.moveColumnBeside(fromIndex, targetIndex, side); },
				onColumnHeightChange: (name: string, height: number) => { void this.sync.updateColumnHeight(name, height); },
				onColumnWidthChange: (name: string, widthPct: number) => { void this.sync.updateColumnWidth(name, widthPct); },
			onTaskReminderEdit: (cardId: string, taskPath: number[], reminder: string | undefined) => this.sync.editTaskReminder(cardId, taskPath, reminder),
			onAddFromTemplate: (columnName: string) => this.openTemplatePicker(columnName),
			onArchiveTasks: (columnName: string) => this.archiveCompletedTasks(columnName),
				onLibraryConfigChange: (columnName: string, config: LibraryConfig) => {
				this.suppressNextRender = true;
				void this.sync.updateLibraryConfig(columnName, config).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			},
				onDataviewConfigChange: (columnName: string, config: DataviewConfig) => {
					this.suppressNextRender = true;
					void this.sync.updateDataviewConfig(columnName, config).then(() => {
						this.refreshSectionInPlace(columnName);
					});
				},
		};
	}

	private handleFileDrop(cardId: string, filePath: string): void {
		if (!this.data) return;
		let sectionType = 'projects';
		let cardType = 'generic';
		for (const col of this.data.columns) {
			const card = col.cards.find(c => c.id === cardId);
			if (card) {
				sectionType = col.sectionType ?? col.name.toLowerCase();
				cardType = card.type;
				break;
			}
		}
		if (cardType === 'weather' || cardType === 'tracker') return;
		if (cardType === 'task') {
			void this.sync.addTask(cardId, `[[${filePath}]]`);
		} else if (sectionType === 'sticky' && (cardType === 'generic' || cardType === 'note')) {
			void this.sync.addFileLinkToMemo(cardId, filePath);
		} else {
			void this.sync.addDocToCard(cardId, filePath);
		}
	}

	private async saveMemoAsNote(card: DashboardCard): Promise<void> {
		try {
			const { path, templateMissing } = await createMemoNote(this.app, {
				folder: this.plugin.settings.memoSavePath,
				templatePath: this.plugin.settings.memoTemplatePath,
				card,
				untitled: t('notice.memoUntitled'),
			});
			if (templateMissing) new Notice(t('notice.memoTemplateNotFound'));
			new Notice(t('notice.memoSaved', { path }), 4000);
		} catch (err) {
			console.error('[Dashboard] saveMemoAsNote failed:', err);
			new Notice(t('notice.memoSaveError'), 4000);
		}
	}

	private async saveTasksToDaily(card: DashboardCard): Promise<void> {
		try {
			if (!card.tasks || card.tasks.length === 0) {
				new Notice(t('notice.noTasksToSave'));
				return;
			}

			// Locate today's daily note via the core "Daily notes" plugin settings.
			const dailyPlugin = getDailyNotesPlugin(this.app);
			const options = dailyPlugin?.instance?.options;
			if (!dailyPlugin?.enabled || !options) {
				new Notice(t('notice.dailyNotesDisabled'), 5000);
				return;
			}

			const folder = (options.folder || '').trim().replace(/^\/+|\/+$/g, '');
			const format = options.format || 'YYYY-MM-DD';
			const dateStr = nowMoment().format(format);
			const fileName = `${dateStr}.md`;
			const path = folder ? `${folder}/${fileName}` : fileName;

			const title = card.title?.trim() || t('notice.memoUntitled');
			const block = `### ${title}\n${serializeTasksForNote(card.tasks)}`;

			if (folder) await ensureFolder(this.app, folder);

			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				const raw = await this.app.vault.read(existing);
				await this.app.vault.modify(existing, prependAfterFrontmatter(raw, block));
			} else {
				await this.app.vault.create(path, `${block}\n`);
			}
			new Notice(t('notice.tasksSavedToDaily', { path }), 4000);
		} catch (err) {
			console.error('[Dashboard] saveTasksToDaily failed:', err);
			new Notice(t('notice.dailySaveError'), 4000);
		}
	}

	private async archiveCompletedTasks(columnName: string): Promise<void> {
		try {
			if (!this.data) return;
			const column = this.data.columns.find((c) => c.name === columnName);
			if (!column) return;

			const now = new Date();
			const pad = (n: number) => String(n).padStart(2, '0');
			const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

			const entries: Array<{ task: string; card: string }> = [];
			for (const card of column.cards) {
				const { archived } = archiveCompleted(card.tasks);
				if (archived.length === 0) continue;
				const cardTitle = card.title?.trim() || t('notice.memoUntitled');
				for (const item of archived) {
					entries.push({ task: item.text, card: cardTitle });
				}
			}

			if (entries.length === 0) {
				new Notice(t('notice.archiveEmpty'));
				return;
			}

			const confirmed = await showConfirmDialog(this.app, {
				title: t('renderer.archiveTasks'),
				message: t('notice.archiveConfirm', { count: entries.length }),
			});
			if (!confirmed) return;

			// Write the running log before mutating the board: if the write fails,
			// the tasks stay on the board (no data loss). Destination is either
			// today's daily note (created from the daily-notes template when
			// missing; a stale blank note is template-rescued) or the configured
			// fixed file with auto-created folders.
			const lines = entries.map((e) => t('notice.archiveLine', { time, task: e.task, card: e.card }));
			const appendText = `${lines.join('\n')}\n`;

			let destFile: TFile;
			if (this.plugin.settings.taskArchiveTarget === 'daily') {
				const note = await getOrCreateDailyNote(this.app, nowMoment().format('YYYY-MM-DD'));
				if (!note) {
					// Daily notes not configured / path unresolvable: abort BEFORE
					// removing anything from the board.
					new Notice(t('notice.archiveDailyUnavailable'), 4000);
					return;
				}
				destFile = note;
			} else {
				const configured = this.plugin.settings.taskArchivePath.trim().replace(/^\/+|\/+$/g, '');
				const fullPath = configured || '归档/已完成.md';
				const slash = fullPath.lastIndexOf('/');
				const folder = slash >= 0 ? fullPath.slice(0, slash) : '';
				if (folder) await ensureFolder(this.app, folder);
				const existing = this.app.vault.getAbstractFileByPath(fullPath);
				destFile = existing instanceof TFile ? existing : await this.app.vault.create(fullPath, '');
			}

			const raw = await this.app.vault.read(destFile);
			const sep = raw === '' || raw.endsWith('\n') ? '' : '\n';
			await this.app.vault.modify(destFile, `${raw}${sep}${appendText}`);

			await this.sync.archiveTasks(columnName);

			new Notice(t('notice.archived', { count: entries.length, path: destFile.path }), 4000);
		} catch (err) {
			console.error('[Dashboard] archiveCompletedTasks failed:', err);
			new Notice(t('notice.archiveError'), 4000);
		}
	}

	private openBannerEditModal(data: DashboardData): void {
		const modal = new BannerEditModal(this.app, data.banner, (updates) => {
			void this.sync.updateBanner(updates);
		});
		modal.open();
	}

	private openCardEditModal(card: DashboardCard): void {
		const modal = new CardEditModal(this.app, card, (updates) => {
			void this.sync.updateCard(card.id, updates);
		});
		modal.open();
	}

	private openNotePopover(file: TFile, subpath?: string, line?: number): void {
		// Close any previously open popover so its embedded leaf is detached
		// before we open a fresh one.
		this.popoverModal?.close();
		const modal = new NotePopoverModal(this.app, file, subpath, line);
		this.popoverModal = modal;
		modal.open();
	}

	/** Opens a note on card click. Honors the "disable popover" setting: when
	 *  on, the note opens directly in a tab (no in-dashboard editor).
	 *
	 *  subpath is the raw `#heading` / `#^block` fragment of a wikilink; the
	 *  tab path resolves it via openLinkText, the popover scrolls to it after
	 *  the embedded view is ready. line is a 0-based source line (calendar
	 *  task jumps): the note is revealed at that line in either path.
	 *
	 *  Non-markdown files (canvas whiteboards, base databases, pdf, media) are
	 *  always opened in a real tab — the in-dashboard popover only hosts a
	 *  MarkdownView and would render them broken. */
	private openNote(file: TFile, subpath?: string, line?: number): void {
		if (this.plugin.settings.disableNotePopover || file.extension !== 'md') {
			void this.openNoteInTab(file, subpath, line);
			return;
		}
		this.openNotePopover(file, subpath, line);
	}

	/** Tab-path open with an optional line reveal once the view is active. */
	private async openNoteInTab(file: TFile, subpath?: string, line?: number): Promise<void> {
		await this.app.workspace.openLinkText(subpath ? `${file.path}${subpath}` : file.path, '');
		if (line === undefined) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file?.path === file.path) revealMarkdownLine(view, line);
	}

	private async addColumnWithType(name: string, sectionType?: string): Promise<void> {
		await this.sync.addColumn(name, sectionType);
		if (sectionType === 'library') {
			this.openLibraryConfigModal(name);
		} else if (sectionType === 'folder') {
			this.openFolderConfigModal(name);
		} else if (sectionType === 'weread') {
			this.openWereadConfigModal(name);
		} else if (sectionType === 'dataview') {
			this.openDataviewConfigModal(name);
		} else if (sectionType === 'web') {
			this.openWebConfigModal(name);
		} else if (sectionType === 'rss') {
			this.openRssConfigModal(name);
		} else if (sectionType === 'pipeline') {
			this.openPipelineConfigModal(name);
		}
	}

	private openAddSectionModal(): void {
		// Immersive boards: the "+ 添加卡片" tile opens the card menu —
		// sections through the modal, widgets straight onto the board
		// (per-board membership, independent of the global toggles).
		if (this.data && resolveEffectiveLayout(this.plugin.settings, this.data) === 'immersive') {
			const root = this.containerEl.children[1] as HTMLElement | undefined;
			const anchor = root?.querySelector<HTMLElement>('.dashboard-imm .dashboard-imm-add-btn')
				?? root?.querySelector<HTMLElement>('.dashboard-imm .dashboard-add-section')
				?? undefined;
			if (anchor) {
				const boardKeys = new Set(this.immItems
					.filter(item => item.id.startsWith('widget:'))
					.map(item => item.id.slice('widget:'.length)));
				openImmersiveAddMenu({
					settings: this.plugin.settings,
					services: {
						pomodoroService: this.pomodoroService ?? undefined,
						readingService: this.readingService ?? undefined,
						holidayData: this.holidayData ?? undefined,
						onOpenNote: (file, line) => this.openNote(file, undefined, line),
						renderQuickActions: (host) => this.renderQuickActionsWidget(host),
					},
					boardKeys,
					anchor,
					onAddSection: () => this.openAddSectionModalInner(),
					onAddNoteCard: kind => void this.addImmersiveNoteCard(kind),
					onAddWidget: key => void this.addImmersiveWidget(key),
				});
				return;
			}
		}
		this.openAddSectionModalInner();
	}

	/** Add a memo/todo card to the board. Sticky sections are dissolved on
	 *  immersive boards — the backing column receives the card (created if no
	 *  sticky column exists); the full render turns it into a fresh card
	 *  tile. */
	private async addImmersiveNoteCard(kind: 'memo' | 'todo'): Promise<void> {
		if (!this.data) return;
		const findSticky = () => this.data?.columns.find(col => (col.sectionType ?? '').toLowerCase() === 'sticky');
		let column = findSticky();
		if (!column) {
			await this.sync.addColumn(t('default.stickyName'), 'sticky');
			column = findSticky();
		}
		if (!column) return;
		await this.sync.addCard(column.name, kind === 'todo' ? { type: 'task' as const } : { type: 'generic' as const });
	}

	private openAddSectionModalInner(): void {
		const modal = new AddSectionModal(this.app, (name, sectionType) => {
			void this.addColumnWithType(name, sectionType);
		});
		modal.open();
	}

	/** Append a widget card to this board's arrangement. No suppression: the
	 *  engine echo takes the full-render path (planDashboardUpdate's immersive
	 *  trigger), which mounts the new card through the normal pipeline. */
	private async addImmersiveWidget(key: string): Promise<void> {
		if (!this.data) return;
		const next = [...this.immItems, {
			id: widgetItemId(key),
			...defaultWidgetSize(key, {
				habit: this.plugin.settings.habitHeightRatio,
				reading: this.plugin.settings.readingHeightRatio,
				albums: this.plugin.settings.albums,
			}),
		}];
		await this.sync.updateImmersive(next);
	}

	/** Remove a tile from this board's arrangement (widget membership is the
	 *  arrangement itself; the underlying widget config is untouched). */
	private async removeImmersiveItem(itemId: string): Promise<void> {
		if (!this.data) return;
		const next = this.immItems.filter(item => item.id !== itemId);
		if (next.length === this.immItems.length) return;
		await this.sync.updateImmersive(next);
	}

	private openWidgetTypeModal(colName: string): void {
		const modal = new WidgetTypeModal(this.app, (type: WidgetType) => {
			if (type === 'weather') {
				this.openWeatherConfigModal(colName);
			} else if (type === 'tracker') {
				this.openTrackerConfigModal(colName);
			}
		});
		modal.open();
	}

	/** Sticky ("便利贴") sections: choose memo or todo before the card is created. */
	private openStickyCardTypeModal(colName: string): void {
		const modal = new StickyCardTypeModal(this.app, (kind) => {
			this.pendingScrollToLastCardOfColumn = colName;
			if (kind === 'todo') {
				void this.sync.addCard(colName, { type: 'task', title: t('sync.todoTitle') });
			} else {
				const now = new Date();
				const pad = (n: number) => String(n).padStart(2, '0');
				const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
				void this.sync.addCard(colName, { type: 'generic', title: t('sync.memoTitle', { date }) });
			}
		});
		modal.open();
	}

	private openWeatherConfigModal(colName: string): void {
		const modal = new WeatherConfigModal(this.app, (title, config) => {
			void this.sync.addCard(colName, {
				title,
				type: 'weather',
				weatherConfig: config,
			});
		});
		modal.open();
	}

	private openTrackerConfigModal(colName: string): void {
		const modal = new TrackerConfigModal(this.app, (title, config) => {
			void this.sync.addCard(colName, {
				title,
				type: 'tracker',
				trackerConfig: config,
			});
		});
		modal.open();
	}

	private openTemplatePicker(colName: string): void {
		const modal = new TemplatePickerModal(
			this.app,
			this.plugin,
			(template) => {
				this.pendingScrollToLastCardOfColumn = colName;
				void this.sync.addCard(colName, {
					title: template.name,
					type: 'task',
					tasks: template.tasks.map(text => ({ text, checked: false })),
				});
			},
		);
		modal.open();
	}

	private openLibraryConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existingConfig = column?.libraryConfig ?? {
			filters: [],
			viewMode: 'grid' as const,
			sortBy: 'modified',
			sortDesc: true,
		};
		const modal = new LibraryConfigModal(
			this.app,
			existingConfig,
			(config) => {
				void this.sync.updateLibraryConfig(colName, config);
			},
		);
		modal.open();
	}

	private openDataviewConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.dataviewConfig ?? { query: '' };
		const modal = new DataviewConfigModal(
			this.app,
			existing,
			(config) => { void this.sync.updateDataviewConfig(colName, config); },
		);
		modal.open();
	}

	/** Web section: URL + engine mode + zoom. Saving goes through the plain
	 *  sync path — handleDataUpdate('local') rebuilds the section in place,
	 *  reloading the frame with the new URL. */
	private openWebConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.webConfig ?? { url: '' };
		const modal = new WebConfigModal(
			this.app,
			existing,
			(config) => { void this.sync.updateWebConfig(colName, config); },
		);
		modal.open();
	}

	/** RSS section: subscription sources + download folder. Same plain sync
	 *  path — the section rebuilds in place and re-reads its feeds. */
	private openRssConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.rssConfig ?? { feeds: [], downloadFolder: '' };
		const modal = new RssConfigModal(
			this.app,
			existing,
			(config) => { void this.sync.updateRssConfig(colName, config); },
		);
		modal.open();
	}

	/** Pipeline sections: stages, skill buttons and the status field. The modal
	 *  seeds sensible defaults when the section was just created. */
	private openPipelineConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const modal = new PipelineConfigModal(
			this.app,
			column?.pipelineConfig,
			(config) => {
				void (async () => {
					await this.sync.updatePipelineConfig(colName, config);
					// Remember valid skill names per agent so the pickers
					// offer them next time (see skill-registry).
					for (const agent of new Set(config.skills.map(skill => skill.agent))) {
						await rememberSkillNames(this.plugin, agent, config.skills.filter(skill => skill.agent === agent && skill.skillName).map(skill => skill.skillName));
					}
				})();
			},
			this.plugin,
		);
		modal.open();
	}

	/** Images/videos sections: the config currently manages the excluded-folder
	 *  set, persisted via the column's libraryConfig. */
	private openMediaConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const modal = new MediaConfigModal(
			this.app,
			column?.libraryConfig,
			(config) => { void this.sync.updateLibraryConfig(colName, config); },
		);
		modal.open();
	}

	private openWereadConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.wereadConfig ?? { widgets: [{ id: 'w1', view: 'shelf' as const, groupBy: 'readingState' as const }] };
		const modal = new WereadConfigModal(
			this.app,
			existing,
			(config) => { void this.sync.updateWereadConfig(colName, config); },
		);
		modal.open();
	}

	/**
	 * Optimistic card move: rewrite only the affected section(s) in place
	 * instead of letting the default full-board re-render tear down every
	 * section (the source of the long lag and the dragend transform "afterimage"
	 * on memo cards).
	 *
	 * moveCard updates `this.data` synchronously then persists; its
	 * `notifyCallbacks` is suppressed here (one-shot) and the file-watcher's
	 * own reload is a no-op via its serialize-equality check, so no extra
	 * full render fires. We then refresh just the source and target sections.
	 */
	/**
	 * Optimistic card move: physically relocate the dragged card's DOM node
	 * instead of re-rendering. This is zero-cost compared to refreshSectionInPlace
	 * (which rebuilds every memo card — each line re-parsing links, each wikilink
	 * re-resolved against the vault — the real source of the lingering lag).
	 *
	 * DnD listeners are bound per cardEl (setupDragAndDrop attaches dragstart to
	 * each card), so moving a node keeps its listeners intact — no rebind needed.
	 * The dragged card carries a `--dragging` class during the drag (desktop) /
	 * until cleanupDrag (touch); we clear it here in case dragend lands after us.
	 */
	private async handleMoveCard(cardId: string, targetCol: string, targetIdx: number): Promise<void> {
		const kanban = (this.containerEl.children[1] as HTMLElement)?.querySelector<HTMLElement>('.dashboard-kanban');
		const draggedEl = kanban?.querySelector<HTMLElement>(`.dashboard-card[data-card-id="${CSS.escape(cardId)}"]`) ?? null;
		const sourceCol = this.data?.columns.find(c => c.cards.some(card => card.id === cardId))?.name;

		this.suppressNextRender = true;
		try {
			await this.sync.moveCard(cardId, targetCol, targetIdx);
		} catch {
			// moveCard swallows disk I/O itself; guard anything else so a rejection
			// can't desync the UI from this.data.
			this.suppressNextRender = false;
			if (this.data) this.render(this.data);
			return;
		}

		// Cross-section moves change both rendering and column-bound callbacks.
		// Rebuild both rows; merely reordering destination children cannot move
		// a node from the source and leaves stale card type / event closures.
		this.suppressNextRender = false;
		if (sourceCol && sourceCol !== targetCol) {
			const sourceRefreshed = this.refreshSectionInPlace(sourceCol);
			const targetRefreshed = this.refreshSectionInPlace(targetCol);
			if ((!sourceRefreshed || !targetRefreshed) && this.data) this.render(this.data);
			return;
		}

		// Physically reorder the target section's card DOM to match the new data
		// order. If we can't (element missing — e.g. a concurrent full render
		// swapped the tree), fall back to the in-place section refresh, then full.
		const moved = draggedEl && this.reorderCardsInDOM(targetCol);
		if (sourceCol && sourceCol !== targetCol) {
			this.reorderCardsInDOM(sourceCol);
		}
		if (draggedEl) {
			draggedEl.removeClass('dashboard-card--dragging');
		}
		if (!moved) {
			let refreshed = this.refreshSectionInPlace(targetCol);
			if (sourceCol && sourceCol !== targetCol) {
				refreshed = this.refreshSectionInPlace(sourceCol) || refreshed;
			}
			if (!refreshed && this.data) {
				this.render(this.data);
			}
		}
	}

	/**
	 * Reorder the card DOM nodes in one section to match `this.data`'s card
	 * order for that column. Pure DOM shuffle (insertBefore) — no rebuild, so
	 * memo cards keep their already-parsed links and hover bindings. Returns
	 * false if the section's DOM can't be located.
	 */
	private reorderCardsInDOM(columnName: string): boolean {
		if (!this.data) return false;
		const kanban = (this.containerEl.children[1] as HTMLElement)?.querySelector<HTMLElement>('.dashboard-kanban');
		const section = kanban?.querySelector<HTMLElement>(`:scope > [data-column="${CSS.escape(columnName)}"]`);
		const cardsContainer = section?.querySelector<HTMLElement>('.dashboard-section-cards');
		if (!cardsContainer) return false;
		const column = this.data.columns.find(c => c.name === columnName);
		if (!column) return false;

		const existing = new Map<string, HTMLElement>();
		cardsContainer.querySelectorAll<HTMLElement>(':scope > .dashboard-card').forEach(el => {
			const id = el.dataset.cardId;
			if (id) existing.set(id, el);
		});

		// Re-append in data order; remove any drop indicator sitting first.
		cardsContainer.querySelectorAll(':scope > .dashboard-drop-indicator').forEach(el => el.remove());
		let cursor: Node | null = null;
		for (const card of column.cards) {
			const el = existing.get(card.id);
			if (!el) continue;
			if (cursor) {
				if (cursor.nextSibling !== el) cardsContainer.insertBefore(el, cursor.nextSibling);
			} else {
				if (cardsContainer.firstChild !== el) cardsContainer.insertBefore(el, cardsContainer.firstChild);
			}
			cursor = el;
		}
		return true;
	}

	private refreshSectionInPlace(columnName: string): boolean {
		if (!this.data) return false;
		const kanban = (this.containerEl.children[1] as HTMLElement)?.querySelector<HTMLElement>('.dashboard-kanban');
		if (!kanban) return false;
		const oldEl = kanban.querySelector<HTMLElement>(`:scope > [data-column="${CSS.escape(columnName)}"]`);
		if (!oldEl) return false;
		const column = this.data.columns.find(c => c.name === columnName);
		if (!column) return false;
		const callbacks = this.createCallbacks();
		const newEl = renderSection(column, callbacks, this.app, this.data, this.plugin.settings);
		// The rebuilt row starts every internal scroller at 0, which snaps the
		// card deck back to its first card and task lists back to their top —
		// the "page jumps away after finishing an edit" symptom. Carry the old
		// row's scroll positions over the node swap.
		const scrollStates = captureScrollStates(oldEl);
		// Immersive: the tile's grid placement lives inline on the element (the
		// packer wrote it); the fresh node would drop back to auto placement and
		// fly to the end of the grid — carry the placement over too.
		const gridCol = oldEl.style.gridColumn;
		const gridRow = oldEl.style.gridRow;
		const minH = oldEl.style.minHeight;
		const immId = oldEl.getAttribute('data-imm-id');
		if (immId) newEl.setAttribute('data-imm-id', immId);
		oldEl.replaceWith(newEl);
		if (gridCol) newEl.style.gridColumn = gridCol;
		if (gridRow) newEl.style.gridRow = gridRow;
		if (minH) newEl.style.minHeight = minH;
		// The swapped-in node carries no resize grip — re-attach it (the
		// method is idempotent) so the tile keeps its corner handle.
		if (immId && resolveEffectiveLayout(this.plugin.settings, this.data) === 'immersive') {
			attachImmersiveResizeHandle(newEl, immId, () => this.immItems, next => this.commitImmersiveItems(next));
		}
		restoreScrollStates(newEl, scrollStates);
		for (const fn of this.dndCleanupFns) fn();
		this.dndCleanupFns = [];
		setupDragAndDrop(kanban, callbacks, this.dndCleanupFns, { skipSectionGrip: resolveEffectiveLayout(this.plugin.settings, this.data) === 'immersive' });
		return true;
	}

	private async openTickTickFilterModal(colName: string): Promise<void> {
		const column = this.data?.columns.find(col => col.name === colName);
		const config = column?.ticktickConfig ?? { view: 'lists' as const };
		const region = this.plugin.settings.ticktickRegion === 'ticktick' ? 'ticktick' : 'dida365';
		const projects = await fetchTickTickProjects(region, this.plugin.settings.ticktickCookie, this.plugin.settings.ticktickDeviceVersion);
		new TickTickFilterModal(this.app, projects, config.hiddenProjects, (hiddenProjects) => {
			this.suppressNextRender = true;
			void this.sync.updateTickTickConfig(colName, { ...config, hiddenProjects }).then(() => {
				this.refreshSectionInPlace(colName);
			});
		}).open();
	}

	private openFolderConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const libraryConfig = column?.libraryConfig;
		const currentFolders = libraryConfig?.folders ?? [];
		const currentTags = libraryConfig?.filters.find(f => f.property === 'tags')?.values ?? [];
		// Non-tags filters feed the modal's property-filter section; the tags
		// section owns the dedicated tags filter instead.
		const currentPropertyFilters = (libraryConfig?.filters ?? []).filter(f => f.property !== 'tags');
		const currentGroupBy = libraryConfig?.kanbanGroupBy;
		const modal = new FolderConfigModal(
			this.app,
			currentFolders,
			libraryConfig?.excludeFolders,
			currentTags,
			currentGroupBy,
			libraryConfig?.showProperties,
			libraryConfig?.propertyLimit,
			(result) => {
				void this.sync.updateLibraryConfig(colName, folderResultToLibraryConfig(libraryConfig, result));
			},
			libraryConfig?.groupMode,
			libraryConfig?.visibleProperties,
			libraryConfig?.kanbanShowCovers,
			sectionTemplatePaths(libraryConfig),
			currentPropertyFilters,
		);
		modal.open();
	}

	/** Reentrancy guard: a second toolbar click while the title prompt is open
	 *  must not stack a second dialog (overlay stacking is a known bug class). */
	private libraryNewNoteInFlight = false;
	private cardNewNoteInFlight = false;

	/** Per-card "new note" (notes/projects sections): prompt for a title, create
	 *  the note from the section's settings (template + save folder; vault root
	 *  when no folder is configured), attach it to the card's doc list, and
	 *  open it. Several configured templates first offer a picker menu at the
	 *  click point (dismissal falls back to the first entry). */
	private async handleCardNewNote(cardId: string, pos?: { x: number; y: number }): Promise<void> {
		if (this.cardNewNoteInFlight) return;
		this.cardNewNoteInFlight = true;
		try {
			let found: { column: DashboardColumn; card: DashboardCard } | null = null;
			for (const column of this.data?.columns ?? []) {
				const card = column.cards.find(c => c.id === cardId);
				if (card) { found = { column, card }; break; }
			}
			if (!found) return;
			const { column, card } = found;

			const folder = sectionNewNoteFolder(column.libraryConfig);
			const templates = sectionTemplatePaths(column.libraryConfig);
			let templatePath = templates[0];
			if (templates.length > 1 && pos) {
				// Menu dismissed without a pick: the documented default (first).
				templatePath = (await pickTemplateFromMenu(templates, pos)) ?? templates[0];
			}
			const title = await showPromptDialog(this.app, {
				title: t('quickNote.titlePrompt'),
				placeholder: t('quickNote.titlePlaceholder'),
			});
			if (title == null) return; // cancelled (empty submit cancels too)

			try {
				let file: TFile;
				try {
					file = await createNoteWithProps(this.app, folder, title, {}, templatePath || undefined);
				} catch (err) {
					// A missing template must not kill the creation — fall back to
					// a bare note and tell the user (the library flow's behavior).
					if (err instanceof Error && err.message.startsWith('Template not found')) {
						new Notice(t('quickNote.templateNotFound'));
						file = await createNoteWithProps(this.app, folder, title, {});
					} else {
						throw err;
					}
				}
				await this.sync.addDocToCard(card.id, file.path);
				await this.app.workspace.getLeaf('tab').openFile(file);
				new Notice(t('quickNote.created', { name: file.basename }));
			} catch (err) {
				console.error('[Dashboard] card new note failed:', err);
				new Notice(t('library.newNoteFailed'));
			}
		} finally {
			this.cardNewNoteInFlight = false;
		}
	}

	/** Notes section settings: show covers, new-note templates + save folder.
	 *  Templates/folder ride the column's libraryConfig; the cover toggle is
	 *  the column's showCover field — both persist in one write. */
	private openNotesSectionConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		if (!column) return;
		const config = column.libraryConfig;
		const modal = new NotesSectionConfigModal(
			this.app,
			{
				templatePaths: sectionTemplatePaths(config),
				folder: (config?.folders ?? [])[0] ?? '',
				showCover: column.showCover !== false,
			},
			(settings) => {
				void this.sync.updateNotesSectionConfig(colName, {
					filters: [],
					viewMode: 'grid',
					sortBy: 'modified',
					sortDesc: true,
					...config,
					templatePaths: settings.templatePaths.length > 0 ? settings.templatePaths : undefined,
					templatePath: settings.templatePaths[0],
					folders: settings.folder ? [settings.folder] : undefined,
				}, settings.showCover);
			},
		);
		modal.open();
	}

	/** Toolbar "new note": folder sections create inside their configured folder
	 *  (menu when several); library sections create at settings.libraryNewNotePath
	 *  with the section's property filters pre-filled so the note matches them.
	 *  Several configured templates offer a picker menu at the click point
	 *  (dismissal falls back to the first entry). A library section with
	 *  hand-authored scan folders (dashboard-file YAML) follows the folder
	 *  branch — queryVaultFiles scopes its results to those folders, so the
	 *  global path would hide the note.
	 *  The section refresh rides the vault-'create' debounce (registerVaultListeners
	 *  → flushVaultRefresh → refreshSectionsFor) — an inline refresh could beat
	 *  metadataCache indexing and briefly render the section without the new
	 *  note. */
	private async handleLibraryNewNote(columnName: string, pos?: { x: number; y: number }): Promise<void> {
		if (this.libraryNewNoteInFlight) return;
		this.libraryNewNoteInFlight = true;
		try {
			const column = this.data?.columns.find(c => c.name === columnName);
			if (!column || (column.sectionType !== 'folder' && column.sectionType !== 'library')) return;

			const folders = (column.libraryConfig?.folders ?? [])
				.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
				.filter(f => f.length > 0);
			let folder: string;
			if (column.sectionType === 'folder' || folders.length > 0) {
				if (folders.length === 0) {
					new Notice(t('library.newNoteNoFolder'));
					return;
				}
				if (folders.length === 1) {
					folder = folders[0]!;
				} else {
					if (!pos) return;
					folder = (await pickFolderFromMenu(folders, pos)) ?? '';
					if (!folder) return; // menu dismissed
				}
			} else {
				folder = this.plugin.settings.libraryNewNotePath.trim().replace(/^\/+|\/+$/g, '');
			}

			// Template picker: only when several are configured. Dismissed
			// without a pick → the documented default (first entry).
			const templates = sectionTemplatePaths(column.libraryConfig);
			let templatePath = templates[0];
			if (templates.length > 1 && pos) {
				templatePath = (await pickTemplateFromMenu(templates, pos)) ?? templates[0];
			}

			const title = await showPromptDialog(this.app, {
				title: t('quickNote.titlePrompt'),
				placeholder: t('quickNote.titlePlaceholder'),
			});
			if (title == null) return; // cancelled (empty submit cancels too — same as presets)

			const { props, skipped } = buildNewNoteProps(column.libraryConfig);
			try {
				let file: TFile;
				try {
					file = await createNoteWithProps(this.app, folder, title, props, templatePath || undefined);
				} catch (err) {
					// Missing template should not kill the creation — fall back
					// to a bare note and tell the user (the preset behavior).
					if (err instanceof Error && err.message.startsWith('Template not found')) {
						new Notice(t('quickNote.templateNotFound'));
						file = await createNoteWithProps(this.app, folder, title, props);
					} else {
						throw err;
					}
				}
				await this.app.workspace.getLeaf('tab').openFile(file);
				new Notice(t('quickNote.created', { name: file.basename }));
				if (skipped.length > 0) {
					new Notice(t('library.newNoteSkipped', { props: skipped.join(', ') }));
				}
			} catch (err) {
				console.error('[Dashboard] library new note failed:', err);
				new Notice(t('library.newNoteFailed'));
			}
		} finally {
			this.libraryNewNoteInFlight = false;
		}
	}

	private openAddActionModal(): void {
		const modal = new AddActionModal(this.app, (action) => {
			void this.sync.addQuickAction(action);
		});
		modal.open();
	}

	private openEditActionModal(action: QuickAction): void {
		const index = this.data?.quickActions.findIndex(a => a.target === action.target) ?? -1;
		if (index < 0) return;
		const modal = new AddActionModal(
			this.app,
			(updated) => {
				void this.sync.updateQuickAction(index, { name: updated.name, icon: updated.icon });
			},
			action,
		);
		modal.open();
	}

	private async deleteColumn(columnName: string, columnIndex?: number): Promise<void> {
		const confirmed = await showConfirmDialog(this.app, {
			title: t('common.confirmDelete'),
			message: t('renderer.confirmDeleteSection', { column: columnName }),
		});
		if (!confirmed) return;
		await this.sync.deleteColumn(columnName, columnIndex);
		new Notice(t('renderer.sectionDeleted'));
	}

	private async executeAction(action: QuickAction): Promise<void> {
		if (action.type === 'file') {
			await this.navigateToPath(action.target);
		} else if (action.type === 'command') {
			// Route every command (including 'daily-notes') through Obsidian's command
			// system so the core Daily notes plugin honors its folder/format/template
			// settings. (Previously 'daily-notes' was short-circuited to a root-level
			// file that ignored all of those settings.)
			(this.app as AppWithCommands).commands.executeCommandById(action.target);
		}
	}

	private openProjectSearchModal(colName: string): void {
		const modal = new DocSearchModal(this.app, (link) => {
			void this.sync.addCard(colName, {
				title: link.name,
				body: `[[${link.path}]]`,
			});
		});
		modal.open();
	}

	private async promptAddColumn(): Promise<void> {
		const name = await showPromptDialog(this.app, { title: t('renderer.sectionName') });
		if (name) {
			void this.sync.addColumn(name);
		}
	}

	private async navigateToPath(path: string): Promise<void> {
		let file = this.app.vault.getFileByPath(path);
		if (!file && !path.endsWith('.md')) {
			file = this.app.vault.getFileByPath(`${path}.md`);
		}

		if (!file) {
			const basename = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
			if (basename) {
				const found = this.app.vault.getMarkdownFiles().find(mf => mf.basename === basename);
				if (found) file = found;
			}
		}

		if (file) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			return;
		}

		const folderPath = path.replace(/\/$/, '');
		const abstractFile = this.app.vault.getAbstractFileByPath(folderPath);
		if (abstractFile) {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer');
			if (leaves.length > 0) {
				this.app.workspace.setActiveLeaf(leaves[0]!, { focus: true });
			}
		}
	}

	private registerVaultListeners(): void {
		this.unregisterVaultListeners();
		const events = this.app.vault;
		const dashboardPath = dashboardMarkdownPath(this.plugin.settings.dashboardFile);
		// Record one vault change. File events contribute their path (renames
		// both ends); folder events and unknown entities set the broad flag —
		// a folder carries no file path to scope-match, so refresh everything.
		// Our own dashboard-file writes are skipped: the engine owns that state
		// and handleDataUpdate has already re-rendered whatever they changed.
		const record = (file: TAbstractFile | null, oldPath?: string): void => {
			if (file instanceof TFile) {
				if (file.path !== dashboardPath) this.vaultChangePaths.add(file.path);
				if (oldPath && oldPath !== dashboardPath) this.vaultChangePaths.add(oldPath);
			} else {
				this.vaultChangeBroad = true;
			}
			this.scheduleVaultRefresh();
		};

		const createRef = events.on('create', (file: TAbstractFile) => {
			// A brand-new note's frontmatter is indexed asynchronously: the
			// create-debounce may render before the cache has the properties
			// (a pipeline board's strict status filter would hide the card).
			// Track it so its FIRST metadataCache 'changed' (index complete)
			// forces one more refresh pass.
			if (file instanceof TFile && file.extension === 'md') {
				this.pendingMdIndexPaths.add(file.path);
			}
			record(file);
		});
		const modifyRef = events.on('modify', (file: TAbstractFile) => {
			// Plain content edits only matter to the note-derived views; an
			// image overwrite with the same path renders identically.
			if (file instanceof TFile && file.extension === 'md') {
				record(file);
			}
		});
		const deleteRef = events.on('delete', (file: TAbstractFile) => {
			if (file instanceof TFile) this.pendingMdIndexPaths.delete(file.path);
			record(file);
		});
		const renameRef = events.on('rename', (file: TAbstractFile, oldPath: string) => {
			if (file instanceof TFile) {
				if (this.pendingMdIndexPaths.delete(oldPath)) this.pendingMdIndexPaths.add(file.path);
			}
			record(file, oldPath);
		});
		// First cache index of a newly created note: the path/mtime/ctime
		// signature cannot see a cache-only change, so drop the signature
		// cache for this one pass. Gated to pending creations — firing on
		// every edit would nullify the signature short-circuit entirely.
		const metadata = this.app.metadataCache;
		const metaChangedRef = metadata.on('changed', (file: TFile) => {
			if (file.extension !== 'md') return;
			const isCreation = this.pendingMdIndexPaths.delete(file.path);
			// Cache landed after the last refresh pass already used this file —
			// that pass rendered stale frontmatter (e.g. a pin that "bounced
			// back"); drop the signatures and run one corrective pass.
			const isLagged = this.mdCacheLagPaths.has(file.path);
			if (!isCreation && !isLagged) return;
			if (isLagged) this.mdCacheLagPaths.delete(file.path);
			invalidateScanningSectionSignatures();
			record(file);
		});

		this.vaultEventRefs = [
			{ evt: events, ref: createRef },
			{ evt: events, ref: modifyRef },
			{ evt: events, ref: deleteRef },
			{ evt: events, ref: renameRef },
			{ evt: metadata, ref: metaChangedRef },
		];
	}

	private unregisterVaultListeners(): void {
		for (const { evt, ref } of this.vaultEventRefs) {
			evt.offref(ref as Parameters<typeof evt.offref>[0]);
		}
		this.vaultEventRefs = [];
		if (this.vaultRefreshTimer) {
			window.clearTimeout(this.vaultRefreshTimer);
			this.vaultRefreshTimer = null;
		}
		this.vaultChangePaths = new Set();
		this.vaultChangeBroad = false;
		this.pendingMdIndexPaths = new Set();
		this.mdCacheLagPaths = new Set();
		if (this.bannerStatsTimer) {
			window.clearTimeout(this.bannerStatsTimer);
			this.bannerStatsTimer = null;
		}
	}

	/** One trailing debounce for every vault event. A burst of edits costs a
	 *  single fan-out pass instead of five independently-reset timers. */
	private scheduleVaultRefresh(): void {
		if (this.vaultRefreshTimer) window.clearTimeout(this.vaultRefreshTimer);
		this.vaultRefreshTimer = window.setTimeout(() => {
			this.vaultRefreshTimer = null;
			const paths = this.vaultChangePaths;
			const broad = this.vaultChangeBroad;
			this.vaultChangePaths = new Set();
			this.vaultChangeBroad = false;
			this.flushVaultRefresh(paths, broad);
		}, this.VAULT_REFRESH_DEBOUNCE);
	}

	/** Apply one debounced batch of vault changes. Each derived view is gated
	 *  by what the batch can actually affect: note-derived sidebars and
	 *  calendar sections need an .md change, album slideshows and media
	 *  sections an image/audio/video one, and scanning sections a change
	 *  inside their scan scope. */
	private flushVaultRefresh(paths: ReadonlySet<string>, broad: boolean): void {
		const lowerPaths = [...paths].map(p => p.toLowerCase());
		const changedMd = broad || lowerPaths.some(p => p.endsWith('.md'));
		const changedMedia = broad || lowerPaths.some(p => {
			const dot = p.lastIndexOf('.');
			const ext = dot >= 0 ? p.slice(dot + 1) : '';
			const kind = fileKind(ext);
			return kind === 'image' || kind === 'audio' || kind === 'video';
		});
		if (changedMd) {
			this.refreshRecentDocs();
			this.refreshSidebarCalendarNow();
			// Keeps its own extra debounce: the stats recompute walks the vault.
			this.debouncedRefreshBannerStats();
		}
		if (changedMedia) {
			this.refreshAlbumWidgetsNow();
		}
		this.refreshSectionsFor(lowerPaths, broad, changedMd, changedMedia);
		// Arm the lag guard: any of these whose cache lands LATER must force
		// one corrective refresh (the pass above may have read stale cache).
		// UNION, never replace — a replace wipes slow-index entries before
		// their 'changed' arrives, and the corrective pass never fires.
		for (const p of paths) this.mdCacheLagPaths.add(p);
		// Bound the set so a 'changed'-less path cannot accumulate forever.
		if (this.mdCacheLagPaths.size > 200) {
			const excess = this.mdCacheLagPaths.size - 200;
			let dropped = 0;
			for (const p of this.mdCacheLagPaths) {
				if (dropped >= excess) break;
				this.mdCacheLagPaths.delete(p);
				dropped += 1;
			}
		}
	}

	/** Re-scan the sidebar task calendar in place (task dots). The widget DOM
	 *  is preserved across full re-renders, so without this the dots would
	 *  never update. */
	private refreshSidebarCalendarNow(): void {
		if (!this.plugin.settings.widgetCalendarEnabled) return;
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) refreshSidebarTaskCalendar(root);
	}

	/** Re-scan the album folders in place via the widget's controller: an
	 *  unchanged path list leaves the slideshow position and timer untouched. */
	private refreshAlbumWidgetsNow(): void {
		const albums = this.plugin.settings.albums ?? [];
		if (!albums.some(a => a.folder.trim())) return;
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) refreshAlbumWidgets(root, albums, this.app);
	}

	/** Rebuild only the sections whose scan scope intersects the changed
	 *  paths. Library/folder sections are scoped by their configured folders
	 *  (a library without folders scans the whole vault, so it always
	 *  qualifies); calendar sections aggregate tasks across all notes, so any
	 *  .md change qualifies; media sections react to media-file changes.
	 *  `broad` (folder-level events) conservatively refreshes everything. */
	private refreshSectionsFor(lowerPaths: readonly string[], broad: boolean, changedMd: boolean, changedMedia: boolean): void {
		const data = this.sync.getData();
		if (!data) return;
		// HYBRID model: on immersive boards the scanning/media sections are
		// PINNED views — vault-event-driven in-place rebuilds are skipped
		// entirely (each rebuild swaps the tile element, and at Rae's vault
		// event rate that read as continuous strobing). They refresh on the
		// next full render (any board data edit, workspace switch-in, settings
		// change) like every other section. Calendar grids are in-place
		// updates that never swap elements — those stay live everywhere.
		const immersive = resolveEffectiveLayout(this.plugin.settings, data) === 'immersive';
		const sectionType = (col: { sectionType?: string }) => col.sectionType;
		const hasScanning = !immersive && data.columns.some(col => {
			const st = sectionType(col);
			return st === 'library' || st === 'calendar' || st === 'folder' || st === 'pipeline';
		});
		const hasMedia = !immersive && data.columns.some(col => {
			const st = sectionType(col);
			return st === 'images' || st === 'videos';
		});
		if (!hasScanning && !hasMedia) {
			// Calendar grids stay live even on immersive boards (in-place
			// update, no element swap).
			if (immersive && changedMd) {
				const root = this.containerEl.children[1] as HTMLElement | undefined;
				const kanban0 = root?.querySelector('.dashboard-kanban');
				if (kanban0) refreshCalendarSections(kanban0 as HTMLElement);
			}
			// Immersive scanning tiles still live-refresh — SCOPED. Pin
			// toggles, due dates, checklist checks, agent writes and note
			// edits land as in-scope .md changes; refreshSectionInPlace is
			// the immersive-safe path (carries tile placement + scroll +
			// re-wires DnD). Sections with a configured scope (pipeline root,
			// library/folder folders) refresh only when the edit hits that
			// scope; whole-vault scans stay on full-render refresh —
			// rebuilding those on every distant edit was the original
			// strobing this layout's refresh freeze exists to prevent.
			if (immersive && changedMd) {
				for (const col of data.columns) {
					const st = col.sectionType;
					if (st === 'pipeline') {
						const rootFolder = (col.pipelineConfig?.rootFolder ?? '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
						const hit = rootFolder.length === 0 || lowerPaths.some(p => p.startsWith(rootFolder + '/'));
						if (hit) this.refreshSectionInPlace(col.name);
					} else if (st === 'library' || st === 'folder') {
						const folders = (col.libraryConfig?.folders ?? [])
							.map(f => f.trim().replace(/^\/+|\/+$/g, '').toLowerCase())
							.filter(f => f.length > 0);
						if (folders.length === 0) continue; // whole-vault scan: keep the freeze
						const hit = lowerPaths.some(p => folders.some(f => p.startsWith(f + '/')));
						if (hit) this.refreshSectionInPlace(col.name);
					}
				}
			}
			return;
		}

		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const kanban = root?.querySelector('.dashboard-kanban') as HTMLElement | null;
		if (!kanban) {
			// View not laid out yet — fall back to a full render.
			this.render(data);
			return;
		}

		const inScope = (col: DashboardColumn): boolean => {
			const folders = (col.libraryConfig?.folders ?? [])
				.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
				.filter(f => f.length > 0);
			// Pipeline sections scope to their root folder (empty = whole vault).
			if (folders.length === 0 && col.sectionType === 'pipeline') {
				const root = (col.pipelineConfig?.rootFolder ?? '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
				if (root.length > 0) {
					if (broad || lowerPaths.length === 0) return true;
					return lowerPaths.some(p => p.startsWith(root + '/'));
				}
				return true;
			}
			// No configured folders: the section scans the whole vault.
			if (folders.length === 0) return true;
			if (broad || lowerPaths.length === 0) return true;
			return lowerPaths.some(p => folders.some(f => p.startsWith(f.toLowerCase() + '/')));
		};
		const shouldRefreshScanning = (col: DashboardColumn): boolean => {
			const st = sectionType(col);
			// Tasks live in any note, so calendar sections follow every .md.
			if (st === 'calendar') return changedMd;
			return inScope(col);
		};

		const callbacks = this.createCallbacks();
		let swapped = 0;
		if (hasScanning) {
			swapped += refreshScanningSections(
				kanban, data, callbacks, this.app, this.plugin.settings, this,
				shouldRefreshScanning,
				dashboardMarkdownPath(this.plugin.settings.dashboardFile),
			);
			// Calendar sections refresh their grid in place (nav/filter state
			// preserved) instead of going through refreshScanningSections.
			if (changedMd) refreshCalendarSections(kanban);
		}
		if (hasMedia && changedMedia) {
			swapped += refreshMediaSections(kanban, data, callbacks, this.app, this.plugin.settings, this);
		}
		if (swapped > 0) {
			// Refreshed sections were replaced (new DOM), so their grip/card
			// DnD handlers are gone — re-wire DnD across the whole kanban.
			for (const fn of this.dndCleanupFns) fn();
			this.dndCleanupFns = [];
			setupDragAndDrop(kanban, callbacks, this.dndCleanupFns, { skipSectionGrip: immersive });
			if (immersive) this.attachImmersiveResizeHandles(kanban);
		}
	}

	/** Music state changed (transport tick, playlist edit from any surface):
	 *  refresh only the derived parts of the sidebar widget. Desktop-only. */
	private onMusicChanged(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) refreshMusicWidget(root);
	}

	/** Habit data changed (toggle/add/rename/remove from any view or overlay):
	 *  refresh the habit widget in place + the mobile habit panel, and let the
	 *  banner debounce recompute when it shows the habit heatmap. */
	private onHabitChanged(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) refreshHabitWidget(root);
		const panel = root?.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (panel && this.mobileWidgetExpanded === 'habit') {
			panel.empty();
			renderSidebarHabitWidget(panel, this.app);
		}
		this.debouncedRefreshBannerStats();
	}

	/** Expense data changed (entry added / record deleted from any view or
	 *  the stats overlay): refresh the widget's derived labels in place + the
	 *  mobile expense panel. The form inputs are never touched, so typing in
	 *  this view survives entries made elsewhere. */
	private onExpenseChanged(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root) refreshExpenseWidget(root);
		const panel = root?.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (panel && this.mobileWidgetExpanded === 'expense') {
			panel.empty();
			renderSidebarExpenseWidget(panel, this.app);
		}
	}

	/** Pomodoro data changed externally (focus re-sync merged another
	 *  device's records): re-render the widget in place + the mobile panel.
	 *  Timer state lives in the service, so a running session is untouched. */
	private onPomodoroDataChanged(): void {
		const service = this.pomodoroService;
		if (!service) return;
		this.refreshDataWidget('.dashboard-sidebar-pomodoro', (c) =>
			renderSidebarPomodoro(c, service, this.plugin.settings, this.app, bg => {
				this.plugin.settings = { ...this.plugin.settings, pomodoroBackground: bg };
				void this.plugin.saveSettings();
				this.plugin.refreshAllDashboards();
			}));
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const panel = root?.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (panel && this.mobileWidgetExpanded === 'pomodoro') {
			panel.empty();
			renderSidebarPomodoro(panel, service, this.plugin.settings);
		}
	}

	/** Reading data changed externally (focus re-sync merged another device's
	 *  records): re-render the widget in place + the mobile panel. */
	private onReadingDataChanged(): void {
		const service = this.readingService;
		if (!service) return;
		this.refreshDataWidget('.dashboard-sidebar-reading', (c) =>
			renderSidebarReading(c, service));
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const panel = root?.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (panel && this.mobileWidgetExpanded === 'reading') {
			panel.empty();
			renderSidebarReading(panel, service);
		}
	}

	/** Holiday data can arrive over the network after the first mobile paint.
	 *  Update only the lunar widget/panel; a second full dashboard render here
	 *  was one of the startup memory spikes that could trigger a WebView reload. */
	private refreshLunarWidgetsInPlace(): void {
		this.refreshDataWidget('.dashboard-sidebar-lunar', (container) =>
			renderSidebarLunarWidget(container, this.holidayData, this.app));
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const panel = root?.querySelector<HTMLElement>('.dashboard-mobile-widget-panel');
		if (panel && this.mobileWidgetExpanded === 'lunar') {
			panel.empty();
			renderSidebarLunarWidget(panel, this.holidayData, this.app);
		}
	}

	/** Re-render one sidebar data widget in place: render into a fresh mount
	 *  at the same position, then drop the old node (emptying in place would
	 *  nest a second .dashboard-sidebar-widget inside and confuse the
	 *  sidebar's widget enumeration/drag handlers). The swapped widget's
	 *  internal scroll (habit list, music playlist) carries over the swap so
	 *  a data refresh elsewhere never yanks the widget's viewport. */
	private refreshDataWidget(selector: string, render: (container: HTMLElement) => void): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const widget = root?.querySelector<HTMLElement>(selector);
		if (!widget || !widget.isConnected) return;
		const parent = widget.parentElement;
		if (!parent) return;
		const scrollStates = captureScrollStates(widget);
		const mount = createDiv();
		mount.addClass('dashboard-sidebar-widget-mount');
		// Carry the replaced widget's identity onto the mount: the stacked
		// widget grid keys its per-type sizing off [data-widget-key] on the
		// DIRECT child, which after this swap is the mount, not the widget.
		const key = widget.dataset.widgetKey;
		if (key) mount.dataset.widgetKey = key;
		const span = widget.style.getPropertyValue('--db-widget-span');
		if (span) mount.style.setProperty('--db-widget-span', span);
		// Immersive: the widget IS a grid tile — without carrying its id and
		// inline placement the swapped-in mount drops to auto placement and
		// slides off to the end of the board. Same carry pattern as the key.
		const immId = widget.dataset.immId;
		if (immId) {
			mount.dataset.immId = immId;
			if (widget.style.gridColumn) mount.style.gridColumn = widget.style.gridColumn;
			if (widget.style.gridRow) mount.style.gridRow = widget.style.gridRow;
			if (widget.style.minHeight) mount.style.minHeight = widget.style.minHeight;
		}
		parent.insertBefore(mount, widget);
		widget.remove();
		render(mount);
		restoreScrollStates(mount, scrollStates);
		// The corner resize grip and the hover delete button lived inside the
		// swapped-out card.
		if (immId && resolveEffectiveLayout(this.plugin.settings, this.data) === 'immersive') {
			attachImmersiveResizeHandle(mount, immId, () => this.immItems, next => this.commitImmersiveItems(next));
			if (immId.startsWith('widget:')) {
				attachImmersiveWidgetDelete(mount, removeId => void this.removeImmersiveItem(removeId));
			}
		}
	}

	/** Recompute the stats banner in place (only when in stats mode). Vault
	 *  changes are the trigger; debounced so a burst of edits costs one pass.
	 *  Refresh regardless of whether a statsConfig is saved — defaults resolve
	 *  at render time, so an absent config must not skip the refresh (that would
	 *  freeze the stats after first paint). */
	private debouncedRefreshBannerStats(): void {
		if (!this.data || this.data.banner.mode !== 'stats') return;
		if (this.bannerStatsTimer) window.clearTimeout(this.bannerStatsTimer);
		this.bannerStatsTimer = window.setTimeout(() => {
			const el = this.bannerStatsEl;
			if (el && el.isConnected) {
				refreshBannerStats(el, this.data!.banner.statsConfig, this.app);
			}
		}, this.BANNER_STATS_DEBOUNCE);
	}

	private refreshRecentDocs(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		if (!root) return;

		const recentSection = root.querySelector('.dashboard-recent');
		if (!recentSection) return;

		const parent = recentSection.parentElement;
		if (!parent) return;

		recentSection.remove();
		const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
		renderRecentDocs(parent, docs, (path) => { void this.navigateToPath(path); });
	}

	/** Tear down per-render resources. With `preserveSidebarWidgets`, the sidebar
	 *  widgets DOM is being re-attached (signature unchanged): its countdown
	 *  timers and the pomodoro/reading services' onTick wiring (which reference
	 *  live DOM inside it) must survive; a fresh widgets render re-wires them. */
	private runCleanup(preserve: PreserveScope = null): void {
		destroyAllCharts(preserve);
		destroyAlbumWidgets(preserve);
		destroyAnniversaryTimers(preserve);
		if (!preserve) {
			if (this.pomodoroService) {
				this.pomodoroService.setOnTick(null);
				this.pomodoroService.setOnComplete(null);
			}
			if (this.readingService) {
				this.readingService.setOnTick(null);
			}
		}
		for (const fn of this.cleanupFns) fn();
		this.cleanupFns = [];
		for (const fn of this.dndCleanupFns) fn();
		this.dndCleanupFns = [];
	}

	/**
	 * Floating "back to top" button pinned to the bottom-right corner.
	 *
	 * The active scroll element differs by layout: on desktop the inner
	 * `.dashboard-kanban` scrolls; on mobile (<=640px) the `.apex-dashboard-root`
	 * itself scrolls. We detect which one is actually scrollable and listen to it,
	 * so the button always scrolls the right container and only appears once the
	 * user has scrolled down. Cleanup is registered so listeners are torn down on
	 * re-render / close.
	 */
	private renderScrollToTop(container: HTMLElement): void {
		const btn = container.createEl('button', {
			cls: 'dashboard-scroll-top',
			attr: { 'aria-label': t('renderer.scrollToTop'), type: 'button' },
		});
		setIcon(btn, 'arrow-up');

		// Pick the element that actually scrolls in the current layout.
		const root = container;
		const kanbanEl = container.querySelector('.dashboard-kanban');
		const regionEl = container.querySelector('.dashboard-scroll-region');
		const pickScroller = (): HTMLElement => {
			if (window.innerWidth <= 640) return root;
			// Stacked layout: the shared region scrolls (widgets + sections);
			// the kanban itself is a static pass-through there.
			return (regionEl as HTMLElement) ?? (kanbanEl as HTMLElement) ?? root;
		};

		const updateVisibility = (): void => {
			const scroller = pickScroller();
			const threshold = Math.max(160, scroller.clientHeight * 0.3);
			if (scroller.scrollTop > threshold) {
				btn.addClass('dashboard-scroll-top--visible');
			} else {
				btn.removeClass('dashboard-scroll-top--visible');
			}
		};

		btn.addEventListener('click', () => {
			const scroller = pickScroller();
			scroller.scrollTo({ top: 0, behavior: 'smooth' });
		});

		// Listen on all candidates: cheap, and covers desktop↔mobile resizes.
		// The region listener matters for stacked AND immersive (the region is
		// the scroller in both; scroll events do not bubble up from it).
		const onKanbanScroll = (): void => updateVisibility();
		const onRootScroll = (): void => updateVisibility();
		const onResize = (): void => updateVisibility();
		if (kanbanEl) kanbanEl.addEventListener('scroll', onKanbanScroll, { passive: true });
		if (regionEl) regionEl.addEventListener('scroll', onRootScroll, { passive: true });
		root.addEventListener('scroll', onRootScroll, { passive: true });
		window.addEventListener('resize', onResize);

		this.cleanupFns.push(() => {
			btn.remove();
			if (kanbanEl) kanbanEl.removeEventListener('scroll', onKanbanScroll);
			if (regionEl) regionEl.removeEventListener('scroll', onRootScroll);
			root.removeEventListener('scroll', onRootScroll);
			window.removeEventListener('resize', onResize);
		});

		updateVisibility();
	}

	private startReminderChecker(): void {
		this.checkReminders();
		this.reminderTimer = window.setInterval(() => this.checkReminders(), DashboardView.REMINDER_CHECK_MS);
	}

	private stopReminderChecker(): void {
		if (this.reminderTimer) {
			window.clearInterval(this.reminderTimer);
			this.reminderTimer = null;
		}
	}

	private startWeatherRefresh(): void {
		this.weatherRefreshTimer = window.setInterval(() => {
			if (!this.data) return;
			const hasWeather = this.data.columns.some(col =>
				col.cards.some(c => c.type === 'weather')
			);
			// The sidebar weather widget DOM is preserved across re-renders, so it
			// no longer refreshes as a side effect of re-renders - pull it into the
			// same periodic refresh. The widget renders through the weather cache,
			// so this only refetches once the TTL has lapsed.
			const hasSidebarWeather = this.plugin.settings.widgetWeatherEnabled;
			if (!hasWeather && !hasSidebarWeather) return;
			// Refresh in place instead of rebuilding the whole dashboard. Full
			// render() here was the main source of periodic jank on mobile - it
			// emptied and rebuilt every card/section.
			clearWeatherCache();
			const root = this.containerEl.children[1] as HTMLElement | undefined;
			if (!root) return;
			if (hasWeather) refreshWeatherCards(root, this.data);
			if (hasSidebarWeather) refreshSidebarWeatherWidget(root, this.plugin.settings, this.app);
		}, DashboardView.WEATHER_REFRESH_MS);
	}

	private stopWeatherRefresh(): void {
		if (this.weatherRefreshTimer) {
			window.clearInterval(this.weatherRefreshTimer);
			this.weatherRefreshTimer = null;
		}
		clearWeatherCache();
	}

	private startDayRolloverChecker(): void {
		this.dayRolloverTimer = window.setInterval(() => this.checkDayRollover(), DashboardView.DAY_ROLLOVER_CHECK_MS);
	}

	private stopDayRolloverChecker(): void {
		if (this.dayRolloverTimer) {
			window.clearInterval(this.dayRolloverTimer);
			this.dayRolloverTimer = null;
		}
	}

	private checkDayRollover(): void {
		if (!this.data) return;
		const todayKey = new Date().toDateString();
		if (todayKey === this.lastRenderedDay) return;

		this.lastRenderedDay = todayKey;
		// Invalidate the widget signature so the preserved widgets DOM is rebuilt:
		// date-dependent widgets (lunar, year progress, countdown values, task
		// calendar) must recompute for the new day.
		this.sidebarWidgetsSig = null;
		this.render(this.data);
	}

	private checkReminders(): void {
		if (!this.data) return;
		const now = new Date();

		for (const col of this.data.columns) {
			for (const card of col.cards) {
				for (let i = 0; i < card.tasks.length; i++) {
					const task = card.tasks[i]!;
					if (!task.reminder || task.checked) continue;

					const key = `${card.id}-${JSON.stringify([i])}`;
					if (this.firedReminders.has(key)) continue;

					const parts = task.reminder.trim().split(/\s+/);
					if (parts.length < 2) continue;
					const [dateStr, timeStr] = parts;
					const [year, month, day] = dateStr!.split('-').map(Number);
					const [hour, min] = timeStr!.split(':').map(Number);
					if (!year || !month || !day) continue;
					const due = new Date(year, month - 1, day, hour ?? 0, min ?? 0);

					if (now >= due) {
						this.firedReminders.add(key);
						const cleanText = task.text.replace(/\[\[[^\]]+\]\]/g, (match) => {
							const inner = match.slice(2, -2);
							return inner.split('|').pop()?.split('/').pop()?.replace(/\.md$/, '') ?? inner;
						});
						this.showReminderModal(cleanText, card.id, [i]);
					}
				}
			}

			// Workflow (pipeline) notes: a note-level `due` + `remind: true`
		// frontmatter pair raises the same reminder modal. Dismiss clears the
		// alarm; snooze pushes the due value an hour out (written back to the
		// note). The scan rides the metadata cache — no file reads.
		for (const col of this.data.columns) {
			if (col.sectionType !== 'pipeline' || !col.pipelineConfig) continue;
			const cfg = col.pipelineConfig;
			for (const file of this.app.vault.getMarkdownFiles()) {
				if (!file.path.toLowerCase().startsWith(cfg.rootFolder.toLowerCase() + '/')) continue;
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (!fm || fm['remind'] !== true) continue;
				const due = parseNoteDue(fm);
				if (!due) continue;
				const key = `pipe:${file.path}`;
				if (this.firedReminders.has(key)) continue;
				const [y, mo, d] = due.date.split('-').map(Number);
				if (!y || !mo || !d) continue;
				const [h, mi] = (due.time ?? '09:00').split(':').map(Number);
				const when = new Date(y, mo - 1, d, h ?? 9, mi ?? 0);
				if (now < when) continue;
				this.firedReminders.add(key);
				const modal = new ReminderNoticeModal(
					this.app,
					file.basename,
					() => {
						// Dismiss: drop the alarm flag, keep the due value.
						void this.app.fileManager.processFrontMatter(file, (f: Record<string, unknown>) => { delete f['remind']; });
					},
					() => {
						// Snooze one hour, re-arm.
						const snoozed = new Date(Date.now() + 60 * 60 * 1000);
						const pad = (n: number) => String(n).padStart(2, '0');
						const value = `${snoozed.getFullYear()}-${pad(snoozed.getMonth() + 1)}-${pad(snoozed.getDate())} ${pad(snoozed.getHours())}:${pad(snoozed.getMinutes())}`;
						this.firedReminders.delete(key);
						void this.app.fileManager.processFrontMatter(file, (f: Record<string, unknown>) => { f['due'] = value; f['remind'] = true; });
					},
				);
				modal.open();
			}
		}

		// Countdown reminders (one per configured countdown)
			if (this.plugin.settings.countdownEnabled) {
				for (const cd of this.plugin.settings.countdowns ?? []) {
					if (!cd.targetDate || cd.reminderDays <= 0) continue;
					const ckKey = `countdown-remind-${cd.id}`;
					if (this.firedReminders.has(ckKey)) continue;
					const raw = cd.targetDate;
					const target = raw.includes('T') ? new Date(raw) : new Date(raw + 'T00:00:00');
					const diffMs = target.getTime() - now.getTime();
					const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
					if (daysLeft >= 0 && daysLeft <= cd.reminderDays) {
						this.firedReminders.add(ckKey);
						const label = cd.label || cd.targetDate;
						new Notice(t('countdown.reminderNotice', { label, days: String(daysLeft) }));
					}
				}
			}
		}

		// Anniversary reminders: fire once a year on the entry's month/day
		// (outside the columns loop — a per-column placement would just repeat
		// the same guarded check). Feb 29 entries roll to Mar 1 in common
		// years via the Date overflow in anniversaryDateThisYear. Lunar
		// entries fire on the lunar anniversary's solar date this year (it
		// drifts through the Gregorian calendar), counted in lunar years.
		if (this.plugin.settings.anniversaryEnabled) {
			for (const av of this.plugin.settings.anniversaries ?? []) {
				if (!av.annualReminder || !av.startDate) continue;
				const avKey = `anniversary-remind-${av.id}`;
				if (this.firedReminders.has(avKey)) continue;
				const start = parseAnniversaryDate(av.startDate);
				if (!start) continue;
				const lunar = av.calendar === 'lunar';
				const today = lunar ? lunarAnniversaryThisYear(start, now) : anniversaryDateThisYear(start, now);
				if (now.getFullYear() === today.getFullYear()
					&& now.getMonth() === today.getMonth()
					&& now.getDate() === today.getDate()) {
					this.firedReminders.add(avKey);
					const label = av.label || av.startDate;
					const years = lunar
						? String(lunarYearsBetween(start, now) ?? (now.getFullYear() - start.getFullYear()))
						: String(now.getFullYear() - start.getFullYear());
					new Notice(t('anniversary.reminderNotice', { label, years }));
				}
			}
		}
	}

	private showReminderModal(taskText: string, cardId: string, taskPath: number[]): void {
		const modal = new ReminderNoticeModal(
			this.app,
			taskText,
			() => {
				void this.sync.editTaskReminder(cardId, taskPath, undefined);
			},
			() => {
				const snoozed = new Date(Date.now() + 60 * 60 * 1000);
				const pad = (n: number) => String(n).padStart(2, '0');
				const newReminder = `${snoozed.getFullYear()}-${pad(snoozed.getMonth() + 1)}-${pad(snoozed.getDate())} ${pad(snoozed.getHours())}:${pad(snoozed.getMinutes())}`;
				this.firedReminders.delete(`${cardId}-${JSON.stringify(taskPath)}`);
				void this.sync.editTaskReminder(cardId, taskPath, newReminder);
			},
		);
		modal.open();
	}
}
