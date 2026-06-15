import type { RenderCallbacks } from './types';

interface DnDState {
	draggingCardId: string | null;
	draggingElement: HTMLElement | null;
	sourceColumn: string | null;
	dropIndicator: HTMLElement | null;
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
	};

	const columns = container.querySelectorAll('.dashboard-section-row');

	columns.forEach((col) => {
		const colEl = col as HTMLElement;
		const columnName = colEl.dataset.column ?? '';

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
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			colEl.addClass('dashboard-section-row--drag-over');
			updateDropIndicator(state, colEl, e.clientX, e.clientY);
		};

		const onDragLeave = (e: DragEvent) => {
			const rect = col.getBoundingClientRect();
			if (
				e.clientX < rect.left || e.clientX > rect.right ||
				e.clientY < rect.top || e.clientY > rect.bottom
			) {
				colEl.removeClass('dashboard-section-row--drag-over');
				removeDropIndicator(state);
			}
		};

		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			colEl.removeClass('dashboard-section-row--drag-over');

			if (!state.draggingCardId) return;

			const cardsContainer = colEl.querySelector('.dashboard-section-cards');
			if (!cardsContainer) return;


			const targetColumn = colEl.dataset.column ?? '';

			if (colEl.dataset.sectionType === 'dashboard' && cardsContainer instanceof HTMLElement) {
				const targetIndex = getDropIndex(cardsContainer, e.clientX, e.clientY);
				callbacks.onMoveCard(state.draggingCardId, targetColumn, targetIndex);
			} else {
				const targetIndex = getDropIndex(cardsContainer as HTMLElement, e.clientX, e.clientY);
				callbacks.onMoveCard(state.draggingCardId, targetColumn, targetIndex);
			}
			removeDropIndicator(state);
		};

		col.addEventListener('dragover', onDragOver);
		col.addEventListener('dragleave', onDragLeave);
		col.addEventListener('drop', onDrop);
		cleanupFns.push(() => {
			col.removeEventListener('dragover', onDragOver);
			col.removeEventListener('dragleave', onDragLeave);
			col.removeEventListener('drop', onDrop);
		});
	});
}

function getDropIndex(container: HTMLElement, clientX: number, clientY: number): number {
	const cards = Array.from(container.querySelectorAll('.dashboard-card:not(.dashboard-card--dragging)')) as HTMLElement[];
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

	const cards = Array.from(cardsContainer.querySelectorAll('.dashboard-card:not(.dashboard-card--dragging)')) as HTMLElement[];
	const indicator = document.createElement('div');
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
	document.querySelectorAll('.dashboard-section-row--drag-over').forEach((el) => {
		(el as HTMLElement).removeClass('dashboard-section-row--drag-over');
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
	let timer: ReturnType<typeof setTimeout> | null = null;

	const onTouchStart = (e: TouchEvent) => {
		const t = e.touches[0];
		if (!t) return;

		const target = e.target as HTMLElement;
		if (!target.closest('.dashboard-card-header, .dashboard-project-cover')) return;

		startX = t.clientX;
		startY = t.clientY;
		isDragging = false;

		timer = setTimeout(() => {
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
					clearTimeout(timer);
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
			clearTimeout(timer);
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
	// document.body, invisible to container re-renders, so without this handler
	// it would strand on screen as a permanent text afterimage.
	const onTouchCancel = () => {
		if (timer) {
			clearTimeout(timer);
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
	ghost.style.position = 'fixed';
	ghost.style.width = `${cardEl.offsetWidth}px`;
	ghost.style.left = `${x - cardEl.offsetWidth / 2}px`;
	ghost.style.top = `${y - cardEl.offsetHeight / 2}px`;
	ghost.style.zIndex = '9999';
	ghost.style.pointerEvents = 'none';
	ghost.style.opacity = '0.85';
	ghost.style.transform = 'rotate(3deg)';
	document.body.appendChild(ghost);
	return ghost;
}

function findColumnAtPoint(container: HTMLElement, x: number, y: number): HTMLElement | null {
	const columns = Array.from(container.querySelectorAll('.dashboard-section-row')) as HTMLElement[];
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
	document.addEventListener('dragend', onAnyDragEnd);

	cleanupFns.push(() => {
		cardEl.removeEventListener('dragover', onFileDragOver);
		cardEl.removeEventListener('dragleave', onFileDragLeave);
		cardEl.removeEventListener('drop', onFileDrop);
		document.removeEventListener('dragend', onAnyDragEnd);
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
