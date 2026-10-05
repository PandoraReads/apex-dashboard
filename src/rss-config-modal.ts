/**
 * Configuration modal for an RSS section: an editable list of subscription
 * sources (name + URL per row, add/remove, WereadConfigModal's row-editor
 * idiom) and the download folder for saved articles (with the shared path
 * picker). Live validation flags invalid/duplicate URLs and blocks saving a
 * broken source list.
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import type { RssConfig, RssFeedSource } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { attachPathPicker } from './path-picker-modal';
import { showPromptDialog } from './prompt-dialog';
import { isValidWebUrl, normalizeWebUrl } from './web-precheck';
import { rssGroupNames } from './rss-section';
import { feedKey } from './rss-service';
import { getRssStore, type RssStore } from './rss-store';
import { buildOpml, parseOpml } from './rss-opml';
import { uniquePath } from './quick-note-section';

/** Select sentinel value: create a new group right from a feed row
 *  (expense-category-ui's add-option idiom). */
const GROUP_ADD_OPTION = '__rss_add_group__';

export class RssConfigModal extends Modal {
	private feeds: RssFeedSource[];
	private groups: string[];
	private groupBy: 'none' | 'group' | 'feed';
	private downloadFolder: string;
	private readonly onSave: (config: RssConfig) => void;
	/** Cache read for per-row failure status; the shared singleton in
	 *  production, an injected instance in verification scripts. */
	private readonly store: RssStore;
	private listEl: HTMLElement | null = null;
	private groupsEl: HTMLElement | null = null;
	private validationEl: HTMLElement | null = null;
	private confirmBtn: HTMLButtonElement | null = null;

	constructor(app: App, config: RssConfig, onSave: (config: RssConfig) => void, store?: RssStore) {
		super(app);
		this.onSave = onSave;
		this.feeds = (config.feeds ?? []).map(feed => ({ ...feed }));
		this.groups = [...(config.groups ?? [])];
		this.groupBy = config.groupBy ?? 'group';
		this.downloadFolder = config.downloadFolder ?? '';
		this.store = store ?? getRssStore(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('rss.configTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Subscription sources.
		const feedsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		feedsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('rss.configFeeds') });
		this.listEl = feedsSection.createDiv({ cls: 'dashboard-rss-cfg-list' });
		this.renderFeeds();

		// Actions row — add-feed + OPML interchange, right-aligned as a group.
		const opmlRow = feedsSection.createDiv({ cls: 'dashboard-rss-cfg-opml-row' });
		const addBtn = opmlRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm dashboard-rss-cfg-add',
			text: t('rss.configAddFeed'),
			attr: { type: 'button' },
		});
		addBtn.addEventListener('click', () => {
			this.feeds = [...this.feeds, { name: '', url: '' }];
			this.renderFeeds();
		});

		// OPML interchange: one-click import (deduped merge) + export to a
		// vault file other readers (Inoreader/Feedly/Follow/NetNewsWire) take.
		const importBtn = opmlRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-rss-cfg-opml-btn',
			text: t('rss.configImportOpml'),
			attr: { type: 'button' },
		});
		const fileInput = opmlRow.createEl('input', {
			cls: 'dashboard-rss-cfg-opml-file',
			attr: { type: 'file', accept: '.opml,.xml,application/xml,text/xml' },
		});
		importBtn.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', () => void this.importOpmlFile(fileInput));
		const exportBtn = opmlRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-rss-cfg-opml-btn',
			text: t('rss.configExportOpml'),
			attr: { type: 'button' },
		});
		exportBtn.addEventListener('click', () => void this.exportOpml());

		this.validationEl = feedsSection.createDiv({ cls: 'dashboard-dataview-validation' });

		// Group management: the shared bucket list every feed picks from.
		const groupsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		groupsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('rss.configGroups') });
		// Bucket dimension: managed groups (default) / per-feed / off. An
		// inline-row select — same shape as the feed rows' group pickers.
		const groupByRow = groupsSection.createDiv({ cls: 'dashboard-rss-cfg-groupby-row' });
		groupByRow.createSpan({ cls: 'dashboard-rss-cfg-groupby-label', text: t('rss.configGroupBy') });
		const groupBySelect = groupByRow.createEl('select', { cls: 'dashboard-library-filter-property dashboard-rss-cfg-groupby-select' });
		const GROUP_BY_OPTIONS: Array<{ value: 'group' | 'feed' | 'none'; label: string }> = [
			{ value: 'group', label: t('rss.groupByGroup') },
			{ value: 'feed', label: t('rss.groupByFeed') },
			{ value: 'none', label: t('rss.groupByNone') },
		];
		for (const option of GROUP_BY_OPTIONS) {
			const opt = groupBySelect.createEl('option', { text: option.label, attr: { value: option.value } });
			opt.selected = this.groupBy === option.value;
		}
		groupBySelect.addEventListener('change', () => {
			this.groupBy = groupBySelect.value as 'group' | 'feed' | 'none';
		});
		this.groupsEl = groupsSection.createDiv({ cls: 'dashboard-rss-cfg-groups' });
		this.renderGroups();
		const addGroupRow = groupsSection.createDiv({ cls: 'dashboard-rss-cfg-group-add-row' });
		const addGroupInput = addGroupRow.createEl('input', {
			cls: 'dashboard-task-input dashboard-rss-cfg-group-add-input',
			attr: { type: 'text', placeholder: t('rss.configNewGroupPh') },
		});
		const addGroupBtn = addGroupRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('rss.configAddGroup'),
			attr: { type: 'button' },
		});
		const submitGroup = (): void => {
			const name = addGroupInput.value.trim();
			if (!name || this.groups.includes(name)) {
				addGroupInput.value = '';
				return;
			}
			this.groups = [...this.groups, name];
			addGroupInput.value = '';
			this.renderGroups();
			this.renderFeeds();
		};
		addGroupBtn.addEventListener('click', submitGroup);
		addGroupInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submitGroup();
			}
		});
		groupsSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('rss.configGroupsHint') });

		// Download folder.
		const folderSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		folderSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('rss.configFolder') });
		const folderRow = folderSection.createDiv({ cls: 'dashboard-rss-cfg-folder-row' });
		const folderInput = folderRow.createEl('input', {
			cls: 'dashboard-task-input dashboard-rss-cfg-folder',
			attr: { type: 'text', placeholder: t('rss.configFolderPlaceholder'), spellcheck: 'false' },
		});
		folderInput.value = this.downloadFolder;
		folderInput.addEventListener('change', () => {
			this.downloadFolder = folderInput.value.trim().replace(/^\/+|\/+$/g, '');
		});
		attachPathPicker(folderRow, folderInput, this.app, 'folder', path => {
			this.downloadFolder = path;
		});

		folderSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('rss.configFolderHint') });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		this.confirmBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		this.confirmBtn.addEventListener('click', () => this.trySave());
		this.validate();
	}

	/** Group rows with remove; removing also clears feed references (a feed
	 *  pointing at a deleted group falls back to ungrouped). */
	private renderGroups(): void {
		if (!this.groupsEl) return;
		this.groupsEl.empty();
		if (this.groups.length === 0) {
			this.groupsEl.createDiv({ cls: 'dashboard-library-config-hint', text: t('rss.configNoGroups') });
			return;
		}
		for (const group of this.groups) {
			const row = this.groupsEl.createDiv({ cls: 'dashboard-rss-cfg-group-row' });
			row.createSpan({ cls: 'dashboard-rss-cfg-group-name', text: group });
			const rm = row.createEl('button', {
				cls: 'dashboard-rss-cfg-remove dashboard-rss-cfg-group-remove',
				attr: { type: 'button', 'aria-label': t('rss.configRemoveGroup'), title: t('rss.configRemoveGroup') },
			});
			setIcon(rm, 'x');
			rm.addEventListener('click', () => {
				this.groups = this.groups.filter(g => g !== group);
				this.feeds = this.feeds.map(f => f.group === group ? { ...f, group: undefined } : f);
				this.renderGroups();
				this.renderFeeds();
			});
		}
	}

	/** Row editor: each source is name + group select + URL + delete; state is
	 *  self-held and the whole list re-renders on structural changes (weread
	 *  idiom). */
	private renderFeeds(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		this.feeds.forEach((feed, i) => {
			const row = this.listEl!.createDiv({ cls: 'dashboard-rss-cfg-row' });
			const nameInput = row.createEl('input', {
				cls: 'dashboard-task-input dashboard-rss-cfg-name',
				attr: { type: 'text', placeholder: t('rss.configFeedName'), value: feed.name ?? '' },
			});
			nameInput.addEventListener('input', () => {
				this.feeds = this.feeds.map((f, idx) => idx === i ? { ...f, name: nameInput.value } : f);
				this.validate();
			});
			this.appendGroupSelect(row, feed, i);
			const urlInput = row.createEl('input', {
				cls: 'dashboard-task-input dashboard-rss-cfg-url',
				attr: { type: 'text', placeholder: t('rss.configFeedUrl'), spellcheck: 'false', value: feed.url },
			});
			urlInput.addEventListener('input', () => {
				this.feeds = this.feeds.map((f, idx) => idx === i ? { ...f, url: urlInput.value } : f);
				this.validate();
			});
			// Failure status rides the row (before the delete affordance): the
			// section list stays clean (content only) — the config modal is
			// where feeds get diagnosed.
			const error = this.store.feedEntry(feedKey(feed.url))?.error;
			if (error) {
				const status = row.createSpan({
					cls: 'dashboard-rss-cfg-status is-error',
					text: t('rss.configFeedFailed'),
				});
				status.setAttribute('title', `${feed.name?.trim() || feed.url}: ${error}`);
			}
			const rmBtn = row.createEl('button', {
				cls: 'dashboard-rss-cfg-remove',
				attr: { type: 'button', 'aria-label': t('rss.configRemoveFeed'), title: t('rss.configRemoveFeed') },
			});
			setIcon(rmBtn, 'trash-2');
			rmBtn.addEventListener('click', () => {
				this.feeds = this.feeds.filter((_, idx) => idx !== i);
				this.renderFeeds();
				this.validate();
			});
		});
		if (this.feeds.length === 0) {
			this.listEl.createDiv({ cls: 'dashboard-library-config-hint', text: t('rss.configNoFeeds') });
		}
	}

	/** Group picker for one feed: no-group + every known group + a dangling
	 *  reference (kept visible) + the new-group sentinel. */
	private appendGroupSelect(row: HTMLElement, feed: RssFeedSource, i: number): void {
		const known = rssGroupNames({ groups: this.groups, feeds: this.feeds });
		const select = row.createEl('select', { cls: 'dashboard-library-filter-property dashboard-rss-cfg-group-select' });
		const none = select.createEl('option', { text: t('rss.configGroupNone'), attr: { value: '' } });
		none.selected = !feed.group;
		for (const group of known) {
			const opt = select.createEl('option', { text: group, attr: { value: group } });
			opt.selected = feed.group === group;
		}
		select.createEl('option', { text: t('rss.configNewGroup'), attr: { value: GROUP_ADD_OPTION } });
		select.addEventListener('change', () => {
			const value = select.value;
			if (value === GROUP_ADD_OPTION) {
				select.value = feed.group ?? '';
				void showPromptDialog(this.app, {
					title: t('rss.configNewGroupTitle'),
					placeholder: t('rss.configNewGroupPh'),
				}).then(name => {
					const clean = (name ?? '').trim();
					if (!clean) return;
					if (!this.groups.includes(clean)) this.groups = [...this.groups, clean];
					this.feeds = this.feeds.map((f, idx) => idx === i ? { ...f, group: clean } : f);
					this.renderGroups();
					this.renderFeeds();
				});
				return;
			}
			this.feeds = this.feeds.map((f, idx) => idx === i ? { ...f, group: value || undefined } : f);
		});
	}

	/** Read the picked OPML file and merge its feeds (URL-deduped; category
	 *  outlines become group assignments + group-list entries). */
	private async importOpmlFile(fileInput: HTMLInputElement): Promise<void> {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			const parsed = parseOpml(text);
			if (parsed.feeds.length === 0) {
				new Notice(t('rss.opmlInvalid'));
				return;
			}
			const existing = new Set(
				this.feeds
					.map(feed => normalizeWebUrl(feed.url.trim()).toLowerCase())
					.filter(url => url.length > 0),
			);
			let added = 0;
			let skipped = 0;
			for (const feed of parsed.feeds) {
				const url = normalizeWebUrl(feed.url.trim());
				if (!url || !isValidWebUrl(url)) {
					skipped++;
					continue;
				}
				const key = url.toLowerCase();
				if (existing.has(key)) {
					skipped++;
					continue;
				}
				existing.add(key);
				this.feeds = [...this.feeds, {
					...(feed.name ? { name: feed.name } : {}),
					url,
					...(feed.group ? { group: feed.group } : {}),
				}];
				added++;
			}
			for (const group of parsed.groups) {
				if (!this.groups.includes(group)) this.groups = [...this.groups, group];
			}
			this.renderGroups();
			this.renderFeeds();
			this.validate();
			new Notice(t('rss.opmlImported', { count: String(added), skipped: String(skipped) }));
		} catch (err) {
			console.error('[Dashboard] OPML import failed:', err);
			new Notice(t('rss.opmlInvalid'));
		}
	}

	/** Write the current subscriptions as OPML into the vault root. */
	private async exportOpml(): Promise<void> {
		const feeds = this.feeds
			.map(feed => ({ name: (feed.name ?? '').trim(), url: normalizeWebUrl(feed.url.trim()), group: (feed.group ?? '').trim() }))
			.filter(feed => feed.url.length > 0)
			.map(feed => (feed.group ? feed : { name: feed.name, url: feed.url }));
		if (feeds.length === 0) {
			new Notice(t('rss.opmlEmpty'));
			return;
		}
		try {
			const xml = buildOpml({ feeds, groups: this.groups });
			const path = await uniquePath(this.app, 'RSS订阅导出.opml');
			await this.app.vault.adapter.write(path, xml);
			new Notice(t('rss.opmlExported', { path }));
		} catch (err) {
			console.error('[Dashboard] OPML export failed:', err);
			new Notice(t('rss.opmlExportFailed'));
		}
	}

	/** URL validity + duplicate check; invalid rows get the error class and
	 *  saving stays disabled until they are fixed or removed. */
	private validate(): void {
		if (!this.validationEl || !this.confirmBtn) return;
		this.validationEl.empty();
		const rows = this.listEl?.querySelectorAll('.dashboard-rss-cfg-row') ?? [];
		rows.forEach(row => row.removeClass('is-error'));

		const seen = new Set<string>();
		let invalid = 0;
		let duplicate = 0;
		this.feeds.forEach((feed, i) => {
			const raw = feed.url.trim();
			if (!raw && !(feed.name ?? '').trim()) return; // fully empty rows drop on save
			if (!raw || !isValidWebUrl(normalizeWebUrl(raw))) {
				invalid++;
				rows[i]?.addClass('is-error');
				return;
			}
			const key = normalizeWebUrl(raw).toLowerCase();
			if (seen.has(key)) {
				duplicate++;
				rows[i]?.addClass('is-error');
				return;
			}
			seen.add(key);
		});

		const hasError = invalid > 0 || duplicate > 0;
		this.confirmBtn.disabled = hasError;
		if (invalid > 0) {
			this.validationEl.addClass('is-error');
			this.validationEl.createSpan({ text: t('rss.configInvalidUrl') });
		} else if (duplicate > 0) {
			this.validationEl.addClass('is-error');
			this.validationEl.createSpan({ text: t('rss.configDuplicateUrl') });
		} else {
			this.validationEl.removeClass('is-error');
		}
	}

	private trySave(): void {
		if (this.confirmBtn?.disabled) return;
		const feeds = this.feeds
			.map(feed => ({
				name: (feed.name ?? '').trim(),
				url: normalizeWebUrl(feed.url.trim()),
				group: (feed.group ?? '').trim(),
			}))
			.filter(feed => feed.url.length > 0)
			.map(feed => (feed.group ? feed : { name: feed.name, url: feed.url }));
		const groups = [...new Set(this.groups.map(g => g.trim()).filter(g => g.length > 0))];
		this.onSave({
			feeds,
			downloadFolder: this.downloadFolder.trim().replace(/^\/+|\/+$/g, ''),
			...(groups.length > 0 ? { groups } : {}),
			...(this.groupBy !== 'group' ? { groupBy: this.groupBy } : {}),
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
