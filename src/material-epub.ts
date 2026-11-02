/**
 * EPUB cover extraction for the material library (素材库).
 *
 * An EPUB is a ZIP archive: META-INF/container.xml points at the OPF package
 * document, whose manifest names the cover image (EPUB3 via a
 * properties="cover-image" item; EPUB2 via a <meta name="cover> reference;
 * anything else falls back to a cover-named image entry).
 *
 * Everything here uses platform-native pieces only — DataView for the ZIP
 * directory and DecompressionStream('deflate-raw') for inflate — so the same
 * code runs in Obsidian's renderer and in the node test harness, with no
 * bundled dependency. Covers come back as data: URLs (base64), so nothing
 * needs lifetime management.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** Inflate chunks at this size; DecompressionStream has no length limit but
 * small chunks keep memory flat for large entries. */
const COVER_BYTES_MAX = 8 * 1024 * 1024;

interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localOffset: number;
}

/** Find the End-of-Central-Directory record: scan back from the tail (the
 * archive may carry a comment of up to 64 KiB). */
function findEocd(bytes: Uint8Array): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const minOffset = Math.max(0, bytes.length - 22 - 65535);
	for (let i = bytes.length - 22; i >= minOffset; i--) {
		if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
	}
	return -1;
}

/** Read the central directory into a name → entry map. Returns null for
 * anything that is not a well-formed ZIP (empty for an empty archive). */
function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> | null {
	const eocd = findEocd(bytes);
	if (eocd < 0) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const entryCount = view.getUint16(eocd + 10, true);
	const dirOffset = view.getUint32(eocd + 16, true);
	const decoder = new TextDecoder();
	const out = new Map<string, ZipEntry>();
	let p = dirOffset;
	for (let i = 0; i < entryCount; i++) {
		if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIGNATURE) return null;
		const method = view.getUint16(p + 10, true);
		const compressedSize = view.getUint32(p + 20, true);
		const uncompressedSize = view.getUint32(p + 24, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localOffset = view.getUint32(p + 42, true);
		const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
		out.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

/** Inflate (method 8) or pass through (method 0) one entry's payload. */
async function readEntryBytes(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array | null> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const off = entry.localOffset;
	if (off + 30 > bytes.length || view.getUint32(off, true) !== LOCAL_SIGNATURE) return null;
	const nameLen = view.getUint16(off + 26, true);
	const extraLen = view.getUint16(off + 28, true);
	const start = off + 30 + nameLen + extraLen;
	const end = start + entry.compressedSize;
	if (end > bytes.length) return null;
	const data = bytes.subarray(start, end);
	if (entry.method === 0) return data;
	if (entry.method !== 8) return null;
	const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
	if (!Ctor) return null;
	const stream = new Blob([data]).stream().pipeThrough(new Ctor('deflate-raw'));
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}

/** Look an entry up by name, tolerant of URL-encoded and case variants (EPUB
 * hrefs are URLs; ZIP entry names are the decoded file paths). */
function findEntry(entries: Map<string, ZipEntry>, name: string): ZipEntry | null {
	const hit = entries.get(name);
	if (hit) return hit;
	const lower = name.toLowerCase();
	for (const entry of entries.values()) {
		if (entry.name.toLowerCase() === lower) return entry;
	}
	try {
		const decoded = decodeURIComponent(name);
		if (decoded !== name) {
			const byDecoded = entries.get(decoded);
			if (byDecoded) return byDecoded;
		}
	} catch {
		// malformed percent sequences — ignore, name stays as-is
	}
	return null;
}

/** Base64 of raw bytes in browser-safe chunks (btoa has an argument-length
 * ceiling well below a cover image's size). */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	avif: 'image/avif',
};

function imageMimeOf(path: string): string {
	const dot = path.lastIndexOf('.');
	const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
	return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function attrOf(tag: string, attr: string): string {
	const re = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
	const m = re.exec(tag);
	return m ? m[1]! : '';
}

/** Resolve an OPF-relative href against the OPF's own folder, undoing URL
 * percent-encoding and ../ segments. */
function resolveHref(opfPath: string, href: string): string {
	let raw = href;
	try {
		raw = decodeURIComponent(href);
	} catch {
		// keep the raw form
	}
	const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
	const parts = (dir + raw).split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') stack.pop();
		else stack.push(part);
	}
	return stack.join('/');
}

/** Pick the cover href out of an OPF document: EPUB3 cover-image property,
 * EPUB2 meta@name=cover, then any cover-named image manifest entry. */
export function epubCoverHref(opfText: string): string {
	const manifest: Array<{ id: string; href: string; properties: string; type: string }> = [];
	for (const m of opfText.matchAll(/<item\s[^>]*>/gi)) {
		const tag = m[0];
		manifest.push({
			id: attrOf(tag, 'id'),
			href: attrOf(tag, 'href'),
			properties: attrOf(tag, 'properties'),
			type: attrOf(tag, 'media-type'),
		});
	}
	// EPUB3: <item properties="cover-image" href="...">
	for (const item of manifest) {
		if (/\bcover-image\b/i.test(item.properties) && item.href) return item.href;
	}
	// EPUB2: <meta name="cover" content="<manifest id>"/>
	for (const m of opfText.matchAll(/<meta\s[^>]*>/gi)) {
		const tag = m[0];
		if (attrOf(tag, 'name').toLowerCase() !== 'cover') continue;
		const id = attrOf(tag, 'content');
		const hit = manifest.find(it => it.id === id && it.href);
		if (hit) return hit.href;
	}
	// Anything cover-named that is an image.
	for (const item of manifest) {
		if (!item.href) continue;
		if (!/cover/i.test(item.href)) continue;
		if (item.type && !/^image\//i.test(item.type)) continue;
		return item.href;
	}
	return '';
}

/** Extract the cover image of an EPUB archive as a data: URL. Resolves null
 * for anything malformed or coverless. */
export async function epubCoverDataUrl(bytes: Uint8Array): Promise<string | null> {
	try {
		const entries = readCentralDirectory(bytes);
		if (!entries) return null;
		const containerEntry = findEntry(entries, 'META-INF/container.xml');
		if (!containerEntry) return null;
		const container = await readEntryBytes(bytes, containerEntry);
		if (!container) return null;
		const containerText = new TextDecoder().decode(container);
		const rootMatch = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerText);
		if (!rootMatch) return null;
		const opfPath = rootMatch[1]!;
		const opfEntry = findEntry(entries, opfPath);
		if (!opfEntry) return null;
		const opfBytes = await readEntryBytes(bytes, opfEntry);
		if (!opfBytes) return null;
		const href = epubCoverHref(new TextDecoder().decode(opfBytes));
		if (!href) return null;
		const imagePath = resolveHref(opfPath, href);
		const imageEntry = findEntry(entries, imagePath);
		if (!imageEntry) return null;
		if (imageEntry.uncompressedSize > COVER_BYTES_MAX) return null;
		const imageBytes = await readEntryBytes(bytes, imageEntry);
		if (!imageBytes || imageBytes.length === 0) return null;
		return `data:${imageMimeOf(imagePath)};base64,${bytesToBase64(imageBytes)}`;
	} catch {
		return null;
	}
}
