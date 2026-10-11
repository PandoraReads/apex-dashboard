import { App, Menu, Modal, Notice, setIcon, TFolder } from 'obsidian';
import type { PmConfig } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { createNoteWithProps } from './library-new-note';
import { projectBodyTemplate } from './pm-model';
import { PmBoardModal, notifyPmChanged } from './pm-board-modal';

/**
 * New-project dialog: the full creation form (one-line intro, milestones,
 * stage, status, key date + reminder, cycle, next step, deliverables,
 * contract/payment, client, income) → one project note with the metadata in
 * frontmatter and the two standard body sections seeded. Local-until-Save,
 * then the project board opens on the fresh note.
 */
/** One-level folder name: strip path separators and filename-illegal
 *  characters so a typed subfolder can never escape the project root. */
function sanitizeFolderName(raw: string): string {
	return raw.replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim();
}

export class PmNewModal extends Modal {
	private readonly cfg: PmConfig;
	private readonly onSave: () => void;
	private nameInput!: HTMLInputElement;
	private folderInput!: HTMLInputElement;
	private groupInput!: HTMLInputElement;
	private introInput!: HTMLInputElement;
	private clientInput!: HTMLInputElement;
	private incomeInput!: HTMLInputElement;
	private milestonesHost: HTMLElement | null = null;
	/** Milestone row texts (index-keyed; empty rows dropped on save). */
	private milestoneValues: string[] = [''];
	private stageSelect!: HTMLSelectElement;
	private statusInput!: HTMLInputElement;
	private keyDateInput!: HTMLInputElement;
	private keyTimeInput!: HTMLInputElement;
	private remindInput!: HTMLInputElement;
	private cycleStartInput!: HTMLInputElement;
	private cycleEndInput!: HTMLInputElement;
	private nextStepInput!: HTMLInputElement;
	private deliverablesInput!: HTMLInputElement;
	private paymentInput!: HTMLInputElement;

	constructor(app: App, cfg: PmConfig, onSave?: () => void) {
		super(app);
		this.cfg = cfg;
		this.onSave = onSave ?? (() => {});
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-pmsec-new' });
		container.createDiv({ cls: 'dashboard-modal-header' }).createDiv({ cls: 'dashboard-modal-title', text: t('pm.newTitle') });
		// dashboard-pmsec-edit: the aligned label-column grid the board's
		// edit form uses — every input's left edge lines up.
		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-pmsec-edit' });

		// Fixed label column + a controls wrapper (same scaffold as the
		// board's edit form) so multi-control rows stay on one line.
		const formRow = (labelKey: string): HTMLElement => {
			const row = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
			row.createDiv({ cls: 'dashboard-library-config-inline-label', text: t(labelKey) });
			return row.createDiv({ cls: 'dashboard-pmsec-edit-controls' });
		};
		const textRow = (labelKey: string, placeholderKey: string, type = 'text'): HTMLInputElement => {
			const controls = formRow(labelKey);
			return controls.createEl('input', { cls: 'dashboard-modal-input', attr: { type, placeholder: t(placeholderKey) } });
		};

		this.nameInput = textRow('pm.f.name', 'pm.f.name');

		// Subfolder (Rae): project notes live in their own folder — default the
		// project's name, and the chevron lists the root's EXISTING subfolders
		// so an already-created folder can be reused.
		const folderRow = body.createDiv({ cls: 'dashboard-library-config-inline-row' });
		folderRow.createDiv({ cls: 'dashboard-library-config-inline-label', text: t('pm.f.subfolder') });
		const folderWrap = folderRow.createDiv({ cls: 'dashboard-pmsec-folderwrap' });
		this.folderInput = folderWrap.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'text', placeholder: t('pm.f.subfolderPh') } });
		const pickBtn = folderWrap.createEl('button', {
			cls: 'dashboard-pipeline-cfg-icon-btn',
			attr: { type: 'button', 'aria-label': t('pm.f.subfolderPick'), title: t('pm.f.subfolderPick') },
		});
		setIcon(pickBtn, 'chevron-down');
		pickBtn.addEventListener('click', ev => {
			const root = (this.cfg.rootFolder ?? '').replace(/^\/+|\/+$/g, '');
			if (!root) return;
			const prefix = root + '/';
			const subs = this.app.vault.getAllLoadedFiles()
				.filter((f): f is TFolder => f instanceof TFolder && f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/'))
				.map(f => f.path.slice(prefix.length))
				.sort((a, b) => a.localeCompare(b));
			if (subs.length === 0) return;
			const menu = new Menu();
			for (const sub of subs) {
				menu.addItem(item => item.setTitle(sub).onClick(() => { this.folderInput.value = sub; }));
			}
			menu.showAtMouseEvent(ev as MouseEvent);
		});
		this.groupInput = textRow('pm.f.group', 'pm.f.groupPh');
		this.introInput = textRow('pm.f.intro', 'pm.f.introPh');
		this.clientInput = textRow('pm.f.client', 'pm.f.client');
		this.incomeInput = textRow('pm.f.income', 'pm.f.income');

		// Stage select from the section's configured stages.
		const stageControls = formRow('pm.f.stage');
		this.stageSelect = stageControls.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
		for (const stage of this.cfg.stages) {
			this.stageSelect.createEl('option', { text: stage.label, attr: { value: stage.label } });
		}

		this.statusInput = textRow('pm.f.status', 'pm.f.statusPh');

		// Milestones: dynamic rows — one input per milestone, + appends a
		// row, each row removable. Replaces the one-big-textarea.
		const msControls = formRow('pm.f.milestones');
		this.milestonesHost = msControls.createDiv({ cls: 'dashboard-pmsec-ms-list' });
		this.renderMilestoneRows();

		const keyControls = formRow('pm.f.keyDate');
		this.keyDateInput = keyControls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });
		this.keyTimeInput = keyControls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-time', attr: { type: 'time' } });
		this.remindInput = keyControls.createEl('input', { attr: { type: 'checkbox' } });

		const cycleControls = formRow('pm.f.cycle');
		this.cycleStartInput = cycleControls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });
		this.cycleEndInput = cycleControls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });

		this.nextStepInput = textRow('pm.f.nextStep', 'pm.f.nextStepPh');
		this.deliverablesInput = textRow('pm.f.deliverables', 'pm.f.deliverablesPh');
		this.paymentInput = textRow('pm.f.payment', 'pm.f.paymentPh');

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--cancel', text: t('common.cancel') })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') })
			.addEventListener('click', () => { void this.save(); });
	}

	/** Milestone rows: an editable input each + trash; the + row appends.
	 *  Values live in this.milestoneValues (index-keyed) so re-rendering
	 *  never loses typing. */
	private renderMilestoneRows(): void {
		const host = this.milestonesHost;
		if (!host) return;
		host.empty();
		this.milestoneValues.forEach((value, index) => {
			const row = host.createDiv({ cls: 'dashboard-pmsec-ms-item' });
			const input = row.createEl('input', {
				cls: 'dashboard-modal-input',
				attr: { type: 'text', placeholder: `${t('pm.f.milestones')} ${index + 1}` },
			});
			input.value = value;
			input.addEventListener('input', () => { this.milestoneValues[index] = input.value; });
			const del = row.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => {
				this.milestoneValues = this.milestoneValues.filter((_, i) => i !== index);
				this.renderMilestoneRows();
			});
		});
		const addRow = host.createDiv({ cls: 'dashboard-pmsec-ms-item dashboard-pmsec-ms-item--add' });
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn',
			attr: { type: 'button' },
		});
		setIcon(addBtn.createSpan({ cls: 'dashboard-pmsec-foot-btn-icon' }), 'plus');
		addBtn.createSpan({ text: t('pm.addMilestone') });
		addBtn.addEventListener('click', () => {
			this.milestoneValues = [...this.milestoneValues, ''];
			this.renderMilestoneRows();
			const last = this.milestonesHost?.querySelectorAll('input');
			(last?.[last.length - 1] as HTMLInputElement | undefined)?.focus();
		});
	}

	private async save(): Promise<void> {
		const name = this.nameInput.value.trim();
		if (!name) {
			this.nameInput.focus();
			return;
		}
		const income = this.incomeInput.value.trim();
		if (income && !Number.isFinite(Number(income.replace(/[¥$,，\s]/g, '')))) {
			new Notice(t('pm.badIncome'));
			this.incomeInput.focus();
			return;
		}
		const props: Record<string, string> = { type: 'project' };
		const assign = (key: string, value: string): void => {
			if (value) props[key] = value;
		};
		assign('group', this.groupInput.value.trim());
		assign('intro', this.introInput.value.trim());
		assign('stage', this.stageSelect.value);
		assign('status', this.statusInput.value.trim());
		assign('client', this.clientInput.value.trim());
		assign('income', income);
		const keyDate = [this.keyDateInput.value, this.keyTimeInput.value].filter(Boolean).join(' ');
		assign('keyDate', keyDate);
		assign('cycleStart', this.cycleStartInput.value);
		assign('cycleEnd', this.cycleEndInput.value);
		assign('nextStep', this.nextStepInput.value.trim());
		assign('deliverables', this.deliverablesInput.value.trim());
		assign('payment', this.paymentInput.value.trim());
		if (this.remindInput.checked && keyDate) props['remind'] = 'true';

		const milestones = this.milestoneValues.map(value => value.trim()).filter(Boolean);
		try {
			// Target folder: the chosen subfolder (default = the project name);
			// createNoteWithProps ensures the folder chain exists.
			const sub = sanitizeFolderName(this.folderInput.value.trim() || name);
			const root = (this.cfg.rootFolder ?? '').replace(/^\/+|\/+$/g, '');
			const targetFolder = root ? `${root}/${sub}` : sub;
			const file = await createNoteWithProps(
				this.app, targetFolder, name, props, undefined, projectBodyTemplate(milestones),
			);
			new Notice(t('pm.created', { name: file.basename }));
			notifyPmChanged();
			this.onSave();
			this.close();
			new PmBoardModal(this.app, file, this.cfg).open();
		} catch (error) {
			new Notice(t('pm.createFailed', { message: error instanceof Error ? error.message : String(error) }));
		}
	}
}
