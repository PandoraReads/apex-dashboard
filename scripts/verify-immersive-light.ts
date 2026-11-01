/**
 * Verifies the light-glass immersive tone ('immersive-light'):
 *
 * 1. Family gate: isImmersiveMode covers BOTH tones (and nothing else), so
 *    every render branch that asks "is this an immersive board?" takes the
 *    light variant down the same pipeline as the dark one. immersiveTone
 *    classifies anything that is not the light variant as 'dark'.
 * 2. Phone pin: effectiveLayout keeps phones on 'side' for both tones — the
 *    light tone is desktop/tablet only, exactly like the dark one.
 * 3. File format: `layout: immersive-light` parses, serializes back in the
 *    same spelling, and an unknown layout string still resolves to undefined
 *    (the follow-the-global-default upgrade path).
 * 4. Seeding: generateDefaultMarkdown('immersive-light') emits the SAME
 *    immersive template as the dark seed (identical sections, cards and free-
 *    grid tiles) and differs only in the layout value — the light tone must
 *    never be seeded as a bare side board.
 *
 * Run: `npm run test:immersive-light`
 */
import { strict as assert } from 'node:assert';
import { effectiveLayout, immersiveTone, isImmersiveMode } from '../src/immersive-grid';
import { generateDefaultMarkdown, parse, serialize } from '../src/parser';
import type { DashboardLayoutMode } from '../src/types';

// Obsidian globals absent in Node: the parser/render layer touches
// activeDocument lazily (modal theming) and i18n reads no DOM. Minimal stubs.
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
	body: { querySelectorAll: () => [] },
};

const run = (): void => {
	// 1. Family gate -------------------------------------------------------
	const family: Array<[DashboardLayoutMode, boolean]> = [
		['immersive', true],
		['immersive-light', true],
		['side', false],
		['stacked', false],
	];
	for (const [mode, expected] of family) {
		assert.equal(isImmersiveMode(mode), expected, `isImmersiveMode('${mode}')`);
	}
	assert.equal(isImmersiveMode(undefined), false, 'undefined is not immersive');
	assert.equal(isImmersiveMode(null), false, 'null is not immersive');

	assert.equal(immersiveTone('immersive-light'), 'light', 'light tone maps to light');
	for (const mode of ['immersive', 'side', 'stacked', undefined] as const) {
		assert.equal(immersiveTone(mode), 'dark', `tone of ${String(mode)} stays dark`);
	}

	// 2. Phone pin ---------------------------------------------------------
	assert.equal(effectiveLayout('immersive-light', true), 'side', 'phones never get the light immersive board');
	assert.equal(effectiveLayout('immersive', true), 'side', 'phones never get the dark immersive board');
	assert.equal(effectiveLayout('immersive-light', false), 'immersive-light', 'desktop keeps the light tone');
	assert.equal(effectiveLayout('immersive', false), 'immersive', 'desktop keeps the dark tone');

	// 3. File format -------------------------------------------------------
	const lightMd = generateDefaultMarkdown('immersive-light');
	assert.match(lightMd, /^layout: immersive-light$/m, 'seed writes the light layout value');

	const lightData = parse(lightMd);
	assert.equal(lightData.layout, 'immersive-light', 'parsing the seed keeps the light layout');
	assert.equal(
		serialize(lightData).includes('layout: immersive-light'),
		true,
		'serializing a light board keeps the light layout value',
	);

	// Round trip is stable: serialize → parse → serialize is byte-identical.
	const roundTrip = serialize(parse(serialize(lightData)));
	assert.equal(roundTrip, serialize(lightData), 'light board round trip is byte-stable');

	// Unknown / malformed layout strings keep the old fallback contract.
	assert.equal(parse('---\ndashboard: true\nlayout: nope\n---\n').layout, undefined, 'unknown layout falls back to the global default');
	assert.equal(parse('---\ndashboard: true\n---\n').layout, undefined, 'absent layout falls back to the global default');

	// 4. Seeding: same board, different tone -------------------------------
	const darkMd = generateDefaultMarkdown('immersive');
	const darkData = parse(darkMd);
	assert.equal(darkData.layout, 'immersive', 'dark seed keeps the dark layout');
	assert.deepEqual(
		lightData.columns.map(col => col.name),
		darkData.columns.map(col => col.name),
		'both seeds carry the same sections',
	);
	assert.deepEqual(
		lightData.columns.map(col => col.cards.map(card => [card.id, card.type, card.tasks.length])),
		darkData.columns.map(col => col.cards.map(card => [card.id, card.type, card.tasks.length])),
		'both seeds carry the same cards and task counts',
	);
	assert.deepEqual(
		lightData.immersive,
		darkData.immersive,
		'both seeds carry the same free-grid tile arrangement',
	);
	assert.ok((lightData.immersive?.length ?? 0) > 0, 'light seed ships the immersive tile arrangement');
	assert.match(lightMd, /^immersive:$/m, 'light seed carries the immersive tile list');

	// The two seeds differ ONLY in the layout line.
	assert.equal(
		lightMd.replace(/^layout: immersive-light$/m, 'layout: immersive'),
		darkMd,
		'light and dark seeds are byte-identical apart from the layout value',
	);
};

run();
console.log('immersive light: ALL PASS');
