import { strict as assert } from 'node:assert';
import { NeteaseAccount } from '../src/netease-account';
import { fetchSongUrl } from '../src/netease-client';
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
	process.stdout.write('verify-music-account: login, cancellation, cleanup and account-isolated playback OK\n');
}
void run().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
