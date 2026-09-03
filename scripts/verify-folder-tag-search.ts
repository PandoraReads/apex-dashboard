/**
 * Verifies the tag-search box in FolderConfigModal's tag filter section:
 * renders above the chips, narrows the list as you type, shows a dedicated
 * no-match message (distinct from "vault has no tags"), restores the full list
 * when cleared, and keeps selections made while filtered.
 *
 * Types bridge two worlds: tsc resolves `obsidian` to the real typings (so
 * `contentEl` is an HTMLElement and `app` the real App), while the esbuild
 * alias swaps in scripts/obsidian-stub.ts at bundle time (where contentEl is a
 * mini-DOM El). Cross-casts keep both checkers honest without `any` in the
 * assertions themselves.
 *
 * Run: `npm run test:folder-tag-search`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { FolderConfigModal } from '../src/folder-config-modal';
import { findByClass, findTag, orderIndex, type El } from './mini-dom';

// applyModalTheme reads the Obsidian global `activeDocument` (a free variable
// once bundled). No dashboard root exists here, so a null-returning
// querySelector makes the theme mirror a no-op, as when no view is open.
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
};

// Stub app for getAllTags -> extractFrontmatterProperties: two files whose
// frontmatter yields four distinct tags to filter. extractFrontmatterProperties
// skips caches without frontmatter; tags come from fm.tags (bare names, no #).
const app = {
	vault: {
		getMarkdownFiles: () => [{ path: 'a.md' }, { path: 'b.md' }],
	},
	metadataCache: {
		getFileCache: (f: { path: string }) => ({
			frontmatter: { tags: f.path === 'a.md' ? ['work', 'project'] : ['work', 'life', 'holiday'] },
		}),
	},
} as unknown as App;

const openModal = (tags: string[], onSave: (r: { tags: string[] }) => void): El => {
	const modal = new FolderConfigModal(app, [], [], tags, undefined, undefined, undefined, onSave as never);
	modal.onOpen();
	return modal.contentEl as unknown as El;
};

const content = openModal(['project'], () => {});

const tagSection = findByClass(content, 'dashboard-library-config-section')
	.find(section => findByClass(section, 'dashboard-media-folder-input-row').length > 0
		&& findByClass(section, 'dashboard-library-filter-values').length > 0);
assert.ok(tagSection, 'tag filter section found');

const searchInput = findTag(tagSection, 'input')
	.find(el => el.getAttribute('placeholder') === '搜索标签…');
assert.ok(searchInput, 'tag search input with placeholder found');
const chipsHost = findByClass(tagSection, 'dashboard-library-filter-values')[0]!;
const chipNames = (): string[] => findByClass(chipsHost, 'dashboard-library-filter-chip').map(c => c.textContent);
const chipActive = (name: string): boolean =>
	findByClass(chipsHost, 'dashboard-library-filter-chip').some(c => c.textContent === name && c.hasClass('active'));
const emptyText = (): string | null =>
	findByClass(chipsHost, 'dashboard-library-filter-empty')[0]?.textContent ?? null;
const type = (v: string): void => {
	searchInput!.value = v;
	searchInput!.dispatchEvent({ type: 'input' });
};

// 1. The search box renders above the chips container, inside the tag section.
assert.ok(orderIndex(tagSection, searchInput!) < orderIndex(tagSection, chipsHost),
	'search input renders before the chips host');

// 2. No query: all vault tags show; the preselected tag is active.
assert.deepEqual(chipNames().sort(), ['holiday', 'life', 'project', 'work'], 'all tags shown initially');
assert.ok(chipActive('project'), 'preselected tag rendered active');

// 3. Typing narrows the list.
type('life');
assert.deepEqual(chipNames(), ['life'], 'query narrows chips to matches');

// 4. A query that matches nothing shows the dedicated no-match message.
type('zzz');
assert.deepEqual(chipNames(), [], 'no chips on unmatched query');
assert.match(emptyText() ?? '', /没有匹配的标签/, 'dedicated no-match message');

// 5. Clearing the query restores the full list.
type('');
assert.equal(chipNames().length, 4, 'clearing query restores all tags');

// 6. Selecting while filtered persists after clearing the query.
type('hol');
findByClass(chipsHost, 'dashboard-library-filter-chip')[0]!.click();
type('');
assert.ok(chipActive('holiday'), 'tag toggled while filtered stays selected');

// 7. Save carries the accumulated selection.
let saved: { tags: string[] } | undefined;
const savingContent = openModal([], r => { saved = r; });
const savingHost = findByClass(savingContent, 'dashboard-library-filter-values')[0]!;
const savingInput = findByClass(savingContent, 'dashboard-media-folder-input-row')
	.map(row => findTag(row, 'input')[0])
	.find((el): el is El => !!el && el.getAttribute('placeholder') === '搜索标签…')!;
savingInput.value = 'pro';
savingInput.dispatchEvent({ type: 'input' });
findByClass(savingHost, 'dashboard-library-filter-chip')[0]!.click();
// The confirm-styled class is also on the exclude editor's Add button; scope
// to the footer so we click the real Save.
const footer = findByClass(savingContent, 'dashboard-modal-footer')[0]!;
const saveBtn = findTag(footer, 'button').find(b => b.hasClass('dashboard-modal-btn--confirm'))!;
saveBtn.click();
assert.deepEqual((saved as { tags: string[] } | undefined)?.tags, ['project'], 'save includes tag picked via search');

console.log('folder tag search: ALL PASS (7 checks)');
