/**
 * Scroll-position preservation across section DOM replacement.
 *
 * Section rows are rebuilt wholesale by the in-place refresh paths
 * (refreshSectionInPlace / refreshScanningSections / refreshMediaSections).
 * A rebuilt row starts every internal scroller at 0, which snaps a
 * horizontally scrolled card deck back to its first card and vertically
 * scrolled task lists back to their top — the page visibly "jumps" right
 * after finishing an edit. These helpers snapshot the scroll state of
 * every scrolled descendant of a section row and replay it onto the
 * rebuilt row, so an edit keeps the viewport anchored where the user
 * left it.
 *
 * Keys must survive the rebuild. The nearest [data-card-id] ancestor is
 * the anchor (card ids are stable; deck order is not), and inside a card
 * the key falls back to class signature + index among same-class
 * siblings (for scrollers that carry no id of their own). Anything that
 * fails to resolve on the new tree is skipped — a missed restore
 * degrades to the pre-fix behaviour, never to a wrong jump.
 */

export interface ScrollState {
	top: number;
	left: number;
}

export type ScrollStateMap = Map<string, ScrollState>;

function classSignature(el: Element): string {
	return el.getAttribute('class') ?? el.tagName.toLowerCase();
}

/** Attributes that anchor a subtree in the ROOT-level walk below: the
 *  element's card / widget / section identity, stable across renders even
 *  when siblings are reordered or the subtree moves elsewhere. */
function rootAnchorIdOf(el: Element): string | null {
	return el.getAttribute('data-card-id')
		?? el.getAttribute('data-widget-key')
		?? el.getAttribute('data-column')
		?? null;
}

/** Shared key derivation so capture and restore always agree. */
function scrollKey(el: Element, inheritedAnchor: string, siblingIndex: number): string {
	// An element carrying its own card id (the card itself — a vertical
	// scroller on mobile) keys on that id alone, independent of deck order.
	const anchor = el.getAttribute('data-card-id') ?? inheritedAnchor;
	return `${anchor}|${classSignature(el)}|${siblingIndex}`;
}

/**
 * Walk `parent`'s subtree, applying `visit` to every element with its
 * derived scroll key. One pass, O(n) total: the per-parent signature
 * counter yields each sibling index without re-walking previous siblings.
 */
function walkScrollers(
	parent: Element,
	anchor: string,
	visit: (el: Element, key: string) => void,
): void {
	const seen = new Map<string, number>();
	for (const el of Array.from(parent.children)) {
		const signature = classSignature(el);
		const ownId = el.getAttribute('data-card-id');
		const siblingIndex = ownId ? 0 : (seen.get(signature) ?? 0);
		seen.set(signature, (seen.get(signature) ?? 0) + 1);
		const key = scrollKey(el, anchor, siblingIndex);
		visit(el, key);
		walkScrollers(el, ownId ?? anchor, visit);
	}
}

/** Snapshot top/left of every scrolled descendant of `root` (`root` itself
 *  is not included — the callers replace section rows, which never scroll). */
export function captureScrollStates(root: Element): ScrollStateMap {
	const states: ScrollStateMap = new Map();
	walkScrollers(root, '', (el, key) => {
		if (el.scrollTop > 0 || el.scrollLeft > 0) {
			states.set(key, { top: el.scrollTop, left: el.scrollLeft });
		}
	});
	return states;
}

/**
 * Walk the WHOLE view root (itself included) for the full-render path,
 * keying every element by `<nearest card/widget/column anchor>|<class
 * signature>|<index among same-signature siblings>`. Anchored keys stay
 * valid when sections, widgets, or cards are reordered (the anchor moves
 * with the subtree); the one-of-a-kind structural scrollers without an
 * anchor (the stacked scroll region, the board, the sidebar rail, the
 * stacked widget deck) key on their unique class signature. Mirrors
 * walkScrollers' key shape so both walks degrade the same way: anything
 * that fails to resolve on the new tree is simply skipped.
 */
function walkRootScrollers(
	el: Element,
	anchor: string,
	siblingIndex: number,
	visit: (el: Element, key: string) => void,
): void {
	const ownId = rootAnchorIdOf(el);
	visit(el, scrollKey(el, ownId ?? anchor, siblingIndex));
	const seen = new Map<string, number>();
	for (const child of Array.from(el.children)) {
		const signature = classSignature(child);
		const childId = rootAnchorIdOf(child);
		const childIndex = childId ? 0 : (seen.get(signature) ?? 0);
		seen.set(signature, (seen.get(signature) ?? 0) + 1);
		walkRootScrollers(child, ownId ?? anchor, childIndex, visit);
	}
}

/**
 * Snapshot top/left of every scrolled element under `root`, `root` itself
 * included (the root scrolls on mobile). Used by the full dashboard render:
 * the previous targeted saves missed the stacked widget deck — its
 * horizontal scroll jumped back to the first column on every re-render,
 * because detaching and re-attaching the widgets container (even when the
 * exact node is reused) resets scroll state.
 */
export function captureRootScrollState(root: Element): ScrollStateMap {
	const states: ScrollStateMap = new Map();
	walkRootScrollers(root, '', 0, (el, key) => {
		if (el.scrollTop > 0 || el.scrollLeft > 0) {
			states.set(key, { top: el.scrollTop, left: el.scrollLeft });
		}
	});
	return states;
}

/** Replay a whole-root snapshot onto `root`; unresolvable keys are ignored. */
export function restoreRootScrollState(root: Element, states: ScrollStateMap): void {
	if (states.size === 0) return;
	walkRootScrollers(root, '', 0, (el, key) => {
		const state = states.get(key);
		if (!state) return;
		el.scrollTop = state.top;
		el.scrollLeft = state.left;
	});
}

/** Replay a snapshot onto `root`. Keys that no longer resolve are ignored. */
export function restoreScrollStates(root: Element, states: ScrollStateMap): void {
	if (states.size === 0) return;
	walkScrollers(root, '', (el, key) => {
		const state = states.get(key);
		if (!state) return;
		el.scrollTop = state.top;
		el.scrollLeft = state.left;
	});
}
