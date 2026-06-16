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
