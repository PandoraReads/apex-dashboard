import { App, Modal } from 'obsidian';
import type { CountdownConfig } from './types';
import { t, getLanguage } from './i18n';

export class CountdownSettingsModal extends Modal {
	private config: CountdownConfig;
	private onSave: (config: CountdownConfig) => void;
	private calendarPopup: HTMLElement | null = null;
	private selectedDate: string;
	private selectedHour: number;
	private selectedMinute: number;

	constructor(app: App, config: CountdownConfig, onSave: (config: CountdownConfig) => void) {
		super(app);
		this.config = { ...config };
		this.onSave = onSave;

		// Parse existing value: "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD"
		const raw = config.targetDate;
		if (raw.includes('T')) {
			const parts = raw.split('T');
			this.selectedDate = parts[0] ?? '';
			const [h, m] = (parts[1] ?? '0:0').split(':').map(Number);
			this.selectedHour = h ?? 0;
			this.selectedMinute = m ?? 0;
		} else if (raw) {
			this.selectedDate = raw;
			this.selectedHour = 0;
			this.selectedMinute = 0;
		} else {
			const now = new Date();
			this.selectedDate = '';
			this.selectedHour = now.getHours();
			this.selectedMinute = now.getMinutes();
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('dashboard-modal');
		contentEl.createEl('h2', { text: t('countdown.settingsTitle') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// Date row with calendar picker
		const dateRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		dateRow.createEl('label', { text: t('countdown.targetDate'), cls: 'dashboard-modal-countdown-label' });

		const dateTrigger = dateRow.createDiv({ cls: 'dashboard-modal-input dashboard-countdown-date-trigger' });
		const dateText = dateTrigger.createSpan({ text: this.selectedDate || t('countdown.setTarget') });
		dateTrigger.createSpan({ cls: 'dashboard-countdown-date-icon', text: ' \u{1F4C5}' });

		dateTrigger.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showCalendarPopup(dateTrigger, dateText);
		});

		// Time row with hour/minute selects
		const timeRow = form.createDiv({ cls: 'dashboard-modal-countdown-row' });
		timeRow.createEl('label', { text: t('countdown.targetTime'), cls: 'dashboard-modal-countdown-label' });

		const timeWrap = timeRow.createDiv({ cls: 'dashboard-countdown-time-wrap' });

		const hourSelect = timeWrap.createEl('select', { cls: 'dashboard-countdown-time-select' });
		for (let h = 0; h < 24; h++) {
			const opt = hourSelect.createEl('option', { text: String(h).padStart(2, '0'), attr: { value: String(h) } });
			if (h === this.selectedHour) opt.selected = true;
		}

		timeWrap.createSpan({ cls: 'dashboard-countdown-time-sep', text: ':' });

		const minuteSelect = timeWrap.createEl('select', { cls: 'dashboard-countdown-time-select' });
		for (let m = 0; m < 60; m += 5) {
			const opt = minuteSelect.createEl('option', { text: String(m).padStart(2, '0'), attr: { value: String(m) } });
			if (m === this.selectedMinute) opt.selected = true;
		}
		// Also add exact minute if not a multiple of 5
		if (this.selectedMinute % 5 !== 0) {
			const opt = minuteSelect.createEl('option', { text: String(this.selectedMinute).padStart(2, '0'), attr: { value: String(this.selectedMinute) } });
			opt.selected = true;
		}

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

		// Actions
		const actions = form.createDiv({ cls: 'dashboard-modal-actions' });
		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			const h = parseInt(hourSelect.value, 10);
			const m = parseInt(minuteSelect.value, 10);
			const dateTime = this.selectedDate
				? `${this.selectedDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.closeCalendarPopup();
		const { contentEl } = this;
		contentEl.empty();
	}

	private closeCalendarPopup(): void {
		if (this.calendarPopup) {
			this.calendarPopup.remove();
			this.calendarPopup = null;
		}
	}

	private showCalendarPopup(anchor: HTMLElement, dateText: HTMLElement): void {
		this.closeCalendarPopup();

		const popup = activeDocument.body.createDiv({ cls: 'dashboard-task-reminder-popup dashboard-countdown-calendar-popup' });

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
		const lang = getLanguage();
		const dayNames = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

		const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
		const prevBtn = calNav.createEl('button', { text: '<' });
		const monthLabel = calNav.createSpan();
		const nextBtn = calNav.createEl('button', { text: '>' });

		const calGrid = popup.createDiv({ cls: 'dashboard-task-reminder-calendar' });

		const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
		btnRow.createEl('button', { cls: 'mod-cta', text: t('common.save') });
		btnRow.createEl('button', { text: t('common.cancel') });

		const renderCalendar = () => {
			calGrid.empty();
			const y = viewYear.value;
			const m = viewMonth.value;
			monthLabel.setText(`${y}-${String(m + 1).padStart(2, '0')}`);

			for (const d of dayNames) {
				calGrid.createDiv({ cls: 'dashboard-task-reminder-calendar-header', text: d });
			}

			const firstDay = new Date(y, m, 1).getDay();
			const daysInMonth = new Date(y, m + 1, 0).getDate();
			const daysInPrev = new Date(y, m, 0).getDate();
			const today = new Date();
			const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

			for (let i = firstDay - 1; i >= 0; i--) {
				const d = daysInPrev - i;
				calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
			}

			for (let d = 1; d <= daysInMonth; d++) {
				const cls = ['dashboard-task-reminder-calendar-day'];
				if (isCurrentMonth && d === today.getDate()) cls.push('dashboard-task-reminder-calendar-day--today');
				if (y === selectedYear && m === selectedMonth && d === selectedDay) cls.push('dashboard-task-reminder-calendar-day--selected');
				const dayBtn = calGrid.createEl('button', { cls: cls.join(' '), text: String(d) });
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
				calGrid.createEl('button', { cls: 'dashboard-task-reminder-calendar-day dashboard-task-reminder-calendar-day--other-month', text: String(d) });
			}
		};

		prevBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			viewMonth.value--;
			if (viewMonth.value < 0) { viewMonth.value = 11; viewYear.value--; }
			renderCalendar();
		});

		nextBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			viewMonth.value++;
			if (viewMonth.value > 11) { viewMonth.value = 0; viewYear.value++; }
			renderCalendar();
		});

		btnRow.querySelector('.mod-cta')!.addEventListener('click', (e) => {
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

		const outsideClick = (ev: MouseEvent) => {
			if (!popup.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) {
				this.closeCalendarPopup();
				activeDocument.removeEventListener('mousedown', outsideClick);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('mousedown', outsideClick), 0);
	}
}
