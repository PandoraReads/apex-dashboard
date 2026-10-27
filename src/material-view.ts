/**
 * Material library (素材库) standalone view: a full-page ItemView, separate
 * from the dashboard's embedded sections (those stay untouched). The view is
 * a thin shell — theming, toolbar, waterfall, multi-select and dispatch all
 * live in material-render.ts; this file owns lifecycle, vault-change refresh
 * and the settings modal wiring.
 */

import { ItemView, WorkspaceLeaf, TAbstractFile, TFile } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { renderMaterialLibrary, type MaterialRenderController } from './material-render';
import { MaterialConfigModal } from './material-config-modal';
import { sanitizeMaterialConfig } from './material-model';
import { agentTargets } from './agent-dispatch';

export const MATERIAL_VIEW_TYPE = 'apex-material-view';

export class MaterialLibraryView extends ItemView {
	private plugin: DashboardPlugin;
	private controller: MaterialRenderController | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MATERIAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('material.title');
	}

	getIcon(): string {
		// 'square-sparkles' (Rae) — the previous 'gallery-thumbnails' read as
		// a plain media browser; the sparkles mark the creative material bin.
		return 'square-sparkles';
	}

	/** Current config, sanitized at read time (old data.json may lack it). */
	private config() {
		return sanitizeMaterialConfig(this.plugin.settings.materialConfig, agentTargets());
	}

	private openSettings(): void {
		new MaterialConfigModal(this.app, this.config(), cfg => {
			this.plugin.settings = { ...this.plugin.settings, materialConfig: cfg };
			void this.plugin.saveSettings();
			this.controller?.refresh();
		}).open();
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		// Same theming surface as the dashboard board: every --db-* token and
		// the theme presets key off these two attributes.
		container.addClass('apex-dashboard-root');
		container.addClass('apex-material-root');
		container.setAttribute('data-theme', this.plugin.settings.stylePreset);

		this.controller = renderMaterialLibrary(container, {
			app: this.app,
			// GETTER, not a snapshot: the renderer re-reads this on every
			// render() so settings edits (scan scope, skill buttons) apply on
			// the next refresh instead of after a view reopen.
			getConfig: () => this.config(),
			onConfigChange: () => { /* settings persist through the modal */ },
			onOpenSettings: () => this.openSettings(),
			tagStore: this.plugin.mediaTagService ?? null,
			// Hearts live in settings (not localStorage) so the collection
			// follows the vault across devices via data.json sync.
			favorites: {
				has: (path: string): boolean => (this.plugin.settings.materialFavorites ?? []).includes(path),
				toggle: (path: string): boolean => {
					const prev = this.plugin.settings.materialFavorites ?? [];
					const next = prev.includes(path)
						? prev.filter(p => p !== path)
						: [...prev, path];
					this.plugin.settings = { ...this.plugin.settings, materialFavorites: next };
					void this.plugin.saveSettings();
					return next.includes(path);
				},
			},
		});

		// The waterfall scans the whole vault now, so any file lifecycle change
		// (not just media extensions) refreshes it; content edits are covered
		// by the rebuild on the next view open.
		let refreshTimer: number | null = null;
		const scheduleRefresh = (): void => {
			if (refreshTimer !== null) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				refreshTimer = null;
				this.controller?.refresh();
			}, 500);
		};
		const isFile = (file: TAbstractFile): boolean => file instanceof TFile;
		this.registerEvent(this.app.vault.on('create', file => {
			if (isFile(file)) scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('rename', file => {
			if (isFile(file)) scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('delete', file => {
			if (isFile(file)) scheduleRefresh();
		}));
	}

	async onClose(): Promise<void> {
		this.controller?.destroy();
		this.controller = null;
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
	}
}
