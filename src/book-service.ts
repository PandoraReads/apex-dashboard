import { App, Platform, TFile, normalizePath, requestUrl } from 'obsidian';

export interface BookSearchResult {
	title: string;
	author: string;
	coverUrl: string;
	isbn: string;
}

const DOUBAN_SUGGEST = 'https://book.douban.com/j/subject_suggest';

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
	if (!query.trim()) return [];

	try {
		const response = await requestUrl({
			url: `${DOUBAN_SUGGEST}?q=${encodeURIComponent(query)}`,
			method: 'GET',
		});

		const data = response.json as DoubanSuggestItem[];
		if (!Array.isArray(data)) return [];

		return data
			.filter(item => item.type === 'b')
			.map(item => ({
				title: item.title ?? '',
				author: item.author_name ?? '',
				coverUrl: item.pic ?? '',
				isbn: item.id ?? '',
			}));
	} catch {
		return [];
	}
}

export async function downloadCoverAsBlobUrl(remoteUrl: string): Promise<string> {
	if (!remoteUrl) return '';
	try {
		const response = await requestUrl({
			url: remoteUrl,
			method: 'GET',
			headers: { Referer: 'https://book.douban.com/' },
		});
		const buffer = response.arrayBuffer;
		if (!buffer || buffer.byteLength === 0) return '';
		const contentType = response.headers['content-type'] || 'image/jpeg';
		const blob = new Blob([buffer], { type: contentType });
		return URL.createObjectURL(blob);
	} catch {
		return '';
	}
}

/** MIME by cover file extension (unknown extensions fall back to jpeg). */
const COVER_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
};

/**
 * Resolve a user-entered cover reference into a URL usable in CSS url().
 * Handles four shapes: http(s) links (fetched as a blob), data: URIs,
 * vault-internal paths (read through the vault API), and absolute local
 * filesystem paths / file:// URIs (desktop only, via the app://local
 * protocol). Returns '' when nothing renders so callers keep the placeholder.
 */
export async function resolveCoverAsObjectUrl(coverUrl: string, app: App): Promise<string> {
	const raw = coverUrl.trim();
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw)) return downloadCoverAsBlobUrl(raw);
	if (/^data:/i.test(raw)) return raw;
	// A file:// URI is unambiguously an absolute local path.
	if (/^file:\/\//i.test(raw)) {
		try {
			return await localCoverUrl(decodeURIComponent(raw.replace(/^file:\/\//i, '')));
		} catch {
			return '';
		}
	}
	// Windows drive paths are absolute local paths too; a vault path can
	// never contain a drive letter.
	if (/^[a-zA-Z]:[\\/]/.test(raw)) return localCoverUrl(raw.replace(/\\/g, '/'));
	// POSIX: a leading slash may be a vault-rooted path OR an absolute disk
	// path — resolve against the vault first, then fall back to disk.
	if (raw.startsWith('/')) {
		const inVault = await vaultCoverUrl(raw.replace(/^\/+/, ''), app);
		if (inVault) return inVault;
		return localCoverUrl(raw);
	}
	return vaultCoverUrl(raw, app);
}

/** Read a vault-internal image into a blob URL; '' when the path misses. */
async function vaultCoverUrl(path: string, app: App): Promise<string> {
	try {
		const file = app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return '';
		const buffer = await app.vault.readBinary(file);
		const type = COVER_MIME[file.extension.toLowerCase()] ?? 'image/jpeg';
		return URL.createObjectURL(new Blob([buffer], { type }));
	} catch {
		return '';
	}
}

/**
 * Absolute-path cover via Obsidian's desktop-only app://local protocol (the
 * renderer blocks file:// under web security). The URL is probed with an
 * Image load before being handed back, so a wrong path keeps the placeholder
 * instead of painting an empty cover box. Mobile has no such protocol — ''.
 */
async function localCoverUrl(absPath: string): Promise<string> {
	if (!Platform.isDesktopApp || !absPath) return '';
	const url = `app://local/${encodeURI(absPath)}`;
	const loadable = await new Promise<boolean>(resolve => {
		const img = new Image();
		img.onload = () => resolve(true);
		img.onerror = () => resolve(false);
		img.src = url;
	});
	return loadable ? url : '';
}

interface DoubanSuggestItem {
	title: string;
	url: string;
	pic: string;
	author_name: string;
	year: string;
	type: string;
	id: string;
}
