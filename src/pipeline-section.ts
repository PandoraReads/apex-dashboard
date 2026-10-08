import { App, HoverParent, Notice, Platform, setIcon, TFile } from 'obsidian';
import type { DashboardColumn, PipelineConfig, PipelineSkill, PipelineStage, RenderCallbacks } from './types';
import { t } from './i18n';
import { attachNoteHover } from './hover-preview';
import { KANBAN_FILE_DRAG_TYPE } from './dnd';
import { AgentPromptModal } from './agent-prompt-modal';
import { buildAgentPrompt, ClaudianBridgeError, getAgentAdapter } from './agent-dispatch';
import {
	cardChips,
	chipColorFor,
	skillColorFor,
	cardSkillVars,
	collectPipelineItems,
	distinctFieldValues,
	filterByField,
	PROJECT_FIELD_KEYS,
	PLATFORM_FIELD_KEYS,
	railValueColors,
	resolveFilterFieldKeys,
	formatNoteDue,
	normalizeFolderPath,
	parseNoteDue,
	parseTasks,
	stageFolderPath,
	stageSkillVars,
	taskProgress,
	toggleTaskLine,
	type PipelineItem,
} from './pipeline-model';
import { createNoteWithProps } from './library-new-note';
import { PipelineDueModal } from './pipeline-due-modal';
import { showPromptDialog } from './prompt-dialog';
import { showConfirmDialog } from './confirm-dialog';

/**
 * Pipeline board: one column per workflow stage, one card per note, grouped
 * by the status frontmatter field. Skill buttons hand a rendered prompt to an
 * agent adapter (agent-dispatch); the agent writes results — including the
 * status mutation that moves the card — back into the note, and the standard
 * scanning-section refresh walks the board forward. No polling anywhere.
 */

/** Transient drag state (desktop). A single drag can be active at a time. */
interface PipelineDragState {
	file: TFile | null;
	cardEl: HTMLElement | null;
}
const dragState: PipelineDragState = { file: null, cardEl: null };

/** Files with a pipeline move still awaiting its write (frontmatter update or
 *  folder rename). A second drop inside that window would read pre-write
 *  state and could double-move — consult this and bail (library kanban
 *  idiom). */
const movesInFlight = new Set<TFile>();

/** How long a title single click waits before opening the note, giving a
 *  double click time to claim the gesture for rename instead. */
const TITLE_OPEN_DELAY_MS = 300;

export function renderPipelineSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	callbacks: RenderCallbacks,
	hoverParent: HoverParent | null,
): void {
	const cfg = column.pipelineConfig;
	// Default skin: 马卡龙 (trello) unless the section explicitly picks 'theme'.
	const skin = cfg?.boardStyle && cfg.boardStyle !== 'theme' ? cfg.boardStyle : 'trello';
	const body = el.createDiv({ cls: `dashboard-section-cards dashboard-pipeline dashboard-pipeline--${skin}` });

	// STRICT scope: a content folder must be configured before anything is
	// scanned — an unset root would otherwise surface the whole vault.
	if (!cfg || !cfg.rootFolder.trim() || cfg.stages.length === 0) {
		renderUnconfigured(body, column);
		return;
	}

	const fullModel = collectPipelineItems(app, cfg);
	const allItems = [...fullModel.byStage.values()].flat();

	// Left value-filter rail (platform / project dimensions). The rail only
	// appears once the dimension's field holds at least one value.
	// Filter dimensions: the configured property list, or the built-in
	// 平台/platform + 项目/project pair. Built-in names keep alias merging.
	const dims = (cfg.filterFields && cfg.filterFields.length > 0
		? cfg.filterFields
		: ['platform', 'project']).map(f => f.trim()).filter(f => f.length > 0);
	const activeDim = dims.includes(cfg.filter?.dim ?? '') ? (cfg.filter?.dim as string) : (dims[0] ?? 'platform');
	const field: readonly string[] = resolveFilterFieldKeys(activeDim);
	const values = distinctFieldValues(allItems, field);
	// The rail stays as long as ANY dimension holds values — switching to a
	// dimension whose field nobody filled must not strand the user (the
	// "both lists vanished" bug); it shows tabs + a hint instead.
	const anyValues = values.length > 0
		|| dims.some(d => distinctFieldValues(allItems, resolveFilterFieldKeys(d)).length > 0);

	const wrap = body.createDiv({ cls: 'dashboard-pipeline-wrap' });
	if (anyValues) {
		renderFilterRail(wrap, column.name, dims, activeDim, cfg.filter?.value ?? null, values);
	}
	const board = wrap.createDiv({ cls: 'dashboard-pipeline-board' });

	const model = filterByField(fullModel, field, cfg.filter?.value ?? null);
	for (const stage of cfg.stages) {
		renderStageColumn(board, stage, model.byStage.get(stage.value) ?? [], column.name, cfg, app, callbacks, hoverParent);
	}
}

/** The left rail: dimension tabs (platform/project) + value list with counts.
 *  Every pick persists through the board's config (see the view's
 *  dashboard-pipeline-filter handler), so the choice survives reloads and the
 *  scanning-section signature notices the change. */
/** Dimension tab label: built-in families localize (平台/项目), custom
 *  properties show their own name. */
function dimLabelFor(name: string): string {
	const n = name.trim();
	if (PLATFORM_FIELD_KEYS.includes(n)) return t('pipeline.dimPlatform');
	if (PROJECT_FIELD_KEYS.includes(n)) return t('pipeline.dimProject');
	return n;
}

function renderFilterRail(wrap: HTMLElement, columnName: string, dims: readonly string[], dim: string, selected: string | null, values: Array<{ value: string; count: number }>): void {
	const rail = wrap.createDiv({ cls: 'dashboard-pipeline-rail' });
	const dispatch = (next: { dim: string; value?: string } | undefined): void => {
		rail.dispatchEvent(new CustomEvent('dashboard-pipeline-filter', { detail: { columnName, filter: next }, bubbles: true }));
	};

	// "All" sits ABOVE the dimension tabs (clears the filter in one tap).
	const all = rail.createEl('button', {
		cls: `dashboard-pipeline-rail-item is-all${selected === null ? ' is-active' : ''}`,
		attr: { type: 'button' },
	});
	all.setText(t('pipeline.filterAll'));
	if (selected !== null) {
		all.addEventListener('click', (e) => {
			e.stopPropagation();
			dispatch({ dim });
		});
	}

	// A single configured dimension needs no switcher.
	if (dims.length > 1) {
		const tabs = rail.createDiv({ cls: 'dashboard-pipeline-rail-dims' });
		for (const name of dims) {
			const tab = tabs.createEl('button', {
				cls: `dashboard-pipeline-rail-dim${name === dim ? ' is-active' : ''}`,
				attr: { type: 'button' },
			});
			tab.setText(dimLabelFor(name));
			if (name !== dim) {
				tab.addEventListener('click', (e) => {
					e.stopPropagation();
					// Switching dimension resets the selection (values differ).
					dispatch({ dim: name });
				});
			}
		}
	}

	if (values.length === 0) {
		rail.createDiv({ cls: 'dashboard-pipeline-rail-empty', text: t('pipeline.filterEmptyDim') });
	}

	values.forEach(({ value, count }, index) => {
		const item = rail.createEl('button', {
			cls: `dashboard-pipeline-rail-item dashboard-pipeline-rail-value${value === selected ? ' is-active' : ''}`,
			attr: { type: 'button', 'data-value': value },
		});
		// Latte monochrome ramp: same warm hue, lightness deepening downward;
		// ink flips with the surface depth for readability.
		const { bg, ink } = railValueColors(index, values.length);
		item.style.setProperty('background', bg);
		item.style.setProperty('--rail-ink', ink);
		const label = item.createSpan({ text: value });
		label.addClass('dashboard-pipeline-rail-label');
		const badge = item.createSpan({ text: String(count) });
		badge.addClass('dashboard-pipeline-rail-count');
		item.addEventListener('click', (e) => {
			e.stopPropagation();
			dispatch({ dim, value });
		});
	});
}

function renderUnconfigured(body: HTMLElement, column: DashboardColumn): void {
	const empty = body.createDiv({ cls: 'dashboard-pipeline-empty' });
	empty.createDiv({ cls: 'dashboard-pipeline-empty-title', text: t('pipeline.emptyTitle') });
	empty.createDiv({ cls: 'dashboard-pipeline-empty-hint', text: t('pipeline.emptyHint') });
	const btn = empty.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pipeline.configure') });
	btn.addEventListener('click', () => {
		body.dispatchEvent(new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true }));
	});
}

/** Paint a skill button in its stable per-skill color (same palette as the
 *  property chips — keyed by the skill's label, so the same skill wears the
 *  same color in every column and on every card). */
function paintSkillButton(btn: HTMLElement, skill: PipelineSkill): void {
	btn.addClass('dashboard-pipeline-skill-btn--colored');
	btn.style.setProperty('background', skillColorFor(skill.label.trim() || skill.skillName.trim() || 'skill'));
}

function skillsForStage(cfg: PipelineConfig, stageValue: string, scope: 'stage' | 'card'): PipelineSkill[] {
	return cfg.skills.filter(skill => skill.stage === stageValue && skill.scope === scope);
}

function renderStageColumn(
	board: HTMLElement,
	stage: PipelineStage,
	items: PipelineItem[],
	columnName: string,
	cfg: PipelineConfig,
	app: App,
	callbacks: RenderCallbacks,
	hoverParent: HoverParent | null,
): void {
	const col = board.createDiv({ cls: 'dashboard-pipeline-col' });
	col.dataset.stage = stage.value;
	col.dataset.stageLabel = stage.label;
	col.style.setProperty('--db-pipe-accent', stage.color);
	// Manual column width (drag the right edge); falls back to the CSS
	// default (Trello list width) when never dragged.
	if (typeof stage.width === 'number' && stage.width >= 200 && stage.width <= 460) {
		col.style.width = `${Math.round(stage.width)}px`;
	}

	const head = col.createDiv({ cls: 'dashboard-pipeline-col-head' });
	const dot = head.createDiv({ cls: 'dashboard-pipeline-col-dot' });
	dot.style.setProperty('background', stage.color);
	head.createDiv({ cls: 'dashboard-pipeline-col-title', text: stage.label });
	// Count hugs the title (Trello "Board 3" rhythm); a flexible spacer keeps
	// the action icons pinned to the column's top-right corner.
	head.createDiv({ cls: 'dashboard-pipeline-col-count', text: String(items.length) });
	head.createDiv({ cls: 'dashboard-pipeline-col-spacer' });

	// Column actions: stage-scope skills + the add-item affordance, all
	// compact icon buttons (e.g. "AI 搜集选题"); the preview modal lets the
	// user narrow a skill run to selected items.
	const stageActions = head.createDiv({ cls: 'dashboard-pipeline-col-actions' });
	for (const skill of skillsForStage(cfg, stage.value, 'stage')) {
		// No `title` attr: the click opens AgentPromptModal headed by the
		// skill's label, and a native tooltip firing on the stationary cursor
		// after that click read as a SECOND, differently-styled name popup.
		const btn = stageActions.createEl('button', {
			cls: 'dashboard-pipeline-skill-btn',
			attr: { type: 'button', 'aria-label': skill.label },
		});
		setIcon(btn, skill.icon || 'sparkles');
		paintSkillButton(btn, skill);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			dispatchSkill(app, skill, stageSkillVars(stage, cfg), cfg, {
				selectableFiles: items.map(item => ({ path: item.file.path, title: item.file.basename })),
			});
		});
	}
	const addBtn = stageActions.createEl('button', {
		cls: 'dashboard-pipeline-col-add',
		attr: { type: 'button', 'aria-label': t('pipeline.addItem', { stage: stage.label }) },
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void createPipelineItem(app, stage, cfg);
	});

	const cardsHost = col.createDiv({ cls: 'dashboard-pipeline-cards' });
	for (const item of items) {
		cardsHost.appendChild(renderPipelineCard(item, stage, cfg, app, callbacks, hoverParent));
	}

	attachColumnDrop(col, stage, cfg, app);
	if (!Platform.isMobile) attachColumnWidthHandle(col, columnName, stage);
}

/** Drag handle on the column's right edge: pointer-drag resizes the column
 *  live; releasing persists the width through the section's config (the
 *  board event bubbles to view.ts, mirroring the rss page-size pattern). */
function attachColumnWidthHandle(col: HTMLElement, columnName: string, stage: PipelineStage): void {
	const handle = col.createDiv({ cls: 'dashboard-pipeline-col-resize' });
	handle.setAttribute('role', 'separator');
	handle.title = t('pipeline.resizeHint');
	handle.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startWidth = col.getBoundingClientRect().width;
		handle.setPointerCapture(e.pointerId);
		const onMove = (ev: PointerEvent): void => {
			const next = Math.min(460, Math.max(200, startWidth + (ev.clientX - startX)));
			col.style.width = `${Math.round(next)}px`;
		};
		const onUp = (ev: PointerEvent): void => {
			handle.releasePointerCapture(ev.pointerId);
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			const finalWidth = Math.round(Math.min(460, Math.max(200, startWidth + (ev.clientX - startX))));
			col.dispatchEvent(new CustomEvent('dashboard-pipeline-col-width', {
				detail: { columnName, stageValue: stage.value, width: finalWidth },
				bubbles: true,
			}));
		};
		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
	});
}

/** Inline rename for a card title (the section-title pattern): swap the text
 *  for an input; Enter/blur commits (fileManager.renameFile, links update),
 *  Escape cancels. The debounced refresh repaints the card afterwards. */
function beginCardTitleEdit(titleEl: HTMLElement, file: TFile, app: App): void {
	const current = file.basename;
	titleEl.empty();
	const input = titleEl.createEl('input', {
		cls: 'dashboard-pipeline-card-title-input',
		attr: { type: 'text', value: current },
	});
	input.focus();
	input.select();
	const finish = (save: boolean): void => {
		const raw = input.value.trim();
		// Strip path separators and friends so a title can never escape its folder.
		const name = raw.replace(/[\\/:*?"<>|]/g, '').trim();
		if (!save || !name || name === current) {
			titleEl.empty();
			titleEl.setText(current);
			return;
		}
		titleEl.empty();
		titleEl.setText(name);
		const slash = file.path.lastIndexOf('/');
		const newPath = `${slash >= 0 ? file.path.slice(0, slash + 1) : ''}${name}.md`;
		void (async () => {
			try {
				if (app.vault.getAbstractFileByPath(newPath)) {
					new Notice(t('pipeline.renameConflict', { name }));
					titleEl.setText(current);
					return;
				}
				await app.fileManager.renameFile(file, newPath);
			} catch (err) {
				console.error('[Dashboard] pipeline rename failed:', err);
				new Notice(t('pipeline.renameFailed'));
				titleEl.setText(current);
			}
		})();
	};
	input.addEventListener('keydown', (ke: KeyboardEvent) => {
		if (ke.key === 'Enter') {
			ke.preventDefault();
			finish(true);
		} else if (ke.key === 'Escape') {
			ke.preventDefault();
			finish(false);
		}
	});
	input.addEventListener('blur', () => finish(true));
}

/** Cards whose checklist is expanded (survives refreshes until collapsed). */

/** Archive one item: stamp the status `archived` (matches no stage, so the
 *  card leaves the board wherever the folder lives) and move the file into
 *  the section's configured archive folder. */
async function archivePipelineItem(app: App, item: PipelineItem, cfg: PipelineConfig): Promise<void> {
	const folder = normalizeFolderPath(cfg.archiveFolder ?? '');
	if (!folder) {
		new Notice(t('pipeline.archiveNoFolder'));
		return;
	}
	if (movesInFlight.has(item.file)) return;
	const newPath = `${folder}/${item.file.name}`;
	if (item.file.path === newPath) {
		// Already filed: just make sure it leaves the board.
	}
	else if (app.vault.getAbstractFileByPath(newPath)) {
		new Notice(t('pipeline.moveNameConflict', { name: item.file.basename, folder }));
		return;
	}
	movesInFlight.add(item.file);
	try {
		await app.fileManager.processFrontMatter(item.file, (fm: Record<string, unknown>) => {
			fm[cfg.statusField] = 'archived';
		});
		if (item.file.path !== newPath) {
			if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			await app.fileManager.renameFile(item.file, newPath);
		}
		expandedCards.delete(item.file.path);
		new Notice(t('pipeline.archived', { name: item.file.basename, folder }));
	} catch (err) {
		console.error('[Dashboard] pipeline archive failed:', err);
		new Notice(t('pipeline.archiveFailed'));
	} finally {
		movesInFlight.delete(item.file);
	}
}
const expandedCards = new Set<string>();

function renderPipelineCard(
	item: PipelineItem,
	stage: PipelineStage,
	cfg: PipelineConfig,
	app: App,
	callbacks: RenderCallbacks,
	hoverParent: HoverParent | null,
): HTMLElement {
	const card = createDiv({ cls: 'dashboard-pipeline-card' });
	card.dataset.path = item.file.path;

	// The card body itself never opens the note: stray clicks on blank card
	// areas used to fire popovers by accident. Opening lives on the TITLE
	// (single click) alongside the rename gesture (double click).
	if (!Platform.isMobile && hoverParent) attachNoteHover(app, card, item.file, hoverParent);

	// Hover-reveal delete (library card's class + CSS): to trash, recoverable.
	const del = card.createEl('button', {
		cls: 'dashboard-library-card-delete',
		attr: { type: 'button', 'aria-label': t('pipeline.deleteItem') },
	});
	del.title = t('pipeline.deleteItem');
	setIcon(del, 'trash-2');
	del.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		void (async () => {
			if (!await showConfirmDialog(app, {
				title: t('pipeline.deleteItem'),
				message: t('pipeline.deleteConfirm', { name: item.file.basename }),
			})) return;
			try { await app.fileManager.trashFile(item.file); } catch (err) {
				console.error('[Dashboard] pipeline item delete failed:', err);
				new Notice(t('pipeline.deleteFailed'));
			}
		})();
	});

	// Tags/property chips sit ABOVE the title (Trello label rhythm); the stage
	// itself is carried by the column's tint, no per-card color strip.
	const chips = cardChips(item.frontmatter, cfg.cardProperties);
	if (chips.length > 0) {
		const chipRow = card.createDiv({ cls: 'dashboard-pipeline-card-chips' });
		for (const chip of chips) {
			const chipEl = chipRow.createDiv({ cls: `dashboard-pipeline-chip${chip.isProperty ? ' dashboard-pipeline-chip--prop' : ''}`, text: chip.text });
			if (chip.isProperty && chip.color) {
				chipEl.style.setProperty('background', chip.color);
			}
		}
	}

	// Semi-hidden archive affordance at the top-right, beside the delete
	// button: revealed on hover like its neighbor (always visible on phones).
	const archiveBtn = card.createEl('button', {
		cls: 'dashboard-library-card-delete dashboard-pipeline-archive-btn',
		attr: { type: 'button', 'aria-label': t('pipeline.archive') },
	});
	archiveBtn.title = t('pipeline.archiveHint');
	setIcon(archiveBtn, 'archive');
	archiveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		void archivePipelineItem(app, item, cfg);
	});

	// Title carries BOTH gestures: single click opens the note, double click
	// renames in place. The open runs on a short timer so the first click of
	// a double click can be claimed by the rename instead (a slow popover
	// flashing open mid-rename is the failure this avoids).
	const titleEl = card.createDiv({ cls: 'dashboard-pipeline-card-title', text: item.file.basename });
	titleEl.setAttribute('role', 'button');
	titleEl.setAttribute('aria-label', item.file.basename);
	titleEl.title = t('pipeline.renameHint');
	let openTimer = 0;
	titleEl.addEventListener('click', (e) => {
		e.stopPropagation();
		// detail>1 = a later click of the same burst; the dblclick handler
		// takes over and cancels the pending open.
		if (e.detail > 1) return;
		openTimer = window.setTimeout(() => callbacks.onOpenNoteInPopover(item.file), TITLE_OPEN_DELAY_MS);
	});
	titleEl.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		e.preventDefault();
		window.clearTimeout(openTimer);
		beginCardTitleEdit(titleEl, item.file, app);
	});

	// Footer: due date + checklist toggle at the LEFT, card-scope skills at
	// the right (Trello badge row).
	const foot = card.createDiv({ cls: 'dashboard-pipeline-card-foot' });

	const due = parseNoteDue(item.frontmatter);
	const dueBtn = foot.createEl('button', {
		cls: `dashboard-pipeline-foot-btn${due ? ' is-set' : ''}`,
		attr: { type: 'button', 'aria-label': t('pipeline.dueTitle'), title: t('pipeline.dueTitle') },
	});
	setIcon(dueBtn, 'calendar-clock');
	dueBtn.createSpan({ text: due ? formatNoteDue(due) : t('pipeline.dueSet') });
	dueBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		new PipelineDueModal(app, item.file, item.frontmatter).open();
	});

	const progress = taskProgress((app.metadataCache.getFileCache(item.file) as { listItems?: Array<{ task?: string }> } | null)?.listItems);
	const todoBtn = foot.createEl('button', {
		cls: 'dashboard-pipeline-foot-btn dashboard-pipeline-todo-toggle',
		attr: { type: 'button', 'aria-label': t('pipeline.todoToggle'), title: t('pipeline.todoToggle') },
	});
	setIcon(todoBtn, 'list-checks');
	todoBtn.createSpan({ text: progress.total > 0 ? `${progress.done}/${progress.total}` : t('pipeline.todoEmptyLabel') });
	todoBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		if (expandedCards.has(item.file.path)) expandedCards.delete(item.file.path);
		else expandedCards.add(item.file.path);
		const host = card.querySelector(':scope > .dashboard-pipeline-tasks');
		if (expandedCards.has(item.file.path)) {
			if (!host) void renderCardTasks(card, item, app);
		} else {
			host?.remove();
		}
	});

	foot.createDiv({ cls: 'dashboard-pipeline-foot-spacer' });

	// Card-scope skills carry this file's context to the agent.
	const cardSkills = skillsForStage(cfg, stage.value, 'card');
	for (const skill of cardSkills) {
		// No `title` (same double-popup reason as the stage-scope buttons).
		const btn = foot.createEl('button', {
			cls: 'dashboard-pipeline-skill-btn',
			attr: { type: 'button', 'aria-label': skill.label },
		});
		setIcon(btn, skill.icon || 'sparkles');
		paintSkillButton(btn, skill);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			dispatchSkill(app, skill, cardSkillVars(item, cfg), cfg);
		});
	}

	if (expandedCards.has(item.file.path)) void renderCardTasks(card, item, app);

	if (!Platform.isMobile) {
		attachCardDrag(card, item);
	}
	return card;
}

/** Expanded checklist body: read the note (cached), render each checkbox
 *  task with its inline due marker; checking a box writes back to the file
 *  (the standard vault-event refresh then updates the progress badge). */
async function renderCardTasks(card: HTMLElement, item: PipelineItem, app: App): Promise<void> {
	let content: string;
	try {
		content = await app.vault.cachedRead(item.file);
	} catch (err) {
		console.error('[Dashboard] pipeline checklist read failed:', err);
		return;
	}
	if (!card.isConnected) return;
	card.querySelector(':scope > .dashboard-pipeline-tasks')?.remove();
	const host = card.createDiv({ cls: 'dashboard-pipeline-tasks' });
	const tasks = parseTasks(content);
	if (tasks.length === 0) {
		host.createDiv({ cls: 'dashboard-pipeline-tasks-empty', text: t('pipeline.todoEmptyHint') });
		return;
	}
	for (const task of tasks) {
		const row = host.createDiv({ cls: `dashboard-pipeline-task${task.checked ? ' is-done' : ''}` });
		const cb = row.createEl('input', {
			cls: 'dashboard-pipeline-task-check',
			attr: { type: 'checkbox' },
		}) as HTMLInputElement;
		cb.checked = task.checked;
		// Checking a box must never fall through to the card's open-note click.
		cb.addEventListener('click', (e) => e.stopPropagation());
		cb.addEventListener('change', () => {
			void (async () => {
				try {
					const fresh = await app.vault.cachedRead(item.file);
					const next = toggleTaskLine(fresh, task.line);
					if (next === fresh) return;
					await app.vault.modify(item.file, next);
					row.toggleClass('is-done', cb.checked);
				} catch (err) {
					console.error('[Dashboard] pipeline checklist toggle failed:', err);
					cb.checked = !cb.checked;
				}
			})();
		});
		row.createDiv({ cls: 'dashboard-pipeline-task-text', text: task.text });
		if (task.due) {
			const badge = row.createDiv({ cls: 'dashboard-pipeline-task-due', text: task.due });
			badge.title = t('pipeline.taskDueHint');
		}
	}
}

/** Make a card draggable (desktop). Tags the drag with the shared custom MIME
 *  type so foreign drop targets (dnd.ts) recognize and decline it. */
function attachCardDrag(card: HTMLElement, item: PipelineItem): void {
	card.setAttribute('draggable', 'true');
	card.title = t('pipeline.dragHint');
	card.addEventListener('dragstart', (e) => {
		dragState.file = item.file;
		dragState.cardEl = card;
		card.addClass('dashboard-pipeline-card--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Custom type only: a bare text/plain payload would insert literal
			// text wherever else the card gets dropped.
			e.dataTransfer.setData(KANBAN_FILE_DRAG_TYPE, item.file.path);
		}
	});
	card.addEventListener('dragend', () => {
		dragState.file = null;
		dragState.cardEl = null;
		card.removeClass('dashboard-pipeline-card--dragging');
		activeDocument.querySelectorAll('.dashboard-pipeline-col--drag-over')
			.forEach(el => (el as HTMLElement).removeClass('dashboard-pipeline-col--drag-over'));
	});
}

/** Wire one column as a drop target (desktop). `stage` null marks the unfiled
 *  column, which declines drops. Drags lacking the kanban marker pass
 *  through untouched so section grips and OS file drops keep dnd.ts
 *  behavior. */
function attachColumnDrop(col: HTMLElement, stage: PipelineStage, cfg: PipelineConfig, app: App): void {
	col.addEventListener('dragover', (e) => {
		if (!e.dataTransfer || !e.dataTransfer.types.includes(KANBAN_FILE_DRAG_TYPE)) return;
		// Claim the event so the enclosing section row in dnd.ts doesn't
		// highlight the whole section behind the board.
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		col.addClass('dashboard-pipeline-col--drag-over');
	});
	col.addEventListener('dragleave', (e) => {
		const rect = col.getBoundingClientRect();
		if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
			col.removeClass('dashboard-pipeline-col--drag-over');
		}
	});
	col.addEventListener('drop', (e) => {
		if (!dragState.file || !dragState.cardEl) return;
		e.preventDefault();
		e.stopPropagation();
		col.removeClass('dashboard-pipeline-col--drag-over');
		void movePipelineItem(app, dragState.file, stage, cfg, dragState.cardEl, col);
	});
}

/** Rewrite the column's count badge so it matches the cards now in the DOM
 *  (covers the optimistic-move window before the debounced re-render). */
function refreshColumnCount(col: HTMLElement): void {
	const count = col.querySelector(':scope > .dashboard-pipeline-col-head .dashboard-pipeline-col-count');
	if (!count) return;
	const rendered = col.querySelectorAll(':scope .dashboard-pipeline-card').length;
	count.setText(String(rendered));
}

/**
 * Advance an item into a stage: write the status field (the grouping truth),
 * then archive the file into the stage folder when one is configured.
 * Optimistically reparents the card across the ~500ms vault-event debounce;
 * rolls the DOM back if the write fails (library kanban idiom).
 */
async function movePipelineItem(
	app: App,
	file: TFile,
	stage: PipelineStage,
	cfg: PipelineConfig,
	cardEl: HTMLElement,
	targetCol: HTMLElement,
): Promise<void> {
	const cached: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[cfg.statusField];
	const sameStage = String(cached ?? '').trim().toLowerCase() === stage.value.trim().toLowerCase();
	const folder = stageFolderPath(cfg, stage);
	const newPath = folder ? `${folder}/${file.name}` : file.path;
	if (sameStage && file.path === newPath) return;
	if (movesInFlight.has(file)) return;

	const originParent = cardEl.parentNode;
	const originNext = cardEl.nextSibling;
	movesInFlight.add(file);
	const targetCards = targetCol.querySelector(':scope .dashboard-pipeline-cards');
	targetCards?.appendChild(cardEl);
	refreshColumnCount(targetCol);
	if (originParent instanceof HTMLElement) refreshColumnCount(originParent);
	try {
		// processFrontMatter re-reads live frontmatter, so the write derives
		// from the file's actual state even if the cache read above was stale.
		if (!sameStage) {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm[cfg.statusField] = stage.value;
			});
		}
		if (folder && file.path !== newPath) {
			// createFolder creates intermediate parents; a no-op when present.
			if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			if (app.vault.getAbstractFileByPath(newPath)) {
				new Notice(t('pipeline.moveNameConflict', { name: file.basename, folder }));
			} else {
				// renameFile respects "auto-update internal links".
				await app.fileManager.renameFile(file, newPath);
			}
		}
		new Notice(t('pipeline.moved', { name: file.basename, stage: stage.label }));
	} catch (err) {
		if (originParent) originParent.insertBefore(cardEl, originNext);
		if (originParent instanceof HTMLElement) refreshColumnCount(originParent);
		refreshColumnCount(targetCol);
		console.error('[Dashboard] pipeline move failed:', err);
		new Notice(t('pipeline.moveFailed'));
	} finally {
		movesInFlight.delete(file);
	}
}

/** Send a skill prompt through its agent adapter — via the preview modal, or
 *  straight away when the section opts into direct send. Stage-scope skills
 *  always open the modal (its checklist is the only way to narrow the run to
 *  selected items); direct send applies to card-scope buttons only. */
function dispatchSkill(
	app: App,
	skill: PipelineSkill,
	vars: Record<string, string>,
	cfg: PipelineConfig,
	options?: { selectableFiles?: Array<{ path: string; title: string }> },
): void {
	const spec = {
		label: skill.label,
		skillName: skill.skillName,
		promptTemplate: skill.promptTemplate,
		inputPlaceholder: skill.inputPlaceholder,
	};
	// A non-empty selectable list marks a stage-scope run with items to pick
	// from: keep the modal even under directSend (an empty column has nothing
	// to pick, so it may send directly).
	const forceModal = !!options?.selectableFiles && options.selectableFiles.length > 0;
	// Per-skill toggle, with the legacy section-wide flag as the fallback.
	if ((skill.directSend ?? cfg.directSend) && !forceModal) {
		void (async () => {
			try {
				const prompt = buildAgentPrompt(spec, { ...vars, input: '' }, skill.agent);
				const adapter = getAgentAdapter(skill.agent);
				await adapter.send(app, prompt);
				if (adapter.kind === 'deep-link') new Notice(t('agent.openedPrefill'));
			} catch (error) {
				if (error instanceof ClaudianBridgeError) new Notice(t(`agent.error.${error.code}`, { agent: getAgentAdapter(skill.agent).label }));
				else new Notice(t('agent.sendFailed', { agent: getAgentAdapter(skill.agent).label, message: error instanceof Error ? error.message : String(error) }));
			}
		})();
		return;
	}
	new AgentPromptModal(app, spec, skill.agent, vars, options?.selectableFiles).open();
}

/** Create a new item note in the stage's folder, seeded from the section
 *  template with the stage value already in the status field. */
async function createPipelineItem(app: App, stage: PipelineStage, cfg: PipelineConfig): Promise<void> {
	const title = await showPromptDialog(app, { title: t('pipeline.newItemTitle', { stage: stage.label }), placeholder: t('pipeline.newItemPlaceholder') });
	if (!title) return;
	const folder = stageFolderPath(cfg, stage) ?? normalizeFolderPath(cfg.rootFolder);
	try {
		const file = await createNoteWithProps(app, folder, title, { [cfg.statusField]: stage.value }, cfg.templatePath || undefined);
		new Notice(t('pipeline.created', { name: file.basename }));
	} catch (err) {
		console.error('[Dashboard] pipeline item create failed:', err);
		new Notice(t('pipeline.createFailed', { message: err instanceof Error ? err.message : String(err) }));
	}
}
