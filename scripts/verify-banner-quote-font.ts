import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass } from './mini-dom';import { parse, serialize } from '../src/parser';
import { renderBanner, QUOTE_FONT_GROUPS, firstFontName } from '../src/banner';
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

	// 6. Dropdown catalog: both locales' groups present, values are unique
	//    non-empty CSS stacks ending in a generic family, labels non-empty.
	{
		const groups = QUOTE_FONT_GROUPS.map(g => g.labelKey);
		assert.ok(groups.includes('banner.quoteFontGroupZh'), '6: Chinese font group exists');
		assert.ok(groups.includes('banner.quoteFontGroupEn'), '6: Western font group exists');
		const all = QUOTE_FONT_GROUPS.flatMap(g => g.fonts);
		assert.ok(all.length >= 12, '6: catalog is not trivially small');
		const values = new Set<string>();
		const generic = /,(serif|sans-serif|cursive|monospace)$/;
		for (const font of all) {
			assert.ok(font.label.trim().length > 0, '6: label non-empty');
			assert.ok(generic.test(font.value), `6: stack ends in a generic family: ${font.label}`);
			assert.ok(!values.has(font.value), `6: duplicate stack value: ${font.label}`);
			values.add(font.value);
		}
		// Cross-platform guard: the kaiti pick covers macOS (Kaiti SC) and Windows (KaiTi).
		const kaiti = valuesHas(values, v => v.includes('"Kaiti SC"') && v.includes('"KaiTi"'));
		assert.ok(kaiti, '6: kaiti stack spans macOS and Windows names');
	}

	// 7. firstFontName labels legacy hand-typed values for the dropdown.
	{
		assert.equal(firstFontName('"Kaiti SC","KaiTi",serif'), 'Kaiti SC', '7: leading quoted family wins');
		assert.equal(firstFontName('Georgia,serif'), 'Georgia', '7: bare family extracted');
		assert.equal(firstFontName('  楷体  '), '楷体', '7: single bare name trimmed');
	}

	console.log('verify-banner-quote-font: all 7 checks passed');
}

function valuesHas(values: Set<string>, pred: (v: string) => boolean): boolean {
	for (const v of values) if (pred(v)) return true;
	return false;
}

main();
