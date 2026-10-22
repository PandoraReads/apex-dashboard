import { getLocale } from './i18n';

export function weekdayLabels(): string[] {
	const locale = getLocale();
	const compact = /^(zh|ja|ko)/.test(locale);
	const format = new Intl.DateTimeFormat(locale, { weekday: compact ? 'narrow' : 'short' });
	return Array.from({ length: 7 }, (_, day) => format.format(new Date(2024, 0, 7 + day)));
}

export function monthLabels(): string[] {
	const format = new Intl.DateTimeFormat(getLocale(), { month: 'short' });
	return Array.from({ length: 12 }, (_, month) => format.format(new Date(2024, month, 1)));
}

export function monthDayLabel(date: Date): string {
	return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(date);
}
