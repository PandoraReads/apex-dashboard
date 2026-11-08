import type { PmStage } from './types';
import type { PipelineTask } from './pipeline-model';
import { shiftDay, validStamp } from './pm-schedule';

/**
 * Gantt five-stage location, data layer (DOM-free).
 *
 * Each configured stage (cfg.stages — the board's stage list) can carry a
 * TIME WINDOW on a project's gantt lane. Where the window comes from, per
 * stage and in this priority:
 *
 *  1. `tasks`   — the project's checklist tasks tagged `[group:: <stage>]`
 *                 (pipeline-model parseTasks) with real dates; the window is
 *                 the min start .. max end of that stage's tasks.
 *  2. `plan`    — the note's explicit `stagePlan` frontmatter (alias
 *                 阶段计划): `<stage>: {start: …, end: …}` per stage.
 *  3. `derived` — a weighted split of the note's `cycleStart`..`cycleEnd`
 *                 (five stages split 15/15/40/15/15; any other count splits
 *                 evenly). An ESTIMATE, rendered with the derived styling.
 *  4. none      — no window; the project keeps its stage rail only.
 *
 * The resolver is a pure function: frontmatter + tasks + stage list in,
 * windows out — tests drive it directly.
 */

export type StageWindowSource = 'tasks' | 'plan' | 'derived';

export interface StageWindow {
	label: string;
	/** `YYYY-MM-DD`; day granularity — bands sit on the day grid. */
	start?: string;
	end?: string;
	source: StageWindowSource;
}

export interface StagePlanEntry {
	start?: string;
	end?: string;
}

/** Percent weights for the five-stage method (需求/方案/开发/SIT/UAT): the
 *  build phase takes the lion's share. Sums to 100. */
export const FIVE_STAGE_WEIGHTS = [15, 15, 40, 15, 15];

/** The five-stage preset (需求/方案/开发/SIT/UAT) the config modal applies in
 *  one click. Labels are canonical Chinese — stage labels are persisted user
 *  data and must not shift with the UI locale. */
export const FIVE_STAGE_PRESET: readonly PmStage[] = [
	{ label: '需求', color: '#4f8cff' },
	{ label: '方案', color: '#9d7bff' },
	{ label: '开发', color: '#2fb380' },
	{ label: 'SIT', color: '#e0a13c' },
	{ label: 'UAT', color: '#e06c75' },
];

/** A task's own window on the day grid: earliest anchor .. latest anchor.
 *  Anchors are the schedule stamps the gantt already draws (start/scheduled
 *  open; end/deadline/due close). */
function taskDayRange(task: PipelineTask): { start?: string; end?: string } {
	const open = [task.start, task.scheduled, task.due].find((v): v is string => !!v && validStamp(v));
	const close = [task.end, task.deadline, task.due].find((v): v is string => !!v && validStamp(v));
	const day = (v: string): string => v.slice(0, 10);
	return { start: open ? day(open) : undefined, end: close ? day(close) : undefined };
}

/** Parse the `stagePlan` frontmatter (alias 阶段计划). Accepts the map form
 *  (`需求: {start: 2026-10-01, end: 2026-10-09}`) and the compact string form
 *  (`需求: 2026-10-01..2026-10-09`, single date = start-only). Invalid dates
 *  drop silently — a typo must not blank the whole plan. */
export function pmStagePlan(frontmatter: Record<string, unknown>): Record<string, StagePlanEntry> {
	const raw = frontmatter['stagePlan'] ?? frontmatter['阶段计划'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, StagePlanEntry> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const label = key.trim();
		if (!label) continue;
		const day = (v: unknown): string | undefined =>
			typeof v === 'string' && validStamp(v) ? v.slice(0, 10) : undefined;
		let start: string | undefined;
		let end: string | undefined;
		if (typeof value === 'string') {
			const [a, b] = value.split('..', 2).map(part => part.trim());
			start = day(a);
			end = day(b);
		} else if (value && typeof value === 'object') {
			const rec = value as Record<string, unknown>;
			start = day(rec['start']);
			end = day(rec['end']);
		}
		if (start || end) out[label] = { ...(start ? { start } : {}), ...(end ? { end } : {}) };
	}
	return out;
}

/** Day offset between two ISO days (b - a). */
function dayDiff(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Split `cycleStart`..`cycleEnd` into one window per stage by weight.
 *  Cumulative-percentage boundaries spread rounding drift evenly and never
 *  open gaps between neighbours; short cycles yield single-day windows
 *  clipped at the cycle end — stages that no longer fit get nothing. */
function deriveFromCycle(stages: readonly PmStage[], cycleStart: string, cycleEnd: string): StageWindow[] {
	const total = Math.max(1, dayDiff(cycleStart, cycleEnd) + 1);
	const weights = stages.length === FIVE_STAGE_WEIGHTS.length
		? FIVE_STAGE_WEIGHTS
		: stages.map(() => Math.round(100 / Math.max(1, stages.length)));
	const out: StageWindow[] = [];
	let prevBoundary = 0;
	for (let i = 0; i < stages.length; i++) {
		const boundary = i === stages.length - 1 ? total : Math.round(total * weights.slice(0, i + 1).reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0));
		const from = prevBoundary;
		const to = Math.min(total - 1, boundary - 1);
		prevBoundary = boundary;
		if (from > total - 1) break;
		out.push({ label: stages[i]!.label, start: shiftDay(cycleStart, from), end: shiftDay(cycleStart, Math.max(from, to)), source: 'derived' });
	}
	return out;
}

/** Resolve every stage's window, in stage order, keeping only stages that
 *  resolved to at least one date (the rail covers all stages regardless).
 *  Stage labels are matched exactly — a `[group:: 联调]` that names no stage
 *  contributes nothing here; it stays a plain task grouping in the gantt. */
export function resolveStageWindows(
	input: { frontmatter: Record<string, unknown>; tasks: readonly PipelineTask[] },
	stages: readonly PmStage[],
): StageWindow[] {
	const plan = pmStagePlan(input.frontmatter);
	// Stage-grouped task spans: min open .. max close per stage label.
	const spans = new Map<string, { start?: string; end?: string }>();
	for (const task of input.tasks) {
		const group = task.group?.trim();
		if (!group || !stages.some(stage => stage.label === group)) continue;
		const range = taskDayRange(task);
		if (!range.start && !range.end) continue;
		const known = spans.get(group);
		spans.set(group, {
			start: [known?.start, range.start].filter(Boolean).sort()[0],
			end: [known?.end, range.end].filter(Boolean).sort().at(-1),
		});
	}
	const cycleStart = typeof input.frontmatter['cycleStart'] === 'string' && validStamp(String(input.frontmatter['cycleStart']))
		? String(input.frontmatter['cycleStart']).slice(0, 10) : undefined;
	const cycleEnd = typeof input.frontmatter['cycleEnd'] === 'string' && validStamp(String(input.frontmatter['cycleEnd']))
		? String(input.frontmatter['cycleEnd']).slice(0, 10) : undefined;
	const derived = new Map(
		(cycleStart && cycleEnd && cycleStart <= cycleEnd ? deriveFromCycle(stages, cycleStart, cycleEnd) : [])
			.map(window => [window.label, window]),
	);
	const windows: StageWindow[] = [];
	for (const stage of stages) {
		const fromTasks = spans.get(stage.label);
		if (fromTasks) { windows.push({ label: stage.label, ...fromTasks, source: 'tasks' }); continue; }
		const entry = plan[stage.label];
		if (entry && (entry.start || entry.end)) { windows.push({ label: stage.label, ...entry, source: 'plan' }); continue; }
		const fallback = derived.get(stage.label);
		if (fallback) windows.push(fallback);
	}
	return windows;
}
