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
 * Tasks under the card's heading block in today's note.
 *
 * `level` is the card's configured heading depth (default 3 = `### title`).
 * Returns null when there is nothing to read yet (core plugin off, no note, or
 * no block) — callers show an empty list rather than inventing tasks.
 */
export async function readCardTasksFromToday(app: App, title: string, level = 3): Promise<TaskItem[] | null> {
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
	// Try the configured level first, then the historical ### block: a level
	// change (or a note block written before it was configured) must not make
	// the existing list invisible.
	const section = extractDailyTasksBlock(raw, dailyBlockHeading(clean, level))
		?? (level === 3 ? null : extractDailyTasksBlock(raw, dailyBlockHeading(clean)));
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
 * Rename the card's block in `file` to the configured heading level.
 *
 * Changing the heading level would otherwise APPEND a second block next to the
 * old one (same title, different depth) and duplicate every task in the note.
 * Rewriting the existing heading line MOVES the block instead. Returns true
 * when a line actually changed.
 */
export async function retitleCardBlock(app: App, file: TFile, title: string, level: number): Promise<boolean> {
	const clean = title.trim();
	if (!clean) return false;
	const want = dailyBlockHeading(clean, level);
	const raw = await app.vault.read(file);
	const lines = raw.split(/\r?\n/);
	let changed = false;
	for (let i = 0; i < lines.length; i++) {
		const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i] ?? '');
		if (!m || m[2] !== clean) continue;
		if (lines[i] === want) continue;
		lines[i] = want;
		changed = true;
	}
	if (!changed) return false;
	await app.vault.modify(file, lines.join(raw.includes('\r\n') ? '\r\n' : '\n'));
	return true;
}

/**
 * Write the card's task tree into today's heading block (`### <title>` by
 * default, or the card's configured `level`), creating the note
 * (template-seeded) and/or the block when missing.
 *
 * The block's task lines are REPLACED by the card's list — the card is an
 * editor for that section, so deletions must propagate. Non-task prose inside
 * the section is preserved. Returns false when the core Daily notes plugin is
 * disabled.
 */
export async function writeCardTasksToToday(app: App, title: string, tasks: TaskItem[], level = 3): Promise<boolean> {
	const clean = title.trim();
	if (!clean) return false;
	if (!getDailyNotesConfig(app)) return false;

	const file = await getOrCreateDailyNote(app, nowMoment().format('YYYY-MM-DD'));
	if (!file) return false;

	const raw = await app.vault.read(file);
	const heading = dailyBlockHeading(clean, level);
	// The note is the source of truth here, so the block's task lines are
	// REWRITTEN to match the card (a deleted task must really disappear) while
	// any prose in the section is kept.
	const rewritten = replaceDailyTasksBlock(raw, heading, tasks);
	await app.vault.modify(file, rewritten ?? appendBlock(raw, heading, tasks));
	return true;
}
