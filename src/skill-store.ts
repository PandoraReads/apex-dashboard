/**
 * Skill library data layer for the skills section (sectionType 'skills').
 *
 * The section shows every AI skill installed on this machine, aggregated by
 * name across skill directories ("stores"): the three agent home dirs plus
 * the user's skillSourceFolders. This module owns:
 *
 *  - store definitions (HOME_SKILL_STORES + custom dirs) and their agent map
 *  - SKILL.md frontmatter parsing (name + description, yaml-backed so folded
 *    multi-line descriptions — about a quarter of real-world skills — parse)
 *  - the filesystem seam (SkillFs): injected in verification scripts because
 *    obsidian-stub has no fs and no Platform.isDesktop
 *  - scanning with an mtime-keyed incremental cache (~700 skill dirs)
 *  - the cross-session snapshot (skills.json in the plugin dir, mobile can
 *    read it back read-only — same trust level as rss.json)
 *  - mutations the section needs: import (folder copy with trash-then-write
 *    overwrite), Finder reveal, OS-trash delete
 *
 * Like skill-registry this module never executes a skill; unlike it, entries
 * carry metadata (description, path, mtime) rather than bare names.
 */

import { App, Notice, Platform } from 'obsidian';
import { parse as parseYaml } from 'yaml';
import type { AgentTarget, SkillSectionGroup } from './types';
import { t } from './i18n';
import { expandHomePath } from './skill-registry';

// ── Store definitions ───────────────────────────────────────────────────

export interface SkillStoreDef {
	/** Stable id: 'claude' | 'codex' | 'workbuddy' | `custom:<absolute dir>`. */
	id: string;
	/** Short label for toolbars and menus (i18n-free; sources are brands). */
	label: string;
	/** Absolute directory path (home stores keep '~' until expanded). */
	dir: string;
	/** Agent whose `$skill` namespace this directory feeds, if any. Custom
	 *  folders feed every agent's picker, so they carry no single agent. */
	agent?: AgentTarget;
}

/** The three agent home skill directories ('~' resolved at scan time). */
export const HOME_SKILL_STORES: readonly SkillStoreDef[] = [
	{ id: 'claude', label: 'Claude', dir: '~/.claude/skills', agent: 'claudian' },
	{ id: 'codex', label: 'Codex', dir: '~/.codex/skills', agent: 'codex' },
	{ id: 'workbuddy', label: 'WorkBuddy', dir: '~/.workbuddy/skills', agent: 'workbuddy' },
];

export function isHomeStoreId(id: string): boolean {
	return id === 'claude' || id === 'codex' || id === 'workbuddy';
}

/** Badge letter for a store id (card source badges: C / X / W / F). */
export function skillStoreBadge(id: string): string {
	if (id === 'claude') return 'C';
	if (id === 'codex') return 'X';
	if (id === 'workbuddy') return 'W';
	return 'F';
}

/** Display label for a store id (home stores by brand, custom by folder). */
export function skillStoreLabel(id: string): string {
	if (id.startsWith('custom:')) return id.slice('custom:'.length).replace(/\/+$/, '').split('/').pop() ?? id;
	return HOME_SKILL_STORES.find(store => store.id === id)?.label ?? id;
}

/** Agent for a home store id, undefined for custom folders. */
export function skillStoreAgent(id: string): AgentTarget | undefined {
	return HOME_SKILL_STORES.find(store => store.id === id)?.agent;
}

/** Home stores + the user's skillSourceFolders (CSV, '~' allowed) as custom
 *  stores. Pure so tests can drive it with a fake home. */
export function resolveSkillStores(foldersCsv: string, home: string): SkillStoreDef[] {
	const customs: SkillStoreDef[] = [];
	for (const raw of foldersCsv.split(/[,，]/)) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const dir = expandHomePath(trimmed, home);
		const label = dir.replace(/\/+$/, '').split('/').pop() ?? dir;
		customs.push({ id: `custom:${dir}`, label, dir });
	}
	return [
		...HOME_SKILL_STORES.map(store => ({ ...store, dir: expandHomePath(store.dir, home) })),
		...customs,
	];
}

// ── SKILL.md frontmatter ────────────────────────────────────────────────

export interface SkillDocMeta {
	name: string;
	description: string;
}

/** Cached description cap — cards line-clamp far earlier; the cap only
 *  bounds skills.json (hundreds of entries × full descriptions). */
const MAX_DESCRIPTION_CHARS = 500;

/** Parse a SKILL.md's leading frontmatter for name + description. The yaml
 *  library (already a dependency) resolves folded multi-line descriptions
 *  correctly; regex and folder-name fallbacks keep malformed files listing
 *  (same tolerance as skill-registry's parseSkillDocName). */
export function parseSkillDoc(content: string, fallbackName: string): SkillDocMeta {
	let name = '';
	let description = '';
	const text = content.replace(/^﻿/, '');
	if (text.startsWith('---')) {
		const end = text.indexOf('\n---', 3);
		if (end > 3) {
			try {
				const doc = parseYaml(text.slice(4, end)) as Record<string, unknown> | null;
				if (doc && typeof doc === 'object') {
					if (typeof doc.name === 'string') name = doc.name.trim().replace(/^["']|["']$/g, '');
					if (typeof doc.description === 'string') description = doc.description.trim();
				}
			} catch {
				// malformed YAML: regex fallback below still finds `name:`
			}
		}
	}
	if (!name) {
		const match = text.match(/^name:\s*(.+)$/m);
		name = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
	}
	return { name: name || fallbackName, description: description.slice(0, MAX_DESCRIPTION_CHARS) };
}

// ── Filesystem seam ─────────────────────────────────────────────────────

export interface SkillListEntry {
	path: string;
	name: string;
	isDir: boolean;
}

/** Everything the library needs from the filesystem, injected so
 *  verification scripts can drive scans and imports against fake trees
 *  (obsidian-stub has no fs; Platform.isDesktop is undefined there). */
export interface SkillFs {
	list(dir: string): Promise<SkillListEntry[]>;
	/** mtime in ms; must reject when the path is absent. */
	statMs(path: string): Promise<number>;
	/** First `bytes` of a UTF-8 file (frontmatter lives at the top). */
	readTextHead(path: string, bytes: number): Promise<string>;
	exists(path: string): Promise<boolean>;
	mkdirRec(path: string): Promise<void>;
	writeFile(path: string, data: Uint8Array): Promise<void>;
	readFileBytes(path: string): Promise<Uint8Array>;
	homeDir(): string;
}

/** Frontmatter bytes read per SKILL.md — capping keeps the first scan of
 *  ~700 files cheap (a handful of full-file reads would still be fine, but
 *  some SKILL.md carry long reference bodies). */
export const SKILL_HEAD_BYTES = 4096;

/** Desktop Node fs behind the seam (same require dance as
 *  skill-registry's discoverFolderSkills). Undefined on mobile or when the
 *  renderer forbids require — callers degrade to the cached snapshot. */
export function desktopSkillFs(): SkillFs | undefined {
	if (!Platform.isDesktop) return undefined;
	const nodeRequire = (globalThis as { require?: NodeRequire }).require ?? (window as unknown as { require?: NodeRequire }).require;
	if (!nodeRequire) return undefined;
	try {
		const fs = nodeRequire('fs') as typeof import('fs');
		const os = nodeRequire('os') as typeof import('os');
		const { Buffer } = nodeRequire('buffer') as typeof import('buffer');
		return {
			list: async dir => {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true });
				return entries.map(e => ({ path: `${dir}/${e.name}`, name: e.name, isDir: e.isDirectory() }));
			},
			statMs: async path => (await fs.promises.stat(path)).mtimeMs,
			readTextHead: async (path, bytes) => {
				const handle = await fs.promises.open(path, 'r');
				try {
					const buf = Buffer.alloc(bytes);
					const { bytesRead } = await handle.read(buf, 0, bytes, 0);
					return buf.subarray(0, bytesRead).toString('utf8');
				} finally {
					await handle.close();
				}
			},
			exists: async path => {
				try {
					await fs.promises.access(path);
					return true;
				} catch {
					return false;
				}
			},
			mkdirRec: async dir => {
				await fs.promises.mkdir(dir, { recursive: true });
			},
			writeFile: (path, data) => fs.promises.writeFile(path, data),
			readFileBytes: async path => new Uint8Array(await fs.promises.readFile(path)),
			homeDir: () => os.homedir(),
		};
	} catch {
		return undefined;
	}
}

// ── Scanning ────────────────────────────────────────────────────────────

export interface SkillEntry {
	/** Frontmatter name (folder name as fallback). */
	name: string;
	description: string;
	storeId: string;
	dirPath: string;
	/** SKILL.md mtime — the freshness key for the incremental cache and the
	 *  "recently updated" sort. */
	mtimeMs: number;
}

/** Skills folders are numerous (~700 across the home dirs) but each stat /
 *  head-read is tiny; a small concurrency cap keeps the scan off the UI
 *  thread's Promise queue without spawning 700 parallel handles. */
const SCAN_CONCURRENCY = 12;

/** Scan one store directory: every subfolder with a SKILL.md becomes an
 *  entry. `previous` (dirPath → entry) lets unchanged skills — same SKILL.md
 *  mtime — skip the read entirely (one stat instead). Pure over the seam. */
export async function scanSkillStoreDir(
	fs: SkillFs,
	store: SkillStoreDef,
	previous: ReadonlyMap<string, SkillEntry>,
): Promise<SkillEntry[]> {
	let entries: SkillListEntry[];
	try {
		entries = await fs.list(store.dir);
	} catch {
		return []; // absent/unreadable store dir: nothing this store offers
	}
	const dirs = entries.filter(e => e.isDir);
	const out: SkillEntry[] = [];
	for (let i = 0; i < dirs.length; i += SCAN_CONCURRENCY) {
		const chunk = dirs.slice(i, i + SCAN_CONCURRENCY);
		const results = await Promise.all(chunk.map(async entry => {
			const dirPath = entry.path.replace(/\/+$/, '');
			const docPath = `${dirPath}/SKILL.md`;
			try {
				const mtimeMs = await fs.statMs(docPath);
				const cached = previous.get(dirPath);
				if (cached && cached.mtimeMs === mtimeMs) return cached;
				const meta = parseSkillDoc(await fs.readTextHead(docPath, SKILL_HEAD_BYTES), entry.name);
				return { ...meta, storeId: store.id, dirPath, mtimeMs } as SkillEntry;
			} catch {
				return null; // no SKILL.md / unreadable: not a skill folder
			}
		}));
		for (const result of results) if (result) out.push(result);
	}
	return out;
}

// ── Aggregation ─────────────────────────────────────────────────────────

export interface SkillGroup {
	name: string;
	description: string;
	/** One per store the skill is installed in, home-store order first so
	 *  the primary path (claude > codex > workbuddy) is stable. */
	instances: SkillEntry[];
}

// ── User groups ─────────────────────────────────────────────────────────

/** Starter groups offered until the user edits them (anthropic-skills-
 *  flavored buckets). Every one is deletable/editable in the config modal;
 *  keyword matches run against the skill NAME only, manual assignments win. */
export const PRESET_SKILL_GROUPS: readonly SkillSectionGroup[] = [
	{ id: 'g-write', name: '写作', keywords: 'write,writing,copy,essay,blog,article,文案,写作,humanize,seo' },
	{ id: 'g-code', name: '代码', keywords: 'code,coding,dev,refactor,tdd,review,api,debug,lint,代码,编程' },
	{ id: 'g-design', name: '设计', keywords: 'design,ui,ux,theme,css,figma,logo,poster,slide,设计,海报,主题' },
	{ id: 'g-doc', name: '办公文档', keywords: 'docx,pdf,pptx,xlsx,excel,word,powerpoint,sheet,文档,表格' },
	{ id: 'g-data', name: '数据分析', keywords: 'data,analytics,chart,sql,dashboard,分析,图表' },
	{ id: 'g-auto', name: '自动化', keywords: 'automation,workflow,n8n,pipeline,scrape,自动化,工作流' },
	{ id: 'g-research', name: '学习研究', keywords: 'research,study,learn,vocab,reading,transcript,学习,研究,精读,词汇' },
];

/** Groups in play: the saved list when the user has ever saved one (even
 *  emptied — that's a deliberate choice), the presets otherwise. */
export function effectiveSkillGroups(groups: SkillSectionGroup[] | undefined): SkillSectionGroup[] {
	return groups ?? [...PRESET_SKILL_GROUPS];
}

/** Assignment value meaning "explicitly ungrouped" — blocks the keyword
 *  fallback so a dragged-away skill stays where the user put it. Distinct
 *  from NO assignment (= let keywords decide). */
export const UNGROUPED_ASSIGNMENT = '__ungrouped__';

/** The group a skill belongs to: manual assignment first (the ungrouped
 *  sentinel short-circuits keywords; an assignment to a deleted group
 *  drops through), then the first keyword hit on the skill name, else
 *  null = 未分组. Pure — tests drive it directly. */
export function resolveSkillGroup(
	name: string,
	groups: readonly SkillSectionGroup[],
	assignments: Record<string, string> | undefined,
): SkillSectionGroup | null {
	const manual = assignments?.[name];
	if (manual === UNGROUPED_ASSIGNMENT) return null;
	if (manual) {
		const claimed = groups.find(group => group.id === manual);
		if (claimed) return claimed;
	}
	const lower = name.toLowerCase();
	for (const group of groups) {
		for (const keyword of (group.keywords ?? '').split(/[,，]/)) {
			const needle = keyword.trim().toLowerCase();
			if (needle && lower.includes(needle)) return group;
		}
	}
	return null;
}

/** Aggregate entries by name — one card per name (~700 directories collapse
 *  to ~440 cards). Description comes from the first instance that has one. */
export function groupSkillEntries(entries: readonly SkillEntry[], storeOrder: readonly string[]): SkillGroup[] {
	const byName = new Map<string, SkillEntry[]>();
	for (const entry of entries) {
		const list = byName.get(entry.name);
		if (list) list.push(entry);
		else byName.set(entry.name, [entry]);
	}
	const rank = new Map(storeOrder.map((id, i) => [id, i]));
	const out: SkillGroup[] = [];
	for (const [name, instances] of byName) {
		const sorted = [...instances].sort((a, b) => (rank.get(a.storeId) ?? 99) - (rank.get(b.storeId) ?? 99));
		const described = sorted.find(inst => inst.description);
		out.push({ name, description: described?.description ?? '', instances: sorted });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Snapshot store (skills.json) ────────────────────────────────────────

interface SkillStoreFile {
	version: 1;
	scannedAt: number;
	entries: SkillEntry[];
}

const DATA_FILE = 'skills.json';

/** How long a scan stands in — board opens usually skip the disk walk
 *  entirely (the header refresh button always bypasses). */
export const SKILL_SCAN_TTL_MS = 15 * 60_000;

function isSkillEntry(value: unknown): value is SkillEntry {
	if (typeof value !== 'object' || value === null) return false;
	const rec = value as Record<string, unknown>;
	return typeof rec.name === 'string' && typeof rec.description === 'string'
		&& typeof rec.storeId === 'string' && typeof rec.dirPath === 'string'
		&& typeof rec.mtimeMs === 'number';
}

/** Cross-session snapshot of the last scan, persisted through the vault
 *  adapter (mobile reads it back for a read-only view; rss-store idiom:
 *  lazy load, serialized writes, silent-fail persist). */
export class SkillLibraryStore {
	private loaded = false;
	private file: SkillStoreFile = { version: 1, scannedAt: 0, entries: [] };
	private lastWritten: string | null = null;
	/** Serialized write queue — at most one write ever in flight. */
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(private readonly app: App) {}

	private get path(): string {
		return `${this.app.vault.configDir}/plugins/apex-dashboard/${DATA_FILE}`;
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const raw = await this.app.vault.adapter.read(this.path);
			const parsed = JSON.parse(raw) as Partial<SkillStoreFile>;
			if (Array.isArray(parsed.entries)) {
				this.file = {
					version: 1,
					scannedAt: typeof parsed.scannedAt === 'number' ? parsed.scannedAt : 0,
					entries: parsed.entries.filter(isSkillEntry),
				};
			}
			this.lastWritten = raw;
		} catch {
			// No file yet (first ever render): the first rescan writes it.
		}
	}

	entries(): readonly SkillEntry[] {
		return this.file.entries;
	}

	/** True when no scan has ever run or the TTL elapsed. */
	isStale(now = Date.now()): boolean {
		return this.file.scannedAt === 0 || now - this.file.scannedAt >= SKILL_SCAN_TTL_MS;
	}

	/** Force the next render to rescan (called after an import/delete). */
	markDirty(): void {
		this.file = { ...this.file, scannedAt: 0 };
	}

	/** Rescan every store; unchanged skills (same SKILL.md mtime) reuse their
	 *  cached entry, so the steady state costs one stat per skill folder. */
	async rescan(fs: SkillFs, foldersCsv: string): Promise<readonly SkillEntry[]> {
		const stores = resolveSkillStores(foldersCsv, fs.homeDir());
		const previous = new Map(this.file.entries.map(entry => [entry.dirPath, entry]));
		const collected: SkillEntry[] = [];
		for (const store of stores) {
			collected.push(...await scanSkillStoreDir(fs, store, previous));
		}
		collected.sort((a, b) => a.name.localeCompare(b.name));
		this.file = { version: 1, scannedAt: Date.now(), entries: collected };
		this.scheduleSave();
		return collected;
	}

	private scheduleSave(): void {
		this.saveQueue = this.saveQueue.then(() => this.persist());
	}

	private async persist(): Promise<void> {
		try {
			const json = JSON.stringify(this.file);
			await this.app.vault.adapter.write(this.path, json);
			this.lastWritten = json;
		} catch {
			// silent fail: an unwritable file must not break rendering
		}
	}
}

let libraryStore: SkillLibraryStore | null = null;

/** App-session singleton — every skills section render shares one store. */
export function getSkillLibraryStore(app: App): SkillLibraryStore {
	if (!libraryStore) libraryStore = new SkillLibraryStore(app);
	return libraryStore;
}

// ── Shell helpers (reveal / trash) ──────────────────────────────────────

type SkillShell = {
	showItemInFolder?: (fullPath: string) => void;
	trashItem?: (fullPath: string) => Promise<void>;
};
type SkillShellRequire = (name: string) => { shell?: SkillShell };

function skillShell(): SkillShell | undefined {
	try {
		const nodeRequire = (globalThis as { require?: SkillShellRequire }).require
			?? (window as unknown as { require?: SkillShellRequire }).require;
		return nodeRequire?.('electron').shell;
	} catch {
		return undefined;
	}
}

/** Reveal a skill folder in the platform file manager (Finder / Explorer). */
export function revealSkillFolder(dirPath: string): boolean {
	const shell = skillShell();
	if (typeof shell?.showItemInFolder !== 'function') {
		new Notice(t('skills.shellUnavailable'));
		return false;
	}
	try {
		shell.showItemInFolder(dirPath);
		return true;
	} catch {
		new Notice(t('skills.revealFailed'));
		return false;
	}
}

/** Move a skill folder to the OS trash (Electron shell.trashItem — the
 *  user can still restore it from Finder/Explorer). */
export async function trashSkillFolder(dirPath: string): Promise<boolean> {
	const shell = skillShell();
	if (typeof shell?.trashItem !== 'function') {
		new Notice(t('skills.shellUnavailable'));
		return false;
	}
	try {
		await shell.trashItem(dirPath);
		return true;
	} catch {
		new Notice(t('skills.removeFailed'));
		return false;
	}
}

/** Clipboard copy with an availability guard (the ZCode bridge idiom — the
 *  Electron renderer always has navigator.clipboard; headless tests don't). */
export async function copySkillPath(path: string): Promise<boolean> {
	try {
		if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
		await navigator.clipboard.writeText(path);
		return true;
	} catch {
		return false;
	}
}

// ── Import ──────────────────────────────────────────────────────────────

export interface SkillImportTarget {
	storeId: string;
	/** Absolute destination directory (the store's dir). */
	dir: string;
}

export interface SkillImportOutcome {
	storeId: string;
	ok: boolean;
	/** An existing folder with the same name was replaced (old copy trashed). */
	overwritten: boolean;
	error?: string;
}

/** What the import modal previews about the chosen source folder. */
export interface SkillImportSource {
	/** Destination folder name — the source folder's basename, kept verbatim
	 *  (Claude Code keys on frontmatter, but the folder is the disk unit). */
	name: string;
	description: string;
	fileCount: number;
}

function baseName(path: string): string {
	return path.replace(/\/+$/, '').split('/').pop() ?? path;
}

/** Walk cap: skill folders are shallow (SKILL.md + references/scripts);
 *  deeper trees are almost certainly a mistaken selection (a whole vault). */
const IMPORT_MAX_DEPTH = 8;
const IMPORT_MAX_FILES = 5000;

async function countFilesRec(fs: SkillFs, dir: string, depth: number): Promise<number> {
	if (depth > IMPORT_MAX_DEPTH) return 0;
	let count = 0;
	for (const entry of await fs.list(dir)) {
		if (!entry.isDir) count += 1;
		else count += await countFilesRec(fs, entry.path, depth + 1);
		if (count >= IMPORT_MAX_FILES) return IMPORT_MAX_FILES;
	}
	return count;
}

/** Validate a typed skill folder: SKILL.md present and parseable. Returns
 *  null when the folder is not a skill (no SKILL.md / unreadable). */
export async function inspectSkillDir(fs: SkillFs, dir: string): Promise<SkillImportSource | null> {
	const clean = dir.replace(/\/+$/, '');
	try {
		const meta = parseSkillDoc(await fs.readTextHead(`${clean}/SKILL.md`, SKILL_HEAD_BYTES), baseName(clean));
		const fileCount = await countFilesRec(fs, clean, 0);
		return { name: baseName(clean), description: meta.description, fileCount };
	} catch {
		return null;
	}
}

/** webkitRelativePath minus the root segment, guarded against traversal. */
function relativeSegments(file: File): string[] | null {
	const rel = file.webkitRelativePath || file.name;
	const parts = rel.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	const rest = parts.slice(1);
	if (rest.some(part => part === '..' || part === '.')) return null;
	return rest;
}

async function copyDirRec(fs: SkillFs, src: string, dest: string, depth: number): Promise<void> {
	if (depth > IMPORT_MAX_DEPTH) throw new Error('skill folder too deep');
	await fs.mkdirRec(dest);
	for (const entry of await fs.list(src)) {
		if (entry.isDir) await copyDirRec(fs, entry.path, `${dest}/${entry.name}`, depth + 1);
		else await fs.writeFile(`${dest}/${entry.name}`, await fs.readFileBytes(entry.path));
	}
}

/** Shared install path: trash an existing same-name folder first (never an
 *  in-place merge — a stale file surviving an update is the classic broken
 *  install), then let the writer fill the destination. Exported for the
 *  GitHub importer, which writes downloaded bytes through the same seam. */
export async function installToStores(
	fs: SkillFs,
	targets: readonly SkillImportTarget[],
	name: string,
	write: (dest: string) => Promise<void>,
): Promise<SkillImportOutcome[]> {
	const outcomes: SkillImportOutcome[] = [];
	for (const target of targets) {
		const dest = `${target.dir.replace(/\/+$/, '')}/${name}`;
		try {
			const overwritten = await fs.exists(dest);
			if (overwritten && !(await trashSkillFolder(dest))) {
				outcomes.push({ storeId: target.storeId, ok: false, overwritten, error: 'trash-failed' });
				continue;
			}
			await write(dest);
			outcomes.push({ storeId: target.storeId, ok: true, overwritten });
		} catch (err) {
			outcomes.push({ storeId: target.storeId, ok: false, overwritten: false, error: err instanceof Error ? err.message : String(err) });
		}
	}
	return outcomes;
}

/** Import a skill folder from a typed/validated disk path. */
export async function importSkillDir(
	fs: SkillFs,
	sourceDir: string,
	targets: readonly SkillImportTarget[],
): Promise<SkillImportOutcome[]> {
	const clean = sourceDir.replace(/\/+$/, '');
	return installToStores(fs, targets, baseName(clean), dest => copyDirRec(fs, clean, dest, 0));
}

/** Import from a webkitdirectory FileList (each file's relative path starts
 *  with the chosen folder's name). */
export async function importSkillFiles(
	fs: SkillFs,
	rootName: string,
	files: readonly File[],
	targets: readonly SkillImportTarget[],
): Promise<SkillImportOutcome[]> {
	return installToStores(fs, targets, rootName, async dest => {
		for (const file of files) {
			const segments = relativeSegments(file);
			if (!segments) continue;
			const destPath = `${dest}/${segments.join('/')}`;
			await fs.mkdirRec(destPath.split('/').slice(0, -1).join('/'));
			await fs.writeFile(destPath, new Uint8Array(await file.arrayBuffer()));
		}
	});
}
