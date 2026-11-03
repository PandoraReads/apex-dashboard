/**
 * Verifies the calendar rescan sees a task that was JUST written.
 *
 * `collectVaultTasks` has two shortcuts that both go stale right after this
 * plugin writes a note:
 *
 *  1. the metadata pre-filter (skip files Obsidian says contain no checkbox
 *     items) — Obsidian reindexes asynchronously, so a note that just gained
 *     its first task still looks task-free;
 *  2. `vault.cachedRead` — the vault's cached snapshot can still be the
 *     pre-write content for a beat.
 *
 * The user-visible symptom was: add a task in a day agenda → the calendar card
 * does not change → clicking the day again shows nothing, until a view switch.
 *
 * `invalidatePath` (called on the written path before the refresh nudge) must
 * force the next scan to read that file from DISK and skip the pre-filter.
 *
 * Run: `npm run test:task-scan-freshness`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { collectVaultTasks, invalidatePath } from '../src/alltasks-scan';

interface Stub {
	app: App;
	writes: { cached: number; disk: number };
}

/** Vault whose cached snapshot lags one write behind the file on disk, plus a
 *  metadata cache that still reports "no checkbox items" for it. */
function makeApp(fresh: string, metaLagging = true): Stub {
	const file = Object.assign(new TFile(), {
		path: 'daily/2026-11-03.md',
		stat: { mtime: 2000, ctime: 1000 },
	}) as TFile;
	const stale = 'Just a heading\n';
	const writes = { cached: 0, disk: 0 };
	const app = {
		vault: {
			getMarkdownFiles: () => [file],
			cachedRead: async () => { writes.cached++; return stale; },
			read: async () => { writes.disk++; return fresh; },
		},
		metadataCache: {
			// fc.mtime >= stat.mtime → "fresh" by mtime, yet listItems is empty:
			// exactly the reindex lag the pre-filter cannot tell apart.
			getFileCache: () => (metaLagging ? { mtime: 2000, listItems: [] } : { mtime: 2000, listItems: [{}] }),
		},
	};
	return { app: app as unknown as App, writes };
}

async function main(): Promise<void> {
	const fresh = '- [ ] 刚加的任务\n';

	// 1. Baseline: a lagging cachedRead / metadata cache hides the new task.
	{
		const { app, writes } = makeApp(fresh);
		const tasks = await collectVaultTasks(app, [], undefined);
		assert.equal(tasks.length, 0, '1a: stale caches hide the task');
		assert.equal(writes.disk, 0, '1b: never touches the disk in the normal path');
	}

	// 2. After invalidatePath the scan reads from disk and skips the pre-filter.
	{
		const { app, writes } = makeApp(fresh);
		invalidatePath('daily/2026-11-03.md');
		const tasks = await collectVaultTasks(app, [], undefined);
		assert.equal(tasks.length, 1, '2a: the just-written task is picked up');
		assert.equal(tasks[0]?.text, '刚加的任务', '2b: parsed from the fresh content');
		assert.ok(writes.disk > 0, '2c: read from disk (vault.read), not the cached snapshot');
	}

	// 3. The force flag is one-shot: later scans return to the cheap cached path.
	{
		const { app, writes } = makeApp(fresh);
		invalidatePath('daily/2026-11-03.md');
		await collectVaultTasks(app, [], undefined);
		const diskAfterFirst = writes.disk;
		// The module cache now holds the fresh content, so the second scan is a
		// pure hit (no read at all) — the force flag must not linger.
		await collectVaultTasks(app, [], undefined);
		assert.equal(writes.disk, diskAfterFirst, '3a: no repeat disk read');
	}

	// 4. A healthy metadata cache keeps the pre-filter (no regression to a
	//    full-vault read).
	{
		const { app, writes } = makeApp(fresh, false);
		invalidatePath('daily/2026-11-03.md');
		const tasks = await collectVaultTasks(app, [], undefined);
		assert.equal(tasks.length, 1, '4a: task found');
		assert.ok(writes.disk > 0, '4b: still a forced disk read for the invalidated path');
	}

	console.log('verify-task-scan-freshness: 4 scenarios OK');
}

void main();
