import { strict as assert } from 'node:assert';
import { El } from './mini-dom';
import { IconPickerModal } from '../src/icon-picker-modal';
import { BUNDLED_ICON_NAMES } from '../src/icon-names';

// Icon picker over the FULL bundled Lucide set (extracted from the local
// Obsidian's asar): curated head keeps the familiar order, everything else
// stays reachable by typing, and the suggestion list is capped so an empty
// query never mounts ~1900 DOM rows.

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};

function main(): void {
	assert.ok(BUNDLED_ICON_NAMES.length > 1500, `bundled set extracted (${BUNDLED_ICON_NAMES.length} names)`);

	const picked: string[] = [];
	const picker = new IconPickerModal({} as never, icon => picked.push(icon));

	const items = picker.getItems();
	assert.ok(items.length > 1500, `picker offers the full set (${items.length})`);
	// Curated head first: the unfiltered view opens on the familiar picks.
	assert.deepEqual(items.slice(0, 11), [
		'file-plus', 'file-text', 'notebook', 'notebook-pen', 'sticky-note', 'folder', 'folder-plus', 'bookmark', 'pin', 'tag', 'hash',
	], 'curated picks lead the list');
	// No duplicates.
	assert.equal(new Set(items).size, items.length, 'curated + bundled lists do not overlap');
	// The retired 'checkbox' name is gone; its replacement is offered.
	assert.ok(!items.slice(0, 80).includes('checkbox'), 'dead Lucide name dropped from the curated head');
	assert.ok(items.includes('square-check-big'), 'checkbox replacement offered');
	// Deep-cut names from the bundled tail are reachable.
	assert.ok(items.includes('wand-sparkles') && items.includes('test-tubes'), 'bundled tail reachable');

	// Empty query: capped, never the full ~1900 rows.
	assert.ok(picker.getSuggestions('').length <= 400, `suggestion cap holds (${picker.getSuggestions('').length})`);
	// Typed queries find what they should.
	const hits = picker.getSuggestions('calendar').map(m => m.item);
	assert.ok(hits.includes('calendar') && hits.includes('calendar-days'), 'typed query filters to matches');

	// Choose round-trips the name.
	picker.onChooseItem('rocket');
	assert.deepEqual(picked, ['rocket']);
}

main();
console.log('icon picker: ALL PASS');
