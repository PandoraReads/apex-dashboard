import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { HabitService, habitToday } from '../src/habit-service';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	visibilityState: 'visible',
	addEventListener: () => {},
	removeEventListener: () => {},
};

const files = new Map<string, string>();
const adapter = {
	async exists(path: string): Promise<boolean> { return files.has(path); },
	async read(path: string): Promise<string> {
		const value = files.get(path);
		if (value === undefined) throw new Error('missing file');
		return value;
	},
	async write(path: string, content: string): Promise<void> { files.set(path, content); },
	async mkdir(): Promise<void> {},
};
const plugin = {
	app: { vault: { configDir: '.obsidian', adapter } },
	manifest: { id: 'apex-dashboard' },
} as unknown as ConstructorParameters<typeof HabitService>[0];

async function main(): Promise<void> {
	const service = new HabitService(plugin);
	await service.load();
	const habit = service.addHabit('Read pages');
	assert.ok(habit);
	assert.equal(habit.mode ?? 'check', 'check', 'existing habit type remains check-in by default');
	service.toggle(habit.id);
	assert.equal(service.setMode(habit.id, 'count'), true, 'habit can switch to count mode');
	assert.equal(service.getCount(habit.id), 1, 'a prior check-in migrates to count one');
	assert.equal(service.incrementCount(habit.id), 2, 'first count click increments');
	assert.equal(service.incrementCount(habit.id), 3, 'subsequent click increments again');
	assert.equal(service.isDone(habit.id), true, 'positive count also marks the habit done today');
	assert.deepEqual(service.getDoneOn(habitToday()), [habit.id], 'counted habit appears in the done list');
	assert.equal(service.getTotal(habit.id), 3, 'counter total sums recorded counts');
	assert.equal(service.setMode(habit.id, 'check'), true, 'habit can return to check-in mode');
	assert.equal(service.getCount(habit.id), 0, 'switching back clears counter values');
	service.toggle(habit.id);
	assert.equal(service.isDone(habit.id), false, 'check-in mode retains toggle behavior');
	service.removeHabit(habit.id);
	service.destroy();
	console.log('habit count mode: ALL PASS');
}

void main();
