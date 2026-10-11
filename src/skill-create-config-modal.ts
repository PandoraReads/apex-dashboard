/**
 * One-time config for the section header's "new skill" button: which agent
 * runs the creator skill, the skill's name (picker-fed), an optional prompt
 * template, and a direct-send opt-out (off by default — Rae: the confirm
 * dialog stays unless explicitly skipped). Saving hands the config back;
 * the caller (view.ts) persists it and fires the first run.
 */

import { App, Modal } from 'obsidian';
import type { AgentTarget, SkillCreateConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { agentPickerOption, agentTargets, isValidSkillName } from './agent-dispatch';
import { attachSkillPicker } from './skill-registry';
import type DashboardPlugin from './main';

export class SkillCreateConfigModal extends Modal {
	private agent: AgentTarget;
	private skillName: string;
	private promptTemplate: string;
	private directSend: boolean;
	private validationEl: HTMLElement | null = null;
	private confirmBtn: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private readonly plugin: DashboardPlugin,
		existing: SkillCreateConfig | undefined,
		private readonly onSave: (config: SkillCreateConfig) => void,
	) {
		super(app);
		this.agent = existing?.agent ?? 'claudian';
		this.skillName = existing?.skillName ?? 'skill-creator';
		this.promptTemplate = existing?.promptTemplate ?? '';
		this.directSend = existing?.directSend ?? false;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-skillsec-createcfg-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-skillsec-createcfg' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skills.createCfgTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.createCfgHint') });

		const agentRow = body.createDiv({ cls: 'dashboard-skillsec-createcfg-row' });
		agentRow.createSpan({ cls: 'dashboard-skillsec-createcfg-label', text: t('skills.createCfgAgent') });
		const agentSel = agentRow.createEl('select', { cls: 'dashboard-library-filter-property' });
		for (const target of agentTargets()) {
			const pick = agentPickerOption(target);
			const opt = agentSel.createEl('option', { text: pick.label, attr: { value: target } }) as HTMLOptionElement;
			opt.disabled = pick.disabled;
			opt.selected = target === this.agent;
		}
		agentSel.addEventListener('change', () => {
			this.agent = agentSel.value as AgentTarget;
		});

		const nameRow = body.createDiv({ cls: 'dashboard-skillsec-createcfg-row' });
		nameRow.createSpan({ cls: 'dashboard-skillsec-createcfg-label', text: t('skills.createCfgSkill') });
		const nameWrap = nameRow.createDiv({ cls: 'dashboard-skillsec-createcfg-namewrap' });
		const nameInput = nameWrap.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: 'skill-creator' },
		}) as HTMLInputElement;
		nameInput.value = this.skillName;
		nameInput.addEventListener('input', () => {
			this.skillName = nameInput.value.trim();
			this.validate();
		});
		attachSkillPicker(nameWrap, nameInput, this.app, {
			plugin: this.plugin,
			getAgent: () => this.agent,
		}, name => {
			this.skillName = name;
			this.validate();
		});

		const tplSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		tplSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.createCfgTemplate') });
		const tplInput = tplSection.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('skills.createCfgTemplatePh') },
		}) as HTMLInputElement;
		tplInput.value = this.promptTemplate;
		tplInput.addEventListener('input', () => {
			this.promptTemplate = tplInput.value;
		});

		const sendRow = body.createDiv({ cls: 'dashboard-skillsec-createcfg-row' });
		const dsLabel = sendRow.createEl('label', { cls: 'dashboard-skillsec-createcfg-ds' });
		const dsCb = dsLabel.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
		dsCb.checked = this.directSend;
		dsCb.addEventListener('change', () => {
			this.directSend = dsCb.checked;
		});
		dsLabel.createSpan({ text: t('skills.createCfgDirectSend') });

		this.validationEl = body.createDiv({ cls: 'dashboard-dataview-validation' });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		this.confirmBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
			attr: { type: 'button' },
		});
		this.confirmBtn.addEventListener('click', () => this.trySave());
		this.validate();
	}

	private validate(): boolean {
		const ok = isValidSkillName(this.skillName);
		if (this.validationEl) {
			this.validationEl.setText(ok ? '' : t('agent.invalidSkill'));
		}
		if (this.confirmBtn) this.confirmBtn.disabled = !ok;
		return ok;
	}

	private trySave(): void {
		if (!this.validate() || !this.skillName) return;
		this.onSave({
			agent: this.agent,
			skillName: this.skillName,
			promptTemplate: this.promptTemplate,
			// Only persist the opt-in (round-trip cleanliness).
			...(this.directSend ? { directSend: true } : {}),
		});
		this.close();
	}
}
