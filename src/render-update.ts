import type { DashboardData } from './types';

export type DashboardUpdateSource = 'local' | 'external';

export type DashboardRenderPlan =
	| { kind: 'none' }
	| { kind: 'sections'; names: string[] }
	| { kind: 'full' };

function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Keep local card/task mutations inside their owning sections. External file
 * changes take the conservative full-render path because parsing creates a new
 * object graph and may change any dashboard-level structure.
 */
export function planDashboardUpdate(
	previous: DashboardData | null,
	next: DashboardData,
	source: DashboardUpdateSource,
): DashboardRenderPlan {
	if (!previous || source === 'external') return { kind: 'full' };
	if (!sameValue(previous.banner, next.banner)) return { kind: 'full' };
	if (!sameValue(previous.quickActions, next.quickActions)) return { kind: 'full' };
	if (!sameValue(previous.quickActionOrder, next.quickActionOrder)) return { kind: 'full' };
	if (!sameValue(previous.hiddenPresets, next.hiddenPresets)) return { kind: 'full' };
	if (previous.columns.length !== next.columns.length) return { kind: 'full' };

	const changed: string[] = [];
	const changedIdx: number[] = [];
	for (let i = 0; i < next.columns.length; i++) {
		const before = previous.columns[i];
		const after = next.columns[i];
		if (!before || !after) return { kind: 'full' };
		// These fields determine the outer row layout/identity, so replacing only
		// the section node would leave the parent layout stale.
		if (before.name !== after.name
			|| before.sectionType !== after.sectionType
			|| before.half !== after.half
			|| before.cards.length !== after.cards.length) {
			return { kind: 'full' };
		}
		if (!sameValue(before, after)) {
			changed.push(after.name);
			changedIdx.push(i);
		}
	}

	// A width change mirrors onto the section's PAIR PARTNER (the right member
	// renders the complement basis). An in-place refresh of only the actor
	// would leave the partner carrying its pre-change inline value — after a
	// pair-divider drag that is the un-rounded live percentage, the two bases
	// sum past 100% and the pair wraps into stacked full-width rows (the
	// "pair drag breaks" bug). Pull every adjacent partner of a changed
	// column into the refresh set.
	const namesSet = new Set(changed);
	for (const i of changedIdx) {
		if (!next.columns[i]!.half) continue;
		for (const j of [i - 1, i + 1]) {
			const neighbor = next.columns[j];
			if (neighbor?.half && !namesSet.has(neighbor.name)) {
				namesSet.add(neighbor.name);
				changed.push(neighbor.name);
			}
		}
	}

	return changed.length > 0
		? { kind: 'sections', names: changed }
		: { kind: 'none' };
}

/** Resolve the settings path form to the real vault markdown path. */
export function dashboardMarkdownPath(path: string): string {
	let normalized = path.trim().replace(/^\/+/, '');
	if (!normalized.toLowerCase().endsWith('.md')) normalized += '.md';
	return normalized;
}
