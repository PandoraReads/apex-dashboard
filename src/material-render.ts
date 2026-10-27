/**
 * Material library renderer (素材库): the full-page waterfall surface shared
 * by the standalone ItemView and the render harness. Owns the toolbar
 * (search / type / sort / group / density / tag filter / collapse-all), the
 * aspect-measured masonry (tiles placed by shortest-column over probed image
 * ratios), multi-select with a right floating action rail (select toggle +
 * skill buttons + batch actions, icons only) and rubber-band drag selection
 * over the tiles, a left group-nav rail in grouped views, and per-tile file
 * management (tag, rename, move, delete, copy path).
 *
 * Pure scanning/filter/sort/group/column math lives in material-model.ts;
 * this module only wires DOM + Obsidian services.
 */

import { App, Notice, Platform, TFile, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { t } from './i18n';
import { showConfirmDialog } from './confirm-dialog';
import { MediaLightboxModal } from './media-lightbox-modal';
import { MediaTagEditModal } from './media-tag-editor-modal';
import { releaseVideoMedia, createLazyVideoMounter } from './media-section';
import { extractCoverValue, renderPagination, renderTagsSelector } from './library-section';
import { renameMediaFile, trashMediaFile } from './media-utils';
import { resolveVaultImage } from './banner';
import { createToolbarDropdown } from './toolbar-dropdown';
import { PathPickerModal } from './path-picker-modal';
import { dispatchSkill } from './pipeline-section';
import { renderSectionRail } from './section-rail';
import { momentOf } from './datetime';
import { MATERIAL_DROPZONE_CLASS, wireMaterialDrop } from './material-drop';
import type { MaterialLibraryConfig, MaterialSkillButton } from './types';
import {
	assignWaterfall,
	buildMaterialItems,
	effectiveMaterialTemplate,
	filterMaterialItems,
	groupMaterialItems,
	materialColumnCount,
	materialSkillVars,
	MATERIAL_IMAGE_ASPECT,
	MATERIAL_RENDER_CEILING,
	MATERIAL_VIDEO_ASPECT,
	paginateMaterial,
	sortMaterialItems,
	type MaterialDensity,
	type MaterialFileRecord,
	type MaterialGroup,
	type MaterialGroupMode,
	type MaterialItem,
	type MaterialKindFilter,
	type MaterialSortBy,
} from './material-model';

/** localStorage key for the persisted waterfall density preference. */
const DENSITY_STORAGE_KEY = 'apex-dashboard-material-density';
/** localStorage key for the card style: 'plain' (cover-only, the original
 *  look) or 'polaroid' (Pin-style paper card). Per-device preference,
 *  like density. */
const CARD_STYLE_STORAGE_KEY = 'apex-dashboard-material-card-style';
export type MaterialCardStyle = 'plain' | 'polaroid';
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** Tag-store surface the renderer needs (satisfied by MediaTagService). */
export interface MaterialTagStore {
	getTags(path: string): string[];
	getAllTags(): string[];
	setTags(path: string, tags: readonly string[]): boolean;
}

/** Favorites (heart) hooks — the view backs them with settings so the
 *  collection syncs with the vault; the renderer only reads and toggles. */
export interface MaterialFavoritesHooks {
	has(path: string): boolean;
	/** Flip one path; returns the resulting state. */
	toggle(path: string): boolean;
}

export interface MaterialRenderContext {
	app: App;
	/** Fresh config per render — a GETTER, not a snapshot object: settings
	 *  edits (e.g. the scan scope) must reach the very next refresh, so the
	 *  view re-reads plugin.settings through this on every render(). */
	getConfig(): MaterialLibraryConfig;
	/** Persist a config change (the view wires saveSettings + refresh). */
	onConfigChange(cfg: MaterialLibraryConfig): void;
	/** Open the settings modal (the view owns it). */
	onOpenSettings(): void;
	tagStore: MaterialTagStore | null;
	favorites?: MaterialFavoritesHooks;
}

/** Controller handed back to the view: external refresh + teardown. */
export interface MaterialRenderController {
	refresh(): void;
	destroy(): void;
}

/** rAF that also works under the node test harness. */
const nextFrame = (fn: () => void): number =>
	typeof requestAnimationFrame === 'function'
		? requestAnimationFrame(fn)
		: window.setTimeout(fn, 0);

/** Probe an image's natural aspect off-DOM; resolves 0 when unknown
 *  (unsupported format / load error / timeout). Never rejects. */
function probeAspect(src: string): Promise<number> {
	return new Promise(resolve => {
		const ImageCtor = (globalThis as { Image?: typeof Image }).Image;
		if (typeof ImageCtor !== 'function') { resolve(0); return; }
		const img = new ImageCtor();
		let settled = false;
		const finish = (v: number): void => {
			if (settled) return;
			settled = true;
			resolve(v);
		};
		img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0);
		img.onerror = () => finish(0);
		window.setTimeout(() => finish(0), 8000);
		img.src = src;
	});
}

/** Read the stored density, defaulting to medium on absent/garbage. */
function readStoredDensity(app: App): MaterialDensity {
	const stored = app.loadLocalStorage(DENSITY_STORAGE_KEY) as string | null;
	return stored === 'small' || stored === 'large' ? stored : 'medium';
}

/** Read the stored card style, defaulting to the Pin polaroid on
 *  absent/garbage (Rae's current default look). */
function readStoredCardStyle(app: App): MaterialCardStyle {
	const stored = app.loadLocalStorage(CARD_STYLE_STORAGE_KEY) as string | null;
	return stored === 'plain' ? 'plain' : 'polaroid';
}

/** Render the whole material library into `host`. Returns a controller. */
export function renderMaterialLibrary(
	host: HTMLElement,
	ctx: MaterialRenderContext,
	_hoverParent?: HoverParent | null,
): MaterialRenderController {
	const { app, tagStore } = ctx;
	/** Live config: re-read through the getter at the top of every render so
	 *  settings-modal changes (scan scope, skill buttons) apply immediately. */
	let config = ctx.getConfig();

	const content = host.createDiv({ cls: 'dashboard-material-content' });

	// ---- toolbar state --------------------------------------------------
	let sortBy: MaterialSortBy = 'modified';
	let sortDesc = true;
	let groupBy: MaterialGroupMode = 'none';
	let kindFilter: MaterialKindFilter = 'all';
	let filterTags: string[] = [];
	let selectMode = false;
	/** Favorites-only view toggle (heart button in the toolbar). */
	let favoritesOnly = false;
	let pageSize = 50;
	let currentPage = 1;
	const density: { value: MaterialDensity } = { value: readStoredDensity(app) };
	/** Card look: 'plain' = cover-only tiles (the original style), 'polaroid'
	 *  = Pin paper cards. Toolbar button flips it; persisted per device. */
	const cardStyle: { value: MaterialCardStyle } = { value: readStoredCardStyle(app) };
	const selected = new Set<string>();
	const collapsedGroups = new Set<string>();
	/** Measured image aspects keyed by path — survives re-renders. */
	const aspectCache = new Map<string, number>();
	/** Render generation: stale async probes/relayouts no-op. */
	let generation = 0;
	let filterPopup: HTMLElement | null = null;
	let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	// ---- toolbar --------------------------------------------------------
	const toolbar = content.createDiv({ cls: 'dashboard-library-toolbar dashboard-material-toolbar' });
	const searchInput = toolbar.createEl('input', {
		cls: 'dashboard-library-search',
		attr: { type: 'text', placeholder: t('library.searchPlaceholder') },
	});

	/** Type filter pills (全部 / 图片 / 视频 / 文本) — visible buttons, not a
	 *  dropdown, so the current scope reads at a glance (Rae). */
	const typePills = toolbar.createDiv({ cls: 'dashboard-material-typepills', attr: { role: 'group', 'aria-label': t('media.groupByType') } });
	const TYPE_LABELS: Record<MaterialKindFilter, string> = {
		all: 'material.typeAll',
		image: 'material.typeImages',
		video: 'material.typeVideos',
		text: 'material.typeText',
	};
	const TYPE_ICONS: Record<MaterialKindFilter, string> = {
		all: 'layout-grid',
		image: 'image',
		video: 'film',
		text: 'file-text',
	};
	const buildTypePills = (): void => {
		typePills.empty();
		for (const key of ['all', 'image', 'video', 'text'] as const) {
			const pill = typePills.createDiv({
				cls: 'dashboard-material-typepill' + (kindFilter === key ? ' active' : ''),
				attr: { role: 'button', 'aria-label': t(TYPE_LABELS[key]), title: t(TYPE_LABELS[key]), 'data-kind': key },
			});
			setIcon(pill.createSpan({ cls: 'dashboard-material-typepill-icon' }), TYPE_ICONS[key]);
			pill.createSpan({ cls: 'dashboard-material-typepill-label', text: t(TYPE_LABELS[key]) });
			pill.addEventListener('click', () => {
				if (kindFilter === key) return;
				kindFilter = key;
				currentPage = 1;
				buildTypePills();
				render();
			});
		}
	};
	buildTypePills();

	const sortSelect = toolbar.createEl('select', { cls: 'dashboard-library-sort' });
	for (const opt of [
		{ value: 'modified', label: t('library.sortModified') },
		{ value: 'created', label: t('library.sortCreated') },
		{ value: 'name', label: t('library.sortName') },
		{ value: 'size', label: t('material.sortSize') },
	] as const) {
		sortSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	const sortDirBtn = toolbar.createDiv({ cls: 'dashboard-library-sort-dir' });
	const updateSortIcon = (): void => setIcon(sortDirBtn, sortDesc ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow');
	updateSortIcon();
	sortDirBtn.addEventListener('click', () => { sortDesc = !sortDesc; updateSortIcon(); currentPage = 1; render(); });

	const groupSelect = toolbar.createEl('select', {
		cls: 'dashboard-library-sort dashboard-media-group-select',
		attr: { 'aria-label': t('media.groupBy'), title: t('media.groupBy') },
	});
	for (const opt of [
		{ value: 'none', label: t('media.groupNone') },
		{ value: 'folder', label: t('media.groupByFolder') },
		{ value: 'tag', label: t('media.groupByTag') },
		{ value: 'type', label: t('material.groupByType') },
	] as const) {
		groupSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
	}
	groupSelect.addEventListener('change', () => { groupBy = groupSelect.value as MaterialGroupMode; currentPage = 1; render(); });

	const densityToggle = toolbar.createDiv({ cls: 'dashboard-library-view-toggle' });
	const sizeShort: Record<MaterialDensity, string> = { small: 'S', medium: 'M', large: 'L' };
	const buildDensityToggle = (): void => {
		densityToggle.empty();
		createToolbarDropdown(densityToggle, density.value, (['small', 'medium', 'large'] as MaterialDensity[]).map(s => ({
			key: s,
			label: t('media.size' + s.charAt(0).toUpperCase() + s.slice(1)),
			short: sizeShort[s],
		})), (key) => {
			density.value = key as MaterialDensity;
			app.saveLocalStorage(DENSITY_STORAGE_KEY, density.value);
			buildDensityToggle();
			relayout();
		});
	};
	buildDensityToggle();

	// Tag filter funnel + active-filter chips row
	const filterBtn = toolbar.createDiv({ cls: 'dashboard-library-filter-btn' });
	setIcon(filterBtn, 'filter');
	filterBtn.title = t('media.quickFilter');
	const filterTagBar = toolbar.createDiv({ cls: 'dashboard-library-filter-tags' });

	// One-click collapse/expand of every group — lives beside the funnel (both
	// are grouping controls, Rae); grouped views only.
	const collapseAllBtn = toolbar.createDiv({
		cls: 'dashboard-library-view-btn dashboard-material-collapse-all is-hidden',
		attr: { 'aria-label': t('library.collapseAllGroups'), title: t('library.collapseAllGroups'), role: 'button' },
	});
	setIcon(collapseAllBtn, 'chevrons-down-up');
	collapseAllBtn.addEventListener('click', () => toggleAllGroups());

	function closeFilterPopup(): void {
		if (outsideClickHandler) {
			activeDocument.removeEventListener('click', outsideClickHandler);
			outsideClickHandler = null;
		}
		if (filterPopup) { filterPopup.remove(); filterPopup = null; }
	}

	function toggleFilterTag(tag: string, chipsHost: HTMLElement | null): void {
		filterTags = filterTags.includes(tag)
			? filterTags.filter(tg => tg !== tag)
			: [...filterTags, tag];
		currentPage = 1;
		render();
		if (filterPopup && chipsHost) {
			renderTagsSelector(chipsHost, tagStore?.getAllTags() ?? [], filterTags, (tg) => toggleFilterTag(tg, chipsHost));
		}
	}

	function openFilterPopup(): void {
		closeFilterPopup();
		filterPopup = activeDocument.body.createDiv({ cls: 'dashboard-library-filter-popup' });
		const dashboardRoot = filterBtn.closest<HTMLElement>('.apex-dashboard-root');
		if (dashboardRoot) {
			const rs = getComputedStyle(dashboardRoot);
			['--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-border-card',
				'--db-text', '--db-text-muted', '--db-accent', '--db-radius-md', '--db-radius-sm', '--db-font',
				'--db-bg-input', '--db-bg-hover', '--db-bg-btn', '--db-text-normal', '--db-border-input'].forEach(v => {
				const val = rs.getPropertyValue(v).trim();
				if (val) filterPopup!.style.setProperty(v, val);
			});
		}
		const rect = filterBtn.getBoundingClientRect();
		filterPopup.setCssProps({ position: 'fixed', top: `${rect.bottom + 4}px`, left: `${rect.left}px`, zIndex: '10000' });

		if (tagStore) {
			const tagRow = filterPopup.createDiv({ cls: 'dashboard-library-quickfilter-row' });
			tagRow.createDiv({ cls: 'dashboard-library-quickfilter-label', text: t('media.filterTags') });
			const chips = tagRow.createDiv({ cls: 'dashboard-library-filter-chips' });
			renderTagsSelector(chips, tagStore.getAllTags(), filterTags, (tag) => toggleFilterTag(tag, chips));
		} else {
			filterPopup.createDiv({ cls: 'dashboard-library-config-hint', text: t('material.cfgBtnHint') });
		}
		if (filterTags.length > 0) {
			const clearBtn = filterPopup.createEl('button', { cls: 'dashboard-library-filter-popup-clear', text: t('reminder.clearReminder') });
			clearBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				filterTags = [];
				currentPage = 1;
				render();
				closeFilterPopup();
			});
		}
		outsideClickHandler = (e: MouseEvent): void => {
			if (!filterPopup) return;
			const target = e.target as Node;
			if (filterPopup.contains(target) || filterBtn.contains(target)) return;
			if (target.instanceOf(Element) && target.closest('.modal-container')) return;
			closeFilterPopup();
		};
		window.setTimeout(() => activeDocument.addEventListener('click', outsideClickHandler!), 0);
	}

	filterBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (filterPopup) closeFilterPopup(); else openFilterPopup();
	});

	toolbar.createDiv({ cls: 'dashboard-library-toolbar-spacer' });
	const countEl = toolbar.createDiv({ cls: 'dashboard-library-count' });
	const pageSizeSelect = toolbar.createEl('select', { cls: 'dashboard-library-page-size' });
	for (const size of PAGE_SIZE_OPTIONS) {
		const opt = pageSizeSelect.createEl('option', { text: t('library.pageSize', { count: size }), attr: { value: String(size) } });
		if (size === pageSize) opt.selected = true;
	}
	pageSizeSelect.addEventListener('change', () => {
		pageSize = parseInt(pageSizeSelect.value) || 50;
		currentPage = 1;
		render();
	});

	// Favorites-only view (heart): one click narrows the waterfall to the
	// collected materials, the next click restores everything.
	// Bare view-btn, no .dashboard-library-view-toggle chip-well around it
	// (Rae): the wrapper painted each button a gray pill, and the hidden
	// collapse button's empty wrapper showed up as a stray dot beside settings.
	const favoritesBtn = toolbar.createDiv({
		cls: 'dashboard-library-view-btn dashboard-material-favorites-btn',
		attr: { 'aria-label': t('material.favorites'), title: t('material.favorites'), role: 'button' },
	});
	setIcon(favoritesBtn, 'heart');
	favoritesBtn.addEventListener('click', () => {
		favoritesOnly = !favoritesOnly;
		currentPage = 1;
		render();
	});

	// Card style switch (Rae): flips between the original cover-only tiles and
	// the Pin (polaroid) cards. The button shows the CURRENT style.
	const styleBtn = toolbar.createDiv({
		cls: 'dashboard-library-view-btn dashboard-material-style-btn',
		attr: { role: 'button' },
	});
	const updateStyleBtn = (): void => {
		const polaroid = cardStyle.value === 'polaroid';
		const label = polaroid ? t('material.stylePolaroid') : t('material.stylePlain');
		setIcon(styleBtn, polaroid ? 'layout-template' : 'image');
		styleBtn.setAttribute('title', label);
		styleBtn.setAttribute('aria-label', label);
	};
	updateStyleBtn();
	styleBtn.addEventListener('click', () => {
		cardStyle.value = cardStyle.value === 'polaroid' ? 'plain' : 'polaroid';
		app.saveLocalStorage(CARD_STYLE_STORAGE_KEY, cardStyle.value);
		currentPage = 1;
		updateStyleBtn();
		render();
	});

	const settingsBtn = toolbar.createDiv({
		cls: 'dashboard-library-view-btn dashboard-material-settings-btn',
		attr: { 'aria-label': t('material.cfgTitle'), title: t('material.cfgTitle'), role: 'button' },
	});
	setIcon(settingsBtn, 'settings');
	settingsBtn.addEventListener('click', () => ctx.onOpenSettings());

	// ---- result areas ----------------------------------------------------
	const filterChipsRow = content.createDiv({ cls: 'dashboard-library-filter-tags dashboard-material-filter-row' });
	/** The bare results area doubles as the fallback drop zone (no import key
	 *  = the configured default folder); group headers/bodies are their own
	 *  zones stamped per render. */
	const resultArea = content.createDiv({ cls: `dashboard-material-area ${MATERIAL_DROPZONE_CLASS}` });
	const paginationArea = content.createDiv({ cls: 'dashboard-library-pagination' });
	/** Right floating action rail: select toggle + skill buttons + batch
	 *  actions, icons only (Rae) — replaces the old bottom batch bar. */
	const actionRail = content.createDiv({ cls: 'dashboard-material-actionrail' });
	/** Where an OS file drop will land, shown while dragging. Absolutely
	 *  positioned over the area and pointer-events:none so it never eats the
	 *  drop itself. */
	const dropHint = content.createDiv({ cls: 'dashboard-material-drophint is-hidden' });
	/** Rubber-band selection rectangle while dragging (select mode). */
	let marqueeEl: HTMLElement | null = null;
	/** Document-capture gesture teardown (marquee drags) — run on destroy so
	 *  an interrupted drag never leaks its move listeners. */
	const gestureDisposers: Array<() => void> = [];
	/** Left group-navigation rail (grouped views only, section-rail styling). */
	let groupRail: HTMLElement | null = null;
	const groupRailOptions = {
		rowsRoot: resultArea,
		rowsSelector: '.dashboard-media-group-header',
		side: 'left' as const,
	};

	// Resize-driven relayout: one observer on the area for the whole
	// controller lifetime (tiles move between columns when the pane resizes).
	let resizeObserver: ResizeObserver | null = null;
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(() => { relayout(); });
		resizeObserver.observe(resultArea);
	}

	const mounter = createLazyVideoMounter();

	function destroy(): void {
		generation++;
		cancelPendingOpen();
		for (const dispose of gestureDisposers.splice(0)) dispose();
		marqueeEl?.remove();
		marqueeEl = null;
		// A 0-row remount detaches the live rail's listeners; the element
		// itself is removed below.
		renderSectionRail(content, 0, [], groupRailOptions);
		groupRail?.remove();
		groupRail = null;
		resizeObserver?.disconnect();
		disposeDrop();
		mounter?.disconnect();
		releaseVideoMedia(resultArea);
		closeFilterPopup();
	}

	// ---- tile actions ----------------------------------------------------
	const fileOf = (path: string): TFile | null => app.vault.getFileByPath(path) ?? null;

	async function deleteItems(paths: readonly string[]): Promise<void> {
		if (paths.length === 0) return;
		const confirmed = await showConfirmDialog(app, {
			title: t('common.confirmDelete'),
			message: paths.length === 1
				? t('media.confirmDelete', { name: paths[0]!.slice(paths[0]!.lastIndexOf('/') + 1) })
				: t('material.confirmDeleteBatch', { count: String(paths.length) }),
		});
		if (!confirmed) return;
		let failed = 0;
		for (const path of paths) {
			const file = fileOf(path);
			if (!file) continue;
			try { await trashMediaFile(app, file); selected.delete(path); } catch { failed++; }
		}
		if (failed > 0) new Notice(t('media.deleteFailed'));
		else new Notice(t('media.deleted'));
		render();
	}

	/** Absolute on-disk location of a vault path (Rae: copied paths must be
	 *  absolute). Falls back to the vault-relative path when the adapter
	 *  exposes no basePath (tests, unusual adapters). */
	function absolutePath(path: string): string {
		const adapter = app.vault.adapter as { basePath?: string } | null | undefined;
		const base = typeof adapter?.basePath === 'string' ? adapter.basePath.replace(/\/+$/, '') : '';
		return base ? `${base}/${path}` : path;
	}

	function copyPaths(paths: readonly string[]): void {
		if (paths.length === 0 || typeof navigator === 'undefined' || !navigator.clipboard) return;
		void navigator.clipboard.writeText(paths.map(absolutePath).join('\n'))
			.then(() => new Notice(t('material.copied', { count: String(paths.length) })))
			.catch(() => new Notice(t('material.copyFailed')));
	}

	async function moveItems(paths: readonly string[]): Promise<void> {
		if (paths.length === 0) return;
		new PathPickerModal(app, 'folder', async target => {
			const folder = target.replace(/\/+$/, '');
			let moved = 0;
			let skipped = 0;
			for (const path of paths) {
				const file = fileOf(path);
				if (!file) continue;
				const name = path.slice(path.lastIndexOf('/') + 1);
				const newPath = folder ? `${folder}/${name}` : name;
				if (newPath === path) continue;
				if (app.vault.getAbstractFileByPath(newPath)) { skipped++; continue; }
				try {
					await app.fileManager.renameFile(file, newPath);
					selected.delete(path);
					moved++;
				} catch { skipped++; }
			}
			if (moved > 0) new Notice(t('material.moved', { count: String(moved) }));
			if (skipped > 0) new Notice(t('material.moveSkipped', { count: String(skipped) }));
			render();
		}).open();
	}

	function openTagEditor(item: MaterialItem): void {
		if (!tagStore) return;
		const file = fileOf(item.path);
		if (!file) return;
		new MediaTagEditModal(
			app,
			file,
			tagStore.getTags(item.path),
			tagStore.getAllTags(),
			(tags) => {
				if (tagStore.setTags(item.path, tags)) render();
			},
		).open();
	}

	/** Batch-tag every selected file (adds the typed tag; keeps existing).
	 *  Popup floats beside the right action rail. */
	function batchTag(): void {
		if (!tagStore || selected.size === 0) return;
		const paths = [...selected];
		const allTags = tagStore.getAllTags();
		const row = activeDocument.body.createDiv({ cls: 'dashboard-library-filter-popup dashboard-material-tagpop' });
		const railRect = actionRail.getBoundingClientRect();
		row.setCssProps({
			position: 'fixed',
			right: `${Math.max(12, window.innerWidth - railRect.left + 10)}px`,
			top: '50%',
			transform: 'translateY(-50%)',
			zIndex: '10000',
		});
		const input = row.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: allTags.slice(0, 5).join(' / ') || t('material.batchTag') },
		});
		const apply = row.createEl('button', { cls: 'dashboard-modal-btn dashboard-modal-btn--confirm', text: t('common.save') });
		const close = (): void => { row.remove(); activeDocument.removeEventListener('click', outside, true); };
		const outside = (e: MouseEvent): void => {
			const target = e.target as Node;
			if (row.contains(target)) return;
			close();
		};
		apply.addEventListener('click', () => {
			const tag = input.value.trim();
			if (tag) {
				for (const path of paths) {
					const next = new Set(tagStore.getTags(path));
					next.add(tag);
					tagStore.setTags(path, [...next]);
				}
			}
			close();
			render();
		});
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply.click(); } });
		input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
		window.setTimeout(() => {
			activeDocument.addEventListener('click', outside, true);
			input.focus();
		}, 0);
	}

	/** Dispatch the current selection through one configured skill button. */
	function dispatchMaterialSkill(button: MaterialSkillButton): void {
		const paths = [...selected];
		if (paths.length === 0) return;
		dispatchSkill(
			app,
			{
				label: button.label || button.agent,
				skillName: button.skillName,
				promptTemplate: effectiveMaterialTemplate(button),
				agent: button.agent,
				...(button.directSend === true ? { directSend: true } : {}),
			},
			materialSkillVars(paths),
			{ directSend: false },
		);
	}

	// ---- tiles -----------------------------------------------------------
	/** Resolved text-tile covers keyed by path — survives re-renders so
	 *  probing and layout can share the same resolution. '' = no cover. */
	const textCoverCache = new Map<string, string>();

	/** Effective tile aspect: video placeholder 16:9, everything else (gated
	 *  text covers included) the probed ratio (4/3 until it settles). */
	function aspectOf(item: MaterialItem): number {
		if (item.kind === 'video') return MATERIAL_VIDEO_ASPECT;
		return aspectCache.get(item.path) ?? MATERIAL_IMAGE_ASPECT;
	}

	/** Resolve a text file's frontmatter cover (封面/cover or any image-looking
	 *  property) into a tile src. Reuses the library gallery's extraction so
	 *  both surfaces agree on what counts as a cover. */
	function textCoverOf(item: MaterialItem): string {
		if (textCoverCache.has(item.path)) return textCoverCache.get(item.path)!;
		let src = '';
		const file = fileOf(item.path);
		const cache = file ? (app.metadataCache as unknown as {
			getFileCache?: (f: TFile) => { frontmatter?: Record<string, unknown> } | null;
			getFirstLinkpathDest?: (link: string, from: string) => { path: string } | null;
		}) : null;
		const fm = cache?.getFileCache?.(file!)?.frontmatter ?? null;
		const candidate = fm ? extractCoverValue(fm) : null;
		if (candidate) {
			const raw = candidate.value;
			if (/^(https?:|data:)/i.test(raw)) src = raw;
			else {
				const dest = cache?.getFirstLinkpathDest?.(raw, item.path);
				src = resolveVaultImage(app, dest ? dest.path : raw) ?? '';
			}
		}
		textCoverCache.set(item.path, src);
		return src;
	}

	/** Single-click open runs on a short delay so double-click can cancel it
	 *  and rename instead — a plain immediate open made the first click of a
	 *  dblclick pop the lightbox, leaving rename unreachable. */
	const OPEN_DELAY_MS = 240;
	let pendingOpenTimer: number | null = null;
	function cancelPendingOpen(): void {
		if (pendingOpenTimer !== null) {
			window.clearTimeout(pendingOpenTimer);
			pendingOpenTimer = null;
		}
	}
	function scheduleOpen(item: MaterialItem, openItem: (item: MaterialItem) => void): void {
		cancelPendingOpen();
		pendingOpenTimer = window.setTimeout(() => {
			pendingOpenTimer = null;
			openItem(item);
		}, OPEN_DELAY_MS);
	}

	/** Inline rename on the name row (double-click, both modes). */
	function startRename(item: MaterialItem, name: HTMLElement): void {
		const file = fileOf(item.path);
		if (!file || name.querySelector('input')) return;
		const original = item.basename;
		name.empty();
		const input = name.createEl('input', { cls: 'dashboard-library-table-edit-input', attr: { type: 'text', value: original } });
		input.focus();
		input.select();
		const finish = async (save: boolean): Promise<void> => {
			if (!input.isConnected) return;
			const raw = input.value.trim();
			input.remove();
			if (!save || !raw || raw === original) { name.textContent = original; return; }
			name.textContent = raw;
			try {
				await renameMediaFile(app, file, raw);
				render();
			} catch {
				new Notice(t('media.renameFailed'));
				name.textContent = original;
			}
		};
		input.addEventListener('keydown', (ke) => {
			if (ke.key === 'Enter') { ke.preventDefault(); void finish(true); }
			else if (ke.key === 'Escape') { ke.preventDefault(); void finish(false); }
		});
		input.addEventListener('blur', () => { void finish(true); });
	}

	function buildTile(item: MaterialItem, openItem: (item: MaterialItem) => void): HTMLElement {
		const polaroid = cardStyle.value === 'polaroid';
		// Detached tile (global createDiv): built outside the DOM, then placed
		// into its waterfall column by layoutTiles' appendChild.
		const tile = createDiv({ cls: 'dashboard-material-tile dashboard-material-tile--' + (polaroid ? 'polaroid' : 'plain') });
		tile.dataset.materialPath = item.path;
		tile.dataset.cardStyle = polaroid ? 'polaroid' : 'plain';
		tile.setAttribute('role', 'button');

		// Polaroid (Pin style): photo + caption share one white paper block and
		// a macaron strip below carries tags/date/heart. Plain: the original
		// cover-only card — full-bleed cover with the caption + heart overlaid
		// on the image bottom, no strip of any kind below it.
		const coverHost = polaroid ? tile.createDiv({ cls: 'dashboard-material-photo' }) : tile;
		const thumb = coverHost.createDiv({ cls: 'dashboard-material-thumb dashboard-material-thumb--' + item.kind });
		thumb.style.aspectRatio = String(aspectOf(item));
		if (item.kind === 'text') {
			// Text tiles are cover-gated upstream, so a cover always exists.
			thumb.createEl('img', {
				cls: 'dashboard-material-img',
				attr: { src: textCoverOf(item), alt: item.basename, loading: 'lazy' },
			});
		} else {
			const src = resolveVaultImage(app, item.path);
			if (src && item.kind === 'image') {
				thumb.createEl('img', {
					cls: 'dashboard-material-img',
					attr: { src, alt: item.basename, loading: 'lazy' },
				});
			} else if (src) {
				thumb.createDiv({ cls: 'dashboard-material-video-ph' });
				if (mounter) mounter.observe(thumb, src);
				const play = thumb.createDiv({ cls: 'dashboard-media-play' });
				setIcon(play, 'play');
			} else {
				thumb.addClass('dashboard-media-thumb--broken');
			}
		}

		// Selection checkbox (select mode only; click anywhere on the tile
		// toggles too — the checkbox is the visual affordance).
		const check = thumb.createDiv({ cls: 'dashboard-material-check' });
		setIcon(check, 'check');

		// Hover actions: tag / move / delete
		const actions = coverHost.createDiv({ cls: 'dashboard-material-actions' });
		const tagBtn = actions.createEl('button', { cls: 'dashboard-media-delete dashboard-material-actbtn', attr: { 'aria-label': t('media.editTags') } });
		setIcon(tagBtn, 'tags');
		tagBtn.addEventListener('click', (e) => { e.stopPropagation(); openTagEditor(item); });
		const moveBtn = actions.createEl('button', { cls: 'dashboard-media-delete dashboard-material-actbtn', attr: { 'aria-label': t('material.batchMove') } });
		setIcon(moveBtn, 'folder-input');
		moveBtn.addEventListener('click', (e) => { e.stopPropagation(); void moveItems([item.path]); });
		const delBtn = actions.createEl('button', { cls: 'dashboard-qa-remove dashboard-media-delete dashboard-material-actbtn', attr: { 'aria-label': t('media.delete') } });
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); void deleteItems([item.path]); });

		// Caption host: polaroid keeps the caption in flow on the white paper
		// block and a macaron strip below carries tags/date/heart; plain lays
		// the caption + heart in ONE bar over the image bottom — nothing is
		// appended below the cover (Rae). `.dashboard-media-name` stays
		// off-limits (absolute overlay in the media section).
		let name: HTMLElement;
		let heartRow: HTMLElement;
		if (polaroid) {
			name = coverHost.createDiv({ cls: 'dashboard-material-name', text: item.basename });
			heartRow = tile.createDiv({ cls: 'dashboard-material-meta' });
			if (item.tags.length > 0) {
				const rowTags = heartRow.createDiv({ cls: 'dashboard-material-meta-tags' });
				for (const tag of item.tags.slice(0, 2)) rowTags.createSpan({ cls: 'dashboard-media-tile-tag', text: tag });
				if (item.tags.length > 2) rowTags.createSpan({ cls: 'dashboard-media-tile-tag dashboard-media-tile-tag--more', text: `+${item.tags.length - 2}` });
			}
			heartRow.createDiv({ cls: 'dashboard-material-meta-date', text: momentOf(item.ctime).format('YYYY-MM-DD') });
		} else {
			const bar = thumb.createDiv({ cls: 'dashboard-material-coverbar' });
			name = bar.createDiv({ cls: 'dashboard-material-name dashboard-material-name--plain', text: item.basename });
			heartRow = bar;
		}
		name.title = `${item.path}\n${item.ext}`;
		const heart = heartRow.createDiv({
			cls: 'dashboard-material-heart' + (ctx.favorites?.has(item.path) ? ' is-fav' : ''),
			attr: { role: 'button', 'aria-label': t('material.favorites'), title: t('material.favorites') },
		});
		setIcon(heart, 'heart');
		heart.addEventListener('click', (e) => {
			// Heart flips in place — no re-render (a rebuild would yank the
			// scroll position and restart any playing preview). Exception:
			// un-favoriting inside the favorites-only view drops the tile,
			// otherwise a just-removed card lingers in the collection.
			e.stopPropagation();
			const fav = ctx.favorites?.toggle(item.path) ?? false;
			heart.toggleClass('is-fav', fav);
			if (favoritesOnly && !fav) render();
		});

		// Click opens on a delay (cancelable); double-click renames. The name
		// row stops propagation so its dblclick drives the same rename once.
		tile.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			cancelPendingOpen();
			startRename(item, name);
		});
		const syncSelected = (): void => tile.toggleClass('is-selected', selected.has(item.path));
		tile.addEventListener('click', () => {
			if (selectMode) {
				cancelPendingOpen();
				if (selected.has(item.path)) selected.delete(item.path);
				else selected.add(item.path);
				syncSelected();
				renderActionRail();
				return;
			}
			scheduleOpen(item, openItem);
		});
		syncSelected();
		tile.toggleClass('is-select-mode', selectMode);
		return tile;
	}

	/** Build the waterfall column hosts and append tiles by assignment. */
	function layoutTiles(colsHost: HTMLElement, tiles: readonly { el: HTMLElement; item: MaterialItem }[]): void {
		colsHost.empty();
		const cols = materialColumnCount(colsHost.clientWidth, density.value);
		const assignment = assignWaterfall(tiles.map(({ item }) => aspectOf(item)), cols);
		const colEls: HTMLElement[] = [];
		for (let i = 0; i < cols; i++) {
			colEls.push(colsHost.createDiv({ cls: 'dashboard-material-col' }));
		}
		tiles.forEach(({ el }, i) => {
			colEls[assignment[i] ?? 0]!.appendChild(el);
		});
		colsHost.style.setProperty('--db-material-cols', String(cols));
	}

	/** Re-run the column layout of the CURRENT render (density change, pane
	 *  resize, settled aspect probes). Tiles are moved, not rebuilt. */
	function relayout(): void {
		const colsHost = resultArea.querySelector<HTMLElement>('.dashboard-material-cols');
		if (!colsHost) return;
		const tiles: { el: HTMLElement; item: MaterialItem }[] = [];
		for (const el of Array.from(colsHost.querySelectorAll<HTMLElement>('.dashboard-material-tile'))) {
			const path = el.dataset.materialPath ?? '';
			const item = lastItems.get(path);
			if (item) tiles.push({ el, item });
		}
		if (tiles.length === 0) return;
		layoutTiles(colsHost, tiles);
	}

	/** Items of the last render, keyed by path (relayout + lightbox order). */
	const lastItems = new Map<string, MaterialItem>();

	/** Probe the page's unmeasured images (and text-tile covers), then relayout
	 *  once per batch. */
	function probeAspects(items: readonly MaterialItem[], gen: number): void {
		const ImageCtor = (globalThis as { Image?: typeof Image }).Image;
		if (typeof ImageCtor !== 'function' || Platform.isMobile) return;
		const pending = items.filter(it => !aspectCache.has(it.path) && (
			it.kind === 'image'
			|| (it.kind === 'text' && textCoverOf(it) !== '')
		));
		let inflight = 0;
		let queued = [...pending];
		let dirty = false;
		const pump = (): void => {
			if (gen !== generation) return;
			while (inflight < 8 && queued.length > 0) {
				const item = queued.shift()!;
				const src = item.kind === 'text' ? textCoverOf(item) : resolveVaultImage(app, item.path);
				if (!src) { aspectCache.set(item.path, aspectOf(item)); dirty = true; continue; }
				inflight++;
				void probeAspect(src).then(aspect => {
					inflight--;
					if (gen !== generation) return;
					if (aspect > 0) {
						aspectCache.set(item.path, aspect);
						const tile = resultArea.querySelector<HTMLElement>(`.dashboard-material-tile[data-material-path="${cssEscape(item.path)}"] .dashboard-material-thumb`);
						if (tile) tile.style.aspectRatio = String(aspect);
						dirty = true;
					}
					pump();
				});
			}
			if (queued.length === 0 && inflight === 0 && dirty) {
				dirty = false;
				// Full shortest-column re-flow with the settled ratios.
				nextFrame(() => { if (gen === generation) relayout(); });
			}
		};
		pump();
	}

	/** cssEscape that works without the CSS API (paths in selectors). */
	function cssEscape(s: string): string {
		return s.replace(/["\\]/g, '\\$&');
	}

	function updateFilterChips(): void {
		filterChipsRow.empty();
		filterBtn.classList.toggle('active', filterTags.length > 0);
		for (const tag of filterTags) {
			const chip = filterChipsRow.createDiv({ cls: 'dashboard-library-filter-tag dashboard-library-filter-tag--tag' });
			chip.createSpan({ cls: 'dashboard-library-filter-tag-label', text: `#${tag}` });
			chip.createSpan({ cls: 'dashboard-library-filter-tag-x', text: '×' }).addEventListener('click', () => toggleFilterTag(tag, null));
		}
	}

	/** Right action rail: ALWAYS mounted — the select toggle must be
	 *  reachable to enter select mode, and the skill buttons must be
	 *  discoverable right after they're configured (Rae). Empty selection
	 *  renders the batch buttons disabled, not hidden. Icon-only, with
	 *  tooltips. */
	function renderActionRail(): void {
		actionRail.empty();
		const empty = selected.size === 0;

		const selBtn = actionRail.createDiv({
			cls: 'dashboard-library-view-btn dashboard-material-railbtn dashboard-material-select-toggle' + (selectMode ? ' active' : ''),
			attr: { 'aria-label': t('material.selectMode'), title: t('material.selectMode'), role: 'button' },
		});
		setIcon(selBtn, selectMode ? 'check-square' : 'square');
		selBtn.addEventListener('click', () => {
			selectMode = !selectMode;
			if (!selectMode) selected.clear();
			render();
		});
		if (selected.size > 0) {
			actionRail.createDiv({ cls: 'dashboard-material-railcount', text: String(selected.size) });
		}

		actionRail.createDiv({ cls: 'dashboard-material-raildivider' });

		for (const button of config.skillButtons) {
			const label = button.label || button.agent;
			const btn = actionRail.createEl('button', {
				cls: 'dashboard-material-railbtn dashboard-material-railbtn--skill',
				attr: { type: 'button', 'aria-label': label, title: label, ...(empty ? { disabled: 'disabled' } : {}) },
			});
			setIcon(btn, button.icon || 'sparkles');
			btn.addEventListener('click', () => dispatchMaterialSkill(button));
		}

		const mkRailBtn = (icon: string, label: string, onClick: () => void, extraCls = '', alwaysEnabled = false): HTMLElement => {
			const btn = actionRail.createEl('button', {
				cls: `dashboard-material-railbtn ${extraCls}`.trim(),
				attr: { type: 'button', 'aria-label': label, title: label, ...(!alwaysEnabled && empty ? { disabled: 'disabled' } : {}) },
			});
			setIcon(btn, icon);
			btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
			return btn;
		};
		mkRailBtn('tags', t('material.batchTag'), () => batchTag());
		mkRailBtn('folder-input', t('material.batchMove'), () => { void moveItems([...selected]); });
		mkRailBtn('copy', t('material.copyPaths'), () => copyPaths([...selected]));
		mkRailBtn('trash-2', t('common.delete'), () => { void deleteItems([...selected]); }, 'dashboard-material-railbtn--danger');
		// Clear stays enabled even at zero — it also just re-renders the rail.
		mkRailBtn('x', t('material.clearSelection'), () => {
			selected.clear();
			render();
		}, 'dashboard-material-railbtn--always', true);
	}

	/** One-click collapse/expand of every group, in place (no re-render, so
	 *  scroll position survives). Icon/title flip to the resulting state. */
	function toggleAllGroups(): void {
		const headers = Array.from(resultArea.querySelectorAll<HTMLElement>('.dashboard-media-group-header'));
		if (headers.length === 0) return;
		const collapse = headers.some(h => !h.hasClass('is-collapsed'));
		for (const header of headers) {
			const key = header.dataset.groupKey ?? '';
			const chevron = header.querySelector<HTMLElement>('.dashboard-media-group-chevron');
			const body = header.nextElementSibling as HTMLElement | null;
			header.toggleClass('is-collapsed', collapse);
			body?.toggleClass('is-hidden', collapse);
			if (chevron) setIcon(chevron, collapse ? 'chevron-right' : 'chevron-down');
			if (collapse) collapsedGroups.add(key);
			else collapsedGroups.delete(key);
		}
		updateCollapseAllUi();
	}

	function updateCollapseAllUi(): void {
		const headers = Array.from(resultArea.querySelectorAll<HTMLElement>('.dashboard-media-group-header'));
		const allCollapsed = headers.length > 0 && headers.every(h => h.hasClass('is-collapsed'));
		setIcon(collapseAllBtn, allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up');
		const nextTitle = allCollapsed ? t('library.expandAllGroups') : t('library.collapseAllGroups');
		collapseAllBtn.title = nextTitle;
		collapseAllBtn.setAttribute('title', nextTitle);
		collapseAllBtn.setAttribute('aria-label', nextTitle);
	}

	/** Left navigation rail over the group headers (section-rail look):
	 *  remounted per render; a 0-label remount tears the previous hooks down. */
	function mountGroupRail(labels: readonly string[]): void {
		groupRail?.remove();
		groupRail = renderSectionRail(content, labels.length, labels, groupRailOptions);
	}

	/** Display name for one group header / nav dash. Folder groups carry an
	 *  explicit label (the sub-folder's own name — the key is root-qualified so
	 *  two scan roots can't collide); type groups key on the raw kind for
	 *  stable collapse state but show the localized type name; tag groups show
	 *  the tag itself. */
	function groupDisplayName(group: MaterialGroup): string {
		if (group.label) return group.label;
		const typeKey = TYPE_LABELS[group.key as MaterialKindFilter];
		return groupBy === 'type' && typeKey ? t(typeKey) : group.key;
	}

	/** Rubber-band selection (Rae): in select mode, dragging over the empty
	 *  area sweeps a rectangle; every tile it intersects joins the selection
	 *  on top of the selection snapshot from drag start. Move/up ride the
	 *  document capture phase so a drag that outruns the pane still tracks. */
	function wireMarquee(): void {
		resultArea.addEventListener('pointerdown', (e) => {
			if (!selectMode) return;
			const target = e.target as HTMLElement | null;
			// Tiles/headers/controls handle their own pointer gestures; only a
			// press on the empty canvas starts a sweep.
			if (target && typeof target.closest === 'function'
				&& target.closest('.dashboard-material-tile, .dashboard-media-group-header, button, input, .dashboard-library-pagination')) return;
			e.preventDefault();
			const base = [...selected];
			const areaRect = resultArea.getBoundingClientRect();
			const x0 = e.clientX;
			const y0 = e.clientY;
			marqueeEl = resultArea.createDiv({ cls: 'dashboard-material-marquee' });
			const hitTest = (l: number, t: number, r: number, b: number): void => {
				selected.clear();
				for (const p of base) selected.add(p);
				for (const tile of Array.from(resultArea.querySelectorAll<HTMLElement>('.dashboard-material-tile'))) {
					const tr = tile.getBoundingClientRect();
					const hits = tr.left < r && tr.right > l && tr.top < b && tr.bottom > t;
					const path = tile.dataset.materialPath ?? '';
					if (hits) selected.add(path);
					tile.toggleClass('is-selected', selected.has(path));
				}
			};
			const onMove = (ev: PointerEvent): void => {
				if (!marqueeEl) return;
				const l = Math.min(x0, ev.clientX);
				const r = Math.max(x0, ev.clientX);
				const t = Math.min(y0, ev.clientY);
				const b = Math.max(y0, ev.clientY);
				marqueeEl.style.left = `${l - areaRect.left + resultArea.scrollLeft}px`;
				marqueeEl.style.top = `${t - areaRect.top + resultArea.scrollTop}px`;
				marqueeEl.style.width = `${r - l}px`;
				marqueeEl.style.height = `${b - t}px`;
				hitTest(l, t, r, b);
			};
			const onUp = (): void => {
				activeDocument.removeEventListener('pointermove', onMove, true);
				activeDocument.removeEventListener('pointerup', onUp, true);
				activeDocument.removeEventListener('pointercancel', onUp, true);
				marqueeEl?.remove();
				marqueeEl = null;
				renderActionRail();
			};
			activeDocument.addEventListener('pointermove', onMove, true);
			activeDocument.addEventListener('pointerup', onUp, true);
			activeDocument.addEventListener('pointercancel', onUp, true);
			gestureDisposers.push(onUp);
		});
	}
	wireMarquee();

	// OS file drops (Rae): an image/video dragged in from anywhere else on the
	// computer is copied into the vault. Zones are stamped per render below; the
	// listeners and the destination rules live in material-drop.ts.
	const disposeDrop = wireMaterialDrop({
		app,
		content,
		hint: dropHint,
		tagStore,
		getGroupMode: () => groupBy,
		getImportFolder: () => config.importFolder ?? '',
		onImported: () => render(),
	});

	function renderTilesBlock(host: HTMLElement, items: readonly MaterialItem[], opener: (item: MaterialItem) => void): void {
		const block = host.createDiv({ cls: 'dashboard-material-block' });
		const colsHost = block.createDiv({ cls: 'dashboard-material-cols' });
		const tiles = items.map(item => ({ el: buildTile(item, opener), item }));
		layoutTiles(colsHost, tiles);
	}

	/** Lightbox over the same-kind files of the given display order; text
	 *  items open as notes instead (nothing to preview in a media lightbox). */
	function makeLightboxOpener(order: readonly MaterialItem[]) {
		return (item: MaterialItem): void => {
			if (item.kind === 'text') {
				void app.workspace.openLinkText(item.path, '', false);
				return;
			}
			const sameKind = order.filter(r => r.kind === item.kind).map(r => fileOf(r.path)).filter((f): f is TFile => !!f);
			const index = Math.max(0, sameKind.findIndex(f => f.path === item.path));
			const tagHooks = tagStore ? {
				getTags: (file: TFile) => tagStore.getTags(file.path),
				getAllTags: () => tagStore.getAllTags(),
				onTagsChange: (file: TFile, tags: string[]) => { tagStore.setTags(file.path, tags); },
			} : undefined;
			new MediaLightboxModal(app, sameKind, index, item.kind, tagHooks).open();
		};
	}

	function render(): void {
		const gen = ++generation;
		// Fresh settings every pass — the getter is the fix for the stale
		// scan-scope bug (a config captured at mount kept the whole vault
		// visible after the settings modal narrowed the scope).
		config = ctx.getConfig();
		releaseVideoMedia(resultArea);
		mounter?.disconnect();
		resultArea.empty();
		resultArea.toggleClass('is-select-mode', selectMode);
		paginationArea.empty();
		lastItems.clear();

		const records: MaterialFileRecord[] = app.vault.getFiles().map(f => ({
			path: f.path,
			basename: f.basename,
			extension: f.extension,
			stat: { mtime: f.stat.mtime, ctime: f.stat.ctime, size: f.stat.size },
		}));
		const all = buildMaterialItems(records, path => tagStore?.getTags(path) ?? [], config);
		const filtered = filterMaterialItems(all, { query: searchInput.value, kind: kindFilter, tags: filterTags });
		// Coverless text files have nothing to show in a visual waterfall —
		// only text with a resolvable cover (vault image attachment or an
		// http(s) URL) ever becomes a tile (Rae).
		const covered = filtered.filter(it => it.kind !== 'text' || textCoverOf(it) !== '');
		const visible = favoritesOnly ? covered.filter(it => ctx.favorites?.has(it.path) === true) : covered;
		const sorted = sortMaterialItems(visible, sortBy, sortDesc);
		countEl.textContent = t('library.fileCount', { count: sorted.length });
		updateFilterChips();
		favoritesBtn.toggleClass('active', favoritesOnly);
		renderActionRail();

		if (sorted.length === 0) {
			collapseAllBtn.addClass('is-hidden');
			mountGroupRail([]);
			resultArea.createDiv({ cls: 'dashboard-library-empty', text: t('material.noFiles') });
			return;
		}

		// Silent ceiling: still capped for render cost, but the on-screen
		// notice is gone (Rae) — it ate layout space for a rare state.
		const display = sorted.length > MATERIAL_RENDER_CEILING ? sorted.slice(0, MATERIAL_RENDER_CEILING) : sorted;

		if (groupBy !== 'none') {
			const groups = groupMaterialItems(display, groupBy, t('library.notSet'));
			const displayOrder = groups.flatMap(g => g.items);
			for (const item of displayOrder) lastItems.set(item.path, item);
			const opener = makeLightboxOpener(displayOrder);
			for (const group of groups) {
				const collapsed = collapsedGroups.has(group.key);
				// Both halves of a group are drop zones carrying its key: a folder
				// group's key IS a vault path, a tag group's key IS the tag to
				// stamp on the copies (material-import resolves which).
				const header = resultArea.createDiv({ cls: `dashboard-media-group-header ${MATERIAL_DROPZONE_CLASS}` + (collapsed ? ' is-collapsed' : '') });
				header.dataset.groupKey = group.key;
				header.dataset.importKey = group.key;
				const chevron = header.createDiv({ cls: 'dashboard-media-group-chevron' });
				setIcon(chevron, collapsed ? 'chevron-right' : 'chevron-down');
				header.createDiv({ cls: 'dashboard-media-group-name', text: groupDisplayName(group) });
				header.createDiv({ cls: 'dashboard-media-group-count', text: String(group.items.length) });
				const body = resultArea.createDiv({ cls: `dashboard-media-group-body ${MATERIAL_DROPZONE_CLASS}` });
				body.dataset.importKey = group.key;
				if (collapsed) body.addClass('is-hidden');
				header.addEventListener('click', () => {
					if (collapsedGroups.has(group.key)) {
						collapsedGroups.delete(group.key);
						header.removeClass('is-collapsed');
						body.removeClass('is-hidden');
						setIcon(chevron, 'chevron-down');
					} else {
						collapsedGroups.add(group.key);
						header.addClass('is-collapsed');
						body.addClass('is-hidden');
						setIcon(chevron, 'chevron-right');
					}
				});
				renderTilesBlock(body, group.items, opener);
			}
			// Group affordances: collapse-all button + left nav rail over the
			// group headers (labels match the header text, so type groups show
			// the localized type name and folder groups their sub-folder).
			const labels = groups.map(groupDisplayName);
			collapseAllBtn.removeClass('is-hidden');
			updateCollapseAllUi();
			mountGroupRail(labels);
			probeAspects(displayOrder, gen);
			return;
		}

		collapseAllBtn.addClass('is-hidden');
		mountGroupRail([]);
		const { page, items, totalPages } = paginateMaterial(display, currentPage, pageSize);
		currentPage = page;
		for (const item of items) lastItems.set(item.path, item);
		const opener = makeLightboxOpener(items);
		renderTilesBlock(resultArea, items, opener);
		probeAspects(items, gen);

		if (totalPages > 1) {
			renderPagination(paginationArea, page, totalPages, display.length, (p) => {
				currentPage = p;
				render();
			});
		}
	}

	searchInput.addEventListener('input', () => { currentPage = 1; render(); });
	sortSelect.addEventListener('change', () => { sortBy = sortSelect.value as MaterialSortBy; currentPage = 1; render(); });

	render();
	return { refresh: render, destroy };
}
