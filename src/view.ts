import { Events, HoverParent, HoverPopover, ItemView, Notice, setIcon, WorkspaceLeaf, TFile } from 'obsidian';
import type DashboardPlugin from './main';
import type { DashboardData, DashboardCard, QuickAction, BannerData, WeatherConfig, TrackerConfig, LibraryConfig } from './types';
import { SyncEngine } from './sync';
import { renderDashboard, destroyAllCharts, renderSidebarWidgets, renderSidebarWeekCalendar, refreshSidebarWeekCalendar, renderSidebarPomodoro, renderSidebarReading } from './renderer';
import { renderBanner, BannerEditModal, resolveVaultImage } from './banner';
import { getRecentDocs, renderRecentDocs } from './recent';
import { renderQuickActions, AddActionModal, DocSearchModal } from './quick-actions';
import { setupDragAndDrop } from './dnd';
import { CardEditModal } from './card-edit-modal';
import { NotePopoverModal } from './note-popover-modal';
import { showConfirmDialog } from './confirm-dialog';
import { clearWeatherCache } from './weather-service';
import { renderSidebarLunarWidget, loadHolidayData } from './lunar-widget';
import type { HolidayInfo } from './holiday-service';
import { WidgetTypeModal, type WidgetType } from './widget-type-modal';
import { WeatherConfigModal } from './weather-config-modal';
import { LibraryConfigModal } from './library-config-modal';
import { TrackerConfigModal } from './tracker-config-modal';
import { TemplatePickerModal } from './template-modal';
import { PomodoroService } from './pomodoro-service';
import { ReadingService } from './reading-service';
import { ReminderNoticeModal } from './reminder-notice';
import { t } from './i18n';

export const DASHBOARD_VIEW_TYPE = 'apex-dashboard-view';

export class DashboardView extends ItemView implements HoverParent {
	private plugin: DashboardPlugin;
	private sync: SyncEngine;
	private data: DashboardData | null = null;
	private cleanupFns: Array<() => void> = [];
	private vaultEventRefs: Array<{ evt: Events; ref: unknown }> = [];
	private recentDocsTimer: ReturnType<typeof setTimeout> | null = null;
	private libraryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly RECENT_DOCS_DEBOUNCE = 500;
	private bannerQuoteIndex = 0;
	private bannerImageIndex = 0;
	private static readonly BANNER_QUOTE_ROTATION_MS = 60 * 60 * 1000; // 1 hour (on the hour)
	private static readonly BANNER_IMAGE_ROTATION_MS = 30 * 60 * 1000; // 30 min (on the half)
	private static readonly REMINDER_CHECK_MS = 60 * 1000; // 1 minute
	private static readonly BANNER_QUOTE_OFFSET_MS = 60 * 60 * 1000; // offset by 1 hour from image
	private reminderTimer: ReturnType<typeof setInterval> | null = null;
	private firedReminders = new Set<string>();
	private sidebarPinned = localStorage.getItem('apex-dashboard-sidebar-pinned') === 'true';
	private sidebarExpanded = false;
	private bannerCollapsed = localStorage.getItem('apex-dashboard-banner-collapsed') === 'true';
	private pendingScrollCardId: string | null = null;
	private pendingScrollToLastCardOfColumn: string | null = null;
	private pomodoroService: PomodoroService | null = null;
	private readingService: ReadingService | null = null;
	private holidayData: Record<string, HolidayInfo> = {};
	private mobileWidgetExpanded: 'pomodoro' | 'reading' | 'lunar' | null = null;
	private mobileWidgetTabsOpen: boolean = false;
	private static readonly WEATHER_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
	private weatherRefreshTimer: ReturnType<typeof setInterval> | null = null;
	private static readonly DAY_ROLLOVER_CHECK_MS = 60 * 1000; // 1 minute
	private dayRolloverTimer: ReturnType<typeof setInterval> | null = null;
	private lastRenderedDay = new Date().toDateString();

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
		this.sync.updateSettings(this.plugin.settings);
		this.sync.onDataUpdate((data) => this.render(data));

		await this.sync.init();
		this.registerVaultListeners();
		this.startReminderChecker();
		this.startWeatherRefresh();
		this.startDayRolloverChecker();
		this.pomodoroService = new PomodoroService(this.plugin);
		await this.pomodoroService.loadSessions();
		this.readingService = new ReadingService(this.plugin);
		await this.readingService.loadSessions();
		loadHolidayData().then(data => {
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
		const data = this.sync.getData();
		if (data) {
			this.render(data);
		}
	}

	addSection(): void {
		const name = prompt(t('renderer.sectionName'));
		if (name?.trim()) {
			this.sync.addColumn(name.trim());
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

		// Sweep any touch-drag ghost clones stranded on document.body from a prior
		// interrupted drag (touchcancel). They live outside the container, so
		// container.empty() cannot reach them.
		document.body.querySelectorAll(':scope > .dashboard-card--ghost').forEach((el) => el.remove());

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
		if (this.sidebarPinned) {
			sidebar.addClass('dashboard-sidebar--pinned');
		} else if (this.sidebarExpanded) {
			sidebar.addClass('dashboard-sidebar--expanded');
		} else {
			sidebar.addClass('dashboard-sidebar--collapsed');
		}
		this.renderSidebar(sidebar, container);
		this.setupSidebarBehavior(sidebar, container);

		const kanban = mainLayout.createDiv({ cls: 'dashboard-kanban-wrapper' });
		renderDashboard(kanban, data, this.createCallbacks(), this.app, this.plugin.settings, this);
		setupDragAndDrop(kanban, this.createCallbacks(), this.cleanupFns);
		// Library config event delegation
		kanban.addEventListener('dashboard-library-config', ((e: CustomEvent) => {
			const { columnName } = e.detail as { columnName: string };
			this.openLibraryConfigModal(columnName);
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
				requestAnimationFrame(() => {
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
					requestAnimationFrame(() => {
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
				const tapX = (e as MouseEvent).clientX - rect.left;
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

		const panel = bar.createDiv({ cls: 'dashboard-mobile-widget-panel' });

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
		const panel = bar.querySelector('.dashboard-mobile-widget-panel') as HTMLElement | null;
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
			localStorage.setItem('apex-dashboard-banner-collapsed', String(this.bannerCollapsed));
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

					setTimeout(() => {
						quoteEl.textContent = next.quote;
						authorEl.textContent = next.author;
						quoteEl.removeClass('dashboard-banner-quote--fading');
						authorEl.removeClass('dashboard-banner-author--fading');
					}, 400);
				};

				const quoteTimer = setInterval(rotateQuote, DashboardView.BANNER_QUOTE_ROTATION_MS);
				this.cleanupFns.push(() => clearInterval(quoteTimer));
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

					setTimeout(() => {
						if (nextResolved) {
							bannerEl.style.backgroundImage = `url("${nextResolved}")`;
						}
						bannerEl.removeClass('dashboard-banner--fading');
					}, 600);
				};

				const imgTimer = setInterval(rotateImage, DashboardView.BANNER_IMAGE_ROTATION_MS);
				this.cleanupFns.push(() => clearInterval(imgTimer));
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
					(action) => { this.executeAction(action); this.closeMobileDrawer(); },
					async (index) => {
						const confirmed = await showConfirmDialog(this.app, {
							title: t('common.confirmDelete'),
							message: t('common.confirmDeleteMessage'),
						});
						if (!confirmed) return;
						this.sync.removeQuickAction(index);
					},
					() => this.openAddActionModal(),
					undefined,
					undefined,
					this.data.quickActionOrder,
					(order) => this.sync.reorderQuickActions(order),
					async (key) => {
						const confirmed = await showConfirmDialog(this.app, {
							title: t('common.confirmDelete'),
							message: t('common.confirmDeleteMessage'),
						});
						if (!confirmed) return;
						this.sync.removeQuickActionByKey(key);
					},
					this.data.hiddenPresets,
				);
			}
		} else {
			content.createEl('h4', { text: t('mobile.recent'), cls: 'dashboard-mobile-drawer-title' });
			const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
			renderRecentDocs(content, docs, (path) => this.navigateToPath(path));
		}

		const backdrop = drawer.createDiv({ cls: 'dashboard-mobile-drawer-backdrop' });
		backdrop.addEventListener('click', () => this.closeMobileDrawer());

		requestAnimationFrame(() => {
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

		renderSidebarWeekCalendar(scroll);

		renderSidebarWidgets(scroll, this.plugin.settings, this.app, this.pomodoroService ?? undefined, this.readingService ?? undefined, this.holidayData, async (order) => {
			this.plugin.settings = {
				...this.plugin.settings,
				widgetOrder: order,
			};
			await this.plugin.saveSettings();
			this.render(this.data!);
		});

		renderQuickActions(
			scroll,
			this.data.quickActions,
			(action) => this.executeAction(action),
			(index) => {
				showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) this.sync.removeQuickAction(index);
				});
			},
			() => this.openAddActionModal(),
			this.sidebarPinned,
			() => {
				this.sidebarPinned = !this.sidebarPinned;
				localStorage.setItem('apex-dashboard-sidebar-pinned', String(this.sidebarPinned));
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
			(order) => this.sync.reorderQuickActions(order),
			(key) => {
				showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) this.sync.removeQuickActionByKey(key);
				});
			},
			this.data.hiddenPresets,
		);

		const docs = getRecentDocs(this.app, this.plugin.settings.recentDocCount);
		renderRecentDocs(
			scroll,
			docs,
			(path) => this.navigateToPath(path),
		);
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
	}

	private createCallbacks() {
		return {
			onCardEdit: (card: DashboardCard) => this.openCardEditModal(card),
			onOpenNoteInPopover: (file: TFile) => this.openNotePopover(file),
			onCardDelete: async (cardId: string) => {
				const confirmed = await showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				});
				if (!confirmed) return;
				this.sync.deleteCard(cardId);
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
				this.sync.deleteTask(cardId, taskPath);
			},
			onTaskReorder: (cardId: string, fromPath: number[], toPath: number[], before: boolean) => this.sync.reorderTask(cardId, fromPath, toPath, before),
			onTaskMoveToCard: (srcCardId: string, fromPath: number[], destCardId: string, destPath: number[], mode: 'before' | 'after' | 'nest') => this.sync.moveTaskToCard(srcCardId, fromPath, destCardId, destPath, mode),
			onTaskEdit: (cardId: string, taskPath: number[], text: string) => this.sync.editTask(cardId, taskPath, text),
			onTaskNest: (cardId: string, taskPath: number[]) => this.sync.nestTask(cardId, taskPath),
			onTaskUnnest: (cardId: string, taskPath: number[]) => this.sync.unnestTask(cardId, taskPath),
			onTaskToggleCollapse: (cardId: string, taskPath: number[]) => this.sync.toggleCollapseTask(cardId, taskPath),
			onMemoUpdate: (card: DashboardCard, updates: { body: string; blockquote: string }) => this.sync.updateMemoCard(card.id, updates),
			onMemoSaveAsNote: (card: DashboardCard) => this.saveMemoAsNote(card),
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
					this.sync.addCard(colName);
				} else {
					this.openProjectSearchModal(colName);
				}
			},
				onColumnAdd: (name: string, sectionType?: string) => {
					this.sync.addColumn(name, sectionType).then(() => {
						if (sectionType === 'library') {
							this.openLibraryConfigModal(name);
						}
					});
				},
			onBannerEdit: () => {
				if (this.data) this.openBannerEditModal(this.data);
			},
			onQuickActionAdd: () => this.openAddActionModal(),
			onQuickActionRemove: (index: number) => {
				showConfirmDialog(this.app, {
					title: t('common.confirmDelete'),
					message: t('common.confirmDeleteMessage'),
				}).then(confirmed => {
					if (confirmed) this.sync.removeQuickAction(index);
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
			onTaskReminderEdit: (cardId: string, taskPath: number[], reminder: string | undefined) => this.sync.editTaskReminder(cardId, taskPath, reminder),
			onAddFromTemplate: (columnName: string) => this.openTemplatePicker(columnName),
				onLibraryConfigChange: (columnName: string, config: LibraryConfig) => this.sync.updateLibraryConfig(columnName, config),
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
			if (cardType === 'task' || sectionType === 'todo') {
			this.sync.addTask(cardId, `[[${filePath}]]`);
		} else if (sectionType === 'memo') {
			this.sync.addFileLinkToMemo(cardId, filePath);
		} else {
			this.sync.addDocToCard(cardId, filePath);
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

	private openBannerEditModal(data: DashboardData): void {
		const modal = new BannerEditModal(this.app, data.banner, (updates) => {
			this.sync.updateBanner(updates);
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openCardEditModal(card: DashboardCard): void {
		const modal = new CardEditModal(this.app, card, (updates) => {
			this.sync.updateCard(card.id, updates);
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
			this.sync.addCard(colName, {
				title,
				type: 'weather',
				weatherConfig: config,
			});
		}, this.plugin.settings.stylePreset);
		modal.open();
	}

	private openTrackerConfigModal(colName: string): void {
		const modal = new TrackerConfigModal(this.app, (title, config) => {
			this.sync.addCard(colName, {
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
				this.sync.addCard(colName, {
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
				this.sync.updateLibraryConfig(colName, config);
			},
		);
		modal.open();
	}

	private openAddActionModal(): void {
		const modal = new AddActionModal(this.app, (action) => {
			this.sync.addQuickAction(action);
		});
		modal.open();
	}

	private async executeAction(action: QuickAction): Promise<void> {
		if (action.type === 'file') {
			await this.navigateToPath(action.target);
		} else if (action.type === 'command') {
			if (action.target === 'daily-notes') {
				await this.createNewJournal();
			} else {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(this.app as any).commands.executeCommandById(action.target);
			}
		}
	}

	private async createNewJournal(): Promise<void> {
		const now = new Date();
		const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const filePath = `${dateStr}.md`;

		let file = this.app.vault.getFileByPath(filePath);
		if (!file) {
			file = await this.app.vault.create(filePath, `# ${dateStr}\n\n`);
		}

		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private openProjectSearchModal(colName: string): void {
		const modal = new DocSearchModal(this.app, (link) => {
			this.sync.addCard(colName, {
				title: link.name,
				body: `[[${link.path}]]`,
			});
		});
		modal.open();
	}

	private promptAddColumn(): void {
		const name = prompt(t('renderer.sectionName'));
		if (name?.trim()) {
			this.sync.addColumn(name.trim());
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
		const handler = () => {
			this.debouncedRefreshRecentDocs();
			this.debouncedRefreshLibrarySections();
		};

		const createRef = events.on('create', handler);
		const modifyRef = events.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				handler();
			}
		});
		const deleteRef = events.on('delete', handler);
		const renameRef = events.on('rename', handler);

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
			clearTimeout(this.recentDocsTimer);
			this.recentDocsTimer = null;
		}
	}

	private debouncedRefreshRecentDocs(): void {
		if (this.recentDocsTimer) clearTimeout(this.recentDocsTimer);
		this.recentDocsTimer = setTimeout(() => {
			this.refreshRecentDocs();
		}, this.RECENT_DOCS_DEBOUNCE);
	}

	private debouncedRefreshLibrarySections(): void {
		if (!this.data) return;
		const hasLibrary = this.data.columns.some(col => col.sectionType === 'library');
		if (!hasLibrary) return;
		if (this.libraryRefreshTimer) clearTimeout(this.libraryRefreshTimer);
		this.libraryRefreshTimer = setTimeout(() => {
			const data = this.sync.getData();
			if (data) this.render(data);
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
		renderRecentDocs(parent, docs, (path) => this.navigateToPath(path));
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
	}

	private startReminderChecker(): void {
		this.checkReminders();
		this.reminderTimer = setInterval(() => this.checkReminders(), DashboardView.REMINDER_CHECK_MS);
	}

	private stopReminderChecker(): void {
		if (this.reminderTimer) {
			clearInterval(this.reminderTimer);
			this.reminderTimer = null;
		}
	}

	private startWeatherRefresh(): void {
		this.weatherRefreshTimer = setInterval(() => {
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
			clearInterval(this.weatherRefreshTimer);
			this.weatherRefreshTimer = null;
		}
		clearWeatherCache();
	}

	private startDayRolloverChecker(): void {
		this.dayRolloverTimer = setInterval(() => this.checkDayRollover(), DashboardView.DAY_ROLLOVER_CHECK_MS);
	}

	private stopDayRolloverChecker(): void {
		if (this.dayRolloverTimer) {
			clearInterval(this.dayRolloverTimer);
			this.dayRolloverTimer = null;
		}
	}

	private checkDayRollover(): void {
		if (!this.data) return;
		const todayKey = new Date().toDateString();
		if (todayKey === this.lastRenderedDay) return;

		this.lastRenderedDay = todayKey;
		const root = this.containerEl.children[1] as HTMLElement | undefined;
		if (root && refreshSidebarWeekCalendar(root)) {
			return;
		}
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

			// Countdown reminder
			if (this.plugin.settings.countdownEnabled && this.plugin.settings.countdownTargetDate && this.plugin.settings.countdownReminderDays > 0) {
				const ckKey = 'countdown-remind';
				if (!this.firedReminders.has(ckKey)) {
					const raw = this.plugin.settings.countdownTargetDate;
				const target = raw.includes('T') ? new Date(raw) : new Date(raw + 'T00:00:00');
					const diffMs = target.getTime() - now.getTime();
					const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
					if (daysLeft >= 0 && daysLeft <= this.plugin.settings.countdownReminderDays) {
						this.firedReminders.add(ckKey);
						const label = this.plugin.settings.countdownLabel || this.plugin.settings.countdownTargetDate;
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
				this.sync.editTaskReminder(cardId, taskPath, undefined);
			},
			() => {
				const snoozed = new Date(Date.now() + 60 * 60 * 1000);
				const pad = (n: number) => String(n).padStart(2, '0');
				const newReminder = `${snoozed.getFullYear()}-${pad(snoozed.getMonth() + 1)}-${pad(snoozed.getDate())} ${pad(snoozed.getHours())}:${pad(snoozed.getMinutes())}`;
				this.firedReminders.delete(`${cardId}-${JSON.stringify(taskPath)}`);
				this.sync.editTaskReminder(cardId, taskPath, newReminder);
			},
		);
		modal.open();
	}
}
