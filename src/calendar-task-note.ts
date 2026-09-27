import type { App } from 'obsidian';
import { ensureFolder, type TaskInsertTarget } from './daily-notes';
import { mergeTemplateNoteContent } from './library-new-note';
import { momentOf } from './datetime';
import { readTemplateContent, sanitizeFilename, splitFrontmatter, uniquePath } from './quick-note-section';

export type CalendarTaskNoteResult = TaskInsertTarget & {
	/** The configured template could not be read; the note was created bare
	 *  and the save still succeeded (caller shows a notice). */
	templateMissing: boolean;
};

/** Strip the checkbox prefix and every date/time marker from a task line,
 *  leaving its human title (e.g. "Buy milk"). Covers the dataview-style
 *  fields ([start::]/[due::]/[scheduled::]/[end::]/…) anywhere in the text and
 *  the trailing emoji markers (⏰/📅/🛫/🛬/⏳/✅ with their date). */
function taskTitleOf(taskLine: string): string {
	return taskLine
		.replace(/^\s*-\s*\[[ xX]\]\s*/, '')
		.replace(/\s*\[(?:start|end|due|scheduled|completion|priority)::[^\]]*\]/gi, '')
		.replace(/\s+(?:⏰|📅|🛫|🛬|⏳|✅)\s+\d{4}-\d{2}-\d{2}.*$/u, '')
		.trim();
}

/**
 * Create a brand-new note for ONE calendar task (the calendarTaskTarget
 * 'note' mode): `folder/YYYY-MM-DD <task title>.md` (uniqued on collision),
 * with the task line written into it. The task keeps its ⏰/📅 marker, so the
 * calendar scanner still finds it in its new home — the note IS the task's
 * home now, not a daily note.
 *
 * Content: the configured template (when set) seeds the note — its body with
 * {{title}} (the task title) and {{date:…}}/{{time:…}} (the task's day, and
 * its ⏰ time when the task has one) substituted, its frontmatter carried
 * over — and the task line is appended after a blank line. With no template
 * (or an unreadable one — `templateMissing`) the note is just the task line.
 *
 * `untitled` labels marker-less leftovers (localized by the caller — this
 * module stays free of i18n/Notice, like memo-note.ts).
 */
export async function createTaskNote(
	app: App,
	input: {
		iso: string;
		taskLine: string;
		folder: string;
		templatePath?: string;
		untitled: string;
	},
): Promise<CalendarTaskNoteResult> {
	// Template vars see the task's day (not the wall clock), and {{time}} the
	// day's time when the line carries one — the [start::] time first (the
	// day the note is for), then ⏰, then [due::]. Same "for that day"
	// semantics as daily-note template seeding. The day also prefixes the
	// filename (a task added from day A but starting day B files under B).
	const timeOf = (re: RegExp): RegExpExecArray | null => re.exec(input.taskLine);
	const marker = timeOf(/\[start::\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/u)
		?? timeOf(/⏰\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/u)
		?? timeOf(/\[due::\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/u);
	const dayIso = marker?.[1] ?? input.iso;
	const now = momentOf(marker?.[1] && marker[2] ? `${marker[1]} ${marker[2]}` : dayIso);

	const title = taskTitleOf(input.taskLine) || input.untitled;
	const safe = sanitizeFilename(title) || input.untitled;
	// Date-prefixed so a task folder sorts chronologically and the same title
	// on different days never collides.
	const fileName = `${dayIso} ${safe}.md`;

	const folder = input.folder.trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const base = folder ? `${folder}/${fileName}` : fileName;
	const path = await uniquePath(app, base);

	let tplFm = '';
	let tplBody = '';
	let templateMissing = false;
	const tplPath = (input.templatePath ?? '').trim();
	if (tplPath) {
		const { content, found } = await readTemplateContent(app, tplPath, { title, now });
		if (!found) {
			// Fall through to a bare note; the save must not fail.
			templateMissing = true;
		} else {
			const split = splitFrontmatter(content);
			tplFm = split.fm;
			// Same leading-newline strip the library new-note pipeline applies.
			tplBody = split.body.replace(/^\n+/, '');
		}
	}

	const body = [tplBody, input.taskLine].filter(s => s.trim().length > 0).join('\n\n');
	const content = mergeTemplateNoteContent(tplFm, body, {});

	const file = await app.vault.create(path, content);
	return {
		file,
		line: Math.max(content.split('\n').indexOf(input.taskLine), 0),
		writtenLine: input.taskLine,
		kind: 'note-created',
		templateMissing,
	};
}
