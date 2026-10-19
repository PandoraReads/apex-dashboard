/**
 * Per-skill launch-button editor for the skills section. The section's home
 * stores (claude/codex/workbuddy dirs) auto-bind one agent button per
 * install, but custom skillSourceFolders bind none — this modal lets the
 * user attach ANY agent (plus optional prompt template) as extra card
 * buttons, the same row shape the skill widget's config uses. Saving routes
 * through the section's prefs event (dashboard-skills-prefs → view.ts →
 * sync.updateSkillsConfig), so the card re-renders in place.
 */

import { App, Modal, setIcon } from 'obsidian';
import type { AgentTarget, SkillCardButton } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { IconPickerModal } from './icon-picker-modal';
import { agentTargets, agentPickerOption, getAgentAdapter } from './agent-dispatch';
import { LargeTextModal } from './large-text-modal';

/** Default icon per agent target — the launch-button glyph on the card. */
const AGENT_ICON: Record<string, string> = {
	claudian: 'bot',
	codex: 'terminal',
	workbuddy: 'message-circle',
};

export function agentButtonIcon(agent: string, override?: string): string {
	return override || AGENT_ICON[agent] || 'sparkles';
}

/** Agent label for a button caption when the user left the label blank. */
export function agentButtonLabel(agent: string): string {
	return getAgentAdapter(agent as AgentTarget)?.label ?? agent;
}

export class SkillCardButtonsModal extends Modal {
	private buttons: SkillCardButton[];

	constructor(
		app: App,
		private readonly skillName: string,
		existing: SkillCardButton[] | undefined,
		private readonly onSave: (buttons: SkillCardButton[]) => void,
	) {
		super(app);
		this.buttons = (existing ?? []).map(b => ({ ...b }));
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skills.cardBtnTitle', { name: this.skillName }) });

		const body = wrap.createDiv({ cls: 'dashboard-modal-body' });
		const section = body.createDiv({ cls: 'dashboard-library-config-section' });
		section.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.cardBtnHint') });
		this.listEl = section.createDiv({ cls: 'dashboard-pipeline-cfg-skills' });
		this.renderRows();
		const addBtn = section.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('skills.cardBtnAdd'),
			attr: { type: 'button' },
		});
		addBtn.addEventListener('click', () => {
			this.buttons = [...this.buttons, {
				id: `sb_${Date.now().toString(36)}`,
				label: '', icon: '', agent: 'claudian',
				promptTemplate: '',
			}];
			this.renderRows();
		});

		const footer = wrap.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { text: t('common.cancel'), cls: 'dashboard-modal-btn dashboard-modal-btn--cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { text: t('common.save'), cls: 'dashboard-modal-btn dashboard-modal-btn--confirm' })
			.addEventListener('click', () => this.save());
	}

	private listEl: HTMLElement | null = null;

	private patchRow(index: number, patch: Partial<SkillCardButton>): void {
		this.buttons = this.buttons.map((b, i) => i === index ? { ...b, ...patch } : b);
	}

	private renderRows(): void {
		const host = this.listEl;
		if (!host) return;
		host.empty();
		if (this.buttons.length === 0) {
			host.createDiv({ cls: 'dashboard-library-empty', text: t('skills.cardBtnEmpty') });
			return;
		}
		this.buttons.forEach((button, index) => {
			const row = host.createDiv({ cls: 'dashboard-pipeline-cfg-skill' });

			const top = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const iconBtn = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn',
				attr: { type: 'button', 'aria-label': t('pipeline.cfgSkillIcon'), title: agentButtonIcon(button.agent, button.icon) },
			});
			setIcon(iconBtn, agentButtonIcon(button.agent, button.icon));
			iconBtn.addEventListener('click', () => {
				new IconPickerModal(this.app, icon => {
					this.patchRow(index, { icon });
					setIcon(iconBtn, agentButtonIcon(button.agent, icon));
					iconBtn.title = agentButtonIcon(button.agent, icon);
				}).open();
			});

			const label = top.createEl('input', {
				cls: 'dashboard-modal-input',
				attr: { type: 'text', placeholder: t('quickNote.fieldLabel') },
			});
			label.value = button.label;
			label.addEventListener('input', () => this.patchRow(index, { label: label.value }));

			const agentSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const target of agentTargets()) {
				const pick = agentPickerOption(target);
				const opt = agentSel.createEl('option', { text: pick.label, attr: { value: target } });
				opt.disabled = pick.disabled;
				opt.selected = target === button.agent;
			}
			agentSel.addEventListener('change', () => this.patchRow(index, { agent: agentSel.value as AgentTarget }));

			const del = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete'), title: t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => {
				this.buttons = this.buttons.filter((_, i) => i !== index);
				this.renderRows();
			});

			const tpl = row.createEl('input', {
				cls: 'dashboard-modal-input',
				attr: { type: 'text', placeholder: t('quickNote.skillTemplate') },
			});
			tpl.value = button.promptTemplate;
			tpl.addEventListener('input', () => this.patchRow(index, { promptTemplate: tpl.value }));
			// Long prompts: expand into a tall popup editor (pipeline-config
			// idiom) — a single-line input can't even be scrolled readably.
			const expandBtn = row.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-prompt-expand',
				attr: { type: 'button', 'aria-label': t('pipeline.cfgPromptView'), title: t('pipeline.cfgPromptView') },
			});
			setIcon(expandBtn, 'maximize-2');
			expandBtn.addEventListener('click', () => {
				new LargeTextModal(this.app, t('pipeline.cfgPromptView'), tpl.value, value => {
					this.patchRow(index, { promptTemplate: value });
					tpl.value = value;
				}).open();
			});

			// Direct send: skip the confirm dialog entirely.
			const directRow = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			directRow.createSpan({ cls: 'dashboard-pipeline-cfg-hint', text: t('agent.directSend') });
			const direct = directRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-toggle',
				attr: { type: 'checkbox' },
			});
			direct.checked = button.directSend === true;
			direct.addEventListener('change', () => this.patchRow(index, { directSend: direct.checked }));
		});
	}

	private save(): void {
		this.onSave(this.buttons.map(b => ({
			...b,
			label: b.label.trim(),
			icon: b.icon.trim(),
			promptTemplate: b.promptTemplate.trim(),
		})));
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
