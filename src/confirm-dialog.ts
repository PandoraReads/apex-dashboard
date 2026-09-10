import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

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
		/** The dialog's default action: the safe choice for destructive
		 *  confirms, OK for plain ones. Focused on open and run by Enter. */
		const defaultValue = !destructive;

		// Full-screen overlay
		const overlay = activeDocument.body.createDiv({ cls: 'dashboard-confirm-overlay' });

		// Dialog card
		const dialog = overlay.createDiv({
			cls: 'dashboard-confirm-card',
			attr: { role: 'dialog', 'aria-modal': 'true' },
		});
		applyModalTheme(dialog);

		dialog.createEl('h3', { text: options.title, cls: 'dashboard-confirm-title' });
		dialog.createEl('p', { text: options.message, cls: 'dashboard-confirm-message' });

		const actions = dialog.createDiv({ cls: 'dashboard-confirm-actions' });

		const close = (value: boolean): void => {
			activeDocument.removeEventListener('keydown', onKeydown);
			overlay.remove();
			done(value);
		};

		const cancelBtn = actions.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-confirm-cancel',
		});
		cancelBtn.addEventListener('click', () => close(false));

		const confirmBtn = actions.createEl('button', {
			text: options.confirmLabel ?? t('common.delete'),
			cls: destructive ? 'dashboard-confirm-delete' : 'dashboard-confirm-primary',
		});
		confirmBtn.addEventListener('click', () => close(true));

		// Close on overlay click
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) {
				close(false);
			}
		});

		// Keyboard: Escape cancels; Enter runs the default action. When the
		// press did not land inside the dialog (focus can still sit on the page
		// button that opened us — the overlay never claimed it before), the
		// preventDefault is what stops that button's native Enter activation
		// from re-opening this dialog: every stray Enter used to stack another
		// half-black overlay, darkening the screen one press at a time.
		const onKeydown = (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (e.key === 'Escape') {
				e.preventDefault();
				close(false);
				return;
			}
			if (e.key === 'Enter' && !dialog.contains(e.target as Node | null)) {
				e.preventDefault();
				close(defaultValue);
			}
		};
		activeDocument.addEventListener('keydown', onKeydown);

		// Claim focus into the dialog (the prompt dialog does the same for its
		// input): the default button is focused so Tab starts inside and Enter
		// activates it natively instead of reaching back into the page.
		(destructive ? cancelBtn : confirmBtn).focus();
	});
}
