/** Guarded surface drag for the desktop resize handles (pair-width divider,
 *  section height).
 *
 *  Why this exists: a plain mousedown + document mousemove/mouseup stream dies
 *  the moment the cursor crosses an embedded frame (web section iframe /
 *  Electron webview) — the guest page owns those pixels, the document never
 *  sees the move or the up. On Windows the failure is worse: a webview's
 *  composited surface can extend past its element box and ignore DOM
 *  z-index, so it can swallow events even over the divider strip itself
 *  (the "surface overflow" class of Windows bugs).
 *
 *  The guard defeats both with two independent nets:
 *  1. POINTER CAPTURE on a full-viewport shield mounted on body for the
 *     drag's lifetime — capture routes every subsequent pointer event to the
 *     shield, bypassing hit-testing entirely, no matter what foreign surface
 *     sits under the cursor.
 *  2. The shield itself covers everything (z-index above the whole app), so
 *     even engines where capture misbehaves deliver moves through it.
 */

export interface GuardedDragHandlers {
	onMove: (ev: PointerEvent) => void;
	onUp: (ev: PointerEvent) => void;
	/** Cursor shown over the shield for the drag's lifetime
	 *  (e.g. 'col-resize'); the mousedown cursor can lag without it. */
	cursor?: string;
}

export function startGuardedDrag(e: PointerEvent, handlers: GuardedDragHandlers): void {
	e.preventDefault();
	e.stopPropagation();

	const doc = e.view?.document ?? activeDocument;
	const shield = doc.body.createDiv({ cls: 'dashboard-drag-shield' });
	if (handlers.cursor) shield.style.cursor = handlers.cursor;

	let done = false;
	const finish = (): void => {
		if (done) return;
		done = true;
		shield.removeEventListener('pointermove', onMove);
		shield.removeEventListener('pointerup', onUp);
		shield.removeEventListener('pointercancel', finish);
		doc.removeEventListener('pointermove', onMove);
		doc.removeEventListener('pointerup', onUp);
		try {
			if (shield.hasPointerCapture(e.pointerId)) shield.releasePointerCapture(e.pointerId);
		} catch {
			// Engine without capture support: the document listeners carried it.
		}
		shield.remove();
	};
	const onMove = (ev: PointerEvent): void => {
		if (done) return;
		handlers.onMove(ev);
	};
	const onUp = (ev: PointerEvent): void => {
		if (done) return;
		finish();
		handlers.onUp(ev);
	};

	shield.addEventListener('pointermove', onMove);
	shield.addEventListener('pointerup', onUp);
	shield.addEventListener('pointercancel', finish);
	// Belt-and-braces alongside the capture (and the carrier when an engine
	// rejects capture on a freshly-mounted element).
	doc.addEventListener('pointermove', onMove);
	doc.addEventListener('pointerup', onUp);
	try {
		shield.setPointerCapture(e.pointerId);
	} catch {
		// Capture unavailable: the document listeners own the stream.
	}
}
