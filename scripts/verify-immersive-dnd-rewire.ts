/**
 * Verifies that immersive TILE DRAGGING survives in-place section refreshes.
 *
 * The bug: the two mid-session refresh paths (refreshSectionInPlace and the
 * vault-batch refreshSectionsFor) clear `dndCleanupFns` to drop the swapped-
 * out tiles' card-deck listeners — but that same array also carries the
 * cleanup of setupImmersiveDnD / setupImmersiveTileMenu, whose whole-tile
 * move-drag + context menu live on the SURVIVING grid. The wipe removed the
 * grid's pointerdown listener and nothing re-armed it: the board looked
 * normal yet tiles could not be dragged until a full re-render (the user's
 * "return from a note, cards can't be dragged; lock → edit layout restores
 * them" report — the wand toggle is what forces the full render).
 *
 * 1. Mechanism: setupImmersiveDnD registers a grid pointerdown listener and
 *    a cleanup that removes it; re-running the setup (what
 *    view.rewireImmersiveGridDnD does) re-arms dragging on the same grid.
 * 2. Same for setupImmersiveTileMenu's contextmenu listener.
 * 3. view.ts wiring: BOTH dndCleanupFns wipe sites re-wire the immersive
 *    grid DnD afterwards, and the wand toggle flips the grid's drag lock in
 *    lockstep with its visual state.
 *
 * Run: `npm run test:immersive-dnd-rewire`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setupImmersiveDnD, setupImmersiveTileMenu } from '../src/immersive';
import type { ImmersiveItem } from '../src/immersive-grid';

/** Minimal EventTarget-style grid spy: records listeners, no DOM needed —
 *  both setups only register listeners at setup time. */
function makeGridSpy() {
	const listeners = new Map<string, Array<() => void>>();
	const grid = {
		dataset: { layoutLocked: 'false' } as Record<string, string>,
		addEventListener(type: string, fn: () => void) {
			let arr = listeners.get(type);
			if (!arr) { arr = []; listeners.set(type, arr); }
			arr.push(fn);
		},
		removeEventListener(type: string, fn: () => void) {
			const arr = listeners.get(type);
			if (!arr) return;
			const i = arr.indexOf(fn);
			if (i >= 0) arr.splice(i, 1);
		},
	};
	return { grid: grid as unknown as HTMLElement, listeners };
}

function run(): void {
	// setupImmersiveDnD's cleanup calls endSession(null) → touches the
	// Obsidian-only `activeDocument` global for the body class sweep.
	(globalThis as unknown as Record<string, unknown>).activeDocument = {
		body: { removeClass: () => {}, addClass: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	};

	const items: ImmersiveItem[] = [{ id: 'section:notes', w: 3, h: 10 }];

	// 1. Tile-move DnD: the wipe → rewire cycle restores the listener.
	{
		const { grid, listeners } = makeGridSpy();
		const cleanups: Array<() => void> = [];
		setupImmersiveDnD(grid, () => items, () => {}, cleanups);
		assert.ok((listeners.get('pointerdown')?.length ?? 0) >= 1, '1: setup registered the grid pointerdown listener');

		// THE WIPE (what refreshSectionInPlace / refreshSectionsFor did):
		for (const fn of cleanups) fn();
		assert.equal(listeners.get('pointerdown')?.length ?? 0, 0, '1: the wipe removed the pointerdown listener → dragging dead');

		// THE REWIRE (view.rewireImmersiveGridDnD): re-running the setup on
		// the SAME (surviving) grid re-arms tile dragging.
		const cleanups2: Array<() => void> = [];
		setupImmersiveDnD(grid, () => items, () => {}, cleanups2);
		assert.ok((listeners.get('pointerdown')?.length ?? 0) >= 1, '1: the rewire re-armed tile dragging on the surviving grid');
		for (const fn of cleanups2) fn();
	}

	// 2. Tile context menu: same wipe → rewire cycle.
	{
		const { grid, listeners } = makeGridSpy();
		const cleanups: Array<() => void> = [];
		setupImmersiveTileMenu(grid, () => {}, cleanups);
		assert.equal(listeners.get('contextmenu')?.length, 1, '2: setup registered the contextmenu listener');
		for (const fn of cleanups) fn();
		assert.equal(listeners.get('contextmenu')?.length ?? 0, 0, '2: the wipe removed it');
		const cleanups2: Array<() => void> = [];
		setupImmersiveTileMenu(grid, () => {}, cleanups2);
		assert.equal(listeners.get('contextmenu')?.length, 1, '2: the rewire restored it');
	}

	// 3. view.ts wiring: both wipe sites re-wire, and the wand keeps the
	//    drag lock in sync with its visual state.
	const view = readFileSync('src/view.ts', 'utf8');
	assert.ok(view.includes('private rewireImmersiveGridDnD'), '3: the rewire helper exists');
	assert.ok(
		view.includes('setupImmersiveDnD(kanban, () => this.immItems, next => this.commitImmersiveItems(next), this.dndCleanupFns)')
		&& view.includes('setupImmersiveTileMenu(kanban, id => void this.removeImmersiveItem(id), this.dndCleanupFns)'),
		'3: the rewire re-arms tile DnD + tile menu on the kanban',
	);
	// refreshSectionInPlace: wipe → setupDragAndDrop → rewire.
	{
		const idx = view.indexOf('setupDragAndDrop(kanban, callbacks, this.dndCleanupFns, { skipSectionGrip: isImmersiveLayout(this.plugin.settings, this.data) });');
		assert.ok(idx >= 0, '3: refreshSectionInPlace wipe site found');
		const tail = view.slice(idx, idx + 400);
		assert.ok(tail.includes('this.rewireImmersiveGridDnD(kanban)'), '3: refreshSectionInPlace re-wires the grid DnD after the wipe');
	}
	// refreshSectionsFor (vault batch): wipe → setupDragAndDrop → rewire.
	{
		const idx = view.indexOf("setupDragAndDrop(kanban, callbacks, this.dndCleanupFns, { skipSectionGrip: immersive });");
		assert.ok(idx >= 0, '3: refreshSectionsFor wipe site found');
		const tail = view.slice(idx, idx + 400);
		assert.ok(tail.includes('this.rewireImmersiveGridDnD(kanban)'), '3: refreshSectionsFor re-wires the grid DnD after the wipe');
	}
	// The wand handler flips the drag guard with the visual state.
	const immersive = readFileSync('src/immersive.ts', 'utf8');
	assert.ok(
		/grid\.dataset\.layoutLocked = editing \? 'false' : 'true';/.test(immersive),
		'3: the wand toggle writes grid.dataset.layoutLocked in lockstep',
	);

	console.log('verify-immersive-dnd-rewire: all checks passed');
}

run();
