import { t } from './i18n';

interface ConfirmOptions {
	title: string;
	message: string;
	/** Override the confirm button label (defaults to the localized "Delete"). */
	confirmLabel?: string;
	/** When false the confirm button uses the accent color instead of the
	 *  destructive red. Defaults to true (destructive) for back-compat. */
	destructive?: boolean;
}

export function showConfirmDialog(_app: unknown, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		let resolved = false;
		const done = (value: boolean) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

		const destructive = options.destructive !== false;

		// Full-screen overlay
		const overlay = activeDocument.body.createDiv({ cls: 'dashboard-confirm-overlay' });

		// Dialog card
		const dialog = overlay.createDiv({ cls: 'dashboard-confirm-card' });

		dialog.createEl('h3', { text: options.title, cls: 'dashboard-confirm-title' });
		dialog.createEl('p', { text: options.message, cls: 'dashboard-confirm-message' });

		const actions = dialog.createDiv({ cls: 'dashboard-confirm-actions' });

		const cancelBtn = actions.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-confirm-cancel',
		});
		cancelBtn.addEventListener('click', () => {
			overlay.remove();
			done(false);
		});

		const confirmBtn = actions.createEl('button', {
			text: options.confirmLabel ?? t('common.delete'),
			cls: destructive ? 'dashboard-confirm-delete' : 'dashboard-confirm-primary',
		});
		confirmBtn.addEventListener('click', () => {
			overlay.remove();
			done(true);
		});

		// Close on overlay click
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) {
				overlay.remove();
				done(false);
			}
		});

		// Close on Escape
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				activeDocument.removeEventListener('keydown', onKeydown);
				overlay.remove();
				done(false);
			}
		};
		activeDocument.addEventListener('keydown', onKeydown);
	});
}
