/**
 * Verifies the music widget's FLOATING panel (search / playlist):
 *
 * 1. Search panel — clicking the header search opens a body-level
 *    `.dashboard-sidebar-music-popover` (NOT an in-card row) carrying the
 *    input + results + import row; the toggle gets --active.
 * 2. Search flow — typing debounces into searchMusic (network stub) and
 *    renders result rows in the popover; the row + adds to the playlist.
 * 3. Toggle + switch — clicking search again closes the popover and clears
 *    --active; opening the playlist swaps the popover's CONTENT in place
 *    (one popover, playlist rows + clear foot, playlist toggle active).
 * 4. refreshMusicWidget still refreshes rows inside the popover (the
 *    timeupdate repaint path must not rebuild the input the user types in).
 * 5. Dismissal — pointerdown outside (not on popover, not on the widget
 *    card) closes; Escape closes.
 * 6. Follow loop — the per-frame anchor tick closes the popover once the
 *    host card leaves the DOM (a re-render replaced the widget).
 *
 * Blind spot: mini-dom checks structure, not computed styles — the popover's
 * fixed positioning/viewport clamp CSS is untested here (see
 * /tmp file:// repro for the visual layer).
 *
 * Run: `npm run test:music-popover`
 */
import { strict as assert } from 'node:assert';
import { Notice } from 'obsidian';
import { renderSidebarMusicWidget, refreshMusicWidget } from '../src/music-widget';
import { MusicService, registerMusicService } from '../src/music-service';
import type { MusicTrack } from '../src/types';
import { El, findByClass } from './mini-dom';
import { resetNetwork } from './music-network-stub';
import { setCookies } from './music-electron-stub';

// ---- Environment: stub document + rAF pump + audio factory -----------------

type DocListener = (ev: { target?: El; key?: string }) => void;
const docListeners = new Map<string, DocListener[]>();
const frames = new Map<number, () => void>();
let nextFrameId = 1;
/** Advance the anchor-follow loop by one frame. */
const pump = (): void => {
	const first = frames.entries().next();
	if (first.done) return;
	frames.delete(first.value[0]);
	first.value[1]();
};

const body = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	body,
	querySelector: () => null,
	defaultView: null, // no layout engine: position() skips geometry, keeps content
	addEventListener: (type: string, fn: DocListener) => {
		docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
	},
	removeEventListener: (type: string, fn: DocListener) => {
		docListeners.set(type, (docListeners.get(type) ?? []).filter(f => f !== fn));
	},
};
const docDispatch = (type: string, ev: { target?: El; key?: string }): void => {
	for (const fn of [...(docListeners.get(type) ?? [])]) fn(ev);
};

Object.assign(globalThis, {
	window: {
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (fn: () => void): number => {
			const id = nextFrameId++;
			frames.set(id, fn);
			return id;
		},
		// Real-DOM semantics: a cancelled tick never runs (stale ticks from a
		// closed panel would otherwise sit in the queue forever).
		cancelAnimationFrame: (id: number): void => {
			frames.delete(id);
		},
	},
});

/** Minimal audio stand-in (see verify-music-account). */
class FakeAudio {
	preload = '';
	volume = 1;
	currentTime = 0;
	duration = 0;
	src: string | null = null;
	addEventListener(): void {}
	removeEventListener(): void {}
	pause(): void {}
	load(): void {}
	getAttribute(): string | null { return this.src; }
	removeAttribute(): void { this.src = null; }
	setAttribute(): void {}
	async play(): Promise<void> {}
}
(globalThis as unknown as { createEl: (tag: string) => unknown }).createEl = (tag: string): unknown => {
	if (tag !== 'audio') throw new Error(`unexpected createEl('${tag}')`);
	return new FakeAudio();
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
const notices = (): string[] => (Notice as unknown as { messages: string[] }).messages;
const track = (id: number, name: string): MusicTrack =>
	({ id, name, artist: `ar${id}`, album: '', durationMs: 1000, fee: 1, picUrl: undefined });

async function run(): Promise<void> {
	// ---- Service + widget -------------------------------------------------------

	setCookies([{ name: 'MUSIC_U', value: 'member' }]);
	const svc = new MusicService({
		app: { vault: { getName: () => 'unit-music' } },
		settings: {},
		saveSettings: async () => {},
	} as unknown as ConstructorParameters<typeof MusicService>[0]);
	registerMusicService(svc);

	const container = body.createDiv({ cls: 'host-panel' });
	renderSidebarMusicWidget(container as unknown as HTMLElement);
	const widget = findByClass(container, 'dashboard-sidebar-music')[0]!;
	assert.ok(widget, 'widget rendered');
	const top = findByClass(widget, 'dashboard-sidebar-music-top')[0]!;
	const [searchBtn, listBtn] = findByClass(top, 'dashboard-sidebar-music-icon-btn');
	assert.ok(searchBtn && listBtn, 'header search + list toggles rendered');

	const popoverOf = (): El[] => findByClass(body, 'dashboard-sidebar-music-popover');
	const resultsOf = (pop: El): El[] => findByClass(pop, 'dashboard-sidebar-music-row');

	// ---- 1. Search panel opens as a body-level popover ---------------------------

	assert.equal(popoverOf().length, 0, 'no popover before any toggle');
	searchBtn.click();
	assert.equal(popoverOf().length, 1, 'search opens ONE body-level popover');
	let pop = popoverOf()[0]!;
	assert.ok(findByClass(pop, 'dashboard-sidebar-music-popover-body')[0], 'popover has a body container');
	assert.ok(!findByClass(widget, 'dashboard-sidebar-music-popover')[0], 'the popover is NOT inside the widget card');
	const searchInput = findByClass(pop, 'dashboard-sidebar-music-search-input')[0]!;
	assert.ok(searchInput, 'search input lives in the popover');
	assert.ok(findByClass(pop, 'dashboard-sidebar-music-results')[0], 'results container lives in the popover');
	assert.ok(findByClass(pop, 'dashboard-sidebar-music-import-input')[0], 'import row lives in the popover');
	assert.ok(searchBtn.hasClass('dashboard-sidebar-music-icon-btn--active'), 'search toggle is active');
	assert.ok(!listBtn.hasClass('dashboard-sidebar-music-icon-btn--active'), 'playlist toggle is not');

	// ---- 2. Typing debounces into searchMusic and renders rows ------------------

	resetNetwork([{ result: { songs: [
		{ id: 11, name: 'flake', artists: [{ name: 'a' }], album: {}, duration: 1000, fee: 1 },
		{ id: 12, name: 'drift', artists: [{ name: 'b' }], album: {}, duration: 1000, fee: 1 },
	] } }]);
	searchInput.value = 'flake';
	searchInput.dispatchEvent({ type: 'input', target: searchInput });
	await sleep(500); // debounce is 400ms
	assert.equal(resultsOf(pop).length, 2, 'stubbed search results rendered as rows');

	// Enter submits immediately — no debounce wait.
	resetNetwork([{ result: { songs: [{ id: 13, name: 'enter-hit', artists: [], album: {}, duration: 1000, fee: 1 }] } }]);
	searchInput.value = 'enter-hit';
	searchInput.dispatchEvent({ type: 'input', target: searchInput });
	searchInput.dispatchEvent({ type: 'keydown', target: searchInput, key: 'Enter' });
	await sleep(50); // immediate — far under the 400ms debounce
	assert.equal(resultsOf(pop).length, 1, 'Enter runs the search without waiting for the debounce');

	const seenBefore = notices().length;
	const addBtn = findByClass(resultsOf(pop)[0]!, 'dashboard-sidebar-music-row-del')[0]!;
	addBtn.click();
	assert.equal(svc.getState().playlist.length, 1, '+ button adds the track to the playlist');
	assert.equal(notices().length - seenBefore, 1, 'add confirms with a notice');

	// ---- 3. Toggle off, playlist swaps content in the same popover ---------------

	searchBtn.click();
	assert.equal(popoverOf().length, 0, 'clicking search again closes the popover');
	assert.ok(!searchBtn.hasClass('dashboard-sidebar-music-icon-btn--active'), 'toggle deactivates');

	listBtn.click();
	assert.equal(popoverOf().length, 1, 'playlist opens the popover again');
	pop = popoverOf()[0]!;
	assert.equal(resultsOf(pop).length, 1, 'playlist rows render in the popover');
	assert.ok(findByClass(pop, 'dashboard-sidebar-music-panel-foot')[0], 'clear foot rides the popover');
	assert.ok(listBtn.hasClass('dashboard-sidebar-music-icon-btn--active'), 'playlist toggle active');

	// Switching panels swaps content — still exactly ONE popover.
	searchBtn.click();
	assert.equal(popoverOf().length, 1, 'panel switch keeps one popover');
	pop = popoverOf()[0]!;
	assert.ok(findByClass(pop, 'dashboard-sidebar-music-search-input')[0], 'switched to search content');
	assert.ok(searchBtn.hasClass('dashboard-sidebar-music-icon-btn--active'));
	assert.ok(!listBtn.hasClass('dashboard-sidebar-music-icon-btn--active'), 'playlist toggle released');

	// ---- 4. refreshMusicWidget repaints rows inside the open popover -------------

	// The last query's results are still in refs.searchResults, so a refresh
	// repaints them — into the POPOVER's results container, without rebuilding
	// the input element the user may be typing into.
	const inputBefore = findByClass(pop, 'dashboard-sidebar-music-search-input')[0]!;
	const rowsBefore = findByClass(pop, 'dashboard-sidebar-music-row').length;
	assert.ok(rowsBefore > 0, 'rows present before the refresh');
	refreshMusicWidget(container as unknown as HTMLElement);
	assert.equal(findByClass(pop, 'dashboard-sidebar-music-row').length, rowsBefore,
		'refresh repaints result rows inside the popover');
	assert.equal(findByClass(pop, 'dashboard-sidebar-music-search-input')[0], inputBefore,
		'refresh does not rebuild the search input');

	// ---- 5. Dismissal: panel-style (toggle / Escape), NOT outside-click ----------

	// Clicking elsewhere on the busy dashboard must NOT eat the panel — the
	// old in-card panel never vanished on outside clicks either (this was the
	// "typed a song, clicked, results gone" regression).
	docDispatch('pointerdown', { target: new El('div') });
	assert.equal(popoverOf().length, 1, 'pointerdown outside does NOT close the popover');
	docDispatch('keydown', { key: 'Enter' });
	assert.equal(popoverOf().length, 1, 'Enter (in the doc, not the input) is no dismissal');
	docDispatch('keydown', { key: 'Escape' });
	assert.equal(popoverOf().length, 0, 'Escape closes the popover');

	// ---- 6. Follow loop closes the popover when the host card leaves the DOM -----

	searchBtn.click();
	assert.equal(popoverOf().length, 1, 'popover open for the follow-loop check');
	widget.remove(); // a re-render replaced the widget card
	pump(); // one anchor tick
	assert.equal(popoverOf().length, 0, 'host removal closes the popover on the next frame');

	svc.destroy?.();
	registerMusicService(null);

	console.log('verify-music-popover: floating search/playlist panel, flows and dismissal OK');

}

run().catch(err => { console.error(err); process.exit(1); });
