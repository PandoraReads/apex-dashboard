import type { PipelineTask } from './pipeline-model';
import { validStamp, assertScheduleFresh, type SchedulePatch } from './pm-schedule';
import { t } from './i18n';

export interface GanttTask extends PipelineTask { kind: 'task' | 'milestone'; group?: string }
export interface GanttBlock { id: string; title: string; tasks: GanttTask[]; from: number; to: number; raw: Record<string, unknown> }
const BLOCK = /^```apex-gantt[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?=\r?$)/gm;
function invalid(): never { throw new Error(t('gantt.invalid')); }
export function parseGanttBlocks(content: string): GanttBlock[] {
	const ids = new Set<string>();
	return [...content.matchAll(BLOCK)].map(match => {
		let raw: Record<string, unknown>;
		try { raw = JSON.parse(match[1]!) as Record<string, unknown>; } catch { return invalid(); }
		if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw.id) || ids.has(raw.id) || !Array.isArray(raw.tasks)) return invalid();
		ids.add(raw.id);
		const taskIds = new Set<string>();
		const tasks = raw.tasks.map((value: unknown, line): GanttTask => {
			if (!value || typeof value !== 'object') return invalid();
			const task = value as Record<string, unknown>;
			if (typeof task.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(task.id) || taskIds.has(task.id) || typeof task.text !== 'string' || !task.text.trim()) return invalid();
			taskIds.add(task.id);
			for (const key of ['start', 'end', 'due', 'scheduled']) if (task[key] !== undefined && (typeof task[key] !== 'string' || (task[key] && !validStamp(task[key] as string)))) return invalid();
			const start = String(task.start || task.scheduled || '');
			if (start && task.end && start > `${task.end}${String(task.end).length === 10 ? ' 23:59' : ''}`) return invalid();
			return { line, id: task.id, text: task.text, checked: task.checked === true, kind: task.kind === 'milestone' ? 'milestone' : 'task',
				...(typeof task.group === 'string' ? { group: task.group } : {}),
				...(task.start ? { start: String(task.start) } : {}), ...(task.end ? { end: String(task.end) } : {}),
				...(task.scheduled ? { scheduled: String(task.scheduled) } : {}),
				...(task.due ? { deadline: String(task.due), due: String(task.due) } : {}) };
		});
		return { id: raw.id, title: typeof raw.title === 'string' ? raw.title : raw.id, tasks, from: match.index!, to: match.index! + match[0].length, raw };
	});
}
export function updateGanttBlock(content: string, chartId: string, taskId: string, patch: SchedulePatch, original?: PipelineTask): string {
	const block = parseGanttBlocks(content).find(b => b.id === chartId);
	if (!block || !block.tasks.some(task => task.id === taskId)) return invalid();
	if (original) assertScheduleFresh(block.tasks.find(task => task.id === taskId)!, original, patch);
	const rawTasks = block.raw.tasks as Record<string, unknown>[];
	const updated = { ...block.raw, tasks: rawTasks.map(task => task.id === taskId ? { ...task, ...patch } : task) };
	const replacement = '```apex-gantt\n' + JSON.stringify(updated, null, 2) + '\n```';
	parseGanttBlocks(replacement);
	return content.slice(0, block.from) + replacement + content.slice(block.to);
}
export type GanttTemplate = 'blank' | 'project';
export function newGanttSource(title: string, template: GanttTemplate = 'blank'): string {
	const tasks = template === 'project' ? [
		{ id: 'scope', text: '需求梳理', kind: 'task', group: '准备', checked: false },
		{ id: 'plan-approved', text: '方案确认', kind: 'milestone', group: '准备', checked: false },
		{ id: 'implementation', text: '主要功能开发', kind: 'task', group: '执行', checked: false },
		{ id: 'stage-review', text: '阶段验收', kind: 'milestone', group: '执行', checked: false },
		{ id: 'verification', text: '测试与问题修复', kind: 'task', group: '验收', checked: false },
		{ id: 'release', text: '正式发布', kind: 'milestone', group: '发布', checked: false },
	] : [];
	return '```apex-gantt\n' + JSON.stringify({ id: `chart-${crypto.randomUUID()}`, title, tasks }, null, 2) + '\n```\n';
}

function rewriteBlock(content: string, chartId: string, transform: (tasks: Record<string, unknown>[]) => Record<string, unknown>[]): string {
	const block = parseGanttBlocks(content).find(b => b.id === chartId);
	if (!block) return invalid();
	const raw = { ...block.raw, tasks: transform(block.raw.tasks as Record<string, unknown>[]) };
	const replacement = '```apex-gantt\n' + JSON.stringify(raw, null, 2) + '\n```';
	parseGanttBlocks(replacement);
	return content.slice(0, block.from) + replacement + content.slice(block.to);
}
export function addGanttTask(content: string, chartId: string, text: string, milestone: boolean): string {
	return rewriteBlock(content, chartId, tasks => [...tasks, { id: `task-${crypto.randomUUID()}`, text: text.trim(), kind: milestone ? 'milestone' : 'task', checked: false }]);
}
export function editGanttTask(content: string, chartId: string, id: string, patch: { text?: string; checked?: boolean; group?: string }): string {
	return rewriteBlock(content, chartId, tasks => {
		if (!tasks.some(task => task.id === id)) return invalid();
		return tasks.map(task => task.id === id ? { ...task, ...patch } : task);
	});
}
export function removeGanttTask(content: string, chartId: string, id: string): string {
	return rewriteBlock(content, chartId, tasks => {
		if (!tasks.some(task => task.id === id)) return invalid();
		return tasks.filter(task => task.id !== id);
	});
}
