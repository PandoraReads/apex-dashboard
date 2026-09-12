import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass } from './mini-dom';import { parse, serialize } from '../src/parser';
import { renderBanner } from '../src/banner';
import type { BannerData } from '../src/types';

// Banner quote font: frontmatter round-trip (incl. CJK names with quotes)
// and renderBanner applying quoteFont to both quote and author elements.

function makeApp(): App {
	return {
		vault: {
			getFileByPath: () => null,
			adapter: {},
		},
	} as unknown as App;
}

const md = [
	'---',
	'banner:',
	'  quote: "Stay hungry, stay foolish."',
	'  author: "Steve Jobs"',
	'---',
	'',
	'## 板块',
].join('\n');

const banner = (extra: Partial<BannerData>): BannerData => ({ ...parse(md).banner, ...extra });

function main(): void {
	// 1. serialize -> parse round-trip keeps quoteFont.
	{
		const data = parse(md);
		data.banner.quoteFont = '楷体';
		const out = parse(serialize(data));
		assert.equal(out.banner.quoteFont, '楷体', '1: font survives round-trip');
	}

	// 2. Font name containing a double quote is escaped, not corrupted.
	{
		const data = parse(md);
		data.banner.quoteFont = 'My "Hand" Font';
		const out = parse(serialize(data));
		assert.equal(out.banner.quoteFont, 'My "Hand" Font', '2: quoted font name round-trips');
	}

	// 3. Absent key parses as undefined (theme default), serialize omits it.
	{
		const data = parse(md);
		assert.equal(data.banner.quoteFont, undefined, '3: parses as undefined');
		const out = serialize(data);
		assert.ok(!out.includes('quoteFont'), '3: key omitted when unset');
	}

	// 4. renderBanner applies the font to quote and author.
	{
		const host = new El('div');
		renderBanner(host as unknown as HTMLElement, banner({ quoteFont: 'Georgia' }), () => {}, makeApp());
		const quote = findByClass(host, 'dashboard-banner-quote')[0];
		const author = findByClass(host, 'dashboard-banner-author')[0];
		assert.ok(quote && author, '4: quote and author rendered');
		assert.equal((quote as unknown as { style: { fontFamily?: string } }).style.fontFamily, 'Georgia', '4: quote font set');
		assert.equal((author as unknown as { style: { fontFamily?: string } }).style.fontFamily, 'Georgia', '4: author font set');
	}

	// 5. No quoteFont -> no inline fontFamily (inherits theme).
	{
		const host = new El('div');
		renderBanner(host as unknown as HTMLElement, banner({}), () => {}, makeApp());
		const quote = findByClass(host, 'dashboard-banner-quote')[0];
		assert.equal((quote as unknown as { style: { fontFamily?: string } }).style.fontFamily, undefined, '5: no inline font when unset');
	}

	console.log('verify-banner-quote-font: all 5 checks passed');
}

main();
