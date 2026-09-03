import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { renderMonthGrid, renderWeekTimeGrid, mondayOf } from '../src/calendar-grid';
import { toIsoDate } from '../src/alltasks-scan';

// Full-screen month grid: the day NUMBER opens that day's agenda (add-task
// flow); compact/dot sidebar modes and no-callback callers stay unchanged.

const APP = {} as App;

function isTrigger(el: El): boolean {
	return el.hasClass('is-clickable')
		&& el.getAttribute('role') === 'button'
		&& el.getAttribute('tabindex') === '0';
}

async function main(): Promise<void> {
	// renderWeekTimeGrid schedules a scroll via requestAnimationFrame.
	(globalThis as { window?: unknown }).window = { requestAnimationFrame: () => 0 };

	// 1. Full-screen month: every day number is a keyboard-activated trigger
	//    whose click/Enter reports that day's iso.
	{
		const root = new El('div');
		const seen: string[] = [];
		renderMonthGrid(root as unknown as HTMLElement, 2026, 7, new Map(), {
			compact: false,
			app: APP,
			onDayNumClick: (iso) => { seen.push(iso); },
		});
		const nums = findByClass(root, 'dashboard-calendar-cell-num');
		assert.equal(nums.length, 42, '1: 42 day numbers');
		for (const n of nums) {
			assert.ok(isTrigger(n), '1: number is a trigger');
			assert.ok((n.getAttribute('aria-label') ?? '').length > 0, '1: aria-label present');
		}
		nums[0]!.click();
		nums[17]!.click();
		nums[41]!.click();
		nums[5]!.dispatchEvent({ type: 'keydown', key: 'Enter' });
		nums[6]!.dispatchEvent({ type: 'keydown', key: ' ' });
		// Aug 2026 starts on a Saturday -> the grid's Monday-first start is Jul 27.
		assert.equal(seen[0], '2026-07-27', '1: first cell iso');
		assert.equal(seen[2], '2026-09-06', '1: last cell iso');
		assert.equal(seen[3], '2026-08-01', '1: Enter activates');
		assert.equal(seen[4], '2026-08-02', '1: Space activates');
	}

	// 2. Compact sidebar mode: the number stays inert (whole cell already
	//    opens the agenda); the cell keeps its clickability.
	{
		const root = new El('div');
		const seen: string[] = [];
		renderMonthGrid(root as unknown as HTMLElement, 2026, 7, new Map(), {
			compact: true,
			app: APP,
			onDayClick: (iso) => { seen.push(iso); },
			onDayNumClick: (iso) => { seen.push('NUM:' + iso); },
		});
		for (const n of findByClass(root, 'dashboard-calendar-cell-num')) {
			assert.ok(!n.hasClass('is-clickable'), '2: number inert in compact');
		}
		const cells = findByClass(root, 'dashboard-calendar-cell');
		cells[0]!.click();
		assert.equal(seen[0], '2026-07-27', '2: cell click still opens agenda');
	}

	// 3. Dot mode: number inert there too.
	{
		const root = new El('div');
		renderMonthGrid(root as unknown as HTMLElement, 2026, 7, new Map(), {
			compact: true,
			dotMode: true,
			app: APP,
			onDayClick: () => {},
			onDayNumClick: () => {},
		});
		for (const n of findByClass(root, 'dashboard-calendar-cell-num')) {
			assert.ok(!n.hasClass('is-clickable'), '3: number inert in dot mode');
		}
	}

	// 4. Full-screen without the callback: nothing becomes clickable (old
	//    callers render exactly as before).
	{
		const root = new El('div');
		renderMonthGrid(root as unknown as HTMLElement, 2026, 7, new Map(), { compact: false, app: APP });
		for (const n of findByClass(root, 'dashboard-calendar-cell-num')) {
			assert.ok(!n.hasClass('is-clickable'), '4: inert without callback');
		}
	}

	// 5. Week time grid: the 7 day headers are triggers reporting Mon..Sun.
	{
		const monday = mondayOf(new Date(2026, 7, 30)); // any date in that week
		const root = new El('div');
		const seen: string[] = [];
		renderWeekTimeGrid(root as unknown as HTMLElement, monday, new Map(), {
			compact: false,
			app: APP,
			onDayNumClick: (iso) => { seen.push(iso); },
		});
		const heads = findByClass(root, 'dashboard-calgrid-dayhead');
		assert.equal(heads.length, 7, '5: 7 day headers');
		for (const h of heads) {
			assert.ok(isTrigger(h), '5: header is a trigger');
			h.click();
		}
		assert.equal(seen[0], toIsoDate(monday), '5: first header is Monday');
		assert.equal(seen[6], toIsoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)), '5: last header is Sunday');
	}

	// 6. Week time grid without the callback: headers stay inert.
	{
		const root = new El('div');
		renderWeekTimeGrid(root as unknown as HTMLElement, mondayOf(new Date()), new Map(), { compact: false, app: APP });
		for (const h of findByClass(root, 'dashboard-calgrid-dayhead')) {
			assert.ok(!h.hasClass('is-clickable'), '6: inert without callback');
		}
	}

	console.log('verify-calendar-daynum: 6 scenarios OK');
}

void main();
