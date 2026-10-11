import { App, Notice, setIcon } from 'obsidian';
import type { DashboardColumn } from './types';
import { t } from './i18n';
import {
	collectPmProjects, orderPmProjects, pmField, pmGroupName, pmIncome, pmCycleText, pmKeyDate, isKeyDateOverdue,
	pmStageColor, sortPmProjects, sumIncome, type PmProject,
} from './pm-model';
import { createToolbarDropdown, type ToolbarDropdownItem } from './toolbar-dropdown';
import {
	PmBoardModal, createPmWorkNote, archivePmProject, deletePmProject,
	dispatchPmSkill, pmSkillVars,
} from './pm-board-modal';

/**
 * PM section renderer: a flat list of project cards (one per note) with the
 * metadata chips on the card, a milestone-completion progress bar, and the
 * hover action row (work note, skills, archive, delete). Single click opens
 * the project board; double click renames the note. Header: new project,
 * total income pill, config gear (renderSection's generic gear handles it).
 */

export function renderPmSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
): void {
	const cfg = column.pmConfig;
	if (!cfg || !cfg.rootFolder.trim()) {
		const empty = el.createDiv({ cls: 'dashboard-pmsec-empty' });
		empty.createDiv({ cls: 'dashboard-pipeline-empty-title', text: t('pm.emptyTitle') });
		empty.createDiv({ cls: 'dashboard-pipeline-empty-hint', text: t('pm.emptyHint') });
		const btn = empty.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('pm.configure') });
		btn.addEventListener('click', () => {
			el.dispatchEvent(new CustomEvent('dashboard-library-config', { detail: { columnName: column.name }, bubbles: true }));
		});
		return;
	}

	// Content wrapper: one scrollable flex column (the section row is
	// height-capped by drag-resize — without this the cards overflow and
	// OVERLAP the section below when a view change grows the content).
	const content = el.createDiv({ cls: 'dashboard-pmsec-content' });
	// View state: stage filter is ephemeral; sort mode + grouped view persist
	// through dashboard-pm-prefs (view.ts → sync.updatePmConfig).
	let stageFilter = '';
	let lastProjects: readonly PmProject[] = [];
	const savePrefs = (prefs: { sortMode?: 'name' | 'milestone' | 'keyDate' | undefined; groupView?: 'blocks' | 'kanban' | undefined }): void => {
		el.dispatchEvent(new CustomEvent('dashboard-pm-prefs', {
			detail: { columnName: column.name, prefs },
			bubbles: true,
		}));
	};
	const render = (): void => {
		content.empty();
		const collected = orderPmProjects(collectPmProjects(app, cfg), cfg.order);
		const sorted = sortPmProjects(collected, cfg.sortMode);
		// Pinned projects ride ahead of every ordering (Rae): stable split,
		// pinned keeps its saved order, the rest follows the active sort.
		const pinnedSet = new Set(cfg.pinned ?? []);
		const pinnedFirst = (list: readonly PmProject[]): PmProject[] => {
			if (pinnedSet.size === 0) return [...list];
			const top = (cfg.pinned ?? []).map(path => list.find(p => p.file.path === path)).filter((p): p is PmProject => !!p);
			const rest = list.filter(p => !pinnedSet.has(p.file.path));
			return [...top, ...rest];
		};
		const arranged = pinnedFirst(sorted);
		const stageFilterKey = stageFilter.startsWith('stage:') ? stageFilter.slice(6) : '';
		lastProjects = stageFilterKey ? arranged.filter(p => pmField(p.frontmatter, 'stage') === stageFilterKey) : arranged;

		// Toolbar row: view controls + the project count at the line's end
		// (Rae: one row, not two). Rebuilt EVERY render so the dropdown
		// pills/checkmarks track the live filter (the stale-snapshot bug:
		// picking 全部 back never fired once the captured key matched).
		const toolbar = content.createDiv({ cls: 'dashboard-pmsec-toolbar' });
		const countPill = toolbar.createDiv({ cls: 'dashboard-pmsec-count', text: t('pm.projectCount', { count: lastProjects.length }) });
		const stageItems: ToolbarDropdownItem[] = [
			{ key: '', label: t('pm.filterAllStages'), icon: 'filter' },
			...cfg.stages.map((stage): ToolbarDropdownItem => ({ key: `stage:${stage.label}`, label: stage.label, icon: 'circle-dot' })),
		];
		createToolbarDropdown(toolbar, stageFilter, stageItems, key => {
			stageFilter = key;
			render();
		});
		const sortItems: ToolbarDropdownItem[] = [
			{ key: 'stage', label: t('pm.sortStage'), icon: 'arrow-down-up' },
			{ key: 'name', label: t('pm.sortName'), icon: 'arrow-down-up' },
			{ key: 'milestone', label: t('pm.sortMilestone'), icon: 'list-checks' },
			{ key: 'keyDate', label: t('pm.sortKeyDate'), icon: 'calendar' },
		];
		createToolbarDropdown(toolbar, cfg.sortMode ?? 'stage', sortItems, key => {
			savePrefs({ sortMode: key === 'stage' ? undefined : key as 'name' | 'milestone' | 'keyDate' });
		});
		// Two grouped modes (Rae): stacked blocks (vertical) vs kanban (one
		// column per group, horizontal) — independent toggles, both OFF = flat.
		const blocksToggle = toolbar.createDiv({
			cls: 'dashboard-library-view-btn dashboard-pmsec-group-toggle' + (cfg.groupView === 'blocks' ? ' active' : ''),
			attr: { role: 'button', tabindex: '0', 'aria-label': t('pm.groupView'), title: t('pm.groupView') },
		});
		setIcon(blocksToggle, 'layers');
		blocksToggle.addEventListener('click', () => {
			savePrefs({ groupView: cfg.groupView === 'blocks' ? undefined : 'blocks' });
		});
		const kanbanToggle = toolbar.createDiv({
			cls: 'dashboard-library-view-btn dashboard-pmsec-kanban-toggle' + (cfg.groupView === 'kanban' ? ' active' : ''),
			attr: { role: 'button', tabindex: '0', 'aria-label': t('pm.groupViewKanban'), title: t('pm.groupViewKanban') },
		});
		setIcon(kanbanToggle, 'columns-3');
		kanbanToggle.addEventListener('click', () => {
			savePrefs({ groupView: cfg.groupView === 'kanban' ? undefined : 'kanban' });
		});
		// Card size is GONE as a control (Rae): kanban view always renders
		// compact cards; flat/stacked stay full. The WHOLE row packs RIGHT
		// (Rae, final): count first, then the controls, all flush right.
		toolbar.prepend(countPill);

		// Belt-and-braces: strip cardSize here — the in-memory config (set via
		// updatePmConfig before any parse round-trip) could still carry the
		// retired value. Only the kanban branch re-injects compact.
		renderProjectList(content, lastProjects, app, { ...cfg, cardSize: undefined }, column.name);
	};
	render();
}

/** Kanban grouped view: one horizontal column per group (pipeline-board
 *  geometry); each column stacks its cards vertically, 未分组 parks last. */
function renderKanbanGroups(
	el: HTMLElement,
	projects: readonly PmProject[],
	app: App,
	cfg: NonNullable<DashboardColumn['pmConfig']>,
	columnName: string,
): void {
	const buckets = new Map<string, PmProject[]>();
	for (const project of projects) {
		const key = pmGroupName(project.frontmatter);
		const bucket = buckets.get(key) ?? [];
		bucket.push(project);
		buckets.set(key, bucket);
	}
	const names = [...buckets.keys()].filter(n => n).sort((a, b) => a.localeCompare(b));
	if (buckets.has('')) names.push('');
	const board = el.createDiv({ cls: 'dashboard-pmsec-kanban' });
	if (projects.length === 0) return;
	for (const name of names) {
		const members = buckets.get(name)!;
		const col = board.createDiv({ cls: 'dashboard-pmsec-kcol' });
		const head = col.createDiv({ cls: 'dashboard-pmsec-grouphead' });
		head.createSpan({ cls: 'dashboard-pmsec-grouphead-name', text: name || t('pm.ungroupedGroup') });
		head.createSpan({ cls: 'dashboard-pmsec-grouphead-count', text: String(members.length) });
		const list = col.createDiv({ cls: 'dashboard-pmsec-list dashboard-pmsec-list--col dashboard-pmsec-list--compact' });
		list.dataset.pmList = columnName;
		const kanbanCfg = { ...cfg, cardSize: 'compact' as const };
		for (const project of members) {
			renderProjectCard(list, project, app, kanbanCfg, el, columnName);
		}
		wirePmListDrop(list, el, columnName);
	}
}

/** Flat list or grouped blocks (frontmatter `group` buckets, 未分组 last). */
function renderProjectList(
	el: HTMLElement,
	projects: readonly PmProject[],
	app: App,
	cfg: NonNullable<DashboardColumn['pmConfig']>,
	columnName: string,
): void {
	if (projects.length === 0) return;
	if (cfg.groupView === 'kanban') {
		renderKanbanGroups(el, projects, app, cfg, columnName);
		return;
	}
	if (!cfg.groupView) {
		const list = el.createDiv({ cls: `dashboard-pmsec-list${cfg.cardSize === 'compact' ? ' dashboard-pmsec-list--compact' : ''}` });
		list.dataset.pmList = columnName;
		for (const project of projects) {
			renderProjectCard(list, project, app, cfg, el, columnName);
		}
		wirePmListDrop(list, el, columnName);
		return;
	}
	const buckets = new Map<string, PmProject[]>();
	for (const project of projects) {
		const key = pmGroupName(project.frontmatter);
		const bucket = buckets.get(key) ?? [];
		bucket.push(project);
		buckets.set(key, bucket);
	}
	const names = [...buckets.keys()].filter(n => n).sort((a, b) => a.localeCompare(b));
	if (buckets.has('')) names.push('');
	for (const name of names) {
		const members = buckets.get(name)!;
		const wrap = el.createDiv({ cls: 'dashboard-pmsec-groupwrap' });
		const groupHead = wrap.createDiv({ cls: 'dashboard-pmsec-grouphead' });
		groupHead.createSpan({ cls: 'dashboard-pmsec-grouphead-name', text: name || t('pm.ungroupedGroup') });
		groupHead.createSpan({ cls: 'dashboard-pmsec-grouphead-count', text: String(members.length) });
		const list = wrap.createDiv({ cls: `dashboard-pmsec-list${cfg.cardSize === 'compact' ? ' dashboard-pmsec-list--compact' : ''}` });
		list.dataset.pmList = columnName;
		for (const project of members) {
			renderProjectCard(list, project, app, cfg, el, columnName);
		}
		wirePmListDrop(list, el, columnName);
	}
}

/** HTML5 drag payload type for pm card reordering. */
const PM_DRAG_TYPE = 'application/x-apex-pmcard';

/** Commit a manual order: full path list in display order → dashboard-pm-order
 *  event (view.ts persists into pmConfig.order and refreshes in place). */
function savePmOrder(el: HTMLElement, columnName: string, paths: readonly string[]): void {
	if (paths.length === 0) return;
	el.dispatchEvent(new CustomEvent('dashboard-pm-order', {
		detail: { columnName, order: [...paths] },
		bubbles: true,
	}));
}

/** Whole-list drop zone: dragging over a card inserts before/after it (the
 *  card wires its own dragover), dropping on the grid's empty area parks the
 *  card at the end. */
function wirePmListDrop(list: HTMLElement, el: HTMLElement, columnName: string): void {
	list.addEventListener('dragover', ev => {
		const e = ev as DragEvent;
		if (!e.dataTransfer?.types?.includes(PM_DRAG_TYPE)) return;
		// Only the empty grid region reaches here — cards stopPropagation.
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
	});
	list.addEventListener('drop', ev => {
		const e = ev as DragEvent;
		const name = e.dataTransfer?.getData(PM_DRAG_TYPE) ?? '';
		if (!name) return;
		e.preventDefault();
		e.stopPropagation();
		const paths = Array.from(list.querySelectorAll('.dashboard-pmsec-card'))
			.map(card => (card as HTMLElement).dataset.path!)
			.filter(p => p && p !== name);
		paths.push(name);
		savePmOrder(el, columnName, paths);
	});
}

function renderProjectCard(
	list: HTMLElement,
	project: PmProject,
	app: App,
	cfg: NonNullable<DashboardColumn['pmConfig']>,
	sectionEl: HTMLElement,
	columnName: string,
): void {
	const fm = project.frontmatter;
	const card = list.createDiv({ cls: 'dashboard-pmsec-card', attr: { draggable: 'true' } });
	card.setAttribute('data-path', project.file.path);

	// Drag to reorder: payload = note path; insertion (before/after) is
	// decided on the target card by pointer position.
	card.addEventListener('dragstart', ev => {
		const e = ev as DragEvent;
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(PM_DRAG_TYPE, project.file.path);
		card.addClass('is-dragging');
	});
	card.addEventListener('dragend', () => {
		card.removeClass('is-dragging');
		for (const el of Array.from(list.querySelectorAll('.dashboard-pmsec-card'))) {
			el.removeClass('drop-above', 'drop-below');
		}
	});
	card.addEventListener('dragover', ev => {
		const e = ev as DragEvent;
		if (!e.dataTransfer?.types?.includes(PM_DRAG_TYPE)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		const rect = card.getBoundingClientRect();
		const below = (e.clientY ?? 0) > rect.top + rect.height / 2;
		card.removeClass(below ? 'drop-above' : 'drop-below');
		card.addClass(below ? 'drop-below' : 'drop-above');
	});
	card.addEventListener('dragleave', () => card.removeClass('drop-above', 'drop-below'));
	card.addEventListener('drop', ev => {
		const e = ev as DragEvent;
		const dragged = e.dataTransfer?.getData(PM_DRAG_TYPE) ?? '';
		card.removeClass('drop-above', 'drop-below');
		if (!dragged) return;
		e.preventDefault();
		e.stopPropagation();
		const below = card.hasClass('drop-below');
		const paths = Array.from(list.querySelectorAll('.dashboard-pmsec-card'))
			.map(el => (el as HTMLElement).dataset.path!)
			.filter(p => p && p !== dragged);
		const targetIndex = paths.indexOf(project.file.path);
		paths.splice(targetIndex < 0 ? paths.length : targetIndex + (below ? 1 : 0), 0, dragged);
		savePmOrder(sectionEl, columnName, paths);
	});

	// Stage eyebrow: the badge sits at the card's top-LEFT, above the title
	// (an editorial kicker — gives the layout breathing room).
	const eyebrow = card.createDiv({ cls: 'dashboard-pmsec-eyebrow' });
	const stage = pmField(fm, 'stage');
	if (stage) {
		const badge = eyebrow.createSpan({ cls: 'dashboard-pmsec-badge' });
		badge.createSpan({ cls: 'dashboard-pmsec-badge-dot' });
		badge.createSpan({ cls: 'dashboard-pmsec-badge-text', text: stage });
		badge.style.setProperty('--pmsec-stage', pmStageColor(cfg.stages, stage));
	}
	const group = pmGroupName(fm);
	if (group) {
		eyebrow.createSpan({ cls: 'dashboard-pmsec-groupchip', text: group, attr: { title: group } });
	}

	// Title row (the click-to-open handlers live on the CARD — see below).
	const titleRow = card.createDiv({ cls: 'dashboard-pmsec-title-row' });
	titleRow.createDiv({ cls: 'dashboard-pmsec-title', text: project.file.basename });

	// Whole-card interaction (Rae: the body opens the board, not just the
	// title): single click anywhere non-interactive opens the board after a
	// beat, double click renames. Clicks that land on a button/input/select
	// (work note, skills, archive/delete) are their controls' business.
	// Timer handle works in browser AND the node test runner (window-less).
	let clickTimer: ReturnType<typeof setTimeout> | null = null;
	const isInteractiveTarget = (ev: Event): boolean => {
		const target = ev.target as HTMLElement | null;
		return !!target?.closest?.('button, input, select, textarea, a, label');
	};
	card.addEventListener('click', ev => {
		if (isInteractiveTarget(ev)) return;
		if (clickTimer !== null) return;
		clickTimer = setTimeout(() => {
			clickTimer = null;
			new PmBoardModal(app, project.file, cfg).open();
		}, 220);
	});
	card.addEventListener('dblclick', ev => {
		if (isInteractiveTarget(ev)) return;
		if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null; }
		void (async () => {
			const { showPromptDialog } = await import('./prompt-dialog');
			const name = await showPromptDialog(app, { title: t('pm.board.renamed'), defaultValue: project.file.basename });
			if (!name || name.trim() === project.file.basename) return;
			try {
				const parent = project.file.parent?.path ? `${project.file.parent.path}/` : '';
				await app.fileManager.renameFile(project.file, `${parent}${name.trim()}.md`);
				new Notice(t('pm.board.renamed'));
			} catch {
				new Notice(t('pipeline.renameFailed'));
			}
		})();
	});

	// Intro: the one-line pitch — a proper lede under the title. ALWAYS
	// rendered (empty keeps the reserved 2-line box) so every card's title
	// block and fields start at the same height.
	const intro = pmField(fm, 'intro');
	card.createDiv({ cls: 'dashboard-pmsec-intro', text: intro });

	// Delivery progress — the number a PM reads first: big percentage
	// numeral, then a NODE PER MILESTONE (dots + hairline connectors), then
	// the counts. No stepper when there are no milestones.
	const { done, total } = project.milestones;
	if (total > 0) {
		const pct = Math.round((done / total) * 100);
		const progRow = card.createDiv({ cls: 'dashboard-pmsec-progress-row' });
		progRow.createSpan({ cls: 'dashboard-pmsec-progress-pct', text: `${pct}%` });
		const stepper = progRow.createDiv({ cls: 'dashboard-pmsec-stepper' });
		for (let i = 0; i < total; i++) {
			stepper.createSpan({ cls: `dashboard-pmsec-step ${i < done ? 'is-done' : ''}` });
		}
		progRow.createSpan({ cls: 'dashboard-pmsec-progress-label', text: `${done}/${total}` });
	}

	// Compact size (Rae): head + actions only — the invoice grid and the
	// money strip drop out, cards shrink to the essentials.
	if (cfg.cardSize !== 'compact') renderPmCardBody(card, fm, cfg);

	// Bottom action row (always visible): work note + skill buttons —
	// these are the project's working tools, they belong in plain sight.
	const footActions = card.createDiv({ cls: 'dashboard-pmsec-foot-actions' });
	const isPinned = (cfg.pinned ?? []).includes(project.file.path);
	if (isPinned) card.addClass('is-pinned');
	const workBtn = footActions.createEl('button', {
		cls: 'dashboard-pmsec-foot-btn',
		attr: { type: 'button' },
	});
	// pm.workNoteName (no leading "+"): the icon already carries the "add"
	// affordance — the button label with a "+ " prefix read as two icons.
	setIcon(workBtn.createSpan({ cls: 'dashboard-pmsec-foot-btn-icon' }), 'notebook-pen');
	workBtn.createSpan({ text: t('pm.workNoteName') });
	workBtn.addEventListener('click', () => { void createPmWorkNote(app, project.file, cfg); });
	for (const skill of cfg.skills ?? []) {
		const btn = footActions.createEl('button', {
			cls: 'dashboard-pmsec-foot-btn dashboard-pmsec-foot-btn--skill',
			attr: { type: 'button' },
		});
		setIcon(btn.createSpan({ cls: 'dashboard-pmsec-foot-btn-icon' }), skill.icon || 'sparkles');
		btn.createSpan({ text: skill.label });
		btn.addEventListener('click', () => dispatchPmSkill(app, skill, pmSkillVars(project.file, cfg)));
	}
	const starBtn = footActions.createEl('button', {
		cls: 'dashboard-pmsec-star' + (isPinned ? ' is-active' : ''),
		attr: { type: 'button', 'aria-label': t('pm.pin'), title: t('pm.pin'), 'aria-pressed': String(isPinned) },
	});
	// Same lucide 'star' glyph both states — CSS fills it solid when active.
	setIcon(starBtn, 'star');
	starBtn.addEventListener('click', ev => {
		ev.stopPropagation();
		const current = cfg.pinned ?? [];
		const next = current.includes(project.file.path)
			? current.filter(p => p !== project.file.path)
			: [...current, project.file.path];
		card.dispatchEvent(new CustomEvent('dashboard-pm-pin', {
			detail: { columnName, pinned: next },
			bubbles: true,
		}));
	});

	// Top-right overlay, hover-revealed: just the destructive pair (Rae: three
	// buttons crowded the corner once stage + group chips arrived).
	const actions = card.createDiv({ cls: 'dashboard-pmsec-actions' });
	const archiveBtn = actions.createEl('button', {
		cls: 'dashboard-pmsec-action',
		attr: { type: 'button', 'aria-label': t('pm.board.archive'), title: t('pm.board.archive') },
	});
	setIcon(archiveBtn, 'archive');
	archiveBtn.addEventListener('click', () => { void archivePmProject(app, project.file, cfg); });
	const deleteBtn = actions.createEl('button', {
		cls: 'dashboard-pmsec-action dashboard-pmsec-action--danger',
		attr: { type: 'button', 'aria-label': t('pm.board.delete'), title: t('pm.board.delete') },
	});
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', () => { void deletePmProject(app, project.file); });
}

/** The card's mid+money body: labeled field grid (with the armed alarm on
 *  the key date) and the ALWAYS-rendered money strip — unfilled values show
 *  N/A (Rae) so the layout never shifts up when data is missing. */
function renderPmCardBody(
	card: HTMLElement,
	fm: Record<string, unknown>,
	cfg: NonNullable<DashboardColumn['pmConfig']>,
): void {
	const fields = card.createDiv({ cls: 'dashboard-pmsec-fields' });
	const field = (icon: string, label: string, value: string, extraCls = ''): void => {
		if (!value) return;
		const row = fields.createDiv({ cls: `dashboard-pmsec-field ${extraCls}`.trim() });
		setIcon(row.createSpan({ cls: 'dashboard-pmsec-field-icon' }), icon);
		row.createSpan({ cls: 'dashboard-pmsec-field-label', text: label });
		row.createSpan({ cls: 'dashboard-pmsec-field-value', text: value });
	};
	field('user', t('pm.f.client'), pmField(fm, 'client'));
	field('clipboard-list', t('pm.f.status'), pmField(fm, 'status'));
	field('calendar-range', t('pm.f.cycle'), pmCycleText(fm));
	const keyDate = pmKeyDate(fm);
	if (keyDate) {
		field('target', t('pm.f.keyDate'), keyDate.date, isKeyDateOverdue(keyDate) ? 'dashboard-pmsec-field--overdue' : '');
		// Reminder armed → the same bare red alarm-clock rides the value.
		if (fm['remind'] === true) {
			const row = fields.lastElementChild as HTMLElement | null;
			const bell = row?.createSpan({ cls: 'dashboard-pmsec-remind is-armed', attr: { 'aria-label': t('pm.remindToggle') } });
			if (bell) setIcon(bell, 'alarm-clock');
		}
	}
	field('package', t('pm.f.deliverables'), pmField(fm, 'deliverables'));
	field('footprints', t('pm.f.nextStep'), pmField(fm, 'nextStep'));

	const income = pmIncome(fm);
	const payment = pmField(fm, 'payment');
	const strip = card.createDiv({ cls: 'dashboard-pmsec-money' });
	const left = strip.createDiv({ cls: 'dashboard-pmsec-money-block' });
	left.createSpan({ cls: 'dashboard-pmsec-money-label', text: t('pm.f.income') });
	left.createSpan({
		cls: `dashboard-pmsec-money-value${income > 0 ? '' : ' dashboard-pmsec-money-value--na'}`,
		text: income > 0 ? `¥${Math.round(income).toLocaleString()}` : 'N/A',
	});
	const right = strip.createDiv({ cls: 'dashboard-pmsec-money-block dashboard-pmsec-money-block--right' });
	right.createSpan({ cls: 'dashboard-pmsec-money-label', text: t('pm.f.payment') });
	right.createSpan({
		cls: `dashboard-pmsec-money-value dashboard-pmsec-money-value--muted${payment ? '' : ' dashboard-pmsec-money-value--na'}`,
		text: payment || 'N/A',
	});
	void cfg;
}
