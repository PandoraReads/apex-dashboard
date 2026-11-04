/**
 * First-install onboarding tour: a spotlight-and-card walkthrough of the
 * workbench basics (open it, switch pages, pin the sidebar, dress the banner,
 * add sections).
 *
 * Gating lives in main.ts (fresh install + desktop only, see
 * shouldAutoStartOnboardingTour); this module only runs the walkthrough.
 *
 * Design notes:
 * - No third-party tour library. A body-level overlay paints a dim mask with
 *   a hole over the current step's target (box-shadow spotlight trick) and a
 *   hint card floating next to it. The overlay itself is pointer-transparent,
 *   so the user clicks the REAL controls; a capture-phase document listener
 *   sees those clicks and advances the step (a "Next" button is always there
 *   as the fallback track).
 * - Anchors are re-resolved live on every positioning tick, never cached —
 *   sections re-render in place (replaceWith) mid-tour and elements get
 *   replaced under us.
 * - Steps whose real action opens a Modal (banner edit, add section) defer
 *   the NEXT step's spotlight until every .modal-container / .menu is gone.
 */
import { EventRef, type WorkspaceLeaf } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { renderTourTerms } from './onboarding-tour-terms';
import { DASHBOARD_VIEW_TYPE } from './view';

/** Bump when the tour content changes meaningfully and should re-run for
 *  fresh installs that already saw the old version (auto-start still only
 *  ever happens on the very first install). */
export const ONBOARDING_TOUR_VERSION = '1';

/** Auto-start contract: only the very first install (no data.json has ever
 *  existed), desktop only, and only when this tour version was not seen. */
export function shouldAutoStartOnboardingTour(
	isFreshInstall: boolean,
	seenVersion: string,
	isMobile: boolean,
): boolean {
	return isFreshInstall && !isMobile && seenVersion !== ONBOARDING_TOUR_VERSION;
}

/** Record the tour as seen, immutably. Called at tour START (not end) so a
 *  crash or an early skip still counts as "has seen the tour". */
export async function persistTourSeen(plugin: DashboardPlugin): Promise<void> {
	if (plugin.settings.onboardingTourSeenVersion === ONBOARDING_TOUR_VERSION) return;
	plugin.settings = { ...plugin.settings, onboardingTourSeenVersion: ONBOARDING_TOUR_VERSION };
	try {
		await plugin.saveSettings();
	} catch {
		// A failed save must not brick the walkthrough; the in-memory flag
		// already stops a same-session re-run.
	}
}

interface TourStep {
	id: 'welcome' | 'open' | 'tabs' | 'switch' | 'pin' | 'banner'
		| 'layoutBanner' | 'layoutQuick' | 'layoutSidebar' | 'layoutBoard' | 'add' | 'done';
	titleKey: string;
	bodyKey: string;
	/** Centered intro/outro cards have no spotlight target. */
	centered?: boolean;
	/** Live target resolver; null while the target is not (yet) on screen. */
	anchor?: () => HTMLElement | null;
	/** Runs once when the anchor resolves (e.g. scroll it into the fold). */
	onAnchor?: (anchor: HTMLElement) => void;
	/** Async setup before anchoring (open the view). */
	ensure?: () => Promise<void>;
	/** Entry guard: a true result skips this step entirely (e.g. the switch
	 *  step when the user is already on a classic board). */
	skipIf?: () => boolean;
	/** Real clicks inside this selector advance the step. */
	advanceClickSelector?: string;
	/** The step advances when a dashboard view becomes the active leaf. */
	advanceOnDashboardActive?: boolean;
	/** The step advances as soon as this condition holds (polled by the
	 *  reposition tick — e.g. the user switched to a classic board). */
	advanceWhen?: () => boolean;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

/** The active dashboard view's root, if one is open. */
const boardRoot = (plugin: DashboardPlugin): HTMLElement | null =>
	plugin.getActiveDashboardView()?.containerEl ?? null;

/** True when the active board is a classic one (side/stacked): the banner
 *  pin only renders there, so its presence is the cheapest reliable tell. */
const pinAnchorPresent = (plugin: DashboardPlugin): boolean =>
	boardRoot(plugin)?.querySelector('.dashboard-sidebar-pin-btn') != null;

/** Open (or focus) the dashboard the same way the ribbon does — the ribbon
 *  callback is private, and duplicating six lines beats widening its API. */
export async function ensureDashboardOpen(plugin: DashboardPlugin): Promise<void> {
	if (plugin.getActiveDashboardView()) return;
	const leaves = plugin.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
	if (leaves.length > 0) {
		plugin.app.workspace.setActiveLeaf(leaves[0]!, { focus: true });
		return;
	}
	const leaf = plugin.app.workspace.getLeaf('tab');
	await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
}

export function buildTourSteps(plugin: DashboardPlugin): TourStep[] {
	return [
		{
			id: 'welcome',
			centered: true,
			titleKey: 'tour.welcomeTitle',
			bodyKey: 'tour.welcomeBody',
		},
		{
			id: 'open',
			anchor: () => plugin.dashboardRibbonEl,
			advanceOnDashboardActive: true,
			titleKey: 'tour.openTitle',
			bodyKey: 'tour.openBody',
		},
		{
			id: 'tabs',
			ensure: () => ensureDashboardOpen(plugin),
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-workspace-switcher') ?? null,
			advanceClickSelector: '.dashboard-workspace-btn',
			titleKey: 'tour.tabsTitle',
			bodyKey: 'tour.tabsBody',
		},
		{
			// Fresh installs ship two pages: the immersive flagship (active)
			// and a classic board. The rest of the tour lives on the classic
			// one — the user switches there THEMSELVES (never auto-switched
			// behind their back): the pill click is the lesson.
			id: 'switch',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-workspace-switcher') ?? null,
			skipIf: () => pinAnchorPresent(plugin) || plugin.settings.workspaceFiles.length < 2,
			advanceWhen: () => pinAnchorPresent(plugin),
			titleKey: 'tour.switchTitle',
			bodyKey: 'tour.switchBody',
		},
		{
			id: 'pin',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-sidebar-pin-btn') ?? null,
			advanceClickSelector: '.dashboard-sidebar-pin-btn',
			titleKey: 'tour.pinTitle',
			bodyKey: 'tour.pinBody',
		},
		{
			id: 'banner',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-banner-edit-btn') ?? null,
			advanceClickSelector: '.dashboard-banner-edit-btn',
			titleKey: 'tour.bannerTitle',
			bodyKey: 'tour.bannerBody',
		},
		{
			id: 'layoutBanner',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-banner') ?? null,
			titleKey: 'tour.layoutBannerTitle',
			bodyKey: 'tour.layoutBannerBody',
		},
		{
			id: 'layoutQuick',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-quicknote') ?? null,
			titleKey: 'tour.layoutQuickTitle',
			bodyKey: 'tour.layoutQuickBody',
		},
		{
			id: 'layoutSidebar',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-sidebar') ?? null,
			titleKey: 'tour.layoutSidebarTitle',
			bodyKey: 'tour.layoutSidebarBody',
		},
		{
			id: 'layoutBoard',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-kanban') ?? null,
			titleKey: 'tour.layoutBoardTitle',
			bodyKey: 'tour.layoutBoardBody',
		},
		{
			id: 'add',
			anchor: () => boardRoot(plugin)?.querySelector<HTMLElement>('.dashboard-add-section') ?? null,
			advanceClickSelector: '.dashboard-add-section',
			// The add button sits at the board's very bottom — without this,
			// the spotlight would hover over a hole below the fold and the
			// screen would just look stuck. Bring the target into view.
			onAnchor: anchor => {
				anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
			},
			titleKey: 'tour.addTitle',
			bodyKey: 'tour.addBody',
		},
		{
			id: 'done',
			centered: true,
			titleKey: 'tour.doneTitle',
			bodyKey: 'tour.doneBody',
		},
	];
}

/** add/removeEventListener pair that returns its own undo. */
function domOn(target: Document | Window, type: string, fn: (ev: never) => void, capture = false): () => void {
	target.addEventListener(type, fn, capture);
	return () => target.removeEventListener(type, fn, capture);
}

class OnboardingTourRunner {
	private readonly plugin: DashboardPlugin;
	private readonly steps: TourStep[];
	private idx = 0;
	private advancing = false;
	private destroyed = false;
	private root: HTMLElement | null = null;
	private hole: HTMLElement | null = null;
	private card: HTMLElement | null = null;
	private tickTimer: number | null = null;
	private readonly unbinds: Array<() => void> = [];
	private leafRef: EventRef | null = null;

	constructor(plugin: DashboardPlugin) {
		this.plugin = plugin;
		this.steps = buildTourSteps(plugin);
	}

	start(): void {
		void persistTourSeen(this.plugin);
		this.buildOverlay();
		this.bindListeners();
		// Replay with the dashboard already open: the ribbon step would
		// spotlight nothing new, so enter at the page-pills step.
		const firstIdx = this.plugin.getActiveDashboardView() ? 1 : 0;
		void this.showStep(firstIdx);
	}

	private buildOverlay(): void {
		const root = document.body.createDiv({ cls: 'apex-tour-root' });
		this.root = root;
		this.hole = root.createDiv({ cls: 'apex-tour-hole apex-tour-hole--hidden' });
		this.card = root.createDiv({ cls: 'apex-tour-card apex-tour-card--centered' });
		document.body.addClass('apex-tour-active');
	}

	private bindListeners(): void {
		this.unbinds.push(domOn(document, 'click', this.onDocClick, true));
		this.unbinds.push(domOn(document, 'keydown', this.onKeyDown, true));
		this.unbinds.push(domOn(window, 'resize', () => this.tick()));
		this.tickTimer = window.setInterval(() => this.tick(), 150);
		this.leafRef = this.plugin.app.workspace.on('active-leaf-change', this.onLeafChange);
		this.plugin.registerEvent(this.leafRef);
	}

	/** Real clicks on the current step's target advance it (capture phase:
	 *  target handlers may stopPropagation, which never blocks capture). */
	private readonly onDocClick = (ev: MouseEvent): void => {
		const step = this.steps[this.idx];
		if (!step?.advanceClickSelector || this.advancing || this.destroyed) return;
		const target = ev.target;
		if (!(target instanceof Element)) return;
		if (target.closest('.apex-tour-card')) return;
		if (target.closest(step.advanceClickSelector)) this.advance();
	};

	private readonly onLeafChange = (leaf: WorkspaceLeaf | null): void => {
		const step = this.steps[this.idx];
		if (!step?.advanceOnDashboardActive || this.advancing || this.destroyed) return;
		if (leaf?.view.getViewType() === DASHBOARD_VIEW_TYPE) this.advance();
	};

	private readonly onKeyDown = (ev: KeyboardEvent): void => {
		if (ev.key !== 'Escape' || this.destroyed) return;
		if (document.querySelector('.modal-container')) return; // let the modal close first
		this.destroy();
	};

	private async showStep(idx: number): Promise<void> {
		if (this.destroyed) return;
		const step = this.steps[idx]!;
		if (step.skipIf?.()) {
			// Nothing to teach here (e.g. the user is already on a classic
			// board): fall through to the next step without painting anything.
			const next = idx + 1;
			if (next >= this.steps.length) {
				this.destroy();
				return;
			}
			await this.showStep(next);
			return;
		}
		this.idx = idx;
		// Stay dim while anchors settle, so the card never flashes in a wrong spot.
		this.root?.addClass('apex-tour-pending');
		if (step.ensure) {
			try {
				await step.ensure();
			} catch {
				// Keep walking; the anchor poll below is the safety net.
			}
		}
		if (this.destroyed) return;
		await this.waitForOverlayClear();
		if (this.destroyed) return;
		this.renderCard(step);
		const anchor = step.centered ? null : await this.resolveAnchor(step);
		if (this.destroyed) return;
		if (anchor && step.onAnchor) {
			step.onAnchor(anchor);
			// Let a smooth scroll settle before the first paint.
			await sleep(450);
		}
		if (this.destroyed) return;
		this.root?.removeClass('apex-tour-pending');
		this.place(anchor);
		this.advancing = false;
	}

	/** Steps whose real action opened a Modal wait for it to close before
	 *  spotlighting the next target (it would sit under the modal). */
	private async waitForOverlayClear(): Promise<void> {
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			if (!document.querySelector('.modal-container') && !document.querySelector('.menu')) return;
			await sleep(120);
		}
	}

	private async resolveAnchor(step: TourStep): Promise<HTMLElement | null> {
		if (!step.anchor) return null;
		const deadline = Date.now() + 6000;
		let el = step.anchor();
		while ((!el || !el.isConnected) && Date.now() < deadline) {
			await sleep(100);
			el = step.anchor();
		}
		return el && el.isConnected ? el : null;
	}

	private renderCard(step: TourStep): void {
		const card = this.card;
		if (!card) return;
		card.empty();
		card.addClass('apex-tour-card--centered');
		if (!step.centered) {
			card.removeClass('apex-tour-card--centered');
			card.createDiv({ cls: 'apex-tour-step-no', text: `${this.idx}/${this.steps.length - 2}` });
		}
		card.createEl('h3', { cls: 'apex-tour-title', text: t(step.titleKey) });
		// Feature names (分区 / 小组件 / …) get the red accent; the body is
		// built from text nodes and our own accent spans, never markup.
		const body = card.createEl('p', { cls: 'apex-tour-body' });
		renderTourTerms(body, t(step.bodyKey));
		const actions = card.createDiv({ cls: 'apex-tour-actions' });
		if (step.id !== 'done') {
			const skip = actions.createEl('button', {
				cls: 'apex-tour-btn apex-tour-btn--ghost',
				text: t('tour.skip'),
			});
			skip.addEventListener('click', () => this.destroy());
		}
		const nextLabel = step.id === 'welcome'
			? t('tour.start')
			: step.id === 'done' ? t('tour.finish') : t('tour.next');
		const next = actions.createEl('button', { cls: 'apex-tour-btn', text: nextLabel });
		next.addEventListener('click', ev => {
			ev.stopPropagation();
			this.advance();
		});
	}

	/** Hole rect clipped to the viewport: region-sized anchors (the whole
	 *  board) would otherwise paint a spotlight running off screen. */
	private clampToViewport(rect: DOMRect): DOMRect | null {
		const top = Math.max(rect.top, 0);
		const bottom = Math.min(rect.bottom, window.innerHeight);
		const left = Math.max(rect.left, 0);
		const right = Math.min(rect.right, window.innerWidth);
		if (bottom <= top || right <= left) return null;
		return new DOMRect(left, top, right - left, bottom - top);
	}

	private place(anchor: HTMLElement | null): void {
		if (!anchor) {
			this.hole?.addClass('apex-tour-hole--hidden');
			if (this.card) {
				this.card.setCssProps({ left: '', top: '' });
				this.card.addClass('apex-tour-card--centered');
			}
			return;
		}
		const clamped = this.clampToViewport(anchor.getBoundingClientRect());
		if (!clamped) {
			// Attached but fully outside the fold: drop the hole, keep the
			// card where it was until the reposition tick sees it again.
			this.hole?.addClass('apex-tour-hole--hidden');
			return;
		}
		this.hole?.removeClass('apex-tour-hole--hidden');
		this.placeHole(clamped);
		this.placeCard(clamped);
	}

	private placeHole(rect: DOMRect): void {
		const hole = this.hole;
		if (!hole) return;
		const pad = 5;
		hole.style.left = `${Math.round(rect.left - pad)}px`;
		hole.style.top = `${Math.round(rect.top - pad)}px`;
		hole.style.width = `${Math.round(rect.width + pad * 2)}px`;
		hole.style.height = `${Math.round(rect.height + pad * 2)}px`;
	}

	private placeCard(rect: DOMRect): void {
		const card = this.card;
		if (!card) return;
		card.removeClass('apex-tour-card--centered');
		const width = card.offsetWidth || 320;
		const height = card.offsetHeight || 180;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const margin = 16;
		let top = rect.bottom + 14;
		if (top + height > vh - margin) {
			top = Math.max(margin, rect.top - height - 14);
		}
		const left = Math.min(Math.max(rect.left, margin), Math.max(margin, vw - width - margin));
		card.style.top = `${Math.round(top)}px`;
		card.style.left = `${Math.round(left)}px`;
	}

	/** Reposition against the live DOM: re-renders may have replaced the
	 *  anchored element; the hole hides until the anchor returns. Also the
	 *  advanceWhen poll (e.g. the user switched to a classic board). */
	private tick(): void {
		if (this.destroyed || this.advancing) return;
		const step = this.steps[this.idx];
		if (!step) return;
		if (step.advanceWhen?.()) {
			this.advance();
			return;
		}
		if (step.centered || !step.anchor || this.root?.hasClass('apex-tour-pending')) return;
		const anchor = step.anchor();
		this.place(anchor && anchor.isConnected ? anchor : null);
	}

	private advance(): void {
		if (this.advancing || this.destroyed) return;
		this.advancing = true;
		const next = this.idx + 1;
		if (next >= this.steps.length) {
			this.destroy();
			return;
		}
		void this.showStep(next);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
		for (const unbind of this.unbinds.splice(0)) unbind();
		if (this.leafRef) this.plugin.app.workspace.offref(this.leafRef);
		this.root?.remove();
		document.body.removeClass('apex-tour-active');
		if (activeTour === this) activeTour = null;
	}
}

let activeTour: OnboardingTourRunner | null = null;

/** Start the walkthrough; a no-op when one is already running. */
export function startOnboardingTour(plugin: DashboardPlugin): void {
	if (activeTour) return;
	activeTour = new OnboardingTourRunner(plugin);
	activeTour.start();
}

/** Tear down a running tour (plugin unload). */
export function stopOnboardingTour(): void {
	activeTour?.destroy();
}
