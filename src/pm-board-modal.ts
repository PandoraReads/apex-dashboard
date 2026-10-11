import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { PmConfig, PmSkill } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';
import { ensureFolder } from './daily-notes';
import { createNoteWithProps } from './library-new-note';
import { dispatchSkill } from './pipeline-section';
import { attachNoteHover } from './hover-preview';
import { iconForExtension } from './file-types';
import {
	parseProjectBody, pmField, pmGroupName, pmIncome, pmKeyDate, keyDateCountdown, pmStageColor, projectFolder,
	insertProjectTask, removeProjectTask, pmLinkedFiles, pmCustomFields,
} from './pm-model';
import { toggleTaskLine, type PipelineTask } from './pipeline-model';
import { NotePopoverModal } from './note-popover-modal';

/** Tell the view to refreshSectionInPlace for every pm column (edits land on
 *  the note immediately; the vault-event path is debounced, this is instant). */
export function notifyPmChanged(): void {
	activeDocument.dispatchEvent(new CustomEvent('dashboard-pm-updated'));
}

/** Dispatch vars for a project's skill buttons. */
export function pmSkillVars(projectFile: TFile, cfg: PmConfig): Record<string, string> {
	return {
		path: projectFile.path,
		title: projectFile.basename,
		folder: projectFolder(cfg.rootFolder ?? '', projectFile.basename),
	};
}

export function dispatchPmSkill(app: App, skill: PmSkill, vars: Record<string, string>): void {
	dispatchSkill(app, skill, vars, {});
}

/** Create one work note from the section's template inside the project's
 *  folder (created on demand), then OPEN it in the note popover so the
 *  click-to-write loop is one gesture. Returns the new file. */
export async function createPmWorkNote(app: App, projectFile: TFile, cfg: PmConfig): Promise<TFile> {
	const folder = projectFolder(cfg.rootFolder ?? '', projectFile.basename);
	const iso = new Date().toISOString().slice(0, 10);
	const title = `${iso} ${t('pm.workNoteName')}`;
	let file: TFile;
	try {
		file = await createNoteWithProps(app, folder, title, {}, cfg.workNoteTemplate || undefined);
	} catch {
		// Missing template (or blocked folder): fall back to a bare note so
		// the button never dead-ends. A failure HERE used to reject silently
		// (callers `void` it) — which left the just-created folder EMPTY with
		// no explanation; surface it instead.
		try {
			file = await createNoteWithProps(app, folder, title, {});
		} catch (error) {
			new Notice(t('pm.createFailed', { message: error instanceof Error ? error.message : String(error) }));
			throw error;
		}
	}
	new Notice(t('pm.workNoteCreated', { name: file.basename }));
	new NotePopoverModal(app, file).open();
	return file;
}

/** Archive: stamp `archived: true` (removes the note from the board wherever
 *  the file sits) and move it into the configured archive folder. */
export async function archivePmProject(app: App, projectFile: TFile, cfg: PmConfig): Promise<boolean> {
	const target = (cfg.archiveFolder ?? '').trim();
	if (!target) {
		new Notice(t('pm.archiveNoFolder'));
		return false;
	}
	await app.fileManager.processFrontMatter(projectFile, fm => { fm['archived'] = true; });
	await ensureFolder(app, target);
	try {
		await app.fileManager.renameFile(projectFile, `${target}/${projectFile.name}`);
	} catch {
		// Name conflict in the archive: the flag alone already removed the
		// note from the board; the file stays where it is.
	}
	new Notice(t('pm.archived'));
	notifyPmChanged();
	return true;
}

/** Delete: confirm, then trash the project note (user's trash preference). */
export async function deletePmProject(app: App, projectFile: TFile): Promise<boolean> {
	const confirmed = await showConfirmDialog(app, {
		title: t('pm.board.delete'),
		message: t('pm.board.deleteConfirm', { name: projectFile.basename }),
	});
	if (!confirmed) return false;
	await app.fileManager.trashFile(projectFile);
	new Notice(t('pm.deleted'));
	notifyPmChanged();
	return true;
}

/**
 * The per-project "project board" dialog: every frontmatter field inline and
 * saved on change (this is a working surface, not a form — no Save button),
 * the milestone/todo checklists of the note's two standard body sections,
 * the project folder's files, and the section's skill buttons. Structural
 * edits (checklist add/remove/toggle, rename) re-render the body; field
 * input edits write through without re-rendering so focus never jumps.
 */
export class PmBoardModal extends Modal {
	private readonly cfg: PmConfig;
	private readonly projectFile: TFile;
	private readonly onChanged: (() => void) | null;
	/** The overview is a visual dossier by default — the fields live in
	 *  stat tiles; clicking the edit entry swaps in the form (milestones and
	 *  todos, the things edited constantly mid-project, stay directly
	 *  editable on the right pane regardless of this flag). */
	private editingOverview = false;

	constructor(app: App, projectFile: TFile, cfg: PmConfig, onChanged?: () => void) {
		super(app);
		this.projectFile = projectFile;
		this.cfg = cfg;
		this.onChanged = onChanged ?? null;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		// Sizing chain for the page-grade layout: real Obsidian nests the
		// board INSIDE an unclassed contentEl div (the browser stub flattens
		// it) — this class lets CSS flex the whole chain (.modal → host →
		// board) so the panes, not the modal, own the scrolling.
		contentEl.addClass('dashboard-pmsec-board-host');
		containerEl.addClass('modal--dashboard');
		containerEl.addClass('modal--pm-board');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		void this.renderBody();
	}

	private async renderBody(): Promise<void> {
		const { contentEl } = this;
		const frontmatter = this.app.metadataCache.getFileCache(this.projectFile)?.frontmatter ?? {};
		const content = await this.app.vault.read(this.projectFile);
		const sections = parseProjectBody(content);

		contentEl.empty();
		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-pmsec-board' });

		// ── Hero: the project's masthead — name, stage, intro lede. ────────
		const header = container.createDiv({ cls: 'dashboard-modal-header dashboard-pmsec-hero' });
		const titleRow = header.createDiv({ cls: 'dashboard-pmsec-hero-row' });
		const title = titleRow.createDiv({ cls: 'dashboard-modal-title dashboard-pmsec-hero-title', text: this.projectFile.basename });
		title.addEventListener('dblclick', () => { void this.renameProject(); });
		const stage = pmField(frontmatter, 'stage');
		if (stage) {
			const badge = titleRow.createSpan({ cls: 'dashboard-pmsec-badge' });
			badge.createSpan({ cls: 'dashboard-pmsec-badge-dot' });
			badge.createSpan({ cls: 'dashboard-pmsec-badge-text', text: stage });
			badge.style.setProperty('--pmsec-stage', pmStageColor(this.cfg.stages, stage));
		}

		// Milestone progress rides the hero's RIGHT side (beside the title):
		// % numeral + one node per milestone + counts. Tooltips on the nodes
		// carry each milestone's text. No close button here — the native one
		// on the modal frame is the single way out.
		const milestoneTotal = sections.milestones.length;
		if (milestoneTotal > 0) {
			const done = sections.milestones.filter(task => task.checked).length;
			const pct = Math.round((done / milestoneTotal) * 100);
			const progressWrap = titleRow.createDiv({ cls: 'dashboard-pmsec-hero-progress' });
			progressWrap.createSpan({ cls: 'dashboard-pmsec-progress-pct', text: `${pct}%` });
			this.buildStepper(progressWrap, sections.milestones);
			progressWrap.createSpan({
				cls: 'dashboard-pmsec-progress-label',
				text: `${done}/${milestoneTotal}`,
			});
		}

		const intro = pmField(frontmatter, 'intro');
		if (intro) header.createDiv({ cls: 'dashboard-pmsec-hero-intro', text: intro });

		// Two panes: the dossier on the left, the working lists on the right
		// (single column under 900px — see CSS).
		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-pmsec-board-body' });
		const left = body.createDiv({ cls: 'dashboard-pmsec-pane' });
		const right = body.createDiv({ cls: 'dashboard-pmsec-pane' });

		// ── Left pane: the dossier on top, the milestone checklist beneath it
		//    (milestones belong to the project's facts-and-progress column;
		//    todos and files — the daily churn — live on the right). ────────
		if (this.editingOverview) this.overviewForm(left, frontmatter);
		else this.overviewDossier(left, frontmatter);
		this.checklistSection(left, t('pm.board.milestones'), sections.milestones, 'milestone');

		// ── Right pane: the things a PM touches mid-project, directly
		//    editable — todos and project files. Skill buttons live on the
		//    CARD's hover row, not here. ─────────────────────────────────────
		this.checklistSection(right, t('pm.board.todos'), sections.todos, 'todo');
		this.filesSection(right, frontmatter);

		// No footer: the destructive pair lives on the section card's hover
		// overlay (archive + delete, see pm-section) — duplicated here it
		// only added misclick surface (Rae). The native close ends the board.
	}

	/** Milestone stepper: one node per task, done nodes filled, connectors
	 *  tinted; hover a node for the milestone's text. */
	private buildStepper(host: HTMLElement, milestones: PipelineTask[]): void {
		const stepper = host.createDiv({ cls: 'dashboard-pmsec-stepper' });
		for (const task of milestones) {
			const step = stepper.createSpan({ cls: `dashboard-pmsec-step ${task.checked ? 'is-done' : ''}` });
			step.title = task.text;
		}
	}

	/** View-mode overview: stat tiles — key date with countdown, cycle span
	 *  with duration, income, payment, client, status, then the next-step
	 *  and deliverables cards full-width. */
	private overviewDossier(host: HTMLElement, frontmatter: Record<string, unknown>): void {
		const sec = host.createDiv({ cls: 'dashboard-library-config-section dashboard-pmsec-ov' });
		// No section title — the tiles speak for themselves; only the edit
		// entry stays, pinned to the pane's top-right. The custom-field adder
		// lives in the EDIT form (Rae: adding fields is an editing act).
		const head = sec.createDiv({ cls: 'dashboard-pmsec-check-title dashboard-pmsec-ov-head' });
		const editBtn = head.createEl('button', { cls: 'dashboard-modal-btn dashboard-pmsec-ov-edit', text: t('pm.editOverview') });
		editBtn.addEventListener('click', () => { this.editingOverview = true; void this.renderBody(); });

		const grid = sec.createDiv({ cls: 'dashboard-pmsec-ov-grid' });
		const tile = (
			icon: string, label: string, value: string,
			opts?: { tone?: 'accent' | 'danger'; sub?: string; big?: boolean; full?: boolean },
		): void => {
			if (!value) return;
			const el = grid.createDiv({
				cls: `dashboard-pmsec-tile ${opts?.full ? 'dashboard-pmsec-tile--full' : ''} ${opts?.tone ? `dashboard-pmsec-tile--${opts.tone}` : ''}`.trim(),
			});
			setIcon(el.createSpan({ cls: 'dashboard-pmsec-tile-icon' }), icon);
			const tileBody = el.createDiv({ cls: 'dashboard-pmsec-tile-body' });
			tileBody.createSpan({ cls: 'dashboard-pmsec-tile-label', text: label });
			tileBody.createDiv({ cls: `dashboard-pmsec-tile-value ${opts?.big ? 'dashboard-pmsec-tile-value--big' : ''}`.trim(), text: value });
			if (opts?.sub) tileBody.createDiv({ cls: 'dashboard-pmsec-tile-sub', text: opts.sub });
		};

		tile('arrow-up-right', t('pm.nextUp'), pmField(frontmatter, 'nextStep'), { full: true, big: true, tone: 'accent' });
		const keyDate = pmKeyDate(frontmatter);
		if (keyDate) {
			const countdown = keyDateCountdown(keyDate);
			tile('target', t('pm.f.keyDate'), keyDate.date, {
				big: true,
				sub: countdown?.text,
				tone: countdown?.overdue ? 'danger' : undefined,
			});
		}
		const cycleStart = pmField(frontmatter, 'cycleStart').slice(0, 10);
		const cycleEnd = pmField(frontmatter, 'cycleEnd').slice(0, 10);
		if (cycleStart || cycleEnd) {
			const days = (cycleStart && cycleEnd)
				? Math.round((new Date(`${cycleEnd}T00:00:00`).getTime() - new Date(`${cycleStart}T00:00:00`).getTime()) / 86_400_000) + 1
				: null;
			tile('calendar-range', t('pm.f.cycle'), `${cycleStart || '…'} → ${cycleEnd || '…'}`, {
				big: true,
				sub: days !== null && Number.isFinite(days) ? t('pm.cycleDuration', { n: days }) : undefined,
			});
		}
		const income = pmIncome(frontmatter);
		if (income > 0) {
			tile('wallet', t('pm.f.income'), `¥${Math.round(income).toLocaleString()}`, { big: true, tone: 'accent' });
		}
		tile('receipt', t('pm.f.payment'), pmField(frontmatter, 'payment'));
		tile('user', t('pm.f.client'), pmField(frontmatter, 'client'));
		tile('clipboard-list', t('pm.f.status'), pmField(frontmatter, 'status'));
		tile('package', t('pm.f.deliverables'), pmField(frontmatter, 'deliverables'), { full: true });

		// User-added custom entries: tag tiles with a hover × to remove.
		for (const field of pmCustomFields(frontmatter)) {
			const el = grid.createDiv({ cls: 'dashboard-pmsec-tile dashboard-pmsec-tile--custom' });
			setIcon(el.createSpan({ cls: 'dashboard-pmsec-tile-icon' }), 'tag');
			const tileBody = el.createDiv({ cls: 'dashboard-pmsec-tile-body' });
			tileBody.createSpan({ cls: 'dashboard-pmsec-tile-label', text: field.key });
			tileBody.createDiv({ cls: 'dashboard-pmsec-tile-value', text: field.value });
			const remove = el.createEl('button', {
				cls: 'dashboard-pmsec-file-unlink',
				attr: { type: 'button', 'aria-label': t('common.delete'), title: t('common.delete') },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.writeCustomField(field.key, '');
			});
		}
	}

	/** Write one custom info entry into frontmatter `custom` (empty value
	 *  deletes the key; an emptied map drops the block entirely). */
	private async writeCustomField(key: string, value: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.projectFile, fm => {
			if (value) {
				if (!fm['custom'] || typeof fm['custom'] !== 'object') fm['custom'] = {};
				(fm['custom'] as Record<string, unknown>)[key] = value;
			} else if (fm['custom'] && typeof fm['custom'] === 'object') {
				delete (fm['custom'] as Record<string, unknown>)[key];
				if (Object.keys(fm['custom'] as Record<string, unknown>).length === 0) delete fm['custom'];
			}
		});
		notifyPmChanged();
		this.onChanged?.();
		await this.renderBody();
	}

	/** Edit-mode overview: the creation form, grid-aligned. Done returns to
	 *  the dossier view. */
	private overviewForm(host: HTMLElement, frontmatter: Record<string, unknown>): void {
		const sec = host.createDiv({ cls: 'dashboard-library-config-section dashboard-pmsec-edit' });
		const head = sec.createDiv({ cls: 'dashboard-pmsec-check-title dashboard-pmsec-ov-head' });
		// Custom-field adder rides the edit form's header (Rae: adding a
		// field is an editing act — the read-only dossier never offers it).
		const addFieldBtn = head.createEl('button', { cls: 'dashboard-modal-btn', text: t('pm.addField') });
		setIcon(addFieldBtn.createSpan({ cls: 'dashboard-pmsec-foot-btn-icon' }), 'plus');
		const doneBtn = head.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pm.doneEditing') });
		doneBtn.addEventListener('click', () => { this.editingOverview = false; void this.renderBody(); });

		this.textField(sec, t('pm.f.group'), pmGroupName(frontmatter), 'pm.f.groupPh', v => ['group', v]);
		this.textField(sec, t('pm.f.intro'), pmField(frontmatter, 'intro'), 'pm.f.introPh', v => ['intro', v]);
		this.stageSelect(sec, frontmatter);
		this.textField(sec, t('pm.f.status'), pmField(frontmatter, 'status'), 'pm.f.statusPh', v => ['status', v]);
		this.textField(sec, t('pm.f.client'), pmField(frontmatter, 'client'), 'pm.f.client', v => ['client', v]);
		this.textField(sec, t('pm.f.income'), pmField(frontmatter, 'income'), 'pm.f.income', v => ['income', v], 'text');
		this.datePair(sec, t('pm.f.cycle'), pmField(frontmatter, 'cycleStart').slice(0, 10), pmField(frontmatter, 'cycleEnd').slice(0, 10));
		this.keyDateRow(sec, frontmatter);
		this.textField(sec, t('pm.f.nextStep'), pmField(frontmatter, 'nextStep'), 'pm.f.nextStepPh', v => ['nextStep', v]);
		this.textField(sec, t('pm.f.deliverables'), pmField(frontmatter, 'deliverables'), 'pm.f.deliverablesPh', v => ['deliverables', v]);
		this.textField(sec, t('pm.f.payment'), pmField(frontmatter, 'payment'), 'pm.f.paymentPh', v => ['payment', v]);

		// Custom-field adder: an inline name+value row revealed by the header
		// button (commit writes frontmatter.custom[key], stays in edit mode).
		const addRow = sec.createDiv({ cls: 'dashboard-pmsec-add-row dashboard-pmsec-custom-add' });
		addRow.style.display = 'none';
		const keyInput = addRow.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'text', placeholder: t('pm.addFieldKey') } });
		const valueInput = addRow.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'text', placeholder: t('pm.addFieldValue') } });
		const confirmAdd = addRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.confirm') });
		const commitField = (): void => {
			const key = keyInput.value.trim();
			const value = valueInput.value.trim();
			if (!key) {
				keyInput.focus();
				return;
			}
			keyInput.value = '';
			valueInput.value = '';
			addRow.style.display = 'none';
			void this.writeCustomField(key, value);
		};
		confirmAdd.addEventListener('click', commitField);
		for (const input of [keyInput, valueInput]) {
			input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) commitField(); });
		}
		addFieldBtn.addEventListener('click', () => {
			addRow.style.display = addRow.style.display === 'none' ? 'flex' : 'none';
			keyInput.focus();
		});
	}

	/** Edit-form row scaffold: fixed label column + a controls wrapper, so
	 *  every input's left edge lines up however long the label is (the
	 *  ragged flex rows read as a spreadsheet — this is the fix). */
	private formRow(host: HTMLElement, label: string): HTMLElement {
		const row = host.createDiv({ cls: 'dashboard-library-config-inline-row' });
		row.createDiv({ cls: 'dashboard-library-config-inline-label', text: label });
		return row.createDiv({ cls: 'dashboard-pmsec-edit-controls' });
	}

	/** One label + text input row; commit-on-change writes the frontmatter
	 *  key (empty deletes the key). No re-render — focus stays put. */
	private textField(
		host: HTMLElement, label: string, initial: string, placeholderKey: string,
		pick: (value: string) => [string, string], type: 'text' | 'number' = 'text',
	): void {
		const controls = this.formRow(host, label);
		const input = controls.createEl('input', { cls: 'dashboard-modal-input', attr: { type, placeholder: t(placeholderKey) } });
		input.value = initial;
		input.addEventListener('change', () => {
			const [key, value] = pick(input.value.trim());
			void this.writeField(key, value);
		});
	}

	private stageSelect(host: HTMLElement, frontmatter: Record<string, unknown>): void {
		const controls = this.formRow(host, t('pm.f.stage'));
		const select = controls.createEl('select', { cls: 'dashboard-pipeline-cfg-select' });
		const current = pmField(frontmatter, 'stage');
		if (!current) select.createEl('option', { text: '—', attr: { value: '' } });
		for (const stage of this.cfg.stages) {
			select.createEl('option', { text: stage.label, attr: { value: stage.label } });
		}
		select.value = current;
		select.addEventListener('change', () => void this.writeField('stage', select.value));
	}

	private datePair(host: HTMLElement, label: string, start: string, end: string): void {
		const controls = this.formRow(host, label);
		const startInput = controls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });
		startInput.value = start;
		const endInput = controls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });
		endInput.value = end;
		startInput.addEventListener('change', () => void this.writeField('cycleStart', startInput.value));
		endInput.addEventListener('change', () => void this.writeField('cycleEnd', endInput.value));
	}

	private keyDateRow(host: HTMLElement, frontmatter: Record<string, unknown>): void {
		const controls = this.formRow(host, t('pm.f.keyDate'));
		const raw = pmField(frontmatter, 'keyDate');
		const [date, time] = raw.split(/\s+/);
		const dateInput = controls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-date', attr: { type: 'date' } });
		dateInput.value = (date ?? '').slice(0, 10);
		const timeInput = controls.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-time', attr: { type: 'time' } });
		timeInput.value = (time ?? '').slice(0, 5);
		// Remind toggle as a BARE alarm-clock icon (Rae): no checkbox chrome —
		// muted when off, red when the reminder is armed. Click flips it.
		const remindBtn = controls.createEl('button', {
			cls: 'dashboard-pmsec-remind' + (frontmatter['remind'] === true ? ' is-armed' : ''),
			attr: { type: 'button', 'aria-label': t('pm.remindToggle'), title: t('pm.remindToggle') },
		});
		setIcon(remindBtn, 'alarm-clock');
		remindBtn.addEventListener('click', () => {
			const armed = !remindBtn.hasClass('is-armed');
			remindBtn.classList[armed ? 'add' : 'remove']('is-armed');
			void this.writeField('remind', armed ? 'true' : '');
		});
		const write = (): void => {
			const value = [dateInput.value, timeInput.value].filter(Boolean).join(' ');
			void this.writeField('keyDate', value);
		};
		dateInput.addEventListener('change', write);
		timeInput.addEventListener('change', write);
	}

	/** Write one canonical frontmatter key (empty deletes). */
	private async writeField(key: string, value: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.projectFile, fm => {
			if (key === 'remind') {
				if (value === 'true') fm['remind'] = true;
				else delete fm['remind'];
				return;
			}
			if (value) fm[key] = value;
			else delete fm[key];
		});
		notifyPmChanged();
		this.onChanged?.();
	}

	private checklistSection(
		host: HTMLElement, title: string, tasks: PipelineTask[], section: 'milestone' | 'todo',
	): void {
		const sec = host.createDiv({ cls: `dashboard-library-config-section dashboard-pmsec-section--${section}` });
		const titleRow = sec.createDiv({ cls: 'dashboard-pmsec-check-title' });
		titleRow.createDiv({ cls: 'dashboard-library-config-section-title', text: title });
		const done = tasks.filter(task => task.checked).length;
		titleRow.createSpan({ cls: 'dashboard-pmsec-check-count', text: `${done}/${tasks.length}` });
		const list = sec.createDiv({ cls: 'dashboard-pmsec-checklist' });
		if (tasks.length === 0) {
			list.createDiv({ cls: 'dashboard-library-empty', text: '—' });
		}
		for (const task of tasks) {
			const item = list.createDiv({ cls: 'dashboard-pmsec-check-item' });
			const box = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': task.text } });
			box.checked = task.checked;
			box.addEventListener('change', () => {
				const completed = list.querySelectorAll('input[type="checkbox"]:checked').length;
				titleRow.querySelector<HTMLElement>('.dashboard-pmsec-check-count')!.textContent = `${completed}/${tasks.length}`;
				if (section === 'milestone') {
					const banner = this.contentEl.querySelector<HTMLElement>('.dashboard-pmsec-progress-banner');
					const pct = banner?.querySelector<HTMLElement>('.dashboard-pmsec-progress-pct');
					const label = banner?.querySelector<HTMLElement>('.dashboard-pmsec-progress-label');
					if (pct) pct.textContent = `${Math.round((completed / tasks.length) * 100)}%`;
					if (label) label.textContent = `${t('pm.board.milestones')} ${completed}/${tasks.length}`;
					banner?.querySelectorAll('.dashboard-pmsec-step')[tasks.indexOf(task)]?.classList.toggle('is-done', box.checked);
				}
				void this.toggleTask(task.line);
			});
			const label = item.createDiv({ cls: 'dashboard-pmsec-check-text', text: task.text });
			if (task.due) label.createSpan({ cls: 'dashboard-pmsec-check-due', text: task.due });
			const del = item.createEl('button', {
				cls: 'dashboard-pipeline-cfg-icon-btn dashboard-pipeline-cfg-icon-btn--danger',
				attr: { type: 'button', 'aria-label': t('common.delete') },
			});
			setIcon(del, 'trash-2');
			del.addEventListener('click', () => { void this.removeTask(task.line); });
		}
		const addRow = sec.createDiv({ cls: 'dashboard-pmsec-add-row' });
		const input = addRow.createEl('input', { cls: 'dashboard-modal-input', attr: { type: 'text', placeholder: t(section === 'milestone' ? 'pm.addMilestone' : 'pm.addTodo') } });
		// Todo add row carries a time picker (Rae): pick 截止/计划 + date
		// (+optional time) and the commit writes the inline marker — no more
		// hand-typed [due:: …] syntax. Milestones stay plain.
		let kindSelect: HTMLSelectElement | null = null;
		let dateInput: HTMLInputElement | null = null;
		let timeInput: HTMLInputElement | null = null;
		if (section === 'todo') {
			kindSelect = addRow.createEl('select', { cls: 'dashboard-pmsec-add-kind' });
			kindSelect.createEl('option', { text: t('pm.addTodoNone'), attr: { value: '' } });
			kindSelect.createEl('option', { text: t('pm.addTodoDue'), attr: { value: 'due' } });
			kindSelect.createEl('option', { text: t('pm.addTodoScheduled'), attr: { value: 'scheduled' } });
			dateInput = addRow.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-add-date', attr: { type: 'date', 'aria-label': t('pm.f.keyDate') } });
			timeInput = addRow.createEl('input', { cls: 'dashboard-modal-input dashboard-pmsec-add-time', attr: { type: 'time', 'aria-label': t('pm.addTodoTime') } });
		}
		const addBtn = addRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.add') });
		const commit = (): void => {
			const value = input.value.trim();
			if (!value) return;
			input.value = '';
			let text = value;
			if (kindSelect && dateInput && kindSelect.value && dateInput.value) {
				const stamp = [dateInput.value, timeInput?.value ?? ''].filter(Boolean).join(' ');
				text = `${value} [${kindSelect.value}:: ${stamp}]`;
				dateInput.value = '';
				if (timeInput) timeInput.value = '';
				kindSelect.value = '';
			}
			void this.addTask(section, text);
		};
		addBtn.addEventListener('click', commit);
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) commit(); });
	}

	/** Structural checklist edits: read → transform → write → re-render. */
	private async mutateFile(transform: (content: string) => string): Promise<void> {
		const content = await this.app.vault.read(this.projectFile);
		await this.app.vault.modify(this.projectFile, transform(content));
		notifyPmChanged();
		this.onChanged?.();
		await this.renderBody();
	}

	private async toggleTask(line: number): Promise<void> {
		const content = await this.app.vault.read(this.projectFile);
		await this.app.vault.modify(this.projectFile, toggleTaskLine(content, line));
		notifyPmChanged();
		this.onChanged?.();
	}

	private async addTask(section: 'milestone' | 'todo', text: string): Promise<void> {
		await this.mutateFile(content => insertProjectTask(content, section, text));
	}

	private async removeTask(line: number): Promise<void> {
		await this.mutateFile(content => removeProjectTask(content, line));
	}

	private filesSection(host: HTMLElement, frontmatter: Record<string, unknown>): void {
		const sec = host.createDiv({ cls: 'dashboard-library-config-section dashboard-pmsec-section--files' });
		const titleRow = sec.createDiv({ cls: 'dashboard-library-config-inline-row' });
		titleRow.createDiv({ cls: 'dashboard-library-config-section-title', text: t('pm.board.files') });
		const addBtn = titleRow.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pm.board.addWorkNote') });
		addBtn.addEventListener('click', () => {
			void (async () => {
				await createPmWorkNote(this.app, this.projectFile, this.cfg);
				await this.renderBody();
			})();
		});

		// Collections first (the search below excludes what's already shown).
		const linked = pmLinkedFiles(frontmatter);
		const folder = projectFolder(this.cfg.rootFolder ?? '', this.projectFile.basename);
		const folderFiles = this.app.vault.getFiles()
			.filter(f => f.path.startsWith(`${folder}/`) && f.path !== this.projectFile.path)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);

		// Link an EXISTING vault file: plain-name search — type ANY part of
		// a file name and live matches drop below the row (no "[[" prefix
		// ritual). Enter or the 链接 button takes the first match; clicking
		// a row picks that file. An exact path also works when pasted.
		const linkRow = sec.createDiv({ cls: 'dashboard-pmsec-add-row dashboard-pmsec-link-row' });
		const linkInput = linkRow.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('pm.linkFilePh') },
		});
		const linkBtn = linkRow.createEl('button', { cls: 'dashboard-modal-btn', text: t('pm.linkFile') });
		const results = sec.createDiv({ cls: 'dashboard-pmsec-link-results' });
		results.style.display = 'none';
		let matches: TFile[] = [];

		const alreadyListed = new Set<string>([...pmLinkedFiles(frontmatter), ...folderFiles.map(f => f.path)]);
		const renderResults = (): void => {
			results.empty();
			if (matches.length === 0) {
				results.style.display = 'none';
				return;
			}
			results.style.display = 'flex';
			for (const file of matches) {
				const item = results.createDiv({ cls: 'dashboard-pmsec-link-item' });
				setIcon(item.createSpan({ cls: 'dashboard-pmsec-link-item-icon' }), iconForExtension(file.path));
				const info = item.createDiv({ cls: 'dashboard-pmsec-link-item-info' });
				info.createDiv({ cls: 'dashboard-pmsec-link-item-name', text: file.basename });
				info.createDiv({ cls: 'dashboard-pmsec-link-item-path', text: file.parent?.path ?? '/' });
				item.addEventListener('click', () => pick(file));
			}
		};
		const refreshMatches = (): void => {
			const query = linkInput.value.trim().toLowerCase();
			if (!query) {
				matches = [];
				renderResults();
				return;
			}
			matches = this.app.vault.getFiles()
				.filter(f => f !== this.projectFile
					&& !alreadyListed.has(f.path)
					&& (f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query)))
				.slice(0, 8);
			renderResults();
		};
		const pick = (file: TFile): void => {
			linkInput.value = '';
			matches = [];
			renderResults();
			void this.linkFile(file);
		};
		const commitLink = (): void => {
			if (matches[0]) {
				pick(matches[0]);
				return;
			}
			// No live match: try the input as an exact vault path (pasted
			// links keep working, with or without [[ ]] and .md).
			const raw = linkInput.value.replace(/\[\[|\]\]/g, '').split('#')[0]!.trim();
			if (!raw) return;
			const target = this.app.vault.getFileByPath(raw.endsWith('.md') ? raw : `${raw}.md`)
				?? this.app.metadataCache.getFirstLinkpathDest(raw, this.projectFile.path);
			if (!target) {
				new Notice(t('pm.fileMissing'));
				return;
			}
			pick(target);
		};
		linkInput.addEventListener('input', refreshMatches);
		linkBtn.addEventListener('click', commitLink);
		linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) commitLink(); });
		linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) commitLink(); });

		// Linked files (frontmatter `files`) first — they carry an unlink
		// button — then the project folder's own contents, deduped.
		const list = sec.createDiv({ cls: 'dashboard-pmsec-files' });
		if (linked.length === 0 && folderFiles.length === 0) {
			list.createDiv({ cls: 'dashboard-library-empty', text: t('pm.board.noFiles') });
			return;
		}
		const linkedSet = new Set(linked);
		for (const path of linked) {
			const file = this.app.vault.getFileByPath(path.endsWith('.md') ? path : `${path}.md`);
			const item = list.createDiv({ cls: 'dashboard-pmsec-file dashboard-pmsec-file--linked' });
			setIcon(item.createSpan({ cls: 'dashboard-pmsec-file-icon' }), file ? iconForExtension(file.path) : 'file-question');
			item.createSpan({ cls: 'dashboard-pmsec-file-name', text: file ? file.basename : path });
			if (file) {
				item.addEventListener('click', () => new NotePopoverModal(this.app, file).open());
				attachNoteHover(this.app, item, file, this.containerEl as unknown as import('obsidian').HoverParent);
			} else {
				item.addClass('dashboard-pmsec-file--missing');
			}
			const unlink = item.createEl('button', {
				cls: 'dashboard-pmsec-file-unlink',
				attr: { type: 'button', 'aria-label': t('pm.unlink'), title: t('pm.unlink') },
			});
			setIcon(unlink, 'unlink');
			unlink.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.unlinkFile(path);
			});
		}
		for (const file of folderFiles) {
			if (linkedSet.has(file.path)) continue;
			const item = list.createDiv({ cls: 'dashboard-pmsec-file' });
			setIcon(item.createSpan({ cls: 'dashboard-pmsec-file-icon' }), iconForExtension(file.path));
			item.createSpan({ cls: 'dashboard-pmsec-file-name', text: file.basename });
			// Notes open in the floating popover (the dashboard's reading
			// surface), not a workspace tab — the board stays put underneath.
			item.addEventListener('click', () => new NotePopoverModal(this.app, file).open());
			attachNoteHover(this.app, item, file, this.containerEl as unknown as import('obsidian').HoverParent);
		}
	}

	/** Append a vault path to the note's frontmatter `files` list (deduped). */
	private async linkFile(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.projectFile, fm => {
			const current = pmLinkedFiles(fm);
			if (!current.includes(file.path)) fm['files'] = [...current, file.path];
		});
		notifyPmChanged();
		this.onChanged?.();
		await this.renderBody();
	}

	/** Remove one path from the frontmatter `files` list (the file itself is
	 *  untouched — linking never moves or copies anything). */
	private async unlinkFile(path: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.projectFile, fm => {
			const next = pmLinkedFiles(fm).filter(p => p !== path);
			if (next.length > 0) fm['files'] = next;
			else delete fm['files'];
		});
		notifyPmChanged();
		this.onChanged?.();
		await this.renderBody();
	}

	private async renameProject(): Promise<void> {
		const name = await showPromptDialog(this.app, { title: t('pm.board.renamed'), defaultValue: this.projectFile.basename });
		if (!name || name.trim() === this.projectFile.basename) return;
		try {
			await this.app.fileManager.renameFile(this.projectFile, `${this.projectFile.parent?.path ? this.projectFile.parent.path + '/' : ''}${name.trim()}.md`);
			new Notice(t('pm.board.renamed'));
			notifyPmChanged();
			await this.renderBody();
		} catch {
			new Notice(t('pipeline.renameFailed'));
		}
	}
}
