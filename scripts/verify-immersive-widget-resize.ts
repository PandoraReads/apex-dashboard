/**
 * Verifies that immersive RESIZE HANDLES stay alive for CACHED widget tiles.
 *
 * The bug: widget tiles are cached across re-renders (immWidgetEls) and
 * re-parented into a fresh grid; attachImmersiveResizeHandle skips them
 * (strips already exist), so their pointerdown listeners kept the grid
 * captured at ATTACH time — the old, detached grid. Detached grids measure
 * 0×0, the drag math produced garbage spans, and every data widget
 * (pomodoro/expense/weather/music/countdown) silently stopped resizing while
 * section tiles (rebuilt fresh each render) kept working.
 *
 * 1. attachImmersiveResizeHandle reads the grid at PRESS time: a tile moved
 *    into a NEW locked grid must be non-resizable (locked honored), and a
 *    tile on the live unlocked grid must still arm the resize.
 * 2. view.ts re-binds handles for reused tiles: stale strips are removed
 *    before re-attach, so listeners + commit closures always bind to the
 *    current grid.
 *
 * Run: `npm run test:immersive-widget-resize`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { El } from './mini-dom';
import { attachImmersiveResizeHandle } from '../src/immersive';
import type { ImmersiveItem } from '../src/immersive-grid';

function run(): void {
	const items: ImmersiveItem[] = [{ id: 'widget:pomodoro', w: 3, h: 15 }];

	// attachImmersiveResizeHandle falls back to the Obsidian-only
	// `activeDocument` global inside startGuardedDrag; a Node shim with the
	// mini-dom surface keeps the unlocked-press path reachable.
	const body = new El('body');
	(globalThis as unknown as Record<string, unknown>).activeDocument = {
		body,
		addEventListener: () => {},
		removeEventListener: () => {},
	};

	const grid1 = new El('div');
	const tile = grid1.createDiv({ cls: 'dashboard-sidebar-widget' });
	tile.dataset.immId = 'widget:pomodoro';
	tile.style.gridColumn = '1 / span 3';
	tile.style.gridRow = '1 / span 15';

	// mini-dom lacks the standard isConnected; startResize checks it on both
	// the tile and its grid before arming. Every node in this test is part of
	// a live tree (reparenting keeps them attached), so a constant true is
	// the faithful stand-in.
	const withIsConnected = (el: El): void => {
		Object.defineProperty(el, 'isConnected', { get: () => true });
	};
	withIsConnected(tile);
	withIsConnected(grid1);

	const commits: ImmersiveItem[][] = [];
	attachImmersiveResizeHandle(
		tile as unknown as HTMLElement,
		'widget:pomodoro',
		() => items,
		next => { commits.push(next); },
	);

	const strip = tile.querySelector('.dashboard-imm-resize-h');
	assert.ok(strip, '1: attach created the edge strips');
	assert.ok(tile.querySelector('.dashboard-imm-resize-v') && tile.querySelector('.dashboard-imm-resize-handle'), '1: v-strip + corner present');

	// 1a. Live unlocked grid: pointerdown arms the resize.
	strip!.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 40, pointerId: 1, button: 0 });
	assert.ok(tile.hasClass('dashboard-imm-tile--resizing'), '1a: press on the live grid arms the resize');
	assert.equal(commits.length, 0, '1a: no commit before release');
	// Release the 1a gesture (pointerup lands on the drag shield) so its
	// armed state doesn't bleed into the reparenting assertions.
	const shield = body.querySelector('.dashboard-drag-shield');
	assert.ok(shield, '1a: guarded-drag shield mounted on the document body');
	shield!.dispatchEvent({ type: 'pointerup', clientX: 100, clientY: 40, pointerId: 1, button: 0 });
	assert.ok(!tile.hasClass('dashboard-imm-tile--resizing'), '1a: release disarms the resize');
	assert.equal(commits.length, 0, '1a: no movement → no commit');

	// 1b. THE REGRESSION: the tile is re-parented into a fresh grid (what a
	// re-render does to cached widget tiles) whose layout is LOCKED. The
	// press must honor the NEW grid's lock — with the old captured-grid bug
	// it consulted the stale unlocked grid and armed anyway.
	const grid2 = new El('div');
	grid2.dataset.layoutLocked = 'true';
	withIsConnected(grid2);
	tile.remove();
	grid2.appendChild(tile);
	strip!.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 40, pointerId: 2, button: 0 });
	assert.ok(!tile.hasClass('dashboard-imm-tile--resizing'), '1b: press consults the CURRENT grid (locked → no resize)');

	// 1c. Same reparenting with the new grid UNLOCKED: still arms.
	grid2.dataset.layoutLocked = 'false';
	strip!.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 40, pointerId: 3, button: 0 });
	assert.ok(tile.hasClass('dashboard-imm-tile--resizing'), '1c: press on the re-parented unlocked grid still arms');

	// 2. view.ts re-binds handles for reused tiles: stale strips removed
	//    before attach, and the commit closure reads the tile's CURRENT
	//    parent instead of a captured grid.
	const view = readFileSync('src/view.ts', 'utf8');
	assert.ok(view.includes("'.dashboard-imm-resize-h, .dashboard-imm-resize-v, .dashboard-imm-resize-handle'"), '2: stale strips removed before re-attach');
	assert.ok(view.includes('(el.parentElement as HTMLElement | null) ?? grid'), '2: commit resolves the grid from the tile at commit time');
	const immersive = readFileSync('src/immersive.ts', 'utf8');
	assert.ok(!/if \(!tile\.querySelector\('\.dashboard-imm-resize-h'\)\) return;\s*\n\tconst grid = tile\.parentElement;/.test(immersive), '2: grid no longer captured at attach time');

	console.log('verify-immersive-widget-resize: all checks passed');
}

run();
