import { App, Modal } from 'obsidian';
import type { WebEmbedConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { isValidWebUrl, normalizeWebUrl } from './web-precheck';

type WebMode = NonNullable<WebEmbedConfig['mode']>;

const MODES: ReadonlyArray<{ value: WebMode; key: string }> = [
	{ value: 'auto', key: 'web.modeAuto' },
	{ value: 'iframe', key: 'web.modeIframe' },
	{ value: 'webview', key: 'web.modeWebview' },
];

/**
 * Configuration modal for a Web section: the URL to embed, the engine mode
 * (auto / forced iframe / forced desktop webview), and a display zoom.
 * Structure mirrors DataviewConfigModal (same modal theme preamble, section
 * layout, and footer) so it reads as a sibling at a glance.
 */
export class WebConfigModal extends Modal {
	private config: WebEmbedConfig;
	private readonly onSave: (config: WebEmbedConfig) => void;
	private urlInput: HTMLInputElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(app: App, config: WebEmbedConfig, onSave: (config: WebEmbedConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.config = { ...config };
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('web.configure') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// URL input with live validation.
		const urlSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		urlSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('web.urlLabel') });
		this.urlInput = urlSection.createEl('input', {
			cls: 'dashboard-task-input',
			attr: {
				type: 'text',
				placeholder: t('web.urlPlaceholder'),
				spellcheck: 'false',
				autocomplete: 'off',
			},
		});
		this.urlInput.value = this.config.url;
		this.urlInput.addEventListener('input', () => {
			this.config = { ...this.config, url: this.urlInput?.value ?? '' };
			this.validate();
		});
		this.errorEl = urlSection.createDiv({ cls: 'dashboard-dataview-validation' });
		this.validate();

		// Engine mode chips: auto prechecks the site; iframe/webview force one
		// engine (useful to correct a misjudged precheck or pin a login app).
		const modeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		modeSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('web.modeLabel') });
		const chipsHost = modeSection.createDiv({ cls: 'dashboard-dataview-sample-chips' });
		const current = this.config.mode ?? 'auto';
		for (const mode of MODES) {
			const chip = chipsHost.createDiv({
				cls: 'dashboard-dataview-sample-chip' + (mode.value === current ? ' active' : ''),
				text: t(mode.key),
			});
			chip.addEventListener('click', () => {
				this.config = { ...this.config, mode: mode.value };
				chipsHost.querySelectorAll('.dashboard-dataview-sample-chip').forEach(c => c.removeClass('active'));
				chip.addClass('active');
			});
		}
		modeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('web.modeHint') });

		// Display zoom: shrinks dense web apps to fit a section.
		const zoomSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		zoomSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('web.zoomLabel') });
		const zoomInput = zoomSection.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'number', step: '0.05', min: '0.5', max: '2' },
		});
		zoomInput.value = this.config.zoom != null ? String(this.config.zoom) : '';
		zoomInput.addEventListener('change', () => {
			const value = Number(zoomInput.value);
			const valid = zoomInput.value !== '' && Number.isFinite(value) && value >= 0.5 && value <= 2;
			this.config = { ...this.config, zoom: valid ? value : undefined };
		});

		// Footer. Save does not gate on a valid URL: the parser tolerates any
		// string and the section renders a configure-me empty state, so a
		// half-finished config can still be persisted.
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave({
				url: this.config.url.trim(),
				mode: this.config.mode,
				zoom: this.config.zoom,
			});
			this.close();
		});

		window.setTimeout(() => this.urlInput?.focus(), 0);
	}

	/** Live URL validation line (same classes as the Dataview modal's). */
	private validate(): void {
		if (!this.errorEl) return;
		const raw = this.config.url.trim();
		this.errorEl.empty();
		if (raw.length === 0) {
			this.errorEl.removeClass('is-error');
			return;
		}
		if (isValidWebUrl(normalizeWebUrl(raw))) {
			this.errorEl.removeClass('is-error');
			this.errorEl.createSpan({ cls: 'dashboard-dataview-validation-ok', text: t('web.validUrl') });
		} else {
			this.errorEl.addClass('is-error');
			this.errorEl.createSpan({ text: t('web.invalidUrl') });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
