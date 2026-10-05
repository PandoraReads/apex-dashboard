import type { App } from 'obsidian';
import { setIcon } from 'obsidian';
import { t } from './i18n';
import { resolveVaultImage } from './banner';

/** Parse a persisted focal point ("x,y", 0-100 integers; a hand-edited
 *  value may stray — signs are accepted and clamped into range). Invalid
 *  input yields undefined. */
export function parseFocalPoint(raw: string | undefined): { x: number; y: number } | undefined {
	if (!raw) return undefined;
	const m = /^([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})$/.exec(raw.trim());
	if (!m) return undefined;
	const x = Math.min(100, Math.max(0, parseInt(m[1]!, 10)));
	const y = Math.min(100, Math.max(0, parseInt(m[2]!, 10)));
	return { x, y };
}

/** Serialize a focal point for the dashboard file ("x,y"). */
export function formatFocalPoint(pos: { x: number; y: number }): string {
	return `${Math.round(pos.x)},${Math.round(pos.y)}`;
}

/** background-position value for a focal point (cover sizing maps the
 *  percentages onto the visible crop directly). */
export function focalToBackgroundPosition(pos: { x: number; y: number }): string {
	return `${Math.round(pos.x)}% ${Math.round(pos.y)}%`;
}

/** Is this the neutral center that needs no persisted entry? */
export function isCenterFocal(pos: { x: number; y: number }): boolean {
	return Math.round(pos.x) === 50 && Math.round(pos.y) === 50;
}

const CENTER: { x: number; y: number } = { x: 50, y: 50 };

/**
 * Shared focal-point picker for the banner and card-cover config modals
 * (方案 B: adjust inside the modal, not on the live surface). A preview box
 * at the target's approximate aspect ratio shows the image with cover
 * cropping; dragging inside it (mouse or touch, via pointer events) moves
 * the focal point live — exactly what `background-position` will render.
 * A reset button returns to center.
 *
 * State is owned by the caller: the picker reports every change through
 * `onChange` and exposes `setPath` so typing a new path in the input row
 * updates the preview without recreating the widget.
 */
export class FocalPointPicker {
	private pos: { x: number; y: number };
	private readonly box: HTMLElement;
	private readonly marker: HTMLElement;

	constructor(
		private readonly app: App,
		host: HTMLElement,
		opts: {
			path: string;
			/** Preview aspect ratio (width/height) approximating the real
			 *  surface — banner ≈ 6, card cover ≈ 3. Cosmetic only: the
			 *  percentage semantics carry to any real ratio. */
			ratio?: number;
			value?: { x: number; y: number };
			onChange: (pos: { x: number; y: number }) => void;
			/** Optional destructive action rendered as a second button
			 *  directly BELOW the reset button (e.g. the banner editor's
			 *  per-image delete). */
			deleteAction?: { label: string; onDelete: () => void };
		},
	) {
		this.pos = { ...(opts.value ?? CENTER) };

		const wrap = host.createDiv({ cls: 'dashboard-focal-picker' });
		this.box = wrap.createDiv({ cls: 'dashboard-focal-picker-box' });
		this.box.style.aspectRatio = String(opts.ratio ?? 3);
		this.box.title = t('focal.hint');
		this.marker = this.box.createDiv({ cls: 'dashboard-focal-picker-marker' });
		// Reset (and optionally delete) stack vertically beside the preview.
		const actions = wrap.createDiv({ cls: 'dashboard-focal-picker-actions' });
		const resetBtn = actions.createEl('button', {
			cls: 'dashboard-focal-picker-reset',
			attr: { 'aria-label': t('focal.reset') },
		});
		resetBtn.title = t('focal.reset');
		setIcon(resetBtn, 'locate-fixed');
		resetBtn.addEventListener('click', () => {
			this.pos = { ...CENTER };
			this.paint();
			opts.onChange({ ...this.pos });
		});
		if (opts.deleteAction) {
			const delBtn = actions.createEl('button', {
				cls: 'dashboard-focal-picker-delete',
				attr: { 'aria-label': opts.deleteAction.label },
			});
			delBtn.title = opts.deleteAction.label;
			setIcon(delBtn, 'trash-2');
			delBtn.addEventListener('click', () => opts.deleteAction!.onDelete());
		}

		this.setPath(opts.path);
		this.paint();

		this.box.addEventListener('pointerdown', (e: PointerEvent) => {
			if (this.box.hasClass('dashboard-focal-picker-box--empty')) return;
			e.preventDefault();
			this.box.setPointerCapture(e.pointerId);
			this.box.addClass('dashboard-focal-picker-box--dragging');
			this.applyFromPointer(e, opts.onChange);
		});
		this.box.addEventListener('pointermove', (e: PointerEvent) => {
			if (!this.box.hasClass('dashboard-focal-picker-box--dragging')) return;
			this.applyFromPointer(e, opts.onChange);
		});
		const endDrag = (e: PointerEvent): void => {
			if (!this.box.hasClass('dashboard-focal-picker-box--dragging')) return;
			this.box.releasePointerCapture(e.pointerId);
			this.box.removeClass('dashboard-focal-picker-box--dragging');
		};
		this.box.addEventListener('pointerup', endDrag);
		this.box.addEventListener('pointercancel', endDrag);
	}

	/** Point the preview at a different image (path typed/edited in the row). */
	setPath(path: string): void {
		const resolved = path.trim() ? resolveVaultImage(this.app, path.trim()) : null;
		if (resolved) {
			this.box.style.backgroundImage = `url("${resolved}")`;
			this.box.removeClass('dashboard-focal-picker-box--empty');
		} else {
			this.box.style.removeProperty('background-image');
			this.box.addClass('dashboard-focal-picker-box--empty');
		}
	}

	private applyFromPointer(e: PointerEvent, onChange: (pos: { x: number; y: number }) => void): void {
		const rect = this.box.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
		const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
		this.pos = { x, y };
		this.paint();
		onChange({ ...this.pos });
	}

	/** Current focal point → preview background-position + crosshair spot. */
	private paint(): void {
		this.box.style.backgroundPosition = focalToBackgroundPosition(this.pos);
		this.marker.style.left = `${Math.round(this.pos.x)}%`;
		this.marker.style.top = `${Math.round(this.pos.y)}%`;
	}
}
