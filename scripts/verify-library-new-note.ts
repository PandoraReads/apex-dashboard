/**
 * Verifies the "new note" button for library/folder sections:
 *
 * 1. buildNewNoteProps — filter → frontmatter mapping: equals (default) and
 *    contains contribute values[0], `tags` collects into a list, notEquals /
 *    pseudo-properties / dateRange land in `skipped`, match-all filters are
 *    ignored silently, duplicate properties keep the first filter.
 * 2. yamlFrontmatter — quoting/escaping, list form, `---` fences, '' when empty.
 * 3. createNoteWithProps — folder cleaning + creation, filename sanitization,
 *    `-2` collision suffix, frontmatter baked into the initial content.
 * 4. Toolbar integration — the button renders on both section types with a
 *    localized aria-label and dispatches `dashboard-library-new-note` with the
 *    column name (view.ts owns the creation flow).
 *
 * Run: `npm run test:library-new-note`
 */
import { strict as assert } from 'node:assert';
import { App, Menu } from 'obsidian';
import { renderLibrarySection } from '../src/library-section';
import { buildNewNoteProps, createNoteWithProps, pickFolderFromMenu, yamlFrontmatter } from '../src/library-new-note';
import { LibraryConfig } from '../src/types';
import { El, findByClass } from './mini-dom';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

// Node's native CustomEvent keeps type/detail behind prototype getters, which
// mini-dom's Object.assign-based dispatchEvent cannot copy onto the event the
// listeners receive — install an own-property stand-in (same trick as
// verify-web-section's polyfill).
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
	type: string;
	detail: unknown;
	bubbles: boolean;
	constructor(type: string, o?: { detail?: unknown; bubbles?: boolean }) {
		this.type = type;
		this.detail = o?.detail;
		this.bubbles = o?.bubbles ?? false;
	}
};

// ---------- 1. buildNewNoteProps ----------

const config = (filters: LibraryConfig['filters']): LibraryConfig =>
	({ filters, viewMode: 'grid', sortBy: 'modified', sortDesc: true });

// Default operator is equals; the first value is written.
{
	const { props, skipped } = buildNewNoteProps(config([
		{ property: 'status', values: ['进行中', '已完成'] },
	]));
	assert.deepEqual(props, { status: '进行中' }, 'equals default writes values[0]');
	assert.deepEqual(skipped, [], 'nothing skipped');
}

// contains writes the full value (a substring check passes on the full string).
{
	const { props } = buildNewNoteProps(config([
		{ property: 'title', values: ['project'], operator: 'contains' },
	]));
	assert.deepEqual(props, { title: 'project' }, 'contains writes the full value');
}

// notEquals cannot be satisfied by any invented value.
{
	const { props, skipped } = buildNewNoteProps(config([
		{ property: 'status', values: ['已归档'], operator: 'notEquals' },
	]));
	assert.deepEqual(props, {}, 'notEquals writes nothing');
	assert.deepEqual(skipped, ['status'], 'notEquals reported in skipped');
}

// tags collects into a list; two tags filters merge (each contributes
// values[0]; duplicates are not re-added).
{
	const { props } = buildNewNoteProps(config([
		{ property: 'tags', values: ['book'] },
		{ property: 'tags', values: ['reading', 'book'] },
	]));
	assert.deepEqual(props, { tags: ['book', 'reading'] }, 'tags filters merge deduped');
}

// Pseudo-properties with values are skipped (no frontmatter can satisfy them);
// dateRange skips even without values (a fixed window cannot include "now").
{
	const { props, skipped } = buildNewNoteProps(config([
		{ property: 'path', values: ['Projects/'] },
		{ property: 'modified', values: [] },
		{ property: 'created', values: [], dateRange: { start: '2024-01-01', end: '2024-12-31' } },
	]));
	assert.deepEqual(props, {}, 'pseudo-properties write nothing');
	assert.deepEqual(skipped, ['path', 'created'], 'path skipped, dateRange skipped');
}

// Empty values without a dateRange are match-all: ignored, not reported.
{
	const { props, skipped } = buildNewNoteProps(config([
		{ property: 'status', values: [] },
		{ property: '', values: ['x'] },
	]));
	assert.deepEqual(props, {}, 'match-all and unnamed filters ignored');
	assert.deepEqual(skipped, [], 'match-all not reported');
}

// Duplicate property: the first filter wins; when the picked value cannot
// satisfy the second filter the property is reported (the AND of both would
// otherwise silently keep the note out of the section).
{
	const { props, skipped } = buildNewNoteProps(config([
		{ property: 'rating', values: ['5'] },
		{ property: 'rating', values: ['4'] },
	]));
	assert.deepEqual(props, { rating: '5' }, 'first duplicate property wins');
	assert.deepEqual(skipped, ['rating'], 'conflicting duplicate reported');
}

// A duplicate the picked value already satisfies stays quiet (equals OR and
// contains-substring both hold).
{
	const equalsOk = buildNewNoteProps(config([
		{ property: 'rating', values: ['5'] },
		{ property: 'rating', values: ['5', '4'] },
	]));
	assert.deepEqual(equalsOk, { props: { rating: '5' }, skipped: [] }, 'satisfied equals duplicate quiet');
	const containsOk = buildNewNoteProps(config([
		{ property: 'title', values: ['project'] },
		{ property: 'title', values: ['roj'], operator: 'contains' },
	]));
	assert.deepEqual(containsOk, { props: { title: 'project' }, skipped: [] }, 'satisfied contains duplicate quiet');
}

// Missing config entirely.
{
	assert.deepEqual(buildNewNoteProps(undefined), { props: {}, skipped: [] }, 'no config → empty');
}

console.log('buildNewNoteProps mapping: PASS');

// ---------- 2. yamlFrontmatter ----------

assert.equal(yamlFrontmatter({}), '', 'empty props → empty string');
assert.equal(
	yamlFrontmatter({ status: '进行中', tags: ['book', 'reading'] }),
	[
		'---',
		'"status": "进行中"',
		'"tags":',
		'  - "book"',
		'  - "reading"',
		'---',
		'',
	].join('\n'),
	'scalar + list rendering with fences',
);
assert.equal(
	yamlFrontmatter({ note: 'he said "hi" \\ done' }),
	'---\n"note": "he said \\"hi\\" \\\\ done"\n---\n',
	'quotes and backslashes escaped',
);
assert.equal(
	yamlFrontmatter({ multiline: 'a\nb\r\nc' }),
	'---\n"multiline": "a b c"\n---\n',
	'newlines flattened to spaces',
);
assert.equal(yamlFrontmatter({ tags: [] }), '---\n"tags": []\n---\n', 'empty list renders inline');

console.log('yamlFrontmatter escaping: PASS');

// ---------- 3. createNoteWithProps (async) + 4. toolbar integration ----------

interface CreateCall { path: string; content: string }

const makeVaultApp = (existing: Set<string>) => {
	const created: CreateCall[] = [];
	const mkdirs: string[] = [];
	const app = {
		vault: {
			adapter: {
				exists: async (p: string): Promise<boolean> => existing.has(p),
				mkdir: async (p: string): Promise<void> => { mkdirs.push(p); existing.add(p); },
			},
			create: async (path: string, content: string): Promise<{ path: string }> => {
				created.push({ path, content });
				existing.add(path);
				return { path };
			},
		},
	} as unknown as App;
	return { app, created, mkdirs };
};

const makeSectionApp = (): Parameters<typeof renderLibrarySection>[2] => {
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
	} as unknown as Parameters<typeof renderLibrarySection>[2];
};

const renderSectionEl = (name: string, sectionType: 'folder' | 'library'): El => {
	const el = new El('div');
	renderLibrarySection(
		el as unknown as HTMLElement,
		{
			name, color: '', sectionType,
			libraryConfig: {
				filters: [], viewMode: 'grid', sortBy: 'modified', sortDesc: true,
				...(sectionType === 'folder' ? { folders: ['notes'] } : {}),
			},
		},
		makeSectionApp(),
		() => {},
	);
	return el;
};

async function main(): Promise<void> {
	// Folder cleaned, created when missing, .md appended, props baked in.
	{
		const { app, created, mkdirs } = makeVaultApp(new Set());
		const file = await createNoteWithProps(app, ' /Notes/Sub/ ', 'My Note', { status: '进行中' });
		assert.equal(file.path, 'Notes/Sub/My Note.md', 'leading/trailing slashes trimmed, .md appended');
		assert.deepEqual(mkdirs, ['Notes', 'Notes/Sub'], 'missing folders created in order');
		assert.equal(created.length, 1, 'one vault.create call');
		assert.equal(created[0]!.content, yamlFrontmatter({ status: '进行中' }), 'content is the frontmatter block');
	}

	// Collision appends -2 (base exists, candidate does not).
	{
		const { app, created } = makeVaultApp(new Set(['Notes/T.md']));
		const file = await createNoteWithProps(app, 'Notes', 'T', {});
		assert.equal(file.path, 'Notes/T-2.md', 'collision suffixed with -2');
		assert.equal(created[0]!.content, '', 'no props → bare note, no fences');
	}

	// Root folder: no mkdir, file at vault root.
	{
		const { app, created, mkdirs } = makeVaultApp(new Set());
		const file = await createNoteWithProps(app, '', 'Root', {});
		assert.equal(file.path, 'Root.md', 'empty folder → vault root');
		assert.deepEqual(mkdirs, [], 'no folders created');
		assert.equal(created.length, 1, 'created once');
	}

	// Illegal filename characters stripped; empty-after-sanitize title throws.
	{
		const { app, created } = makeVaultApp(new Set());
		const file = await createNoteWithProps(app, 'N', 'a/b:c*', {});
		assert.equal(file.path, 'N/abc.md', 'illegal characters stripped');
		await assert.rejects(() => createNoteWithProps(app, 'N', '///', {}), /empty/i, 'blank title rejected');
		assert.equal(created.length, 1, 'rejected title created nothing');
	}

	// pickFolderFromMenu: items listed in order; clicking resolves the folder
	// (a late hide must not double-resolve); dismissing resolves null.
	// tsc sees the real obsidian Menu (no stub surface); the bundled stub
	// records items and the last instance for exactly this check.
	type StubMenu = { items: Array<{ title: string; click: () => void }>; dismiss(): void };
	const lastMenu = (): StubMenu => (Menu as unknown as { last: StubMenu }).last;
	{
		const pick = pickFolderFromMenu(['Inbox', 'Projects'], { x: 10, y: 20 });
		const menu = lastMenu();
		assert.deepEqual(menu.items.map(i => i.title), ['Inbox', 'Projects'], 'menu lists folders in order');
		menu.items[1]!.click();
		assert.equal(await pick, 'Projects', 'item click resolves the folder');
		menu.dismiss();
		const dismissed = pickFolderFromMenu(['Inbox'], { x: 0, y: 0 });
		lastMenu().dismiss();
		assert.equal(await dismissed, null, 'dismissal resolves null');
	}

	console.log('createNoteWithProps + pickFolderFromMenu: PASS');

	// ---------- 4. Toolbar integration ----------

	// Both section types get the button, with a localized aria-label.
	for (const sectionType of ['folder', 'library'] as const) {
		const el = renderSectionEl('C1', sectionType);
		const btn = findByClass(el, 'dashboard-library-newnote-btn')[0];
		assert.ok(btn, `button rendered on ${sectionType} section`);
		const label = btn!.getAttribute('aria-label');
		assert.ok(label === '新建笔记' || /new note/i.test(label ?? ''), `aria-label localized (${label})`);

		// Click dispatches the custom event carrying the column name (mini-dom
		// fires same-element listeners; the real DOM bubbles up to the kanban
		// root where view.ts handles creation).
		let detail: { columnName?: string } | undefined;
		(el as unknown as {
			addEventListener: (type: string, fn: (ev: { detail?: { columnName?: string } }) => void) => void;
		}).addEventListener('dashboard-library-new-note', (ev) => { detail = ev.detail; });
		btn!.click();
		assert.equal(detail?.columnName, 'C1', `event carries column name (${sectionType})`);
	}

	console.log('toolbar button integration: PASS');
}

void main().then(() => {
	console.log('library new note: ALL PASS');
});
