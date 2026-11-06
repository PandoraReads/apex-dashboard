/**
 * Verifies the in-place toggle of a task inside a Dataview TASK result.
 *
 * The checkbox used to call the section-level `rerender`, which empty()s the
 * whole card, paints the scan spinner and awaits a fresh `buildPages` — per
 * click. Now the click updates the row model synchronously and the DOM edit is
 * the smallest one that expresses the new result: the rows that LEFT the result
 * are dropped on their own and everything else is left alone (no body rebuild,
 * so no scroll jump and no hover snap).
 *
 * 1. Filtered query: the completed row is pruned by key, exactly once; the
 *    section-level rerender is never used.
 * 2. The patch clones the page — the snapshot the section rendered keeps its
 *    own state.
 * 3. Unfiltered query: the row survives, so no DOM work at all.
 * 4. Accumulation: a SECOND click re-evaluates against the first click's result.
 *    Patching the frozen snapshot made every earlier toggle evaporate (a task
 *    completed in a `WHERE !completed` list came back, unchecked, when another
 *    row was toggled) — this is the regression this file guards.
 * 5. Synchronous model: `model.capped` is already correct when the handler
 *    returns, before the note write settles, so the list cannot lag a click.
 * 6. Failed write: the model is rolled back and the body repainted (a pruned row
 *    can only come back through a repaint), so the list never claims a state the
 *    file does not have.
 * 7. Wiring: every TASK row goes through `rowToggler`, every row element is
 *    keyed, and the handler never blanks the container nor re-scans the vault.
 * 8. CSS: the label-scoped done state the mirror flips actually paints.
 * 9. No rebuild machinery: the old hover-mute repaint hack is gone — it painted
 *    two visible steps per click, which read as a double flash.
 *
 * Run: `npm run test:dataview-task-toggle`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { readFileSync } from 'node:fs';
import { executeDql } from '../src/dql';
import type { DataviewConfig } from '../src/types';
import type { Page, ResultRow } from '../src/dql/types';
import { makeTaskToggleHandler, type TaskToggleModel, type TaskToggleSurfaces } from '../src/dataview-section';

/* ----------------------------- fixtures ----------------------------- */

type TaskSpec = [line: number, checked: boolean, text: string];

function pageOf(path: string, tasks: TaskSpec[]): Page {
	const file = new TFile();
	(file as unknown as { path: string }).path = path;
	const list = tasks.map(([line, checked, text]) => ({
		kind: 'object' as const,
		entries: {
			completed: checked,
			checked,
			text,
			due: null,
			priority: null,
			link: null,
			__line: line,
			__original: `- [${checked ? 'x' : ' '}] ${text}`,
			__path: path,
		},
	}));
	return { file, fields: { 'file.path': path, 'file.tasks': list, 'file.lists': list } } as unknown as Page;
}

const path = '01-日记/2026-11-06.md';
const sourcePage = pageOf(path, [[0, false, '写周报'], [1, false, '买菜']]);

/** No note resolves: every write is a no-op. The model still updates, which is
 *  exactly what the list shows before the write settles. */
function noVaultApp(): App {
	return { vault: { getAbstractFileByPath: () => null } } as unknown as App;
}

/** Every write rejects — used to prove the rollback. */
function failingApp(): App {
	const file = new TFile();
	(file as unknown as { path: string }).path = path;
	(file as unknown as { stat: { mtime: number; ctime: number } }).stat = { mtime: 1, ctime: 1 };
	return {
		vault: {
			getAbstractFileByPath: () => file,
			process: () => Promise.reject(new Error('disk on fire')),
		},
	} as unknown as App;
}

function rowsOf(dql: string, pages: readonly Page[]): ResultRow[] {
	const outcome = executeDql(dql, pages);
	assert.ok(outcome.ok, `query runs: ${dql}`);
	return outcome.empty ? [] : [...outcome.result.rows];
}

function connectedHandler(query: string, seed: readonly Page[], initial: ResultRow[], app: App = noVaultApp()) {
	const model: TaskToggleModel = { pages: [...seed], capped: initial };
	const counters = { prunes: [] as string[][], redraws: 0, rerenders: 0 };
	const surfaces: TaskToggleSurfaces = {
		prune: (keys) => { counters.prunes.push([...keys]); },
		redraw: () => { counters.redraws += 1; },
	};
	const handler = makeTaskToggleHandler(
		{ query } as DataviewConfig,
		model,
		surfaces,
		() => { counters.rerenders += 1; },
		app,
	);
	return { model, counters, handler };
}

const texts = (rows: readonly ResultRow[]): string[] => rows.map(r => r.task?.text ?? '');
const keyOf = (line: number): string => `${path}\u0000${line}`;

async function main(): Promise<void> {
	/* ----------------------------- 1. filtered query ----------------------------- */

	{
		const dql = 'TASK\nFROM "01-日记"\nWHERE !completed\nSORT file.name DESC';
		const rows = rowsOf(dql, [sourcePage]);
		assert.equal(rows.length, 2, '1: two unfinished tasks to start with');

		const { model, counters, handler } = connectedHandler(dql, [sourcePage], rows);
		void handler(rows[0]!, true);

		assert.deepEqual(counters.prunes, [[keyOf(0)]],
			'1: only the completed row is dropped, addressed by its key');
		assert.equal(counters.redraws, 0, '1: no body rebuild (that is the flash)');
		assert.equal(counters.rerenders, 0, '1: and no section-level rerender');
		assert.deepEqual(texts(model.capped), ['买菜'], '1: the completed task left a `WHERE !completed` result');
	}

	/* ----------------------------- 2. snapshot untouched ----------------------------- */

	{
		const before = JSON.stringify(sourcePage.fields['file.tasks']);
		const dql = 'TASK\nWHERE !completed';
		const rows = rowsOf(dql, [sourcePage]);
		void connectedHandler(dql, [sourcePage], rows).handler(rows[0]!, true);
		assert.equal(JSON.stringify(sourcePage.fields['file.tasks']), before,
			'2: the patched page is a clone — the rendered snapshot keeps its own state');
	}

	/* ----------------------------- 3. unfiltered query ----------------------------- */

	{
		const dql = 'TASK';
		const rows = rowsOf(dql, [sourcePage]);
		const { model, counters, handler } = connectedHandler(dql, [sourcePage], rows);
		void handler(rows[0]!, true);

		assert.equal(counters.prunes.length, 0, '3: a row that survives is not touched at all');
		assert.equal(counters.redraws, 0, '3: and nothing is repainted');
		assert.equal(counters.rerenders, 0, '3: and never a section rerender');
		assert.equal(model.capped.length, 2, '3: both rows still present');
		assert.equal(model.capped[0]!.task?.checked, true, '3: the fresh row carries the new state');
		assert.ok(model.capped[0]!.task?.originalLine.startsWith('- [x]'),
			'3: the patched row hands the writer a line that matches disk');
	}

	/* ----------------------------- 4. toggles accumulate ----------------------------- */

	{
		// The reported bug: clicking a few rows in a row left the list showing
		// states the notes no longer had, because each click re-ran the query from
		// the original snapshot and resurrected every earlier toggle.
		const dql = 'TASK\nWHERE !completed';
		const rows = rowsOf(dql, [sourcePage]);
		const { model, counters, handler } = connectedHandler(dql, [sourcePage], rows);

		void handler(rows[0]!, true); // 写周报 done -> only 买菜 left
		assert.deepEqual(texts(model.capped), ['买菜'], '4: first click drops its own row');
		const second = model.capped[0]!;
		void handler(second, true); // 买菜 done -> list empty
		assert.deepEqual(texts(model.capped), [], '4: the second click must not resurrect 写周报');
		assert.deepEqual(counters.prunes, [[keyOf(0)], [keyOf(1)]],
			'4: each click prunes its OWN row — the first one never comes back');

		void handler(second, false); // 买菜 back
		assert.deepEqual(texts(model.capped), ['买菜'], '4: un-completing brings only that row back');
		assert.equal(model.capped[0]!.task?.checked, false, '4: and back unchecked');

		void handler(rows[0]!, false); // 写周报 also back
		assert.deepEqual(texts(model.capped).sort(), ['买菜', '写周报'].sort(),
			'4: both rows are back once both are unchecked');
	}

	{
		// Same accumulation, opposite filter: each completed task must STAY in a
		// `WHERE completed` result as the next one is completed.
		const dql = 'TASK\nWHERE completed';
		const unchecked = rowsOf('TASK\nWHERE !completed', [sourcePage]);
		const { model, handler } = connectedHandler(dql, [sourcePage], rowsOf(dql, [sourcePage]));
		void handler(unchecked[0]!, true);
		assert.deepEqual(texts(model.capped), ['写周报'], '4b: the first completed task shows up');
		void handler(unchecked[1]!, true);
		assert.deepEqual(texts(model.capped).sort(), ['买菜', '写周报'].sort(),
			'4b: the second click keeps the first completed task in the result');
		assert.ok(model.capped.every(r => r.task?.checked), '4b: both rows read as done');
	}

	/* ----------------------------- 5. synchronous model ----------------------------- */

	{
		const dql = 'TASK\nWHERE !completed';
		const rows = rowsOf(dql, [sourcePage]);
		const { model, handler } = connectedHandler(dql, [sourcePage], rows);
		void handler(rows[0]!, true);
		// Read immediately, with no await: the list must already be right even
		// though the note write has not settled (it never does with noVaultApp).
		assert.deepEqual(texts(model.capped), ['买菜'],
			'5: the row model follows the click synchronously, before the write settles');
	}

	/* ----------------------------- 6. failed write rolls back ----------------------------- */

	{
		const dql = 'TASK\nWHERE !completed';
		const rows = rowsOf(dql, [sourcePage]);
		const { model, counters, handler } = connectedHandler(dql, [sourcePage], rows, failingApp());

		const realError = console.error;
		console.error = () => { /* the handler logs the failure; keep the output clean */ };
		let pending: void | Promise<void>;
		try {
			pending = handler(rows[0]!, true);
			assert.deepEqual(texts(model.capped), ['买菜'], '6: optimistic update happens first');
			assert.deepEqual(counters.prunes, [[keyOf(0)]], '6: and the row is dropped immediately');
			await pending;
		} finally {
			console.error = realError;
		}
		assert.deepEqual(texts(model.capped).sort(), ['买菜', '写周报'].sort(),
			'6: a failed write restores the row instead of lying about the note');
		assert.equal(model.capped.find(r => r.task?.text === '写周报')?.task?.checked, false,
			'6: and restores its previous state');
		assert.equal(counters.redraws, 1,
			'6: bringing a pruned row back needs one repaint — that is the only path that renders');
	}

	/* ----------------------------- 7. wiring ----------------------------- */

	const sectionSrc = readFileSync('src/dataview-section.ts', 'utf-8');
	const css = readFileSync('styles.css', 'utf-8');
	{
		assert.ok(sectionSrc.includes('export function makeTaskToggleHandler('),
			'7: the in-place toggle handler exists');
		assert.ok(sectionSrc.includes('function patchTaskChecked('),
			'7: the handler patches an accumulated page set');
		assert.equal((sectionSrc.match(/renderTaskCell\([^)]*rowToggler\(appRef, row, onTaskToggle, rerender\)\)/g) ?? []).length, 3,
			'7: all three row renderers (table, list, free) go through rowToggler');
		assert.equal((sectionSrc.match(/dataset\.rowKey = rowIdentity\(row\)/g) ?? []).length, 3,
			'7: every row element is keyed (table, list, free) so it can be dropped on its own');
		assert.ok(!/renderTaskCell\([^)]*\(\)\s*=>\s*rerender\?\.\(\)\)/.test(sectionSrc),
			'7: no TASK cell wires the raw section rerender any more');
		assert.ok(sectionSrc.includes('}, start, onTaskToggle);'),
			'7: the paginated body passes the handler down');
		assert.ok(sectionSrc.includes("host.closest('tr, .dashboard-dataview-list-item, .dashboard-dataview-free-item')"),
			'7: the done mirror finds the row, not just a sibling (table keeps the box in its own cell)');

		// The handler must never blank the container (that is the flash) and must
		// never re-scan the vault; the write happens behind it, not around it.
		const handlerSrc = sectionSrc.slice(
			sectionSrc.indexOf('export function makeTaskToggleHandler('),
			sectionSrc.indexOf('function renderResult('),
		);
		assert.ok(!handlerSrc.includes('.empty()'), '7: the handler never empties the container');
		assert.ok(!handlerSrc.includes('buildPages'), '7: the handler never re-scans the vault');
		assert.ok(handlerSrc.includes('surfaces.prune(gone)'),
			'7: the row-set change is applied as a keyed prune, not a repaint');
		assert.ok(!/pages\.map\(p =>/.test(handlerSrc),
			'7: the handler never re-patches the frozen snapshot (that resets earlier toggles)');

		// The checkbox no longer owns the write, so a second click cannot race it.
		const cellSrc = sectionSrc.slice(sectionSrc.indexOf('function renderTaskCell('));
		const cellBody = cellSrc.slice(0, cellSrc.indexOf('\n}\n'));
		assert.ok(!cellBody.includes('toggleTaskInFile'), '7: the cell no longer writes to disk before updating the model');
		assert.ok(cellBody.indexOf('onToggle(next)') < cellBody.indexOf('Promise.resolve'),
			'7: the model is handed the click before the write settles');
	}

	/* ----------------------------- 8. CSS ----------------------------- */

	assert.ok(/\.dashboard-dataview-task-text\.is-done\s*\{[^}]*line-through/.test(css),
		'8: the label-scoped done state the mirror flips actually paints');

	/* ----------------------------- 9. prune, not rebuild ----------------------------- */

	{
		const pruneIdx = sectionSrc.indexOf('const pruneRows = (rowKeys: readonly string[]): void => {');
		assert.ok(pruneIdx > 0, '9: the prune surface exists');
		const pruneSrc = sectionSrc.slice(pruneIdx, sectionSrc.indexOf('\n\t};', pruneIdx));
		assert.ok(pruneSrc.includes('[data-row-key]') && pruneSrc.includes('el.remove()'),
			'9: it removes only the keyed row elements — every other row keeps its DOM node');
		assert.ok(pruneSrc.includes('updateCount('),
			'9: the toolbar count follows the removal without touching the rows');

		// The previous attempt muted hover for one painted frame and then released
		// it — two visible steps per click, i.e. a double flash. Both halves are
		// gone now that nothing is rebuilt.
		assert.ok(!sectionSrc.includes('is-hover-muted'), '9: the hover-mute repaint hack is gone from the source');
		assert.ok(!css.includes('is-hover-muted'), '9: and from the stylesheet');
		assert.ok(!sectionSrc.includes('repaintRows'), '9: nothing repaints the body on a normal toggle');
	}

	console.log('dataview task toggle: all scenarios OK');
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
