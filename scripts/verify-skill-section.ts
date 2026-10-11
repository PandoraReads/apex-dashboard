/**
 * Verifies the skills section end to end (mini-dom + injected fs/store):
 *
 * 1. Parser round-trip: type 'skills' whitelisted; skillsConfig (stores
 *    subset, sortMode, pinned, pageSize, importTargets) serializes and
 *    parses back; all-default config serializes to NO skills block; no card
 *    body under the section heading; serialize idempotent.
 * 2. skill-store units: parseSkillDoc (plain / folded multi-line / no
 *    frontmatter / description cap), resolveSkillStores (~ + custom CSV),
 *    groupSkillEntries (aggregation, home-order primary, description pick),
 *    scanSkillStoreDir (skips non-skill dirs; mtime cache skips re-reads).
 * 3. Section render: aggregated cards (one card per name, badges + launch
 *    buttons per store), pinned-first ordering, search filtering, store
 *    filter menu, import button routing the dashboard-skills-import event,
 *    card click opening the detail modal with per-instance rows, pin menu
 *    routing dashboard-skills-prefs.
 * 4. Import modal: typed-path validation (no SKILL.md → error), preview,
 *    fresh install copies the tree into every checked target and reports
 *    agents; a conflicting target refuses to proceed without the desktop
 *    trash (headless: no electron shell) and leaves the old copy intact.
 * 5. Config modal: store checkboxes + sort; save carries pinned/pageSize
 *    through untouched.
 *
 * Run: `npm run test:skill-section`
 */
import { strict as assert } from 'node:assert';
import { Menu, Modal, Notice } from 'obsidian';
import { El, findByClass, findTag, orderIndex } from './mini-dom';
import { parse, serialize, generateDefaultMarkdown } from '../src/parser';
import type { DashboardColumn, DashboardData, SkillsSectionConfig } from '../src/types';
import { renderSkillSection } from '../src/skill-section';
import { SkillImportModal } from '../src/skill-import-modal';
import { SkillSectionConfigModal } from '../src/skill-section-config-modal';
import {
	groupSkillEntries, parseSkillDoc, resolveSkillGroup, resolveSkillStores, scanSkillStoreDir,
	PRESET_SKILL_GROUPS, SkillLibraryStore, type SkillEntry, type SkillFs, type SkillListEntry,
} from '../src/skill-store';
import { parseGithubUrl, fetchGithubSkillDirs, importGithubSkills, type GithubRequest } from '../src/skill-github';

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 25));

// Modal-theme reads the Obsidian global activeDocument — stub it inert
// (verify-card-delete idiom).
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	body: new El('body'),
};

// ── In-memory filesystem ────────────────────────────────────────────────

interface FakeNode {
	kind: 'dir' | 'file';
	content?: string;
	mtime: number;
}

function makeFakeFs(home: string): { fs: SkillFs; tree: Map<string, FakeNode>; reads: string[] } {
	const tree = new Map<string, FakeNode>();
	const reads: string[] = [];
	const dirOf = (path: string): string => path.replace(/\/+$/, '');
	const childrenOf = (dir: string): string[] => {
		const prefix = `${dirOf(dir)}/`;
		return [...tree.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
	};
	const fs: SkillFs = {
		list: async dir => childrenOf(dir).map((p): SkillListEntry => {
			const node = tree.get(p)!;
			const name = p.slice(dirOf(dir).length + 1);
			return { path: p, name, isDir: node.kind === 'dir' };
		}),
		statMs: async path => {
			const node = tree.get(dirOf(path));
			if (!node) throw new Error(`missing ${path}`);
			return node.mtime;
		},
		readTextHead: async (path, bytes) => {
			const node = tree.get(dirOf(path));
			if (!node || node.kind !== 'file') throw new Error(`missing ${path}`);
			reads.push(path);
			return (node.content ?? '').slice(0, bytes);
		},
		exists: async path => tree.has(dirOf(path)),
		mkdirRec: async path => {
			tree.set(dirOf(path), { kind: 'dir', mtime: 0 });
		},
		writeFile: async (path, data) => {
			tree.set(dirOf(path), { kind: 'file', content: new TextDecoder().decode(data), mtime: 1 });
		},
		readFileBytes: async path => {
			const node = tree.get(dirOf(path));
			if (!node || node.kind !== 'file') throw new Error(`missing ${path}`);
			reads.push(path);
			return new TextEncoder().encode(node.content ?? '');
		},
		homeDir: () => home,
	};
	return { fs, tree, reads };
}

const skillDoc = (name: string, description: string): string =>
	`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nbody\n`;

let clock = 1;
function addSkill(tree: Map<string, FakeNode>, dir: string, name: string, description = ''): void {
	tree.set(dir, { kind: 'dir', mtime: clock++ });
	tree.set(`${dir}/SKILL.md`, { kind: 'file', content: skillDoc(name, description), mtime: clock++ });
}

// ── App harness (vault adapter over a disk map, rss-verify idiom) ───────

function makeApp(): { app: unknown; disk: Record<string, string> } {
	const disk: Record<string, string> = {};
	const adapter = {
		exists: async (p: string) => disk[p] !== undefined,
		read: async (p: string) => {
			if (disk[p] === undefined) throw new Error(`missing ${p}`);
			return disk[p];
		},
		write: async (p: string, c: string) => { disk[p] = c; },
		mkdir: async () => {},
	};
	return { app: { vault: { configDir: '.obsidian', adapter } }, disk };
}

const lastModalEl = (): El => (Modal as unknown as { last: { contentEl: El } }).last.contentEl;

const cardsOf = (host: El): El[] => findByClass(host, 'dashboard-skillsec-card');
const cardByName = (host: El, name: string): El | undefined =>
	cardsOf(host).find(card => findByClass(card, 'dashboard-skillsec-name').some(el => el.textContent === name));

/** Section under test: renders and flushes the initial async scan. */
async function renderSkills(column: DashboardColumn, options: { fs: SkillFs; foldersCsv?: string }): Promise<El> {
	const { app } = makeApp();
	const host = new El('div');
	renderSkillSection(
		host as unknown as HTMLElement,
		column,
		app as never,
		undefined,
		() => {},
		{ fs: options.fs, store: new SkillLibraryStore(app as never), foldersCsv: options.foldersCsv ?? '' },
	);
	await flush();
	await flush();
	return host;
}

async function main(): Promise<void> {

// ── 1. Parser round-trip ────────────────────────────────────────────────

{
	const config: SkillsSectionConfig = {
		stores: ['claude', 'codex'],
		sortMode: 'recent',
		sortDir: 'asc',
		pinned: ['bailian-gen', 'ab-test-setup'],
		pageSize: 100,
		importTargets: ['claude', 'workbuddy'],
		groups: [
			{ id: 'g-a', name: '写作', keywords: 'write, 文案' },
			{ id: 'g-b', name: '代码' },
		],
		assignments: { 'my-skill': 'g-b' },
		groupView: 'kanban',
		createSkill: { agent: 'claudian', skillName: 'skill-creator', promptTemplate: '帮我做一个{input}', directSend: true },
	};
	const dataWith = (skillsConfig: SkillsSectionConfig | undefined): DashboardData => {
		const base = parse(generateDefaultMarkdown());
		return { ...base, columns: [{ name: '技能库', color: '6366f1', sectionType: 'skills', cards: [], skillsConfig }] };
	};
	const md = serialize(dataWith(config));
	const parsed = parse(md);
	const col = parsed.columns[0]!;
	assert.equal(col.sectionType, 'skills', 'type: skills survives the whitelist');
	assert.deepEqual(col.skillsConfig, config, 'skillsConfig round-trips');
	assert.ok(!md.includes('\n### '), 'no card body under the skills heading');
	assert.equal(serialize(parsed), md, 'serialize idempotent');

	// All-default config → no skills block at all (round-trip cleanliness).
	const plain = serialize(dataWith({}));
	assert.ok(!plain.includes('skills:'), 'default skillsConfig omits the skills block');
	const parsedPlain = parse(plain);
	assert.equal(parsedPlain.columns[0]!.skillsConfig, undefined, 'empty config parses back to no config');

	// An explicitly emptied group list persists (kills the preset fallback).
	const emptied = serialize(dataWith({ groups: [] }));
	assert.ok(emptied.includes('groups: []'), 'empty groups persist as []');
	assert.deepEqual(parse(emptied).columns[0]!.skillsConfig!.groups, [], 'empty groups parse back empty');
	console.log('1 parser round-trip: ok');
}

// ── 2. skill-store units ────────────────────────────────────────────────

{
	const plain = parseSkillDoc('---\nname: foo\ndescription: bar\n---\nbody', 'folder');
	assert.equal(plain.name, 'foo');
	assert.equal(plain.description, 'bar');

	const folded = parseSkillDoc('---\nname: foo\ndescription: >-\n  line one\n  line two\n---\n', 'folder');
	assert.equal(folded.name, 'foo');
	assert.equal(folded.description, 'line one line two', 'folded multi-line description parses');

	const noFm = parseSkillDoc('# just a body\n', 'folder-name');
	assert.equal(noFm.name, 'folder-name', 'folder-name fallback');
	assert.equal(noFm.description, '');

	const long = parseSkillDoc(`---\nname: x\ndescription: ${'a'.repeat(900)}\n---\n`, 'f');
	assert.ok(long.description.length <= 500, 'description capped at 500 chars');

	const malformed = parseSkillDoc('---\nname: [unclosed\ndescription: x\n---\n', 'fb');
	assert.equal(malformed.name, '[unclosed', 'malformed yaml falls back to the regex name');

	const stores = resolveSkillStores('~/.extra-skills, /abs/dir', '/home/tester');
	assert.equal(stores.length, 5, 'three home stores + two customs');
	assert.equal(stores[0]!.dir, '/home/tester/.claude/skills', '~ expanded for home stores');
	assert.equal(stores[3]!.id, 'custom:/home/tester/.extra-skills');
	assert.equal(stores[3]!.dir, '/home/tester/.extra-skills');
	assert.equal(stores[4]!.dir, '/abs/dir', 'absolute custom path untouched');

	const entries: SkillEntry[] = [
		{ name: 'alpha', description: '', storeId: 'workbuddy', dirPath: '/w/alpha', mtimeMs: 3 },
		{ name: 'alpha', description: 'from codex', storeId: 'codex', dirPath: '/x/alpha', mtimeMs: 2 },
		{ name: 'beta', description: 'b-desc', storeId: 'claude', dirPath: '/c/beta', mtimeMs: 1 },
	];
	const groups = groupSkillEntries(entries, ['claude', 'codex', 'workbuddy']);
	assert.equal(groups.length, 2);
	const alpha = groups.find(g => g.name === 'alpha')!;
	assert.equal(alpha.instances.length, 2, 'same-name instances aggregate');
	assert.equal(alpha.instances[0]!.storeId, 'codex', 'home-store order decides the primary instance');
	assert.equal(alpha.description, 'from codex', 'description comes from the first instance that has one');
	assert.equal(groups[0]!.name, 'alpha', 'groups sorted by name');
	console.log('2 skill-store units: ok');
}

{
	const groups = [
		{ id: 'g-w', name: '写作', keywords: 'write, 文案' },
		{ id: 'g-c', name: '代码', keywords: 'code' },
	];
	assert.equal(resolveSkillGroup('my-write-tool', groups, undefined)?.id, 'g-w', 'keyword match on name');
	assert.equal(resolveSkillGroup('文案大师', groups, undefined)?.id, 'g-w', 'CJK keyword match');
	assert.equal(resolveSkillGroup('my-skill', groups, { 'my-skill': 'g-c' })?.id, 'g-c', 'manual assignment wins over keywords');
	assert.equal(resolveSkillGroup('my-write-tool', groups, { 'my-write-tool': 'g-c' })?.id, 'g-c', 'manual beats keyword hit');
	assert.equal(resolveSkillGroup('zzz', groups, { zzz: 'g-gone' }), null, 'assignment to a deleted group drops to keyword/null');
	assert.equal(resolveSkillGroup('zzz', groups, undefined), null, 'no match = ungrouped');
	assert.equal(resolveSkillGroup('my-write-tool', groups, { 'my-write-tool': '__ungrouped__' }), null, 'explicit ungrouped sentinel blocks keyword matches');
	console.log('2 resolveSkillGroup: ok');
}

{
	const { fs, tree, reads } = makeFakeFs('/h');
	const store = { id: 'claude', label: 'Claude', dir: '/h/.claude/skills' };
	addSkill(tree, '/h/.claude/skills/alpha', 'alpha', 'a');
	addSkill(tree, '/h/.claude/skills/beta', 'beta', 'b');
	tree.set('/h/.claude/skills/notaskill', { kind: 'dir', mtime: 1 });

	const first = await scanSkillStoreDir(fs, store, new Map());
	assert.equal(first.length, 2, 'dirs without SKILL.md are not skills');
	assert.equal(first[0]!.name, 'alpha');

	const readsAfterFirst = reads.length;
	const second = await scanSkillStoreDir(fs, store, new Map(first.map(e => [e.dirPath, e])));
	assert.deepEqual(second.map(e => e.name), ['alpha', 'beta'], 'cached rescan returns the same entries');
	assert.equal(reads.length, readsAfterFirst, 'unchanged mtimes skip the SKILL.md read entirely');
	console.log('2 scanSkillStoreDir: ok');
}

// ── 3. Section render ───────────────────────────────────────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	addSkill(tree, '/h/.claude/skills/alpha', 'alpha', 'desc alpha');
	addSkill(tree, '/h/.codex/skills/alpha', 'alpha', 'desc alpha');
	addSkill(tree, '/h/.workbuddy/skills/beta', 'beta', 'desc beta');
	addSkill(tree, '/h/.claude/skills/gamma', 'gamma', 'desc gamma');

	const column: DashboardColumn = {
		name: '技能库', color: '6366f1', sectionType: 'skills', cards: [],
		skillsConfig: { pinned: ['beta'] },
	};
	const host = await renderSkills(column, { fs });

	const cards = cardsOf(host);
	assert.equal(cards.length, 3, 'three aggregated cards');
	const alpha = cardByName(host, 'alpha')!;
	assert.ok(alpha, 'alpha card exists');
	assert.equal(findByClass(alpha, 'dashboard-skillsec-badge').length, 2, 'alpha carries two source badges');
	assert.equal(findByClass(alpha, 'dashboard-skillsec-launch').length, 2, 'alpha offers claude + codex launch buttons');
	const beta = cardByName(host, 'beta')!;
	assert.equal(findByClass(beta, 'dashboard-skillsec-launch').length, 1, 'workbuddy-only skill offers one button');
	assert.ok(beta.hasClass('is-pinned'), 'pinned card flagged');
	assert.ok(orderIndex(host, beta) < orderIndex(host, alpha), 'pinned card renders first');

	// Stats line carries per-store counts.
	const stats = findByClass(host, 'dashboard-skillsec-stats')[0]!;
	assert.ok(stats.textContent.includes('3'), 'total in stats');

	// Import button signals view.ts (which owns the plugin context).
	const importBtn = findByClass(host, 'dashboard-skillsec-import')[0]!;
	assert.ok(importBtn, 'import button rendered on desktop');
	let importSignal = '';
	host.addEventListener('dashboard-skills-import', ev => {
		importSignal = (ev as CustomEvent).detail.columnName;
	});
	importBtn.click();
	assert.equal(importSignal, '技能库', 'import click routes the CustomEvent');

	// Search narrows the grid without a full re-render losing the toolbar.
	const search = findByClass(host, 'dashboard-skillsec-search')[0]! as unknown as El & { value: string };
	search.value = 'alpha';
	search.dispatchEvent({ type: 'input', target: search });
	await flush();
	assert.equal(cardsOf(host).length, 1, 'search filters to the matching card');
	search.value = '';
	search.dispatchEvent({ type: 'input', target: search });
	await flush();
	assert.equal(cardsOf(host).length, 3, 'clearing search restores all cards');

	// Store filter via the shared dropdown → native Menu.
	const dropdown = findByClass(host, 'dashboard-toolbar-dropdown')[0]!;
	dropdown.click();
	type StubMenu = { items: Array<{ title: string; click(): void }> };
	const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu;
	assert.ok(menu, 'filter menu opened');
	const codexItem = menu.items.find(i => i.title.startsWith('Codex'));
	assert.ok(codexItem, 'per-store filter bucket exists');
	codexItem!.click();
	await flush();
	assert.equal(cardsOf(host).length, 1, 'store filter narrows to alpha');

	// Pinned-only filter: pin beta beforehand via the config (already
	// pinned in this scenario's column config) → the bucket shows only it.
	const dropdown2 = findByClass(host, 'dashboard-toolbar-dropdown')[0]!;
	dropdown2.click();
	type StubMenu2 = { items: Array<{ title: string; click(): void }> };
	const pinnedItem = ((Menu as unknown as { last: Menu | null }).last as unknown as StubMenu2).items.find(i => i.title.startsWith('置顶'));
	assert.ok(pinnedItem, 'pinned filter bucket exists');
	pinnedItem!.click();
	await flush();
	assert.equal(cardsOf(host).length, 1, 'pinned filter shows only pinned cards');
	assert.equal(cardsOf(host)[0]!.dataset.skill, 'beta', 'the pinned card is the one shown');

	// Back to all sources — later checks click non-pinned cards.
	const dropdown3 = findByClass(host, 'dashboard-toolbar-dropdown')[0]!;
	dropdown3.click();
	type StubMenu3 = { items: Array<{ title: string; click(): void }> };
	const allItem = ((Menu as unknown as { last: Menu | null }).last as unknown as StubMenu3).items.find(i => i.title.startsWith('全部来源'));
	assert.ok(allItem, 'all-sources filter bucket exists');
	allItem!.click();
	await flush();
	assert.equal(cardsOf(host).length, 3, 'all-sources filter restores every card');

	// Sort menu now carries direction: name asc/desc, recent newest/oldest.
	{
		const { fs, tree } = makeFakeFs('/h');
		addSkill(tree, '/h/.claude/skills/alpha-write', 'alpha-write', 'w');
		addSkill(tree, '/h/.claude/skills/gamma', 'gamma', 'g');
		addSkill(tree, '/h/.claude/skills/mid', 'mid', 'm');
		const column: DashboardColumn = {
			name: 'S', color: '6366f1', sectionType: 'skills', cards: [],
			skillsConfig: { sortMode: 'name', sortDir: 'desc' },
		};
		const host = await renderSkills(column, { fs });
		const names = cardsOf(host).map(c => c.dataset.skill);
		assert.deepEqual(names, ['mid', 'gamma', 'alpha-write'], 'name desc = Z→A');
		// The sort dropdown offers all four mode×direction entries.
		findByClass(host, 'dashboard-toolbar-dropdown')[1]!.click();
		type StubMenu = { items: Array<{ title: string; click(): void }> };
		const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu;
		assert.equal(menu.items.length, 4, 'four sort entries (mode × direction)');
		console.log('3e sort direction: ok');
	}

	// Card click → detail modal with one row per instance. (The stub's
	// Modal.open records the instance but never calls onOpen — rss-verify
	// idiom: drive it by hand.)
	(cardByName(host, 'alpha') as unknown as El).click();
	await flush();
	const detail = (Modal as unknown as { last: Modal | null }).last as unknown as { contentEl: El; onOpen(): void };
	assert.ok(detail, 'detail modal opened');
	detail.onOpen();
	assert.ok(detail, 'detail modal opened');
	assert.equal(findByClass(detail.contentEl, 'dashboard-skillsec-instance').length, 2, 'instance rows listed');
	// markdown preview rendered through the MarkdownRenderer stand-in
	assert.ok(findByClass(detail.contentEl, 'dashboard-skillsec-detail-doc').length === 1, 'SKILL.md preview present');
	console.log('3 section render: ok');
}

// ── 3b. Pin from the card menu routes the prefs event ───────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	addSkill(tree, '/h/.claude/skills/alpha', 'alpha', 'a');
	const column: DashboardColumn = { name: 'S', color: '6366f1', sectionType: 'skills', cards: [] };
	const host = await renderSkills(column, { fs });

	let prefsDetail: { columnName: string; prefs: Partial<SkillsSectionConfig> } | null = null;
	host.addEventListener('dashboard-skills-prefs', ev => {
		prefsDetail = (ev as CustomEvent).detail;
	});
	const menuBtn = findByClass(cardsOf(host)[0]!, 'dashboard-skillsec-menu')[0]!;
	menuBtn.click();
	type StubMenu = { items: Array<{ title: string; click(): void }> };
	const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu;
	const pinItem = menu.items.find(i => i.title.length > 0 && i.title === '置顶');
	assert.ok(pinItem, 'pin menu item present (zh default locale)');
	pinItem!.click();
	await flush();
	assert.equal(prefsDetail!.columnName, 'S');
	assert.deepEqual(prefsDetail!.prefs.pinned, ['alpha'], 'pin toggles route through the prefs event');
	console.log('3b pin menu: ok');
}

// ── 3c. Grouped view: buckets, collapse, collapse-all ───────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	// Names chosen to hit preset keywords: *write* → 写作, *code* → 代码,
	// gamma matches nothing → ungrouped.
	addSkill(tree, '/h/.claude/skills/quick-write', 'quick-write', 'w');
	addSkill(tree, '/h/.claude/skills/code-review', 'code-review', 'c');
	addSkill(tree, '/h/.claude/skills/gamma', 'gamma', 'g');

	const column: DashboardColumn = {
		name: 'S', color: '6366f1', sectionType: 'skills', cards: [],
		skillsConfig: { groupView: 'groups' },
	};
	const host = await renderSkills(column, { fs });

	const blocks = findByClass(host, 'dashboard-skillsec-group');
	assert.ok(blocks.length >= 2, 'grouped view renders group blocks');
	const names = findByClass(host, 'dashboard-skillsec-group-name').map(el => el.textContent);
	assert.ok(names.includes('写作') && names.includes('代码'), 'preset groups bucket the skills');
	assert.equal(names[names.length - 1], '未分组', 'ungrouped bucket renders last');
	// quick-write lives in 写作; gamma in ungrouped.
	const writeBlock = blocks.find(b => {
		const n = findByClass(b, 'dashboard-skillsec-group-name')[0];
		return n?.textContent === '写作';
	})!;
	assert.equal(findByClass(writeBlock, 'dashboard-skillsec-card').length, 1, 'keyword-matched card inside its group');
	// Every card carries its update date — inside the badges line now.
	const badgeRows = findByClass(host, 'dashboard-skillsec-badges');
	assert.ok(badgeRows.every(row => findByClass(row, 'dashboard-skillsec-date').length === 1), 'date rides the badges line');
	// No path row on cards (badges carry the story; detail modal keeps paths).
	assert.equal(findByClass(host, 'dashboard-skillsec-path').length, 0, 'cards no longer show the path');

	// Collapse one group in place (class flip, no re-render).
	const writeHead = findByClass(writeBlock, 'dashboard-skillsec-group-head')[0]!;
	writeHead.click();
	assert.ok(writeBlock.hasClass('is-collapsed'), 'header click collapses the block');
	writeHead.click();
	assert.ok(!writeBlock.hasClass('is-collapsed'), 'second click re-expands');

	// Collapse-all pill: present in grouped view, collapses everything.
	const pill = findByClass(host, 'dashboard-skillsec-collapse-all')[0]!;
	assert.ok(pill, 'collapse-all pill renders in grouped view');
	pill.click();
	assert.ok(blocks.every(b => b.hasClass('is-collapsed')), 'pill collapses every group');
	pill.click();
	assert.ok(blocks.every(b => !b.hasClass('is-collapsed')), 'pill re-expands every group');

	// View toggles: two pills, active state follows the mode; clicking the
	// inactive kanban pill switches modes (persists via prefs).
	const toggles = findByClass(host, 'dashboard-skillsec-toggle');
	assert.equal(toggles.length, 2, 'group + kanban toggle pills render');
	assert.ok(toggles[0]!.hasClass('active'), 'groups toggle active in grouped view');
	console.log('3c grouped view: ok');
}

// ── 3c-2. Kanban view: one column per group ─────────────────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	addSkill(tree, '/h/.claude/skills/quick-write', 'quick-write', 'w');
	addSkill(tree, '/h/.claude/skills/code-review', 'code-review', 'c');
	addSkill(tree, '/h/.claude/skills/gamma', 'gamma', 'g');

	const column: DashboardColumn = {
		name: 'S', color: '6366f1', sectionType: 'skills', cards: [],
		skillsConfig: { groupView: 'kanban' },
	};
	const host = await renderSkills(column, { fs });

	const cols = findByClass(host, 'dashboard-skillsec-kcol');
	assert.ok(cols.length >= 2, 'kanban renders one column per group + ungrouped');
	const names = findByClass(host, 'dashboard-skillsec-group-name').map(el => el.textContent);
	assert.ok(names.includes('写作') && names.includes('代码') && names[names.length - 1] === '未分组', 'kanban columns in group order, ungrouped last');
	const writeCol = cols.find(c => {
		const n = findByClass(c, 'dashboard-skillsec-group-name')[0];
		return n?.textContent === '写作';
	})!;
	assert.equal(findByClass(writeCol, 'dashboard-skillsec-card').length, 1, 'cards stack inside their column');

	// Column collapse works like the stacked mode.
	const head = findByClass(writeCol, 'dashboard-skillsec-group-head')[0]!;
	head.click();
	assert.ok(writeCol.hasClass('is-collapsed'), 'kanban column collapses');

	// Drag-to-regroup: dragstart on a card, drop on another column → prefs.
	let prefsDetail: { columnName: string; prefs: Partial<SkillsSectionConfig> } | null = null;
	host.addEventListener('dashboard-skills-prefs', ev => {
		prefsDetail = (ev as CustomEvent).detail;
	});
	const gammaCard = cardsOf(host).find(c => c.dataset.skill === 'gamma')!;
	const makeTransfer = (name: string): unknown => ({
		types: ['application/x-apex-skill'],
		setData: () => {},
		getData: (type: string) => (type === 'application/x-apex-skill' ? name : ''),
		effectAllowed: '',
		dropEffect: '',
	});
	gammaCard.dispatchEvent({ type: 'dragstart', dataTransfer: makeTransfer('gamma'), target: gammaCard });
	assert.ok(gammaCard.hasClass('is-dragging'), 'dragstart dims the card');
	writeCol.dispatchEvent({ type: 'dragover', dataTransfer: makeTransfer('gamma'), target: writeCol });
	assert.ok(writeCol.hasClass('is-drop-target'), 'column highlights on dragover');
	writeCol.dispatchEvent({ type: 'drop', dataTransfer: makeTransfer('gamma'), target: writeCol });
	assert.equal(prefsDetail!.prefs.assignments!.gamma, 'g-write', 'dropping on a group column assigns that group');
	// Dropping on the ungrouped column writes the explicit sentinel.
	const ungroupedCol = findByClass(host, 'dashboard-skillsec-kcol').find(c => {
		const n = findByClass(c, 'dashboard-skillsec-group-name')[0];
		return n?.textContent === '未分组';
	})!;
	ungroupedCol.dispatchEvent({ type: 'drop', dataTransfer: makeTransfer('gamma'), target: ungroupedCol });
	assert.equal(prefsDetail!.prefs.assignments!.gamma, '__ungrouped__', 'dropping on ungrouped writes the sentinel (blocks keyword snap-back)');
	console.log('3c-2 kanban view: ok');
}

// ── 3d. Group assignment through the card menu ──────────────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	addSkill(tree, '/h/.claude/skills/gamma', 'gamma', 'g');
	const column: DashboardColumn = { name: 'S', color: '6366f1', sectionType: 'skills', cards: [] };
	const host = await renderSkills(column, { fs });

	let prefsDetail: { columnName: string; prefs: Partial<SkillsSectionConfig> } | null = null;
	host.addEventListener('dashboard-skills-prefs', ev => {
		prefsDetail = (ev as CustomEvent).detail;
	});

	const menuBtn = findByClass(cardsOf(host)[0]!, 'dashboard-skillsec-menu')[0]!;
	menuBtn.click();
	type StubMenu = { items: Array<{ title: string; click(): void }> };
	const menu = (Menu as unknown as { last: Menu | null }).last as unknown as StubMenu;
	const groupItem = menu.items.find(i => i.title === '设置分组…');
	assert.ok(groupItem, 'set-group menu item present');
	groupItem!.click();
	await flush();

	const picker = (Modal as unknown as { last: Modal }).last as unknown as { contentEl: El; onOpen(): void };
	picker.onOpen();
	const rows = findByClass(picker.contentEl, 'dashboard-skillsec-grouppick-row');
	assert.equal(rows.length, PRESET_SKILL_GROUPS.length + 1, 'picker lists ungrouped + every group');
	// Pick 代码 (second preset).
	const codeRow = rows.find(row => findByClass(row, 'dashboard-skillsec-grouppick-label').some(el => el.textContent === '代码'))!;
	codeRow.click();
	await flush();
	assert.equal(prefsDetail!.prefs.assignments!.gamma, 'g-code', 'picker routes the assignment through prefs');
	console.log('3d group picker: ok');
}

// ── 4. Import modal ─────────────────────────────────────────────────────

{
	const { fs, tree } = makeFakeFs('/h');
	addSkill(tree, '/src/my-skill', 'my-skill', 'a fancy skill');
	tree.set('/src/my-skill/references', { kind: 'dir', mtime: 1 });
	tree.set('/src/my-skill/references/guide.md', { kind: 'file', content: 'ref', mtime: 1 });
	tree.set('/h/.claude/skills/occupied', { kind: 'dir', mtime: 1 });
	tree.set('/h/.claude/skills/occupied/SKILL.md', { kind: 'file', content: 'old', mtime: 1 });
	addSkill(tree, '/src/occupied', 'occupied', 'new version');

	const makeModal = (): SkillImportModal => {
		const modal = new SkillImportModal({ vault: { configDir: '.obsidian' } } as never, {
			foldersCsv: '',
			defaultTargets: ['claude', 'codex'],
			onSaveTargets: ids => { savedTargets.push(ids); },
			onImported: (name, agents) => { imported.push({ name, agents: agents as string[] }); },
			fs,
		});
		// The stub's open() records Modal.last but never calls onOpen —
		// drive the render by hand (rss-verify idiom).
		modal.open();
		(modal as unknown as { onOpen(): void }).onOpen();
		return modal;
	};
	const savedTargets: string[][] = [];
	const imported: Array<{ name: string; agents: string[] }> = [];
	(Notice as unknown as { messages: string[] }).messages.length = 0;

	const setPath = async (modalEl: El, value: string): Promise<void> => {		const pathInput = findByClass(modalEl, 'dashboard-skillsec-import-path')[0]! as unknown as El & { value: string };
		pathInput.value = value;
		pathInput.dispatchEvent({ type: 'change', target: pathInput });
		await flush();
	};
	// The folder-pick button shares the --confirm class; the real confirm is
	// the footer's.
	const footerConfirm = (modalEl: El): El => findByClass(findByClass(modalEl, 'dashboard-modal-footer')[0]!, 'dashboard-modal-btn--confirm')[0]!;

	// Invalid first: a folder without SKILL.md.
	const invalid = makeModal();
	let modalEl = lastModalEl();
	await setPath(modalEl, '/src/not-a-skill');
	const status = findByClass(modalEl, 'dashboard-skillsec-import-status')[0]!;
	assert.ok(status.textContent.includes('SKILL.md'), 'missing SKILL.md surfaces the invalid-source error');
	const confirmBtn = footerConfirm(modalEl) as unknown as El & { disabled: boolean };
	assert.equal(confirmBtn.disabled, true, 'confirm stays disabled for an invalid source');
	void invalid;

	// 4a — fresh install into both targets.
	const fresh = makeModal();
	modalEl = lastModalEl();
	await setPath(modalEl, '/src/my-skill');
	const previewName = findByClass(modalEl, 'dashboard-skillsec-import-preview-name')[0]!;
	assert.equal(previewName.textContent, 'my-skill', 'preview shows the folder name');
	const confirmA = footerConfirm(modalEl) as unknown as El & { disabled: boolean };
	assert.equal(confirmA.disabled, false, 'confirm enabled after validation');
	confirmA.click();
	await flush();
	await flush();

	assert.equal(tree.get('/h/.claude/skills/my-skill/SKILL.md')?.content, skillDoc('my-skill', 'a fancy skill'), 'claude target installed');
	assert.equal(tree.get('/h/.codex/skills/my-skill/SKILL.md')?.content, skillDoc('my-skill', 'a fancy skill'), 'codex target installed');
	assert.equal(tree.get('/h/.codex/skills/my-skill/references/guide.md')?.content, 'ref', 'subfolder files copied');
	assert.deepEqual(savedTargets[0], ['claude', 'codex'], 'checkbox set persisted for next time');
	assert.deepEqual(imported[0], { name: 'my-skill', agents: ['claudian', 'codex'] }, 'import reports the fresh name + targeted agents');

	// 4b — conflicting target: headless has no electron shell, so the
	// trash-first overwrite must refuse and leave the old copy intact while
	// the clean target still installs.
	const conflict = makeModal();
	modalEl = lastModalEl();
	await setPath(modalEl, '/src/occupied');
	const confirmB = footerConfirm(modalEl) as unknown as El & { disabled: boolean };
	confirmB.click();
	await flush();
	await flush();

	assert.equal(tree.get('/h/.claude/skills/occupied/SKILL.md')?.content, 'old', 'conflicting target untouched without the desktop trash');
	assert.equal(tree.get('/h/.codex/skills/occupied/SKILL.md')?.content, skillDoc('occupied', 'new version'), 'clean target installed despite the sibling failure');
	assert.deepEqual(imported[1], { name: 'occupied', agents: ['codex'] }, 'partial import reports only the successful agent');
	console.log('4 import modal: ok');
}

// ── 5. Config modal ─────────────────────────────────────────────────────

{
	const existing: SkillsSectionConfig = {
		stores: ['claude', 'codex'],
		pinned: ['keep-me'],
		pageSize: 20,
		assignments: { orphan: 'g-deleted', keeper: 'g-code', exiled: '__ungrouped__' },
	};
	let saved: SkillsSectionConfig | null = null;
	const modal = new SkillSectionConfigModal({} as never, existing, config => { saved = config; });
	modal.open();
	(modal as unknown as { onOpen(): void }).onOpen();
	const modalEl = lastModalEl();

	// Group manager: preset rows appear (editable defaults).
	const groupRows = findByClass(modalEl, 'dashboard-skillsec-cfg-group');
	assert.equal(groupRows.length, PRESET_SKILL_GROUPS.length, 'preset groups seed the editor');

	const rows = findByClass(modalEl, 'dashboard-skillsec-cfg-store');
	assert.equal(rows.length, 3, 'three home store rows');
	const codexRow = rows.find(row => findByClass(row, 'dashboard-skillsec-cfg-store-name').some(el => el.textContent === 'Codex'))!;
	const codexInput = findTag(codexRow, 'input')[0] as unknown as El & { checked: boolean; dispatchEvent(ev: unknown): void };
	assert.equal(codexInput.checked, true, 'existing store set pre-checked');
	codexInput.checked = false;
	codexInput.dispatchEvent({ type: 'change', target: codexInput });

	// Delete the first preset group (写): blank-able presets are the point.
	const deleteBtn = findByClass(groupRows[0]!, 'dashboard-skillsec-cfg-group-delete')[0]!;
	deleteBtn.click();
	assert.equal(findByClass(modalEl, 'dashboard-skillsec-cfg-group').length, PRESET_SKILL_GROUPS.length - 1, 'delete drops the row');

	const saveBtn = findByClass(modalEl, 'dashboard-modal-btn--confirm')[0]!;
	saveBtn.click();
	assert.deepEqual(saved!.stores, ['claude'], 'unchecked store drops out');
	assert.deepEqual(saved!.pinned, ['keep-me'], 'pinned passes through untouched');
	assert.equal(saved!.pageSize, 20, 'pageSize passes through untouched');
	assert.equal(saved!.groups!.length, PRESET_SKILL_GROUPS.length - 1, 'edited group list persists');
	assert.equal(saved!.assignments!.keeper, 'g-code', 'assignment to a surviving group persists');
	assert.equal(saved!.assignments!.orphan, undefined, 'assignment to a deleted group pruned');
	assert.equal(saved!.assignments!.exiled, '__ungrouped__', 'explicit ungrouped sentinel survives pruning');
	console.log('5 config modal: ok');
}

// ── 5b. New-skill button config modal ───────────────────────────────────

{
	const { SkillCreateConfigModal } = await import('../src/skill-create-config-modal');
	let saved: import('../src/types').SkillCreateConfig | null = null;
	const modal = new SkillCreateConfigModal({} as never, { settings: {} } as never, undefined, cfg => { saved = cfg; });
	modal.open();
	(modal as unknown as { onOpen(): void }).onOpen();
	const modalEl = lastModalEl();

	// Defaults: skill-creator, confirm enabled, directSend off.
	const confirmBtn = findByClass(modalEl, 'dashboard-modal-btn--confirm')[0]! as unknown as El & { disabled: boolean };
	assert.equal(confirmBtn.disabled, false, 'default skill name validates');
	confirmBtn.click();
	const got = saved as unknown as import('../src/types').SkillCreateConfig;
	assert.ok(got, 'default save fires');
	assert.equal(got.agent, 'claudian');
	assert.equal(got.skillName, 'skill-creator');
	assert.equal(got.promptTemplate, '');
	assert.equal(got.directSend, undefined, 'directSend stays unset by default (confirm dialog kept)');

	// Invalid skill name blocks the save.
	const nameInput = findByClass(modalEl, 'dashboard-modal-input')[0]! as unknown as El & { value: string; dispatchEvent(ev: unknown): void };
	nameInput.value = 'not valid!';
	nameInput.dispatchEvent({ type: 'input', target: nameInput });
	const confirmBtn2 = findByClass(modalEl, 'dashboard-modal-btn--confirm')[0]! as unknown as El & { disabled: boolean };
	assert.equal(confirmBtn2.disabled, true, 'spaces/! in the name disable save');
	console.log('5b create config modal: ok');
}

// ── 6. GitHub import ────────────────────────────────────────────────────

{
	// URL parsing: plain repo, .git, tree+branch+subfolder.
	assert.equal(parseGithubUrl('https://github.com/anthropics/skills')?.repo, 'skills');
	assert.equal(parseGithubUrl('github.com/o/r.git')?.repo, 'r');
	const treeUrl = parseGithubUrl('https://github.com/o/r/tree/main/docs/skills');
	assert.equal(treeUrl?.branch, 'main', 'tree URL branch');
	assert.equal(treeUrl?.subPath, 'docs/skills', 'tree URL subfolder');
	assert.equal(parseGithubUrl('https://example.com/x'), null, 'non-GitHub URL rejected');

	// Fake GitHub: repo JSON + recursive tree with a nested reference doc
	// (skill-a/references/SKILL.md must NOT count as a second skill).
	const repoJson = JSON.stringify({ default_branch: 'main' });
	const treeJson = JSON.stringify({ tree: [
		{ path: 'README.md', type: 'blob' },
		{ path: 'skill-a/SKILL.md', type: 'blob' },
		{ path: 'skill-a/references/guide.md', type: 'blob' },
		{ path: 'skill-a/references/SKILL.md', type: 'blob' },
		{ path: 'skill-b/SKILL.md', type: 'blob' },
		{ path: 'deep/nest/thing/SKILL.md', type: 'blob' },
	] });
	const request: GithubRequest = async (url, accept) => {
		if (url.includes('/git/trees/')) return { status: 200, text: treeJson, bytes: new TextEncoder().encode(treeJson) };
		if (url.includes('/repos/o/r')) return { status: 200, text: repoJson, bytes: new TextEncoder().encode(repoJson) };
		if (url.includes('raw.githubusercontent.com')) {
			const path = url.replace(/^.*\/r\/main\//, '');
			return { status: 200, text: path, bytes: new TextEncoder().encode(`content of ${path}`) };
		}
		void accept;
		return { status: 404, text: 'nope', bytes: new Uint8Array() };
	};

	const listed = await fetchGithubSkillDirs(parseGithubUrl('https://github.com/o/r')!, request);
	assert.equal(listed.ref.branch, 'main', 'default branch resolved');
	assert.deepEqual(listed.skills.map(s => s.name), ['skill-a', 'skill-b'], 'skills listed; nested doc and deep nest excluded');

	// Install both skills into claude through the fake raw downloader.
	const { fs, tree: fsTree } = makeFakeFs('/h');
	const targets = [{ storeId: 'claude', dir: '/h/.claude/skills' }];
	const results = await importGithubSkills(fs, listed.ref, listed.paths, listed.skills, targets, request);
	assert.deepEqual(results.map(r => r.name), ['skill-a', 'skill-b']);
	assert.ok(results.every(r => r.outcomes.every(o => o.ok)), 'both skills installed cleanly');
	assert.equal(fsTree.get('/h/.claude/skills/skill-a/SKILL.md')?.content, 'content of skill-a/SKILL.md', 'SKILL.md bytes landed');
	assert.equal(fsTree.get('/h/.claude/skills/skill-a/references/guide.md')?.content, 'content of skill-a/references/guide.md', 'subfolder bytes landed');
	console.log('6 github import: ok');
}

	console.log('verify-skill-section: all scenarios OK');
}

void main().catch(err => {
	console.error(err);
	process.exit(1);
});
