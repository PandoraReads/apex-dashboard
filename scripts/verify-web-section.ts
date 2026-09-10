import { strict as assert } from 'node:assert';
import { Platform } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import { parse, serialize, generateDefaultMarkdown } from '../src/parser';
import type { DashboardData, DashboardColumn } from '../src/types';
import {
	classifyFramePolicy,
	clearPrecheckCache,
	getCachedVerdict,
	isValidWebUrl,
	normalizeHeaders,
	normalizeWebUrl,
	precheckEmbed,
	type HeaderFetcher,
} from '../src/web-precheck';
import { renderWebSection } from '../src/web-section';

// Web section: config persistence round-trips through the hand-rolled YAML
// serializer; the framing-policy precheck classifies response headers and
// caches verdicts; the render state machine picks iframe / webview / fallback
// per mode, platform, and verdict — with an epoch guard against late async
// callbacks and a webview-attach timeout that escapes to the iframe.

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 20));

/** Deterministic header fetcher factory — records calls, returns a queue. */
function fakeFetcher(responses: Array<Record<string, string> | Error>): HeaderFetcher & { calls: string[] } {
	const calls: string[] = [];
	let i = 0;
	const fn = async (url: string): Promise<Record<string, string>> => {
		calls.push(url);
		const next = responses[Math.min(i++, responses.length - 1)]!;
		if (next instanceof Error) throw next;
		return next;
	};
	return Object.assign(fn, { calls });
}

const DENY: Record<string, string> = { 'x-frame-options': 'DENY' };
const CLEAN: Record<string, string> = { 'content-type': 'text/html' };

function webColumn(name: string, url: string, mode?: 'auto' | 'iframe' | 'webview', zoom?: number): DashboardColumn {
	return {
		name,
		color: '#e11d48',
		sectionType: 'web',
		cards: [],
		webConfig: { url, mode, zoom },
	};
}

function dataWith(col: DashboardColumn): DashboardData {
	// Build on the real default shape: serialize() reads unguarded banner
	// fields, so a hand-rolled cast object would crash it.
	const base = parse(generateDefaultMarkdown());
	return { ...base, columns: [col] };
}

/** Render into a fresh El and return the registered reload closure. */
function render(column: DashboardColumn, options?: { fetcher?: HeaderFetcher; timeoutMs?: number }): { host: El; reload: () => void } {
	const host = new El('div');
	let reload: () => void = () => {};
	renderWebSection(host as unknown as HTMLElement, column, fn => { reload = fn; }, options);
	return { host, reload };
}

async function main(): Promise<void> {
	// Globals the section code touches: window (setTimeout/clearTimeout/open)
	// and CustomEvent (the configure button's routing event).
	let opened: string[] = [];
	(globalThis as unknown as { window: unknown }).window = {
		setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
		clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
		open: (url: string) => { opened.push(url); },
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
	clearPrecheckCache();

	/* ---------------- A. parser round-trip ---------------- */

	// 1. Full config serializes every field and parses back equal.
	const full = dataWith(webColumn('Keep', 'https://keep.google.com/u/0/', 'webview', 0.75));
	const md1 = serialize(full);
	assert.ok(md1.includes('type: web'), '1: type line');
	assert.ok(md1.includes('web:'), '1: web block');
	assert.ok(md1.includes('url: "https://keep.google.com/u/0/"'), '1: url line');
	assert.ok(md1.includes('mode: webview'), '1: mode line');
	assert.ok(md1.includes('zoom: 0.75'), '1: zoom line');
	const back1 = parse(md1).columns[0]!;
	assert.equal(back1.sectionType, 'web', '1: sectionType survives');
	assert.deepEqual(back1.webConfig, { url: 'https://keep.google.com/u/0/', mode: 'webview', zoom: 0.75 }, '1: config deep-equal');

	// 2. Minimal config emits no mode/zoom lines.
	const md2 = serialize(dataWith(webColumn('Blog', 'https://example.com')));
	assert.ok(!/mode:/.test(md2), '2: no mode line');
	assert.ok(!/zoom:/.test(md2), '2: no zoom line');

	// 3. Hand-written `mode: auto` / `zoom: 1` normalize away (round-trip exact).
	const noisy = parse(serialize(dataWith(webColumn('N', 'https://x.com'))).replace(
		'    web:\n      url: "https://x.com"',
		'    web:\n      url: "https://x.com"\n      mode: auto\n      zoom: 1',
	)).columns[0]!;
	assert.equal(noisy.webConfig?.mode, undefined, '3: auto normalizes out');
	assert.equal(noisy.webConfig?.zoom, undefined, '3: zoom 1 normalizes out');

	// 4. Special characters in the URL survive the round-trip.
	const tricky = 'https://x.com/a"b?c=1&d=2#frag';
	const back4 = parse(serialize(dataWith(webColumn('T', tricky)))).columns[0]!;
	assert.equal(back4.webConfig?.url, tricky, '4: special chars preserved');

	// 5. `type: web` is whitelisted (not silently dropped).
	const md5 = serialize(dataWith(webColumn('W', 'https://a.com')));
	assert.equal(parse(md5).columns[0]!.sectionType, 'web', '5: web in SECTION_TYPES');

	// 6. Idempotent serialize and no card body for web sections.
	const once = serialize(dataWith(webColumn('I', 'https://i.com', 'iframe', 1.5)));
	assert.equal(serialize(parse(once)), once, '6: serialize(parse(serialize)) === serialize');
	assert.ok(!once.includes('### '), '6: no card headings in body');

	/* ---------------- B. precheck pure functions ---------------- */

	// 7. No framing headers at all -> allowed.
	assert.equal(classifyFramePolicy({}), 'allowed', '7: empty headers allowed');

	// 8. X-Frame-Options DENY / SAMEORIGIN block in any value casing (keys are
	// lower-cased upstream by normalizeHeaders — see 10); ALLOW-FROM is dead.
	assert.equal(classifyFramePolicy({ 'x-frame-options': 'deny' }), 'blocked', '8: lowercase deny');
	assert.equal(classifyFramePolicy({ 'x-frame-options': 'SameOrigin' }), 'blocked', '8: mixed-case value');
	assert.equal(classifyFramePolicy({ 'x-frame-options': 'ALLOW-FROM https://a.com' }), 'allowed', '8: allow-from ignored');

	// 9. CSP frame-ancestors: without * blocks, with * allows, strictest wins.
	assert.equal(classifyFramePolicy({ 'content-security-policy': "frame-ancestors https://a.com" }), 'blocked', '9: explicit origin blocks');
	assert.equal(classifyFramePolicy({ 'content-security-policy': "frame-ancestors *" }), 'allowed', '9: wildcard allows');
	assert.equal(classifyFramePolicy({ 'content-security-policy': "default-src 'self'" }), 'allowed', '9: no frame-ancestors directive');
	assert.equal(
		classifyFramePolicy({ 'content-security-policy': "frame-ancestors * , frame-ancestors 'self'" }),
		'blocked',
		'9: strictest of merged policies wins',
	);

	// 10. Header normalization: lower-cased keys, array values joined.
	assert.deepEqual(
		normalizeHeaders({ 'X-Frame-Options': 'DENY', 'Set-Cookie': ['a=1', 'b=2'] }),
		{ 'x-frame-options': 'DENY', 'set-cookie': 'a=1, b=2' },
		'10: normalizeHeaders',
	);

	// 11. URL normalization: scheme added, whitespace trimmed, http kept.
	assert.equal(normalizeWebUrl('  keep.google.com  '), 'https://keep.google.com', '11: scheme added + trimmed');
	assert.equal(normalizeWebUrl('http://x.local'), 'http://x.local', '11: http untouched');

	// 12. URL validity gates.
	assert.equal(isValidWebUrl('https://x.com'), true, '12: plain https ok');
	assert.equal(isValidWebUrl('javascript:alert(1)'), false, '12: javascript rejected');
	assert.equal(isValidWebUrl('ftp://x.com'), false, '12: ftp rejected');
	assert.equal(isValidWebUrl('https://'), false, '12: empty host rejected');
	assert.equal(isValidWebUrl('https://u:p@x.com'), false, '12: userinfo rejected');
	assert.equal(isValidWebUrl('https://x.com/' + 'a'.repeat(2000)), false, '12: >2000 chars rejected');

	// 13. precheckEmbed with injected fetcher: verdict, cache, clear, failure.
	clearPrecheckCache();
	const denyOnce = fakeFetcher([DENY]);
	assert.equal((await precheckEmbed('https://cached.com', denyOnce)).verdict, 'blocked', '13: denied verdict');
	assert.equal((await precheckEmbed('https://cached.com', denyOnce)).verdict, 'blocked', '13: cached verdict served');
	assert.equal(denyOnce.calls.length, 1, '13: fetcher called once (cache hit second time)');
	assert.equal(getCachedVerdict('https://cached.com'), 'blocked', '13: cache readable');

	const throwing = fakeFetcher([new Error('offline')]);
	assert.equal((await precheckEmbed('https://flaky.com', throwing)).verdict, 'unknown', '13: network failure -> unknown');
	assert.equal((await precheckEmbed('https://flaky.com', fakeFetcher([]))).verdict, 'unknown', '13: cached unknown served without fetch');

	// 13b. A black-holed probe resolves to unknown within its bound.
	const hanging: HeaderFetcher = () => new Promise(() => {});
	const t0 = Date.now();
	assert.equal((await precheckEmbed('https://hang.com', hanging, 15)).verdict, 'unknown', '13b: hung probe -> unknown');
	assert.ok(Date.now() - t0 < 2000, '13b: bounded by timeoutMs, not pended forever');
	assert.equal(getCachedVerdict('https://hang.com'), 'unknown', '13b: timeout cached as unknown');

	clearPrecheckCache('https://cached.com');
	assert.equal(getCachedVerdict('https://cached.com'), undefined, '13: cleared per-url');
	const reprobe = fakeFetcher([CLEAN]);
	assert.equal((await precheckEmbed('https://cached.com', reprobe)).verdict, 'allowed', '13: re-probe after clear');

	/* ---------------- C. render state machine ---------------- */

	// 14. Empty URL -> guide state; configure button routes the config event.
	const empty = render(webColumn('Guide', ''));
	const emptyWrap = findByClass(empty.host, 'dashboard-web-empty')[0]!;
	assert.ok(emptyWrap, '14: empty state rendered');
	assert.equal(findTag(empty.host, 'iframe').length, 0, '14: no iframe for empty URL');
	let routed = false;
	empty.host.addEventListener('dashboard-library-config', () => { routed = true; });
	findByClass(empty.host, 'dashboard-web-fallback-btn')[0]!.click();
	assert.ok(routed, '14: configure button dispatched the config event');

	// 15. Forced iframe mode skips the precheck entirely.
	clearPrecheckCache();
	const forced = render(webColumn('F', 'https://frame.me', 'iframe'));
	const frame15 = findTag(forced.host, 'iframe')[0]!;
	assert.ok(frame15, '15: iframe mounted');
	assert.equal(frame15.getAttribute('src'), 'https://frame.me', '15: src set');
	assert.equal(frame15.getAttribute('referrerpolicy'), 'no-referrer', '15: referrer policy set');
	assert.equal(frame15.getAttribute('sandbox'), null, '15: no sandbox (login-capable)');

	// 16. auto + blocked verdict + desktop -> webview with isolated partition.
	clearPrecheckCache();
	const blockedDesktop = render(webColumn('B', 'https://deny.com'), { fetcher: fakeFetcher([DENY]) });
	await flush();
	const wv16 = findTag(blockedDesktop.host, 'webview')[0]!;
	assert.ok(wv16, '16: webview mounted for blocked site');
	assert.equal(wv16.getAttribute('src'), 'https://deny.com', '16: webview src');
	assert.equal(wv16.getAttribute('partition'), 'persist:apex-dashboard-web', '16: isolated persistent partition');
	assert.equal(wv16.getAttribute('nodeintegration'), null, '16: no node integration');
	assert.equal(findTag(blockedDesktop.host, 'iframe').length, 0, '16: no iframe alongside');

	// 17. Mobile + blocked -> fallback card with a working open-in-browser.
	const wasMobile = Platform.isMobile;
	Platform.isMobile = true;
	try {
		clearPrecheckCache();
		const mobileBlocked = render(webColumn('M', 'https://deny.com'), { fetcher: fakeFetcher([DENY]) });
		await flush();
		const card = findByClass(mobileBlocked.host, 'dashboard-web-fallback')[0]!;
		assert.ok(card, '17: fallback card rendered');
		assert.equal(findTag(mobileBlocked.host, 'iframe').length, 0, '17: optimistic iframe swapped out');
		assert.ok(findByClass(card, 'dashboard-web-fallback-host')[0]!.textContent.includes('deny.com'), '17: hostname shown');
		assert.equal(findTag(mobileBlocked.host, 'webview').length, 0, '17: no webview on mobile');
		const before = opened.length;
		findByClass(card, 'dashboard-web-fallback-btn')[0]!.click();
		assert.equal(opened.length, before + 1, '17: open-in-browser button works');

		// Forced webview on mobile also degrades to the card.
		const mobileForced = render(webColumn('MF', 'https://deny.com', 'webview'));
		assert.ok(findByClass(mobileForced.host, 'dashboard-web-fallback')[0]!, '17: forced webview -> card on mobile');
	} finally {
		Platform.isMobile = wasMobile;
	}

	// 18. auto + allowed -> plain iframe, mounted optimistically and never
	// remounted by the verdict (no reload flicker).
	clearPrecheckCache();
	const allowed = render(webColumn('A', 'https://fine.com'), { fetcher: fakeFetcher([CLEAN]) });
	assert.ok(findTag(allowed.host, 'iframe')[0], '18: optimistic iframe mounts immediately');
	await flush();
	assert.equal(findTag(allowed.host, 'iframe').length, 1, '18: allowed verdict kept the live iframe (no remount)');
	assert.equal(findTag(allowed.host, 'webview').length, 0, '18: no webview needed');

	// 19. Epoch guard: reload supersedes a pending probe; when both resolve,
	// only the live epoch's callback may mount — exactly one frame, not two.
	clearPrecheckCache();
	const delayed: HeaderFetcher = () => new Promise(res => {
		setTimeout(() => res(DENY), 25);
	});
	const racing = render(webColumn('R', 'https://race.com'), { fetcher: delayed });
	assert.ok(findTag(racing.host, 'iframe')[0], '19: optimistic iframe while probing');
	racing.reload(); // supersede: epoch 1 -> 2, a second probe starts
	await flush();
	await flush();
	const frames19 = findTag(racing.host, 'iframe').length + findTag(racing.host, 'webview').length;
	assert.equal(frames19, 1, '19: exactly one frame — late epoch-1 callback dropped');
	assert.ok(findTag(racing.host, 'webview')[0], '19: live epoch landed its webview');

	// 20. Reload closure: clears the URL's verdict cache and re-renders.
	clearPrecheckCache();
	const refreshing = render(webColumn('RL', 'https://deny.com'), { fetcher: fakeFetcher([DENY]) });
	await flush();
	assert.ok(findTag(refreshing.host, 'webview')[0], '20: blocked initially -> webview');
	assert.equal(getCachedVerdict('https://deny.com'), 'blocked', '20: verdict cached');
	refreshing.reload();
	assert.equal(getCachedVerdict('https://deny.com'), undefined, '20: reload cleared the cache');
	assert.ok(findTag(refreshing.host, 'iframe')[0], '20: re-render is optimistic again');
	await flush();
	assert.ok(findTag(refreshing.host, 'webview')[0], '20: re-probe re-landed the webview');
	assert.equal(findTag(refreshing.host, 'iframe').length, 0, '20: swap cleared the optimistic iframe');

	// 21. Zoom applies to the iframe path.
	clearPrecheckCache();
	const zoomed = render(webColumn('Z', 'https://zoom.com', 'iframe', 0.75));
	const frame21 = findTag(zoomed.host, 'iframe')[0]!;
	assert.equal((frame21 as unknown as { style: Record<string, string> }).style.zoom, '0.75', '21: css zoom set');

	// 22. Webview attach timeout escapes to the iframe (and does not loop).
	clearPrecheckCache();
	const stuck = render(webColumn('S', 'https://deny.com'), { fetcher: fakeFetcher([DENY]), timeoutMs: 5 });
	await flush(); // webview mounts (blocked) — its dom-ready never fires in mini-dom
	await new Promise(r => setTimeout(r, 30)); // timeout elapses
	const iframe22 = findTag(stuck.host, 'iframe')[0]!;
	assert.ok(iframe22, '22: webview timeout fell back to iframe');
	assert.equal(iframe22.getAttribute('src'), 'https://deny.com', '22: fallback iframe same URL');
	assert.equal(findTag(stuck.host, 'webview').length, 0, '22: dead webview removed, no loop');

	console.log('verify-web-section: 22 scenarios OK');
}

void main().catch(err => {
	console.error(err);
	process.exit(1);
});
