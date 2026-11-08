import { App, Notice, setIcon, type TFile } from 'obsidian';
import type { PipelineTask } from './pipeline-model';
import { chipColorFor } from './pipeline-model';
import type { PmStage } from './types';
import type { StageWindow } from './pm-stages';
import { PmScheduleModal, type ScheduleSave } from './pm-schedule-modal';
import { validStamp, scheduleRange, shiftDay } from './pm-schedule';
import { startGuardedDrag } from './drag-guard';
import { t } from './i18n';

export interface GanttRow { task: PipelineTask; milestone: boolean; group?: string; save: ScheduleSave; toggle?: () => Promise<void> }
export interface GanttGroup {
	key: string; title: string; file: TFile; rows: GanttRow[];
	cycleStart?: string; cycleEnd?: string; keyDate?: string;
	/** Current stage label (project notes' `stage` frontmatter) for the rail. */
	stage?: string;
	/** Resolved stage windows (pm-stages) for the stage band row. */
	stageWindows?: StageWindow[];
	onOpen: () => void; onRemove?: () => void; onAdd?: (milestone: boolean) => void;
}
export type GanttScale = 'day' | 'week' | 'month';
export type GanttFilter = 'projects' | 'todos' | 'milestones' | 'all';
const DAY = 86_400_000;
const dayNumber = (value: string): number => Date.parse(`${value.slice(0, 10)}T12:00:00Z`) / DAY;
const weekColor = (value: string): number => {
	const day = dayNumber(value);
	const monday = day - ((new Date(day * DAY).getUTCDay() + 6) % 7);
	return ((Math.floor(monday / 7) % 6) + 6) % 6;
};
export function localToday(now = new Date()): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function renderGanttChart(host: HTMLElement, app: App, groups: GanttGroup[], scale: GanttScale, collapsed: readonly string[], onCollapse: (key: string) => void, filter: GanttFilter = 'all', selectedProjectPath?: string, onKindToggle?: (key: string, filter: GanttFilter) => void, stageList?: readonly PmStage[]): void {
	const visibleGroups = selectedProjectPath ? groups.filter(group => group.key === selectedProjectPath) : groups;
	const today = localToday();
	const stamps = visibleGroups.flatMap(g => [g.cycleStart, g.cycleEnd, g.keyDate, ...g.rows.flatMap(r => [r.task.start, r.task.end, r.task.scheduled, r.task.deadline])]).filter((v): v is string => !!v && validStamp(v));
	const dates = [today, ...stamps].map(dayNumber);
	const origin = Math.min(...dates) - 7;
	const days = Math.max(45, Math.max(...dates) - origin + 15);
	const px = Math.min(scale === 'day' ? 30 : scale === 'week' ? 12 : 4, 60000 / days);
	const width = days * px;
	const labelWidth = host.clientWidth > 0 && host.clientWidth < 500 ? 140 : 220;
	const scroll = host.createDiv({ cls: 'dashboard-gantt-scroll' });
	const canvas = scroll.createDiv({ cls: 'dashboard-gantt-canvas' });
	canvas.style.width = `${width + labelWidth}px`;
	canvas.style.setProperty('--gantt-day', `${px}px`);
	canvas.style.setProperty('--gantt-label', `${labelWidth}px`);
	const head = canvas.createDiv({ cls: 'dashboard-gantt-row dashboard-gantt-axis' });
	head.createDiv({ cls: 'dashboard-gantt-label' });
	const axis = head.createDiv({ cls: 'dashboard-gantt-lane' });
	const x = (date: string): number => (dayNumber(date) - origin) * px;
	const firstMonday = origin - ((new Date(origin * DAY).getUTCDay() + 6) % 7);
	for (let monday = firstMonday; monday < origin + days; monday += 7) {
		const visibleStart = Math.max(monday, origin);
		const visibleEnd = Math.min(monday + 7, origin + days);
		const week = new Date(monday * DAY).toISOString().slice(0, 10);
		const band = axis.createDiv({ cls: `dashboard-gantt-axis-week-band dashboard-gantt-week-${weekColor(week)}` });
		band.style.left = `${(visibleStart - origin) * px}px`;
		band.style.width = `${Math.max(0, (visibleEnd - visibleStart) * px - 2)}px`;
	}
	const step = Math.max(scale === 'day' ? 1 : scale === 'week' ? 7 : 30, Math.ceil(days / 300));
	for (let d = 0; d <= days; d += step) {
		const stamp = new Date((origin + d) * DAY).toISOString().slice(0, 10);
		const label = axis.createSpan({ cls: 'dashboard-gantt-tick', text: stamp.slice(5) });
		label.style.left = `${d * px}px`; label.title = stamp;
	}
	const bar = (lane: HTMLElement, start: string, end: string, cls: string, title: string): HTMLElement => {
		const el = lane.createDiv({ cls: `dashboard-gantt-bar ${cls}`, attr: { title } });
		const first = dayNumber(start);
		const last = dayNumber(end);
		el.style.left = `${x(start)}px`;
		el.style.width = `${Math.max(8, (last - first + 1) * px)}px`;
		for (let cursor = first; cursor <= last;) {
			const mondayOffset = (new Date(cursor * DAY).getUTCDay() + 6) % 7;
			const segmentEnd = Math.min(last, cursor + 6 - mondayOffset);
			const segment = el.createDiv({ cls: `dashboard-gantt-week-segment dashboard-gantt-week-${weekColor(new Date(cursor * DAY).toISOString().slice(0, 10))}` });
			segment.style.left = `${(cursor - first) * px}px`;
			segment.style.width = `${Math.max(2, (segmentEnd - cursor + 1) * px - 2)}px`;
			cursor = segmentEnd + 1;
		}
		return el;
	};
	const marker = (lane: HTMLElement, date: string, cls: string, label: string): HTMLElement => {
		const el = lane.createDiv({ cls: `dashboard-gantt-marker ${cls} dashboard-gantt-week-${weekColor(date)}`, attr: { title: `${label}: ${date}` } });
		el.style.left = `${x(date) + px / 2}px`; return el;
	};
	const edit = (row: GanttRow): void => new PmScheduleModal(app, row.task, row.milestone, row.save).open();
	const drawTask = (lane: HTMLElement, row: GanttRow, compact = false, compactIndex = 0): void => {
		const { task } = row;
		const range = scheduleRange(task);
		const start = range.start && validStamp(range.start) ? range.start : undefined;
		const end = range.end && validStamp(range.end) ? range.end : undefined;
		const deadline = task.deadline && validStamp(task.deadline) ? task.deadline : undefined;
		const title = `${task.text}\n${start || '—'} → ${end || '—'}${deadline ? `\n${t('gantt.due')}: ${deadline}` : ''}`;
		let el: HTMLElement | null = null;
		if (start && end && dayNumber(end) >= dayNumber(start)) {
			el = bar(lane, start, end, `${task.checked ? 'is-done' : ''} ${row.milestone ? 'is-milestone' : ''} ${start.slice(0, 10) <= today && end.slice(0, 10) >= today ? 'is-current' : ''}`, title);
		} else if (start || end || deadline) {
			el = marker(lane, end || start || deadline!, row.milestone ? 'is-milestone' : 'is-partial', title);
		} else if (!compact) lane.createSpan({ cls: 'dashboard-gantt-unscheduled', text: t('gantt.unscheduled') });
		if (deadline && deadline !== end) marker(lane, deadline, 'is-deadline', t('gantt.due'));
		if (!el) return;
		if (compact) { el.setCssProps({ top: `${8 + (compactIndex % 10) * 5}px`, height: '4px', pointerEvents: 'none' }); return; }
		el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', title);
		el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(row); } });
		if (task.checked) el.addClass('is-done');
		const drag = (e: PointerEvent, edge?: 'start' | 'end'): void => {
			if (e.button !== 0) return;
			const press = e.clientX;
			let delta = 0;
			startGuardedDrag(e, {
				cursor: edge ? 'ew-resize' : 'grabbing',
				onCancel: () => { el.setCssProps({ transform: '' }); },
				onMove: ev => { delta = Math.round((ev.clientX - press) / px); el.setCssProps({ transform: `translateX(${delta * px}px)` }); },
				onUp: () => {
					el.setCssProps({ transform: '' });
					if (!delta) { if (!edge) edit(row); return; }
					const patch = start && end ? edge === 'start' ? { start: shiftDay(start, delta) } : edge === 'end' ? { end: shiftDay(end, delta) }
						: { start: shiftDay(start, delta), end: shiftDay(end, delta) }
						: end ? { end: shiftDay(end, delta) } : task.start ? { start: shiftDay(task.start, delta) } : task.scheduled ? { scheduled: shiftDay(task.scheduled, delta) } : { due: shiftDay(deadline!, delta) };
					void row.save(patch).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
				},
			});
		};
		el.addEventListener('pointerdown', e => drag(e));
		if (start && end) for (const edge of ['start', 'end'] as const) {
			const handle = el.createDiv({ cls: `dashboard-gantt-edge dashboard-gantt-edge--${edge}` });
			handle.addEventListener('pointerdown', e => { e.stopPropagation(); drag(e, edge); });
		}
	};
	// ── Stage-band focus (transient, in-DOM only) ────────────────────────────
	// Clicking a stage segment centers that window and pops the stage's rows
	// (is-stage-hit) while dimming this project's other grouped rows
	// (is-stage-dim). Nothing persists; any click outside a segment clears.
	let stageTouched: HTMLElement[] = [];
	let stageFocusSeg: HTMLElement | null = null;
	const clearStageFocus = (): void => {
		for (const el of stageTouched) { el.classList.remove('is-stage-hit'); el.classList.remove('is-stage-dim'); }
		stageTouched = [];
		if (stageFocusSeg) stageFocusSeg.classList.remove('is-focus');
		stageFocusSeg = null;
	};
	scroll.addEventListener('click', ev => {
		const target = ev.target as HTMLElement | null;
		if (target && typeof target.closest === 'function' && target.closest('.dashboard-gantt-stage-seg')) return;
		clearStageFocus();
	});
	const focusStage = (seg: HTMLElement, stageRow: HTMLElement, label: string, centerX: number): void => {
		clearStageFocus();
		stageFocusSeg = seg;
		seg.classList.add('is-focus');
		const view = scroll.clientWidth || 0;
		scroll.scrollLeft = Math.max(0, centerX - view / 2);
		const siblings = Array.from((stageRow.parentElement?.children ?? []) as HTMLElement[]);
		for (let i = siblings.indexOf(stageRow) + 1; i < siblings.length; i++) {
			const node = siblings[i]!;
			if (node.classList.contains('dashboard-gantt-project')) break;
			if (!node.classList.contains('dashboard-gantt-row')) continue;
			// Empty/absent data-group both mean "not stage-tagged" (mini-dom
			// reads missing dataset keys as '' — keep both environments equal).
			const groupTag = node.dataset.group;
			if (!groupTag) continue;
			node.classList.add(groupTag === label ? 'is-stage-hit' : 'is-stage-dim');
			stageTouched.push(node);
		}
	};
	for (const group of visibleGroups) {
		const todoRows = group.rows.filter(row => !row.milestone);
		const milestoneRows = group.rows.filter(row => row.milestone);
		const visibleRows = filter === 'todos' ? todoRows : filter === 'milestones' ? milestoneRows : group.rows;
		const folded = collapsed.includes(group.key);
		const row = canvas.createDiv({ cls: 'dashboard-gantt-row dashboard-gantt-project' });
		const label = row.createDiv({ cls: 'dashboard-gantt-label dashboard-gantt-project-nav' });
		const titleRow = label.createDiv({ cls: 'dashboard-gantt-project-title-row' });
		const toggle = titleRow.createEl('button', { cls: 'dashboard-gantt-project-collapse', text: folded ? '▸' : '▾', attr: { 'aria-label': t('gantt.collapse'), 'aria-expanded': String(!folded) } });
		toggle.addEventListener('click', () => onCollapse(group.key));
		const name = titleRow.createEl('button', { cls: 'dashboard-gantt-project-name', text: group.title, attr: { title: group.title } });
		name.addEventListener('click', group.onOpen);
		if (group.onRemove) {
			const remove = titleRow.createEl('button', { cls: 'dashboard-gantt-remove-source', text: '×', attr: { type: 'button', 'aria-label': t('gantt.removeSource'), title: t('gantt.removeSource') } });
			remove.addEventListener('click', group.onRemove);
		}
		const kinds = label.createDiv({ cls: 'dashboard-gantt-project-kinds' });
		for (const kind of [
			{ milestone: true, title: t('pm.board.milestones'), rows: milestoneRows, filter: 'milestones' as const },
			{ milestone: false, title: t('pm.board.todos'), rows: todoRows, filter: 'todos' as const },
		]) {
			const openKey = `gantt-open::${group.key}::${kind.filter}`;
			const open = filter === kind.filter || (filter === 'all' && collapsed.includes(openKey));
			const card = kinds.createDiv({ cls: `dashboard-gantt-kind-card${open ? ' is-open' : ''}` });
			const kindToggle = card.createEl('button', { cls: 'dashboard-gantt-kind-toggle', attr: { type: 'button', 'aria-expanded': String(open) } });
			kindToggle.createSpan({ text: kind.title });
			kindToggle.createSpan({ cls: 'dashboard-gantt-kind-count', text: String(kind.rows.length) });
			kindToggle.addEventListener('click', () => onKindToggle?.(openKey, kind.filter));
			if (group.onAdd) {
				const add = card.createEl('button', { cls: 'dashboard-gantt-kind-add', attr: { type: 'button', 'aria-label': t(kind.milestone ? 'pm.addMilestone' : 'pm.addTodo'), title: t(kind.milestone ? 'pm.addMilestone' : 'pm.addTodo') } });
				setIcon(add, 'plus');
				add.addEventListener('click', () => group.onAdd!(kind.milestone));
			}
		}
		// Stage rail: all configured stages in order, filled up to the current
		// one — a five-second "where is this project" read in the label column.
		if (stageList?.length && (group.stage || (group.stageWindows?.length ?? 0) > 0)) {
			const stageIdx = stageList.findIndex(stage => stage.label === group.stage);
			const rail = label.createDiv({ cls: 'dashboard-gantt-stage-rail' });
			for (const [i, stage] of stageList.entries()) {
				const win = group.stageWindows?.find(w => w.label === stage.label);
				const cls = `dashboard-gantt-stage-rail-seg${i < stageIdx ? ' is-past' : i === stageIdx ? ' is-now' : ''}`;
				const title = `${stage.label}${win?.start || win?.end ? ` · ${win.start || '—'} → ${win.end || '—'}${win.source === 'derived' ? ` (${t('gantt.derivedTag')})` : ''}` : ''}`;
				const seg = rail.createDiv({ cls, text: stage.label, attr: { title } });
				seg.style.setProperty('--stage-color', stage.color || chipColorFor(stage.label));
			}
		}
		const lane = row.createDiv({ cls: 'dashboard-gantt-lane' });
		if (filter === 'projects' || filter === 'all') {
			if (group.cycleStart && group.cycleEnd && validStamp(group.cycleStart) && validStamp(group.cycleEnd)) bar(lane, group.cycleStart, group.cycleEnd, 'is-cycle', `${group.cycleStart} → ${group.cycleEnd}`);
			const bounds = visibleRows.flatMap(r => [r.task.start || r.task.scheduled, r.task.end]).filter((v): v is string => !!v && validStamp(v)).sort();
			if (bounds.length) bar(lane, bounds[0]!, bounds[bounds.length - 1]!, 'is-summary', group.title);
			if (group.keyDate && validStamp(group.keyDate)) marker(lane, group.keyDate, 'is-milestone', group.title);
		}
		// Stage band: one segment per resolved stage window (pm-stages), under
		// the project row. Projects/all filters only — todos/milestones views
		// are about tasks, not the lifecycle. Click a segment to locate it.
		const stageWindows = group.stageWindows ?? [];
		if (stageList?.length && stageWindows.length > 0 && (filter === 'projects' || filter === 'all')) {
			const stageRow = canvas.createDiv({ cls: 'dashboard-gantt-row dashboard-gantt-stagerow' });
			const stageLabel = stageRow.createDiv({ cls: 'dashboard-gantt-label dashboard-gantt-stagelabel' });
			stageLabel.createSpan({ text: t('gantt.stageBand') });
			if (stageWindows.some(win => win.source === 'derived')) stageLabel.createSpan({ cls: 'dashboard-gantt-stagelabel-hint', text: `· ${t('gantt.derivedTag')}` });
			const stageLane = stageRow.createDiv({ cls: 'dashboard-gantt-lane' });
			for (const win of stageWindows) {
				const from = win.start ?? win.end;
				if (!from) continue;
				const daySpan = win.start && win.end ? Math.max(0, dayNumber(win.end) - dayNumber(win.start)) : 0;
				const width = Math.max(14, (daySpan + 1) * px);
				const seg = stageLane.createDiv({ cls: `dashboard-gantt-stage-seg${win.source === 'derived' ? ' is-derived' : ''}` });
				seg.style.left = `${x(from)}px`;
				seg.style.width = `${width}px`;
				seg.style.setProperty('--stage-color', stageList.find(stage => stage.label === win.label)?.color || chipColorFor(win.label));
				seg.createSpan({ cls: 'dashboard-gantt-stage-seg-label', text: win.label });
				seg.title = `${win.label}: ${win.start || '—'} → ${win.end || '—'}${win.source === 'derived' ? ` · ${t('gantt.derivedTag')}` : ''}`;
				seg.addEventListener('click', () => {
					if (seg.classList.contains('is-focus')) { clearStageFocus(); return; }
					focusStage(seg, stageRow, win.label, x(from) + width / 2);
				});
			}
		}
		if (filter === 'projects') continue;
		if (folded) {
			row.style.minHeight = `${Math.max(66, Math.min(10, visibleRows.length) * 5 + 20)}px`;
			visibleRows.forEach((task, index) => drawTask(lane, task, true, index));
		} else {
			const categories = [
				{ milestone: true, title: t('pm.board.milestones'), rows: milestoneRows, filter: 'milestones' as const },
				{ milestone: false, title: t('pm.board.todos'), rows: todoRows, filter: 'todos' as const },
			];
			for (const category of categories) {
				const isOpen = category.filter === filter || (filter === 'all' && collapsed.includes(`gantt-open::${group.key}::${category.filter}`));
				if (!isOpen || (filter !== 'all' && filter !== category.filter)) continue;
				const categoryRows = filter === 'all' ? category.rows : visibleRows;
			const buckets = new Map<string, GanttRow[]>();
			for (const task of categoryRows) {
				const name = task.group || category.title;
				buckets.set(name, [...(buckets.get(name) || []), task]);
			}
			for (const [name, members] of buckets) {
				const key = `${group.key}::${category.filter}::${name}`;
				const folded = collapsed.includes(key);
				const hasCustomGroup = members.some(member => member.group?.trim());
				if (hasCustomGroup) {
					const header = canvas.createDiv({ cls: 'dashboard-gantt-row dashboard-gantt-subgroup' });
					header.dataset.group = name;
					const button = header.createEl('button', { cls: 'dashboard-gantt-label', text: `${folded ? '▸' : '▾'} ${name} (${members.length})`, attr: { 'aria-expanded': String(!folded) } });
					button.addEventListener('click', () => onCollapse(key));
					const lane = header.createDiv({ cls: 'dashboard-gantt-lane' });
					members.forEach((member, index) => drawTask(lane, member, true, index));
					header.style.minHeight = `${Math.max(38, Math.min(10, members.length) * 5 + 20)}px`;
					if (folded) continue;
				}
				for (const task of members) {
			const taskRow = canvas.createDiv({ cls: 'dashboard-gantt-row' });
					if (task.group) taskRow.dataset.group = task.group;
					const label = taskRow.createDiv({ cls: 'dashboard-gantt-label dashboard-gantt-task-label' });
					if (task.milestone) {
						const icon = label.createSpan({ cls: 'dashboard-gantt-milestone-icon' });
						setIcon(icon, 'flag');
					} else {
						const checkbox = label.createEl('input', { cls: 'dashboard-gantt-task-checkbox', attr: { type: 'checkbox', 'aria-label': `${t('pm.board.todos')}: ${task.task.text}` } });
						checkbox.checked = task.task.checked;
					}
					const nameButton = label.createEl('button', { cls: `dashboard-gantt-task ${task.task.checked ? 'is-done' : ''}`, text: task.task.text });
					const checkbox = label.querySelector<HTMLInputElement>('.dashboard-gantt-task-checkbox');
					checkbox?.addEventListener('change', () => {
						if (!task.toggle) { checkbox.checked = task.task.checked; return; }
						checkbox.disabled = true;
						nameButton.toggleClass('is-done', checkbox.checked);
						void task.toggle().catch((error: unknown) => {
							checkbox.checked = task.task.checked;
							nameButton.toggleClass('is-done', checkbox.checked);
							new Notice(error instanceof Error ? error.message : String(error));
						}).finally(() => { checkbox.disabled = false; });
					});
					nameButton.addEventListener('click', () => edit(task));
			const track = taskRow.createDiv({ cls: 'dashboard-gantt-lane' });
			drawTask(track, task);
			if (group.cycleStart && group.cycleEnd && ((task.task.start && task.task.start < group.cycleStart) || (task.task.end && task.task.end.slice(0, 10) > group.cycleEnd.slice(0, 10)))) {
						nameButton.title = t('gantt.overrun'); nameButton.addClass('is-overrun');
			}
		}
			}
			}
		}
	}
	if (!visibleGroups.length) canvas.createDiv({ text: t('gantt.empty') });
	const todayLine = canvas.createDiv({ cls: 'dashboard-gantt-today', attr: { title: today } });
	todayLine.style.left = `${labelWidth + x(today) + px / 2}px`;
	scroll.scrollLeft = Math.max(0, x(today) - 100);
	host.addEventListener('dashboard-gantt-today', () => { scroll.scrollLeft = Math.max(0, x(today) - 100); });
}
