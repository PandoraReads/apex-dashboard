import { t } from './i18n';

interface ConfirmOptions {
	title: string;
	message: string;
}

export function showConfirmDialog(_app: unknown, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const doc = activeDocument;
		const overlay = doc.body.createDiv({ cls: 'dashboard-confirm-overlay' });
		let resolved = false;
		function done(value: boolean): void {
			if (resolved) return;
			resolved = true;
			doc.removeEventListener('keydown', onKeydown);
			overlay.remove();
			resolve(value);
		}
		function onKeydown(e: KeyboardEvent): void {
			if (e.key === 'Escape') done(false);
		}

		// Full-screen overlay
		const dashboardRoot = doc.querySelector<HTMLElement>('.apex-dashboard-root');
		if (dashboardRoot) {
			const themeStyles = dashboardRoot.ownerDocument.defaultView?.getComputedStyle(dashboardRoot) ?? getComputedStyle(dashboardRoot);
			for (const property of [
				'--db-bg-card',
				'--db-bg-btn',
				'--db-bg-btn-hover',
				'--db-border-card',
				'--db-border-btn',
				'--db-text',
				'--db-text-muted',
				'--db-danger',
				'--db-shadow-card',
			]) {
				overlay.style.setProperty(property, themeStyles.getPropertyValue(property));
			}
			overlay.dataset.theme = dashboardRoot.dataset.theme ?? '';
		}

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
			done(false);
		});

		const deleteBtn = actions.createEl('button', {
			text: t('common.delete'),
			cls: 'dashboard-confirm-delete',
		});
		deleteBtn.addEventListener('click', () => {
			done(true);
		});

		// Close on overlay click
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) {
				done(false);
			}
		});

		// Close on Escape
		doc.addEventListener('keydown', onKeydown);
	});
}
