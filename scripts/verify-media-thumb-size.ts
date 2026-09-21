/**
 * Verifies the media section's thumbnail-size (S/M/L) persistence:
 *
 * 1. No stored value — medium active, grid renders un-suffixed... actually the
 *    media grid always suffixes (`--small/medium/large`); assert `--medium`.
 * 2. Stored 'large' — L active on open, grid renders `--large`.
 * 3. Clicking S — saves via app.saveLocalStorage with the right key, grid
 *    re-renders `--small`.
 * 4. Stored garbage — falls back to medium.
 *
 * Run: `npm run test:media-thumb-size`
 */
import { strict as assert } from 'node:assert';
import { Menu } from 'obsidian';
import { renderMediaSection } from '../src/media-section';
import { El, findByClass } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

/** localStorage-backed app stub recording writes into `store`. */
const makeApp = (store: Record<string, string>) => {
	const img = { path: 'pics/a.png', name: 'a.png', extension: 'png', stat: { mtime: 1, ctime: 1 } };
	return {
		vault: {
			getFiles: () => [img],
			getFileByPath: (p: string) => (p === img.path ? img : null),
			adapter: { getResourcePath: (p: string) => `app://stub/${p}` },
			trash: async () => {},
		},
		loadLocalStorage: (k: string) => store[k] ?? null,
		saveLocalStorage: (k: string, v: string) => { store[k] = v; },
		metadataCache: { getFileCache: () => null, fileToLinktext: (f: { path: string }) => f.path },
		workspace: { on: () => {}, off: () => {} },
	} as unknown as Parameters<typeof renderMediaSection>[2];
};

const open = (store: Record<string, string>): { el: El } => {
	const el = new El('div');
	renderMediaSection(
		el as unknown as HTMLElement,
		{ name: 'M', color: '', sectionType: 'images' } as Parameters<typeof renderMediaSection>[1],
		makeApp(store),
		null,
		undefined,
		undefined,
	);
	return { el };
};

// Dropdown model: the collapsed button carries the current letter as text.
const activeSize = (el: El): string | undefined => findByClass(el, 'dashboard-media-size-toggle')[0]
	? findByClass(findByClass(el, 'dashboard-media-size-toggle')[0]!, 'dashboard-toolbar-dropdown-text')[0]?.textContent
	: assert.fail('size toggle rendered');
const gridSize = (el: El): string | undefined =>
	findByClass(el, 'dashboard-media-grid')[0]?.className.match(/dashboard-media-grid--(\w+)/)?.[1]
	?? assert.fail('media grid rendered');

// 1. Nothing stored: medium active, grid --medium.
const store1: Record<string, string> = {};
const a = open(store1);
assert.equal(activeSize(a.el), 'M', 'medium active with no stored value');
assert.equal(gridSize(a.el), 'medium', 'grid renders medium');

// 2. Stored large: L active on open, grid --large, no write on open.
const store2: Record<string, string> = { 'apex-dashboard-media-thumb-size': 'large' };
const b = open(store2);
assert.equal(activeSize(b.el), 'L', 'stored large restores L');
assert.equal(gridSize(b.el), 'large', 'grid renders large');

// 3. Pick Small through the dropdown menu: opens via the collapsed button
//    click (native Menu stub records items), then clicking the first item
//    (small) persists with the exact key and re-renders small.
const store3: Record<string, string> = {};
const c = open(store3);
findByClass(findByClass(c.el, 'dashboard-media-size-toggle')[0]!, 'dashboard-toolbar-dropdown')[0]!.click();
// tsc resolves the real obsidian types (no static last there); the runtime
// alias points at the stub, whose Menu.last exists — bridge with a cast.
const menu = (Menu as unknown as { last: { items: Array<{ click(): void }> } | null }).last;
assert.ok(menu, 'dropdown click opens a menu');
assert.equal(menu!.items.length, 3, 'menu lists the three sizes');
menu!.items[0]!.click();
assert.equal(store3['apex-dashboard-media-thumb-size'], 'small', 'menu pick saves to localStorage');
assert.equal(gridSize(c.el), 'small', 'grid re-renders small');
assert.equal(activeSize(c.el), 'S', 'S shown on the collapsed button after pick');

// 4. Garbage stored: falls back to medium.
const store4: Record<string, string> = { 'apex-dashboard-media-thumb-size': 'huge' };
const d = open(store4);
assert.equal(activeSize(d.el), 'M', 'garbage falls back to medium');

console.log('media thumb size persistence: ALL PASS');
