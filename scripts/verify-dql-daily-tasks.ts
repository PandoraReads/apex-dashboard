/**
 * Verifies the DQL recipes for "unfinished tasks in daily notes":
 *
 * 1. TASK + FROM folder + WHERE !completed — one row per unfinished task,
 *    completed ones filtered out, every row carrying its task payload.
 * 2. date() idempotency — `date(today)` used to re-parse its own ISO string
 *    and land on UTC midnight, so `file.day = date(today)` missed every
 *    daily note outside UTC (the "today" query came back empty). The local
 *    midnight must survive: equality, `<` ranges and dateformat all agree.
 * 3. Scoping variants — due-date filters (due / overdue / next 7 days),
 *    keyword on the task text, and the recent-N-days window.
 *
 * Run: `npm run test:dql-daily-tasks`
 */
import { strict as assert } from 'node:assert';
import { executeDql } from '../src/dql';
import type { Page } from '../src/dql/types';

const pad = (n: number): string => String(n).padStart(2, '0');
const isoDay = (offsetDays: number): string => {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localStamps = (day: string): number => Date.parse(`${day}T00:00:00`);

type TaskSpec = [checked: boolean, text: string, due?: string];

const dailyPage = (day: string, tasks: TaskSpec[]): Page => ({
	file: { path: `01-日记/${day}.md`, basename: day, stat: { ctime: 0, mtime: 0, size: 0 } },
	fields: {
		'file.name': day,
		'file.path': `01-日记/${day}.md`,
		'file.folder': '01-日记',
		'file.day': { kind: 'date', ts: localStamps(day) },
		'file.tags': [],
		'file.tasks': tasks.map(([checked, text, due]) => ({
			kind: 'object',
			entries: {
				completed: checked,
				checked,
				text,
				due: due ? { kind: 'date', ts: localStamps(due) } : null,
				priority: null,
				link: { kind: 'link', path: `01-日记/${day}.md` },
				__line: 0,
				__original: '',
				__path: `01-日记/${day}.md`,
			},
		})),
	},
} as unknown as Page);

const today = isoDay(0);
const yesterday = isoDay(-1);
const lastWeek = isoDay(-7);
const pages: Page[] = [
	dailyPage(yesterday, [[false, '写周报'], [true, '买菜']]),
	dailyPage(lastWeek, [[false, '旧任务']]),
	dailyPage(today, [[false, '交报告', isoDay(-2)], [false, '看牙', isoDay(20)], [true, '倒垃圾']]),
];

/** Run a query and return the task texts it yielded. */
const taskTexts = (dql: string): string[] => {
	const out = executeDql(dql, pages);
	assert.ok(out.ok, `query runs: ${dql}`);
	if (out.empty) return [];
	return (out.result.rows as ReadonlyArray<{ task?: { text: string } }>).map(r => r.task?.text ?? '');
};

const run = (): void => {
	// --- 1. Every unfinished task in the daily-note folder --------------------
	{
		const texts = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed\nSORT file.name DESC');
		assert.deepEqual(texts.sort(), ['交报告', '写周报', '旧任务', '看牙'].sort(),
			'1: only unfinished tasks, one row each');
		assert.ok(!texts.includes('买菜') && !texts.includes('倒垃圾'),
			'1: completed tasks are filtered out');

		// Folder scoping keeps other folders out.
		const elsewhere: Page[] = [{
			file: { path: '备忘/x.md', basename: 'x', stat: { ctime: 0, mtime: 0, size: 0 } },
			fields: {
				'file.path': '备忘/x.md', 'file.name': 'x', 'file.folder': '备忘',
				'file.day': null, 'file.tags': [],
				'file.tasks': [{
					kind: 'object',
					entries: {
						completed: false, checked: false, text: '不在日记里', due: null,
						priority: null, link: { kind: 'link', path: '备忘/x.md' },
						__line: 0, __original: '', __path: '备忘/x.md',
					},
				}],
			},
		} as unknown as Page];
		const scoped = executeDql('TASK\nFROM "01-日记"\nWHERE !completed', [...pages, ...elsewhere]);
		assert.ok(scoped.ok && !scoped.empty);
		const texts2 = (scoped.result.rows as ReadonlyArray<{ task?: { text: string } }>).map(r => r.task?.text);
		assert.ok(!texts2.includes('不在日记里'), '1: FROM limits the scan to the folder');

		// Task rows carry the interactive payload (checkbox toggles write back).
		const withPayload = executeDql('TASK\nFROM "01-日记"\nWHERE !completed', pages);
		assert.ok(withPayload.ok && !withPayload.empty);
		const row = (withPayload.result.rows as ReadonlyArray<{ task?: { path: string; line: number } }>)[0]!;
		assert.equal(row.task?.path, `01-日记/${yesterday}.md`, '1: rows keep the source path');
		assert.equal(row.task?.line, 0, '1: rows keep the source line');
	}

	// --- 2. date() idempotency: "today" survives the round trip ---------------
	{
		// date(today) must stay LOCAL midnight; re-parsing its ISO form turned
		// it into UTC midnight, which made today's note unreachable in UTC+8.
		const texts = taskTexts(`TASK\nFROM "01-日记"\nWHERE !completed AND file.day = date(today)`);
		assert.deepEqual(texts.sort(), ['交报告', '看牙'], '2: equality against date(today) matches today only');
		const plain = taskTexts(`TASK\nFROM "01-日记"\nWHERE !completed AND file.day = today`);
		assert.deepEqual(plain.sort(), ['交报告', '看牙'], '2: the bare `today` literal agrees');
		const range = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND file.day >= date(today) AND file.day < date(tomorrow)');
		assert.deepEqual(range.sort(), ['交报告', '看牙'], '2: a >= today / < tomorrow range agrees');
		const formatted = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND dateformat(file.day, "yyyy-MM-dd") = dateformat(date(today), "yyyy-MM-dd")');
		assert.deepEqual(formatted.sort(), ['交报告', '看牙'], '2: the dateformat form agrees');
	}

	// --- 3. Scoping variants -------------------------------------------------
	{
		const withDue = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND due\nSORT due ASC');
		assert.deepEqual(withDue, ['交报告', '看牙'], '3: `due` keeps only dated tasks, ascending');

		const overdue = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND due AND due <= date(today)');
		assert.deepEqual(overdue, ['交报告'], '3: overdue = due today or earlier');

		const soon = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND due AND due <= date(today) + dur("7 days")');
		assert.deepEqual(soon, ['交报告'], '3: the 7-day window excludes far-future tasks');

		const week = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND file.day >= date(today) - dur("7 days")');
		assert.ok(week.includes('旧任务'), '3: the 7-day window is inclusive of the boundary note');
		const recent = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND file.day >= date(today) - dur("6 days")');
		assert.deepEqual(recent.sort(), ['交报告', '写周报', '看牙'].sort(), '3: a 6-day window drops the older note');

		const keyword = taskTexts('TASK\nFROM "01-日记"\nWHERE !completed AND contains(text, "报告")');
		assert.deepEqual(keyword, ['交报告'], '3: task text is addressable (`text`)');
	}
};

run();
console.log('dql daily tasks: ALL PASS');
