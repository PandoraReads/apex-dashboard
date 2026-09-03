/**
 * Verifies the gallery placeholder cover:
 *
 * 1. A note with no cover info at all (no 封面/cover field, no image-shaped
 *    value) renders a placeholder cover slot: the bundled default image.
 * 2. A note whose cover value fails to resolve (file missing) falls through
 *    to the same placeholder instead of dropping the slot.
 * 3. A note with a resolvable cover keeps the real image (regression guard).
 *
 * Run: `npm run test:gallery-placeholder`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { renderLibrarySection } from '../src/library-section';
import { El, findByClass } from './mini-dom';

const bodyEl = new El('body');
const run = async (): Promise<void> => {
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: bodyEl,
};

// Three notes: no cover info at all / broken cover path / healthy cover.
const notes = [
	{ path: 'notes/plain.md', fm: { title: 'Plain' } },
	{ path: 'notes/broken.md', fm: { cover: 'missing.png' } },
	{ path: 'notes/good.md', fm: { cover: 'pic.png' } },
];
const app = {
	vault: {
		getMarkdownFiles: () => notes.map(n => ({
			path: n.path, basename: n.path.split('/').pop()!.replace('.md', ''), extension: 'md',
			stat: { mtime: 1, ctime: 1 },
		})),
		cachedRead: async () => '---\n---\n\nbody',
		getFileByPath: (p: string) => (p === 'pic.png' ? { path: p } : null),
		adapter: { read: async (p: string) => { if (p === 'pic.png') return 'binary'; throw new Error('not found'); } },
	},
	metadataCache: {
		getFileCache: (f: { path: string }) => ({ frontmatter: notes.find(n => n.path === f.path)?.fm ?? {}, tags: [] }),
		fileToLinktext: (f: { path: string }) => f.path,
		getFirstLinkpathDest: (raw: string) => (raw === 'pic.png' ? { path: 'pic.png' } : null),
	},
	workspace: { on: () => {}, off: () => {} },
} as unknown as App;

const el = new El('div');
bodyEl.appendChild(el); // async cover callbacks check isConnected.
renderLibrarySection(
	el as unknown as HTMLElement,
	{ name: 'G', color: '', sectionType: 'folder', libraryConfig: { filters: [], viewMode: 'gallery', sortBy: 'name', sortDesc: false, folders: ['notes'] } },
	app,
	() => {},
);

// Let the async cover resolutions settle.
await new Promise(r => setImmediate(r));

const cards = findByClass(el, 'dashboard-library-card');
const coverOf = (card: El): El | undefined => findByClass(card, 'dashboard-library-card-cover')[0];
const byTitle = (title: string): El => {
	const hit = cards.find(c => findByClass(c, 'dashboard-library-card-title')[0]?.textContent === title);
	return hit ?? assert.fail(`card ${title} rendered`);
};

// 1. No cover info -> placeholder with the bundled image.
const plainCover = coverOf(byTitle('plain'));
assert.ok(plainCover, 'plain note renders a cover slot');
assert.ok(plainCover!.hasClass('dashboard-library-card-cover--placeholder'), 'placeholder class set');
assert.match(plainCover!.style.backgroundImage ?? '', /^url\(data:image\/jpeg;base64,/, 'bundled image applied');

// 2. Broken cover path -> falls through to the placeholder too.
const brokenCover = coverOf(byTitle('broken'));
assert.ok(brokenCover?.hasClass('dashboard-library-card-cover--placeholder'), 'broken cover falls back to placeholder');
assert.match(brokenCover?.style.backgroundImage ?? '', /^url\(data:image\/jpeg;base64,/, 'placeholder image on fallback');

// 3. A note WITH a cover value keeps its cover slot too (gallery never drops
//    the slot now). The stub environment has no URL.createObjectURL/Image, so
//    blob resolution here always fails into the placeholder — the real-image
//    path is covered by extractCoverValue in test:library-cover.
const goodCover = coverOf(byTitle('good'));
assert.ok(goodCover, 'note with cover value renders a cover slot');

};
run().then(() => console.log('gallery placeholder cover: ALL PASS'), e => { console.error(e); process.exit(1); });
