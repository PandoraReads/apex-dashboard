import { App, Modal, Setting } from 'obsidian';
import { Solar, Lunar, LunarYear } from 'lunar-typescript';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { formatElapsed, parseAnniversaryDate } from './anniversary-widget';
import { WidgetBackgroundModal } from './widget-background';
import type { AnniversaryConfig } from './types';

/** Chinese lunar month names indexed by |lunar month| − 1, matching
 *  lunar-typescript's getMonthInChinese() (正,二,…,十,冬,腊). */
const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

/** Chinese lunar day names indexed by lunar day − 1, matching
 *  lunar-typescript's getDayInChinese() (verified exhaustively for a full
 *  leap year: 初一…初十, 十一…十九, 二十, 廿一…廿九, 三十). */
const LUNAR_DAY_NAMES = [
	'初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
	'十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
	'廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

/** lunar-typescript's supported range; entries outside are rejected. */
const LUNAR_YEAR_MIN = 1901;
const LUNAR_YEAR_MAX = 2099;

/** Create/edit one anniversary ("纪念日") entry: a historical date plus the
 *  elapsed display precision and the annual reminder switch. Edits stay local
 *  until Save commits them through onSave.
 *
 *  The date can be entered in the solar (default) or the lunar calendar. The
 *  stored `startDate` is always the SOLAR ISO date: a lunar entry converts to
 *  its solar equivalent on every select change (lossless — each solar date
 *  maps to exactly one lunar date, leap months included), so the preview, the
 *  widget and the reminder logic all keep reading the one field. */
export class AnniversarySettingsModal extends Modal {
	private readonly cfg: AnniversaryConfig;
	private readonly onSave: (cfg: AnniversaryConfig) => void;
	private preview: Setting | null = null;
	private dateSetting: Setting | null = null;
	private lunarSetting: Setting | null = null;
	// Lunar select state (authoritative while calendar === 'lunar').
	private lunarYear = 0;
	private lunarMonth = 1;
	private lunarDay = 1;
	private monthSelect: HTMLSelectElement | null = null;
	private daySelect: HTMLSelectElement | null = null;
	private yearInput: HTMLInputElement | null = null;

	constructor(app: App, cfg: AnniversaryConfig, onSave: (cfg: AnniversaryConfig) => void) {
		super(app);
		this.cfg = { ...cfg };
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const title = container.createDiv({ cls: 'dashboard-modal-title', text: t('anniversary.editTitle') });
		title.setCssProps({ fontSize: '1em' });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		new Setting(body)
			.setName(t('anniversary.label'))
			.setDesc(t('anniversary.labelDesc'))
			.addText(text => text
				.setPlaceholder(t('anniversary.labelPlaceholder'))
				.setValue(this.cfg.label)
				.onChange(v => { this.cfg.label = v.trim(); }));

		// Calendar system: solar keeps the native date picker; lunar swaps the
		// date row for lunar year/month/day selects (see the class doc).
		new Setting(body)
			.setName(t('anniversary.calendar'))
			.setDesc(t('anniversary.calendarDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('solar', t('anniversary.calendarSolar'))
				.addOption('lunar', t('anniversary.calendarLunar'))
				.setValue(this.cfg.calendar === 'lunar' ? 'lunar' : 'solar')
				.onChange(v => {
					this.cfg.calendar = v === 'lunar' ? 'lunar' : 'solar';
					if (this.cfg.calendar === 'lunar') this.readLunarFromStart();
					this.applyCalendarMode();
					this.updatePreview();
				}));

		// Solar entry (the historical default).
		this.dateSetting = new Setting(body)
			.setName(t('anniversary.startDate'))
			.setDesc(t('anniversary.startDateDesc'))
			.addText(text => {
				// Native date input: Obsidian's Chromium renders a real
				// calendar picker, localized by the OS, value always
				// YYYY-MM-DD. A hand-rolled time part (if ever present) is
				// preserved on top of the picked date.
				text.inputEl.type = 'date';
				text
					.setValue(this.cfg.startDate.split('T')[0] ?? '')
					.onChange(v => {
						const timePart = this.cfg.startDate.includes('T')
							? this.cfg.startDate.split('T')[1] : '';
						this.cfg.startDate = v ? `${v}${timePart ? 'T' + timePart : ''}` : '';
						this.updatePreview();
					});
			});
		this.dateSetting.settingEl.addClass('dashboard-anniversary-solar-setting');

		// Lunar entry: year input + month/day selects. Every change converts
		// the selection to its solar date and writes it into cfg.startDate.
		this.lunarSetting = new Setting(body)
			.setName(t('anniversary.lunarDate'))
			.setDesc(t('anniversary.lunarDateDesc'));
		this.lunarSetting.settingEl.addClass('dashboard-anniversary-lunar-setting');
		const row = this.lunarSetting.controlEl.createDiv({ cls: 'dashboard-anniversary-lunar-row' });
		this.yearInput = row.createEl('input', {
			cls: 'dashboard-anniversary-lunar-year',
			attr: { type: 'number', min: String(LUNAR_YEAR_MIN), max: String(LUNAR_YEAR_MAX) },
		});
		this.monthSelect = row.createEl('select', { cls: 'dashboard-anniversary-lunar-select' });
		this.daySelect = row.createEl('select', { cls: 'dashboard-anniversary-lunar-select' });
		this.readLunarFromStart();
		this.yearInput.value = String(this.lunarYear);
		this.yearInput.addEventListener('change', () => {
			const y = Math.floor(Number(this.yearInput!.value));
			if (!Number.isFinite(y) || y < LUNAR_YEAR_MIN || y > LUNAR_YEAR_MAX) {
				this.yearInput!.value = String(this.lunarYear);
				return;
			}
			this.lunarYear = y;
			this.renderMonthOptions();
			this.renderDayOptions();
			this.commitLunar();
		});
		this.renderMonthOptions();
		this.renderDayOptions();
		this.monthSelect.addEventListener('change', () => {
			this.lunarMonth = Number(this.monthSelect!.value) || 1;
			this.renderDayOptions();
			this.commitLunar();
		});
		this.daySelect.addEventListener('change', () => {
			this.lunarDay = Number(this.daySelect!.value) || 1;
			this.commitLunar();
		});
		this.applyCalendarMode();

		new Setting(body)
			.setName(t('anniversary.precision'))
			.setDesc(t('anniversary.precisionDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('ymd', t('anniversary.precisionYmd'))
				.addOption('days', t('anniversary.precisionDays'))
				.addOption('hours', t('anniversary.precisionHours'))
				.setValue(this.cfg.precision)
				.onChange(v => { this.cfg.precision = v as AnniversaryConfig['precision']; this.updatePreview(); }));

		new Setting(body)
			.setName(t('anniversary.annualReminder'))
			.setDesc(t('anniversary.annualReminderDesc'))
			.addToggle(toggle => toggle
				.setValue(this.cfg.annualReminder)
				.onChange(v => { this.cfg.annualReminder = v; }));

		// Card background: the nested modal edits this.cfg.background in
		// place (cfg is a local copy); the parent Save commits it with the
		// rest of the entry.
		new Setting(body)
			.setName(t('wbg.set'))
			.setDesc(this.cfg.background?.image ?? '')
			.addButton(btn => btn
				.setButtonText(this.cfg.background ? t('common.edit') : t('wbg.set'))
				.onClick(() => {
					new WidgetBackgroundModal(this.app, this.cfg.background, (bg) => {
						this.cfg.background = bg;
					}).open();
				}));

		// Live preview of the widget's value line for the current inputs.
		this.preview = new Setting(body)
			.setName(t('anniversary.preview'))
			.setDesc('--');
		this.updatePreview();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			text: t('common.save'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		}).addEventListener('click', () => {
			this.close();
			this.onSave(this.cfg);
		});
	}

	/** Show only the date row matching the picked calendar system. */
	private applyCalendarMode(): void {
		const lunar = this.cfg.calendar === 'lunar';
		this.dateSetting?.settingEl.toggleClass('is-hidden', lunar);
		this.lunarSetting?.settingEl.toggleClass('is-hidden', !lunar);
	}

	/** Seed the lunar select state from the current solar startDate (today
	 *  when unset/invalid), so switching to lunar continues from the same day. */
	private readLunarFromStart(): void {
		const src = parseAnniversaryDate(this.cfg.startDate) ?? new Date();
		try {
			const lunar = Solar.fromYmd(src.getFullYear(), src.getMonth() + 1, src.getDate()).getLunar();
			this.lunarYear = lunar.getYear();
			this.lunarMonth = lunar.getMonth();
			this.lunarDay = lunar.getDay();
		} catch {
			const now = Solar.fromDate(new Date()).getLunar();
			this.lunarYear = now.getYear();
			this.lunarMonth = now.getMonth();
			this.lunarDay = now.getDay();
		}
		this.yearInput!.value = String(this.lunarYear);
		this.renderMonthOptions();
		this.renderDayOptions();
	}

	/** Month options: the lunar year's own months in lunar order (leap month
	 *  in its calendar position, value negative per lunar-typescript). */
	private renderMonthOptions(): void {
		const select = this.monthSelect!;
		select.empty();
		let months: Array<{ month: number; dayCount: number }> = [];
		try {
			months = LunarYear.fromYear(this.lunarYear).getMonths()
				.filter(m => m.getYear() === this.lunarYear)
				.map(m => ({ month: m.getMonth(), dayCount: m.getDayCount() }));
		} catch {
			months = [];
		}
		if (months.length === 0) {
			// Out-of-range year (guarded above) or library hiccup: plain 1..12.
			for (let m = 1; m <= 12; m++) months.push({ month: m, dayCount: 30 });
		}
		// Keep a valid selection when the year changed under it (e.g. a leap
		// month that the new year doesn't have rolls onto its base month).
		if (!months.some(m => m.month === this.lunarMonth)) {
			this.lunarMonth = Math.abs(this.lunarMonth);
			if (!months.some(m => m.month === this.lunarMonth)) this.lunarMonth = months[0]!.month;
		}
		for (const { month } of months) {
			const label = (month < 0 ? '闰' : '') + LUNAR_MONTH_NAMES[Math.abs(month) - 1] + t('anniversary.monthSuffix');
			const opt = select.createEl('option', { text: label, attr: { value: String(month) } });
			if (month === this.lunarMonth) opt.selected = true;
		}
	}

	/** Day options: the selected lunar month's actual length (29 or 30). */
	private renderDayOptions(): void {
		const select = this.daySelect!;
		select.empty();
		let dayCount = 30;
		try {
			const m = LunarYear.fromYear(this.lunarYear).getMonths()
				.find(m => m.getYear() === this.lunarYear && m.getMonth() === this.lunarMonth);
			if (m) dayCount = m.getDayCount();
		} catch {
			// fall through with 30
		}
		this.lunarDay = Math.min(this.lunarDay, dayCount);
		for (let d = 1; d <= dayCount; d++) {
			const opt = select.createEl('option', { text: LUNAR_DAY_NAMES[d - 1]!, attr: { value: String(d) } });
			if (d === this.lunarDay) opt.selected = true;
		}
	}

	/** Convert the lunar selection to its solar date and store it as the
	 *  (always-solar) startDate. An impossible combination (三十一 aside, the
	 *  clamps above prevent most) keeps the last valid startDate. */
	private commitLunar(): void {
		try {
			const solar = Lunar.fromYmd(this.lunarYear, this.lunarMonth, this.lunarDay).getSolar();
			const pad = (n: number) => String(n).padStart(2, '0');
			this.cfg.startDate = `${solar.getYear()}-${pad(solar.getMonth())}-${pad(solar.getDay())}`;
		} catch {
			// keep the previous valid conversion
		}
		this.updatePreview();
	}

	private updatePreview(): void {
		if (!this.preview) return;
		const start = parseAnniversaryDate(this.cfg.startDate);
		this.preview.setDesc(start
			? formatElapsed(start, new Date(), this.cfg.precision)
			: t('anniversary.invalidDate'));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
