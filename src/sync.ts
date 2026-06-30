import { App, TFile } from 'obsidian';
import type { DashboardSettings, DashboardCard, DashboardData, TaskItem, DocNode, QuickAction, BannerData, CardType } from './types';
import { parse, serialize, generateDefaultMarkdown } from './parser';
import { t } from './i18n';
import {
	type TaskPath,
	updateTaskAt,
	removeTaskAt,
	insertSibling,
	appendChild,
	demoteToChild,
	nestIntoTarget,
	promoteToTopLevel,
	recalcChecked,
	archiveCompleted,
} from './task-tree';
import {
	type DocPath,
	updateDocAt,
	removeDocAt,
	insertDocSibling,
	appendDocChild,
	demoteDocToChild,
} from './doc-tree';

type DataCallback = (data: DashboardData) => void;

type TaskDropMode = 'before' | 'after' | 'nest';

export class SyncEngine {
	private app: App;
	private settings: DashboardSettings;
	private file: TFile | null = null;
	private data: DashboardData | null = null;
	private debounceTimer: number | null = null;
	private readonly debounceMs = 300;
	private writeQueue: Promise<void> = Promise.resolve();
	private callbacks: DataCallback[] = [];
	private eventRef: ReturnType<typeof this.app.vault.on> | null = null;
	private static readonly BACKUP_DIR = '.dashboard-backup';
	private static readonly MAX_BACKUPS = 5;

	constructor(app: App, settings: DashboardSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: DashboardSettings): void {
		this.settings = settings;
	}

	onDataUpdate(cb: DataCallback): void {
		this.callbacks.push(cb);
	}

	async init(): Promise<void> {
		await this.findOrCreateFile();
		this.registerFileWatcher();
		await this.load();
	}

	destroy(): void {
		if (this.eventRef) {
			this.app.vault.offref(this.eventRef);
			this.eventRef = null;
		}
		if (this.renameEventRef) {
			this.app.vault.offref(this.renameEventRef);
			this.renameEventRef = null;
		}
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
		}
		if (this.deferredWriteTimer) {
			window.clearTimeout(this.deferredWriteTimer);
		}
	}

	getData(): DashboardData | null {
		return this.data;
	}

	async refresh(): Promise<void> {
		await this.load();
	}

	private mapCardTasks(
		data: DashboardData,
		cardId: string,
		transform: (tasks: TaskItem[]) => TaskItem[],
	): DashboardData {
		return {
			...data,
			columns: data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, tasks: transform(card.tasks) } : card,
				),
			})),
		};
	}

	private mapCardDocs(
		data: DashboardData,
		cardId: string,
		transform: (docs: DocNode[]) => DocNode[],
	): DashboardData {
		return {
			...data,
			columns: data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, docs: transform(card.docs) } : card,
				),
			})),
		};
	}

	async archiveTasks(columnName: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map((col) => {
				if (col.name !== columnName) return col;
				return {
					...col,
					cards: col.cards.map((card) => {
						const { archived, remaining } = archiveCompleted(card.tasks);
						return archived.length === 0 ? card : { ...card, tasks: remaining };
					}),
				};
			}),
		};
		await this.writeToDisk();
	}

	async toggleTask(cardId: string, taskPath: TaskPath, checked: boolean): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) => {
			let next = updateTaskAt(tasks, taskPath, (t) => {
				if (t.children && t.children.length > 0) {
					return { ...t, checked, children: t.children.map(c => ({ ...c, checked })) };
				}
				return { ...t, checked };
			});

			for (let depth = taskPath.length - 1; depth > 0; depth--) {
				next = updateTaskAt(next, taskPath.slice(0, depth), recalcChecked);
			}

			if (checked && taskPath.length === 1) {
				const target = next[taskPath[0]!];
				if (target) {
					const without = removeTaskAt(next, taskPath).tasks;
					next = [...without, target];
				}
			}

			return next;
		});
		await this.writeToDisk();
	}

	async reorderTask(cardId: string, fromPath: TaskPath, toPath: TaskPath, before: boolean): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) => {
			const { removed, tasks: t1 } = removeTaskAt(tasks, fromPath);
			if (!removed) return tasks;
			return insertSibling(t1, toPath, removed, before);
		});
		await this.writeToDisk();
	}

	async moveTaskToCard(
		srcCardId: string,
		fromPath: TaskPath,
		destCardId: string,
		destPath: TaskPath,
		mode: TaskDropMode,
	): Promise<void> {
		if (!this.data) return;

		let movedTask: TaskItem | undefined;

		const columnsWithout = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => {
				if (card.id !== srcCardId) return card;
				const { removed, tasks } = removeTaskAt(card.tasks, fromPath);
				movedTask = removed;
				return { ...card, tasks };
			}),
		}));

		if (!movedTask) return;

		const node: TaskItem = mode === 'nest' ? { ...movedTask } : (() => {
			const clean: TaskItem = { ...movedTask };
			delete clean.children;
			return clean;
		})();

		this.data = {
			...this.data,
			columns: columnsWithout.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== destCardId) return card;
					let tasks: TaskItem[];
					if (mode === 'nest') {
						tasks = appendChild(card.tasks, destPath, node);
					} else {
						tasks = insertSibling(card.tasks, destPath, node, mode === 'before');
					}
					return { ...card, tasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async editTask(cardId: string, taskPath: TaskPath, newText: string): Promise<void> {
		if (!this.data || !newText) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			updateTaskAt(tasks, taskPath, (t) => ({ ...t, text: newText })));
		await this.writeToDisk();
	}

	async addTask(cardId: string, text: string, parentPath?: TaskPath): Promise<void> {
		if (!this.data || !text.trim()) return;

		const node: TaskItem = { text: text.trim(), checked: false };
		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			parentPath && parentPath.length > 0
				? appendChild(tasks, parentPath, node)
				: [...tasks, node]);
		await this.writeToDisk();
	}

	async deleteTask(cardId: string, taskPath: TaskPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			removeTaskAt(tasks, taskPath).tasks);
		await this.writeToDisk();
	}

	async nestTask(cardId: string, taskPath: TaskPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			demoteToChild(tasks, taskPath));
		await this.writeToDisk();
	}

	async nestTaskInto(cardId: string, srcPath: TaskPath, destPath: TaskPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			nestIntoTarget(tasks, srcPath, destPath));
		await this.writeToDisk();
	}

	async unnestTask(cardId: string, taskPath: TaskPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			promoteToTopLevel(tasks, taskPath));
		await this.writeToDisk();
	}

	async toggleCollapseTask(cardId: string, taskPath: TaskPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			updateTaskAt(tasks, taskPath, (t) => ({ ...t, collapsed: !t.collapsed })));
		await this.writeToDisk();
	}

	async updateCard(cardId: string, updates: Partial<Pick<DashboardCard, 'title' | 'body' | 'dueDate' | 'color' | 'coverImage' | 'width' | 'size' | 'gridCols' | 'gridRows' | 'gridCol' | 'gridRow'>>): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, ...updates } : card
				),
			})),
		};
		await this.writeToDisk();
	}

	async editTaskReminder(cardId: string, taskPath: TaskPath, reminder: string | undefined): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			updateTaskAt(tasks, taskPath, (t) => ({ ...t, reminder })));
		await this.writeToDisk();
	}

	async deleteCard(cardId: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.filter(c => c.id !== cardId),
			})),
		};
		await this.writeToDisk();
	}

	async addCard(columnName: string, overrides?: Partial<DashboardCard>): Promise<void> {
		if (!this.data) return;
		const column = this.data.columns.find(col => col.name === columnName);
		const sectionType = column?.sectionType;
		const cardTitle = overrides?.title ?? this.getDefaultCardTitle(columnName, sectionType);
		const cardType = overrides?.type ?? this.getDefaultCardType(columnName, sectionType);

		const newCard: DashboardCard = {
			id: `card-${Date.now().toString(36)}`,
			title: cardTitle,
			type: cardType,
			column: columnName,
			body: '',
			tasks: cardType === 'task' ? [{ text: t('sync.todoDefaultTask'), checked: false }] : [],
			docs: [],
			url: '',
			wikiLink: '',
			progress: -1,
			streak: 0,
			dueDate: '',
			blockquote: '',
			color: '',
			coverImage: '',
				width: 0,
			size: 'M' as const,
			gridCols: 0,
			gridRows: 0,
			gridCol: 0,
			gridRow: 0,
			...overrides,
		};

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? { ...col, cards: [...col.cards, newCard] }
					: col
			),
		};
		await this.writeToDisk();
	}

	async addColumn(name: string, sectionType?: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: [...this.data.columns, { name, color: '#6366f1', sectionType, cards: [] }],
		};
		await this.writeToDisk();
	}

	async updateLibraryConfig(columnName: string, config: import('./types').LibraryConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, libraryConfig: config } : col
			),
		};
		await this.writeToDisk();
	}

	async updateHeatmapConfig(columnName: string, config: import('./types').HeatmapConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, heatmapConfig: config } : col
			),
		};
		await this.writeToDisk();
	}

	async updateWereadConfig(columnName: string, config: import('./types').WereadConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, wereadConfig: config } : col
			),
		};
		await this.writeToDisk();
	}

	async updateTickTickConfig(columnName: string, config: import('./types').TickTickConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, ticktickConfig: config } : col
			),
		};
		await this.writeToDisk();
	}

	/** Reorder sections by array index (index-based to avoid name collisions). */
	async moveColumn(fromIndex: number, toIndex: number): Promise<void> {
		if (!this.data) return;
		const cols = [...this.data.columns];
		if (fromIndex < 0 || fromIndex >= cols.length || toIndex < 0 || toIndex >= cols.length) return;
		if (fromIndex === toIndex) return;
		const [moved] = cols.splice(fromIndex, 1);
		if (!moved) return;
		cols.splice(toIndex, 0, moved);
		this.data = { ...this.data, columns: cols };
		await this.writeToDisk();
	}

	/** Persist a user-dragged section height (px), desktop only. */
	async updateColumnHeight(columnName: string, height: number): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, height } : col
			),
		};
		await this.writeToDisk();
	}


	async renameColumn(oldName: string, newName: string): Promise<void> {
		if (!this.data || !newName || oldName === newName) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === oldName ? { ...col, name: newName } : col
			),
		};
		await this.writeToDisk();
	}

	async deleteColumn(columnName: string): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			columns: this.data.columns.filter(col => col.name !== columnName),
		};
		await this.writeToDisk();
	}

	async moveCard(cardId: string, targetColumn: string, targetIndex: number): Promise<void> {
		if (!this.data) return;

		let movedCard: DashboardCard | null = null;

		const columnsWithout = this.data.columns.map(col => {
			const idx = col.cards.findIndex(c => c.id === cardId);
			if (idx !== -1) {
				movedCard = { ...col.cards[idx]!, column: targetColumn };
				return { ...col, cards: [...col.cards.slice(0, idx), ...col.cards.slice(idx + 1)] };
			}
			return col;
		});

		if (!movedCard) return;

		const newColumns = columnsWithout.map(col => {
			if (col.name !== targetColumn) return col;
			const cards = [...col.cards];
			cards.splice(targetIndex, 0, movedCard!);
			return { ...col, cards };
		});

		this.data = { ...this.data, columns: newColumns };
		await this.writeToDisk();
	}

	async updateBanner(updates: Partial<BannerData>): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			banner: { ...this.data.banner, ...updates },
		};
		await this.writeToDisk();
	}

	async addQuickAction(action: QuickAction): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActions: [...this.data.quickActions, action],
		};
		await this.writeToDisk();
	}

	async removeQuickAction(index: number): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActions: this.data.quickActions.filter((_, i) => i !== index),
		};
		await this.writeToDisk();
	}

	async updateQuickAction(index: number, updates: Partial<Pick<QuickAction, 'name' | 'icon'>>): Promise<void> {
		if (!this.data) return;
		const actions = [...this.data.quickActions];
		if (index < 0 || index >= actions.length) return;
		actions[index] = { ...actions[index]!, ...updates };
		this.data = {
			...this.data,
			quickActions: actions,
		};
		await this.writeToDisk();
	}

	async reorderQuickActions(order: string[]): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActionOrder: order,
		};
		await this.writeToDisk();
	}

	async removeQuickActionByKey(key: string): Promise<void> {
		if (!this.data) return;
		if (key.startsWith('p:')) {
			// Preset: add to hiddenPresets and remove from order
			const hidden = [...(this.data.hiddenPresets ?? [])];
			if (!hidden.includes(key)) hidden.push(key);
			this.data = {
				...this.data,
				hiddenPresets: hidden,
				quickActionOrder: (this.data.quickActionOrder ?? []).filter(k => k !== key),
			};
		} else {
			// Custom: remove from quickActions[] and order
			const target = key.slice(2);
			this.data = {
				...this.data,
				quickActions: this.data.quickActions.filter(a => a.target !== target),
				quickActionOrder: (this.data.quickActionOrder ?? []).filter(k => k !== key),
			};
		}
		await this.writeToDisk();
	}

	async updateMemoCard(cardId: string, updates: { body: string; blockquote: string }): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, ...updates } : card
				),
			})),
		};
		await this.writeToDisk();
	}

	async reorderDocs(cardId: string, fromPath: DocPath, toPath: DocPath, before: boolean): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) => {
			const { removed, docs: d1 } = removeDocAt(docs, fromPath);
			if (!removed) return docs;
			return insertDocSibling(d1, toPath, removed, before);
		});
		await this.writeToDisk();
	}

	async moveDocToCard(
		srcCardId: string,
		fromPath: DocPath,
		destCardId: string,
		destPath: DocPath,
		mode: TaskDropMode,
	): Promise<void> {
		if (!this.data) return;

		let movedDoc: DocNode | undefined;

		const columnsWithout = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => {
				if (card.id !== srcCardId) return card;
				const { removed, docs } = removeDocAt(card.docs, fromPath);
				movedDoc = removed;
				return { ...card, docs };
			}),
		}));

		if (!movedDoc) return;

		const node: DocNode = mode === 'nest' ? { ...movedDoc } : (() => {
			const clean: DocNode = { ...movedDoc };
			delete clean.children;
			return clean;
		})();

		this.data = {
			...this.data,
			columns: columnsWithout.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== destCardId) return card;
					let docs: DocNode[];
					if (mode === 'nest') {
						docs = appendDocChild(card.docs, destPath, node);
					} else {
						docs = insertDocSibling(card.docs, destPath, node, mode === 'before');
					}
					return { ...card, docs };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async nestDoc(cardId: string, docPath: DocPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			demoteDocToChild(docs, docPath));
		await this.writeToDisk();
	}

	async toggleCollapseDoc(cardId: string, docPath: DocPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			updateDocAt(docs, docPath, (d) => ({ ...d, collapsed: !d.collapsed })));
		await this.writeToDisk();
	}

	async deleteDoc(cardId: string, docPath: DocPath): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			removeDocAt(docs, docPath).docs);
		await this.writeToDisk();
	}

	async addDocToCard(cardId: string, filePath: string): Promise<void> {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			docs.some(d => d.path === filePath) ? docs : [...docs, { path: filePath }]);
		await this.writeToDisk();
	}

	async addFileLinkToMemo(cardId: string, filePath: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					const link = `[[${filePath}]]`;
					if (card.body.includes(link)) return card;
					const body = card.body ? `${card.body}\n${link}` : link;
					return { ...card, body };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async updateMemoColor(cardId: string, color: string): Promise<void> {
		await this.updateCard(cardId, { color });
	}

	async updateCardWidth(cardId: string, width: number): Promise<void> {
		await this.updateCard(cardId, { width });
	}

	async updateCardSize(cardId: string, size: import('./types').CardSize): Promise<void> {
		await this.updateCard(cardId, { size });
	}

	async updateCardGrid(cardId: string, gridCols: number, gridRows: number): Promise<void> {
		await this.updateCard(cardId, { gridCols, gridRows });
	}

	async updateCardGridMove(cardId: string, gridCol: number, gridRow: number): Promise<void> {
		await this.updateCard(cardId, { gridCol, gridRow });
	}

	async updateProjectCover(cardId: string, coverImage: string): Promise<void> {
		await this.updateCard(cardId, { coverImage });
	}

	async replaceData(newData: DashboardData): Promise<void> {
		this.data = newData;
		await this.writeToDisk();
	}

	private getDefaultCardTitle(columnName: string, sectionType?: string): string {
		const effective = sectionType?.toLowerCase();
		if (effective === 'memo' || (!effective && columnName.toLowerCase() === 'memo')) {
			const now = new Date();
			const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
			return t('sync.memoTitle', { date });
		}
		if (effective === 'todo' || (!effective && columnName.toLowerCase() === 'todo')) return t('sync.todoTitle');
		if (effective === 'notes') return t('sync.notesTitle');
		if (columnName.toLowerCase() === 'projects') return t('sync.projectTitle');
		return t('sync.newCard');
	}

	private getDefaultCardType(columnName: string, sectionType?: string): CardType {
		const effective = sectionType?.toLowerCase();
		if (effective === 'todo' || (!effective && columnName.toLowerCase() === 'todo')) return 'task';
		if (effective === 'memo' || (!effective && columnName.toLowerCase() === 'memo')) return 'generic';
		if (effective === 'dashboard' || (!effective && columnName.toLowerCase() === 'dashboard')) return 'weather';
		return 'project';
	}

	private async findOrCreateFile(): Promise<void> {
		const rawPath = this.settings.dashboardFile.trim();
		const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			this.file = existing;
			return;
		}

		const content = generateDefaultMarkdown();
		this.file = await this.app.vault.create(path, content);
	}

	private deferredWriteTimer: number | null = null;
	private renameEventRef: ReturnType<typeof this.app.vault.on> | null = null;

	private registerFileWatcher(): void {
		const filePath = this.file?.path;
		this.eventRef = this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.path === filePath) {
				this.onFileModify();
			}
		});

		this.renameEventRef = this.app.vault.on('rename', (file: TFile, oldPath: string) => {
			if (!this.data) return;
			this.handleFileRename(file, oldPath);
		});
	}

	private handleFileRename(file: TFile, oldPath: string): void {
		if (!this.data) return;
		const newPath = file.path;
		let changed = false;

		const replace = (str: string): string => {
			if (!str || !str.includes(oldPath)) return str;
			changed = true;
			return str.split(oldPath).join(newPath);
		};

		const oldPathNoExt = oldPath.endsWith('.md') ? oldPath.slice(0, -3) : oldPath;
		const newName = file.basename;

		const quickActions = this.data.quickActions.map(action => {
			if (action.type !== 'file') return action;
			if (action.target !== oldPath && action.target !== oldPathNoExt) return action;
			changed = true;
			return { ...action, target: newPath, name: newName };
		});

		const banner = { ...this.data.banner, image: replace(this.data.banner.image) };

		const columns = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => ({
				...card,
				coverImage: replace(card.coverImage),
			})),
		}));

		if (!changed) return;

		// Cancel pending re-parse to prevent race condition
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.data = { ...this.data, banner, quickActions, columns };
		void this.writeToDisk();
	}

	private scheduleDeferredWrite(): void {
		if (this.deferredWriteTimer) window.clearTimeout(this.deferredWriteTimer);
		this.deferredWriteTimer = window.setTimeout(() => {
			this.deferredWriteTimer = null;
			if (this.data) {
				void this.writeToDisk();
			}
		}, 1000);
	}

	private onFileModify(): void {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			void this.load();
		}, this.debounceMs);
	}

	private async load(): Promise<void> {
		if (!this.file) return;

		const content = await this.app.vault.read(this.file);
		const newData = parse(content);

		// Skip the re-render when the on-disk data is logically equivalent to what
		// we already hold. Our own writes echo back through the file watcher, and a
		// byte-level hash misfires on trivial differences (e.g. trailing newlines),
		// so compare canonical serializations instead — otherwise the whole view
		// rebuilds a second time (the visible "double flash").
		if (this.data && serialize(newData) === serialize(this.data)) return;

		this.data = newData;
		this.notifyCallbacks();
	}

	private async writeToDisk(): Promise<void> {
		if (!this.data || !this.file) return;

		const content = serialize(this.data);

		const fileRef = this.file;
		this.writeQueue = this.writeQueue.then(async () => {
			try {
				const current = await this.app.vault.read(fileRef);

				// Safety: skip write if new content is drastically smaller
				if (current.length > 0 && content.length < current.length * 0.3) {
					console.warn('Dashboard write skipped: new content significantly smaller than current file');
					return;
				}

				// Backup current file before overwriting
				await this.createBackup(current);

				await this.app.vault.modify(fileRef, content);
			} catch (err) {
				console.error('Dashboard sync write failed:', err);
			}
		});

		this.notifyCallbacks();
	}

	private async createBackup(currentContent: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const dir = SyncEngine.BACKUP_DIR;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			const backupPath = dir + '/dashboard-' + ts + '.md';
			await adapter.write(backupPath, currentContent);

			// Prune old backups, keep only MAX_BACKUPS
			const files = await adapter.list(dir);
			const backups = files.files
				.filter((f: string) => f.startsWith(dir + '/dashboard-') && f.endsWith('.md'))
				.sort();
			while (backups.length > SyncEngine.MAX_BACKUPS) {
				await adapter.remove(backups.shift()!);
			}
		} catch {
			// Backup failure should never block the main write
		}
	}

	private notifyCallbacks(): void {
		if (!this.data) return;
		for (const cb of this.callbacks) {
			cb(this.data);
		}
	}
}
