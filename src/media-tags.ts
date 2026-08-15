import type { App, TFile } from 'obsidian';
import type DashboardPlugin from './main';

/** Max tags per media file — keeps the per-file chip UI readable. */
export const MEDIA_TAG_MAX_PER_FILE = 10;
/** Max characters per tag. */
export const MEDIA_TAG_MAX_LEN = 40;

/** Normalize a tag list: trim, drop empty/overlong entries, dedupe, sort. */
export function normalizeTags(tags: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const raw of tags) {
		if (typeof raw !== 'string') continue;
		const tag = raw.trim();
		if (!tag || tag.length > MEDIA_TAG_MAX_LEN) continue;
		seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Sanitize the raw mediaTags value loaded from data.json into a plain
 *  Record<path, string[]>; anything malformed is dropped. */
export function sanitizeMediaTags(raw: unknown): Record<string, string[]> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, string[]> = {};
	for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(value)) continue;
		const tags = normalizeTags(value.filter((v): v is string => typeof v === 'string'));
		if (tags.length > 0) out[path] = tags;
	}
	return out;
}

/**
 * Owns the media tag store (settings.mediaTags: Record<path, string[]>).
 * Writes go through a 400ms debounce so batch tagging produces a single
 * data.json write; vault rename/delete events keep the path keys in sync.
 */
export class MediaTagService {
	private plugin: DashboardPlugin;
	private data: Record<string, string[]> = {};
	private saveTimer: number | null = null;
	private readonly debounceMs = 400;
	private renameRef: ReturnType<App['vault']['on']> | null = null;
	private deleteRef: ReturnType<App['vault']['on']> | null = null;

	constructor(plugin: DashboardPlugin) {
		this.plugin = plugin;
		this.registerVaultEvents(plugin.app);
	}

	/** Read the (already sanitized) tags from plugin settings. */
	load(): void {
		this.data = sanitizeMediaTags(this.plugin.settings.mediaTags);
		this.plugin.settings.mediaTags = this.data;
	}

	/** Flush any pending write and detach vault listeners. */
	destroy(): void {
		this.flush();
		if (this.renameRef !== null) this.plugin.app.vault.offref(this.renameRef);
		if (this.deleteRef !== null) this.plugin.app.vault.offref(this.deleteRef);
		this.renameRef = null;
		this.deleteRef = null;
	}

	getTags(path: string): string[] {
		return this.data[path] ?? [];
	}

	/** Union of all tags in use across media files, sorted and deduped. */
	getAllTags(): string[] {
		const seen = new Set<string>();
		for (const tags of Object.values(this.data)) {
			for (const tag of tags) seen.add(tag);
		}
		return [...seen].sort((a, b) => a.localeCompare(b));
	}

	/** Set the tag list for one file. Returns true when anything changed. */
	setTags(path: string, tags: readonly string[]): boolean {
		const next = normalizeTags(tags).slice(0, MEDIA_TAG_MAX_PER_FILE);
		const prev = this.data[path];
		const same = prev !== undefined
			&& prev.length === next.length
			&& prev.every((t, i) => t === next[i]);
		if (same) return false;
		if (next.length === 0) delete this.data[path];
		else this.data[path] = next;
		this.plugin.settings.mediaTags = this.data;
		this.scheduleSave();
		return true;
	}

	/** Debounced persist: consecutive tag edits within the window coalesce
	 *  into one data.json write. */
	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveSettings();
		}, this.debounceMs);
	}

	/** Persist immediately (used on unload). */
	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			await this.plugin.saveSettings();
		}
	}

	/** Re-key on rename/move, prune on delete, debounced save. */
	private registerVaultEvents(app: App): void {
		this.renameRef = app.vault.on('rename', (file: TFile, oldPath: string) => {
			const tags = this.data[oldPath];
			if (!tags) return;
			delete this.data[oldPath];
			this.data[file.path] = tags;
			this.plugin.settings.mediaTags = this.data;
			this.scheduleSave();
		});
		this.deleteRef = app.vault.on('delete', (file: TFile) => {
			if (!this.data[file.path]) return;
			delete this.data[file.path];
			this.plugin.settings.mediaTags = this.data;
			this.scheduleSave();
		});
	}
}
