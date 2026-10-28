/**
 * Media lightbox gesture test (src/media-lightbox-modal.ts):
 *
 * 1. Image mode: wheel zoom magnifies around the cursor (transform carries
 *    translate + scale); wheel-out reverses; double-click resets to identity.
 * 2. Pan while magnified: pointerdown on the image + document pointermove
 *    shifts the translate component (document-capture listeners fire).
 * 3. Video mode: the player WRAP opens at the persisted width (default 70%),
 *    the corner grip drag stretches it (delta / viewport width), and the choice
 *    persists through saveLocalStorage — the next open restores it. The video
 *    element itself carries no inline width (CSS fills the wrap, which is what
 *    keeps the player centered).
 * 4. Navigation chrome: prev/next step through the list with is-disabled
 *    states at the ends; the caption tracks the index.
 * 5. Backdrop close vs. drag tail: a plain backdrop click closes, but the
 *    click a grip drag synthesizes when it releases over the backdrop is
 *    swallowed, and clicks on the player never close.
 * 6. Backlinks: the referencing-notes list below the tag bar keeps only
 *    existing markdown notes (missing files and canvas boards drop), sorts
 *    by path, and a click closes the lightbox then jumps via the openNote
 *    hook — or openLinkText when no hook is provided (resolvedLinks is the
 *    source of truth).
 *
 * Run: `npm run test:lightbox`
 */
import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { MediaLightboxModal } from '../src/media-lightbox-modal';

// window/activeDocument for the gesture listeners (document-capture pairs).
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as Record<string, unknown>).innerWidth = 1000;
const docEl = new El('div');
(docEl as unknown as { body: El }).body = new El('body');
(globalThis as Record<string, unknown>).activeDocument = docEl;

function mediaFile(path: string): TFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return {
		path,
		name,
		basename: dot > 0 ? name.slice(0, dot) : name,
		extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
		parent: { path: '素材' },
		stat: { mtime: 1, ctime: 1, size: 10 },
	} as unknown as TFile;
}

const FILES = [mediaFile('素材/a.png'), mediaFile('素材/b.png'), mediaFile('素材/clip.mp4')];

/** Backlink sources must be real TFile instances — the renderer filters with
 *  instanceof, and the plain-object mediaFile cast above would never pass. */
function noteFile(path: string): TFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new TFile(), {
		path,
		name,
		basename: dot > 0 ? name.slice(0, dot) : name,
		extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
		parent: { path: path.slice(0, path.lastIndexOf('/')) || '/' },
		stat: { mtime: 1, ctime: 1, size: 10 },
	}) as unknown as TFile;
}

// ref-a / ref-b resolve; gone.md is a stale link with no file behind it;
// whiteboard.canvas exists but is not a markdown note.
const NOTE_A = noteFile('笔记/ref-a.md');
const NOTE_B = noteFile('笔记/ref-b.md');
const CANVAS = Object.assign(new TFile(), { path: '笔记/whiteboard.canvas', extension: 'canvas' }) as unknown as TFile;
/** Inverted from the metadata cache's resolvedLinks view of the fixtures:
 *  sources whose resolved targets include the media file. */
const RESOLVED_LINKS: Record<string, Record<string, number>> = {
	'笔记/ref-b.md': { '素材/a.png': 1 },
	'笔记/gone.md': { '素材/a.png': 1 },
	'笔记/ref-a.md': { '素材/a.png': 2, '素材/clip.mp4': 1 },
	'笔记/whiteboard.canvas': { '素材/a.png': 1 },
};

function makeApp(): { app: App; stored: { value: string | null }; openedLinks: string[] } {
	const byPath = new Map<string, TFile>();
	for (const f of [...FILES, NOTE_A, NOTE_B, CANVAS]) byPath.set(f.path, f);
	const stored = { value: null as string | null };
	const openedLinks: string[] = [];
	const app = {
		vault: {
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			adapter: {
				basePath: '/vault-root',
				getResourcePath: (p: string) => `app://local/${p}`,
			},
		},
		metadataCache: { resolvedLinks: RESOLVED_LINKS },
		workspace: {
			openLinkText: async (linktext: string) => { openedLinks.push(linktext); },
		},
		loadLocalStorage: () => stored.value,
		saveLocalStorage: (_k: string, v: string) => { stored.value = v; },
	} as unknown as App;
	return { app, stored, openedLinks };
}

/** contentEl through the mini-dom type (tsc sees the real HTMLElement). */
function contentOf(modal: MediaLightboxModal): El {
	return (modal as unknown as { contentEl: El }).contentEl;
}

function openModal(
	app: App,
	files: TFile[],
	index: number,
	kind: 'image' | 'video',
	openNote?: (file: TFile) => void,
): MediaLightboxModal {
	const modal = new MediaLightboxModal(app, files, index, kind, undefined, openNote);
	// The stub Modal has no scope; the real one registers arrow-key handlers.
	(modal as unknown as { scope: { register: () => void } }).scope = { register: () => {} };
	modal.onOpen();
	return modal;
}

function main(): void {
	const { app, stored, openedLinks } = makeApp();

	// --- 1. Image wheel zoom ---------------------------------------------------
	const imgModal = openModal(app, [FILES[0]!, FILES[1]!], 0, 'image');
	let img = findByClass(contentOf(imgModal), 'dashboard-media-lightbox-img')[0]!;
	assert.ok(img, 'image lightbox embeds the img');
	assert.equal(img.getAttribute('src'), 'app://local/素材/a.png');
	assert.equal(img.style.transform, undefined, 'no transform before any zoom');
	// Wheel in: 1 × 1.2 = 1.2.
	img.dispatchEvent({ type: 'wheel', deltaY: -100, clientX: 100, clientY: 100 });
	assert.ok(img.style.transform!.includes('scale(1.2)'), `wheel-in magnifies: ${img.style.transform}`);
	// Wheel out: back to 1.
	img.dispatchEvent({ type: 'wheel', deltaY: 100, clientX: 100, clientY: 100 });
	assert.ok(img.style.transform!.includes('scale(1)'), `wheel-out reverses: ${img.style.transform}`);
	assert.ok(!img.style.transform!.includes('scale(1.'), `fully reversed, not 1.x: ${img.style.transform}`);

	// --- 2. Pan while magnified -------------------------------------------------
	// Wheel-in at cursor (100,100) with a zero rect also anchors the zoom:
	// t = d - k·(d - t) = 100 - 1.2·100 = -20 on both axes, scale 1.2.
	img.dispatchEvent({ type: 'wheel', deltaY: -100, clientX: 100, clientY: 100 });
	assert.ok(img.style.transform!.includes('translate(-20px, -20px) scale(1.2)'), `cursor-anchored zoom: ${img.style.transform}`);
	img.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100 });
	docEl.dispatchEvent({ type: 'pointermove', clientX: 150, clientY: 120 });
	docEl.dispatchEvent({ type: 'pointerup' });
	assert.ok(img.style.transform!.includes('translate(30px, 0px)'), `pan adds the drag delta: ${img.style.transform}`);
	// Double-click resets zoom + pan.
	img.dispatchEvent({ type: 'dblclick' });
	assert.equal(img.style.transform, 'translate(0px, 0px) scale(1)', 'double-click resets to identity');

	// --- 3. Navigation chrome ----------------------------------------------------
	assert.ok(findByClass(contentOf(imgModal), 'dashboard-media-lightbox-nav--prev')[0]!.hasClass('is-disabled'), 'prev disabled at the first item');
	const next = findByClass(contentOf(imgModal), 'dashboard-media-lightbox-nav--next')[0]!;
	next.dispatchEvent({ type: 'click' });
	img = findByClass(contentOf(imgModal), 'dashboard-media-lightbox-img')[0]!;
	assert.equal(img.getAttribute('src'), 'app://local/素材/b.png', 'next steps to the second image');
	assert.ok(findByClass(contentOf(imgModal), 'dashboard-media-lightbox-caption')[0]!.textContent.includes('(2 / 2)'), 'caption tracks the index');
	assert.ok(findByClass(contentOf(imgModal), 'dashboard-media-lightbox-nav--next')[0]!.hasClass('is-disabled'), 'next disabled at the last item');
	imgModal.onClose();

	// --- 4. Video resize grip -----------------------------------------------------
	const vidModal = openModal(app, [FILES[2]!], 0, 'video');
	let video = findByClass(contentOf(vidModal), 'dashboard-media-lightbox-video')[0]!;
	assert.ok(video, 'video lightbox embeds the player');
	assert.equal((video as unknown as El).getAttribute('controls'), '', 'player carries native controls');
	let wrap = findByClass(contentOf(vidModal), 'dashboard-media-lightbox-video-wrap')[0]!;
	assert.equal(wrap.style.width, '70%', 'first open defaults the wrap to 70% width');
	assert.equal(video.style.width, undefined, 'the player has no inline width (CSS fills the wrap → stays centered)');
	const grip = findByClass(contentOf(vidModal), 'dashboard-media-lightbox-resize')[0]!;
	assert.equal(grip.getAttribute('title'), '拖动调整播放器大小', 'grip announces the resize gesture');
	// Drag right by 200px of a 1000px viewport → +20% → clamped 90%.
	grip.dispatchEvent({ type: 'pointerdown', clientX: 500, clientY: 500 });
	docEl.dispatchEvent({ type: 'pointermove', clientX: 700, clientY: 500 });
	docEl.dispatchEvent({ type: 'pointerup' });
	assert.equal(wrap.style.width, '90%', 'drag stretches the wrap width');
	assert.equal(stored.value, '90', 'release persists the width');
	vidModal.onClose();

	// A later open restores the persisted width (clamped into 20–95).
	const second = openModal(app, [FILES[2]!], 0, 'video');
	wrap = findByClass(contentOf(second), 'dashboard-media-lightbox-video-wrap')[0]!;
	assert.equal(wrap.style.width, '90%', 'persisted width restored on reopen');
	stored.value = '500';
	const clamped = openModal(app, [FILES[2]!], 0, 'video');
	assert.equal(findByClass(contentOf(clamped), 'dashboard-media-lightbox-video-wrap')[0]!.style.width, '95%', 'out-of-range stored width clamps to 95%');

	// --- 5. Backdrop close vs. drag tail -------------------------------------------
	stored.value = '60';
	const bd = openModal(app, [FILES[2]!], 0, 'video');
	let closes = 0;
	(bd as unknown as { close: () => void }).close = () => { closes += 1; };
	const content = contentOf(bd);
	const stage = findByClass(content, 'dashboard-media-lightbox-stage')[0]!;
	const bdWrap = findByClass(content, 'dashboard-media-lightbox-video-wrap')[0]!;
	// A plain backdrop click closes.
	content.dispatchEvent({ type: 'click', target: stage });
	assert.equal(closes, 1, 'backdrop click closes the lightbox');
	// The click a grip drag synthesizes on release (target = the common ancestor,
	// i.e. the stage) must NOT close — that was the "dragging closes the modal" bug.
	const grip2 = findByClass(content, 'dashboard-media-lightbox-resize')[0]!;
	grip2.dispatchEvent({ type: 'pointerdown', clientX: 500, clientY: 500 });
	docEl.dispatchEvent({ type: 'pointermove', clientX: 560, clientY: 500 });
	docEl.dispatchEvent({ type: 'pointerup' });
	content.dispatchEvent({ type: 'click', target: stage });
	assert.equal(closes, 1, 'drag-tail backdrop click is swallowed');
	assert.equal(bdWrap.style.width, '66%', 'the drag still resized the player');
	assert.equal(stored.value, '66', 'and persisted the new width');
	// Clicks landing on the player itself never close.
	video = findByClass(content, 'dashboard-media-lightbox-video')[0]!;
	stage.dispatchEvent({ type: 'click', target: video });
	assert.equal(closes, 1, 'click on the player does not close');
	bd.onClose();

	// --- 6. Backlinks: referencing notes below the tags ----------------------------
	// Hook path: click closes the lightbox and hands the note to openNote.
	const hookOpens: Array<{ path: string }> = [];
	let hookCloses = 0;
	const blModal = openModal(app, [FILES[0]!], 0, 'image', f => { hookOpens.push({ path: f.path }); });
	(blModal as unknown as { close: () => void }).close = () => { hookCloses += 1; };
	const blContent = contentOf(blModal);
	assert.equal(
		findByClass(blContent, 'dashboard-media-lightbox-backlinks-title')[0]!.textContent, '引用笔记',
		'section title is localized',
	);
	assert.equal(findByClass(blContent, 'dashboard-media-lightbox-backlink').length, 2, 'stale links and canvas boards drop; only existing notes render');
	assert.deepEqual(
		findByClass(blContent, 'dashboard-media-lightbox-backlink-name').map(el => el.textContent),
		['ref-a', 'ref-b'],
		'notes sort by path and carry the basename',
	);
	findByClass(blContent, 'dashboard-media-lightbox-backlink')[0]!.dispatchEvent({ type: 'click' });
	assert.equal(hookCloses, 1, 'backlink click closes the lightbox');
	assert.deepEqual(hookOpens, [{ path: '笔记/ref-a.md' }], 'and jumps through the openNote hook');
	blModal.onClose();

	// Fallback: no hook → the jump rides openLinkText.
	const fbModal = openModal(app, [FILES[0]!], 0, 'image');
	findByClass(contentOf(fbModal), 'dashboard-media-lightbox-backlink')[0]!.dispatchEvent({ type: 'click' });
	assert.deepEqual(openedLinks, ['笔记/ref-a.md'], 'without a hook the jump falls back to openLinkText');
	fbModal.onClose();

	// Videos get the same section; unreferenced files render none.
	assert.equal(findByClass(contentOf(openModal(app, [FILES[2]!], 0, 'video')), 'dashboard-media-lightbox-backlink').length, 1, 'video mode lists its referencing note too');
	assert.equal(findByClass(contentOf(openModal(app, [FILES[1]!], 0, 'image')), 'dashboard-media-lightbox-backlink').length, 0, 'unreferenced file renders no backlink rows');

	console.log('verify-lightbox: all assertions passed');
}

main();
