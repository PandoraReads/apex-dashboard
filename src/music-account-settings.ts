import { Notice, Platform, Setting } from 'obsidian';
import { getMusicService } from './music-service';
import { t } from './i18n';

export function renderMusicAccountSettings(container: HTMLElement): void {
	const service = getMusicService();
	if (!service) return;
	// Sign-in opens an Electron BrowserWindow; phones and tablets have no
	// Electron, so the account rows would only ever show failed notices there.
	if (Platform.isMobile) return;
	const host = container.createDiv();
	let busy = false;
	const render = (): void => {
		host.empty();
		new Setting(host)
			.setName(t('music.accountTitle'))
			.setDesc(t(service.account.loggedIn ? 'music.accountSignedIn' : 'music.accountSignedOut'))
			.addButton(button => button.setButtonText(t('music.accountLogin')).setDisabled(busy)
				.onClick(async () => {
					if (busy) return;
					busy = true;
					render();
					try { await service.login(); new Notice(t('music.accountSuccess')); }
					catch (error) {
						if (!(error instanceof Error && error.message === 'CANCELLED')) new Notice(t('music.accountFailed'));
					} finally { busy = false; render(); }
				}))
			.addButton(button => button.setButtonText(t('music.accountLogout')).setDisabled(busy)
				.onClick(async () => {
					if (busy) return;
					busy = true;
					render();
					try { await service.logout(); }
					catch { new Notice(t('music.accountLogoutFailed')); }
					finally { busy = false; render(); }
				}));
	};
	render();
}
