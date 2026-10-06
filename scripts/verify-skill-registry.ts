import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import type { DashboardSettings } from '../src/types';
import {
	clearRememberedSkills,
	discoverFolderSkills,
	discoverVaultSkills,
	expandHomePath,
	mergeKnownSkills,
	parseSkillDocName,
	rememberSkillNames,
	rememberedSkills,
	scanSkillDir,
} from '../src/skill-registry';

// Skill registry: remembered names persist per agent; discovery reads in-vault
// convention folders via the vault adapter and (desktop, opt-in) local folders;
// the merge de-dupes with source priority. The picker Menu itself is DOM-bound
// and covered by usage, not asserted here.

function baseSettings(overrides?: Partial<DashboardSettings>): DashboardSettings {
	return { knownSkills: {}, skillSourceFolders: '', ...overrides } as unknown as DashboardSettings;
}

async function main(): Promise<void> {
	// --- SKILL.md name parsing: frontmatter wins, folder name falls back. ---
	assert.equal(parseSkillDocName('---\nname: my-skill\ndescription: x\n---\nbody', 'fallback'), 'my-skill');
	assert.equal(parseSkillDocName('---\nname: "quoted name"\n---\n', 'fallback'), 'quoted name');
	assert.equal(parseSkillDocName('no frontmatter here', 'folder-name'), 'folder-name');

	// --- One-level directory scan: SKILL.md dirs, bare .md files, skips. ---
	const dir = new Map<string, Array<{ path: string; name: string; isDir: boolean }>>([
		['skills', [
			{ path: 'skills/write-draft', name: 'write-draft', isDir: true },
			{ path: 'skills/Bare Command', name: 'Bare Command', isDir: true },
			{ path: 'skills/quick.md', name: 'quick.md', isDir: false },
			{ path: 'skills/_private.md', name: '_private.md', isDir: false },
			{ path: 'skills/notes.txt', name: 'notes.txt', isDir: false },
		]],
	]);
	const docs = new Map<string, string>([
		['skills/write-draft/SKILL.md', '---\nname: write-draft\ndescription: drafts\n---\n'],
		// No SKILL.md inside: directory is skipped entirely.
	]);
	const list = async (path: string) => dir.get(path) ?? (() => { throw new Error('missing'); })();
	const read = async (path: string) => docs.get(path) ?? (() => { throw new Error('missing'); })();
	assert.deepEqual(await scanSkillDir(list, read, 'skills'), ['quick', 'write-draft']);
	// A missing directory yields [] (absent convention folder is normal).
	assert.deepEqual(await scanSkillDir(list, read, 'nowhere'), []);

	// --- Vault discovery routes through the adapter for the agent's folders. ---
	const adapterCalls: string[] = [];
	const app = {
		vault: {
			adapter: {
				list: async (path: string) => {
					adapterCalls.push(path);
					if (path === '.claude/skills') {
						return { files: [], folders: ['gen-topics'] };
					}
					if (path === '.agents/skills') return { files: [], folders: ['start-my-day'] };
					if (path === '.codex/skills') return { files: [], folders: [] };
					throw new Error('missing');
				},
				read: async (path: string) => path.includes('start-my-day')
					? `---\nname: start-my-day\n---\n`
					: `---\nname: gen-topics\n---\n`,
			},
		},
	} as unknown as App;
	assert.deepEqual(await discoverVaultSkills(app, 'claudian'), ['gen-topics']);
	assert.deepEqual(await discoverVaultSkills(app, 'copilot'), []);
	assert.deepEqual(await discoverVaultSkills(app, 'codex'), ['start-my-day']);
	assert.ok(adapterCalls.includes('.claude/skills'), 'claudian scans .claude/skills');
	assert.ok(adapterCalls.includes('.agents/skills'), 'codex scans .agents/skills');
	assert.ok(!adapterCalls.includes('.claude/skills/__x'), 'no deep scans');

	// --- Desktop folder gate: stub Platform.isDesktop is false -> []. ---
	assert.deepEqual(await discoverFolderSkills('~/.claude/skills'), []);

	// --- Home expansion. ---
	assert.equal(expandHomePath('~/.claude/skills', '/Users/rae'), '/Users/rae/.claude/skills');
	assert.equal(expandHomePath('~', '/Users/rae'), '/Users/rae');
	assert.equal(expandHomePath('/abs/path', '/Users/rae'), '/abs/path');

	// --- Registry: immutable remember, per-agent isolation, clear. ---
	let saved = 0;
	const plugin = {
		settings: baseSettings(),
		saveSettings: async () => { saved += 1; },
	};
	await rememberSkillNames(plugin as never, 'claudian', ['write-draft', 'gen-topics', '  spaced  ']);
	await rememberSkillNames(plugin as never, 'claudian', ['write-draft', 'new-one']);
	await rememberSkillNames(plugin as never, 'copilot', ['copilot-prompt']);
	assert.deepEqual(rememberedSkills(plugin.settings, 'claudian'), ['write-draft', 'gen-topics', 'spaced', 'new-one']);
	assert.deepEqual(rememberedSkills(plugin.settings, 'copilot'), ['copilot-prompt']);
	// Duplicate-only remember must not burn a save (the no-op guard).
	const savedBefore = saved;
	await rememberSkillNames(plugin as never, 'claudian', ['write-draft']);
	assert.equal(saved, savedBefore, 'no-op remember skips persistence');
	await clearRememberedSkills(plugin as never, 'claudian');
	assert.deepEqual(rememberedSkills(plugin.settings, 'claudian'), []);
	assert.deepEqual(rememberedSkills(plugin.settings, 'copilot'), ['copilot-prompt'], 'clear is per agent');

	// --- Merge: de-dupe with priority remembered > vault > folder. ---
	const merged = mergeKnownSkills(['a', 'b'], ['b', 'c'], ['c', 'd']);
	assert.deepEqual(merged, [
		{ name: 'a', source: 'remembered' },
		{ name: 'b', source: 'remembered' },
		{ name: 'c', source: 'vault' },
		{ name: 'd', source: 'folder' },
	]);
}

void main();
