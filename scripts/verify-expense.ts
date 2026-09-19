/**
 * Verifies the expense category/primary model and the period-window math:
 *
 * 1. expense-period (pure): Monday-anchored week windows including
 *    year-straddling weeks, calendar month/year windows with previous-period
 *    pairs, elapsedDays clamping (past period = full span, current period =
 *    day index), periodShift month/year anchor normalization (03-31 must
 *    shift to 02-01, never the Date-overflow 03-02), periodLabel formats.
 * 2. Service normalize: legacy file without the new fields stays untouched;
 *    dirty categoryOrder drops unknown keys without materializing missing
 *    ones; dangling parent mappings drop out; over-cap primary lists clip.
 * 3. Order API: reorderCategories exact-cover rule (dup/short/foreign
 *    rejected), read-time lenient completion, persisted order round-trip.
 * 4. Primary API: add (case-insensitive + preset-key + preset-label
 *    collisions, cap), setCategoryParent round-trip + null clear,
 *    removePrimaryCategory ungroups members, removeCustomCategory cleans
 *    order + parents.
 * 5. Merge (persist with an external writer): session-first order/primaries
 *    union, per-key session-wins parents, dangling parents dropped.
 * 6. regroupBreakdownByPrimary: unmapped categories pool into
 *    UNGROUPED_PRIMARY.
 *
 * Run: `npm run test:expense`
 */
import { strict as assert } from 'node:assert';
import {
	EXPENSE_MAX_PRIMARY_CATEGORIES,
	type ExpenseService,
	ExpenseService as ExpenseServiceClass,
	regroupBreakdownByPrimary,
	UNGROUPED_PRIMARY,
} from '../src/expense-service';
import {
	addDays,
	daysInclusive,
	periodLabel,
	periodShift,
	windowFor,
} from '../src/expense-period';

// ---- Harness ---------------------------------------------------------------

/** In-memory adapter: one file per path, reads/writes captured verbatim. */
const makeAdapter = (files: Record<string, string>) => {
	const disk = { ...files };
	const written: string[] = [];
	return {
		adapter: {
			exists: async (p: string) => disk[p] !== undefined,
			read: async (p: string) => {
				if (disk[p] === undefined) throw new Error(`missing ${p}`);
				return disk[p];
			},
			write: async (p: string, c: string) => {
				disk[p] = c;
				written.push(c);
				return Promise.resolve();
			},
			mkdir: async () => Promise.resolve(),
		},
		disk,
		written,
		/** Simulate another device writing expense.json behind our back. */
		overwrite: (p: string, c: string): void => { disk[p] = c; },
	};
};

const DATA_PATH = '.obsidian/plugins/apex-dashboard/expense.json';

interface Harness {
	service: ExpenseService;
	h: { disk: Record<string, string>; written: string[]; overwrite: (p: string, c: string) => void };
	/** Await the serialized write queue so disk assertions are deterministic. */
	flush: () => Promise<void>;
}

const boot = (file: string): Harness => {
	const { adapter, disk, written, overwrite } = makeAdapter({ [DATA_PATH]: file });
	(globalThis as { activeDocument?: unknown }).activeDocument = {
		body: {},
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
	};
	const plugin = {
		app: { vault: { configDir: '.obsidian', adapter } },
		manifest: { id: 'apex-dashboard' },
		settings: { expenseCurrency: '¥' },
	} as unknown as ConstructorParameters<typeof ExpenseServiceClass>[0];
	const service = new ExpenseServiceClass(plugin);
	return {
		service,
		h: { disk, written, overwrite },
		flush: async () => {
			await (service as unknown as { saveQueue: Promise<void> }).saveQueue;
		},
	};
};

const record = (over: Record<string, unknown>): string => JSON.stringify({
	version: 1,
	records: [{ id: 'ex-1', type: 'expense', amount: 10, category: 'food', date: '2026-01-05', createdAt: 1 }],
	lastCategory: { expense: 'food' },
	...over,
});

// ---- 1. expense-period (pure) ----------------------------------------------

const periodChecks = (): void => {
	// Week containing a Friday New Year runs Mon 2026-12-28 -> Sun 2027-01-03.
	const ny = windowFor('week', '2027-01-01', '2027-01-01');
	assert.equal(ny.curStart, '2026-12-28', 'cross-year week starts in Dec');
	assert.equal(ny.curEnd, '2027-01-03', 'cross-year week ends in Jan');
	assert.equal(ny.prevStart, '2026-12-21', 'prev week of the NY week');

	// Thursday 2026-01-01 belongs to the week of Mon 2025-12-29.
	const thu = windowFor('week', '2026-01-01', '2026-01-01');
	assert.equal(thu.curStart, '2025-12-29');
	assert.equal(thu.curEnd, '2026-01-04');

	// Leap February: full 29 days, previous period is January.
	const feb = windowFor('month', '2024-02-10', '2026-09-19');
	assert.equal(feb.curStart, '2024-02-01');
	assert.equal(feb.curEnd, '2024-02-29');
	assert.equal(feb.prevStart, '2024-01-01');
	assert.equal(feb.prevEnd, '2024-01-31');
	assert.equal(feb.elapsedDays, 29, 'past month spans fully');

	// Calendar year with previous-year pair.
	const yr = windowFor('year', '2025-06-15', '2026-09-19');
	assert.equal(yr.curStart, '2025-01-01');
	assert.equal(yr.curEnd, '2025-12-31');
	assert.equal(yr.prevStart, '2024-01-01');
	assert.equal(yr.prevEnd, '2024-12-31');

	// elapsedDays: current week clamps to today (Sat of the 09-14 week = 6).
	assert.equal(windowFor('week', '2026-09-16', '2026-09-19').elapsedDays, 6);
	// Current month on the 19th = 19 elapsed days; a today of the 1st = 1.
	assert.equal(windowFor('month', '2026-09-10', '2026-09-19').elapsedDays, 19);
	assert.equal(windowFor('month', '2026-09-05', '2026-09-01').elapsedDays, 1);
	// Current year on day 262 (2026-09-19, non-leap).
	assert.equal(windowFor('year', '2026-03-01', '2026-09-19').elapsedDays, daysInclusive('2026-01-01', '2026-09-19'));
	// Past full week = 7 even when today is far ahead.
	assert.equal(windowFor('week', '2026-08-03', '2026-09-19').elapsedDays, 7);

	// periodShift normalization: month anchors land on the target month's 1st.
	assert.equal(periodShift('month', '2024-03-31', -1), '2024-02-01', '03-31 back = 02-01 (no overflow)');
	assert.equal(periodShift('month', '2024-01-15', -1), '2023-12-01', 'January back crosses the year');
	assert.equal(periodShift('month', '2024-03-31', 1), '2024-04-01');
	// Week shifts move by whole weeks from the Monday.
	assert.equal(periodShift('week', '2026-09-14', 1), '2026-09-21');
	assert.equal(periodShift('week', '2026-09-18', -1), '2026-09-07', 'mid-week anchor normalizes to Monday first');
	// Year anchors land on Jan 1.
	assert.equal(periodShift('year', '2024-05-05', -1), '2023-01-01');
	assert.equal(periodShift('year', '2023-02-02', 1), '2024-01-01');

	// Labels.
	const wk = windowFor('week', '2026-09-16', '2026-09-19');
	assert.equal(periodLabel('week', wk), '2026-09-14 ~ 2026-09-20');
	assert.equal(periodLabel('month', wk), '2026-09');
	assert.equal(periodLabel('year', wk), '2026');
	assert.equal(fmtCheck(addDays(new Date('2026-09-14T00:00:00'), 7)), '2026-09-21');
};

const fmtCheck = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---- 2-5. Service ----------------------------------------------------------

const serviceChecks = async (): Promise<void> => {
	// Legacy file without the new fields: defaults everywhere, no growth.
	{
		const { service, h, flush } = boot(record({}));
		await service.load();
		assert.equal(service.getPrimaryCategories('expense').length, 0, 'no primaries on legacy file');
		assert.equal(service.getCategoryParent('expense', 'food'), undefined, 'no mapping on legacy file');
		// Default order = presets + customs, before any reorder.
		assert.equal(service.getOrderedCategories('expense')[0], 'food');
		service.reorderCategories('expense', service.getCategories('expense').slice().reverse());
		await flush();
		assert.ok(!h.written[0]!.includes('__ungrouped__'), 'sentinel never persists');
		assert.ok(JSON.parse(h.disk[DATA_PATH]!).categoryOrder.expense[0] === 'other', 'reversed order persists');
	}

	// Dirty file: unknown order keys dropped, missing keys completed at read
	// time (not persisted), dangling parents dropped, primaries capped.
	{
		const primaries = Array.from({ length: 15 }, (_, i) => `组${i}`);
		const { service } = boot(record({
			customCategories: { expense: ['咖啡', '健身'] },
			categoryOrder: { expense: ['咖啡', 'bogus', 'food'] },
			primaryCategories: { expense: primaries },
			categoryParents: { expense: { '咖啡': '组0', 'food': 'ghost', 'transport': '组1' } },
		}));
		await service.load();
		const ordered = service.getOrderedCategories('expense');
		assert.deepEqual(ordered.slice(0, 2), ['咖啡', 'food'], 'stored order leads, unknown key dropped');
		assert.equal(ordered[ordered.length - 1], '健身', 'custom missing from order completes at the tail');
		assert.equal(ordered.length, 12, '10 presets + 2 customs');
		assert.equal(service.getPrimaryCategories('expense').length, EXPENSE_MAX_PRIMARY_CATEGORIES, 'over-cap primaries clipped');
		assert.equal(service.getCategoryParent('expense', '咖啡'), '组0', 'valid mapping kept');
		assert.equal(service.getCategoryParent('expense', 'food'), undefined, 'dangling primary dropped');
		assert.equal(service.getCategoryParent('expense', 'transport'), '组1', 'mapping to surviving primary kept');
	}

	// reorderCategories exact-cover rule.
	{
		const { service } = boot(record({}));
		await service.load();
		const cats = service.getCategories('expense');
		assert.equal(service.reorderCategories('expense', [...cats, ...cats]), false, 'duplicates rejected');
		assert.equal(service.reorderCategories('expense', cats.slice(1)), false, 'short list rejected');
		assert.equal(service.reorderCategories('expense', [...cats.slice(1), 'not-a-cat']), false, 'foreign key rejected');
		const rotated = [...cats.slice(5), ...cats.slice(0, 5)];
		assert.equal(service.reorderCategories('expense', rotated), true);
		assert.deepEqual(service.getOrderedCategories('expense'), rotated, 'rotation effective');
		assert.deepEqual(service.getCategories('expense'), cats, 'raw order (presets + customs) unchanged');
	}

	// Primary API round-trip.
	{
		const { service } = boot(record({ customCategories: { expense: ['咖啡'] } }));
		await service.load();
		assert.equal(service.addPrimaryCategory('expense', '生活').ok, true);
		assert.equal(service.addPrimaryCategory('expense', '生活').ok, false, 'exact duplicate rejected');
		assert.equal((service.addPrimaryCategory('expense', '生活X').ok === true), true);
		assert.equal(service.addPrimaryCategory('expense', '生活x').ok, false, 'case-insensitive duplicate rejected');
		assert.equal(service.addPrimaryCategory('expense', 'food').ok, false, 'preset key rejected');
		assert.equal(service.addPrimaryCategory('expense', '餐饮').ok, false, 'preset localized label rejected');
		for (let i = service.getPrimaryCategories('expense').length; i < EXPENSE_MAX_PRIMARY_CATEGORIES; i++) {
			service.addPrimaryCategory('expense', `填充${i}`);
		}
		const capped = service.addPrimaryCategory('expense', '第十一个');
		assert.equal(capped.ok, false, 'over cap rejected');
		assert.equal(capped.reason, 'limit');

		assert.equal(service.setCategoryParent('expense', '咖啡', '生活'), true);
		assert.equal(service.getCategoryParent('expense', '咖啡'), '生活');
		assert.equal(service.setCategoryParent('expense', '咖啡', 'nope'), false, 'unknown primary rejected');
		assert.equal(service.setCategoryParent('expense', 'nope', '生活'), false, 'unknown category rejected');
		assert.equal(service.setCategoryParent('expense', '咖啡', null), true, 'null clears');
		assert.equal(service.getCategoryParent('expense', '咖啡'), undefined);
		assert.equal(service.setCategoryParent('expense', '咖啡', null), true, 'second null is a no-op success');

		// removePrimaryCategory ungroups every member.
		service.setCategoryParent('expense', '咖啡', '生活');
		service.setCategoryParent('expense', 'food', '生活');
		assert.equal(service.countPrimaryUsage('expense', '生活'), 2);
		assert.equal(service.removePrimaryCategory('expense', '生活'), true);
		assert.equal(service.getCategoryParent('expense', 'food'), undefined, 'member ungrouped on primary delete');
		assert.equal(service.getPrimaryCategories('expense').includes('生活'), false);

		// removeCustomCategory cleans order + parents alongside customs.
		service.addCustomCategory('expense', '奶茶');
		service.setCategoryParent('expense', '奶茶', '生活X');
		const withMilk = service.getOrderedCategories('expense');
		service.reorderCategories('expense', ['奶茶', ...withMilk.filter(c => c !== '奶茶')]);
		assert.equal(service.removeCustomCategory('expense', '奶茶'), true);
		assert.equal(service.getCategoryParent('expense', '奶茶'), undefined, 'mapping cleaned with the custom');
		assert.ok(!service.getOrderedCategories('expense').includes('奶茶'), 'order cleaned with the custom');
	}

	// Merge on persist with an external writer: session-first order/primaries,
	// per-key session-wins parents, dangling disk parents dropped.
	{
		const { service, h, flush } = boot(record({
			customCategories: { expense: ['咖啡'] },
			categoryOrder: { expense: ['food', '咖啡'] },
			primaryCategories: { expense: ['生活'] },
			categoryParents: { expense: { '咖啡': '生活' } },
		}));
		await service.load();

		// Session mutations: a fresh reorder + a new mapping.
		const cats = service.getCategories('expense');
		service.reorderCategories('expense', ['咖啡', ...cats.filter(c => c !== '咖啡')]);
		service.setCategoryParent('expense', 'food', '生活');
		await flush();

		// Another device writes: adds a record, its own order starting with
		// the stale 'food', a new primary '住行', and parents for transport.
		h.overwrite(DATA_PATH, JSON.stringify({
			version: 1,
			records: [
				{ id: 'ex-9', type: 'expense', amount: 5, category: 'transport', date: '2026-01-06', createdAt: 9 },
				{ id: 'ex-1', type: 'expense', amount: 10, category: 'food', date: '2026-01-05', createdAt: 1 },
			],
			lastCategory: { expense: 'food' },
			customCategories: { expense: ['咖啡'] },
			categoryOrder: { expense: ['food', '咖啡'] },
			primaryCategories: { expense: ['住行'] },
			categoryParents: { expense: { '咖啡': '住行', 'transport': 'ghost' } },
		}));

		// Any further mutation triggers persist -> external-change merge.
		assert.ok(service.addRecord({ type: 'expense', amount: 1, category: 'food', date: '2026-01-07' }));
		await flush();

		const merged = JSON.parse(h.disk[DATA_PATH]!);
		assert.equal(merged.records.length, 3, 'external record unioned in');
		assert.equal(merged.categoryOrder.expense[0], '咖啡', 'session order survives the merge (session-first)');
		assert.ok(merged.primaryCategories.expense.includes('生活') && merged.primaryCategories.expense.includes('住行'), 'primaries unioned');
		assert.equal(merged.categoryParents.expense['咖啡'], '生活', 'session mapping wins the per-key clash');
		assert.equal(merged.categoryParents.expense['food'], '生活', 'session-only mapping kept');
		assert.equal(merged.categoryParents.expense['transport'], undefined, 'dangling disk parent dropped');
	}

	// regroupBreakdownByPrimary pools unmapped into the sentinel bucket.
	{
		const totals = new Map([['food', 100], ['咖啡', 50], ['transport', 30]]);
		const parentOf = (c: string): string | undefined => (c === 'transport' ? undefined : '生活');
		const grouped = regroupBreakdownByPrimary(totals, parentOf);
		assert.equal(grouped.get('生活'), 150);
		assert.equal(grouped.get(UNGROUPED_PRIMARY), 30);
		assert.equal(grouped.size, 2);
	}
};

// ---- Run --------------------------------------------------------------------

const run = async (): Promise<void> => {
	periodChecks();
	await serviceChecks();
	console.log('verify-expense: all assertions passed');
};

void run().catch((error) => {
	console.error(error);
	process.exit(1);
});
