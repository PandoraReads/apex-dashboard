import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import {
	formatLunarStartDate,
	lunarAnniversaryThisYear,
	lunarYearsBetween,
	renderSidebarAnniversaryWidget,
} from '../src/anniversary-widget';
import type { AnniversaryConfig } from '../src/types';

// Anniversary lunar calendar support: the date line on a lunar entry shows
// the lunar date (with its solar equivalent), the elapsed value keeps
// measuring from the stored solar startDate, and the annual occurrence maps
// the lunar anniversary onto this year's drifting solar date (counted in
// lunar years). Solar entries keep the historical behavior byte-for-byte.

// The bare global createDiv() the widget's root element uses (Node lacks it).
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	return el;
};

const baseCfg: AnniversaryConfig = {
	id: 'av-1',
	label: '在一起的那天',
	startDate: '2023-06-22', // = 农历二〇二三年五月初五 (verified against lunar-typescript)
	calendar: 'lunar',
	precision: 'days',
	annualReminder: true,
};

const ymd = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function main(): void {
	// 1. formatLunarStartDate: solar → 农历 display string; leap months carry
	//    the 闰 prefix from getMonthInChinese; unusable dates yield null
	//    (production callers guard NaN upstream; the catch path still degrades).
	{
		assert.equal(formatLunarStartDate(new Date(2023, 5, 22)), '农历二〇二三年五月初五', '1: 五月初五 maps');
		assert.equal(formatLunarStartDate(new Date(2023, 3, 5)), '农历二〇二三年闰二月十五', '1: leap month 闰二月十五 maps');
		assert.equal(formatLunarStartDate(new Date(NaN)), null, '1: invalid date yields null');
	}

	// 2. lunarAnniversaryThisYear: the same lunar month/day of the CURRENT
	//    lunar year converted back to solar — a drifting Gregorian date.
	//    农历五月初五 of lunar year 2026 falls on 2026-06-19.
	{
		const start = new Date(2023, 5, 22);
		assert.equal(ymd(lunarAnniversaryThisYear(start, new Date(2026, 8, 23))), '2026-06-19', '2: lunar 5-5 occurrence in 2026');
		// Same lunar year as the start → the original date itself.
		assert.equal(ymd(lunarAnniversaryThisYear(start, new Date(2023, 8, 23))), '2023-06-22', '2: occurrence in the start year is the start date');
		// Leap-month anniversary in a year without that leap month: the
		// helper must still return a usable date (never throw).
		const leapStart = new Date(2023, 3, 5); // 农历2023闰二月十五
		const occ = lunarAnniversaryThisYear(leapStart, new Date(2026, 8, 23));
		assert.ok(occ instanceof Date && !Number.isNaN(occ.getTime()), '2: leap-month anniversary never throws');
	}

	// 3. lunarYearsBetween: whole lunar years elapsed (new-year boundary, not
	//    Jan 1) — the reminder's "N 年" count for lunar entries.
	{
		const start = new Date(2023, 5, 22);
		assert.equal(lunarYearsBetween(start, new Date(2026, 8, 23)), 3, '3: three lunar years by Sep 2026');
		// 2024-01-05 sits before the 2024 lunar new year → still 0 years.
		assert.equal(lunarYearsBetween(start, new Date(2024, 0, 5)), 0, '3: before lunar new year = 0');
	}

	// 4. Widget date line: lunar entries lead with the lunar date and carry
	//    the solar equivalent; solar entries keep the plain ISO line.
	{
		const host = new El('div');
		renderSidebarAnniversaryWidget(host as unknown as HTMLElement, { ...baseCfg }, undefined, undefined);
		const sub = findByClass(host, 'dashboard-sidebar-anniversary-date')[0]!;
		assert.ok(sub.textContent.includes('农历二〇二三年五月初五'), '4: lunar date shown');
		assert.ok(sub.textContent.includes('2023-06-22'), '4: solar equivalent shown');

		const solarHost = new El('div');
		renderSidebarAnniversaryWidget(solarHost as unknown as HTMLElement, { ...baseCfg, calendar: 'solar' }, undefined, undefined);
		const solarSub = findByClass(solarHost, 'dashboard-sidebar-anniversary-date')[0]!;
		assert.equal(solarSub.textContent, '2023-06-22', '4: solar entry keeps the plain ISO date');

		// An unparseable startDate leaves the date line empty (the shared
		// start guard) — no lunar conversion is ever attempted.
		const badHost = new El('div');
		renderSidebarAnniversaryWidget(badHost as unknown as HTMLElement, { ...baseCfg, startDate: 'not-a-date' }, undefined, undefined);
		const badSub = findByClass(badHost, 'dashboard-sidebar-anniversary-date')[0]!;
		assert.equal(badSub.textContent, '', '4: unparseable date leaves the sub line empty');
	}

	console.log('anniversary lunar: all 4 checks passed');
}

main();
