/**
 * Verifies the gallery view's cover extraction and persistence:
 *
 * 1. extractCoverValue — the field rule the user specified: explicit
 *    `封面`/`cover` keys (case-insensitive) win with any non-empty value;
 *    otherwise the first remaining field holding an image-shaped value
 *    (path/URL by extension, data: URI; tags/position skipped) wins. Covers
 *    the wrapper shapes note properties commonly hold: quotes, wikilinks
 *    (with alias), markdown images, <img> tags, lists.
 * 2. viewMode round-trip — 'gallery' survives serialize → parse (the parser
 *    whitelist used to silently reset unknown modes to 'grid').
 *
 * Run: `npm run test:library-cover`
 */
import { strict as assert } from 'node:assert';
import { extractCoverValue } from '../src/library-section';
import { parse, serialize } from '../src/parser';

// ---------- 1. extractCoverValue ----------

const cover = (fm: Record<string, unknown>) => {
	const hit = extractCoverValue(fm);
	return hit ? `${hit.key}=${hit.value}` : 'null';
};

// Explicit keys, case-insensitive, plus the Chinese key.
assert.equal(cover({ cover: 'a.png' }), 'cover=a.png');
assert.equal(cover({ Cover: 'a.png' }), 'Cover=a.png');
assert.equal(cover({ COVER: 'a.png' }), 'COVER=a.png');
assert.equal(cover({ 封面: 'a.png' }), '封面=a.png');

// Explicit keys accept any non-empty value (resolver probes and drops on failure).
assert.equal(cover({ cover: 'https://pics.example/235' }), 'cover=https://pics.example/235');

// Wrapper unwrapping.
assert.equal(cover({ 封面: '![[Assets/cover.png]]' }), '封面=Assets/cover.png');
assert.equal(cover({ cover: '[[art.jpg|alias]]' }), 'cover=art.jpg');
assert.equal(cover({ cover: '"quoted.png"' }), 'cover=quoted.png');
assert.equal(cover({ cover: '![alt](front.webp)' }), 'cover=front.webp');
assert.equal(cover({ cover: '<img src="poster.svg" width="2">' }), 'cover=poster.svg');

// Lists: first image-shaped entry wins.
assert.equal(cover({ cover: ['foo', 'back.webp', 'b.png'] }), 'cover=back.webp');

// Scan fallback: any field holding an image-shaped value.
assert.equal(cover({ 背景: 'photo.jpg' }), '背景=photo.jpg');
assert.equal(cover({ link: 'https://x.example/y.PNG?w=1' }), 'link=https://x.example/y.PNG?w=1');
assert.equal(cover({ avatar: 'data:image/png;base64,AAAA' }), 'avatar=data:image/png;base64,AAAA');
assert.equal(cover({ art: 'pic.avif' }), 'art=pic.avif');
assert.equal(cover({ art: 'pic.jpeg' }), 'art=pic.jpeg');
assert.equal(cover({ art: 'pic.svg' }), 'art=pic.svg');

// Explicit key beats the scan.
assert.equal(cover({ 封面: 'art.png', 背景: 'other.jpg' }), '封面=art.png');

// Empty explicit value falls through to the scan.
assert.equal(cover({ cover: '', 背板: 'b.webp' }), '背板=b.webp');

// Non-image values never match (explicit empty / scan finds nothing).
assert.equal(cover({ cover: '' }), 'null');
assert.equal(cover({ 作者: '张三', status: '在读', rating: 4 }), 'null');
assert.equal(cover({ title: 'Note', note: 'see a.png.org' }), 'null');

// tags/position are skipped by the scan even when they look like images.
assert.equal(cover({ tags: ['a.png'] }), 'null');
assert.equal(cover({ position: { start: { line: 0 } } }), 'null');

// Unusable value shapes.
assert.equal(cover({ cover: { nested: true } }), 'null');
assert.equal(cover({ cover: new Date(0) }), 'null');
assert.equal(cover({ cover: [] }), 'null');
assert.equal(cover({}), 'null');

console.log('extractCoverValue semantics: PASS');

// ---------- 2. viewMode round-trip ----------

const md = [
	'---',
	'columns:',
	'  - name: 书库',
	"    color: '#6366f1'",
	'    type: library',
	'    library:',
	'      viewMode: gallery',
	'      sortBy: modified',
	'      sortDesc: true',
	'---',
	'',
	'## 书库',
].join('\n');

const data = parse(md);
assert.equal(data.columns[0]?.libraryConfig?.viewMode, 'gallery', 'gallery parses from markdown');
assert.equal(
	parse(serialize(data)).columns[0]?.libraryConfig?.viewMode,
	'gallery',
	'gallery survives serialize -> parse round-trip',
);

const unknownMd = md.replace('viewMode: gallery', 'viewMode: poster');
assert.equal(
	parse(unknownMd).columns[0]?.libraryConfig?.viewMode,
	'grid',
	'unknown viewMode still falls back to grid',
);

console.log('viewMode round-trip: PASS');
console.log('library cover: ALL PASS');
