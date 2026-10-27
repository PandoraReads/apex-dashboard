/**
 * OS file drop → vault copy for the material library (素材库).
 *
 * Files dragged in from elsewhere on the computer arrive as DataTransfer File
 * objects — Electron hands over the real bytes, and the vault adapter cannot
 * read outside the vault, so the copy goes File → ArrayBuffer →
 * vault.createBinary.
 *
 * Destination rules (Rae):
 * - folder grouping: into the group's own folder (a folder group key is
 *   already a root-qualified vault path);
 * - tag grouping: into the configured default folder AND tagged with the
 *   group's tag;
 * - anything else (flat view, type groups, the not-set bucket): the
 *   configured default folder, falling back to Obsidian's attachment folder.
 *
 * The destination math and the outcome wording are pure so they are testable
 * without a DOM or a vault; only importDroppedFiles touches Obsidian.
 */

import { App } from 'obsidian';
import { ensureFolder } from './daily-notes';
import { sanitizeFilename, uniquePath } from './quick-note-section';
import { materialKindFor, normalizeImportFolder, type MaterialGroupMode } from './material-model';
import { t } from './i18n';

export { normalizeImportFolder };

/** Where one drop lands. `tag` empty = no tagging. */
export interface ImportTarget {
	/** Vault folder to copy into ('' = vault root). */
	folder: string;
	/** Tag to apply to every copied file (tag-group drops only). */
	tag: string;
}

/** The minimal File surface used here — a DOM File in Obsidian, a plain
 *  object in tests. */
export interface ImportableFile {
	name: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** Tag-store slice the importer needs (satisfied by MaterialTagStore). */
export interface ImportTagSink {
	getTags(path: string): string[];
	setTags(path: string, tags: readonly string[]): boolean;
}

export interface ImportFailure {
	name: string;
	message: string;
}

export interface ImportResult {
	/** Vault paths that were created. */
	imported: string[];
	/** Dropped names that are not image/video material. */
	skipped: string[];
	failed: ImportFailure[];
}

/** Obsidian's configured attachment folder, normalized ('' = vault root). */
export function attachmentFolderOf(app: App): string {
	const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
	const raw = typeof vault.getConfig === 'function' ? vault.getConfig('attachmentFolderPath') : '';
	return typeof raw === 'string' ? normalizeImportFolder(raw) : '';
}

/** Resolve the destination for a drop. `groupKey` is the drop zone's
 *  data-import-key (null when the drop did not land on a group); the not-set
 *  bucket is never a folder and never a tag. */
export function resolveImportTarget(opts: {
	groupMode: MaterialGroupMode;
	groupKey: string | null;
	notSetLabel: string;
	/** Configured default destination ('' = Obsidian's attachment folder). */
	importFolder: string;
	attachmentFolder: string;
}): ImportTarget {
	const fallback = normalizeImportFolder(opts.importFolder) || normalizeImportFolder(opts.attachmentFolder);
	const key = (opts.groupKey ?? '').trim();
	const isBucket = key === '' || key === opts.notSetLabel;
	if (isBucket) return { folder: fallback, tag: '' };
	if (opts.groupMode === 'folder') return { folder: normalizeImportFolder(key), tag: '' };
	if (opts.groupMode === 'tag') return { folder: fallback, tag: key };
	return { folder: fallback, tag: '' };
}

/** Only images and videos are library material; anything else is refused
 *  (a dropped note or PDF would tile as a coverless text file = invisible). */
export function isImportableName(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) return false;
	const kind = materialKindFor(name.slice(dot + 1).toLowerCase());
	return kind === 'image' || kind === 'video';
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** Copy dropped files into the vault and tag them. Per-file failures never
 *  abort the rest of the drop; a bad destination folder fails the whole batch
 *  (reported once). The folder is created lazily on the first real copy, so a
 *  drop with nothing importable leaves the vault untouched. Never throws. */
export async function importDroppedFiles(
	app: App,
	files: readonly ImportableFile[],
	target: ImportTarget,
	tagStore: ImportTagSink | null,
): Promise<ImportResult> {
	const imported: string[] = [];
	const skipped: string[] = [];
	const failed: ImportFailure[] = [];
	const folder = normalizeImportFolder(target.folder);
	let folderState: 'pending' | 'ready' | 'broken' = 'pending';
	const prepareFolder = async (): Promise<boolean> => {
		if (folderState !== 'pending') return folderState === 'ready';
		if (folder === '') { folderState = 'ready'; return true; }
		try {
			await ensureFolder(app, folder);
			folderState = 'ready';
		} catch (error) {
			folderState = 'broken';
			failed.push({ name: '', message: messageOf(error) });
		}
		return folderState === 'ready';
	};
	for (const file of files) {
		if (!isImportableName(file.name)) {
			skipped.push(file.name);
			continue;
		}
		if (!(await prepareFolder())) return { imported, skipped, failed };
		try {
			const bytes = await file.arrayBuffer();
			const name = sanitizeFilename(file.name) || file.name;
			const path = await uniquePath(app, folder === '' ? name : `${folder}/${name}`);
			await app.vault.createBinary(path, bytes);
			if (target.tag !== '' && tagStore) {
				const existing = tagStore.getTags(path);
				if (!existing.includes(target.tag)) tagStore.setTags(path, [...existing, target.tag]);
			}
			imported.push(path);
		} catch (error) {
			failed.push({ name: file.name, message: messageOf(error) });
		}
	}
	return { imported, skipped, failed };
}

/** Folder wording for the drop hint and the outcome notice. */
export function importFolderLabel(target: ImportTarget): string {
	return target.folder === '' ? t('material.dropVaultRoot') : target.folder;
}

/** One-line outcome for the notice: what landed, what was refused, what
 *  broke. Empty string when nothing happened at all. */
export function describeImportResult(result: ImportResult, target: ImportTarget): string {
	const lines: string[] = [];
	const folder = importFolderLabel(target);
	if (result.imported.length > 0) {
		lines.push(target.tag === ''
			? t('material.imported', { count: result.imported.length, folder })
			: t('material.importedWithTag', { count: result.imported.length, folder, tag: target.tag }));
	}
	if (result.skipped.length > 0) lines.push(t('material.dropSkipped', { count: result.skipped.length }));
	if (result.failed.length > 0) {
		lines.push(t('material.importFailed', { count: result.failed.length, error: result.failed[0]!.message }));
	}
	return lines.join('\n');
}
