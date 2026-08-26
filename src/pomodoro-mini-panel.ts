import { setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { restoreFloatingPos, wireFloatingDrag } from './floating-panel-utils';
import { PomodoroService, type PomodoroPhase } from './pomodoro-service';

/** Panel self-refresh cadence (ms) — matches the service's own tick cadence. */
const POLL_MS = 1000;
/** Mini ring geometry (px). */
const RING_SIZE = 28;
const RING_STROKE = 2.5;
/** localStorage key for the last dragged position (device-local by design:
 *  a position saved on a big screen must not yank the panel off a phone). */
const POS_KEY = 'apex-dashboard.pomodoro-mini-pos';

interface PanelRefs {
	panel: HTMLElement;
	infoEl: HTMLElement;
	timeText: HTMLElement;
	phaseText: HTMLElement;
	progressCircle: SVGCircleElement;
	ringRadius: number;
	toggleBtn: HTMLElement;
}

export interface PomodoroMiniPanel {
	/** Force an immediate refresh (state changed outside the poll cadence). */
	refresh(): void;
	destroy(): void;
}

function formatMiniTime(totalSeconds: number): string {
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function phaseLabel(phase: PomodoroPhase, paused: boolean): string {
	const base = phase === 'work'
		? t('pomodoro.work')
		: phase === 'short-break' ? t('pomodoro.shortBreak') : t('pomodoro.longBreak');
	return paused ? `${base} · ${t('pomodoro.paused')}` : base;
}

/**
 * Floating pomodoro mini panel: a small always-on-top countdown pill with a
 * tomato ring, pause/resume and skip actions, mounted at the document body
 * level so it stays visible while the user works in other tabs.
 *
 * The panel deliberately does NOT use the service's onTick/onComplete slots:
 * they are single-subscriber and already owned by the sidebar widget (and get
 * rewired on every sidebar re-render). Instead it polls getState() on its own
 * interval, which also makes it immune to view re-render cleanup cycles.
 *
 * Lifecycle: mounted whenever the service is non-idle and the setting is on;
 * hidden when idle, disabled, or manually dismissed (a dismissal re-arms on
 * the next idle-to-running transition). Destroyed together with the owning
 * view, since the service dies with it.
 */
export function createPomodoroMiniPanel(
	plugin: DashboardPlugin,
	service: PomodoroService,
	doc: Document,
): PomodoroMiniPanel {
	let refs: PanelRefs | null = null;
	let timer: number | null = null;
	let dismissed = false;
	let seenIdle = true;
	let widthFrozen = false;

	/** Freeze the info column at its widest phase/pause label right after
	 *  mount, so the pill's size never changes across phase transitions,
	 *  pause state or countdown digits. */
	function freezeInfoWidth(): void {
		if (!refs) return;
		const { infoEl, phaseText } = refs;
		const realPhase = phaseText.textContent ?? '';
		const variants = (['work', 'short-break', 'long-break'] as const)
			.flatMap(phase => [phaseLabel(phase, false), phaseLabel(phase, true)]);
		let widest = infoEl.offsetWidth;
		for (const v of variants) {
			phaseText.textContent = v;
			widest = Math.max(widest, infoEl.offsetWidth);
		}
		phaseText.textContent = realPhase;
		infoEl.style.width = `${Math.ceil(widest)}px`;
		widthFrozen = true;
	}

	function refresh(): void {
		const enabled = plugin.settings.pomodoroMiniPanelEnabled;
		const state = service.getState();

		// Leaving idle re-arms a manual dismissal so the next run shows again.
		if (state.status === 'idle') {
			seenIdle = true;
		} else if (seenIdle) {
			seenIdle = false;
			dismissed = false;
		}

		if (!enabled || state.status === 'idle' || dismissed) {
			unmount();
			return;
		}
		if (!refs) mount();
		if (!refs) return;

		const paused = state.status === 'paused';
		refs.timeText.textContent = formatMiniTime(state.remainingSeconds);
		refs.phaseText.textContent = phaseLabel(state.phase, paused);
		if (!widthFrozen) freezeInfoWidth();
		const progress = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 1;
		const circumference = 2 * Math.PI * refs.ringRadius;
		refs.progressCircle.setAttribute(
			'stroke-dashoffset',
			String(circumference * (1 - progress)),
		);
		refs.panel.toggleClass('dashboard-pomodoro-mini--paused', paused);
		refs.panel.toggleClass('dashboard-pomodoro-mini--break', state.phase !== 'work');

		setIcon(refs.toggleBtn, state.status === 'running' ? 'pause' : 'play');
		refs.toggleBtn.setAttribute(
			'aria-label',
			state.status === 'running' ? t('pomodoro.pause') : t('pomodoro.start'),
		);
	}

	function mount(): void {
		widthFrozen = false;
		const panel = doc.body.createDiv({ cls: 'dashboard-pomodoro-mini' });
		applyModalTheme(panel);

		// Ring with the tomato at its center.
		const ringWrap = panel.createDiv({ cls: 'dashboard-pomodoro-mini-ring-wrap' });
		const radius = (RING_SIZE - RING_STROKE) / 2;
		const circumference = 2 * Math.PI * radius;
		const svg = ringWrap.createSvg('svg', {
			cls: 'dashboard-pomodoro-mini-ring',
			attr: {
				viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`,
				width: String(RING_SIZE),
				height: String(RING_SIZE),
			},
		});
		svg.createSvg('circle', {
			cls: 'dashboard-pomodoro-mini-ring-bg',
			attr: {
				cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: radius,
				'stroke-width': RING_STROKE, fill: 'none',
			},
		});
		const progressCircle = svg.createSvg('circle', {
			cls: 'dashboard-pomodoro-mini-ring-progress',
			attr: {
				cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: radius,
				'stroke-width': RING_STROKE, fill: 'none',
				'stroke-linecap': 'round',
				'stroke-dasharray': circumference,
				'stroke-dashoffset': '0',
				transform: `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`,
			},
		});
		ringWrap.createDiv({ cls: 'dashboard-pomodoro-mini-tomato', text: '🍅' });

		const info = panel.createDiv({ cls: 'dashboard-pomodoro-mini-info' });
		const timeText = info.createDiv({ cls: 'dashboard-pomodoro-mini-time' });
		const phaseText = info.createDiv({ cls: 'dashboard-pomodoro-mini-phase' });

		const toggleBtn = panel.createDiv({
			cls: 'dashboard-pomodoro-mini-btn',
			attr: { role: 'button', tabindex: '0' },
		});
		toggleBtn.addEventListener('click', () => {
			if (service.getState().status === 'running') {
				service.pause();
			} else {
				service.start();
			}
			refresh();
		});

		const skipBtn = panel.createDiv({
			cls: 'dashboard-pomodoro-mini-btn',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('pomodoro.skip'), title: t('pomodoro.skip') },
		});
		setIcon(skipBtn, 'skip-forward');
		skipBtn.addEventListener('click', () => {
			service.skip();
			refresh();
		});

		const hideBtn = panel.createDiv({
			cls: 'dashboard-pomodoro-mini-btn dashboard-pomodoro-mini-btn--ghost',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('pomodoro.miniHide'), title: t('pomodoro.miniHide') },
		});
		setIcon(hideBtn, 'x');
		hideBtn.addEventListener('click', () => {
			dismissed = true;
			unmount();
		});

		refs = {
			panel,
			infoEl: info,
			timeText,
			phaseText,
			progressCircle,
			ringRadius: radius,
			toggleBtn,
		};

		wireFloatingDrag(panel, doc, POS_KEY, '.dashboard-pomodoro-mini-btn');
		// Restore the last dragged spot (clamped to this viewport's size).
		restoreFloatingPos(panel, doc, POS_KEY);
	}

	function unmount(): void {
		refs?.panel.remove();
		refs = null;
	}

	timer = window.setInterval(() => refresh(), POLL_MS);
	refresh();

	return {
		refresh,
		destroy(): void {
			if (timer !== null) {
				window.clearInterval(timer);
				timer = null;
			}
			unmount();
		},
	};
}
