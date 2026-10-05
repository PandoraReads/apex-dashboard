/**
 * Real-world feed smoke test (NOT a npm verify script — ad-hoc harness):
 * parses live-downloaded feeds in /tmp through the production pipeline and
 * prints what the section would actually see. Run:
 *   npx esbuild scripts/real-feed-check.ts --bundle --platform=node \
 *     --format=cjs --outfile=node_modules/.tmp/real-feed-check.cjs && \
 *     node node_modules/.tmp/real-feed-check.cjs
 */
import { readFileSync } from 'node:fs';
import { parseFeedXml } from '../src/rss-xml';
import { htmlToMarkdown, stripHtmlText } from '../src/html-md';

const SAMPLES: Array<{ file: string; expect: string }> = [
	{ file: '/tmp/feed-hn.xml', expect: 'rss' },
	{ file: '/tmp/feed-sspai.xml', expect: 'rss' },
	{ file: '/tmp/feed-github.xml', expect: 'rss' },
	{ file: '/tmp/feed-v2ex.xml', expect: 'rss' },
	{ file: '/tmp/feed-ruanyifeng.xml', expect: 'html-challenge' },
];

let failures = 0;
for (const { file, expect } of SAMPLES) {
	const name = file.split('/').pop();
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (err) {
		console.log(`✗ ${name}: unreadable (${(err as Error).message})`);
		failures++;
		continue;
	}
	const feed = parseFeedXml(text);
	if (expect === 'html-challenge') {
		const ok = feed === null;
		console.log(`${ok ? '✓' : '✗'} ${name}: challenge page -> ${feed === null ? 'null (correct)' : 'PARSED (should be null!)'}`);
		if (!ok) failures++;
		continue;
	}
	if (!feed) {
		console.log(`✗ ${name}: parse returned null`);
		failures++;
		continue;
	}
	const withFull = feed.items.filter(i => i.contentHtml && stripHtmlText(i.contentHtml).length >= 500).length;
	const withDates = feed.items.filter(i => i.pubDate !== undefined).length;
	const withGuids = feed.items.filter(i => i.guid.length > 0).length;
	console.log(`✓ ${name}: "${feed.title}" | ${feed.items.length} items | full-text ${withFull} | dated ${withDates} | guid ${withGuids} | first: "${feed.items[0]?.title?.slice(0, 50)}"`);
	// Convert the first full-text item's HTML to markdown, verify sanity.
	const full = feed.items.find(i => i.contentHtml && stripHtmlText(i.contentHtml).length >= 500);
	if (full) {
		const md = htmlToMarkdown(full.contentHtml!, { baseUrl: feed.link || full.link, skipFirstHeading: true });
		const imgs = (md.match(/!\[[^\]]*\]\(/g) ?? []).length;
		const links = (md.match(/[^!]\[[^\]]+\]\(/g) ?? []).length;
		console.log(`   → md ${md.length} chars, ${imgs} imgs, ${links} links, no raw tags: ${!/<(p|div|span)\b/.test(md)}`);
	}
}

console.log(failures === 0 ? '\nreal-feed-check: ALL OK' : `\nreal-feed-check: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
