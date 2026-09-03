/**
 * Verifies the card-size (S/M/L) toggle for the library and folder sections'
 * card views:
 *
 * 1. Parser round-trip — 'small'/'large' persist to the dashboard file,
 *    'medium' (default) writes nothing, garbage parses to undefined.
 * 2. renderLibrarySection toolbar — the selector renders three buttons, is
 *    visible in grid/gallery and hidden in list/table/kanban, clicking a size
 *    reports it through onConfigChange and re-renders the grid with the
 *    matching size class. 'medium' stays un-suffixed (legacy layout intact).
 *
 * Run: `npm run test:library-card-size`
 */
import { strict as assert } from 'node:assert';
import { parse, serialize } from '../src/parser';
import { renderLibrarySection } from '../src/library-section';
import { El, findByClass } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

// ---------- 1. Parser round-trip ----------

const roundTrip = (size: string | undefined): string | undefined => {
	const dash = parse([
		'---',
		'columns:',
		'  - name: C1',
		'    type: folder',
		'    library:',
		`      cardSize: ${size}`,
		'---',
		'',
		'## C1',
	].join('\n'));
	const col = dash.columns[0];
	return serialize(dash).match(/cardSize: (\w+)/)?.[1] ?? undefined;
};

assert.equal(roundTrip('small'), 'small', 'small round-trips');
assert.equal(roundTrip('large'), 'large', 'large round-trips');
assert.equal(roundTrip('medium'), undefined, 'medium (default) writes nothing');
assert.equal(roundTrip('huge'), undefined, 'garbage value dropped');

console.log('cardSize parser round-trip: PASS');

// ---------- 2. Toolbar + rendering ----------

const makeApp = () => {
	const file = {
		path: 'notes/a.md', basename: 'a', extension: 'md',
		stat: { mtime: 1, ctime: 1 },
	};
	return {
		vault: {
			getMarkdownFiles: () => [file],
			cachedRead: async () => '---\ntitle: x\n---\n\nbody',
			adapter: { read: async () => { throw new Error('no adapter in stub'); } },
		},
		metadataCache: {
			getFileCache: () => ({ frontmatter: { title: 'x' }, tags: [] }),
			fileToLinktext: (f: { path: string }) => f.path,
		},
		workspace: { on: () => {}, off: () => {} },
		fileManager: {},
		lastEvent: null,
	} as unknown as Parameters<typeof renderLibrarySection>[2];
};

const el = new El('div');
let saved: { cardSize?: string } | undefined;
// tsc sees HTMLElement (real typings); the bundled mini-DOM provides El.
renderLibrarySection(
	el as unknown as HTMLElement,
	{ name: 'C1', color: '', sectionType: 'folder', libraryConfig: { filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true, folders: ['notes'] } },
	makeApp(),
	cfg => { saved = { ...cfg } as { cardSize?: string }; },
);

const sizeToggle = findByClass(el, 'dashboard-library-size-toggle')[0]!;
const sizeBtns = (): El[] => findByClass(sizeToggle, 'dashboard-library-view-btn');
const activeSize = (): string | undefined => sizeBtns().find(b => b.hasClass('active'))?.textContent;
const gridHost = (): El => findByClass(el, 'dashboard-library-grid')[0]
	?? findByClass(el, 'dashboard-library-gallery')[0]
	?? assert.fail('card grid rendered');

// Three buttons, S/M/L, medium active by default, toggle visible in grid.
assert.deepEqual(sizeBtns().map(b => b.textContent), ['S', 'M', 'L'], 'three size buttons S/M/L');
assert.equal(activeSize(), 'M', 'medium active by default');
assert.ok(!sizeToggle.hasClass('is-hidden'), 'visible in grid view');

// aria-labels are localized.
const ariaLabels = sizeBtns().map(b => b.getAttribute('aria-label'));
assert.ok(ariaLabels.every(l => l === '小卡片' || l === '中卡片' || l === '大卡片' || /cards/i.test(l ?? '')),
	`aria labels localized: ${ariaLabels.join(',')}`);

// Default grid carries no size class (legacy layout).
assert.ok(!gridHost().hasClass('dashboard-library-cards--small')
	&& !gridHost().hasClass('dashboard-library-cards--large'), 'medium stays un-suffixed');

// Click S: config reported, grid re-rendered with the class.
sizeBtns().find(b => b.textContent === 'S')!.click();
assert.equal((saved as { cardSize?: string } | undefined)?.cardSize, 'small', 'onConfigChange carries cardSize');
assert.equal(activeSize(), 'S', 'S becomes active');
assert.ok(gridHost().hasClass('dashboard-library-cards--small'), 'grid re-rendered with small class');

// Click L via the fresh buttons.
findByClass(sizeToggle, 'dashboard-library-view-btn').find(b => b.textContent === 'L')!.click();
assert.ok(gridHost().hasClass('dashboard-library-cards--large'), 'grid re-rendered with large class');

// Switch to list: selector hides; back to gallery: visible and gallery-sized.
const viewToggle = findByClass(el, 'dashboard-library-view-toggle')[0]!;
const viewBtn = (mode: string): El => findByClass(viewToggle, 'dashboard-library-view-btn')
	.find(b => b.getAttribute('data-view-mode') === mode)!;
viewBtn('list').click();
assert.ok(sizeToggle.hasClass('is-hidden'), 'hidden in list view');
viewBtn('table').click();
assert.ok(sizeToggle.hasClass('is-hidden'), 'hidden in table view');
viewBtn('gallery').click();
assert.ok(!sizeToggle.hasClass('is-hidden'), 'visible in gallery view');
assert.ok(gridHost().hasClass('dashboard-library-gallery'), 'gallery view renders gallery grid');
assert.ok(gridHost().hasClass('dashboard-library-cards--large'), 'card size carries over to gallery');

// A persisted small config renders small from the start (no toggle needed).
const el2 = new El('div');
renderLibrarySection(
	el2 as unknown as HTMLElement,
	{ name: 'C2', color: '', sectionType: 'library', libraryConfig: { filters: [], viewMode: 'gallery', sortBy: 'modified', sortDesc: true, cardSize: 'small' } },
	makeApp(),
	() => {},
);
const gallery2 = findByClass(el2, 'dashboard-library-gallery')[0]!;
assert.ok(gallery2.hasClass('dashboard-library-cards--small'), 'persisted small applied on open');
assert.equal(findByClass(findByClass(el2, 'dashboard-library-size-toggle')[0]!, 'dashboard-library-view-btn')
	.find(b => b.hasClass('active'))?.textContent, 'S', 'S active on open');

console.log('card size toolbar + rendering: PASS');
console.log('library card size: ALL PASS');
