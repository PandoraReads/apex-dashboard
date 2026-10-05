/**
 * Verifies the RSS pure-function pipeline:
 *
 * 1. parseFeedXml: RSS 2.0 (channel meta, items, CDATA, entities, guid
 *    fallback, RFC-822 dates), Atom (entries, link rel preference, author
 *    name, published/updated), and non-feed inputs returning null.
 * 2. htmlToMarkdown: headings, inline emphasis/links/code, blockquotes,
 *    fenced code with language, nested + ordered lists, GFM tables, img URL
 *    absolutization, script/style stripping, div-per-paragraph layouts,
 *    skipFirstHeading.
 * 3. extractArticle: <article> candidate beats noisy body, chrome pruning,
 *    og:title extraction, too-short pages returning null.
 *
 * Run: `npm run test:rss-parse`
 */
import { strict as assert } from 'node:assert';
import { decodeHtmlEntities, htmlToMarkdown, stripHtmlText } from '../src/html-md';
import { parseFeedXml } from '../src/rss-xml';
import { extractArticle } from '../src/rss-readability';

const RSS_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
	<title>阮一峰的网络日志</title>
	<link>https://www.ruanyifeng.com/blog</link>
	<description>Science and technology</description>
	<item>
		<title>科技爱好者周刊：第 100 期</title>
		<link>https://www.ruanyifeng.com/blog/2026/09/weekly-issue-100.html</link>
		<guid isPermaLink="false">issue-100</guid>
		<pubDate>Mon, 28 Sep 2026 08:00:00 GMT</pubDate>
		<dc:creator>Ruan YiFeng</dc:creator>
		<description>这里是&lt;b&gt;摘要&lt;/b&gt;文字</description>
		<content:encoded><![CDATA[<p>第一段正文，足够长用于判定全文。</p><p>第二段正文。</p>]]></content:encoded>
	</item>
	<item>
		<title>Item without guid &amp; date</title>
		<link>https://www.ruanyifeng.com/blog/2026/09/no-guid.html</link>
		<description>short summary</description>
	</item>
</channel>
</rss>`;

const ATOM_FULL = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Example Engineering</title>
	<link rel="self" href="https://example.com/atom.xml"/>
	<link rel="alternate" href="https://example.com/"/>
	<entry>
		<title type="html">Post &lt;em&gt;Title&lt;/em&gt;</title>
		<id>tag:example.com,2026:post-1</id>
		<link rel="alternate" href="https://example.com/posts/1"/>
		<link rel="self" href="https://example.com/posts/1.json"/>
		<published>2026-09-20T10:00:00Z</published>
		<author><name>Jane Doe</name></author>
		<summary type="html">Atom summary text</summary>
		<content type="html">&lt;p&gt;Atom full body&lt;/p&gt;</content>
	</entry>
</feed>`;

const main = (): void => {
	/* ---------------- A. parseFeedXml ---------------- */

	// 1. RSS 2.0: channel meta + first item fields.
	const rss = parseFeedXml(RSS_FULL)!;
	assert.ok(rss, '1: rss parses');
	assert.equal(rss.title, '阮一峰的网络日志', '1: channel title');
	assert.equal(rss.link, 'https://www.ruanyifeng.com/blog', '1: channel link');
	assert.equal(rss.items.length, 2, '1: two items');
	const first = rss.items[0]!;
	assert.equal(first.guid, 'issue-100', '1: guid');
	assert.equal(first.title, '科技爱好者周刊：第 100 期', '1: title');
	assert.equal(first.link, 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-100.html', '1: link');
	assert.equal(first.author, 'Ruan YiFeng', '1: dc:creator author');
	assert.equal(first.pubDate, Date.parse('Mon, 28 Sep 2026 08:00:00 GMT'), '1: RFC-822 date');
	assert.ok(first.contentHtml?.includes('第一段正文'), '1: CDATA content decoded');
	assert.ok(first.summaryHtml?.includes('摘要'), '1: entity-decoded description');

	// 2. guid falls back to link; missing pubDate stays undefined; HTML in
	//    titles is stripped; entities decode.
	const second = rss.items[1]!;
	assert.equal(second.guid, second.link, '2: guid fallback = link');
	assert.equal(second.pubDate, undefined, '2: no date');
	assert.equal(second.title, 'Item without guid & date', '2: title cleaned + entity');
	assert.equal(second.contentHtml, undefined, '2: no content field');

	// 3. Atom: link prefers rel=alternate; author > name; published parses;
	//    type="html" content decodes entities.
	const atom = parseFeedXml(ATOM_FULL)!;
	assert.ok(atom, '3: atom parses');
	assert.equal(atom.title, 'Example Engineering', '3: feed title');
	assert.equal(atom.link, 'https://example.com/', '3: alternate link preferred');
	const entry = atom.items[0]!;
	assert.equal(entry.guid, 'tag:example.com,2026:post-1', '3: atom id');
	assert.equal(entry.link, 'https://example.com/posts/1', '3: entry alternate link');
	assert.equal(entry.author, 'Jane Doe', '3: author name');
	assert.equal(entry.pubDate, Date.parse('2026-09-20T10:00:00Z'), '3: published');
	assert.equal(entry.title, 'Post Title', '3: inline html title stripped');
	assert.ok(entry.contentHtml?.includes('Atom full body'), '3: html-typed content decoded');

	// 4. Non-feeds: HTML page / JSON / empty -> null.
	assert.equal(parseFeedXml('<!doctype html><html><body><p>hi</p></body></html>'), null, '4: html page null');
	assert.equal(parseFeedXml('{"json": true}'), null, '4: json null');
	assert.equal(parseFeedXml(''), null, '4: empty null');
	assert.equal(parseFeedXml(undefined as unknown as string), null, '4: undefined null');

	/* ---------------- B. htmlToMarkdown ---------------- */

	// 5. Headings + paragraphs + inline emphasis/link/code.
	const md5 = htmlToMarkdown(
		'<h2>小节</h2><p>这是<b>加粗</b>和<i>斜体</i>与<code>x = 1</code>。'
		+ '<a href="/docs">文档</a>与<a href="https://a.com/b">外链</a></p>',
		{ baseUrl: 'https://example.com/posts/1' },
	);
	assert.ok(md5.includes('## 小节'), '5: h2');
	assert.ok(md5.includes('**加粗**'), '5: bold');
	assert.ok(md5.includes('*斜体*'), '5: italic');
	assert.ok(md5.includes('`x = 1`'), '5: inline code');
	assert.ok(md5.includes('[文档](https://example.com/docs)'), '5: relative link absolutized');
	assert.ok(md5.includes('[外链](https://a.com/b)'), '5: absolute link kept');

	// 6. Blockquote + fenced code with language + hr.
	const md6 = htmlToMarkdown('<blockquote><p>引用一句</p></blockquote><hr><pre><code class="language-python">print(1)</code></pre>');
	assert.ok(md6.includes('> 引用一句'), '6: blockquote');
	assert.ok(md6.includes('---'), '6: hr');
	assert.ok(md6.includes('```python\nprint(1)\n```'), '6: fenced code + language');

	// 7. Nested unordered list + ordered list numbering.
	const md7 = htmlToMarkdown('<ul><li>甲<ul><li>甲一</li></ul></li><li>乙</li></ul><ol><li>第一</li><li>第二</li></ol>');
	assert.ok(md7.includes('- 甲'), '7: bullet');
	assert.ok(md7.includes('    - 甲一'), '7: nested bullet indent');
	assert.ok(md7.includes('1. 第一'), '7: ordered');
	assert.ok(md7.includes('2. 第二'), '7: ordered sequence');

	// 8. GFM table with pipes escaped in cells.
	const md8 = htmlToMarkdown('<table><tr><th>名称</th><th>值</th></tr><tr><td>a|b</td><td>2</td></tr></table>');
	assert.ok(md8.includes('| 名称 | 值 |'), '8: header row');
	assert.ok(md8.includes('| --- | --- |'), '8: separator');
	assert.ok(md8.includes('a\\|b'), '8: pipe escaped');

	// 9. Images: relative src absolutized, alt kept.
	const md9 = htmlToMarkdown('<p><img src="/img/cat.png" alt="一只猫"></p>', { baseUrl: 'https://example.com/' });
	assert.ok(md9.includes('![一只猫](https://example.com/img/cat.png)'), '9: img absolutized');

	// 10. script/style dropped entirely.
	const md10 = htmlToMarkdown('<p>前</p><script>alert(1)</script><style>.x{}</style><p>后</p>');
	assert.ok(!md10.includes('alert'), '10: script gone');
	assert.ok(!md10.includes('.x{}'), '10: style gone');
	assert.ok(md10.includes('前') && md10.includes('后'), '10: text kept');

	// 11. div-per-paragraph (no <p> tags) still yields separate paragraphs.
	const md11 = htmlToMarkdown('<div>第一段</div><div>第二段</div>');
	assert.ok(md11.includes('第一段\n\n第二段'), '11: div paragraphs separated');

	// 12. skipFirstHeading drops exactly the leading h1.
	const withH1 = '<h1>标题</h1><p>正文</p>';
	assert.ok(!htmlToMarkdown(withH1, { skipFirstHeading: true }).includes('# 标题'), '12: leading h1 dropped');
	assert.ok(htmlToMarkdown(withH1).includes('# 标题'), '12: kept without the flag');

	// 13. Entities: named + numeric decode; stripHtmlText length heuristic.
	assert.equal(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;'), 'a&b<c>d"', '13: named entities');
	assert.equal(decodeHtmlEntities('&#20013;&#x6587;'), '中文', '13: numeric entities');
	assert.equal(stripHtmlText('<p>你好</p><p>世界</p>'), '你好世界', '13: stripHtmlText');

	/* ---------------- C. extractArticle ---------------- */

	const page = (body: string, head = ''): string =>
		`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

	// 14. <article> candidate beats a noisier body with more text.
	const md14 = extractArticle(page(
		'<nav>导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航导航</nav>'
		+ '<article><h1>正文标题</h1>'
		+ '<p>' + '这是正文内容，足够长以至于能被评分选中。'.repeat(12) + '</p>'
		+ '<p>' + '第二段也很长，用于拉开分差。'.repeat(10) + '</p></article>'
		+ '<footer>页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚页脚</footer>',
	));
	assert.ok(md14, '14: extracted');
	assert.ok(md14!.markdown.includes('这是正文内容'), '14: article text kept');
	assert.ok(!md14!.markdown.includes('页脚'), '14: footer pruned');
	assert.ok(!md14!.markdown.includes('导航'), '14: nav pruned');
	assert.ok(!md14!.markdown.startsWith('# 正文标题'), '14: duplicate h1 skipped (title known)');

	// 15. og:title wins over <title> with site suffix.
	const md15 = extractArticle(page(
		'<article><p>' + '正文。'.repeat(80) + '</p></article>',
		'<meta property="og:title" content="开放图谱标题"><title>网页标题 | 某站点</title>',
	));
	assert.equal(md15!.title, '开放图谱标题', '15: og:title');

	// 16. <title> suffix trimmed when no og:title.
	const md16 = extractArticle(page(
		'<main><p>' + '正文。'.repeat(80) + '</p></main>',
		'<title>长长长长长长长长长长长长长长长长长长长长标题 | 某站点</title>',
	));
	assert.ok(md16!.title.startsWith('长长长长'), '16: longest title segment');
	assert.ok(!md16!.title.includes('|'), '16: suffix trimmed');

	// 17. Too-short page -> null (caller falls back to the summary).
	assert.equal(extractArticle(page('<p>太短</p>')), null, '17: short page null');

	// 18. Chrome-class pruning inside the chosen candidate.
	const md18 = extractArticle(page(
		'<article>'
		+ '<p>' + '主内容段落文字。'.repeat(30) + '</p>'
		+ '<div class="related-posts">' + '相关阅读相关阅读相关阅读相关阅读相关阅读相关阅读相关阅读'.repeat(6) + '</div>'
		+ '<div class="share-buttons">分享到微博分享到微博分享到微博分享到微博分享到微博分享到微博</div>'
		+ '</article>',
	));
	assert.ok(!md18!.markdown.includes('相关阅读'), '18: negative class pruned');
	assert.ok(!md18!.markdown.includes('分享到微博'), '18: share pruned');
	assert.ok(md18!.markdown.includes('主内容段落文字'), '18: content kept');

	console.log('verify-rss-parse: 18 scenarios OK');
};

try {
	main();
} catch (err) {
	console.error(err);
	process.exit(1);
}
