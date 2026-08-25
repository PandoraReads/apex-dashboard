import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { getHabitService, habitFormatDate, HabitService, type Habit } from './habit-service';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';

/** Heatmap window shown per habit in the stats overlay (12 weeks). */
const HEATMAP_DAYS = 84;
/** Long-press before a touch drag arms (matches the card DnD threshold). */
const TOUCH_DRAG_MS = 200;
/** Finger travel that cancels a pending touch drag (scroll intent). */
const TOUCH_CANCEL_PX = 10;

/** Shared state for card reordering inside one open overlay. */
interface HabitDragState {
	index: number | null;
}

/**
 * Mount point for the stats overlay. The `--db-*` theme variables live on
 * `.apex-dashboard-root[data-theme]`, so the overlay must be appended INSIDE
 * that root (not doc.body) or every var() resolves to nothing (same reason as
 * the pomodoro stats overlay).
 */
function mountOverlay(doc: Document): HTMLElement {
	const root = doc.querySelector('.apex-dashboard-root');
	const host = root ?? doc.body;
	return host.createDiv({ cls: 'dashboard-habit-stats-overlay' });
}

/**
 * Habit statistics overlay: one card per habit with streak / 30-day rate /
 * total count chips and a 12-week check-in heatmap. Rename, delete and
 * drag-to-reorder live here (the widget stays tap-to-toggle only); every
 * mutation re-renders through the service's subscribe fan-out.
 */
export function showHabitStats(doc: Document): void {
	const service = getHabitService();
	if (!service) return;

	const overlay = mountOverlay(doc);
	const modal = overlay.createDiv({ cls: 'dashboard-habit-stats-modal' });

	const header = modal.createDiv({ cls: 'dashboard-habit-stats-header' });
	header.createDiv({ cls: 'dashboard-habit-stats-title', text: t('habit.statsTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-habit-stats-close' });
	setIcon(closeBtn, 'x');

	const body = modal.createDiv({ cls: 'dashboard-habit-stats-body' });

	let closed = false;
	function close(): void {
		closed = true;
		unsubscribe();
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		// A confirm/prompt dialog may be stacked on top (rename/delete); it
		// also listens for Escape on the same document — let IT consume the
		// key so cancelling the dialog doesn't close the stats overlay too.
		if (e.key === 'Escape' && !doc.querySelector('.dashboard-confirm-overlay')) close();
	}
	doc.addEventListener('keydown', onKey);
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	const drag: HabitDragState = { index: null };

	const renderAll = (): void => {
		body.empty();
		const habits = service.getHabits();
		if (habits.length === 0) {
			body.createDiv({ cls: 'dashboard-habit-stats-empty', text: t('habit.statsEmpty') });
			return;
		}
		habits.forEach((habit, index) => {
			renderHabitCard(body, service, habit, index, drag);
		});
	};

	// Live re-render on any habit data change (check-in, rename, delete...).
	// A full view re-render can detach the overlay's host root — unsubscribe
	// then instead of holding a dead listener until the next Escape.
	const unsubscribe = service.subscribe(() => {
		if (!overlay.isConnected) {
			unsubscribe();
			return;
		}
		if (!closed) renderAll();
	});

	renderAll();
}

function renderHabitCard(
	body: HTMLElement,
	service: HabitService,
	habit: Habit,
	index: number,
	drag: HabitDragState,
): void {
	const card = body.createDiv({
		cls: 'dashboard-habit-stats-card',
		attr: { 'data-index': String(index) },
	});

	const head = card.createDiv({ cls: 'dashboard-habit-stats-card-head' });
	const grip = head.createDiv({
		cls: 'dashboard-habit-stats-grip',
		attr: { 'aria-label': t('common.drag'), title: t('common.drag') },
	});
	setIcon(grip, 'grip-vertical');
	head.createDiv({ cls: 'dashboard-habit-stats-card-name', text: habit.name });
	head.createDiv({ cls: 'dashboard-habit-stats-card-head-spacer' });

	const renameBtn = head.createDiv({ cls: 'dashboard-habit-stats-icon-btn' });
	renameBtn.setAttribute('aria-label', t('habit.renameTitle'));
	setIcon(renameBtn, 'pencil');
	renameBtn.addEventListener('click', () => {
		void (async () => {
			const name = await showPromptDialog(null, {
				title: t('habit.renameTitle'),
				defaultValue: habit.name,
			});
			if (name === null) return;
			// The service's notify fan-out re-renders the overlay on success;
			// a rejected rename (duplicate) surfaces as a Notice instead.
			if (!service.renameHabit(habit.id, name)) {
				new Notice(t('habit.duplicate'));
			}
		})();
	});

	const deleteBtn = head.createDiv({ cls: 'dashboard-habit-stats-icon-btn dashboard-habit-stats-icon-btn--danger' });
	deleteBtn.setAttribute('aria-label', t('habit.deleteTitle'));
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', () => {
		void (async () => {
			const confirmed = await showConfirmDialog(null, {
				title: t('habit.deleteTitle'),
				message: t('habit.deleteConfirm', { name: habit.name }),
			});
			if (confirmed) {
				// Re-render comes from the service's notify fan-out.
				service.removeHabit(habit.id);
			}
		})();
	});

	const chips = card.createDiv({ cls: 'dashboard-habit-stats-chips' });
	appendChip(chips, 'flame', `${service.getStreak(habit.id)}${t('habit.dayUnit')}`, t('habit.streakLabel'));
	appendChip(chips, 'percent', `${service.getRate30(habit.id)}%`, t('habit.rate30'));
	appendChip(chips, 'check-circle-2', String(service.getTotal(habit.id)), t('habit.totalCount'));

	renderHabitHeatmap(card, service, habit);

	wireCardDrag(body, card, grip, index, drag, service);
	wireCardTouchDrag(body, card, index, service);
}

// ── Drag-to-reorder (quick-note config modal pattern) ─────────────────────

/** Which half of `card` the pointer sits in — decides insert-before vs -after. */
function dropHalf(e: { clientY: number }, card: HTMLElement): 'top' | 'bottom' {
	const rect = card.getBoundingClientRect();
	return e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
}

function indicateDrop(body: HTMLElement, card: HTMLElement, half: 'top' | 'bottom'): void {
	clearDropIndicators(body);
	card.addClass(half === 'top'
		? 'dashboard-habit-stats-card--drop-before'
		: 'dashboard-habit-stats-card--drop-after');
}

function clearDropIndicators(body: HTMLElement): void {
	body
		.querySelectorAll('.dashboard-habit-stats-card--drop-before, .dashboard-habit-stats-card--drop-after')
		.forEach(el => el.classList.remove('dashboard-habit-stats-card--drop-before', 'dashboard-habit-stats-card--drop-after'));
}

/**
 * Grip-gated HTML5 drag (desktop): dragging arms only while the grip is held,
 * so rename/delete stay clickable; the hovered card's half decides the insert
 * slot. Committing calls service.moveHabit, whose notify fan-out re-renders
 * the overlay — the same path rename and delete already take.
 */
function wireCardDrag(
	body: HTMLElement,
	card: HTMLElement,
	grip: HTMLElement,
	index: number,
	drag: HabitDragState,
	service: HabitService,
): void {
	card.draggable = false;
	// Only the grip arms dragging; releasing without a drag disarms it again.
	grip.addEventListener('pointerdown', () => { card.draggable = true; });
	grip.addEventListener('pointerup', () => { card.draggable = false; });

	card.addEventListener('dragstart', (e: DragEvent) => {
		if (!card.draggable) return;
		drag.index = index;
		card.addClass('dashboard-habit-stats-card--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', 'habit-card');
		}
	});
	card.addEventListener('dragend', () => {
		card.removeClass('dashboard-habit-stats-card--dragging');
		card.draggable = false;
		clearDropIndicators(body);
		drag.index = null;
	});
	card.addEventListener('dragover', (e: DragEvent) => {
		if (drag.index === null || drag.index === index) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		indicateDrop(body, card, dropHalf(e, card));
	});
	card.addEventListener('drop', (e: DragEvent) => {
		if (drag.index === null) return;
		e.preventDefault();
		const from = drag.index;
		const to = dropHalf(e, card) === 'top' ? index : index + 1;
		clearDropIndicators(body);
		// Reset before the move: the notify re-render detaches the source
		// card before its dragend can fire (quick-note wireDrag lesson).
		drag.index = null;
		if (from !== to) service.moveHabit(from, to);
	});
}

/** First non-source card whose rect contains the point (touch hit-testing). */
function cardAtPoint(body: HTMLElement, x: number, y: number): HTMLElement | null {
	const cards = Array.from(body.querySelectorAll<HTMLElement>('.dashboard-habit-stats-card'));
	for (const c of cards) {
		if (c.hasClass('dashboard-habit-stats-card--dragging')) continue;
		const rect = c.getBoundingClientRect();
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return c;
	}
	return null;
}

/** Clone following the dragged card under the finger (mobile). Appended to
 *  the overlay — not doc.body — so the clone keeps the theme's --db-* vars. */
function createCardGhost(card: HTMLElement, x: number, y: number): HTMLElement {
	const ghost = card.cloneNode(true) as HTMLElement;
	ghost.addClass('dashboard-habit-stats-card--ghost');
	ghost.setCssProps({
		position: 'fixed',
		width: `${card.offsetWidth}px`,
		left: `${x - card.offsetWidth / 2}px`,
		top: `${y - card.offsetHeight / 2}px`,
		zIndex: '9999',
		pointerEvents: 'none',
		opacity: '0.85',
		transform: 'rotate(2deg)',
	});
	const host = card.closest('.dashboard-habit-stats-overlay') ?? card.ownerDocument.body;
	host.appendChild(ghost);
	return ghost;
}

/**
 * Long-press drag on the card head (mobile): HTML5 DnD never fires from a
 * touch, so the grip-less path reuses the card-DnD ghost convention. A short
 * press stays a plain tap; moving TOUCH_CANCEL_PX before the timer fires is
 * read as a scroll and cancels the drag before it starts.
 */
function wireCardTouchDrag(
	body: HTMLElement,
	card: HTMLElement,
	index: number,
	service: HabitService,
): void {
	let ghost: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let isDragging = false;
	let timer: number | null = null;

	const cleanupDrag = (): void => {
		if (ghost) {
			ghost.remove();
			ghost = null;
		}
		card.removeClass('dashboard-habit-stats-card--dragging');
		clearDropIndicators(body);
		isDragging = false;
	};

	const onTouchStart = (e: TouchEvent) => {
		const t0 = e.touches[0];
		if (!t0) return;
		// Only the head row starts a drag; icon buttons handle their own taps.
		const target = e.target as HTMLElement;
		if (!target.closest('.dashboard-habit-stats-card-head')) return;
		if (target.closest('.dashboard-habit-stats-icon-btn')) return;

		startX = t0.clientX;
		startY = t0.clientY;
		isDragging = false;

		timer = window.setTimeout(() => {
			isDragging = true;
			ghost = createCardGhost(card, startX, startY);
			card.addClass('dashboard-habit-stats-card--dragging');
		}, TOUCH_DRAG_MS);
	};

	const onTouchMove = (e: TouchEvent) => {
		if (!isDragging) {
			if (timer) {
				const t = e.touches[0];
				if (!t) return;
				if (Math.abs(t.clientX - startX) > TOUCH_CANCEL_PX || Math.abs(t.clientY - startY) > TOUCH_CANCEL_PX) {
					window.clearTimeout(timer);
					timer = null;
				}
			}
			return;
		}

		e.preventDefault();
		const t = e.touches[0];
		if (!t) return;

		if (ghost) {
			ghost.style.left = `${t.clientX - ghost.offsetWidth / 2}px`;
			ghost.style.top = `${t.clientY - ghost.offsetHeight / 2}px`;
		}

		const target = cardAtPoint(body, t.clientX, t.clientY);
		if (target) {
			indicateDrop(body, target, dropHalf(t, target));
		} else {
			clearDropIndicators(body);
		}
	};

	const onTouchEnd = (e: TouchEvent) => {
		if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}
		if (!isDragging) return;

		const t = e.changedTouches[0];
		cleanupDrag();
		if (!t) return;

		const target = cardAtPoint(body, t.clientX, t.clientY);
		if (!target) return;
		const toIndex = Number(target.dataset.index ?? '-1');
		if (toIndex < 0) return;
		const to = dropHalf(t, target) === 'top' ? toIndex : toIndex + 1;
		if (index !== to) service.moveHabit(index, to);
	};

	// touchcancel fires on system interruptions (edge gestures, scroll hijack,
	// notifications) instead of touchend; without it the ghost strands on screen.
	const onTouchCancel = () => {
		if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}
		cleanupDrag();
	};

	card.addEventListener('touchstart', onTouchStart, { passive: true });
	card.addEventListener('touchmove', onTouchMove, { passive: false });
	card.addEventListener('touchend', onTouchEnd, { passive: true });
	card.addEventListener('touchcancel', onTouchCancel, { passive: true });
}

function appendChip(parent: HTMLElement, icon: string, value: string, label: string): void {
	const chip = parent.createDiv({ cls: 'dashboard-habit-stats-chip' });
	const ico = chip.createDiv({ cls: 'dashboard-habit-stats-chip-icon' });
	setIcon(ico, icon);
	const text = chip.createDiv({ cls: 'dashboard-habit-stats-chip-text' });
	text.createDiv({ cls: 'dashboard-habit-stats-chip-value', text: value });
	text.createDiv({ cls: 'dashboard-habit-stats-chip-label', text: label });
}

/** 12-week check-in grid, oldest→today, boolean two-step fill (empty base vs
 *  accent). A wrapping div grid (banner heatmap pattern), not SVG: cells fill
 *  the card width at a fixed pitch — no fixed-canvas center-huddle, and none
 *  of the SVG first-paint collapse pitfalls. Native <title> tooltips. */
function renderHabitHeatmap(card: HTMLElement, service: HabitService, habit: Habit): void {
	const section = card.createDiv({ cls: 'dashboard-habit-stats-heatmap-section' });
	const head = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-head' });
	head.createDiv({ cls: 'dashboard-habit-stats-heatmap-hint', text: t('habit.heatmapHint') });

	const wrap = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-wrap' });
	const series = service.getHeatmapDays(habit.id, HEATMAP_DAYS);

	const grid = wrap.createDiv({ cls: 'dashboard-habit-stats-heatmap-grid' });
	series.forEach((done, i) => {
		const cell = grid.createDiv({ cls: 'dashboard-habit-stats-heatmap-cell' });
		if (done > 0) cell.addClass('dashboard-habit-stats-heatmap-cell--done');
		// Tooltips still carry the date — the wrapping strip has no calendar
		// axes, so the <title> is the only per-cell label.
		const d = new Date();
		d.setDate(d.getDate() - (HEATMAP_DAYS - 1 - i));
		cell.setAttribute('title', done > 0
			? `${habitFormatDate(d)} · ${t('habit.heatDone')}`
			: habitFormatDate(d));
	});

	// Empty-grid guidance for habits with no check-ins yet.
	if (series.every(v => v === 0)) {
		wrap.createDiv({ cls: 'dashboard-habit-stats-heatmap-empty', text: t('habit.heatEmpty') });
	}

	const legend = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-legend' });
	legend.createSpan({ cls: 'dashboard-habit-stats-heatmap-legend-label', text: t('pomodoro.less') });
	legend.createDiv({ cls: 'dashboard-habit-stats-heatmap-legend-swatch' });
	legend.createDiv({
		cls: 'dashboard-habit-stats-heatmap-legend-swatch dashboard-habit-stats-heatmap-legend-swatch--done',
	});
	legend.createSpan({ cls: 'dashboard-habit-stats-heatmap-legend-label', text: t('pomodoro.more') });
}
