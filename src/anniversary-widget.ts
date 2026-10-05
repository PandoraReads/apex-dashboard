import type { App } from 'obsidian';
import { Solar, Lunar } from 'lunar-typescript';
import type { AnniversaryConfig } from './types';
import { t } from './i18n';
import { applyWidgetBackground, attachWidgetConfigButton } from './widget-background';
import { isInPreserveScope, type PreserveScope } from './preserve-scope';
// Runtime-only use inside a click handler; the module cycle with
// anniversary-settings-modal (it imports formatElapsed from here) is safe
// because both sides defer cross-references to call time.
import { AnniversarySettingsModal } from './anniversary-settings-modal';

/** Live value tickers keyed by timer id, mapped to the value element they
 *  refresh (hours precision only — coarser units move at most once a day and
 *  re-render on ordinary dashboard refreshes anyway). Self-cleaning: each
 *  tick drops its timer once the element is detached, mirroring the
 *  countdown-timer idiom in renderer.ts. */
const anniversaryTimers = new Map<number, HTMLElement>();

/** Clear every anniversary ticker ahead of a re-render. `preserveWidgets` is
 *  the detached-but-reused sidebar widgets element: tickers animating widgets
 *  inside it survive so the re-attached DOM keeps ticking. */
export function destroyAnniversaryTimers(preserveWidgets?: PreserveScope): void {
	for (const [id, el] of anniversaryTimers) {
		if (isInPreserveScope(preserveWidgets, el)) continue;
		window.clearInterval(id);
		anniversaryTimers.delete(id);
	}
}

export function parseAnniversaryDate(raw: string): Date | null {
	if (!raw) return null;
	const date = raw.includes('T') ? new Date(raw) : new Date(raw + 'T00:00:00');
	const time = date.getTime();
	if (Number.isNaN(time)) return null;
	return date;
}

/** Elapsed time from `start` to `now`, formatted per the precision setting:
 *  'ymd' calendar years/months/days, 'days' total days, 'hours' days+hours.
 *  Exported for the verify script. */
export function formatElapsed(start: Date, now: Date, precision: AnniversaryConfig['precision']): string {
	const diffMs = now.getTime() - start.getTime();
	if (diffMs < 0) return t('anniversary.notYet');
	const totalDays = Math.floor(diffMs / 86400000);
	if (precision === 'days') return t('anniversary.daysValue', { days: String(totalDays) });
	if (precision === 'hours') {
		const hours = Math.floor((diffMs - totalDays * 86400000) / 3600000);
		return t('anniversary.daysHoursValue', { days: String(totalDays), hours: String(hours) });
	}
	// Calendar walk: advance whole years, then months, then count leftover days.
	let years = now.getFullYear() - start.getFullYear();
	let months = now.getMonth() - start.getMonth();
	let days = now.getDate() - start.getDate();
	if (days < 0) {
		months -= 1;
		// Days in the month preceding `now` (0-indexed month + 1 = previous).
		days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
	}
	if (months < 0) {
		years -= 1;
		months += 12;
	}
	const parts: string[] = [];
	if (years > 0) parts.push(t('anniversary.yearsPart', { years: String(years) }));
	if (months > 0) parts.push(t('anniversary.monthsPart', { months: String(months) }));
	parts.push(t('anniversary.daysPart', { days: String(Math.max(0, days)) }));
	return parts.join(' ');
}

/** The date this year that carries the anniversary's month/day (Feb 29 rolls
 *  onto Mar 1 in common years — Date overflow does this naturally). */
export function anniversaryDateThisYear(start: Date, now: Date): Date {
	return new Date(now.getFullYear(), start.getMonth(), start.getDate());
}

/** The lunar date of a solar date as a display string, e.g. 农历二〇二三年闰二月初五
 *  (getMonthInChinese already carries the 闰 prefix for leap months). Null when
 *  the date is unusable — lunar-typescript doesn't throw on NaN, it emits
 *  garbage (农历〇年月), so the guard is explicit. */
export function formatLunarStartDate(start: Date): string | null {
	if (Number.isNaN(start.getTime())) return null;
	try {
		const lunar = Solar.fromYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()).getLunar();
		return t('anniversary.lunarDateValue', {
			year: lunar.getYearInChinese(),
			month: lunar.getMonthInChinese(),
			day: lunar.getDayInChinese(),
		});
	} catch {
		return null;
	}
}

/** Whole lunar years elapsed between two solar dates (the reminder's "N 年"
 *  count for lunar entries — the lunar new year boundary, not Jan 1). Null
 *  when either date is unusable. */
export function lunarYearsBetween(start: Date, now: Date): number | null {
	if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return null;
	try {
		return Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunar().getYear()
			- Solar.fromYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()).getLunar().getYear();
	} catch {
		return null;
	}
}

/** The solar date this year carrying a lunar anniversary's lunar month/day:
 *  the same lunar date of the current lunar year converted back to solar
 *  (it lands on a different Gregorian date every year). Falls back to the
 *  plain solar mapping when the conversion fails. */
export function lunarAnniversaryThisYear(start: Date, now: Date): Date {
	if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return anniversaryDateThisYear(start, now);
	try {
		const startLunar = Solar.fromYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()).getLunar();
		const currentLunarYear = Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunar().getYear();
		const solar = Lunar.fromYmd(currentLunarYear, startLunar.getMonth(), startLunar.getDay()).getSolar();
		return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
	} catch {
		return anniversaryDateThisYear(start, now);
	}
}

/** Render one anniversary card. Hours precision gets a 60s ticker so the
 *  value stays live; coarser precisions are static until the next render.
 *  With `onEdit`, a hover config button opens the full edit modal (label,
 *  date, precision, reminder, background) right from the card. */
export function renderSidebarAnniversaryWidget(
	container: HTMLElement,
	cfg: AnniversaryConfig,
	app?: App,
	onEdit?: (cfg: AnniversaryConfig) => void,
): void {
	const widget = createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-anniversary' });
	container.appendChild(widget);
	if (app) applyWidgetBackground(widget, cfg.background, app);
	if (app && onEdit) {
		attachWidgetConfigButton(widget, () => {
			new AnniversarySettingsModal(app, cfg, onEdit).open();
		}, t('anniversary.editTitle'));
	}

	const start = parseAnniversaryDate(cfg.startDate);

	const title = widget.createDiv({ cls: 'dashboard-sidebar-anniversary-title' });
	title.textContent = cfg.label || t('anniversary.unnamed');

	const value = widget.createDiv({ cls: 'dashboard-sidebar-anniversary-value' });
	if (start) {
		value.textContent = formatElapsed(start, new Date(), cfg.precision);
	} else {
		value.textContent = '--';
	}

	const sub = widget.createDiv({ cls: 'dashboard-sidebar-anniversary-date' });
	if (start) {
		const pad = (n: number) => String(n).padStart(2, '0');
		const solarText = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
		if (cfg.calendar === 'lunar') {
			// 农历 entries lead with the lunar date (the 农历 marker the user
			// asked for); the solar equivalent rides along for scheduling apps.
			const lunarText = formatLunarStartDate(start);
			sub.textContent = lunarText ? t('anniversary.lunarWithSolar', { lunar: lunarText, solar: solarText }) : solarText;
		} else {
			sub.textContent = solarText;
		}
	}

	if (start && cfg.precision === 'hours') {
		const timer = window.setInterval(() => {
			if (!value.isConnected) {
				window.clearInterval(timer);
				anniversaryTimers.delete(timer);
				return;
			}
			value.textContent = formatElapsed(start, new Date(), cfg.precision);
		}, 60_000);
		anniversaryTimers.set(timer, value);
	}
}
