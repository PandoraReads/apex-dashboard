/**
 * Verifies that clicking a task in a Dataview result opens the note AT the task,
 * the way a calendar chip click does.
 *
 * The row used to call the plain note opener, which drops the reader at the top
 * of the note: on a long daily note the task itself was nowhere in sight. TASK
 * rows know their source line, so they now go through the same line-aware
 * channel the calendar section uses.
 *
 * 1. `rowJumpLine` — the line a click should land on. Only TASK rows have one;
 *    a synthetic row (-1) or a non-task query opens the note at the top.
 * 2. `attachRowOpen` — jumpable rows are marked, the line opener wins over the
 *    generic opener, and checkbox / inner-link clicks are still left alone.
 * 3. Wiring — the section receives the line opener and the renderer passes the
 *    calendar's `onOpenNoteAtLine` through.
 * 4. The view maps that callback to `openNote(file, undefined, line)`, and both
 *    the popover and the tab fallback reveal the line.
 *
 * Run: `npm run test:dataview-task-open`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { rowJumpLine } from '../src/dataview-section';
import type { ResultRow } from '../src/dql/types';

const sectionSrc = readFileSync('src/dataview-section.ts', 'utf8');
const rendererSrc = readFileSync('src/renderer.ts', 'utf8');
const viewSrc = readFileSync('src/view.ts', 'utf8');
const popoverSrc = readFileSync('src/note-popover-modal.ts', 'utf8');
const css = readFileSync('styles.css', 'utf8');

/** A row carrying only what the click path looks at. */
function rowWith(line: number | null): ResultRow {
	const task = line === null ? undefined : { text: '写周报', checked: false, path: '01-日记/2026-11-06.md', line, originalLine: '- [ ] 写周报' };
	return { page: null, values: [], task } as unknown as ResultRow;
}

/* ------------------------------ 1. rowJumpLine ------------------------------ */

assert.equal(rowJumpLine(rowWith(12)), 12, '1: a TASK row jumps to its own source line');
assert.equal(rowJumpLine(rowWith(0)), 0, '1: line 0 is a real target, not a falsy miss');
assert.equal(rowJumpLine(rowWith(-1)), null, '1: a synthetic task has no line to land on');
assert.equal(rowJumpLine(rowWith(null)), null, '1: a non-TASK row opens the note at the top');

/* ----------------------------- 2. attachRowOpen ----------------------------- */

{
	const openSrc = sectionSrc.slice(
		sectionSrc.indexOf('function attachRowOpen('),
		sectionSrc.indexOf('// Re-export so the view can bust the page cache'),
	);
	assert.ok(openSrc.length > 0, '2: attachRowOpen exists');
	assert.ok(openSrc.includes('const line = rowJumpLine(row);'),
		'2: it asks rowJumpLine instead of re-deriving the line');
	assert.ok(openSrc.includes('if (line !== null) el.addClass(\'is-jumpable\');'),
		'2: only rows with a line are marked jumpable');
	assert.ok(openSrc.includes('if (line !== null && dvLineOpener) {'),
		'2: a jumpable row prefers the line-aware opener');
	assert.ok(openSrc.indexOf('dvLineOpener(file, line)') < openSrc.indexOf('if (dvOpener) dvOpener(file);'),
		'2: the generic opener is only the fallback');
	assert.ok(openSrc.includes("target.closest('a, .dashboard-wikilink, .dashboard-dataview-task-checkbox')"),
		'2: inner links and the toggle checkbox keep their own handlers');
}

/* -------------------------------- 3. wiring -------------------------------- */

{
	// Auto ("free") mode is the DEFAULT shape for LIST/TASK results and was the
	// one renderer that never attached a row opener — clicking a task did
	// nothing at all, which is why the popover never appeared.
	const freeSrc = sectionSrc.slice(
		sectionSrc.indexOf('function renderFreeList('),
		sectionSrc.indexOf('/* ----------------------------- CALENDAR'),
	);
	assert.ok(freeSrc.includes('attachRowOpen(li, row);'), '3: free-mode rows open their note');
	assert.ok(freeSrc.indexOf('attachRowOpen(li, row);') < freeSrc.indexOf("result.queryType === 'TASK' && row.task"),
		'3: wired BEFORE the TASK branch returns, or task rows stay dead');
}

assert.ok(sectionSrc.includes('let dvLineOpener: ((file: TFile, line?: number) => void) | null = null;'),
	'3: the section holds a line-aware opener');
assert.ok(sectionSrc.includes('onOpenNoteAtLine: ((file: TFile, line?: number) => void) | null,'),
	'3: renderDataviewSection takes it as a parameter');
assert.ok(sectionSrc.includes('dvLineOpener = onOpenNoteAtLine;'),
	'3: and stores it for the inner renderers');

{
	const callIdx = rendererSrc.indexOf('renderDataviewSection(el, column, app, activeHoverParent,');
	assert.ok(callIdx > 0, '3: the section is rendered by the dashboard renderer');
	const call = rendererSrc.slice(callIdx, callIdx + 400);
	assert.ok(call.includes('callbacks.onOpenNoteInPopover ?? null'),
		'3: the generic opener still comes from onOpenNoteInPopover');
	assert.ok(call.includes('callbacks.onOpenNoteAtLine ?? null'),
		'3: the line opener comes from the calendar-sections channel (onOpenNoteAtLine)');
	assert.ok(call.indexOf('onOpenNoteInPopover') < call.indexOf('onOpenNoteAtLine'),
		'3: argument order matches the signature (opener, then line opener)');
}

/* ------------------------------- 4. the view ------------------------------- */

assert.ok(viewSrc.includes('onOpenNoteAtLine: (file: TFile, line?: number) => this.openNote(file, undefined, line),'),
	'4: the view routes the line into openNote');
assert.ok(viewSrc.includes('if (this.plugin.settings.disableNotePopover || file.extension !== \'md\') {'),
	'4: openNote still honours the popover setting');
{
	// Popover path: the embedded editor is revealed at the line once it has
	// geometry (the "标识位置" half of the calendar behaviour).
	assert.ok(popoverSrc.includes('window.setTimeout(() => { revealMarkdownLine(view, line); }, 100);'),
		'4: the popover reveals the requested line after layout');
	assert.ok(popoverSrc.includes('view.setEphemeralState({ line });'),
		'4: revealMarkdownLine scrolls through the same channel Obsidian uses');
	assert.ok(popoverSrc.includes('editor.setCursor(from);') && popoverSrc.includes('editor.scrollIntoView({ from, to }, true);'),
		'4: and puts the caret on the line when the editor is available');
	// Tab fallback (popover disabled / non-markdown): same reveal.
	assert.ok(viewSrc.includes('revealMarkdownLine(view, line);'),
		'4: the tab path reveals the line too');
}

/* --------------------------------- 5. CSS --------------------------------- */

assert.ok(css.includes('.dashboard-dataview-free-item.is-clickable {'),
	'5: free-view rows show the pointer cursor they never had');
assert.ok(css.includes('.dashboard-dataview-table tbody tr.is-clickable {'),
	'5: clickable table rows get the pointer the old rule only denied to the rest');
assert.ok(/\.dashboard-dataview-free-item\.is-jumpable[^{]*\{/.test(css) === false,
	'5: no dead is-jumpable rule is needed — the cursor rides on is-clickable');

console.log('dataview task open: all scenarios OK');
