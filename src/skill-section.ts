/**
 * Skills section renderer: an aggregated card grid over the machine's AI
 * skill directories (see skill-store). One card per skill NAME — instances
 * in several stores collapse into source badges (C/X/W) and per-store agent
 * launch buttons. Like rss-section there is deliberately no vault-event
 * wiring: the snapshot lives in skills.json, refreshes on TTL staleness or
 * the header refresh button, and an epoch guard drops late async callbacks
 * from superseded renders.
 *
 * Views: flat (paginated grid) or grouped (user groups from the config —
 * preset buckets until edited — with collapsible sticky headers and a
 * collapse-all pill; the ungrouped bucket paginates at the end). Pinned
 * skills, sort, page size, group assignments and the view mode persist
 * through the dashboard-skills-prefs CustomEvent (view.ts →
 * sync.updateSkillsConfig).
 */

import { App, Menu, Notice, setIcon } from 'obsidian';
import type { DashboardColumn, DashboardSettings, SkillsSectionConfig, SkillSectionGroup } from './types';
import { t } from './i18n';
import {
	copySkillPath, desktopSkillFs, effectiveSkillGroups, getSkillLibraryStore, groupSkillEntries,
	resolveSkillGroup, resolveSkillStores, revealSkillFolder, skillStoreAgent, skillStoreBadge,
	UNGROUPED_ASSIGNMENT, type SkillFs, type SkillGroup,
	type SkillLibraryStore, type SkillStoreDef,
} from './skill-store';
import { AgentPromptModal } from './agent-prompt-modal';
import { captureScrollStates, restoreScrollStates } from './scroll-preserve';
import { createToolbarDropdown, type ToolbarDropdownItem } from './toolbar-dropdown';
import { renderPagination } from './library-section';
import { SkillDetailModal } from './skill-detail-modal';
import { SkillGroupPickerModal } from './skill-group-picker-modal';
import { momentOf } from './datetime';

/** Test seams only — production call sites (renderer) pass neither. */
export interface SkillSectionOptions {
	fs?: SkillFs;
	store?: SkillLibraryStore;
	/** Overrides the custom-folders CSV (production reads settings). */
	foldersCsv?: string;
}

const SKILLSEC_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];
const SKILLSEC_DEFAULT_PAGE_SIZE = 50;

/** Agent button icon per home store (the label beside it is the brand). */
const STORE_AGENT_ICON: Record<string, string> = {
	claude: 'bot',
	codex: 'terminal',
	workbuddy: 'message-circle',
};

/** Collapse-set key for the ungrouped bucket — doubles as the explicit
 * "keep out of groups" assignment value (see UNGROUPED_ASSIGNMENT). */
const UNGROUPED_KEY = UNGROUPED_ASSIGNMENT;

/** HTML5 drag payload type for kanban card→column regrouping. */
const SKILL_DRAG_TYPE = 'application/x-apex-skill';

/** Filter-dropdown key for the pinned-only bucket (never a store id). */
const PINNED_FILTER_KEY = '__pinned__';

export function renderSkillSection(
	el: HTMLElement,
	column: DashboardColumn,
	app: App,
	settings: DashboardSettings | undefined,
	reloadRegister: (fn: () => void) => void,
	options?: SkillSectionOptions,
): void {
	const config: SkillsSectionConfig = column.skillsConfig ?? {};
	const store = options?.store ?? getSkillLibraryStore(app);
	// Desktop fs seam; undefined on mobile → the section renders the cached
	// snapshot read-only (import/reveal/delete hidden).
	const fs = options?.fs ?? desktopSkillFs();
	const desktop = !!fs;
	const foldersCsv = options?.foldersCsv ?? settings?.skillSourceFolders ?? '';
	const groups = effectiveSkillGroups(config.groups);

	// UI store defs: home stores always (labels/agent map are static); custom
	// folders only resolve on desktop where '~' can expand.
	const stores: SkillStoreDef[] = fs
		? resolveSkillStores(foldersCsv, fs.homeDir())
		: resolveSkillStores('', '/');
	const visibleStoreIds = new Set(
		config.stores?.length ? config.stores : ['claude', 'codex', 'workbuddy'],
	);
	const content = el.createDiv({ cls: 'dashboard-skillsec-content' });

	// Async-race guard: every run() bumps the epoch; late callbacks from a
	// superseded run (refresh, in-place section rebuild) compare and drop.
	let epoch = 0;
	let pending = true;
	let scanning = false;
	let searchText = '';
	let storeFilter = 'all';
	// Pagination (library idiom): page resets on filter/search changes; a
	// page-size change rebuilds the whole section (config round trip).
	let currentPage = 1;
	// Collapsed group ids (in-memory view state — collapse never persists).
	const collapsedGroups = new Set<string>();

	// Toolbar is built once per render — rebuilding it on every keystroke
	// would drop the search input's focus; only the results area re-renders.
	let resultsEl: HTMLElement | null = null;
	let scanningEl: HTMLElement | null = null;
	let collapseAllBtn: HTMLElement | null = null;

	function allGroups(): SkillGroup[] {
		const aggregated = groupSkillEntries(store.entries(), stores.map(s => s.id));
		const pinned = new Set(config.pinned ?? []);
		const pinnedFirst = (config.pinned ?? [])
			.map(name => aggregated.find(g => g.name === name))
			.filter((g): g is SkillGroup => !!g);
		const rest = aggregated.filter(g => !pinned.has(g.name));
		// Direction: name defaults asc, recent defaults desc (newest first) —
		// only the flipped case persists in the config.
		const mode = config.sortMode ?? 'name';
		const desc = (config.sortDir ?? (mode === 'recent' ? 'desc' : 'asc')) === 'desc';
		if (mode === 'recent') {
			rest.sort((a, b) => {
				const delta = Math.max(...a.instances.map(i => i.mtimeMs)) - Math.max(...b.instances.map(i => i.mtimeMs));
				return desc ? -delta : delta;
			});
		} else {
			rest.sort((a, b) => desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
		}
		return [...pinnedFirst, ...rest];
	}

	function filteredGroups(): SkillGroup[] {
		const pinned = new Set(config.pinned ?? []);
		return allGroups().filter(group => {
			if (storeFilter === PINNED_FILTER_KEY) {
				if (!pinned.has(group.name)) return false;
			} else if (storeFilter !== 'all' && !group.instances.some(inst => inst.storeId === storeFilter)) return false;
			const q = searchText.trim().toLowerCase();
			if (!q) return true;
			return group.name.toLowerCase().includes(q) || group.description.toLowerCase().includes(q);
		});
	}

	function savePrefs(prefs: Partial<SkillsSectionConfig>): void {
		el.dispatchEvent(new CustomEvent('dashboard-skills-prefs', {
			detail: { columnName: column.name, prefs },
			bubbles: true,
		}));
	}

	function togglePinned(name: string): void {
		const pinned = config.pinned ?? [];
		const next = pinned.includes(name) ? pinned.filter(n => n !== name) : [...pinned, name];
		savePrefs({ pinned: next });
	}

	/** Assign a skill to a group (null = explicitly ungrouped, which blocks
	 *  keyword auto-matching — without the sentinel a keyword-hit skill
	 *  dragged to 未分组 would snap right back). */
	function assignGroup(skillName: string, groupId: string | null): void {
		const next = { ...(config.assignments ?? {}) };
		next[skillName] = groupId ?? UNGROUPED_ASSIGNMENT;
		savePrefs({ assignments: next });
	}

	function buildToolbar(): void {
		const toolbar = content.createDiv({ cls: 'dashboard-skillsec-toolbar' });

		const searchInput = toolbar.createEl('input', {
			cls: 'dashboard-skillsec-search',
			attr: { type: 'text', placeholder: t('skills.searchPh'), 'aria-label': t('skills.searchPh') },
		});
		searchInput.value = searchText;
		searchInput.addEventListener('input', () => {
			searchText = searchInput.value;
			currentPage = 1;
			renderResults();
		});

		// Store filter: all + pinned-only + one bucket per visible store,
		// counts included. 'filter' = the funnel every section's filter uses.
		const current = allGroups();
		const pinnedSet = new Set(config.pinned ?? []);
		const filterItems: ToolbarDropdownItem[] = [
			{ key: 'all', label: t('skills.filterAll'), icon: 'filter', count: current.length },
			{ key: PINNED_FILTER_KEY, label: t('skills.filterPinned'), icon: 'pin', count: current.filter(g => pinnedSet.has(g.name)).length },
			...stores.filter(s => visibleStoreIds.has(s.id) || s.id.startsWith('custom:')).map((s): ToolbarDropdownItem => ({
				key: s.id,
				label: s.label,
				icon: s.id.startsWith('custom:') ? 'folder' : 'hard-drive',
				count: current.filter(g => g.instances.some(inst => inst.storeId === s.id)).length,
			})),
		];
		if (!filterItems.some(item => item.key === storeFilter)) storeFilter = 'all';
		createToolbarDropdown(toolbar, storeFilter, filterItems, key => {
			storeFilter = key;
			currentPage = 1;
			// Rebuild the toolbar too — the dropdown pill/checkboxes carry a
			// build-time snapshot of the active key, so they'd go stale (the
			// search input keeps its value through the rebuild).
			renderAll();
		});

		// Sort: mode × direction in one menu (name asc/desc, recent newest/
		// oldest). Icons validated against Obsidian's bundled Lucide dict.
		const currentSortKey = () => {
			const mode = config.sortMode ?? 'name';
			const desc = (config.sortDir ?? (mode === 'recent' ? 'desc' : 'asc')) === 'desc';
			return mode === 'recent' ? (desc ? 'recent-desc' : 'recent-asc') : (desc ? 'name-desc' : 'name-asc');
		};
		const sortItems: ToolbarDropdownItem[] = [
			{ key: 'name-asc', label: t('skills.sortNameAsc'), icon: 'arrow-down-up' },
			{ key: 'name-desc', label: t('skills.sortNameDesc'), icon: 'arrow-down-up' },
			{ key: 'recent-desc', label: t('skills.sortRecentNewest'), icon: 'history' },
			{ key: 'recent-asc', label: t('skills.sortRecentOldest'), icon: 'history' },
		];
		createToolbarDropdown(toolbar, currentSortKey(), sortItems, key => {
			const [mode, dir] = key.split('-');
			const isDefault = (mode === 'name' && dir === 'asc') || (mode === 'recent' && dir === 'desc');
			savePrefs(isDefault ? { sortMode: undefined, sortDir: undefined } : { sortMode: mode as 'name' | 'recent', sortDir: dir as 'asc' | 'desc' });
		});

		// View toggles: one pill per grouped mode, click again to go flat.
		// 'active' mirrors the ticktick view-toggle convention.
		const groupToggle = toolbar.createDiv({
			cls: 'dashboard-library-view-btn dashboard-skillsec-toggle' + (config.groupView === 'groups' ? ' active' : ''),
			attr: { role: 'button', tabindex: '0', 'aria-label': t('skills.viewGroups'), title: t('skills.viewGroups') },
		});
		setIcon(groupToggle, 'layers');
		groupToggle.addEventListener('click', () => {
			savePrefs({ groupView: config.groupView === 'groups' ? undefined : 'groups' });
		});
		const kanbanToggle = toolbar.createDiv({
			cls: 'dashboard-library-view-btn dashboard-skillsec-toggle' + (config.groupView === 'kanban' ? ' active' : ''),
			attr: { role: 'button', tabindex: '0', 'aria-label': t('skills.viewKanban'), title: t('skills.viewKanban') },
		});
		setIcon(kanbanToggle, 'square-kanban');
		kanbanToggle.addEventListener('click', () => {
			savePrefs({ groupView: config.groupView === 'kanban' ? undefined : 'kanban' });
		});

		// Collapse-all pill (either grouped mode): collapses every visible
		// group when any is open, expands all when none is.
		if (config.groupView) {
			collapseAllBtn = toolbar.createDiv({
				cls: 'dashboard-library-view-btn dashboard-skillsec-collapse-all',
				attr: { role: 'button', tabindex: '0', 'aria-label': t('skills.collapseAll'), title: t('skills.collapseAll') },
			});
			syncCollapseAllIcon();
			collapseAllBtn.addEventListener('click', () => {
				const keys = visibleGroupKeys();
				const anyOpen = keys.some(key => !collapsedGroups.has(key));
				for (const key of keys) {
					if (anyOpen) collapsedGroups.add(key);
					else collapsedGroups.delete(key);
				}
				syncCollapseAllIcon();
				// Flip the blocks in place — no re-render, scroll stays put.
				for (const block of Array.from(content.querySelectorAll('[data-group-key]'))) {
					block.classList[anyOpen ? 'add' : 'remove']('is-collapsed');
				}
			});
		}

		// Import opens from view.ts (needs the plugin for skillSourceFolders
		// and the remember-registry); the section just signals.
		if (desktop) {
			const importBtn = toolbar.createEl('button', {
				cls: 'dashboard-modal-btn dashboard-modal-btn--confirm dashboard-skillsec-import',
				text: t('skills.import'),
				attr: { type: 'button' },
			});
			importBtn.addEventListener('click', () => {
				el.dispatchEvent(new CustomEvent('dashboard-skills-import', {
					detail: { columnName: column.name },
					bubbles: true,
				}));
			});
		}

		scanningEl = toolbar.createSpan({ cls: 'dashboard-skillsec-scanning' + (scanning ? '' : ' is-hidden'), text: t('skills.scanning') });

		// Page size (library-section idiom): a plain select whose change rides
		// a CustomEvent to view.ts, which persists it and rebuilds the section.
		toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
		const pageSize = config.pageSize ?? SKILLSEC_DEFAULT_PAGE_SIZE;
		const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
		for (const size of SKILLSEC_PAGE_SIZE_OPTIONS) {
			const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: String(size) }), attr: { value: String(size) } });
			if (size === pageSize) opt.selected = true;
		}
		pageSizeSelect.addEventListener('change', () => {
			const newSize = parseInt(pageSizeSelect.value) || SKILLSEC_DEFAULT_PAGE_SIZE;
			savePrefs({ pageSize: newSize === SKILLSEC_DEFAULT_PAGE_SIZE ? undefined : newSize });
		});
	}

	/** Group ids that currently have a rendered header (ungrouped included). */
	function visibleGroupKeys(): string[] {
		const filtered = filteredGroups();
		const keys = groups.filter(g => filtered.some(item => resolveSkillGroup(item.name, groups, config.assignments)?.id === g.id)).map(g => g.id);
		if (filtered.some(item => !resolveSkillGroup(item.name, groups, config.assignments))) keys.push(UNGROUPED_KEY);
		return keys;
	}

	function syncCollapseAllIcon(): void {
		if (!collapseAllBtn) return;
		const anyOpen = visibleGroupKeys().some(key => !collapsedGroups.has(key));
		setIcon(collapseAllBtn, anyOpen ? 'chevrons-down-up' : 'chevrons-up-down');
	}

	function syncScanning(): void {
		if (scanningEl) scanningEl.classList[scanning ? 'remove' : 'add']('is-hidden');
	}

	function renderResults(): void {
		if (!resultsEl) return;
		resultsEl.empty();

		const filtered = filteredGroups();
		const countIn = (id: string): number => filtered.filter(g => g.instances.some(inst => inst.storeId === id)).length;
		resultsEl.createDiv({
			cls: 'dashboard-skillsec-stats',
			text: t('skills.statSummary', {
				total: String(filtered.length),
				claude: String(countIn('claude')),
				codex: String(countIn('codex')),
				workbuddy: String(countIn('workbuddy')),
			}),
		});

		if (config.groupView === 'kanban') renderKanbanResults(filtered);
		else if (config.groupView === 'groups') renderGroupedResults(filtered);
		else renderFlatResults(filtered);
	}

	/** Buckets shared by both grouped modes: config-ordered groups then the
	 *  ungrouped backlog last. */
	function groupBuckets(filtered: readonly SkillGroup[]): Array<{ key: string; name: string | null; members: SkillGroup[] }> {
		const buckets: Array<{ key: string; name: string | null; members: SkillGroup[] }> = [];
		for (const group of groups) {
			const members = filtered.filter(item => resolveSkillGroup(item.name, groups, config.assignments)?.id === group.id);
			if (members.length > 0) buckets.push({ key: group.id, name: group.name, members });
		}
		const ungrouped = filtered.filter(item => !resolveSkillGroup(item.name, groups, config.assignments));
		if (ungrouped.length > 0) buckets.push({ key: UNGROUPED_KEY, name: null, members: ungrouped });
		return buckets;
	}

	/** A group header: chevron + name + count; click toggles collapse. */
	function renderGroupHead(block: HTMLElement, bucket: { key: string; name: string | null; members: SkillGroup[] }): void {
		const head = block.createDiv({ cls: 'dashboard-skillsec-group-head', attr: { role: 'button', tabindex: '0' } });
		const chevron = head.createSpan({ cls: 'dashboard-skillsec-group-chevron' });
		setIcon(chevron, 'chevron-down');
		head.createSpan({ cls: 'dashboard-skillsec-group-name', text: bucket.name ?? t('skills.ungrouped') });
		head.createSpan({ cls: 'dashboard-skillsec-group-count', text: String(bucket.members.length) });
		head.addEventListener('click', () => {
			if (collapsedGroups.has(bucket.key)) collapsedGroups.delete(bucket.key);
			else collapsedGroups.add(bucket.key);
			block.classList.toggle('is-collapsed');
			syncCollapseAllIcon();
		});
		head.addEventListener('keydown', ev => {
			const key = (ev as KeyboardEvent).key;
			if (key === 'Enter' || key === ' ') {
				ev.preventDefault();
				head.click();
			}
		});
	}

	function renderGroupedResults(filtered: readonly SkillGroup[]): void {
		const container = resultsEl!.createDiv({ cls: 'dashboard-skillsec-groups' });
		const buckets = groupBuckets(filtered);
		for (const bucket of buckets) {
			const collapsed = collapsedGroups.has(bucket.key);
			// The ungrouped bucket paginates (it is the whole backlog);
			// curated groups render every member.
			const members = bucket.key === UNGROUPED_KEY ? paginateUngrouped(bucket.members) : bucket.members;
			const block = container.createDiv({ cls: `dashboard-skillsec-group${collapsed ? ' is-collapsed' : ''}` });
			block.dataset.groupKey = bucket.key;
			renderGroupHead(block, bucket);
			const grid = block.createDiv({ cls: 'dashboard-skillsec-grid dashboard-skillsec-group-grid' });
			renderIntoGrid(grid, members);
		}
		if (buckets.length === 0) {
			container.createDiv({ cls: 'dashboard-skillsec-empty', text: emptyText(filtered.length) });
			return;
		}
		// Pagination under the ungrouped bucket only, when it has pages.
		const ungrouped = filtered.filter(item => !resolveSkillGroup(item.name, groups, config.assignments));
		const effectivePageSize = config.pageSize ?? SKILLSEC_DEFAULT_PAGE_SIZE;
		if (ungrouped.length > effectivePageSize) {
			const totalPages = Math.max(1, Math.ceil(ungrouped.length / effectivePageSize));
			renderPaginationIfPages(totalPages, ungrouped.length);
		}
	}

	/** Kanban: one column per group, horizontally scrolling (pipeline-board
	 *  geometry); collapse per column works the same as the stacked mode.
	 *  Columns double as drop targets — dragging a card onto another column
	 *  assigns it to that group (desktop HTML5 DnD; touch keeps the card
	 *  menu's 设置分组). */
	function renderKanbanResults(filtered: readonly SkillGroup[]): void {
		const container = resultsEl!.createDiv({ cls: 'dashboard-skillsec-kanban' });
		const buckets = groupBuckets(filtered);
		for (const bucket of buckets) {
			const collapsed = collapsedGroups.has(bucket.key);
			const members = bucket.key === UNGROUPED_KEY ? paginateUngrouped(bucket.members) : bucket.members;
			const col = container.createDiv({ cls: `dashboard-skillsec-kcol${collapsed ? ' is-collapsed' : ''}` });
			col.dataset.groupKey = bucket.key;
			renderGroupHead(col, bucket);
			const list = col.createDiv({ cls: 'dashboard-skillsec-kcol-list' });
			for (const group of members) renderCard(list, group, true);
			wireColumnDropTarget(col, bucket.key);
		}
		if (buckets.length === 0) {
			container.createDiv({ cls: 'dashboard-skillsec-empty', text: emptyText(filtered.length) });
		}
	}

	/** Highlight on hover, assign on drop. Only our drag type lights the
	 *  column up — external drags pass through untouched. */
	function wireColumnDropTarget(col: HTMLElement, groupKey: string): void {
		col.addEventListener('dragover', ev => {
			const e = ev as DragEvent;
			if (!e.dataTransfer?.types?.includes(SKILL_DRAG_TYPE)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			col.addClass('is-drop-target');
		});
		col.addEventListener('dragleave', () => col.removeClass('is-drop-target'));
		col.addEventListener('drop', ev => {
			const e = ev as DragEvent;
			col.removeClass('is-drop-target');
			const name = e.dataTransfer?.getData(SKILL_DRAG_TYPE) ?? '';
			if (!name) return;
			e.preventDefault();
			if (resolveSkillGroup(name, groups, config.assignments)?.id === groupKey) return; // same group: no-op
			assignGroup(name, groupKey === UNGROUPED_KEY ? null : groupKey);
		});
	}

	function renderFlatResults(filtered: readonly SkillGroup[]): void {
		const effectivePageSize = config.pageSize ?? SKILLSEC_DEFAULT_PAGE_SIZE;
		const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
		if (currentPage > totalPages) currentPage = totalPages;
		const pageGroups = filtered.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

		const grid = resultsEl!.createDiv({ cls: 'dashboard-skillsec-grid' });
		renderIntoGrid(grid, pageGroups);
		renderEmptyIfNeeded(grid, filtered.length, filtered.length);
		renderPaginationIfPages(totalPages, filtered.length);
	}

	function paginateUngrouped(members: readonly SkillGroup[]): SkillGroup[] {
		const effectivePageSize = config.pageSize ?? SKILLSEC_DEFAULT_PAGE_SIZE;
		const totalPages = Math.max(1, Math.ceil(members.length / effectivePageSize));
		if (currentPage > totalPages) currentPage = totalPages;
		return members.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
	}

	function renderIntoGrid(grid: HTMLElement, groupsToRender: readonly SkillGroup[]): void {
		for (const group of groupsToRender) renderCard(grid, group);
	}

	function renderEmptyIfNeeded(grid: HTMLElement, filteredCount: number, totalCount: number): void {
		if (filteredCount > 0) return;
		grid.createDiv({ cls: 'dashboard-skillsec-empty', text: emptyText(totalCount) });
	}

	function emptyText(totalCount: number): string {
		if (pending || scanning) return t('skills.scanning');
		if (totalCount > 0) return t('skills.noMatches');
		return desktop ? t('skills.emptyHint') : t('skills.desktopOnly');
	}

	function renderPaginationIfPages(totalPages: number, totalCount: number): void {
		if (totalPages <= 1) return;
		const paginationArea = resultsEl!.createDiv({ cls: 'dashboard-library-pagination' });
		renderPagination(paginationArea, currentPage, totalPages, totalCount, page => {
			currentPage = page;
			renderResults();
			const gridEl = resultsEl?.querySelector('.dashboard-skillsec-grid');
			if (gridEl) gridEl.scrollTop = 0;
		});
	}

	function renderCard(grid: HTMLElement, group: SkillGroup, kanbanDraggable = false): void {
		const pinned = (config.pinned ?? []).includes(group.name);
		const card = grid.createDiv({
			cls: `dashboard-skillsec-card${pinned ? ' is-pinned' : ''}`,
			attr: { role: 'button', tabindex: '0', ...(kanbanDraggable ? { draggable: 'true' } : {}) },
		});
		card.dataset.skill = group.name;
		if (kanbanDraggable) {
			card.addEventListener('dragstart', ev => {
				const e = ev as DragEvent;
				if (!e.dataTransfer) return;
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData(SKILL_DRAG_TYPE, group.name);
				card.addClass('is-dragging');
			});
			card.addEventListener('dragend', () => card.removeClass('is-dragging'));
		}

		const primary = group.instances[0]!;
		const top = card.createDiv({ cls: 'dashboard-skillsec-card-top' });
		const nameRow = top.createDiv({ cls: 'dashboard-skillsec-name-row' });
		if (pinned) {
			const pin = nameRow.createSpan({ cls: 'dashboard-skillsec-pin' });
			setIcon(pin, 'pin');
		}
		nameRow.createSpan({ cls: 'dashboard-skillsec-name', text: group.name });
		// Second line: source badges (tooltip = full path, the only path UI
		// on the card — Rae: badges already tell the agent story) + update
		// date tucked right.
		const badges = top.createDiv({ cls: 'dashboard-skillsec-badges' });
		for (const instance of group.instances) {
			badges.createSpan({
				cls: `dashboard-skillsec-badge is-${instance.storeId.startsWith('custom:') ? 'custom' : instance.storeId}`,
				text: skillStoreBadge(instance.storeId),
				attr: { title: instance.dirPath },
			});
		}
		const m = momentOf(primary.mtimeMs);
		if (m.isValid()) {
			badges.createSpan({
				cls: 'dashboard-skillsec-date',
				text: m.format('YYYY-MM-DD'),
				attr: { title: m.format('YYYY-MM-DD HH:mm') },
			});
		}

		if (group.description) {
			card.createDiv({ cls: 'dashboard-skillsec-desc', text: group.description });
		}

		// Launch buttons: one per home store the skill is installed in — the
		// button set itself reflects availability (a codex-only skill never
		// offers a Claude send). Custom-folder instances feed every agent's
		// picker, so they add no dedicated button.
		const actions = card.createDiv({ cls: 'dashboard-skillsec-actions' });
		if (desktop) {
			for (const instance of group.instances) {
				const agent = skillStoreAgent(instance.storeId);
				if (!agent) continue;
				const btn = actions.createEl('button', {
					cls: 'dashboard-skillsec-launch',
					attr: { type: 'button', 'aria-label': t('skills.launch', { agent }), title: t('skills.launch', { agent }) },
				});
				setIcon(btn, STORE_AGENT_ICON[instance.storeId] ?? 'sparkles');
				btn.createSpan({ cls: 'dashboard-skillsec-launch-label', text: agent === 'claudian' ? 'Claude' : agent === 'codex' ? 'Codex' : 'WorkBuddy' });
				btn.addEventListener('click', ev => {
					ev.stopPropagation();
					new AgentPromptModal(app, { label: group.name, skillName: group.name, promptTemplate: '' }, agent, {}).open();
				});
			}
		}

		const menuBtn = card.createEl('button', {
			cls: 'dashboard-skillsec-menu',
			attr: { type: 'button', 'aria-label': t('skills.cardMenu'), title: t('skills.cardMenu') },
		});
		setIcon(menuBtn, 'ellipsis');
		menuBtn.addEventListener('click', ev => {
			ev.stopPropagation();
			openCardMenu(ev, group);
		});

		card.addEventListener('click', () => openDetail(group));
		card.addEventListener('keydown', ev => {
			const key = (ev as KeyboardEvent).key;
			if (key === 'Enter' || key === ' ') {
				ev.preventDefault();
				openDetail(group);
			}
		});
	}

	function openCardMenu(ev: MouseEvent, group: SkillGroup): void {
		const pinned = (config.pinned ?? []).includes(group.name);
		const assigned = resolveSkillGroup(group.name, groups, config.assignments);
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(pinned ? t('skills.unpin') : t('skills.pin'))
			.setIcon(pinned ? 'pin-off' : 'pin')
			.onClick(() => togglePinned(group.name)));
		menu.addItem(item => item
			.setTitle(assigned
				? t('skills.regroupFrom', { group: assigned.name })
				: t('skills.setGroup'))
			.setIcon('folder-input')
			.onClick(() => openGroupPicker(group)));
		menu.addItem(item => item
			.setTitle(t('skills.detail'))
			.setIcon('info')
			.onClick(() => openDetail(group)));
		if (desktop) {
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle(t('skills.copyPath'))
				.setIcon('copy')
				.onClick(() => {
					void copySkillPath(group.instances[0]!.dirPath).then(ok => {
						new Notice(ok ? t('skills.copied') : t('skills.copyFailed'));
					});
				}));
			menu.addItem(item => item
				.setTitle(t('skills.reveal'))
				.setIcon('folder-open')
				.onClick(() => revealSkillFolder(group.instances[0]!.dirPath)));
			// Multi-instance deletion picks its target inside the detail modal
			// (per-instance rows); a single instance can go straight to it.
			if (group.instances.length === 1) {
				menu.addItem(item => item
					.setTitle(t('skills.remove'))
					.setIcon('trash-2')
					.onClick(() => openDetail(group, true)));
			}
		}
		menu.showAtMouseEvent(ev);
	}

	function openGroupPicker(group: SkillGroup): void {
		new SkillGroupPickerModal(app, groups, resolveSkillGroup(group.name, groups, config.assignments)?.id ?? null, pick => {
			assignGroup(group.name, pick);
		}).open();
	}

	function openDetail(group: SkillGroup, focusDelete = false): void {
		new SkillDetailModal(app, group, {
			fs,
			pinned: (config.pinned ?? []).includes(group.name),
			onTogglePin: () => togglePinned(group.name),
			onChanged: () => void run(true),
			focusDelete,
		}).open();
	}

	function renderAll(): void {
		content.empty();
		resultsEl = null;
		scanningEl = null;
		collapseAllBtn = null;
		buildToolbar();
		resultsEl = content.createDiv({ cls: 'dashboard-skillsec-results' });
		renderResults();
	}

	function rerenderResultsPreservingScroll(): void {
		const states = captureScrollStates(content);
		renderAll();
		restoreScrollStates(content, states);
	}

	async function run(force: boolean): Promise<void> {
		const my = ++epoch;
		await store.load();
		pending = false;
		if (epoch !== my) return;
		renderAll();
		// Mobile (no fs): the cached snapshot is the whole view. Desktop:
		// rescan when forced, never scanned, or past the TTL — steady-state
		// scans cost one stat per skill folder (mtime-keyed cache).
		if (fs && (force || store.isStale())) {
			scanning = true;
			syncScanning();
			try {
				await store.rescan(fs, foldersCsv);
			} catch (err) {
				console.error('[Dashboard] skill scan failed:', err);
			}
			scanning = false;
			if (epoch !== my) return;
			rerenderResultsPreservingScroll();
		}
	}

	reloadRegister(() => {
		void run(true);
	});

	void run(false);
}
