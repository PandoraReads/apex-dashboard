import { App, Modal, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import type { PinnedNote, QuickCommand, QuickNotePreset } from './types';
import { IconPickerModal } from './icon-picker-modal';
import type { AppWithCommands } from './obsidian-internal';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/**
 * Configuration modal for the Quick Notes region: CRUD for create-presets,
 * pinned-note shortcuts and quick commands, plus capture (target/folder) and
 * "today" toggles. All edits live in local copies until Save, which commits to
 * global settings, persists, and refreshes open dashboards.
 */
export class QuickNoteConfigModal extends Modal {
	private plugin: DashboardPlugin;
	private presets: QuickNotePreset[];
	private pinned: PinnedNote[];
	private commands: QuickCommand[];
	private captureEnabled: boolean;
	private captureTarget: string;
	private captureFolder: string;
	private captureTemplate: string;
	private capturePosition: 'start' | 'end';
	private dailyEnabled: boolean;
	/** Index + list of the row currently being dragged (null when idle). */
	private dragIndex: number | null = null;
	private dragKind: 'preset' | 'pinned' | 'command' | null = null;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app);
		this.plugin = plugin;
		const s = plugin.settings;
		this.presets = s.quickNotePresets.map(p => ({ ...p }));
		this.pinned = s.pinnedNotes.map(p => ({ ...p }));
		this.commands = (s.quickCommands ?? []).map(c => ({ ...c }));
		this.captureEnabled = s.quickCaptureEnabled;
		this.captureTarget = s.quickCaptureTarget;
		this.captureFolder = s.quickCaptureFolder;
		this.captureTemplate = s.quickCaptureTemplate;
		this.capturePosition = s.quickCapturePosition === 'end' ? 'end' : 'start';
		this.dailyEnabled = s.quickDailyEnabled;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		this.renderBody();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderBody(): void {
		const { contentEl } = this;
		contentEl.empty();
		const container = contentEl.createDiv({
			cls: 'dashboard-modal dashboard-modal--compact dashboard-quicknote-config',
		});
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('quickNote.configTitle') });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const form = body.createDiv({ cls: 'dashboard-modal-form' });
		this.renderPresets(form);
		this.renderPinned(form);
		this.renderCommands(form);
		this.renderCapture(form);
		this.renderDaily(form);
		this.renderActions(container);
	}

	// ── Presets ────────────────────────────────────────────────────────────

	private renderPresets(form: HTMLElement): void {
		const section = this.section(form, t('quickNote.presets'), t('quickNote.presetsDesc'));
		const list = section.createDiv({ cls: 'dashboard-quicknote-cfg-list' });
		this.presets.forEach((_, i) => this.renderPresetRow(list, i));

		this.addBtn(section, t('quickNote.addPreset'), () => {
			this.presets = [...this.presets, {
				id: uid(), label: '', icon: 'file-plus',
				templatePath: '', folder: '', filename: '{{date:YYYY-MM-DD}}',
			}];
			this.renderBody();
		});
	}

	private renderPresetRow(list: HTMLElement, i: number): void {
		const preset = this.presets[i]!;
		const card = list.createDiv({ cls: 'dashboard-quicknote-cfg-item' });

		const top = card.createDiv({ cls: 'dashboard-quicknote-cfg-top' });
		this.wireDrag(top, card, i, 'preset', (from, to) => {
			this.presets = this.reorderArray(this.presets, from, to);
			this.renderBody();
		});
		this.iconPickBtn(top, preset.icon || 'file-plus', (name) => this.updatePreset(i, { icon: name }));
		this.textInput(top, preset.label, '', { cls: 'dashboard-quicknote-cfg-label', placeholder: t('quickNote.fieldLabel') }, (v) => this.updatePreset(i, { label: v }));
		this.delBtn(top, () => { this.presets = this.presets.filter((_, idx) => idx !== i); this.renderBody(); });

		this.textInput(card, preset.templatePath, '', { placeholder: t('quickNote.fieldTemplatePh') }, (v) => this.updatePreset(i, { templatePath: v }));
		this.textInput(card, preset.folder, '', { placeholder: t('quickNote.fieldFolderPh') }, (v) => this.updatePreset(i, { folder: v }));
		this.textInput(card, preset.filename, '', { placeholder: t('quickNote.fieldFilenamePh') }, (v) => this.updatePreset(i, { filename: v }));
	}

	private updatePreset(i: number, patch: Partial<QuickNotePreset>): void {
		this.presets = this.presets.map((p, idx) => idx === i ? { ...p, ...patch } : p);
	}

	// ── Pinned ─────────────────────────────────────────────────────────────

	private renderPinned(form: HTMLElement): void {
		const section = this.section(form, t('quickNote.pinned'), t('quickNote.pinnedDesc'));
		const list = section.createDiv({ cls: 'dashboard-quicknote-cfg-list' });
		this.pinned.forEach((_, i) => this.renderPinnedRow(list, i));

		this.addBtn(section, t('quickNote.addPinned'), () => {
			this.pinned = [...this.pinned, { id: uid(), label: '', icon: 'pin', path: '' }];
			this.renderBody();
		});
	}

	private renderPinnedRow(list: HTMLElement, i: number): void {
		const note = this.pinned[i]!;
		const card = list.createDiv({ cls: 'dashboard-quicknote-cfg-item' });
		const top = card.createDiv({ cls: 'dashboard-quicknote-cfg-top' });
		this.wireDrag(top, card, i, 'pinned', (from, to) => {
			this.pinned = this.reorderArray(this.pinned, from, to);
			this.renderBody();
		});
		this.iconPickBtn(top, note.icon || 'pin', (name) => this.updatePinned(i, { icon: name }));
		this.textInput(top, note.label, '', { cls: 'dashboard-quicknote-cfg-label', placeholder: t('quickNote.fieldLabel') }, (v) => this.updatePinned(i, { label: v }));
		this.delBtn(top, () => { this.pinned = this.pinned.filter((_, idx) => idx !== i); this.renderBody(); });
		this.textInput(card, note.path, '', { placeholder: t('quickNote.fieldPathPh') }, (v) => this.updatePinned(i, { path: v }));
	}

	private updatePinned(i: number, patch: Partial<PinnedNote>): void {
		this.pinned = this.pinned.map((p, idx) => idx === i ? { ...p, ...patch } : p);
	}

	// ── Commands ───────────────────────────────────────────────────────────

	private renderCommands(form: HTMLElement): void {
		const section = this.section(form, t('quickNote.commands'), t('quickNote.commandsDesc'));
		const list = section.createDiv({ cls: 'dashboard-quicknote-cfg-list' });
		this.commands.forEach((_, i) => this.renderCommandRow(list, i));

		this.addBtn(section, t('quickNote.addCommand'), () => {
			new CommandSearchModal(this.app, (entry) => {
				this.commands = [...this.commands, {
					id: uid(), label: entry.name, icon: 'terminal', commandId: entry.id,
				}];
				// Commands are committed immediately (unlike presets/pinned, which
				// wait for Save): picking one from the search list is an explicit
				// "add this" action, and the chip should survive closing the modal
				// without Save (e.g. via Esc or the X).
				void this.commitCommands();
				this.renderBody();
			}).open();
		});
	}

	private renderCommandRow(list: HTMLElement, i: number): void {
		const cmd = this.commands[i]!;
		const card = list.createDiv({ cls: 'dashboard-quicknote-cfg-item' });
		const top = card.createDiv({ cls: 'dashboard-quicknote-cfg-top' });
		this.wireDrag(top, card, i, 'command', (from, to) => {
			this.commands = this.reorderArray(this.commands, from, to);
			void this.commitCommands();
			this.renderBody();
		});
		this.iconPickBtn(top, cmd.icon || 'terminal', (name) => this.updateCommand(i, { icon: name }));
		this.textInput(top, cmd.label, '', { cls: 'dashboard-quicknote-cfg-label', placeholder: t('quickNote.fieldLabel') }, (v) => this.updateCommand(i, { label: v }));
		this.delBtn(top, () => {
			this.commands = this.commands.filter((_, idx) => idx !== i);
			void this.commitCommands();
			this.renderBody();
		});
		// Read-only command id under the top bar (picked via search, not typed).
		card.createDiv({ cls: 'dashboard-quicknote-cfg-cmd-id', text: cmd.commandId });
	}

	/** Persist the quick-command list right away (add/delete/reorder are
	 *  immediate actions; only label/icon edits still ride on Save). */
	private async commitCommands(): Promise<void> {
		this.plugin.settings = {
			...this.plugin.settings,
			quickCommands: this.commands.filter(c => c.commandId.trim() && c.label.trim()),
		};
		await this.plugin.saveSettings();
		this.plugin.refreshAllDashboards();
	}

	private updateCommand(i: number, patch: Partial<QuickCommand>): void {
		this.commands = this.commands.map((c, idx) => idx === i ? { ...c, ...patch } : c);
	}

	// ── Capture ────────────────────────────────────────────────────────────

	private renderCapture(form: HTMLElement): void {
		const section = this.section(form, t('quickNote.capture'), t('quickNote.captureDesc'));
		const toggleRow = section.createDiv({ cls: 'dashboard-quicknote-cfg-toggle' });
		const cb = toggleRow.createEl('input', { attr: { type: 'checkbox', id: 'qn-capture' } });
		cb.checked = this.captureEnabled;
		cb.addEventListener('change', () => { this.captureEnabled = cb.checked; });
		toggleRow.createEl('label', { attr: { for: 'qn-capture' }, text: t('quickNote.captureEnable') });

		this.textInput(section, this.captureTarget, '', { placeholder: t('quickNote.fieldCaptureTargetPh') }, (v) => { this.captureTarget = v; });
		this.textInput(section, this.captureFolder, '', { placeholder: t('quickNote.fieldCaptureFolderPh') }, (v) => { this.captureFolder = v; });
		this.textInput(section, this.captureTemplate, '', { placeholder: t('quickNote.fieldCaptureTemplatePh') }, (v) => { this.captureTemplate = v; });

		// Top vs bottom of the capture target (and of the template in new
		// fleeting notes). Reuses the toggle-row layout: label left, control right.
		const posRow = section.createDiv({ cls: 'dashboard-quicknote-cfg-toggle' });
		posRow.createEl('label', { attr: { for: 'qn-capture-pos' }, text: t('quickNote.capturePosition') });
		const posSelect = posRow.createEl('select', { cls: 'dashboard-modal-input', attr: { id: 'qn-capture-pos' } });
		const startOpt = posSelect.createEl('option', { text: t('quickNote.capturePositionStart'), attr: { value: 'start' } });
		const endOpt = posSelect.createEl('option', { text: t('quickNote.capturePositionEnd'), attr: { value: 'end' } });
		(this.capturePosition === 'end' ? endOpt : startOpt).selected = true;
		posSelect.addEventListener('change', () => { this.capturePosition = posSelect.value === 'end' ? 'end' : 'start'; });
	}

	// ── Daily ──────────────────────────────────────────────────────────────

	private renderDaily(form: HTMLElement): void {
		const section = this.section(form, t('quickNote.daily'), t('quickNote.dailyDesc'));
		const toggleRow = section.createDiv({ cls: 'dashboard-quicknote-cfg-toggle' });
		const cb = toggleRow.createEl('input', { attr: { type: 'checkbox', id: 'qn-daily' } });
		cb.checked = this.dailyEnabled;
		cb.addEventListener('change', () => { this.dailyEnabled = cb.checked; });
		toggleRow.createEl('label', { attr: { for: 'qn-daily' }, text: t('quickNote.dailyEnable') });
	}

	// ── Actions ────────────────────────────────────────────────────────────

	private renderActions(container: HTMLElement): void {
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => { void this.save(); });
	}

	private async save(): Promise<void> {
		this.plugin.settings = {
			...this.plugin.settings,
			quickNotePresets: this.presets.filter(p => p.label.trim()),
			pinnedNotes: this.pinned.filter(p => p.label.trim() && p.path.trim()),
			quickCommands: this.commands.filter(c => c.commandId.trim() && c.label.trim()),
			quickCaptureEnabled: this.captureEnabled,
			quickCaptureTarget: this.captureTarget.trim(),
			quickCaptureFolder: this.captureFolder.trim(),
			quickCaptureTemplate: this.captureTemplate.trim(),
			quickCapturePosition: this.capturePosition,
			quickDailyEnabled: this.dailyEnabled,
		};
		await this.plugin.saveSettings();
		this.plugin.refreshAllDashboards();
		this.close();
	}

	// ── Shared row helpers ─────────────────────────────────────────────────

	private section(parent: HTMLElement, title: string, desc: string): HTMLElement {
		const sec = parent.createDiv({ cls: 'dashboard-quicknote-cfg-section' });
		sec.createEl('h3', { text: title });
		sec.createEl('p', { cls: 'dashboard-quicknote-cfg-desc', text: desc });
		return sec;
	}

	private textInput(
		parent: HTMLElement,
		value: string,
		_default: string,
		opts: { cls?: string; placeholder: string },
		onInput: (v: string) => void,
	): HTMLInputElement {
		const input = parent.createEl('input', {
			cls: `dashboard-modal-input ${opts.cls ?? ''}`.trim(),
			attr: { type: 'text', placeholder: opts.placeholder },
		});
		input.value = value;
		input.addEventListener('input', () => onInput(input.value));
		return input;
	}

	private delBtn(parent: HTMLElement, onClick: () => void): HTMLButtonElement {
		const btn = parent.createEl('button', {
			cls: 'dashboard-quicknote-cfg-del',
			attr: { 'aria-label': t('common.delete'), title: t('common.delete') },
		});
		setIcon(btn, 'trash-2');
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** A square button showing the current icon; opens the icon picker on click. */
	private iconPickBtn(parent: HTMLElement, currentIcon: string, onPick: (name: string) => void): HTMLButtonElement {
		const btn = parent.createEl('button', {
			cls: 'dashboard-quicknote-cfg-icon-btn',
			attr: { 'aria-label': t('quickNote.pickIcon'), title: t('quickNote.pickIcon') },
		});
		setIcon(btn, currentIcon);
		btn.addEventListener('click', () => {
			new IconPickerModal(this.app, (name) => {
				setIcon(btn, name);
				onPick(name);
			}).open();
		});
		return btn;
	}

	private addBtn(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
		const btn = parent.createEl('button', { cls: 'dashboard-quicknote-cfg-add', text: label });
		btn.addEventListener('click', onClick);
		return btn;
	}

	// ── Drag-to-reorder (per list) ─────────────────────────────────────────

	/**
	 * Make a cfg row reorderable via a leading grip handle. Dragging is gated on
	 * the grip (pointerdown flips the card to `draggable`) so the inner text
	 * inputs stay selectable. Drop position is derived from the pointer's half
	 * over the target row; the closure commits the reordered array + re-renders.
	 */
	private wireDrag(
		topBar: HTMLElement,
		card: HTMLElement,
		index: number,
		kind: 'preset' | 'pinned' | 'command',
		onReorder: (from: number, to: number) => void,
	): void {
		card.draggable = false;
		const grip = topBar.createSpan({
			cls: 'dashboard-quicknote-cfg-grip',
			attr: { 'aria-hidden': 'true', title: t('common.drag') },
		});
		setIcon(grip, 'grip-vertical');
		// Only the grip arms dragging; releasing without a drag disarms it again.
		grip.addEventListener('pointerdown', () => { card.draggable = true; });
		grip.addEventListener('pointerup', () => { card.draggable = false; });

		card.addEventListener('dragstart', (e: DragEvent) => {
			if (!card.draggable) return;
			this.dragIndex = index;
			this.dragKind = kind;
			card.addClass('dashboard-quicknote-cfg-item--dragging');
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', 'qn-row');
			}
		});
		card.addEventListener('dragend', () => {
			card.removeClass('dashboard-quicknote-cfg-item--dragging');
			card.draggable = false;
			this.clearDragIndicators();
			this.dragIndex = null;
			this.dragKind = null;
		});
		card.addEventListener('dragover', (e: DragEvent) => {
			if (this.dragKind !== kind || this.dragIndex == null) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			this.indicateDrop(card, this.dropHalf(e, card));
		});
		card.addEventListener('drop', (e: DragEvent) => {
			if (this.dragKind !== kind || this.dragIndex == null) return;
			e.preventDefault();
			const from = this.dragIndex;
			const to = this.dropHalf(e, card) === 'top' ? index : index + 1;
			this.clearDragIndicators();
			// Reset before onReorder: a successful drop re-renders, detaching the
			// source card before its dragend can fire.
			this.dragIndex = null;
			this.dragKind = null;
			if (from !== to) onReorder(from, to);
		});
	}

	/** Which half of `card` the pointer sits in — decides insert-before vs -after. */
	private dropHalf(e: DragEvent, card: HTMLElement): 'top' | 'bottom' {
		const rect = card.getBoundingClientRect();
		return e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
	}

	private indicateDrop(card: HTMLElement, half: 'top' | 'bottom'): void {
		this.clearDragIndicators();
		card.addClass(half === 'top' ? 'dashboard-quicknote-cfg-item--drop-before' : 'dashboard-quicknote-cfg-item--drop-after');
	}

	private clearDragIndicators(): void {
		this.contentEl
			.querySelectorAll('.dashboard-quicknote-cfg-item--drop-before, .dashboard-quicknote-cfg-item--drop-after')
			.forEach(el => el.classList.remove('dashboard-quicknote-cfg-item--drop-before', 'dashboard-quicknote-cfg-item--drop-after'));
	}

	/** Return a new array with the item at `from` moved to slot `to` (pre-removal index). */
	private reorderArray<T>(arr: T[], from: number, to: number): T[] {
		if (from < 0 || from >= arr.length || from === to) return arr;
		const next = [...arr];
		const moved = next.splice(from, 1)[0];
		if (!moved) return arr;
		const insertAt = to > from ? to - 1 : to;
		next.splice(insertAt, 0, moved);
		return next;
	}
}

function uid(): string {
	return `qn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Live-filtered picker over the vault command registry (core + plugins).
 * Clicking a row invokes `onPick` with the command id + name; label and icon
 * are edited inline in the config row afterwards. Stacks over the config
 * modal the same way IconPickerModal does.
 */
class CommandSearchModal extends Modal {
	private readonly onPick: (entry: { id: string; name: string }) => void;

	constructor(app: App, onPick: (entry: { id: string; name: string }) => void) {
		super(app);
		this.onPick = onPick;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('quickNote.commandSearchTitle') });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const wrap = body.createDiv({ cls: 'dashboard-docsearch' });
		const input = wrap.createEl('input', {
			cls: 'dashboard-modal-input dashboard-docsearch-input',
			attr: { type: 'text', placeholder: t('quickNote.commandSearchPh'), autofocus: 'true' },
		});
		const results = wrap.createDiv({ cls: 'dashboard-docsearch-results' });

		const renderResults = (query: string) => {
			results.empty();
			const q = query.toLowerCase().trim();
			if (!q) {
				results.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.typeToSearchCmd') });
				return;
			}
			const commands = (this.app as AppWithCommands).commands.commands;
			if (!commands) {
				results.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
				return;
			}
			// Registry can hold hundreds of entries; filter → sort → top-30
			// matches the shipped quick-actions command search cost.
			const entries = Object.entries(commands)
				.map(([id, cmd]) => ({ id, name: cmd.name ?? id }))
				.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 30);
			if (entries.length === 0) {
				results.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
				return;
			}
			for (const e of entries) {
				const item = results.createDiv({ cls: 'dashboard-docsearch-item' });
				setIcon(item.createSpan({ cls: 'dashboard-docsearch-icon' }), 'terminal');
				const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
				info.createDiv({ cls: 'dashboard-docsearch-name', text: e.name });
				info.createDiv({ cls: 'dashboard-docsearch-path', text: e.id });
				item.addEventListener('click', () => {
					this.onPick(e);
					this.close();
				});
			}
		};

		input.addEventListener('input', () => renderResults(input.value));
		renderResults(input.value);
		input.focus();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
