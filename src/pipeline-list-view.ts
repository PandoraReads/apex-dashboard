import { App, HoverParent, Menu, setIcon } from 'obsidian';
import type { DashboardColumn, PipelineConfig, RenderCallbacks } from './types';
import { t } from './i18n';
import {
	actionCurrentValue,
	cardSkillVars,
	fieldAliasValues,
	formatNoteDue,
	normalizePipelineActions,
	parseNoteDue,
	PLATFORM_FIELD_KEYS,
	skillColorFor,
	type PipelineBoardModel,
	type PipelineItem,
} from './pipeline-model';
import { applyPipelineAction, archivePipelineItem, deletePipelineItem, dispatchSkill } from './pipeline-section';

/**
 * List view of the pipeline (2026-11, Rae's spec): every filtered card as one
 * row for scanning fields and firing buttons. NEXT TO the title — not at the
 * row's end — sit the card's buttons in two separated groups: the configured
 * agent skills (colored, one click dispatches) and the custom action buttons
 * (one click opens that action's own value menu). No ⋯ indirection: every
 * configured button is directly clickable in the row.
 */

/** Rows rendered before the load-more pill (library progressive idiom). */
export const PIPELINE_LIST_PAGE_SIZE = 50;

/** Rendered page size per section (runtime, not persisted). */
const listPages = new Map<string, number>();

export function renderPipelineListView(
	host: HTMLElement,
	column: DashboardColumn,
	model: PipelineBoardModel,
	app: App,
	callbacks: RenderCallbacks,
	_hoverParent: HoverParent | null,
): void {
	const cfg = column.pipelineConfig as PipelineConfig;
	const rows: PipelineItem[] = [];
	for (const stage of cfg.stages) {
		rows.push(...(model.byStage.get(stage.value) ?? []));
	}

	if (rows.length === 0) {
		host.createDiv({ cls: 'dashboard-pipeline-list-empty', text: t('pipeline.list.empty') });
		return;
	}

	const wrap = host.createDiv({ cls: 'dashboard-pipeline-list-wrap' });
	const table = wrap.createEl('table', { cls: 'dashboard-pipeline-list' });
	const thead = table.createEl('thead');
	const headRow = thead.createEl('tr');
	for (const key of ['title', 'buttons', 'platform', 'stage', 'due', 'mtime'] as const) {
		headRow.createEl('th', {
			cls: key === 'title' || key === 'buttons' ? `dashboard-pipeline-list-th--${key}` : undefined,
			text: t(`pipeline.list.col.${key}`),
		});
	}

	const tbody = table.createEl('tbody');
	const limit = listPages.get(column.name) ?? PIPELINE_LIST_PAGE_SIZE;
	for (const item of rows.slice(0, limit)) {
		renderListRow(tbody, item, cfg, app, callbacks);
	}
	if (rows.length > limit) {
		const more = wrap.createDiv({
			cls: 'dashboard-library-load-more dashboard-pipeline-load-more',
			text: t('library.showMore', { count: rows.length - limit }),
		});
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			listPages.set(column.name, limit + PIPELINE_LIST_PAGE_SIZE);
			more.dispatchEvent(new CustomEvent('dashboard-pipeline-refresh', { detail: { columnName: column.name }, bubbles: true }));
		});
	}
}

function renderListRow(
	tbody: HTMLElement,
	item: PipelineItem,
	cfg: PipelineConfig,
	app: App,
	callbacks: RenderCallbacks,
): void {
	const tr = tbody.createEl('tr', { attr: { 'data-path': item.file.path } });

	// Title: PLAIN TEXT (a div carrying role=button — the card-title idiom),
	// never a <button>: Obsidian's global button chrome (background, border,
	// shadow) fought the transparent look no matter how it was reset (Rae,
	// 2026-11-16 round five). Click opens the note.
	const titleTd = tr.createEl('td', { cls: 'dashboard-pipeline-list-title' });
	const titleBtn = titleTd.createDiv({ cls: 'dashboard-pipeline-list-title-btn' });
	titleBtn.setAttribute('role', 'button');
	titleBtn.setAttribute('tabindex', '0');
	titleBtn.setAttribute('aria-label', item.file.basename);
	titleBtn.setText(item.file.basename);
	titleBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onOpenNoteInPopover(item.file);
	});

	// Buttons, RIGHT OF the title — two groups: skills, then actions.
	const buttonsTd = tr.createEl('td', { cls: 'dashboard-pipeline-list-buttons' });
	const skills = cfg.skills.filter(skill => skill.stage === item.stage.value && skill.scope === 'card');
	if (skills.length > 0) {
		const skillGroup = buttonsTd.createDiv({ cls: 'dashboard-pipeline-list-btn-group dashboard-pipeline-list-btn-group--skills' });
		for (const skill of skills) {
			const btn = skillGroup.createEl('button', {
				cls: 'dashboard-pipeline-skill-btn dashboard-pipeline-skill-btn--colored',
				attr: { type: 'button', 'aria-label': skill.label, title: skill.label, 'data-skill-id': skill.id },
			});
			setIcon(btn, skill.icon || 'sparkles');
			btn.style.setProperty('background', skillColorFor(skill.label.trim() || skill.skillName.trim() || 'skill'));
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				dispatchSkill(app, skill, cardSkillVars(item, cfg), cfg);
			});
		}
	}
	const actions = normalizePipelineActions(cfg.actions);
	{
		const actionGroup = buttonsTd.createDiv({ cls: 'dashboard-pipeline-list-btn-group dashboard-pipeline-list-btn-group--actions' });
		for (const action of actions) {
			const btn = actionGroup.createEl('button', {
				cls: 'dashboard-pipeline-list-action-btn',
				attr: { type: 'button', 'aria-label': action.label, title: action.label },
			});
			setIcon(btn, action.icon || 'square-pen');
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				openActionValueMenu(btn, item, action, app);
			});
		}
		// Built-ins after the configured actions (Rae, 2026-11-16): archive
		// and delete ride in the same 操作 group — same one-click directness,
		// same ghost styling as the card corner tools.
		const archiveBtn = actionGroup.createEl('button', {
			cls: 'dashboard-pipeline-list-action-btn',
			attr: { type: 'button', 'aria-label': t('pipeline.archive'), title: t('pipeline.archiveHint') },
		});
		setIcon(archiveBtn, 'archive');
		archiveBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			void archivePipelineItem(app, item, cfg);
		});
		const deleteBtn = actionGroup.createEl('button', {
			cls: 'dashboard-pipeline-list-action-btn',
			attr: { type: 'button', 'aria-label': t('pipeline.deleteItem'), title: t('pipeline.deleteItem') },
		});
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			void deletePipelineItem(app, item);
		});
	}

	const fm = item.frontmatter;
	tr.createEl('td', { text: fieldAliasValues(fm, PLATFORM_FIELD_KEYS).join(' / ') || '—' });
	tr.createEl('td', { cls: 'dashboard-pipeline-list-stage', text: item.stage.label });

	const dueTd = tr.createEl('td', { cls: 'dashboard-pipeline-list-due' });
	const due = parseNoteDue(fm);
	dueTd.setText(due ? formatNoteDue(due) : '—');

	tr.createEl('td', { cls: 'dashboard-pipeline-list-mtime', text: shortDate(item.file.stat.mtime) });
}

/** One action button's own value menu (the card button's behavior): the
 *  configured options with the current value checked; a pick writes that
 *  value into the action's target field. */
function openActionValueMenu(anchor: HTMLElement, item: PipelineItem, action: import('./types').PipelineAction, app: App): void {
	const menu = new Menu();
	const current = actionCurrentValue(item.frontmatter, action.field);
	for (const option of action.options) {
		menu.addItem(mi => {
			mi.setTitle(option);
			if (option === current) mi.setChecked(true);
			mi.onClick(() => { void applyPipelineAction(app, item, action, option); });
		});
	}
	const rect = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}

function shortDate(ms: number): string {
	const date = new Date(ms);
	return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
