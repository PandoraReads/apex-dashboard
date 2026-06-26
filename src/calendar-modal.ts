import { App, Modal, setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
import { t } from './i18n';
import { renderTextWithLinks } from './renderer';
import { renderMonthGrid, monthLabel } from './calendar-grid';
import { toIsoDate, type VaultTask } from './alltasks-scan';

interface CalendarModalCallbacks {
	onToggle: (task: VaultTask, nextChecked: boolean) => Promise<void> | void;
	onOpenNote?: (file: TFile) => void;
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
	private readonly cb: CalendarModalCallbacks;

	constructor(app: App, byDay: Map<string, VaultTask[]>, cb: CalendarModalCallbacks) {
		super(app);
		this.byDay = byDay;
		this.cb = cb;
		const now = new Date();
		this.year = now.getFullYear();
		this.month = now.getMonth();
	}

	onOpen(): void {
		const { contentEl, containerEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-calendar-fullscreen');
		modalEl.addClass('dashboard-calendar-fullscreen-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.style.background = 'transparent';
		containerEl.style.backgroundColor = 'transparent';
		containerEl.style.border = 'none';
		containerEl.style.boxShadow = 'none';
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
		header.createDiv({ cls: 'dashboard-modal-title dashboard-calendar-nav-label', text: monthLabel(this.year, this.month) });
		const next = header.createDiv({ cls: 'dashboard-calendar-nav-btn' });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.shift(1));

		const todayBtn = header.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('calendar.today') });
		todayBtn.addEventListener('click', () => {
			const now = new Date();
			this.year = now.getFullYear();
			this.month = now.getMonth();
			this.render();
		});

		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-calendar-fullscreen-body' });
		renderMonthGrid(body, this.year, this.month, this.byDay, {
			compact: false,
			app: this.app,
			onToggle: (task, next) => { void this.toggle(task, next); },
			onOpenNote: this.cb.onOpenNote,
		});
	}

	private shift(delta: number): void {
		let m = this.month + delta;
		let y = this.year;
		while (m < 0) { m += 12; y -= 1; }
		while (m > 11) { m -= 12; y += 1; }
		this.month = m;
		this.year = y;
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
	private readonly tasks: VaultTask[];
	private readonly cb: CalendarModalCallbacks;

	constructor(app: App, iso: string, tasks: VaultTask[], cb: CalendarModalCallbacks) {
		super(app);
		this.iso = iso;
		this.tasks = tasks;
		this.cb = cb;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		containerEl.style.background = 'transparent';
		containerEl.style.backgroundColor = 'transparent';
		containerEl.style.border = 'none';
		containerEl.style.boxShadow = 'none';

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: `${this.iso} · ${t('calendar.dayAgenda')}` });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		if (this.tasks.length === 0) {
			body.createDiv({ cls: 'dashboard-library-empty', text: t('calendar.noEvents') });
		} else {
			const list = body.createDiv({ cls: 'dashboard-alltasks-list' });
			for (const task of this.tasks) {
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
		const row = document.createElement('div');
		row.className = 'dashboard-alltasks-row' + (task.checked ? ' is-done' : '');
		const check = row.createEl('input', { cls: 'dashboard-alltasks-check', attr: { type: 'checkbox' } });
		check.checked = task.checked;
		check.addEventListener('click', (e) => { e.preventDefault(); void this.toggle(task, !task.checked); });

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
		chip.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onOpenNote?.(task.file); });
		return row;
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
