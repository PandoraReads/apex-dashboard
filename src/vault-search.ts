import { App, TFile } from 'obsidian';
import { SUPPORTED_FILE_EXTS } from './file-types';

/**
 * Substring vault-file search shared by the quick-note bar's search mode and
 * the file-search sidebar widget: hidden files excluded, supported extensions
 * only, path and basename matched case-insensitively. Shorter basenames sort
 * first so the top hit reads as the most direct match, and results are capped
 * at `limit` (the dropdown lists stay one-glance short).
 */
export function searchVaultFiles(app: App, query: string, limit = 10): TFile[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return app.vault
		.getFiles()
		.filter(f => !f.path.startsWith('.') && SUPPORTED_FILE_EXTS.has(f.extension))
		.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
		.sort((a, b) => a.basename.length - b.basename.length)
		.slice(0, limit);
}
