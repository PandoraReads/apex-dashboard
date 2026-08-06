import { getLanguage } from './i18n';

/**
 * Sidebar widget showing how much of the current calendar year has elapsed:
 * a percentage, a themed progress bar, and the day-of-year count.
 *
 * Pure presentation: the value is recomputed on every render (cheap, and the
 * sidebar re-renders frequently enough that it never goes stale).
 */
export function renderSidebarYearProgress(container: HTMLElement): void {
	const isZh = getLanguage() === 'zh';
	const now = new Date();
	const year = now.getFullYear();

	const start = new Date(year, 0, 1).getTime();
	const end = new Date(year + 1, 0, 1).getTime();
	const total = end - start;
	const elapsed = now.getTime() - start;
	const ratio = Math.max(0, Math.min(1, elapsed / total));
	const percent = Math.round(ratio * 1000) / 10; // one decimal place

	const daysInYear = Math.round(total / 86_400_000);
	const dayOfYear = Math.floor(elapsed / 86_400_000) + 1;
	const daysLeft = Math.max(0, daysInYear - dayOfYear);

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-year-progress' });

	const header = widget.createDiv({ cls: 'dashboard-sidebar-year-progress-header' });
	header.createSpan({ cls: 'dashboard-sidebar-year-progress-year', text: String(year) });
	header.createSpan({
		cls: 'dashboard-sidebar-year-progress-left',
		text: isZh ? `剩 ${daysLeft} 天` : `${daysLeft} days left`,
	});

	const bar = widget.createDiv({ cls: 'dashboard-progress dashboard-sidebar-year-progress-bar' });
	const track = bar.createDiv({ cls: 'dashboard-progress-bar' });
	track.createDiv({
		cls: 'dashboard-progress-fill',
		attr: { style: `width: ${percent.toFixed(1)}%` },
	});

	const sub = widget.createDiv({ cls: 'dashboard-sidebar-year-progress-sub' });
	sub.createSpan({
		cls: 'dashboard-sidebar-year-progress-day',
		text: isZh ? `第 ${dayOfYear} / ${daysInYear} 天` : `Day ${dayOfYear} of ${daysInYear}`,
	});
	sub.createSpan({ cls: 'dashboard-sidebar-year-progress-percent', text: `${percent.toFixed(1)}%` });
}
