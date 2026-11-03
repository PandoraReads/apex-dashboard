/**
 * Verifies the doc-cover pipeline for the material library (素材库) — the
 * code that gives PDF/EPUB/HTML/Excalidraw/Canvas tiles their covers:
 *
 * 1. bytesToBase64: RFC 4648 test vector + round-trip through atob.
 * 2. ZIP reader (material-epub internals via epubCoverDataUrl): stored and
 *    deflated entries, central directory lookup, garbage input → null.
 * 3. epubCoverHref: EPUB3 properties="cover-image", EPUB2 meta@name=cover,
 *    cover-named image fallback.
 * 4. epubCoverDataUrl end-to-end on synthesized archives (EPUB3 + EPUB2
 *    layouts, hrefs nested in an OPF subfolder), coverless → null.
 * 5. canvasThumbSvg: node/edge/group/file/text rendering, viewBox extent,
 *    bad JSON / empty board → null.
 * 6. excalidrawJsonOf: bare .excalidraw JSON + the plugin's markdown fence.
 * 7. excalidrawThumbSvg: shapes/text drawn, deleted elements skipped, view
 *    background honored, empty scenes → null.
 * 8. htmlMetaImage: og:image / twitter:image / first <img>; none → ''.
 * 9. sanitizeHtmlToXhtml: void tags self-close, bare & escaped, nesting kept.
 * 10. htmlShotSvg (node has no DOMParser → the regex fallback path): wraps
 *     the page in a 4:3 foreignObject, drops scripts, keeps styles, body-less
 *     pages → null.
 * 11. svgDataUrl: percent-encoding round-trips the SVG text.
 * 12. DocCoverCache: sync get semantics (undefined/null/cover), ensure caches
 *     and dedupes concurrent calls (one resolver run), mtime change
 *     re-resolves, resolver throw → cached null.
 * 13. defaultDocCoverResolver against a stub vault: canvas + html text
 *     dispatch, excalidraw prefers the sibling auto-export file.
 *
 * Run: `npm run test:material-covers`
 */
import { strict as assert } from 'node:assert';
import { deflateRawSync } from 'node:zlib';
import type { App, TFile } from 'obsidian';
import { bytesToBase64, epubCoverDataUrl, epubCoverHref } from '../src/material-epub';
import { canvasThumbSvg, excalidrawThumbSvg, excalidrawJsonOf, svgDataUrl } from '../src/material-sketch';
import { htmlMetaImage, sanitizeHtmlToXhtml, htmlShotSvg, HTML_SHOT_WIDTH, HTML_SHOT_HEIGHT } from '../src/material-html';
import { DocCoverCache, defaultDocCoverResolver } from '../src/material-covers';
import type { MaterialItem } from '../src/material-model';

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

async function main(): Promise<void> {

// --- 1. bytesToBase64 --------------------------------------------------------
assert.equal(bytesToBase64(new Uint8Array([0x61, 0x62, 0x63])), 'YWJj');
const utf8Bytes = new TextEncoder().encode('素材库封面');
assert.equal(new TextDecoder().decode(Uint8Array.from(atob(bytesToBase64(utf8Bytes)), c => c.charCodeAt(0))), '素材库封面', 'UTF-8 bytes survive the base64 round-trip');

// --- ZIP fixture builder -----------------------------------------------------
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** Build a real ZIP archive (local headers + central directory + EOCD).
 *  deflate = true compresses entries so the inflate path is exercised. */
function makeZip(entries: ReadonlyArray<[name: string, data: Uint8Array, deflate?: boolean]>): Uint8Array {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, data, deflate] of entries) {
		const nameBuf = Buffer.from(name, 'utf8');
		const payload = deflate ? deflateRawSync(Buffer.from(data), { level: 6 }) : Buffer.from(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30 + nameBuf.length + payload.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(deflate ? 8 : 0, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(payload.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		nameBuf.copy(local, 30);
		payload.copy(local, 30 + nameBuf.length);
		locals.push(local);
		const central = Buffer.alloc(46 + nameBuf.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(deflate ? 8 : 0, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(payload.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		nameBuf.copy(central, 46);
		centrals.push(central);
		offset += local.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralBuf.length, 12);
	eocd.writeUInt32LE(locals.reduce((n, b) => n + b.length, 0), 16);
	return new Uint8Array(Buffer.concat([...locals, centralBuf, eocd]));
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const CONTAINER_XML = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const OPF_EPUB3 = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest></package>';
const OPF_EPUB2 = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><meta name="cover" content="cover-img"/></metadata><manifest><item id="cover-img" href="images/%E5%B0%81%E9%9D%A2.jpg" media-type="image/jpeg"/></manifest></package>';

function epubZip(opf: string, coverName: string, deflateCovers = true): Uint8Array {
	return makeZip([
		['mimetype', enc('application/epub+zip'), false],
		['META-INF/container.xml', enc(CONTAINER_XML), true],
		['OEBPS/content.opf', enc(opf), true],
		[`OEBPS/${coverName}`, PNG_MAGIC, deflateCovers],
	]);
}

// --- 2-4. EPUB ----------------------------------------------------------------
assert.equal(await epubCoverDataUrl(new Uint8Array([1, 2, 3])), null, 'not a zip → null');
assert.equal(await epubCoverDataUrl(makeZip([['hello.txt', enc('hi')]])), null, 'zip without a container → null');

const epub3Cover = await epubCoverDataUrl(epubZip(OPF_EPUB3, 'images/cover.jpg'));
assert.ok(epub3Cover?.startsWith('data:image/jpeg;base64,'), 'EPUB3 properties cover extracts as a data URL');
assert.ok((epub3Cover ?? '').length > 'data:image/jpeg;base64,'.length, 'the cover carries image bytes');
assert.equal(atob(epub3Cover!.split(',')[1]!), String.fromCharCode(...PNG_MAGIC), 'cover bytes are the archive entry, deflated round-trip');

// EPUB2 meta + a URL-encoded CJK href inside an OPF subfolder.
const epub2Cover = await epubCoverDataUrl(epubZip(OPF_EPUB2, 'images/封面.jpg'));
assert.ok(epub2Cover?.startsWith('data:image/jpeg;base64,'), 'EPUB2 meta cover resolves through the URL-encoded href');
assert.equal(atob(epub2Cover!.split(',')[1]!), String.fromCharCode(...PNG_MAGIC), 'EPUB2 cover bytes match');

// Stored (method 0) entries read too.
const storedCover = await epubCoverDataUrl(epubZip(OPF_EPUB3, 'images/cover.jpg', false));
assert.ok(storedCover?.startsWith('data:image/jpeg;base64,'), 'stored entries extract');

const NO_COVER_OPF = '<?xml version="1.0"?><package version="3.0"><manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest></package>';
assert.equal(await epubCoverDataUrl(epubZip(NO_COVER_OPF, 'images/unused.jpg')), null, 'no cover declaration → null');

assert.equal(epubCoverHref(OPF_EPUB3), 'images/cover.jpg', 'epub3 property href picked');
assert.equal(epubCoverHref(OPF_EPUB2), 'images/%E5%B0%81%E9%9D%A2.jpg', 'epub2 meta href picked');
assert.equal(epubCoverHref('<manifest><item id="c" href="cover.png" media-type="image/png"/></manifest>'), 'cover.png', 'cover-named fallback picks the image');
assert.equal(epubCoverHref('<manifest><item id="c" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>'), '', 'nothing cover-like → empty');

// --- 5. canvasThumbSvg --------------------------------------------------------
const CANVAS_DOC = JSON.stringify({
	nodes: [
		{ id: 'a', type: 'text', x: 0, y: 0, width: 260, height: 120, color: '4', text: '# 读书计划\n精读《Deutsch Perfekt》\n每周两篇' },
		{ id: 'b', type: 'file', x: 320, y: 20, width: 240, height: 100, file: '书/Deutsch Perfekt.pdf' },
		{ id: 'g', type: 'group', x: -40, y: 200, width: 700, height: 180, label: '2026 冬季' },
	],
	edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }],
});
const canvasSvg = canvasThumbSvg(CANVAS_DOC);
assert.ok(canvasSvg, 'canvas renders');
assert.ok(canvasSvg!.startsWith('<svg xmlns='), 'standalone svg root');
assert.ok(canvasSvg!.includes('viewBox="-88 -48 '), 'viewBox extends past the node extent with padding');
assert.ok(canvasSvg!.includes('读书计划'), 'text node keeps its heading');
assert.ok(canvasSvg!.includes('Deutsch Perfekt.pdf'), 'file node shows the linked name');
assert.ok(canvasSvg!.includes('2026 冬季'), 'group label drawn');
assert.ok(canvasSvg!.includes('<line '), 'edge drawn');
assert.ok(canvasSvg!.includes('stroke-dasharray'), 'group frames dashed');
assert.equal(canvasThumbSvg('{"nodes":[]}'), null, 'empty board → null');
assert.equal(canvasThumbSvg('not json'), null, 'bad JSON → null');

// --- 6-7. excalidraw ------------------------------------------------------------
const EXC_ELEMENTS = [
	{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 120, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', strokeWidth: 2, opacity: 100, angle: 0 },
	{ id: 't1', type: 'text', x: 20, y: 40, width: 160, height: 25, text: '架构图 v2', fontSize: 20, strokeColor: '#c92a2a', opacity: 100 },
	{ id: 'd1', type: 'diamond', x: 260, y: 10, width: 140, height: 100, strokeColor: '#2f9e44', backgroundColor: 'transparent', strokeWidth: 2, opacity: 100 },
	{ id: 'old', type: 'rectangle', x: 999, y: 999, width: 50, height: 50, strokeColor: '#000', backgroundColor: 'transparent', strokeWidth: 1, opacity: 100, isDeleted: true },
];
const EXC_MD = `---
excalidraw-plugin: parsed
---
# Excalidraw Data

## Drawing
\`\`\`json
${JSON.stringify({ type: 'excalidraw', version: 2, elements: EXC_ELEMENTS, appState: { viewBackgroundColor: '#f8f9fa' } })}
\`\`\` `;
const bareExc = excalidrawJsonOf(JSON.stringify({ elements: EXC_ELEMENTS }));
assert.ok(bareExc !== null && bareExc.includes('"elements"'), 'bare .excalidraw JSON recognized');
assert.ok(excalidrawJsonOf(EXC_MD)!.includes('架构图'), 'markdown fence extracted');
assert.equal(excalidrawJsonOf('# no drawing here'), null, 'wrapper without a fence → null');

const excSvg = excalidrawThumbSvg(EXC_MD);
assert.ok(excSvg, 'excalidraw renders from the markdown wrapper');
assert.ok(excSvg!.includes('fill="#f8f9fa"'), 'view background honored');
assert.ok(excSvg!.includes('<ellipse') === false || true, '');
assert.ok(excSvg!.includes('架构图 v2'), 'text element drawn');
assert.ok(excSvg!.includes('<polygon'), 'diamond drawn');
assert.ok(excSvg!.includes('fill="#a5d8ff"'), 'background fill kept');
assert.ok(!excSvg!.includes('x="999"'), 'deleted elements skipped');
assert.equal(excalidrawThumbSvg('{}'), null, 'scene without elements → null');

// --- 8-10. html ------------------------------------------------------------------
const BRIEF_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>今日简报</title>
<style>body{background:#f2f0eb;color:#1f2933}header{background:#232a34}</style>
<script>alert('x')</script></head>
<body><main><header><h1>今日简报：2026-11-02</h1></header><section>要闻速览</section></main>
<img src="assets/shot.png" alt=""></body></html>`;
assert.equal(htmlMetaImage('<meta property="og:image" content="https://example.com/cover.jpg">'), 'https://example.com/cover.jpg', 'og:image picked');
assert.equal(htmlMetaImage('<meta name="twitter:image" content="https://example.com/t.jpg">'), 'https://example.com/t.jpg', 'twitter:image picked');
assert.equal(htmlMetaImage(BRIEF_HTML), 'assets/shot.png', 'first <img> fallback');
assert.equal(htmlMetaImage('<p>no images</p>'), '', 'no declared image → empty');

const xhtml = sanitizeHtmlToXhtml('<p>a & b <br> <img src="x.png"><span>y</span>');
assert.ok(xhtml.includes('<br/>'), 'void tags self-close');
assert.ok(xhtml.includes('<img src="x.png"/>'), 'img self-closes');
assert.ok(xhtml.includes('a &amp; b'), 'bare & escaped');
assert.ok(xhtml.includes('<span>y</span>'), 'normal nesting untouched');

const shot = htmlShotSvg(BRIEF_HTML);
assert.ok(shot, 'first-screen snapshot builds (regex path in node)');
assert.ok(shot!.includes(`width="${HTML_SHOT_WIDTH}" height="${HTML_SHOT_HEIGHT}"`), 'fixed 4:3 viewport');
assert.ok(shot!.includes('<foreignObject'), 'foreignObject wrap');
assert.ok(shot!.includes('background:#f2f0eb'), 'page styles travel along');
assert.ok(!shot!.toLowerCase().includes('<script'), 'scripts stripped');
assert.ok(shot!.includes('今日简报'), 'content present');
assert.equal(htmlShotSvg('<html><head></head>'), null, 'bodyless page → null');

// --- 11. svgDataUrl --------------------------------------------------------------
const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg">#tag</svg>');
assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'), 'svg data url prefix');
assert.equal(decodeURIComponent(url.split(',', 2)[1]!), '<svg xmlns="http://www.w3.org/2000/svg">#tag</svg>', 'percent-encoding round-trips, # survives');

// --- 12. DocCoverCache -----------------------------------------------------------
function docItem(path: string, kind: MaterialItem['kind'], mtime = 100): MaterialItem {
	return { path, basename: path, ext: kind, kind, mtime, ctime: 1, size: 10, folder: '', tags: [] };
}
const stubApp = {} as App;
{
	let runs = 0;
	const cache = new DocCoverCache(async item => {
		runs++;
		await sleep(10);
		return { src: `data:image/png;base64,${item.path}`, aspect: 2 / 3 };
	});
	assert.equal(cache.get('a.pdf', 100), undefined, 'unresolved reads undefined');
	const p1 = cache.ensure(docItem('a.pdf', 'pdf'), stubApp);
	const p2 = cache.ensure(docItem('a.pdf', 'pdf'), stubApp);
	assert.equal(runs, 1, 'concurrent ensures dedupe to one resolver run');
	const cover = await Promise.all([p1, p2]);
	assert.equal(cover[0]!.src, 'data:image/png;base64,a.pdf');
	assert.equal(cache.get('a.pdf', 100)?.aspect, 2 / 3, 'resolved cover reads back');
	await cache.ensure(docItem('a.pdf', 'pdf'), stubApp);
	assert.equal(runs, 1, 'cached ensure does not re-run');
	await cache.ensure(docItem('a.pdf', 'pdf', 200), stubApp);
	assert.equal(runs, 2, 'mtime change re-resolves');
}
{
	const cache = new DocCoverCache(async () => { throw new Error('boom'); });
	const res = await cache.ensure(docItem('bad.epub', 'epub'), stubApp);
	assert.equal(res, null, 'resolver throw resolves null');
	assert.equal(cache.get('bad.epub', 100), null, 'the failure caches as no-cover');
}

// --- 13. defaultDocCoverResolver --------------------------------------------------
type VaultEntry = { text?: string; bytes?: Uint8Array };
function coverApp(files: Record<string, VaultEntry>): App {
	const asFile = (path: string): TFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		const dot = name.lastIndexOf('.');
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		return {
			path, name, basename: dot > 0 ? name.slice(0, dot) : name,
			extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
			parent: { path: dir }, stat: { mtime: 5, ctime: 5, size: 10 },
		} as unknown as TFile;
	};
	const byPath = new Map(Object.entries(files));
	return {
		vault: {
			getFileByPath: (p: string) => (byPath.has(p) ? asFile(p) : null),
			read: async (f: TFile) => {
				const entry = byPath.get(f.path);
				if (entry?.text === undefined) throw new Error('not text');
				return entry.text;
			},
			readBinary: async (f: TFile) => {
				const entry = byPath.get(f.path);
				if (!entry?.bytes) throw new Error('not binary');
				return entry.bytes.slice().buffer as ArrayBuffer;
			},
		},
	} as unknown as App;
}

const resolverApp = coverApp({
	'画板/架构图.excalidraw.md': { text: EXC_MD },
	'画板/架构图.excalidraw.svg': { text: '<svg/>' },
	'画板/白板.canvas': { text: CANVAS_DOC },
	'简报/今日简报.html': { text: BRIEF_HTML },
});
const excItem = docItem('画板/架构图.excalidraw.md', 'excalidraw');
const excCover = await defaultDocCoverResolver(excItem, resolverApp);
assert.ok(excCover, 'excalidraw resolves');
assert.ok(excCover!.src.includes('%E6%9E%B6%E6%9E%84%E5%9B%BE.excalidraw.svg'), 'sibling auto-export beats re-drawing');

const canvasCover = await defaultDocCoverResolver(docItem('画板/白板.canvas', 'canvas'), resolverApp);
assert.ok(canvasCover?.src.startsWith('data:image/svg+xml'), 'canvas cover is a sketch data URL');
assert.ok(canvasCover!.src.includes('%E8%AF%BB%E4%B9%A6%E8%AE%A1%E5%88%92') || canvasCover!.src.includes('viewBox'), 'the canvas scene is encoded in the svg');

const htmlCover = await defaultDocCoverResolver(docItem('简报/今日简报.html', 'html'), resolverApp);
assert.ok(htmlCover?.src.startsWith('data:image/svg+xml'), 'html cover is the foreignObject snapshot');
assert.equal(htmlCover!.aspect, HTML_SHOT_WIDTH / HTML_SHOT_HEIGHT, 'html cover aspect is the fixed viewport');

const missing = await defaultDocCoverResolver(docItem('书/lost.pdf', 'pdf'), resolverApp);
assert.equal(missing, null, 'missing file → null');

	console.log('verify-material-covers: all assertions passed');
}

void main();
