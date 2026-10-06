import { Notice, setIcon } from 'obsidian';
import { applyWidgetBackground, appendInlineBackgroundButton } from './widget-background';
import { t } from './i18n';
import { getMusicService, type MusicPlayerState } from './music-service';
import { fetchLyric, isPlayableByFee, searchMusic, type LyricLine } from './netease-client';
import type { MusicTrack } from './types';
import { applyModalTheme } from './modal-theme';

/**
 * Sidebar music player widget. Pure view: every mutation goes through
 * MusicService, whose subscribers drive refreshMusicWidget. The element refs
 * live in a WeakMap so a refresh only touches derived parts — the search box
 * keeps focus across the 250ms timeupdate repaints.
 *
 * Panels (search / playlist) are FLOATING: a body-level popover anchored
 * under the widget card, styled as an extension of it. Never an in-card row —
 * an immersive tile is a FIXED-height box with overflow hidden (a long list
 * past the cap is simply clipped), and in the side rails a growing list
 * stretches the whole rail. Floating, the list overlays neighbors and clamps
 * to the viewport instead.
 */

type PanelMode = 'none' | 'playlist' | 'search';

/** Live floating panel (body-level popover) + its follow/dismiss wiring. */
interface MusicPanel {
	root: HTMLElement;
	body: HTMLElement;
	raf: number;
	onKeydown: (e: KeyboardEvent) => void;
}

interface MusicWidgetRefs {
	host: HTMLElement;
	now: HTMLElement;
	lyric: HTMLElement;
	progress: HTMLElement;
	controls: HTMLElement;
	panel: MusicPanel | null;
	panelMode: PanelMode;
	searchBtn: HTMLElement;
	listBtn: HTMLElement;
	importInput: HTMLInputElement | null;
	importing: boolean;
	searchResults: MusicTrack[];
	searchSeq: number;
	lyricLines: LyricLine[];
	lyricTrackId: number | null;
	lastLyricIndex: number;
	els: {
		coverImg: HTMLImageElement;
		name: HTMLElement;
		artist: HTMLElement;
		fill: HTMLElement;
		pos: HTMLElement;
		dur: HTMLElement;
		playBtn: HTMLElement;
		modeBtn: HTMLElement;
	} | null;
	lastTrackKey: string;
	lastPct: number;
	lastControlKey: string;
	listSignature: string;
}

const refsMap = new WeakMap<HTMLElement, MusicWidgetRefs>();

export function renderSidebarMusicWidget(container: HTMLElement, bg?: import('./types').WidgetBackground, app?: import('obsidian').App, onBgChange?: (bg: import('./types').WidgetBackground | undefined) => void): void {
	const service = getMusicService();
	if (!service) return;

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-music' });
	if (app) applyWidgetBackground(widget, bg, app);

	// Typing in the search/import boxes must not drag the widget (the whole
	// widget is a drag handle; expense-widget has the same guard).
	widget.addEventListener('dragstart', (e) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest('input')) e.preventDefault();
	});

	const refs: MusicWidgetRefs = {
		host: widget,
		now: widget.createDiv({ cls: 'dashboard-sidebar-music-now' }),
		lyric: widget.createDiv({ cls: 'dashboard-sidebar-music-lyric' }),
		progress: widget.createDiv({ cls: 'dashboard-sidebar-music-progress' }),
		controls: widget.createDiv({ cls: 'dashboard-sidebar-music-controls' }),
		panel: null,
		panelMode: 'none',
		searchBtn: widget.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' }),
		listBtn: widget.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' }),
		importInput: null,
		importing: false,
		searchResults: [],
		searchSeq: 0,
		lyricLines: [],
		lyricTrackId: null,
		lastLyricIndex: -1,
		els: null,
		lastTrackKey: '\u0000',
		lastPct: -1,
		lastControlKey: '\u0000',
		listSignature: '',
	};
	refsMap.set(widget, refs);
	// Skeleton areas were appended before the header existed; move the header
	// to the top (it stays static after this point).
	const header = buildHeader(widget, refs);
	widget.prepend(header);
	// Background gear rides inside the header's right-hand icon cluster
	// (search/playlist), not as a corner button that would overlap them.
	if (app && onBgChange) appendInlineBackgroundButton(header, app, bg, onBgChange);

	// ---- now playing ----
	const cover = refs.now.createDiv({ cls: 'dashboard-sidebar-music-cover' });
	const coverImg = cover.createEl('img', {
		cls: 'dashboard-sidebar-music-cover-img',
		attr: { loading: 'lazy' },
	});
	coverImg.addEventListener('error', () => { coverImg.hidden = true; });
	const coverGlyph = cover.createDiv({ cls: 'dashboard-sidebar-music-cover-glyph' });
	setIcon(coverGlyph, 'music');
	const info = refs.now.createDiv({ cls: 'dashboard-sidebar-music-info' });
	const nameEl = info.createDiv({ cls: 'dashboard-sidebar-music-name' });
	const artistEl = info.createDiv({ cls: 'dashboard-sidebar-music-artist' });

	// ---- progress ----
	const posEl = refs.progress.createDiv({ cls: 'dashboard-sidebar-music-time' });
	const bar = refs.progress.createDiv({ cls: 'dashboard-progress dashboard-sidebar-music-bar' });
	const trackEl = bar.createDiv({ cls: 'dashboard-progress-bar' });
	const fillEl = trackEl.createDiv({ cls: 'dashboard-progress-fill' });
	const durEl = refs.progress.createDiv({ cls: 'dashboard-sidebar-music-time' });
	bar.addEventListener('click', (e) => {
		e.stopPropagation();
		const svc = getMusicService();
		if (!svc) return;
		const rect = bar.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		svc.seek(ratio * (svc.getState().durationSec || 0));
	});

	// ---- controls ----
	const prevBtn = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	prevBtn.setAttribute('aria-label', t('music.prev'));
	setIcon(prevBtn, 'skip-back');
	prevBtn.addEventListener('click', (e) => { e.stopPropagation(); getMusicService()?.prev(); });

	const playBtn = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-icon-btn dashboard-sidebar-music-play' });
	playBtn.addEventListener('click', (e) => { e.stopPropagation(); getMusicService()?.togglePlay(); });

	const nextBtn = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	nextBtn.setAttribute('aria-label', t('music.next'));
	setIcon(nextBtn, 'skip-forward');
	nextBtn.addEventListener('click', (e) => { e.stopPropagation(); getMusicService()?.next(false); });

	refs.controls.createDiv({ cls: 'dashboard-sidebar-music-top-spacer' });

	const modeBtn = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	modeBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const svc = getMusicService();
		if (!svc) return;
		const modes: ('list' | 'one' | 'shuffle')[] = ['list', 'one', 'shuffle'];
		svc.setMode(modes[(modes.indexOf(svc.getState().mode) + 1) % modes.length] ?? 'list');
	});

	const volBtn = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	volBtn.setAttribute('aria-label', t('music.volume'));
	setIcon(volBtn, 'volume-2');
	const volArea = refs.controls.createDiv({ cls: 'dashboard-sidebar-music-vol-area' });
	let volRange: HTMLInputElement | null = null;
	volBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (volRange) { volRange.remove(); volRange = null; return; }
		const svc = getMusicService();
		volRange = volArea.createEl('input', {
			attr: { type: 'range', min: '0', max: '100', value: String(Math.round((svc?.getState().volume ?? 0.8) * 100)) },
		});
		volRange.addEventListener('input', () => {
			svc?.setVolume((Number(volRange?.value) || 0) / 100);
		});
	});

	refs.els = { coverImg, name: nameEl, artist: artistEl, fill: fillEl, pos: posEl, dur: durEl, playBtn, modeBtn };
	renderPanel(refs);
	refreshMusicWidget(container);
}

function buildHeader(widget: HTMLElement, refs: MusicWidgetRefs): HTMLElement {
	const top = widget.createDiv({ cls: 'dashboard-sidebar-music-top' });
	const iconWrap = top.createDiv({ cls: 'dashboard-sidebar-music-title-icon' });
	setIcon(iconWrap, 'music');
	// The rolling lyric line occupies the title slot (right of the note icon);
	// there is no static "Music" label — the header stays quiet when idle.
	top.appendChild(refs.lyric);

	const searchBtn = refs.searchBtn;
	searchBtn.setAttribute('aria-label', t('music.search'));
	setIcon(searchBtn, 'search');
	searchBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		togglePanel(refs, 'search');
	});

	const listBtn = refs.listBtn;
	listBtn.setAttribute('aria-label', t('music.playlist'));
	setIcon(listBtn, 'list');
	listBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		togglePanel(refs, 'playlist');
	});
	top.appendChild(searchBtn);
	top.appendChild(listBtn);
	return top;
}

/** Refresh the derived parts of an existing widget (timeupdate, transport
 *  state, playlist). Never rebuilds inputs the user may be typing into. */
export function refreshMusicWidget(root: HTMLElement): void {
	const widget = root.querySelector<HTMLElement>('.dashboard-sidebar-music');
	if (!widget || !widget.isConnected) return;
	const refs = refsMap.get(widget);
	const service = getMusicService();
	if (!refs || !service) return;
	const state = service.getState();
	updateNowPlaying(refs, state);
	updateProgress(refs, state);
	updateControls(refs, state);
	updateLyric(refs, state);
	if (refs.panelMode === 'playlist') renderPlaylistRows(refs, state);
	else if (refs.panelMode === 'search') renderSearchRows(refs, state);
}

function togglePanel(refs: MusicWidgetRefs, mode: PanelMode): void {
	refs.panelMode = refs.panelMode === mode ? 'none' : mode;
	renderPanel(refs);
}

function renderPanel(refs: MusicWidgetRefs): void {
	closePanel(refs);
	if (refs.panelMode === 'playlist') {
		openPanel(refs);
		renderPlaylistRows(refs, getMusicService()?.getState() ?? null);
	} else if (refs.panelMode === 'search') {
		openPanel(refs);
		renderSearchPanel(refs);
	}
	syncPanelButtons(refs);
}

/** Reflect the open panel on the header buttons (active chip on the toggle). */
function syncPanelButtons(refs: MusicWidgetRefs): void {
	refs.searchBtn?.toggleClass('dashboard-sidebar-music-icon-btn--active', refs.panelMode === 'search');
	refs.listBtn?.toggleClass('dashboard-sidebar-music-icon-btn--active', refs.panelMode === 'playlist');
}

// ===== Floating panel shell =====

/** Seam between the card and its floating extension (px). */
const PANEL_SEAM_PX = 6;
/** Comfortable panel cap; the viewport clamp can only shrink it (px). */
const PANEL_MAX_PX = 440;
/** Below-space under which the panel flips above the card (px). */
const PANEL_FLIP_BELOW_PX = 140;
/** Smallest usable panel (input + import row + a peek of results). The
 *  clamp may shrink to this even below it — staying on screen beats a
 *  comfortable height. */
const PANEL_MIN_PX = 64;

/** Mount the floating panel under the card and start following it. The
 *  popover lives on <body> (no ancestor overflow can clip it), mirrors the
 *  active dashboard's --db-* tokens (it sits outside .apex-dashboard-root,
 *  where the theme vars don't cascade), and re-anchors every frame so page
 *  scroll, tile refits or drags keep it glued to the card. Closes itself
 *  when the card leaves the DOM (a re-render replaced it).
 *
 *  Dismissal is PANEL-style, not popover-style: the toggle button, Escape,
 *  the host leaving the DOM, or switching to the other panel. Clicking
 *  elsewhere deliberately does NOT close — the dashboard is a busy surface
 *  and the old in-card panel never vanished on outside clicks either; a
 *  stray click mid-search (or on the board) eating the results read as
 *  "search returns nothing". */
function openPanel(refs: MusicWidgetRefs): void {
	const root = activeDocument.body.createDiv({ cls: 'dashboard-sidebar-music-popover' });
	applyModalTheme(root);
	const body = root.createDiv({ cls: 'dashboard-sidebar-music-popover-body' });

	const position = (): boolean => {
		const panel = refs.panel;
		if (!panel) return false;
		if (!refs.host.isConnected) return false; // host swapped out → caller closes
		const view = activeDocument.defaultView;
		if (!view) return true; // no window (mini-dom): keep content, skip geometry
		const rect = refs.host.getBoundingClientRect();
		const vw = view.innerWidth;
		const vh = view.innerHeight;
		if (!vw || !vh) return true; // no layout engine (mini-dom): keep content, skip geometry
		const width = `${Math.round(rect.width)}px`;
		const left = `${Math.max(8, Math.min(rect.left, vw - rect.width - 8))}px`;
		const below = vh - rect.bottom - PANEL_SEAM_PX - 8;
		const above = rect.top - PANEL_SEAM_PX - 8;
		// Prefer hanging BELOW (the "extension of the card" read); flip above
		// only when below is starved and above clearly offers more room. The
		// height clamp follows the actual space (never the cozy floors) so the
		// panel cannot cross the viewport edge; the results list gives way
		// (flex shrink) before the input and import row do.
		const flip = below < PANEL_FLIP_BELOW_PX && above > below;
		const avail = Math.max(PANEL_MIN_PX, Math.min(PANEL_MAX_PX, flip ? above : below));
		const maxHeight = `${avail}px`;
		if (flip) {
			const bottom = `${Math.round(vh - rect.top + PANEL_SEAM_PX)}px`;
			setStyles(root, { width, left, maxHeight, bottom, top: '' });
		} else {
			const top = `${Math.round(rect.bottom + PANEL_SEAM_PX)}px`;
			setStyles(root, { width, left, maxHeight, top, bottom: '' });
		}
		return true;
	};

	const closeFromDoc = (): void => {
		refs.panelMode = 'none';
		closePanel(refs);
		syncPanelButtons(refs);
	};
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') closeFromDoc();
	};
	activeDocument.addEventListener('keydown', onKeydown, true);

	const panel: MusicPanel = { root, body, raf: 0, onKeydown };
	refs.panel = panel;

	// Per-frame anchor follow. The inTick guard breaks synchronous-rAF test
	// stubs (a stub that invokes the callback immediately would otherwise
	// recurse forever); real browsers schedule asynchronously.
	let inTick = false;
	const tick = (): void => {
		if (inTick) return;
		if (refs.panel !== panel) return;
		inTick = true;
		try {
			if (!position()) {
				closeFromDoc();
				return;
			}
			panel.raf = window.requestAnimationFrame(tick);
		} finally {
			inTick = false;
		}
	};
	tick();
}

function closePanel(refs: MusicWidgetRefs): void {
	const panel = refs.panel;
	if (!panel) return;
	refs.panel = null;
	window.cancelAnimationFrame?.(panel.raf);
	activeDocument.removeEventListener('keydown', panel.onKeydown, true);
	panel.root.remove();
}

/** Compare-before-write styles (observers see same-value writes). */
function setStyles(el: HTMLElement, styles: Record<string, string>): void {
	for (const [prop, value] of Object.entries(styles)) {
		if (el.style.getPropertyValue(kebab(prop)) !== value) el.style.setProperty(kebab(prop), value);
	}
}

function kebab(prop: string): string {
	return prop.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`);
}

// ===== Playlist panel =====

function renderPlaylistRows(refs: MusicWidgetRefs, state: MusicPlayerState | null): void {
	if (refs.panelMode !== 'playlist' || !state) return;
	const service = getMusicService();
	const host = refs.panel?.body;
	if (!service || !host) return;
	const sig = `${service.account.loggedIn}|${state.currentIndex}|${state.playlist.map(tr => tr.id).join(',')}`;
	if (sig === refs.listSignature) return;
	refs.listSignature = sig;
	host.empty();
	if (state.playlist.length === 0) {
		host.createDiv({ cls: 'dashboard-sidebar-music-empty', text: t('music.emptyPlaylist') });
	}
	state.playlist.forEach((track, i) => {
		const row = host.createDiv({
			cls: 'dashboard-sidebar-music-row' + (i === state.currentIndex ? ' dashboard-sidebar-music-row--active' : '')
				+ (isPlayableByFee(track.fee, service.account.loggedIn) ? '' : ' dashboard-sidebar-music-row--vip'),
		});
		if (i === state.currentIndex) {
			const dot = row.createDiv({ cls: 'dashboard-sidebar-music-row-play' });
			setIcon(dot, state.status === 'playing' ? 'volume-2' : 'pause');
		}
		const label = row.createDiv({ cls: 'dashboard-sidebar-music-row-label' });
		label.createDiv({ cls: 'dashboard-sidebar-music-row-name', text: track.name });
		label.createDiv({ cls: 'dashboard-sidebar-music-row-sub', text: track.artist });
		if (!isPlayableByFee(track.fee)) {
			row.createDiv({ cls: 'dashboard-sidebar-music-vip-badge', text: 'VIP' });
		}
		const delBtn = row.createDiv({ cls: 'dashboard-sidebar-music-row-del' });
		setIcon(delBtn, 'x');
		delBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			service.removeFromPlaylist(i);
		});
		row.addEventListener('click', () => service.play(i));
	});
	const footRow = host.createDiv({ cls: 'dashboard-sidebar-music-panel-foot' });
	const clearBtn = footRow.createDiv({ cls: 'dashboard-sidebar-music-text-btn', text: t('music.clear') });
	clearBtn.addEventListener('click', (e) => { e.stopPropagation(); service.clearPlaylist(); });
}

// ===== Search panel =====

function renderSearchPanel(refs: MusicWidgetRefs): void {
	const host = refs.panel?.body;
	if (!host) return;
	const input = host.createEl('input', {
		cls: 'dashboard-sidebar-music-search-input',
		attr: { type: 'text', placeholder: t('music.searchPlaceholder') },
	});
	let debounce: number | null = null;
	const searchNow = (): void => {
		if (debounce !== null) window.clearTimeout(debounce);
		debounce = null;
		void runSearch(refs, input.value);
	};
	input.addEventListener('input', () => {
		if (debounce !== null) window.clearTimeout(debounce);
		debounce = window.setTimeout(searchNow, 400);
	});
	// Enter submits immediately — an explicit "run it now" affordance next to
	// the passive 400ms debounce (IME composition Enter is not a submit).
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			searchNow();
		}
	});
	host.createDiv({ cls: 'dashboard-sidebar-music-results' });

	const importRow = host.createDiv({ cls: 'dashboard-sidebar-music-import-row' });
	const importInput = importRow.createEl('input', {
		cls: 'dashboard-sidebar-music-import-input',
		attr: { type: 'text', placeholder: t('music.importPlaceholder') },
	});
	refs.importInput = importInput;
	const importBtn = importRow.createDiv({ cls: 'dashboard-sidebar-music-text-btn', text: t('music.import') });
	importBtn.addEventListener('click', () => { void runImport(refs); });

	renderSearchRows(refs, getMusicService()?.getState() ?? null);
	input.focus();
}

async function runSearch(refs: MusicWidgetRefs, query: string): Promise<void> {
	const seq = ++refs.searchSeq;
	const kw = query.trim();
	if (!kw) {
		refs.searchResults = [];
		renderSearchRows(refs, getMusicService()?.getState() ?? null);
		return;
	}
	try {
		const tracks = await searchMusic(kw);
		if (seq !== refs.searchSeq) return; // a newer query already won
		refs.searchResults = tracks;
		renderSearchRows(refs, getMusicService()?.getState() ?? null);
	} catch {
		if (seq !== refs.searchSeq) return;
		new Notice(t('music.networkError'));
	}
}

function renderSearchRows(refs: MusicWidgetRefs, state: MusicPlayerState | null): void {
	if (refs.panelMode !== 'search') return;
	const results = refs.panel?.body.querySelector<HTMLElement>('.dashboard-sidebar-music-results');
	if (!results) return;
	results.empty();
	const playingId = state?.playlist[state.currentIndex]?.id ?? -1;
	for (const track of refs.searchResults.slice(0, 30)) {
		const row = results.createDiv({ cls: 'dashboard-sidebar-music-row' });
		const label = row.createDiv({ cls: 'dashboard-sidebar-music-row-label' });
		label.createDiv({ cls: 'dashboard-sidebar-music-row-name', text: track.name });
		label.createDiv({ cls: 'dashboard-sidebar-music-row-sub', text: track.artist });
		if (!isPlayableByFee(track.fee)) {
			row.createDiv({ cls: 'dashboard-sidebar-music-vip-badge', text: 'VIP' });
		}
		const addBtn = row.createDiv({ cls: 'dashboard-sidebar-music-row-del' });
		setIcon(addBtn, track.id === playingId ? 'check' : 'plus');
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			getMusicService()?.addToPlaylist([track]);
			new Notice(t('music.added'));
		});
		row.addEventListener('click', () => getMusicService()?.addAndPlay([track]));
	}
}

async function runImport(refs: MusicWidgetRefs): Promise<void> {
	const service = getMusicService();
	const input = refs.importInput;
	if (!service || !input || refs.importing) return;
	const raw = input.value.trim();
	if (!raw) return;
	refs.importing = true;
	try {
		const added = await service.importPlaylist(raw);
		new Notice(t('music.importSuccess', { count: added }));
		input.value = '';
	} catch (error) {
		new Notice(t('music.importFailed', { message: error instanceof Error ? error.message : String(error) }));
	} finally {
		refs.importing = false;
	}
}

// ===== Now playing / progress / controls / lyric =====

function updateNowPlaying(refs: MusicWidgetRefs, state: MusicPlayerState): void {
	const els = refs.els;
	if (!els) return;
	const track = state.current;
	const key = track ? `${track.id}|${track.picUrl ?? ''}` : 'none';
	if (key === refs.lastTrackKey) return;
	refs.lastTrackKey = key;
	els.coverImg.hidden = !track?.picUrl;
	if (track?.picUrl) els.coverImg.src = track.picUrl;
	els.name.setText(track ? track.name : t('music.noTrack'));
	els.artist.setText(track ? track.artist : t('music.emptyHint'));
}

function updateProgress(refs: MusicWidgetRefs, state: MusicPlayerState): void {
	const els = refs.els;
	if (!els) return;
	const dur = state.durationSec > 0 ? state.durationSec : 0;
	const pos = Math.min(state.positionSec, dur);
	const pct = dur > 0 ? (pos / dur) * 100 : 0;
	if (Math.abs(pct - refs.lastPct) < 0.05) return;
	refs.lastPct = pct;
	els.fill.setAttribute('style', `width: ${pct.toFixed(2)}%`);
	els.pos.setText(formatTime(pos));
	els.dur.setText(dur > 0 ? formatTime(dur) : '--:--');
}

function updateControls(refs: MusicWidgetRefs, state: MusicPlayerState): void {
	const els = refs.els;
	if (!els) return;
	const playing = state.status === 'playing';
	const key = `${state.status}|${state.mode}`;
	if (key === refs.lastControlKey) return;
	refs.lastControlKey = key;
	els.playBtn.empty();
	setIcon(els.playBtn, playing ? 'pause' : 'play');
	els.playBtn.setAttribute('aria-label', playing ? t('music.pause') : t('music.play'));
	els.modeBtn.empty();
	setIcon(els.modeBtn, state.mode === 'one' ? 'repeat-1' : state.mode === 'shuffle' ? 'shuffle' : 'repeat');
	els.modeBtn.setAttribute('aria-label',
		state.mode === 'one' ? t('music.modeOne') : state.mode === 'shuffle' ? t('music.modeShuffle') : t('music.modeList'));
}

function updateLyric(refs: MusicWidgetRefs, state: MusicPlayerState): void {
	const trackId = state.current?.id ?? null;
	if (trackId !== refs.lyricTrackId) {
		refs.lyricTrackId = trackId;
		refs.lyricLines = [];
		refs.lastLyricIndex = -1;
		refs.lyric.empty();
		if (trackId !== null) {
			const wanted = trackId;
			void fetchLyric(wanted).then(lines => {
				if (refs.lyricTrackId === wanted) refs.lyricLines = lines;
			}).catch(() => { /* lyrics are cosmetic */ });
		}
	}
	if (refs.lyricLines.length === 0) return;
	const ms = state.positionSec * 1000;
	let idx = -1;
	for (let i = 0; i < refs.lyricLines.length; i++) {
		const line = refs.lyricLines[i];
		if (line && line.timeMs <= ms) idx = i;
		else break;
	}
	if (idx === refs.lastLyricIndex) return;
	refs.lastLyricIndex = idx;
	refs.lyric.setText(idx >= 0 ? refs.lyricLines[idx]?.text ?? '' : '');
}

function formatTime(sec: number): string {
	const s = Math.max(0, Math.floor(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
