import { t } from './i18n';

interface PromptOptions {
	title: string;
	placeholder?: string;
	defaultValue?: string;
}

/**
 * Lightweight text-input dialog: the `dashboard-confirm-*` counterpart to a
 * native `prompt()`. Resolves to the trimmed value, or `null` if cancelled.
 * Used instead of `prompt()`, which is disallowed by the `no-alert` lint rule.
 */
export function showPromptDialog(_app: unknown, options: PromptOptions): Promise<string | null> {
	return new Promise((resolve) => {
		let resolved = false;

		const overlay = activeDocument.body.createDiv({ cls: 'dashboard-confirm-overlay' });
		const dialog = overlay.createDiv({ cls: 'dashboard-confirm-card' });

		dialog.createEl('h3', { text: options.title, cls: 'dashboard-confirm-title' });

		const input = dialog.createEl('input', { cls: 'dashboard-prompt-input', attr: { type: 'text' } });
		input.placeholder = options.placeholder ?? '';
		input.value = options.defaultValue ?? '';

		function finish(value: string | null): void {
			if (resolved) return;
			resolved = true;
			overlay.remove();
			activeDocument.removeEventListener('keydown', onKeydown);
			resolve(value);
		}

		function submit(): void {
			const value = input.value.trim();
			finish(value.length > 0 ? value : null);
		}

		function onKeydown(e: KeyboardEvent): void {
			if (e.key === 'Escape') finish(null);
		}

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submit();
			}
		});

		const actions = dialog.createDiv({ cls: 'dashboard-confirm-actions' });

		const cancelBtn = actions.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-confirm-cancel',
		});
		cancelBtn.addEventListener('click', () => finish(null));

		const confirmBtn = actions.createEl('button', {
			text: t('common.save'),
			cls: 'dashboard-confirm-confirm',
		});
		confirmBtn.addEventListener('click', submit);

		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) finish(null);
		});

		activeDocument.addEventListener('keydown', onKeydown);

		// Defer focus until the input is laid out.
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	});
}
