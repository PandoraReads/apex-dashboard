import { requestUrl } from 'obsidian';

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

interface DoubanSuggestItem {
	title: string;
	url: string;
	pic: string;
	author_name: string;
	year: string;
	type: string;
	id: string;
}
