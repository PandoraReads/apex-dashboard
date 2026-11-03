/**
 * Verifies the per-card "task complete behavior" config (task-list config
 * button → sync.toggleTask):
 *
 * 1. Round-trip: card.taskCompleteBehavior = 'stay' / 'afterUnfinished'
 *    serializes to a `taskCompleteBehavior: <value>` metadata line and
 *    parses back to the same value.
 * 2. Default: 'end' (and any unknown value) stays UNPERSISTED — no
 *    metadata line, parses back to undefined.
 * 3. sync.ts wiring: toggleTask honors all three behaviors — 'stay' keeps
 *    the slot, 'end' moves to the bottom, 'afterUnfinished' inserts just
 *    past the last unfinished task.
 * 4. renderer/view wiring: the task-card config button opens a Menu with
 *    the three options and routes through onTaskCompleteBehaviorChange →
 *    sync.updateCard.
 *
 * Run: `npm run test:task-complete-behavior`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { parse, serialize } from '../src/parser';
import type { DashboardData } from '../src/types';

// Build from a real parse so every serialize-required field exists.
function withCard(behavior: 'stay' | 'afterUnfinished' | undefined): DashboardData {
	const base = parse([
		'---',
		'dashboard: true',
		'banner:',
		'  quote: ""',
		'  author: ""',
		'---',
		'',
		'## Todos',
		'',
		'### Shopping list',
		'id: card-1',
		'type: task',
		'- [ ] alpha',
		'- [ ] beta',
		'',
	].join('\n'));
	const card = base.columns[0]!.cards[0]!;
	assert.equal(card.type, 'task');
	if (behavior) card.taskCompleteBehavior = behavior;
	else delete card.taskCompleteBehavior;
	return base;
}

function run(): void {
	// 1. Explicit values persist and round-trip.
	for (const value of ['stay', 'afterUnfinished'] as const) {
		const md = serialize(withCard(value));
		assert.ok(md.includes(`taskCompleteBehavior: ${value}`), `1: ${value} serializes a metadata line`);
		assert.equal(parse(md).columns[0]!.cards[0]!.taskCompleteBehavior, value, `1: ${value} parses back`);
	}

	// 2. Default 'end' (and undefined) writes no metadata line.
	const defMd = serialize(withCard(undefined));
	assert.ok(!defMd.includes('taskCompleteBehavior'), "2: default 'end' writes no metadata line");
	assert.equal(parse(defMd).columns[0]!.cards[0]!.taskCompleteBehavior, undefined, '2: default parses to undefined');

	// 2b. A hand-authored junk value is ignored (not trusted).
	const junkMd = serialize(withCard(undefined)).replace('### Shopping list', '### Shopping list\ntaskCompleteBehavior: banana');
	assert.equal(parse(junkMd).columns[0]!.cards[0]!.taskCompleteBehavior, undefined, '2b: unknown value → undefined');

	// 2c. Re-saving an explicit value is idempotent (no drift).
	assert.equal(serialize(parse(serialize(withCard('stay')))), serialize(withCard('stay')), '2c: stay round-trip is byte-stable');

	// 3. sync.toggleTask honors the three behaviors.
	const src = readFileSync('src/sync.ts', 'utf-8');
	assert.ok(src.includes("card?.taskCompleteBehavior ?? 'end'"),
		"toggleTask reads the per-card behavior with the historical 'end' default");
	assert.ok(src.includes("behavior === 'stay'"), "toggleTask implements 'stay'");
	assert.ok(src.includes("behavior === 'afterUnfinished'"), "toggleTask implements 'afterUnfinished'");
	assert.ok(/if \(!without\[i\]!\.checked\) insertIdx = i \+ 1;/.test(src),
		'afterUnfinished inserts past the last unfinished top-level task');

	// 4. renderer/view wiring.
	const rendererSrc = readFileSync('src/renderer.ts', 'utf-8');
	assert.ok(rendererSrc.includes("t('renderer.taskListBehavior')"),
		'task cards render the behavior config button');
	assert.ok(rendererSrc.includes("'taskBehavior.stay'") && rendererSrc.includes("'taskBehavior.afterUnfinished'"),
		'config menu offers all three options');
	assert.ok(rendererSrc.includes("opt.value === 'end' ? undefined : opt.value"),
		"choosing 'end' persists undefined (clears the metadata line)");
	const viewSrc = readFileSync('src/view.ts', 'utf-8');
	assert.ok(viewSrc.includes("onTaskCompleteBehaviorChange: (card: DashboardCard, value: 'stay' | 'afterUnfinished' | undefined) =>"),
		'view routes the callback through sync.updateCard');
}

run();
console.log('verify-task-complete-behavior: all checks passed');
