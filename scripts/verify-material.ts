/**
 * Verifies the material library's DOM-free core (src/material-model.ts):
 *
 * 1. buildMaterialItems: EVERY non-dot in-scope file scans in (media typed
 *    image/video, everything else 'text'); include scope (empty = whole
 *    vault, prefix + case-insensitive), exclude prefixes, dot-file filter,
 *    top-level folder derivation on an unscoped scan and ROOT-RELATIVE keys on
 *    a scoped one (deepest matching include root is the grouping base), tag
 *    attach; extension parity with the media sections for the image/video sets.
 * 2. filterMaterialItems: query (basename + full path), kind (incl. text),
 *    tag OR-union.
 * 3. sortMaterialItems: all four keys, both directions, purity, numeric-aware
 *    name compare.
 * 4. groupMaterialItems: folder / tag (fan-out per tag) / type (three kinds)
 *    modes, alphabetical keys, folder groups carry a display label (the
 *    sub-folder's own name, not the root-qualified key), not-set bucket always
 *    last with its label, running offsets; 'none' returns [].
 * 5. paginateMaterial: page clamping both ways, slice bounds, totalPages.
 * 6. materialColumnCount: floor((w+gap)/(target+gap)) clamped 2..8; guards
 *    NaN/zero widths (harness clientWidth is undefined).
 * 7. assignWaterfall: shortest-column placement, leftmost tie, deterministic,
 *    non-finite/non-positive aspects fall back to the image aspect.
 * 8. materialSkillVars / effectiveMaterialTemplate: dash-prefixed path list,
 *    first path, count; user template wins over the default.
 * 9. sanitizeMaterialConfig: garbage → defaults; non-string list entries
 *    dropped; invalid agent ids fall back to claudian; directSend only kept
 *    when literally true; the drop-in importFolder normalizes (and defaults to
 *    '' on garbage).
 *
 * Run: `npm run test:material`
 */
import { strict as assert } from 'node:assert';
import {
	MATERIAL_IMAGE_EXTS, MATERIAL_VIDEO_EXTS, MATERIAL_IMAGE_ASPECT, MATERIAL_VIDEO_ASPECT,
	MATERIAL_COL_GAP, DENSITY_TARGET_PX,
	materialKindFor, normalizeIncludeFolders, buildMaterialItems,
	filterMaterialItems, sortMaterialItems, groupMaterialItems, paginateMaterial,
	materialColumnCount, assignWaterfall, materialSkillVars, effectiveMaterialTemplate,
	sanitizeMaterialConfig,
} from '../src/material-model';
import { IMAGE_EXTS, VIDEO_EXTS } from '../src/media-section';

function rec(path: string, mtime = 1, ctime = 1, size = 100): { path: string; basename: string; extension: string; stat: { mtime: number; ctime: number; size: number } } {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return { path, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '', stat: { mtime, ctime, size } };
}

const TAGS: Record<string, string[]> = {
	'素材/cover.png': ['封面', '小红书'],
	'素材/clip.mp4': ['视频'],
};

const FILES = [
	rec('素材/cover.png', 30, 10, 500),
	rec('素材/shot.JPG', 20, 5, 400),
	rec('素材/clip.mp4', 40, 20, 9000),
	rec('素材/notes.txt', 50, 1, 3),   // not media
	rec('素材/temp.md', 60, 1, 3),     // not media
	rec('.obsidian/icon.png', 70, 70, 1), // dot-path skipped
	rec('root.png', 80, 80, 200),      // vault-root file
	rec('旅行/vlog.mov', 90, 90, 8000),
];

// --- 1. buildMaterialItems -------------------------------------------------
// Extension parity: the image/video type sets must match exactly what the
// images + videos sections accept, no drift on either side (everything else
// falls through to the 'text' kind — no extension gate anymore).
assert.equal(new Set([...MATERIAL_IMAGE_EXTS, ...IMAGE_EXTS]).size, IMAGE_EXTS.size, 'image ext sets identical to media-section');
assert.equal(new Set([...MATERIAL_VIDEO_EXTS, ...VIDEO_EXTS]).size, VIDEO_EXTS.size, 'video ext sets identical to media-section');
assert.equal(materialKindFor('png'), 'image');
assert.equal(materialKindFor('mp4'), 'video');
assert.equal(materialKindFor('txt'), 'text', 'non-media extensions type as text');
assert.equal(materialKindFor('md'), 'text');
assert.equal(materialKindFor(''), 'text', 'extensionless files type as text');

const whole = buildMaterialItems(FILES, p => TAGS[p] ?? [], { includeFolders: [], excludeFolders: [] });
// 7 files: 5 media + notes.txt + temp.md — everything in the vault except
// the dot-path (.obsidian skipped).
assert.equal(whole.length, 7, 'whole-vault scan keeps non-media files, skips dot-paths');
assert.equal(whole[0]!.ext, 'png');
assert.deepEqual(whole[0]!.tags, ['封面', '小红书'], 'tags attached from the store');
assert.deepEqual(whole[1]!.tags, [], 'no tags → empty array, not undefined');
assert.equal(whole[5]!.folder, '', 'vault-root file has empty folder key');
assert.equal(whole[3]!.kind, 'text', 'txt file kinds as text');

// Include scope: only listed folders (subfolders included), case-insensitive
// on the config side, and prefixes don't leak (素材x must not match 素材).
const scoped = buildMaterialItems(FILES, () => [], { includeFolders: [' /素材/ ', '旅行'], excludeFolders: [] });
assert.deepEqual(scoped.map(r => r.path), ['素材/cover.png', '素材/shot.JPG', '素材/clip.mp4', '素材/notes.txt', '素材/temp.md', '旅行/vlog.mov'], 'include scope, trimmed entries, no prefix leak');
assert.deepEqual(normalizeIncludeFolders([' /a/ ', '', 'b']), ['a', 'b'], 'include normalization');

// Exclude scope beats include scope.
const excluded = buildMaterialItems(FILES, () => [], { includeFolders: ['素材'], excludeFolders: ['素材'] });
assert.equal(excluded.length, 0, 'exclude removes even inside the include scope');

// Folder derivation on an UNSCOPED scan is the top-level folder (root = '').
assert.equal(whole[0]!.folder, '素材');
assert.equal(whole[6]!.folder, '旅行');

// Scoped scan: folder keys are RELATIVE to the deepest matching include root,
// so a single-root library groups by the sub-folder below it (Rae) instead of
// collapsing everything into the one root bucket. Files sitting directly in the
// root bucket under the root itself; deeper levels fold into the first one down.
const DEEP = [
	rec('素材/cover.png'),
	rec('素材/图片/shot.jpg'),
	rec('素材/图片/2024/newyear.png'),
	rec('素材/视频/clip.mp4'),
	rec('旅行/vlog.mov'),
];
const deepScoped = buildMaterialItems(DEEP, () => [], { includeFolders: ['素材'], excludeFolders: [] });
assert.deepEqual(
	deepScoped.map(r => r.folder),
	['素材', '素材/图片', '素材/图片', '素材/视频'],
	'root-relative sub-folder keys, deeper levels collapse to the first below the root',
);
const deepGroups = groupMaterialItems(deepScoped, 'folder', '(not set)');
assert.deepEqual(deepGroups.map(g => g.key), ['素材', '素材/图片', '素材/视频'], 'keys stay root-qualified');
assert.deepEqual(deepGroups.map(g => g.label), ['素材', '图片', '视频'], 'labels show the sub-folder name only');
// Two roots with same-named sub-folders stay distinct (why keys are qualified).
const twinRoots = buildMaterialItems(
	[rec('a/2024/x.png'), rec('b/2024/y.png')], () => [], { includeFolders: ['a', 'b'], excludeFolders: [] },
);
assert.deepEqual(twinRoots.map(r => r.folder), ['a/2024', 'b/2024'], 'root-qualified keys keep same-named sub-folders apart');
// A nested include root wins over its ancestor (deepest match).
const nested = buildMaterialItems(
	[rec('素材/图片/shot.jpg')], () => [], { includeFolders: ['素材', '素材/图片'], excludeFolders: [] },
);
assert.deepEqual(nested.map(r => r.folder), ['素材/图片'], 'deepest matching root is the grouping base');

// --- 2. filterMaterialItems --------------------------------------------------
const f = (q: string, kind: 'all' | 'image' | 'video' | 'text', tags: string[]): string[] =>
	filterMaterialItems(whole, { query: q, kind, tags }).map(r => r.basename);
assert.deepEqual(f('', 'all', []).sort(), ['clip', 'cover', 'notes', 'root', 'shot', 'temp', 'vlog']);
assert.deepEqual(f('', 'video', []), ['clip', 'vlog'], 'kind filter');
assert.deepEqual(f('', 'text', []).sort(), ['notes', 'temp'], 'text kind filter covers every non-media file');
assert.deepEqual(f('CO', 'all', []), ['cover'], 'query is case-insensitive on basename');
assert.equal(f('素材/', 'all', []).length, 5, 'query also matches the full path');
assert.deepEqual(f('', 'all', ['视频']), ['clip'], 'tag filter');
assert.deepEqual(f('', 'all', ['小红书', '视频']).sort(), ['clip', 'cover'], 'tag OR-union');

// --- 3. sortMaterialItems ----------------------------------------------------
const sortPaths = (by: 'modified' | 'created' | 'name' | 'size', desc: boolean): string[] =>
	sortMaterialItems(whole, by, desc).map(r => r.basename);
assert.deepEqual(sortPaths('modified', true)[0], 'vlog', 'modified desc = newest first');
assert.deepEqual(sortPaths('modified', false)[0], 'shot', 'modified asc = oldest first');
assert.deepEqual(sortPaths('created', true)[0], 'vlog');
assert.deepEqual(sortPaths('size', true)[0], 'clip', 'size desc');
assert.equal(sortPaths('size', false)[0], 'notes', 'size asc (3-byte text files tie; input order is stable)');
const named = sortMaterialItems([
	{ ...whole[0]!, basename: 'item10' },
	{ ...whole[0]!, basename: 'item2' },
	{ ...whole[0]!, basename: 'item1' },
], 'name', false).map(r => r.basename);
assert.deepEqual(named, ['item1', 'item2', 'item10'], 'numeric-aware name sort');
const input = [...whole];
sortMaterialItems(whole, 'name', true);
assert.deepEqual(whole, input, 'sortMaterialItems is pure — input untouched');

// --- 4. groupMaterialItems ----------------------------------------------------
const gs = groupMaterialItems(whole, 'folder', '(not set)');
assert.deepEqual(gs.map(g => g.key), ['旅行', '素材', '(not set)'], 'folder groups alphabetical, root bucket last under its label');
assert.deepEqual(gs[0]!.items.map(r => r.basename), ['vlog']);
assert.deepEqual(gs[2]!.items.map(r => r.basename), ['root'], 'empty-folder items land in the not-set bucket');
assert.deepEqual(gs.map(g => g.offset), [0, 1, 6], 'running offsets feed lightbox indexing');

const byTag = groupMaterialItems(whole, 'tag', '(not set)');
// Tags: 封面(cover) 小红书(cover) 视频(clip) + everything untagged → not-set.
assert.equal(byTag.length, 4, 'one bucket per distinct tag + not-set');
assert.equal(new Set(byTag.slice(0, 3).map(g => g.key)).size, 3, 'the three tag buckets lead (exact order is locale-dependent)');
assert.equal(byTag[3]!.key, '(not set)', 'not-set bucket is last regardless of collation');
assert.equal(byTag.filter(g => g.items.some(r => r.basename === 'cover')).length, 2, 'tagged item fans out into every tag bucket');

const byType = groupMaterialItems(whole, 'type', '(not set)');
assert.deepEqual(byType.map(g => g.key), ['image', 'text', 'video'], 'type groups: three kinds, alphabetical');
assert.deepEqual(byType.map(g => g.items.length), [3, 2, 2]);
assert.deepEqual(groupMaterialItems(whole, 'none', 'x'), [], 'none mode returns no groups');

// --- 5. paginateMaterial --------------------------------------------------------
const page = paginateMaterial(whole, 99, 2);
assert.equal(page.page, 4, 'overlarge page clamps to the last page');
assert.deepEqual(page.items.map(r => r.basename), ['vlog']);
assert.equal(page.totalPages, 4);
const before = paginateMaterial(whole, 0, 2);
assert.equal(before.page, 1, 'page numbers start at 1');
assert.equal(paginateMaterial([], 1, 50).totalPages, 1, 'empty input still has one page');

// --- 6. materialColumnCount -----------------------------------------------------
const rawCols = (w: number, d: 'small' | 'medium' | 'large'): number =>
	Math.floor((w + MATERIAL_COL_GAP) / (DENSITY_TARGET_PX[d]! + MATERIAL_COL_GAP));
assert.equal(materialColumnCount(210, 'medium'), Math.max(2, rawCols(210, 'medium')), 'formula with min clamp');
assert.equal(materialColumnCount(2000, 'small'), Math.min(8, rawCols(2000, 'small')), 'formula with max clamp');
assert.equal(materialColumnCount(5000, 'medium'), 8, 'capped at 8 columns');
assert.equal(materialColumnCount(100, 'large'), 2, 'never below 2 columns');
assert.equal(materialColumnCount(Number.NaN, 'medium'), 2, 'NaN width (harness) falls back to min');
assert.equal(materialColumnCount(0, 'medium'), 2, 'zero width falls back to min');
assert.ok(MATERIAL_IMAGE_ASPECT > 1 && MATERIAL_VIDEO_ASPECT > 1, 'aspect fallbacks are landscape');

// --- 7. assignWaterfall ----------------------------------------------------------
assert.deepEqual(assignWaterfall([1, 1, 1, 1, 1], 2), [0, 1, 0, 1, 0], 'alternating equal aspects');
assert.deepEqual(assignWaterfall([10, 1, 1, 1], 2), [0, 1, 1, 1], 'tall item sends the whole following run to the other column');
assert.deepEqual(assignWaterfall([1, 1, 1], 3), [0, 1, 2], 'first row fills columns left to right (leftmost tie)');
assert.deepEqual(assignWaterfall([1, 1, 1], 2), assignWaterfall([1, 1, 1], 2), 'deterministic');
assert.deepEqual(assignWaterfall([0, -3, Number.NaN], 1), [0, 0, 0], 'non-finite/non-positive aspects fall back, single column');

// --- 8. skill vars + template ----------------------------------------------------
assert.deepEqual(materialSkillVars(['a.png', 'b/b.mp4']), {
	paths: '- a.png\n- b/b.mp4',
	path: 'a.png',
	count: '2',
});
assert.deepEqual(materialSkillVars([]), { paths: '', path: '', count: '0' });
assert.equal(effectiveMaterialTemplate({ promptTemplate: '  ' }), '{skill}\n\n{paths}', 'blank template falls back to the default');
assert.equal(effectiveMaterialTemplate({ promptTemplate: ' 用 {path} 创作 ' }), '用 {path} 创作', 'user template wins, trimmed');

// --- 9. sanitizeMaterialConfig ---------------------------------------------------
assert.deepEqual(
	sanitizeMaterialConfig(undefined, ['claudian', 'copilot']),
	{ includeFolders: [], excludeFolders: [], skillButtons: [], importFolder: '' },
	'undefined → complete defaults',
);
assert.deepEqual(
	sanitizeMaterialConfig('garbage', []),
	{ includeFolders: [], excludeFolders: [], skillButtons: [], importFolder: '' },
	'non-object garbage → defaults',
);
const saved = sanitizeMaterialConfig({
	includeFolders: ['/素材/', '', 42, ' 旅行 '],
	excludeFolders: ['回收站', null],
	importFolder: ' ./素材/收件箱/ ',
	skillButtons: [
		{ id: 'b1', label: ' 配图 ', icon: 'image', agent: 'copilot', skillName: 'mk-cover', promptTemplate: ' x ', directSend: true },
		{ label: 'bad agent', agent: 'nonexistent', promptTemplate: '' },
		'not an object',
	],
}, ['claudian', 'copilot']);
assert.deepEqual(saved.includeFolders, ['素材', '旅行'], 'include folders normalized, non-strings dropped');
assert.deepEqual(saved.excludeFolders, ['回收站'], 'exclude non-strings dropped');
assert.equal(saved.importFolder, '素材/收件箱', 'import folder normalized (dots/slashes/space folded)');
assert.equal(sanitizeMaterialConfig({ importFolder: 42 }, []).importFolder, '', 'non-string import folder → default');
assert.equal(saved.skillButtons.length, 2, 'garbage button entries dropped');
assert.deepEqual(saved.skillButtons[0], {
	id: 'b1', label: '配图', icon: 'image', agent: 'copilot',
	skillName: 'mk-cover', promptTemplate: 'x', directSend: true,
}, 'fields trimmed, directSend kept');
assert.equal(saved.skillButtons[1]!.agent, 'claudian', 'invalid agent id falls back to claudian');
assert.ok(saved.skillButtons[1]!.id.startsWith('mb_'), 'missing ids regenerate');
assert.equal('directSend' in saved.skillButtons[1]!, false, 'directSend only kept when literally true');

console.log('verify-material: all assertions passed');
