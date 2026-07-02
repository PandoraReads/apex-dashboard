import { App, Modal, Platform, setIcon } from 'obsidian';
import { t } from './i18n';

/* eslint-disable no-undef, @typescript-eslint/no-require-imports -- Electron's BrowserWindow and session.cookie APIs are loaded via require() without bundled typings, so require/no-undef can't be avoided in this desktop-only login interop */

/** Minimal Electron typings — only the surface this login helper touches (Electron's own types aren't bundled with Obsidian). */
interface ElectronCookie {
	name: string;
	value?: string;
}
interface ElectronCookieStore {
	get(filter: { domain?: string }): Promise<ElectronCookie[]>;
}
interface ElectronWebContents {
	session: { cookies: ElectronCookieStore };
}
interface BrowserWindowLike {
	webContents: ElectronWebContents;
	loadURL(url: string): Promise<unknown>;
	isDestroyed(): boolean;
	close(): void;
	on(event: 'closed', listener: () => void): void;
}
type BrowserWindowConstructor = new (opts: {
	width: number;
	height: number;
	webPreferences: Record<string, unknown>;
}) => BrowserWindowLike;
interface ElectronModule {
	BrowserWindow?: BrowserWindowConstructor;
	remote?: { BrowserWindow?: BrowserWindowConstructor };
}
/**
 * Open TickTick's sign-in page in an embedded Electron window and grab the `t`
 * session cookie + `_csrf_token` (needed for writes) automatically once the user
 * logs in — no DevTools, no manual copy. Desktop only (Electron BrowserWindow);
 * mobile falls back to the manual-paste path in the modal.
 */
export function loginViaBrowser(region: 'dida365' | 'ticktick'): Promise<{ token: string; csrf: string }> {
	return new Promise((resolve, reject) => {
		if (Platform.isMobile) {
			reject(new Error('UNSUPPORTED'));
			return;
		}
		const signinUrl = region === 'ticktick' ? 'https://ticktick.com/signin' : 'https://dida365.com/signin';
		const domain = region === 'ticktick' ? 'ticktick.com' : 'dida365.com';

		// Resolve a BrowserWindow constructor across Obsidian/Electron variants.
		let BrowserWindowCtor: BrowserWindowConstructor | undefined;
		try {
			const electron = require('electron') as ElectronModule | undefined;
			BrowserWindowCtor = electron?.BrowserWindow ?? electron?.remote?.BrowserWindow;
			if (!BrowserWindowCtor) {
				try {
					const remote = require('@electron/remote') as { BrowserWindow?: BrowserWindowConstructor } | undefined;
					BrowserWindowCtor = remote?.BrowserWindow;
				} catch { /* not available */ }
			}
		} catch (e) {
			reject(new Error(`NO_ELECTRON:${e instanceof Error ? e.message : ''}`));
			return;
		}
		if (!BrowserWindowCtor) {
			reject(new Error('NO_ELECTRON:BrowserWindow unavailable in this Obsidian build'));
			return;
		}

		let win: BrowserWindowLike;
		try {
			win = new BrowserWindowCtor({
				width: 960,
				height: 720,
				webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'persist:apex-ticktick' },
			});
		} catch (e) {
			reject(new Error(`UNSUPPORTED:${e instanceof Error ? e.message : ''}`));
			return;
		}

		void win.loadURL(signinUrl);
		let done = false;
		const poll = async (): Promise<void> => {
			if (done || win.isDestroyed()) return;
			try {
				const cookies = await win.webContents.session.cookies.get({ domain });
				const token = cookies.find(c => c.name === 't' && typeof c.value === 'string' && c.value.length > 0);
				if (token && token.value) {
					const csrf = cookies.find(c => c.name === '_csrf_token' && typeof c.value === 'string');
					done = true;
					if (!win.isDestroyed()) win.close();
					resolve({ token: token.value, csrf: csrf?.value ?? '' });
					return;
				}
			} catch {
				// ignore and keep polling
			}
			window.setTimeout(() => { void poll(); }, 1500);
		};
		window.setTimeout(() => { void poll(); }, 2000);
		win.on('closed', () => { if (!done) reject(new Error('WINDOW_CLOSED')); });
	});
}
/* eslint-enable no-undef, @typescript-eslint/no-require-imports -- end of the Electron login interop block */

/**
 * Guided authorization modal for TickTick. Primary flow: email + password login
 * that calls /user/signon and stores the returned token as the `t` cookie — no
 * DevTools needed. Fallback: instructions + "open web app" + manual paste.
 */
export class TickTickLoginModal extends Modal {
	private readonly region: 'dida365' | 'ticktick';
	private readonly deviceVersion?: string;
	private readonly onSave: (token: string, csrf: string) => void | Promise<void>;
	private busy = false;

	constructor(app: App, region: 'dida365' | 'ticktick', deviceVersion: string | undefined, onSave: (token: string, csrf: string) => void | Promise<void>) {
		super(app);
		this.region = region;
		this.deviceVersion = deviceVersion;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('ticktick.loginTitle') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		body.createDiv({ cls: 'dashboard-library-config-hint', text: t('ticktick.loginHint') });

		// Desktop: one-click popup login — log in normally in an embedded window,
		// the cookie is grabbed automatically. No DevTools.
		let popupStatus: HTMLElement | null = null;
		if (!Platform.isMobile) {
			const popupBtn = body.createEl('button', {
				cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
				text: t('ticktick.loginViaPopup'),
			});
			popupBtn.setCssProps({ width: '100%', marginBottom: '6px' });
			popupStatus = body.createDiv({ cls: 'dashboard-ticktick-login-status' });
			popupBtn.addEventListener('click', () => { void this.doPopupLogin(popupBtn, popupStatus!); });
		}

		// Manual fallback
		const manual = body.createDiv({ cls: 'dashboard-ticktick-manual' });
		manual.createDiv({ cls: 'dashboard-library-config-section-title', text: t('ticktick.manualTitle') });
		manual.createDiv({ cls: 'dashboard-library-config-hint', text: t('ticktick.manualHint') });
		const openBtn = manual.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('ticktick.openWeb'),
		});
		openBtn.addEventListener('click', () => {
			const url = this.region === 'ticktick' ? 'https://ticktick.com/signin' : 'https://dida365.com/signin';
			window.open(url, '_blank');
		});
		const pasteRow = manual.createDiv({ cls: 'dashboard-library-config-inline-row' });
		pasteRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: 't' });
		const pasteInput = pasteRow.createEl('input', {
			cls: 'dashboard-task-input dashboard-section-name-input',
			attr: { type: 'text', placeholder: t('ticktick.pastePlaceholder') },
		});
		const csrfRow = manual.createDiv({ cls: 'dashboard-library-config-inline-row' });
		csrfRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('ticktick.csrfLabel') });
		const csrfInput = csrfRow.createEl('input', {
			cls: 'dashboard-task-input dashboard-section-name-input',
			attr: { type: 'text', placeholder: '_csrf_token' },
		});
		const saveBtn = pasteRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		});
		saveBtn.addEventListener('click', () => {
			const token = pasteInput.value.trim();
			if (!token) return;
			void Promise.resolve(this.onSave(token, csrfInput.value.trim()));
			this.close();
		});
	}

	private async doPopupLogin(btn: HTMLElement, statusEl: HTMLElement): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		btn.addClass('is-disabled');
		statusEl.empty();
		statusEl.createDiv({ cls: 'dashboard-ticktick-login-info', text: t('ticktick.popupHint') });
		try {
			const { token, csrf } = await loginViaBrowser(this.region);
			await this.onSave(token, csrf);
			this.close();
		} catch (err) {
			statusEl.empty();
			const code = err instanceof Error ? err.message : '';
			let msg = t('ticktick.loginFailed');
			if (code === 'WINDOW_CLOSED') msg = t('ticktick.popupClosed');
			else if (code.startsWith('NO_ELECTRON') || code.startsWith('UNSUPPORTED')) {
				msg = `${t('ticktick.popupUnsupported')} (${code})`;
			}
			console.warn('[ticktick] popup login failed:', code, err);
			statusEl.createDiv({ cls: 'dashboard-ticktick-login-error', text: msg });
		} finally {
			this.busy = false;
			btn.removeClass('is-disabled');
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
