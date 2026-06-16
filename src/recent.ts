import { App, TFile } from 'obsidian';
import { t } from './i18n';

export interface RecentDoc {
	name: string;
	path: string;
	relativeTime: string;
}

export function getRecentDocs(app: App, count: number): RecentDoc[] {
	const files = app.vault.getMarkdownFiles();
	const sorted = files
		.filter(f => !f.path.startsWith('.'))
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, count);

	return sorted.map(f => ({
		name: f.basename,
		path: f.path,
		relativeTime: formatRelativeTime(f.stat.mtime),
	}));
}

export function renderRecentDocs(
	container: HTMLElement,
	docs: RecentDoc[],
	onClick: (path: string) => void,
): void {
	const section = container.createDiv({ cls: 'dashboard-section dashboard-recent' });
	section.createEl('h3', { text: t('recent.title'), cls: 'dashboard-section-title' });

	if (docs.length === 0) {
		section.createSpan({ text: t('recent.empty'), cls: 'dashboard-empty' });
		return;
	}

	const list = section.createDiv({ cls: 'dashboard-recent-list' });
	for (const doc of docs) {
		const item = list.createDiv({ cls: 'dashboard-recent-item' });
		item.createEl('span', { text: doc.name, cls: 'dashboard-recent-name' });
		item.createEl('span', { text: doc.relativeTime, cls: 'dashboard-recent-time' });
		item.addEventListener('click', () => onClick(doc.path));
		item.setAttribute('role', 'button');
		item.setAttribute('aria-label', t('common.open', { name: doc.name }));
	}
}

function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return t('recent.daysAgo', { count: days });
	if (hours > 0) return t('recent.hoursAgo', { count: hours });
	if (minutes > 0) return t('recent.minutesAgo', { count: minutes });
	return t('recent.justNow');
}
