import { App, Modal, setIcon } from 'obsidian';
import type { DashboardCard } from './types';
import { t } from './i18n';

export class CardEditModal extends Modal {
	private card: DashboardCard;
	private onSave: (updates: { title: string; body: string; coverImage: string }) => void;
	private theme: string;
	private linkedPaths: string[];
	private coverImageValue: string;
	private pendingPaths: Set<string> = new Set();

	constructor(
		app: App,
		card: DashboardCard,
		onSave: (updates: { title: string; body: string; coverImage: string }) => void,
		theme?: string,
	) {
		super(app);
		this.card = card;
		this.onSave = onSave;
		this.theme = theme ?? 'earth';

		this.linkedPaths = card.body.split('\n')
			.map(line => line.trim())
			.filter(line => line.startsWith('[[') && line.endsWith(']]'))
			.map(line => line.slice(2, -2));

		this.coverImageValue = card.coverImage || '';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		contentEl.createEl('h2', { text: t('cardEdit.title') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		const titleField = form.createDiv();
		titleField.createEl('label', { text: t('cardEdit.titleLabel') });
		const titleInput = titleField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text' },
		});
		titleInput.value = this.card.title;

		const coverField = form.createDiv();
		coverField.createEl('label', { text: t('cardEdit.coverImage') });
		const coverInput = coverField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('cardEdit.coverImagePlaceholder') },
		});
		coverInput.value = this.coverImageValue;

		const docsField = form.createDiv();
		docsField.createEl('label', { text: t('cardEdit.linkedDocs') });

		const docsList = docsField.createDiv({ cls: 'dashboard-modal-docs-list' });

		const renderDocs = () => {
			docsList.empty();
			if (this.linkedPaths.length === 0) {
				docsList.createDiv({ cls: 'dashboard-modal-docs-empty', text: t('cardEdit.noDocs') });
				return;
			}
			this.linkedPaths.forEach((docPath, idx) => {
				const file = this.app.vault.getFileByPath(docPath);
				const docItem = docsList.createDiv({ cls: 'dashboard-modal-doc-item' });
				docItem.createSpan({
					text: file?.basename ?? docPath.split('/').pop() ?? docPath,
					cls: 'dashboard-modal-doc-name',
				});

				const removeBtn = docItem.createEl('button', {
					cls: 'dashboard-modal-doc-remove',
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => {
					this.linkedPaths = this.linkedPaths.filter((_, i) => i !== idx);
					renderDocs();
				});
			});
		};

		renderDocs();

		// Search with multi-select
		const searchField = form.createDiv();
		searchField.createEl('label', { text: t('cardEdit.searchDocs') });
		const searchInput = searchField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('quickLinks.typeToSearch') },
		});

		const searchResults = searchField.createDiv({ cls: 'dashboard-modal-search-results' });

		const renderSearchResults = () => {
			searchResults.empty();
			const q = searchInput.value.toLowerCase().trim();
			if (!q) return;

			const files = this.app.vault.getFiles()
				.filter(f => !f.path.startsWith('.'))
				.filter(f => f.extension === 'md' || f.extension === 'pdf' || f.extension === 'canvas' || f.extension === 'base' || /\.(png|jpg|jpeg|gif|svg|webp|bmp|mp3|mp4|m4a|m4b|mov|mkv|avi)$/i.test(f.path))
				.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
				.filter(f => !this.linkedPaths.includes(f.path))
				.slice(0, 50);

			if (files.length === 0) {
				searchResults.createDiv({ cls: 'dashboard-modal-search-hint', text: t('quickLinks.noDocsFound') });
				return;
			}

			for (const file of files) {
				const selected = this.pendingPaths.has(file.path);
				const item = searchResults.createDiv({ cls: 'dashboard-modal-search-item' + (selected ? ' is-selected' : '') });

				const check = item.createDiv({ cls: 'dashboard-modal-search-check' });
				if (selected) {
					setIcon(check, 'check');
				}

				const info = item.createDiv({ cls: 'dashboard-modal-search-info' });
				info.createSpan({ text: file.basename, cls: 'dashboard-modal-search-name' });
				info.createSpan({ text: file.path, cls: 'dashboard-modal-search-path' });

				item.addEventListener('click', () => {
					if (this.pendingPaths.has(file.path)) {
						this.pendingPaths.delete(file.path);
					} else {
						this.pendingPaths.add(file.path);
					}
					renderSearchResults();
					updateAddBtn();
				});
			}
		};

		searchInput.addEventListener('input', () => {
			renderSearchResults();
		});

		searchInput.addEventListener('focus', () => {
			if (searchInput.value.trim()) {
				renderSearchResults();
			}
		});

		// Batch add button
		const addBtn = form.createEl('button', {
			cls: 'dashboard-modal-batch-add mod-cta',
			text: t('cardEdit.addSelected'),
		});
		addBtn.setCssProps({ display: 'none' });

		const updateAddBtn = () => {
			const count = this.pendingPaths.size;
			if (count > 0) {
				addBtn.setCssProps({ display: '' });
				addBtn.textContent = t('cardEdit.addSelectedCount', { count: String(count) });
			} else {
				addBtn.setCssProps({ display: 'none' });
			}
		};

		addBtn.addEventListener('click', () => {
			if (this.pendingPaths.size === 0) return;
			this.linkedPaths = [...this.linkedPaths, ...this.pendingPaths];
			this.pendingPaths.clear();
			searchInput.value = '';
			searchResults.empty();
			renderDocs();
			updateAddBtn();
		});

		const actions = form.createDiv({ cls: 'dashboard-modal-actions' });

		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			const body = this.linkedPaths.map(p => `[[${p}]]`).join('\n');
			this.onSave({
				title: titleInput.value.trim() || this.card.title,
				body,
				coverImage: coverInput.value.trim(),
			});
			this.close();
		});

		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveBtn.click();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
