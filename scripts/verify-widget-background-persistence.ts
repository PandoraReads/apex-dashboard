/**
 * Verifies that clearing a widget card background survives a plugin reload
 * (issue #60).
 *
 * Root cause guarded here: DEFAULT_SETTINGS used to carry the first-install
 * photo presets for the quick-buttons / habit / music cards. The clear button
 * persists `undefined`, JSON.stringify drops that key from data.json, and the
 * next `{ ...DEFAULT_SETTINGS, ...raw }` merge brought the preset back on
 * every Obsidian start — clearing could never stick.
 *
 * 1. DEFAULT_SETTINGS carries no background image for the three cards.
 * 2. clear -> save -> reload stays cleared for each key (JSON round-trip).
 * 3. A saved custom background still survives the same round-trip.
 * 4. FIRST_INSTALL_WIDGET_BACKGROUNDS still ships the presets for fresh
 *    installs (main.ts applies them only when loadData() returned null).
 * 5. applyWidgetBackground(undefined) leaves the card untouched.
 *
 * Run: `npm run test:widget-background`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El } from './mini-dom';
import {
	DEFAULT_SETTINGS,
	FIRST_INSTALL_WIDGET_BACKGROUNDS,
	type DashboardSettings,
	type WidgetBackground,
} from '../src/types';
import { applyWidgetBackground } from '../src/widget-background';

const BACKGROUND_KEYS = ['quickActionsBackground', 'habitBackground', 'musicBackground'] as const;

/** JSON-only persistence — exactly what Plugin.saveData/loadData do. */
function roundTrip(settings: Partial<DashboardSettings>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
}

/** The merge loadSettings performs on plugin start. */
function reload(raw: Record<string, unknown> | null): DashboardSettings {
	return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

// --- 1. Neutral defaults ----------------------------------------------------
for (const key of BACKGROUND_KEYS) {
	assert.equal(DEFAULT_SETTINGS[key], undefined, `${key} must not carry a preset in DEFAULT_SETTINGS`);
}

// --- 2. Clear -> save -> reload stays cleared -------------------------------
for (const key of BACKGROUND_KEYS) {
	const cleared: Partial<DashboardSettings> = { ...DEFAULT_SETTINGS, [key]: undefined };
	const persisted = roundTrip(cleared);
	assert.ok(!(key in persisted), `${key}: an undefined value is dropped from data.json`);
	const reloaded = reload(persisted);
	assert.equal(reloaded[key], undefined, `${key}: reload must not resurrect a cleared background`);
}

// --- 3. A custom background survives the same round-trip --------------------
const custom: WidgetBackground = {
	image: 'attachments/card.jpg',
	opacity: 80,
	dim: 20,
	blur: 4,
	foreground: '#f5e9d7',
};
const withCustom: Partial<DashboardSettings> = { ...DEFAULT_SETTINGS, quickActionsBackground: custom };
assert.deepEqual(
	reload(roundTrip(withCustom)).quickActionsBackground,
	custom,
	'a saved background survives a reload',
);

// --- 4. First-install presets still exist ----------------------------------
for (const key of ['quickActions', 'habit', 'music'] as const) {
	const preset = FIRST_INSTALL_WIDGET_BACKGROUNDS[key];
	assert.ok(preset.image.startsWith('https://'), `${key}: first-install preset image present`);
	assert.ok(preset.opacity >= 0 && preset.opacity <= 100, `${key}: opacity in range`);
	assert.ok(preset.dim >= 0 && preset.dim <= 100, `${key}: dim in range`);
}

// --- 5. Undefined background is a no-op ------------------------------------
const card = new El('div');
applyWidgetBackground(card as unknown as HTMLElement, undefined, {} as App);
assert.ok(!card.hasClass('dashboard-sidebar-widget--has-bg'), 'no background layer for an undefined config');

console.log('verify-widget-background-persistence: all assertions passed');
