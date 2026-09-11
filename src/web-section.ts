import { Notice, Platform, setIcon } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import {
	clearPrecheckCache,
	getCachedVerdict,
	isValidWebUrl,
	normalizeWebUrl,
	precheckEmbed,
	type HeaderFetcher,
} from './web-precheck';

/** Test seams only — production call sites (renderer) pass neither. The
 *  fetcher lets verification scripts stub the precheck network call; timeoutMs
 *  shrinks the webview attach timeout so the fallback path is testable. */
export interface WebRenderOptions {
	fetcher?: HeaderFetcher;
	timeoutMs?: number;
}

const DEFAULT_WEBVIEW_TIMEOUT_MS = 3500;
/** Own persistent Electron session so login-walled apps (Keep, Todoist) stay
 *  signed in across Obsidian restarts. nodeintegration/allowpopups stay off
 *  (Electron defaults) — the guest page never gets host access. */
const WEBVIEW_PARTITION = 'persist:apex-dashboard-web';

/* ---------------------- native chrome theming ----------------------- */

/** WCAG relative luminance of a CSS color (hex or rgb()/rgba()), or null when
 *  unparseable (percentages, named colors — callers fall back). */
function relativeLuminance(color: string): number | null {
	let r = 0;
	let g = 0;
	let b = 0;
	const hex = color.match(/^#([0-9a-f]{3,8})$/i);
	if (hex) {
		let h = hex[1]!;
		if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
		if (h.length < 6) return null;
		r = parseInt(h.slice(0, 2), 16) / 255;
		g = parseInt(h.slice(2, 4), 16) / 255;
		b = parseInt(h.slice(4, 6), 16) / 255;
	} else {
		const rgb = color.match(/rgba?\(([^)]+)\)/i);
		if (!rgb) return null;
		const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
		if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n))) return null;
		r = parts[0]! / 255;
		g = parts[1]! / 255;
		b = parts[2]! / 255;
	}
	const lin = (c: number): number => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Resolve the dashboard's effective light/dark scheme so the embedded page's
 *  NATIVE chrome (its scrollbar, form controls) matches the plugin theme. A
 *  cross-origin frame cannot be styled from outside — color-scheme on the
 *  frame element is the only lever: Chromium renders the embedded document's
 *  UA chrome with it unless the page declares its own scheme.
 *
 *  Truth source is the active root's computed --db-bg luminance (respects the
 *  plugin theme, Obsidian's light/dark mode, and Appearance Studio overrides);
 *  body theme class is the fallback when no root is mounted. Globalled guards
 *  keep the node-run verification scripts alive (no activeDocument/computed
 *  style there). */
function resolveFrameColorScheme(): 'dark' | 'light' {
	try {
		const doc: Document | null = typeof activeDocument !== 'undefined' ? activeDocument : null;
		const root = doc?.querySelector?.('.apex-dashboard-root') ?? null;
		if (root) {
			const bg = getComputedStyle(root).getPropertyValue('--db-bg').trim();
			const luminance = bg.length > 0 ? relativeLuminance(bg) : null;
			if (luminance !== null) return luminance < 0.5 ? 'dark' : 'light';
		}
		return doc?.body?.classList.contains('theme-dark') ? 'dark' : 'light';
	} catch {
		return 'light';
	}
}

/**
 * Web section: embeds a configured URL in place. Engine choice is automatic:
 * frameable sites load as an iframe; sites whose headers refuse framing load
 * in a desktop Electron webview (a separate browsing context the refusal
 * headers do not govern); mobile has no webview and shows a fallback card
 * with an open-in-browser button. The iframe mounts OPTIMISTICALLY and the
 * precheck (web-precheck.ts) runs silently in the background — a blocked
 * verdict swaps the engine; an allowed verdict changes nothing.
 *
 * Like dataview-section: a reloadRegister closure powers the header refresh
 * button (re-probe policy + rebuild), and there is deliberately no vault-event
 * wiring — page content refreshes only on demand.
 */
export function renderWebSection(
	el: HTMLElement,
	column: DashboardColumn,
	reloadRegister: (fn: () => void) => void,
	options?: WebRenderOptions,
): void {
	const config = column.webConfig ?? { url: '' };
	const content = el.createDiv({ cls: 'dashboard-web-content' });

	// Async-race guard: every render() bumps the epoch; late callbacks from a
	// superseded render (refresh, in-place section rebuild) compare and drop.
	let epoch = 0;
	// Set when the webview attach times out, so the re-render routes to the
	// iframe directly instead of looping back into another webview.
	let webviewFailed = false;
	// What is currently mounted — lets the background precheck know when its
	// verdict changes nothing (allowed + optimistic iframe already live).
	let mounted: 'none' | 'iframe' | 'webview' | 'fallback' | 'error' = 'none';

	const targetUrl = (): string => normalizeWebUrl(config.url);

	/** Every state helper owns its slot: clear whatever was mounted first, so
	 *  engine swaps (optimistic iframe -> webview/fallback) never stack states
	 *  on top of each other. */
	function renderEmpty(): void {
		content.empty();
		mounted = 'none';
		const wrap = content.createDiv({ cls: 'dashboard-web-empty' });
		const icon = wrap.createDiv({ cls: 'dashboard-web-empty-icon' });
		setIcon(icon, 'globe');
		wrap.createDiv({ cls: 'dashboard-web-empty-text', text: t('web.emptyUrl') });
		wrap.createDiv({ cls: 'dashboard-web-empty-hint', text: t('web.configureHint') });
		const configure = wrap.createEl('button', {
			cls: 'dashboard-web-fallback-btn',
			text: t('web.configure'),
			attr: { type: 'button' },
		});
		configure.addEventListener('click', () => {
			// Same routing event as the header gear — view.ts's delegation opens
			// the config modal, so no callback threading is needed here.
			el.dispatchEvent(new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true }));
		});
	}

	function mountIframe(target: string): void {
		content.empty();
		mounted = 'iframe';
		const frame = content.createEl('iframe', {
			cls: 'dashboard-web-frame',
			attr: {
				src: target,
				referrerpolicy: 'no-referrer',
				allow: 'fullscreen',
				title: column.name,
			},
		});
		// No sandbox attribute on purpose: login-walled apps need cookies
		// (Custom Frames makes the same trade-off).
		if (config.zoom != null) frame.style.zoom = String(config.zoom);
		// Match the embedded page's native scrollbar/controls to the theme.
		frame.style.colorScheme = resolveFrameColorScheme();
	}

	function mountWebview(target: string, my: number): void {
		content.empty();
		mounted = 'webview';
		// 'webview' is not in HTMLElementTagNameMap; bind + cast through the
		// generic signature so tsc accepts the Electron-only tag (calling the
		// unbound method would lose `this` — the bind is load-bearing).
		const createAny = content.createEl.bind(content) as unknown as
			(tag: string, o?: { cls?: string; attr?: Record<string, string> }) => HTMLElement;
		const frame = createAny('webview', {
			cls: 'dashboard-web-frame',
			attr: { src: target, partition: WEBVIEW_PARTITION },
		});
		// Match the guest page's native scrollbar/controls to the theme.
		frame.style.colorScheme = resolveFrameColorScheme();

		// The tag itself never throws (an unsupported environment yields an
		// inert HTMLUnknownElement) — the only failure signal is dom-ready
		// never arriving, hence the timeout fallback below.
		let settled = false;
		const timer = window.setTimeout(() => {
			if (settled || epoch !== my) return;
			settled = true;
			console.error('[Dashboard] webview attach timed out:', target);
			new Notice(t('web.webviewUnavailable'));
			webviewFailed = true;
			render();
		}, options?.timeoutMs ?? DEFAULT_WEBVIEW_TIMEOUT_MS);

		frame.addEventListener('dom-ready', () => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			if (config.zoom != null) {
				try {
					const zoomable = frame as unknown as { setZoomFactor?: (factor: number) => void };
					if (typeof zoomable.setZoomFactor === 'function') zoomable.setZoomFactor(config.zoom);
				} catch (err) {
					console.error('[Dashboard] webview setZoomFactor failed:', err);
				}
			}
		});

		frame.addEventListener('did-fail-load', (ev: unknown) => {
			if (settled || epoch !== my) return;
			const detail = ev as { isMainFrame?: boolean; errorCode?: number };
			// Subframe failures and cancellations (-3 ERR_ABORTED, e.g. a
			// redirect chain) leave the main page loadable — ignore them.
			if (detail.isMainFrame === false || detail.errorCode === -3) return;
			settled = true;
			window.clearTimeout(timer);
			renderLoadError(target);
		});
	}

	function renderLoadError(target: string): void {
		content.empty();
		mounted = 'error';
		const wrap = content.createDiv({ cls: 'dashboard-web-fallback' });
		const icon = wrap.createDiv({ cls: 'dashboard-web-fallback-icon' });
		setIcon(icon, 'alert-triangle');
		wrap.createDiv({ cls: 'dashboard-web-fallback-text', text: t('web.loadFailed') });
		wrap.createDiv({ cls: 'dashboard-web-fallback-url', text: target });
		const retry = wrap.createEl('button', {
			cls: 'dashboard-web-fallback-btn',
			text: t('web.retry'),
			attr: { type: 'button' },
		});
		retry.addEventListener('click', () => render());
	}

	function renderFallback(target: string): void {
		content.empty();
		mounted = 'fallback';
		const wrap = content.createDiv({ cls: 'dashboard-web-fallback' });
		const icon = wrap.createDiv({ cls: 'dashboard-web-fallback-icon' });
		setIcon(icon, 'globe');
		wrap.createDiv({ cls: 'dashboard-web-fallback-text', text: t('web.mobileBlocked') });
		let host = target;
		try { host = new URL(target).hostname; } catch { /* keep raw string */ }
		wrap.createDiv({ cls: 'dashboard-web-fallback-host', text: host });
		wrap.createDiv({ cls: 'dashboard-web-fallback-url', text: target });
		const openBtn = wrap.createEl('button', {
			cls: 'dashboard-web-fallback-btn',
			text: t('web.openExternal'),
			attr: { type: 'button' },
		});
		openBtn.addEventListener('click', () => {
			window.open(target, '_blank');
		});
	}

	function render(): void {
		const my = ++epoch;
		content.empty();
		mounted = 'none';
		// NOTE: webviewFailed is deliberately NOT reset here — the webview
		// timeout handler sets it and calls render() to escape to the iframe;
		// resetting in render() would wash the flag out and loop webviews.
		// Only an explicit refresh (reloadRegister below) gives webview a
		// fresh chance.

		const target = targetUrl();
		if (!isValidWebUrl(target)) {
			renderEmpty();
			return;
		}

		// Engine choice is fully automatic: a cached verdict picks up front,
		// otherwise the iframe mounts optimistically and the background probe
		// (below) swaps it. 'unknown' means a past precheck failed at the
		// network layer — frame optimistically rather than blocking the embed
		// behind a dead probe.
		const applyVerdict = (blocked: boolean): void => {
			if (!blocked) {
				mountIframe(target);
			} else if (Platform.isMobile) {
				renderFallback(target);
			} else if (webviewFailed) {
				mountIframe(target);
			} else {
				mountWebview(target, my);
			}
		};

		const cached = getCachedVerdict(target);
		if (cached !== undefined) {
			applyVerdict(cached === 'blocked');
			return;
		}

		// No verdict yet: mount the iframe OPTIMISTICALLY (allowed is the
		// common case) and let the probe run silently in the background —
		// there is no checking state on screen. Blocked swaps to the
		// webview/fallback card; allowed or unknown keeps the already-live
		// iframe exactly as it is (no reload flicker).
		mountIframe(target);
		void precheckEmbed(target, options?.fetcher).then(result => {
			if (epoch !== my) return; // superseded — late precheck discarded
			if (result.verdict !== 'blocked' && mounted === 'iframe') return; // verdict changes nothing
			applyVerdict(result.verdict === 'blocked');
		});
	}

	// Refresh semantics: drop this URL's cached verdict (the site's policy may
	// have changed, or a past probe may have failed offline), re-arm the
	// webview, and rebuild from the top of the state machine — reloading the
	// page in the process.
	reloadRegister(() => {
		const target = targetUrl();
		if (isValidWebUrl(target)) clearPrecheckCache(target);
		webviewFailed = false;
		render();
	});

	render();
}
