import { App, Notice, setIcon } from 'obsidian';
import type { DashboardSettings, SkillShortcut } from './types';
import { t } from './i18n';
import { skillColorFor, SKILL_KEY_PALETTE } from './pipeline-model';
import { AgentPromptModal } from './agent-prompt-modal';
import { buildAgentPrompt, ClaudianBridgeError, getAgentAdapter, sendPromptWithTimeout } from './agent-dispatch';

/** No-dialog deliver: render the prompt, send guarded, report via Notices. */
export function fireSkillDirect(app: App, spec: { label: string; skillName: string; promptTemplate: string }, agent: SkillShortcut['target']): void {
	let prompt: string;
	try {
		prompt = buildAgentPrompt(spec, { input: '' }, agent);
	} catch {
		new Notice(t('agent.invalidSkill'));
		return;
	}
	void (async () => {
		const outcome = await sendPromptWithTimeout(app, agent, prompt);
		if (outcome === 'timeout') new Notice(t('agent.sendTimeout', { agent: getAgentAdapter(agent).label }));
		else if (outcome !== 'sent') {
			const error = outcome.error;
			if (error instanceof ClaudianBridgeError) new Notice(t(`agent.error.${error.code}`, { agent: getAgentAdapter(agent).label }));
			else new Notice(t('agent.sendFailed', { agent: getAgentAdapter(agent).label, message: error instanceof Error ? error.message : String(error) }));
		}
	})();
}

/**
 * Standalone skill-buttons widget, redesigned as a tactile key strip (Rae):
 * one slim pill-shaped bar; each skill is a ROUND key with real-button
 * texture (bevel highlight, bottom shade, press travel); the gear key sits
 * at the far right of the LAST row; with no skills configured the bar is
 * just that one key. Keys are grouped into ROWS of at most
 * SKILL_KEYS_PER_ROW (gear included): four skills + the gear fill the
 * classic single row edge to edge, further keys wrap onto second/third
 * rows. Key colors come from the aqua-theme keycap palette
 * (SKILL_KEY_PALETTE), POSITION-indexed: the first four keys always read as
 * four distinct hues (pink / purple / gold / mint, the design's keycap row);
 * the gear is the neutral key. Keys are FLEX-SIZED circles (see the CSS):
 * equal shares of the row width, capped at the classic 34px.
 */

/** Keys per row in the strip — the gear rides the last row. */
export const SKILL_KEYS_PER_ROW = 5;

/** Split items into fixed-size chunks (pure; rows of SKILL_KEYS_PER_ROW). */
export function chunkSkillKeys<T>(items: readonly T[], size = SKILL_KEYS_PER_ROW): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += Math.max(1, size)) {
		rows.push(items.slice(i, i + Math.max(1, size)) as T[]);
	}
	return rows;
}

export function renderSidebarSkillWidget(container: HTMLElement, app: App, settings: DashboardSettings): void {
	const buttons = settings.skillWidgetButtons ?? [];
	const bar = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-skills' });

	// Key factories in strip order (skills first, gear last), then chunked
	// into rows of five — structural rows, not CSS wrapping, so "max 5 per
	// row" holds on every container width (wide immersive tiles included).
	type KeyMaker = (parent: HTMLElement) => void;
	const makers: KeyMaker[] = [];
	let slot = 0;
	for (const skill of buttons) {
		if (!skill.label.trim()) continue;
		const keySlot = slot;
		makers.push((parent) => {
			// No `title` attr: the click opens AgentPromptModal headed by the
			// skill's label, and a native tooltip firing on the stationary cursor
			// after that click read as a SECOND, differently-styled name popup.
			const key = parent.createEl('button', {
				cls: 'dashboard-skills-orb',
				attr: { type: 'button', 'aria-label': skill.label },
			});
			key.style.setProperty('--orb', SKILL_KEY_PALETTE[keySlot % SKILL_KEY_PALETTE.length] ?? skillColorFor(skill.label.trim()));
			setIcon(key, skill.icon || 'sparkles');
			key.addEventListener('click', (e) => {
				e.stopPropagation();
				if (skill.directSend) {
					fireSkillDirect(app, skill, skill.target);
					return;
				}
				new AgentPromptModal(app, {
					label: skill.label,
					skillName: skill.skillName,
					promptTemplate: skill.promptTemplate,
				}, skill.target, {}).open();
			});
		});
		slot += 1;
	}
	makers.push((parent) => {
		const cog = parent.createEl('button', {
			cls: 'dashboard-skills-orb dashboard-skills-orb--cog',
			attr: { type: 'button', 'aria-label': t('skillsWidget.configure') },
		});
		setIcon(cog, 'settings');
		cog.addEventListener('click', (e) => {
			e.stopPropagation();
			bar.dispatchEvent(new CustomEvent('dashboard-skillwidget-config', { bubbles: true }));
		});
	});

	const rows = chunkSkillKeys(makers);
	// Single row keeps the capsule pill; multiple rows switch to a card-scale
	// radius (a 999px cap on two rows amputates the corners — see the CSS).
	bar.toggleClass('dashboard-sidebar-skills--multi', rows.length > 1);
	for (const row of rows) {
		const rowEl = bar.createDiv({ cls: 'dashboard-skills-row' });
		for (const make of row) make(rowEl);
	}
}

/** Signature input: everything the widget's DOM derives from. */
export function skillWidgetSig(buttons: readonly SkillShortcut[]): string {
	return JSON.stringify(buttons.map(b => [b.label, b.icon, b.target, b.skillName, b.promptTemplate, b.directSend === true]));
}
