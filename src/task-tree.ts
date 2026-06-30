import type { TaskItem } from './types';

export type TaskPath = number[];

function locate(tasks: TaskItem[], path: TaskPath): { siblings: TaskItem[]; index: number } | null {
	if (path.length === 0) return null;
	let nodes = tasks;
	for (let i = 0; i < path.length - 1; i++) {
		const node = nodes[path[i]!];
		if (!node) return null;
		nodes = node.children ?? [];
	}
	const lastIndex = path[path.length - 1]!;
	if (lastIndex < 0 || lastIndex >= nodes.length) return null;
	return { siblings: nodes, index: lastIndex };
}

export function getTaskByPath(tasks: TaskItem[], path: TaskPath): TaskItem | undefined {
	const loc = locate(tasks, path);
	return loc ? loc.siblings[loc.index] : undefined;
}

export function updateTaskAt(
	tasks: TaskItem[],
	path: TaskPath,
	updater: (t: TaskItem) => TaskItem,
): TaskItem[] {
	if (path.length === 0) return tasks.map(updater);
	const [head, ...rest] = path;
	return tasks.map((t, i) => {
		if (i !== head) return t;
		if (rest.length === 0) return updater(t);
		return { ...t, children: updateTaskAt(t.children ?? [], rest, updater) };
	});
}

function replaceSiblings(tasks: TaskItem[], path: TaskPath, newSiblings: TaskItem[]): TaskItem[] {
	if (path.length === 0) return newSiblings;
	const [head, ...rest] = path;
	return tasks.map((t, i) =>
		i === head ? { ...t, children: replaceSiblings(t.children ?? [], rest, newSiblings) } : t,
	);
}

export function removeTaskAt(
	tasks: TaskItem[],
	path: TaskPath,
): { tasks: TaskItem[]; removed: TaskItem | undefined } {
	const parentPath = path.slice(0, -1);
	const loc = locate(tasks, path);
	if (!loc) return { tasks, removed: undefined };
	const removed = loc.siblings[loc.index]!;
	const newSiblings = loc.siblings.filter((_, i) => i !== loc.index);
	return { tasks: replaceSiblings(tasks, parentPath, newSiblings), removed };
}

export function insertAt(
	tasks: TaskItem[],
	parentPath: TaskPath,
	index: number,
	node: TaskItem,
): TaskItem[] {
	const loc = parentPath.length === 0
		? { siblings: tasks, index: 0 }
		: locate(tasks, [...parentPath, 0]);
	if (parentPath.length === 0) {
		const clamped = Math.max(0, Math.min(index, tasks.length));
		const next = [...tasks];
		next.splice(clamped, 0, node);
		return next;
	}
	if (!loc) return tasks;
	const parentChildren = loc.siblings;
	const clamped = Math.max(0, Math.min(index, parentChildren.length));
	const next = [...parentChildren];
	next.splice(clamped, 0, node);
	return replaceSiblings(tasks, parentPath, next);
}

export function insertSibling(
	tasks: TaskItem[],
	path: TaskPath,
	node: TaskItem,
	before: boolean,
): TaskItem[] {
	if (path.length === 0) return tasks;
	const parentPath = path.slice(0, -1);
	const idx = path[path.length - 1]!;
	return insertAt(tasks, parentPath, before ? idx : idx + 1, node);
}

export function appendChild(tasks: TaskItem[], parentPath: TaskPath, node: TaskItem): TaskItem[] {
	const parent = getTaskByPath(tasks, parentPath);
	if (!parent) return tasks;
	const children = parent.children ?? [];
	return updateTaskAt(tasks, parentPath, (p) => ({ ...p, children: [...children, node] }));
}

export function demoteToChild(tasks: TaskItem[], path: TaskPath): TaskItem[] {
	if (path.length === 0) return tasks;
	const idx = path[path.length - 1]!;
	if (idx === 0) return tasks;
	const { removed, tasks: t1 } = removeTaskAt(tasks, path);
	if (!removed) return tasks;
	const prevSiblingPath = [...path.slice(0, -1), idx - 1];
	return appendChild(t1, prevSiblingPath, removed);
}

/**
 * Nest the task at `srcPath` as the last child of the task at `destPath`.
 *
 * Unlike {@link demoteToChild} (which always reparents to the source's previous
 * sibling), this targets the specific task the user dropped onto. Used by the
 * drag-and-drop "nest" zone; the mobile swipe gesture keeps using demoteToChild.
 *
 * Guards against dropping a task onto itself or one of its own descendants
 * (which would create a cycle), and re-locates the destination after the source
 * is removed, since removal can shift sibling indices.
 */
export function nestIntoTarget(tasks: TaskItem[], srcPath: TaskPath, destPath: TaskPath): TaskItem[] {
	if (srcPath.length === 0 || destPath.length === 0) return tasks;
	if (isSelfOrDescendant(srcPath, destPath)) return tasks;

	const { removed, tasks: t1 } = removeTaskAt(tasks, srcPath);
	if (!removed) return tasks;

	const adjustedDest = adjustPathAfterRemoval(destPath, srcPath);
	// Expand the destination if collapsed so the newly nested child is visible.
	const expanded = updateTaskAt(t1, adjustedDest, (p) => (p.collapsed ? { ...p, collapsed: false } : p));
	return appendChild(expanded, adjustedDest, removed);
}

/** True if `destPath` equals `srcPath` or lies within the subtree rooted at it. */
function isSelfOrDescendant(srcPath: TaskPath, destPath: TaskPath): boolean {
	if (destPath.length < srcPath.length) return false;
	for (let i = 0; i < srcPath.length; i++) {
		if (destPath[i] !== srcPath[i]) return false;
	}
	return true;
}

/**
 * Recompute the destination path after the source was removed.
 * `removeTaskAt` only mutates the source's immediate parent's sibling list, so
 * the destination shifts iff it shares that parent and sat after the source.
 */
function adjustPathAfterRemoval(destPath: TaskPath, srcPath: TaskPath): TaskPath {
	const parentLen = srcPath.length - 1;
	if (destPath.length < srcPath.length) return destPath;
	for (let i = 0; i < parentLen; i++) {
		if (destPath[i] !== srcPath[i]) return destPath;
	}
	if (destPath[parentLen]! > srcPath[parentLen]!) {
		const next = [...destPath];
		next[parentLen] = next[parentLen]! - 1;
		return next;
	}
	return destPath;
}

export function promoteToTopLevel(tasks: TaskItem[], path: TaskPath): TaskItem[] {
	if (path.length < 2) return tasks;
	const parentIdx = path[0]!;
	const { removed, tasks: t1 } = removeTaskAt(tasks, path);
	if (!removed) return tasks;
	const clean: TaskItem = { ...removed };
	delete clean.children;
	return insertAt(t1, [], parentIdx + 1, clean);
}

export function recalcChecked(task: TaskItem): TaskItem {
	const kids = task.children ?? [];
	if (kids.length === 0) return task;
	const allChecked = kids.every((k) => k.checked);
	return { ...task, checked: allChecked };
}

/**
 * Partition a task tree into completed (to be archived) and remaining items.
 *
 * Rules:
 * - A top-level checked task is archived wholesale (its text becomes the
 *   archive entry; subtree goes with it).
 * - A top-level unchecked task is kept; its checked descendants are archived
 *   individually, unchecked descendants are preserved.
 *
 * Both halves are returned so view (writes the archive log from `archived`)
 * and sync (persists `remaining`) share one rule definition.
 */
export function archiveCompleted(tasks: TaskItem[]): { archived: TaskItem[]; remaining: TaskItem[] } {
	const archived: TaskItem[] = [];
	const remaining: TaskItem[] = [];

	for (const task of tasks) {
		if (task.checked) {
			archived.push(task);
			continue;
		}

		if (task.children && task.children.length > 0) {
			const childResult = archiveCompleted(task.children);
			archived.push(...childResult.archived);
			remaining.push({
				...task,
				children: childResult.remaining.length > 0 ? childResult.remaining : undefined,
			});
		} else {
			remaining.push(task);
		}
	}

	return { archived, remaining };
}

/**
 * Serialize a task tree to Markdown checkbox lines for export (daily note).
 * Mirrors parser.serialize's task formatting but drops the internal
 * `<!--collapsed-->` marker and keeps the reminder, so the output reads as a
 * plain Obsidian task list.
 */
export function serializeTasksForNote(tasks: TaskItem[]): string {
	const lines: string[] = [];

	const write = (task: TaskItem, indent: number) => {
		const prefix = indent > 0 ? '    '.repeat(indent) : '';
		let line = `${prefix}- [${task.checked ? 'x' : ' '}] ${task.text}`;
		if (task.reminder) line += ` ⏰ ${task.reminder}`;
		lines.push(line);
		for (const child of task.children ?? []) write(child, indent + 1);
	};

	for (const task of tasks) write(task, 0);
	return lines.join('\n');
}
