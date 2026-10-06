import type { App, TFile } from 'obsidian';
import type { PipelineConfig, PipelineStage } from './types';
import { isUnderExcludedFolder, normalizeExcludeFolders } from './exclude-folders';

/**
 * Pure core of the pipeline section: scan a root folder, read each note's
 * status field, group items into stages. Rendering, dragging and prompt
 * dispatch live in pipeline-section; this module stays DOM-free so the
 * verification scripts can drive it directly against a stubbed vault.
 */

export interface PipelineItem {
	file: TFile;
	stage: PipelineStage;
	/** Raw frontmatter map (metadataCache view, may be empty). */
	frontmatter: Record<string, unknown>;
}

export function normalizeFolderPath(path: string): string {
	return path.trim().replace(/^\/+|\/+$/g, '');
}

/** Stage identity is the status field's value: trimmed, case-insensitive
 *  (a hand-typed `Draft` still lands in the `draft` column). */
export function resolvePipelineStage(stages: PipelineStage[], rawValue: unknown): PipelineStage | null {
	const value = String(rawValue ?? '').trim().toLowerCase();
	if (!value) return null;
	return stages.find(stage => stage.value.trim().toLowerCase() === value) ?? null;
}

export function isPathInPipelineRoot(path: string, rootFolder: string): boolean {
	const root = normalizeFolderPath(rootFolder).toLowerCase();
	if (!root) return true;
	return path.toLowerCase().startsWith(root + '/');
}

/** Full vault path of a stage's archive folder, or null when the stage keeps
 *  files wherever they are (no folder configured). */
export function stageFolderPath(config: PipelineConfig, stage: PipelineStage): string | null {
	const sub = normalizeFolderPath(stage.folder ?? '');
	if (!sub) return null;
	const root = normalizeFolderPath(config.rootFolder);
	return root ? `${root}/${sub}` : sub;
}

/** Order one stage's cards. Default: newest-touched first (mtime desc).
 *  'ctime': newest-created first. 'platform': grouped by the platform
 *  frontmatter value (empty last, locale order), newest-touched inside each
 *  group so a platform switch never shuffles unrelated work. */
/** One rail value item's colors on the TIFFANY-teal monochrome ramp (Rae's
 *  pick): a single 178° hue whose LIGHTNESS opens from deep turquoise (top)
 *  to pale Tiffany (bottom) — same family, varying depth, no hue hopping.
 *  The ink flips with the surface so every step stays readable (white on the
 *  deep end, slate on the pale end). Positional, so the progression is
 *  stable. */
export interface RailValueColors {
	bg: string;
	ink: string;
}

export function railValueColors(index: number, total: number): RailValueColors {
	const t = Math.min(1, Math.max(0, total <= 0 ? 0.5 : (index + 0.5) / total));
	const lightness = Math.round(30 + t * (68 - 30));
	const bg = `hsl(178deg 38% ${lightness}%)`;
	const ink = lightness < 52 ? '#ffffff' : '#33484d';
	return { bg, ink };
}

export function sortStageItems(items: PipelineItem[], sortBy: 'ctime' | 'platform' | undefined): PipelineItem[] {
	const byMtime = (a: PipelineItem, b: PipelineItem) => b.file.stat.mtime - a.file.stat.mtime;
	if (sortBy === 'ctime') {
		items.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
	} else if (sortBy === 'platform') {
		const platformOf = (item: PipelineItem): string => String(item.frontmatter['platform'] ?? '').trim();
		items.sort((a, b) => {
			const pa = platformOf(a);
			const pb = platformOf(b);
			if (!pa && pb) return 1;
			if (pa && !pb) return -1;
			if (pa && pb && pa !== pb) return pa.localeCompare(pb, 'zh-Hans-CN');
			return byMtime(a, b);
		});
	} else {
		items.sort(byMtime);
	}
	return items;
}

/** Project-dimension field aliases — any one holding a value counts (Rae's
 *  vault mixes 项目 / project / 相关项目 across notes). */
export const PROJECT_FIELD_KEYS: readonly string[] = ['项目', 'project', '相关项目'];

/** Platform-dimension field aliases, same rule: 平台 / platform. */
export const PLATFORM_FIELD_KEYS: readonly string[] = ['平台', 'platform'];

/** Split one raw field value into individual values: YAML lists pass
 *  through member-wise, strings split on commas (半角/全角). */
export function splitFieldValues(raw: unknown): string[] {
	const out: string[] = [];
	if (Array.isArray(raw)) {
		for (const v of raw) out.push(String(v).trim());
	} else if (typeof raw === 'string') {
		for (const v of raw.split(/[,，]/)) out.push(v.trim());
	}
	return out.filter(v => v.length > 0);
}

/** Alias-group lookup for a configured filter dimension: built-in names
 *  keep their families (项目/project/相关项目, 平台/platform), anything
 *  else matches its exact key. */
export function resolveFilterFieldKeys(name: string): readonly string[] {
	const n = name.trim();
	if (PROJECT_FIELD_KEYS.includes(n)) return PROJECT_FIELD_KEYS;
	if (PLATFORM_FIELD_KEYS.includes(n)) return PLATFORM_FIELD_KEYS;
	return n ? [n] : [];
}

/** All individual values from the first field key that holds any — a note
 *  with `platform: [小红书, 公众号]` (or "小红书, 公众号") carries BOTH
 *  values, each listed separately in the filter rail. */
export function fieldAliasValues(frontmatter: Record<string, unknown>, keys: string | readonly string[]): string[] {
	for (const key of typeof keys === 'string' ? [keys] : keys) {
		const values = splitFieldValues(frontmatter[key]);
		if (values.length > 0) return values;
	}
	return [];
}



/** Distinct field values across items, count desc then locale — the left
 *  filter rail's source list (only values actually present are shown). */
export function distinctFieldValues(items: readonly PipelineItem[], key: string | readonly string[]): Array<{ value: string; count: number }> {
	const counts = new Map<string, number>();
	for (const item of items) {
		for (const value of fieldAliasValues(item.frontmatter, key)) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-Hans-CN'));
}

/** Keep only the items whose field value equals the pick (null = all). */
export function filterByField(model: PipelineBoardModel, key: string | readonly string[], value: string | null): PipelineBoardModel {
	if (value === null) return model;
	const byStage = new Map<string, PipelineItem[]>();
	for (const [stageValue, list] of model.byStage) {
		byStage.set(stageValue, list.filter(item => fieldAliasValues(item.frontmatter, key).includes(value)));
	}
	return { byStage };
}

export interface PipelineBoardModel {
	/** Items per stage, keyed by stage.value, newest first (mtime desc). */
	byStage: Map<string, PipelineItem[]>;
}

/** Scan the root folder and group notes by the status field. STRICT by
 *  design: a note renders on the board only when its status value matches a
 *  configured stage (case-insensitively). Notes without the field or with an
 *  unknown value are skipped entirely — the pipeline must never surface
 *  unrelated vault content. Excluded folders (templates, archives) never
 *  reach the board either. */
export function collectPipelineItems(app: App, config: PipelineConfig): PipelineBoardModel {
	const byStage = new Map<string, PipelineItem[]>();
	for (const stage of config.stages) byStage.set(stage.value, []);
	const excluded = normalizeExcludeFolders(config.excludeFolders ?? []);
	for (const file of app.vault.getMarkdownFiles()) {
		if (!isPathInPipelineRoot(file.path, config.rootFolder)) continue;
		if (isUnderExcludedFolder(file.path, excluded)) continue;
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const stage = resolvePipelineStage(config.stages, frontmatter[config.statusField]);
		if (stage) byStage.get(stage.value)!.push({ file, stage, frontmatter });
	}
	for (const list of byStage.values()) sortStageItems(list, config.sortBy);
	return { byStage };
}

/** Frontmatter tags normalized to a flat string list (array, comma/space
 *  separated string, or nothing). Used by the default chip set. */
export function itemTags(frontmatter: Record<string, unknown>): string[] {
	const raw = frontmatter['tags'] ?? frontmatter['tag'];
	const out: string[] = [];
	if (Array.isArray(raw)) {
		for (const v of raw) out.push(String(v).trim());
	} else if (typeof raw === 'string') {
		for (const v of raw.split(/[,，\s]+/)) if (v) out.push(v.trim());
	}
	return out.filter(tag => tag.length > 0 && tag.length <= 24).slice(0, 4);
}

/** One non-tag frontmatter field surfaced as a chip (e.g. platform: 小红书). */
export function itemPropertyChip(frontmatter: Record<string, unknown>): string | null {
	const raw = frontmatter['platform'];
	if (raw == null) return null;
	const value = String(raw).trim();
	return value ? value.slice(0, 16) : null;
}

export interface PipelineChip {
	text: string;
	/** Property chips take the stage accent; tag chips stay muted. */
	isProperty: boolean;
	/** Stable per-value color for property chips (white text), see
	 *  {@link chipColorFor}. */
	color?: string;
}

/** Pastel palette for skill buttons (Rae: 浅粉 / 蒂芙尼蓝 territory — soft,
 *  airy tones). Icons sit on it in deep ink, NOT white: pastels can't carry
 *  white glyphs. */
const SKILL_PALETTE = ['#8ed6cf', '#f4b8c8', '#c9b6e4', '#f2d591', '#b9dfc3', '#a9c8e8', '#f5c3a8', '#cfc9e8'];

/** Stable pastel slot for a skill (same hash family as the chips). */
export function skillColorFor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
	}
	return SKILL_PALETTE[hash % SKILL_PALETTE.length]!;
}

/** Mid-depth palette for property chips: saturated enough for white text,
 *  soft enough to sit beside the latte stage tints. */
const PROPERTY_PALETTE = ['#5b8def', '#e07b9a', '#57a773', '#b583d6', '#e0954f', '#4fb3c9', '#8b7ec8', '#d97b6c'];

/** Deterministic palette slot for a value — the same value gets the same
 *  color on every card, every render. */
export function chipColorFor(value: string): string {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return PROPERTY_PALETTE[hash % PROPERTY_PALETTE.length]!;
}

/** Chips shown on a card. With `cardProperties` configured, exactly those
 *  frontmatter keys render (in config order); the default shows the platform
 *  field (accent) plus tags (muted). */
export function cardChips(frontmatter: Record<string, unknown>, cardProperties?: readonly string[]): PipelineChip[] {
	if (cardProperties && cardProperties.length > 0) {
		const out: PipelineChip[] = [];
		for (const key of cardProperties) {
			// One chip per individual value; the property NAME never renders.
			for (const value of splitFieldValues(frontmatter[key])) {
				out.push({ text: value.slice(0, 24), isProperty: true, color: chipColorFor(value) });
			}
		}
		return out.slice(0, 4);
	}
	const out: PipelineChip[] = [];
	for (const value of splitFieldValues(frontmatter['platform']).slice(0, 2)) {
		out.push({ text: value.slice(0, 16), isProperty: true, color: chipColorFor(value) });
	}
	for (const tag of itemTags(frontmatter)) out.push({ text: tag, isProperty: false });
	return out.slice(0, 4);
}

/** Template vars available to a card-scope skill prompt. */
export function cardSkillVars(item: PipelineItem, config: PipelineConfig): Record<string, string> {
	return {
		path: item.file.path,
		title: item.file.basename,
		stage: item.stage.label || item.stage.value,
		folder: normalizeFolderPath(config.rootFolder),
	};
}

/** Template vars for a stage-scope skill (no card context). */
export function stageSkillVars(stage: PipelineStage, config: PipelineConfig): Record<string, string> {
	return {
		path: '',
		title: '',
		stage: stage.label || stage.value,
		folder: normalizeFolderPath(config.rootFolder),
	};
}

/** Seed config for a pipeline section opened for the first time. Labels are
 *  localized by the caller (config modal); the values are stable slugs and
 *  the colors are the 奶泡/Latte low-saturation set (Rae-approved 2026-10-06,
 *  see /tmp/workflow-board-design.html — do not swap back to saturated
 *  Tailwind hues). */
export function defaultPipelineStages(labels: { idea: string; draft: string; review: string; published: string; done: string }): PipelineStage[] {
	return [
		{ value: 'idea', label: labels.idea, color: '#d9a88f', folder: '01-选题' },
		{ value: 'draft', label: labels.draft, color: '#92aec9', folder: '02-草稿' },
		{ value: 'review', label: labels.review, color: '#b5a3d1', folder: '03-待审核' },
		{ value: 'published', label: labels.published, color: '#9dc3a4', folder: '04-已发布' },
		{ value: 'done', label: labels.done, color: '#a9a69c', folder: '05-已复盘' },
	];
}

// ── Card extras: checklist progress, task lines, note-level due ──────────

/** Progress read from the metadata cache alone (no file I/O): listItems'
 * task char is ' ' unchecked / 'x' (or friends) checked. */
export function taskProgress(listItems: Array<{ task?: string }> | undefined | null): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const item of listItems ?? []) {
		if (item.task === undefined) continue;
		total += 1;
		if (item.task !== ' ') done += 1;
	}
	return { done, total };
}

export interface PipelineTask {
	/** 0-based source line. */
	line: number;
	text: string;
	checked: boolean;
	/** `YYYY-MM-DD( HH:MM)` from an inline [due:: …] marker, when present —
	 *  calendar-visible by the existing task-scan conventions. */
	due?: string;
}

const TASK_LINE_RE = /^(\s*)- \[( |x|X)\] (.*)$/;
const INLINE_DUE_RE = /\[due::\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\]/i;

/** Parse a note's checkbox tasks (verbatim lines, markers stripped). */
export function parseTasks(content: string): PipelineTask[] {
	const out: PipelineTask[] = [];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]!.match(TASK_LINE_RE);
		if (!match) continue;
		const due = match[3]!.match(INLINE_DUE_RE)?.[1];
		const text = match[3]!.replace(INLINE_DUE_RE, '').trim();
		out.push({ line: i, text, checked: match[2] !== ' ', ...(due ? { due } : {}) });
	}
	return out;
}

/** Flip one task's checkbox in the file content (line-indexed, so a shifted
 *  file cannot toggle the wrong row). Returns the content unchanged when the
 *  line is no longer a task. */
export function toggleTaskLine(content: string, line: number): string {
	const lines = content.split('\n');
	const target = lines[line];
	if (!target) return content;
	const unchecked = target.replace(/^(\s*)- \[ \]/, '$1- [x]');
	const checked = target.replace(/^(\s*)- \[[xX]\]/, '$1- [ ]');
	if (unchecked !== target) lines[line] = unchecked;
	else if (checked !== target) lines[line] = checked;
	else return content;
	return lines.join('\n');
}

export interface NoteDue {
	/** `YYYY-MM-DD`. */
	date: string;
	/** `HH:MM`, when the value carries a time. */
	time?: string;
	/** Reminder alarm opt-in (frontmatter `remind: true`). */
	remind: boolean;
}

/** Parse a note-level due from frontmatter (`due: YYYY-MM-DD( HH:MM)` +
 *  `remind: true`), the same value shape the [due::] field uses. */
export function parseNoteDue(frontmatter: Record<string, unknown>): NoteDue | null {
	const raw = String(frontmatter['due'] ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?$/.test(raw)) return null;
	const [date, time] = raw.split(/\s+/);
	return {
		date: date!,
		...(time ? { time } : {}),
		remind: frontmatter['remind'] === true,
	};
}

export function formatNoteDue(due: NoteDue): string {
	return due.time ? `${due.date} ${due.time}` : due.date;
}
