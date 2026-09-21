import type { App } from 'obsidian';
import type { AnniversaryConfig } from './types';
import { t } from './i18n';
import { applyWidgetBackground, attachWidgetConfigButton } from './widget-background';
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
export function destroyAnniversaryTimers(preserveWidgets?: HTMLElement | null): void {
	for (const [id, el] of anniversaryTimers) {
		if (preserveWidgets && preserveWidgets.contains(el)) continue;
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
		sub.textContent = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
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
