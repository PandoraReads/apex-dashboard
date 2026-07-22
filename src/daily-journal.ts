import { App, normalizePath, setIcon, TFile, TFolder } from 'obsidian';
import { getLanguage, t } from './i18n';

export type DailyTaskMode = 'routine' | 'day' | 'continuous';

export interface DailyTask {
	id: string;
	text: string;
	checked: boolean;
	mode: DailyTaskMode;
}

export interface DailyJournal {
	date: string;
	tasks: DailyTask[];
	note: string;
	exists: boolean;
}

export interface DailySummary {
	done: number;
	total: number;
	exists: boolean;
}

export interface DailyJournalRenderContext {
	service: DailyJournalService;
	selectedDate: string;
	onDataChanged(): void;
	onStatusChanged(): void;
}

interface PersistentTask {
	id: string;
	text: string;
	startDate: string;
	endDate?: string;
}

const TASK_META_RE = /<!--\s*apex-daily:id=([^;]+);mode=(routine|day|continuous)\s*-->/;
const POOL_META_RE = /<!--\s*apex-daily:id=([^;]+);start=(\d{4}-\d{2}-\d{2})(?:;end=(\d{4}-\d{2}-\d{2}))?\s*-->/;
const NOTE_START = '<!-- apex-daily:note:start -->';
const NOTE_END = '<!-- apex-daily:note:end -->';

const ROUTINES = [
	{ id: 'routine-meditation', labelKey: 'daily.routineMeditation', trackerKey: 'habit_meditation' },
	{ id: 'routine-literature', labelKey: 'daily.routineLiterature', trackerKey: 'habit_literature' },
] as const;

export function toLocalIsoDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseIsoDate(iso: string): Date {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function previousDate(iso: string): string {
	const date = parseIsoDate(iso);
	date.setDate(date.getDate() - 1);
	return toLocalIsoDate(date);
}

function sanitizeTaskText(text: string): string {
	return text.replace(/\s+/g, ' ').replace(/<!--|-->/g, '→').trim();
}

function makeTaskId(): string {
	return `daily-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractNote(raw: string): string {
	const start = raw.indexOf(NOTE_START);
	const end = raw.indexOf(NOTE_END);
	if (start < 0 || end < start) return '';
	return raw.slice(start + NOTE_START.length, end).replace(/^\s*\n/, '').replace(/\n\s*$/, '');
}

function parseJournalTasks(raw: string): DailyTask[] {
	const tasks: DailyTask[] = [];
	for (const line of raw.split('\n')) {
		const checkbox = line.match(/^\s*- \[([ xX])]\s+(.*?)\s*$/);
		if (!checkbox) continue;
		const meta = line.match(TASK_META_RE);
		if (!meta) continue;
		const text = (checkbox[2] ?? '').replace(TASK_META_RE, '').trim();
		tasks.push({
			id: meta[1] ?? makeTaskId(),
			text,
			checked: (checkbox[1] ?? ' ') !== ' ',
			mode: (meta[2] ?? 'day') as DailyTaskMode,
		});
	}
	return tasks;
}

function yamlNumber(raw: string, key: string): number {
	const match = raw.match(new RegExp(`^${key}:\\s*(\\d+(?:\\.\\d+)?)\\s*$`, 'm'));
	return match ? Number(match[1]) : 0;
}

/**
 * Markdown-backed daily journal storage. Routine definitions are built in;
 * user-created continuous tasks live in `_Daily Tasks.md`, while completion
 * state and free text live in one `YYYY-MM-DD.md` file per edited date.
 */
export class DailyJournalService {
	private folder: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(private readonly app: App, folder: string) {
		this.folder = this.normalizeFolder(folder);
	}

	updateFolder(folder: string): void {
		this.folder = this.normalizeFolder(folder);
	}

	private normalizeFolder(folder: string): string {
		return normalizePath(folder.trim().replace(/^\/+|\/+$/g, '') || '02 Daily');
	}

	isManagedPath(path: string): boolean {
		return path === this.poolPath() || (path.startsWith(`${this.folder}/`) && /\d{4}-\d{2}-\d{2}\.md$/.test(path));
	}

	async load(date: string): Promise<DailyJournal> {
		await this.writeQueue;
		return this.loadUnlocked(date);
	}

	async setChecked(date: string, taskId: string, checked: boolean): Promise<void> {
		return this.enqueue(async () => {
			const journal = await this.loadUnlocked(date);
			journal.tasks = journal.tasks.map(task => task.id === taskId ? { ...task, checked } : task);
			await this.writeJournal(journal);
		});
	}

	async addTask(date: string, text: string, mode: 'day' | 'continuous'): Promise<void> {
		const clean = sanitizeTaskText(text);
		if (!clean) return;
		return this.enqueue(async () => {
			const id = makeTaskId();
			if (mode === 'continuous') {
				const persistent = await this.loadPersistentTasks();
				persistent.push({ id, text: clean, startDate: date });
				await this.writePersistentTasks(persistent);
			}
			const journal = await this.loadUnlocked(date);
			if (mode === 'day') journal.tasks.push({ id, text: clean, checked: false, mode });
			await this.writeJournal(journal);
		});
	}

	async removeTask(date: string, task: DailyTask): Promise<void> {
		if (task.mode === 'routine') return;
		return this.enqueue(async () => {
			if (task.mode === 'continuous') {
				const persistent = await this.loadPersistentTasks();
				const next = persistent
					.map(item => item.id === task.id ? { ...item, endDate: previousDate(date) } : item)
					.filter(item => !item.endDate || item.endDate >= item.startDate);
				await this.writePersistentTasks(next);
			}
			const journal = await this.loadUnlocked(date);
			journal.tasks = journal.tasks.filter(item => item.id !== task.id);
			await this.writeJournal(journal);
		});
	}

	async setNote(date: string, note: string): Promise<void> {
		return this.enqueue(async () => {
			const journal = await this.loadUnlocked(date);
			journal.note = note.replace(new RegExp(NOTE_END, 'g'), '').replace(new RegExp(NOTE_START, 'g'), '');
			await this.writeJournal(journal);
		});
	}

	async getMonthSummary(year: number, month: number): Promise<Map<string, DailySummary>> {
		await this.writeQueue;
		const result = new Map<string, DailySummary>();
		const prefix = `${this.folder}/`;
		const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
		const files = this.app.vault.getMarkdownFiles().filter(file =>
			file.path.startsWith(prefix) && file.basename.startsWith(monthPrefix) && /^\d{4}-\d{2}-\d{2}$/.test(file.basename)
		);
		await Promise.all(files.map(async file => {
			const raw = await this.app.vault.cachedRead(file);
			result.set(file.basename, {
				done: yamlNumber(raw, 'tasks_done'),
				total: yamlNumber(raw, 'tasks_total'),
				exists: true,
			});
		}));
		return result;
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const next = this.writeQueue.then(operation, operation);
		this.writeQueue = next.catch(() => undefined);
		return next;
	}

	private dailyPath(date: string): string {
		return normalizePath(`${this.folder}/${date}.md`);
	}

	private poolPath(): string {
		return normalizePath(`${this.folder}/_Daily Tasks.md`);
	}

	private async ensureFolder(): Promise<void> {
		let current = '';
		for (const part of this.folder.split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) await this.app.vault.createFolder(current);
			else if (!(existing instanceof TFolder)) throw new Error(`${current} is not a folder`);
		}
	}

	private async loadUnlocked(date: string): Promise<DailyJournal> {
		const path = this.dailyPath(date);
		const file = this.app.vault.getFileByPath(path);
		const raw = file ? await this.app.vault.cachedRead(file) : '';
		const existingTasks = parseJournalTasks(raw);
		const existingById = new Map(existingTasks.map(task => [task.id, task]));
		const persistent = await this.loadPersistentTasks();

		const routines: DailyTask[] = ROUTINES.map(def => ({
			id: def.id,
			text: t(def.labelKey),
			checked: existingById.get(def.id)?.checked ?? false,
			mode: 'routine',
		}));
		const continuous: DailyTask[] = persistent
			.filter(task => task.startDate <= date && (!task.endDate || task.endDate >= date))
			.map(task => ({
				id: task.id,
				text: task.text,
				checked: existingById.get(task.id)?.checked ?? false,
				mode: 'continuous',
			}));
		const day = existingTasks.filter(task => task.mode === 'day');

		return { date, tasks: [...routines, ...continuous, ...day], note: extractNote(raw), exists: !!file };
	}

	private async loadPersistentTasks(): Promise<PersistentTask[]> {
		const file = this.app.vault.getFileByPath(this.poolPath());
		if (!file) return [];
		const raw = await this.app.vault.cachedRead(file);
		const result: PersistentTask[] = [];
		for (const line of raw.split('\n')) {
			const meta = line.match(POOL_META_RE);
			if (!meta) continue;
			const text = line.replace(/^\s*-\s*/, '').replace(POOL_META_RE, '').trim();
			const item: PersistentTask = { id: meta[1] ?? makeTaskId(), text, startDate: meta[2] ?? toLocalIsoDate(new Date()) };
			if (meta[3]) item.endDate = meta[3];
			result.push(item);
		}
		return result;
	}

	private async writePersistentTasks(tasks: PersistentTask[]): Promise<void> {
		await this.ensureFolder();
		const lines = [
			'---',
			'type: apex-daily-task-pool',
			'---',
			'',
			`# ${t('daily.continuousTasks')}`,
			'',
			...tasks.map(task => `- ${sanitizeTaskText(task.text)} <!-- apex-daily:id=${task.id};start=${task.startDate}${task.endDate ? `;end=${task.endDate}` : ''} -->`),
			'',
		];
		await this.writeFile(this.poolPath(), lines.join('\n'));
	}

	private async writeJournal(journal: DailyJournal): Promise<void> {
		await this.ensureFolder();
		const done = journal.tasks.filter(task => task.checked).length;
		const total = journal.tasks.length;
		const score = total === 0 ? 0 : Math.round(done / total * 100);
		const taskLines = (mode: DailyTaskMode | 'schedule') => journal.tasks
			.filter(task => mode === 'schedule' ? task.mode !== 'routine' : task.mode === mode)
			.map(task => `- [${task.checked ? 'x' : ' '}] ${sanitizeTaskText(task.text)} <!-- apex-daily:id=${task.id};mode=${task.mode} -->`);
		const routineValue = (id: string) => journal.tasks.find(task => task.id === id)?.checked ? 1 : 0;
		const lines = [
			'---',
			`date: ${journal.date}`,
			'type: daily',
			`tasks_done: ${done}`,
			`tasks_total: ${total}`,
			`task_score: ${score}`,
			`habit_meditation: ${routineValue('routine-meditation')}`,
			`habit_literature: ${routineValue('routine-literature')}`,
			'---',
			'',
			`# ${journal.date}`,
			'',
			`## ${t('daily.routines')}`,
			'',
			...taskLines('routine'),
			'',
			`## ${t('daily.schedule')}`,
			'',
			...taskLines('schedule'),
			'',
			`## ${t('daily.note')}`,
			'',
			NOTE_START,
			journal.note,
			NOTE_END,
			'',
		];
		await this.writeFile(this.dailyPath(journal.date), lines.join('\n'));
	}

	private async writeFile(path: string, content: string): Promise<void> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing instanceof TFile) {
			const old = await this.app.vault.cachedRead(existing);
			if (old !== content) await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}
}

function formatDateLabel(iso: string): string {
	return new Intl.DateTimeFormat(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
		year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
	}).format(parseIsoDate(iso));
}

/** Render the compact month picker that replaces the old seven-day strip. */
export function renderSidebarMonthCalendar(
	container: HTMLElement,
	selectedDate: string,
	service: DailyJournalService,
	onSelect: (date: string) => void,
): void {
	let host = container.querySelector<HTMLElement>('.dashboard-sidebar-month-calendar');
	if (!host) host = container.createDiv({ cls: 'dashboard-sidebar-month-calendar' });
	host.empty();
	let cursor = parseIsoDate(selectedDate);
	let renderToken = 0;

	const render = async (): Promise<void> => {
		const token = ++renderToken;
		const year = cursor.getFullYear();
		const month = cursor.getMonth();
		const summaries = await service.getMonthSummary(year, month);
		if (token !== renderToken || !host?.isConnected) return;
		host.empty();

		const nav = host.createDiv({ cls: 'dashboard-sidebar-month-nav' });
		const prev = nav.createEl('button', { cls: 'dashboard-sidebar-month-nav-btn', attr: { 'aria-label': t('daily.previousMonth') } });
		setIcon(prev, 'chevron-left');
		nav.createDiv({
			cls: 'dashboard-sidebar-month-label',
			text: new Intl.DateTimeFormat(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' }).format(cursor),
		});
		const next = nav.createEl('button', { cls: 'dashboard-sidebar-month-nav-btn', attr: { 'aria-label': t('daily.nextMonth') } });
		setIcon(next, 'chevron-right');
		prev.addEventListener('click', () => { cursor = new Date(year, month - 1, 1); void render(); });
		next.addEventListener('click', () => { cursor = new Date(year, month + 1, 1); void render(); });

		const weekdays = host.createDiv({ cls: 'dashboard-sidebar-month-weekdays' });
		for (const label of t('calendar.weekdays').split(',')) weekdays.createSpan({ text: label.trim() });

		const grid = host.createDiv({ cls: 'dashboard-sidebar-month-grid' });
		const first = new Date(year, month, 1);
		const leading = (first.getDay() + 6) % 7;
		const start = new Date(year, month, 1 - leading);
		const today = toLocalIsoDate(new Date());
		for (let i = 0; i < 42; i++) {
			const date = new Date(start);
			date.setDate(start.getDate() + i);
			const iso = toLocalIsoDate(date);
			const summary = summaries.get(iso);
			const cell = grid.createEl('button', {
				cls: 'dashboard-sidebar-month-cell'
					+ (date.getMonth() !== month ? ' is-outside' : '')
					+ (iso === today ? ' is-today' : '')
					+ (iso === selectedDate ? ' is-selected' : '')
					+ (summary?.exists ? ' has-entry' : '')
					+ (summary && summary.total > 0 && summary.done === summary.total ? ' is-complete' : ''),
				attr: { 'aria-label': iso },
			});
			cell.createSpan({ text: String(date.getDate()) });
			if (summary?.exists) cell.createSpan({ cls: 'dashboard-sidebar-month-dot' });
			cell.addEventListener('click', () => onSelect(iso));
		}
	};

	void render();
}

/** Render the selected date's routines, scheduled tasks, and one free-text note. */
export function renderDailyJournalSection(
	el: HTMLElement,
	context: DailyJournalRenderContext,
): void {
	const host = el.createDiv({ cls: 'dashboard-daily-journal-content' });
	host.createDiv({ cls: 'dashboard-daily-loading', text: t('daily.loading') });

	void context.service.load(context.selectedDate).then(journal => {
		if (!host.isConnected) return;
		host.empty();
		const header = host.createDiv({ cls: 'dashboard-daily-date-header' });
		header.createDiv({ cls: 'dashboard-daily-date-label', text: formatDateLabel(journal.date) });
		const done = journal.tasks.filter(task => task.checked).length;
		header.createDiv({ cls: 'dashboard-daily-progress', text: `${done}/${journal.tasks.length}` });

		let pendingNote = journal.note;
		let savedNote = journal.note;
		let noteTimer: number | null = null;
		const flushNote = async (): Promise<void> => {
			if (noteTimer) { window.clearTimeout(noteTimer); noteTimer = null; }
			if (pendingNote === savedNote) return;
			await context.service.setNote(journal.date, pendingNote);
			savedNote = pendingNote;
			context.onStatusChanged();
		};
		const refreshAfterMutation = (): void => {
			context.onDataChanged();
			if (!host.isConnected) return;
			host.remove();
			renderDailyJournalSection(el, context);
		};

		const renderGroup = (parent: HTMLElement, title: string, tasks: DailyTask[]): void => {
			const group = parent.createDiv({ cls: 'dashboard-daily-group' });
			group.createDiv({ cls: 'dashboard-daily-group-title', text: title });
			const list = group.createDiv({ cls: 'dashboard-daily-task-list' });
			if (tasks.length === 0) list.createDiv({ cls: 'dashboard-daily-empty', text: t('daily.noTasks') });
			for (const task of tasks) {
				const row = list.createDiv({ cls: 'dashboard-daily-task-row' + (task.checked ? ' is-done' : '') });
				const checkbox = row.createEl('input', { cls: 'dashboard-daily-checkbox', attr: { type: 'checkbox' } });
				checkbox.checked = task.checked;
				row.createSpan({ cls: 'dashboard-daily-task-text', text: task.text });
				if (task.mode === 'continuous') row.createSpan({ cls: 'dashboard-daily-mode-badge', text: t('daily.continuous') });
				if (task.mode !== 'routine') {
					const remove = row.createEl('button', {
						cls: 'dashboard-daily-remove-btn',
						attr: { 'aria-label': task.mode === 'continuous' ? t('daily.stopContinuous') : t('common.delete') },
					});
					setIcon(remove, task.mode === 'continuous' ? 'circle-stop' : 'x');
					remove.addEventListener('click', () => {
						void (async () => {
							await flushNote();
							await context.service.removeTask(journal.date, task);
							refreshAfterMutation();
						})();
					});
				}
				checkbox.addEventListener('change', () => {
					void (async () => {
						checkbox.disabled = true;
						await flushNote();
						await context.service.setChecked(journal.date, task.id, checkbox.checked);
						refreshAfterMutation();
					})();
				});
			}
		};

		const leftColumn = host.createDiv({ cls: 'dashboard-daily-left-column' });
		renderGroup(leftColumn, t('daily.routines'), journal.tasks.filter(task => task.mode !== 'day'));
		renderGroup(leftColumn, t('daily.schedule'), journal.tasks.filter(task => task.mode === 'day'));

		const add = leftColumn.createDiv({ cls: 'dashboard-daily-add-row' });
		const input = add.createEl('input', { cls: 'dashboard-daily-add-input', attr: { type: 'text', placeholder: t('daily.addPlaceholder') } });
		const mode = add.createEl('select', { cls: 'dashboard-daily-add-mode' });
		mode.createEl('option', { text: t('daily.onlyThisDay'), value: 'day' });
		mode.createEl('option', { text: t('daily.continuous'), value: 'continuous' });
		const addBtn = add.createEl('button', { cls: 'dashboard-daily-add-btn', attr: { 'aria-label': t('common.add') } });
		setIcon(addBtn, 'plus');
		const submit = (): void => {
			const text = input.value.trim();
			if (!text) return;
			void (async () => {
				addBtn.setAttribute('disabled', 'true');
				await flushNote();
				await context.service.addTask(journal.date, text, mode.value === 'continuous' ? 'continuous' : 'day');
				refreshAfterMutation();
			})();
		};
		addBtn.addEventListener('click', submit);
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') { event.preventDefault(); submit(); }
		});

		const noteWrap = host.createDiv({ cls: 'dashboard-daily-note-wrap' });
		noteWrap.createDiv({ cls: 'dashboard-daily-group-title', text: t('daily.note') });
		const textarea = noteWrap.createEl('textarea', {
			cls: 'dashboard-daily-note',
			attr: { placeholder: t('daily.notePlaceholder'), rows: '4' },
		});
		textarea.value = journal.note;
		textarea.addEventListener('input', () => {
			pendingNote = textarea.value;
			if (noteTimer) window.clearTimeout(noteTimer);
			noteTimer = window.setTimeout(() => { void flushNote(); }, 600);
		});
		textarea.addEventListener('blur', () => { void flushNote(); });
	}).catch(() => {
		if (!host.isConnected) return;
		host.empty();
		host.createDiv({ cls: 'dashboard-daily-error', text: t('daily.loadFailed') });
	});
}
