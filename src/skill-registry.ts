import { App, Menu, Notice, Platform, setIcon } from 'obsidian';
import type { AgentTarget, DashboardSettings } from './types';
import type DashboardPlugin from './main';
import { t } from './i18n';

/**
 * Skill-name registry + discovery + picker.
 *
 * Skill buttons reference skills that live agent-side (Claudian/Codex `$skill`,
 * Copilot `/prompt`). Nothing here executes or defines a skill — it only
 * remembers the names the user has saved and, where cheap and in-scope,
 * discovers candidate names so config surfaces offer a dropdown instead of
 * re-typing. Three sources, merged and de-duplicated:
 *
 *  1. remembered — names from saved configs, persisted per agent in settings
 *  2. vault      — in-vault convention folders, read via vault.adapter:
 *                 .claude/skills/<skill>/SKILL.md (Claude Code project skills)
 *                 .copilot/prompts/*.md (Copilot custom commands)
 *                 .agents/skills/<skill>/SKILL.md or .codex/skills/... (Codex)
 *  3. folder     — user-configured desktop folders (settings.skillSourceFolders,
 *                 "~" allowed). Opt-in by nature: empty string disables it and
 *                 nothing outside the vault is ever read implicitly.
 */

export type SkillSource = 'remembered' | 'vault' | 'folder';

export interface KnownSkill {
	name: string;
	source: SkillSource;
}

// ── Registry persistence ────────────────────────────────────────────────

export function rememberedSkills(settings: DashboardSettings, agent: AgentTarget): string[] {
	return settings.knownSkills?.[agent] ?? [];
}

/** Immutable add; callers persist through the plugin's normal save path. */
function withRememberedSkill(settings: DashboardSettings, agent: AgentTarget, name: string): DashboardSettings {
	const clean = name.trim();
	if (!clean) return settings;
	const current = settings.knownSkills?.[agent] ?? [];
	if (current.includes(clean)) return settings;
	return {
		...settings,
		knownSkills: { ...settings.knownSkills, [agent]: [...current, clean] },
	};
}

/** Remember every valid name the just-saved config references. Called on save
 *  (after validation) so typos in abandoned rows never pollute the registry. */
export async function rememberSkillNames(plugin: DashboardPlugin, agent: AgentTarget, names: readonly string[]): Promise<void> {
	let settings = plugin.settings;
	for (const name of names) settings = withRememberedSkill(settings, agent, name);
	if (settings === plugin.settings) return;
	plugin.settings = settings;
	await plugin.saveSettings();
}

export async function clearRememberedSkills(plugin: DashboardPlugin, agent: AgentTarget): Promise<void> {
	if (!(plugin.settings.knownSkills?.[agent]?.length)) return;
	plugin.settings = {
		...plugin.settings,
		knownSkills: { ...plugin.settings.knownSkills, [agent]: [] },
	};
	await plugin.saveSettings();
}

// ── Discovery ───────────────────────────────────────────────────────────

/** SKILL.md frontmatter `name:` (first ~40 lines), quotes stripped. Falls
 *  back to the folder name — Claude Code itself keys on the frontmatter but
 *  tolerates the folder alias. */
export function parseSkillDocName(content: string, fallback: string): string {
	const match = content.match(/^name:\s*(.+)$/m);
	const raw = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
	return raw || fallback;
}

type ListEntry = { path: string; name: string; isDir: boolean };

/** Generic one-level scan of a skills directory: skill folders with a
 *  SKILL.md inside (name from frontmatter, folder as fallback) plus bare
 *  *.md files (basename). Used for both the vault adapter and desktop
 *  folders so either layout works. */
export async function scanSkillDir(list: (path: string) => Promise<ListEntry[]>, read: (path: string) => Promise<string>, dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries: ListEntry[];
	try {
		entries = await list(dir);
	} catch {
		return out; // absent folder: fine, nothing to offer
	}
	for (const entry of entries) {
		if (entry.isDir) {
			const doc = `${entry.path.replace(/\/+$/, '')}/SKILL.md`;
			try {
				out.push(parseSkillDocName(await read(doc), entry.name));
			} catch {
				// Directory without SKILL.md: not a skill.
			}
		} else if (entry.name.toLowerCase().endsWith('.md') && !entry.name.startsWith('_')) {
			out.push(entry.name.replace(/\.md$/i, ''));
		}
	}
	return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

const VAULT_SKILL_DIRS: Record<AgentTarget, string[]> = {
	claudian: ['.claude/skills'],
	copilot: ['.copilot/prompts', 'copilot-commands'],
	codex: ['.agents/skills', '.codex/skills'],
	// ZCode drives the bundled Claude Code / Codex CLIs, so its discoverable
	// skills live in the same in-vault convention folders.
	zcode: ['.claude/skills', '.codex/skills'],
	// WorkBuddy keeps its user skills OUTSIDE the vault (~/.workbuddy/skills,
	// scanned by the picker below), so it has no in-vault convention folders.
	workbuddy: [],
};

/** In-vault discovery via the public DataAdapter (works on mobile too). */
export async function discoverVaultSkills(app: App, agent: AgentTarget): Promise<string[]> {
	const adapter = (app as { vault?: { adapter?: { list?: (p: string) => Promise<{ files: string[]; folders: string[] }> ; read?: (p: string) => Promise<string> } } }).vault?.adapter;
	if (!adapter?.list || !adapter.read) return [];
	const list = async (path: string): Promise<ListEntry[]> => {
		const res = await adapter.list!(path);
		const base = path.replace(/\/+$/, '');
		return [
			...res.folders.map(f => ({ path: base + '/' + f, name: f.replace(/\/+$/, '').split('/').pop() ?? f, isDir: true })),
			...res.files.map(f => ({ path: base + '/' + f, name: f.split('/').pop() ?? f, isDir: false })),
		];
	};
	const names: string[] = [];
	for (const dir of VAULT_SKILL_DIRS[agent]) {
		names.push(...await scanSkillDir(list, p => adapter.read!(p), dir));
	}
	return [...new Set(names)];
}

/** "~" expansion, pure so tests can drive it with a fake home. */
export function expandHomePath(path: string, home: string): string {
	const trimmed = path.trim();
	if (trimmed === '~') return home;
	if (trimmed.startsWith('~/')) return home + trimmed.slice(1);
	return trimmed;
}

/** Desktop-only scan of user-configured folders (settings.skillSourceFolders,
 *  CSV). Empty input or non-desktop returns []. */
export async function discoverFolderSkills(foldersCsv: string): Promise<string[]> {
	if (!foldersCsv.trim() || !Platform.isDesktop) return [];
	const nodeRequire = (globalThis as { require?: NodeRequire }).require ?? (window as unknown as { require?: NodeRequire }).require;
	if (!nodeRequire) return [];
	let fs: typeof import('fs');
	let home: string;
	try {
		fs = nodeRequire('fs') as typeof import('fs');
		home = nodeRequire('os').homedir();
	} catch {
		return [];
	}
	const list = async (dir: string): Promise<ListEntry[]> => {
		const entries = await fs.promises.readdir(dir, { withFileTypes: true });
		return entries.map(e => ({ path: `${dir}/${e.name}`, name: e.name, isDir: e.isDirectory() }));
	};
	const names: string[] = [];
	for (const raw of foldersCsv.split(/[,，]/)) {
		const dir = expandHomePath(raw, home);
		if (!dir) continue;
		try {
			names.push(...await scanSkillDir(list, p => fs.promises.readFile(p, 'utf8'), dir));
		} catch {
			// Unreadable path the user configured: skip, the picker still
			// shows the other sources.
		}
	}
	return [...new Set(names)];
}

// ── Merge + picker ──────────────────────────────────────────────────────

/** Merge with source priority remembered > vault > folder. */
export function mergeKnownSkills(remembered: readonly string[], vault: readonly string[], folder: readonly string[]): KnownSkill[] {
	const seen = new Set<string>();
	const out: KnownSkill[] = [];
	const push = (name: string, source: SkillSource): void => {
		const clean = name.trim();
		if (!clean || seen.has(clean)) return;
		seen.add(clean);
		out.push({ name: clean, source });
	};
	remembered.forEach(n => push(n, 'remembered'));
	vault.forEach(n => push(n, 'vault'));
	folder.forEach(n => push(n, 'folder'));
	return out;
}

/** Everything the picker needs from the host modal. The agent is a getter:
 *  rows let the user switch agents without re-rendering, and the picker must
 *  list names for the agent selected *at click time*. */
export interface SkillPickerContext {
	plugin: DashboardPlugin;
	getAgent: () => AgentTarget;
}

/** Native-Menu dropdown of known skill names for one agent, grouped by
 *  source. Picking writes the name into `input` (still editable afterwards)
 *  and fires onPick. */
export async function openSkillPicker(app: App, ctx: SkillPickerContext, input: HTMLInputElement, onPick?: (name: string) => void): Promise<void> {
	const agent = ctx.getAgent();
	// WorkBuddy's own skill store (~/.workbuddy/skills) is its documented user
	// dir, so its picker always scans it — same trust level as the ZCode app
	// presence probe, and the user's skillSourceFolders still append to it.
	const userFolders = ctx.plugin.settings.skillSourceFolders ?? '';
	const foldersCsv = agent === 'workbuddy'
		? `~/.workbuddy/skills${userFolders.trim() ? `,${userFolders}` : ''}`
		: userFolders;
	const [vault, folder] = await Promise.all([
		discoverVaultSkills(app, agent),
		discoverFolderSkills(foldersCsv),
	]);
	const skills = mergeKnownSkills(rememberedSkills(ctx.plugin.settings, agent), vault, folder);
	const menu = new Menu();
	if (skills.length === 0) {
		new Notice(t('skillPicker.empty'));
		return;
	}
	let currentSource: SkillSource | null = null;
	for (const skill of skills) {
		if (currentSource !== null && skill.source !== currentSource) menu.addSeparator();
		currentSource = skill.source;
		menu.addItem(item => {
			item.setTitle(skill.name).onClick(() => {
				input.value = skill.name;
				onPick?.(skill.name);
			});
		});
	}
	menu.showAtPosition({ x: input.getBoundingClientRect().right, y: input.getBoundingClientRect().bottom });
}

/** Dropdown button for a skill-name input (attachPathPicker idiom). */
export function attachSkillPicker(
	btnParent: HTMLElement,
	input: HTMLInputElement,
	app: App,
	ctx: SkillPickerContext,
	onPick?: (name: string) => void,
): HTMLButtonElement {
	const btn = btnParent.createEl('button', {
		cls: 'dashboard-pipeline-cfg-icon-btn dashboard-skillpicker-btn',
		attr: { type: 'button', 'aria-label': t('skillPicker.pick'), title: t('skillPicker.pick') },
	});
	setIcon(btn, 'chevron-down');
	btn.addEventListener('click', () => {
		void openSkillPicker(app, ctx, input, onPick);
	});
	return btn;
}
