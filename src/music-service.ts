import { Notice } from 'obsidian';
// createEl is an ambient global declared by the Obsidian typings, not a
// module export — it creates a detached element, exactly what the player needs.
import type DashboardPlugin from './main';
import type { MusicRepeatMode, MusicTrack } from './types';
import { t } from './i18n';
import {
	backfillCovers,
	extractPlaylistId,
	fetchPlaylist,
	fetchSongUrl,
	isPlayableByFee,
} from './netease-client';

/** Stop auto-skipping after this many consecutive failures to start audio —
    an all-VIP playlist or a dead network must not become an infinite loop. */
const MAX_PLAY_ATTEMPTS = 5;

// ===== Module-level singleton (habit-service pattern) =====
// The sidebar widget, the floating mini bar and the settings tab all reach the
// player through here; the plugin registers the live service at onload and
// clears it at unload. Playback must survive closing the dashboard view, which
// is why the service (and its detached <audio>) is plugin-level, not view-level.

let activeService: MusicService | null = null;

export function registerMusicService(service: MusicService | null): void {
	activeService = service;
}

export function getMusicService(): MusicService | null {
	return activeService;
}

export type MusicStatus = 'idle' | 'loading' | 'playing' | 'paused';

/** Immutable snapshot handed to UI subscribers (widget + mini bar). */
export interface MusicPlayerState {
	status: MusicStatus;
	current: MusicTrack | null;
	currentIndex: number;
	playlist: MusicTrack[];
	volume: number;
	mode: MusicRepeatMode;
	positionSec: number;
	durationSec: number;
}

/** Pure next-track selection, exported for unit tests. `userInitiated` marks a
    manual next/prev click: in 'one' mode only the user can leave the track. */
export function pickNextIndex(
	length: number,
	index: number,
	mode: MusicRepeatMode,
	userInitiated: boolean,
): number {
	if (length <= 0) return -1;
	if (mode === 'one' && !userInitiated) return index;
	if (mode === 'shuffle') {
		if (length === 1) return 0;
		let n = index;
		while (n === index) n = Math.floor(Math.random() * length);
		return n;
	}
	return (index + 1) % length;
}

/** Keep only well-formed tracks so a hand-edited or half-synced data.json
    degrades to partial data instead of breaking the player. */
export function sanitizePlaylist(raw: unknown): MusicTrack[] {
	if (!Array.isArray(raw)) return [];
	const out: MusicTrack[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const track = item as Partial<MusicTrack>;
		if (typeof track.id !== 'number' || typeof track.name !== 'string') continue;
		out.push({
			id: track.id,
			name: track.name,
			artist: typeof track.artist === 'string' ? track.artist : '',
			album: typeof track.album === 'string' ? track.album : '',
			durationMs: typeof track.durationMs === 'number' ? track.durationMs : 0,
			fee: typeof track.fee === 'number' ? track.fee : 0,
			picUrl: typeof track.picUrl === 'string' && track.picUrl ? track.picUrl : undefined,
		});
	}
	return out;
}

/**
 * NetEase music player. Owns a detached HTMLAudioElement (created via the
 * global createEl helper and never attached to any DOM subtree) so playback
 * survives widget-area rebuilds; persists playlist/index/volume/mode through
 * the plugin settings with a debounced write.
 */
export class MusicService {
	/** Detached; lives in the service, not the widget DOM. */
	private audio: HTMLAudioElement;
	private playlist: MusicTrack[] = [];
	private index = -1;
	private status: MusicStatus = 'idle';
	private volume = 0.8;
	private mode: MusicRepeatMode = 'list';
	private loaded = false;
	private listeners = new Set<() => void>();
	/** Consecutive failures to produce audible playback (VIP skip, CDN error,
	    network fail). Reset by the 'playing' event. */
	private playAttempts = 0;
	private lastTimeNotify = 0;
	private persistTimer: number | null = null;

	constructor(private plugin: DashboardPlugin) {
		this.audio = createEl('audio');
		this.audio.preload = 'auto';
		this.audio.addEventListener('playing', () => {
			this.status = 'playing';
			this.playAttempts = 0;
			this.notify();
		});
		// Natural end also fires 'pause' before 'ended'; the status guard keeps
		// the transient blip out of the UI while advance() takes over.
		this.audio.addEventListener('pause', () => {
			if (this.status === 'playing') {
				this.status = 'paused';
				this.notify();
			}
		});
		this.audio.addEventListener('ended', () => this.advance(true));
		this.audio.addEventListener('error', () => {
			// Clearing the src (stop/remove) fires an error on an empty element;
			// that is shutdown, not a playback failure.
			if (!this.audio.getAttribute('src')) return;
			new Notice(t('music.networkError'));
			this.advanceAfterFailure();
		});
		this.audio.addEventListener('timeupdate', () => {
			const now = Date.now();
			if (now - this.lastTimeNotify < 250) return;
			this.lastTimeNotify = now;
			this.notify();
		});
		this.audio.addEventListener('loadedmetadata', () => this.notify());
	}

	/** Restore persisted state. Never starts playback — self-starting network
	    audio after a restart is a bad citizen. */
	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		const s = this.plugin.settings;
		this.playlist = sanitizePlaylist(s.musicPlaylist);
		this.index = typeof s.musicCurrentIndex === 'number' && s.musicCurrentIndex >= 0
			&& s.musicCurrentIndex < this.playlist.length ? s.musicCurrentIndex : -1;
		this.volume = typeof s.musicVolume === 'number' ? Math.min(1, Math.max(0, s.musicVolume)) : 0.8;
		this.mode = s.musicRepeatMode ?? 'list';
		this.audio.volume = this.volume;
	}

	// ===== Subscriptions =====

	/** Register a state-changed listener; returns its unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	getState(): MusicPlayerState {
		return {
			status: this.status,
			current: this.playlist[this.index] ?? null,
			currentIndex: this.index,
			playlist: this.playlist,
			volume: this.volume,
			mode: this.mode,
			positionSec: this.audio.currentTime || 0,
			durationSec: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
		};
	}

	// ===== Transport =====

	/** Play playlist[index]; skips with a notice when the track needs an
	    account the widget deliberately does not have. */
	play(index: number): void {
		const track = this.playlist[index];
		if (!track) return;
		if (!isPlayableByFee(track.fee)) {
			new Notice(t('music.vipSkipped', { name: track.name }));
			return;
		}
		this.playAttempts = 0;
		void this.startPlay(index);
	}

	/** Resume if paused/idle, pause if playing. */
	togglePlay(): void {
		if (this.status === 'playing') {
			this.audio.pause();
			return;
		}
		if (this.audio.getAttribute('src') && this.status === 'paused') {
			void this.audio.play();
			return;
		}
		// Idle with a restored (but never auto-played) track: resume it.
		if (this.playlist.length > 0) {
			const target = this.index >= 0 ? this.index : 0;
			this.play(target);
		}
	}

	pause(): void {
		this.audio.pause();
	}

	/** Auto=true when playback ended by itself; mode 'one' only loops then. */
	next(auto = false): void {
		this.advance(auto);
	}

	prev(): void {
		if (this.audio.currentTime > 3 && this.status === 'playing') {
			this.audio.currentTime = 0;
			return;
		}
		// Step back one slot, wrapping (shuffle ignores history in v1).
		const target = (this.index - 1 + this.playlist.length) % this.playlist.length;
		this.play(target);
	}

	seek(sec: number): void {
		const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
		const target = duration > 0 ? Math.min(duration - 0.1, Math.max(0, sec)) : Math.max(0, sec);
		this.audio.currentTime = target;
		this.notify();
	}

	setVolume(v: number): void {
		this.volume = Math.min(1, Math.max(0, v));
		this.audio.volume = this.volume;
		this.persist();
		this.notify();
	}

	setMode(mode: MusicRepeatMode): void {
		this.mode = mode;
		this.persist();
		this.notify();
	}

	// ===== Playlist =====

	/** Append tracks (dedup by id); returns the number actually added. */
	addToPlaylist(tracks: MusicTrack[]): number {
		const existing = new Set(this.playlist.map(track => track.id));
		const fresh = tracks.filter(track => !existing.has(track.id));
		if (fresh.length === 0) return 0;
		this.playlist = [...this.playlist, ...fresh];
		if (this.index < 0) this.index = 0;
		this.persist();
		this.notify();
		// Fire-and-forget: covers fill in later and trigger their own persist.
		void backfillCovers(this.playlist).then(withCovers => {
			if (withCovers !== this.playlist) {
				this.playlist = withCovers;
				this.persist();
				this.notify();
			}
		}).catch(() => { /* covers are cosmetic; missing them is not an error */ });
		return fresh.length;
	}

	/** Play the first newly added track (search result click = add & play). */
	addAndPlay(tracks: MusicTrack[]): void {
		const existing = new Set(this.playlist.map(track => track.id));
		const first = tracks.find(track => !existing.has(track.id));
		const added = this.addToPlaylist(tracks);
		if (first && added > 0) {
			const target = this.playlist.findIndex(track => track.id === first.id);
			if (target >= 0) this.play(target);
		} else if (added === 0 && this.playlist.length > 0) {
			// Already in the playlist: just play the existing copy.
			const existingIndex = this.playlist.findIndex(track => track.id === tracks[0]?.id);
			if (existingIndex >= 0) this.play(existingIndex);
		}
	}

	removeFromPlaylist(index: number): void {
		if (index < 0 || index >= this.playlist.length) return;
		const wasCurrent = index === this.index;
		this.playlist = this.playlist.filter((_track, i) => i !== index);
		if (wasCurrent) {
			this.stopPlayback();
			if (index >= this.playlist.length) this.index = this.playlist.length - 1;
			else this.index = index; // the next track slides into the slot
			this.persist();
		} else if (index < this.index) {
			this.index -= 1;
			this.persist();
		}
		this.notify();
	}

	clearPlaylist(): void {
		this.stopPlayback();
		this.playlist = [];
		this.index = -1;
		this.persist();
		this.notify();
	}

	/** Import a NetEase playlist from a pasted link/id; returns added count.
	    Throws on an unrecognized link or an unreachable playlist. */
	async importPlaylist(input: string): Promise<number> {
		const id = extractPlaylistId(input);
		if (!id) throw new Error(t('music.badPlaylistLink'));
		const imported = await fetchPlaylist(id);
		if (imported.tracks.length === 0) throw new Error(t('music.importEmpty'));
		const existing = new Set(this.playlist.map(track => track.id));
		const fresh = imported.tracks.filter(track => !existing.has(track.id));
		if (fresh.length > 0) {
			this.playlist = [...this.playlist, ...fresh];
			if (this.index < 0) this.index = 0;
			this.persist();
			this.notify();
		}
		// Covers are cosmetic and batched; a failure here must not fail the import.
		try {
			const withCovers = await backfillCovers(this.playlist);
			if (withCovers !== this.playlist) {
				this.playlist = withCovers;
				this.persist();
				this.notify();
			}
		} catch { /* keep the imported playlist without covers */ }
		return fresh.length;
	}

	// ===== Internals =====

	private async startPlay(index: number): Promise<void> {
		const track = this.playlist[index];
		if (!track) return;
		this.index = index;
		this.status = 'loading';
		this.notify();
		this.persist();
		try {
			const info = await fetchSongUrl(track.id);
			if (!info.url) {
				// fee lied (region/DMCA): same treatment as a VIP skip.
				new Notice(t('music.vipSkipped', { name: track.name }));
				this.advanceAfterFailure();
				return;
			}
			this.audio.src = info.url;
			this.audio.currentTime = 0;
			await this.audio.play();
			// 'playing' listener sets status and resets playAttempts.
		} catch {
			new Notice(t('music.networkError'));
			this.advanceAfterFailure();
		}
	}

	private advance(auto: boolean): void {
		if (this.playlist.length === 0) {
			this.status = 'idle';
			this.notify();
			return;
		}
		const nextIndex = pickNextIndex(this.playlist.length, this.index, this.mode, !auto);
		if (nextIndex < 0) return;
		void this.startPlay(nextIndex);
	}

	/** Skip forward after a failed start; stop (with a notice) once too many
	    consecutive tracks failed to produce sound. */
	private advanceAfterFailure(): void {
		this.playAttempts += 1;
		if (this.playlist.length === 0
			|| this.playAttempts >= MAX_PLAY_ATTEMPTS
			|| this.playAttempts >= this.playlist.length) {
			this.status = 'idle';
			this.notify();
			new Notice(t('music.stopAfterFailures'));
			return;
		}
		this.advance(true);
	}

	private stopPlayback(): void {
		this.audio.pause();
		this.audio.removeAttribute('src');
		this.audio.load();
		this.status = 'idle';
	}

	private persist(): void {
		if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
		this.persistTimer = window.setTimeout(() => { void this.persistNow(); }, 500);
	}

	/** Only the service-owned fields are written; the enabled toggles belong
	    to the settings tab and must not race a concurrent settings save. */
	private async persistNow(): Promise<void> {
		this.persistTimer = null;
		this.plugin.settings = {
			...this.plugin.settings,
			musicVolume: this.volume,
			musicRepeatMode: this.mode,
			musicPlaylist: this.playlist,
			musicCurrentIndex: this.index,
		};
		await this.plugin.saveSettings();
	}

	destroy(): void {
		if (this.persistTimer !== null) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.audio.pause();
		this.audio.removeAttribute('src');
		this.audio.load();
		this.listeners.clear();
	}
}
