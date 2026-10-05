/**
 * RSS network orchestration: fetch feeds via requestUrl (CORS-free, injectable
 * fetcher for verification scripts — the web-precheck seam pattern), parse
 * them into the store, and resolve an article's readable Markdown with the
 * agreed preference order:
 *
 *   1. the feed's own full text (content:encoded), when it is substantial;
 *   2. a cached web extraction for that guid (fetched once, reused);
 *   3. a fresh fetch + readability extraction of the article page;
 *   4. the feed summary — the modal shows it with an open-in-browser button.
 */

import { requestUrl } from 'obsidian';
import { htmlToMarkdown, stripHtmlText } from './html-md';
import { extractArticle } from './rss-readability';
import type { RssItem } from './rss-xml';
import { parseFeedXml } from './rss-xml';
import type { RssStore } from './rss-store';
import { isValidWebUrl, normalizeWebUrl } from './web-precheck';

/** Injectable text fetcher seam (tests queue canned responses). */
export type RssTextFetcher = (url: string) => Promise<string>;

/** Default fetcher: requestUrl bypasses CORS; UA because some feeds 403 the
 *  bare Obsidian client string. */
export const requestUrlTextFetcher: RssTextFetcher = async (url) => {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: {
			'User-Agent': 'obsidian-dashboard (+https://github.com/pandora/apex-dashboard)',
			Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
		},
	});
	return response.text;
};

const FEED_TIMEOUT_MS = 15_000;
const PAGE_TIMEOUT_MS = 12_000;
/** Feed full text shorter than this (stripped) counts as "summary-only". */
const FULL_TEXT_MIN_CHARS = 500;

/** Promise.race timeout bound (window.* timer per the popout lint rule). */
function withTimeout(promise: Promise<string>, ms: number): Promise<string> {
	let timer: number | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = window.setTimeout((): void => reject(new Error('rss fetch timeout')), ms);
		}),
	]).finally(() => {
		if (timer !== undefined) window.clearTimeout(timer);
	});
}

/** A feed's normalized URL (the store's cache key). */
export function feedKey(url: string): string {
	return normalizeWebUrl(url);
}

/** Fetch every configured feed that is stale (`force` bypasses freshness),
 *  updating the store per feed. One feed failing never blocks the others. */
export async function refreshFeeds(
	store: RssStore,
	sources: ReadonlyArray<{ name?: string; url: string }>,
	opts: { force?: boolean; fetcher?: RssTextFetcher; now?: number } = {},
): Promise<void> {
	const fetcher = opts.fetcher ?? requestUrlTextFetcher;
	const targets = sources
		.map(source => ({ ...source, url: feedKey(source.url) }))
		.filter(source => source.url.length > 0 && isValidWebUrl(source.url));

	// Polite concurrency cap: a burst of N parallel hits on one mirror makes
	// it slow-shed requests (observed: single curl answers in 2s while a
	// 13-wide burst times out at 15s). A 4-wide rolling pool keeps refreshes
	// quick without tripping rate limits.
	const MAX_CONCURRENT_FETCHES = 4;
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < targets.length) {
			const source = targets[cursor++]!;
			await fetchOne(source);
		}
	};
	const fetchOne = async (source: { name?: string; url: string }): Promise<void> => {
		if (!opts.force && !store.isStale(source.url, opts.now)) return;
		const label = source.name?.trim() || source.url;
		try {
			const text = await withTimeout(fetcher(source.url), FEED_TIMEOUT_MS);
			const feed = parseFeedXml(text);
			if (!feed || feed.items.length === 0) throw new Error('unparseable or empty feed');
			store.setFeed(source.url, {
				title: label || feed.title || source.url,
				link: feed.link,
				items: feed.items,
				fetchedAt: Date.now(),
			});
		} catch (err) {
			// Keep whatever items the last successful fetch had; surface the
			// error so the section can show a per-feed failure chip.
			const reason = err instanceof Error ? err.message : String(err);
			const prev = store.feedEntry(source.url);
			store.setFeed(source.url, {
				title: prev?.title ?? label,
				items: prev?.items ?? [],
				fetchedAt: Date.now(),
				error: reason,
			});
		}
	};
	await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FETCHES, targets.length) }, () => worker()));
}

/** Where an article's Markdown came from (drives the modal's fallback UI). */
export type ArticleMarkdownSource = 'feed' | 'web' | 'summary';

export interface ResolvedArticle {
	markdown: string | null;
	source: ArticleMarkdownSource;
}

/** Resolve the Markdown to render/save for one article (see file header). */
export async function resolveArticleMarkdown(
	store: RssStore,
	feed: { title: string; link: string },
	item: RssItem,
	opts: { fetcher?: RssTextFetcher } = {},
): Promise<ResolvedArticle> {
	// 1. Substantial feed full text.
	if (item.contentHtml && stripHtmlText(item.contentHtml).length >= FULL_TEXT_MIN_CHARS) {
		return { markdown: htmlToMarkdown(item.contentHtml, { baseUrl: feed.link || item.link }), source: 'feed' };
	}

	// 2. Previously extracted page content.
	const cached = store.cachedWeb(item.guid);
	if (cached) return { markdown: cached, source: 'web' };

	// 3. Fetch and extract the article page.
	if (item.link && isValidWebUrl(normalizeWebUrl(item.link))) {
		try {
			const fetcher = opts.fetcher ?? requestUrlTextFetcher;
			const html = await withTimeout(fetcher(normalizeWebUrl(item.link)), PAGE_TIMEOUT_MS);
			const article = extractArticle(html, normalizeWebUrl(item.link));
			if (article && article.markdown.replace(/\s+/g, '').length >= FULL_TEXT_MIN_CHARS) {
				store.setCachedWeb(item.guid, article.markdown);
				return { markdown: article.markdown, source: 'web' };
			}
		} catch {
			// offline / blocked / timeout — fall through to the summary
		}
	}

	// 4. Whatever the feed did ship (short full text or plain summary).
	if (item.contentHtml) {
		return { markdown: htmlToMarkdown(item.contentHtml, { baseUrl: feed.link || item.link }), source: 'summary' };
	}
	if (item.summaryHtml) {
		return { markdown: htmlToMarkdown(item.summaryHtml, { baseUrl: feed.link || item.link }), source: 'summary' };
	}
	return { markdown: null, source: 'summary' };
}
