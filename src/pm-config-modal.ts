import { App, Modal, Notice, setIcon } from 'obsidian';
import type { AgentTarget, PmConfig, PmSkill, PmStage } from './types';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { attachPathPicker } from './path-picker-modal';
import { IconPickerModal } from './icon-picker-modal';
import { agentTargets, agentPickerOption, isValidSkillName } from './agent-dispatch';
import { attachSkillPicker } from './skill-registry';
import { defaultPmStages } from './parser';

let skillSeq = 0;
function newPmSkillId(): string {
	skillSeq += 1;
	return `pms_${Date.now().toString(36)}_${skillSeq}`;
}

/**
 * PM section config: source folder + exclusions, the stage list (label +
 * color), work-note template, archive folder, and skill buttons (the
 * pipeline config's skill-card editor pattern, project-scoped). Local state
 * until Save hands a fresh PmConfig to onSave.
 */
export class PmConfigModal extends Modal {
	private rootFolder: string;
	private stages: PmStage[];
	private workNoteTemplate: string;
	private archiveFolder: string;
	private skills: PmSkill[];
	private readonly onSave: (config: PmConfig) => void;
	/** Owning plugin; present in the app, absent in verification scripts —
	 *  without it the skill-name picker button is simply omitted. */
	private readonly plugin: DashboardPlugin | null;
	private stagesEl: HTMLElement | null = null;
	private skillsEl: HTMLElement | null = null;

	constructor(app: App, config: PmConfig | undefined, onSave: (config: PmConfig) => void, plugin?: DashboardPlugin) {
		super(app);
		this.onSave = onSave;
		this.plugin = plugin ?? null;
		const cfg = config ?? { rootFolder: '', stages: defaultPmStages(), skills: [] };
		this.rootFolder = cfg.rootFolder ?? '';
		this.stages = (cfg.stages ?? []).map(stage => ({ ...stage }));
		if (this.stages.length === 0) this.stages = defaultPmStages();
		this.workNoteTemplate = cfg.workNoteTemplate ?? '';
		this.archiveFolder = cfg.archiveFolder ?? '';
		this.skills = (cfg.skills ?? []).map(skill => ({ ...skill }));
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		container.createDiv({ cls: 'dashboard-modal-header' }).createDiv({ cls: 'dashboard-modal-title', text: t('pm.cfgTitle') });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Source: root folder + exclusions.
		const source = body.createDiv({ cls: 'dashboard-library-config-section' });
		source.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pm.cfgSource') });
		const rootRow = source.createDiv({ cls: 'dashboard-library-config-inline-row' });
		rootRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pm.cfgRoot') });
		const rootInput = rootRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('pm.cfgRootHint') },
		});
		rootInput.value = this.rootFolder;
		attachPathPicker(rootRow, rootInput, this.app, 'folder', (path) => { this.rootFolder = path; });
		rootInput.addEventListener('change', () => { this.rootFolder = rootInput.value; });

		// Stages: label + color rows.
		const stagesSec = body.createDiv({ cls: 'dashboard-library-config-section' });
		stagesSec.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pm.cfgStages') });
		stagesSec.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pm.cfgStageHint') });
		this.stagesEl = stagesSec.createDiv({ cls: 'dashboard-pmsec-cfg-stages' });
		this.renderStages();
		const addStage = stagesSec.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pm.cfgAddStage') });
		addStage.addEventListener('click', () => {
			this.stages = [...this.stages, { label: '' }];
			this.renderStages();
		});

		// Work-note template + archive folder.
		const paths = body.createDiv({ cls: 'dashboard-library-config-section' });
		const tplRow = paths.createDiv({ cls: 'dashboard-library-config-inline-row' });
		tplRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pm.cfgWorkNoteTemplate') });
		const tplInput = tplRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: 'Templates/工作笔记 (optional)' },
		});
		tplInput.value = this.workNoteTemplate;
		attachPathPicker(tplRow, tplInput, this.app, 'file', (path) => { this.workNoteTemplate = path; });
		tplInput.addEventListener('change', () => { this.workNoteTemplate = tplInput.value; });

		const archiveRow = paths.createDiv({ cls: 'dashboard-library-config-inline-row' });
		archiveRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pm.cfgArchiveFolder') });
		const archiveInput = archiveRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: '项目管理/99-归档 (optional)' },
		});
		archiveInput.value = this.archiveFolder;
		attachPathPicker(archiveRow, archiveInput, this.app, 'folder', (path) => { this.archiveFolder = path; });
		archiveInput.addEventListener('change', () => { this.archiveFolder = archiveInput.value; });

		// Skill buttons (pipeline's card editor pattern, project-scoped).
		const skillsSec = body.createDiv({ cls: 'dashboard-library-config-section' });
		skillsSec.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pm.cfgSkills') });
		this.skillsEl = skillsSec.createDiv({ cls: 'dashboard-pmsec-cfg-skills' });
		this.renderSkills();
		const addSkill = skillsSec.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pm.cfgAddSkill') });
		addSkill.addEventListener('click', () => {
			this.skills = [...this.skills, {
				id: newPmSkillId(), label: '', icon: 'sparkles', agent: 'claudian',
				skillName: '', promptTemplate: '',
			}];
			this.renderSkills();
		});

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') })
			.addEventListener('click', () => { void this.save(); });
	}

	private renderStages(): void {
		const host = this.stagesEl;
		if (!host) return;
		host.empty();
		this.stages.forEach((stage, index) => {
			const row = host.createDiv({ cls: 'dashboard-pipeline-cfg-stage-row' });
			const label = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pm.cfgStageLabel') },
			});
			label.value = stage.label;
			label.addEventListener('input', () => { this.stages[index] = { ...stage, label: label.value }; });
			const color = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-color',
				attr: { type: 'color', title: t('pm.cfgStageLabel') },
			});
			color.value = stage.color || '#8b7cf6';
			color.addEventListener('input', () => { this.stages[index] = { ...stage, color: color.value }; });
			const del = row.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => {
				this.stages = this.stages.filter((_, i) => i !== index);
				this.renderStages();
			});
		});
	}

	private renderSkills(): void {
		const host = this.skillsEl;
		if (!host) return;
		host.empty();
		if (this.skills.length === 0) {
			host.createDiv({ cls: 'dashboard-library-empty', text: t('pm.cfgAddSkill') });
			return;
		}
		this.skills.forEach((skill, index) => {
			const card = host.createDiv({ cls: 'dashboard-pipeline-cfg-skill' });
			const top = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const iconBtn = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn',
				attr: { type: 'button', 'aria-label': t('pm.cfgSkillIcon'), title: skill.icon || 'sparkles' },
			});
			setIcon(iconBtn, skill.icon || 'sparkles');
			iconBtn.addEventListener('click', () => {
				new IconPickerModal(this.app, (icon) => {
					this.skills[index] = { ...skill, icon };
					setIcon(iconBtn, icon || 'sparkles');
					iconBtn.title = icon || 'sparkles';
				}).open();
			});
			const label = top.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pm.cfgSkillLabel') },
			});
			label.value = skill.label;
			label.addEventListener('input', () => { this.skills[index] = { ...skill, label: label.value }; });

			const agentSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const target of agentTargets()) {
				const pick = agentPickerOption(target);
				const opt = agentSel.createEl('option', { text: pick.label, attr: { value: target } }) as HTMLOptionElement;
				opt.disabled = pick.disabled;
			}
			agentSel.value = skill.agent;
			agentSel.addEventListener('change', () => { this.skills[index] = { ...skill, agent: agentSel.value as AgentTarget }; });

			const nameRow = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const name = nameRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pm.cfgSkillName') },
			});
			name.value = skill.skillName;
			name.addEventListener('input', () => { this.skills[index] = { ...skill, skillName: name.value }; });
			if (this.plugin) {
				attachSkillPicker(nameRow, name, this.app, {
					plugin: this.plugin,
					getAgent: () => this.skills[index]?.agent ?? 'claudian',
				}, (skillName) => { this.skills[index] = { ...skill, skillName }; });
			}

			const tplRow = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const tpl = tplRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: `${t('pm.cfgSkillTemplate')} — {path} {title} {folder} {input}` },
			});
			tpl.value = skill.promptTemplate;
			tpl.addEventListener('input', () => { this.skills[index] = { ...skill, promptTemplate: tpl.value }; });

			// Per-skill direct send. NOTE the class placement: the toggle
			// class belongs on the CHECKBOX (it sizes it 16px) — wrapping a
			// label + checkbox in a div wearing it squeezes them vertical.
			// Pipeline's inline-row structure is the pattern.
			const sendRow = card.createDiv({ cls: 'dashboard-library-config-inline-row' });
			sendRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('agent.directSend') });
			const direct = sendRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-toggle',
				attr: { type: 'checkbox' },
			}) as HTMLInputElement;
			direct.checked = skill.directSend === true;
			direct.addEventListener('change', () => { this.skills[index] = { ...skill, directSend: direct.checked }; });

			const del = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => {
				this.skills = this.skills.filter((_, i) => i !== index);
				this.renderSkills();
			});
		});
	}

	private async save(): Promise<void> {
		const stages = this.stages
			.map(stage => ({ label: stage.label.trim(), ...(stage.color ? { color: stage.color } : {}) }))
			.filter(stage => stage.label);
		if (stages.length === 0) {
			new Notice(t('pm.cfgNeedStage'));
			return;
		}
		for (const skill of this.skills) {
			if (skill.skillName.trim() && !isValidSkillName(skill.skillName.trim())) {
				new Notice(t('pm.cfgBadSkillName', { name: skill.skillName }));
				return;
			}
		}
		const skills = this.skills
			.filter(skill => skill.label.trim())
			.map(skill => ({
				...skill,
				id: skill.id || newPmSkillId(),
				label: skill.label.trim(),
				skillName: skill.skillName.trim(),
			}));
		this.onSave({
			rootFolder: this.rootFolder.trim(),
			stages,
			...(this.workNoteTemplate.trim() ? { workNoteTemplate: this.workNoteTemplate.trim() } : {}),
			...(this.archiveFolder.trim() ? { archiveFolder: this.archiveFolder.trim() } : {}),
			...(skills.length > 0 ? { skills } : {}),
		});
		this.close();
	}
}
