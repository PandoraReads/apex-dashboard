import { Solar } from 'lunar-typescript';
import { fetchHolidayData, getHolidayForDate, type HolidayInfo } from './holiday-service';
import { getTodayAlmanac } from './lunar-almanac';
import { getLanguage } from './i18n';
import type { App } from 'obsidian';
import { FortuneStickModal } from './fortune-stick-modal';

export interface LunarWidgetData {
	lunarDate: string;
	ganZhiYear: string;
	zodiac: string;
	ganZhiMonth: string;
	ganZhiDay: string;
	jieQi: string;
	festivals: string[];
	holiday: HolidayInfo | null;
	almanac: string;
}

export function computeLunarData(date: Date, holidayData: Record<string, HolidayInfo>): LunarWidgetData {
	const solar = Solar.fromDate(date);
	const lunar = solar.getLunar();

	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const dateStr = `${y}-${m}-${d}`;

	const festivals = [
		...lunar.getFestivals(),
		...solar.getFestivals(),
		...lunar.getOtherFestivals(),
	].filter((v, i, a) => a.indexOf(v) === i);

	return {
		lunarDate: formatLunarDate(lunar),
		ganZhiYear: lunar.getYearInGanZhi(),
		zodiac: lunar.getYearShengXiao(),
		ganZhiMonth: lunar.getMonthInGanZhi(),
		ganZhiDay: lunar.getDayInGanZhi(),
		jieQi: lunar.getJieQi() ?? '',
		festivals: festivals.filter((v, i, a) => a.indexOf(v) === i),
		holiday: getHolidayForDate(dateStr, holidayData),
		almanac: getTodayAlmanac(),
	};
}

function formatLunarDate(lunar: import('lunar-typescript').Lunar): string {
	const month = lunar.getMonthInChinese();
	const day = lunar.getDayInChinese();
	const isLeap = lunar.getMonth() < 0;
	return (isLeap ? '闰' : '') + month + '月' + day;
}

export function renderSidebarLunarWidget(
	container: HTMLElement,
	holidayData: Record<string, HolidayInfo>,
	app?: App,
): void {
	const now = new Date();
	let data: LunarWidgetData;
	try {
		data = computeLunarData(now, holidayData);
	} catch {
		return;
	}
	const lang = getLanguage();
	const isZh = lang === 'zh';

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-lunar' });

	// Fortune stick button (top-left)
	const fortuneBtn = widget.createDiv({ cls: 'dashboard-sidebar-lunar-fortune-btn' });
	fortuneBtn.setText('\u{1F390}');
	fortuneBtn.addEventListener('click', () => {
		if (app) {
			const modal = new FortuneStickModal();
			modal.open();
		}
	});

	const header = widget.createDiv({ cls: 'dashboard-sidebar-lunar-header' });

	const meta = header.createDiv({ cls: 'dashboard-sidebar-lunar-meta' });
	meta.createSpan({ cls: 'dashboard-sidebar-lunar-ganzhi', text: `${data.ganZhiYear}年` });
	meta.createSpan({ cls: 'dashboard-sidebar-lunar-zodiac', text: data.zodiac });
	meta.createSpan({ cls: 'dashboard-sidebar-lunar-ganzhi', text: `${data.ganZhiMonth}月 ${data.ganZhiDay}日` });

	if (data.jieQi) {
		meta.createSpan({ cls: 'dashboard-sidebar-lunar-jieqi', text: data.jieQi });
	}

	const dateEl = header.createDiv({ cls: 'dashboard-sidebar-lunar-date' });
	dateEl.createSpan({ text: data.lunarDate });

	if (data.holiday && data.holiday.holiday) {
		dateEl.createDiv({
			cls: 'dashboard-sidebar-lunar-badge dashboard-sidebar-lunar-badge--holiday dashboard-sidebar-lunar-badge--inline',
			text: data.holiday.name || (isZh ? '节假日' : 'Holiday'),
		});
	}

	if (data.holiday && data.holiday.type === 3) {
		dateEl.createDiv({
			cls: 'dashboard-sidebar-lunar-badge dashboard-sidebar-lunar-badge--work dashboard-sidebar-lunar-badge--inline',
			text: isZh ? '补班' : 'Makeup work',
		});
	}

	const isWeekend = now.getDay() === 0 || now.getDay() === 6;
	if (!data.holiday && isWeekend) {
		dateEl.createDiv({
			cls: 'dashboard-sidebar-lunar-badge dashboard-sidebar-lunar-badge--weekend dashboard-sidebar-lunar-badge--inline',
			text: isZh ? '周末' : 'Weekend',
		});
	}

	for (const f of data.festivals.slice(0, 2)) {
		dateEl.createDiv({
			cls: 'dashboard-sidebar-lunar-badge dashboard-sidebar-lunar-badge--festival dashboard-sidebar-lunar-badge--inline',
			text: f,
		});
	}

	const almanacEl = widget.createDiv({ cls: 'dashboard-sidebar-lunar-almanac' });
	const commaIndex = data.almanac.indexOf('，');
	if (commaIndex !== -1) {
		almanacEl.createSpan({ cls: 'dashboard-sidebar-lunar-almanac-text', text: data.almanac.slice(0, commaIndex + 1) });
		almanacEl.createEl('br');
		almanacEl.createSpan({ cls: 'dashboard-sidebar-lunar-almanac-text', text: data.almanac.slice(commaIndex + 1) });
	} else {
		almanacEl.createSpan({ cls: 'dashboard-sidebar-lunar-almanac-text', text: data.almanac });
	}
}

export async function loadHolidayData(app: App): Promise<Record<string, HolidayInfo>> {
	const year = new Date().getFullYear();
	return fetchHolidayData(app, year);
}
