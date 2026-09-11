import { App, setIcon } from 'obsidian';
import { t } from './i18n';
import type { DashboardSettings } from './types';
import { resolveVaultImage } from './banner';

/** Rotation tick timers keyed by timer id, mapped to the widget root they
 *  animate. destroyAlbumWidgets skips entries still inside a preserved widget
 *  area (re-attached sidebar widgets DOM keeps rotating), and every timer is
 *  also self-cleaning (isConnected check per tick) - the same registry + belt
 *  discipline as the countdown timers in renderer.ts. */
const albumTimers = new Map<number, HTMLElement>();

/** Per-widget slideshow controllers keyed by the widget root element: vault
 *  structure changes push a freshly scanned image list into the live closure
 *  without rebuilding the widget - and without disturbing the current photo
 *  when the list did not actually change. Mirrors calendar-widget's
 *  widgetReloaders WeakMap. */
interface AlbumController {
	setImages: (next: string[]) => void;
}
const albumControllers = new WeakMap<HTMLElement, AlbumController>();

const ALBUM_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
const ALBUM_FADE_MS = 600;

/** Photo transition modes. The frame carries a `--<mode>` class and layers
 *  animate between their start state (transition suppressed via --instant)
 *  and the default visible state, mirroring the banner fade house pattern. */
export type AlbumTransition = 'fade' | 'slide-left' | 'slide-right' | 'zoom';

const ALBUM_TRANSITIONS: AlbumTransition[] = ['fade', 'slide-left', 'slide-right', 'zoom'];

/** Per-mode layer classes: `start` is applied to the incoming layer before
 *  the transition (removed to run it); `out` moves the outgoing layer away
 *  (slide modes only - fade/zoom simply cover it). */
const TRANSITION_CLASSES: Record<AlbumTransition, { start: string; out?: string }> = {
	fade: { start: 'dashboard-sidebar-album-layer--start-fade' },
	zoom: { start: 'dashboard-sidebar-album-layer--start-zoom' },
	'slide-left': {
		start: 'dashboard-sidebar-album-layer--start-slide-in-right',
		out: 'dashboard-sidebar-album-layer--run-slide-out-left',
	},
	'slide-right': {
		start: 'dashboard-sidebar-album-layer--start-slide-in-left',
		out: 'dashboard-sidebar-album-layer--run-slide-out-right',
	},
};

const LAYER_STATE_CLASSES = [
	'dashboard-sidebar-album-layer--instant',
	'dashboard-sidebar-album-layer--top',
	'dashboard-sidebar-album-layer--bottom',
	...ALBUM_TRANSITIONS.flatMap(m => [TRANSITION_CLASSES[m].start, ...(TRANSITION_CLASSES[m].out ? [TRANSITION_CLASSES[m].out] : [])]),
];

export function normalizeTransition(value: string | undefined): AlbumTransition {
	return ALBUM_TRANSITIONS.includes(value as AlbumTransition) ? (value as AlbumTransition) : 'fade';
}

function clampIntervalSec(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 600) return 8;
	return Math.round(value);
}

function normalizeAlbumFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, '');
}

function basename(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? path : path.slice(idx + 1);
}

/** List the image file paths under `folder` (vault-relative). The prefix match
 *  is inherently recursive; non-recursive keeps only direct children of the
 *  folder itself. Naturally sorted so the slideshow order is stable. */
export function listAlbumImages(app: App, folder: string, recursive: boolean): string[] {
	const normalized = normalizeAlbumFolder(folder);
	if (!normalized) return [];
	const prefix = normalized + '/';
	return app.vault.getFiles()
		.filter(f =>
			!f.path.startsWith('.') &&
			ALBUM_IMAGE_EXTS.has(f.extension) &&
			f.path.startsWith(prefix) &&
			(recursive || f.parent?.path === normalized))
		.map(f => f.path)
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Stop album rotation timers ahead of a re-render. `preserveWidgets` is the
 *  detached-but-reused sidebar widgets element (see renderSidebarWidgets):
 *  timers animating widgets inside it survive so the re-attached DOM keeps
 *  rotating. Stragglers of a discarded DOM unwind themselves via the per-tick
 *  isConnected check. */
export function destroyAlbumWidgets(preserveWidgets?: HTMLElement | null): void {
	for (const [id, widget] of albumTimers) {
		if (preserveWidgets && preserveWidgets.contains(widget)) continue;
		window.clearInterval(id);
		albumTimers.delete(id);
	}
}

/** Push a freshly scanned image list into the live album widget. Returns
 *  false when the widget is absent (disabled) or not attached. An unchanged
 *  path list is a no-op: the slideshow position and timer stay untouched. */
export function refreshAlbumWidget(root: HTMLElement, settings: DashboardSettings, app: App): boolean {
	const el = root.querySelector<HTMLElement>('.dashboard-sidebar-album');
	if (!el || !el.isConnected) return false;
	const controller = albumControllers.get(el);
	if (!controller) return false;
	controller.setImages(listAlbumImages(app, settings.widgetAlbumFolder, settings.widgetAlbumRecursive));
	return true;
}

function renderAlbumPlaceholder(body: HTMLElement, text: string): void {
	body.empty();
	const ph = body.createDiv({ cls: 'dashboard-sidebar-album-placeholder' });
	setIcon(ph.createDiv({ cls: 'dashboard-sidebar-album-placeholder-icon' }), 'image');
	ph.createDiv({ cls: 'dashboard-sidebar-album-placeholder-text', text });
}

export function renderSidebarAlbumWidget(container: HTMLElement, settings: DashboardSettings, app: App): void {
	// No title row: the panel is the photo alone. The frame keeps the widget
	// chrome (card bg/drag) from .dashboard-sidebar-widget around it.
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-album' });
	widget.addClass(settings.widgetAlbumRatio === '3:4'
		? 'dashboard-sidebar-album--ratio-3-4'
		: 'dashboard-sidebar-album--ratio-1-1');
	const body = widget.createDiv({ cls: 'dashboard-sidebar-album-body' });

	const intervalMs = clampIntervalSec(settings.widgetAlbumIntervalSec) * 1000;
	const transition = normalizeTransition(settings.widgetAlbumTransition);
	let images = listAlbumImages(app, settings.widgetAlbumFolder, settings.widgetAlbumRecursive);
	let index = 0;
	let paused = false;
	let transitioning = false;
	let timer: number | null = null;
	let badgeEl: HTMLElement | null = null;
	/** Two ping-pong layers: layers[currentLayer] shows the active photo, the
	 *  other is the incoming surface for the next transition (roles flip at
	 *  settle). Both exist for the whole frame lifetime. */
	let layers: [HTMLImageElement, HTMLImageElement] | null = null;
	let currentLayer = 0;
	/** Bumped on every frame rebuild; a settle callback from a stale frame
	 *  (setImages mid-transition) must not flip layer roles underneath it. */
	let frameEpoch = 0;

	const stopTimer = (): void => {
		if (timer !== null) {
			window.clearInterval(timer);
			albumTimers.delete(timer);
			timer = null;
		}
	};
	const startTimer = (): void => {
		if (timer !== null || images.length < 2) return;
		timer = window.setInterval(tick, intervalMs);
		albumTimers.set(timer, widget);
	};
	const restartTimer = (): void => {
		stopTimer();
		startTimer();
	};

	const updateBadge = (): void => {
		if (badgeEl) badgeEl.setText(`${index + 1}/${images.length}`);
	};

	const preloadNext = (): void => {
		if (images.length < 2) return;
		const src = resolveVaultImage(app, images[(index + 1) % images.length]!);
		if (src) {
			const pre = new Image();
			pre.src = src;
		}
	};

	const toPlaceholder = (text: string): void => {
		images = [];
		index = 0;
		layers = null;
		badgeEl = null;
		stopTimer();
		widget.addClass('dashboard-sidebar-album--empty');
		widget.removeClass('dashboard-sidebar-album--single');
		renderAlbumPlaceholder(body, text);
	};

	/** Animate to images[target] using the configured transition. Skips files
	 *  that no longer resolve; when none do, the folder effectively died -
	 *  fall back to the empty placeholder. */
	const show = (target: number): void => {
		if (images.length === 0 || !layers) return;
		let slot = target;
		let resolved: string | null = null;
		for (let i = 0; i < images.length; i++) {
			slot = (target + i) % images.length;
			resolved = resolveVaultImage(app, images[slot]!);
			if (resolved) break;
		}
		if (!resolved) {
			toPlaceholder(t('album.placeholderEmpty'));
			return;
		}
		const incoming = layers[1 - currentLayer]!;
		const outgoing = layers[currentLayer]!;
		const anim = TRANSITION_CLASSES[transition];
		// Setup pass (single JS task, no paint): clear stale state, load the
		// new photo onto the covered/off-screen incoming layer, then pin both
		// layers at their transition start states with transitions suppressed.
		incoming.src = resolved;
		incoming.alt = basename(images[slot]!);
		for (const cls of LAYER_STATE_CLASSES) {
			incoming.removeClass(cls);
			outgoing.removeClass(cls);
		}
		incoming.addClass('dashboard-sidebar-album-layer--instant');
		outgoing.addClass('dashboard-sidebar-album-layer--instant');
		incoming.addClass('dashboard-sidebar-album-layer--top');
		outgoing.addClass('dashboard-sidebar-album-layer--bottom');
		incoming.addClass(anim.start);
		// Force style recalc so the start states are the transition's origin.
		incoming.getBoundingClientRect();
		// Run pass: re-enable transitions and move both layers to their end
		// states (incoming -> default visible; outgoing slides away if the
		// mode needs it - fade/zoom simply get covered).
		incoming.removeClass('dashboard-sidebar-album-layer--instant');
		outgoing.removeClass('dashboard-sidebar-album-layer--instant');
		incoming.removeClass(anim.start);
		if (anim.out) outgoing.addClass(anim.out);
		index = slot;
		transitioning = true;
		const epoch = frameEpoch;
		window.setTimeout(() => {
			transitioning = false;
			if (!widget.isConnected || epoch !== frameEpoch) return;
			currentLayer = 1 - currentLayer;
			updateBadge();
			preloadNext();
		}, ALBUM_FADE_MS);
	};

	const tick = (): void => {
		if (!widget.isConnected) {
			stopTimer();
			return;
		}
		if (paused || transitioning || images.length < 2) return;
		show((index + 1) % images.length);
	};

	const attachNavButton = (frame: HTMLElement, cls: string, icon: string, label: string, delta: number): void => {
		const btn = frame.createEl('button', {
			cls: `dashboard-sidebar-album-nav ${cls}`,
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(btn, icon);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (transitioning || images.length < 2) return;
			// Manual nav resets the auto timer: otherwise the next auto-advance
			// can fire right after a click and reads as a double-skip.
			show((index + delta + images.length) % images.length);
			restartTimer();
		});
	};

	/** Rebuild the frame DOM at the current index (no transition) and wire
	 *  hover pause, manual nav and the auto-rotation timer for the new list
	 *  shape. */
	const renderFrame = (): void => {
		if (images.length === 0) return;
		let slot = index;
		let src: string | null = null;
		for (let i = 0; i < images.length; i++) {
			const candidate = (index + i) % images.length;
			const resolved = resolveVaultImage(app, images[candidate]!);
			if (resolved) {
				slot = candidate;
				src = resolved;
				break;
			}
		}
		if (!src) {
			toPlaceholder(t('album.placeholderEmpty'));
			return;
		}
		index = slot;
		body.empty();
		widget.removeClass('dashboard-sidebar-album--empty');
		widget.toggleClass('dashboard-sidebar-album--single', images.length < 2);

		const frame = body.createDiv({ cls: `dashboard-sidebar-album-frame dashboard-sidebar-album-frame--${transition}` });
		// draggable=false: a native <img> drag would hijack the widget's
		// drag-to-reorder gesture when the user grabs the photo.
		const front = frame.createEl('img', {
			cls: 'dashboard-sidebar-album-layer dashboard-sidebar-album-layer--top',
			attr: { alt: basename(images[slot]!), draggable: 'false' },
		});
		front.src = src;
		// The back layer waits off-stage (invisible) for its turn as incoming.
		const back = frame.createEl('img', {
			cls: 'dashboard-sidebar-album-layer dashboard-sidebar-album-layer--instant dashboard-sidebar-album-layer--start-fade',
			attr: { draggable: 'false' },
		});
		layers = [front, back];
		currentLayer = 0;
		frameEpoch++;
		badgeEl = frame.createDiv({ cls: 'dashboard-sidebar-album-index' });
		updateBadge();
		attachNavButton(frame, 'dashboard-sidebar-album-nav--prev', 'chevron-left', t('album.prev'), -1);
		attachNavButton(frame, 'dashboard-sidebar-album-nav--next', 'chevron-right', t('album.next'), 1);
		// Hover pause must be JS (a boolean flag): CSS cannot stop an interval.
		// Scoped to the frame so the nav buttons hover-pause too.
		frame.addEventListener('mouseenter', () => { paused = true; });
		frame.addEventListener('mouseleave', () => { paused = false; });
		restartTimer();
		preloadNext();
	};

	if (images.length === 0) {
		widget.addClass('dashboard-sidebar-album--empty');
		renderAlbumPlaceholder(body, normalizeAlbumFolder(settings.widgetAlbumFolder)
			? t('album.placeholderEmpty')
			: t('album.placeholderUnset'));
	} else {
		// Seed the start index from the clock (banner rotation trick): the
		// album opens on a time-varying photo instead of always the first one.
		index = Math.floor(Date.now() / intervalMs) % images.length;
		renderFrame();
	}

	albumControllers.set(widget, {
		setImages: (next: string[]) => {
			if (next.length === 0) {
				if (images.length === 0) return;
				toPlaceholder(t('album.placeholderEmpty'));
				return;
			}
			if (next.length === images.length && next.every((p, i) => p === images[i])) return;
			// Keep the current photo when it survived the change; otherwise
			// clamp the index into the new list.
			const currentPath = images[index] ?? null;
			const at = currentPath !== null ? next.indexOf(currentPath) : -1;
			index = at >= 0 ? at : Math.min(index, next.length - 1);
			images = next;
			renderFrame();
		},
	});
}
