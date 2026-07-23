import { Events, HoverParent, HoverPopover, ItemView, Modal, moment, Notice, setIcon, Setting, WorkspaceLeaf, TFile } from 'obsidian';
import type DashboardPlugin from './main';
import type { AppWithCommands } from './obsidian-internal';
import type { DashboardData, DashboardCard, QuickAction, BannerData, LibraryConfig } from './types';
import { SyncEngine } from './sync';
import { renderDashboard, destroyAllCharts, renderSidebarWidgets, renderSidebarPomodoro, renderSidebarReading, refreshScanningSections, refreshMediaSections, renderSection } from './renderer';
import { renderBanner, BannerEditModal, resolveVaultImage } from './banner';
import { getRecentDocs, renderRecentDocs } from './recent';
import { renderQuickActions, AddActionModal, DocSearchModal } from './quick-actions';
import { setupDragAndDrop } from './dnd';
import { CardEditModal } from './card-edit-modal';
import { NotePopoverModal } from './note-popover-modal';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';
import { clearWeatherCache } from './weather-service';
import { renderSidebarLunarWidget, loadHolidayData } from './lunar-widget';
import type { HolidayInfo } from './holiday-service';
import { WidgetTypeModal, type WidgetType } from './widget-type-modal';
import { AddSectionModal } from './add-section-modal';
import { WeatherConfigModal } from './weather-config-modal';
import { LibraryConfigModal } from './library-config-modal';
import { FolderConfigModal } from './folder-config-modal';
import { HeatmapConfigModal } from './heatmap-config-modal';
import { WereadConfigModal } from './weread-config-modal';
import { fetchWereadCategories } from './weread-service';
import { fetchTickTickProjects } from './ticktick-config-modal';
import { CalendarConfigModal } from './calendar-config-modal';
import { DailyJournalService, renderSidebarMonthCalendar, toLocalIsoDate, type DailyJournalRenderContext } from './daily-journal';
import { TrackerConfigModal } from './tracker-config-modal';
import { TemplatePickerModal } from './template-modal';
import { PomodoroService } from './pomodoro-service';
import { ReadingService } from './reading-service';
import { ReminderNoticeModal } from './reminder-notice';
import { t } from './i18n';
import { archiveCompleted, serializeTasksForNote } from './task-tree';
import type { App } from 'obsidian';

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
	private recentDocsTimer: number | null = null;
	private libraryRefreshTimer: number | null = null;
	private readonly RECENT_DOCS_DEBOUNCE = 500;
	private bannerQuoteIndex = 0;
	private bannerImageIndex = 0;
	private static readonly BANNER_QUOTE_ROTATION_MS = 60 * 60 * 1000; // 1 hour (on the hour)
	private static readonly BANNER_IMAGE_ROTATION_MS = 30 * 60 * 1000; // 30 min (on the half)
	private static readonly REMINDER_CHECK_MS = 60 * 1000; // 1 minute
	private static readonly BANNER_QUOTE_OFFSET_MS = 60 * 60 * 1000; // offset by 1 hour from image
	private reminderTimer: number | null = null;
	private firedReminders = new Set<string>();
	private sidebarPinned = this.app.loadLocalStorage('apex-dashboard-sidebar-pinned') === 'true';
	private sidebarExpanded = false;
	private sidebarHiddenByBanner = false;
	private bannerCollapsed = this.app.loadLocalStorage('apex-dashboard-banner-collapsed') === 'true';
	private pendingScrollCardId: string | null = null;
	private pendingScrollToLastCardOfColumn: string | null = null;
	private pomodoroService: PomodoroService | null = null;
	private readingService: ReadingService | null = null;
	private holidayData: Record<string, HolidayInfo> = {};
	private mobileWidgetExpanded: 'pomodoro' | 'reading' | 'lunar' | null = null;
	private mobileWidgetTabsOpen: boolean = false;
	private static readonly WEATHER_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
	private weatherRefreshTimer: number | null = null;
	private static readonly DAY_ROLLOVER_CHECK_MS = 60 * 1000; // 1 minute
	private dayRolloverTimer: number | null = null;
	private lastRenderedDay = new Date().toDateString();
	private selectedDailyDate = toLocalIsoDate(new Date());
	private dailyJournalService: DailyJournalService;

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
		this.dailyJournalService = new DailyJournalService(this.app, this.plugin.settings.dailyJournalFolder);
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('main.dashboard');
	}

	getIcon(): string {
		return 'home';
	}

	async onOpen(): Promise<void> {
		// Obsidian may keep a dashboard view instance alive across tab switches or
		// workspace restores. Always start a newly opened dashboard on local today.
		this.lastRenderedDay = new Date().toDateString();
		this.selectedDailyDate = toLocalIsoDate(new Date());
		this.sync.updateSettings(this.plugin.settings);
		this.sync.onDataUpdate((data) => {
			this.data = data;
			if (this.suppressNextRender) {
				this.suppressNextRender = false;
				return;
			}
			this.render(data);
		});

		await this.sync.init();
		this.registerVaultListeners();
		this.startReminderChecker();
		this.startWeatherRefresh();
		this.startDayRolloverChecker();
		this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
			if (leaf === this.leaf) this.returnDailyJournalToToday();
		}));
		this.registerDomEvent(window, 'focus', () => this.checkDayRollover());
		this.pomodoroService = new PomodoroService(this.plugin);
		await this.pomodoroService.loadSessions();
		this.readingService = new ReadingService(this.plugin);
		await this.readingService.loadSessions();
		void loadHolidayData(this.app).then(data => {
			this.holidayData = data;
			const currentData = this.sync.getData();
			if (currentData) this.render(currentData);
		});
	}

	async onClose(): Promise<void> {
		this.popoverModal?.close();
		this.popoverModal = null;
		this.runCleanup();
		this.unregisterVaultListeners();
		this.stopReminderChecker();
		this.stopWeatherRefresh();
		this.stopDayRolloverChecker();
		this.pomodoroService?.destroy();
		this.pomodoroService = null;
		this.readingService?.destroy();
		this.readingService = null;
		this.sync.destroy();
	}

	async refresh(): Promise<void> {
		this.sync.updateSettings(this.plugin.settings);
		this.dailyJournalService.updateFolder(this.plugin.settings.dailyJournalFolder);
		const data = this.sync.getData();
		if (data) {
			this.render(data);
		}
	}

	async addSection(): Promise<void> {
		const name = await showPromptDialog(this.app, { title: t('renderer.sectionName') });
		if (name) {
			void this.sync.addColumn(name);
		}
	}

	private render(data: DashboardData): void {
		this.runCleanup();
		this.data = data;
		this.firedReminders.clear();

		// Save scroll positions before re-render
		const root = this.containerEl.children[1] as HTMLElement;
		const kanbanEl = root?.querySelector('.dashboard-kanban');
		const sidebarScrollEl = root?.querySelector('.dashboard-sidebar-scroll');
		const savedKanbanScroll = kanbanEl ? kanbanEl.scrollTop : 0;
		const savedSidebarScroll = sidebarScrollEl ? sidebarScrollEl.scrollTop : 0;

		const savedCardScrolls = new Map<string, number>();
		root?.querySelectorAll('.dashboard-section-cards').forEach((el) => {
			const section = (el as HTMLElement).closest('.dashboard-section-row');
			const key = section?.getAttribute('data-column') ?? '';
			if (key) savedCardScrolls.set(key, (el as HTMLElement).scrollLeft);
		});

		// Save per-task-list scroll positions so they survive re-render
		const savedTaskListScrolls = new Map<string, number>();
		root?.querySelectorAll('.dashboard-task-list').forEach((el) => {
			const cardId = (el as HTMLElement).dataset.cardId;
			if (cardId) savedTaskListScrolls.set(cardId, (el as HTMLElement).scrollTop);
		});

		const container = this.containerEl.children[1] as HTMLElement;

		// Sweep any touch-drag ghost clones stranded on activeDocument.body from a prior
		// interrupted drag (touchcancel). They live outside the container, so
		// container.empty() cannot reach them.
		activeDocument.body.querySelectorAll(':scope > .dashboard-card--ghost').forEach((el) => el.remove());

		container.empty();
		container.addClass('apex-dashboard-root');
		container.setAttribute('data-theme', this.plugin.settings.stylePreset);

		const bannerEl = renderBanner(
			container,
			data.banner,
			() => this.openBannerEditModal(data),
			this.app,
		);

		this.renderMobileActions(bannerEl);

		if (this.bannerCollapsed && window.innerWidth > 640) {
			bannerEl.addClass('dashboard-banner--collapsed');
		}
		this.setupBannerBehavior(bannerEl);

		// Banner quote rotation
		this.setupBannerRotation(container, data.banner);

		this.renderMobileWidgetBar(container);

		const mainLayout = container.createDiv({ cls: 'dashboard-main' });

		const sidebar = mainLayout.createDiv({ cls: 'dashboard-sidebar' });
		if (this.sidebarHiddenByBanner) {
			sidebar.addClass('dashboard-sidebar--collapsed');
		} else if (this.sidebarPinned) {
			sidebar.addClass('dashboard-sidebar--pinned');
		} else if (this.sidebarExpanded) {
			sidebar.addClass('dashboard-sidebar--expanded');
		} else {
			sidebar.addClass('dashboard-sidebar--collapsed');
		}
		this.renderSidebar(sidebar, container);
		this.setupSidebarBehavior(sidebar);

		const kanban = mainLayout.createDiv({ cls: 'dashboard-kanban-wrapper' });
		renderDashboard(kanban, data, this.createCallbacks(), this.app, this.plugin.settings, this, this.createDailyJournalContext());
		setupDragAndDrop(kanban, this.createCallbacks(), this.dndCleanupFns);
		// Library config event delegation
		kanban.addEventListener('dashboard-library-config', ((e: CustomEvent) => {
			const { columnName } = e.detail as { columnName: string };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col?.sectionType === 'folder') {
				this.openFolderConfigModal(columnName);
			} else if (col?.sectionType === 'calendar') {
				this.openCalendarConfigModal(columnName);
			} else if (col?.sectionType === 'heatmap') {
				this.openHeatmapConfigModal(columnName);
			} else if (col?.sectionType === 'weread') {
				this.openWereadConfigModal(columnName);
			} else {
				this.openLibraryConfigModal(columnName);
			}
		}) as EventListener);

		// TickTick view toggle (today/lists) — dispatched from header buttons.
		kanban.addEventListener('dashboard-ticktick-view', ((e: CustomEvent) => {
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
		kanban.addEventListener('dashboard-ticktick-filter', ((e: CustomEvent) => {
			const { columnName } = e.detail as { columnName: string };
			void this.openTickTickFilterModal(columnName);
		}) as EventListener);

		// TickTick project card resize (lists view).
		kanban.addEventListener('dashboard-ticktick-resize', ((e: CustomEvent) => {
			const { columnName, projectWidths } = e.detail as { columnName: string; projectWidths: Record<string, number> };
			const col = this.data?.columns.find(c => c.name === columnName);
			if (col?.ticktickConfig) {
				this.suppressNextRender = true;
				void this.sync.updateTickTickConfig(columnName, { ...col.ticktickConfig, projectWidths }).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			}
		}) as EventListener);


		// Restore scroll positions
		const newKanban = container.querySelector('.dashboard-kanban');
		const newSidebarScroll = container.querySelector('.dashboard-sidebar-scroll');
		if (newKanban) newKanban.scrollTop = savedKanbanScroll;
		if (newSidebarScroll) newSidebarScroll.scrollTop = savedSidebarScroll;

		container.querySelectorAll('.dashboard-section-cards').forEach((el) => {
			const section = (el as HTMLElement).closest('.dashboard-section-row');
			const key = section?.getAttribute('data-column') ?? '';
			const saved = savedCardScrolls.get(key);
			if (saved !== undefined) (el as HTMLElement).scrollLeft = saved;
		});

		// Restore per-task-list scroll positions
		container.querySelectorAll('.dashboard-task-list').forEach((el) => {
			const cardId = (el as HTMLElement).dataset.cardId;
			const saved = cardId ? savedTaskListScrolls.get(cardId) : undefined;
			if (saved !== undefined) (el as HTMLElement).scrollTop = saved;
		});

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

		const widgets: Array<{ key: 'pomodoro' | 'reading' | 'lunar'; label: string; icon: string }> = [
			{ key: 'pomodoro', label: t('mobile.pomodoro'), icon: 'hourglass' },
			{ key: 'reading', label: t('mobile.reading'), icon: 'book-open' },
			{ key: 'lunar', label: t('mobile.lunar'), icon: 'moon' },
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
			renderSidebarPomodoro(panel, this.pomodoroService, this.plugin.settings);
		} else if (this.mobileWidgetExpanded === 'reading' && this.readingService) {
			renderSidebarReading(panel, this.readingService);
		} else if (this.mobileWidgetExpanded === 'lunar') {
			renderSidebarLunarWidget(panel, this.holidayData, this.app);
		}
	}

	private setupBannerBehavior(bannerEl: HTMLElement): void {
		bannerEl.addClass('dashboard-banner--sidebar-toggle');
		bannerEl.setAttribute('aria-label', t('banner.toggleSidebar'));
		bannerEl.setAttribute('title', t('banner.toggleSidebar'));
		bannerEl.setAttribute('tabindex', '0');
		bannerEl.setAttribute('aria-expanded', String(!this.sidebarHiddenByBanner && (this.sidebarPinned || this.sidebarExpanded)));

		const toggleSidebar = () => {
			if (window.innerWidth <= 640) return;
			const root = bannerEl.closest('.apex-dashboard-root');
			const sidebar = root?.querySelector<HTMLElement>('.dashboard-sidebar');
			if (!sidebar) return;

			const expand = sidebar.hasClass('dashboard-sidebar--collapsed');
			if (expand) {
				this.sidebarHiddenByBanner = false;
				sidebar.removeClass('dashboard-sidebar--collapsed');
				if (this.sidebarPinned) {
					sidebar.addClass('dashboard-sidebar--pinned');
					sidebar.removeClass('dashboard-sidebar--expanded');
					this.sidebarExpanded = false;
				} else {
					sidebar.removeClass('dashboard-sidebar--pinned');
					sidebar.addClass('dashboard-sidebar--expanded');
					this.sidebarExpanded = true;
				}
			} else {
				// Keep the user's pin preference; the banner is a temporary visibility
				// toggle, so reopening restores the pinned state when applicable.
				this.sidebarHiddenByBanner = true;
				sidebar.removeClass('dashboard-sidebar--pinned');
				sidebar.removeClass('dashboard-sidebar--expanded');
				sidebar.addClass('dashboard-sidebar--collapsed');
				this.sidebarExpanded = false;
			}
			bannerEl.setAttribute('aria-expanded', String(expand));
		};

		bannerEl.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target.closest('button, a, input, textarea, select')) return;
			e.stopPropagation();
			toggleSidebar();
		});
		bannerEl.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			if ((e.target as HTMLElement).closest('button')) return;
			e.preventDefault();
			e.stopPropagation();
			toggleSidebar();
		});

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
		// Quote rotation
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

		// Image rotation
		const images = banner.images;
		if (images && images.length > 1) {
			const imgIndex = Math.floor(Date.now() / DashboardView.BANNER_IMAGE_ROTATION_MS) % images.length;
			this.bannerImageIndex = imgIndex;

			const bannerEl = container.querySelector('.dashboard-banner') as HTMLElement;
			if (bannerEl) {
				const resolved = resolveVaultImage(this.app, images[imgIndex]!);
				if (resolved) {
					bannerEl.style.backgroundImage = `url("${resolved}")`;
				}

				const rotateImage = () => {
					this.bannerImageIndex = (this.bannerImageIndex + 1) % images.length;
					const nextPath = images[this.bannerImageIndex]!;
					const nextResolved = resolveVaultImage(this.app, nextPath);

					bannerEl.addClass('dashboard-banner--fading');

					window.setTimeout(() => {
						if (nextResolved) {
							bannerEl.style.backgroundImage = `url("${nextResolved}")`;
						}
						bannerEl.removeClass('dashboard-banner--fading');
					}, 600);
				};

				const imgTimer = window.setInterval(rotateImage, DashboardView.BANNER_IMAGE_ROTATION_MS);
				this.cleanupFns.push(() => window.clearInterval(imgTimer));
			}
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
					undefined,
					undefined,
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

	private renderSidebar(sidebar: HTMLElement, root: HTMLElement): void {
		if (!this.data) return;

		const scroll = sidebar.createDiv({ cls: 'dashboard-sidebar-scroll' });

		renderSidebarMonthCalendar(scroll, this.selectedDailyDate, this.dailyJournalService, (date) => {
			this.selectedDailyDate = date;
			if (this.data) this.render(this.data);
		});

		renderSidebarWidgets(scroll, this.plugin.settings, this.app, this.pomodoroService ?? undefined, this.readingService ?? undefined, this.holidayData, (order) => {
			void (async () => {
				this.plugin.settings = {
					...this.plugin.settings,
					widgetOrder: order,
				};
				await this.plugin.saveSettings();
				this.render(this.data!);
			})();
		});

		renderQuickActions(
			scroll,
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
			this.sidebarPinned,
			() => {
				this.sidebarPinned = !this.sidebarPinned;
				this.app.saveLocalStorage('apex-dashboard-sidebar-pinned', String(this.sidebarPinned));
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
			},
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
		);

		const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
		renderRecentDocs(
			scroll,
			docs,
			(path) => { void this.navigateToPath(path); },
		);
	}

	private setupSidebarBehavior(sidebar: HTMLElement): void {
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
				this.sidebarHiddenByBanner = false;
			}
		}, true);
	}

	private createCallbacks() {
		return {
			onCardEdit: (card: DashboardCard) => this.openCardEditModal(card),
			onOpenNoteInPopover: (file: TFile) => this.openNote(file),
			onCardDelete: async (cardId: string) => {
				const confirmed = await showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				});
				if (!confirmed) return;
				void this.sync.deleteCard(cardId);
				new Notice(t('card.deleted'));
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
			onTaskToggleCollapse: (cardId: string, taskPath: number[]) => this.sync.toggleCollapseTask(cardId, taskPath),
			onMemoUpdate: (card: DashboardCard, updates: { body: string; blockquote: string }) => this.sync.updateMemoCard(card.id, updates),
			onMemoSaveAsNote: (card: DashboardCard) => this.saveMemoAsNote(card),
			onTaskSaveToDaily: (card: DashboardCard) => this.saveTasksToDaily(card),
			onDocAdd: (cardId: string, path: string) => this.sync.addDocToCard(cardId, path),
			onDocDelete: (cardId: string, docPath: number[]) => this.sync.deleteDoc(cardId, docPath),
			onDocReorder: (cardId: string, fromPath: number[], toPath: number[], before: boolean) => this.sync.reorderDocs(cardId, fromPath, toPath, before),
			onDocMoveToCard: (srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest') => this.sync.moveDocToCard(srcCardId, fromPath, destCardId, destPath, mode),
			onDocNest: (cardId: string, docPath: number[]) => this.sync.nestDoc(cardId, docPath),
			onDocToggleCollapse: (cardId: string, docPath: number[]) => this.sync.toggleCollapseDoc(cardId, docPath),
			onCardAdd: (colName: string) => {
				const column = this.data?.columns.find(col => col.name === colName);
				const effectiveType = column?.sectionType ?? colName.toLowerCase();
				if (effectiveType === 'dashboard') {
					this.openWidgetTypeModal(colName);
				} else if (effectiveType === 'memo' || effectiveType === 'todo') {
					this.pendingScrollToLastCardOfColumn = colName;
					void this.sync.addCard(colName);
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
			onMoveCard: (cardId: string, targetCol: string, targetIdx: number) => this.sync.moveCard(cardId, targetCol, targetIdx),
			onMemoColorChange: (card: DashboardCard, color: string) => this.sync.updateMemoColor(card.id, color),
			onProjectCoverChange: (card: DashboardCard, imagePath: string) => this.sync.updateProjectCover(card.id, imagePath),
				onCardTitleEdit: (cardId: string, newTitle: string) => this.sync.updateCard(cardId, { title: newTitle }),
				onCardWidthChange: (cardId: string, width: number) => this.sync.updateCardWidth(cardId, width),
					onCardSizeChange: (cardId: string, size: string) => this.sync.updateCardSize(cardId, size as import('./types').CardSize),
				onCardGridChange: (cardId: string, gridCols: number, gridRows: number) => this.sync.updateCardGrid(cardId, gridCols, gridRows),
				onCardGridMove: (cardId: string, gridCol: number, gridRow: number) => this.sync.updateCardGridMove(cardId, gridCol, gridRow),
				onFileDrop: (cardId: string, filePath: string) => this.handleFileDrop(cardId, filePath),
				onColumnRename: (oldName: string, newName: string) => this.sync.renameColumn(oldName, newName),
				onColumnDelete: (columnName: string) => this.deleteColumn(columnName),
				onColumnMove: (fromIndex: number, toIndex: number) => { void this.sync.moveColumn(fromIndex, toIndex); },
				onColumnHeightChange: (name: string, height: number) => { void this.sync.updateColumnHeight(name, height); },
			onTaskReminderEdit: (cardId: string, taskPath: number[], reminder: string | undefined) => this.sync.editTaskReminder(cardId, taskPath, reminder),
			onAddFromTemplate: (columnName: string) => this.openTemplatePicker(columnName),
			onArchiveTasks: (columnName: string) => this.archiveCompletedTasks(columnName),
				onLibraryConfigChange: (columnName: string, config: LibraryConfig) => {
				this.suppressNextRender = true;
				void this.sync.updateLibraryConfig(columnName, config).then(() => {
					this.refreshSectionInPlace(columnName);
				});
			},
		};
	}

	private createDailyJournalContext(): DailyJournalRenderContext {
		return {
			service: this.dailyJournalService,
			selectedDate: this.selectedDailyDate,
			onDataChanged: () => this.refreshDailyCalendar(),
			onStatusChanged: () => this.refreshDailyCalendar(),
		};
	}

	private refreshDailyCalendar(): void {
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		const scroll = root?.querySelector<HTMLElement>('.dashboard-sidebar-scroll');
		if (!scroll) return;
		renderSidebarMonthCalendar(scroll, this.selectedDailyDate, this.dailyJournalService, (date) => {
			this.selectedDailyDate = date;
			if (this.data) this.render(this.data);
		});
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
			if (cardType === 'task' || sectionType === 'todo') {
			void this.sync.addTask(cardId, `[[${filePath}]]`);
		} else if (sectionType === 'memo') {
			void this.sync.addFileLinkToMemo(cardId, filePath);
		} else {
			void this.sync.addDocToCard(cardId, filePath);
		}
	}

	private async saveMemoAsNote(card: DashboardCard): Promise<void> {
		try {
			const now = new Date();
			const title = card.title?.trim() || t('notice.memoUntitled');
			const pad = (n: number) => String(n).padStart(2, '0');
			const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
			const iso = now.toISOString();

			// Sanitize title for use as a filename
			const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || t('notice.memoUntitled');
			const fileName = `${safeTitle}-${ts}.md`;

			// Build folder path (empty setting = vault root)
			const folder = this.plugin.settings.memoSavePath.trim().replace(/^\/+|\/+$/g, '');
			const fullPath = folder ? `${folder}/${fileName}` : fileName;

			// Build note content: YAML frontmatter + blockquote + body
			const frontmatter = [
				'---',
				`title: "${title.replace(/"/g, '\\"')}"`,
				`created: "${iso}"`,
				'source: apex-dashboard',
				'---',
				'',
			].join('\n');

			const sections: string[] = [frontmatter];
			if (card.blockquote && card.blockquote.trim()) {
				const quoteLines = card.blockquote.split('\n').map(l => `> ${l}`);
				sections.push(quoteLines.join('\n'));
			}
			if (card.body && card.body.trim()) {
				sections.push(card.body);
			}
			const content = sections.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

			// Ensure the destination folder exists
			if (folder) {
				await this.ensureFolder(folder);
			}

			await this.app.vault.create(fullPath, content);
			new Notice(t('notice.memoSaved', { path: fullPath }), 4000);
		} catch (err) {
			console.error('[Dashboard] saveMemoAsNote failed:', err);
			new Notice(t('notice.memoSaveError'), 4000);
		}
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
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
			const dateStr = moment().format(format);
			const fileName = `${dateStr}.md`;
			const path = folder ? `${folder}/${fileName}` : fileName;

			const title = card.title?.trim() || t('notice.memoUntitled');
			const block = `### ${title}\n${serializeTasksForNote(card.tasks)}`;

			if (folder) await this.ensureFolder(folder);

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
			// the tasks stay on the board (no data loss).
			const configured = this.plugin.settings.taskArchivePath.trim().replace(/^\/+|\/+$/g, '');
			const fullPath = configured || '归档/已完成.md';
			const slash = fullPath.lastIndexOf('/');
			const folder = slash >= 0 ? fullPath.slice(0, slash) : '';
			if (folder) await this.ensureFolder(folder);

			const lines = entries.map((e) => t('notice.archiveLine', { time, task: e.task, card: e.card }));
			const appendText = `${lines.join('\n')}\n`;

			const existing = this.app.vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) {
				const raw = await this.app.vault.read(existing);
				const sep = raw.endsWith('\n') ? '' : '\n';
				await this.app.vault.modify(existing, `${raw}${sep}${appendText}`);
			} else {
				await this.app.vault.create(fullPath, appendText);
			}

			await this.sync.archiveTasks(columnName);

			new Notice(t('notice.archived', { count: entries.length, path: fullPath }), 4000);
		} catch (err) {
			console.error('[Dashboard] archiveCompletedTasks failed:', err);
			new Notice(t('notice.archiveError'), 4000);
		}
	}

	private openBannerEditModal(data: DashboardData): void {
		const modal = new BannerEditModal(this.app, data.banner, (updates) => {
			void this.sync.updateBanner(updates);
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openCardEditModal(card: DashboardCard): void {
		const modal = new CardEditModal(this.app, card, (updates) => {
			void this.sync.updateCard(card.id, updates);
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openNotePopover(file: TFile): void {
		// Close any previously open popover so its embedded leaf is detached
		// before we open a fresh one.
		this.popoverModal?.close();
		const modal = new NotePopoverModal(this.app, file, this.plugin.settings.stylePreset);
		this.popoverModal = modal;
		modal.open();
	}

	/** Opens a note on card click. Honors the "disable popover" setting: when
	 *  on, the note opens directly in a tab (no in-dashboard editor). */
	private openNote(file: TFile): void {
		if (this.plugin.settings.disableNotePopover) {
			void this.app.workspace.getLeaf(false).openFile(file);
			return;
		}
		this.openNotePopover(file);
	}

	private async addColumnWithType(name: string, sectionType?: string): Promise<void> {
		await this.sync.addColumn(name, sectionType);
		if (sectionType === 'library') {
			this.openLibraryConfigModal(name);
		} else if (sectionType === 'folder') {
			this.openFolderConfigModal(name);
		} else if (sectionType === 'heatmap') {
			this.openHeatmapConfigModal(name);
		} else if (sectionType === 'weread') {
			this.openWereadConfigModal(name);
		}
	}

	private openAddSectionModal(): void {
		const modal = new AddSectionModal(this.app, (name, sectionType) => {
			void this.addColumnWithType(name, sectionType);
		});
		modal.open();
	}

	private openWidgetTypeModal(colName: string): void {
		const modal = new WidgetTypeModal(this.app, (type: WidgetType) => {
			if (type === 'weather') {
				this.openWeatherConfigModal(colName);
			} else if (type === 'tracker') {
				this.openTrackerConfigModal(colName);
			}
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openWeatherConfigModal(colName: string): void {
		const modal = new WeatherConfigModal(this.app, (title, config) => {
			void this.sync.addCard(colName, {
				title,
				type: 'weather',
				weatherConfig: config,
			});
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openTrackerConfigModal(colName: string): void {
		const modal = new TrackerConfigModal(this.app, (title, config) => {
			void this.sync.addCard(colName, {
				title,
				type: 'tracker',
				trackerConfig: config,
			});
		}, this.plugin.settings.stylePreset);
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
			this.plugin.settings.stylePreset,
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

	private openHeatmapConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.heatmapConfig ?? {
			folder: '',
			trackerKey: '',
			period: 'pastYear' as const,
		};
		const modal = new HeatmapConfigModal(
			this.app,
			existing,
			(config) => { void this.sync.updateHeatmapConfig(colName, config); },
		);
		modal.open();
	}

	private openWereadConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const existing = column?.wereadConfig ?? { widgets: [{ id: 'w1', view: 'shelf' as const }] };
		void (async () => {
			const categories = await fetchWereadCategories(this.plugin.settings.wereadApiKey);
			const modal = new WereadConfigModal(
				this.app,
				existing,
				categories,
				(config) => { void this.sync.updateWereadConfig(colName, config); },
			);
			modal.open();
		})();
	}

	private refreshSectionInPlace(columnName: string): void {
		if (!this.data) return;
		const kanban = (this.containerEl.children[1] as HTMLElement)?.querySelector<HTMLElement>('.dashboard-kanban');
		if (!kanban) return;
		const oldEl = kanban.querySelector(`:scope > [data-column="${CSS.escape(columnName)}"]`);
		if (!oldEl) return;
		const column = this.data.columns.find(c => c.name === columnName);
		if (!column) return;
		const callbacks = this.createCallbacks();
		const newEl = renderSection(column, callbacks, this.app, this.data, this.plugin.settings);
		oldEl.replaceWith(newEl);
		for (const fn of this.dndCleanupFns) fn();
		this.dndCleanupFns = [];
		setupDragAndDrop(kanban, callbacks, this.dndCleanupFns);
	}

	private async openTickTickFilterModal(colName: string): Promise<void> {
		const column = this.data?.columns.find(col => col.name === colName);
		const config = column?.ticktickConfig ?? { view: 'lists' as const };
		const region = this.plugin.settings.ticktickRegion === 'ticktick' ? 'ticktick' : 'dida365';
		const projects = await fetchTickTickProjects(region, this.plugin.settings.ticktickCookie, this.plugin.settings.ticktickDeviceVersion);
		const hidden = new Set(config.hiddenProjects ?? []);
		const modal = new Modal(this.app);
		modal.titleEl.setText(t('ticktick.filterProjects'));
		for (const p of projects) {
			new Setting(modal.contentEl)
				.setName(p.name)
				.addToggle(toggle => toggle
					.setValue(!hidden.has(p.id))
					.onChange(value => {
						if (value) hidden.delete(p.id);
						else hidden.add(p.id);
					}));
		}
		new Setting(modal.contentEl).addButton(btn => btn
			.setButtonText(t('common.save'))
			.setCta()
			.onClick(() => {
				this.suppressNextRender = true;
				void this.sync.updateTickTickConfig(colName, { ...config, hiddenProjects: hidden.size > 0 ? [...hidden] : undefined }).then(() => {
					this.refreshSectionInPlace(colName);
				});
				modal.close();
			}));
		modal.open();
	}

	private openCalendarConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);		const existingConfig = column?.libraryConfig ?? {
			filters: [],
			viewMode: 'grid' as const,
			sortBy: 'modified',
			sortDesc: true,
		};
		const modal = new CalendarConfigModal(
			this.app,
			existingConfig,
			(config) => {
				void this.sync.updateLibraryConfig(colName, config);
			},
		);
		modal.open();
	}

	private openFolderConfigModal(colName: string): void {
		const column = this.data?.columns.find(col => col.name === colName);
		const libraryConfig = column?.libraryConfig;
		const currentFolders = libraryConfig?.folders ?? [];
		const currentTags = libraryConfig?.filters.find(f => f.property === 'tags')?.values ?? [];
		const currentGroupBy = libraryConfig?.kanbanGroupBy;
		const modal = new FolderConfigModal(
			this.app,
			currentFolders,
			currentTags,
			currentGroupBy,
			libraryConfig?.showProperties,
			libraryConfig?.propertyLimit,
			(result) => {
				const base = libraryConfig ?? {
					filters: [],
					viewMode: 'grid' as const,
					sortBy: 'modified',
					sortDesc: true,
				};
				const filtersWithoutTags = base.filters.filter(f => f.property !== 'tags');
				const filters = result.tags.length > 0
					? [...filtersWithoutTags, { property: 'tags', values: result.tags }]
					: filtersWithoutTags;
				void this.sync.updateLibraryConfig(colName, {
					...base,
					folders: result.folders,
					filters,
					kanbanGroupBy: result.groupBy,
					showProperties: result.showProperties ? undefined : false,
					propertyLimit: result.propertyLimit,
				});
			},
		);
		modal.open();
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

	private async deleteColumn(columnName: string): Promise<void> {
		const confirmed = await showConfirmDialog(this.app, {
			title: t('common.confirmDelete'),
			message: t('renderer.confirmDeleteSection', { column: columnName }),
		});
		if (!confirmed) return;
		await this.sync.deleteColumn(columnName);
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
		const events = this.app.vault;
		// `structure` distinguishes file add/remove/rename (which can change the
		// media listing) from plain .md content edits (which only affect task/
		// calendar/library scans). Media sections are refreshed only on the
		// former, so editing notes never churns the video thumbnails.
		const handler = (structure: boolean): void => {
			this.debouncedRefreshRecentDocs();
			this.debouncedRefreshSections(structure);
		};

		const createRef = events.on('create', () => handler(true));
		const modifyRef = events.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				handler(false);
			}
		});
		const deleteRef = events.on('delete', () => handler(true));
		const renameRef = events.on('rename', () => handler(true));

		this.vaultEventRefs = [
			{ evt: events, ref: createRef },
			{ evt: events, ref: modifyRef },
			{ evt: events, ref: deleteRef },
			{ evt: events, ref: renameRef },
		];
	}

	private unregisterVaultListeners(): void {
		for (const { evt, ref } of this.vaultEventRefs) {
			evt.offref(ref as Parameters<typeof evt.offref>[0]);
		}
		this.vaultEventRefs = [];
		if (this.recentDocsTimer) {
			window.clearTimeout(this.recentDocsTimer);
			this.recentDocsTimer = null;
		}
	}

	private debouncedRefreshRecentDocs(): void {
		if (this.recentDocsTimer) window.clearTimeout(this.recentDocsTimer);
		this.recentDocsTimer = window.setTimeout(() => {
			this.refreshRecentDocs();
		}, this.RECENT_DOCS_DEBOUNCE);
	}

	private debouncedRefreshSections(structure: boolean): void {
		if (!this.data) return;
		const sectionType = (col: { sectionType?: string }) => col.sectionType;
		const hasScanning = this.data.columns.some(col => {
			const st = sectionType(col);
			return st === 'library' || st === 'calendar' || st === 'folder';
		});
		const hasMedia = this.data.columns.some(col => {
			const st = sectionType(col);
			return st === 'images' || st === 'videos';
		});
		// Only refresh if there's a section that needs it: scanning sections on
		// any change, media sections only on structural changes.
		if (!hasScanning && !(structure && hasMedia)) return;
		if (this.libraryRefreshTimer) window.clearTimeout(this.libraryRefreshTimer);
		this.libraryRefreshTimer = window.setTimeout(() => {
			const data = this.sync.getData();
			if (!data) return;
			const root = this.containerEl.children[1] as HTMLElement | undefined;
			const kanban = root?.querySelector('.dashboard-kanban') as HTMLElement | null;
			if (!kanban) {
				// View not laid out yet — fall back to a full render.
				this.render(data);
				return;
			}
			const callbacks = this.createCallbacks();
			if (hasScanning) {
				refreshScanningSections(kanban, data, callbacks, this.app, this.plugin.settings, this);
			}
			if (structure && hasMedia) {
				refreshMediaSections(kanban, data, callbacks, this.app, this.plugin.settings, this);
			}
			// Scanning/media sections were replaced (new DOM), so their grip/card
			// DnD handlers are gone — re-wire DnD across the whole kanban.
			for (const fn of this.dndCleanupFns) fn();
			this.dndCleanupFns = [];
			setupDragAndDrop(kanban, callbacks, this.dndCleanupFns);
		}, 500);
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

	private runCleanup(): void {
		destroyAllCharts();
		if (this.pomodoroService) {
			this.pomodoroService.setOnTick(null);
			this.pomodoroService.setOnComplete(null);
		}
		if (this.readingService) {
			this.readingService.setOnTick(null);
		}
		for (const fn of this.cleanupFns) fn();
		this.cleanupFns = [];
		for (const fn of this.dndCleanupFns) fn();
		this.dndCleanupFns = [];
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
			if (hasWeather) {
				this.render(this.data);
			}
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
		this.checkDayRollover();
		this.dayRolloverTimer = window.setInterval(() => this.checkDayRollover(), DashboardView.DAY_ROLLOVER_CHECK_MS);
	}

	private stopDayRolloverChecker(): void {
		if (this.dayRolloverTimer) {
			window.clearInterval(this.dayRolloverTimer);
			this.dayRolloverTimer = null;
		}
	}

	private checkDayRollover(): void {
		const todayKey = new Date().toDateString();
		if (todayKey === this.lastRenderedDay) return;

		this.lastRenderedDay = todayKey;
		this.selectedDailyDate = toLocalIsoDate(new Date());
		if (this.data) this.render(this.data);
	}

	private returnDailyJournalToToday(): void {
		const now = new Date();
		const today = toLocalIsoDate(now);
		const selectionChanged = this.selectedDailyDate !== today;
		this.lastRenderedDay = now.toDateString();
		this.selectedDailyDate = today;
		if (selectionChanged && this.data) this.render(this.data);
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
