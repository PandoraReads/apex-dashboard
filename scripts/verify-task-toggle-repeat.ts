/**
 * Verifies that toggling the SAME task object back and forth keeps writing.
 *
 * The day agenda (and todo cards) now update rows in place, so one task
 * object survives many flips — but toggleTaskInFile located the line by the
 * scanned `originalLine` verbatim. After the first flip (`- [ ]` → `- [x]`)
 * the stale originalLine no longer contained the marker the second flip
 * needed, the replacement equaled the file's line, and the write was
 * silently skipped: the checkbox could only sync state ONCE and the file
 * never saw the uncheck.
 *
 * Now the lookup uses a check-state-insensitive skeleton and flips whatever
 * marker the file currently holds; the task object's line/originalLine are
 * re-stamped after each write.
 *
 * Run: `npm run test:task-toggle-repeat`
 */
import { strict as assert } from 'node:assert';
import { TFile, type App } from 'obsidian';
import { toggleTaskInFile, type VaultTask } from '../src/alltasks-scan';

function makeVault(initial: string): { app: App; read: () => string } {
	const store = initial;
	let data = store;
	const file = new TFile();
	(file as unknown as { path: string }).path = '2026-11-04.md';
	const app = {
		vault: {
			process: async (_f: TFile, cb: (data: string) => string) => {
				data = cb(data);
				return data;
			},
		},
	};
	return { app: app as unknown as App, read: () => data };
}

function taskOf(line: string, lineNo: number): VaultTask {
	return {
		path: '2026-11-04.md',
		line: lineNo,
		originalLine: line,
		checked: false,
		text: '写周报',
		file: new TFile(),
		mtime: 0,
		ctime: 0,
	} as unknown as VaultTask;
}

async function main(): Promise<void> {
	const line = '- [ ] 写周报';
	// The task object AS SCANNED — it must survive many flips in place.
	const { app, read } = makeVault(`${line}\nother text\n`);

	const task = taskOf(line, 0);

	// 1st flip: unchecked → checked.
	assert.ok(await toggleTaskInFile(app, task, true), '1st toggle writes');
	assert.equal(read(), '- [x] 写周报\nother text\n', 'file checked');
	assert.equal(task.originalLine, '- [x] 写周报', 'task re-stamped after write');

	// 2nd flip on the SAME object: checked → unchecked (used to no-op).
	assert.ok(await toggleTaskInFile(app, task, false), '2nd toggle writes');
	assert.equal(read(), '- [ ] 写周报\nother text\n', 'file unchecked again');

	// 3rd flip: unchecked → checked again, via the file-shifted fallback.
	task.line = 99;
	assert.ok(await toggleTaskInFile(app, task, true), '3rd toggle writes via unique skeleton match');
	assert.equal(read(), '- [x] 写周报\nother text\n', 'file checked a second time');

	// Idempotent: toggling to the state the file already holds writes nothing.
	assert.equal(await toggleTaskInFile(app, task, true), false, 'no write when already checked');
	assert.equal(read(), '- [x] 写周报\nother text\n', 'file untouched on no-op');

	// Uppercase markers (some scanners write `- [X]`) uncheck cleanly.
	const up = makeVault('- [X] 买牛奶\n');
	const upTask = taskOf('- [X] 买牛奶', 0);
	assert.ok(await toggleTaskInFile(up.app, upTask, false), 'uppercase done unchecks');
	assert.equal(up.read(), '- [ ] 买牛奶\n', 'uppercase marker flipped to open');

	// Ambiguous skeleton (two identical task lines) refuses to write.
	const dup = makeVault('- [ ] 重复\n- [ ] 重复\n');
	const dupTask = taskOf('- [ ] 重复', 5);
	assert.equal(await toggleTaskInFile(dup.app, dupTask, true), false, 'ambiguous line refused');
	assert.equal(dup.read(), '- [ ] 重复\n- [ ] 重复\n', 'ambiguous file untouched');

	console.log('verify-task-toggle-repeat: OK');
}

void main();
