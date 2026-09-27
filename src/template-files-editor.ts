import type { App } from 'obsidian';
import { t } from './i18n';
import { PathPickerModal } from './path-picker-modal';

/**
 * Reusable multi-template editor for section config modals: selected template
 * chips (each removable), a manual path input with an add button, and a file
 * browser. State is owned by the editor; the caller reads `value` on save, so
 * cancelling the modal discards edits without touching the stored config.
 *
 * Mirrors {@link ExcludeFoldersEditor}'s chips pattern, but for vault files:
 * a section's "new note" can seed from any of several templates — the toolbar
 * button then offers a menu (the first entry is the default).
 *
 * Renders into an existing section container — the caller provides the titled
 * `dashboard-library-config-section` wrapper (title + hint), this fills in the
 * chips row and the add row beneath it.
 */
export class TemplateFilesEditor {
	private templates: string[];
	private readonly app: App;

	constructor(app: App, host: HTMLElement, initial: readonly string[], opts?: { placeholder?: string }) {
		this.app = app;
		this.templates = [...initial];

		const chipsHost = host.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const addRow = host.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const pathInput = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: opts?.placeholder ?? 'Templates/note.md' },
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
			new PathPickerModal(this.app, 'file', (path) => {
				if (!path) return;
				if (this.templates.some(p => p.toLowerCase() === path.toLowerCase())) return;
				this.templates = [...this.templates, path];
				renderChips();
			}).open();
		});

		const addTemplate = (): void => {
			const tpl = pathInput.value.trim();
			pathInput.value = '';
			if (!tpl) return;
			if (this.templates.some(p => p.toLowerCase() === tpl.toLowerCase())) return;
			this.templates = [...this.templates, tpl];
			renderChips();
		};
		addBtn.addEventListener('click', addTemplate);
		pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTemplate(); } });

		const renderChips = (): void => {
			chipsHost.empty();
			if (this.templates.length === 0) {
				chipsHost.createDiv({ cls: 'dashboard-library-filter-empty', text: t('library.noTemplates') });
				return;
			}
			// Order is meaningful (the first entry is the default), so the first
			// chip carries a marker instead of reordering on interactions.
			this.templates.forEach((tpl, i) => {
				const chip = chipsHost.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
				chip.createSpan({ text: i === 0 ? `${tpl}${t('library.templateDefaultTag')}` : tpl });
				const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
				x.addEventListener('click', () => {
					this.templates = this.templates.filter(p => p !== tpl);
					renderChips();
				});
			});
		};
		renderChips();
	}

	/** The current selection (a copy, order preserved); empty array = bare note. */
	get value(): string[] {
		return [...this.templates];
	}
}
