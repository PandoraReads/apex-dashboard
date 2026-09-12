import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { getMusicService, type MusicPlayerState } from './music-service';
import { fetchLyric, isPlayableByFee, searchMusic, type LyricLine } from './netease-client';
import type { MusicTrack } from './types';

/**
 * Sidebar music player widget. Pure view: every mutation goes through
 * MusicService, whose subscribers drive refreshMusicWidget. The element refs
 * live in a WeakMap so a refresh only touches derived parts — the search box
 * keeps focus across the 250ms timeupdate repaints.
 */

type PanelMode = 'none' | 'playlist' | 'search';

interface MusicWidgetRefs {
	now: HTMLElement;
	lyric: HTMLElement;
	progress: HTMLElement;
	controls: HTMLElement;
	panel: HTMLElement;
	panelMode: PanelMode;
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

export function renderSidebarMusicWidget(container: HTMLElement): void {
	const service = getMusicService();
	if (!service) return;

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-music' });

	// Typing in the search/import boxes must not drag the widget (the whole
	// widget is a drag handle; expense-widget has the same guard).
	widget.addEventListener('dragstart', (e) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest('input')) e.preventDefault();
	});

	const refs: MusicWidgetRefs = {
		now: widget.createDiv({ cls: 'dashboard-sidebar-music-now' }),
		lyric: widget.createDiv({ cls: 'dashboard-sidebar-music-lyric' }),
		progress: widget.createDiv({ cls: 'dashboard-sidebar-music-progress' }),
		controls: widget.createDiv({ cls: 'dashboard-sidebar-music-controls' }),
		panel: widget.createDiv({ cls: 'dashboard-sidebar-music-panel' }),
		panelMode: 'none',
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
	widget.prepend(buildHeader(widget, refs));

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

	const searchBtn = top.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	searchBtn.setAttribute('aria-label', t('music.search'));
	setIcon(searchBtn, 'search');
	searchBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		togglePanel(refs, 'search');
	});

	const listBtn = top.createDiv({ cls: 'dashboard-sidebar-music-icon-btn' });
	listBtn.setAttribute('aria-label', t('music.playlist'));
	setIcon(listBtn, 'list');
	listBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		togglePanel(refs, 'playlist');
	});
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
	refs.panel.empty();
	if (refs.panelMode === 'playlist') renderPlaylistRows(refs, getMusicService()?.getState() ?? null);
	else if (refs.panelMode === 'search') renderSearchPanel(refs);
}

// ===== Playlist panel =====

function renderPlaylistRows(refs: MusicWidgetRefs, state: MusicPlayerState | null): void {
	if (refs.panelMode !== 'playlist' || !state) return;
	const service = getMusicService();
	if (!service) return;
	const sig = `${service.account.loggedIn}|${state.currentIndex}|${state.playlist.map(tr => tr.id).join(',')}`;
	if (sig === refs.listSignature) return;
	refs.listSignature = sig;
	refs.panel.empty();
	if (state.playlist.length === 0) {
		refs.panel.createDiv({ cls: 'dashboard-sidebar-music-empty', text: t('music.emptyPlaylist') });
	}
	state.playlist.forEach((track, i) => {
		const row = refs.panel.createDiv({
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
	const footRow = refs.panel.createDiv({ cls: 'dashboard-sidebar-music-panel-foot' });
	const clearBtn = footRow.createDiv({ cls: 'dashboard-sidebar-music-text-btn', text: t('music.clear') });
	clearBtn.addEventListener('click', (e) => { e.stopPropagation(); service.clearPlaylist(); });
}

// ===== Search panel =====

function renderSearchPanel(refs: MusicWidgetRefs): void {
	const input = refs.panel.createEl('input', {
		cls: 'dashboard-sidebar-music-search-input',
		attr: { type: 'text', placeholder: t('music.searchPlaceholder') },
	});
	let debounce: number | null = null;
	input.addEventListener('input', () => {
		if (debounce !== null) window.clearTimeout(debounce);
		debounce = window.setTimeout(() => { void runSearch(refs, input.value); }, 400);
	});
	refs.panel.createDiv({ cls: 'dashboard-sidebar-music-results' });

	const importRow = refs.panel.createDiv({ cls: 'dashboard-sidebar-music-import-row' });
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
	const results = refs.panel.querySelector<HTMLElement>('.dashboard-sidebar-music-results');
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
