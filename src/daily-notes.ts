import { App, TFile, moment } from 'obsidian';

interface DailyNotesOptions {
	folder?: string;
	format?: string;
	template?: string;
}

interface DailyNotesPlugin {
	enabled?: boolean;
	instance?: { options?: DailyNotesOptions };
}

/** Read the core "Daily notes" plugin's options (folder / format / template).
 *  Returns null when the core plugin is disabled. */
function getDailyNotesOptions(app: App): DailyNotesOptions | null {
	const internalPlugins = (app as unknown as {
		internalPlugins?: { getPluginById?: (id: string) => DailyNotesPlugin | undefined };
	}).internalPlugins;
	const plugin = internalPlugins?.getPluginById?.('daily-notes');
	if (!plugin?.enabled) return null;
	return plugin.instance?.options ?? null;
}

/** Ensure a vault folder path exists, creating intermediate folders as needed. */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const adapter = app.vault.adapter;
	const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
}

/** Vault path of the daily note for the given `YYYY-MM-DD` iso date, computed
 *  from the core Daily Notes plugin's folder + format. Null if it is disabled. */
export function dailyNotePathFor(app: App, iso: string): string | null {
	const opts = getDailyNotesOptions(app);
	if (!opts) return null;
	const format = opts.format || 'YYYY-MM-DD';
	const base = moment(iso).format(format);
	const folder = (opts.folder || '').trim().replace(/^\/+|\/+$/g, '');
	return folder ? `${folder}/${base}.md` : `${base}.md`;
}

/**
 * Append a task line (e.g. `- [ ] Buy milk ⏰ 2026-06-27 14:00`) to the daily
 * note for `iso`. If the note does not exist yet, it is created in the core
 * Daily Notes plugin's folder, seeded with its template content (if any), so
 * Obsidian's daily-note path + template settings are honored.
 *
 * Returns the note's TFile, or null if the Daily Notes core plugin is disabled.
 */
export async function appendTaskToDailyNote(app: App, iso: string, taskLine: string): Promise<TFile | null> {
	const opts = getDailyNotesOptions(app);
	if (!opts) return null;
	const path = dailyNotePathFor(app, iso);
	if (!path) return null;

	const folder = (opts.folder || '').trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		const raw = await app.vault.read(existing);
		const sep = raw.endsWith('\n') ? '' : '\n';
		await app.vault.modify(existing, `${raw}${sep}${taskLine}\n`);
		return existing;
	}

	// Create with the Daily Notes template content (if configured), else empty.
	let content = '';
	const tplPath = (opts.template || '').trim();
	if (tplPath) {
		let tplFile = app.vault.getAbstractFileByPath(tplPath);
		if (!(tplFile instanceof TFile) && !tplPath.endsWith('.md')) {
			tplFile = app.vault.getAbstractFileByPath(`${tplPath}.md`);
		}
		if (tplFile instanceof TFile) {
			try { content = await app.vault.read(tplFile); } catch { /* ignore */ }
		}
	}
	if (content && !content.endsWith('\n')) content += '\n';
	content += `${taskLine}\n`;
	return await app.vault.create(path, content);
}
