/**
 * Verifies the widget-background clear-persistence fix (3.9.7 regression):
 * cleared card backgrounds resurrecting after an Obsidian restart.
 *
 * Mechanism under test: clearing a background persists as `settings[key] =
 * undefined`, which JSON.stringify (Obsidian's saveData) DROPS from data.json.
 * On the next start, loadSettings rebuilds settings via {...DEFAULT_SETTINGS,
 * ...raw} — so any widget-background preset living in DEFAULT_SETTINGS
 * refills the missing key and the cleared photo comes back. The fix removes
 * the presets from DEFAULT_SETTINGS (new installs get them from
 * loadSettings' fresh-install seed instead).
 *
 * 1. DEFAULT_SETTINGS ships no widget-background presets (the resurrection
 *    guard — re-adding them here is the bug).
 * 2. Round trip: saved preset -> clear (undefined dropped by stringify) ->
 *    reload merge -> stays clean.
 * 3. A background the user KEEPS survives the same round trip untouched.
 * 4. The fresh-install seed in main.ts still provides the presets for new
 *    installs (source scan: loadSettings' loaded === null block sets all
 *    three keys).
 *
 * Run: `npm run test:widget-bg-clear`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, type DashboardSettings, type WidgetBackground } from '../src/types';

const BG_KEYS = ['quickActionsBackground', 'pomodoroBackground', 'habitBackground', 'musicBackground', 'yearProgressBackground'] as const;
type BgKey = typeof BG_KEYS[number];

const preset: WidgetBackground = {
	image: 'https://images.pexels.com/photos/4958013/pexels-photo-4958013.jpeg',
	opacity: 100, dim: 40, blur: 0, foreground: 'light',
};

// 1. No preset may live in DEFAULT_SETTINGS: a cleared background is
//    persisted as an absent key, and the load-time {...DEFAULT, ...raw}
//    merge would refill any default here on every restart.
for (const key of BG_KEYS) {
	assert.equal((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key], undefined,
		`DEFAULT_SETTINGS.${key} must stay unset — a default here resurrects cleared backgrounds on restart`);
}

/** Mirror of loadSettings' rebuild (the parts that matter for these keys). */
const reload = (onDisk: Record<string, unknown>): DashboardSettings =>
	({ ...DEFAULT_SETTINGS, ...onDisk }) as DashboardSettings;

/** Mirror of Plugin.saveData: JSON.stringify drops undefined-valued keys. */
const saveToDisk = (settings: DashboardSettings): Record<string, unknown> =>
	JSON.parse(JSON.stringify(settings));

// 2. The reported bug's round trip: preset saved on disk, user clears,
//    restart — must stay clean. (Before the fix, reload() refilled the
//    habit/quickActions/music presets here.)
const withPreset: Record<string, unknown> = {
	habitBackground: { ...preset },
	quickActionsBackground: { ...preset, image: 'https://example.com/a.jpg' },
	musicBackground: { ...preset, image: 'https://example.com/b.jpg' },
};
const cleared = { ...reload(withPreset), habitBackground: undefined } as DashboardSettings;
const afterClearDisk = saveToDisk(cleared);
assert.equal('habitBackground' in afterClearDisk, false,
	'clearing must leave no habitBackground key on disk (undefined is dropped by stringify)');
assert.equal(reload(afterClearDisk).habitBackground, undefined,
	'a cleared background must stay cleared after restart');
// The other two were untouched by the clear and survive.
assert.ok(reload(afterClearDisk).musicBackground?.image, 'an untouched background survives the restart');

// 3. Clearing via each writer idiom (settings-tab spread and
//    saveSingletonBackground both use the same {...settings, [key]: bg}).
for (const key of BG_KEYS) {
	const base = { ...reload({ [key]: { ...preset } }) } as DashboardSettings;
	const writer = (bg: WidgetBackground | undefined): DashboardSettings =>
		({ ...base, [key]: bg });
	const next = reload(saveToDisk(writer(undefined)));
	assert.equal(next[key as BgKey], undefined, `${key}: cleared via spread writer stays cleared`);
	const kept = reload(saveToDisk(writer({ ...preset })));
	assert.equal(kept[key as BgKey]?.image, preset.image, `${key}: saved background round-trips`);
}

// 4. Fresh installs still ship the presets: the loaded === null seed in
//    main.ts must set all three keys (regression guard for the removal).
// (Run from the repo root via npm — same cwd idiom as verify-card-delete.)
const mainSrc = readFileSync('src/main.ts', 'utf8');
const seedStart = mainSrc.indexOf('if (loaded === null) {');
assert.ok(seedStart > 0, 'loadSettings fresh-install seed block not found');
const seedEnd = mainSrc.indexOf('this.app.saveLocalStorage', seedStart);
assert.ok(seedEnd > seedStart, 'fresh-install seed block end not found');
const seedBlock = mainSrc.slice(seedStart, seedEnd);
for (const key of ['quickActionsBackground', 'habitBackground', 'musicBackground'] as const) {
	assert.ok(seedBlock.includes(`${key}: {`),
		`fresh-install seed must still set ${key} (presets ship to new installs only)`);
}

console.log('verify-widget-bg-clear: all assertions passed');
