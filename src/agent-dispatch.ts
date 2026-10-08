/**
 * Agent dispatch layer: the single place that knows how to hand a rendered
 * prompt to an AI agent. Buttons across the dashboard (quick-note skill
 * chips, pipeline board skills) describe WHAT to send; this module decides
 * HOW it reaches the agent.
 *
 * In-app adapters keep internal plugin APIs in one place. Codex Desktop uses
 * its documented deep link to create a new chat with a prefilled prompt; the
 * user submits it in Codex. It never runs the Codex CLI.
 */

import type { AgentTarget } from './types';
import { t } from './i18n';

type ClaudianTab = {
	state?: { isStreaming?: boolean };
	controllers?: { inputController?: { sendMessage?: (options: { content: string }) => Promise<void> } };
};

type ClaudianPlugin = {
	activateView?: () => Promise<void>;
	getView?: () => { getActiveTab?: () => ClaudianTab | null } | null;
};

type PluginHost = { plugins?: { plugins?: Record<string, unknown> } };

export type AgentBridgeErrorCode = 'missing' | 'unsupported' | 'chat' | 'busy';

export class AgentBridgeError extends Error {
	constructor(readonly code: AgentBridgeErrorCode, message: string) {
		super(message);
	}
}

/** Backward-compatible name for the original Claudian adapter. */
export { AgentBridgeError as ClaudianBridgeError };

/** Claudian 2.x currently has no documented cross-plugin submit API. Keep its
 *  internal shape in one place and fail closed if an update changes it. */
export async function prepareClaudian(app: unknown): Promise<(content: string) => Promise<void>> {
	const host = app as PluginHost;
	const plugin = host.plugins?.plugins?.realclaudian as ClaudianPlugin | undefined;
	if (!plugin) throw new AgentBridgeError('missing', 'Claudian is not enabled');
	if (typeof plugin.activateView !== 'function' || typeof plugin.getView !== 'function') {
		throw new AgentBridgeError('unsupported', 'Unsupported Claudian interface');
	}
	await plugin.activateView();
	const view = plugin.getView();
	const tab = view?.getActiveTab?.();
	if (!tab) throw new AgentBridgeError('chat', 'Claudian chat is not ready');
	if (tab.state?.isStreaming) throw new AgentBridgeError('busy', 'Claudian chat is busy');
	const send = tab.controllers?.inputController?.sendMessage;
	if (typeof send !== 'function') throw new AgentBridgeError('unsupported', 'Unsupported Claudian interface');
	return async (content: string) => { await send.call(tab.controllers?.inputController, { content }); };
}

export async function submitToClaudian(app: unknown, content: string): Promise<void> {
	const send = await prepareClaudian(app);
	await send(content);
}

/** The skill name is an identifier, never a path or shell fragment. */
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidSkillName(name: string): boolean {
	return SKILL_NAME_RE.test(name.trim());
}

/** What a prompt-producing button provides: the agent-side skill it invokes
 *  (may be empty for free-form prompts) and the template to render. */
export interface AgentPromptSpec {
	skillName: string;
	promptTemplate: string;
}

/**
 * Render a prompt spec over template vars. Mirrors the historical
 * buildSkillPrompt contract: `{skill}` expands to the target agent's invocation,
 * `{input}` is supplemental input, and a template that omits the invocation
 * gets it prepended. Unknown vars pass
 * through untouched so hand-written templates stay debuggable.
 */
export function buildAgentPrompt(spec: AgentPromptSpec, vars: Record<string, string>, target: AgentTarget = 'claudian'): string {
	const skillName = spec.skillName.trim();
	if (skillName && !SKILL_NAME_RE.test(skillName)) {
		throw new Error('Invalid skill name');
	}
	const tokens: Record<AgentTarget, string> = {
		claudian: '$', copilot: '/', codex: '$', zcode: '$', workbuddy: '$',
	};
	const alt: Record<AgentTarget, string> = {
		claudian: '/', copilot: '$', codex: '/', zcode: '/', workbuddy: '/',
	};
	const skillToken = skillName ? `${tokens[target] ?? '$'}${skillName}` : '';
	const alternateSkillToken = skillName ? `${alt[target] ?? '/'}${skillName}` : '';
	let body = spec.promptTemplate.trim() || (skillToken ? skillToken + '\n\n{input}' : '{input}');
	const replacements: Record<string, string> = { ...vars, skill: skillToken };
	// Longest keys first so {paths} never half-replaces {path}.
	for (const key of Object.keys(replacements).sort((a, b) => b.length - a.length)) {
		const value = replacements[key] ?? '';
		body = body.replaceAll(`{${key}}`, key === 'input' ? value.trim() : value);
	}
	if (alternateSkillToken) body = body.replaceAll(alternateSkillToken, skillToken);
	body = body.trim();
	if (skillToken && !body.includes(skillToken)) body = `${skillToken}\n\n${body}`;
	return body;
}

/** A guarded deliver: resolves 'sent', 'timeout' (bridge never settled) or
 *  `{ error }` — never hangs the caller (the stranded-modal lesson). */
export type AgentSendOutcome = 'sent' | 'timeout' | { error: unknown };

export async function sendPromptWithTimeout(app: unknown, agent: AgentTarget, prompt: string, timeoutMs = 10_000): Promise<AgentSendOutcome> {
	return Promise.race([
		getAgentAdapter(agent).send(app, prompt).then(() => 'sent' as const, (error: unknown): AgentSendOutcome => ({ error })),
		new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
	]);
}

/** How an agent is reached. In-app agents take the prompt through a plugin
 * bridge inside Obsidian; terminal agents compose a shell command an external
 * console runs (desktop only). */
export type AgentKind = 'in-app' | 'terminal' | 'deep-link' | 'clipboard-app';

export interface AgentAdapter {
	id: AgentTarget;
	/** Display name used in buttons, notices and the preview modal. */
	label: string;
	kind: AgentKind;
	/** Cheap synchronous availability probe (plugin present, CLI found). */
	isAvailable(app: unknown): boolean;
	/** Deliver a rendered prompt. Throws (typed where possible) on failure. */
	send(app: unknown, prompt: string): Promise<void>;
	/** Announced but not yet reachable: pickers render the option greyed out
	 *  with an "即将上线" suffix and refuse new selections. Already-configured
	 *  skills keep working through the adapter's current bridge. */
	comingSoon?: boolean;
}

/** One picker entry: what the config dropdowns show for a target. */
export interface AgentPickerOption {
	label: string;
	disabled: boolean;
}

/** The dropdown descriptor for a target — the single source config modals
 *  use, so a coming-soon agent greys out everywhere at once. */
export function agentPickerOption(target: AgentTarget): AgentPickerOption {
	const adapter = getAgentAdapter(target);
	const coming = adapter.comingSoon === true;
	return {
		label: coming ? `${adapter.label}（${t('agent.comingSoon')}）` : adapter.label,
		disabled: coming,
	};
}

const claudianAdapter: AgentAdapter = {
	id: 'claudian',
	label: 'Claudian',
	kind: 'in-app',
	isAvailable(app: unknown): boolean {
		const plugin = (app as PluginHost)?.plugins?.plugins?.realclaudian as ClaudianPlugin | undefined;
		return !!plugin && typeof plugin.activateView === 'function' && typeof plugin.getView === 'function';
	},
	send(app: unknown, prompt: string): Promise<void> {
		return submitToClaudian(app, prompt);
	},
};

type CopilotChatState = {
	isTurnInFlight?: () => boolean;
	sendMessage?: (text: string) => { id?: string };
};

type CopilotSession = {
	ready?: Promise<unknown>;
	getStatus?: () => string;
};

type CopilotPlugin = {
	activateAgentView?: () => Promise<unknown>;
	agentSessionManager?: {
		getOrCreateActiveSession?: () => Promise<CopilotSession>;
		getActiveChatUIState?: () => CopilotChatState | null;
	};
};

const copilotAdapter: AgentAdapter = {
	id: 'copilot',
	label: 'Copilot Agent Chat',
	kind: 'in-app',
	isAvailable(app: unknown): boolean {
		const plugin = (app as PluginHost)?.plugins?.plugins?.copilot as CopilotPlugin | undefined;
		return !!plugin && typeof plugin.activateAgentView === 'function' &&
			typeof plugin.agentSessionManager?.getOrCreateActiveSession === 'function';
	},
	async send(app: unknown, prompt: string): Promise<void> {
		const plugin = (app as PluginHost)?.plugins?.plugins?.copilot as CopilotPlugin | undefined;
		if (!plugin) throw new AgentBridgeError('missing', 'Copilot is not enabled');
		const manager = plugin.agentSessionManager;
		if (typeof plugin.activateAgentView !== 'function' ||
			typeof manager?.getOrCreateActiveSession !== 'function' ||
			typeof manager.getActiveChatUIState !== 'function') {
			throw new AgentBridgeError('unsupported', 'Unsupported Copilot Agent Chat interface');
		}
		await plugin.activateAgentView();
		const session = await manager.getOrCreateActiveSession();
		if (session.ready) await session.ready;
		if (session.getStatus?.() === 'running' || session.getStatus?.() === 'awaiting_permission') {
			throw new AgentBridgeError('busy', 'Copilot Agent Chat is busy');
		}
		const chat = manager.getActiveChatUIState();
		if (!chat || typeof chat.sendMessage !== 'function') {
			throw new AgentBridgeError('chat', 'Copilot Agent Chat is not ready');
		}
		if (chat.isTurnInFlight?.()) throw new AgentBridgeError('busy', 'Copilot Agent Chat is busy');
		const result = chat.sendMessage(prompt);
		if (!result?.id) throw new AgentBridgeError('chat', 'Copilot did not accept the message');
	},
};

type ElectronShell = { openExternal?: (url: string) => Promise<void> };
type ElectronRequire = (name: string) => { shell?: ElectronShell };

function electronShell(): ElectronShell | undefined {
	try {
		const globalRequire = (globalThis as { require?: ElectronRequire }).require;
		const windowRequire = (window as unknown as { require?: ElectronRequire }).require;
		const requireElectron = globalRequire ?? windowRequire;
		return requireElectron?.('electron').shell;
	} catch {
		return undefined;
	}
}

/** Build the documented Codex Desktop deep link for a new, prefilled chat. */
export function codexConversationUrl(prompt: string, workspacePath?: string): string {
	const url = new URL('codex://threads/new');
	url.searchParams.set('prompt', prompt);
	if (workspacePath?.trim()) url.searchParams.set('path', workspacePath.trim());
	return url.toString();
}

const codexAdapter: AgentAdapter = {
	id: 'codex',
	label: 'Codex Desktop (new chat draft)',
	kind: 'deep-link',
	isAvailable(): boolean {
		return typeof electronShell()?.openExternal === 'function';
	},
	async send(app: unknown, prompt: string): Promise<void> {
		const shell = electronShell();
		if (typeof shell?.openExternal !== 'function') {
			throw new AgentBridgeError('missing', 'Codex Desktop deep links are only available in Obsidian Desktop');
		}
		const vault = (app as { vault?: { adapter?: { getBasePath?: () => string } } })?.vault;
		const workspacePath = vault?.adapter?.getBasePath?.();
		await shell.openExternal(codexConversationUrl(prompt, workspacePath));
	},
};

type MacOpen = (args: string[]) => { unref?: () => void };

function macSpawnOpen(appName: string): boolean {
	try {
		const req = (globalThis as { require?: (m: string) => { spawn?: (cmd: string, args: string[], opts?: unknown) => { unref?: () => void } } }).require
			?? (window as unknown as { require?: (m: string) => { spawn?: (cmd: string, args: string[], opts?: unknown) => { unref?: () => void } } }).require;
		const spawn = req?.('child_process')?.spawn;
		if (typeof spawn !== 'function') return false;
		spawn('open', ['-a', appName], { detached: true, stdio: 'ignore' }).unref?.();
		return true;
	} catch {
		return false;
	}
}

function macAppInstalled(name: string): boolean {
	try {
		const req = (globalThis as { require?: (m: string) => { existsSync?: (p: string) => boolean } }).require
			?? (window as unknown as { require?: (m: string) => { existsSync?: (p: string) => boolean } }).require;
		return req?.('fs')?.existsSync?.(`/Applications/${name}.app`) === true;
	} catch {
		return false;
	}
}

/** ZCode (z.ai ADE) exposes no conversation deep link (verified in its
 *  app.asar: only workspace/oauth/payment/share routes) — the honest bridge
 *  copies the prompt and launches the app, where the user pastes it as a new
 *  task. Marked coming-soon: pickers grey it out until ZCode ships a
 *  `zcode://chat/new?prompt=`-style entry; already-configured skills keep
 *  the clipboard bridge. */
const zcodeAdapter: AgentAdapter = {
	id: 'zcode',
	label: 'ZCode',
	kind: 'clipboard-app',
	comingSoon: true,
	isAvailable(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.clipboard && macAppInstalled('ZCode');
	},
	async send(_app: unknown, prompt: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(prompt);
		} catch {
			throw new AgentBridgeError('unsupported', 'Clipboard is unavailable');
		}
		if (!macSpawnOpen('ZCode')) {
			throw new AgentBridgeError('missing', 'Could not launch ZCode — paste the copied prompt manually');
		}
	},
};

/** WorkBuddy (Tencent) documents a task deep link:
 *  `workbuddy://task?action=start&prompt=…&skills=…&cwd=…` — the parser also
 *  accepts `promptContentBlocks` (JSON content blocks, the same shape a
 *  mention chip serializes to). The skills param is deliberately NOT used:
 *  WorkBuddy's coordinator resolves skills asynchronously and re-emits its
 *  single-value prefill intent as a skills-only payload, which replaces the
 *  prompt intent before the composer subscribes on cold start — the typed
 *  supplemental input silently vanished (Rae's diary-skill report). Riding
 *  the skill as a phrase block inside promptContentBlocks keeps chip + text
 *  in ONE emission, applied atomically. Trade-off: no ecosystem auto-install
 *  for uninstalled skills (the picker lists ~/.workbuddy/skills anyway). */
const WORKBUDDY_MAX_PROMPT = 8_000;

/** Serialize one skill-invocation chip exactly like WorkBuddy's own
 *  buildSkillChipBlock (createPhraseBlock shape, verified in app.asar). */
function workbuddySkillChipBlock(name: string): Record<string, unknown> {
	return {
		type: 'resource_link',
		name,
		uri: `skill://${name}`,
		title: `Use skill ${name}. `,
		_meta: {
			displayAsContext: false,
			displayAsPhrase: true,
			icon: 'skill',
			description: '',
			type: 'skill',
			mentionType: 'skill',
			displayText: name,
		},
	};
}

export function workbuddyTaskUrl(prompt: string, workspacePath?: string): string {
	const url = new URL('workbuddy://task');
	url.searchParams.set('action', 'start');
	// Leading invocation line "$<skill>" becomes a chip block; the rest rides
	// as the prompt text (blocks apply first, text appended after — mirroring
	// the "$skill\n\n{input}" layout).
	const trimmed = prompt.trim();
	const invocation = /^(\$[A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\s*\n+([\s\S]*))?$/.exec(trimmed);
	let body = trimmed;
	const blocks: Array<Record<string, unknown>> = [];
	if (invocation?.[1]) {
		blocks.push(workbuddySkillChipBlock(invocation[1].slice(1)));
		body = (invocation[2] ?? '').trim();
	}
	if (body) {
		url.searchParams.set('prompt', body.length > WORKBUDDY_MAX_PROMPT ? body.slice(0, WORKBUDDY_MAX_PROMPT) : body);
	}
	// The parser requires one of prompt/payloadId/promptContentBlocks; a
	// skill-only send satisfies it with the chip block alone.
	if (blocks.length > 0) url.searchParams.set('promptContentBlocks', JSON.stringify(blocks));
	if (workspacePath?.trim()) url.searchParams.set('cwd', workspacePath.trim());
	return url.toString();
}

const workbuddyAdapter: AgentAdapter = {
	id: 'workbuddy',
	label: 'WorkBuddy (new task)',
	kind: 'deep-link',
	isAvailable(): boolean {
		// Desktop deep link; the app check is mac-only (where this plugin's
		// terminal bridges already live) — other platforms report unavailable
		// rather than firing a scheme the OS cannot resolve.
		return typeof electronShell()?.openExternal === 'function' && macAppInstalled('WorkBuddy');
	},
	async send(app: unknown, prompt: string): Promise<void> {
		const shell = electronShell();
		if (typeof shell?.openExternal !== 'function') {
			throw new AgentBridgeError('missing', 'WorkBuddy deep links are only available in Obsidian Desktop');
		}
		const vault = (app as { vault?: { adapter?: { getBasePath?: () => string } } })?.vault;
		const workspacePath = vault?.adapter?.getBasePath?.();
		await shell.openExternal(workbuddyTaskUrl(prompt, workspacePath));
	},
};

/** Registry keyed by AgentTarget. */
const ADAPTERS: Record<AgentTarget, AgentAdapter> = {
	claudian: claudianAdapter,
	copilot: copilotAdapter,
	codex: codexAdapter,
	zcode: zcodeAdapter,
	workbuddy: workbuddyAdapter,
};

export function getAgentAdapter(id: AgentTarget): AgentAdapter {
	return ADAPTERS[id];
}

export function agentTargets(): AgentTarget[] {
	return Object.keys(ADAPTERS) as AgentTarget[];
}
