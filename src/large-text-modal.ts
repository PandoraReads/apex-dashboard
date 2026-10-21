/**
 * Read-and-edit popup for long single-line config texts (prompt templates
 * above all): the inline field stays compact, this modal shows the whole
 * content in a tall textarea. Every keystroke streams back through onChange
 * so closing never loses an edit — no save/cancel ceremony.
 */

import { App, Modal } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export class LargeTextModal extends Modal {
	constructor(
		app: App,
		title: string,
		text: string,
		private readonly onChange: (value: string) => void,
	) {
		super(app);
		this.title = title;
		this.text = text;
	}

	private title: string;
	private text: string;

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const wrap = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-large-text-modal' });
		const header = wrap.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: this.title });

		const body = wrap.createDiv({ cls: 'dashboard-modal-body' });
		const area = body.createEl('textarea', {
			cls: 'dashboard-large-text',
			attr: { 'aria-label': this.title },
		});
		area.value = this.text;
		area.addEventListener('input', () => {
			this.text = area.value;
			this.onChange(area.value);
		});

		const footer = wrap.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('common.close'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			attr: { type: 'button' },
		}).addEventListener('click', () => this.close());
		// Focus the text so reading/editing starts without an extra click.
		window.setTimeout(() => area.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
