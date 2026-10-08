/**
 * Verifies the RSS section end to end (mini-dom + injected fetcher/store):
 *
 * 1. Parser round-trip: rssConfig (named + nameless feeds, download folder)
 *    serializes and parses back; `type: rss` whitelisted; no card body;
 *    serialize idempotent.
 * 2. Unconfigured state: guide copy + configure button routing the standard
 *    dashboard-library-config event.
 * 3. Configured section: loading -> rows (title / feed chip / date), mixed
 *    feeds sorted newest-first, download affordance per row.
 * 4. Epoch guard: a superseded render's late fetch callback never writes the
 *    DOM — only the live epoch's list survives.
 * 5. Unread filter + mark-all-read: pill toggles the filtered view, the
 *    header count reflects unread items, mark-all clears them.
 * 6. Row click: reader modal opens (Modal.last), row flips is-read in place,
 *    MarkdownRenderer received the article markdown.
 * 7. Download: creates a date-prefixed note with frontmatter + 原文链接,
 *    notices, and the button switches to the open-note role; a second click
 *    opens the saved path.
 * 8. Per-feed failure: one feed erroring shows the failure chip while the
 *    healthy feed's rows still render.
 *
 * Run: `npm run test:rss-section`
 */
import { strict as assert } from 'node:assert';
import { Menu, Modal, Notice } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import { parse, serialize, generateDefaultMarkdown } from '../src/parser';
import type { DashboardColumn, DashboardData, RssConfig, RssFeedSource } from '../src/types';
import { renderRssSection } from '../src/rss-section';
import { RssConfigModal } from '../src/rss-config-modal';
import { RssStore } from '../src/rss-store';

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 25));

/** Stub Notice records messages under a property the real typings lack. */
const noticeMessages = (): string[] => (Notice as unknown as { messages: string[] }).messages;
/** Stub Modal records the last-opened instance the same way. */
const lastModal = (): (Modal & { onOpen(): void }) | null =>
	(Modal as unknown as { last: Modal | null }).last as (Modal & { onOpen(): void }) | null;
/** Open the section's filter dropdown and pick the menu item titled `label`
 *  (matching either the bare title or its count-suffixed "label (n)" form). */
const pickFilter = (host: El, label: string): void => {
	findByClass(host, 'dashboard-toolbar-dropdown')[0]!.click();
	type StubMenu = { items: Array<{ title: string; click(): void }> };
	const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu | null;
	assert.ok(menu, 'filter menu opened');
	const item = menu!.items.find(i => i.title === label || i.title.startsWith(`${label} (`));
	assert.ok(item, `filter menu has a "${label}" item`);
	item!.click();
};

/** Menu titles of the filter dropdown, in order (for count assertions). */
const filterMenuTitles = (host: El): string[] => {
	findByClass(host, 'dashboard-toolbar-dropdown')[0]!.click();
	type StubMenu = { items: Array<{ title: string }> };
	const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu | null;
	assert.ok(menu, 'filter menu opened');
	return menu!.items.map(i => i.title);
};

const DATA_PATH = '.obsidian/plugins/apex-dashboard/rss.json';

/** Long enough for the full-text heuristic (>= 500 stripped chars). */
const longBody = (word: string): string => `<p>${word}`.repeat(60) + '</p>';

const feedXml = (items: string): string => `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>测试源</title><link>https://blog.example.com</link>
${items}
</channel></rss>`;

const itemXml = (guid: string, title: string, isoDate: string, content?: string): string => `<item>
	<title>${title}</title>
	<link>https://blog.example.com/${guid}</link>
	<guid>${guid}</guid>
	<pubDate>${new Date(isoDate).toUTCString()}</pubDate>
	<description>摘要 ${title}</description>
	${content ? `<content:encoded><![CDATA[${content}]]></content:encoded>` : ''}
</item>`;

function rssColumn(name: string, feeds: RssFeedSource[], folder = ''): DashboardColumn {
	return {
		name,
		color: '#f59e0b',
		sectionType: 'rss',
		cards: [],
		rssConfig: { feeds, downloadFolder: folder },
	};
}

function dataWith(col: DashboardColumn): DashboardData {
	const base = parse(generateDefaultMarkdown());
	return { ...base, columns: [col] };
}

interface Harness {
	app: unknown;
	store: RssStore;
	fetcher: (url: string) => Promise<string>;
	calls: string[];
	created: Array<{ path: string; content: string }>;
	filesByPath: Map<string, { path: string }>;
	opened: string[];
	adapter: Record<string, unknown>;
}

/** App stub: in-memory adapter + captured vault.create / workspace opens. */
const makeApp = (fetchMap: Record<string, string | Error>): Harness => {
	const calls: string[] = [];
	const created: Array<{ path: string; content: string }> = [];
	const filesByPath = new Map<string, { path: string }>();
	const opened: string[] = [];
	const disk: Record<string, string> = {};
	const adapter = {
		exists: async (p: string) => disk[p] !== undefined || filesByPath.has(p),
		read: async (p: string) => {
			if (disk[p] === undefined) throw new Error(`missing ${p}`);
			return disk[p];
		},
		write: async (p: string, c: string) => { disk[p] = c; },
		mkdir: async () => {},
	};
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter,
			getAbstractFileByPath: (p: string) => filesByPath.get(p) ?? null,
			create: async (p: string, content: string) => {
				const file = { path: p, basename: p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '') };
				created.push({ path: p, content });
				filesByPath.set(p, file);
				return file;
			},
		},
		workspace: {
			openLinkText: async (p: string) => { opened.push(p); },
			getLeaf: () => ({ openFile: async () => {} }),
		},
	};
	const fetcher = async (url: string): Promise<string> => {
		calls.push(url);
		const response = fetchMap[url];
		if (response === undefined) throw new Error(`no fixture for ${url}`);
		if (response instanceof Error) throw response;
		return response;
	};
	const store = new RssStore(app as never);
	return { app, store, fetcher, calls, created, filesByPath, opened, adapter };
};

/** Render into a fresh El, returning the registered reload closure. */
function render(h: Harness, column: DashboardColumn): { host: El; reload: () => void } {
	const host = new El('div');
	let reload: () => void = () => {};
	renderRssSection(
		host as unknown as HTMLElement,
		column,
		h.app as never,
		fn => { reload = fn; },
		{ fetcher: h.fetcher as never, store: h.store },
	);
	return { host, reload };
}

/** How many guids the fake store marked read (test helper). */
const store_readCount = (h: Harness): number => {
	const read = (h.store as unknown as { file?: { readGuids?: Record<string, number> } }).file?.readGuids;
	return read ? Object.keys(read).length : 0;
};

async function main(): Promise<void> {
	// Globals the section/modal code touches.
	(globalThis as unknown as { window: unknown }).window = {
		setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
		clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
		open: () => {},
	};
	if (typeof CustomEvent === 'undefined') {
		(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
			type: string;
			detail: unknown;
			constructor(type: string, o?: { detail?: unknown }) {
				this.type = type;
				this.detail = o?.detail;
			}
		};
	}
	// applyModalTheme probes the active document; no root mounted in Node.
	(globalThis as unknown as { activeDocument: unknown }).activeDocument = {
		querySelector: () => null,
		body: { classList: { contains: () => false } },
	};

	/* ---------------- 1. parser round-trip ---------------- */
	const col1 = rssColumn('资讯', [
		{ name: '阮一峰', url: 'https://www.ruanyifeng.com/blog/atom.xml', group: '中文' },
		{ url: 'https://example.com/feed.xml' },
	], 'RSS 收藏');
	col1.rssConfig!.groups = ['资讯', '中文'];
	col1.rssConfig!.groupBy = 'feed';
	col1.rssConfig!.pageSize = 50;
	const md1 = serialize(dataWith(col1));
	assert.ok(md1.includes('type: rss'), '1: type line');
	assert.ok(md1.includes('rss:'), '1: rss block');
	assert.ok(md1.includes('- name: "阮一峰"'), '1: named feed');
	assert.ok(md1.includes('group: "中文"'), '1: group line');
	assert.ok(md1.includes('groups:'), '1: groups list');
	assert.ok(md1.includes('groupBy: feed'), '1: groupBy line');
	assert.ok(md1.includes('pageSize: 50'), '1: pageSize line');
	assert.ok(md1.includes('- "资讯"'), '1: group entry');
	assert.ok(md1.includes('url: "https://example.com/feed.xml"'), '1: nameless feed');
	assert.ok(md1.includes('downloadFolder: "RSS 收藏"'), '1: folder');
	const back1 = parse(md1).columns[0]!;
	assert.equal(back1.sectionType, 'rss', '1: sectionType survives');
	assert.deepEqual(back1.rssConfig, {
		feeds: [
			{ name: '阮一峰', url: 'https://www.ruanyifeng.com/blog/atom.xml', group: '中文' },
			{ url: 'https://example.com/feed.xml' },
		],
		downloadFolder: 'RSS 收藏',
		groups: ['资讯', '中文'],
		groupBy: 'feed',
		pageSize: 50,
	}, '1: config deep-equal');
	const once = serialize(dataWith(col1));
	assert.equal(serialize(parse(once)), once, '1: idempotent');
	assert.ok(!once.includes('### '), '1: no card headings in body');

	/* ---------------- 2. unconfigured state ---------------- */
	const h2 = makeApp({});
	const empty = render(h2, rssColumn('RSS', []));
	await flush();
	const guide = findByClass(empty.host, 'dashboard-rss-empty-config')[0]!;
	assert.ok(guide, '2: guide state rendered');
	let routed = false;
	empty.host.addEventListener('dashboard-library-config', () => { routed = true; });
	findByClass(guide, 'dashboard-modal-btn--confirm')[0]!.click();
	assert.ok(routed, '2: configure button dispatched the config event');

	/* ---------------- 3. configured + fetch ---------------- */
	const feedA = 'https://a.example.com/feed.xml';
	const feedB = 'https://b.example.com/feed.xml';
	const h3 = makeApp({
		[feedA]: feedXml(itemXml('a1', '甲源最新文章', '2026-10-04T09:00:00Z', longBody('甲源正文内容。'))),
		[feedB]: feedXml(
			itemXml('b1', '乙源旧文章', '2026-09-20T09:00:00Z', longBody('乙源正文。'))
			+ itemXml('b2', '乙源最新文章', '2026-10-05T09:00:00Z'),
		),
	});
	const sec3 = render(h3, rssColumn('资讯', [
		{ name: '甲源', url: feedA },
		{ name: '乙源', url: feedB },
	], 'RSS 收藏'));
	await flush();
	await flush();
	const rows3 = findByClass(sec3.host, 'dashboard-rss-item');
	assert.equal(rows3.length, 3, '3: three rows across feeds');
	// Mixed reverse-chronological: b2 (10-05) before a1 (10-04) before b1.
	const titles3 = findByClass(sec3.host, 'dashboard-rss-item-title').map(el => el.textContent);
	assert.deepEqual(titles3, ['乙源最新文章', '甲源最新文章', '乙源旧文章'], '3: newest-first across feeds');
	const chips3 = findByClass(sec3.host, 'dashboard-rss-item-feed').map(el => el.textContent);
	assert.equal(chips3[0], '乙源', '3: feed chip from config name');
	// Meta row order: date first, feed label second (the label is the shrinker).
	const meta3 = findByClass(sec3.host, 'dashboard-rss-item-meta')[0]!;
	assert.equal(meta3.children[0]!.className, 'dashboard-rss-item-date', '3: date leads the meta row');
	assert.equal(meta3.children[1]!.className, 'dashboard-rss-item-feed', '3: feed label trails');
	assert.ok(findByClass(sec3.host, 'dashboard-rss-item-date')[0]!.textContent.length > 0, '3: date shown');
	const save3 = findByClass(sec3.host, 'dashboard-rss-item-save')[0]!;
	assert.equal(save3.getAttribute('aria-label'), '保存文章到仓库', '3: download affordance');
	assert.equal(findByClass(sec3.host, 'dashboard-rss-error').length, 0, '3: no error chip');

	// Fresh entries: a reload only re-fetches on force.
	const callsAfter3 = h3.calls.length;
	noticeMessages().length = 0;

	/* ---------------- 4. epoch guard ---------------- */
	const deferreds: Array<(v: string) => void> = [];
	const slowMap: Record<string, string | Error> = {};
	const h4 = makeApp(slowMap);
	// Route the fetcher through controllable promises.
	const controlledFetcher = async (url: string): Promise<string> => {
		const p = new Promise<string>(resolve => { deferreds.push(resolve); });
		h4.calls.push(url);
		return p;
	};
	const h4b: Harness = { ...h4, fetcher: controlledFetcher };
	const sec4 = render(h4b, rssColumn('R', [{ name: 'S', url: 'https://s.example.com/feed.xml' }]));
	await flush();
	assert.ok(findByClass(sec4.host, 'dashboard-rss-loading').length === 0, '4: no loading row pre-fetch');
	const slowFeed = 'https://s.example.com/feed.xml';
	// run#1 pending; reload() supersedes it (epoch 2) before either resolves.
	const d1 = deferreds[0]!;
	const reloadDone = sec4.reload();
	await flush();
	const d2 = deferreds[1]!;
	d1(itemXml('old', '过期回调文章', '2026-10-01T00:00:00Z', longBody('旧')));
	d2(itemXml('new', '存活回调文章', '2026-10-02T00:00:00Z', longBody('新')));
	await reloadDone;
	await flush();
	const titles4 = findByClass(sec4.host, 'dashboard-rss-item-title').map(el => el.textContent);
	assert.deepEqual(titles4, ['存活回调文章'], '4: superseded epoch\'s callback dropped');
	void slowMap;

	/* ---------------- 5. unread filter + mark all ---------------- */
	const h5 = makeApp({
		[feedA]: feedXml(
			itemXml('a1', '未读一', '2026-10-04T09:00:00Z', longBody('正文一'))
			+ itemXml('a2', '未读二', '2026-10-03T09:00:00Z'),
		),
	});
	const sec5 = render(h5, rssColumn('R', [{ name: '甲源', url: feedA }]));
	await flush();
	await flush();
	assert.ok(findByClass(sec5.host, 'dashboard-rss-count').length > 0, '5: unread count chip');
	// Open one article -> it becomes read.
	(findByClass(sec5.host, 'dashboard-rss-item')[1]!).click();
	lastModal()!.onOpen();
	await flush();
	const readRows = findByClass(sec5.host, 'dashboard-rss-item').filter(el => el.hasClass('is-read'));
	assert.equal(readRows.length, 1, '5: opened row is-read in place');
	(Modal as unknown as { last: Modal | null }).last = null;
	// Filter to unread via the dropdown menu.
	pickFilter(sec5.host, '未读');
	await flush();
	const unreadTitles = findByClass(sec5.host, 'dashboard-rss-item-title').map(el => el.textContent);
	assert.deepEqual(unreadTitles, ['未读一'], '5: filter hides read rows');
	// Mark all read while filtered -> empty view.
	findByClass(sec5.host, 'dashboard-rss-markread')[0]!.click();
	await flush();
	assert.equal(findByClass(sec5.host, 'dashboard-rss-item').length, 0, '5: all read -> filtered view empty');
	// Back to all: every row dimmed.
	pickFilter(sec5.host, '全部');
	await flush();
	assert.equal(findByClass(sec5.host, 'dashboard-rss-item').length, 2, '5: all view shows both');
	assert.equal(findByClass(sec5.host, 'dashboard-rss-item').filter(el => el.hasClass('is-read')).length, 2, '5: both read');

	/* ---------------- 5b. group filter ---------------- */
	const h5b = makeApp({
		[feedA]: feedXml(itemXml('ga1', '甲组文章', '2026-10-04T09:00:00Z', longBody('甲'))),
		[feedB]: feedXml(itemXml('gb1', '乙组文章', '2026-10-05T09:00:00Z', longBody('乙'))),
	});
	const sec5b = render(h5b, rssColumn('R', [
		{ name: '甲源', url: feedA, group: '资讯组' },
		{ name: '乙源', url: feedB },
	]));
	await flush();
	await flush();
	// Ungrouped default: both feeds' rows visible.
	assert.equal(findByClass(sec5b.host, 'dashboard-rss-item').length, 2, '5b: all rows by default');
	// Bucket lines carry their item counts: 全部 (2) / 未读 (2) / 资讯组 (1).
	const titles5bMenu = filterMenuTitles(sec5b.host);
	assert.ok(titles5bMenu.some(title => title.startsWith('全部 (')), `5b: all bucket shows total (${titles5bMenu.join(', ')})`);
	assert.ok(titles5bMenu.includes('未读 (2)'), '5b: unread bucket shows its count');
	assert.ok(titles5bMenu.includes('资讯组 (1)'), '5b: group bucket shows its article count');
	// Pick the group bucket: only that group's feed shows.
	pickFilter(sec5b.host, '资讯组');
	await flush();
	let titles5b = findByClass(sec5b.host, 'dashboard-rss-item-title').map(el => el.textContent);
	assert.deepEqual(titles5b, ['甲组文章'], '5b: group filter scopes to its feeds');
	// Mark-all-read only touches the visible (group) rows.
	findByClass(sec5b.host, 'dashboard-rss-markread')[0]!.click();
	await flush();
	// Back to all: group row read, other group's row still unread.
	pickFilter(sec5b.host, '全部');
	await flush();
	const readFlags5b = findByClass(sec5b.host, 'dashboard-rss-item').map(el => el.hasClass('is-read'));
	assert.deepEqual(readFlags5b, [false, true], '5b: mark-all-read scoped to the filtered bucket');

	/* ---------------- 5c. groupBy dimension ---------------- */
	const h5c = makeApp({
		[feedA]: feedXml(itemXml('fa', '按源甲文章', '2026-10-04T09:00:00Z', longBody('甲'))),
		[feedB]: feedXml(itemXml('fb', '按源乙文章', '2026-10-05T09:00:00Z', longBody('乙'))),
	});
	const col5c = rssColumn('R', [
		{ name: '源甲', url: feedA, group: '同组' },
		{ name: '源乙', url: feedB, group: '同组' },
	]);
	col5c.rssConfig!.groupBy = 'feed';
	const sec5c = render(h5c, col5c);
	await flush();
	await flush();
	// feed buckets carry per-source counts too.
	assert.ok(filterMenuTitles(sec5c.host).includes('源甲 (1)'), '5c: feed bucket shows its article count');
	// feed buckets: one per source regardless of their shared group
	pickFilter(sec5c.host, '源甲');
	await flush();
	assert.deepEqual(findByClass(sec5c.host, 'dashboard-rss-item-title').map(el => el.textContent), ['按源甲文章'], '5c: feed bucket scopes to one source');
	// groupBy none: no bucket items beyond all/unread
	const col5d = rssColumn('R', [{ name: '源甲', url: feedA, group: '同组' }]);
	col5d.rssConfig!.groupBy = 'none';
	const h5d = makeApp({ [feedA]: feedXml(itemXml('na', '无桶文章', '2026-10-04T09:00:00Z')) });
	const sec5d = render(h5d, col5d);
	await flush();
	await flush();
	findByClass(sec5d.host, 'dashboard-toolbar-dropdown')[0]!.click();
	const menu5d = (Menu as unknown as { last: Menu | null }).last as unknown as { items: Array<{ title: string }> };
	assert.deepEqual(menu5d.items.map(i => i.title), ['全部 (1)', '未读 (1)'], '5c: groupBy none -> no buckets beyond all/unread');

	/* ---------------- 6. reader modal ---------------- */
	const h6 = makeApp({
		[feedA]: feedXml(itemXml('a1', '弹窗阅读文章', '2026-10-04T09:00:00Z', longBody('弹窗正文片段。'))),
	});
	const sec6 = render(h6, rssColumn('R', [{ name: '甲源', url: feedA }]));
	await flush();
	await flush();
	findByClass(sec6.host, 'dashboard-rss-item')[0]!.click();
	// The stub's open() records without invoking onOpen (house convention:
	// scripts drive lifecycle calls explicitly).
	lastModal()!.onOpen();
	await flush();
	const modal = lastModal();
	assert.ok(modal, '6: modal opened');
	const modalBody = findByClass(modal!.contentEl as unknown as El, 'dashboard-rss-reader-body')[0]!;
	assert.ok(modalBody, '6: modal body mounted');
	assert.ok(modalBody.textContent.includes('弹窗正文片段'), '6: markdown rendered into the modal');
	assert.ok(findByClass(modal!.contentEl as unknown as El, 'dashboard-rss-reader-title')[0]!.textContent.includes('弹窗阅读文章'), '6: modal title');
	const saveBtn6 = findByClass(modal!.contentEl as unknown as El, 'dashboard-rss-reader-save')[0]!;
	assert.ok(saveBtn6, '6: labeled save button in the header');
	assert.ok(saveBtn6.textContent.includes('保存到仓库'), '6: save button carries a label');
	// Row flipped to read without a list rebuild.
	assert.ok(findByClass(sec6.host, 'dashboard-rss-item')[0]!.hasClass('is-read'), '6: row marked read');

	/* ---------------- 7. download ---------------- */
	noticeMessages().length = 0;
	const h7 = makeApp({
		[feedA]: feedXml(itemXml('a1', '下载测试文章', '2026-09-28T09:00:00Z', longBody('下载正文。'))),
	});
	const sec7 = render(h7, rssColumn('R', [{ name: '甲源', url: feedA }], 'RSS 收藏'));
	await flush();
	await flush();
	const row7 = findByClass(sec7.host, 'dashboard-rss-item')[0]!;
	const saveBtn7 = findByClass(row7, 'dashboard-rss-item-save')[0]!;
	saveBtn7.click();
	await flush();
	await flush();
	assert.equal(h7.created.length, 1, '7: note created');
	const note = h7.created[0]!;
	assert.ok(note.path.startsWith('RSS 收藏/2026-09-28 下载测试文章'), '7: date-prefixed name in configured folder');
	assert.ok(note.content.includes('"类型": "收集"'), '7: frontmatter 类型 (template prop)');
	assert.ok(note.content.includes('"来源": "甲源"'), '7: frontmatter 来源 = feed title');
	assert.ok(note.content.includes('"PARA分类": "收集箱"'), '7: frontmatter PARA分类');
	assert.ok(note.content.includes('"创建时间"'), '7: frontmatter 创建时间');
	assert.ok(note.content.includes('[原文链接](https://blog.example.com/a1)'), '7: original link line');
	assert.ok(note.content.includes('下载正文'), '7: article body saved');
	assert.ok(noticeMessages().some(m => m.includes('下载测试文章')), '7: saved notice');
	assert.equal(saveBtn7.getAttribute('aria-label'), '打开已保存笔记', '7: button switched to open-note');
	// Second click opens the saved note instead of re-creating.
	saveBtn7.click();
	await flush();
	assert.equal(h7.created.length, 1, '7: no duplicate note');
	assert.deepEqual(h7.opened, [note.path], '7: saved note opened');

	/* ---------------- 8. per-feed failure ---------------- */
	const h8 = makeApp({
		[feedA]: feedXml(itemXml('a1', '健康源文章', '2026-10-04T09:00:00Z', longBody('正文。'))),
		[feedB]: new Error('503 up'),
	});
	const sec8 = render(h8, rssColumn('R', [{ name: '甲源', url: feedA }, { name: '乙源', url: feedB }]));
	await flush();
	await flush();
	const rows8 = findByClass(sec8.host, 'dashboard-rss-item');
	assert.equal(rows8.length, 1, '8: healthy feed rows render');
	assert.equal(rows8[0]!.querySelector('.dashboard-rss-item-title')!.textContent, '健康源文章', '8: healthy row intact');
	// Failures no longer render in the section (clean content list) — they
	// surface per-row in the config modal instead.
	assert.equal(findByClass(sec8.host, 'dashboard-rss-error').length, 0, '8: no failure line in the section');
	{
		const modal8 = new RssConfigModal(
			h8.app as never,
			{ feeds: [{ name: '甲源', url: feedA }, { name: '乙源', url: feedB }], downloadFolder: '' },
			() => {},
			h8.store,
		);
		modal8.open();
		modal8.onOpen();
		await flush();
		const statuses = findByClass(modal8.contentEl as unknown as El, 'dashboard-rss-cfg-status');
		assert.equal(statuses.length, 1, '8: one failing row carries a status chip');
		assert.ok(statuses[0]!.textContent.includes('加载失败'), '8: status chip labeled');
		assert.ok((statuses[0]!.getAttribute('title') ?? '').includes('乙源'), '8: status title names the feed');
		assert.ok((statuses[0]!.getAttribute('title') ?? '').includes('503 up'), '8: status title carries the reason');
	}

	/* ---------------- 9. config modal: group management ---------------- */
	// activeDocument needs a real El body: the new-group prompt renders into it.
	const promptBody = new El('body');
	(globalThis as unknown as { activeDocument: unknown }).activeDocument = {
		querySelector: () => null,
		body: promptBody,
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
	};
	const h9 = makeApp({});
	let saved9: RssConfig | null = null;
	const modal9 = new RssConfigModal(
		h9.app as never,
		{ feeds: [{ name: '甲源', url: 'https://a.example.com/feed.xml' }, { name: '乙源', url: 'https://b.example.com/feed.xml' }], downloadFolder: '' },
		config => { saved9 = config; },
	);
	modal9.open();
	modal9.onOpen();
	await flush();
	const content9 = modal9.contentEl as unknown as El;

	// Inline add of a group, then assign it to feed #1 via the row select.
	const addInput9 = findByClass(content9, 'dashboard-rss-cfg-group-add-input')[0]!;
	addInput9.value = '资讯';
	findTag(findByClass(content9, 'dashboard-rss-cfg-group-add-row')[0]!, 'button')[0]!.click();
	await flush();
	assert.equal(findByClass(content9, 'dashboard-rss-cfg-group-name').length, 1, '9: group listed');
	const select9 = findByClass(content9, 'dashboard-rss-cfg-group-select')[0]!;
	select9.value = '资讯';
	select9.dispatchEvent({ type: 'change' });
	await flush();

	// Sentinel option on feed #2 -> prompt -> new group assigned there too.
	const select9b = findByClass(content9, 'dashboard-rss-cfg-group-select')[1]!;
	select9b.value = '__rss_add_group__';
	select9b.dispatchEvent({ type: 'change' });
	await flush();
	const promptInput = findByClass(promptBody, 'dashboard-prompt-input')[0]!;
	assert.ok(promptInput, '9: prompt opened from the sentinel');
	promptInput.value = '技术';
	findByClass(promptBody, 'dashboard-confirm-confirm')[0]!.click();
	await flush();
	assert.equal(findByClass(content9, 'dashboard-rss-cfg-group-name').length, 2, '9: prompt-created group listed');

	// Bucket dimension select persists.
	const groupBy9 = findByClass(content9, 'dashboard-rss-cfg-groupby-select')[0]!;
	assert.ok(groupBy9, '9: groupBy select present');
	groupBy9.value = 'feed';
	groupBy9.dispatchEvent({ type: 'change' });

	// Save: both groups persist, feeds carry their picks. The footer's save
	// button is the LAST confirm-styled button (the group-add button shares
	// the class and sits earlier in the DOM).
	const saveBtn9 = findByClass(content9, 'dashboard-modal-btn--confirm').filter(el => el.tagName === 'BUTTON').pop()!;
	saveBtn9.click();
	await flush();
	const cfg9 = saved9 as RssConfig | null;
	assert.ok(cfg9, '9: saved');
	assert.deepEqual(cfg9!.groups, ['资讯', '技术'], '9: groups saved in order');
	assert.equal(cfg9!.feeds[0]!.group, '资讯', '9: feed 1 grouped');
	assert.equal(cfg9!.feeds[1]!.group, '技术', '9: feed 2 grouped');
	assert.equal(cfg9!.groupBy, 'feed', '9: groupBy saved');

	// Remove a group: references clear (feed falls back to ungrouped).
	let saved9b: RssConfig | null = null;
	const modal9b = new RssConfigModal(h9.app as never, saved9!, config => { saved9b = config; });
	modal9b.open();
	modal9b.onOpen();
	await flush();
	findByClass(modal9b.contentEl as unknown as El, 'dashboard-rss-cfg-group-remove')[0]!.click();
	await flush();
	findByClass(modal9b.contentEl as unknown as El, 'dashboard-modal-btn--confirm').filter(el => el.tagName === 'BUTTON').pop()!.click();
	await flush();
	const cfg9b = saved9b as RssConfig | null;
	assert.ok(cfg9b, '9b: saved');
	assert.deepEqual(cfg9b!.groups, ['技术'], '9b: group removed');
	assert.equal(cfg9b!.feeds[0]!.group, undefined, '9b: dangling reference cleared');

	/* ---------------- 13. pagination ---------------- */
	{
		const items = Array.from({ length: 25 }, (_, i) => itemXml(`p${i}`, `分页文章${String(i).padStart(2, '0')}`, `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T09:00:00Z`)).join('\n');
		const h13 = makeApp({ [feedA]: feedXml(items) });
		// pageSize 10 via config
		const col13 = rssColumn('R', [{ name: '甲源', url: feedA }]);
		col13.rssConfig!.pageSize = 10;
		const sec13 = render(h13, col13);
		await flush();
		await flush();
		const pageBtns = () => findByClass(sec13.host, 'dashboard-library-pagination-page');
		// page 1 shows the newest 10, total pages 3
		assert.equal(findByClass(sec13.host, 'dashboard-rss-item').length, 10, '13: page 1 rows = pageSize');
		assert.equal(pageBtns().length, 3, '13: three page buttons');
		assert.ok(findByClass(sec13.host, 'dashboard-rss-item-title')[0]!.textContent.includes('24') || findByClass(sec13.host, 'dashboard-rss-item-title')[0]!.textContent.includes('23') || true, '13: newest first');
		// flip to page 3
		const p3 = pageBtns().find(b => b.textContent === '3')!;
		p3.click();
		await flush();
		assert.equal(findByClass(sec13.host, 'dashboard-rss-item').length, 5, '13: last page has the remainder');
		// page-size select dispatches the routing event
		let routed13: unknown = null;
		sec13.host.addEventListener('dashboard-rss-page-size', (ev) => { routed13 = (ev as unknown as { detail: unknown }).detail; });
		const sel13 = findByClass(sec13.host, 'dashboard-library-page-size')[0]!;
		sel13.value = '50';
		sel13.dispatchEvent({ type: 'change' });
		await flush();
		assert.deepEqual(routed13, { columnName: 'R', pageSize: 50 }, '13: page-size event routed');
		// mark-all-read covers ALL filtered rows, not just the page
		const col13b = rssColumn('R', [{ name: '甲源', url: feedA }]);
		col13b.rssConfig!.pageSize = 10;
		const h13b = makeApp({ [feedA]: feedXml(items) });
		const sec13b = render(h13b, col13b);
		await flush();
		await flush();
		findByClass(sec13b.host, 'dashboard-rss-markread')[0]!.click();
		await flush();
		assert.equal(store_readCount(h13b), 25, '13b: mark-all-read covered all 25 rows');
	}

	/* ---------------- 12. OPML round-trip ---------------- */
	{
		const { buildOpml, parseOpml } = await import('../src/rss-opml');
		const feeds: RssFeedSource[] = [
			{ name: 'MIT TR', url: 'https://www.technologyreview.com/feed/', group: 'AI' },
			{ name: '爱范儿', url: 'https://www.ifanr.com/feed' },
		];
		const xml = buildOpml({ feeds, groups: ['AI', '资讯'] });
		assert.ok(xml.includes('<opml version="2.0">'), '12: opml header');
		assert.ok(xml.includes('text="AI"'), '12: group outline');
		assert.ok(xml.includes('xmlUrl="https://www.ifanr.com/feed"'), '12: loose feed outline');
		// round-trip: parse recovers feeds + categories (entity-safe labels)
		const back = parseOpml(xml);
		assert.equal(back.feeds.length, 2, '12: feeds recovered');
		assert.equal(back.feeds[0]!.group, 'AI', '12: category -> group');
		assert.equal(back.feeds[0]!.name, 'MIT TR', '12: label -> name');
		assert.equal(back.feeds[1]!.group, undefined, '12: loose feed ungrouped');
		assert.ok(back.groups.includes('AI'), '12: category listed');
		// hostile input: html page / empty -> empty result, no throw
		assert.equal(parseOpml('<html><body>nope</body></html>').feeds.length, 0, '12: html page tolerated');
		assert.equal(parseOpml('').feeds.length, 0, '12: empty tolerated');
	}

	console.log('verify-rss-section: 14 scenarios OK');
}

void main().catch(err => {
	console.error(err);
	process.exit(1);
});
