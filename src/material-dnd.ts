/**
 * Tile-to-folder drag moves for the material library (素材库).
 *
 * In the FOLDER grouping mode a group's key is a real vault path, so dropping
 * a tile onto another group is exactly "move this file into that folder"
 * (Rae). This module owns the DOM side only: dragging a tile seeds a custom
 * data type with the paths (all selected tiles when the source tile is part
 * of the selection), folder-group zones accept the drop with a move afford-
 * ance, and the actual rename lives in material-render's movePathsTo.
 *
 * The OS-file import wiring (material-drop.ts) listens on the same ancestor
 * but only reacts to drags carrying real files; the custom type here never
 * carries any, so the two never collide.
 */

import { t } from './i18n';
import type { MaterialGroupMode } from './material-model';

/** Data type marking an INTERNAL material drag (tile paths as JSON array). */
export const MATERIAL_MOVE_DRAG_TYPE = 'application/x-apex-material-paths';

const TILE_SELECTOR = '.dashboard-material-tile';
const ZONE_SELECTOR = '.dashboard-material-dropzone';

export interface MaterialMoveHooks {
	/** Persistent ancestor every tile and zone lives under — the listener host. */
	content: HTMLElement;
	/** Destination pill shared with the OS-file drop (text + visibility here). */
	hint: HTMLElement;
	/** Grouping mode right now — only 'folder' zones are legal move targets. */
	getGroupMode(): MaterialGroupMode;
	/** Whether the dragged tile is part of the active selection. */
	isSelected(path: string): boolean;
	/** Paths of the active selection (moved together when the source is in it). */
	getSelected(): readonly string[];
	/** Perform the move (material-render's movePathsTo) and re-render. */
	movePaths(paths: readonly string[], folder: string): void;
}

/** The minimal DataTransfer surface used here — the real thing in Obsidian, a
 *  plain recording object in tests. */
interface MoveDragTransfer {
	types: readonly string[];
	effectAllowed?: string;
	dropEffect?: string;
	setData(type: string, value: string): void;
	getData(type: string): string;
}

interface MoveDragEvent {
	target: EventTarget | null;
	dataTransfer?: MoveDragTransfer | null;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Folder-group zone under the pointer with a real key, or null. */
function folderZoneOf(ev: MoveDragEvent, isFolderMode: boolean): HTMLElement | null {
	if (!isFolderMode) return null;
	const el = ev.target as HTMLElement | null;
	if (!el || typeof el.closest !== 'function') return null;
	const zone = el.closest(ZONE_SELECTOR) as HTMLElement | null;
	if (!zone) return null;
	// '' means the bare results area (the OS-drop fallback) — not a folder.
	const key = zone.dataset.importKey;
	return typeof key === 'string' && key !== '' ? zone : null;
}

/** Short label for a root-qualified folder key: the sub folder's own name. */
function folderLabel(key: string): string {
	const name = key.slice(key.lastIndexOf('/') + 1);
	return name !== '' ? name : key;
}

/** Wire the internal drag listeners. Returns a teardown for the view. */
export function wireMaterialFolderMove(hooks: MaterialMoveHooks): () => void {
	const { content, hint } = hooks;
	let activeZone: HTMLElement | null = null;

	const markZone = (zone: HTMLElement | null, folder: string | null): void => {
		if (zone === activeZone && folder !== null) return;
		activeZone?.removeClass('is-move-active');
		activeZone = zone;
		activeZone?.addClass('is-move-active');
		if (folder !== null) {
			hint.textContent = t('material.moveHint', { folder });
			hint.removeClass('is-hidden');
		} else {
			hint.addClass('is-hidden');
		}
	};

	const clearChrome = (): void => {
		activeZone?.removeClass('is-move-active');
		activeZone = null;
		hint.addClass('is-hidden');
	};

	const isMoveDrag = (dt: MoveDragTransfer | null | undefined): boolean =>
		!!dt && dt.types.includes(MATERIAL_MOVE_DRAG_TYPE);

	const onDragStart = (e: Event): void => {
		const ev = e as unknown as MoveDragEvent;
		if (hooks.getGroupMode() !== 'folder') return;
		const el = ev.target as HTMLElement | null;
		const tile = el && typeof el.closest === 'function' ? (el.closest(TILE_SELECTOR) as HTMLElement | null) : null;
		if (!tile) return;
		const path = tile.dataset.materialPath;
		if (!path) return;
		const selected = hooks.getSelected();
		const paths = hooks.isSelected(path) && selected.length > 0 ? [...selected] : [path];
		const dt = ev.dataTransfer;
		if (!dt) return;
		dt.setData(MATERIAL_MOVE_DRAG_TYPE, JSON.stringify(paths));
		dt.effectAllowed = 'move';
		// Keep the OS-import wiring (and Obsidian) out of this drag.
		ev.stopPropagation();
	};

	const onDragOver = (e: Event): void => {
		const ev = e as unknown as MoveDragEvent;
		if (!isMoveDrag(ev.dataTransfer)) return;
		const zone = folderZoneOf(ev, hooks.getGroupMode() === 'folder');
		if (!zone) {
			markZone(null, null);
			return; // No preventDefault: the browser keeps rejecting the drop.
		}
		ev.preventDefault();
		if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
		markZone(zone, folderLabel(zone.dataset.importKey ?? ''));
	};

	const onDrop = (e: Event): void => {
		const ev = e as unknown as MoveDragEvent;
		if (!isMoveDrag(ev.dataTransfer)) return;
		const zone = folderZoneOf(ev, hooks.getGroupMode() === 'folder');
		clearChrome();
		if (!zone || !ev.dataTransfer) return;
		ev.preventDefault();
		ev.stopPropagation();
		let paths: string[] = [];
		try {
			const parsed: unknown = JSON.parse(ev.dataTransfer.getData(MATERIAL_MOVE_DRAG_TYPE));
			if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === 'string');
		} catch { paths = []; }
		const folder = zone.dataset.importKey;
		if (paths.length === 0 || typeof folder !== 'string' || folder === '') return;
		hooks.movePaths(paths, folder);
	};

	const onDragEnd = (): void => {
		// Fires on the source tile after a drop OR a cancelled drag (Esc /
		// released outside). dragend carries no data in some engines, so this
		// clears unconditionally — clearing only ever removes a highlight.
		clearChrome();
	};

	content.addEventListener('dragstart', onDragStart);
	content.addEventListener('dragover', onDragOver);
	content.addEventListener('drop', onDrop);
	content.addEventListener('dragend', onDragEnd);
	return () => {
		clearChrome();
		content.removeEventListener('dragstart', onDragStart);
		content.removeEventListener('dragover', onDragOver);
		content.removeEventListener('drop', onDrop);
		content.removeEventListener('dragend', onDragEnd);
	};
}
