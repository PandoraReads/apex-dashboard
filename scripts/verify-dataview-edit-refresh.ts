/**
 * Verifies that a note edited inside the in-dashboard popover re-runs the
 * dataview card it was opened from.
 *
 * A dataview card is a snapshot: it queries once and stays off the vault-change
 * debounce by design, so an edit made through a row's own popover used to leave
 * the card showing the pre-edit rows until the user pressed refresh.
 *
 * 1. The registry reloads exactly the cards that show the edited note.
 * 2. Handles whose DOM is gone are dropped (a re-rendered dashboard builds new
 *    section elements) — and are never reloaded.
 * 3. Re-registering the same element replaces its handle instead of stacking a
 *    second one (which would double-run the query on every edit).
 * 4. `collectResultPaths` sees every note a result refers to, grouped members
 *    and TASK payloads included.
 * 5. The refresh is QUIET: it keeps the current result on screen instead of
 *    emptying the card and painting the scan spinner, while the header refresh
 *    button stays loud.
 * 6. `view.onNoteEditedInPopover` is what triggers it, after invalidating the
 *    scan cache so the re-run reads the new text from disk.
 *
 * Run: `npm run test:dataview-edit-refresh`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
	collectResultPaths,
	refreshDataviewSectionsForPath,
	registerDataviewSection,
	type DataviewSectionHandle,
} from '../src/dataview-section';
import type { ResultRow } from '../src/dql/types';

const sectionSrc = readFileSync('src/dataview-section.ts', 'utf8');
const viewSrc = readFileSync('src/view.ts', 'utf8');

/** A handle whose DOM node reports itself as connected (or not). */
function handleFor(paths: string[], connected = true): DataviewSectionHandle & { reloads: number } {
	const handle = {
		el: { isConnected: connected } as unknown as HTMLElement,
		paths: new Set(paths),
		reloads: 0,
		reload: (): void => { handle.reloads += 1; },
	};
	return handle;
}

/* ------------------------- 1. only the cards that show it ------------------------- */

{
	const daily = handleFor(['01-日记/2026-11-06.md']);
	const other = handleFor(['02-项目/看板.md']);
	registerDataviewSection(daily);
	registerDataviewSection(other);

	refreshDataviewSectionsForPath('01-日记/2026-11-06.md');
	assert.equal(daily.reloads, 1, '1: the card showing the edited note re-runs');
	assert.equal(other.reloads, 0, '1: a card that does not show it is left alone');

	refreshDataviewSectionsForPath('03-无关/笔记.md');
	assert.equal(daily.reloads, 1, '1: an edit to an unrelated note changes nothing');
	assert.equal(other.reloads, 0, '1: still nothing');
}

/* ---------------------------- 2. dead DOM is pruned ---------------------------- */

{
	const dead = handleFor(['01-日记/2026-11-07.md'], false);
	registerDataviewSection(dead);
	refreshDataviewSectionsForPath('01-日记/2026-11-07.md');
	assert.equal(dead.reloads, 0, '2: a section that is no longer in the DOM is never reloaded');

	// Prove it left the registry: bring its element back to life and refresh —
	// a pruned handle must not resurrect.
	dead.paths.add('01-日记/2026-11-07.md');
	refreshDataviewSectionsForPath('01-日记/2026-11-07.md');
	assert.equal(dead.reloads, 0, '2: pruning is permanent for that handle');
}

/* ---------------------- 3. same element, one handle only ---------------------- */

{
	const el = { isConnected: true } as unknown as HTMLElement;
	let first = 0;
	let second = 0;
	registerDataviewSection({ el, paths: new Set(['05-去重/笔记.md']), reload: () => { first += 1; } });
	registerDataviewSection({ el, paths: new Set(['05-去重/笔记.md']), reload: () => { second += 1; } });

	refreshDataviewSectionsForPath('05-去重/笔记.md');
	assert.equal(first, 0, '3: the superseded handle is replaced, not kept');
	assert.equal(second, 1, '3: the section re-runs once, not twice');
}

/* --------------------------- 4. which notes a result refers to --------------------------- */

{
	const rows = [
		{ page: { file: { path: 'a.md' } }, values: [] },
		{ page: { file: { path: 'b.md' } }, values: [], task: { text: 't', checked: false, path: 'b.md', line: 3, originalLine: '- [ ] t' } },
		{
			page: null,
			values: [],
			groupKey: 'g',
			rows: [
				{ page: { file: { path: 'c.md' } }, values: [] },
				{ page: null, values: [], task: { text: 'u', checked: false, path: 'd.md', line: 0, originalLine: '- [ ] u' } },
			],
		},
	] as unknown as ResultRow[];

	const paths = collectResultPaths(rows);
	assert.deepEqual([...paths].sort(), ['a.md', 'b.md', 'c.md', 'd.md'],
		'4: page, task payload and grouped member notes are all collected');
}

/* ------------------------------ 5. quiet refresh ------------------------------ */

{
	assert.ok(sectionSrc.includes('const render = async (quiet = false): Promise<void> => {'),
		'5: render takes a quiet flag');
	const body = sectionSrc.slice(
		sectionSrc.indexOf('const render = async (quiet = false)'),
		sectionSrc.indexOf('const handle: DataviewSectionHandle = {'),
	);
	assert.ok(body.includes('if (!quiet) {'), '5: the spinner is skipped when quiet');
	assert.ok(body.indexOf('if (!quiet) {') < body.indexOf('renderScanningState(content)'),
		'5: the guard wraps the scan placeholder, not something else');
	assert.ok(body.includes('handle.paths = collectResultPaths(outcome.result.rows);'),
		'5: every run records what the card now shows');
	assert.ok(body.includes('handle.paths = new Set();'),
		'5: an empty result clears it (nothing left to refresh)');

	assert.ok(sectionSrc.includes('reload: () => { void render(true); },'),
		'5: the registry reload is quiet');
	assert.ok(sectionSrc.includes('reloadRegister(() => { void render(); });'),
		'5: the header refresh button still shows the scan state');
	assert.ok(sectionSrc.includes('registerDataviewSection(handle);'),
		'5: every rendered section is registered');
}

/* --------------------------------- 6. the trigger --------------------------------- */

{
	const idx = viewSrc.indexOf('private onNoteEditedInPopover(file: TFile): void {');
	assert.ok(idx > 0, '6: the view handles popover edits');
	const body = viewSrc.slice(idx, idx + 900);
	assert.ok(body.includes('refreshDataviewSectionsForPath(file.path);'),
		'6: it re-runs the cards that show the edited note');
	assert.ok(body.indexOf('invalidatePath(file.path);') < body.indexOf('refreshDataviewSectionsForPath(file.path);'),
		'6: the scan cache is invalidated FIRST, or the re-run reads the old text');

	assert.ok(viewSrc.includes("import { refreshDataviewSectionsForPath } from './dataview-section';"),
		'6: the view actually imports it');
}

console.log('dataview edit refresh: all scenarios OK');
