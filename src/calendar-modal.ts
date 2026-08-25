import { App, Modal, Notice, setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
import { t } from './i18n';
import { renderTextWithLinks } from './renderer';
import { renderMonthGrid, renderWeekTimeGrid, mondayOf, taskDayTime, byDayTaskTime, appendDayOriginMark } from './calendar-grid';
import { toIsoDate, type VaultTask } from './alltasks-scan';
import { insertTaskForDay, type TaskInsertTarget } from './daily-notes';
import { applyModalTheme } from './modal-theme';

interface CalendarModalCallbacks {
	onToggle: (task: VaultTask, nextChecked: boolean) => Promise<void> | void;
	/** Open a task's source note, optionally scrolling to the task's line. */
	onOpenNote?: (file: TFile, line?: number) => void;
}

/**
 * Full-screen month grid: navigate any month, toggle tasks inline (writes back
 * via onToggle), click a task to open its source note. Receives a fully indexed
 * day map so navigation across months needs no re-scan.
 */
export class CalendarMonthModal extends Modal {
	private readonly byDay: Map<string, VaultTask[]>;
	private year: number;
	private month: number;
	private view: 'month' | 'week';
	private weekStart: Date;
	private readonly cb: CalendarModalCallbacks;
	/** Vault path of the dashboard file, forwarded to day agendas opened from
	 *  bar clicks (their add-task fallback destination). */
	private readonly dashboardFile?: string;

	constructor(
		app: App,
		byDay: Map<string, VaultTask[]>,
		cb: CalendarModalCallbacks,
		initialView: 'month' | 'week' = 'month',
		initialWeekStart?: Date,
		dashboardFile?: string,
	) {
		super(app);
		this.byDay = byDay;
		this.cb = cb;
		this.dashboardFile = dashboardFile;
		const now = new Date();
		this.year = now.getFullYear();
		this.month = now.getMonth();
		this.view = initialView;
		this.weekStart = initialWeekStart ?? mondayOf(now);
	}

	onOpen(): void {
		const { contentEl, containerEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-calendar-fullscreen');
		modalEl.addClass('dashboard-calendar-fullscreen-modal');
		applyModalTheme(containerEl);
		containerEl.addClass('modal--dashboard');
		containerEl.setCssProps({
			background: 'transparent',
			backgroundColor: 'transparent',
			border: 'none',
			boxShadow: 'none',
		});
		this.scope.register([], 'ArrowLeft', () => { this.shift(-1); return false; });
		this.scope.register([], 'ArrowRight', () => { this.shift(1); return false; });
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-calendar-fullscreen-inner' });

		const header = container.createDiv({ cls: 'dashboard-modal-header dashboard-calendar-nav' });
		const prev = header.createDiv({ cls: 'dashboard-calendar-nav-btn' });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => this.shift(-1));
		const labelEl = header.createDiv({ cls: 'dashboard-modal-title dashboard-calendar-nav-label' });
		const next = header.createDiv({ cls: 'dashboard-calendar-nav-btn' });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.shift(1));

		// Month | Week toggle
		const viewToggle = header.createDiv({ cls: 'dashboard-library-view-toggle dashboard-calendar-view-toggle' });
		(['month', 'week'] as const).forEach((v) => {
			const btn = viewToggle.createDiv({
				cls: 'dashboard-library-view-btn' + (v === this.view ? ' active' : ''),
				attr: { 'aria-label': v === 'month' ? t('calendar.viewMonth') : t('calendar.viewWeek') },
			});
			setIcon(btn, v === 'month' ? 'calendar' : 'calendar-range');
			btn.addEventListener('click', () => {
				if (this.view === v) return;
				this.view = v;
				if (v === 'week') this.weekStart = mondayOf(new Date());
				this.render();
			});
		});

		const todayBtn = header.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('calendar.today') });
		todayBtn.addEventListener('click', () => {
			const now = new Date();
			this.year = now.getFullYear();
			this.month = now.getMonth();
			this.weekStart = mondayOf(now);
			this.render();
		});

		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-calendar-fullscreen-body' });
		const gridOpts = {
			compact: false as const,
			app: this.app,
			onToggle: (task: VaultTask, next: boolean) => { void this.toggle(task, next); },
			onOpenNote: this.cb.onOpenNote,
			onBarClick: (iso: string) => {
				new DayAgendaModal(this.app, iso, this.byDay.get(iso) ?? [], this.cb, this.dashboardFile).open();
			},
		};
		const { label } = this.view === 'week'
			? renderWeekTimeGrid(body, this.weekStart, this.byDay, gridOpts)
			: renderMonthGrid(body, this.year, this.month, this.byDay, gridOpts);
		labelEl.textContent = label;
	}

	private shift(delta: number): void {
		if (this.view === 'week') {
			const d = new Date(this.weekStart);
			d.setDate(this.weekStart.getDate() + delta * 7);
			this.weekStart = d;
		} else {
			let m = this.month + delta;
			let y = this.year;
			while (m < 0) { m += 12; y -= 1; }
			while (m > 11) { m -= 12; y += 1; }
			this.month = m;
			this.year = y;
		}
		this.render();
	}

	private async toggle(task: VaultTask, nextChecked: boolean): Promise<void> {
		await this.cb.onToggle(task, nextChecked);
		task.checked = nextChecked;
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Compact single-day agenda: lists one day's tasks with checkboxes + open buttons. */
export class DayAgendaModal extends Modal {
	private readonly iso: string;
	private tasks: VaultTask[];
	private readonly cb: CalendarModalCallbacks;
	/** Vault path (no .md required) of the dashboard file, used as the fallback
	 *  destination when the day has no daily note yet. */
	private readonly dashboardFile?: string;

	constructor(app: App, iso: string, tasks: VaultTask[], cb: CalendarModalCallbacks, dashboardFile?: string) {
		super(app);
		this.iso = iso;
		this.tasks = tasks;
		this.cb = cb;
		this.dashboardFile = dashboardFile;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		containerEl.setCssProps({
			background: 'transparent',
			backgroundColor: 'transparent',
			border: 'none',
			boxShadow: 'none',
		});

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: `${this.iso} · ${t('calendar.dayAgenda')}` });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Add-task row: optional time (HH:MM) + title + Add. Goes to the top of
		// this day's daily note (created from the Daily Notes template/path when
		// absent — or, when the day has no daily note, to the dashboard file's
		// first checkbox list; see insertTaskForDay).
		const addRow = body.createDiv({ cls: 'dashboard-cal-day-add' });
		const timeInput = addRow.createEl('input', {
			cls: 'dashboard-modal-input dashboard-cal-day-add-time',
			attr: { type: 'time', 'aria-label': t('calendar.taskTime') },
		});
		const titleInput = addRow.createEl('input', {
			cls: 'dashboard-modal-input dashboard-cal-day-add-title',
			attr: { type: 'text', placeholder: t('calendar.addTaskPlaceholder') },
		});
		titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); void this.addTask(titleInput, timeInput); }
		});
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm dashboard-cal-day-add-btn',
			text: t('calendar.addTask'),
		});
		addBtn.addEventListener('click', () => void this.addTask(titleInput, timeInput));

		if (this.tasks.length === 0) {
			body.createDiv({ cls: 'dashboard-library-empty', text: t('calendar.noEvents') });
		} else {
			const list = body.createDiv({ cls: 'dashboard-alltasks-list' });
			for (const task of [...this.tasks].sort(byDayTaskTime(this.iso))) {
				list.appendChild(this.renderRow(task));
			}
		}

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.close'),
		}).addEventListener('click', () => this.close());
	}

	private renderRow(task: VaultTask): HTMLElement {
		const row = createDiv();
		row.className = 'dashboard-alltasks-row' + (task.checked ? ' is-done' : '');
		const check = row.createEl('input', { cls: 'dashboard-alltasks-check', attr: { type: 'checkbox' } });
		check.checked = task.checked;
		check.addEventListener('click', (e) => { e.preventDefault(); void this.toggle(task, !task.checked); });

		const tm = taskDayTime(task, this.iso);
		if (tm) row.createDiv({ cls: 'dashboard-calendar-event-time', text: tm });
		appendDayOriginMark(row, task, this.iso);

		if (task.priority) {
			row.createDiv({ cls: `dashboard-alltasks-prio dashboard-alltasks-prio--${task.priority}`, text: task.priority[0]!.toUpperCase() });
		}
		const bodyEl = row.createDiv({ cls: 'dashboard-alltasks-body' });
		const textEl = bodyEl.createDiv({ cls: 'dashboard-alltasks-text' });
		renderTextWithLinks(textEl, task.text, this.app);

		const source = row.createDiv({ cls: 'dashboard-alltasks-source' });
		const chip = source.createDiv({ cls: 'dashboard-alltasks-chip', text: task.file.basename });
		chip.title = task.path;
		chip.setAttribute('role', 'button');
		chip.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onOpenNote?.(task.file, task.line); });

		// Whole-row jump (when wired): click anywhere except the checkbox, the
		// source chip, or an inline link to open the note at the task's line.
		if (this.cb.onOpenNote) {
			row.addClass('is-jumpable');
			row.addEventListener('click', (e) => {
				const target = e.target as HTMLElement;
				if (target.tagName === 'INPUT' || target.closest('a') || target.closest('.dashboard-alltasks-chip')) return;
				this.cb.onOpenNote?.(task.file, task.line);
			});
		}
		return row;
	}

	/** Add the entered task (optional time + title) for this day: to the top of
	 *  the day's daily note, or — when that day has no daily note — to the
	 *  dashboard file's first checkbox list. */
	private async addTask(titleInput: HTMLInputElement, timeInput: HTMLInputElement): Promise<void> {
		const title = titleInput.value.trim();
		if (!title) return;
		const time = timeInput.value; // '' or 'HH:MM'
		const reminder = time ? `${this.iso} ${time}` : undefined;
		// Timed tasks use the plugin's ⏰ reminder; date-only tasks use 📅 so they
		// still land on this calendar day (a task with no date marker wouldn't
		// be calendar-relevant and would never show up).
		const line = reminder ? `- [ ] ${title} ⏰ ${reminder}` : `- [ ] ${title} 📅 ${this.iso}`;

		let target: TaskInsertTarget | null = null;
		try {
			target = await insertTaskForDay(this.app, this.iso, line, this.dashboardFile);
		} catch (err) {
			console.error('[Dashboard] add task failed:', err);
			new Notice(t('calendar.taskAddFailed'), 4000);
			return;
		}
		if (!target) {
			new Notice(t('calendar.dailyNotesDisabled'), 5000);
			return;
		}
		new Notice(t(
			target.kind === 'dashboard-list' ? 'calendar.taskAddedDashboard' : 'calendar.taskAddedDaily',
			{ path: target.file.path },
		), 3000);

		// Optimistic: show the new task immediately at its time slot. The
		// calendar section also re-scans automatically on the vault write event.
		this.tasks = [...this.tasks, {
			file: target.file, path: target.file.path, line: target.line, originalLine: target.writtenLine, checked: false,
			text: title, reminder, due: this.iso, time: time || undefined,
			priority: undefined, mtime: Date.now(), ctime: Date.now(),
		}].sort(byDayTaskTime(this.iso));
		titleInput.value = '';
		timeInput.value = '';
		this.onOpen();
	}

	private async toggle(task: VaultTask, nextChecked: boolean): Promise<void> {
		await this.cb.onToggle(task, nextChecked);
		task.checked = nextChecked;
		this.onOpen();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export { toIsoDate };
