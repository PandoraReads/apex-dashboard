import { App, Modal, setIcon } from 'obsidian';
import type { QuickAction } from './types';
import { PRESET_ACTIONS } from './types';
import { t } from './i18n';
import type { AppWithCommands } from './obsidian-internal';

function actionKey(action: QuickAction, isPreset: boolean): string {
	return isPreset ? `p:${action.target}` : `c:${action.target}`;
}

interface OrderedAction {
	action: QuickAction;
	isPreset: boolean;
	key: string;
}

// Curated set of common Lucide icons offered in the quick-action icon picker.
const COMMON_ICONS: readonly string[] = [
	'file-text', 'folder', 'folder-open', 'notebook-pen',
	'star', 'bookmark', 'heart', 'flag', 'award', 'trophy',
	'list', 'list-checks', 'circle-check', 'square-check',
	'calendar', 'calendar-days', 'clock', 'alarm-clock', 'timer',
	'pencil', 'pen-line', 'edit',
	'search', 'home', 'settings', 'sliders-horizontal',
	'link', 'external-link', 'paperclip',
	'terminal', 'command', 'play',
	'mail', 'message-square', 'bell', 'bell-ring',
	'user', 'users', 'contact',
	'image', 'camera', 'music', 'headphones', 'film',
	'plus', 'download', 'upload', 'save', 'send', 'inbox',
	'zap', 'flame', 'target', 'trending-up', 'rocket', 'sparkles',
	'book', 'book-open', 'library',
	'map-pin', 'compass', 'globe',
	'lock', 'key', 'shield',
	'tag', 'hash', 'label',
	'code', 'database', 'git-branch',
	'sun', 'moon', 'cloud',
	'coffee', 'dumbbell', 'utensils',
	'eye', 'filter', 'layers', 'trash-2', 'palette', 'brush',
	'pin', 'megaphone', 'phone',
];

function buildOrderedActions(actions: QuickAction[], order?: string[], hiddenPresets?: string[]): OrderedAction[] {
	const hidden = new Set(hiddenPresets ?? []);
	const all: OrderedAction[] = [
		...PRESET_ACTIONS.filter(a => !hidden.has(actionKey(a, true))).map((a) => ({ action: a, isPreset: true, key: actionKey(a, true) })),
		...actions.map(a => ({ action: a, isPreset: false, key: actionKey(a, false) })),
	];

	if (!order || order.length === 0) return all;

	const keySet = new Set(order);
	const ordered: OrderedAction[] = [];
	for (const k of order) {
		const found = all.find(a => a.key === k);
		if (found) ordered.push(found);
	}
	for (const a of all) {
		if (!keySet.has(a.key)) ordered.push(a);
	}
	return ordered;
}

export function renderQuickActions(
	container: HTMLElement,
	actions: QuickAction[],
	onExecute: (action: QuickAction) => void,
	_onRemove: (index: number) => void,
	onAdd: () => void,
	initialPinned?: boolean,
	onTogglePin?: () => void,
	order?: string[],
	onReorder?: (order: string[]) => void,
	onRemoveByKey?: (key: string) => void,
	hiddenPresets?: string[],
	onEdit?: (action: QuickAction) => void,
): void {
	const section = container.createDiv({ cls: 'dashboard-section dashboard-quick-actions' });

	const header = section.createDiv({ cls: 'dashboard-qa-header' });
	header.createEl('h3', { text: t('quickActions.title'), cls: 'dashboard-section-title' });

	const btnGroup = header.createDiv({ cls: 'dashboard-qa-btn-group' });

	// Pin button (left of add button)
	if (onTogglePin) {
		let pinned = initialPinned ?? false;
		const pinBtn = btnGroup.createEl('button', {
			cls: 'dashboard-qa-pin-btn',
			attr: { 'aria-label': 'Toggle pin' },
		});
		const updatePinIcon = () => {
			setIcon(pinBtn, pinned ? 'pin' : 'pin-off');
			pinBtn.toggleClass('dashboard-qa-pin-btn--active', pinned);
		};
		updatePinIcon();
		pinBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			onTogglePin();
			pinned = !pinned;
			updatePinIcon();
		});
	}

	const addBtn = btnGroup.createEl('button', {
		cls: 'dashboard-qa-add-btn',
		attr: { 'aria-label': t('quickActions.addAction') },
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', onAdd);

	const list = section.createDiv({ cls: 'dashboard-qa-list' });

	const ordered = buildOrderedActions(actions, order, hiddenPresets);

	if (ordered.length === 0) {
		section.createSpan({ text: t('quickActions.empty'), cls: 'dashboard-empty' });
		return;
	}

	// DnD state
	let draggedKey: string | null = null;

	const onDragStart = (e: DragEvent, key: string) => {
		draggedKey = key;
		const target = e.currentTarget as HTMLElement;
		target.addClass('dashboard-qa-item--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', key);
		}
	};

	const onDragEnd = (e: Event) => {
		(e.currentTarget as HTMLElement).removeClass('dashboard-qa-item--dragging');
		list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
		draggedKey = null;
	};

	const onDragOver = (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const item = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (item && !item.hasClass('dashboard-qa-item--dragging')) {
			list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
			item.addClass('dashboard-qa-item--drag-over');
		}
	};

	const onDragLeave = (e: DragEvent) => {
		const item = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (item) item.removeClass('dashboard-qa-item--drag-over');
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
		if (!draggedKey || !onReorder) return;

		const targetItem = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (!targetItem) return;

		const targetKey = targetItem.dataset.qaKey;
		if (!targetKey || targetKey === draggedKey) return;

		// Build new order from current DOM order with the swap
		const items = Array.from(list.querySelectorAll<HTMLElement>('.dashboard-qa-item'));
		const currentKeys = items.map(el => el.dataset.qaKey ?? '');
		const fromIdx = currentKeys.indexOf(draggedKey);
		const toIdx = currentKeys.indexOf(targetKey);
		if (fromIdx === -1 || toIdx === -1) return;

		const newKeys = currentKeys.filter(k => k !== draggedKey);
		newKeys.splice(toIdx, 0, draggedKey);
		onReorder(newKeys);
	};

	for (const { action, isPreset, key } of ordered) {
		const item = list.createDiv({
			cls: 'dashboard-qa-item' + (isPreset ? ' dashboard-qa-item--preset' : ''),
			attr: { draggable: 'true', 'data-qa-key': key },
		});

		const iconEl = item.createSpan({ cls: 'dashboard-qa-icon' });
		setIcon(iconEl, action.icon);
		item.createSpan({ text: action.name, cls: 'dashboard-qa-name' });
		item.setAttribute('title', action.name);

		// Remove button (on all items)
		const removeHandler = onRemoveByKey ?? ((k: string) => {
			if (k.startsWith('c:')) {
				const idx = actions.findIndex(a => `c:${a.target}` === k);
				if (idx !== -1) _onRemove(idx);
			}
		});
		const removeBtn = item.createEl('button', {
			cls: 'dashboard-qa-remove',
			attr: { 'aria-label': t('common.remove', { name: action.name }) },
		});
		setIcon(removeBtn, 'x');
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			removeHandler(key);
		});

		// Edit button: custom actions only, and only when an onEdit handler is
		// supplied (desktop). Mobile omits onEdit, so no edit button there.
		if (onEdit && !isPreset) {
			const editBtn = item.createEl('button', {
				cls: 'dashboard-qa-edit',
				attr: { 'aria-label': t('quickActions.editAction') },
			});
			setIcon(editBtn, 'pencil');
			editBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				onEdit(action);
			});
		}

		item.addEventListener('click', () => onExecute(action));
		item.setAttribute('role', 'button');

		// DnD events
		item.addEventListener('dragstart', (e) => onDragStart(e, key));
		item.addEventListener('dragend', onDragEnd);
		item.addEventListener('dragover', onDragOver);
		item.addEventListener('dragleave', onDragLeave);
		item.addEventListener('drop', onDrop);
	}

}

export class AddActionModal extends Modal {
	private onSelect: (action: QuickAction) => void;
	private activeTab: 'file' | 'command' = 'file';
	private pendingAction: QuickAction | null = null;
	private lastQuery = '';
	private isEditMode = false;

	constructor(app: App, onSelect: (action: QuickAction) => void, initialAction?: QuickAction) {
		super(app);
		this.onSelect = onSelect;
		this.pendingAction = initialAction ?? null;
		this.isEditMode = !!initialAction;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('dashboard-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: t('quickActions.addAction') });

		if (this.pendingAction) {
			this.renderConfirmView(contentEl);
		} else {
			this.renderSearchView(contentEl);
		}
	}

	private renderSearchView(contentEl: HTMLElement): void {
		const tabBar = contentEl.createDiv({ cls: 'dashboard-action-tabs' });
		const fileTab = tabBar.createEl('button', {
			cls: 'dashboard-action-tab' + (this.activeTab === 'file' ? ' active' : ''),
			text: t('quickActions.fileTab'),
		});
		const cmdTab = tabBar.createEl('button', {
			cls: 'dashboard-action-tab' + (this.activeTab === 'command' ? ' active' : ''),
			text: t('quickActions.commandTab'),
		});

		const switchTab = (tab: 'file' | 'command') => {
			this.activeTab = tab;
			this.lastQuery = '';
			this.render();
		};
		fileTab.addEventListener('click', () => switchTab('file'));
		cmdTab.addEventListener('click', () => switchTab('command'));

		const searchWrap = contentEl.createDiv({ cls: 'dashboard-docsearch' });
		const input = searchWrap.createEl('input', {
			cls: 'dashboard-modal-input dashboard-docsearch-input',
			attr: { type: 'text', placeholder: t('quickActions.searchPlaceholder'), autofocus: 'true', value: this.lastQuery },
		});
		const resultsList = searchWrap.createDiv({ cls: 'dashboard-docsearch-results' });

		const renderResults = (query: string) => {
			resultsList.empty();
			const q = query.toLowerCase().trim();
			if (this.activeTab === 'file') {
				this.renderFileResults(resultsList, q);
			} else {
				this.renderCommandResults(resultsList, q);
			}
		};

		input.addEventListener('input', () => {
			this.lastQuery = input.value;
			renderResults(input.value);
		});
		renderResults(input.value);
		input.focus();

		const cancelBtn = contentEl.createEl('button', {
			cls: 'dashboard-docsearch-cancel',
			text: t('common.cancel'),
		});
		cancelBtn.addEventListener('click', () => this.close());
	}

	private renderConfirmView(contentEl: HTMLElement): void {
		const action = this.pendingAction!;
		const defaultName = action.name;
		const defaultIcon = action.icon;

		// Preview of the selected file/command
		const preview = contentEl.createDiv({ cls: 'dashboard-qa-confirm-preview' });
		const previewIcon = preview.createDiv({ cls: 'dashboard-docsearch-icon dashboard-qa-confirm-preview-icon' });
		setIcon(previewIcon, defaultIcon);
		const previewInfo = preview.createDiv({ cls: 'dashboard-docsearch-info' });
		previewInfo.createDiv({ cls: 'dashboard-docsearch-name', text: defaultName });
		previewInfo.createDiv({ cls: 'dashboard-docsearch-path', text: action.target });

		// Name field
		const nameField = contentEl.createDiv({ cls: 'dashboard-qa-confirm-field' });
		nameField.createEl('label', { text: t('quickActions.displayName'), cls: 'dashboard-qa-confirm-label' });
		const nameInput = nameField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', value: defaultName },
		});

		// Icon picker: clickable grid of common icons
		const iconField = contentEl.createDiv({ cls: 'dashboard-qa-confirm-field' });
		iconField.createEl('label', { text: t('quickActions.icon'), cls: 'dashboard-qa-confirm-label' });
		let selectedIcon = defaultIcon;
		const grid = iconField.createDiv({ cls: 'dashboard-qa-icon-grid' });
		const allIcons = COMMON_ICONS.includes(defaultIcon) ? COMMON_ICONS : [defaultIcon, ...COMMON_ICONS];
		const renderGrid = () => {
			grid.empty();
			for (const iconName of allIcons) {
				const opt = grid.createDiv({
					cls: 'dashboard-qa-icon-option' + (iconName === selectedIcon ? ' dashboard-qa-icon-option--selected' : ''),
					attr: { title: iconName, 'aria-label': iconName, role: 'button' },
				});
				setIcon(opt, iconName);
				opt.addEventListener('click', () => {
					selectedIcon = iconName;
					setIcon(previewIcon, selectedIcon);
					grid.querySelectorAll('.dashboard-qa-icon-option').forEach(el => el.removeClass('dashboard-qa-icon-option--selected'));
					opt.addClass('dashboard-qa-icon-option--selected');
				});
			}
		};
		renderGrid();

		nameInput.focus();
		nameInput.select();

		const finish = () => {
			const finalName = nameInput.value.trim() || defaultName;
			this.onSelect({ ...action, name: finalName, icon: selectedIcon });
			this.close();
		};

		nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); finish(); }
		});

		const actions = contentEl.createDiv({ cls: 'dashboard-modal-actions' });
		const backBtn = actions.createEl('button', {
			text: this.isEditMode ? t('common.cancel') : t('quickActions.back'),
		});
		backBtn.addEventListener('click', () => {
			if (this.isEditMode) {
				this.close();
			} else {
				this.pendingAction = null;
				this.render();
			}
		});
		const confirmBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.isEditMode ? t('quickActions.saveAction') : t('quickActions.confirmAdd'),
		});
		confirmBtn.addEventListener('click', finish);
	}

	private renderFileResults(container: HTMLElement, q: string): void {
		if (!q) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.typeToSearchFile') });
			return;
		}

		const files = this.app.vault.getFiles()
			.filter(f => !f.path.startsWith('.'))
			.filter(f => f.extension === 'md' || f.extension === 'pdf' || f.extension === 'canvas' || f.extension === 'base' || /\.(png|jpg|jpeg|gif|svg|webp|bmp|mp3|mp4|m4a|m4b|mov|mkv|avi)$/i.test(f.path))
			.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
			.slice(0, 20);

		if (files.length === 0) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		for (const file of files) {
			const item = container.createDiv({ cls: 'dashboard-docsearch-item' });
			item.createSpan({ cls: 'dashboard-docsearch-icon', text: '\u{1F4C4}' });
			const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
			info.createDiv({ cls: 'dashboard-docsearch-name', text: file.basename });
			info.createDiv({ cls: 'dashboard-docsearch-path', text: file.path });

			item.addEventListener('click', () => {
				this.pendingAction = { name: file.basename, icon: 'file-text', type: 'file', target: file.path };
				this.render();
			});
		}
	}

	private renderCommandResults(container: HTMLElement, q: string): void {
		const commands = (this.app as AppWithCommands).commands.commands;

		if (!commands) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		const entries = Object.entries(commands)
			.map(([id, cmd]) => ({ id, name: cmd.name ?? id }))
			.filter(entry => {
				if (!q) return true;
				return entry.name.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q);
			})
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, 30);

		if (!q) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.typeToSearchCmd') });
			return;
		}

		if (entries.length === 0) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		for (const entry of entries) {
			const item = container.createDiv({ cls: 'dashboard-docsearch-item' });
			item.createSpan({ cls: 'dashboard-docsearch-icon', text: '⚙️' });
			const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
			info.createDiv({ cls: 'dashboard-docsearch-name', text: entry.name });
			info.createDiv({ cls: 'dashboard-docsearch-path', text: entry.id });

			item.addEventListener('click', () => {
				this.pendingAction = { name: entry.name, icon: 'terminal', type: 'command', target: entry.id };
				this.render();
			});
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Kept for project search modal reuse
export class DocSearchModal extends Modal {
	private onSelect: (link: { name: string; path: string }) => void;

	constructor(app: App, onSelect: (link: { name: string; path: string }) => void) {
		super(app);
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('dashboard-modal');
		contentEl.createEl('h2', { text: t('quickActions.fileTab') });

		const searchWrap = contentEl.createDiv({ cls: 'dashboard-docsearch' });
		const input = searchWrap.createEl('input', {
			cls: 'dashboard-modal-input dashboard-docsearch-input',
			attr: { type: 'text', placeholder: t('quickActions.searchPlaceholder'), autofocus: 'true' },
		});
		const resultsList = searchWrap.createDiv({ cls: 'dashboard-docsearch-results' });

		const renderResults = (query: string) => {
			resultsList.empty();
			const q = query.toLowerCase().trim();
			if (!q) return;

			const files = this.app.vault.getFiles()
				.filter(f => !f.path.startsWith('.'))
				.filter(f => f.extension === 'md' || f.extension === 'pdf' || f.extension === 'canvas' || f.extension === 'base' || /\.(png|jpg|jpeg|gif|svg|webp|bmp|mp3|mp4|m4a|m4b|mov|mkv|avi)$/i.test(f.path))
				.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
				.slice(0, 20);

			for (const file of files) {
				const item = resultsList.createDiv({ cls: 'dashboard-docsearch-item' });
				item.createSpan({ cls: 'dashboard-docsearch-icon', text: '\u{1F4C4}' });
				const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
				info.createDiv({ cls: 'dashboard-docsearch-name', text: file.basename });
				info.createDiv({ cls: 'dashboard-docsearch-path', text: file.path });
				item.addEventListener('click', () => {
					this.onSelect({ name: file.basename, path: file.path });
					this.close();
				});
			}
		};

		input.addEventListener('input', () => renderResults(input.value));
		input.focus();

		contentEl.createEl('button', {
			cls: 'dashboard-docsearch-cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
