import { setIcon } from 'obsidian';
import type { BookInfo, ReadingService } from './reading-service';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { restoreFloatingPos, wireFloatingDrag } from './floating-panel-utils';
import { openEndReadingModal, refreshSidebarReadingWidget } from './renderer';

/** Self-refresh cadence (ms) — matches the service's tick cadence. */
const POLL_MS = 1000;
/** localStorage key for the last dragged position (device-local). */
const POS_KEY = 'apex-dashboard.reading-mini-pos';

export interface ReadingMiniTimer {
	/** Force an immediate refresh (state changed outside the poll cadence). */
	refresh(): void;
	destroy(): void;
}

function formatElapsed(totalSeconds: number): string {
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Floating reading mini timer: a tiny pill pinned near the top-right corner
 * while a reading session is active, showing the elapsed time with a stop
 * button. Stopping follows the exact sidebar flow — pause, then the end-of-
 * reading modal (end page / total pages / finished) — so the saved record is
 * identical to one ended from the widget.
 *
 * Like the pomodoro mini panel it polls the service on its own interval
 * (the service's onTick slot belongs to the sidebar widget) and is draggable
 * with a persisted position. There is deliberately no hide button: away from
 * the dashboard tab this pill is the only stop handle, and a hidden timer
 * with a running session would be a footgun.
 */
export function createReadingMiniTimer(service: ReadingService, doc: Document): ReadingMiniTimer {
	let panel: HTMLElement | null = null;
	let timeText: HTMLElement | null = null;
	let timer: number | null = null;
	let widthFrozen = false;

	/** Freeze the time cell at the widest format (h:mm:ss) so the pill never
	 *  widens when a session crosses the one-hour mark. */
	function freezeTimeWidth(): void {
		if (!timeText) return;
		const real = timeText.textContent ?? '';
		timeText.textContent = formatElapsed(3600);
		const widest = timeText.offsetWidth;
		timeText.textContent = real;
		timeText.style.width = `${Math.ceil(widest)}px`;
		widthFrozen = true;
	}

	function refresh(): void {
		const state = service.getState();
		if (state.status === 'idle' || !state.currentBook) {
			unmount();
			return;
		}
		if (!panel) mount();

		const paused = state.status === 'paused';
		if (timeText) timeText.textContent = formatElapsed(state.elapsedSeconds);
		if (!widthFrozen) freezeTimeWidth();
		if (panel) {
			panel.toggleClass('dashboard-reading-mini--paused', paused);
			panel.setAttribute(
				'title',
				`${state.currentBook.title} · ${paused ? t('reading.miniPaused') : t('reading.miniReading')}`,
			);
		}
	}

	function mount(): void {
		widthFrozen = false;
		panel = doc.body.createDiv({ cls: 'dashboard-reading-mini' });
		applyModalTheme(panel);

		const icon = panel.createDiv({ cls: 'dashboard-reading-mini-icon' });
		setIcon(icon, 'book-open');

		timeText = panel.createDiv({ cls: 'dashboard-reading-mini-time' });

		const stopBtn = panel.createDiv({
			cls: 'dashboard-reading-mini-btn',
			attr: { role: 'button', tabindex: '0', 'aria-label': t('reading.miniStop'), title: t('reading.miniStop') },
		});
		setIcon(stopBtn, 'square');
		stopBtn.addEventListener('click', () => {
			const state = service.getState();
			if (state.status === 'idle' || !state.currentBook) return;
			const book: BookInfo = state.currentBook;
			// Pause first so the elapsed time freezes in the modal (same as
			// the sidebar stop button), then collect the end-of-session info.
			if (state.status === 'running') service.pause();
			openEndReadingModal(
				doc,
				service,
				book,
				service.getElapsedSeconds(),
				() => {
					refreshSidebarReadingWidget(doc, service);
					refresh();
				},
			);
		});

		wireFloatingDrag(panel, doc, POS_KEY, '.dashboard-reading-mini-btn');
		restoreFloatingPos(panel, doc, POS_KEY);
	}

	function unmount(): void {
		panel?.remove();
		panel = null;
		timeText = null;
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
