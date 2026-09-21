import { App, Modal, Setting, type TextComponent } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { PathPickerModal } from './path-picker-modal';
import { normalizeTransition } from './album-widget';
import type { AlbumConfig, WidgetHeightRatio } from './types';

/** Create/edit one album widget entry. Folder via text or the vault folder
 *  picker; interval/ratio/transition mirror the legacy single-album fields;
 *  heightRatio picks the stacked-layout card size. Edits stay local until
 *  Save commits them through onSave. */
export class AlbumSettingsModal extends Modal {
	private readonly cfg: AlbumConfig;
	private readonly onSave: (cfg: AlbumConfig) => void;

	constructor(app: App, cfg: AlbumConfig, onSave: (cfg: AlbumConfig) => void) {
		super(app);
		this.cfg = { ...cfg };
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const title = container.createDiv({ cls: 'dashboard-modal-title', text: t('album.editTitle') });
		title.setCssProps({ fontSize: '1em' });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		let folderInput: TextComponent | undefined;
		new Setting(body)
			.setName(t('settings.widgetAlbumFolder'))
			.setDesc(t('settings.widgetAlbumFolderDesc'))
			.addText(text => {
				folderInput = text;
				text
					.setPlaceholder(t('settings.widgetAlbumFolderPlaceholder'))
					.setValue(this.cfg.folder)
					.onChange(v => { this.cfg.folder = v.trim().replace(/^\/+|\/+$/g, ''); });
			})
			.addExtraButton(btn => btn
				.setIcon('folder-search')
				.setTooltip(t('pathPicker.pickFolder'))
				.onClick(() => {
					new PathPickerModal(this.app, 'folder', (path) => {
						this.cfg.folder = path;
						folderInput?.setValue(path);
					}).open();
				}));

		const INTERVAL_PRESETS = [3, 5, 8, 10, 15, 30, 60];
		new Setting(body)
			.setName(t('settings.widgetAlbumInterval'))
			.setDesc(t('settings.widgetAlbumIntervalDesc'))
			.addDropdown(dropdown => {
				if (!INTERVAL_PRESETS.includes(this.cfg.intervalSec)) {
					dropdown.addOption(String(this.cfg.intervalSec), `${this.cfg.intervalSec}s`);
				}
				for (const sec of INTERVAL_PRESETS) dropdown.addOption(String(sec), `${sec}s`);
				dropdown
					.setValue(String(this.cfg.intervalSec))
					.onChange(v => { this.cfg.intervalSec = Number(v); });
			});

		new Setting(body)
			.setName(t('settings.widgetAlbumRecursive'))
			.setDesc(t('settings.widgetAlbumRecursiveDesc'))
			.addToggle(toggle => toggle
				.setValue(this.cfg.recursive)
				.onChange(v => { this.cfg.recursive = v; }));

		// The legacy frame aspect-ratio option (1:1 / 3:4) is gone: the card
		// size selector below supersedes it — the frame now fills whatever
		// height the card gets and crops via object-fit. cfg.ratio stays in
		// the data model for the side layout's natural sizing.

		new Setting(body)
			.setName(t('settings.widgetAlbumTransition'))
			.setDesc(t('settings.widgetAlbumTransitionDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('fade', t('settings.widgetAlbumTransitionFade'))
				.addOption('slide-left', t('settings.widgetAlbumTransitionSlideLeft'))
				.addOption('slide-right', t('settings.widgetAlbumTransitionSlideRight'))
				.addOption('zoom', t('settings.widgetAlbumTransitionZoom'))
				.setValue(normalizeTransition(this.cfg.transition))
				.onChange(v => { this.cfg.transition = normalizeTransition(v); }));

		new Setting(body)
			.setName(t('album.heightRatio'))
			.setDesc(t('album.heightRatioDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('full', t('album.size.full'))
				.addOption('twoThirds', t('album.size.twoThirds'))
				.addOption('half', t('album.size.half'))
				.addOption('third', t('album.size.third'))
				.setValue(this.cfg.heightRatio)
				.onChange(v => { this.cfg.heightRatio = v as WidgetHeightRatio; }));

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('common.cancel'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			text: t('common.save'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		}).addEventListener('click', () => {
			this.close();
			this.onSave(this.cfg);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
