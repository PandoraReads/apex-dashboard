/**
 * RSS 2.0 / Atom feed parsing (pure functions, zero dependencies).
 *
 * Feed XML is extracted with tolerant regexes rather than a real XML parser:
 * inside content:encoded / content elements the payload HTML is entity-escaped
 * (or CDATA-wrapped), so literal `<item>`/`<entry>` tags from the payload
 * never appear as raw markup — block-splitting on them is safe in practice.
 * Malformed feeds degrade item-by-item instead of failing the whole feed.
 */

import { decodeHtmlEntities } from './html-md';

/** One feed article. `guid` is the stable identity (guid, else link). */
export interface RssItem {
	guid: string;
	title: string;
	link: string;
	author?: string;
	/** Published time, epoch ms. Undefined when the feed carries no date. */
	pubDate?: number;
	/** Full-text HTML (RSS content:encoded / Atom content), when provided. */
	contentHtml?: string;
	/** Summary HTML (RSS description / Atom summary). */
	summaryHtml?: string;
}

export interface RssFeed {
	title: string;
	/** Site home URL, used to absolutize relative article URLs. */
	link: string;
	items: RssItem[];
}

/** Raw inner text of the first `<tag ...>…</tag>` in `src`, else ''. */
function extract(src: string, tag: string): string {
	const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
	const m = re.exec(src);
	return m ? m[1]!.trim() : '';
}

/** Unwrap CDATA when present, then decode entities. */
function unescapeValue(raw: string): string {
	const cdata = /^<!\[CDATA\[([\s\S]*)]]>$/.exec(raw.trim());
	const body = cdata ? cdata[1]! : raw;
	return decodeHtmlEntities(body).trim();
}

/** Plain-text a value that may carry inline HTML (titles, authors). */
function plainText(raw: string): string {
	return unescapeValue(raw)
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Parse a date string (RFC 822 or ISO) to epoch ms; undefined when invalid. */
function parseDate(raw: string): number | undefined {
	const value = unescapeValue(raw);
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

/** RSS 2.0: `<link>text</link>` (Atom-style link tags have no text body). */
function rssLink(src: string): string {
	const raw = extract(src, 'link');
	// An atom:link (`<link href=…/>`) yields '' from extract; its href is not
	// the article URL anyway (it points at the feed itself).
	return unescapeValue(raw).replace(/<[^>]*>/g, '').trim();
}

/** Atom: pick the link with rel="alternate" (or no rel), else the first href. */
function atomLink(src: string): string {
	const tags = src.match(/<link\b[^>]*>/gi) ?? [];
	let fallback = '';
	for (const tag of tags) {
		const href = /href\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
		if (!href) continue;
		const rel = /rel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
		if (rel === 'alternate' || rel === '') return href;
		if (!fallback) fallback = href;
	}
	return fallback;
}

/** RSS 2.0 items from `<item>` blocks. */
function parseRssItems(channel: string): RssItem[] {
	const items: RssItem[] = [];
	for (const block of matchBlocks(channel, /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
		const title = plainText(extract(block, 'title'));
		const link = rssLink(block);
		const guid = unescapeValue(extract(block, 'guid')) || link;
		if (!guid) continue; // nothing to identify the row by
		const author = plainText(extract(block, 'dc:creator')) || plainText(extract(block, 'author')) || undefined;
		const pubDate = parseDate(extract(block, 'pubDate')) ?? parseDate(extract(block, 'dc:date'));
		const contentHtml = unescapeValue(extract(block, 'content:encoded'));
		const summaryHtml = unescapeValue(extract(block, 'description'));
		items.push({
			guid,
			title: title || '(untitled)',
			link,
			author: author || undefined,
			pubDate,
			contentHtml: contentHtml || undefined,
			summaryHtml: summaryHtml || undefined,
		});
	}
	return items;
}

/** Atom entries from `<entry>` blocks. */
function parseAtomEntries(feed: string): RssItem[] {
	const items: RssItem[] = [];
	for (const block of matchBlocks(feed, /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
		const title = plainText(extract(block, 'title'));
		const link = atomLink(block);
		const guid = unescapeValue(extract(block, 'id')) || link;
		if (!guid) continue;
		const authorRaw = extract(block, 'author');
		const author = plainText(extract(authorRaw, 'name')) || plainText(authorRaw) || undefined;
		const pubDate = parseDate(extract(block, 'published'))
			?? parseDate(extract(block, 'issued'))
			?? parseDate(extract(block, 'updated'));
		const contentHtml = unescapeValue(extract(block, 'content'));
		const summaryHtml = unescapeValue(extract(block, 'summary'));
		items.push({
			guid,
			title: title || '(untitled)',
			link,
			author: author || undefined,
			pubDate,
			contentHtml: contentHtml || undefined,
			summaryHtml: summaryHtml || undefined,
		});
	}
	return items;
}

/** Map regex matches to their first capture group (iterator helper shim). */
function matchBlocks(src: string, re: RegExp): string[] {
	const out: string[] = [];
	for (const m of src.matchAll(re)) out.push(m[1] ?? '');
	return out;
}

/**
 * Parse a feed document (RSS 2.0, RSS 1.0-with-items, or Atom). Returns null
 * for input that is neither (HTML error pages, JSON, empty strings).
 */
export function parseFeedXml(text: string): RssFeed | null {
	if (typeof text !== 'string' || text.trim().length === 0) return null;

	if (/<feed[\s>]/i.test(text)) {
		const title = plainText(extract(text, 'title'));
		const link = atomLink(text);
		const items = parseAtomEntries(text);
		if (!title && !link && items.length === 0) return null;
		return { title: title || link, link, items };
	}

	if (/<rss[\s>]/i.test(text) || /<channel[\s>]/i.test(text) || /<item[\s>]/i.test(text)) {
		const channelMatch = /<channel(?:\s[^>]*)?>([\s\S]*?)<\/channel>/i.exec(text);
		const channel = channelMatch ? channelMatch[1]! : text;
		const title = plainText(extract(channel, 'title'));
		const link = channelMatch ? rssLink(channel) : '';
		const items = parseRssItems(channelMatch ? channel : text);
		if (!title && !link && items.length === 0) return null;
		return { title: title || link, link, items };
	}

	return null;
}
