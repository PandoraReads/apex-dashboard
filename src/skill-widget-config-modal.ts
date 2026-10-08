import { App, Modal, Notice, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import type { AgentTarget, SkillShortcut } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { IconPickerModal } from './icon-picker-modal';
import { agentTargets, agentPickerOption } from './agent-dispatch';
import { attachSkillPicker, rememberSkillNames } from './skill-registry';

/**
 * Config modal for the standalone skill-buttons widget: same fields and
 * pickers as the quick-note chips editor, but a SEPARATE list
 * (settings.skillWidgetButtons). Uses the pipeline config's section/row
 * classes so it inherits the plugin's standard themed modal look.
 */
export class SkillWidgetConfigModal extends Modal {
	private buttons: SkillShortcut[];
	private listEl: HTMLElement | null = null;

	constructor(app: App, private readonly plugin: DashboardPlugin) {
		super(app);
		this.buttons = (plugin.settings.skillWidgetButtons ?? []).map(b => ({ ...b }));
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skillsWidget.cfgTitle') });

		const body = wrap.createDiv({ cls: 'dashboard-modal-body' });
		const section = body.createDiv({ cls: 'dashboard-library-config-section' });
		section.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skillsWidget.cfgTitle') });
		this.listEl = section.createDiv({ cls: 'dashboard-pipeline-cfg-skills' });
		this.renderRows();
		const addBtn = section.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('skillsWidget.add'),
			attr: { type: 'button' },
		});
		addBtn.addEventListener('click', () => {
			this.buttons = [...this.buttons, {
				id: `sw_${Date.now().toString(36)}`,
				label: '', icon: 'sparkles', target: 'claudian',
				skillName: '', promptTemplate: '',
			}];
			this.renderRows();
		});

		const footer = wrap.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { text: t('common.cancel'), cls: 'dashboard-modal-btn dashboard-modal-btn--cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { text: t('common.save'), cls: 'dashboard-modal-btn dashboard-modal-btn--confirm' })
			.addEventListener('click', () => void this.save());
	}

	private patchRow(index: number, patch: Partial<SkillShortcut>): void {
		this.buttons = this.buttons.map((b, i) => i === index ? { ...b, ...patch } : b);
	}

	private renderRows(): void {
		const host = this.listEl;
		if (!host) return;
		host.empty();
		if (this.buttons.length === 0) {
			host.createDiv({ cls: 'dashboard-library-empty', text: t('skillsWidget.emptyCfg') });
			return;
		}
		this.buttons.forEach((skill, index) => {
			const row = host.createDiv({ cls: 'dashboard-pipeline-cfg-skill' });

			const top = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			const iconBtn = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn',
				attr: { type: 'button', 'aria-label': t('pipeline.cfgSkillIcon'), title: skill.icon || 'sparkles' },
			});
			setIcon(iconBtn, skill.icon || 'sparkles');
			iconBtn.addEventListener('click', () => {
				new IconPickerModal(this.app, (icon) => {
					this.patchRow(index, { icon });
					setIcon(iconBtn, icon || 'sparkles');
					iconBtn.title = icon || 'sparkles';
				}).open();
			});

			const label = top.createEl('input', {
				cls: 'dashboard-modal-input',
				attr: { type: 'text', placeholder: t('quickNote.fieldLabel') },
			});
			label.value = skill.label;
			label.addEventListener('input', () => this.patchRow(index, { label: label.value }));

			const agentSel = top.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
			for (const target of agentTargets()) {
				const pick = agentPickerOption(target);
				const opt = agentSel.createEl('option', { text: pick.label, attr: { value: target } }) as HTMLOptionElement;
				opt.disabled = pick.disabled;
				opt.selected = target === skill.target;
			}
			agentSel.addEventListener('change', () => this.patchRow(index, { target: agentSel.value as AgentTarget }));

			const del = top.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete'), title: t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => {
				this.buttons = this.buttons.filter((_, i) => i !== index);
				this.renderRows();
			});

			const nameRow = row.createDiv({ cls: 'dashboard-pipeline-cfg-name-row' });
			const nameInput = nameRow.createEl('input', {
				cls: 'dashboard-modal-input dashboard-pipeline-cfg-input--slug',
				attr: { type: 'text', placeholder: t('quickNote.skillName') },
			});
			nameInput.value = skill.skillName;
			nameInput.addEventListener('input', () => this.patchRow(index, { skillName: nameInput.value.trim() }));
			attachSkillPicker(nameRow, nameInput, this.app, {
				plugin: this.plugin,
				getAgent: () => this.buttons[index]?.target ?? 'claudian',
			}, name => this.patchRow(index, { skillName: name }));

			const tpl = row.createEl('input', {
				cls: 'dashboard-modal-input',
				attr: { type: 'text', placeholder: t('quickNote.skillTemplate') },
			});
			tpl.value = skill.promptTemplate;
			tpl.addEventListener('input', () => this.patchRow(index, { promptTemplate: tpl.value }));

			// Direct send: skip the confirm dialog entirely.
			const directRow = row.createDiv({ cls: 'dashboard-pipeline-cfg-skill-row' });
			directRow.createSpan({ cls: 'dashboard-pipeline-cfg-hint', text: t('agent.directSend') });
			const direct = directRow.createEl('input', {
				cls: 'dashboard-pipeline-cfg-toggle',
				attr: { type: 'checkbox' },
			}) as HTMLInputElement;
			direct.checked = skill.directSend === true;
			direct.addEventListener('change', () => this.patchRow(index, { directSend: direct.checked }));
		});
	}

	private async save(): Promise<void> {
		const saved = this.buttons
			.filter(b => b.label.trim())
			.map(b => ({ ...b, label: b.label.trim() }));
		this.plugin.settings = {
			...this.plugin.settings,
			skillWidgetButtons: saved,
		};
		await this.plugin.saveSettings();
		for (const agent of new Set(saved.map(b => b.target))) {
			await rememberSkillNames(this.plugin, agent, saved.filter(b => b.target === agent && b.skillName).map(b => b.skillName));
		}
		this.plugin.refreshAllDashboards();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
