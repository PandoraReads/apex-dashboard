/**
 * Verifies the sidebar photo-album widget:
 *
 * 1. Unset folder renders the "pick a folder" placeholder.
 * 2. Folder set but imageless renders the "no images" placeholder.
 * 3. listAlbumImages: recursive vs top-level only, hidden-path skip, natural
 *    sort order (a2 before a10), non-image extensions ignored.
 * 4. Populated folder renders frame + img + index badge; single image gets
 *    the --single modifier and no rotation timer.
 * 5. refreshAlbumWidget with an identical list is a no-op (img element and
 *    interval id survive untouched).
 * 6. refreshAlbumWidget with a changed list keeps the current photo when it
 *    survived (src unchanged), else clamps into the new list.
 * 7. destroyAlbumWidgets clears rotation timers; a detached widget's tick
 *    also self-cleans (isConnected guard).
 *
 * Run: `npm run test:album-widget`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import {
	renderSidebarAlbumWidget,
	refreshAlbumWidget,
	destroyAlbumWidgets,
	listAlbumImages,
} from '../src/album-widget';
import type { DashboardSettings } from '../src/types';
import { El, findByClass } from './mini-dom';

interface FakeFile {
	path: string;
	extension: string;
	parent: { path: string };
}

const makeFiles = (paths: string[]): FakeFile[] =>
	paths.map(p => ({
		path: p,
		extension: p.split('.').pop() ?? '',
		parent: { path: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/' },
	}));

/** A single App instance whose file list can be swapped between refreshes -
 *  mirrors production, where the view's `app` never changes and only the
 *  vault contents do (the widget's closures capture the render-time app). */
const makeVault = (paths: string[]): { app: App; setFiles: (next: string[]) => void } => {
	let files = makeFiles(paths);
	const app = {
		vault: {
			getFiles: () => files,
			getFileByPath: (p: string) => files.find(f => f.path === p) ?? null,
			adapter: { getResourcePath: (p: string) => `appres://${p}` },
		},
	} as unknown as App;
	return { app, setFiles: (next: string[]) => { files = makeFiles(next); } };
};

/** The visible photo layer: --top always marks the layer showing the current
 *  slide (assigned at render and moved to each incoming layer at settle). */
const frontLayer = (root: El): El | undefined =>
	findByClass(root, 'dashboard-sidebar-album-layer').find(l => l.hasClass('dashboard-sidebar-album-layer--top'));

const albumSettings = (over: Partial<DashboardSettings>): DashboardSettings =>
	({ widgetAlbumEnabled: true, widgetAlbumFolder: '', widgetAlbumIntervalSec: 8, widgetAlbumRecursive: true, widgetAlbumRatio: '1:1' as '1:1' | '3:4', widgetAlbumTransition: 'fade' as 'fade' | 'slide-left' | 'slide-right' | 'zoom', ...over } as unknown as DashboardSettings);

const run = async (): Promise<void> => {
	// Globals the widget touches: window timers (faked intervals, real
	// timeouts so the 600ms fade swap stays inert but harmless), Image for
	// preloading, activeDocument kept inert for modal-theme imports.
	const intervals = new Map<number, () => void>();
	let intervalSeq = 0;
	(globalThis as { window?: unknown }).window = {
		setTimeout: globalThis.setTimeout.bind(globalThis) as (fn: () => void, ms?: number) => number,
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
		setInterval: (fn: () => void, _ms?: number): number => {
			const id = ++intervalSeq;
			intervals.set(id, fn);
			return id;
		},
		clearInterval: (id: number): void => {
			intervals.delete(id);
		},
	};
	(globalThis as Record<string, unknown>).Image = class {
		src = '';
	};
	(globalThis as { activeDocument?: unknown }).activeDocument = {
		querySelector: (): null => null,
		body: new El('body'),
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
	};

	const bodyEl = new El('body');

	// 1. Unset folder -> "pick a folder" placeholder.
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: '' }), makeVault([]).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		assert.ok(widget, 'album widget rendered');
		assert.ok(widget.hasClass('dashboard-sidebar-album--empty'), 'unset folder marks widget empty');
		assert.equal(findByClass(widget, 'dashboard-sidebar-album-top').length, 0, 'no title row on the panel');
		assert.ok(widget.hasClass('dashboard-sidebar-album--ratio-1-1'), 'default ratio class is 1:1');
		const ph = findByClass(widget, 'dashboard-sidebar-album-placeholder')[0]!;
		assert.ok(ph, 'placeholder rendered');
		assert.match(ph.textContent, /相册文件夹/, 'unset-folder hint text');
		assert.equal(findByClass(widget, 'dashboard-sidebar-album-frame').length, 0, 'no frame without images');
		assert.equal(intervals.size, 0, 'no timer without images');
	}

	// 2. Folder set, no images -> "no images" placeholder.
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Empty' }), makeVault(['Empty/readme.md']).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		const ph = findByClass(widget, 'dashboard-sidebar-album-placeholder')[0]!;
		assert.match(ph.textContent, /暂无图片/, 'no-images hint text');
	}

	// 3. listAlbumImages semantics.
	{
		const app = makeVault([
			'Photos/b.jpg',
			'Photos/a10.png',
			'Photos/a2.png',
			'Photos/2024/sub/s.png',
			'.hidden/x.png',
			'Elsewhere/z.png',
			'Photos/note.md',
		]).app;
		assert.deepEqual(listAlbumImages(app, 'Photos', true), [
			'Photos/2024/sub/s.png',
			'Photos/a2.png',
			'Photos/a10.png',
			'Photos/b.jpg',
		], 'recursive: natural sort, hidden/other folders/md skipped');
		assert.deepEqual(listAlbumImages(app, 'Photos', false), [
			'Photos/a2.png',
			'Photos/a10.png',
			'Photos/b.jpg',
		], 'non-recursive: direct children only');
		assert.deepEqual(listAlbumImages(app, '/Photos/', true), listAlbumImages(app, 'Photos', true), 'folder path normalized');
		assert.deepEqual(listAlbumImages(app, '', true), [], 'empty folder string yields no images');
	}

	// 4. Populated folder: frame + img + badge; single image -> --single, no timer.
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos' }), makeVault(['Photos/a2.png', 'Photos/a10.png']).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		const frame = findByClass(widget, 'dashboard-sidebar-album-frame')[0]!;
		assert.ok(frame, 'frame rendered');
		assert.ok(frame.hasClass('dashboard-sidebar-album-frame--fade'), 'frame carries the fade mode class');
		const layers = findByClass(frame, 'dashboard-sidebar-album-layer');
		assert.equal(layers.length, 2, 'two ping-pong layers rendered');
		const img = frontLayer(frame)!;
		assert.ok(img, 'a --top (front) layer exists');
		assert.match(String((img as unknown as { src?: string }).src ?? ''), /^appres:\/\/Photos\/(a2|a10)\.png$/, 'front layer src resolved via resource path');
		assert.equal(layers.every(l => l.getAttribute('draggable') === 'false'), true, 'layers not natively draggable');
		const badge = findByClass(widget, 'dashboard-sidebar-album-index')[0]!;
		assert.match(badge.textContent, /^[12]\/2$/, 'index badge shows n/2');
		assert.ok(!widget.hasClass('dashboard-sidebar-album--single'), 'two images are not single mode');
		assert.equal(intervals.size, 1, 'one rotation timer for 2+ images');
	}
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Solo' }), makeVault(['Solo/only.png']).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		assert.ok(widget.hasClass('dashboard-sidebar-album--single'), 'single image sets --single');
		assert.equal(intervals.size, 1, 'timer count still just the pair-widget one');
	}

	// 4b. Portrait ratio setting applies the 3:4 modifier class.
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos', widgetAlbumRatio: '3:4' }), makeVault(['Photos/a2.png']).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		assert.ok(widget.hasClass('dashboard-sidebar-album--ratio-3-4'), '3:4 setting applies the portrait class');
		assert.ok(!widget.hasClass('dashboard-sidebar-album--ratio-1-1'), 'portrait excludes the square class');
	}

	// 4c. Slide-left transition: manual nav animates the other layer in, runs
	//     the old one out, and settles with flipped roles + advanced badge.
	{
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos', widgetAlbumTransition: 'slide-left' }), makeVault(['Photos/a2.png', 'Photos/a10.png']).app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		const frame = findByClass(widget, 'dashboard-sidebar-album-frame')[0]!;
		assert.ok(frame.hasClass('dashboard-sidebar-album-frame--slide-left'), 'frame carries the slide-left mode class');
		const srcOf = (): string => String((frontLayer(widget) as unknown as { src?: string }).src ?? '');
		const before = srcOf();
		const other = before.endsWith('a2.png') ? 'appres://Photos/a10.png' : 'appres://Photos/a2.png';

		const nextBtn = findByClass(widget, 'dashboard-sidebar-album-nav--next')[0]!;
		nextBtn.click();
		// Synchronous post-click state: incoming layer loaded + promoted, old
		// layer carries the slide-out run class.
		const afterClick = srcOf();
		assert.equal(afterClick, other, 'next click loads the other photo onto the promoted layer');
		const allLayers = findByClass(frame, 'dashboard-sidebar-album-layer');
		const outgoing = allLayers.find(l => !l.hasClass('dashboard-sidebar-album-layer--top'))!;
		assert.ok(outgoing.hasClass('dashboard-sidebar-album-layer--run-slide-out-left'), 'slide-left runs the old layer out to the left');
		assert.equal(String((outgoing as unknown as { src?: string }).src), before, 'outgoing layer keeps the previous photo');
		// Rapid double-click is guarded by the transitioning flag.
		nextBtn.click();
		assert.equal(srcOf(), other, 'click during a transition is ignored');

		await new Promise(r => setTimeout(r, 700)); // let the 600ms settle fire
		const badge = findByClass(widget, 'dashboard-sidebar-album-index')[0]!;
		assert.match(badge.textContent, /^[12]\/2$/, 'badge settled on the new photo');
	}

	// 5. Identical list refresh: img element identity and timer id untouched.
	{
		const { app } = makeVault(['Photos/a2.png', 'Photos/a10.png']);
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos' }), app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		const imgBefore = frontLayer(widget)!;
		const timerBefore = [...intervals.keys()];
		assert.equal(refreshAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos' }), app), true, 'refresh finds the live widget');
		const imgAfter = frontLayer(widget)!;
		assert.equal(imgAfter, imgBefore, 'identical list does not rebuild the frame');
		assert.deepEqual([...intervals.keys()], timerBefore, 'identical list does not restart the timer');
	}

	// 6. Changed list: current photo survives -> src kept; removed -> clamped;
	//    emptied -> placeholder returns. One vault whose contents mutate.
	{
		const { app, setFiles } = makeVault(['Photos/a2.png', 'Photos/a10.png']);
		const root = bodyEl.createDiv({ cls: 'host' });
		const settings = albumSettings({ widgetAlbumFolder: 'Photos' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, settings, app);
		const widget = findByClass(root, 'dashboard-sidebar-album')[0]!;
		const srcOf = (): string => String((frontLayer(widget) as unknown as { src?: string }).src ?? '');
		const currentSrc = srcOf();
		assert.match(currentSrc, /^appres:\/\//, 'current src resolves before refresh');

		// Current photo survives the other one being replaced.
		const survivingPath = currentSrc.replace(/^appres:\/\//, '');
		setFiles([survivingPath, 'Photos/zz-new.png']);
		assert.equal(refreshAlbumWidget(root as unknown as HTMLElement, settings, app), true, 'refresh applies the changed list');
		assert.equal(srcOf(), currentSrc, 'surviving current photo stays on screen');

		// Current photo deleted -> clamped onto the new list.
		setFiles(['Photos/zz-new.png']);
		assert.equal(refreshAlbumWidget(root as unknown as HTMLElement, settings, app), true, 'refresh applies a shrinking list');
		assert.equal(srcOf(), 'appres://Photos/zz-new.png', 'index clamped onto the remaining photo');

		// List emptied -> placeholder returns.
		setFiles(['Photos/readme.md']);
		assert.equal(refreshAlbumWidget(root as unknown as HTMLElement, settings, app), true, 'refresh applies an empty list');
		assert.ok(widget.hasClass('dashboard-sidebar-album--empty'), 'empty refresh returns to placeholder');
		assert.ok(findByClass(widget, 'dashboard-sidebar-album-placeholder')[0], 'placeholder DOM present');
	}

	// 7. Timer teardown: destroyAlbumWidgets clears; detached tick self-cleans.
	{
		const { app } = makeVault(['Photos/a2.png', 'Photos/a10.png']);
		const root = bodyEl.createDiv({ cls: 'host' });
		renderSidebarAlbumWidget(root as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos' }), app);
		assert.ok(intervals.size >= 1, 'timer registered');

		destroyAlbumWidgets();
		assert.equal(intervals.size, 0, 'destroyAlbumWidgets clears rotation timers');

		// mini-dom's remove() keeps .parent set (real DOM nulls it), so a
		// detached widget is simulated by rendering into a root that was never
		// appended to the body: isConnected is false from the first tick.
		const detachedRoot = new El('div');
		renderSidebarAlbumWidget(detachedRoot as unknown as HTMLElement, albumSettings({ widgetAlbumFolder: 'Photos' }), app);
		const tick = [...intervals.values()][0]!;
		assert.ok(tick, 'detached render still registers its timer');
		tick(); // self-clean path: isConnected false -> clearInterval
		assert.equal(intervals.size, 0, 'detached widget tick self-cleans its timer');
	}

	destroyAlbumWidgets();
};

run().then(() => console.log('album widget: ALL PASS'), e => { console.error(e); process.exit(1); });
