/**
 * Verifies the hover-reveal card delete button (grid / gallery / kanban):
 *
 * 1. Every card in all three card views carries a
 *    button.dashboard-library-card-delete (trash icon, 删除 aria-label).
 * 2. Clicking it does NOT open the note (stopPropagation holds — the card's
 *    open handler would throw against the stub workspace, so a clean click
 *    proves propagation stopped; the confirm dialog takes over from there).
 * 3. List/table views stay button-free at the card level (the table keeps its
 *    own per-row control; the list row has none).
 * 4. styles.css ships the hover-reveal rules, the position anchors and the
 *    tablet padding reset for the new button class.
 *
 * Run: `npm run test:card-delete`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import { renderLibrarySection } from '../src/library-section';
import { El, findByClass, findTag } from './mini-dom';

const bodyEl = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: bodyEl,
};
(globalThis as unknown as Record<string, unknown>).window = globalThis;

const notes = [
	{ path: 'notes/a.md', fm: { title: 'A' } },
	{ path: 'notes/b.md', fm: { title: 'B' } },
];
const app = {
	vault: {
		getMarkdownFiles: () => notes.map(n => ({
			path: n.path, basename: n.path.split('/').pop()!.replace('.md', ''), extension: 'md',
			stat: { mtime: 1, ctime: 1 },
		})),
		cachedRead: async () => '---\n---\n\nbody',
	},
	metadataCache: {
		getFileCache: (f: { path: string }) => ({ frontmatter: notes.find(n => n.path === f.path)?.fm ?? {}, tags: [] }),
		fileToLinktext: (f: { path: string }) => f.path,
	},
	workspace: { on: () => {}, off: () => {} },
} as unknown as App;

/** Render one view mode and settle its async preview/cover callbacks. */
const renderView = async (viewMode: string, folders: string[] = ['notes']): Promise<El> => {
	const host = new El('div');
	bodyEl.appendChild(host);
	renderLibrarySection(
		host as unknown as HTMLElement,
		{ name: 'V', color: '', sectionType: 'folder', libraryConfig: { filters: [], viewMode, sortBy: 'name', sortDesc: false, folders } } as never,
		app,
		() => {},
	);
	await new Promise(r => setImmediate(r));
	return host;
};

const run = async (): Promise<void> => {
	// 1 + 2: grid, gallery and kanban cards all carry the delete button; a
	// click must not reach the card's open handler (the stub workspace would
	// throw — a clean click proves stopPropagation).
	for (const viewMode of ['grid', 'gallery', 'kanban'] as const) {
		const host = await renderView(viewMode);
		const cardCls = viewMode === 'kanban' ? 'dashboard-library-kanban-card' : 'dashboard-library-card';
		const cards = findByClass(host, cardCls);
		assert.equal(cards.length, 2, `1: ${viewMode} renders both cards`);
		for (const card of cards) {
			const btn = findTag(card, 'button').find(b => b.hasClass('dashboard-library-card-delete'));
			assert.ok(btn, `1: ${viewMode} card carries the delete button`);
			assert.equal(btn!.getAttribute('aria-label'), '删除', `1: ${viewMode} delete button labelled`);
			assert.doesNotThrow(() => btn!.click(), `2: ${viewMode} delete click stops propagation (no open)`);
		}
	}

	// 3: list rows carry no delete button (view-level affordance stays where
	//    it was: the table's own per-row control, unchanged).
	{
		const list = await renderView('list');
		assert.equal(findByClass(list, 'dashboard-library-card-delete').length, 0, '3: list view has no card delete buttons');
	}

	// 4: the CSS contract — hover reveal on both card shapes, focus fallback,
	//    the position anchors, and the tablet padding reset.
	{
		const css = readFileSync('styles.css', 'utf8');
		assert.ok(css.includes('.dashboard-library-card:hover .dashboard-library-card-delete'), '4: grid/gallery hover reveal rule');
		assert.ok(css.includes('.dashboard-library-kanban-card:hover .dashboard-library-card-delete'), '4: kanban hover reveal rule');
		assert.ok(css.includes('.dashboard-library-card-delete:focus-visible'), '4: keyboard focus reveal');
		assert.ok(css.includes('.is-tablet button.dashboard-library-card-delete'), '4: tablet padding reset present');
		assert.ok(/\.dashboard-library-card \{[^}]*position: relative/.test(css), '4: grid card anchors the button');
		assert.ok(/\.dashboard-library-kanban-card \{[^}]*position: relative/.test(css), '4: kanban card anchors the button');
	}

	console.log('verify-card-delete: all checks passed');
};

void run();
