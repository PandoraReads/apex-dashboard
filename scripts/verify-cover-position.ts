/**
 * Verifies the cover/banner focal-point feature (方案 B — modal picker):
 *
 * 1. parse/format helpers: "x,y" round-trip, clamping, invalid input.
 * 2. Parser: card `coverPos:` metadata and banner `imagePos:` map both
 *    round-trip through serialize → parse; the neutral center is omitted.
 * 3. renderBanner: a saved focal point lands as background-position
 *    percentages; absent/center leaves no inline override (CSS center).
 * 4. FocalPointPicker: pointer drag maps to 0-100 percentages, the reset
 *    button returns to center, and an empty path ignores drags.
 *
 * Run: `npm run test:cover-position`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { parse, serialize } from '../src/parser';
import { renderBanner } from '../src/banner';
import { FocalPointPicker, parseFocalPoint, formatFocalPoint, isCenterFocal } from '../src/focal-point-picker';
import { El, findByClass } from './mini-dom';
import type { BannerData } from '../src/types';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
};

const app = {
	vault: { getFileByPath: () => null },
	workspace: { on: () => {}, off: () => {} },
} as unknown as App;

const banner = (over: Partial<BannerData> = {}): BannerData => ({
	quote: 'Hello',
	author: 'World',
	image: 'https://example.com/p.jpg',
	...over,
});

function main(): void {
	// 1. Helpers.
	{
		const pos = parseFocalPoint('30,80')!;
		assert.deepEqual(pos, { x: 30, y: 80 }, '1: parses x,y');
		assert.equal(formatFocalPoint(pos), '30,80', '1: formats back');
		assert.deepEqual(parseFocalPoint('120,-5'), { x: 100, y: 0 }, '1: clamps into 0-100');
		assert.equal(parseFocalPoint('nope'), undefined, '1: junk yields undefined');
		assert.equal(parseFocalPoint(undefined), undefined, '1: absent yields undefined');
		assert.ok(isCenterFocal({ x: 50, y: 50 }), '1: 50/50 is the neutral center');
		assert.ok(!isCenterFocal({ x: 50, y: 51 }), '1: non-center detected');
	}

	// 2. Parser round-trips.
	{
		const md = [
			'---',
			'dashboard: true',
			'banner:',
			'  quote: "Hello"',
			'  author: "World"',
			'  image: "https://example.com/p.jpg"',
			'  images:',
			'    - "https://example.com/p.jpg"',
			'    - "attachments/b.jpg"',
			'  imagePos:',
			'    "https://example.com/p.jpg": "30,80"',
			'    "attachments/b.jpg": "0,100"',
			'columns:',
			'  - name: Projects',
			'    color: "#10b981"',
			'---',
			'',
			'## Projects',
			'',
			'### Card',
			'cover: attachments/c.jpg',
			'coverPos: 30,80',
			'',
		].join('\n');
		const data = parse(md);
		assert.deepEqual(data.banner.imagePos?.['https://example.com/p.jpg'], { x: 30, y: 80 }, '2: banner imagePos parses');
		assert.deepEqual(data.banner.imagePos?.['attachments/b.jpg'], { x: 0, y: 100 }, '2: second image focal parses');
		const card = data.columns[0]!.cards[0]!;
		assert.deepEqual(card.coverPos, { x: 30, y: 80 }, '2: card coverPos parses');

		const out = serialize(data);
		assert.ok(out.includes('coverPos: 30,80'), '2: coverPos re-serialized');
		assert.ok(out.includes('"https://example.com/p.jpg": "30,80"'), '2: imagePos re-serialized');

		// Center values are omitted: a centered card cover writes no line and
		// a centered banner image drops its map entry.
		const centered = parse(serialize({
			...data,
			banner: { ...data.banner, imagePos: { 'https://example.com/p.jpg': { x: 50, y: 50 } } },
			columns: data.columns.map(col => ({
				...col,
				cards: col.cards.map(c => ({ ...c, coverPos: { x: 50, y: 50 } })),
			})),
		}));
		assert.equal(centered.columns[0]!.cards[0]!.coverPos, undefined, '2: centered coverPos unpersisted');
		assert.equal(centered.banner.imagePos, undefined, '2: all-center imagePos map dropped');
	}

	// 3. renderBanner applies the saved focal point (http URLs skip vault
	//    resolution); absent/center leaves no inline background-position.
	{
		const host = new El('div');
		renderBanner(host as unknown as HTMLElement, banner({ imagePos: { 'https://example.com/p.jpg': { x: 30, y: 80 } } }), () => {}, app);
		const el = findByClass(host, 'dashboard-banner')[0]!;
		assert.equal(el.style.backgroundPosition, '30% 80%', '3: saved focal applied');

		const plain = new El('div');
		renderBanner(plain as unknown as HTMLElement, banner(), () => {}, app);
		const el2 = findByClass(plain, 'dashboard-banner')[0]!;
		assert.ok(!('backgroundPosition' in el2.style) || !el2.style.backgroundPosition, '3: no override without a focal point');

		const centered = new El('div');
		renderBanner(centered as unknown as HTMLElement, banner({ imagePos: { 'https://example.com/p.jpg': { x: 50, y: 50 } } }), () => {}, app);
		const el3 = findByClass(centered, 'dashboard-banner')[0]!;
		assert.ok(!('backgroundPosition' in el3.style) || !el3.style.backgroundPosition, '3: center focal = no override');
	}

	// 4. FocalPointPicker: drag math + reset + empty guard.
	{
		const changes: Array<{ x: number; y: number }> = [];
		const host = new El('div');
		new FocalPointPicker(app, host as unknown as HTMLElement, {
			path: 'https://example.com/p.jpg',
			ratio: 2,
			onChange: (pos) => { changes.push(pos); },
		});
		const box = findByClass(host, 'dashboard-focal-picker-box')[0]! as El & {
			setPointerCapture: (id: number) => void;
			releasePointerCapture: (id: number) => void;
		};
		// Geometry: 200x100 box at origin → pointer (60, 30) = (30%, 30%).
		(box as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
			({ top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as unknown as DOMRect;
		box.setPointerCapture = () => {};
		box.releasePointerCapture = () => {};

		box.dispatchEvent({ type: 'pointerdown', target: box, pointerId: 1, clientX: 60, clientY: 30 });
		assert.deepEqual(changes[changes.length - 1], { x: 30, y: 30 }, '4: pointer maps to percentages');
		assert.equal(box.style.backgroundPosition, '30% 30%', '4: preview background-position live');
		// Drag beyond the edge clamps to 100.
		box.dispatchEvent({ type: 'pointermove', target: box, pointerId: 1, clientX: 999, clientY: -20 });
		assert.deepEqual(changes[changes.length - 1], { x: 100, y: 0 }, '4: drag clamps at the edges');

		const reset = findByClass(host, 'dashboard-focal-picker-reset')[0]!;
		reset.click();
		assert.deepEqual(changes[changes.length - 1], { x: 50, y: 50 }, '4: reset recenters');

		// Empty path: preview ignores pointer input entirely.
		const emptyHost = new El('div');
		const emptyChanges: Array<{ x: number; y: number }> = [];
		new FocalPointPicker(app, emptyHost as unknown as HTMLElement, { path: '', onChange: (pos) => { emptyChanges.push(pos); } });
		const emptyBox = findByClass(emptyHost, 'dashboard-focal-picker-box')[0]! as El & {
			setPointerCapture: (id: number) => void;
		};
		(emptyBox as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
			({ top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as unknown as DOMRect;
		emptyBox.setPointerCapture = () => {};
		emptyBox.dispatchEvent({ type: 'pointerdown', target: emptyBox, pointerId: 1, clientX: 60, clientY: 30 });
		assert.equal(emptyChanges.length, 0, '4: empty preview ignores drags');
	}

	console.log('verify-cover-position: all checks passed');
}

main();
