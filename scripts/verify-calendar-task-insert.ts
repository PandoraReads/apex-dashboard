import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { insertTaskForDay, type TaskInsertTarget } from '../src/daily-notes';
import { createTaskNote } from '../src/calendar-task-note';
import { buildTaskLine, scanFileTasks } from '../src/alltasks-scan';
import { taskDayTimeRange } from '../src/calendar-grid';

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

	// 9. Custom FILE target overrides the whole chain: today's daily note
	//    exists, but the task lands in the pinned file per position.
	{
		const { app, store } = makeApp({ [todayPath]: 'x\n', 'Notes/tasks.md': '---\ntype: tasks\n---\n\nExisting\n' });
		const line = '- [ ] pinned';
		const target = await insertTaskForDay(app, todayIso, line, 'Dashboard/dashboard', 'start', { kind: 'file', path: 'Notes/tasks' });
		assert.equal(target?.file.path, 'Notes/tasks.md', '9: lands in pinned file (.md appended)');
		const out = store.get('Notes/tasks.md')!;
		assert.ok(out.includes(line) && out.indexOf(line) < out.indexOf('Existing'), '9: start position');
	}

	// 10. Custom FOLDER target: one note per day named YYYY-MM-DD, created on
	//     the first task, appended on the second (end position).
	{
		const { app, store } = makeApp({ [todayPath]: 'x\n' });
		const t1 = await insertTaskForDay(app, futureIso, '- [ ] first', undefined, 'end', { kind: 'folder', path: 'Tasks' });
		assert.equal(t1?.file.path, `Tasks/${futureIso}.md`, '10a: created day note in folder');
		await insertTaskForDay(app, futureIso, '- [ ] second', undefined, 'end', { kind: 'folder', path: 'Tasks' });
		const out = store.get(`Tasks/${futureIso}.md`)!;
		assert.ok(out.includes('- [ ] first') && out.indexOf('- [ ] first') < out.indexOf('- [ ] second'), '10b: appended after first');
	}

	// 11. 'note' target passed through insertTaskForDay must NOT take the
	//     folder branch — it falls back to the default chain (the caller
	//     dispatches it to createTaskNote instead).
	{
		const { app, store } = makeApp({ [todayPath]: 'x\n' });
		const line = '- [ ] every task its own note';
		const target = await insertTaskForDay(app, todayIso, line, undefined, 'end', { kind: 'note', path: 'Tasks' });
		assert.equal(target?.kind, 'daily-end', '11: note kind falls through to daily chain');
		assert.ok(!store.has(`Tasks/${todayIso}.md`), '11: no folder note created');
	}

	// 12. 'note' mode via createTaskNote: bare note named "<iso> <title>",
	//     containing exactly the task line (marker kept for the scanner).
	{
		const { app, store } = makeApp({});
		const line = `- [ ] 买牛奶 📅 ${futureIso}`;
		const res = await createTaskNote(app, { iso: futureIso, taskLine: line, folder: 'Tasks', untitled: '待办' });
		assert.equal(res.kind, 'note-created', '12: kind');
		assert.equal(res.file.path, `Tasks/${futureIso} 买牛奶.md`, '12: date-prefixed title filename');
		assert.equal(store.get(`Tasks/${futureIso} 买牛奶.md`), `${line}\n`, '12: bare content is the task line');
		assert.equal(res.templateMissing, false, '12: no template configured');
		assert.equal(res.writtenLine, line, '12: writtenLine');
	}

	// 13. 'note' mode with a template: frontmatter kept, {{title}}/{{date}}
	//     substituted with the task title and day, task line appended after
	//     the body. A timed task's ⏰ time feeds {{time}}.
	{
		const tpl = '---\ntype: task\nproject: home\n---\n\n# {{title}}\n\nDue {{date}} at {{time}}\n';
		const { app, store } = makeApp({ 'Templates/task.md': tpl });
		const line = `- [ ] 买牛奶 ⏰ ${futureIso} 14:30`;
		const res = await createTaskNote(app, {
			iso: futureIso, taskLine: line, folder: 'Tasks',
			templatePath: 'Templates/task.md', untitled: '待办',
		});
		const out = store.get(`Tasks/${futureIso} 买牛奶.md`)!;
		assert.ok(out.includes('type: task'), '13: template frontmatter kept');
		assert.ok(out.includes('project: home'), '13: extra template props kept');
		assert.ok(out.includes('# 买牛奶'), '13: {{title}} substituted');
		assert.ok(out.includes(`Due ${futureIso} at 14:30`), '13: {{date}}/{{time}} = task day and ⏰ time');
		assert.ok(out.includes(line), '13: task line written');
		assert.ok(out.indexOf('at 14:30') < out.indexOf(line), '13: task line after the template body');
		assert.equal(res.templateMissing, false, '13: template found');
	}

	// 14. 'note' mode with a MISSING template: note still created bare,
	//     templateMissing flags the fallback.
	{
		const { app, store } = makeApp({});
		const line = `- [ ] urgent ⏰ ${futureIso} 09:00`;
		const res = await createTaskNote(app, {
			iso: futureIso, taskLine: line, folder: 'Tasks',
			templatePath: 'Templates/gone.md', untitled: '待办',
		});
		assert.equal(res.templateMissing, true, '14: templateMissing');
		assert.equal(store.get(`Tasks/${futureIso} urgent.md`), `${line}\n`, '14: bare fallback content');
	}

	// 15. 'note' mode filename collision: same day + same title uniques to -2.
	{
		const { app, store } = makeApp({ [`Tasks/${futureIso} 买牛奶.md`]: 'existing\n' });
		const res = await createTaskNote(app, { iso: futureIso, taskLine: `- [ ] 买牛奶 📅 ${futureIso}`, folder: 'Tasks', untitled: '待办' });
		assert.equal(res.file.path, `Tasks/${futureIso} 买牛奶-2.md`, '15: uniqued filename');
	}

	// 16. buildTaskLine: no group keeps the historical date-only anchor.
	{
		assert.equal(buildTaskLine('milk', futureIso, {}), `- [ ] milk 📅 ${futureIso}`, '16a: empty groups anchor via 📅');
		assert.equal(buildTaskLine('milk', futureIso, { start: {}, due: {}, scheduled: {} }), `- [ ] milk 📅 ${futureIso}`, '16b: all-empty groups same');
	}

	// 17. buildTaskLine: time-only groups anchor to the clicked day; full
	//     cross-day groups carry their own dates.
	{
		assert.equal(
			buildTaskLine('milk', futureIso, { start: { time: '09:30' } }),
			`- [ ] milk [start:: ${futureIso} 09:30]`,
			'17a: time-only start anchors to the day',
		);
		assert.equal(
			buildTaskLine('trip', todayIso, {
				start: { date: futureIso, time: '10:00' },
				due: { date: '2026-10-01', time: '18:00' },
				scheduled: { date: futureIso },
			}),
			`- [ ] trip [start:: ${futureIso} 10:00] [due:: 2026-10-01 18:00] [scheduled:: ${futureIso}]`,
			'17b: cross-day trio in start/due/scheduled order',
		);
		assert.equal(
			buildTaskLine('x', todayIso, { due: { date: futureIso } }),
			`- [ ] x [due:: ${futureIso}]`,
			'17c: date-only group writes date without time',
		);
	}

	// 18. scanFileTasks: START time wins over ⏰/due for the week-grid slot;
	//     a due time landing on the START's own day closes the block there.
	{
		const f = Object.assign(new TFile(), { path: 'x.md', stat: { mtime: 1, ctime: 1 } }) as TFile;
		const scan = (line: string) => scanFileTasks(f, `${line}\n`)[0]!;
		const both = scan(`- [ ] dual [start:: ${futureIso} 10:00] [due:: ${futureIso} 18:00]`);
		assert.equal(both.time, '10:00', '18a: start time wins');
		assert.equal(both.endTime, '18:00', '18b: same-day due closes the block');
		assert.equal(both.start, futureIso, '18c: start date parsed');
		assert.equal(both.due, futureIso, '18d: due date parsed');
		const cross = scan(`- [ ] trip [start:: ${futureIso} 10:00] [due:: 2026-10-01 09:00]`);
		assert.equal(cross.endTime, undefined, '18e: cross-day due does not size the block');
		const legacy = scan(`- [ ] old ⏰ ${futureIso} 14:30`);
		assert.equal(legacy.time, '14:30', '18f: ⏰-only tasks unchanged');
		const startOverReminder = scan(`- [ ] mix [start:: ${futureIso} 08:00] ⏰ ${futureIso} 14:30`);
		assert.equal(startOverReminder.time, '08:00', '18g: start beats ⏰');
		assert.equal(startOverReminder.endTime, '14:30', '18h: same-day ⏰ closes the block');
	}

	// 19. taskDayTimeRange: "10:00-18:00" when the block closes the same day.
	{
		const f = Object.assign(new TFile(), { path: 'x.md', stat: { mtime: 1, ctime: 1 } }) as TFile;
		const task = scanFileTasks(f, `- [ ] dual [start:: ${futureIso} 10:00] [due:: ${futureIso} 18:00]\n`)[0]!;
		assert.equal(taskDayTimeRange(task, futureIso), '10:00-18:00', '19a: range label');
		const single = scanFileTasks(f, `- [ ] plain [due:: ${futureIso} 09:00]\n`)[0]!;
		assert.equal(taskDayTimeRange(single, futureIso), '09:00', '19b: bare time without end');
	}

	// 20. createTaskNote with field markers: title strips them; filename day
	//     follows the [start::] date when it differs from the clicked day.
	{
		const { app, store } = makeApp({});
		const line = `- [ ] 写周报 [start:: 2026-10-05 09:00] [due:: 2026-10-06 18:00]`;
		const res = await createTaskNote(app, { iso: todayIso, taskLine: line, folder: 'Tasks', untitled: '待办' });
		assert.equal(res.file.path, 'Tasks/2026-10-05 写周报.md', '20a: filename day from start marker');
		const out = store.get('Tasks/2026-10-05 写周报.md')!;
		assert.ok(out.includes(line), '20b: task line kept verbatim');
	}

	// Sanity: returned targets always describe the written line.
	{
		const { app } = makeApp({ [todayPath]: 'x\n' });
		const target: TaskInsertTarget | null =
			await insertTaskForDay(app, todayIso, '- [ ] y', undefined, 'end');
		if (!target) throw new Error('sanity: expected a target');
		assert.equal(target.writtenLine, '- [ ] y', 'sanity: writtenLine');
	}

	console.log('verify-calendar-task-insert: 20 scenarios + sanity OK');
}

void main();
