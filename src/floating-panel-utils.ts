/** Shared helpers for body-level floating mini panels (pomodoro pill,
 *  reading timer): viewport-clamped positioning, persisted drag positions
 *  and a pointer-drag wiring that leaves inner buttons clickable. */

/** Pointer travel (px) before a press counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 3;
/** Viewport edge margin panels are clamped to (px). */
const EDGE_MARGIN_PX = 8;

interface SavedPos {
	left: number;
	top: number;
}

function loadPos(doc: Document, key: string): SavedPos | null {
	try {
		const raw = doc.defaultView?.localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<SavedPos>;
		if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
		return { left: parsed.left, top: parsed.top };
	} catch {
		return null;
	}
}

function savePos(doc: Document, key: string, pos: SavedPos): void {
	try {
		doc.defaultView?.localStorage.setItem(key, JSON.stringify(pos));
	} catch {
		// Storage unavailable (sandboxed context) — position lives for this mount only.
	}
}

/** Pin the panel at left/top (switching off its right/bottom default anchor),
 *  clamped inside the current viewport so saved positions from other window
 *  sizes can never strand the panel off-screen. */
function applyClampedPos(panel: HTMLElement, doc: Document, left: number, top: number): void {
	const view = doc.defaultView;
	if (!view) return;
	// Swap the stylesheet anchors off via the pinned class — without it the
	// stylesheet right/bottom would fight the inline left/top and stretch
	// the panel across the viewport instead of moving it.
	panel.addClass('dashboard-floating-mini--pinned');
	const maxX = Math.max(EDGE_MARGIN_PX, view.innerWidth - panel.offsetWidth - EDGE_MARGIN_PX);
	const maxY = Math.max(EDGE_MARGIN_PX, view.innerHeight - panel.offsetHeight - EDGE_MARGIN_PX);
	panel.style.left = `${Math.min(Math.max(left, EDGE_MARGIN_PX), maxX)}px`;
	panel.style.top = `${Math.min(Math.max(top, EDGE_MARGIN_PX), maxY)}px`;
}

/** Restore the last dragged spot (clamped to this viewport), if any. */
export function restoreFloatingPos(panel: HTMLElement, doc: Document, key: string): void {
	const saved = loadPos(doc, key);
	if (saved) applyClampedPos(panel, doc, saved.left, saved.top);
}

/**
 * Drag-to-move on the panel body: pointerdown captures, travel past the
 * threshold switches to explicit left/top positioning and follows the
 * pointer; release persists the spot under `key`. Elements matching
 * `skipSelector` (buttons) never start a drag.
 */
export function wireFloatingDrag(
	panel: HTMLElement,
	doc: Document,
	key: string,
	skipSelector: string,
): void {
	panel.addEventListener('pointerdown', (e: PointerEvent) => {
		if ((e.target as HTMLElement).closest(skipSelector)) return;
		const startPX = e.clientX;
		const startPY = e.clientY;
		const rect = panel.getBoundingClientRect();
		const offX = startPX - rect.left;
		const offY = startPY - rect.top;
		let moved = false;

		const onMove = (ev: PointerEvent): void => {
			if (!moved && Math.hypot(ev.clientX - startPX, ev.clientY - startPY) < DRAG_THRESHOLD_PX) return;
			if (!moved) {
				moved = true;
				panel.addClass('dashboard-floating-mini--dragging');
			}
			applyClampedPos(panel, doc, ev.clientX - offX, ev.clientY - offY);
		};
		const onUp = (): void => {
			panel.removeEventListener('pointermove', onMove);
			panel.removeEventListener('pointerup', onUp);
			panel.removeEventListener('pointercancel', onUp);
			if (moved) {
				panel.removeClass('dashboard-floating-mini--dragging');
				const r = panel.getBoundingClientRect();
				savePos(doc, key, { left: r.left, top: r.top });
			}
		};

		panel.addEventListener('pointermove', onMove);
		panel.addEventListener('pointerup', onUp);
		panel.addEventListener('pointercancel', onUp);
		try {
			// Keeps move/up firing at the panel even when the pointer leaves it.
			panel.setPointerCapture(e.pointerId);
		} catch {
			// Older webviews: listeners above still cover the common slow-drag case.
		}
	});
}
