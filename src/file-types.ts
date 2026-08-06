/**
 * Centralised file-type knowledge for the dashboard.
 *
 * Every place that filters "supported" vault files or picks an icon for one
 * should go through these helpers so a new format (canvas, base, audio, ...)
 * only needs to be added once.
 */

/** Every file extension the dashboard recognises for browsing, linking, and
 *  attaching to cards. Kept as a lowercased set; lookups are case-insensitive. */
export const SUPPORTED_FILE_EXTS: ReadonlySet<string> = new Set([
	// Notes & documents
	'md', 'pdf',
	// Obsidian rich formats
	'canvas', 'base',
	// Images
	'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp',
	// Audio
	'mp3', 'wav', 'ogg', 'm4a', 'flac',
	// Video
	'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v',
]);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);

export type FileKind = 'note' | 'canvas' | 'base' | 'pdf' | 'image' | 'audio' | 'video' | 'other';

/** Coarse classification of a file by its extension. */
export function fileKind(extension: string): FileKind {
	const ext = extension.toLowerCase();
	if (ext === 'md') return 'note';
	if (ext === 'canvas') return 'canvas';
	if (ext === 'base') return 'base';
	if (ext === 'pdf') return 'pdf';
	if (IMAGE_EXTS.has(ext)) return 'image';
	if (AUDIO_EXTS.has(ext)) return 'audio';
	if (VIDEO_EXTS.has(ext)) return 'video';
	return 'other';
}

/** True for formats that can only be viewed in a dedicated Obsidian view
 *  (canvas/base/pdf), never the in-dashboard markdown popover. */
export function isOpenableInPopover(extension: string): boolean {
	return extension.toLowerCase() === 'md';
}

/**
 * Pick a Lucide icon name for a file extension. Returns a name that exists in
 * the Lucide set Obsidian ships, so it can be passed straight to `setIcon`.
 */
export function iconForExtension(extension: string): string {
	switch (fileKind(extension)) {
		case 'note':
		case 'pdf':
			return 'file-text';
		case 'canvas':
			return 'layout-dashboard';
		case 'base':
			return 'database';
		case 'image':
			return 'image';
		case 'audio':
			return 'music';
		case 'video':
			return 'film';
		default:
			return 'file';
	}
}

/** True if the dashboard recognises this extension at all. */
export function isSupportedExtension(extension: string): boolean {
	return SUPPORTED_FILE_EXTS.has(extension.toLowerCase());
}
