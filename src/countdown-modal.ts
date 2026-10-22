import { App, Modal } from 'obsidian';
import type { CountdownConfig } from './types';
import { t } from './i18n';
import { monthLabels, weekdayLabels } from './locale-format';
import { applyModalTheme } from './modal-theme';
import { WidgetBackgroundModal } from './widget-background';

export class CountdownSettingsModal extends Modal {
	private config: CountdownConfig;
	private onSave: (config: CountdownConfig) => void;
	private calendarPopup: HTMLElement | null = null;
	private selectedDate: string;
	private selectedHour: number;
	private selectedMinute: number;
	private removeOutsideClickListener: (() => void) | null = null;

	constructor(app: App, config: CountdownConfig, onSave: (config: CountdownConfig) => void) {
		super(app);
		this.config = { ...config };
		this.onSave = onSave;

		// Parse existing value: "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD"
		const raw = typeof config.targetDate === 'string' ? config.targetDate.trim() : '';
		const parsed = /^(\d{4}-\d{2}-\d{2})(?:T(\d{1,2}):(\d{1,2}))?$/.exec(raw);
		if (parsed && !Number.isNaN(Date.parse(`${parsed[1]}T00:00:00`))) {
			this.selectedDate = parsed[1]!;
			this.selectedHour = Math.min(23, Math.max(0, Number(parsed[2] ?? 0)));
			this.selectedMinute = Math.min(59, Math.max(0, Number(parsed[3] ?? 0)));
		} else {
			this.selectedDate = '';
			const now = new Date();
			this.selectedHour = now.getHours();
			this.selectedMinute = now.getMinutes();
		}
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('countdown.settingsTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const form = body.createDiv({ cls: 'dashboard-modal-form' });

		// Date row with calendar picker (time is picked inside the popup too)
		const dateRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		dateRow.createEl('label', { text: t('countdown.targetDate'), cls: 'dashboard-modal-countdown-label' });

		const dateTrigger = dateRow.createDiv({ cls: 'dashboard-modal-input dashboard-countdown-date-trigger' });
		const dateText = dateTrigger.createSpan({ text: this.selectedDate || t('countdown.setTarget') });
		dateTrigger.createSpan({ cls: 'dashboard-countdown-date-icon', text: ' \u{1F4C5}' });

		dateTrigger.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showCalendarPopup(dateTrigger, dateText);
		});

		// Display mode
		const modeRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		modeRow.createEl('label', { text: t('countdown.displayMode'), cls: 'dashboard-modal-countdown-label' });
		const modeSelect = modeRow.createEl('select', { cls: 'dashboard-modal-input dashboard-modal-countdown-select' });
		const daysOpt = modeSelect.createEl('option', { text: t('countdown.days'), attr: { value: 'days' } });
		const hoursOpt = modeSelect.createEl('option', { text: t('countdown.hours'), attr: { value: 'hours' } });
		const minutesOpt = modeSelect.createEl('option', { text: t('countdown.minutes'), attr: { value: 'minutes' } });
		if (this.config.displayMode === 'days') daysOpt.selected = true;
		else if (this.config.displayMode === 'hours') hoursOpt.selected = true;
		else minutesOpt.selected = true;

		// Reminder days
		const reminderRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		reminderRow.createEl('label', { text: t('countdown.reminderDays'), cls: 'dashboard-modal-countdown-label' });
		const reminderInput = reminderRow.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'number', min: '0', max: '365', value: String(this.config.reminderDays), placeholder: '0' },
		});
		reminderRow.createSpan({ text: t('countdown.reminderDaysDesc'), cls: 'dashboard-modal-countdown-hint' });

		// Label
		const labelRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		labelRow.createEl('label', { text: t('countdown.label'), cls: 'dashboard-modal-countdown-label' });
		const labelInput = labelRow.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', value: this.config.label, placeholder: t('countdown.labelPlaceholder') },
		});

		// Card background (nested modal mutates this.config in place; the
		// Save below spreads this.config so the background rides along).
		const bgRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		bgRow.createEl('label', { text: t('wbg.set'), cls: 'dashboard-modal-countdown-label' });
		const bgBtn = bgRow.createEl('button', {
			cls: 'dashboard-modal-btn',
			text: this.config.background ? t('common.edit') : t('wbg.set'),
		});
		bgBtn.addEventListener('click', () => {
			new WidgetBackgroundModal(this.app, this.config.background, (bg) => {
				this.config.background = bg;
			}).open();
		});

		// Actions
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		const saveBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		saveBtn.addEventListener('click', () => {
			// Time lives on the instance (picked inside the calendar popup).
			const dateTime = this.selectedDate
				? `${this.selectedDate}T${String(this.selectedHour).padStart(2, '0')}:${String(this.selectedMinute).padStart(2, '0')}`
				: '';
			this.onSave({
				...this.config,
				targetDate: dateTime,
				displayMode: modeSelect.value as 'days' | 'hours' | 'minutes',
				reminderDays: parseInt(reminderInput.value, 10) || 0,
				label: labelInput.value.trim(),
			});
			this.close();
		});
	}

	onClose(): void {
		this.closeCalendarPopup();
		const { contentEl } = this;
		contentEl.empty();
	}

	private closeCalendarPopup(): void {
		this.removeOutsideClickListener?.();
		this.removeOutsideClickListener = null;
		if (this.calendarPopup) {
			this.calendarPopup.remove();
			this.calendarPopup = null;
		}
	}

	private showCalendarPopup(anchor: HTMLElement, dateText: HTMLElement): void {
		this.closeCalendarPopup();

		const popupDocument = this.contentEl.ownerDocument;
		const popupWindow = popupDocument.defaultView ?? window;
		const popup = popupDocument.body.createDiv({ cls: 'dashboard-task-reminder-popup dashboard-countdown-calendar-popup' });
		applyModalTheme(popup);

		const rect = anchor.getBoundingClientRect();
		popup.setCssProps({
			position: 'fixed',
			top: `${rect.bottom + 4}px`,
		});
		const popupWidth = 240;
		if (rect.left + popupWidth > window.innerWidth) {
			popup.style.right = `${window.innerWidth - rect.right}px`;
		} else {
			popup.style.left = `${rect.left}px`;
		}

		const now = new Date();
		let selectedYear: number;
		let selectedMonth: number;
		let selectedDay: number;

		if (this.selectedDate) {
			const dp = this.selectedDate.split('-').map(Number);
			selectedYear = dp[0] ?? now.getFullYear();
			selectedMonth = (dp[1] ?? now.getMonth() + 1) - 1;
			selectedDay = dp[2] ?? now.getDate();
		} else {
			selectedYear = now.getFullYear();
			selectedMonth = now.getMonth();
			selectedDay = now.getDate();
		}

		const viewYear = { value: selectedYear };
		const viewMonth = { value: selectedMonth };
		const dayNames = weekdayLabels();
		const monthNames = monthLabels();

		// Two-level header: < > navigate months (or years in the year-month
		// panel); the label button toggles between the day grid and the
		// year-month panel for fast jumps across years.
		const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
		const prevBtn = calNav.createEl('button', { text: '<' });
		const monthLabel = calNav.createEl('button', { cls: 'dashboard-countdown-cal-label' });
		const nextBtn = calNav.createEl('button', { text: '>' });

		// The panel swaps between the day grid and the year-month picker;
		// the time row and action buttons stay put below it.
		const calBody = popup.createDiv();
		const timeRow = popup.createDiv({ cls: 'dashboard-countdown-popup-time' });
		const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
		btnRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') });
		btnRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') });

		const ymMode = { value: false };

		const renderCalendar = () => {
			calBody.empty();
			if (ymMode.value) {
				renderYearMonthPanel();
				return;
			}
			const grid = calBody.createDiv({ cls: 'dashboard-task-reminder-calendar' });
			const y = viewYear.value;
			const m = viewMonth.value;
			monthLabel.setText(`${y}-${String(m + 1).padStart(2, '0')}`);

			for (const d of dayNames) {
				grid.createDiv({ cls: 'dashboard-task-reminder-calendar-header', text: d });
			}

			const firstDay = new Date(y, m, 1).getDay();
			const daysInMonth = new Date(y, m + 1, 0).getDate();
			const daysInPrev = new Date(y, m, 0).getDate();
			const today = new Date();
			const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

			for (let i = firstDay - 1; i >= 0; i--) {
				const d = daysInPrev - i;
				grid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
			}

			for (let d = 1; d <= daysInMonth; d++) {
				const cls = ['dashboard-task-reminder-calendar-day'];
				if (isCurrentMonth && d === today.getDate()) cls.push('dashboard-task-reminder-calendar-day--today');
				if (y === selectedYear && m === selectedMonth && d === selectedDay) cls.push('dashboard-task-reminder-calendar-day--selected');
				const dayBtn = grid.createEl('button', { cls: cls.join(' '), text: String(d) });
				dayBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					selectedYear = y;
					selectedMonth = m;
					selectedDay = d;
					renderCalendar();
				});
			}

			const totalCells = firstDay + daysInMonth;
			const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
			for (let d = 1; d <= remaining; d++) {
				grid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
			}
		};

		/** Year-month picker: the top nav already shows the year and steps by
		 *  years, so this panel is just the 12 month cells. */
		const renderYearMonthPanel = () => {
			const panel = calBody.createDiv({ cls: 'dashboard-countdown-ym-panel' });
			monthLabel.setText(String(viewYear.value));

			const monthGrid = panel.createDiv({ cls: 'dashboard-countdown-ym-grid' });
			for (let m = 0; m < 12; m++) {
				const cls = ['dashboard-countdown-ym-cell'];
				if (viewYear.value === selectedYear && m === selectedMonth) cls.push('dashboard-task-reminder-calendar-day--selected');
				const monthBtn = monthGrid.createEl('button', { cls: cls.join(' '), text: monthNames[m] });
				monthBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					viewMonth.value = m;
					ymMode.value = false;
					renderCalendar();
				});
			}
		};

		// Header navigation: months in the day grid, years in the year-month
		// panel; the label button toggles between the two views.
		const step = (dir: number): void => {
			if (ymMode.value) {
				viewYear.value += dir;
			} else {
				viewMonth.value += dir;
				if (viewMonth.value < 0) { viewMonth.value = 11; viewYear.value--; }
				if (viewMonth.value > 11) { viewMonth.value = 0; viewYear.value++; }
			}
			renderCalendar();
		};

		prevBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			step(-1);
		});

		nextBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			step(1);
		});

		monthLabel.addEventListener('click', (e) => {
			e.stopPropagation();
			ymMode.value = !ymMode.value;
			renderCalendar();
		});

		// Time row: hour and minute pick inside the popup, so one Save commit
		// carries both the date and time. Use an in-popup picker instead of a
		// native <select>: desktop native menus can emit outside mousedown events.
		timeRow.createSpan({ cls: 'dashboard-countdown-popup-time-label', text: t('countdown.targetTime') });
		let activeTimeMenu: HTMLElement | null = null;
		let hourTrigger: HTMLButtonElement;
		let minuteTrigger: HTMLButtonElement;
		const closeTimeMenu = (): void => {
			activeTimeMenu?.remove();
			activeTimeMenu = null;
			hourTrigger?.setAttribute('aria-expanded', 'false');
			minuteTrigger?.setAttribute('aria-expanded', 'false');
		};
		hourTrigger = timeRow.createEl('button', {
			cls: 'dashboard-countdown-time-picker-trigger',
			text: String(this.selectedHour).padStart(2, '0'),
			attr: { type: 'button', 'aria-label': t('countdown.targetTime') },
		});
		timeRow.createSpan({ cls: 'dashboard-countdown-time-sep', text: ':' });
		minuteTrigger = timeRow.createEl('button', {
			cls: 'dashboard-countdown-time-picker-trigger',
			text: String(this.selectedMinute).padStart(2, '0'),
			attr: { type: 'button', 'aria-label': t('countdown.targetTime') },
		});
		const openTimeMenu = (kind: 'hour' | 'minute', trigger: HTMLButtonElement): void => {
			if (activeTimeMenu?.hasClass(`dashboard-countdown-time-options--${kind}`)) {
				closeTimeMenu();
				return;
			}
			closeTimeMenu();
			const menu = timeRow.createDiv({ cls: `dashboard-countdown-time-options dashboard-countdown-time-options--${kind}` });
			activeTimeMenu = menu;
			const max = kind === 'hour' ? 24 : 60;
			for (let value = 0; value < max; value++) {
				const selected = kind === 'hour' ? value === this.selectedHour : value === this.selectedMinute;
				const option = menu.createEl('button', {
					cls: 'dashboard-countdown-time-option' + (selected ? ' is-selected' : ''),
					text: String(value).padStart(2, '0'),
					attr: { type: 'button' },
				});
				option.addEventListener('click', event => {
					event.stopPropagation();
					if (kind === 'hour') {
						this.selectedHour = value;
						hourTrigger.setText(String(value).padStart(2, '0'));
					} else {
						this.selectedMinute = value;
						minuteTrigger.setText(String(value).padStart(2, '0'));
					}
					closeTimeMenu();
				});
			}
			trigger.setAttribute('aria-expanded', 'true');
		};
		hourTrigger.addEventListener('click', event => {
			event.stopPropagation();
			openTimeMenu('hour', hourTrigger);
		});
		minuteTrigger.addEventListener('click', event => {
			event.stopPropagation();
			openTimeMenu('minute', minuteTrigger);
		});

		btnRow.querySelector('.dashboard-modal-btn--confirm')!.addEventListener('click', (e) => {
			e.stopPropagation();
			this.selectedDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
			dateText.setText(this.selectedDate);
			this.closeCalendarPopup();
		});

		btnRow.querySelectorAll('button')[1]!.addEventListener('click', (e) => {
			e.stopPropagation();
			this.closeCalendarPopup();
		});

		renderCalendar();
		this.calendarPopup = popup;

		// Swallow mousedowns inside the popup so the document-level outside
		// click handler never sees them.
		popup.addEventListener('mousedown', (e) => e.stopPropagation());

		const outsideClick = (ev: MouseEvent) => {
			const rawTarget = ev.target as (EventTarget & { nodeType?: number; matches?: (selector: string) => boolean }) | null;
			const target = rawTarget && typeof rawTarget.nodeType === 'number' ? rawTarget as Node : null;
			// Native select dropdown layers can report detached or option
			// targets; never treat them as outside.
			if (rawTarget?.matches?.('select, option')) return;
			if (!popup.contains(target) && !anchor.contains(target)) {
				this.closeCalendarPopup();
			}
		};
		this.removeOutsideClickListener = () => popupDocument.removeEventListener('mousedown', outsideClick);
		popupWindow.setTimeout(() => {
			if (this.calendarPopup === popup) popupDocument.addEventListener('mousedown', outsideClick);
		}, 0);
	}
}
