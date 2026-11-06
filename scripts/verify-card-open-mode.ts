/**
 * Verifies the per-card "new note open mode" config (card edit modal →
 * handleCardNewNote):
 *
 * 1. Round-trip: card.newNoteOpenMode = 'tab' serializes to a
 *    `newNoteOpenMode: tab` metadata line and parses back to 'tab'.
 * 2. Default: 'popover' (and any unknown value) stays UNPERSISTED — no
 *    metadata line, parses back to undefined.
 * 3. view.ts wiring: handleCardNewNote opens the popover by default
 *    (openNotePopover) and only the explicit 'tab' goes to a real tab.
 *
 * Run: `npm run test:card-open-mode`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { parse, serialize } from '../src/parser';
import type { DashboardData } from '../src/types';

function withCard(mode: 'popover' | 'tab' | undefined): DashboardData {
	// Build from a real parse so every serialize-required field exists.
	const base = parse([
		'---',
		'dashboard: true',
		'banner:',
		'  quote: ""',
		'  author: ""',
		'---',
		'',
		'## Notes',
		'',
		'### Reading list',
		'id: card-1',
		'type: project',
		'',
	].join('\n'));
	const card = base.columns[0]!.cards[0]!;
	if (mode) card.newNoteOpenMode = mode;
	else delete card.newNoteOpenMode;
	return base;
}

function run(): void {
	// 1. 'tab' persists and round-trips.
	const tabData = withCard('tab');
	const tabMd = serialize(tabData);
	assert.ok(tabMd.includes('newNoteOpenMode: tab'), '1: tab mode serializes a metadata line');
	const tabBack = parse(tabMd);
	assert.equal(tabBack.columns[0]!.cards[0]!.newNoteOpenMode, 'tab', '1: tab mode parses back');

	// 2. Default popover: no line, parses to undefined.
	const defMd = serialize(withCard(undefined));
	assert.ok(!defMd.includes('newNoteOpenMode'), '2: default mode writes no metadata line');
	assert.equal(parse(defMd).columns[0]!.cards[0]!.newNoteOpenMode, undefined, '2: default parses to undefined');
	assert.equal(parse(serialize(withCard('popover'))).columns[0]!.cards[0]!.newNoteOpenMode, undefined, '2: explicit popover stays unpersisted');

	// 2b. A hand-authored junk value is ignored (not trusted).
	const junkMd = serialize(withCard(undefined)).replace('### Reading list', '### Reading list\nnewNoteOpenMode: banana');
	assert.equal(parse(junkMd).columns[0]!.cards[0]!.newNoteOpenMode, undefined, '2b: unknown value → undefined');

	// 3. view.ts wiring.
	const view = readFileSync('src/view.ts', 'utf8');
	const idx = view.indexOf('private async handleCardNewNote');
	const body = view.slice(idx, idx + 3200);
	assert.ok(body.includes("card.newNoteOpenMode === 'tab'"), '3: handleCardNewNote consults the card config');
	assert.ok(body.includes('this.openNotePopover(file)'), '3: default path opens the in-dashboard popover editor');
	assert.ok(body.includes("this.app.workspace.getLeaf('tab').openFile(file)"), '3: tab path opens a real editor tab');
	const modal = readFileSync('src/card-edit-modal.ts', 'utf8');
	assert.ok(modal.includes("t('cardEdit.newNoteOpenMode')"), '3: card edit modal exposes the config dropdown');

	console.log('verify-card-open-mode: all checks passed');
}

run();
