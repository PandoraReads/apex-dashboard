/**
 * Section pairing ("双排") primitives.
 *
 * A column with `half: true` renders side-by-side with its partner — two
 * ADJACENT half columns form one visual row (max two per row). Pairing is
 * purely adjacency-based: the invariant "every half column sits in a run of
 * exactly two consecutive halves" is re-established here at each mutation
 * (and self-healed once at parse time for hand-edited files).
 *
 * All functions are pure array transforms over any `{ half?: boolean }` shape,
 * so `DashboardColumn[]` satisfies them structurally and this module stays
 * free of Obsidian imports (jiti-testable standalone).
 */

interface Pairable {
	half?: boolean;
}

export type PairSide = 'left' | 'right';

/** Indices where a valid pair begins: scan runs of half columns, consume two
 *  at a time (greedy left-to-right; a leftover odd member pairs with no one). */
export function pairStarts<T extends Pairable>(cols: T[]): number[] {
	const starts: number[] = [];
	let i = 0;
	while (i < cols.length) {
		if (!cols[i]!.half) {
			i++;
			continue;
		}
		const runStart = i;
		while (i < cols.length && cols[i]!.half) i++;
		for (let s = runStart; s + 1 < i; s += 2) starts.push(s);
	}
	return starts;
}

/** The partner of `cols[index]`, or -1 when it is unpaired (or out of range). */
export function partnerIndexOf<T extends Pairable>(cols: T[], index: number): number {
	if (index < 0 || index >= cols.length || !cols[index]!.half) return -1;
	for (const s of pairStarts(cols)) {
		if (s === index) return s + 1;
		if (s + 1 === index) return s;
	}
	return -1;
}

/** Clear `half` on any column not inside a valid pair. Parse-time self-heal
 *  for hand-edited files: greedy left-to-right is the only sensible reading
 *  of an odd run (e.g. A B C → keep A|B, free C). Mutations NEVER rely on
 *  this — they unpartner explicitly (a run-merge after a delete would
 *  otherwise re-pair the WRONG neighbours). */
export function normalizeColumnPairs<T extends Pairable>(cols: T[]): T[] {
	const paired = new Set<number>();
	for (const s of pairStarts(cols)) {
		paired.add(s);
		paired.add(s + 1);
	}
	let changed = false;
	const next = cols.map((c, i) => {
		if (c.half && !paired.has(i)) {
			changed = true;
			return { ...c, half: undefined };
		}
		return c;
	});
	return changed ? next : cols;
}

/** Clear `half` on the column at `index` and its partner (if any). */
export function unpartnerAt<T extends Pairable>(cols: T[], index: number): T[] {
	const partner = partnerIndexOf(cols, index);
	const toClear = new Set<number>([index]);
	if (partner >= 0) toClear.add(partner);
	let changed = false;
	const next = cols.map((c, i) => {
		if (toClear.has(i) && c.half) {
			changed = true;
			return { ...c, half: undefined };
		}
		return c;
	});
	return changed ? next : cols;
}

/**
 * Vertical move = "own full-width row": the moved column loses any pairing,
 * its ex-partner falls back to full width, and the reinsertion never lands
 * between two members of a surviving pair (pairing is adjacency-based).
 * `to` is in POST-REMOVAL space (the dnd drop handler's convention).
 */
export function moveToOwnRow<T extends Pairable>(cols: T[], from: number, to: number): T[] {
	if (from < 0 || from >= cols.length) return cols;

	const unp = unpartnerAt(cols, from);
	const moved = { ...unp[from]!, half: undefined };
	const rest = unp.filter((_, i) => i !== from);

	let insertAt = Math.max(0, Math.min(to, rest.length));
	// Inserting at insertAt would split the pair starting at insertAt-1.
	// One step suffices: runs are exactly 2 under the invariant, so the
	// position past the pair is always a legal (between-pairs) boundary.
	if (pairStarts(rest).includes(insertAt - 1)) insertAt += 1;
	return [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
}

/**
 * Side move = pair with the target: splice `from` out, insert it beside
 * `target` (post-removal), flag both `half`. Any ex-partner that is not the
 * other actor of this pairing is evicted back to a full-width row; clearing
 * them first also guarantees the insertion can never land between two
 * surviving partners. `from`/`target` are in CURRENT-array space.
 */
export function moveBeside<T extends Pairable>(cols: T[], from: number, target: number, side: PairSide): T[] {
	if (from === target || from < 0 || from >= cols.length || target < 0 || target >= cols.length) return cols;

	const partnerOfFrom = partnerIndexOf(cols, from);
	const partnerOfTarget = partnerIndexOf(cols, target);

	const evict = new Set<number>();
	if (partnerOfFrom >= 0 && partnerOfFrom !== target) evict.add(partnerOfFrom);
	if (partnerOfTarget >= 0 && partnerOfTarget !== from) evict.add(partnerOfTarget);
	const cleared = evict.size === 0
		? cols
		: cols.map((c, i) => (evict.has(i) ? { ...c, half: undefined } : c));

	const moved = { ...cleared[from]!, half: true };
	const rest = cleared.filter((_, i) => i !== from);
	const t = target - (from < target ? 1 : 0);
	const insertAt = side === 'left' ? t : t + 1;
	const inserted = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];

	// Re-assert the target's flag (first-time pairing, or it was the source's
	// partner whose `half` survived the eviction pass via the actor exemption).
	const targetPost = insertAt <= t ? t + 1 : t;
	return inserted.map((c, i) => (i === targetPost ? { ...c, half: true } : c));
}
