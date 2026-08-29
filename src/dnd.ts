import type { RenderCallbacks } from './types';

/** Custom drag type marking "a library kanban card file drag" (set by
 *  library-section's folder-grouped kanban). Foreign drop targets check
 *  dataTransfer.types for it at dragover time — when text/plain payloads are
 *  not yet readable — to decline the drag instead of painting misleading
 *  drop-target highlights. */
export const KANBAN_FILE_DRAG_TYPE = 'application/x-apex-libcard';

/** Custom drag type marking "an item drag inside a card" (task/doc items set
 *  it on dragstart). The card-level external-file-drop layer and the
 *  section-row handlers check for it so an item drag is never mistaken for a
 *  file drag — the file layer used to force dropEffect='link' over the
 *  effectAllowed='move' item drags carry, which made the browser forbid the
 *  drop and left empty cards (no item handlers to win the race) undroppable. */
export const ITEM_DRAG_TYPE = 'application/x-apex-item';

interface DnDState {
	draggingCardId: string | null;
	draggingElement: HTMLElement | null;
	sourceColumn: string | null;
	dropIndicator: HTMLElement | null;
	/** Section-reorder drag (from the grip handle); mutually exclusive with card drag. */
	sectionDragSource: { index: number; row: HTMLElement } | null;
}

export function setupDragAndDrop(
	container: HTMLElement,
	callbacks: RenderCallbacks,
	cleanupFns: Array<() => void>,
): void {
	const state: DnDState = {
		draggingCardId: null,
		draggingElement: null,
		sourceColumn: null,
		dropIndicator: null,
		sectionDragSource: null,
	};

	const rows = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-section-row'));

	rows.forEach((colEl, index) => {
		const columnName = colEl.dataset.column ?? '';

		// Section reorder grip handle (desktop). Sets sectionDragSource so the row's
		// dragover/drop handlers branch into section-reorder logic instead of card moves.
		const grip = colEl.querySelector<HTMLElement>('.dashboard-section-grip');
		if (grip) {
			const onGripDragStart = (e: DragEvent) => {
				e.stopPropagation();
				state.sectionDragSource = { index, row: colEl };
				colEl.addClass('dashboard-section-row--dragging');
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', `section:${columnName}`);
				}
			};
			const onGripDragEnd = () => {
				colEl.removeClass('dashboard-section-row--dragging');
				clearAllSectionDragOver();
				removeSectionDropIndicator(state);
				state.sectionDragSource = null;
			};
			grip.addEventListener('dragstart', onGripDragStart);
			grip.addEventListener('dragend', onGripDragEnd);
			cleanupFns.push(() => {
				grip.removeEventListener('dragstart', onGripDragStart);
				grip.removeEventListener('dragend', onGripDragEnd);
			});
		}

		const cards = colEl.querySelectorAll('.dashboard-card');
		cards.forEach((card) => {
			const cardEl = card as HTMLElement;
			const cardId = cardEl.dataset.cardId ?? '';

			const onDragStart = (e: DragEvent) => {
				state.draggingCardId = cardId;
				state.draggingElement = cardEl;
				state.sourceColumn = columnName;
				cardEl.addClass('dashboard-card--dragging');

				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', cardId);
				}
			};

			const onDragEnd = () => {
				cardEl.removeClass('dashboard-card--dragging');
				removeDropIndicator(state);
				clearAllDragOver();
				state.draggingCardId = null;
				state.draggingElement = null;
				state.sourceColumn = null;
			};

			cardEl.addEventListener('dragstart', onDragStart);
			cardEl.addEventListener('dragend', onDragEnd);
			cleanupFns.push(() => {
				cardEl.removeEventListener('dragstart', onDragStart);
				cardEl.removeEventListener('dragend', onDragEnd);
			});

			setupExternalFileDrop(cardEl, cardId, state, callbacks, cleanupFns);

			setupTouchDrag(state, cardEl, cardId, columnName, container, callbacks, cleanupFns);
		});

		const onDragOver = (e: DragEvent) => {
			// A library kanban card drag hovering this section row: decline early
			// (no preventDefault, no highlight, no drop indicator) so the row can't
			// masquerade as a drop target for a file move it would silently ignore.
			if (e.dataTransfer?.types.includes(KANBAN_FILE_DRAG_TYPE)) return;
			// An in-card item drag is none of the section row's business either
			// (no card move, no section reorder): decline the same way so no
			// misleading card drop indicator is painted over empty row space.
			if (e.dataTransfer?.types.includes(ITEM_DRAG_TYPE) && !state.sectionDragSource && !state.draggingCardId) return;
			if (state.sectionDragSource) {
				e.preventDefault();
				e.stopPropagation();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				updateSectionDropIndicator(state, container, colEl, e.clientX, e.clientY);
				return;
			}
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			colEl.addClass('dashboard-section-row--drag-over');
			updateDropIndicator(state, colEl, e.clientX, e.clientY);
		};

		const onDragLeave = (e: DragEvent) => {
			if (state.sectionDragSource) return;
			const rect = colEl.getBoundingClientRect();
			if (
				e.clientX < rect.left || e.clientX > rect.right ||
				e.clientY < rect.top || e.clientY > rect.bottom
			) {
				colEl.removeClass('dashboard-section-row--drag-over');
				removeDropIndicator(state);
			}
		};

		const onDrop = (e: DragEvent) => {
			if (state.sectionDragSource) {
				e.preventDefault();
				e.stopPropagation();
				const src = state.sectionDragSource;
				if (src.index === index) {
					removeSectionDropIndicator(state);
					return;
				}
				const zone = getSectionDropZone(colEl, e.clientX, e.clientY);
				if (zone === 'left' || zone === 'right') {
					// Side drop: pair with this section (its ex-partner, if any, falls
					// back to a full-width row). Indices stay in current-array space;
					// moveColumnBeside resolves the post-removal insertion.
					callbacks.onColumnMoveBeside(src.index, index, zone);
					removeSectionDropIndicator(state);
					return;
				}
				// Compute target index in the array AFTER the source is removed.
				let target: number;
				if (zone === 'before') {
					target = src.index < index ? index - 1 : index;
				} else {
					target = src.index < index ? index : index + 1;
				}
				// target === src.index is legal: a vertical drop onto the row the
				// source already borders unpairs it in place. The sync layer skips
				// the disk write when nothing actually changes.
				callbacks.onColumnMove(src.index, target);
				removeSectionDropIndicator(state);
				return;
			}
			e.preventDefault();
			colEl.removeClass('dashboard-section-row--drag-over');

			if (!state.draggingCardId) return;

			const cardsContainer = colEl.querySelector('.dashboard-section-cards');
			if (!cardsContainer) return;


			const targetColumn = colEl.dataset.column ?? '';

			if (colEl.dataset.sectionType === 'dashboard' && cardsContainer.instanceOf(HTMLElement)) {
				const targetIndex = getDropIndex(cardsContainer, e.clientX, e.clientY);
				callbacks.onMoveCard(state.draggingCardId, targetColumn, targetIndex);
			} else {
				const targetIndex = getDropIndex(cardsContainer as HTMLElement, e.clientX, e.clientY);
				callbacks.onMoveCard(state.draggingCardId, targetColumn, targetIndex);
			}
			removeDropIndicator(state);
		};

		colEl.addEventListener('dragover', onDragOver);
		colEl.addEventListener('dragleave', onDragLeave);
		colEl.addEventListener('drop', onDrop);
		cleanupFns.push(() => {
			colEl.removeEventListener('dragover', onDragOver);
			colEl.removeEventListener('dragleave', onDragLeave);
			colEl.removeEventListener('drop', onDrop);
		});
	});
}

function getDropIndex(container: HTMLElement, clientX: number, clientY: number): number {
	const cards = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-card:not(.dashboard-card--dragging)'));
	if (cards.length === 0) return 0;

	for (let i = 0; i < cards.length; i++) {
		const rect = cards[i]!.getBoundingClientRect();
		if (clientY < rect.top || (clientY < rect.bottom && clientX < rect.left + rect.width / 2)) {
			return i;
		}
	}

	return cards.length;
}

function updateDropIndicator(state: DnDState, column: HTMLElement, clientX: number, clientY: number): void {
	removeDropIndicator(state);

	const cardsContainer = column.querySelector('.dashboard-section-cards');
	if (!cardsContainer) return;

	const cards = Array.from(cardsContainer.querySelectorAll<HTMLElement>('.dashboard-card:not(.dashboard-card--dragging)'));
	const indicator = createDiv();
	indicator.addClass('dashboard-drop-indicator');
	state.dropIndicator = indicator;

	if (cards.length === 0) {
		cardsContainer.appendChild(indicator);
		return;
	}

	const idx = getDropIndex(cardsContainer as HTMLElement, clientX, clientY);
	if (idx < cards.length) {
		cardsContainer.insertBefore(indicator, cards[idx]!);
	} else {
		cardsContainer.appendChild(indicator);
	}
}

function removeDropIndicator(state: DnDState): void {
	if (state.dropIndicator?.parentNode) {
		state.dropIndicator.parentNode.removeChild(state.dropIndicator);
	}
	state.dropIndicator = null;
}

function clearAllDragOver(): void {
	activeDocument.querySelectorAll('.dashboard-section-row--drag-over').forEach((el) => {
		(el as HTMLElement).removeClass('dashboard-section-row--drag-over');
	});
}

function clearAllSectionDragOver(): void {
	activeDocument.querySelectorAll('.dashboard-section-row--section-drag-over').forEach((el) => {
		(el as HTMLElement).removeClass('dashboard-section-row--section-drag-over');
	});
}

function isPointInTopHalf(row: HTMLElement, clientY: number): boolean {
	const rect = row.getBoundingClientRect();
	return clientY < rect.top + rect.height / 2;
}

/** Side drop zones occupy the left/right edge strips of a section row; the
 *  middle band keeps the familiar top-half/bottom-half before/after split.
 *  Always active — dropping beside an already-paired section evicts its
 *  ex-partner to a full-width row (decided in the sync layer; dnd stays
 *  pairing-agnostic). */
const SECTION_SIDE_ZONE = 0.25;

type SectionDropZone = 'before' | 'after' | 'left' | 'right';

function getSectionDropZone(row: HTMLElement, clientX: number, clientY: number): SectionDropZone {
	const rect = row.getBoundingClientRect();
	const xRatio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
	if (xRatio <= SECTION_SIDE_ZONE) return 'left';
	if (xRatio >= 1 - SECTION_SIDE_ZONE) return 'right';
	return isPointInTopHalf(row, clientY) ? 'before' : 'after';
}

/** Highlight the hovered section row edge (top/bottom for vertical inserts,
 *  left/right for pairing) where the drag will land. */
function updateSectionDropIndicator(state: DnDState, _container: HTMLElement, row: HTMLElement, clientX: number, clientY: number): void {
	clearAllSectionDragOver();
	if (state.sectionDragSource?.row === row) return;
	row.addClass('dashboard-section-row--section-drag-over');
	row.dataset.sectionDropPos = getSectionDropZone(row, clientX, clientY);
}

function removeSectionDropIndicator(_state: DnDState): void {
	activeDocument.querySelectorAll('.dashboard-section-row--section-drag-over').forEach((el) => {
		(el as HTMLElement).removeClass('dashboard-section-row--section-drag-over');
	});
}

function setupTouchDrag(
	state: DnDState,
	cardEl: HTMLElement,
	cardId: string,
	_sourceColumn: string,
	container: HTMLElement,
	callbacks: RenderCallbacks,
	cleanupFns: Array<() => void>,
): void {
	let ghost: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let isDragging = false;
	const LONG_PRESS_MS = 200;
	let timer: number | null = null;

	const onTouchStart = (e: TouchEvent) => {
		const t = e.touches[0];
		if (!t) return;

		const target = e.target as HTMLElement;
		if (!target.closest('.dashboard-card-header, .dashboard-project-cover')) return;

		startX = t.clientX;
		startY = t.clientY;
		isDragging = false;

		timer = window.setTimeout(() => {
			isDragging = true;
			ghost = createGhost(cardEl, startX, startY);
			cardEl.addClass('dashboard-card--dragging');
		}, LONG_PRESS_MS);
	};

	const onTouchMove = (e: TouchEvent) => {
		if (!isDragging) {
			if (timer) {
				const t = e.touches[0];
				if (!t) return;
				if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
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

		const targetCol = findColumnAtPoint(container, t.clientX, t.clientY);
		clearAllDragOver();
		if (targetCol) {
			targetCol.addClass('dashboard-section-row--drag-over');
		}
	};

	const cleanupDrag = (): void => {
		if (ghost) {
			ghost.remove();
			ghost = null;
		}
		cardEl.removeClass('dashboard-card--dragging');
		clearAllDragOver();
		isDragging = false;
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
		const targetCol = findColumnAtPoint(container, t.clientX, t.clientY);

		if (targetCol && targetCol.dataset.column) {
			const cardsContainer = targetCol.querySelector('.dashboard-section-cards');
			const targetIndex = cardsContainer ? getDropIndex(cardsContainer as HTMLElement, t.clientX, t.clientY) : 0;
			callbacks.onMoveCard(cardId, targetCol.dataset.column, targetIndex);
		}
	};

	// touchcancel fires on system interruptions (edge gestures, scroll hijack,
	// notifications) instead of touchend. The ghost clone is appended to
	// activeDocument.body, invisible to container re-renders, so without this handler
	// it would strand on screen as a permanent text afterimage.
	const onTouchCancel = () => {
		if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}
		cleanupDrag();
	};

	cardEl.addEventListener('touchstart', onTouchStart, { passive: true });
	cardEl.addEventListener('touchmove', onTouchMove, { passive: false });
	cardEl.addEventListener('touchend', onTouchEnd, { passive: true });
	cardEl.addEventListener('touchcancel', onTouchCancel, { passive: true });

	cleanupFns.push(() => {
		cardEl.removeEventListener('touchstart', onTouchStart);
		cardEl.removeEventListener('touchmove', onTouchMove);
		cardEl.removeEventListener('touchend', onTouchEnd);
		cardEl.removeEventListener('touchcancel', onTouchCancel);
	});
}

function createGhost(cardEl: HTMLElement, x: number, y: number): HTMLElement {
	const ghost = cardEl.cloneNode(true) as HTMLElement;
	ghost.removeAttribute('draggable');
	ghost.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));
	ghost.addClass('dashboard-card--ghost');
	ghost.setCssProps({
		position: 'fixed',
		width: `${cardEl.offsetWidth}px`,
		left: `${x - cardEl.offsetWidth / 2}px`,
		top: `${y - cardEl.offsetHeight / 2}px`,
		zIndex: '9999',
		pointerEvents: 'none',
		opacity: '0.85',
		transform: 'rotate(3deg)',
	});
	activeDocument.body.appendChild(ghost);
	return ghost;
}

function findColumnAtPoint(container: HTMLElement, x: number, y: number): HTMLElement | null {
	const columns = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-section-row'));
	for (const col of columns) {
		const rect = col.getBoundingClientRect();
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
			return col;
		}
	}
	return null;
}

function setupExternalFileDrop(
	cardEl: HTMLElement,
	cardId: string,
	state: DnDState,
	callbacks: RenderCallbacks,
	cleanupFns: Array<() => void>,
): void {
	let hasFileDropClass = false;

	const onFileDragOver = (e: DragEvent) => {
		if (state.draggingCardId) return;
		if (!e.dataTransfer) return;
		// Library kanban card drag: not an OS/Obsidian file drop — skip the
		// file-drop highlight (the link/move effect mismatch already blocks
		// the drop itself).
		if (e.dataTransfer.types.includes(KANBAN_FILE_DRAG_TYPE)) return;
		// In-card item drag (task/doc): also not a file drop. Must bail BEFORE
		// setting dropEffect='link' — the link/move mismatch makes the browser
		// forbid the drop, which is exactly what made empty cards undroppable.
		if (e.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return;

		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'link';
		if (!hasFileDropClass) {
			cardEl.addClass('dashboard-card--file-drop');
			hasFileDropClass = true;
		}
	};

	const onFileDragLeave = (e: DragEvent) => {
		if (state.draggingCardId || !hasFileDropClass) return;

		const rect = cardEl.getBoundingClientRect();
		if (
			e.clientX < rect.left || e.clientX > rect.right ||
			e.clientY < rect.top || e.clientY > rect.bottom
		) {
			cardEl.removeClass('dashboard-card--file-drop');
			hasFileDropClass = false;
		}
	};

	const onFileDrop = (e: DragEvent) => {
		hasFileDropClass = false;
		cardEl.removeClass('dashboard-card--file-drop');
		if (state.draggingCardId) return;
		if (!e.dataTransfer) return;
		// Library kanban card drag never carries a vault-explorer file payload.
		if (e.dataTransfer.types.includes(KANBAN_FILE_DRAG_TYPE)) return;
		// In-card item drag: its text/plain payload is a JSON path, not a file.
		if (e.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return;

		e.preventDefault();
		e.stopPropagation();

		const filePath = extractObsidianFilePath(e.dataTransfer);
		if (filePath) {
			callbacks.onFileDrop(cardId, filePath);
		}
	};

	const onAnyDragEnd = () => {
		if (!hasFileDropClass) return;
		cardEl.removeClass('dashboard-card--file-drop');
		hasFileDropClass = false;
	};

	cardEl.addEventListener('dragover', onFileDragOver);
	cardEl.addEventListener('dragleave', onFileDragLeave);
	cardEl.addEventListener('drop', onFileDrop);
	activeDocument.addEventListener('dragend', onAnyDragEnd);

	cleanupFns.push(() => {
		cardEl.removeEventListener('dragover', onFileDragOver);
		cardEl.removeEventListener('dragleave', onFileDragLeave);
		cardEl.removeEventListener('drop', onFileDrop);
		activeDocument.removeEventListener('dragend', onAnyDragEnd);
	});
}

function extractObsidianFilePath(dataTransfer: DataTransfer): string | null {
	const text = dataTransfer.getData('text/plain');
	if (!text || text.trim().length === 0) return null;
	if (text.includes('\n')) return null;
	const trimmed = text.trim();

	// Obsidian file explorer drag sends an obsidian:// URI
	if (trimmed.startsWith('obsidian://')) {
		try {
			const url = new URL(trimmed);
			const file = url.searchParams.get('file');
			if (file) return decodeURIComponent(file);
		} catch {
			return null;
		}
	}

	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
	return trimmed;
}
