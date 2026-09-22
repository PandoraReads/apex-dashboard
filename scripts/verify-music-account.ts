/**
 * Verifies the NetEase music account layer and the MusicService playback
 * failure policy:
 *
 * 1. Login/logout against the Electron cookie store, cancellation while a
 *    login window is open, and BUSY rejection of concurrent logins.
 * 2. fetchSongUrl account isolation: -110 (no entitlement) → url null,
 *    member cookie → full URL, stale cookie → null, envelope/entry 301/302 →
 *    AUTH_EXPIRED.
 * 3. MusicService startPlay: a member hitting an intermittent -110 recovers
 *    on the spaced retry (no notice); a persistent -110 exhausts the retries
 *    and announces WHICH track was skipped (the fee guard never fires when
 *    signed in, so this notice is the only per-track explanation) before
 *    advancing; a deterministic non--110 null keeps its single immediate
 *    retry and trips the circuit breaker when the whole playlist fails; an
 *    anonymous fee-1 click still short-circuits at the fee guard.
 *
 * Run: `npm run test:music-account`
 */
import { strict as assert } from 'node:assert';
import { Notice } from 'obsidian';
import { NeteaseAccount } from '../src/netease-account';
import { fetchSongUrl } from '../src/netease-client';
import { MusicService } from '../src/music-service';
import type { MusicTrack } from '../src/types';
import { resetNetwork, calls } from './music-network-stub';
import { setCookies, windows, flushes, setFailLoad } from './music-electron-stub';

// Electron renderer timers, without a running Obsidian application.
Object.assign(globalThis, { window: { setTimeout, clearTimeout } });
async function run(): Promise<void> {
	const account = new NeteaseAccount('test:music');
	await account.restore();
	assert.equal(account.loggedIn, false);
	assert.equal(await account.cookie(), '');
	setCookies([{ name: 'MUSIC_U', value: 'test-token' }]);
	resetNetwork([{ code: 200, profile: { userId: 123 } }]);
	await account.login();
	assert.equal(account.loggedIn, true);
	assert.equal(windows.at(-1)?.closed, true);
	assert.equal(calls[0]?.headers?.Cookie, 'MUSIC_U=test-token');
	assert.ok(flushes > 0);
	assert.deepEqual(windows.at(-1)?.options.webPreferences, {
		partition: 'test:music', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
	});
	await account.logout();
	assert.equal(account.loggedIn, false);
	assert.equal(await account.cookie(), '');
	const cancel = account.login();
	windows.at(-1)?.close();
	await assert.rejects(cancel, /CANCELLED/);
	const pending = account.login();
	await assert.rejects(account.login(), /BUSY/);
	account.destroy();
	await assert.rejects(pending, /CANCELLED/);
	await assert.rejects(account.login(), /BUSY/);
	setFailLoad(true);
	await assert.rejects(new NeteaseAccount('test:offline').login(), /LOAD_FAILED/);
	setFailLoad(false);

	resetNetwork([{ data: [{ code: -110, url: null }] },
		{ data: [{ code: 200, url: 'https://m.music.126.net/full.mp3' }] },
		{ data: [{ code: -110, url: null }] }, { code: 301 }]);
	assert.equal((await fetchSongUrl(987654)).url, null);
	assert.equal((await fetchSongUrl(987654, 'MUSIC_U=member')).url, 'https://m.music.126.net/full.mp3');
	assert.equal((await fetchSongUrl(987654, 'MUSIC_U=other')).url, null);
	assert.equal((await fetchSongUrl(987654)).url, null);
	await assert.rejects(fetchSongUrl(987654, 'MUSIC_U=expired'), /AUTH_EXPIRED/);
	assert.equal(calls.length, 4);
	assert.equal(calls[0]?.headers?.Cookie, undefined);
	assert.equal(calls[1]?.headers?.Cookie, 'MUSIC_U=member');
	assert.equal(calls[2]?.headers?.Cookie, 'MUSIC_U=other');

	// ---------- MusicService: -110 spaced retries + per-track skip notice ----------

	/** Minimal HTMLAudioElement stand-in: captures transport calls, stores
	 *  listeners, resolves play() while firing 'playing' synchronously. */
	class FakeAudio {
		preload = '';
		volume = 1;
		currentTime = 0;
		duration = 0;
		src: string | null = null;
		private readonly listeners = new Map<string, Array<() => void>>();
		addEventListener(type: string, listener: () => void): void {
			this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
		}
		removeEventListener(): void {}
		dispatch(type: string): void { for (const l of this.listeners.get(type) ?? []) l(); }
		pause(): void {}
		load(): void {}
		getAttribute(_name: string): string | null { return this.src; }
		removeAttribute(_name: string): void { this.src = null; }
		setAttribute(_name: string, _value: string): void {}
		async play(): Promise<void> { this.dispatch('playing'); }
	}
	const audios: FakeAudio[] = [];
	(globalThis as unknown as { createEl: (tag: string) => unknown }).createEl = (tag: string): unknown => {
		if (tag !== 'audio') throw new Error(`unexpected createEl('${tag}')`);
		const audio = new FakeAudio();
		audios.push(audio);
		return audio;
	};
	const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
	const messages = (): string[] => (Notice as unknown as { messages: string[] }).messages;
	const track = (id: number, name: string): MusicTrack =>
		({ id, name, artist: '', album: '', durationMs: 1000, fee: 1, picUrl: `https://p.music.126.net/${id}.jpg` });
	const makeService = (): MusicService => {
		const plugin = {
			app: { vault: { getName: () => 'unit-music' } },
			settings: {},
			saveSettings: async () => {},
		} as unknown as ConstructorParameters<typeof MusicService>[0];
		return new MusicService(plugin);
	};

	setCookies([{ name: 'MUSIC_U', value: 'member' }]);
	const svc = makeService();
	await svc.load();
	svc.addToPlaylist([track(1, 'flake'), track(2, 'next')]);
	const audio = audios.at(-1)!;

	// A member's entitled track hits an intermittent -110: the spaced retry
	// recovers it — no notice, playback continues.
	let seen = messages().length;
	resetNetwork([
		{ data: [{ code: -110, url: null }] },
		{ data: [{ code: 200, url: 'https://m.music.126.net/recovered.mp3' }] },
	]);
	svc.play(0);
	await sleep(900);
	assert.equal(svc.getState().status, 'playing', '-110 flake recovers via the spaced retry');
	assert.equal(audio.src, 'https://m.music.126.net/recovered.mp3', 'recovered URL reached the audio element');
	assert.equal(messages().length - seen, 0, 'no notice when a retry recovers');
	assert.equal(calls.length, 2, 'two URL fetches (initial + one retry)');
	assert.equal(calls[0]?.headers?.Cookie, 'MUSIC_U=member', 'member cookie sent');

	// Persistent -110: the retries exhaust, the skip names the track (the fee
	// guard never fires when signed in — this notice is the only per-track
	// explanation), and playback advances to the next track.
	seen = messages().length;
	resetNetwork([
		{ data: [{ code: -110, url: null }] },
		{ data: [{ code: -110, url: null }] },
		{ data: [{ code: -110, url: null }] },
		{ data: [{ code: 200, url: 'https://m.music.126.net/next.mp3' }] },
	]);
	svc.play(0);
	await sleep(1900);
	assert.equal(calls.length, 4, 'three attempts on the denied track + one on the next');
	const skipMsgs = messages().slice(seen);
	assert.equal(skipMsgs.length, 1, 'exactly one per-track notice');
	assert.ok(skipMsgs[0]!.includes('flake'), `notice names the skipped track: ${skipMsgs[0]}`);
	assert.equal(svc.getState().status, 'playing', 'advanced to the next track');
	assert.equal(svc.getState().current?.name, 'next', 'next track is current');

	// A deterministic non--110 null keeps the single immediate retry; when the
	// whole playlist fails that way the circuit breaker stops playback after
	// naming every track.
	seen = messages().length;
	resetNetwork([
		{ data: [{ code: 404, url: null }] }, { data: [{ code: 404, url: null }] },
		{ data: [{ code: 404, url: null }] }, { data: [{ code: 404, url: null }] },
	]);
	svc.clearPlaylist();
	svc.addToPlaylist([track(11, 'dead1'), track(12, 'dead2')]);
	svc.play(0);
	await sleep(150);
	assert.equal(calls.length, 4, 'two tracks x two attempts (immediate retry, no spacing)');
	const stopMsgs = messages().slice(seen);
	assert.equal(stopMsgs.filter(m => m.includes('dead1') || m.includes('dead2')).length, 2, 'both dead tracks named');
	assert.ok(stopMsgs.some(m => /已停止|Stopped/.test(m)), `circuit-breaker notice shown: ${stopMsgs.join(' | ')}`);
	assert.equal(svc.getState().status, 'idle', 'stopped after the whole playlist failed');
	assert.equal(audio.src, null, 'audio src cleared on stop');

	// Anonymous fee-1 click: the pre-flight fee guard still fires and the
	// server is never asked.
	setCookies([]);
	await svc.account.cookie();
	seen = messages().length;
	resetNetwork([]);
	svc.play(0);
	assert.ok(messages().slice(seen).some(m => m.includes('dead1')), 'anonymous fee-1 click keeps the vipSkipped notice');
	assert.equal(calls.length, 0, 'no network for a pre-flight skip');

	process.stdout.write('verify-music-account: login, cancellation, cleanup, account-isolated playback and -110 retry/skip notices OK\n');
}
void run().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
