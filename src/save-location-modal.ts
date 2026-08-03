import { App, Modal, setIcon } from 'obsidian';
import type { TodoSaveLocation } from './types';
import { t } from './i18n';

/**
 * Save-location picker shown when a todo card's save button is clicked.
 * Lists every configured TodoSaveLocation.
 */

export type SaveTarget = { kind: 'location'; location: TodoSaveLocation };

export class SaveLocationPickerModal extends Modal {
	private readonly locations: TodoSaveLocation[];
	private readonly onPick: (target: SaveTarget) => void;
	private readonly theme: string;

	constructor(app: App, locations: TodoSaveLocation[], onPick: (target: SaveTarget) => void, theme?: string) {
		super(app);
		this.locations = locations;
		this.onPick = onPick;
		this.theme = theme ?? 'earth';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const header = contentEl.createDiv({ cls: 'template-modal-header' });
		header.createEl('h2', { text: t('saveLoc.pickTitle') });

		const list = contentEl.createDiv({ cls: 'template-modal-list' });

		for (const loc of this.locations) {
			const target = [loc.folder, loc.file].filter(Boolean).join('/') + '.md'
				+ (loc.heading ? ` › ${loc.heading}` : ` › ${t('settings.saveLocFileTop')}`);
			const item = list.createDiv({ cls: 'template-modal-item dashboard-save-target-item' });
			const iconEl = item.createDiv({ cls: 'dashboard-save-target-icon' });
			setIcon(iconEl, 'file-down');
			const info = item.createDiv({ cls: 'template-modal-item-info' });
			info.createDiv({ cls: 'template-modal-item-name', text: loc.name || loc.file });
			info.createDiv({ cls: 'template-modal-item-count', text: target });
			item.addEventListener('click', () => {
				this.onPick({ kind: 'location', location: loc });
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
