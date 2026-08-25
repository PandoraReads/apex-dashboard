/** Normalize raw excluded-folder entries into comparable lowercase prefixes:
 *  trim, strip leading/trailing slashes, drop empties. Matching downstream is
 *  case-insensitive, so the whole set is lowercased once up front. */
export function normalizeExcludeFolders(folders: readonly string[]): string[] {
	return folders
		.map(f => f.trim().replace(/^\/+|\/+$/g, ''))
		.filter(f => f.length > 0)
		.map(f => f.toLowerCase());
}

/** True if a vault path equals or lives under one of the normalized excluded
 *  folders (path-prefix match, subfolders included). */
export function isUnderExcludedFolder(path: string, normalized: readonly string[]): boolean {
	if (normalized.length === 0) return false;
	const lower = path.toLowerCase();
	return normalized.some(f => lower === f || lower.startsWith(f + '/'));
}
