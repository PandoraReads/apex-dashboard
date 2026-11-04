/**
 * Verifies the per-card "load tasks from today's daily note" config
 * (`card.tasksFromDaily`):
 *
 * 1. `extractDailyTasksBlock` scopes to the card's `### <title>` section.
 * 2. `readCardTasksFromToday` reads exactly that section (nested tasks and
 *    ⏰ reminders included), and reports null when there is nothing to read.
 * 3. `writeCardTasksToToday` merges card edits back into the same section,
 *    appends the block when missing and creates today's note when missing.
 * 4. Parser round-trip: the flag persists as one metadata line while the task
 *    lines are NOT written into the dashboard file (the note owns them).
 * 5. Wiring: renderer menu item → view handler → sync hydration + mirror.
 *
 * Run: `npm run test:task-daily-source`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { TFile, type App } from 'obsidian';
import { parse, serialize } from '../src/parser';
import { extractDailyTasksBlock } from '../src/daily-note-block';
import { readCardTasksFromToday, writeCardTasksToToday } from '../src/daily-task-source';
import type { DashboardData, TaskItem } from '../src/types';

interface MemFile extends TFile {
	path: string;
}

function makeApp(files: Record<string, string>, dailyNotes = true): { app: App; store: Map<string, string> } {
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
			getPluginById: (id: string) => id === 'daily-notes' && dailyNotes
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
const HEADING = '### My tasks';

function withCard(fromDaily: boolean, tasks = true): DashboardData {
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
		...(tasks ? ['- [ ] old task'] : []),
		'',
	].join('\n'));
	const card = data.columns[0]!.cards[0]!;
	if (fromDaily) card.tasksFromDaily = true;
	else delete card.tasksFromDaily;
	return data;
}

async function main(): Promise<void> {
	// 1. Section extraction stops at the next heading, heading absent → null.
	{
		const md = `## Day\n- [ ] outside\n${HEADING}\n- [ ] b\n    - [ ] b1\n### Other\n- [ ] c\n`;
		assert.equal(extractDailyTasksBlock(md, HEADING), '- [ ] b\n    - [ ] b1', '1a: scoped to the section');
		assert.equal(extractDailyTasksBlock(md, '### Nope'), null, '1b: missing heading → null');
		assert.equal(extractDailyTasksBlock(`${HEADING}\n`, HEADING), '', '1c: empty section → empty text');
	}

	// 2. Reading: only the card's section, nesting + reminder preserved.
	{
		const note = [
			'## Journal',
			'- [ ] not mine',
			HEADING,
			'- [ ] mine',
			'    - [x] child ⏰ 2026-11-03 09:30',
			'### Another card',
			'- [ ] someone else',
			'',
		].join('\n');
		const { app } = makeApp({ [todayPath]: note });
		const tasks = await readCardTasksFromToday(app, 'My tasks');
		assert.ok(tasks, '2a: block found');
		assert.equal(tasks!.length, 1, '2b: only the section tasks');
		assert.equal(tasks![0]!.text, 'mine', '2c: text');
		assert.equal(tasks![0]!.children?.[0]?.checked, true, '2d: nested child checked');
		assert.equal(tasks![0]!.children?.[0]?.reminder, '2026-11-03 09:30', '2e: reminder kept');
	}

	// 2f. Nothing to read: no note / no block / core plugin off.
	{
		const none = makeApp({});
		assert.equal(await readCardTasksFromToday(none.app, 'My tasks'), null, '2f: no note → null');

		const noBlock = makeApp({ [todayPath]: '## Journal\n- [ ] x\n' });
		assert.equal(await readCardTasksFromToday(noBlock.app, 'My tasks'), null, '2g: no block → null');

		const off = makeApp({ [todayPath]: `${HEADING}\n- [ ] x\n` }, false);
		assert.equal(await readCardTasksFromToday(off.app, 'My tasks'), null, '2h: core plugin off → null');
	}

	// 3. Writing back: the block's task lines are replaced by the card's list
	//    (a deletion must propagate), prose in the section and other sections
	//    are untouched.
	{
		const note = `## Journal\n- [ ] not mine\n${HEADING}\n- [ ] mine\n- [ ] hand written\nnote about this list\n### Other\n- [ ] keep\n`;
		const { app, store } = makeApp({ [todayPath]: note });
		const tasks: TaskItem[] = [
			{ text: 'mine', checked: true },
			{ text: 'brand new', checked: false },
		];
		assert.equal(await writeCardTasksToToday(app, 'My tasks', tasks), true, '3a: write reported');
		const out = store.get(todayPath)!;
		assert.ok(out.includes('- [x] mine'), '3b: existing entry updated');
		assert.ok(out.includes('- [ ] brand new'), '3c: new entry written');
		assert.ok(!out.includes('- [ ] hand written'), '3d: dropped task really disappears from the block');
		assert.ok(out.includes('note about this list'), '3e: prose inside the block preserved');
		assert.ok(out.includes('- [ ] not mine'), '3f: other sections untouched');
		assert.equal(out.indexOf('- [ ] brand new') < out.indexOf('### Other'), true, '3g: written inside the block');
	}

	// 3m. The blank separator before the next heading survives, and re-writing
	//     the same list is byte-identical (no blank-line growth per save).
	{
		const note = `${HEADING}\n- [ ] a\n\n### Other\n- [ ] keep\n`;
		const { app, store } = makeApp({ [todayPath]: note });
		await writeCardTasksToToday(app, 'My tasks', [{ text: 'a', checked: false }]);
		const once = store.get(todayPath)!;
		assert.ok(once.includes('- [ ] a\n\n### Other'), '3m: blank separator kept');
		await writeCardTasksToToday(app, 'My tasks', [{ text: 'a', checked: false }]);
		assert.equal(store.get(todayPath), once, '3n: re-write is idempotent');
	}

	// 3g. No block yet → appended as a new section at the note's end.
	{
		const { app, store } = makeApp({ [todayPath]: '## Journal\n- [ ] x\n' });
		await writeCardTasksToToday(app, 'My tasks', [{ text: 'fresh', checked: false }]);
		const out = store.get(todayPath)!;
		assert.ok(out.includes(HEADING), '3g: block heading created');
		assert.ok(out.trimEnd().endsWith('- [ ] fresh'), '3h: task written under it');
		assert.ok(out.includes('- [ ] x'), '3i: existing note content kept');
	}

	// 3j. No note at all → today's note is created.
	{
		const { app, store } = makeApp({});
		await writeCardTasksToToday(app, 'My tasks', [{ text: 'first', checked: false }]);
		const out = store.get(todayPath);
		assert.ok(out?.includes(HEADING), '3j: note created with the block');
	}

	// 3k. Core Daily notes plugin off → nothing written.
	{
		const { app, store } = makeApp({ [todayPath]: `${HEADING}\n- [ ] x\n` }, false);
		assert.equal(await writeCardTasksToToday(app, 'My tasks', []), false, '3k: no write without the core plugin');
		assert.ok(store.get(todayPath)!.includes('- [ ] x'), '3l: note untouched');
	}

	// 4. Round-trip: flag persisted, task lines NOT (the note owns them).
	{
		const onMd = serialize(withCard(true));
		assert.ok(onMd.includes('tasksFromDaily: true'), '4a: flag serialized');
		assert.ok(!onMd.includes('old task'), '4b: task list not persisted in the dashboard file');
		const back = parse(onMd).columns[0]!.cards[0]!;
		assert.equal(back.tasksFromDaily, true, '4c: flag parses back');
		assert.equal(back.tasks.length, 0, '4d: no tasks parsed (hydrated from the note)');

		const offMd = serialize(withCard(false));
		assert.ok(!offMd.includes('tasksFromDaily'), '4e: default writes no metadata line');
		assert.ok(offMd.includes('old task'), '4f: a normal card still persists its tasks');
		assert.equal(parse(offMd).columns[0]!.cards[0]!.tasks.length, 1, '4g: tasks parse back');

		// Toggling the flag off re-persists the hydrated list.
		const toggled = withCard(true);
		toggled.columns[0]!.cards[0]!.tasks = [{ text: 'hydrated', checked: false }];
		delete toggled.columns[0]!.cards[0]!.tasksFromDaily;
		const toggledMd = serialize(toggled);
		assert.ok(toggledMd.includes('- [ ] hydrated'), '4h: disabling keeps the hydrated tasks');
	}

	// 5. Wiring across the layers.
	{
		const parser = readFileSync('src/parser.ts', 'utf8');
		assert.ok(parser.includes('card.tasks.length > 0 && !card.tasksFromDaily'), '5a: serialize skips mirrored tasks');
		assert.ok(parser.includes("'tasksFromDaily'"), '5b: metadata key registered');

		const sync = readFileSync('src/sync.ts', 'utf8');
		assert.ok(sync.includes('writeCardTasksToToday'), '5c: sync mirrors into the note');
		assert.ok((sync.match(/await this\.commitTasks\(/g) ?? []).length >= 8, '5d: every task mutator commits');
		assert.ok(sync.includes('await this.refreshDailyLinkedTasks();'), '5e: load hydrates mirrored cards');
		assert.ok(sync.includes("'taskCompleteBehavior' | 'tasksFromDaily'"), '5f: updateCard accepts the flag');

		const renderer = readFileSync('src/renderer.ts', 'utf8');
		assert.ok(renderer.includes('new TaskCardConfigModal(app, card'), '5g: the gear opens the config dialog');
		assert.ok(renderer.includes('onTaskCardConfigSave'), '5h: dialog saves through the callback');

		const modal = readFileSync('src/task-card-config-modal.ts', 'utf8');
		assert.ok(modal.includes("t('renderer.tasksFromDaily')"), '5h2: dialog hosts the daily-source toggle');

		const view = readFileSync('src/view.ts', 'utf8');
		assert.ok(view.includes('private async applyTaskCardConfig'), '5i: view applies the config in one pass');
		assert.ok(view.includes('getDailyNotesConfig(this.app)'), '5j: enabling requires the core Daily notes plugin');
		assert.ok(view.includes('void this.refreshDailyLinkedCards();'), '5k: note edits re-read the cards');
		assert.ok(view.includes('writeCardTasksToToday(this.app, card.title'), '5l: enabling seeds the note first (no task loss)');
	}

	console.log('verify-task-daily-source: all checks passed');
}

void main();
