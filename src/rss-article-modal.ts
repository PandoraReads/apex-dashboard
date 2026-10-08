/**
 * Reader modal for one RSS article: title/meta header plus the article body
 * rendered as Markdown (never raw remote HTML — see html-md). Body content is
 * resolved once via rss-service (feed full text, cached web extraction, fresh
 * page fetch, or summary fallback) and shared with the modal's own download
 * button, so opening a summary-only article fetches its page exactly once.
 */

import { App, Component, Modal, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme, removeNativeModalCloseButton } from './modal-theme';
import type { RssStore } from './rss-store';
import { resolveArticleMarkdown, type ResolvedArticle, type RssTextFetcher } from './rss-service';
import type { RssItem } from './rss-xml';
import { saveRssArticle } from './rss-note';
import { momentOf } from './datetime';

export interface RssArticleModalOptions {
	app: App;
	store: RssStore;
	feedTitle: string;
	feedLink: string;
	item: RssItem;
	/** Section-configured download folder ('' = vault root). */
	downloadFolder: string;
	/** Test seam — canned page HTML for the web-extraction path. */
	fetcher?: RssTextFetcher;
	/** Row-icon sync after a successful in-modal download. */
	onDownloaded?: (guid: string, path: string) => void;
}

export class RssArticleModal extends Modal {
	private readonly store: RssStore;
	private readonly feedTitle: string;
	private readonly feedLink: string;
	private readonly item: RssItem;
	private readonly downloadFolder: string;
	private readonly fetcher?: RssTextFetcher;
	private readonly onDownloaded?: (guid: string, path: string) => void;

	private closed = false;
	private renderComponent: Component | null = null;
	private markdownPromise: Promise<ResolvedArticle> | null = null;
	private saveBtn: HTMLElement | null = null;

	constructor(opts: RssArticleModalOptions) {
		super(opts.app);
		this.store = opts.store;
		this.feedTitle = opts.feedTitle;
		this.feedLink = opts.feedLink;
		this.item = opts.item;
		this.downloadFolder = opts.downloadFolder;
		this.fetcher = opts.fetcher;
		this.onDownloaded = opts.onDownloaded;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-rss-reader-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.addClass('dashboard-rss-reader');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		// The header carries its own labeled save + browser buttons; drop the
		// native corner close so the actions row can sit flush right (the
		// reserved corner clearance made the save button read as off-center).
		removeNativeModalCloseButton(containerEl.querySelector('.modal') ?? containerEl);

		// `dashboard-modal` is load-bearing: it carries the opaque
		// --db-bg-modal surface (glass modal system — the outer .modal box is
		// transparent, so WITHOUT this class the reader renders see-through
		// and its text floats over the dashboard).
		const wrap = contentEl.createDiv({ cls: 'dashboard-rss-reader-wrap dashboard-modal' });

		const header = wrap.createDiv({ cls: 'dashboard-rss-reader-header' });
		const headMain = header.createDiv({ cls: 'dashboard-rss-reader-headmain' });
		headMain.createDiv({ cls: 'dashboard-rss-reader-title', text: this.item.title });
		const meta = headMain.createDiv({ cls: 'dashboard-rss-reader-meta' });
		meta.createSpan({ cls: 'dashboard-rss-reader-feed', text: this.feedTitle });
		if (this.item.author) meta.createSpan({ cls: 'dashboard-rss-reader-author', text: this.item.author });
		if (this.item.pubDate) {
			meta.createSpan({ cls: 'dashboard-rss-reader-date', text: momentOf(this.item.pubDate).format('YYYY-MM-DD HH:mm') });
		}

		const actions = header.createDiv({ cls: 'dashboard-rss-reader-actions' });
		// Labeled save button (an icon-only one was easy to miss): 保存到仓库,
		// flipping to 打开笔记 once the article is saved.
		this.saveBtn = actions.createEl('button', {
			cls: 'dashboard-rss-reader-save',
			attr: { type: 'button' },
		});
		this.refreshSaveButton();
		this.saveBtn.addEventListener('click', () => void this.handleSave());
		const openBtn = actions.createEl('button', {
			cls: 'dashboard-section-add-btn dashboard-rss-reader-btn',
			attr: { type: 'button', 'aria-label': t('rss.openInBrowser') },
		});
		setIcon(openBtn, 'external-link');
		openBtn.addEventListener('click', () => {
			if (this.item.link) window.open(this.item.link, '_blank');
		});
		// Close: the native corner close was dropped so the actions row sits
		// flush right — this key closes from the same row (Esc still works).
		const closeBtn = actions.createEl('button', {
			cls: 'dashboard-section-add-btn dashboard-rss-reader-btn',
			attr: { type: 'button', 'aria-label': t('common.close') },
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = wrap.createDiv({ cls: 'dashboard-rss-reader-body' });
		const loading = body.createDiv({ cls: 'dashboard-rss-reader-loading', text: t('rss.fetchingArticle') });

		const component = new Component();
		component.load();
		this.renderComponent = component;

		this.markdownPromise = resolveArticleMarkdown(this.store, { title: this.feedTitle, link: this.feedLink }, this.item, { fetcher: this.fetcher });
		void this.markdownPromise.then(res => {
			if (this.closed) return;
			loading.remove();
			if (res.markdown) {
				void MarkdownRenderer.render(this.app, res.markdown, body, '', component);
				return;
			}
			const empty = body.createDiv({ cls: 'dashboard-rss-reader-empty' });
			empty.createDiv({ cls: 'dashboard-rss-reader-empty-text', text: t('rss.articleFailed') });
			if (this.item.link) {
				const fallback = empty.createEl('button', {
					cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
					text: t('rss.openInBrowser'),
					attr: { type: 'button' },
				});
				fallback.addEventListener('click', () => window.open(this.item.link, '_blank'));
			}
		});
	}

	/** Rebuild the save button's icon + label for the current saved state. */
	private refreshSaveButton(): void {
		if (!this.saveBtn) return;
		const saved = this.store.savedPath(this.item.guid) !== undefined;
		this.saveBtn.empty();
		setIcon(this.saveBtn.createSpan({ cls: 'dashboard-rss-reader-save-icon' }), saved ? 'file-text' : 'download');
		this.saveBtn.createSpan({ text: t(saved ? 'rss.openNote' : 'rss.saveToVault') });
		this.saveBtn.setAttribute('aria-label', t(saved ? 'rss.openNote' : 'rss.saveToVault'));
		this.saveBtn.toggleClass('is-saved', saved);
	}

	/** Saved before -> jump to the note; otherwise resolve (reusing the body
	 *  promise) and save once. */
	private async handleSave(): Promise<void> {
		const existing = this.store.savedPath(this.item.guid);
		if (existing) {
			const file = this.app.vault.getAbstractFileByPath(existing);
			if (file) {
				void this.app.workspace.openLinkText(existing, '');
				return;
			}
			this.store.clearSaved(this.item.guid);
		}
		try {
			const resolved = await (this.markdownPromise
				?? resolveArticleMarkdown(this.store, { title: this.feedTitle, link: this.feedLink }, this.item, { fetcher: this.fetcher }));
			if (!resolved.markdown) {
				new Notice(t('rss.saveFailed'));
				return;
			}
			const file = await saveRssArticle(this.app, {
				folder: this.downloadFolder,
				feedTitle: this.feedTitle,
				item: this.item,
				markdown: resolved.markdown,
			});
			this.store.setSaved(this.item.guid, file.path);
			this.refreshSaveButton();
			this.onDownloaded?.(this.item.guid, file.path);
			new Notice(t('rss.savedNotice', { name: file.basename }));
		} catch (err) {
			console.error('[Dashboard] rss article save failed:', err);
			new Notice(t('rss.saveFailed'));
		}
	}

	onClose(): void {
		this.closed = true;
		this.renderComponent?.unload();
		this.renderComponent = null;
		this.contentEl.empty();
	}
}
