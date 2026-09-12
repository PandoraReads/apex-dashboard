import { musicCookieHeader } from '../src/netease-account';
import { strict as assert } from 'node:assert';
import {
	extractPlaylistId,
	isPlayableByFee,
	mapSearchSong,
	mapSongUrl,
	mergePicUrls,
	parseLrc,
	toHttps,
	type NeteaseSong,
	type NeteaseSongUrlEntry,
} from '../src/netease-client';
import type { MusicTrack } from '../src/types';

let checked = 0;
function ok(cond: boolean, msg: string): void {
	assert.ok(cond, msg);
	checked++;
}

ok(isPlayableByFee(1, true), 'signed-in VIP tracks reach the entitlement API');
ok(isPlayableByFee(4, true), 'signed-in purchased tracks reach the entitlement API');
ok(!isPlayableByFee(1, false), 'anonymous VIP tracks remain gated');
ok(mapSongUrl({ url: 'https://m.music.126.net/a.mp3', code: 200, freeTrialInfo: { start: 0, end: 30 } }).url === null, 'trial clips must not count as full member playback');
ok(mapSongUrl({ url: 'https://m.music.126.net/a.mp3', code: 403 }).url === null, 'denied responses cannot play');

ok(musicCookieHeader([{ name: 'MUSIC_U', value: 'secret' }, { name: '__csrf', value: 'csrf' }, { name: 'other', value: 'private' }]) === 'MUSIC_U=secret; __csrf=csrf', 'only auth cookies are forwarded');
ok(musicCookieHeader([{ name: 'MUSIC_U', value: 'bad;injection' }]) === '', 'cookie separator injection rejected');
ok(musicCookieHeader([{ name: 'MUSIC_U', value: 'bad\r\nHeader' }]) === '', 'cookie header injection rejected');

// ---------- mapSearchSong: search/playlist/detail raw nodes -> MusicTrack ----------

const rawMultiArtist: NeteaseSong = {
	id: 509781655,
	name: '想你就写信 (Live)',
	duration: 238698,
	fee: 1,
	artists: [{ name: '周杰伦' }, { name: '李硕' }, { name: '张鑫' }],
	album: { name: '中国新歌声第二季 第13期' },
};
const multi = mapSearchSong(rawMultiArtist);
ok(multi !== null, 'mapSearchSong returns a track');
if (multi) {
	ok(multi.id === 509781655, 'id passes through');
	ok(multi.name === '想你就写信 (Live)', 'name passes through');
	ok(multi.artist === '周杰伦 / 李硕 / 张鑫', 'artists joined with " / "');
	ok(multi.album === '中国新歌声第二季 第13期', 'album name mapped');
	ok(multi.durationMs === 238698, 'duration in ms');
	ok(multi.fee === 1, 'fee passes through');
	ok(multi.picUrl === undefined, 'no picUrl in search node -> undefined');
}

const rawDetail: NeteaseSong = {
	id: 1,
	name: '晴天',
	duration: 269000,
	fee: 8,
	artists: [{ name: '周杰伦' }],
	album: { name: '叶惠美', picUrl: 'http://p3.music.126.net/cover.jpg' },
};
const detail = mapSearchSong(rawDetail);
ok(detail !== null && detail.picUrl === 'http://p3.music.126.net/cover.jpg', 'picUrl kept when present (later upgraded via toHttps at play time)');
ok(detail !== null && detail.fee === 8, 'fee=8 (free-with-login-free tier) passes through');

ok(mapSearchSong({ name: 'no id' }) === null, 'missing id -> null');
ok(mapSearchSong({ id: 5 }) === null, 'missing name -> null');
ok(mapSearchSong({ id: 5, name: 'x', artists: [{ name: '' }] })?.artist === '', 'blank artist names filtered, no dangling " / "');
ok(mapSearchSong({ id: 5, name: 'x', album: {} })?.album === '', 'missing album node -> empty album');

// ---------- mapSongUrl: enhance/player/url entry -> SongUrlInfo ----------

const rawOk: NeteaseSongUrlEntry = {
	url: 'http://m801.music.126.net/20260911/abc.mp3?vuutv=xyz',
	code: 200,
	br: 128000,
	size: 710445,
	type: 'mp3',
};
const mappedOk = mapSongUrl(rawOk);
ok(mappedOk.url === 'https://m801.music.126.net/20260911/abc.mp3?vuutv=xyz', 'http CDN url rewritten to https');
ok(mappedOk.code === 200 && mappedOk.br === 128000 && mappedOk.type === 'mp3', 'code/br/type pass through');

const rawVip: NeteaseSongUrlEntry = { url: null, code: -110, br: 0, size: 0 };
const mappedVip = mapSongUrl(rawVip);
ok(mappedVip.url === null, 'VIP song url stays null');
ok(mappedVip.code === -110, 'VIP code -110 preserved');
ok(!isPlayableByFee(1), 'fee=1 (VIP) is not playable');
ok(isPlayableByFee(0) && isPlayableByFee(8), 'fee 0 and 8 playable');
ok(!isPlayableByFee(2) && !isPlayableByFee(4) && !isPlayableByFee(undefined), 'album-purchase/unknown fees not playable');

const rawNoCode: NeteaseSongUrlEntry = { url: 'https://m701.music.126.net/x.mp3' };
ok(mapSongUrl(rawNoCode).code === 200, 'missing code with live url defaults to 200');
const rawNoUrlNoCode: NeteaseSongUrlEntry = { url: '' };
ok(mapSongUrl(rawNoUrlNoCode).url === null && mapSongUrl(rawNoUrlNoCode).code === -1, 'empty url -> null + code -1');

// ---------- parseLrc ----------

const LRC = [
	'[by:大锦鲤]',
	'[offset:500]',
	'[00:00.000] 作词 : 黄家驹',
	'[00:18.466]今天我 寒夜里看雪飘过',
	'[00:25.110]怀着冷却了的心窝漂远方',
	'',
	'[01:02.5][01:40.5]重复的一句歌词',
	'没有时间标签的行',
	'[01:30]两种精度混排',
	'[99:99.999]分钟越界也能解析为数字',
].join('\r\n');
const lines = parseLrc(LRC);
ok(lines.length === 7, 'metadata/blank/tagless lines dropped, multi-tag expanded');
ok(lines[0]?.text === '作词 : 黄家驹' && lines[0]?.timeMs === 0, 'first line mm:ss.xxx');
ok(lines[1]?.timeMs === 18466, 'fraction .466 = 466ms');
ok(lines[2]?.timeMs === 25110, 'fraction .110 = 110ms');
const repeated = lines.filter(l => l.text === '重复的一句歌词');
ok(repeated.length === 2 && repeated[0]?.timeMs === 62500 && repeated[1]?.timeMs === 100500, 'one line two tags -> two entries (62500/100500ms)');
const mixed = lines.filter(l => l.text === '两种精度混排');
ok(mixed[0]?.timeMs === 90000, 'mm:ss without fraction works');
ok(lines.every((l, i) => i === 0 || (lines[i - 1]?.timeMs ?? 0) <= l.timeMs), 'output sorted by time');
ok(parseLrc('').length === 0, 'empty body -> empty list');
ok(parseLrc('[00:01.0]\r\n[00:02.0]  \n仅空文本行').length === 0, 'lines with no text dropped');

// ---------- extractPlaylistId ----------

ok(extractPlaylistId('https://music.163.com/#/playlist?id=3778678') === '3778678', 'hash-form share link');
ok(extractPlaylistId('https://music.163.com/playlist?id=123456&userid=7') === '123456', 'query-form link, first id wins');
ok(extractPlaylistId('https://music.163.com/#/playlist/987654') === '987654', 'path-form link');
ok(extractPlaylistId('  3778678 ') === '3778678', 'bare id with whitespace');
ok(extractPlaylistId('https://music.163.com/#/song?id=1') === null, 'non-playlist link rejected');
ok(extractPlaylistId('hello') === null, 'garbage rejected');
ok(extractPlaylistId('') === null, 'empty rejected');

// ---------- toHttps ----------

ok(toHttps('http://m701.music.126.net/a.mp3') === 'https://m701.music.126.net/a.mp3', 'http upgraded');
ok(toHttps('https://m701.music.126.net/a.mp3') === 'https://m701.music.126.net/a.mp3', 'https untouched');
ok(toHttps('//m701.music.126.net/a.mp3') === '//m701.music.126.net/a.mp3', 'protocol-relative untouched');

// ---------- mergePicUrls (immutable cover backfill) ----------

const base: MusicTrack[] = [
	{ id: 1, name: 'A', artist: 'a', album: 'al', durationMs: 1000, fee: 0 },
	{ id: 2, name: 'B', artist: 'b', album: 'al', durationMs: 2000, fee: 8, picUrl: 'https://x/2.jpg' },
];
const merged = mergePicUrls(base, [
	{ id: 1, name: 'A', artist: 'a', album: 'al', durationMs: 1000, fee: 0, picUrl: 'https://x/1.jpg' },
	{ id: 9, name: 'X', artist: 'x', album: 'al', durationMs: 1000, fee: 0, picUrl: 'https://x/9.jpg' },
]);
ok(merged[0]?.picUrl === 'https://x/1.jpg', 'missing cover filled from details');
ok(merged[1]?.picUrl === 'https://x/2.jpg', 'existing cover kept');
ok(base[0]?.picUrl === undefined, 'input array not mutated');
ok(base[0]?.name === 'A' && merged[0]?.name === 'A', 'other fields preserved');

console.log(`verify-music-client: ${checked} assertions OK`);
