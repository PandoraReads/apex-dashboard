import { Modal, Notice } from 'obsidian';
import type { AgentTarget } from './types';
import {
	buildAgentPrompt,
	ClaudianBridgeError,
	getAgentAdapter,
	sendPromptWithTimeout,
	type AgentPromptSpec,
} from './agent-dispatch';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/** One pickable file for the stage-scope "run on selected items" list. */
export interface SelectableFile {
	path: string;
	title: string;
}

/**
 * Shared "compose and confirm" modal for every prompt-producing button
 * (quick-note skill chips, pipeline board skills). Shows the exact message
 * that will reach the agent with an optional supplemental input; the send
 * button routes through the agent's adapter. Sections whose config opts into
 * direct send skip this modal entirely.
 *
 * Stage-scope skills pass `selectableFiles` (the column's items): a checkbox
 * list then lets the user narrow the run to specific items. The selection
 * renders into the prompt as the `{paths}` var (newline-joined), and when the
 * template has no `{paths}` placeholder it is appended as an explicit file
 * list — no selection means the whole stage, as before.
 */
export class AgentPromptModal extends Modal {
	private readonly selected = new Set<string>();

	constructor(
		app: import('obsidian').App,
		private readonly spec: AgentPromptSpec & { label: string; inputPlaceholder?: string },
		private readonly agent: AgentTarget,
		private readonly vars: Record<string, string>,
		private readonly selectableFiles?: SelectableFile[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		const body = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		body.createEl('h2', { text: this.spec.label });
		const adapter = getAgentAdapter(this.agent);
		const prefillOnly = adapter.kind === 'deep-link' || adapter.kind === 'clipboard-app';
		body.createEl('p', { text: t(prefillOnly ? 'agent.targetPrefill' : 'agent.target', { agent: adapter.label }) });

		// Scope list for stage-scope skills: pick the items this run touches.
		if (this.selectableFiles && this.selectableFiles.length > 0) {
			const scope = body.createDiv({ cls: 'dashboard-skill-scope' });
			const scopeHead = scope.createDiv({ cls: 'dashboard-skill-scope-head' });
			const scopeTitle = scopeHead.createDiv({ cls: 'dashboard-skill-scope-title', text: t('agent.scopeAll') });
			const scopeHint = scope.createDiv({ cls: 'dashboard-skill-scope-hint', text: t('agent.scopeHint') });
			const list = scope.createDiv({ cls: 'dashboard-skill-scope-list' });
			for (const file of this.selectableFiles) {
				const row = list.createDiv({ cls: 'dashboard-skill-scope-item', attr: { role: 'label' } });
				const cb = row.createEl('input', {
					cls: 'dashboard-skill-scope-check',
					attr: { type: 'checkbox' },
				}) as HTMLInputElement;
				cb.addEventListener('change', () => {
					if (cb.checked) this.selected.add(file.path);
					else this.selected.delete(file.path);
					scopeTitle.setText(this.selected.size === 0
						? t('agent.scopeAll')
						: t('agent.scopeSelected', { count: String(this.selected.size) }));
					renderPreview();
				});
				row.createDiv({ cls: 'dashboard-skill-scope-name', text: file.title });
			}
			scopeHint.setText(t('agent.scopeHint'));
		}

		const input = body.createEl('textarea', {
			cls: 'dashboard-modal-input dashboard-skill-input',
			attr: { rows: '4', placeholder: this.spec.inputPlaceholder || t('agent.inputHint') },
		});
		body.createEl('p', { text: t(prefillOnly ? 'agent.previewPrefill' : 'agent.preview') });
		const preview = body.createEl('pre', { cls: 'dashboard-skill-preview' });

		const buildPrompt = (): string => {
			const paths = this.selected.size > 0
				? [...this.selected].map(path => `- ${path}`).join('\n')
				: '';
			const prompt = buildAgentPrompt(this.spec, { ...this.vars, input: input.value, paths }, this.agent);
			if (paths && !this.spec.promptTemplate.includes('{paths}')) {
				return `${prompt}\n\n${t('agent.scopeListHeading')}\n${paths}`;
			}
			return prompt;
		};
		const renderPreview = (): void => {
			try {
				preview.setText(buildPrompt());
			} catch {
				preview.setText(t('agent.invalidSkill'));
			}
		};
		input.addEventListener('input', renderPreview);
		renderPreview();

		const actions = body.createDiv({ cls: 'dashboard-modal-footer' });
		actions.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
		const send = actions.createEl('button', {
			text: t(prefillOnly ? 'agent.openPrefill' : 'agent.send', { agent: adapter.label }),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		});
		send.addEventListener('click', () => {
			let prompt: string;
			try {
				prompt = buildPrompt();
			} catch {
				new Notice(t('agent.invalidSkill'));
				return;
			}
			// The modal closes the MOMENT the user commits — composing is its
			// whole job, and a slow or hung adapter bridge must never leave it
			// stranded on screen. The dispatch continues in the background;
			// outcomes report through Notices.
			this.close();
			void (async () => {
				const outcome = await sendPromptWithTimeout(this.app, this.agent, prompt);
				if (outcome === 'sent') {
					if (prefillOnly) new Notice(t('agent.openedPrefill'));
				} else if (outcome === 'timeout') {
					new Notice(t('agent.sendTimeout', { agent: adapter.label }));
				} else {
					const error = outcome.error;
					if (error instanceof ClaudianBridgeError) {
						new Notice(t(`agent.error.${error.code}`, { agent: adapter.label }));
					} else {
						const message = error instanceof Error ? error.message : String(error);
						new Notice(t('agent.sendFailed', { agent: adapter.label, message }));
					}
				}
			})();
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
