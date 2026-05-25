import { App, setIcon } from 'obsidian';
import type { DashboardData, DashboardColumn, DashboardCard, RenderCallbacks, TaskItem, DashboardSettings, CardSize, TrackerStyle } from './types';
import { t, getLanguage } from './i18n';
import { resolveVaultImage } from './banner';
import { attachFileSuggest } from './file-suggest';
import { showConfirmDialog } from './confirm-dialog';
import { fetchWeather, getCachedWeather, getWeatherEmoji, getWeatherDescription } from './weather-service';
import { readTrackerData } from './tracker-service';
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip);

const chartInstances = new Map<string, Chart>();

function destroyChart(cardId: string): void {
	const chart = chartInstances.get(cardId);
	if (chart) {
		chart.destroy();
		chartInstances.delete(cardId);
	}
}

export function destroyAllCharts(): void {
	for (const [, chart] of chartInstances) {
		chart.destroy();
	}
	chartInstances.clear();
}

function getCSSVar(name: string): string {
	const el = document.querySelector('.dashboard-root');
	if (!el) return '';
	return getComputedStyle(el).getPropertyValue(name).trim();
}

let taskDragSource: { cardId: string; taskIndex: number } | null = null;
let docDragSource: { cardId: string; docIndex: number } | null = null;

const VAULT_FILE_EXTS = new Set(['md', 'pdf', 'canvas', 'base', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'mp3', 'mp4', 'm4a', 'm4b', 'mov', 'mkv', 'avi']);

function getSearchableFiles(app: App) {
	return app.vault.getFiles()
		.filter(f => !f.path.startsWith('.') && VAULT_FILE_EXTS.has(f.extension));
}

// ===== Sidebar Widget Rendering =====

export function renderSidebarWeekCalendar(container: HTMLElement): void {
	const now = new Date();
	const today = now.getDay();
	const mondayOffset = today === 0 ? -6 : 1 - today;
	const monday = new Date(now);
	monday.setDate(now.getDate() + mondayOffset);

	const lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
	const row = container.createDiv({ cls: 'dashboard-sidebar-week-calendar' });

	for (let i = 0; i < 7; i++) {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		const isToday = d.toDateString() === now.toDateString();

		const cell = row.createDiv({
			cls: 'dashboard-sidebar-week-cell' + (isToday ? ' dashboard-sidebar-week-cell--today' : ''),
		});
		cell.createDiv({
			cls: 'dashboard-sidebar-week-day',
			text: d.toLocaleDateString(lang, { weekday: 'narrow' }),
		});
		cell.createDiv({
			cls: 'dashboard-sidebar-week-date',
			text: String(d.getDate()),
		});
	}
}

export function renderSidebarWidgets(
	container: HTMLElement,
	settings: import('./types').DashboardSettings,
	app: App,
): void {
	const theme = settings.widgetTheme;
	if (theme === 'off') return;

	const widgetArea = container.createDiv({ cls: 'dashboard-sidebar-widgets' });

	if (theme === 'weather' || theme === 'weather-heatmap') {
		renderSidebarWeather(widgetArea, settings, app);
	}

	if (theme === 'weather-heatmap') {
		renderSidebarHeatmap(widgetArea, settings, app);
	}
}

function renderSidebarWeather(container: HTMLElement, settings: import('./types').DashboardSettings, app: App): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-weather' });
	const cityName = settings.widgetWeatherCity || '';

	widget.createDiv({ cls: 'dashboard-sidebar-weather-loading', text: '...' });

	const config = {
		latitude: settings.widgetWeatherLat || 31.23,
		longitude: settings.widgetWeatherLon || 121.47,
		cityName: cityName || 'Shanghai',
	};

	const cached = getCachedWeather(config);
	if (cached) {
		widget.empty();
		renderSidebarWeatherContent(widget, cached, config.cityName);
		return;
	}

	fetchWeather(config).then(data => {
		widget.empty();
		renderSidebarWeatherContent(widget, data, config.cityName);
	}).catch(() => {
		widget.empty();
		widget.createDiv({ cls: 'dashboard-sidebar-weather-error', text: '--' });
	});
}

function renderSidebarWeatherContent(el: HTMLElement, data: import('./types').WeatherData, cityName: string): void {
	const top = el.createDiv({ cls: 'dashboard-sidebar-weather-top' });
	top.createDiv({ cls: 'dashboard-sidebar-weather-icon', text: getWeatherEmoji(data.weatherCode) });
	const tempWrap = top.createDiv({ cls: 'dashboard-sidebar-weather-temp-wrap' });
	tempWrap.createDiv({ cls: 'dashboard-sidebar-weather-temp', text: `${Math.round(data.temperature)}°` });

	const info = el.createDiv({ cls: 'dashboard-sidebar-weather-info' });
	info.createDiv({ cls: 'dashboard-sidebar-weather-city', text: cityName });
	const descLine = info.createDiv({ cls: 'dashboard-sidebar-weather-desc-line' });
	descLine.createSpan({ cls: 'dashboard-sidebar-weather-desc', text: getWeatherDescription(data.weatherCode) });

	const details = el.createDiv({ cls: 'dashboard-sidebar-weather-details' });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${t('weather.feelsLike') ?? 'Feels like'} ${Math.round(data.feelsLike)}°` });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${t('weather.humidity') ?? 'Humidity'} ${Math.round(data.humidity)}%` });
	details.createDiv({ cls: 'dashboard-sidebar-weather-detail', text: `${Math.round(data.windSpeed)} km/h` });

	if (data.dailyDates.length > 1) {
		const forecast = el.createDiv({ cls: 'dashboard-sidebar-weather-forecast' });
		const count = Math.min(data.dailyDates.length, 5);
		for (let i = 0; i < count; i++) {
			const day = forecast.createDiv({ cls: 'dashboard-sidebar-weather-fday' });
			const d = new Date(data.dailyDates[i]! + 'T00:00:00');
			const dayName = d.toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short' });
			day.createDiv({ cls: 'dashboard-sidebar-weather-fday-name', text: i === 0 ? t('weather.today') ?? 'Today' : dayName });
			day.createDiv({ cls: 'dashboard-sidebar-weather-fday-icon', text: getWeatherEmoji(data.dailyCodes[i]!) });
			const temps = day.createDiv({ cls: 'dashboard-sidebar-weather-fday-temps' });
			temps.createSpan({ cls: 'dashboard-sidebar-weather-fday-high', text: `${Math.round(data.dailyMax[i]!)}°` });
			temps.createSpan({ cls: 'dashboard-sidebar-weather-fday-low', text: `${Math.round(data.dailyMin[i]!)}°` });
		}
	}
}

function renderSidebarHeatmap(container: HTMLElement, settings: import('./types').DashboardSettings, app: App): void {
	if (!settings.widgetTrackerKey) return;

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-heatmap' });

	const data = readTrackerData(app, settings.journalPath ?? '', settings.widgetTrackerKey, settings.widgetTrackerDays);
	const validPoints = data.filter(p => p.value !== null);

	if (validPoints.length === 0) return;

	const values = data.map(p => p.value);
	const minVal = Math.min(...values.filter((v): v is number => v !== null));
	const maxVal = Math.max(...values.filter((v): v is number => v !== null));
	const accentColor = getCSSVar('--db-accent') || '#6366f1';

	const firstDate = data[0] ? new Date(data[0].date + 'T00:00:00') : new Date();
	const startDayOfWeek = firstDate.getDay();
	const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

	const weeks: (import('./types').TrackerDataPoint | null)[][] = [];
	let currentWeek: (import('./types').TrackerDataPoint | null)[] = [];
	for (let i = 0; i < mondayOffset; i++) {
		currentWeek.push(null);
	}
	for (const point of data) {
		currentWeek.push(point);
		if (currentWeek.length === 7) {
			weeks.push(currentWeek);
			currentWeek = [];
		}
	}
	if (currentWeek.length > 0) {
		weeks.push(currentWeek);
	}

	const visibleWeeks = weeks.slice(-20);
	const range = maxVal - minVal || 1;

	const grid = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-grid' });
	grid.style.display = 'grid';
	grid.style.gridTemplateColumns = `repeat(${visibleWeeks.length}, 8px)`;
	grid.style.gridTemplateRows = 'repeat(7, 8px)';
	grid.style.gap = '2px';

	for (const week of visibleWeeks) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const point = week[dayIdx] ?? null;
			const cell = grid.createDiv({ cls: 'dashboard-sidebar-heatmap-cell' });
			cell.style.width = '8px';
			cell.style.height = '8px';
			cell.style.borderRadius = '2px';

			if (point === null || point.value === null) {
				cell.addClass('dashboard-sidebar-heatmap-cell--empty');
			} else {
				const intensity = (point.value - minVal) / range;
				cell.style.backgroundColor = accentColor;
				cell.style.opacity = String(0.15 + intensity * 0.85);
				cell.title = `${point.date}: ${point.value}`;
			}
		}
	}

	// Mini stats
	const summaryMode = settings.widgetTrackerSummary ?? 'streak';
	if (summaryMode === 'off') return;

	let streak = 0;
	for (let i = validPoints.length - 1; i >= 0; i--) {
		if (validPoints[i]!.value !== null) streak++;
		else break;
	}
	const completionRate = Math.round((validPoints.length / data.length) * 100);

	const stats = widget.createDiv({ cls: 'dashboard-sidebar-heatmap-stats' });

	if (summaryMode === 'streak' || summaryMode === 'both') {
		const streakEl = stats.createSpan({ cls: 'dashboard-sidebar-heatmap-summary' });
		streakEl.createSpan({ cls: 'dashboard-sidebar-heatmap-icon', text: '⚡' });
		streakEl.createSpan({ text: t('heatmap.streak', { count: streak }) });
	}
	if (summaryMode === 'rate' || summaryMode === 'both') {
		const rateEl = stats.createSpan({ cls: 'dashboard-sidebar-heatmap-summary' });
		rateEl.createSpan({ cls: 'dashboard-sidebar-heatmap-icon', text: '✅' });
		rateEl.createSpan({ text: t('heatmap.rate', { rate: completionRate }) });
	}
}


export function renderDashboard(
	container: HTMLElement,
	data: DashboardData,
	callbacks: RenderCallbacks,
	app: App,
	settings?: DashboardSettings,
): void {
	container.empty();
	container.addClass('dashboard-kanban');

	for (const column of data.columns) {
		const section = renderSection(column, callbacks, app, data, settings);
		container.appendChild(section);
	}

	const addColBtn = container.createDiv({ cls: 'dashboard-add-section' });
	addColBtn.setText(t('renderer.addSection'));
	addColBtn.setAttribute('role', 'button');
	addColBtn.addEventListener('click', () => {
		if (addColBtn.querySelector('input')) return;
		addColBtn.empty();

		let selectedType = 'projects';

		const row = addColBtn.createDiv({ cls: 'dashboard-add-section-row' });

		const input = row.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('renderer.sectionName') },
		});

		const typePicker = row.createDiv({ cls: 'dashboard-section-type-picker' });
		const typeOptions = [
			{ value: 'projects', label: t('renderer.typeNotes') },
			{ value: 'todo', label: t('renderer.typeTodo') },
			{ value: 'memo', label: t('renderer.typeMemo') },
			{ value: 'notes', label: t('renderer.typeNotesPlain') },
		];

		for (const opt of typeOptions) {
			const btn = typePicker.createEl('button', {
				cls: 'dashboard-section-type-btn' + (opt.value === selectedType ? ' active' : ''),
				text: opt.label,
				attr: { 'data-type': opt.value },
			});
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
			});
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				selectedType = opt.value;
				typePicker.querySelectorAll('.dashboard-section-type-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		const confirmBtn = row.createEl('button', {
			cls: 'dashboard-section-confirm-btn',
			attr: { 'aria-label': t('common.save') },
		});
		setIcon(confirmBtn, 'check');
		confirmBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			finish();
		});

		const finish = () => {
			const name = input.value.trim();
			input.value = '';
			if (name) {
				callbacks.onColumnAdd(name, selectedType);
			}
			addColBtn.empty();
			addColBtn.setText(t('renderer.addSection'));
		};

		input.addEventListener('input', () => {
			const name = input.value.trim().toLowerCase();
			if (name === 'memo') {
				selectedType = 'memo';
			} else if (name === 'todo') {
				selectedType = 'todo';
			} else {
				return;
			}
			typePicker.querySelectorAll('.dashboard-section-type-btn').forEach(b => {
				b.toggleClass('active', b.getAttribute('data-type') === selectedType);
			});
		});

		input.addEventListener('keydown', (ke) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish();
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				addColBtn.empty();
				addColBtn.setText(t('renderer.addSection'));
			}
		});

		input.focus();
	});
}

const COLLAPSED_KEY = 'apex-dashboard-collapsed';

function getCollapsedSections(): Set<string> {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (!raw) return new Set();
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return new Set();
	}
}

function saveCollapsedSections(collapsed: Set<string>): void {
	localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

function renderSection(column: DashboardColumn, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): HTMLElement {
	const el = document.createElement('div');
	el.addClass('dashboard-section-row');
	el.dataset.column = column.name;
	const sectionType = getSectionType(column);
	el.dataset.sectionType = sectionType;

	const collapsed = getCollapsedSections();
	if (collapsed.has(column.name)) {
		el.addClass('dashboard-section-row--collapsed');
	}

	const header = el.createDiv({ cls: 'dashboard-section-header' });

	const titleWrap = header.createDiv({ cls: 'dashboard-section-title-wrap' });
	const toggle = titleWrap.createDiv({ cls: 'dashboard-section-toggle' });
	toggle.setAttribute('role', 'button');
	toggle.setAttribute('aria-label', 'Toggle section');
	const titleEl = titleWrap.createEl('h3', { text: column.name, cls: 'dashboard-section-title' });

	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const currentName = titleEl.getText();
		titleEl.empty();
		const input = titleEl.createEl('input', {
			cls: 'dashboard-section-rename-input',
			attr: { type: 'text', value: currentName },
		});
		input.focus();
		input.select();

		const finish = (save: boolean) => {
			const newName = input.value.trim();
			if (save && newName && newName !== currentName) {
				callbacks.onColumnRename(currentName, newName);
			} else {
				titleEl.empty();
				titleEl.setText(currentName);
			}
		};

		input.addEventListener('keydown', (ke) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});

		input.addEventListener('blur', () => {
			finish(true);
		});
	});
	titleEl.style.cursor = 'pointer';

	toggle.addEventListener('click', (e) => {
		e.stopPropagation();
		const isNowCollapsed = el.hasClass('dashboard-section-row--collapsed');
		if (isNowCollapsed) {
			el.removeClass('dashboard-section-row--collapsed');
			collapsed.delete(column.name);
		} else {
			el.addClass('dashboard-section-row--collapsed');
			collapsed.add(column.name);
		}
		saveCollapsedSections(collapsed);
	});

	const headerActions = header.createDiv({ cls: 'dashboard-section-header-actions' });

	if (sectionType === 'todo') {
		const templateBtn = headerActions.createEl('button', {
			cls: 'dashboard-section-add-btn',
			attr: { 'aria-label': t('template.addFromTemplate') },
		});
		setIcon(templateBtn, 'layout-template');
		templateBtn.addEventListener('click', () => callbacks.onAddFromTemplate(column.name));
	}

	const addCardBtn = headerActions.createEl('button', {
		cls: 'dashboard-section-add-btn',
		attr: { 'aria-label': t('renderer.addCardTo', { column: column.name }) },
	});
	setIcon(addCardBtn, 'plus');
	addCardBtn.addEventListener('click', () => callbacks.onCardAdd(column.name));

	const deleteBtn = headerActions.createEl('button', {
		cls: 'dashboard-section-add-btn dashboard-section-delete-btn',
		attr: { 'aria-label': t('renderer.deleteSection', { column: column.name }) },
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onColumnDelete(column.name);
	});

	const cardsContainer = el.createDiv({ cls: 'dashboard-section-cards' });

	for (const card of column.cards) {
		try {
			const cardEl = renderCard(card, column.name, sectionType, callbacks, app, data, settings);
			cardsContainer.appendChild(cardEl);
		} catch (err) {
			console.error('[Dashboard] renderCard error:', card.id, card.type, err);
		}
	}

	return el;
}

function renderCard(card: DashboardCard, columnName: string, sectionType: string, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): HTMLElement {
	const el = document.createElement('div');
	el.addClass('dashboard-card', `dashboard-card--${card.type}`);
	el.dataset.cardId = card.id;
	el.dataset.cardType = card.type;
	el.setAttribute('role', 'article');
	el.setAttribute('aria-label', card.title);

	if (card.color) {
		el.dataset.hasColor = 'true';
		el.style.setProperty('--db-card-accent', card.color);
	}

	const isMemo = sectionType === 'memo';
	const isTask = card.type === 'task' || sectionType === 'todo';
	const isWeather = card.type === 'weather';
	const isTracker = card.type === 'tracker';
	const isWidget = isWeather || isTracker;
	const isProjectLike = !isMemo && !isTask && !isWidget;
	const isDashboardSection = sectionType === 'dashboard';
	const showCover = isProjectLike && !isDashboardSection && sectionType !== 'notes';

	if (card.coverImage && showCover) {
		const resolved = resolveVaultImage(app, card.coverImage);
		if (resolved) {
			const cover = el.createDiv({ cls: 'dashboard-project-cover' });
			cover.style.backgroundImage = `url("${resolved}")`;
			cover.setAttribute('draggable', 'true');
		} else {
			const cover = el.createDiv({ cls: 'dashboard-project-cover dashboard-project-cover--default' });
			cover.setAttribute('draggable', 'true');
		}
	} else if (showCover) {
		const cover = el.createDiv({ cls: 'dashboard-project-cover dashboard-project-cover--default' });
		cover.setAttribute('draggable', 'true');
	}

	const header = el.createDiv({ cls: 'dashboard-card-header' });
	header.setAttribute('draggable', 'true');

	// Mobile: tap header to toggle card action buttons
	header.addEventListener('touchstart', () => {
		const wasActive = header.hasClass('dashboard-card-header--touched');
		document.querySelectorAll('.dashboard-card-header--touched').forEach(el => {
			el.removeClass('dashboard-card-header--touched');
		});
		if (!wasActive) {
			header.addClass('dashboard-card-header--touched');
		}
	}, { passive: true });

	const titleEl = header.createEl('h4', { text: card.title, cls: 'dashboard-card-title' });

	const skipEditBtn = isMemo || isTask || (isWidget && isDashboardSection);

	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		const currentTitle = titleEl.getText();
		titleEl.empty();
		const input = titleEl.createEl('input', {
			cls: 'dashboard-title-edit-input',
			attr: { type: 'text', value: currentTitle },
		});
		input.focus();
		input.select();

		const finish = (save: boolean) => {
			const newTitle = input.value.trim();
			if (save && newTitle && newTitle !== currentTitle) {
				callbacks.onCardTitleEdit(card.id, newTitle);
			} else {
				titleEl.empty();
				titleEl.setText(currentTitle);
			}
		};

		input.addEventListener('keydown', (ke) => {
			if (ke.key === 'Enter') {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});

		input.addEventListener('blur', () => {
			finish(true);
		});
	});
	titleEl.style.cursor = 'pointer';

	const actions = header.createDiv({ cls: 'dashboard-card-actions' });

	// Dashboard grid layout for widget cards
	if (isWidget && isDashboardSection) {
		const currentSize: CardSize = card.size || 'M';
		const sizeToGrid: Record<CardSize, { cols: number; rows: number }> = {
			S: { cols: 1, rows: 1 },
			M: { cols: 2, rows: 1 },
			L: { cols: 2, rows: 2 },
		};
		const grid = sizeToGrid[currentSize];
		el.style.gridColumn = `span ${grid.cols}`;
		el.style.gridRow = `span ${grid.rows}`;

		// Size selector button for dashboard widgets only
		const sizeBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn dashboard-card-btn--size',
			attr: { 'aria-label': 'Card size' },
		});
		sizeBtn.setText(t('widget.size' + currentSize));
		sizeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const sizes: CardSize[] = ['S', 'M', 'L'];
			const nextIdx = (sizes.indexOf(currentSize) + 1) % sizes.length;
			const nextSize = sizes[nextIdx]!;
			callbacks.onCardSizeChange(card.id, nextSize);
		});
	}

	if (isMemo && (card.type === 'generic' || card.type === 'note') || isWidget) {
		const colorBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn dashboard-card-btn--color',
			attr: { 'aria-label': t('renderer.setMemoColor') },
		});
		setIcon(colorBtn, 'palette');
		if (card.color) {
			colorBtn.style.color = card.color;
		}
		colorBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const input = document.createElement('input');
			input.type = 'color';
			input.value = card.color || '#f59e0b';
			input.style.position = 'absolute';
			input.style.opacity = '0';
			input.style.width = '0';
			input.style.height = '0';
			document.body.appendChild(input);
			input.addEventListener('input', () => {
				callbacks.onMemoColorChange(card, input.value);
			});
			input.addEventListener('change', () => {
				if (input.value) {
					callbacks.onMemoColorChange(card, input.value);
				}
				input.remove();
			});
			input.addEventListener('blur', () => {
				input.remove();
			});
			input.click();
		});
	}

	if (!skipEditBtn) {
		const editBtn = actions.createEl('button', {
			cls: 'dashboard-card-btn',
			attr: { 'aria-label': t('renderer.editCard') },
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onCardEdit(card);
		});
	}

	const deleteBtn = actions.createEl('button', {
		cls: 'dashboard-card-btn dashboard-card-btn--danger',
		attr: { 'aria-label': t('renderer.deleteCard') },
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onCardDelete(card.id);
	});

	const body = el.createDiv({ cls: 'dashboard-card-body' });

	// When this is a project-like card, allow dropping docs onto the card body
	if (isProjectLike) {
		body.addEventListener('dragover', (e) => {
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			body.addClass('dashboard-card-body--doc-drop');
		});

		body.addEventListener('dragleave', (e) => {
			if (!body.contains(e.relatedTarget as Node)) {
				body.removeClass('dashboard-card-body--doc-drop');
			}
		});

		body.addEventListener('drop', (e) => {
			body.removeClass('dashboard-card-body--doc-drop');
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			if (e.defaultPrevented) return;
			e.preventDefault();
			const parseDocPaths = (b: string): string[] =>
				b.split('\n').map(l => l.trim()).filter(l => l.startsWith('[[') && l.endsWith(']]')).map(l => l.slice(2, -2));
			const destIndex = parseDocPaths(card.body).length;
			callbacks.onDocMoveToCard(docDragSource.cardId, docDragSource.docIndex, card.id, destIndex);
		});
	}

	renderCardBody(body, card, columnName, sectionType, callbacks, app, data, settings);

	if (card.dueDate) {
		const due = el.createDiv({ cls: 'dashboard-card-due' });
		due.createSpan({ text: card.dueDate });
	}

	if (isMemo) {
		if (card.width > 0) {
			const w = Math.max(200, Math.min(600, card.width));
			el.style.flex = `0 0 ${w}px`;
			el.style.minWidth = `${w}px`;
			el.style.maxWidth = `${w}px`;
		}
	}

	// Dashboard grid layout for widget cards (styles only, button already created above)
	if (isWidget && isDashboardSection) {
		// grid styles already set above when creating the size button
	} else if (isMemo || isTask || isProjectLike) {
		const minW = 200;
		const maxW = 600;
		if (!isMemo && card.width > 0) {
			const w = Math.max(minW, Math.min(500, card.width));
			el.style.flex = `0 0 ${w}px`;
			el.style.minWidth = `${w}px`;
			el.style.maxWidth = `${w}px`;
		}
		const handle = el.createDiv({ cls: 'dashboard-card-resize-handle' });
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startWidth = el.offsetWidth;
			el.addClass('dashboard-card--resizing');

			const onMove = (ev: MouseEvent) => {
				const delta = ev.clientX - startX;
				const newWidth = Math.max(minW, Math.min(maxW, startWidth + delta));
				el.style.flex = `0 0 ${newWidth}px`;
				el.style.minWidth = `${newWidth}px`;
				el.style.maxWidth = `${newWidth}px`;
			};

			const onUp = (ev: MouseEvent) => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				el.removeClass('dashboard-card--resizing');
				const finalWidth = Math.max(minW, Math.min(maxW, startWidth + (ev.clientX - startX)));
				if (finalWidth !== card.width) {
					callbacks.onCardWidthChange(card.id, finalWidth);
				}
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	return el;
}

function renderCardBody(container: HTMLElement, card: DashboardCard, columnName: string, sectionType: string, callbacks: RenderCallbacks, app: App, data?: DashboardData, settings?: DashboardSettings): void {
	if (card.type === 'weather') {
		renderWeatherBody(container, card, app);
		return;
	}

	if (card.type === 'tracker') {
		renderTrackerBody(container, card, app, settings);
		return;
	}

	const isMemo = sectionType === 'memo';
	const isTaskCard = card.type === 'task' || sectionType === 'todo';

	if (isTaskCard) {
		renderTaskBody(container, card, callbacks, app);
		return;
	}

	if (isMemo) {
		renderMemoBody(container, card, callbacks, app);
		return;
	}

	// All non-memo, non-task cards render as project body
	renderProjectBody(container, card, callbacks, app);
}

function renderTaskBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
	const list = container.createDiv({ cls: 'dashboard-task-list' });
	list.dataset.cardId = card.id;

	// When the list is empty, make it a drop target so tasks can be dragged in
	list.addEventListener('dragover', (e) => {
		if (!taskDragSource) return;
		if (taskDragSource.cardId === card.id) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		list.addClass('dashboard-task-list--drop-target');
	});

	list.addEventListener('dragleave', (e) => {
		if (!list.contains(e.relatedTarget as Node)) {
			list.removeClass('dashboard-task-list--drop-target');
		}
	});

	list.addEventListener('drop', (e) => {
		e.preventDefault();
		list.removeClass('dashboard-task-list--drop-target');
		if (!taskDragSource) return;
		if (taskDragSource.cardId === card.id) return;
		callbacks.onTaskMoveToCard(taskDragSource.cardId, taskDragSource.taskIndex, card.id, card.tasks.length);
	});

	card.tasks.forEach((task, index) => {
		const item = list.createDiv({ cls: 'dashboard-task-item' });
		item.setAttribute('draggable', 'true');
		item.dataset.taskIndex = String(index);
		item.dataset.cardId = card.id;

		// Mobile: tap to toggle action buttons visibility
		item.addEventListener('touchstart', () => {
			const wasActive = item.hasClass('dashboard-task-item--touched');
			document.querySelectorAll('.dashboard-task-item--touched').forEach(el => {
				el.removeClass('dashboard-task-item--touched');
			});
			if (!wasActive) {
				item.addClass('dashboard-task-item--touched');
			}
		}, { passive: true });

		const checkbox = item.createEl('input', {
			cls: 'dashboard-task-checkbox',
			attr: { type: 'checkbox' },
		});
		checkbox.checked = task.checked;
		checkbox.addEventListener('change', () => {
			callbacks.onCheckboxToggle(card.id, index, checkbox.checked);
		});

		const label = item.createSpan({
			cls: task.checked ? 'dashboard-task-text dashboard-task-text--done' : 'dashboard-task-text',
		});
		renderTextWithLinks(label, task.text, app);
		label.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			const currentText = label.getText();
			label.empty();

			// Disable dragging on the parent item while editing
			item.setAttribute('draggable', 'false');

			const textarea = label.createEl('textarea', {
				cls: 'dashboard-task-edit-textarea',
				text: task.text,
			});

			// Auto-size: fit content and expand as user types
			const autoResize = () => {
				textarea.style.height = 'auto';
				textarea.style.height = textarea.scrollHeight + 'px';
			};
			autoResize();

			textarea.focus();
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);

			const finish = (save: boolean) => {
				const newText = textarea.value.trim();
				if (save && newText && newText !== task.text) {
					callbacks.onTaskEdit(card.id, index, newText);
				} else {
					label.empty();
					label.setText(currentText);
				}
				item.setAttribute('draggable', 'true');
			};

			textarea.addEventListener('input', autoResize);

			textarea.addEventListener('keydown', (ke) => {
				if (ke.key === 'Enter' && !ke.shiftKey) {
					ke.preventDefault();
					finish(true);
				} else if (ke.key === 'Escape') {
					ke.preventDefault();
					finish(false);
				}
			});

			textarea.addEventListener('blur', () => {
				finish(true);
			});
		});

		const delBtn = item.createEl('button', {
			cls: 'dashboard-task-delete',
			attr: { 'aria-label': t('renderer.deleteTask') },
		});
		setIcon(delBtn, 'x');
		delBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			callbacks.onTaskDelete(card.id, index);
		});

		const reminderBtn = createReminderButton(item, card.id, index, task, callbacks);
		item.appendChild(reminderBtn);

		item.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			taskDragSource = { cardId: card.id, taskIndex: index };
			item.addClass('dashboard-task-item--dragging');
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', String(index));
			}
		});

		item.addEventListener('dragend', () => {
			item.removeClass('dashboard-task-item--dragging');
			document.querySelectorAll('.dashboard-task-item--drag-over').forEach(el => {
				(el as HTMLElement).removeClass('dashboard-task-item--drag-over');
			});
			taskDragSource = null;
		});

		item.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!taskDragSource) return;
			if (taskDragSource.cardId === card.id && taskDragSource.taskIndex === index) return;
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			document.querySelectorAll('.dashboard-task-item--drag-over').forEach(el => {
				(el as HTMLElement).removeClass('dashboard-task-item--drag-over');
			});
			item.addClass('dashboard-task-item--drag-over');
		});

		item.addEventListener('dragleave', () => {
			item.removeClass('dashboard-task-item--drag-over');
		});

		item.addEventListener('drop', (e) => {
			e.preventDefault();
			e.stopPropagation();
			item.removeClass('dashboard-task-item--drag-over');
			if (!taskDragSource) return;
			if (taskDragSource.cardId === card.id && taskDragSource.taskIndex === index) return;

			if (taskDragSource.cardId === card.id) {
				callbacks.onTaskReorder(card.id, taskDragSource.taskIndex, index);
			} else {
				callbacks.onTaskMoveToCard(taskDragSource.cardId, taskDragSource.taskIndex, card.id, index);
			}
		});
	});

	const addRow = container.createDiv({ cls: 'dashboard-task-add' });
	const input = addRow.createEl('input', {
		cls: 'dashboard-task-input',
		attr: { type: 'text', placeholder: t('renderer.addTask') },
	});
	const taskSuggest = attachFileSuggest(input, app);
	input.addEventListener('keydown', (e) => {
		if (taskSuggest.isActive()) return;
		if (e.key === 'Enter' && input.value.trim()) {
			callbacks.onTaskAdd(card.id, input.value.trim());
			input.value = '';
		}
	});

	if (card.tasks.length > 0) {
		const checkedCount = card.tasks.filter(t => t.checked).length;
		const total = card.tasks.length;
		const percent = Math.round((checkedCount / total) * 100);

		const progressWrap = container.createDiv({ cls: 'dashboard-progress' });
		const bar = progressWrap.createDiv({ cls: 'dashboard-progress-bar' });
		bar.createDiv({
			cls: 'dashboard-progress-fill',
			attr: { style: `width: ${percent}%` },
		});
		progressWrap.createSpan({
			cls: 'dashboard-progress-text',
			text: `${percent}%`,
		});
	}
}

function renderMemoBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
	const text = [card.blockquote, card.body].filter(Boolean).join('\n');
	let dirty = false;

	// View mode: rendered text with clickable links
	const view = container.createDiv({ cls: 'dashboard-memo-view' });
	renderMemoViewContent(view, text, app);
	view.addEventListener('click', () => {
		view.style.display = 'none';
		textarea.style.display = '';
		textarea.focus();
	});

	// Edit mode: textarea (hidden by default)
	const textarea = container.createEl('textarea', {
		cls: 'dashboard-memo-textarea',
		text: text,
		attr: { placeholder: t('renderer.writeThoughts') },
	});
	textarea.style.display = 'none';

	attachFileSuggest(textarea, app);

	textarea.addEventListener('input', () => {
		dirty = true;
	});

	const save = () => {
		if (!dirty) return;
		dirty = false;
		const value = textarea.value;
		const lines = value.split('\n');
		const quoteLines: string[] = [];
		const bodyLines: string[] = [];

		for (const line of lines) {
			if (line.startsWith('> ')) {
				quoteLines.push(line.slice(2));
			} else {
				bodyLines.push(line);
			}
		}

		callbacks.onMemoUpdate(card, {
			body: bodyLines.join('\n').trim(),
			blockquote: quoteLines.join('\n'),
		});
	};

	textarea.addEventListener('blur', () => {
		save();
		// If re-render didn't happen (not dirty), switch to view manually
		if (document.body.contains(view)) {
			renderMemoViewContent(view, textarea.value, app);
			view.style.display = '';
			textarea.style.display = 'none';
		}
	});
}

function renderMemoViewContent(container: HTMLElement, text: string, app: App): void {
	container.empty();
	if (!text) {
		container.addClass('dashboard-memo-view--empty');
		container.setText(t('renderer.writeThoughts'));
		return;
	}
	container.removeClass('dashboard-memo-view--empty');

	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (i > 0) container.createEl('br');
		const line = lines[i]!;
		if (line.startsWith('> ')) {
			const quote = container.createDiv({ cls: 'dashboard-note-quote' });
			quote.setText(line.slice(2));
		} else {
			renderTextWithLinks(container, line, app);
		}
	}
}

function renderNoteBody(container: HTMLElement, card: DashboardCard): void {
	if (card.blockquote) {
		const quote = container.createDiv({ cls: 'dashboard-note-quote' });
		quote.setText(card.blockquote);
	}
	if (card.body) {
		container.createDiv({ cls: 'dashboard-note-body', text: card.body });
	}
}

function renderLinkBody(container: HTMLElement, card: DashboardCard): void {
	const link = container.createEl('a', {
		cls: 'dashboard-link-url',
		attr: { href: card.url, target: '_blank', rel: 'noopener' },
		text: card.url,
	});
	if (card.body) {
		container.createDiv({ cls: 'dashboard-link-desc', text: card.body });
	}
}

	function renderProjectBody(container: HTMLElement, card: DashboardCard, callbacks: RenderCallbacks, app: App): void {
		const parseDocPaths = (body: string): string[] =>
			body.split('\n')
				.map(line => line.trim())
				.filter(line => line.startsWith('[[') && line.endsWith(']]'))
				.map(line => line.slice(2, -2));

		const docPaths = parseDocPaths(card.body);

		const docList = container.createDiv({ cls: 'dashboard-project-docs' });
		docList.dataset.cardId = card.id;

		// Empty list drop target so docs can be dragged in
		docList.addEventListener('dragover', (e) => {
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			docList.addClass('dashboard-project-docs--drop-target');
		});

		docList.addEventListener('dragleave', (e) => {
			if (!docList.contains(e.relatedTarget as Node)) {
				docList.removeClass('dashboard-project-docs--drop-target');
			}
		});

		docList.addEventListener('drop', (e) => {
			e.preventDefault();
			docList.removeClass('dashboard-project-docs--drop-target');
			if (!docDragSource) return;
			if (docDragSource.cardId === card.id) return;
			const destIndex = docPaths.length;
			callbacks.onDocMoveToCard(docDragSource.cardId, docDragSource.docIndex, card.id, destIndex);
		});

		if (docPaths.length > 0) {

			docPaths.forEach((docPath, idx) => {
				const file = app.vault.getFileByPath(docPath);
				const docItem = docList.createDiv({ cls: 'dashboard-project-doc-item' });
				docItem.setAttribute('draggable', 'true');
				docItem.dataset.docIndex = String(idx);
				docItem.createSpan({ text: file?.basename ?? docPath.split('/').pop() ?? docPath, cls: 'dashboard-project-doc-name' });

				const removeBtn = docItem.createEl('button', {
					cls: 'dashboard-project-doc-remove',
					attr: { 'aria-label': t('renderer.removeDoc') },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					const currentPaths = parseDocPaths(card.body);
					const newPaths = currentPaths.filter((_, i) => i !== idx);
					const confirmed = await showConfirmDialog(app, {
						title: t('common.confirmDelete'),
						message: t('common.confirmDeleteMessage'),
					});
					if (!confirmed) return;
					callbacks.onProjectDocsUpdate(card, newPaths);
				});

				docItem.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).tagName === 'BUTTON') return;
					const f = app.vault.getFileByPath(docPath);
					if (f) {
						app.workspace.getLeaf(false).openFile(f);
					} else {
						const basename = docPath.split('/').pop()?.replace(/\.md$/, '') ?? '';
						if (basename) {
							const found = getSearchableFiles(app).find(mf => mf.basename === basename);
							if (found) app.workspace.getLeaf(false).openFile(found);
						}
					}
				});

				docItem.addEventListener('dragstart', (e) => {
					e.stopPropagation();
					docDragSource = { cardId: card.id, docIndex: idx };
					docItem.addClass('dashboard-task-item--dragging');
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData('text/plain', String(idx));
					}
				});

				docItem.addEventListener('dragend', () => {
					docItem.removeClass('dashboard-task-item--dragging');
					document.querySelectorAll('.dashboard-task-item--drag-over').forEach(el => {
						(el as HTMLElement).removeClass('dashboard-task-item--drag-over');
					});
					docDragSource = null;
				});

				docItem.addEventListener('dragover', (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (!docDragSource) return;
					if (docDragSource.cardId === card.id && docDragSource.docIndex === idx) return;
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'move';
					}
					document.querySelectorAll('.dashboard-task-item--drag-over').forEach(el => {
						(el as HTMLElement).removeClass('dashboard-task-item--drag-over');
					});
					docItem.addClass('dashboard-task-item--drag-over');
				});

				docItem.addEventListener('dragleave', () => {
					docItem.removeClass('dashboard-task-item--drag-over');
				});

				docItem.addEventListener('drop', (e) => {
					e.preventDefault();
					e.stopPropagation();
					docItem.removeClass('dashboard-task-item--drag-over');
					if (!docDragSource) return;
					if (docDragSource.cardId === card.id && docDragSource.docIndex === idx) return;

					if (docDragSource.cardId === card.id) {
						callbacks.onProjectDocsReorder(card.id, docDragSource.docIndex, idx);
					} else {
						callbacks.onDocMoveToCard(docDragSource.cardId, docDragSource.docIndex, card.id, idx);
					}
				});
			});
		}

		const addDocRow = container.createDiv({ cls: 'dashboard-project-add-doc' });
		const docInput = addDocRow.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('renderer.addDocument') },
		});

		const docResults = addDocRow.createDiv({ cls: 'dashboard-project-doc-results' });

		docInput.addEventListener('input', () => {
			docResults.empty();
			const q = docInput.value.toLowerCase().trim();
			if (!q) return;

			const currentPaths = parseDocPaths(card.body);
			const files = getSearchableFiles(app)
				.filter(f => !f.path.startsWith('.'))
				.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
				.filter(f => !currentPaths.includes(f.path))
				.slice(0, 50);

			for (const file of files) {
				const item = docResults.createDiv({ cls: 'dashboard-project-doc-result' });
				item.setText(file.basename);
				item.addEventListener('click', () => {
					const latestPaths = parseDocPaths(card.body);
					const newPaths = [...latestPaths, file.path];
					callbacks.onProjectDocsUpdate(card, newPaths);
				});
			}
		});

		docInput.addEventListener('blur', () => {
			setTimeout(() => docResults.empty(), 200);
		});
	}

function renderHabitBody(container: HTMLElement, card: DashboardCard): void {
	const streakEl = container.createDiv({ cls: 'dashboard-habit-streak' });
	streakEl.createSpan({ cls: 'dashboard-habit-icon', text: '🔥' });
	streakEl.createSpan({ text: t('renderer.dayStreak', { count: card.streak }) });

	if (card.body) {
		container.createDiv({ cls: 'dashboard-habit-body', text: card.body });
	}
}

function getSectionType(column: DashboardColumn): string {
	if (column.sectionType) return column.sectionType;
	const lower = column.name.toLowerCase();
	if (lower === 'memo') return 'memo';
	if (lower === 'todo') return 'todo';
	if (lower === 'projects') return 'projects';
	if (lower === 'notes') return 'notes';
	if (lower === 'dashboard') return 'dashboard';
	if (column.cards.length > 0) {
		const types = new Set(column.cards.map(c => c.type));
		const dashboardTypes = new Set(['chart', 'weather', 'tracker']);
		if ([...types].every(t => dashboardTypes.has(t)) && types.size > 0) return 'dashboard';
		if (types.has('task') && types.size === 1) return 'todo';
		if (types.has('task') && !types.has('project')) return 'todo';
		if (types.has('project') && types.size === 1) return 'projects';
		if (types.has('generic') && !types.has('project') && !types.has('task')) return 'memo';
	}
	return 'projects';
}

function renderTextWithLinks(container: HTMLElement, text: string, app: App): void {
	const parts = text.split(/(\[\[[^\]]+?\]\]|\[[^\]]+\]\([^)]+\))/g);
	for (const part of parts) {
		const wikiMatch = part.match(/^\[\[([^\]]+)\]\]$/);
		if (wikiMatch) {
			renderWikilink(container, wikiMatch[1]!, app);
			continue;
		}
		const extMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
		if (extMatch) {
			renderExternalLink(container, extMatch[1]!, extMatch[2]!);
			continue;
		}
		if (part) {
			container.appendChild(document.createTextNode(part));
		}
	}
}

function renderWikilink(container: HTMLElement, content: string, app: App): void {
	let alias: string | undefined;
	let linkPart = content;

	const pipeIdx = content.indexOf('|');
	if (pipeIdx !== -1) {
		alias = content.slice(pipeIdx + 1);
		linkPart = content.slice(0, pipeIdx);
	}

	let path = linkPart;
	let fragment: string | undefined;

	const hashIdx = linkPart.indexOf('#');
	if (hashIdx !== -1) {
		path = linkPart.slice(0, hashIdx);
		fragment = linkPart.slice(hashIdx + 1);
	}

	const noteName = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
	let displayName: string;
	if (alias) {
		displayName = alias;
	} else if (fragment) {
		displayName = `${noteName} > ${fragment}`;
	} else {
		displayName = noteName;
	}

	const link = container.createSpan({
		cls: 'dashboard-wikilink',
		text: displayName,
	});

	link.addEventListener('click', (e) => {
		e.stopPropagation();
		const filePath = path.includes('.') ? path : `${path}.md`;
		let file = app.vault.getFileByPath(filePath);
		if (!file) {
			const basename = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
			if (basename) {
				file = getSearchableFiles(app).find(mf => mf.basename === basename) ?? null;
			}
		}
		if (file) {
			app.workspace.getLeaf(false).openFile(file, {
				eState: fragment ? { line: 0 } : undefined,
			});
		}
	});
}

function renderExternalLink(container: HTMLElement, text: string, url: string): void {
	const link = container.createSpan({
		cls: 'dashboard-external-link',
		text: text,
	});
	link.addEventListener('click', (e) => {
		e.stopPropagation();
		window.open(url, '_blank');
	});
}

function isReminderOverdue(reminder: string): boolean {
	const now = new Date();
	const parts = reminder.trim().split(/\s+/);
	if (parts.length < 2) return false;
	const dateStr = parts[0]!;
	const timeStr = parts[1]!;
	const [year, month, day] = dateStr.split('-').map(Number);
	const [hour, min] = timeStr.split(':').map(Number);
	if (!year || !month || !day) return false;
	const due = new Date(year, month - 1, day, hour ?? 0, min ?? 0);
	return now >= due;
}

function createReminderButton(
	taskItem: HTMLElement,
	cardId: string,
	taskIndex: number,
	task: TaskItem,
	callbacks: RenderCallbacks,
): HTMLElement {
	const btn = document.createElement('button');
	btn.setAttribute('draggable', 'false');
	btn.addClass('dashboard-task-reminder-btn');

	if (task.reminder) {
		btn.addClass('dashboard-task-reminder-btn--active');
		setIcon(btn, 'bell-ring');
		btn.setAttribute('aria-label', t('reminder.editReminder'));
		if (!task.checked && isReminderOverdue(task.reminder)) {
			btn.addClass('dashboard-task-reminder-btn--overdue');
		}
	} else {
		setIcon(btn, 'bell');
		btn.setAttribute('aria-label', t('reminder.setReminder'));
	}

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		showReminderPopup(btn, cardId, taskIndex, task, callbacks);
	});

	return btn;
}

function showReminderPopup(
	anchorBtn: HTMLElement,
	cardId: string,
	taskIndex: number,
	task: TaskItem,
	callbacks: RenderCallbacks,
): void {
	closeAllReminderPopups();

	const popup = document.body.createDiv({ cls: 'dashboard-task-reminder-popup' });

	// Inherit theme variables from dashboard root (popup is on body, outside theme scope)
	const dashboardRoot = anchorBtn.closest('.dashboard-root') as HTMLElement;
	if (dashboardRoot) {
		const rs = getComputedStyle(dashboardRoot);
		const themeVars = ['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
			'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font'];
		themeVars.forEach(v => {
			const val = rs.getPropertyValue(v).trim();
			if (val) popup.style.setProperty(v, val);
		});
	}

	const rect = anchorBtn.getBoundingClientRect();
	popup.style.position = 'fixed';
	popup.style.top = `${rect.bottom + 4}px`;

	const popupWidth = 240;
	if (rect.left + popupWidth > window.innerWidth) {
		popup.style.right = `${window.innerWidth - rect.right}px`;
	} else {
		popup.style.left = `${rect.left}px`;
	}

	// Scroll & resize tracking — reposition popup when content moves
	const updatePopupPosition = () => {
		const r = anchorBtn.getBoundingClientRect();
		if (r.height === 0 || r.bottom < 0 || r.top > window.innerHeight
			|| r.right < 0 || r.left > window.innerWidth) {
			closeAllReminderPopups();
			return;
		}
		popup.style.top = `${r.bottom + 4}px`;
		if (r.left + popupWidth > window.innerWidth) {
			popup.style.right = `${window.innerWidth - r.right}px`;
			popup.style.left = 'auto';
		} else {
			popup.style.left = `${r.left}px`;
			popup.style.right = 'auto';
		}
	};
	document.addEventListener('scroll', updatePopupPosition, { passive: true, capture: true });
	window.addEventListener('resize', updatePopupPosition);
	(popup as any).__reminderCleanup = () => {
		document.removeEventListener('scroll', updatePopupPosition, { capture: true });
		window.removeEventListener('resize', updatePopupPosition);
	};

	// Parse initial values
	let selectedYear: number;
	let selectedMonth: number;
	let selectedDay: number;
	let selectedHour = 9;
	let selectedMin = 0;

	const now = new Date();
	if (task.reminder) {
		const parts = task.reminder.trim().split(/\s+/);
		const dp = parts[0]?.split('-').map(Number) ?? [];
		const tp = parts[1]?.split(':').map(Number) ?? [];
		selectedYear = dp[0] ?? now.getFullYear();
		selectedMonth = (dp[1] ?? now.getMonth() + 1) - 1;
		selectedDay = dp[2] ?? now.getDate();
		selectedHour = tp[0] ?? 9;
		selectedMin = tp[1] ?? 0;
	} else {
		selectedYear = now.getFullYear();
		selectedMonth = now.getMonth();
		selectedDay = now.getDate();
	}

	const viewYear = { value: selectedYear };
	const viewMonth = { value: selectedMonth };

	const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	// Calendar nav
	const calNav = popup.createDiv({ cls: 'dashboard-task-reminder-calendar-nav' });
	const prevBtn = calNav.createEl('button', { text: '<' });
	const monthLabel = calNav.createEl('span');
	const nextBtn = calNav.createEl('button', { text: '>' });

	// Calendar grid
	const calGrid = popup.createDiv({ cls: 'dashboard-task-reminder-calendar' });

	// Time picker
	const timeRow = popup.createDiv({ cls: 'dashboard-task-reminder-time' });
	const hourSelect = timeRow.createEl('select');
	for (let h = 0; h < 24; h++) {
		const opt = hourSelect.createEl('option', { text: String(h).padStart(2, '0'), attr: { value: String(h) } });
		if (h === selectedHour) opt.selected = true;
	}
	timeRow.createSpan({ text: ':' });
	const minSelect = timeRow.createEl('select');
	for (let m = 0; m < 60; m++) {
		const opt = minSelect.createEl('option', { text: String(m).padStart(2, '0'), attr: { value: String(m) } });
		if (m === selectedMin) opt.selected = true;
	}

	// Action buttons
	const btnRow = popup.createDiv({ cls: 'dashboard-task-reminder-popup-btns' });
	const saveBtn = btnRow.createEl('button', { cls: 'mod-cta', text: t('common.save') });
	if (task.reminder) {
		btnRow.createEl('button', { cls: 'dashboard-task-reminder-clear', text: t('reminder.clearReminder') });
	}

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

	saveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const h = parseInt(hourSelect.value, 10);
		const m = parseInt(minSelect.value, 10);
		const reminder = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		callbacks.onTaskReminderEdit(cardId, taskIndex, reminder);
		closeAllReminderPopups();
	});

	btnRow.querySelector('.dashboard-task-reminder-clear')?.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onTaskReminderEdit(cardId, taskIndex, undefined);
		closeAllReminderPopups();
	});

	const outsideClick = (ev: MouseEvent) => {
		if (!popup.contains(ev.target as Node)) {
			closeAllReminderPopups();
			document.removeEventListener('mousedown', outsideClick);
		}
	};
	setTimeout(() => document.addEventListener('mousedown', outsideClick), 0);

	renderCalendar();
}

function closeAllReminderPopups(): void {
	document.querySelectorAll('.dashboard-task-reminder-popup').forEach(el => {
		const popup = el as HTMLElement & { __reminderCleanup?: () => void };
		popup.__reminderCleanup?.();
		popup.remove();
	});
}


function renderWeatherBody(container: HTMLElement, card: DashboardCard, app: App): void {
	if (!card.weatherConfig) return;

	const el = container.createDiv({ cls: 'dashboard-weather' });

	const cached = getCachedWeather(card.weatherConfig);
	if (cached) {
		renderWeatherContent(el, cached, card.weatherConfig.cityName);
	} else {
		el.createDiv({ cls: 'dashboard-weather-loading', text: '...' });
		fetchWeather(card.weatherConfig).then(data => {
			el.empty();
			renderWeatherContent(el, data, card.weatherConfig!.cityName);
		}).catch(() => {
			el.empty();
			el.createDiv({ cls: 'dashboard-weather-error', text: t('weather.fetchError') });
		});
	}
}

function renderWeatherContent(el: HTMLElement, data: import('./types').WeatherData, cityName: string): void {
	const current = el.createDiv({ cls: 'dashboard-weather-current' });
	const tempWrap = current.createDiv({ cls: 'dashboard-weather-temp-wrap' });
	tempWrap.createDiv({ cls: 'dashboard-weather-temp', text: `${Math.round(data.temperature)}\u00B0` });
	tempWrap.createDiv({ cls: 'dashboard-weather-icon', text: getWeatherEmoji(data.weatherCode) });

	const details = current.createDiv({ cls: 'dashboard-weather-details' });
	details.createDiv({ cls: 'dashboard-weather-city', text: cityName });
	details.createDiv({ cls: 'dashboard-weather-desc', text: getWeatherDescription(data.weatherCode) });
	const metaLine = details.createDiv({ cls: 'dashboard-weather-wind' });
	metaLine.createSpan({ text: `${t('weather.feelsLike')} ${Math.round(data.feelsLike)}\u00B0  ${t('weather.humidity')} ${Math.round(data.humidity)}%  ${t('weather.wind')} ${Math.round(data.windSpeed)} km/h` });

	if (data.dailyDates.length > 0) {
		const forecast = el.createDiv({ cls: 'dashboard-weather-forecast' });
		const count = Math.min(data.dailyDates.length, 5);
		for (let i = 0; i < count; i++) {
			const day = forecast.createDiv({ cls: 'dashboard-weather-day' });
			const d = new Date(data.dailyDates[i]! + 'T00:00:00');
			const dayName = d.toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en', { weekday: 'short' });
			day.createDiv({ cls: 'dashboard-weather-day-name', text: dayName });
			day.createDiv({ cls: 'dashboard-weather-day-icon', text: getWeatherEmoji(data.dailyCodes[i]!) });
			day.createDiv({ cls: 'dashboard-weather-day-temps', text: `${Math.round(data.dailyMax[i]!)}\u00B0 / ${Math.round(data.dailyMin[i]!)}\u00B0` });
		}
	}
}

function renderTrackerBody(container: HTMLElement, card: DashboardCard, app: App, settings?: import('./types').DashboardSettings): void {
	if (!card.trackerConfig) return;

	const config = card.trackerConfig;
	const journalPath = settings?.journalPath ?? '';
	const size: CardSize = card.size || 'M';
	const style: TrackerStyle = config.style || 'line';
	destroyChart(card.id);

	const el = container.createDiv({ cls: `dashboard-tracker dashboard-tracker--${size}` });

	const data = readTrackerData(app, journalPath, config.key, config.days);
	const validPoints = data.filter(p => p.value !== null);

	if (validPoints.length === 0) {
		el.createDiv({ cls: 'dashboard-tracker-empty', text: journalPath ? t('tracker.noData') + ': ' + config.key : t('tracker.noJournal') });
		return;
	}

	const values = data.map(p => p.value);
	const minVal = Math.min(...values.filter((v): v is number => v !== null));
	const maxVal = Math.max(...values.filter((v): v is number => v !== null));
	const sum = validPoints.reduce((s, p) => s + p.value!, 0);
	const avg = (sum / validPoints.length).toFixed(1);
	const latest = validPoints[validPoints.length - 1]!.value as number;
	const prev = validPoints.length > 1 ? validPoints[validPoints.length - 2]!.value as number : latest;
	const trendDir = latest > prev ? 'up' : latest < prev ? 'down' : 'flat';
	const trendPct = prev !== 0 ? ((latest - prev) / Math.abs(prev) * 100).toFixed(1) : '0';

	// Streak: consecutive days with data (from latest backward)
	let streak = 0;
	for (let i = validPoints.length - 1; i >= 0; i--) {
		if (validPoints[i]!.value !== null) streak++;
		else break;
	}

	if (size === 'S') {
		const row = el.createDiv({ cls: 'dashboard-tracker-compact' });
		row.createDiv({ cls: 'dashboard-tracker-compact-value', text: String(latest) });
		const arrow = row.createDiv({ cls: `dashboard-tracker-trend dashboard-tracker-trend--${trendDir}` });
		arrow.setText(trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→');
		if (config.key) {
			row.createDiv({ cls: 'dashboard-tracker-compact-label', text: config.key });
		}
		return;
	}

	const accentColor = getCSSVar('--db-accent') || '#6366f1';

	// Dispatch by style
	if (style === 'heatmap') {
		renderTrackerHeatmap(el, data, minVal, maxVal, size, accentColor);
	} else if (style === 'bar') {
		renderTrackerBarChart(el, data, size, accentColor, card.id);
	} else {
		renderTrackerLineChart(el, data, size, accentColor, card.id);
	}

	// Stats
	const stats = el.createDiv({ cls: 'dashboard-tracker-stats' });
	const addStat = (label: string, value: string | number) => {
		const stat = stats.createDiv({ cls: 'dashboard-tracker-stat' });
		stat.createSpan({ cls: 'dashboard-tracker-stat-label', text: label });
		stat.createSpan({ cls: 'dashboard-tracker-stat-value', text: String(value) });
	};
	addStat(t('tracker.current'), latest);
	addStat(t('tracker.avg'), avg);

	if (size === 'M') {
		addStat(t('tracker.trend'), `${trendDir === 'up' ? '+' : ''}${trendPct}%`);
	}

	if (size === 'L') {
		addStat(t('tracker.trend'), `${trendDir === 'up' ? '+' : ''}${trendPct}%`);
		addStat(t('tracker.streak'), `${streak}d`);
		addStat(t('tracker.min'), minVal);
		addStat(t('tracker.max'), maxVal);
	}
}

function renderTrackerLineChart(el: HTMLElement, data: import('./types').TrackerDataPoint[], size: CardSize, accentColor: string, cardId: string): void {
	const chartWrap = el.createDiv({ cls: 'dashboard-tracker-chart' });
	const canvasEl = chartWrap.createEl('canvas', { cls: 'dashboard-chart-canvas' });
	const ctx = canvasEl.getContext('2d');
	if (!ctx) return;

	const chart = new Chart(ctx, {
		type: 'line',
		data: {
			labels: data.map(p => p.date.slice(5)),
			datasets: [{
				data: data.map(p => p.value),
				borderColor: accentColor,
				backgroundColor: `${accentColor}22`,
				fill: true,
				tension: 0.4,
				pointRadius: size === 'L' ? 3 : 0,
				pointHoverRadius: 5,
				pointBackgroundColor: accentColor,
				borderWidth: 2,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, tooltip: { enabled: true } },
			scales: {
				x: { display: false },
				y: { display: false },
			},
			animation: { duration: 600 },
		},
	});
	chartInstances.set(cardId, chart);
}

function renderTrackerBarChart(el: HTMLElement, data: import('./types').TrackerDataPoint[], size: CardSize, accentColor: string, cardId: string): void {
	const chartWrap = el.createDiv({ cls: 'dashboard-tracker-chart' });
	const canvasEl = chartWrap.createEl('canvas', { cls: 'dashboard-chart-canvas' });
	const ctx = canvasEl.getContext('2d');
	if (!ctx) return;

	const textColor = getCSSVar('--db-text-muted') || '#888';
	const validVals = data.filter(p => p.value !== null).map(p => p.value!);
	const barMax = validVals.length > 0 ? Math.max(...validVals) : 1;

	const chart = new Chart(ctx, {
		type: 'bar',
		data: {
			labels: data.map(p => p.date.slice(5)),
			datasets: [{
				data: data.map(p => p.value ?? 0),
				backgroundColor: data.map(p => {
					if (p.value === null) return 'transparent';
					const intensity = barMax > 0 ? p.value / barMax : 0;
					return `${accentColor}${Math.round(40 + intensity * 180).toString(16).padStart(2, '0')}`;
				}),
				borderRadius: 2,
				barPercentage: 0.8,
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, tooltip: { enabled: true } },
			scales: {
				x: { display: false },
				y: { display: size === 'L', grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
			},
			animation: { duration: 600 },
		},
	});
	chartInstances.set(cardId, chart);
}

function renderTrackerHeatmap(el: HTMLElement, data: import('./types').TrackerDataPoint[], minVal: number, maxVal: number, size: CardSize, accentColor: string): void {
	const heatmap = el.createDiv({ cls: 'dashboard-tracker-heatmap' });

	const range = maxVal - minVal || 1;
	const cellSize = size === 'M' ? 10 : 14;
	const gap = 2;

	// Organize data into weeks (columns), days are rows (Mon-Sun)
	// Each column = 1 week, from oldest to newest
	const firstDate = data[0] ? new Date(data[0].date + 'T00:00:00') : new Date();
	const startDayOfWeek = firstDate.getDay(); // 0=Sun, 1=Mon...
	const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // days from Monday

	// Build week columns
	const weeks: (import('./types').TrackerDataPoint | null)[][] = [];
	let currentWeek: (import('./types').TrackerDataPoint | null)[] = [];

	// Pad first week with nulls to align to Monday
	for (let i = 0; i < mondayOffset; i++) {
		currentWeek.push(null);
	}

	for (const point of data) {
		currentWeek.push(point);
		if (currentWeek.length === 7) {
			weeks.push(currentWeek);
			currentWeek = [];
		}
	}
	if (currentWeek.length > 0) {
		weeks.push(currentWeek);
	}

	// Limit visible weeks based on size
	const maxWeeks = size === 'M' ? 15 : size === 'L' ? 26 : 52;
	const visibleWeeks = weeks.slice(-maxWeeks);

	const grid = heatmap.createDiv({ cls: 'dashboard-tracker-heatmap-grid' });
	grid.style.display = 'grid';
	grid.style.gridTemplateColumns = `repeat(${visibleWeeks.length}, ${cellSize}px)`;
	grid.style.gridTemplateRows = `repeat(7, ${cellSize}px)`;
	grid.style.gap = `${gap}px`;

	// Day labels (Mon, Tue, ... Sun) for L size
	if (size === 'L') {
		const labels = heatmap.createDiv({ cls: 'dashboard-tracker-heatmap-labels' });
		const dayNames = ['M', '', 'W', '', 'F', '', 'S'];
		for (const name of dayNames) {
			labels.createDiv({ cls: 'dashboard-tracker-heatmap-day-label', text: name });
		}
	}

	for (const week of visibleWeeks) {
		for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
			const point = week[dayIdx] ?? null;
			const cell = grid.createDiv({ cls: 'dashboard-tracker-heatmap-cell' });
			cell.style.width = `${cellSize}px`;
			cell.style.height = `${cellSize}px`;
			cell.style.borderRadius = `${Math.max(2, cellSize / 4)}px`;

			if (point === null || point.value === null) {
				cell.addClass('dashboard-tracker-heatmap-cell--empty');
			} else {
				const intensity = (point.value - minVal) / range;
				const alpha = 0.15 + intensity * 0.85;
				cell.style.backgroundColor = accentColor;
				cell.style.opacity = String(alpha);
				cell.title = `${point.date}: ${point.value}`;
			}
		}
	}
}
