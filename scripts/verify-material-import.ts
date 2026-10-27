/**
 * Verifies the material library's OS file-drop importer (src/material-import.ts):
 *
 * 1. normalizeImportFolder: './x/' → 'x', bare slashes → '', whitespace trimmed.
 * 2. attachmentFolderOf: reads Obsidian's attachmentFolderPath through getConfig
 *    and normalizes it; absent/non-string config → '' (vault root).
 * 3. isImportableName: images/videos only — notes, PDFs, dotfiles and
 *    extension-less names are refused (a dropped note tiles as a coverless text
 *    file = invisible, so it must never be copied in).
 * 4. resolveImportTarget (Rae's rules): folder group → that group's folder;
 *    tag group → the default folder PLUS that tag; type groups / flat view /
 *    the not-set bucket / no zone → the configured default folder, falling back
 *    to Obsidian's attachment folder, then the vault root.
 * 5. importFolderLabel: '' reads as the localized vault-root wording.
 * 6. importDroppedFiles against a fake vault: copies land at the unique path,
 *    missing folders are created, illegal filename characters are stripped,
 *    non-media files are skipped without aborting the batch, one rejecting file
 *    never takes the others down, an unreachable destination fails the batch
 *    once, and the group tag is appended exactly once (existing tags kept).
 * 7. describeImportResult: the right key/params per outcome and '' when nothing
 *    happened.
 *
 * Run: `npm run test:material-import`
 */
import { strict as assert } from 'node:assert';
import {
	attachmentFolderOf, describeImportResult, importDroppedFiles, importFolderLabel,
	isImportableName, normalizeImportFolder, resolveImportTarget,
	type ImportableFile, type ImportTagSink,
} from '../src/material-import';
import { t } from '../src/i18n';
import type { App } from 'obsidian';

interface FakeVault {
	app: App;
	/** Paths that already exist (files AND folders). */
	existing: Set<string>;
	created: Array<{ path: string; bytes: number }>;
	mkdirs: string[];
	/** When set, adapter.mkdir rejects with it (unreachable destination). */
	mkdirError: string | null;
}

function makeVault(existing: readonly string[] = [], mkdirError: string | null = null): FakeVault {
	const state: FakeVault = {
		app: null as unknown as App,
		existing: new Set(existing),
		created: [],
		mkdirs: [],
		mkdirError,
	};
	const adapter = {
		exists: async (path: string): Promise<boolean> => state.existing.has(path),
		mkdir: async (path: string): Promise<void> => {
			if (state.mkdirError) throw new Error(state.mkdirError);
			state.mkdirs.push(path);
			state.existing.add(path);
		},
	};
	state.app = {
		vault: {
			adapter,
			createBinary: async (path: string, data: ArrayBuffer): Promise<unknown> => {
				state.created.push({ path, bytes: data.byteLength });
				state.existing.add(path);
				return { path };
			},
			getConfig: (key: string): unknown => (key === 'attachmentFolderPath' ? '附件/默认' : ''),
		},
	} as unknown as App;
	return state;
}

/** A dropped file: the DOM File surface the importer actually uses. */
function droppedFile(name: string, size = 8, rejectWith: string | null = null): ImportableFile {
	return {
		name,
		arrayBuffer: async (): Promise<ArrayBuffer> => {
			if (rejectWith) throw new Error(rejectWith);
			return new ArrayBuffer(size);
		},
	};
}

function makeTagStore(initial: Record<string, string[]> = {}): ImportTagSink & { map: Record<string, string[]>; sets: number } {
	const map: Record<string, string[]> = { ...initial };
	const store = {
		map,
		/** Write count — proves an already-tagged path is left alone. */
		sets: 0,
		getTags: (path: string): string[] => [...(map[path] ?? [])],
		setTags: (path: string, tags: readonly string[]): boolean => {
			store.sets++;
			map[path] = [...tags];
			return true;
		},
	};
	return store;
}

const NOT_SET = t('library.notSet');

// ---- 1. normalizeImportFolder ---------------------------------------------
assert.equal(normalizeImportFolder('  ./素材/图片/ '), '素材/图片');
assert.equal(normalizeImportFolder('/'), '');
assert.equal(normalizeImportFolder('   '), '');
assert.equal(normalizeImportFolder('/a/b/'), 'a/b');
assert.equal(normalizeImportFolder('附件'), '附件');

// ---- 2. attachmentFolderOf -------------------------------------------------
assert.equal(attachmentFolderOf(makeVault().app), '附件/默认');
assert.equal(attachmentFolderOf({ vault: {} } as unknown as App), '');
assert.equal(attachmentFolderOf({ vault: { getConfig: () => 42 } } as unknown as App), '');

// ---- 3. isImportableName ---------------------------------------------------
for (const ok of ['a.png', 'a.JPG', 'clip.MP4', 'clip.mov', 'x.webp', 'y.m4v', 'z.mkv']) {
	assert.equal(isImportableName(ok), true, ok);
}
for (const bad of ['note.md', 'doc.pdf', 'noext', '.hidden', 'trailing.', 'a.txt', 'b.mp3']) {
	assert.equal(isImportableName(bad), false, bad);
}

// ---- 4. resolveImportTarget ------------------------------------------------
const base = { notSetLabel: NOT_SET, importFolder: '素材/收件箱', attachmentFolder: '附件/默认' };
// folder grouping: the group key IS the destination folder
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'folder', groupKey: '素材/图片' }),
	{ folder: '素材/图片', tag: '' },
);
// folder grouping with a messy key still normalizes
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'folder', groupKey: './素材/视频/' }),
	{ folder: '素材/视频', tag: '' },
);
// the not-set bucket is never a folder and never a tag
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'folder', groupKey: NOT_SET }),
	{ folder: '素材/收件箱', tag: '' },
);
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'tag', groupKey: NOT_SET }),
	{ folder: '素材/收件箱', tag: '' },
);
// tag grouping: default folder + the group's tag
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'tag', groupKey: '封面' }),
	{ folder: '素材/收件箱', tag: '封面' },
);
// type grouping / flat view / no zone: default folder, no tag
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'type', groupKey: 'image' }),
	{ folder: '素材/收件箱', tag: '' },
);
assert.deepEqual(
	resolveImportTarget({ ...base, groupMode: 'none', groupKey: null }),
	{ folder: '素材/收件箱', tag: '' },
);
// no configured default → Obsidian's attachment folder; neither → vault root
assert.deepEqual(
	resolveImportTarget({ ...base, importFolder: '', groupMode: 'none', groupKey: null }),
	{ folder: '附件/默认', tag: '' },
);
assert.deepEqual(
	resolveImportTarget({ ...base, importFolder: '', attachmentFolder: '', groupMode: 'none', groupKey: null }),
	{ folder: '', tag: '' },
);
// a tag drop with no default folder still tags, into the vault root
assert.deepEqual(
	resolveImportTarget({ ...base, importFolder: '', attachmentFolder: '', groupMode: 'tag', groupKey: '小红书' }),
	{ folder: '', tag: '小红书' },
);

// ---- 5. importFolderLabel --------------------------------------------------
assert.equal(importFolderLabel({ folder: '', tag: '' }), t('material.dropVaultRoot'));
assert.equal(importFolderLabel({ folder: '素材/图片', tag: '' }), '素材/图片');

async function main(): Promise<void> {
	// ---- 6. importDroppedFiles -------------------------------------------------
	// 6a. plain copy into an existing folder, non-media skipped
	{
		const vault = makeVault(['素材', '素材/图片', '素材/图片/cover.png']);
		const result = await importDroppedFiles(
			vault.app,
			[droppedFile('new.png', 12), droppedFile('clip.mp4', 40), droppedFile('note.md')],
			{ folder: '素材/图片', tag: '' },
			null,
		);
		assert.deepEqual(result.imported, ['素材/图片/new.png', '素材/图片/clip.mp4']);
		assert.deepEqual(result.skipped, ['note.md']);
		assert.deepEqual(result.failed, []);
		assert.deepEqual(vault.created.map(c => c.bytes), [12, 40]);
		assert.deepEqual(vault.mkdirs, []); // folder already there
	}

	// 6b. collision → -2 suffix; illegal characters stripped; missing folders made
	{
		const vault = makeVault(['素材/图片/cover.png']);
		const result = await importDroppedFiles(
			vault.app,
			[droppedFile('cover.png'), droppedFile('a:b?.png')],
			{ folder: '素材/图片', tag: '' },
			null,
		);
		assert.deepEqual(result.imported, ['素材/图片/cover-2.png', '素材/图片/ab.png']);
		assert.deepEqual(vault.mkdirs, ['素材', '素材/图片']);
	}

	// 6c. vault root destination: no leading slash
	{
		const vault = makeVault([]);
		const result = await importDroppedFiles(vault.app, [droppedFile('root.png')], { folder: '', tag: '' }, null);
		assert.deepEqual(result.imported, ['root.png']);
		assert.deepEqual(vault.mkdirs, []);
	}

	// 6d. tag grouping: the tag is appended to what the path already carries
	{
		const vault = makeVault(['素材', '素材/keep.png']);
		// keep.png collides, so the copy lands where the store already has a tag.
		const store = makeTagStore({ '素材/keep-2.png': ['旧标签'] });
		const result = await importDroppedFiles(
			vault.app,
			[droppedFile('a.png'), droppedFile('keep.png')],
			{ folder: '素材', tag: '封面' },
			store,
		);
		assert.deepEqual(result.imported, ['素材/a.png', '素材/keep-2.png']);
		assert.deepEqual(store.map['素材/a.png'], ['封面']);
		assert.deepEqual(store.map['素材/keep-2.png'], ['旧标签', '封面']);
		assert.equal(store.sets, 2);
	}

	// 6e. a path that already carries the tag is not written again (no dup)
	{
		const vault = makeVault(['素材']);
		const store = makeTagStore({ '素材/a.png': ['封面'] });
		const result = await importDroppedFiles(vault.app, [droppedFile('a.png')], { folder: '素材', tag: '封面' }, store);
		assert.deepEqual(result.imported, ['素材/a.png']);
		assert.deepEqual(store.map['素材/a.png'], ['封面']);
		assert.equal(store.sets, 0);
	}

	// 6f. one rejecting file never takes the batch down
	{
		const vault = makeVault(['素材']);
		const result = await importDroppedFiles(
			vault.app,
			[droppedFile('good.png'), droppedFile('bad.png', 1, 'disk on fire'), droppedFile('good2.png')],
			{ folder: '素材', tag: '' },
			null,
		);
		assert.deepEqual(result.imported, ['素材/good.png', '素材/good2.png']);
		assert.deepEqual(result.failed, [{ name: 'bad.png', message: 'disk on fire' }]);
	}

	// 6g. an unreachable destination fails the whole batch exactly once
	{
		const vault = makeVault([], 'permission denied');
		const result = await importDroppedFiles(
			vault.app,
			[droppedFile('a.png'), droppedFile('b.png')],
			{ folder: '素材/新目录', tag: '' },
			null,
		);
		assert.deepEqual(result.imported, []);
		assert.deepEqual(result.skipped, []);
		assert.equal(result.failed.length, 1);
		assert.equal(result.failed[0]!.message, 'permission denied');
	}

	// 6h. an empty drop is a no-op (no folder churn)
	{
		const vault = makeVault([]);
		const result = await importDroppedFiles(vault.app, [], { folder: '素材', tag: '' }, null);
		assert.deepEqual(result, { imported: [], skipped: [], failed: [] });
		assert.deepEqual(vault.mkdirs, []);
	}

	// ---- 7. describeImportResult -----------------------------------------------
	const target = { folder: '素材/图片', tag: '' };
	assert.equal(describeImportResult({ imported: [], skipped: [], failed: [] }, target), '');
	assert.equal(
		describeImportResult({ imported: ['a', 'b'], skipped: [], failed: [] }, target),
		t('material.imported', { count: 2, folder: '素材/图片' }),
	);
	assert.equal(
		describeImportResult({ imported: ['a'], skipped: [], failed: [] }, { folder: '', tag: '封面' }),
		t('material.importedWithTag', { count: 1, folder: t('material.dropVaultRoot'), tag: '封面' }),
	);
	const mixed = describeImportResult(
		{ imported: ['a'], skipped: ['n.md'], failed: [{ name: 'b.png', message: 'boom' }] },
		target,
	);
	assert.deepEqual(mixed.split('\n'), [
		t('material.imported', { count: 1, folder: '素材/图片' }),
		t('material.dropSkipped', { count: 1 }),
		t('material.importFailed', { count: 1, error: 'boom' }),
	]);

	console.log('verify-material-import: OK (destination rules, copy/tag/skip/failure paths, notice wording)');
}

void main();