import { App, HoverParent, Menu, Platform, setIcon } from 'obsidian';
import type { DashboardColumn, PipelineConfig, RenderCallbacks } from './types';
import { t } from './i18n';
import { attachNoteHover } from './hover-preview';
import { extractCoverValue, resolveLibraryCover } from './library-section';
import {
	actionCurrentValue,
	cardDisplayTitle,
	cardSkillVars,
	firstImageLinkIn,
	normalizePipelineActions,
	skillColorFor,
	type PipelineBoardModel,
	type PipelineItem,
} from './pipeline-model';
import {
	applyPipelineAction,
	archivePipelineItem,
	deletePipelineItem,
	dispatchSkill,
} from './pipeline-section';
import { PIPELINE_LIST_PAGE_SIZE, shortDate } from './pipeline-list-view';

/**
 * Cards view of the pipeline (2026-11-16, Rae's spec): every filtered item as
 * a Xiaohongshu-style image-text note card — a tall cover, the crafted 标题
 * (or `title`) below it, then one line of 更新日期 + stage, then the same
 * directly-clickable buttons the list view carries (colored skill dispatch +
 * action value menus + the built-in archive/delete pair). Cover chain: the
 * note's 封面/cover property, then any image-shaped property value, then the
 * first image link embedded in the note body, then a themed placeholder.
 */

/** Rendered pages per section (runtime, not persisted) — the list view's
 *  progressive idiom, keyed by column name. */
const cardsPages = new Map<string, number>();

export function renderPipelineCardsView(
	host: HTMLElement,
	column: DashboardColumn,
	model: PipelineBoardModel,
	app: App,
	callbacks: RenderCallbacks,
	hoverParent: HoverParent | null,
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

	const grid = host.createDiv({ cls: 'dashboard-pipeline-notes' });
	const limit = cardsPages.get(column.name) ?? PIPELINE_LIST_PAGE_SIZE;
	for (const item of rows.slice(0, limit)) {
		grid.appendChild(renderNoteCard(item, cfg, app, callbacks, hoverParent));
	}
	if (rows.length > limit) {
		const more = grid.createDiv({
			cls: 'dashboard-library-load-more dashboard-pipeline-load-more',
			text: t('library.showMore', { count: rows.length - limit }),
		});
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			cardsPages.set(column.name, limit + PIPELINE_LIST_PAGE_SIZE);
			more.dispatchEvent(new CustomEvent('dashboard-pipeline-refresh', { detail: { columnName: column.name }, bubbles: true }));
		});
	}
}

function renderNoteCard(
	item: PipelineItem,
	cfg: PipelineConfig,
	app: App,
	callbacks: RenderCallbacks,
	hoverParent: HoverParent | null,
): HTMLElement {
	const card = createDiv({ cls: 'dashboard-pipeline-note' });
	card.dataset.path = item.file.path;
	if (!Platform.isMobile && hoverParent) attachNoteHover(app, card, item.file, hoverParent);

	// Cover — the whole Xiaohongshu card form hangs off it. Click opens the
	// note (the cover IS the primary content here, unlike the board card
	// where blank areas deliberately do nothing).
	const cover = card.createDiv({ cls: 'dashboard-pipeline-note-cover' });
	cover.setAttribute('role', 'button');
	cover.setAttribute('tabindex', '0');
	cover.setAttribute('aria-label', cardDisplayTitle(item));
	cover.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onOpenNoteInPopover(item.file);
	});
	paintNoteCover(cover, item, app);

	// Action tools: a VERTICAL icon-only stack over the cover's BOTTOM-right
	// corner (Rae, 2026-11-17, moved from the top) — configured actions (each
	// opens its own value menu) plus the built-in archive/delete pair.
	// Icon-only, no background box or fill: white glyphs with a drop shadow so
	// they read over any cover photo AND the light placeholder wash. Anchored
	// INSIDE the cover so the stack follows the cover's own bottom edge; the
	// card's whole bottom row stays with the skill buttons.
	const tools = cover.createDiv({ cls: 'dashboard-pipeline-note-tools' });
	for (const action of normalizePipelineActions(cfg.actions)) {
		const btn = tools.createEl('button', {
			cls: 'dashboard-pipeline-note-tool',
			attr: { type: 'button', 'aria-label': action.label, title: action.label },
		});
		setIcon(btn, action.icon || 'square-pen');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			openActionValueMenu(btn, item, action, app);
		});
	}
	const archiveBtn = tools.createEl('button', {
		cls: 'dashboard-pipeline-note-tool',
		attr: { type: 'button', 'aria-label': t('pipeline.archive'), title: t('pipeline.archiveHint') },
	});
	setIcon(archiveBtn, 'archive');
	archiveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		void archivePipelineItem(app, item, cfg);
	});
	const deleteBtn = tools.createEl('button', {
		cls: 'dashboard-pipeline-note-tool',
		attr: { type: 'button', 'aria-label': t('pipeline.deleteItem'), title: t('pipeline.deleteItem') },
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		void deletePipelineItem(app, item);
	});

	const body = card.createDiv({ cls: 'dashboard-pipeline-note-body' });

	// Title: plain text div (the card-title idiom — a <button> can never shed
	// Obsidian's global chrome), single click opens the note.
	const title = body.createDiv({ cls: 'dashboard-pipeline-note-title', text: cardDisplayTitle(item) });
	title.setAttribute('role', 'button');
	title.setAttribute('tabindex', '0');
	title.setAttribute('aria-label', cardDisplayTitle(item));
	title.addEventListener('click', (e) => {
		e.stopPropagation();
		callbacks.onOpenNoteInPopover(item.file);
	});

	// One meta line under the title: 更新日期 · stage (dot in the stage color,
	// the rail chip vocabulary).
	const meta = body.createDiv({ cls: 'dashboard-pipeline-note-meta' });
	meta.createSpan({ cls: 'dashboard-pipeline-note-date', text: shortDate(item.file.stat.mtime) });
	const stageEl = meta.createSpan({ cls: 'dashboard-pipeline-note-stage' });
	const dot = stageEl.createSpan({ cls: 'dashboard-pipeline-note-stage-dot' });
	dot.style.setProperty('background', item.stage.color);
	stageEl.createSpan({ text: item.stage.label });

	// Bottom row: card-scope skills ONLY (Rae, 2026-11-17) — the actions moved
	// to the corner, so however many buttons a stage carries, they all show.
	const foot = body.createDiv({ cls: 'dashboard-pipeline-note-foot' });
	const skills = cfg.skills.filter(skill => skill.stage === item.stage.value && skill.scope === 'card');
	if (skills.length > 0) {
		const skillGroup = foot.createDiv({ cls: 'dashboard-pipeline-list-btn-group dashboard-pipeline-list-btn-group--skills' });
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
	return card;
}

/** Paint one card's cover: frontmatter cover (封面/cover, then any
 *  image-shaped property — the library's extraction) and, when that is
 *  absent or fails to resolve, the FIRST image link embedded in the note
 *  body. A themed placeholder closes the chain. Every step is async; the
 *  element is checked for isConnected so a refresh mid-flight paints
 *  nothing (the library cover idiom). */
function paintNoteCover(coverEl: HTMLElement, item: PipelineItem, app: App): void {
	const paintOrPlaceholder = (url: string): void => {
		if (!coverEl.isConnected) return;
		if (url) coverEl.style.backgroundImage = `url(${url})`;
		else {
			coverEl.addClass('dashboard-pipeline-note-cover--placeholder');
			setIcon(coverEl, 'image');
		}
	};

	const explicit = extractCoverValue(item.frontmatter);
	const resolveExplicit = explicit
		? resolveLibraryCover(explicit.value, item.file, app)
		: Promise.resolve('');

	// Body-image fallback serves BOTH paths (no property cover, or a property
	// cover that fails to resolve — a dead link should not blank the card).
	const fromBody = (): Promise<string> => app.vault.cachedRead(item.file)
		.then(content => {
			const link = firstImageLinkIn(content);
			return link ? resolveLibraryCover(link, item.file, app) : '';
		})
		.catch(() => '');

	void resolveExplicit
		.then(url => url ? url : fromBody())
		.then(paintOrPlaceholder)
		.catch(() => paintOrPlaceholder(''));
}

/** One action button's own value menu (identical to the list view's): the
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
