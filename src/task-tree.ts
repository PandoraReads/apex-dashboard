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
