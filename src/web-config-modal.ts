import { App, Modal } from 'obsidian';
import type { WebEmbedConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { isValidWebUrl, normalizeWebUrl } from './web-precheck';

/** Single-select zoom presets — dense web apps shrink, sparse pages grow.
 *  1 (100%) is the default and persists as no zoom line at all. */
const ZOOM_PRESETS: ReadonlyArray<number> = [0.5, 0.75, 0.9, 1, 1.1, 1.25];

/**
 * Configuration modal for a Web section: the URL to embed and a display zoom.
 * The engine (iframe vs desktop webview) is chosen automatically by the
 * section's precheck — there is deliberately no manual override. Structure
 * mirrors DataviewConfigModal (same modal theme preamble, section layout, and
 * footer) so it reads as a sibling at a glance.
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

		// Display zoom: preset chips shrink dense web apps (Keep-style) to fit
		// a section, or grow sparse pages. Replaces the old free-form number
		// input; 100% = native size and persists as no zoom at all.
		const zoomSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		zoomSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('web.zoomLabel') });
		const chipsHost = zoomSection.createDiv({ cls: 'dashboard-web-zoom-chips' });
		const currentZoom = this.config.zoom ?? 1;
		for (const preset of ZOOM_PRESETS) {
			const chip = chipsHost.createDiv({
				cls: 'dashboard-web-zoom-chip' + (preset === currentZoom ? ' active' : ''),
				text: `${Math.round(preset * 100)}%`,
			});
			chip.addEventListener('click', () => {
				this.config = { ...this.config, zoom: preset === 1 ? undefined : preset };
				chipsHost.querySelectorAll('.dashboard-web-zoom-chip').forEach(c => c.removeClass('active'));
				chip.addClass('active');
			});
		}

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
