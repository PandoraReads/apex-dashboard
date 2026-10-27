/**
 * OS file-drop wiring for the material library (素材库).
 *
 * Dragging an image or video in from anywhere else on the computer copies it
 * into the vault (Rae). The rules and the copy itself live in
 * material-import.ts; this module owns the DOM side: which element is a drop
 * zone, the drag-in chrome (hint pill + outlines) and the post-import notice.
 *
 * Zones are marked by the renderer with `.dashboard-material-dropzone` plus a
 * `data-import-key` (the group key); the bare results area carries the class
 * with no key and is therefore the fallback destination. Listeners are
 * registered ONCE on a persistent ancestor, so a re-render that rebuilds every
 * zone can never leave a stale handler behind.
 */

import { App, Notice } from 'obsidian';
import { t } from './i18n';
import {
	attachmentFolderOf,
	describeImportResult,
	importDroppedFiles,
	importFolderLabel,
	resolveImportTarget,
	type ImportableFile,
	type ImportTagSink,
	type ImportTarget,
} from './material-import';
import type { MaterialGroupMode } from './material-model';

/** Drop-zone marker class shared with the renderer and styles.css. */
export const MATERIAL_DROPZONE_CLASS = 'dashboard-material-dropzone';
const ZONE_SELECTOR = `.${MATERIAL_DROPZONE_CLASS}`;

export interface MaterialDropHooks {
	app: App;
	/** Persistent ancestor every zone lives under — the listener host. */
	content: HTMLElement;
	/** Destination hint pill (text set here, visibility toggled here). */
	hint: HTMLElement;
	tagStore: ImportTagSink | null;
	/** Grouping mode right now (the toolbar can change it between renders). */
	getGroupMode(): MaterialGroupMode;
	/** Configured default destination ('' = Obsidian's attachment folder). */
	getImportFolder(): string;
	/** Re-render after a drop so the copies show up immediately. */
	onImported(): void;
}

/** The minimal DataTransfer surface used here — the real thing in Obsidian, a
 *  plain object in tests. */
interface DragPayload {
	files?: ArrayLike<ImportableFile> | null;
	types?: readonly string[] | null;
	dropEffect?: string;
}

interface DragLikeEvent {
	target?: EventTarget | null;
	dataTransfer?: DragPayload | null;
	preventDefault(): void;
	stopPropagation(): void;
}

/** A drag carrying OS files (Electron exposes the real File list even before
 *  the drop; a text/URI drag must not be hijacked). */
function isFileDrag(ev: DragLikeEvent): boolean {
	const dt = ev.dataTransfer;
	if (!dt) return false;
	if (filesOf(dt).length > 0) return true;
	return Array.from(dt.types ?? []).includes('Files');
}

function filesOf(dt: DragPayload): ImportableFile[] {
	const list = dt.files;
	const out: ImportableFile[] = [];
	for (let i = 0; i < (list?.length ?? 0); i++) {
		const file = list?.[i];
		if (file) out.push(file);
	}
	return out;
}

/** The innermost drop zone under the pointer, or null outside any zone. */
function zoneOf(target: EventTarget | null | undefined): HTMLElement | null {
	const el = target as HTMLElement | null;
	if (!el || typeof el.closest !== 'function') return null;
	return el.closest(ZONE_SELECTOR) as HTMLElement | null;
}

/** Where a drop on `target` would land, per the current grouping mode. */
export function dropTargetFor(
	target: EventTarget | null | undefined,
	opts: { groupMode: MaterialGroupMode; importFolder: string; app: App },
): ImportTarget {
	const zone = zoneOf(target);
	const key = zone?.dataset.importKey;
	return resolveImportTarget({
		groupMode: opts.groupMode,
		groupKey: typeof key === 'string' && key !== '' ? key : null,
		notSetLabel: t('library.notSet'),
		importFolder: opts.importFolder,
		attachmentFolder: attachmentFolderOf(opts.app),
	});
}

/** Wire the drag/drop listeners. Returns a teardown for the view's destroy. */
export function wireMaterialDrop(hooks: MaterialDropHooks): () => void {
	const { content, hint, app, tagStore } = hooks;
	let depth = 0;
	let activeZone: HTMLElement | null = null;

	const currentTarget = (ev: DragLikeEvent): ImportTarget =>
		dropTargetFor(ev.target, {
			groupMode: hooks.getGroupMode(),
			importFolder: hooks.getImportFolder(),
			app,
		});

	const updateHint = (ev: DragLikeEvent): void => {
		hint.textContent = t('material.dropHint', { folder: importFolderLabel(currentTarget(ev)) });
	};

	const markZone = (ev: DragLikeEvent): void => {
		const zone = zoneOf(ev.target);
		if (zone === activeZone) return;
		activeZone?.removeClass('is-drop-active');
		activeZone = zone;
		activeZone?.addClass('is-drop-active');
	};

	const clearState = (): void => {
		depth = 0;
		activeZone?.removeClass('is-drop-active');
		activeZone = null;
		content.removeClass('is-dragging-file');
		hint.addClass('is-hidden');
	};

	const onEnter = (e: Event): void => {
		const ev = e as unknown as DragLikeEvent;
		if (!isFileDrag(ev)) return;
		ev.preventDefault();
		depth++;
		content.addClass('is-dragging-file');
		hint.removeClass('is-hidden');
		updateHint(ev);
		markZone(ev);
	};

	const onOver = (e: Event): void => {
		const ev = e as unknown as DragLikeEvent;
		if (!isFileDrag(ev)) return;
		// preventDefault on dragover is what makes the browser hand us the drop
		// at all; dropEffect 'copy' gives the OS the copy cursor.
		ev.preventDefault();
		if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
		updateHint(ev);
		markZone(ev);
	};

	const onLeave = (e: Event): void => {
		if (!isFileDrag(e as unknown as DragLikeEvent)) return;
		// Depth-counted: crossing into a child fires its own leave/enter pair.
		depth = Math.max(0, depth - 1);
		if (depth === 0) clearState();
	};

	const onDrop = (e: Event): void => {
		const ev = e as unknown as DragLikeEvent;
		if (!isFileDrag(ev)) return;
		ev.preventDefault();
		// Keep Obsidian's own drop paths (file explorer, editor embeds) out of
		// this drop — the copy below is the only import that should happen.
		ev.stopPropagation();
		const files = filesOf(ev.dataTransfer ?? {});
		const target = currentTarget(ev);
		clearState();
		if (files.length === 0) return;
		void (async () => {
			const result = await importDroppedFiles(app, files, target, tagStore);
			const message = describeImportResult(result, target);
			if (message !== '') new Notice(message, 6000);
			hooks.onImported();
		})();
	};

	content.addEventListener('dragenter', onEnter);
	content.addEventListener('dragover', onOver);
	content.addEventListener('dragleave', onLeave);
	content.addEventListener('drop', onDrop);
	return () => {
		clearState();
		content.removeEventListener('dragenter', onEnter);
		content.removeEventListener('dragover', onOver);
		content.removeEventListener('dragleave', onLeave);
		content.removeEventListener('drop', onDrop);
	};
}
