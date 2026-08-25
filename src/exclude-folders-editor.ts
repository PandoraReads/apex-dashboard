import type { App } from 'obsidian';
import { t } from './i18n';
import { MultiFolderSelectModal } from './folder-config-modal';

/**
 * Reusable "excluded folders" editor block for section config modals: selected
 * folder chips (each removable), a manual path input, and a multi-select folder
 * browser. State is owned by the editor; the caller reads `value` on save, so
 * cancelling the modal discards edits without touching the stored config.
 *
 * Renders into an existing section container — the caller provides the titled
 * `dashboard-library-config-section` wrapper (title + hint), this fills in the
 * chips row and the add row beneath it.
 */
export class ExcludeFoldersEditor {
	private folders: string[];
	private readonly app: App;

	constructor(app: App, host: HTMLElement, initial: readonly string[]) {
		this.app = app;
		this.folders = [...initial];

		const chipsHost = host.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const addRow = host.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const pathInput = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('exclude.folderPlaceholder') },
		});
		const browseBtn = addRow.createEl('button', {
			cls: 'dashboard-media-folder-browse',
			text: t('folder.browse'),
		});
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.add'),
		});

		browseBtn.addEventListener('click', () => {
			// Multi-select picker: manage the whole excluded set in one place.
			// parentCoversChildren: exclusions match by path prefix, so checking a
			// parent already covers its subfolders.
			new MultiFolderSelectModal(this.app, this.folders, (folders) => {
				this.folders = folders;
				renderChips();
			}, { parentCoversChildren: true }).open();
		});

		const addFolder = (): void => {
			const folder = pathInput.value.trim().replace(/^\/+|\/+$/g, '');
			pathInput.value = '';
			if (!folder) return;
			if (this.folders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.folders = [...this.folders, folder];
			renderChips();
		};
		addBtn.addEventListener('click', addFolder);
		pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFolder(); } });

		const renderChips = (): void => {
			chipsHost.empty();
			if (this.folders.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('folder.noFolders') });
				return;
			}
			for (const folder of this.folders) {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: folder });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					this.folders = this.folders.filter(f => f !== folder);
					renderChips();
				});
			}
		};
		renderChips();
	}

	/** The current selection (a copy); empty array = nothing excluded. */
	get value(): string[] {
		return [...this.folders];
	}
}
