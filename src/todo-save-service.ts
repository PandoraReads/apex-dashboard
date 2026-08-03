import { App, TFile, moment } from 'obsidian';
import type { DashboardCard, TaskItem, TodoSaveLocation } from './types';
import { appendTaskMarkers, extractTaskMarkers, todayStr } from './task-markers';

/**
 * Todo-card → note save service.
 *
 * Block format written into notes (Tasks / Tasks-Datetime compatible):
 *
 *   - [ ] 卡片标题 <!-- a:c8k2m -->
 *       - [x] 任务1 ➕ 2026-08-01 ✅ 2026-08-02
 *       - [ ] 任务2 ⏫ ➕ 2026-08-03 ⏳ 2026-08-05 14:00
 *
 * - Every todo carries its own ➕ created / ✅ completed dates (per-todo,
 *   independently) so completion-rate / time-cost statistics stay accurate.
 * - Reminders are written as ⏳ date HH:MM (Tasks-Datetime readable), not the
 *   apex-private ⏰ format.
 * - The hidden `<!-- a:ids -->` comment anchors the block for in-place
 *   updates; comma-separated ids appear after merges. The legacy
 *   `<!-- apex-card:ids -->` form is still recognized on read.
 * - Merge = three-way by task text: note-only tasks kept, card-only tasks
 *   appended, conflicts resolved in favor of the card (dashboard = truth).
 */

export type SaveStatus = 'created' | 'updated' | 'merged' | 'unchanged';

export interface SaveResult {
	status: SaveStatus;
	path: string;
}

const MARKER_REGEX = /<!--\s*(?:apex-card|a):([^>]+?)\s*-->/;
const CHECKBOX_REGEX = /^(\s*)- \[([ xX])\]\s*(.*)$/;
const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;
const DATE_TEMPLATE_REGEX = /\{\{date:([^}]+)\}\}/g;

/** Resolve {{date:FORMAT}} templates (moment format tokens) against today. */
function resolveDateTemplates(input: string): string {
	return input.replace(DATE_TEMPLATE_REGEX, (_m, fmt: string) => moment().format(fmt.trim()));
}

/** Serialize one task line (indent ≥ 1) with per-todo markers + ⏳ reminder. */
function serializeTaskLine(task: TaskItem, indent: number): string {
	const prefix = '    '.repeat(indent);
	let line = `${prefix}- [${task.checked ? 'x' : ' '}] ${task.text}`;
	line = appendTaskMarkers(line, task);
	if (task.reminder) line += ` ⏳ ${task.reminder}`;
	return line;
}

/** Serialize one card into a note block. `ids` may include merge aliases. */
export function serializeCardBlock(card: DashboardCard, ids: string[]): string {
	const tasks = card.tasks ?? [];
	const allChecked = tasks.length > 0 && tasks.every(task => task.checked);

	let titleLine = `- [${allChecked ? 'x' : ' '}] ${card.title?.trim() || 'Untitled'}`;
	titleLine += ` <!-- a:${ids.join(',')} -->`;

	const lines = [titleLine];
	const writeTask = (task: TaskItem, indent: number): void => {
		lines.push(serializeTaskLine(task, indent));
		for (const child of task.children ?? []) writeTask(child, indent + 1);
	};
	for (const task of tasks) writeTask(task, 1);
	return lines.join('\n');
}

interface ParsedNoteTask {
	text: string;
	checked: boolean;
	createdAt?: string;
	completedAt?: string;
	priority?: TaskItem['priority'];
	reminder?: string;
}

/** Parse the child task lines of a block (top-level only, indent > title). */
function parseNoteTasks(blockLines: string[]): ParsedNoteTask[] {
	const out: ParsedNoteTask[] = [];
	for (const raw of blockLines) {
		const m = raw.match(CHECKBOX_REGEX);
		if (!m || !m[1] || m[1].length === 0) continue; // top-level of the block only (indent > 0)
		if (m[1].length !== 4) continue; // only direct children (one indent level)
		let text = m[3] ?? '';
		let reminder: string | undefined;
		const rm = text.match(/\s*⏳\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/) ?? text.match(/\s*⏰\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
		if (rm?.[1]) {
			reminder = rm[1];
			text = text.replace(rm[0], '');
		}
		const { text: clean, markers } = extractTaskMarkers(text);
		out.push({
			text: clean,
			checked: m[2] !== ' ',
			createdAt: markers.createdAt,
			completedAt: markers.completedAt,
			reminder,
		});
	}
	return out;
}

/**
 * Three-way merge by task text:
 * - text in both → card version wins (checked/dates/priority/reminder)
 * - text only in note → kept as recorded in the note
 * - text only in card → appended after existing tasks
 */
function mergeNoteTasks(existing: ParsedNoteTask[], cardTasks: TaskItem[]): TaskItem[] {
	const cardTop = new Map(cardTasks.map(t => [t.text, t]));
	const used = new Set<string>();
	const merged: TaskItem[] = [];

	for (const noteTask of existing) {
		const cardTask = cardTop.get(noteTask.text);
		if (cardTask) {
			merged.push(cardTask);
			used.add(noteTask.text);
		} else {
			merged.push({
				text: noteTask.text,
				checked: noteTask.checked,
				createdAt: noteTask.createdAt,
				completedAt: noteTask.completedAt,
				priority: noteTask.priority,
				reminder: noteTask.reminder,
			});
		}
	}
	for (const cardTask of cardTasks) {
		if (!used.has(cardTask.text) && !existing.some(n => n.text === cardTask.text)) {
			merged.push(cardTask);
		}
	}
	return merged;
}

interface LocatedBlock {
	/** Line index of the title checkbox line. */
	start: number;
	/** Line index one past the last child line. */
	end: number;
	/** Ids recorded in the marker comment. */
	ids: string[];
	/** Plain title text (markers + marker comment stripped). */
	title: string;
}

/** Extract plain title from a title checkbox line (checkbox, markers, comment stripped). */
function plainTitle(raw: string): string {
	const m = raw.match(CHECKBOX_REGEX);
	if (!m?.[3]) return raw.trim();
	let text = m[3].replace(MARKER_REGEX, '');
	text = text.replace(/\s*⏰\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/, '');
	text = text.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '');
	text = text.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, '');
	text = extractTaskMarkers(text).text;
	return text.trim();
}

/** Scan lines for the block owned by `cardId`, or (fallback) one titled `title`. */
function locateBlock(lines: string[], cardId: string, title: string): LocatedBlock | null {
	let titleMatch: LocatedBlock | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const cb = line.match(CHECKBOX_REGEX);
		if (!cb) continue;
		const indent = cb[1]!.length;

		const marker = line.match(MARKER_REGEX);
		const ids = marker?.[1] ? marker[1].split(',').map(s => s.trim()).filter(Boolean) : [];

		// Block end = following lines more indented than the title line
		let end = i + 1;
		while (end < lines.length) {
			const next = lines[end]!;
			if (next.trim() === '') break;
			const leading = next.match(/^(\s*)/)![1]!.length;
			if (leading <= indent) break;
			end++;
		}

		if (ids.includes(cardId)) {
			return { start: i, end, ids, title: plainTitle(line) };
		}
		if (!titleMatch && indent === 0 && plainTitle(line) === title) {
			titleMatch = { start: i, end, ids, title };
		}
	}
	return titleMatch;
}

/** True when two block strings carry the same content, ignoring apex marker ids. */
function blocksEqual(a: string, b: string): boolean {
	const strip = (s: string) => s
		.split('\n')
		.map(l => l.replace(MARKER_REGEX, '').trimEnd())
		.join('\n')
		.trim();
	return strip(a) === strip(b);
}

export async function saveCardToLocation(app: App, card: DashboardCard, loc: TodoSaveLocation): Promise<SaveResult> {
	const folder = resolveDateTemplates(loc.folder.trim()).replace(/^\/+|\/+$/g, '');
	const fileName = resolveDateTemplates(loc.file.trim()).replace(/\.md$/i, '');
	const path = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
	const title = card.title?.trim() || 'Untitled';

	await ensureFolder(app, folder);

	const existing = app.vault.getAbstractFileByPath(path);
	if (!(existing instanceof TFile)) {
		// New file: heading (if any) + block
		const parts: string[] = [];
		if (loc.heading) parts.push(`## ${loc.heading}`, '');
		parts.push(serializeCardBlock(card, [card.id]));
		await app.vault.create(path, parts.join('\n') + '\n');
		return { status: 'created', path };
	}

	const raw = await app.vault.read(existing);
	const lines = raw.split('\n');

	const found = locateBlock(lines, card.id, title);
	if (found) {
		const byId = found.ids.includes(card.id);
		const unionIds = Array.from(new Set([...found.ids, card.id]));

		if (byId) {
			// Same card re-save: card fully defines the block (panel deletions propagate).
			const newBlock = serializeCardBlock(card, unionIds);
			const oldBlock = lines.slice(found.start, found.end).join('\n');
			if (blocksEqual(oldBlock, newBlock)) return { status: 'unchanged', path };
			lines.splice(found.start, found.end - found.start, ...newBlock.split('\n'));
			await app.vault.modify(existing, lines.join('\n'));
			return { status: 'updated', path };
		}

		// Title match (different card): append-only. Preserve the note's entire
		// existing content (including nested subtask trees); only append card
		// tasks whose top-level text is not yet present in the block.
		const existingTexts = new Set<string>();
		for (let j = found.start + 1; j < found.end; j++) {
			const cb = lines[j]!.match(CHECKBOX_REGEX);
			if (cb?.[1] && cb[1]!.length === 4) { // direct child (one indent)
				let raw = cb[3] ?? '';
				raw = raw.replace(/\s*(⏳|⏰|📅|🛫)\s*[\d\s:-]+/g, '');
				existingTexts.add(extractTaskMarkers(raw).text);
			}
		}

		let anyNew = false;
		for (const task of card.tasks ?? []) {
			if (!existingTexts.has(task.text)) {
				lines.splice(found.end, 0, serializeTaskLine(task, 1));
				found.end++;
				anyNew = true;
			}
		}

		if (!anyNew) return { status: 'unchanged', path };

		// Update the marker line to reflect both card ids
		lines[found.start] = lines[found.start]!.replace(MARKER_REGEX, ` <!-- a:${unionIds.join(',')} -->`);
		await app.vault.modify(existing, lines.join('\n'));
		return { status: 'merged', path };
	}

	// Append: under the configured heading (end of its section), or at file top
	const block = serializeCardBlock(card, [card.id]);
	const insertAt = locateInsertionPoint(lines, loc.heading);
	if (insertAt >= 0) {
		lines.splice(insertAt, 0, ...block.split('\n'));
	} else {
		// Heading not found → create it at end of file, then the block below it
		if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') lines.push('');
		lines.push(`## ${loc.heading.trim()}`, '', ...block.split('\n'));
	}
	await app.vault.modify(existing, lines.join('\n'));
	return { status: 'created', path };
}

/**
 * Where to insert a new block:
 * - heading set & found  → end of that heading's section
 * - heading set & missing → -1 (caller creates the heading at EOF)
 * - heading empty → top of file, right after frontmatter (if any)
 */
function locateInsertionPoint(lines: string[], heading: string): number {
	const wanted = heading.trim();

	if (!wanted) {
		let i = 0;
		if (lines[0]?.trim() === '---') {
			for (i = 1; i < lines.length; i++) {
				if (lines[i]!.trim() === '---') { i++; break; }
			}
			while (i < lines.length && lines[i]!.trim() === '') i++;
		}
		return i;
	}

	for (let i = 0; i < lines.length; i++) {
		const h = lines[i]!.match(HEADING_REGEX);
		if (!h || h[2]! !== wanted) continue;
		const level = h[1]!.length;
		let j = i + 1;
		for (; j < lines.length; j++) {
			const next = lines[j]!.match(HEADING_REGEX);
			if (next && next[1]!.length <= level) break;
		}
		// trim trailing blank lines so the block sits right after section content
		while (j - 1 > i && lines[j - 1]!.trim() === '') j--;
		return j;
	}

	return -1;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	if (!folderPath) return;
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

/** Re-export for view layer convenience. */
export { todayStr };
