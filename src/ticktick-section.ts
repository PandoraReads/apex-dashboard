import { App, Notice, setIcon } from 'obsidian';
import type { DashboardColumn, TickTickConfig, TickTickWidget } from './types';
import { t } from './i18n';
import { TickTickClient, parseTickDate } from './ticktick-service';
import type { TickTickHabit, TickTickProject, TickTickTask } from './ticktick-service';
import { TickTickTaskEditModal } from './ticktick-task-edit-modal';

/** Actions a task row can trigger; each optimistically updates the caches. */
interface TaskActions {
	canWrite: boolean;
	toggleComplete(task: TickTickTask): Promise<void>;
	rename(task: TickTickTask, title: string): Promise<void>;
	editFields(task: TickTickTask, fields: { title?: string; dueDate?: string; priority?: number }): Promise<void>;
	reorder(projectId: string, movedId: string, beforeId: string | null, siblings: TickTickTask[]): Promise<void>;
}

interface Snapshot { projects: TickTickProject[]; tasks: TickTickTask[]; inboxId?: string }
interface HabitsCache { habits: TickTickHabit[]; doneToday: Set<string> }

/**
 * TickTick section renderer. Stacks widgets (today / by-project / completed /
 * habits) and supports interaction: complete, inline rename, edit date/priority,
 * drag-to-reorder. Writes go through {@link TickTickClient} (needs CSRF).
 */
export function renderTickTickSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	region: 'dida365' | 'ticktick',
	cookie: string,
	csrf: string,
	deviceVersion: string | undefined,
	onReloadReady?: (reload: () => void) => void,
): void {
	const widgets = normalizedWidgets(column.ticktickConfig);
	// eslint-disable-next-line no-console
	console.log('[ticktick] section widgets:', widgets.map(w => `${w.id}:${w.view}`));
	const client = new TickTickClient(region, cookie, deviceVersion, csrf);
	const host = el.createDiv({ cls: 'dashboard-ticktick-widgets' });

	let snapshot: Snapshot | null = null;
	let completedCache: TickTickTask[] | null = null;
	let habitsCache: HabitsCache | null = null;
	const getSnapshot = async (): Promise<Snapshot> => {
		if (!snapshot) snapshot = await client.fetchSnapshot();
		return snapshot;
	};

	const rerender = (): void => { renderWidgets(); };

	const actions: TaskActions = {
		canWrite: client.canWrite(),
		async toggleComplete(task) {
			if (!client.canWrite()) { new Notice(t('ticktick.cannotWrite')); return; }
			const makeComplete = task.status !== 2;
			try {
				if (makeComplete) {
					await client.completeTask(task.projectId ?? '', task.id);
					task.status = 2;
					task.completedTime = new Date().toISOString();
					if (completedCache) completedCache = [task, ...completedCache.filter(t => t.id !== task.id)];
				} else {
					await client.uncompleteTask(task.projectId ?? '', task.id);
					task.status = 0;
					task.completedTime = undefined;
					if (completedCache) completedCache = completedCache.filter(t => t.id !== task.id);
				}
				rerender();
			} catch (err) {
				new Notice(messageForError(err));
			}
		},
		async rename(task, title) {
			if (!client.canWrite() || !title) return;
			try {
				await client.updateTask(task.projectId ?? '', task.id, { title });
				task.title = title;
				rerender();
			} catch (err) {
				new Notice(messageForError(err));
			}
		},
		async editFields(task, fields) {
			if (!client.canWrite()) { new Notice(t('ticktick.cannotWrite')); return; }
			try {
				await client.updateTask(task.projectId ?? '', task.id, fields);
				if (fields.title !== undefined) task.title = fields.title;
				if (fields.priority !== undefined) task.priority = fields.priority;
				if (fields.dueDate !== undefined) task.dueDate = fields.dueDate || undefined;
				rerender();
			} catch (err) {
				new Notice(messageForError(err));
			}
		},
		async reorder(projectId, movedId, beforeId, siblings) {
			if (!client.canWrite()) return;
			const moved = siblings.find(s => s.id === movedId);
			if (!moved) return;
			const newSort = computeSortOrder(movedId, beforeId, siblings);
			try {
				await client.reorderTasks([{ projectId, id: movedId, sortOrder: newSort }]);
				moved.sortOrder = newSort;
				rerender();
			} catch (err) {
				new Notice(messageForError(err));
			}
		},
	};

	const renderWidgets = (): void => {
		host.empty();
		if (!client.canWrite()) {
			host.createDiv({ cls: 'dashboard-ticktick-readonly-hint', text: t('ticktick.readonlyHint') });
		}
		for (const w of widgets) {
			const block = host.createDiv({ cls: 'dashboard-ticktick-widget' });
			if (w.title) block.createDiv({ cls: 'dashboard-ticktick-widget-title', text: w.title });
			const content = block.createDiv({ cls: 'dashboard-ticktick-content' });
			try {
				if (w.view === 'today') {
					if (!snapshot) { renderHint(content, t('ticktick.loading'), ''); continue; }
					renderToday(content, snapshot, w, app, actions);
				} else if (w.view === 'projects') {
					if (!snapshot) { renderHint(content, t('ticktick.loading'), ''); continue; }
					renderProjects(content, snapshot, w, actions);
				} else if (w.view === 'completed') {
					if (!completedCache) { renderHint(content, t('ticktick.loading'), ''); continue; }
					renderCompleted(content, completedCache, w, actions);
				} else {
					if (!habitsCache) { renderHint(content, t('ticktick.loading'), ''); continue; }
					renderHabits(content, habitsCache.habits, habitsCache.doneToday);
				}
			} catch (err) {
				content.empty();
				renderHint(content, t('ticktick.loadFailed'), messageForError(err));
			}
		}
	};

	const loadAll = async (force: boolean): Promise<void> => {
		if (force) { client.clearCache(); snapshot = null; completedCache = null; habitsCache = null; }
		host.empty();
		if (!client.isConfigured()) {
			renderHint(host, t('ticktick.noCookie'), t('ticktick.noCookieHint'));
			return;
		}
		try {
			if (widgets.some(w => w.view === 'today' || w.view === 'projects')) await getSnapshot();
			if (widgets.some(w => w.view === 'completed')) completedCache = await client.fetchCompleted();
			if (widgets.some(w => w.view === 'habits')) {
				const habits = await client.fetchHabits();
				const checkins = await client.fetchHabitCheckins(habits.map(h => h.id), todayStamp());
				habitsCache = { habits, doneToday: new Set(checkins.map(c => c.habitId)) };
			}
			renderWidgets();
		} catch (err) {
			host.empty();
			renderHint(host, t('ticktick.loadFailed'), messageForError(err));
		}
	};

	if (onReloadReady) onReloadReady(() => { void loadAll(true); });
	void loadAll(false);
}

function normalizedWidgets(cfg?: TickTickConfig): TickTickWidget[] {
	if (cfg?.widgets?.length) return cfg.widgets;
	return [{ id: 'w1', view: 'today' }];
}

function renderHint(content: HTMLElement, title: string, hint: string): void {
	const wrap = content.createDiv({ cls: 'dashboard-ticktick-hint' });
	wrap.createDiv({ cls: 'dashboard-ticktick-hint-title', text: title });
	if (hint) wrap.createDiv({ cls: 'dashboard-ticktick-hint-desc', text: hint });
}

function messageForError(err: unknown): string {
	const code = err instanceof Error ? err.message : '';
	if (code === 'NO_COOKIE' || code === 'BAD_COOKIE' || code === 'NO_CSRF') return t('ticktick.badCookie');
	if (code === 'RATE_LIMITED') return t('ticktick.rateLimited');
	if (code.startsWith('NETWORK')) return t('ticktick.networkError');
	return code || t('ticktick.loadFailed');
}

// ---------- Today ----------

function renderToday(content: HTMLElement, snap: Snapshot, _w: TickTickWidget, app: App, actions: TaskActions): void {
	const eod = endOfDay(new Date());
	const projMap = new Map(snap.projects.map(p => [p.id, p]));
	const items = snap.tasks
		.filter(task => task.status === 0 && task.dueDate ? (parseTickDate(task.dueDate)?.getTime() ?? Infinity) <= eod.getTime() : false)
		.sort((a, b) => {
			const da = parseTickDate(a.dueDate)?.getTime() ?? 0;
			const db = parseTickDate(b.dueDate)?.getTime() ?? 0;
			return da - db || b.priority - a.priority;
		});
	if (items.length === 0) { renderHint(content, t('ticktick.todayEmpty'), ''); return; }
	const list = content.createDiv({ cls: 'dashboard-ticktick-list' });
	for (const task of items) renderTaskRow(list, task, projMap, { showDue: true, app, actions });
}

// ---------- By project ----------

function renderProjects(content: HTMLElement, snap: Snapshot, w: TickTickWidget, actions: TaskActions): void {
	const projMap = new Map(snap.projects.map(p => [p.id, p]));
	const groups = new Map<string, TickTickTask[]>();
	for (const task of snap.tasks) {
		if (task.status !== 0) continue;
		const pid = task.projectId ?? snap.inboxId ?? 'inbox';
		if (w.projectId && pid !== w.projectId) continue;
		groups.set(pid, [...(groups.get(pid) ?? []), task]);
	}
	if (groups.size === 0) { renderHint(content, t('ticktick.noTasks'), ''); return; }
	const grid = content.createDiv({ cls: 'dashboard-ticktick-proj-grid' });
	for (const [pid, tasks] of groups) {
		const proj = projMap.get(pid);
		const card = grid.createDiv({ cls: 'dashboard-ticktick-proj-card' });
		card.style.setProperty('--proj-color', proj?.color || 'var(--db-accent, #6366f1)');
		const head = card.createDiv({ cls: 'dashboard-ticktick-proj-card-head' });
		const dot = head.createDiv({ cls: 'dashboard-ticktick-proj-dot' });
		dot.style.backgroundColor = proj?.color || 'var(--db-accent)';
		head.createDiv({ cls: 'dashboard-ticktick-group-name', text: proj?.name ?? t('ticktick.inbox') });
		head.createDiv({ cls: 'dashboard-ticktick-group-count', text: String(tasks.length) });
		const list = card.createDiv({ cls: 'dashboard-ticktick-list dashboard-ticktick-list--reorder' });
		const ordered = tasks.sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0) || b.priority - a.priority);
		for (const task of ordered) {
			renderTaskRow(list, task, projMap, { showDue: true, app: null, actions, reorderable: true, projectId: pid, siblings: ordered });
		}
	}
}

// ---------- Completed ----------

function renderCompleted(content: HTMLElement, all: TickTickTask[], w: TickTickWidget, actions: TaskActions): void {
	const days = Math.max(1, w.days ?? 1);
	const since = startOfDay(addDays(new Date(), -(days - 1)));
	const items = all
		.filter(task => task.completedTime ? (parseTickDate(task.completedTime)?.getTime() ?? 0) >= since.getTime() : false)
		.sort((a, b) => (parseTickDate(b.completedTime)?.getTime() ?? 0) - (parseTickDate(a.completedTime)?.getTime() ?? 0));
	if (items.length === 0) { renderHint(content, t('ticktick.noCompleted'), ''); return; }
	const list = content.createDiv({ cls: 'dashboard-ticktick-list' });
	for (const task of items) {
		const row = list.createDiv({ cls: 'dashboard-ticktick-row dashboard-ticktick-row--done' });
		const check = row.createDiv({ cls: 'dashboard-ticktick-check dashboard-ticktick-check--done' });
		setIcon(check, 'check');
		if (actions.canWrite) {
			check.addEventListener('click', (e) => { e.stopPropagation(); void actions.toggleComplete(task); });
		}
		const main = row.createDiv({ cls: 'dashboard-ticktick-main' });
		main.createDiv({ cls: 'dashboard-ticktick-title dashboard-ticktick-title--done', text: task.title });
		const when = parseTickDate(task.completedTime);
		if (when) main.createDiv({ cls: 'dashboard-ticktick-meta', text: formatRelative(when) });
	}
}

// ---------- Habits ----------

function renderHabits(content: HTMLElement, habits: TickTickHabit[], doneToday: Set<string>): void {
	if (habits.length === 0) { renderHint(content, t('ticktick.noHabits'), ''); return; }
	const list = content.createDiv({ cls: 'dashboard-ticktick-list' });
	for (const habit of habits) {
		const row = list.createDiv({ cls: 'dashboard-ticktick-row dashboard-ticktick-row--habit' });
		const check = row.createDiv({ cls: 'dashboard-ticktick-check' + (doneToday.has(habit.id) ? ' dashboard-ticktick-check--done' : '') });
		setIcon(check, doneToday.has(habit.id) ? 'check' : 'circle');
		const main = row.createDiv({ cls: 'dashboard-ticktick-main' });
		main.createDiv({ cls: 'dashboard-ticktick-title', text: habit.name });
		if (habit.goal) main.createDiv({ cls: 'dashboard-ticktick-meta', text: `${habit.goal}${habit.unit ?? ''}` });
	}
}

interface RowOpts {
	showDue: boolean;
	app: App | null;
	actions: TaskActions;
	reorderable?: boolean;
	projectId?: string;
	siblings?: TickTickTask[];
}

function renderTaskRow(list: HTMLElement, task: TickTickTask, projMap: Map<string, TickTickProject>, opts: RowOpts): void {
	const row = list.createDiv({ cls: 'dashboard-ticktick-row' });
	if (opts.reorderable) {
		row.setAttribute('draggable', 'true');
		row.dataset.taskId = task.id;
		wireRowDnD(row, opts.projectId ?? '', opts.siblings ?? [], opts.actions);
	}

	const check = row.createDiv({ cls: 'dashboard-ticktick-check' + (task.status === 2 ? ' dashboard-ticktick-check--done' : '') });
	setIcon(check, task.status === 2 ? 'check' : 'circle');
	if (opts.actions.canWrite) {
		check.addEventListener('click', (e) => { e.stopPropagation(); void opts.actions.toggleComplete(task); });
	}

	const main = row.createDiv({ cls: 'dashboard-ticktick-main' });
	const titleLine = main.createDiv({ cls: 'dashboard-ticktick-title-line' });
	const titleEl = titleLine.createDiv({ cls: 'dashboard-ticktick-title', text: task.title });
	if (task.repeatFlag) {
		const rep = titleLine.createDiv({ cls: 'dashboard-ticktick-badge', text: t('ticktick.recurring') });
		rep.setAttribute('aria-label', task.repeatFlag);
	}
	if (opts.actions.canWrite && opts.app) {
		const editBtn = titleLine.createDiv({ cls: 'dashboard-ticktick-edit-btn' });
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new TickTickTaskEditModal(opts.app!, task, (fields) => opts.actions.editFields(task, fields)).open();
		});
	}

	const meta: string[] = [];
	if (opts.showDue && task.dueDate) {
		const due = parseTickDate(task.dueDate);
		if (due) meta.push(formatDue(due));
	}
	const proj = task.projectId ? projMap.get(task.projectId) : undefined;
	if (proj && proj.name) meta.push(proj.name);
	if (task.tags?.length) meta.push(task.tags.map(s => `#${s}`).join(' '));
	if (meta.length) main.createDiv({ cls: 'dashboard-ticktick-meta', text: meta.join(' · ') });

	if (opts.actions.canWrite) {
		titleEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startInlineRename(titleEl, task, opts.actions); });
	}
}

function startInlineRename(titleEl: HTMLElement, task: TickTickTask, actions: TaskActions): void {
	const current = task.title;
	titleEl.empty();
	const input = titleEl.createEl('input', { cls: 'dashboard-ticktick-rename-input', attr: { type: 'text', value: current } });
	input.focus();
	input.select();
	const finish = (save: boolean): void => {
		const v = input.value.trim();
		if (save && v && v !== current) void actions.rename(task, v);
		else { titleEl.empty(); titleEl.setText(current); }
	};
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); finish(true); }
		else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
	});
	input.addEventListener('blur', () => finish(true));
}

/** HTML5 drag-and-drop to reorder task rows within a list. */
function wireRowDnD(row: HTMLElement, projectId: string, siblings: TickTickTask[], actions: TaskActions): void {
	row.addEventListener('dragstart', (e) => {
		row.addClass('dashboard-ticktick-row--dragging');
		if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.taskId ?? ''); }
	});
	row.addEventListener('dragend', () => { row.removeClass('dashboard-ticktick-row--dragging'); });
	row.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
	row.addEventListener('drop', (e) => {
		e.preventDefault();
		const movedId = e.dataTransfer?.getData('text/plain') ?? '';
		if (!movedId || movedId === row.dataset.taskId) return;
		const rect = row.getBoundingClientRect();
		const before = e.clientY < rect.top + rect.height / 2;
		const targetId = row.dataset.taskId ?? '';
		const beforeId = before ? targetId : nextSiblingId(siblings, targetId);
		void actions.reorder(projectId, movedId, beforeId, siblings);
	});
}

function nextSiblingId(siblings: TickTickTask[], id: string): string | null {
	const ordered = [...siblings].sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0));
	const i = ordered.findIndex(s => s.id === id);
	if (i < 0 || i + 1 >= ordered.length) return null;
	return ordered[i + 1]!.id;
}

/** sortOrder so `movedId` lands before `beforeId` (descending order; midpoint between neighbors). */
function computeSortOrder(movedId: string, beforeId: string | null, siblings: TickTickTask[]): number {
	const ordered = [...siblings].sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0));
	let targetIdx = beforeId ? ordered.findIndex(s => s.id === beforeId) : ordered.length - 1;
	if (targetIdx < 0) targetIdx = ordered.length - 1;
	const above = targetIdx > 0 ? ordered[targetIdx - 1]! : null;
	const below = targetIdx < ordered.length ? ordered[targetIdx]! : null;
	const aboveSort = above && above.id !== movedId ? (above.sortOrder ?? 0) : null;
	const belowSort = below && below.id !== movedId ? (below.sortOrder ?? 0) : null;
	if (aboveSort != null && belowSort != null) return Math.floor((aboveSort + belowSort) / 2);
	if (aboveSort != null) return aboveSort + 1000;
	if (belowSort != null) return belowSort - 1000;
	return Date.now();
}

// ---------- date helpers ----------

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = startOfDay(d); x.setDate(x.getDate() + 1); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function todayStamp(): string {
	const d = new Date();
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function formatDue(due: Date): string {
	const now = new Date();
	const todayStart = startOfDay(now);
	const dueStart = startOfDay(due);
	const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000);
	if (diffDays < 0) return t('ticktick.overdue', { n: String(-diffDays) });
	if (diffDays === 0) return t('ticktick.dueToday');
	return `${due.getMonth() + 1}/${due.getDate()}`;
}
function formatRelative(d: Date): string {
	const now = new Date();
	const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
