/**
 * Verifies the per-card "heading level in the daily note" config
 * (`card.dailyHeadingLevel`, edited in the task-card config dialog):
 *
 * 1. `dailyBlockHeading` renders `#` × level and clamps junk input to 1-6.
 * 2. Parser round-trip: a non-default level persists as one metadata line and
 *    parses back; the default 3 stays unpersisted.
 * 3. Section helpers are level-aware: a `#### Title` block keeps its `#####`
 *    subheadings and is closed by the next `##`/`###`/`####` heading.
 * 4. `writeCardTasksToToday` / `readCardTasksFromToday` honour the level.
 * 5. `retitleCardBlock` MOVES an existing block to the new level instead of
 *    letting a second copy appear.
 *
 * Run: `npm run test:task-heading-level`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { parse, serialize } from '../src/parser';
import { dailyBlockHeading, extractDailyTasksBlock, replaceDailyTasksBlock } from '../src/daily-note-block';
import { readCardTasksFromToday, retitleCardBlock, writeCardTasksToToday } from '../src/daily-task-source';
import type { DashboardData } from '../src/types';

interface MemFile extends TFile {
	path: string;
}

function makeApp(files: Record<string, string>): { app: App; store: Map<string, string> } {
	const store = new Map(Object.entries(files));
	const fileOf = (path: string): MemFile => Object.assign(new TFile(), { path }) as MemFile;
	const app = {
		vault: {
			adapter: {
				exists: async (p: string) => store.has(p),
				mkdir: async () => {},
			},
			getAbstractFileByPath: (p: string) => (store.has(p) ? fileOf(p) : null),
			getFileByPath: (p: string) => (store.has(p) ? fileOf(p) : null),
			read: async (f: MemFile) => store.get(f.path) ?? '',
			modify: async (f: MemFile, c: string) => { store.set(f.path, c); },
			create: async (p: string, c: string) => { store.set(p, c); return fileOf(p); },
		},
		internalPlugins: {
			getPluginById: (id: string) => id === 'daily-notes'
				? { enabled: true, instance: { options: { folder: 'daily', format: 'YYYY-MM-DD' } } }
				: undefined,
		},
	};
	return { app: app as unknown as App, store };
}

const isoOf = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayIso = isoOf(new Date());
const todayPath = `daily/${todayIso}.md`;

function withCard(level?: 1 | 2 | 3 | 4 | 5 | 6): DashboardData {
	const data = parse([
		'---',
		'dashboard: true',
		'banner:',
		'  quote: ""',
		'  author: ""',
		'---',
		'',
		'## Todo',
		'',
		'### My tasks',
		'id: card-1',
		'type: task',
		'- [ ] alpha',
		'',
	].join('\n'));
	const card = data.columns[0]!.cards[0]!;
	assert.equal(card.type, 'task', 'fixture parses as a task card');
	if (level) card.dailyHeadingLevel = level;
	else delete card.dailyHeadingLevel;
	return data;
}

async function main(): Promise<void> {
	// 1. Heading rendering + clamping.
	{
		assert.equal(dailyBlockHeading('Jobs', 4), '#### Jobs', '1a: level 4');
		assert.equal(dailyBlockHeading('Jobs'), '### Jobs', '1b: default stays ###');
		assert.equal(dailyBlockHeading('Jobs', 0), '### Jobs', '1c: junk level falls back to the default');
		assert.equal(dailyBlockHeading('Jobs', 9), '###### Jobs', '1d: level clamps down to 6');
	}

	// 2. Parser round-trip; default 3 writes no line.
	{
		for (const level of [1, 2, 4, 5, 6] as const) {
			const md = serialize(withCard(level));
			assert.ok(md.includes(`dailyHeadingLevel: ${level}`), `2a: level ${level} persists a metadata line`);
			assert.equal(parse(md).columns[0]!.cards[0]!.dailyHeadingLevel, level, `2a: level ${level} parses back`);
		}
		const defMd = serialize(withCard(undefined));
		assert.ok(!defMd.includes('dailyHeadingLevel'), '2b: default 3 writes no metadata line');
		assert.equal(parse(defMd).columns[0]!.cards[0]!.dailyHeadingLevel, undefined, '2b: default parses to undefined');

		// Explicit 3 is the default → still unpersisted, still undefined.
		const three = serialize(withCard(3));
		assert.ok(!three.includes('dailyHeadingLevel'), '2c: explicit 3 is the default and stays unpersisted');

		// Junk value is ignored rather than trusted.
		const junk = serialize(withCard(4)).replace(/dailyHeadingLevel: 4/, 'dailyHeadingLevel: 9');
		assert.equal(parse(junk).columns[0]!.cards[0]!.dailyHeadingLevel, undefined, '2d: out-of-range value → undefined');
	}

	// 3. Level-aware section boundaries.
	{
		const md = '## Day\n- [ ] outside\n#### Title\n- [ ] a\n##### sub\n- [ ] b\n#### Other\n- [ ] c\n';
		assert.equal(extractDailyTasksBlock(md, '#### Title'), '- [ ] a\n##### sub\n- [ ] b',
			'3a: a #### block keeps its ##### subheadings and stops at the next ####');
		assert.equal(extractDailyTasksBlock(md, '### Title'), null, '3b: heading match is exact');

		const replaced = replaceDailyTasksBlock('#### Title\n- [ ] old\n#### Next\nx\n', '#### Title', [
			{ text: 'new', checked: false },
		]);
		assert.ok(replaced !== null && replaced.includes('- [ ] new') && !replaced.includes('- [ ] old'),
			'3c: replace works at level 4');
		assert.ok(replaced!.includes('#### Next'), '3d: the following section survives');
	}

	// 4. Write / read honour the configured level.
	{
		const { app, store } = makeApp({});
		await writeCardTasksToToday(app, 'My tasks', [{ text: 'alpha', checked: false }], 4);
		const md = store.get(todayPath) ?? '';
		assert.ok(md.includes('#### My tasks'), '4a: block written at the configured level');
		assert.ok(!md.split('\n').some(l => l.trim() === '### My tasks'), '4b: no default-level block leaked in');
		const read = await readCardTasksFromToday(app, 'My tasks', 4);
		assert.equal(read?.[0]?.text, 'alpha', '4c: read back at the same level');

		// A legacy ### block is still found when the level changed.
		const legacy = makeApp({ [todayPath]: '### My tasks\n- [ ] legacy\n' });
		const fallback = await readCardTasksFromToday(legacy.app, 'My tasks', 5);
		assert.equal(fallback?.[0]?.text, 'legacy', '4d: falls back to the historical ### block');
	}

	// 5. Level change MOVES the block instead of duplicating it.
	{
		const { app, store } = makeApp({ [todayPath]: '## Day\n\n### My tasks\n- [ ] alpha\n\n### Next\n- [ ] z\n' });
		const file = app.vault.getFileByPath(todayPath)!;
		const changed = await retitleCardBlock(app, file, 'My tasks', 4);
		assert.equal(changed, true, '5a: retitle reports a change');
		const md = store.get(todayPath)!;
		assert.ok(md.includes('#### My tasks'), '5b: heading moved to level 4');
		assert.ok(!md.split('\n').some(l => l.trim() === '### My tasks'), '5c: old heading gone — no duplicate block');
		assert.equal((md.match(/- \[ \] alpha/g) ?? []).length, 1, '5d: the task list exists exactly once');
		assert.ok(md.includes('### Next'), '5e: sibling sections untouched');

		const again = await retitleCardBlock(app, file, 'My tasks', 4);
		assert.equal(again, false, '5f: idempotent — nothing to rename');
	}

	// 6. Wiring: card config dialog + view pass the level down.
	{
		const modal = await import('node:fs').then(fs => fs.readFileSync('src/task-card-config-modal.ts', 'utf8'));
		assert.ok(modal.includes("t('taskConfig.headingLevel')"), '6a: dialog exposes the heading level');
		const view = await import('node:fs').then(fs => fs.readFileSync('src/view.ts', 'utf8'));
		assert.ok(view.includes('dailyBlockHeading(title, card.dailyHeadingLevel ?? 3)'), '6b: save-to-daily uses the level');
		assert.ok(view.includes('retitleCardBlock(this.app'), '6c: level changes move the existing block');
		const sync = await import('node:fs').then(fs => fs.readFileSync('src/sync.ts', 'utf8'));
		assert.ok(sync.includes('card.dailyHeadingLevel ?? 3'), '6d: mirror writes use the level');
	}

	console.log('verify-task-heading-level: all checks passed');
}

void main();
