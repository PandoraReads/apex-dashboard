/**
 * Verifies the section navigation rail (src/section-rail.ts):
 *
 * 1. Under two sections no rail mounts.
 * 2. With sections: one dash item per row, names as data-name, and the dashes
 *    stay neutral (no column-color tinting — Rae rejected colored dashes).
 * 3. "Current" dash = the section with the largest visible overlap; a scroll
 *    fired inside the board (any descendant scroller) re-runs the pick.
 * 4. Click locates: scrollIntoView(center) on the row — re-queried lazily, so
 *    a row replaced by an in-place refresh is still found (no stale refs).
 * 5. Re-mount on the same host swaps hooks without accumulation.
 * 6. Auto-hide: the right-edge cursor strip reveals, leaving fades, keyboard
 *    focus reveals (matchMedia stubbed to a pointer device).
 *
 * Run: `npm run test:section-rail`
 */
import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { renderSectionRail } from '../src/section-rail';

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
const rect = (top: number, bottom: number): Rect => ({ top, bottom, right: 1000, left: 0, width: 1000, height: bottom - top });

function withRect(el: El, r: Rect): El {
	(el as unknown as { getBoundingClientRect: () => Rect }).getBoundingClientRect = () => r;
	return el;
}

/** renderSectionRail types against the real DOM; the harness swaps in El. */
const mount = (host: El, rowCount: number, names: string[]): El | null =>
	renderSectionRail(host as unknown as HTMLElement, rowCount, names) as unknown as El | null;

// --- 1. Fewer than two sections: nothing mounts. ---
{
	const host = new El('div');
	const rail = mount(host, 1, ['唯一分区']);
	assert.equal(rail, null, 'single section mounts no rail');
	assert.equal(findByClass(host, 'dashboard-section-rail').length, 0, 'no rail in the DOM');
}

// --- 2-4. Three sections: structure, neutrality, active pick, click locate. ---
{
	const host = new El('div');
	const board = host.createDiv({ cls: 'dashboard-kanban' });
	const mkRow = (name: string): El => {
		const row = board.createDiv({ cls: 'dashboard-section-row' });
		row.setAttribute('data-column', name);
		return row;
	};
	const rows = [mkRow('日记'), mkRow('项目'), mkRow('阅读')];

	// Rects BEFORE mounting: updateActive runs synchronously inside the mount.
	withRect(host, rect(0, 100));
	withRect(rows[0]!, rect(0, 40));
	withRect(rows[1]!, rect(30, 120)); // overlap 70 — the winner
	withRect(rows[2]!, rect(90, 200)); // overlap 10

	const rail = mount(host, rows.length, ['日记', '项目', '阅读']);
	assert.ok(rail, 'rail mounts for three sections');
	const items = findByClass(rail!, 'dashboard-section-rail-item');
	assert.equal(items.length, 3, 'one item per section');
	assert.deepEqual(items.map(item => item.getAttribute('data-name')), ['日记', '项目', '阅读'], 'names ride the items');
	assert.ok(items.every(item => item.style.getPropertyValue('--rail-color') === ''), 'dashes stay neutral — no column-color tinting');

	// --- 3. Active: the row owning the most viewport height wins. ---
	assert.ok(findByClass(rail!, 'dashboard-section-rail-item')[1]!.hasClass('is-active'), 'largest-overlap section lit at mount');
	assert.ok(!findByClass(rail!, 'dashboard-section-rail-item')[0]!.hasClass('is-active'));
	assert.ok(!findByClass(rail!, 'dashboard-section-rail-item')[2]!.hasClass('is-active'));

	// A scroll inside the board re-runs the pick (bubbles to the host hook).
	withRect(rows[1]!, rect(0, 20)); // now nearly gone
	withRect(rows[2]!, rect(0, 100)); // fully visible
	board.dispatchEvent({ type: 'scroll', target: board });
	assert.ok(findByClass(rail!, 'dashboard-section-rail-item')[2]!.hasClass('is-active'), 'scroll re-picks the current dash');
	assert.ok(!findByClass(rail!, 'dashboard-section-rail-item')[1]!.hasClass('is-active'));

	// --- 4. Click locates the (lazily re-queried) row. ---
	let located: string | null = null;
	const patchScrollIntoView = (row: El, tag: string): void => {
		(row as unknown as { scrollIntoView: (opts: unknown) => void }).scrollIntoView = (opts: unknown) => {
			located = `${tag}:${JSON.stringify(opts)}`;
		};
	};
	patchScrollIntoView(rows[0]!, 'old');
	// In-place refresh replaced row 3 with a fresh element.
	rows[2]!.remove();
	const fresh = mkRow('阅读');
	patchScrollIntoView(fresh, 'fresh');
	findByClass(rail!, 'dashboard-section-rail-item')[0]!.click();
	assert.equal(located, 'old:{"behavior":"smooth","block":"center","inline":"nearest"}', 'click centers the row');
	findByClass(rail!, 'dashboard-section-rail-item')[2]!.click();
	assert.equal(located, 'fresh:{"behavior":"smooth","block":"center","inline":"nearest"}', 'replaced row still locatable (lazy re-query)');

	// --- 5. Re-mount on the same host: the previous scroll hook detaches
	// (the host survives renders), and the new rail picks up live rects. ---
	const rail2 = mount(host, rows.length, ['日记', '项目', '阅读']);
	assert.ok(rail2 && rail2 !== rail, 're-mount builds a fresh rail');
	assert.ok(!findByClass(rail2!, 'dashboard-section-rail-item')[1]!.hasClass('is-active'), 'fresh rail starts unlit');
	withRect(rows[0]!, rect(0, 10)); // row 0 nearly gone
	withRect(rows[1]!, rect(0, 100)); // row 1 fully visible now
	board.dispatchEvent({ type: 'scroll', target: board });
	assert.ok(findByClass(rail2!, 'dashboard-section-rail-item')[1]!.hasClass('is-active'), 're-mounted rail tracks scroll');
}

// --- 6. Auto-hide (pointer devices): reveal on the right-edge strip,
// fade on leave, reveal for keyboard focus. ---
{
	// Node has no matchMedia — arm the module's hover-capability probe.
	(globalThis as unknown as { matchMedia: unknown }).matchMedia = (): { matches: boolean } => ({ matches: true });
	const host = new El('div');
	withRect(host, rect(0, 100)); // right = 1000 → strip is x ∈ [964, 1002]
	const board = host.createDiv({ cls: 'dashboard-kanban' });
	for (const name of ['一', '二', '三']) {
		const row = board.createDiv({ cls: 'dashboard-section-row' });
		row.setAttribute('data-column', name);
	}
	const rail = mount(host, 3, ['一', '二', '三']);
	assert.ok(rail, 'rail mounts');
	assert.ok(!rail!.hasClass('is-revealed'), 'starts hidden (fully invisible)');

	host.dispatchEvent({ type: 'mousemove', target: board, clientX: 500, clientY: 50 });
	assert.ok(!rail!.hasClass('is-revealed'), 'cursor mid-board keeps it hidden');

	host.dispatchEvent({ type: 'mousemove', target: board, clientX: 990, clientY: 50 });
	assert.ok(rail!.hasClass('is-revealed'), 'cursor in the right-edge strip reveals it');

	host.dispatchEvent({ type: 'mousemove', target: board, clientX: 990, clientY: 50 });
	host.dispatchEvent({ type: 'mousemove', target: board, clientX: 700, clientY: 50 });
	assert.ok(!rail!.hasClass('is-revealed'), 'leaving the strip fades it out again');

	host.dispatchEvent({ type: 'mousemove', target: board, clientX: 1000, clientY: 50 });
	assert.ok(rail!.hasClass('is-revealed'), 're-reveal works');
	host.dispatchEvent({ type: 'mouseleave', target: host });
	assert.ok(!rail!.hasClass('is-revealed'), 'host mouseleave hides it');

	rail!.dispatchEvent({ type: 'focusin', target: rail });
	assert.ok(rail!.hasClass('is-revealed'), 'keyboard focus reveals invisible dashes');
	rail!.dispatchEvent({ type: 'focusout', target: rail });
	assert.ok(!rail!.hasClass('is-revealed'), 'focus leaving hides it again');

	// Re-mount disposes the hover hooks with the scroll hook (no accumulation
	// on the persistent host).
	const rail2 = mount(host, 3, ['一', '二', '三']);
	assert.ok(rail2 && !rail2!.hasClass('is-revealed'), 're-mounted rail starts hidden');
}

console.log('verify-section-rail: all assertions passed');
