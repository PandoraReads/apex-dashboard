import { t } from './i18n';

interface ConfirmOptions {
	title: string;
	message: string;
}

export function showConfirmDialog(_app: unknown, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		let resolved = false;
		const done = (value: boolean) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

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

		const deleteBtn = actions.createEl('button', {
			text: t('common.delete'),
			cls: 'dashboard-confirm-delete',
		});
		deleteBtn.addEventListener('click', () => {
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
