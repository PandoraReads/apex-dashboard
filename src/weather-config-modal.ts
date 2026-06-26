import { App, Modal } from 'obsidian';
import type { WeatherConfig } from './types';
import { geocodeCity, type GeocodeResult } from './weather-service';
import { t } from './i18n';

export class WeatherConfigModal extends Modal {
	private onSave: (title: string, config: WeatherConfig) => void;
	private theme: string;

	private cityName = '';
	private latitude = 0;
	private longitude = 0;
	private useManual = false;
	private results: GeocodeResult[] = [];
	private searchTimer: number | null = null;

	constructor(
		app: App,
		onSave: (title: string, config: WeatherConfig) => void,
		theme?: string,
	) {
		super(app);
		this.onSave = onSave;
		this.theme = theme ?? 'earth';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		contentEl.createEl('h2', { text: t('weather.configTitle') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// City search
		const cityField = form.createDiv({ cls: 'chart-config-field' });
		cityField.createEl('label', { text: t('weather.cityLabel') });
		const cityInput = cityField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('weather.cityPlaceholder') },
		});

		const resultsList = cityField.createDiv({ cls: 'weather-city-results' });

		const renderResults = () => {
			resultsList.empty();
			if (this.results.length === 0) return;

			for (const r of this.results) {
				const item = resultsList.createDiv({ cls: 'weather-city-result-item' });
				const label = r.admin1 ? `${r.name}, ${r.admin1}, ${r.country}` : `${r.name}, ${r.country}`;
				item.setText(label);
				item.addEventListener('click', () => {
					this.cityName = r.name;
					this.latitude = r.latitude;
					this.longitude = r.longitude;
					cityInput.value = r.name;
					resultsList.empty();
					this.results = [];
				});
			}
		};

		cityInput.addEventListener('input', () => {
			if (this.searchTimer) window.clearTimeout(this.searchTimer);
			const query = cityInput.value.trim();
			if (!query) {
				this.results = [];
				resultsList.empty();
				return;
			}
			this.searchTimer = window.setTimeout(() => {
				void (async () => {
					this.results = await geocodeCity(query);
					renderResults();
				})();
			}, 400);
		});

		// Manual coordinates toggle
		const manualField = form.createDiv({ cls: 'chart-config-field' });
		const manualCheck = manualField.createEl('input', {
			attr: { type: 'checkbox', id: 'weather-manual' },
		});
		manualField.createEl('label', {
			text: t('weather.manualCoords'),
			attr: { for: 'weather-manual' },
		});

		const coordsWrap = form.createDiv({ cls: 'weather-coords-wrap', attr: { style: 'display:none' } });

		const latField = coordsWrap.createDiv({ cls: 'chart-config-field chart-config-row' });
		latField.createEl('label', { text: t('weather.latLabel') });
		const latInput = latField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'number', step: '0.0001', placeholder: '39.9042' },
		});

		const lonField = coordsWrap.createDiv({ cls: 'chart-config-field chart-config-row' });
		lonField.createEl('label', { text: t('weather.lonLabel') });
		const lonInput = lonField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'number', step: '0.0001', placeholder: '116.4074' },
		});

		manualCheck.addEventListener('change', () => {
			this.useManual = manualCheck.checked;
			coordsWrap.style.display = this.useManual ? 'block' : 'none';
		});

		// Actions
		const actions = form.createDiv({ cls: 'dashboard-modal-actions' });
		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			let lat: number, lon: number, city: string;

			if (this.useManual) {
				lat = parseFloat(latInput.value) || 0;
				lon = parseFloat(lonInput.value) || 0;
				city = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
			} else {
				lat = this.latitude;
				lon = this.longitude;
				city = this.cityName || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
			}

			if (isNaN(lat) || isNaN(lon)) return;
				if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
				if (lat === 0 && lon === 0) return;

			this.onSave(city, { latitude: lat, longitude: lon, cityName: city });
			this.close();
		});

		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		cityInput.focus();
	}

	onClose(): void {
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
		const { contentEl } = this;
		contentEl.empty();
	}
}
