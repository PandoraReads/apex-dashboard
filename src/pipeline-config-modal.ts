import { App, Modal, Notice, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import type { AgentTarget, PipelineConfig, PipelineSkill, PipelineStage } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { attachPathPicker } from './path-picker-modal';
import { IconPickerModal } from './icon-picker-modal';
import { agentTargets, agentPickerOption, isValidSkillName } from './agent-dispatch';
import { attachSkillPicker } from './skill-registry';
import { ExcludeFoldersEditor } from './exclude-folders-editor';
import { normalizeExcludeFolders } from './exclude-folders';
import { VisiblePropertiesEditor } from './visible-properties-editor';
import { defaultPipelineStages, normalizeFolderPath } from './pipeline-model';

let skillSeq = 0;
function newSkillId(): string {
	skillSeq += 1;
	return `sk_${Date.now().toString(36)}_${skillSeq}`;
}

/**
 * Config modal for a pipeline section: source folder + status field, the
 * ordered stage list (label / status value / archive folder / color), the
 * skill buttons (per stage, card- or stage-scoped, agent + prompt), the
 * new-item template and the direct-send toggle. RssConfigModal's row-editor
 * idiom: state is local until Save hands a fresh config to onSave.
 */
export class PipelineConfigModal extends Modal {
	private rootFolder: string;
	private statusField: string;
	private stages: PipelineStage[];
	private skills: PipelineSkill[];
	private templatePath: string;
	private archiveFolder: string;
	private excludeFolders: string[];
	private cardProperties: string[];
	private boardStyle: 'theme' | 'trello' | 'solid' | 'blush';
	private filterFields: string[];
	private readonly onSave: (config: PipelineConfig) => void;
	/** Owning plugin; present in the app, absent in verification scripts.
	 *  Without it the skill-name picker button is simply omitted. */
	private readonly plugin: DashboardPlugin | null;
	private stagesEl: HTMLElement | null = null;
	private skillsEl: HTMLElement | null = null;
	private excludeEditor: ExcludeFoldersEditor | null = null;
	private propertiesEditor: VisiblePropertiesEditor | null = null;
	private filterEditor: VisiblePropertiesEditor | null = null;

	constructor(app: App, config: PipelineConfig | undefined, onSave: (config: PipelineConfig) => void, plugin?: DashboardPlugin) {
		super(app);
		this.onSave = onSave;
		this.plugin = plugin ?? null;
		const cfg = config ?? {
			rootFolder: '',
			statusField: 'status',
			stages: defaultPipelineStages({
				idea: t('pipeline.stageIdea'),
				draft: t('pipeline.stageDraft'),
				review: t('pipeline.stageReview'),
				pending: t('pipeline.stagePending'),
				retro: t('pipeline.stageRetro'),
			}),
			skills: [],
		};
		this.rootFolder = cfg.rootFolder ?? '';
		this.statusField = cfg.statusField || 'status';
		this.stages = (cfg.stages ?? []).map(stage => ({ ...stage }));
		// Resolve each skill's direct-send once from the legacy section-wide
		// flag (configs saved before the per-skill split), so the per-skill
		// checkboxes show the effective state and saving persists it per
		// skill — the section flag itself stops being written.
		this.skills = (cfg.skills ?? []).map(skill => ({ ...skill, directSend: skill.directSend ?? cfg.directSend === true }));
		this.templatePath = cfg.templatePath ?? '';
		this.archiveFolder = cfg.archiveFolder ?? '';
		this.excludeFolders = [...(cfg.excludeFolders ?? [])];
		this.cardProperties = [...(cfg.cardProperties ?? [])];
		this.boardStyle = cfg.boardStyle === 'theme' ? 'theme' : (cfg.boardStyle ?? 'trello');
		this.filterFields = [...(cfg.filterFields ?? [])];
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('pipeline.cfgTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Source: root folder + status field.
		const source = body.createDiv({ cls: 'dashboard-library-config-section' });
		source.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pipeline.cfgSource') });
		const rootRow = source.createDiv({ cls: 'dashboard-library-config-inline-row' });
		rootRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgRoot') });
		const rootInput = rootRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('pipeline.cfgRootHint') },
		});
		rootInput.value = this.rootFolder;
		attachPathPicker(rootRow, rootInput, this.app, 'folder', (path) => { this.rootFolder = path; });
		rootInput.addEventListener('change', () => { this.rootFolder = rootInput.value; });

		const fieldRow = source.createDiv({ cls: 'dashboard-library-config-inline-row' });
		fieldRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgStatusField') });
		const fieldInput = fieldRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: 'status' },
		});
		fieldInput.value = this.statusField;
		fieldInput.addEventListener('change', () => {
			this.statusField = fieldInput.value.trim() || 'status';
			fieldInput.value = this.statusField;
		});
		source.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgStatusFieldHint') });

		// Excluded folders: templates / archives under the root never board.
		const excludeHost = source.createDiv({ cls: 'dashboard-library-config-section-sub' });
		excludeHost.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgExclude') });
		this.excludeEditor = new ExcludeFoldersEditor(this.app, excludeHost, this.excludeFolders);

		// Stages.
		const stagesSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		stagesSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pipeline.cfgStages') });
		stagesSection.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgStageHint') });
		const head = stagesSection.createDiv({ cls: 'dashboard-pipeline-cfg-stage-head' });
		head.createDiv({ cls: 'dashboard-pipeline-cfg-head-cell', text: t('pipeline.cfgHeadLabel') });
		head.createDiv({ cls: 'dashboard-pipeline-cfg-head-cell dashboard-pipeline-cfg-head-cell--slug', text: t('pipeline.cfgHeadValue') });
		head.createDiv({ cls: 'dashboard-pipeline-cfg-head-cell', text: t('pipeline.cfgHeadFolder') });
		this.stagesEl = stagesSection.createDiv({ cls: 'dashboard-pipeline-cfg-stages' });
		this.renderStages();
		const addStageBtn = stagesSection.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('pipeline.cfgAddStage'),
			attr: { type: 'button' },
		});
		addStageBtn.addEventListener('click', () => {
			this.stages = [...this.stages, { value: '', label: '', color: '#a9a69c' }];
			this.renderStages();
			this.renderSkills();
		});

		// Skills.
		const skillsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		skillsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pipeline.cfgSkills') });
		this.skillsEl = skillsSection.createDiv({ cls: 'dashboard-pipeline-cfg-skills' });
		this.renderSkills();
		const addSkillBtn = skillsSection.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('pipeline.cfgAddSkill'),
			attr: { type: 'button' },
		});
		addSkillBtn.addEventListener('click', () => {
			const stage = this.stages[0];
			this.skills = [...this.skills, {
				id: newSkillId(),
				label: '',
				icon: 'sparkles',
				agent: 'claudian',
				stage: stage ? stage.value : '',
				scope: 'card',
				skillName: '',
				promptTemplate: '',
				directSend: false,
			}];
			this.renderSkills();
		});

		// Card display: which frontmatter keys render as chips (empty = the
		// default platform + tags set). No grouping options by design — the
		// board's columns ARE the grouping.
		const display = body.createDiv({ cls: 'dashboard-library-config-section' });
		display.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pipeline.cfgDisplay') });
		const styleRow = display.createDiv({ cls: 'dashboard-library-config-inline-row' });
		styleRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgBoardStyle') });
		const styleSel = styleRow.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
		for (const [value, key] of [['theme', 'pipeline.cfgStyleTheme'], ['trello', 'pipeline.cfgStyleTrello'], ['solid', 'pipeline.cfgStyleSolid'], ['blush', 'pipeline.cfgStyleBlush']] as const) {
			const opt = styleSel.createEl('option', { text: t(key), attr: { value } }) as HTMLOptionElement;
			opt.selected = value === this.boardStyle;
		}
		styleSel.addEventListener('change', () => {
			const picked = styleSel.value;
			this.boardStyle = picked === 'trello' || picked === 'solid' || picked === 'blush' ? picked : 'theme';
		});
		this.propertiesEditor = new VisiblePropertiesEditor(this.app, display, this.cardProperties);

		// Filter dimensions: which properties the left rail offers (empty =
		// the built-in 平台 + 项目 pair).
		const filterHost = display.createDiv({ cls: 'dashboard-library-config-section-sub' });
		filterHost.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgFilterFields') });
		this.filterEditor = new VisiblePropertiesEditor(this.app, filterHost, this.filterFields);
		filterHost.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgFilterFieldsHint') });

		// New-item template (direct send is a per-skill toggle in each skill
		// card, not a section-wide switch).
		const misc = body.createDiv({ cls: 'dashboard-library-config-section' });
		misc.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pipeline.cfgNewNote') });
		const archiveRow = misc.createDiv({ cls: 'dashboard-library-config-inline-row' });
		archiveRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgArchiveFolder') });
		const archiveInput = archiveRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('pipeline.cfgArchiveFolderPh') },
		});
		archiveInput.value = this.archiveFolder;
		attachPathPicker(archiveRow, archiveInput, this.app, 'folder', (path) => { this.archiveFolder = path; });
		archiveInput.addEventListener('change', () => { this.archiveFolder = archiveInput.value.trim(); });

		const tplRow = misc.createDiv({ cls: 'dashboard-library-config-inline-row' });
		tplRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgTemplate') });
		const tplInput = tplRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('pipeline.cfgTemplateHint') },
		});
		tplInput.value = this.templatePath;
		attachPathPicker(tplRow, tplInput, this.app, 'file', (path) => { this.templatePath = path; });
		tplInput.addEventListener('change', () => { this.templatePath = tplInput.value.trim(); });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => this.trySave());
	}

	/** Patch one stage/skill from its CURRENT state (not the render-time
	 *  snapshot): every field listener closes over the row as rendered, so
	 *  spreading the captured object here would silently revert fields the
	 *  user edited earlier in the same row — the "skill vanishes on save"
	 *  bug (the emptied label made the save filter drop the row). */
	private patchStage(index: number, patch: Partial<PipelineStage>): void {
		this.stages = this.stages.map((s, i) => i === index ? { ...s, ...patch } : s);
	}

	private patchSkill(index: number, patch: Partial<PipelineSkill>): void {
		this.skills = this.skills.map((s, i) => i === index ? { ...s, ...patch } : s);
	}

	private renderStages(): void {
		const host = this.stagesEl;
		if (!host) return;
		host.empty();
		this.stages.forEach((stage, index) => {
			const row = host.createDiv({ cls: 'dashboard-pipeline-cfg-stage-row' });
			const label = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pipeline.cfgStageLabel') },
			});
			label.value = stage.label;
			label.addEventListener('input', () => { this.patchStage(index, { label: label.value }); });
			const value = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input dashboard-pipeline-cfg-input--slug',
				attr: { type: 'text', placeholder: t('pipeline.cfgStageValue') },
			});
			value.value = stage.value;
			value.addEventListener('input', () => { this.patchStage(index, { value: value.value.trim() }); });
			const folder = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pipeline.cfgStageFolder') },
			});
			folder.value = stage.folder ?? '';
			folder.addEventListener('input', () => {
				this.patchStage(index, { folder: folder.value.trim() ? folder.value.trim() : undefined });
			});
			const color = row.createEl('input', {
				cls: 'dashboard-pipeline-cfg-color',
				attr: { type: 'color' },
			}) as HTMLInputElement;
			color.value = stage.color || '#a9a69c';
			color.addEventListener('input', () => { this.patchStage(index, { color: color.value }); });

			this.attachReorder(row, index, count => {
				this.stages = moveItem(this.stages, index, count);
				this.renderStages();
			});
			this.attachRemove(row, () => {
				this.stages = this.stages.filter((_, i) => i !== index);
				this.renderStages();
				this.renderSkills();
			});
		});
	}

	private renderSkills(): void {
		const host = this.skillsEl;
		if (!host) return;
		host.empty();
		if (this.stages.length === 0) {
			host.createDiv({ cls: 'dashboard-library-empty', text: t('pipeline.cfgNeedStage') });
			return;
		}
		this.skills.forEach((skill, index) => {
			const card = host.createDiv({ cls: 'dashboard-pipeline-cfg-skill' });

			const top = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const iconBtn = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn',
				attr: { type: 'button', 'aria-label': t('pipeline.cfgSkillIcon'), title: skill.icon || 'sparkles' },
			});
			setIcon(iconBtn, skill.icon || 'sparkles');
			iconBtn.addEventListener('click', () => {
				new IconPickerModal(this.app, (icon) => {
					this.patchSkill(index, { icon });
					setIcon(iconBtn, icon || 'sparkles');
					iconBtn.title = icon || 'sparkles';
				}).open();
			});
			const label = top.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input',
				attr: { type: 'text', placeholder: t('pipeline.cfgSkillLabel') },
			});
			label.value = skill.label;
			label.addEventListener('input', () => { this.patchSkill(index, { label: label.value }); });

			const stageSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const stage of this.stages) {
				const opt = stageSel.createEl('option', {
					text: stage.label || stage.value || t('pipeline.cfgStageValue'),
					attr: { value: stage.value },
				}) as HTMLOptionElement;
				opt.selected = stage.value === skill.stage;
			}
			stageSel.addEventListener('change', () => { this.patchSkill(index, { stage: stageSel.value }); });

			const scopeSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const [value, key] of [['card', 'pipeline.cfgScopeCard'], ['stage', 'pipeline.cfgScopeStage']] as const) {
				const opt = scopeSel.createEl('option', { text: t(key), attr: { value } }) as HTMLOptionElement;
				opt.selected = value === skill.scope;
			}
			scopeSel.addEventListener('change', () => {
				this.patchSkill(index, { scope: scopeSel.value === 'stage' ? 'stage' : 'card' });
			});

			const agentSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const target of agentTargets()) {
				const pick = agentPickerOption(target);
				const opt = agentSel.createEl('option', {
					text: pick.label,
					attr: { value: target },
				}) as HTMLOptionElement;
				opt.disabled = pick.disabled;
				opt.selected = target === skill.agent;
			}
			agentSel.addEventListener('change', () => {
				this.patchSkill(index, { agent: agentSel.value as AgentTarget });
			});

			this.attachRemove(top, () => {
				this.skills = this.skills.filter((_, i) => i !== index);
				this.renderSkills();
			});

			const mid = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const nameRow = mid.createDiv({ cls: 'dashboard-pipeline-cfg-name-row' });
			const nameInput = nameRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-input dashboard-pipeline-cfg-input--slug',
				attr: { type: 'text', placeholder: t('pipeline.cfgSkillName') },
			});
			nameInput.value = skill.skillName;
			nameInput.addEventListener('input', () => { this.patchSkill(index, { skillName: nameInput.value.trim() }); });
			if (this.plugin) {
				attachSkillPicker(nameRow, nameInput, this.app, {
					plugin: this.plugin,
					getAgent: () => this.skills[index]?.agent ?? 'claudian',
				}, name => { this.patchSkill(index, { skillName: name }); });
			}
			mid.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgSkillNameHint') });
			// Supplemental input needs no per-skill config: the preview modal
			// always carries its own input box (default hint).

			const bottom = card.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const tpl = bottom.createEl('textarea', {
				cls: 'dashboard-pipeline-cfg-textarea',
				attr: { rows: '2', placeholder: t('pipeline.cfgSkillTemplate') },
			});
			tpl.value = skill.promptTemplate;
			tpl.addEventListener('input', () => { this.patchSkill(index, { promptTemplate: tpl.value }); });
			bottom.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgSkillTemplateHint') });

			// Per-skill direct send (replaces the old section-wide toggle):
			// checked = fire immediately on click, no preview dialog.
			const sendRow = card.createDiv({ cls: 'dashboard-library-config-inline-row' });
			sendRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pipeline.cfgSkillDirectSend') });
			const sendToggle = sendRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-toggle',
				attr: { type: 'checkbox' },
			}) as HTMLInputElement;
			sendToggle.checked = skill.directSend === true;
			sendToggle.addEventListener('change', () => { this.patchSkill(index, { directSend: sendToggle.checked }); });
			sendRow.createDiv({ cls: 'dashboard-pipeline-cfg-hint', text: t('pipeline.cfgSkillDirectSendHint') });
		});
	}

	private attachReorder(row: HTMLElement, index: number, move: (count: number) => void): void {
		const up = row.createEl('button', {
			cls: 'dashboard-pipeline-cfg-icon-btn',
			attr: { type: 'button', 'aria-label': t('common.drag'), title: t('common.drag') },
		});
		setIcon(up, 'chevron-up');
		up.addEventListener('click', () => move(-1));
		const down = row.createEl('button', {
			cls: 'dashboard-pipeline-cfg-icon-btn',
			attr: { type: 'button', 'aria-label': t('common.drag'), title: t('common.drag') },
		});
		setIcon(down, 'chevron-down');
		down.addEventListener('click', () => move(1));
	}

	private attachRemove(row: HTMLElement, onRemove: () => void): void {
		const del = row.createEl('button', {
			cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
			attr: { type: 'button', 'aria-label': t('common.delete'), title: t('common.delete') },
		});
		setIcon(del, 'trash-2');
		del.addEventListener('click', onRemove);
	}

	private trySave(): void {
		const stages = this.stages
			.map(stage => ({ ...stage, label: stage.label.trim(), value: stage.value.trim(), folder: normalizeFolderPath(stage.folder ?? '') || undefined }))
			.filter(stage => stage.label || stage.value);
		if (stages.length === 0) {
			new Notice(t('pipeline.cfgNeedStage'));
			return;
		}
		const seen = new Set<string>();
		for (const stage of stages) {
			if (!stage.label || !stage.value) {
				new Notice(t('pipeline.cfgStageIncomplete'));
				return;
			}
			const key = stage.value.toLowerCase();
			if (seen.has(key)) {
				new Notice(t('pipeline.cfgDupStageValue', { value: stage.value }));
				return;
			}
			seen.add(key);
		}
		for (const skill of this.skills) {
			if (skill.skillName && !isValidSkillName(skill.skillName)) {
				new Notice(t('pipeline.cfgBadSkillName', { name: skill.skillName }));
				return;
			}
			if (!stages.some(stage => stage.value === skill.stage)) {
				new Notice(t('pipeline.cfgSkillStageMissing', { label: skill.label || skill.skillName }));
				return;
			}
		}
		const config: PipelineConfig = {
			rootFolder: normalizeFolderPath(this.rootFolder),
			statusField: this.statusField.trim() || 'status',
			stages,
			// Rows the user started but left unlabeled are dropped, not saved
			// as dead buttons.
			skills: this.skills
				.filter(skill => skill.label.trim().length > 0)
				.map(skill => ({ ...skill, label: skill.label.trim() })),
			...(this.boardStyle !== 'theme' ? { boardStyle: this.boardStyle } : {}),
			...(() => {
				const filterFields = [...new Set((this.filterEditor?.value ?? this.filterFields).map(f => f.trim()).filter(f => f.length > 0))];
				return filterFields.length > 0 ? { filterFields } : {};
			})(),
			...(this.templatePath ? { templatePath: this.templatePath } : {}),
			...(normalizeFolderPath(this.archiveFolder) ? { archiveFolder: normalizeFolderPath(this.archiveFolder) } : {}),
			...(() => {
				const excludeFolders = normalizeExcludeFolders(this.excludeEditor?.value ?? this.excludeFolders);
				return excludeFolders.length > 0 ? { excludeFolders } : {};
			})(),
			...(() => {
				const cardProperties = (this.propertiesEditor?.value ?? this.cardProperties).map(p => p.trim()).filter(p => p.length > 0);
				return cardProperties.length > 0 ? { cardProperties } : {};
			})(),
		};
		this.onSave(config);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Immutable single-slot move (keeps the coding-style no-mutation rule). */
function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
	const target = index + delta;
	if (target < 0 || target >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	if (item === undefined) return [...list];
	next.splice(target, 0, item);
	return next;
}
