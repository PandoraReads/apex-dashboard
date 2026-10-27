/**
 * Material library settings modal: scan scope (include/exclude folders), the
 * drop-in destination for files dragged from outside the vault, and the batch
 * bar's skill buttons (agent + optional skill + prompt template — the same row
 * shape as the skills section's card buttons, plus a skill-name field since
 * material buttons are not bound to a skill card).
 */

import { App, Modal, setIcon } from 'obsidian';
import type { MaterialLibraryConfig, MaterialSkillButton } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { IconPickerModal } from './icon-picker-modal';
import { MultiFolderSelectModal } from './folder-config-modal';
import { LargeTextModal } from './large-text-modal';
import { agentTargets, agentPickerOption } from './agent-dispatch';
import { agentButtonIcon } from './skill-card-buttons-modal';
import { attachPathPicker } from './path-picker-modal';
import { normalizeImportFolder } from './material-model';

export class MaterialConfigModal extends Modal {
	private includeFolders: string[];
	private excludeFolders: string[];
	private buttons: MaterialSkillButton[];
	/** Drop-in destination ('' = Obsidian's attachment folder). */
	private importFolder: string;

	constructor(
		app: App,
		config: MaterialLibraryConfig,
		private readonly onSaved: (config: MaterialLibraryConfig) => void,
	) {
		super(app);
		this.includeFolders = [...config.includeFolders];
		this.excludeFolders = [...config.excludeFolders];
		this.buttons = config.skillButtons.map(b => ({ ...b }));
		this.importFolder = normalizeImportFolder(config.importFolder ?? '');
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const wrap = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = wrap.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('material.cfgTitle') });
		const body = wrap.createDiv({ cls: 'dashboard-modal-body' });

		// --- Scan scope ----------------------------------------------------
		const scopeSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		scopeSection.createDiv({ cls: 'dashboard-library-config-label', text: t('material.cfgInclude') });
		scopeSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('material.cfgIncludeHint') });
		const includeChips = scopeSection.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const includeRow = scopeSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const includeInput = includeRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder') },
		});
		const includeBrowse = includeRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		includeBrowse.addEventListener('click', () => {
			new MultiFolderSelectModal(this.app, this.includeFolders, folders => {
				this.includeFolders = folders;
				this.renderFolderChips(includeChips, 'include');
			}).open();
		});
		const addInclude = (): void => {
			const folder = includeInput.value.trim().replace(/^\/+|\/+$/g, '');
			includeInput.value = '';
			if (!folder || this.includeFolders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.includeFolders = [...this.includeFolders, folder];
			this.renderFolderChips(includeChips, 'include');
		};
		includeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addInclude(); } });
		this.renderFolderChips(includeChips, 'include');

		scopeSection.createDiv({ cls: 'dashboard-library-config-label', text: t('material.cfgExclude') });
		const excludeChips = scopeSection.createDiv({ cls: 'dashboard-alltasks-exclude-chips' });
		const excludeRow = scopeSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const excludeInput = excludeRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder') },
		});
		const excludeBrowse = excludeRow.createEl('button', { cls: 'dashboard-media-folder-browse', text: t('media.browseFolder') });
		excludeBrowse.addEventListener('click', () => {
			new MultiFolderSelectModal(this.app, this.excludeFolders, folders => {
				this.excludeFolders = folders;
				this.renderFolderChips(excludeChips, 'exclude');
			}).open();
		});
		const addExclude = (): void => {
			const folder = excludeInput.value.trim().replace(/^\/+|\/+$/g, '');
			excludeInput.value = '';
			if (!folder || this.excludeFolders.some(f => f.toLowerCase() === folder.toLowerCase())) return;
			this.excludeFolders = [...this.excludeFolders, folder];
			this.renderFolderChips(excludeChips, 'exclude');
		};
		excludeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addExclude(); } });
		this.renderFolderChips(excludeChips, 'exclude');

		// --- Drop-in destination (files dragged from outside the vault) -----
		const importSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		importSection.createDiv({ cls: 'dashboard-library-config-label', text: t('material.cfgImportFolder') });
		importSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('material.cfgImportFolderHint') });
		const importRow = importSection.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const importInput = importRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('media.filterFolderPlaceholder') },
		});
		importInput.value = this.importFolder;
		importInput.addEventListener('input', () => {
			this.importFolder = normalizeImportFolder(importInput.value);
		});
		attachPathPicker(importRow, importInput, this.app, 'folder', (path) => {
			this.importFolder = normalizeImportFolder(path);
		});

		// --- Skill buttons -------------------------------------------------
		const btnSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		btnSection.createDiv({ cls: 'dashboard-library-config-label', text: t('material.cfgButtons') });
		btnSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('material.cfgBtnHint') });
		const listEl = btnSection.createDiv({ cls: 'dashboard-pipeline-cfg-skills' });
		const renderButtons = (): void => {
			listEl.empty();
			if (this.buttons.length === 0) {
				listEl.createDiv({ cls: 'dashboard-library-empty', text: t('material.btnEmpty') });
				return;
			}
			this.buttons.forEach((button, index) => {
				const row = listEl.createDiv({ cls: 'dashboard-pipeline-cfg-skill' });
				const top = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
				const iconBtn = top.createEl('button', {
					cls: 'dashboard-pipeline-cfg-icon-btn',
					attr: { type: 'button', 'aria-label': t('pipeline.cfgSkillIcon') },
				});
				setIcon(iconBtn, agentButtonIcon(button.agent, button.icon));
				iconBtn.addEventListener('click', () => {
					new IconPickerModal(this.app, icon => {
						this.patchButton(index, { icon });
						setIcon(iconBtn, agentButtonIcon(button.agent, icon));
					}).open();
				});
				const label = top.createEl('input', {
					cls: 'dashboard-modal-input',
					attr: { type: 'text', placeholder: t('quickNote.fieldLabel') },
				});
				label.value = button.label;
				label.addEventListener('input', () => this.patchButton(index, { label: label.value }));
				const skillName = top.createEl('input', {
					cls: 'dashboard-modal-input',
					attr: { type: 'text', placeholder: t('material.cfgSkillName') },
				});
				skillName.value = button.skillName;
				skillName.addEventListener('input', () => this.patchButton(index, { skillName: skillName.value }));
				const agentSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
				for (const target of agentTargets()) {
					const pick = agentPickerOption(target);
					const opt = agentSel.createEl('option', { text: pick.label, attr: { value: target } });
					opt.disabled = pick.disabled;
					opt.selected = target === button.agent;
				}
				agentSel.addEventListener('change', () => this.patchButton(index, { agent: agentSel.value as MaterialSkillButton['agent'] }));
				const del = top.createEl('button', {
					cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
					attr: { type: 'button', 'aria-label': t('common.delete') },
				});
				setIcon(del, 'trash-2');
				del.addEventListener('click', () => {
					this.buttons = this.buttons.filter((_, i) => i !== index);
					renderButtons();
				});

				const tpl = row.createEl('input', {
					cls: 'dashboard-modal-input',
					attr: { type: 'text', placeholder: t('quickNote.skillTemplate') },
				});
				tpl.value = button.promptTemplate;
				tpl.addEventListener('input', () => this.patchButton(index, { promptTemplate: tpl.value }));
				const expand = row.createEl('button', {
					cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-prompt-expand',
					attr: { type: 'button', 'aria-label': t('pipeline.cfgPromptView') },
				});
				setIcon(expand, 'maximize-2');
				expand.addEventListener('click', () => {
					new LargeTextModal(this.app, t('pipeline.cfgPromptView'), tpl.value, value => {
						this.patchButton(index, { promptTemplate: value });
						tpl.value = value;
					}).open();
				});

				const directRow = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
				directRow.createSpan({ cls: 'dashboard-pipeline-cfg-hint', text: t('agent.directSend') });
				const direct = directRow.createEl('input', { cls: 'dashboard-pipeline-cfg-toggle', attr: { type: 'checkbox' } });
				direct.checked = button.directSend === true;
				direct.addEventListener('change', () => this.patchButton(index, { directSend: direct.checked }));
			});
		};
		renderButtons();
		const addBtn = btnSection.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('material.cfgBtnAdd'),
			attr: { type: 'button' },
		});
		addBtn.addEventListener('click', () => {
			this.buttons = [...this.buttons, {
				id: `mb_${Date.now().toString(36)}`,
				label: '', icon: '', agent: 'claudian', skillName: '', promptTemplate: '',
			}];
			renderButtons();
		});

		const footer = wrap.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { text: t('common.cancel'), cls: 'dashboard-modal-btn dashboard-modal-btn--cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { text: t('common.save'), cls: 'dashboard-modal-btn dashboard-modal-btn--confirm' })
			.addEventListener('click', () => this.save());
	}

	private patchButton(index: number, patch: Partial<MaterialSkillButton>): void {
		this.buttons = this.buttons.map((b, i) => i === index ? { ...b, ...patch } : b);
	}

	/** Chip row for one folder list; each chip's × removes it. */
	private renderFolderChips(host: HTMLElement, which: 'include' | 'exclude'): void {
		const folders = which === 'include' ? this.includeFolders : this.excludeFolders;
		host.empty();
		if (folders.length === 0) {
			host.createDiv({ cls: 'dashboard-library-filter-empty', text: which === 'include' ? t('folder.libraryAll') : t('folder.noFolders') });
			return;
		}
		for (const folder of folders) {
			const chip = host.createDiv({ cls: 'dashboard-alltasks-exclude-chip' });
			chip.createSpan({ text: folder });
			const x = chip.createSpan({ cls: 'dashboard-alltasks-exclude-chip-x', text: '×' });
			x.addEventListener('click', () => {
				if (which === 'include') this.includeFolders = this.includeFolders.filter(f => f !== folder);
				else this.excludeFolders = this.excludeFolders.filter(f => f !== folder);
				this.renderFolderChips(host, which);
			});
		}
	}

	private save(): void {
		this.onSaved({
			includeFolders: this.includeFolders.map(f => f.trim()).filter(Boolean),
			excludeFolders: this.excludeFolders.map(f => f.trim()).filter(Boolean),
			importFolder: this.importFolder,
			skillButtons: this.buttons.map(b => ({
				...b,
				label: b.label.trim(),
				icon: b.icon.trim(),
				skillName: b.skillName.trim(),
				promptTemplate: b.promptTemplate.trim(),
			})),
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
