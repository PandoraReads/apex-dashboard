import type { App, CachedMetadata, TFile } from 'obsidian';
import type { PmConfig, PmStage } from './types';
import { isPathInPipelineRoot, normalizeFolderPath, parseTasks, parseNoteDue, chipColorFor, type PipelineTask, type NoteDue } from './pipeline-model';
import { isUnderExcludedFolder, normalizeExcludeFolders } from './exclude-folders';
import { t } from './i18n';

/**
 * PM section core (DOM-free): collecting project notes, deriving card data
 * from frontmatter + the note's two standard body sections, and the body
 * edit helpers the board modal writes through.
 *
 * A project note is any note under the section root whose frontmatter carries
 * `type: project` (case-insensitive) and not `archived: true` — the pipeline
 * section's strict-matching model, so nothing else in the folder boards by
 * accident. Metadata lives in frontmatter (English keys written, Chinese
 * aliases accepted on read); the body's two `## 里程碑` / `## 待办` sections
 * hold the milestone checklist (completion = the card's delivery progress)
 * and the todo checklist ([due:: …] markers make todos calendar-visible by
 * the existing task-scan conventions, no extra wiring).
 */

/** Progress counts for a checklist section (cache-driven, no file reads). */
export interface PmProgress {
	done: number;
	total: number;
}

export interface PmProject {
	file: TFile;
	frontmatter: Record<string, unknown>;
	milestones: PmProgress;
	todos: PmProgress;
}

/** Frontmatter key aliases: English keys are written, Chinese variants are
 *  accepted on read so hand-authored notes work too. */
const PM_FIELD_ALIASES: Record<string, readonly string[]> = {
	intro: ['intro', '一句话', '一句话介绍'],
	stage: ['stage', '阶段', '当前阶段'],
	status: ['status', '状态', '当前状态'],
	client: ['client', '客户'],
	income: ['income', '收入', '金额'],
	keyDate: ['keyDate', '关键日期'],
	cycleStart: ['cycleStart', '开始日期', '周期开始'],
	cycleEnd: ['cycleEnd', '结束日期', '周期结束'],
	nextStep: ['nextStep', '下一步'],
	deliverables: ['deliverables', '交付物', '交付物摘要'],
	payment: ['payment', '尾款', '合同尾款'],
};

/** Read one project field through its alias family. '' when unset. */
export function pmField(frontmatter: Record<string, unknown>, key: keyof typeof PM_FIELD_ALIASES): string {
	for (const alias of PM_FIELD_ALIASES[key]!) {
		const raw = frontmatter[alias];
		if (raw === undefined || raw === null) continue;
		const value = String(raw).trim();
		if (value) return value;
	}
	return '';
}

/** Numeric income through the alias family (NaN-guarded). */
export function pmIncome(frontmatter: Record<string, unknown>): number {
	const raw = pmField(frontmatter, 'income');
	if (!raw) return 0;
	const value = Number(raw.replace(/[¥$,，\s]/g, ''));
	return Number.isFinite(value) ? value : 0;
}

/** The project's key date (`YYYY-MM-DD[ HH:MM]` + remind opt-in), parsed from
 *  the keyDate alias family — same value shape as the pipeline note due. */
export function pmKeyDate(frontmatter: Record<string, unknown>): (NoteDue & { remind: boolean }) | null {
	for (const alias of PM_FIELD_ALIASES.keyDate!) {
		const raw = frontmatter[alias];
		if (raw === undefined || raw === null) continue;
		const probe: Record<string, unknown> = { due: raw, remind: frontmatter['remind'] };
		const parsed = parseNoteDue(probe);
		if (parsed) return parsed;
	}
	return null;
}

export function isKeyDateOverdue(due: NoteDue, now = new Date()): boolean {
	const time = due.time ?? '09:00';
	const [h, m] = time.split(':').map(Number);
	const dueAt = new Date(`${due.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
	return Number.isNaN(dueAt.getTime()) ? false : dueAt.getTime() <= now.getTime();
}

/** Days-until badge text for a key date: "3 天后" / "已逾期 2 天" (day
 *  granularity, absolute value — the countdown a PM scans for). */
export function keyDateCountdown(due: NoteDue, now = new Date()): { text: string; overdue: boolean } | null {
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const target = new Date(`${due.date}T00:00:00`);
	if (Number.isNaN(target.getTime())) return null;
	const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
	if (days === 0) return { text: t('pm.today'), overdue: false };
	if (days < 0) return { text: t('pm.daysOverdue', { n: -days }), overdue: true };
	return { text: t('pm.daysLeft', { n: days }), overdue: false };
}

/** `MM.DD – MM.DD` (+ total days) for the cycle chips; '' when unset. */
export function pmCycleText(frontmatter: Record<string, unknown>): string {
	const start = pmField(frontmatter, 'cycleStart').slice(0, 10);
	const end = pmField(frontmatter, 'cycleEnd').slice(0, 10);
	const fmt = (iso: string): string => (iso.length === 10 ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : '');
	if (!start && !end) return '';
	const startAt = start ? new Date(`${start}T00:00:00`) : null;
	const endAt = end ? new Date(`${end}T00:00:00`) : null;
	let days = '';
	if (startAt && endAt && !Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime())) {
		days = ` · ${Math.round((endAt.getTime() - startAt.getTime()) / 86_400_000) + 1}d`;
	}
	return `${fmt(start) || '—'} – ${fmt(end) || '—'}${days}`;
}

/** Badge color for a stage: its configured color, else the deterministic
 *  chip ramp. */
export function pmStageColor(stages: readonly PmStage[], label: string): string {
	return stages.find(stage => stage.label === label)?.color || chipColorFor(label || '?');
}

const MILESTONE_HEADING_RE = /^(里程碑|milestones?)$/i;
const TODO_HEADING_RE = /^(待办|todos?|任务)$/i;

/** Cache-driven section progress: checkbox items assigned to the last
 *  level-2 heading above them (## 里程碑 / ## 待办). No file reads — the
 *  metadata cache already knows item positions and checked states. */
function sectionProgress(cache: CachedMetadata, headingRe: RegExp): PmProgress {
	const headings = (cache.headings ?? []).filter(h => h.level === 2);
	if (headings.length === 0) return { done: 0, total: 0 };
	let done = 0;
	let total = 0;
	for (const item of cache.listItems ?? []) {
		if (item.task === undefined) continue;
		const line = item.position.start.line;
		let section: string | null = null;
		for (const heading of headings) {
			if (heading.position.start.line < line) section = heading.heading;
			else break;
		}
		if (!section || !headingRe.test(section.trim())) continue;
		total += 1;
		if (item.task !== ' ') done += 1;
	}
	return { done, total };
}

/** Shared scan body: type:project notes under any of `roots`, split by the
 *  archived flag. Cache-driven, no file reads. */
function scanPmProjects(app: App, roots: readonly string[], excludes: readonly string[], wantArchived: boolean): PmProject[] {
	const projects: PmProject[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!roots.some(root => isPathInPipelineRoot(file.path, root))) continue;
		if (isUnderExcludedFolder(file.path, excludes)) continue;
		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) continue;
		if (String(frontmatter['type'] ?? '').trim().toLowerCase() !== 'project') continue;
		if ((frontmatter['archived'] === true) !== wantArchived) continue;
		projects.push({
			file,
			frontmatter,
			milestones: sectionProgress(cache!, MILESTONE_HEADING_RE),
			todos: sectionProgress(cache!, TODO_HEADING_RE),
		});
	}
	return projects;
}

/** Collect the section's live projects. Order: configured stage order first
 *  (unknown stages last), then key date ascending. */
export function collectPmProjects(app: App, config: PmConfig): PmProject[] {
	const root = normalizeFolderPath(config.rootFolder ?? '');
	if (!root) return [];
	const excludes = normalizeExcludeFolders(config.excludeFolders ?? []);
	const projects = scanPmProjects(app, [root], excludes, false);
	const stageOrder = new Map(config.stages.map((stage, index) => [stage.label, index]));
	projects.sort((a, b) => {
		const stageA = stageOrder.get(pmField(a.frontmatter, 'stage')) ?? Number.MAX_SAFE_INTEGER;
		const stageB = stageOrder.get(pmField(b.frontmatter, 'stage')) ?? Number.MAX_SAFE_INTEGER;
		if (stageA !== stageB) return stageA - stageB;
		const dateA = pmField(a.frontmatter, 'keyDate').slice(0, 10);
		const dateB = pmField(b.frontmatter, 'keyDate').slice(0, 10);
		return dateA.localeCompare(dateB);
	});
	return projects;
}


/** Section sort modes beyond the default stage order. */
export type PmSortMode = 'name' | 'milestone' | 'keyDate';

/** Re-sort a collected project list (the collect default is stage→keyDate;
 *  the drag order rides on top of THAT default only). Pure. */
export function sortPmProjects(projects: readonly PmProject[], mode: PmSortMode | undefined): PmProject[] {
	if (!mode) return [...projects];
	const out = [...projects];
	if (mode === 'name') {
		out.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
	} else if (mode === 'milestone') {
		const ratio = (p: PmProject): number => p.milestones.total > 0 ? p.milestones.done / p.milestones.total : -1;
		out.sort((a, b) => ratio(b) - ratio(a) || b.milestones.total - a.milestones.total);
	} else {
		const dateOf = (p: PmProject): string => pmField(p.frontmatter, 'keyDate').slice(0, 10);
		out.sort((a, b) => {
			const da = dateOf(a), db = dateOf(b);
			if (!da && !db) return 0;
			if (!da) return 1;
			if (!db) return -1;
			return da.localeCompare(db);
		});
	}
	return out;
}

/** Group key for the grouped view: the frontmatter `group` field, '' for the
 *  ungrouped bucket. */
export function pmGroupName(frontmatter: Record<string, unknown>): string {
	return String(frontmatter['group'] ?? frontmatter['分组'] ?? '').trim();
}

/** Apply the manual drag order on top of the stage→keyDate sort: known
 *  paths take their saved slots, unknown projects keep the incoming sort
 *  and append after the ordered ones (stable). Pure — tests drive it
 *  directly; an empty/absent order is a no-op. */
export function orderPmProjects(projects: readonly PmProject[], order: readonly string[] | undefined): PmProject[] {
	if (!order || order.length === 0) return [...projects];
	const rank = new Map(order.map((path, index) => [path, index]));
	const known: PmProject[] = [];
	const unknown: PmProject[] = [];
	for (const project of projects) {
		if (rank.has(project.file.path)) known.push(project);
		else unknown.push(project);
	}
	known.sort((a, b) => (rank.get(a.file.path) ?? 0) - (rank.get(b.file.path) ?? 0));
	return [...known, ...unknown];
}

/** Archived projects: scanned across BOTH the root and the archive folder
 *  (archiving may move the note outside the root), newest-touched first.
 *  Their full panel (overview, milestones, todos) stays readable/editable
 *  through the board modal — the flag only removes them from the live
 *  board. */
export function collectArchivedPmProjects(app: App, config: PmConfig): PmProject[] {
	const roots = [config.rootFolder ?? '', config.archiveFolder ?? '']
		.map(folder => normalizeFolderPath(folder))
		.filter(Boolean);
	if (roots.length === 0) return [];
	const excludes = normalizeExcludeFolders(config.excludeFolders ?? []);
	const projects = scanPmProjects(app, roots, excludes, true);
	projects.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
	return projects;
}

/** Sum of non-archived project incomes (the header pill). */
export function sumIncome(projects: readonly PmProject[]): number {
	return projects.reduce((sum, project) => sum + pmIncome(project.frontmatter), 0);
}

/** The note's linked files: frontmatter `files` as a YAML list (or a
 *  legacy comma string) of vault paths. Linking never moves or copies the
 *  file — it is a reference the board resolves and opens. */
export function pmLinkedFiles(frontmatter: Record<string, unknown>): string[] {
	const raw = frontmatter['files'];
	if (Array.isArray(raw)) {
		return raw.map(v => String(v).trim()).filter(Boolean);
	}
	if (typeof raw === 'string' && raw.trim()) {
		return raw.split(/[,，]/).map(v => v.trim()).filter(Boolean);
	}
	return [];
}

/** User-added custom info entries: frontmatter `custom` as a name→value
 *  map (insertion-ordered — the file's YAML order is the display order).
 *  Values are stringified so numbers/dates typed by hand still render. */
export function pmCustomFields(frontmatter: Record<string, unknown>): Array<{ key: string; value: string }> {
	const raw = frontmatter['custom'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
	return Object.entries(raw as Record<string, unknown>)
		.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
		.map(([key, value]) => ({ key, value: String(value).trim() }));
}

/** The per-project work-note folder: `<root>/<project name>/`. The main
 *  note sits BESIDE its folder (pipeline stage-folder convention) — the
 *  scan never depends on the folder, it only holds work notes. */
export function projectFolder(rootFolder: string, projectTitle: string): string {
	return `${normalizeFolderPath(rootFolder)}/${projectTitle.trim().replace(/[/\\?%*:|"<>.]/g, '-')}`;
}

// ── Body section editing (content-driven; the board modal reads once) ──────

export interface PmBodySections {
	milestones: PipelineTask[];
	todos: PipelineTask[];
}

/** Split a note's checkbox tasks into the two standard sections. Line-keyed
 *  (PipelineTask.line) so toggles can use pipeline-model's toggleTaskLine. */
export function parseProjectBody(content: string): PmBodySections {
	const milestones: PipelineTask[] = [];
	const todos: PipelineTask[] = [];
	const lines = content.split('\n');
	let current: 'milestone' | 'todo' | null = null;
	for (let i = 0; i < lines.length; i++) {
		const headingMatch = lines[i]!.match(/^##\s+(.*)$/);
		if (headingMatch) {
			const title = headingMatch[1]!.trim();
			if (MILESTONE_HEADING_RE.test(title)) current = 'milestone';
			else if (TODO_HEADING_RE.test(title)) current = 'todo';
			else current = null;
			continue;
		}
		if (!current) continue;
		const parsed = parseTasks(lines[i]!);
		if (parsed[0]) {
			const task = { ...parsed[0]!, line: i };
			(current === 'milestone' ? milestones : todos).push(task);
		}
	}
	return { milestones, todos };
}

/** Insert `- [ ] text` at the end of a section (creating the section at the
 *  document end when missing). Text goes in verbatim — todos may carry
 *  [due:: …] markers for calendar visibility. Returns the new content. */
export function insertProjectTask(content: string, section: 'milestone' | 'todo', text: string): string {
	const headingTitle = section === 'milestone' ? '## 里程碑' : '## 待办';
	const headingRe = section === 'milestone' ? MILESTONE_HEADING_RE : TODO_HEADING_RE;
	const clean = text.trim();
	if (!clean) return content;
	const lines = content.split('\n');
	let insertAt = -1;
	let inSection = false;
	for (let i = 0; i < lines.length; i++) {
		const headingMatch = lines[i]!.match(/^##\s+(.*)$/);
		if (headingMatch) {
			if (inSection) {
				insertAt = i;
				break;
			}
			inSection = headingRe.test(headingMatch[1]!.trim());
		} else if (inSection && /^(\s*)- \[( |x|X)\] /.test(lines[i]!)) {
			insertAt = i + 1;
		}
	}
	if (!inSection && insertAt === -1) {
		const next = [...lines];
		while (next.length > 0 && next[next.length - 1]!.trim() === '') next.pop();
		if (next.length > 0) next.push('');
		next.push(headingTitle, `- [ ] ${clean}`);
		return next.join('\n');
	}
	if (insertAt === -1) insertAt = lines.length;
	const next = [...lines.slice(0, insertAt), `- [ ] ${clean}`, ...lines.slice(insertAt)];
	return next.join('\n');
}

/** Remove one task line (0-based). Returns the content unchanged when the
 *  line is no longer a task. */
export function removeProjectTask(content: string, line: number): string {
	const lines = content.split('\n');
	const target = lines[line];
	if (!target || !/^(\s*)- \[( |x|X)\] /.test(target)) return content;
	const next = lines.filter((_, index) => index !== line);
	return next.join('\n');
}

/** The standard two-section body written on project creation. */
export function projectBodyTemplate(milestones: readonly string[]): string {
	const parts = ['## 里程碑'];
	for (const name of milestones) {
		const clean = name.trim();
		if (clean) parts.push(`- [ ] ${clean}`);
	}
	parts.push('', '## 待办');
	return parts.join('\n');
}
