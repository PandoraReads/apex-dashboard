/**
 * Verifies the calendar day-agenda "include the day's daily-note tasks" feature:
 *
 * The vault-wide scan only surfaces tasks carrying date markers (⏰/📅/
 * [due::]/[start::]/…), so a day's daily-note checkboxes — the ones users type
 * straight into the note — never reached the day agenda. The agenda now reads
 * that day's note directly and merges its tasks into the list.
 *
 * 1. Setting: `calendarIncludeDailyNoteTasks` (default true) + settings-tab
 *    toggle; the agenda reads it live on every open.
 * 2. Note resolution mirrors the add path: pinned folder target's
 *    YYYY-MM-DD note, else the Daily Notes plugin's path for that day.
 * 3. Merge is deduped by vault path + line (a note task that also carries
 *    this day's marker arrives via the scan too) and shares the agenda's
 *    time sort.
 *
 * Run: `npm run test:calendar-daily-tasks`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const modalSrc = readFileSync('src/calendar-modal.ts', 'utf-8');
const typesSrc = readFileSync('src/types.ts', 'utf-8');
const settingsSrc = readFileSync('src/settings.ts', 'utf-8');

// 1. Setting + default.
assert.ok(typesSrc.includes('calendarIncludeDailyNoteTasks: boolean;'),
	'types declare the setting');
assert.ok(/calendarIncludeDailyNoteTasks: true/.test(typesSrc),
	'default is on (the feature the config exists to switch off)');

// Agenda reads it LIVE (per open) and treats a missing legacy value as true.
assert.ok(modalSrc.includes('function readIncludeDailyTasks('),
	'agenda-side reader exists');
assert.ok(modalSrc.includes("?.settings?.calendarIncludeDailyNoteTasks !== false"),
	'missing setting (legacy data.json) counts as enabled');

// 2. Note resolution mirrors the add path.
{
	const fnIdx = modalSrc.indexOf('private async loadDailyNoteTasks');
	assert.ok(fnIdx > 0, 'agenda loads note tasks');
	const body = modalSrc.slice(fnIdx, fnIdx + 2200);
	assert.ok(body.includes("targetCfg?.kind === 'folder'"),
		'pinned folder target resolves its own YYYY-MM-DD note');
	assert.ok(body.includes('dailyNotePathFor(this.app, this.iso)'),
		'default chain resolves via the Daily Notes plugin');
	assert.ok(body.includes('scanFileTasks(file,'),
		'note content runs through the shared task scanner');
	assert.ok(body.includes('await this.app.vault.read(file)'),
		'note is read fresh, not from a snapshot');
}

// 3. Merge: dedupe by path+line, agenda re-sorts with the shared comparator.
assert.ok(modalSrc.includes('private dedupe(tasks: VaultTask[])'),
	'dedupe helper exists');
assert.ok(modalSrc.includes('this.dedupe([...this.tasks, ...(await this.loadDailyNoteTasks())])'),
	'onOpen merges scanned + note tasks through the dedupe');
assert.ok(/\[\.\.\.tasks\]\.sort\(byDayTaskTime\(this\.iso\)\)/.test(modalSrc),
	'merged list uses the agenda time sort (renderDayList paints in that order)');

// Settings tab: toggle wired to the persisted setting.
assert.ok(settingsSrc.includes('t(\'settings.calendarIncludeDailyTasks\')'),
	'settings tab hosts the toggle');
assert.ok(settingsSrc.includes('calendarIncludeDailyNoteTasks: value'),
	'toggle persists the setting');

// i18n: the two keys exist in the base file and every locale pack.
{
	const key = 'settings.calendarIncludeDailyTasks';
	assert.ok(modalSrc.includes('readIncludeDailyTasks') === true);
	let hits = 0;
	for (const f of ['src/i18n.ts',
		'src/locales/de/part-6.ts', 'src/locales/es/part-6.ts', 'src/locales/fr/part-6.ts',
		'src/locales/ja/part-6.ts', 'src/locales/ko/part-6.ts', 'src/locales/pt-BR/part-6.ts',
		'src/locales/ru/part-6.ts', 'src/locales/th/part-6.ts']) {
		hits += readFileSync(f, 'utf-8').includes(key) ? 1 : 0;
	}
	assert.equal(hits, 9, `i18n key present in all 9 language files (found ${hits})`);
}

console.log('verify-calendar-daily-tasks: OK');
