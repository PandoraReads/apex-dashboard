/**
 * Verifies the TASK-row truncation fix (dataview section):
 *
 * A TASK row is a flex line of [checkbox][text]. Wrapping the text onto extra
 * lines both stranded the checkbox on a row of its own and turned "keep the box
 * level with the text" into a guessing game about the first line box (every
 * px/lh offset drifted with the font scale). The row is single-line now and
 * overlong text is cut with an ellipsis, so the two always share one line and
 * centering them is exact.
 *
 * 1. CSS: the row cannot wrap; the list host fills the item (it is a
 *    fit-content row, so otherwise the text keeps its full length and nothing
 *    ever truncates); the text is a shrinkable, non-wrapping, clipped flex item
 *    with `text-overflow: ellipsis`.
 * 2. The px nudge that used to fake centering is cancelled inside task rows.
 * 3. The full text stays reachable: both TASK paths put it in `title`.
 *
 * Run: `npm run test:dataview-task-ellipsis`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const sectionSrc = readFileSync('src/dataview-section.ts', 'utf-8');
const css = readFileSync('styles.css', 'utf-8');

/** Declaration block of the FIRST rule with this exact selector. */
function ruleOf(selector: string): string {
	const at = css.indexOf(`\n${selector} {`);
	assert.ok(at > 0, `CSS rule exists: ${selector}`);
	return css.slice(at, css.indexOf('}', at));
}

// --- 1. Row never wraps; host is width-constrained -----------------------
{
	const row = ruleOf('.dashboard-dataview-task-row');
	assert.ok(/flex-wrap:\s*nowrap/.test(row), '1: checkbox + text stay on one line');
	assert.ok(/align-items:\s*center/.test(row),
		'2: single-line rows centre the box on the text line (free host is baseline)');

	const host = ruleOf('.dashboard-dataview-list-main.dashboard-dataview-task-row');
	assert.ok(/width:\s*100%/.test(host),
		'3: list host fills the item so the text has a width to truncate against');
	assert.ok(/align-items:\s*center/.test(host), '4: list host keeps centring');
}

// --- 2. Text truncates with an ellipsis ---------------------------------
{
	const text = ruleOf('.dashboard-dataview-task-row .dashboard-dataview-task-text');
	assert.ok(/white-space:\s*nowrap/.test(text), '5: text never wraps');
	assert.ok(/overflow:\s*hidden/.test(text), '6: overflow is clipped');
	assert.ok(/text-overflow:\s*ellipsis/.test(text), '7: clipping renders "…"');
	assert.ok(/min-width:\s*0/.test(text), '8: may shrink below max-content width');
	assert.ok(/flex:\s*1 1 auto/.test(text), '9: takes the width left by the checkbox');
}

// --- 3. Vertical nudge cancelled inside task rows -----------------------
{
	const base = ruleOf('.dashboard-dataview-task-checkbox');
	assert.ok(/transform:\s*translateY/.test(base), '10: the shared base rule is untouched');
	const scoped = ruleOf('.dashboard-dataview-task-row .dashboard-dataview-task-checkbox');
	assert.ok(/transform:\s*none/.test(scoped),
		'11: task rows drop the px nudge (centring is already exact)');
}

// --- 4. No leftovers from the wrapping/alignment attempts ---------------
{
	assert.ok(!css.includes('.dashboard-dataview-task-check {'),
		'12: no one-line wrapper element');
	assert.ok(!/height:\s*1lh/.test(css), '13: no lh-based box sizing');
	assert.ok(!/\.dashboard-dataview-task-row[^{]*\.dashboard-dataview-task-text\s*{[^}]*overflow-wrap/.test(css),
		'14: no word-wrapping rule on task text');
	assert.ok(!/\.dashboard-dataview-task-row[^{]*\.dashboard-dataview-task-text\s*{[^}]*word-break/.test(css),
		'15: no word-break rule on task text');
	assert.ok(!sectionSrc.includes("dashboard-dataview-task-check'"),
		'16: the renderer does not wrap the input in a sizing box');
}

// --- 5. Full text reachable on hover ------------------------------------
assert.equal((sectionSrc.match(/label\.title = row\.task\.text/g) ?? []).length, 2,
	'17: both TASK row paths (list + free) expose the full text as a tooltip');

console.log('dataview task ellipsis: all scenarios OK');
