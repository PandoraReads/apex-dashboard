/**
 * Verifies the RSS persistence store:
 *
 * 1. normalizeRssFile: garbage shapes drop out silently, valid ones survive.
 * 2. Freshness: a fresh entry is not stale; an errored entry re-arms after
 *    the short retry window; a stale entry is due for a fetch.
 * 3. Item cap: setFeed clips to MAX_ITEMS_PER_FEED.
 * 4. Read/saved/web-cache round-trips through a save->reload cycle.
 * 5. markAllRead only writes when something actually changed.
 * 6. persist merges with an external writer (iCloud/second device): entries
 *    neither side knows about survive; per-key newest-wins.
 * 7. mergeRssFiles: feeds by newest fetchedAt, guid maps by union.
 *
 * Run: `npm run test:rss-store`
 */
import { strict as assert } from 'node:assert';
import {
	FEED_ERROR_TTL_MS,
	FEED_TTL_MS,
	MAX_ITEMS_PER_FEED,
	RssStore,
	mergeRssFiles,
	normalizeRssFile,
	setRssReadRetentionDays,
} from '../src/rss-store';
import type { RssItem } from '../src/rss-xml';

const DATA_PATH = '.obsidian/plugins/apex-dashboard/rss.json';

/** In-memory adapter (expense harness idiom). */
const makeAdapter = (files: Record<string, string> = {}) => {
	const disk = { ...files };
	const written: string[] = [];
	return {
		adapter: {
			exists: async (p: string) => disk[p] !== undefined,
			read: async (p: string) => {
				if (disk[p] === undefined) throw new Error(`missing ${p}`);
				return disk[p];
			},
			write: async (p: string, c: string) => {
				disk[p] = c;
				written.push(c);
				return Promise.resolve();
			},
			mkdir: async () => Promise.resolve(),
		},
		disk,
		written,
		overwrite: (p: string, c: string): void => { disk[p] = c; },
	};
};

const item = (n: number, over: Partial<RssItem> = {}): RssItem => ({
	guid: `g-${n}`,
	title: `文章 ${n}`,
	link: `https://example.com/${n}`,
	pubDate: 1_700_000_000_000 + n * 1000,
	...over,
});

const boot = (file?: string): { store: RssStore; h: ReturnType<typeof makeAdapter>; flush: () => Promise<void> } => {
	const h = makeAdapter(file === undefined ? {} : { [DATA_PATH]: file });
	const app = { vault: { configDir: '.obsidian', adapter: h.adapter } } as unknown as ConstructorParameters<typeof RssStore>[0];
	const store = new RssStore(app);
	return {
		store,
		h,
		flush: async () => {
			await (store as unknown as { saveQueue: Promise<void> }).saveQueue;
		},
	};
};

const main = async (): Promise<void> => {
	/* ---------------- 1. normalizeRssFile ---------------- */
	const normalized = normalizeRssFile({
		version: 1,
		feeds: {
			ok: { title: 'A', link: 'https://a.com', items: [{ guid: 'g1', title: 't', link: 'l' }], fetchedAt: 100 },
			bad: { title: 'B', items: [{ guid: '', }], fetchedAt: 0 },
			junk: 'not an object',
		},
		readGuids: { r1: 123, bad: 'x' },
		savedGuids: { s1: 'notes/a.md', bad: 7 },
		webCache: { w1: { markdown: 'md', fetchedAt: 5 }, w2: { markdown: '' } },
	});
	assert.ok(normalized.feeds['ok'], '1: valid feed kept');
	assert.equal(normalized.feeds['bad'], undefined, '1: zero-fetchedAt feed dropped');
	assert.equal(normalized.feeds['junk'], undefined, '1: junk feed dropped');
	assert.equal(normalized.readGuids['bad'], undefined, '1: non-numeric read marker dropped');
	assert.equal(normalized.savedGuids['bad'], undefined, '1: non-string saved path dropped');
	assert.equal(normalized.webCache['w2'], undefined, '1: empty web cache dropped');
	assert.equal(normalizeRssFile(null).feeds !== undefined, true, '1: null input tolerated');

	/* ---------------- 2. freshness ---------------- */
	const { store, h, flush } = boot();
	await store.load();
	const url = 'https://example.com/feed.xml';
	store.setFeed(url, { title: 'A', items: [item(1)], fetchedAt: Date.now() });
	await flush();
	assert.equal(store.isStale(url), false, '2: fresh entry not stale');
	assert.equal(store.isStale(url, Date.now() + FEED_TTL_MS + 1), true, '2: stale after TTL');

	store.setFeed(url, { title: 'A', items: [item(1)], fetchedAt: Date.now(), error: 'boom' });
	await flush();
	assert.equal(store.isStale(url), false, '2: errored entry not immediately stale');
	assert.equal(store.isStale(url, Date.now() + FEED_ERROR_TTL_MS + 1), true, '2: errored entry re-arms after the short window');
	assert.ok(h.written.length >= 2, '2: writes queued');

	/* ---------------- 3. item cap ---------------- */
	const many = Array.from({ length: MAX_ITEMS_PER_FEED + 10 }, (_, i) => item(i));
	store.setFeed(url, { title: 'A', items: many, fetchedAt: Date.now() });
	await flush();
	assert.equal(store.feedEntry(url)!.items.length, MAX_ITEMS_PER_FEED, '3: items clipped to cap');
	assert.equal(store.feedEntry(url)!.items[0]!.guid, 'g-0', '3: newest-first order preserved');

	/* ---------------- 4. round-trip ---------------- */
	store.markRead('g-1');
	store.markRead('g-1'); // idempotent
	store.setSaved('g-1', 'RSS/2026-10-05 文章 1.md');
	store.setCachedWeb('g-2', '# extracted');
	await flush();
	assert.equal(store.isRead('g-1'), true, '4: read visible');
	assert.equal(store.savedPath('g-1'), 'RSS/2026-10-05 文章 1.md', '4: saved path visible');
	assert.equal(store.cachedWeb('g-2'), '# extracted', '4: web cache visible');

	// A second store instance (fresh process) reads the same disk state.
	const h2 = boot(h.disk[DATA_PATH]!);
	await h2.store.load();
	assert.equal(h2.store.isRead('g-1'), true, '4: read persisted');
	assert.equal(h2.store.savedPath('g-1'), 'RSS/2026-10-05 文章 1.md', '4: saved persisted');
	assert.equal(h2.store.cachedWeb('g-2'), '# extracted', '4: web cache persisted');
	assert.equal(h2.store.feedEntry(url)!.items.length, MAX_ITEMS_PER_FEED, '4: items persisted');

	/* ---------------- 5. markAllRead change detection ---------------- */
	const before = h2.h.written.length;
	h2.store.markAllRead(['g-1']); // already read -> no write
	await h2.flush();
	assert.equal(h2.h.written.length, before, '5: no-op markAllRead does not write');
	h2.store.markAllRead(['g-5']);
	await h2.flush();
	assert.equal(h2.store.isRead('g-5'), true, '5: new marker written');

	/* ---------------- 6. external-writer merge ---------------- */
	h2.store.markRead('mine-1');
	await h2.flush();
	const mine = JSON.parse(h2.h.disk[DATA_PATH]!);
	const external = { ...mine, readGuids: { ...mine.readGuids, 'theirs-1': 12345 } };
	h2.h.overwrite(DATA_PATH, JSON.stringify(external));
	h2.store.markRead('mine-2'); // triggers persist -> disk differs from lastWritten
	await h2.flush();
	const merged = JSON.parse(h2.h.disk[DATA_PATH]!);
	assert.ok(merged.readGuids['theirs-1'], '6: external marker survived');
	assert.ok(merged.readGuids['mine-1'] && merged.readGuids['mine-2'], '6: local markers survived');

	/* ---------------- 7. mergeRssFiles ---------------- */
	const base = normalizeRssFile({ feeds: { u: { title: 'old', items: [], fetchedAt: 100 }, gone: { title: 'x', items: [], fetchedAt: 50 } } });
	const overlay = normalizeRssFile({ feeds: { u: { title: 'new', items: [item(9)], fetchedAt: 200 } } });
	const mergedFeeds = mergeRssFiles(base, overlay);
	assert.equal(mergedFeeds.feeds['u']!.title, 'new', '7: newest feed wins');
	assert.ok(mergedFeeds.feeds['gone'], '7: base-only feed survives');
	const a = normalizeRssFile({ readGuids: { r: 100 }, savedGuids: { s: 'a.md' }, webCache: { w: { markdown: 'a', fetchedAt: 1 } } });
	const b = normalizeRssFile({ readGuids: { r: 200, r2: 5 }, savedGuids: { s: 'b.md' }, webCache: { w: { markdown: 'b', fetchedAt: 9 } } });
	const mergedMaps = mergeRssFiles(a, b);
	assert.equal(mergedMaps.readGuids['r'], 200, '7: read marker newest wins');
	assert.ok(mergedMaps.readGuids['r2'], '7: read markers union');
	assert.equal(mergedMaps.savedGuids['s'], 'b.md', '7: saved overlay wins');
	assert.equal(mergedMaps.webCache['w']!.markdown, 'b', '7: web cache newest wins');

	/* ---------------- 8. configurable read retention ---------------- */
	setRssReadRetentionDays(30);
	{
		// An ancient marker (400 days) dies under a 30-day retention.
		const ancient = Date.now() - 400 * 24 * 60 * 60_000;
		const h8 = boot(JSON.stringify({ version: 1, feeds: {}, readGuids: { old: ancient, fresh: Date.now() }, savedGuids: {}, webCache: {} }));
		await h8.store.load();
		h8.store.setFeed('https://r.example/f', { title: 'R', items: [], fetchedAt: Date.now() });
		await h8.flush();
		assert.equal(h8.store.isRead('old'), false, '8: ancient marker pruned at 30d');
		assert.equal(h8.store.isRead('fresh'), true, '8: fresh marker kept');

		// 0 = keep forever: the same ancient marker survives.
		setRssReadRetentionDays(0);
		const h8b = boot(JSON.stringify({ version: 1, feeds: {}, readGuids: { old: ancient }, savedGuids: {}, webCache: {} }));
		await h8b.store.load();
		h8b.store.setFeed('https://r.example/f', { title: 'R', items: [], fetchedAt: Date.now() });
		await h8b.flush();
		assert.equal(h8b.store.isRead('old'), true, '8: forever retention keeps ancient markers');
	}
	setRssReadRetentionDays(undefined);

	console.log('verify-rss-store: 8 scenarios OK');
};

main().catch(err => {
	console.error(err);
	process.exit(1);
});
