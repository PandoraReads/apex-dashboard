/**
 * Save an RSS article into the vault as a Markdown note. Reuses the note
 * creation utilities (ensureFolder / sanitizeFilename / uniquePath /
 * yamlFrontmatter) so filename safety, folder creation and frontmatter
 * escaping behave exactly like the dashboard's other note-creating features.
 *
 * The frontmatter mirrors Rae's 「01 收集」 inbox template's PROPERTY SET
 * (cssclasses/摘要/类型/PARA分类/… — collected notes flow into the second-
 * brain PARA pipeline), with RSS values mapped in; the template's BODY is
 * deliberately not used, only its properties.
 */

import type { App, TFile } from 'obsidian';
import { ensureFolder } from './daily-notes';
import { momentOf, nowMoment } from './datetime';
import { yamlFrontmatter } from './library-new-note';
import { sanitizeFilename, uniquePath } from './quick-note-section';
import type { RssItem } from './rss-xml';
import { stripHtmlText } from './html-md';

/** Longest note-title portion of an article title (weread import idiom). */
const MAX_TITLE_CHARS = 80;
/** 摘要 cap — an indexable teaser, not the whole article. */
const MAX_SUMMARY_CHARS = 120;

export interface SaveRssArticleOptions {
	/** Destination folder ('' = vault root), from the section config. */
	folder: string;
	/** Display name of the feed the article came from. */
	feedTitle: string;
	item: RssItem;
	markdown: string;
}

/** Filename base: date prefix (publication date when known, else today) +
 *  sanitized title — same collision-avoidance shape as calendar task notes. */
export function rssNoteName(item: RssItem, now = Date.now()): string {
	const date = item.pubDate ? momentOf(item.pubDate) : momentOf(now);
	const prefix = date.isValid() ? date.format('YYYY-MM-DD') : nowMoment().format('YYYY-MM-DD');
	const title = sanitizeFilename(item.title).slice(0, MAX_TITLE_CHARS).trim();
	return title ? `${prefix} ${title}` : prefix;
}

/** Plain-text teaser: the feed's summary (entities resolved, tags stripped),
 *  falling back to the title. */
function summaryOf(item: RssItem): string {
	const raw = (item.summaryHtml ?? item.contentHtml ?? '').trim();
	const text = raw ? stripHtmlText(raw) : item.title;
	return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text;
}

/** Frontmatter per the 「01 收集」 template's property set, RSS-mapped. */
export function rssNoteProps(opts: SaveRssArticleOptions, now = Date.now()): Record<string, string | string[]> {
	const { item, feedTitle } = opts;
	const when = momentOf(now);
	const date = when.isValid() ? when : nowMoment();
	const year = item.pubDate && momentOf(item.pubDate).isValid() ? momentOf(item.pubDate).format('YYYY') : date.format('YYYY');
	return {
		cssclasses: 'sb-second-brain',
		'摘要': summaryOf(item),
		'类型': '收集',
		'PARA分类': '收集箱',
		'年份': year,
		'年度页': `[[${year}]]`,
		'状态': '待整理',
		'Wiki摄入状态': '未摄入',
		'领域': '',
		'关联项目': [],
		'Wiki关联': [],
		'主题': [],
		'来源': feedTitle,
		'相关笔记': [],
		'创建时间': date.format('YYYY-MM-DD'),
		'更新时间': date.format('YYYY-MM-DD'),
	};
}

/** Compose the note: template-mirrored frontmatter + original-link line +
 *  the article body (never the template's body). */
export function buildRssNoteContent(opts: SaveRssArticleOptions, now = Date.now()): string {
	const { item, markdown } = opts;
	const parts: string[] = [yamlFrontmatter(rssNoteProps(opts, now))];
	if (item.link) parts.push(`[原文链接](${item.link})`);
	parts.push(markdown.trim());
	return `${parts.filter(p => p.length > 0).join('\n\n')}\n`;
}

/** Create the note (uniqued `-2`/`-3`… on collision) and return the file. */
export async function saveRssArticle(app: App, opts: SaveRssArticleOptions): Promise<TFile> {
	const folder = opts.folder.trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const base = folder ? `${folder}/${rssNoteName(opts.item)}.md` : `${rssNoteName(opts.item)}.md`;
	const path = await uniquePath(app, base);
	return app.vault.create(path, buildRssNoteContent(opts));
}
