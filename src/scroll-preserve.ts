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
