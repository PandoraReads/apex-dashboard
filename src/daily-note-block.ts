import type { TaskItem } from './types';

/**
 * Daily-note task merge helpers for "save tasks to daily note".
 *
 * saveTasksToDaily used to unconditionally prepend `### <card title>` plus
 * the serialized task list, so every re-save stacked another copy. The block
 * is now addressable by its heading line and saved with a MERGE strategy:
 *
 * - a task line already present in the note block is UPDATED to the card's
 *   current state (text / checked / reminder / indent);
 * - card tasks with no counterpart in the note are APPENDED to the block;
 * - task lines that exist only in the note (the user added them by hand, or
 *   deleted them from the card) are LEFT UNTOUCHED.
 */

/** The exact heading line a saved block starts with. */
export function dailyBlockHeading(title: string): string {
	return `### ${title}`;
}

/** Count occurrences of the heading line — used by tests to prove idempotence. */
export function countDailyBlock(md: string, heading: string): number {
	return md.split(/\r?\n/).filter((line) => line.trim() === heading).length;
}

interface MergeOutcome {
	content: string;
	/** false = heading absent, caller should prepend the whole block instead. */
	replaced: boolean;
	updated: number;
	appended: number;
}

const TASK_LINE = /^(\s*)- \[([ xX])\] (.*)$/;

/** Serialized markdown line for one task, mirroring task-tree.serializeTasksForNote. */
function taskLine(task: TaskItem, indent: number): string {
	let line = `${'    '.repeat(indent)}- [${task.checked ? 'x' : ' '}] ${task.text}`;
	if (task.reminder) line += ` ⏰ ${task.reminder}`;
	return line;
}

/** Strip checkbox / indentation / reminder so lines compare by plain text. */
function taskLineText(raw: string): string {
	const m = raw.match(TASK_LINE);
	return m ? (m[3] ?? '').replace(/ ⏰ .*$/, '').trim() : '';
}

/**
 * Merge the card's task tree into the `heading` section of a daily note.
 * Matching is by plain task text (first occurrence wins). Structural note:
 * a matched parent with brand-new children gets those children appended at
 * the end of the block (they cannot be nested under the matched parent
 * without rewriting lines the user may have reordered by hand).
 *
 * Notes written by the OLD always-prepend code contain several stacked
 * copies of the block; every copy after the first is an artifact of that
 * bug, so they are REMOVED here — one save heals the note.
 */
export function mergeDailyTasksBlock(
	md: string,
	heading: string,
	tasks: TaskItem[],
): MergeOutcome {
	const eol = md.includes('\r\n') ? '\r\n' : '\n';
	const lines = md.split(/\r?\n/);
	const idx = lines.findIndex((line) => line.trim() === heading);
	if (idx === -1) return { content: md, replaced: false, updated: 0, appended: 0 };

	/** End of the section starting at `start` (exclusive), trailing blank
	 *  separator lines excluded — they belong to the surrounding text. */
	const sectionEndOf = (start: number): number => {
		let end = lines.length;
		for (let i = start + 1; i < lines.length; i++) {
			if (/^#{1,3} /.test(lines[i] ?? '')) {
				end = i;
				break;
			}
		}
		let trimmed = end;
		while (trimmed > start + 1 && lines[trimmed - 1]?.trim() === '') trimmed--;
		return trimmed;
	};

	// Duplicate sections (same heading) left behind by the old always-prepend
	// save: mark every copy after the first for removal. The blank lines
	// around each copy are absorbed too — the merged block re-inserts exactly
	// one separator, so removal doesn't leave blank-line litter.
	const keep = lines.map(() => true);
	let cursor = sectionEndOf(idx);
	while (true) {
		const dup = lines.findIndex((line, i) => i >= cursor && line.trim() === heading);
		if (dup === -1) break;
		let dupStart = dup;
		while (dupStart - 1 > idx && lines[dupStart - 1]?.trim() === '') dupStart--;
		let dupEnd = sectionEndOf(dup);
		while (dupEnd < lines.length && lines[dupEnd]?.trim() === '') dupEnd++;
		for (let i = dupStart; i < dupEnd; i++) keep[i] = false;
		cursor = dupEnd;
	}

	const sectionEnd = sectionEndOf(idx);

	// Card side: flatten the tree, first text wins for matching.
	const cardByText = new Map<string, string>();
	const flatten = (task: TaskItem, indent: number) => {
		const key = task.text.trim();
		if (!cardByText.has(key)) cardByText.set(key, taskLine(task, indent));
		for (const child of task.children ?? []) flatten(child, indent + 1);
	};
	for (const task of tasks) flatten(task, 0);

	// Note side: walk the existing section line by line. Task lines whose
	// text matches the card are rewritten; everything else (prose, ####
	// subheadings, hand-written tasks, blanks) passes through untouched.
	const merged: string[] = [];
	const seen = new Set<string>();
	let updated = 0;
	for (let i = idx + 1; i < sectionEnd; i++) {
		const raw = lines[i] ?? '';
		const key = taskLineText(raw);
		const replacement = key ? cardByText.get(key) : undefined;
		if (replacement !== undefined && !seen.has(key)) {
			seen.add(key);
			merged.push(replacement);
			updated++;
		} else {
			merged.push(raw);
		}
	}

	// Append card tasks the note has never seen.
	const appendedLines: string[] = [];
	let appended = 0;
	const collect = (task: TaskItem, indent: number) => {
		const key = task.text.trim();
		if (!seen.has(key)) {
			seen.add(key);
			appendedLines.push(taskLine(task, indent));
			appended++;
		}
		for (const child of task.children ?? []) collect(child, indent + 1);
	};
	for (const task of tasks) collect(task, 0);

	const before = lines.slice(0, idx + 1);
	const after = lines
		.slice(sectionEnd)
		.filter((_, i) => keep[sectionEnd + i]);
	// Reuse the note's own blank separator when one follows the block; only
	// add one when real content (or nothing) comes next — never grow the
	// gap by one blank line per save.
	const sep = after.length > 0 && after[0]?.trim() === '' ? [] : after.length > 0 ? [''] : [];
	const next = [...before, ...merged, ...appendedLines, ...sep, ...after];
	return { content: next.join(eol), replaced: true, updated, appended };
}
