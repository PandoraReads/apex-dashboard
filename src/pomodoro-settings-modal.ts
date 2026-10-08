import { App, Modal, Notice } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import type { PomodoroService } from './pomodoro-service';
import { renderPomodoroTagList } from './pomodoro-tag-manager';
import { WidgetBackgroundModal, type WidgetPluginHandle } from './widget-background';
import type { DashboardSettings, WidgetBackground } from './types';

/**
 * Pomodoro widget settings — the card gear's dialog. Gathers the stopwatch
 * reminder cadence (used to be a bell key on the card), tag management (used
 * to be a header button in the stats panel) and the card background in one
 * place. Everything applies immediately: the reminder write re-renders the
 * dashboards and the live stopwatch re-arms one full interval out by design
 * (the service diffs the setting), tag mutations persist through the service,
 * and the nested background editor commits through the widget's onBgChange.
 * No Save step, no local draft state.
 */
export class PomodoroSettingsModal extends Modal {
	private bg: WidgetBackground | undefined;
	private bgDescEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly service: PomodoroService,
		private readonly plugin: WidgetPluginHandle,
		bg: WidgetBackground | undefined,
		private readonly onBgChange: (bg: WidgetBackground | undefined) => void,
	) {
		super(app);
		this.bg = bg ? { ...bg } : undefined;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-pomodoro-settings' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('pomodoro.settingsTitle') });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const form = body.createDiv({ cls: 'dashboard-modal-form' });

		this.renderMode(form);
		this.renderReminder(form);
		this.renderTags(form);
		this.renderBackground(form);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ── Timing mode (countdown / stopwatch) ────────────────────────────────

	private renderMode(form: HTMLElement): void {
		const section = this.section(form, t('settings.pomodoroMode'), t('settings.pomodoroModeDesc'));

		/** Re-sync both boxes to the persisted setting (also reverts a
		 *  blocked attempt after the busy toast). */
		const boxes: HTMLInputElement[] = [];
		const sync = (): void => {
			for (const cb of boxes) cb.checked = false;
			const current = this.plugin.settings.pomodoroMode === 'stopwatch' ? 1 : 0;
			if (boxes[current]) boxes[current]!.checked = true;
		};

		// Mutually exclusive check rows (the quick-capture purpose idiom): the
		// active one refuses to be unticked, ticking the other flips the mode.
		// A live run pins its start-time mode (service design), so a mid-run
		// flip would appear to do nothing — block it with the same toast the
		// card's old toggle key used and re-sync the rows to the setting.
		for (const mode of ['timer', 'stopwatch'] as const) {
			const row = section.createDiv({ cls: 'dashboard-quicknote-cfg-toggle' });
			const cb = row.createEl('input', { attr: { type: 'checkbox', id: `pn-mode-${mode}` } });
			row.createEl('label', {
				attr: { for: `pn-mode-${mode}` },
				text: t(mode === 'timer' ? 'settings.pomodoroModeTimer' : 'settings.pomodoroModeStopwatch'),
			});
			cb.checked = this.plugin.settings.pomodoroMode === mode;
			cb.addEventListener('change', () => {
				if (!cb.checked) {
					cb.checked = true; // the active row stays checked
					return;
				}
				if (this.service.getState().status !== 'idle') {
					new Notice(t('pomodoro.modeSwitchBusy'));
					sync();
					return;
				}
				this.plugin.settings = {
					...this.plugin.settings,
					pomodoroMode: mode,
				};
				void this.plugin.saveSettings().then(() => this.plugin.refreshAllDashboards());
				sync();
			});
			boxes.push(cb);
		}
	}

	private renderReminder(form: HTMLElement): void {
		const section = this.section(form, t('settings.pomodoroStopwatchReminder'), t('settings.pomodoroStopwatchReminderDesc'));
		const input = section.createEl('input', {
			cls: 'dashboard-modal-input dashboard-pomodoro-settings-reminder',
			attr: { type: 'text', inputmode: 'numeric', placeholder: '0' },
		});
		input.value = this.plugin.settings.pomodoroStopwatchReminderMinutes > 0
			? String(this.plugin.settings.pomodoroStopwatchReminderMinutes)
			: '';
		// Commit on change (blur/Enter), not per keystroke: the write re-renders
		// every dashboard, which would fight the caret mid-typing.
		input.addEventListener('change', () => {
			const parsed = Math.min(240, Math.max(0, parseInt(input.value, 10) || 0));
			input.value = parsed > 0 ? String(parsed) : '';
			this.plugin.settings = {
				...this.plugin.settings,
				pomodoroStopwatchReminderMinutes: parsed,
			};
			void this.plugin.saveSettings().then(() => this.plugin.refreshAllDashboards());
		});
	}

	// ── Tags ───────────────────────────────────────────────────────────────

	private renderTags(form: HTMLElement): void {
		const section = this.section(form, t('pomodoro.tagTitle'), t('pomodoro.tagHint'));
		// Tag edits rewrite pomodoro.json through the service; the refresh
		// updates the card's activity quick-pick, which lists tag names.
		renderPomodoroTagList(section, this.service, () => this.plugin.refreshAllDashboards());
	}

	// ── Card background ────────────────────────────────────────────────────

	private renderBackground(form: HTMLElement): void {
		const section = this.section(form, t('wbg.set'), '');
		const row = section.createDiv({ cls: 'dashboard-pomodoro-settings-bg-row' });
		this.bgDescEl = row.createDiv({
			cls: 'dashboard-pomodoro-settings-bg-desc',
			text: this.bg?.image ?? t('pomodoro.bgNone'),
		});
		const editBtn = row.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: this.bg ? t('common.edit') : t('wbg.set'),
		});
		editBtn.addEventListener('click', () => {
			// The nested editor commits through the widget's own onBgChange
			// (persist + refresh), same as when it opened directly from the gear.
			new WidgetBackgroundModal(this.app, this.bg, (bg) => {
				this.bg = bg;
				if (this.bgDescEl) this.bgDescEl.textContent = bg?.image ?? t('pomodoro.bgNone');
				this.onBgChange(bg);
			}).open();
		});
	}

	// ── Shared ─────────────────────────────────────────────────────────────

	private section(parent: HTMLElement, title: string, desc: string): HTMLElement {
		const sec = parent.createDiv({ cls: 'dashboard-pomodoro-settings-section' });
		sec.createEl('h3', { text: title });
		if (desc) sec.createEl('p', { cls: 'dashboard-pomodoro-settings-desc', text: desc });
		return sec;
	}
}
