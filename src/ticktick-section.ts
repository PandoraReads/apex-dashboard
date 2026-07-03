import { App, Notice, Platform, setIcon } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import { TickTickClient, parseTickDate } from './ticktick-service';
import type { TickTickHabit, TickTickProject, TickTickTask } from './ticktick-service';
import { TickTickTaskEditModal } from './ticktick-task-edit-modal';
import { DEFAULT_TICKTICK_TZ, isValidTz, tzDayNum, tzParts, tzStamp } from './ticktick-tz';

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
 * TickTick section renderer. Two views toggled from the header:
 * - 'today': three cards (today's tasks, recently completed, habits) side by side.
 * - 'lists': one card per project (with drag-to-reorder, project filter).
 * Writes go through {@link TickTickClient} (needs CSRF).
 */
export function renderTickTickSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	region: 'dida365' | 'ticktick',
	cookie: string,
	csrf: string,
	deviceVersion: string | undefined,
	timezone: string,
	onReloadReady?: (reload: () => void) => void,
	onResize?: (projectId: string, width: number) => void,
): void {
	const cfg = column.ticktickConfig ?? { view: 'today' as const };
	const view: 'today' | 'lists' = cfg.view === 'lists' ? 'lists' : 'today';
	const tz = isValidTz(timezone) ? timezone : DEFAULT_TICKTICK_TZ;
	const hiddenProjects = new Set(cfg.hiddenProjects ?? []);
	const projectWidths = cfg.projectWidths ?? {};
	const client = new TickTickClient(region, cookie, deviceVersion, csrf);
	const host = el.createDiv({ cls: 'dashboard-ticktick-widgets' });

	let snapshot: Snapshot | null = null;
	let completedCache: TickTickTask[] | null = null;
	let habitsCache: HabitsCache | null = null;

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
				renderView();
			} catch (err) { new Notice(messageForError(err)); }
		},
		async rename(task, title) {
			if (!client.canWrite() || !title) return;
			try {
				await client.updateTask(task.projectId ?? '', task.id, { title });
				task.title = title;
				renderView();
			} catch (err) { new Notice(messageForError(err)); }
		},
		async editFields(task, fields) {
			if (!client.canWrite()) { new Notice(t('ticktick.cannotWrite')); return; }
			try {
				await client.updateTask(task.projectId ?? '', task.id, fields);
				if (fields.title !== undefined) task.title = fields.title;
				if (fields.priority !== undefined) task.priority = fields.priority;
				if (fields.dueDate !== undefined) task.dueDate = fields.dueDate || undefined;
				renderView();
			} catch (err) { new Notice(messageForError(err)); }
		},
		async reorder(projectId, movedId, beforeId, siblings) {
			if (!client.canWrite()) return;
			const moved = siblings.find(s => s.id === movedId);
			if (!moved) return;
			const newSort = computeSortOrder(movedId, beforeId, siblings);
			try {
				await client.reorderTasks([{ projectId, id: movedId, sortOrder: newSort }]);
				moved.sortOrder = newSort;
				renderView();
			} catch (err) { new Notice(messageForError(err)); }
		},
	};

	const renderView = (): void => {
		host.empty();
		if (!client.canWrite()) {
			host.createDiv({ cls: 'dashboard-ticktick-readonly-hint', text: t('ticktick.readonlyHint') });
		}
		if (view === 'today') renderTodayView();
		else renderListsView();
	};

	const loadAll = async (force: boolean): Promise<void> => {
		if (force) { client.clearCache(); snapshot = null; completedCache = null; habitsCache = null; }
		host.empty();
		if (!client.isConfigured()) {
			renderHint(host, t('ticktick.noCookie'), t('ticktick.noCookieHint'));
			return;
		}
		try {
			snapshot = await client.fetchSnapshot();
			completedCache = await client.fetchCompleted();
			const habits = await client.fetchHabits();
			const checkins = await client.fetchHabitCheckins(habits.map(h => h.id), tzStamp(new Date(), tz));
			habitsCache = { habits, doneToday: new Set(checkins.map(c => c.habitId)) };
			renderView();
		} catch (err) {
			host.empty();
			renderHint(host, t('ticktick.loadFailed'), messageForError(err));
		}
	};

	// ---------- Today view: 3 cards ----------

	function renderTodayView(): void {
		if (!snapshot || !completedCache || !habitsCache) {
			renderHint(host, t('ticktick.loading'), '');
			return;
		}
		const projMap = new Map(snapshot.projects.map(p => [p.id, p]));
		const grid = host.createDiv({ cls: 'dashboard-ticktick-proj-grid' });

		// Card 1: Today's tasks (due on or before end of today in the chosen tz)
		const todayNum = tzDayNum(new Date(), tz);
		const todayTasks = snapshot.tasks
			.filter((task) => {
				if (task.status !== 0 || !task.dueDate) return false;
				const due = parseTickDate(task.dueDate);
				return due ? tzDayNum(due, tz) <= todayNum : false;
			})
			.sort((a, b) => {
				const da = parseTickDate(a.dueDate)?.getTime() ?? 0;
				const db = parseTickDate(b.dueDate)?.getTime() ?? 0;
				return da - db || b.priority - a.priority;
			});
		buildCard(grid, t('ticktick.viewToday'), String(todayTasks.length), '#ef4444', (list) => {
			if (todayTasks.length === 0) { renderHint(list, t('ticktick.todayEmpty'), ''); return; }
			for (const task of todayTasks) renderTaskRow(list, task, projMap, { showDue: true, app, actions, tz });
		});

		// Card 2: Recently completed (3 days in the chosen tz)
		const sinceNum = tzDayNum(new Date(), tz) - 2;
		const recentDone = completedCache
			.filter((task) => {
				if (!task.completedTime) return false;
				const c = parseTickDate(task.completedTime);
				return c ? tzDayNum(c, tz) >= sinceNum : false;
			})
			.sort((a, b) => (parseTickDate(b.completedTime)?.getTime() ?? 0) - (parseTickDate(a.completedTime)?.getTime() ?? 0));
		buildCard(grid, t('ticktick.viewCompleted'), String(recentDone.length), '#10b981', (list) => {
			if (recentDone.length === 0) { renderHint(list, t('ticktick.noCompleted'), ''); return; }
			for (const task of recentDone) {
				const row = list.createDiv({ cls: 'dashboard-ticktick-row dashboard-ticktick-row--done' });
				const check = row.createDiv({ cls: 'dashboard-ticktick-check dashboard-ticktick-check--done' });
				setIcon(check, 'check');
				if (actions.canWrite) check.addEventListener('click', (e) => { e.stopPropagation(); void actions.toggleComplete(task); });
				const main = row.createDiv({ cls: 'dashboard-ticktick-main' });
				main.createDiv({ cls: 'dashboard-ticktick-title dashboard-ticktick-title--done', text: task.title });
				const when = parseTickDate(task.completedTime);
				if (when) main.createDiv({ cls: 'dashboard-ticktick-meta', text: formatRelative(when, tz) });
			}
		});

		// Card 3: Habits
		buildCard(grid, t('ticktick.viewHabits'), String(habitsCache.habits.length), '#3b82f6', (list) => {
			if (habitsCache!.habits.length === 0) { renderHint(list, t('ticktick.noHabits'), ''); return; }
			for (const habit of habitsCache!.habits) {
				const row = list.createDiv({ cls: 'dashboard-ticktick-row dashboard-ticktick-row--habit' });
				const done = habitsCache!.doneToday.has(habit.id);
				const check = row.createDiv({ cls: 'dashboard-ticktick-check' + (done ? ' dashboard-ticktick-check--done' : '') });
				setIcon(check, done ? 'check' : 'circle');
				const main = row.createDiv({ cls: 'dashboard-ticktick-main' });
				main.createDiv({ cls: 'dashboard-ticktick-title', text: habit.name });
				if (habit.goal) main.createDiv({ cls: 'dashboard-ticktick-meta', text: `${habit.goal}${habit.unit ?? ''}` });
			}
		});
	}

	// ---------- Lists view: project cards ----------

	function renderListsView(): void {
		if (!snapshot) { renderHint(host, t('ticktick.loading'), ''); return; }
		const projMap = new Map(snapshot.projects.map(p => [p.id, p]));
		const groups = new Map<string, TickTickTask[]>();
		for (const task of snapshot.tasks) {
			if (task.status !== 0) continue;
			const pid = task.projectId ?? snapshot.inboxId ?? 'inbox';
			if (hiddenProjects.has(pid)) continue;
			groups.set(pid, [...(groups.get(pid) ?? []), task]);
		}
		if (groups.size === 0) { renderHint(host, t('ticktick.noTasks'), ''); return; }
		const row = host.createDiv({ cls: 'dashboard-ticktick-proj-row' });
		for (const [pid, tasks] of groups) {
			const proj = projMap.get(pid);
			const w = projectWidths[pid];
			const cardEl = buildCard(row, proj?.name ?? t('ticktick.inbox'), String(tasks.length), proj?.color ?? '#6366f1', (list) => {
				list.addClass('dashboard-ticktick-list--reorder');
				const ordered = tasks.sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0) || b.priority - a.priority);
				for (const task of ordered) {
					renderTaskRow(list, task, projMap, { showDue: true, app: null, actions, reorderable: true, projectId: pid, siblings: ordered, tz });
				}
			}, proj?.color, w);
			// Resize handle
			if (!Platform.isMobile) {
				const handle = cardEl.createDiv({ cls: 'dashboard-ticktick-card-resize' });
				let sX = 0;
				let sW = 0;
				const onMove = (ev: MouseEvent): void => {
					const newW = Math.max(200, Math.min(500, sW + ev.clientX - sX));
					cardEl.style.flex = `0 0 ${newW}px`;
					cardEl.style.minWidth = `${newW}px`;
					cardEl.style.maxWidth = `${newW}px`;
				};
				handle.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
					sX = e.clientX;
					sW = cardEl.offsetWidth;
					cardEl.addClass('dashboard-ticktick-card--resizing');
					const up = (ev: MouseEvent): void => {
						activeDocument.removeEventListener('mousemove', onMove);
						activeDocument.removeEventListener('mouseup', up);
						cardEl.removeClass('dashboard-ticktick-card--resizing');
						const finalW = Math.max(200, Math.min(500, sW + ev.clientX - sX));
						if (finalW !== projectWidths[pid]) {
							projectWidths[pid] = finalW;
							onResize?.(pid, finalW);
						}
					};
					activeDocument.addEventListener('mousemove', onMove);
					activeDocument.addEventListener('mouseup', up);
				});
			}
		}
	}

	if (onReloadReady) onReloadReady(() => { void loadAll(true); });
	void loadAll(false);
}

/** Build a project-style card with a colored header and a body callback. */
function buildCard(parent: HTMLElement, title: string, count: string, color: string, body: (list: HTMLElement) => void, headerColor?: string, width?: number): HTMLElement {
	const card = parent.createDiv({ cls: 'dashboard-ticktick-proj-card' });
	if (width && width > 0) {
		card.style.flex = `0 0 ${width}px`;
		card.style.minWidth = `${width}px`;
		card.style.maxWidth = `${width}px`;
	}
	card.style.setProperty('--proj-color', headerColor ?? color);
	const head = card.createDiv({ cls: 'dashboard-ticktick-proj-card-head' });
	const dot = head.createDiv({ cls: 'dashboard-ticktick-proj-dot' });
	dot.style.backgroundColor = color;
	head.createDiv({ cls: 'dashboard-ticktick-group-name', text: title });
	head.createDiv({ cls: 'dashboard-ticktick-group-count', text: count });
	const list = card.createDiv({ cls: 'dashboard-ticktick-list' });
	body(list);
	return card;
}

// ---------- helpers ----------

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

interface RowOpts {
	showDue: boolean;
	app: App | null;
	actions: TaskActions;
	reorderable?: boolean;
	projectId?: string;
	siblings?: TickTickTask[];
	tz: string;
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
	if (opts.actions.canWrite) check.addEventListener('click', (e) => { e.stopPropagation(); void opts.actions.toggleComplete(task); });

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
			new TickTickTaskEditModal(opts.app!, task, (fields) => opts.actions.editFields(task, fields), opts.tz).open();
		});
	}
	const meta: string[] = [];
	if (opts.showDue && task.dueDate) {
		const due = parseTickDate(task.dueDate);
		if (due) meta.push(formatDue(due, opts.tz));
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

// date helpers (wall-clock in the configured TickTick timezone)
function formatDue(due: Date, tz: string): string {
	const diffDays = tzDayNum(due, tz) - tzDayNum(new Date(), tz);
	if (diffDays < 0) return t('ticktick.overdue', { n: String(-diffDays) });
	if (diffDays === 0) return t('ticktick.dueToday');
	const { month, day } = tzParts(due, tz);
	return `${month}/${day}`;
}
function formatRelative(d: Date, tz: string): string {
	const p = tzParts(d, tz);
	const nowP = tzParts(new Date(), tz);
	const sameDay = p.year === nowP.year && p.month === nowP.month && p.day === nowP.day;
	const hh = String(p.hour).padStart(2, '0');
	const mm = String(p.minute).padStart(2, '0');
	return sameDay ? `${hh}:${mm}` : `${p.month}/${p.day} ${hh}:${mm}`;
}
