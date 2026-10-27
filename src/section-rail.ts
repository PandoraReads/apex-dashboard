import { t } from './i18n';

/**
 * Section navigation rail — the semi-transparent dash column pinned to the
 * right edge of the normal (non-immersive) workspace. One short dash per
 * section row; click (or Enter) centers that section in whichever ancestor
 * scrolls (the side layout scrolls the kanban vertically; the stacked layout
 * scrolls the region; on phones the root itself scrolls — scrollIntoView
 * walks them all). Hovering a dash slides out the section's name, and the
 * dash whose section owns the most viewport height stays lit as "current".
 *
 * Mounted by view.render into the positioned root; rebuilt with every render
 * (so add/remove/rename rides along for free). Rows are re-queried lazily by
 * index so in-place section refreshes (replaceWith) can't strand stale
 * elements under live dashes.
 *
 * Auto-hide (pointer-capable devices only): the rail is fully invisible until
 * the cursor enters a reveal strip along the host's right edge — a proximity
 * check on mousemove, NOT a hover zone element, so nothing ever blocks the
 * clicks the invisible rail would otherwise sit on. Keyboard focus reveals it
 * too (tabbing into the dashes must not land on invisible targets); touch
 * devices keep the rail permanently visible (no mouse to trigger it).
 */

export const SECTION_RAIL_MIN_SECTIONS = 2;

/** How far from the host's right edge the cursor still reveals the rail. */
export const SECTION_RAIL_REVEAL_ZONE_PX = 36;

/** Per-surface tweaks for {@link renderSectionRail}. */
export interface SectionRailOptions {
	/** Row selector inside `rowsRoot` (default: the dashboard's section rows). */
	rowsSelector?: string;
	/** Where rows are looked up (default: the mount host itself). */
	rowsRoot?: HTMLElement | null;
	/** Edge the rail pins to (default right). The material library mounts left. */
	side?: 'left' | 'right';
}

/** The host element persists across renders (only its children rebuild), so
 *  each mount first detaches the previous render's hooks — otherwise the
 *  scroll listener would pile up per render. */
const railDisposers = new WeakMap<HTMLElement, () => void>();

/** First ancestor between `from` (exclusive) and `host` (inclusive) that
 *  actually scrolls vertically. Stops AT the host: scrollers beyond the
 *  dashboard root (page, workspace split) are never ours to move. Returns
 *  null where computed styles are unavailable (Node harness) so the caller
 *  falls back to scrollIntoView. */
function nearestScroller(from: HTMLElement, host: HTMLElement): HTMLElement | null {
	if (typeof getComputedStyle !== 'function') return null;
	const scrolls = (el: HTMLElement): boolean => {
		const style = getComputedStyle(el);
		return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
	};
	for (let cur: HTMLElement | null = from.parentElement; cur && cur !== host; cur = cur.parentElement) {
		if (scrolls(cur)) return cur;
	}
	return scrolls(host) ? host : null;
}

export function renderSectionRail(
	host: HTMLElement,
	rowCount: number,
	/** Section display names, index-aligned with the rendered rows. */
	names: readonly string[],
	options: SectionRailOptions = {},
): HTMLElement | null {
	railDisposers.get(host)?.();
	const disposers: Array<() => void> = [];
	railDisposers.set(host, () => { for (const dispose of disposers) dispose(); });
	if (rowCount < SECTION_RAIL_MIN_SECTIONS) return null;

	const rowsRoot = options.rowsRoot ?? host;
	const rowsSelector = options.rowsSelector ?? '.dashboard-section-row';
	const rows = (): HTMLElement[] =>
		Array.from(rowsRoot.querySelectorAll<HTMLElement>(rowsSelector));
	const rail = host.createDiv({
		cls: 'dashboard-section-rail' + (options.side === 'left' ? ' dashboard-section-rail--left' : ''),
		attr: { role: 'navigation', 'aria-label': t('rail.sections') },
	});

	const items: HTMLElement[] = [];
	for (let i = 0; i < rowCount; i++) {
		const name = names[i] ?? '';
		const item = rail.createDiv({
			cls: 'dashboard-section-rail-item',
			attr: { role: 'button', tabindex: '0', 'data-name': name, 'aria-label': name },
		});
		// Deliberately UNTINTED: column-color dashes read as visual noise on
		// a busy board (Rae) — the stylesheet keeps the rail a faint neutral
		// gray in every state.
		item.createDiv({ cls: 'dashboard-section-rail-dash' });
		// Center the row in its nearest scrollable ancestor INSIDE the
		// dashboard root. scrollIntoView(block:center) would also scroll
		// whatever scrollable sits beyond the root (the page in embedded
		// contexts, a split workspace) — the banner must never scroll away.
		const locate = (): void => {
			const row = rows()[i];
			// Detached (replaced mid-session) or missing: a no-op, the next
			// full render re-links the rail.
			if (!row) return;
			const scroller = nearestScroller(row, host);
			if (scroller) {
				const sr = scroller.getBoundingClientRect();
				const rr = row.getBoundingClientRect();
				scroller.scrollBy({
					top: (rr.top + rr.height / 2) - (sr.top + sr.height / 2),
					behavior: 'smooth',
				});
				return;
			}
			row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
		};
		item.addEventListener('click', locate);
		item.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				locate();
			}
		});
		items.push(item);
	}

	// "Current" = the section with the largest share of visible height,
	// measured against the rows' scrolling viewport (the kanban in the side
	// layout, the stacked region, the root on phones) — NOT the whole root,
	// whose banner band would inflate the topmost row's score.
	const updateActive = (): void => {
		const live = rows();
		if (live.length === 0) return;
		const view = (nearestScroller(live[0]!, host) ?? host).getBoundingClientRect();
		let best = -1;
		let bestOverlap = 0;
		for (let i = 0; i < live.length && i < items.length; i++) {
			const r = live[i]!.getBoundingClientRect();
			const overlap = Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top));
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				best = i;
			}
		}
		items.forEach((item, i) => item.toggleClass('is-active', i === best));
	};

	// Capture-phase scroll listener on the host: scroll events fired by ANY
	// descendant scroller (kanban, stacked region, mobile root) arrive here,
	// whatever their bubbling semantics. Disposed by the next mount (above) —
	// the host itself survives renders.
	let queued = false;
	const scheduleUpdate = (): void => {
		if (queued) return;
		queued = true;
		const run = (): void => {
			queued = false;
			updateActive();
		};
		// rAF-coalesced in the app; direct in Node (verify scripts — no window).
		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
		else run();
	};
	host.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
	disposers.push(() => host.removeEventListener('scroll', scheduleUpdate, { capture: true }));

	// Auto-hide: reveal while the cursor rides the right-edge strip, fade out
	// the moment it leaves (mouse or host). Keyboard focus reveals as well.
	const hoverCapable = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
	if (hoverCapable) {
		let revealed = false;
		const setRevealed = (on: boolean): void => {
			if (revealed === on) return;
			revealed = on;
			rail.toggleClass('is-revealed', on);
		};
		const onMouseMove = (e: MouseEvent): void => {
			const rect = host.getBoundingClientRect();
			// Proximity strip along the rail's own edge (right by default, left
			// for the material library's left-mounted rail).
			const onStrip = options.side === 'left'
				? e.clientX >= rect.left - 2 && e.clientX <= rect.left + SECTION_RAIL_REVEAL_ZONE_PX
				: e.clientX >= rect.right - SECTION_RAIL_REVEAL_ZONE_PX && e.clientX <= rect.right + 2;
			setRevealed(onStrip);
		};
		const onMouseLeave = (): void => setRevealed(false);
		host.addEventListener('mousemove', onMouseMove, { passive: true });
		host.addEventListener('mouseleave', onMouseLeave);
		disposers.push(() => {
			host.removeEventListener('mousemove', onMouseMove);
			host.removeEventListener('mouseleave', onMouseLeave);
		});
		// Tab focus must never land on invisible dashes.
		rail.addEventListener('focusin', () => setRevealed(true));
		rail.addEventListener('focusout', () => setRevealed(false));
	}

	updateActive();
	return rail;
}
