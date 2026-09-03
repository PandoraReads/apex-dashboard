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
	moveTaskBeside,
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
	moveDocBeside,
} from './doc-tree';
import { moveToOwnRow, moveBeside, unpartnerAt } from './column-pairs';
import { workspaceBackupName } from './workspace-registry';

import type { DashboardUpdateSource } from './render-update';

type DataCallback = (data: DashboardData, source: DashboardUpdateSource) => void;

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

	onDataUpdate(cb: DataCallback): () => void {
		this.callbacks.push(cb);
		return () => {
			this.callbacks = this.callbacks.filter((candidate) => candidate !== cb);
		};
	}

	async init(): Promise<void> {
		await this.findOrCreateFile();
		this.registerFileWatcher();
		await this.load();
	}

	destroy(): void {
		this.unregisterFileWatchers();
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
		}
		if (this.deferredWriteTimer) {
			window.clearTimeout(this.deferredWriteTimer);
		}
	}

	/** Detach the vault modify/rename watchers. Called on destroy and before
	    re-pointing the engine at another workspace file (switchFile). */
	private unregisterFileWatchers(): void {
		if (this.eventRef) {
			this.app.vault.offref(this.eventRef);
			this.eventRef = null;
		}
		if (this.renameEventRef) {
			this.app.vault.offref(this.renameEventRef);
			this.renameEventRef = null;
		}
	}

	getData(): DashboardData | null {
		return this.data;
	}

	async refresh(): Promise<void> {
		await this.load();
	}

	/**
	 * Re-acquire the dashboard file reference and reload its contents from disk,
	 * then notify listeners (which re-renders the view). Used by the backup
	 * restore flow: the file may have been deleted/recreated, so the cached
	 * `this.file` can be stale and must be resolved again before reading.
	 */
	async reloadFromDisk(): Promise<void> {
		await this.findOrCreateFile();
		await this.load();
	}

	/**
	 * Re-point this engine at `settings.dashboardFile` after a workspace switch
	 * (unlike reloadFromDisk, which keeps watching the same file).
	 *
	 * Order matters: writeToDisk captures its fileRef at ENQUEUE time but
	 * serializes `this.data` at EXECUTION time — so any queued write must fully
	 * drain into the OLD file before `this.file`/`this.data` change, or the new
	 * workspace's content lands in the old workspace's file. The pending
	 * deferred (quiet collapse) write is flushed into the queue first, not
	 * dropped. The modify watcher closure-captures the watched path, so it must
	 * be re-registered against the new file. `this.data` is nulled before
	 * loading to defeat load()'s serialize-equality skip — two workspaces with
	 * byte-identical content (e.g. two fresh defaults) must still re-render.
	 */
	async switchFile(): Promise<void> {
		if (this.deferredWriteTimer) {
			window.clearTimeout(this.deferredWriteTimer);
			this.deferredWriteTimer = null;
			if (this.data) await this.writeToDisk(true);
		}
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		await this.writeQueue;
		this.unregisterFileWatchers();
		this.data = null;
		await this.findOrCreateFile();
		this.registerFileWatcher();
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

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			moveTaskBeside(tasks, fromPath, toPath, before));
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

		// Preserve the moved task's entire subtree. Previously the children were
		// stripped for 'before'/'after' drops, which silently deleted all sub-items
		// when a parent task was moved to another card.
		const node: TaskItem = { ...movedTask };

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
				// Top-level additions land at the TOP of the list so the newest
				// item is visible without scrolling past the existing ones.
				: [node, ...tasks]);
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

	/**
	 * Toggle a task's collapsed state WITHOUT triggering a full re-render.
	 *
	 * Collapse is a purely visual state — the chevron click should update the DOM
	 * in place (handled by the renderer) and persist to disk on a debounce, but
	 * must not echo back through `notifyCallbacks`, which would tear down and
	 * rebuild the entire dashboard for a single chevron toggle.
	 */
	toggleCollapseTaskQuiet(cardId: string, taskPath: TaskPath): void {
		if (!this.data) return;

		this.data = this.mapCardTasks(this.data, cardId, (tasks) =>
			updateTaskAt(tasks, taskPath, (t) => ({ ...t, collapsed: !t.collapsed })));
		this.scheduleDeferredWrite();
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
		const uniqueName = this.uniqueColumnName(name);

		// New library sections default to a rolling "last 7 days" window (by
		// modified date, matching the default modified-desc sort) so the grid
		// opens focused on recent files. The quick filter can clear or change it.
		const libraryConfig = sectionType === 'library'
			? {
				filters: [] as import('./types').PropertyFilter[],
				viewMode: 'grid' as import('./types').LibraryViewMode,
				sortBy: 'modified',
				sortDesc: true,
				quickDateFilter: { property: 'modified' as const, start: '', end: '', days: 7 },
			}
			: undefined;

		this.data = {
			...this.data,
			columns: [...this.data.columns, { name: uniqueName, color: '#6366f1', sectionType, cards: [], libraryConfig }],
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

	async updateDataviewConfig(columnName: string, config: import('./types').DataviewConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, dataviewConfig: config } : col
			),
		};
		await this.writeToDisk();
	}

	/** Reorder sections by array index (index-based to avoid name collisions).
	 *  Vertical drop = "own full-width row": a moved section loses any pairing
	 *  and never lands between two partners (see moveToOwnRow). from === to is
	 *  legal — it unpairs the section in place. */
	async moveColumn(fromIndex: number, toIndex: number): Promise<void> {
		if (!this.data) return;
		const cols = this.data.columns;
		if (fromIndex < 0 || fromIndex >= cols.length || toIndex < 0 || toIndex >= cols.length) return;
		const candidate = { ...this.data, columns: moveToOwnRow(cols, fromIndex, toIndex) };
		// No-op drops (e.g. vertical drop that lands where it started on an
		// unpaired section) must not burn a backup file and re-render the board.
		if (serialize(candidate) === serialize(this.data)) return;
		this.data = candidate;
		await this.writeToDisk();
	}

	/** Pair the dragged section beside the target (`side` of the target row).
	 *  The target's ex-partner, if any, falls back to a full-width row. */
	async moveColumnBeside(fromIndex: number, targetIndex: number, side: 'left' | 'right'): Promise<void> {
		if (!this.data) return;
		const candidate = { ...this.data, columns: moveBeside(this.data.columns, fromIndex, targetIndex, side) };
		if (serialize(candidate) === serialize(this.data)) return;
		this.data = candidate;
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


	/** Resolve a column to a single index. Prefers the UI-provided index (the
	 *  exact section the user clicked) when its name still matches — with
	 *  duplicate names that targets only THIS section — and falls back to the
	 *  first name match. The name guard rejects stale indexes from an
	 *  out-of-date render. */
	private resolveColumnIndex(columnName: string, columnIndex?: number): number {
		if (!this.data) return -1;
		const idx = typeof columnIndex === 'number' ? columnIndex : -1;
		if (idx >= 0 && idx < this.data.columns.length
			&& this.data.columns[idx]!.name === columnName) {
			return idx;
		}
		return this.data.columns.findIndex(col => col.name === columnName);
	}

	/** Names are the column key in the markdown format (## heading), so
	 *  duplicates break every name-keyed operation (delete/rename used to hit
	 *  ALL same-named sections). Creation and rename therefore always resolve
	 *  to a unique name. `exceptIndex` exempts the column being renamed. */
	private uniqueColumnName(base: string, exceptIndex?: number): string {
		if (!this.data) return base;
		const taken = new Set(
			this.data.columns
				.filter((_, i) => i !== exceptIndex)
				.map(col => col.name),
		);
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) {
			const candidate = `${base} ${n}`;
			if (!taken.has(candidate)) return candidate;
		}
	}

	async renameColumn(oldName: string, newName: string, columnIndex?: number): Promise<void> {
		const trimmed = newName.trim();
		if (!this.data || !trimmed || oldName === trimmed) return;
		const idx = this.resolveColumnIndex(oldName, columnIndex);
		if (idx < 0) return;

		const uniqueNew = this.uniqueColumnName(trimmed, idx);
		this.data = {
			...this.data,
			columns: this.data.columns.map((col, i) =>
				i === idx ? { ...col, name: uniqueNew } : col
			),
		};
		await this.writeToDisk();
	}

	async deleteColumn(columnName: string, columnIndex?: number): Promise<void> {
		if (!this.data) return;
		const idx = this.resolveColumnIndex(columnName, columnIndex);
		if (idx < 0) return;
		// Free the deleted section's partner first so it falls back to a full
		// width row instead of lingering as an orphan half.
		this.data = {
			...this.data,
			columns: unpartnerAt(this.data.columns, idx).filter((_, i) => i !== idx),
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

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			moveDocBeside(docs, fromPath, toPath, before));
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

		// Preserve the moved doc's entire subtree (same rationale as moveTaskToCard).
		const node: DocNode = { ...movedDoc };

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

	toggleCollapseDocQuiet(cardId: string, docPath: DocPath): void {
		if (!this.data) return;

		this.data = this.mapCardDocs(this.data, cardId, (docs) =>
			updateDocAt(docs, docPath, (d) => ({ ...d, collapsed: !d.collapsed })));
		this.scheduleDeferredWrite();
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
		if (effective === 'memo' || effective === 'sticky' || (!effective && columnName.toLowerCase() === 'memo')) {
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
		// Sticky sections pick the type per card via StickyCardTypeModal; a bare
		// addCard (no overrides) falls back to a memo card.
		if (effective === 'sticky') return 'generic';
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
	/** Depth of writes currently queued/executing. `onFileModify` uses this to
	 *  decide whether an external change can be ingested immediately: while our
	 *  own writes are draining, a load() could race them (see onFileModify). */
	private writeQueuePending = 0;

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

	/**
	 * Persist `this.data` to disk on a debounce WITHOUT re-rendering the view.
	 *
	 * Used by the "quiet" collapse toggles (`toggleCollapseTaskQuiet` /
	 * `toggleCollapseDocQuiet`): the renderer has already updated the DOM in
	 * place, so the deferred write only needs to flush the new `collapsed` flag
	 * to disk. The write MUST NOT echo back through `notifyCallbacks`, otherwise
	 * the whole dashboard is torn down and rebuilt a second after every chevron
	 * click — the source of the multi-second lag.
	 */
	private scheduleDeferredWrite(): void {
		if (this.deferredWriteTimer) window.clearTimeout(this.deferredWriteTimer);
		this.deferredWriteTimer = window.setTimeout(() => {
			this.deferredWriteTimer = null;
			if (this.data) {
				void this.writeToDisk(true);
			}
		}, 400);
	}

	private onFileModify(): void {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		// External writers (the calendar's day-agenda insert, task toggles, other
		// devices via file sync) bypass this engine and write the file directly.
		// They must be ingested into `this.data` BEFORE the next engine write
		// serializes over them — otherwise a stale in-memory copy clobbers the
		// external change (observed: a whole section vanishing ~a minute after
		// it was created). When our write queue is idle we reload right away;
		// our own write echoes are cheap no-ops thanks to load()'s
		// serialize-equality check. While writes are draining we fall back to
		// the debounce — serialize-at-execution in writeToDisk picks up the
		// freshest `this.data` anyway.
		if (this.writeQueuePending === 0 && this.deferredWriteTimer === null) {
			void this.load();
			return;
		}
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
		this.notifyCallbacks('external');
	}

	/**
	 * Serialize `this.data` to the dashboard file.
	 *
	 * `silent=true` skips `notifyCallbacks` — for collapse toggles whose DOM is
	 * already updated in place and only need the new state flushed to disk,
	 * without triggering a full-board re-render.
	 */
	private async writeToDisk(silent = false): Promise<void> {
		if (!this.data || !this.file) return;

		const fileRef = this.file;
		this.writeQueuePending++;
		this.writeQueue = this.writeQueue.then(async () => {
			try {
				// Serialize at EXECUTION time, not enqueue time: content captured
				// earlier can be stale by the time earlier queued writes drain,
				// and writing it would silently revert everything that changed in
				// between (external inserts included).
				const content = serialize(this.data!);

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
			} finally {
				this.writeQueuePending--;
			}
		});

		if (!silent) {
			this.notifyCallbacks('local');
		}
	}

	private async createBackup(currentContent: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const dir = SyncEngine.BACKUP_DIR;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			// Keyed per workspace: each board keeps its own rolling copies and
			// prunes only its own files (dot separator so 'dashboard.' never
			// matches 'dashboard-2.<ts>.md').
			const base = this.file?.basename ?? 'dashboard';
			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			const backupPath = `${dir}/${workspaceBackupName(base, ts)}`;
			await adapter.write(backupPath, currentContent);

			// Prune old backups, keep only MAX_BACKUPS
			const files = await adapter.list(dir);
			const backups = files.files
				.filter((f: string) => f.startsWith(dir + '/' + base + '.') && f.endsWith('.md'))
				.sort();
			while (backups.length > SyncEngine.MAX_BACKUPS) {
				await adapter.remove(backups.shift()!);
			}
		} catch {
			// Backup failure should never block the main write
		}
	}

	private notifyCallbacks(source: DashboardUpdateSource): void {
		if (!this.data) return;
		for (const cb of this.callbacks) {
			cb(this.data, source);
		}
	}
}
