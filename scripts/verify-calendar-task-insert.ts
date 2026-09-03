import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { insertTaskForDay, type TaskInsertTarget } from '../src/daily-notes';

// In-memory vault + core daily-notes plugin mock. TFile instances come from
// the alias stub, so the `instanceof TFile` checks inside daily-notes see the
// same class this file constructs.
interface MemFile extends TFile {
	path: string;
}

function makeApp(files: Record<string, string>, opts: { dailyNotes?: boolean; folder?: string } = {}): {
	app: App;
	store: Map<string, string>;
} {
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
			getPluginById: (id: string) => id === 'daily-notes' && opts.dailyNotes !== false
				? { enabled: true, instance: { options: { folder: opts.folder ?? 'daily', format: 'YYYY-MM-DD' } } }
				: undefined,
		},
	};
	return { app: app as unknown as App, store };
}

const isoOf = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main(): Promise<void> {
	const todayIso = isoOf(new Date());
	const futureIso = isoOf(new Date(Date.now() + 7 * 86400000));
	const todayPath = `daily/${todayIso}.md`;
	const futurePath = `daily/${futureIso}.md`;

	const FRONTMATTER_NOTE = '---\ntags: daily\n---\n\nExisting line\n';

	// 1. Clicked a future day, today's note exists -> task files into TODAY's
	//    note (top, below frontmatter), carrying the future-day 📅 marker.
	{
		const { app, store } = makeApp({ [todayPath]: FRONTMATTER_NOTE });
		const line = `- [ ] Future task 📅 ${futureIso}`;
		const target = await insertTaskForDay(app, futureIso, line, 'Dashboard/dashboard', 'start');
		assert.equal(target?.kind, 'daily-top', '1: kind');
		assert.equal(target?.file.path, todayPath, "1: lands in today's note");
		assert.equal(target?.line, 3, '1: inserted right below frontmatter');
		assert.ok(store.get(todayPath)!.includes(line), '1: marker line written');
	}

	// 2. Same, position 'end' -> appended at today's note bottom.
	{
		const { app, store } = makeApp({ [todayPath]: 'Existing line\n' });
		const line = `- [ ] Future task ⏰ ${futureIso} 14:30`;
		const target = await insertTaskForDay(app, futureIso, line, 'Dashboard/dashboard', 'end');
		assert.equal(target?.kind, 'daily-end', '2: kind');
		assert.equal(target?.file.path, todayPath, "2: lands in today's note");
		const lines = store.get(todayPath)!.split('\n');
		assert.equal(lines[lines.length - 2], line, '2: last content line is the task');
	}

	// 3. Future day, no note for today either -> dashboard file's list (kept).
	{
		const { app, store } = makeApp({ 'Dashboard/dashboard.md': '- [ ] Existing\n- [ ] Other\n' });
		const line = `- [ ] Future task 📅 ${futureIso}`;
		const target = await insertTaskForDay(app, futureIso, line, 'Dashboard/dashboard', 'start');
		assert.equal(target?.kind, 'dashboard-list', '3: kind');
		assert.equal(target?.file.path, 'Dashboard/dashboard.md', '3: dashboard file');
		assert.ok(store.get('Dashboard/dashboard.md')!.includes(line), '3: line in dashboard list');
	}

	// 4. Clicked today itself, note exists -> today's note as before.
	{
		const { app } = makeApp({ [todayPath]: 'Existing line\n' });
		const target = await insertTaskForDay(app, todayIso, '- [ ] Today task', 'Dashboard/dashboard', 'start');
		assert.equal(target?.kind, 'daily-top', '4: kind');
		assert.equal(target?.file.path, todayPath, "4: today's note");
	}

	// 5. Clicked a future day that DOES have a note -> that day's note wins (kept).
	{
		const { app, store } = makeApp({ [futurePath]: 'Pre-seeded travel note\n', [todayPath]: 'Today\n' });
		const line = `- [ ] Trip task 📅 ${futureIso}`;
		const target = await insertTaskForDay(app, futureIso, line, 'Dashboard/dashboard', 'start');
		assert.equal(target?.file.path, futurePath, "5: clicked day's own note wins");
		assert.ok(store.get(futurePath)!.includes(line), '5: line in future note');
		assert.ok(!store.get(todayPath)!.includes('Trip task'), "5: today's note untouched");
	}

	// 6. Daily Notes plugin disabled, dashboard exists -> dashboard list.
	{
		const { app } = makeApp({ 'Dashboard/dashboard.md': '- [ ] Existing\n' }, { dailyNotes: false });
		const target = await insertTaskForDay(app, futureIso, '- [ ] task', 'Dashboard/dashboard', 'start');
		assert.equal(target?.kind, 'dashboard-list', '6: kind');
	}

	// 7. Daily Notes plugin disabled AND no dashboard -> null (caller shows hint).
	{
		const { app } = makeApp({}, { dailyNotes: false });
		const target = await insertTaskForDay(app, futureIso, '- [ ] task', '', 'start');
		assert.equal(target, null, '7: null');
	}

	// 8. Nothing anywhere -> last resort creates the clicked day's note.
	{
		const { app, store } = makeApp({}, { folder: 'daily' });
		const line = `- [ ] Lonely task 📅 ${futureIso}`;
		const target = await insertTaskForDay(app, futureIso, line, 'missing/dashboard', 'start');
		assert.equal(target?.kind, 'daily-created', '8: kind');
		assert.equal(target?.file.path, futurePath, "8: created the clicked day's note");
		assert.ok(store.get(futurePath)!.includes(line), '8: line in created note');
	}

	// Sanity: returned targets always describe the written line.
	{
		const { app } = makeApp({ [todayPath]: 'x\n' });
		const target: TaskInsertTarget | null =
			await insertTaskForDay(app, todayIso, '- [ ] y', undefined, 'end');
		if (!target) throw new Error('sanity: expected a target');
		assert.equal(target.writtenLine, '- [ ] y', 'sanity: writtenLine');
	}

	console.log('verify-calendar-task-insert: 8 scenarios + sanity OK');
}

void main();
