import type { DocNode } from './types';

export type DocPath = number[];

function locate(docs: DocNode[], path: DocPath): { siblings: DocNode[]; index: number } | null {
	if (path.length === 0) return null;
	let nodes = docs;
	for (let i = 0; i < path.length - 1; i++) {
		const node = nodes[path[i]!];
		if (!node) return null;
		nodes = node.children ?? [];
	}
	const lastIndex = path[path.length - 1]!;
	if (lastIndex < 0 || lastIndex >= nodes.length) return null;
	return { siblings: nodes, index: lastIndex };
}

export function getDocByPath(docs: DocNode[], path: DocPath): DocNode | undefined {
	const loc = locate(docs, path);
	return loc ? loc.siblings[loc.index] : undefined;
}

export function updateDocAt(
	docs: DocNode[],
	path: DocPath,
	updater: (d: DocNode) => DocNode,
): DocNode[] {
	if (path.length === 0) return docs.map(updater);
	const [head, ...rest] = path;
	return docs.map((d, i) => {
		if (i !== head) return d;
		if (rest.length === 0) return updater(d);
		return { ...d, children: updateDocAt(d.children ?? [], rest, updater) };
	});
}

function replaceSiblings(docs: DocNode[], path: DocPath, newSiblings: DocNode[]): DocNode[] {
	if (path.length === 0) return newSiblings;
	const [head, ...rest] = path;
	return docs.map((d, i) =>
		i === head ? { ...d, children: replaceSiblings(d.children ?? [], rest, newSiblings) } : d,
	);
}

export function removeDocAt(
	docs: DocNode[],
	path: DocPath,
): { docs: DocNode[]; removed: DocNode | undefined } {
	const parentPath = path.slice(0, -1);
	const loc = locate(docs, path);
	if (!loc) return { docs, removed: undefined };
	const removed = loc.siblings[loc.index]!;
	const newSiblings = loc.siblings.filter((_, i) => i !== loc.index);
	return { docs: replaceSiblings(docs, parentPath, newSiblings), removed };
}

export function insertDocAt(
	docs: DocNode[],
	parentPath: DocPath,
	index: number,
	node: DocNode,
): DocNode[] {
	if (parentPath.length === 0) {
		const clamped = Math.max(0, Math.min(index, docs.length));
		const next = [...docs];
		next.splice(clamped, 0, node);
		return next;
	}
	const loc = locate(docs, [...parentPath, 0]);
	if (!loc) return docs;
	const parentChildren = loc.siblings;
	const clamped = Math.max(0, Math.min(index, parentChildren.length));
	const next = [...parentChildren];
	next.splice(clamped, 0, node);
	return replaceSiblings(docs, parentPath, next);
}

export function insertDocSibling(
	docs: DocNode[],
	path: DocPath,
	node: DocNode,
	before: boolean,
): DocNode[] {
	if (path.length === 0) return docs;
	const parentPath = path.slice(0, -1);
	const idx = path[path.length - 1]!;
	return insertDocAt(docs, parentPath, before ? idx : idx + 1, node);
}

export function appendDocChild(docs: DocNode[], parentPath: DocPath, node: DocNode): DocNode[] {
	const parent = getDocByPath(docs, parentPath);
	if (!parent) return docs;
	const children = parent.children ?? [];
	return updateDocAt(docs, parentPath, (p) => ({ ...p, children: [...children, node] }));
}

export function demoteDocToChild(docs: DocNode[], path: DocPath): DocNode[] {
	if (path.length === 0) return docs;
	const idx = path[path.length - 1]!;
	if (idx === 0) return docs;
	const { removed, docs: d1 } = removeDocAt(docs, path);
	if (!removed) return docs;
	const prevSiblingPath = [...path.slice(0, -1), idx - 1];
	return appendDocChild(d1, prevSiblingPath, removed);
}

export function promoteDocToTopLevel(docs: DocNode[], path: DocPath): DocNode[] {
	if (path.length < 2) return docs;
	const parentIdx = path[0]!;
	const { removed, docs: d1 } = removeDocAt(docs, path);
	if (!removed) return docs;
	const clean: DocNode = { ...removed };
	delete clean.children;
	return insertDocAt(d1, [], parentIdx + 1, clean);
}

/** True if `destPath` equals `srcPath` or lies within the subtree rooted at it. */
function isSelfOrDescendant(srcPath: DocPath, destPath: DocPath): boolean {
	if (destPath.length < srcPath.length) return false;
	for (let i = 0; i < srcPath.length; i++) {
		if (destPath[i] !== srcPath[i]) return false;
	}
	return true;
}

/**
 * Recompute the destination path after the source was removed.
 * `removeDocAt` only mutates the source's immediate parent's sibling list, so
 * the destination shifts iff it shares that parent and sat after the source.
 */
function adjustPathAfterRemoval(destPath: DocPath, srcPath: DocPath): DocPath {
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

/**
 * Move the doc at `srcPath` into the sibling slot beside the doc at `destPath`
 * (`before` picks the slot above vs below it). Doc-tree mirror of task-tree's
 * `moveTaskBeside`: both paths are in the ORIGINAL tree's coordinates, so the
 * destination is re-located after the source is removed — without that shift,
 * downward drops over-shot by one slot while upward drops landed correctly.
 *
 * Dropping beside yourself or one of your own descendants is a no-op.
 */
export function moveDocBeside(
	docs: DocNode[],
	srcPath: DocPath,
	destPath: DocPath,
	before: boolean,
): DocNode[] {
	if (srcPath.length === 0 || destPath.length === 0) return docs;
	if (isSelfOrDescendant(srcPath, destPath)) return docs;

	const { removed, docs: d1 } = removeDocAt(docs, srcPath);
	if (!removed) return docs;

	const adjustedDest = adjustPathAfterRemoval(destPath, srcPath);
	return insertDocSibling(d1, adjustedDest, removed, before);
}
