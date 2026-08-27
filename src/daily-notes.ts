import { App, TFile } from 'obsidian';
import { MomentLike, momentOf, nowMoment } from './datetime';

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
 *  Returns null when the core plugin is disabled. Tries both access patterns
 *  (`getPluginById` and the `plugins` map) for resilience across versions. */
function getDailyNotesOptions(app: App): DailyNotesOptions | null {
	const internalPlugins = (app as unknown as {
		internalPlugins?: {
			getPluginById?: (id: string) => DailyNotesPlugin | undefined;
			plugins?: Record<string, DailyNotesPlugin>;
		};
	}).internalPlugins;
	if (!internalPlugins) return null;
	const plugin = internalPlugins.getPluginById?.('daily-notes') ?? internalPlugins.plugins?.['daily-notes'];
	if (!plugin?.enabled) return null;
	return plugin.instance?.options ?? null;
}

/** Folder + date format of the core Daily notes plugin, with leading/trailing
 *  slashes trimmed from the folder. Returns null when the core plugin is off. */
export interface DailyNotesConfig {
	folder: string;
	format: string;
}
export function getDailyNotesConfig(app: App): DailyNotesConfig | null {
	const opts = getDailyNotesOptions(app);
	if (!opts) return null;
	const folder = (opts.folder || '').trim().replace(/^\/+|\/+$/g, '');
	return { folder, format: opts.format || 'YYYY-MM-DD' };
}

/** Ensure a vault folder path exists, creating intermediate folders as needed. */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
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

/**
 * Substitute a basic subset of Obsidian's template variables in `content`,
 * using `now` (defaults to the current time). Supported: `{{date}}`,
 * `{{date:FORMAT}}`, `{{time}}`, `{{time:FORMAT}}`, and `{{title}}` (only when
 * a title is provided — otherwise left in place). Used by note creation from
 * user templates and by daily-note seeding.
 */
export function substituteTemplateVars(
	content: string,
	opts: { title?: string; now?: MomentLike } = {},
): string {
	const now = opts.now ?? nowMoment();
	let out = content;
	// Specific-format variants first so the bare regex doesn't shadow them.
	out = out.replace(/\{\{date:([^}]+)\}\}/g, (_m, fmt: string) => now.format(fmt));
	out = out.replace(/\{\{time:([^}]+)\}\}/g, (_m, fmt: string) => now.format(fmt));
	out = out.replace(/\{\{date\}\}/g, now.format('YYYY-MM-DD'));
	out = out.replace(/\{\{time\}\}/g, now.format('HH:mm'));
	if (opts.title != null) {
		out = out.replace(/\{\{title\}\}/g, opts.title);
	}
	return out;
}

/** Vault path of the daily note for the given `YYYY-MM-DD` iso date, computed
 *  from the core Daily Notes plugin's folder + format. Null if it is disabled. */
export function dailyNotePathFor(app: App, iso: string): string | null {
	const opts = getDailyNotesOptions(app);
	if (!opts) return null;
	const format = opts.format || 'YYYY-MM-DD';
	const base = momentOf(iso).format(format);
	const folder = (opts.folder || '').trim().replace(/^\/+|\/+$/g, '');
	return folder ? `${folder}/${base}.md` : `${base}.md`;
}

/** Read & var-substitute the Daily Notes template file (`opts.template`) for the
 *  given moment. Returns '' when no template is configured or the file can't be
 *  resolved/read — callers then create a blank note, matching Obsidian's behavior. */
async function readDailyTemplateContent(app: App, opts: DailyNotesOptions, now: MomentLike): Promise<string> {
	const tplPath = (opts.template || '').trim();
	if (!tplPath) return '';
	let tplFile = app.vault.getAbstractFileByPath(tplPath);
	if (!(tplFile instanceof TFile) && !tplPath.endsWith('.md')) {
		tplFile = app.vault.getAbstractFileByPath(`${tplPath}.md`);
	}
	if (!(tplFile instanceof TFile)) return '';
	try {
		return substituteTemplateVars(await app.vault.read(tplFile), { now });
	} catch {
		return '';
	}
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
	let content = await readDailyTemplateContent(app, opts, momentOf(iso));
	if (content && !content.endsWith('\n')) content += '\n';
	content += `${taskLine}\n`;
	return await app.vault.create(path, content);
}

/** Where a calendar-added task line landed — drives the success Notice wording
 *  and the optimistic row's click-to-jump target. */
export interface TaskInsertTarget {
	file: TFile;
	/** 0-based line index the task was written to. */
	line: number;
	/** The exact line as written (e.g. with the dashboard list's indentation) —
	 *  the optimistic row's originalLine so an immediate toggle can match it. */
	writtenLine: string;
	kind: 'daily-top' | 'daily-end' | 'dashboard-list' | 'daily-created';
}

/** A checkbox task item line (same shape the vault scanner recognizes). */
const TASK_ITEM_REGEX = /^(\s*)- \[[ xX]\]\s/;

/** Line index just past YAML frontmatter (or 0 when the content has none). */
function topInsertIndex(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') return i + 1;
	}
	return 0;
}

/**
 * Splice `taskLine` into `content` right after the last item of its FIRST
 * checkbox list, matching the list's indentation (so it renders as part of
 * that list). Blank lines between items and indented continuation lines are
 * treated as part of the list. Returns null when no checkbox list exists.
 */
function appendToFirstTaskList(content: string, taskLine: string): { content: string; line: number; writtenLine: string } | null {
	const lines = content.split('\n');
	const first = lines.findIndex(l => TASK_ITEM_REGEX.test(l));
	if (first === -1) return null;
	const indent = lines[first]!.match(TASK_ITEM_REGEX)![1] ?? '';
	let end = first;
	for (let i = first + 1; i < lines.length; i++) {
		const l = lines[i]!;
		if (TASK_ITEM_REGEX.test(l)) { end = i; continue; }
		// A blank line only continues the list when another item follows it.
		if (l.trim() === '' && TASK_ITEM_REGEX.test(lines[i + 1] ?? '')) continue;
		// Indented non-blank lines continue the current item (sub-content).
		if (l.trim() !== '' && /^\s+/.test(l)) { end = i; continue; }
		break;
	}
	const written = `${indent}${taskLine}`;
	const out = [...lines.slice(0, end + 1), written, ...lines.slice(end + 1)];
	return { content: out.join('\n'), line: end + 1, writtenLine: written };
}

/** Splice `taskLine` onto the end of `content` as a new list (blank-line
 *  separated). Returns the rewritten content and the task's 0-based line. */
function appendAtFileEnd(content: string, taskLine: string): { content: string; line: number; writtenLine: string } {
	let out = content;
	if (out.trim() !== '') {
		if (!out.endsWith('\n')) out += '\n';
		out += '\n';
	}
	out += `${taskLine}\n`;
	return { content: out, line: out.split('\n').length - 2, writtenLine: taskLine };
}

/**
 * Write a calendar-added task line for `iso`:
 *
 *  1. the day's daily note exists -> insert per `position`: 'start' at its TOP
 *     (right below frontmatter), 'end' at its bottom;
 *  2. otherwise -> the dashboard file's first checkbox list (appended at its
 *     end; end-of-file when the file has no checkbox list yet);
 *  3. last resort (no dashboard file either) -> create the daily note (template
 *     -seeded) with the task, matching the classic behavior.
 *
 * Returns null only when the core Daily Notes plugin is disabled AND the
 * dashboard file is missing — callers surface the enable-hint Notice.
 */
export async function insertTaskForDay(
	app: App,
	iso: string,
	taskLine: string,
	dashboardFile?: string,
	position: 'start' | 'end' = 'start',
): Promise<TaskInsertTarget | null> {
	// 1. Existing daily note: top (below frontmatter) or bottom, per setting.
	const notePath = dailyNotePathFor(app, iso);
	if (notePath) {
		const existing = app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) {
			const raw = await app.vault.read(existing);
			if (position === 'end') {
				let out = raw;
				if (out !== '' && !out.endsWith('\n')) out += '\n';
				// Task lands after the current last line (0-based index).
				const line = out.split('\n').length - 1;
				out += `${taskLine}\n`;
				await app.vault.modify(existing, out);
				return { file: existing, line, writtenLine: taskLine, kind: 'daily-end' };
			}
			const lines = raw.split('\n');
			const at = topInsertIndex(lines);
			const out = [...lines.slice(0, at), taskLine, ...lines.slice(at)].join('\n');
			await app.vault.modify(existing, out);
			return { file: existing, line: at, writtenLine: taskLine, kind: 'daily-top' };
		}
	}

	// 2. No daily note for the day: the dashboard file's first checkbox list.
	const rawPath = (dashboardFile ?? '').trim();
	if (rawPath) {
		const dashPath = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
		const dash = app.vault.getFileByPath(dashPath);
		if (dash) {
			const raw = await app.vault.read(dash);
			const spliced = appendToFirstTaskList(raw, taskLine) ?? appendAtFileEnd(raw, taskLine);
			await app.vault.modify(dash, spliced.content);
			return { file: dash, line: spliced.line, writtenLine: spliced.writtenLine, kind: 'dashboard-list' };
		}
	}

	// 3. Last resort: create the day's daily note with the task (classic path).
	const created = await appendTaskToDailyNote(app, iso, taskLine);
	if (!created) return null;
	const raw = await app.vault.read(created);
	const line = Math.max(raw.split('\n').indexOf(taskLine), 0);
	return { file: created, line, writtenLine: taskLine, kind: 'daily-created' };
}

/**
 * Get today's (or `iso`'s) daily note, creating it from the core Daily Notes
 * plugin's template (with `{{date}}`/`{{time}}` substituted) if it doesn't
 * exist yet. Returns null if the core Daily Notes plugin is disabled — callers
 * should surface a "enable Daily Notes" hint in that case.
 */
export async function getOrCreateDailyNote(app: App, iso: string): Promise<TFile | null> {
	const opts = getDailyNotesOptions(app);
	if (!opts) return null;
	const path = dailyNotePathFor(app, iso);
	if (!path) return null;

	const folder = (opts.folder || '').trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);

	const now = momentOf(iso);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		// Rescue a stale blank daily note (e.g. one created before a template was
		// configured): seed the configured template into an empty file. No-op for
		// notes that already have content — user edits are never overwritten.
		const raw = await app.vault.read(existing);
		if (raw.trim() === '') {
			const seeded = await readDailyTemplateContent(app, opts, now);
			if (seeded.trim() !== '') await app.vault.modify(existing, seeded);
		}
		return existing;
	}

	const content = await readDailyTemplateContent(app, opts, now);
	return await app.vault.create(path, content);
}
