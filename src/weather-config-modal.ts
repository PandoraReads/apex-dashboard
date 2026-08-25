import { App, Modal } from 'obsidian';
import type { WeatherConfig } from './types';
import { geocodeCity, type GeocodeResult } from './weather-service';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export class WeatherConfigModal extends Modal {
	private onSave: (title: string, config: WeatherConfig) => void;

	private cityName = '';
	private latitude = 0;
	private longitude = 0;
	private useManual = false;
	private results: GeocodeResult[] = [];
	private searchTimer: number | null = null;

	constructor(
		app: App,
		onSave: (title: string, config: WeatherConfig) => void,
	) {
		super(app);
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
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('weather.configTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// City search
		const citySection = body.createDiv({ cls: 'dashboard-library-config-section' });
		citySection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('weather.cityLabel') });
		const cityInput = citySection.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('weather.cityPlaceholder') },
		});

		const resultsList = citySection.createDiv({ cls: 'weather-city-results' });

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

		// Manual coordinates
		const coordsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		const manualRow = coordsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		const manualCheck = manualRow.createEl('input', {
			cls: 'dashboard-library-config-checkbox',
			attr: { type: 'checkbox', id: 'weather-manual' },
		});
		manualRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('weather.manualCoords') });

		const latRow = coordsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		latRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('weather.latLabel') });
		const latInput = latRow.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'number', step: '0.0001', placeholder: '39.9042' },
		});

		const lonRow = coordsSection.createDiv({ cls: 'dashboard-library-config-inline-row' });
		lonRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('weather.lonLabel') });
		const lonInput = lonRow.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'number', step: '0.0001', placeholder: '116.4074' },
		});

		latRow.setCssProps({ display: 'none' });
		lonRow.setCssProps({ display: 'none' });
		manualCheck.addEventListener('change', () => {
			this.useManual = manualCheck.checked;
			latRow.setCssProps({ display: this.useManual ? 'flex' : 'none' });
			lonRow.setCssProps({ display: this.useManual ? 'flex' : 'none' });
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

		cityInput.focus();
	}

	onClose(): void {
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
		const { contentEl } = this;
		contentEl.empty();
	}
}
