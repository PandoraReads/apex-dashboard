import { App, TFile } from 'obsidian';
import { dailyNotePathFor, getDailyNotesConfig, getOrCreateDailyNote } from './daily-notes';
import { dailyBlockHeading, extractDailyTasksBlock, replaceDailyTasksBlock } from './daily-note-block';
import { extractCardParts } from './parser';
import { serializeTasksForNote } from './task-tree';
import { nowMoment } from './datetime';
import type { TaskItem } from './types';

/**
 * "Load tasks from today's daily note" (per-card config `tasksFromDaily`).
 *
 * A card with the flag on keeps NO task list of its own in the dashboard file:
 * its tasks are read from — and written back to — the `### <card title>` block
 * of today's daily note (the same block "save tasks to daily" writes). The note
 * is the single source of truth, so the two copies can never drift apart and
 * no task is duplicated across files.
 */

/** Today's daily-note file, or null when the core Daily notes plugin is off or
 *  the note has not been created yet. */
export function todayDailyNote(app: App): TFile | null {
	if (!getDailyNotesConfig(app)) return null;
	const path = dailyNotePathFor(app, nowMoment().format('YYYY-MM-DD'));
	if (!path) return null;
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

/**
 * Tasks under the card's `### <title>` block in today's note.
 *
 * Returns null when there is nothing to read yet (core plugin off, no note, or
 * no block) — callers show an empty list rather than inventing tasks.
 */
export async function readCardTasksFromToday(app: App, title: string): Promise<TaskItem[] | null> {
	const clean = title.trim();
	if (!clean) return null;
	const file = todayDailyNote(app);
	if (!file) return null;
	let raw: string;
	try {
		raw = await app.vault.read(file);
	} catch {
		return null;
	}
	const section = extractDailyTasksBlock(raw, dailyBlockHeading(clean));
	if (section === null) return null;
	return extractCardParts(section).tasks;
}

/** Append a fresh `### <title>` block holding `tasks` to the end of `raw`. */
function appendBlock(raw: string, heading: string, tasks: TaskItem[]): string {
	const eol = raw.includes('\r\n') ? '\r\n' : '\n';
	const block = `${heading}${eol}${serializeTasksForNote(tasks)}`;
	const base = raw.replace(/\s+$/, '');
	return base ? `${base}${eol}${eol}${block}${eol}` : `${block}${eol}`;
}

/**
 * Write the card's task tree into today's `### <title>` block, creating the
 * note (template-seeded) and/or the block when missing.
 *
 * The block's task lines are REPLACED by the card's list — the card is an
 * editor for that section, so deletions must propagate. Non-task prose inside
 * the section is preserved. Returns false when the core Daily notes plugin is
 * disabled.
 */
export async function writeCardTasksToToday(app: App, title: string, tasks: TaskItem[]): Promise<boolean> {
	const clean = title.trim();
	if (!clean) return false;
	if (!getDailyNotesConfig(app)) return false;

	const file = await getOrCreateDailyNote(app, nowMoment().format('YYYY-MM-DD'));
	if (!file) return false;

	const raw = await app.vault.read(file);
	const heading = dailyBlockHeading(clean);
	// The note is the source of truth here, so the block's task lines are
	// REWRITTEN to match the card (a deleted task must really disappear) while
	// any prose in the section is kept.
	const rewritten = replaceDailyTasksBlock(raw, heading, tasks);
	await app.vault.modify(file, rewritten ?? appendBlock(raw, heading, tasks));
	return true;
}
