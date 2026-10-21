import { t } from './i18n';
import { parseTasks, type PipelineTask } from './pipeline-model';

export interface SchedulePatch { start?: string; end?: string; due?: string; scheduled?: string }
export const SCHEDULE_MARKERS = /\[(?:start|end|due|scheduled)::\s*[^\]]*\]/gi;
export function validStamp(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(value)) return false;
	const day = value.slice(0, 10);
	const parsed = new Date(`${day}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
		&& (value.length === 10 || (Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60));
}
export function shiftDay(day: string, amount: number): string {
	const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + amount);
	return d.toISOString().slice(0, 10) + day.slice(10);
}
export function scheduleRange(task: PipelineTask): { start?: string; end?: string } {
	const start = task.start || task.scheduled;
	return { start, end: task.end };
}
/** Locate by persistent block ID, or exact original row for previously unedited tasks.
 * Stale/ambiguous targets fail closed; never write to a row just because its index matches. */
export function updateSchedule(content: string, task: PipelineTask, patch: SchedulePatch): string {
	const lines = content.split('\n');
	const line = locateScheduleTask(content, task);
	const entry = { line, raw: lines[line]!, task: parseTasks(lines[line]!)[0]! };
	const current = entry.task!;
	assertScheduleFresh(current, task, patch);
	const next = { start: current.start, end: current.end, due: current.deadline, scheduled: current.scheduled, ...patch };
	for (const value of Object.values(next)) if (value && !validStamp(value)) throw new Error(t('gantt.invalid'));
	const start = next.start || next.scheduled;
	if (start && next.end && start > (next.end.length === 10 ? `${next.end} 23:59` : next.end)) throw new Error(t('gantt.invalid'));
	const id = current.id || `apex-${crypto.randomUUID()}`;
	const prefix = entry.raw.replace(SCHEDULE_MARKERS, '').replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').trimEnd();
	const markers = Object.entries(next).filter(([, value]) => value).map(([key, value]) => `[${key}:: ${value}]`).join(' ');
	return lines.map((line, index) => index === entry.line ? `${prefix}${markers ? ` ${markers}` : ''} ^${id}` : line).join('\n');
}

export function locateScheduleTask(content: string, task: PipelineTask): number {
	// Parsed board tasks retain their source line. Prefer that exact row so
	// legacy notes with duplicate task text remain independently editable.
	if (Number.isInteger(task.line)) {
		const lines = content.split('\n');
		const raw = lines[task.line];
		const current = raw ? parseTasks(raw)[0] : undefined;
		if (current && current.text === task.text && current.checked === task.checked
			&& current.start === task.start && current.end === task.end
			&& current.due === task.due && current.scheduled === task.scheduled
			&& (!task.id || current.id === task.id)) return task.line;
	}
	const candidates = parseTasks(content).filter(current => task.id ? current.id === task.id : current.text === task.text
		&& current.checked === task.checked && current.start === task.start && current.end === task.end
		&& current.due === task.due && current.scheduled === task.scheduled);
	if (candidates.length !== 1) throw new Error(t('gantt.stale'));
	return candidates[0]!.line;
}

export function assertScheduleFresh(current: PipelineTask, original: PipelineTask, patch: SchedulePatch): void {
	for (const key of Object.keys(patch) as Array<keyof SchedulePatch>) {
		const field = key === 'due' ? 'deadline' : key;
		if ((current[field] || '') !== (original[field] || '') && (current[field] || '') !== (patch[key] || '')) throw new Error(t('gantt.stale'));
	}
}
