import { Menu, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { showPromptDialog } from './prompt-dialog';
import { showConfirmDialog } from './confirm-dialog';
import { normalizeWorkspacePath } from './workspace-registry';

/** Display label for a workspace: its name, else the file path. */
function workspaceLabel(name: string, path: string): string {
	return name.trim() || `${path}.md`;
}

/** Open the "new workspace" dialog and create the workspace on confirm.
 *  `layout` seeds the board file's `layout:` override (the immersive-hub
 *  flavour of the + menu). */
async function promptNewWorkspace(plugin: DashboardPlugin, layout?: 'immersive'): Promise<void> {
	const files = plugin.settings.workspaceFiles;
	const fallback = t('workspace.defaultName', { n: files.length + 1 });
	const name = await showPromptDialog(plugin.app, {
		title: layout === 'immersive' ? t('workspace.newImmersiveTitle') : t('workspace.newTitle'),
		placeholder: t('workspace.namePlaceholder'),
		defaultValue: fallback,
	});
	if (name === null) return;
	await plugin.createWorkspace(name === '' ? fallback : name, layout);
}

/** Long-press / right-click management menu for one workspace button. */
function openWorkspaceMenu(plugin: DashboardPlugin, file: string, name: string, isActive: boolean, ev: MouseEvent): void {
	const menu = new Menu();
	menu.addItem((item) => {
		item.setTitle(t('workspace.renameTitle'))
			.setIcon('pencil')
			.onClick(async () => {
				const next = await showPromptDialog(plugin.app, {
					title: t('workspace.renameTitle'),
					placeholder: t('workspace.namePlaceholder'),
					defaultValue: name,
				});
				if (next !== null) await plugin.renameWorkspace(file, next);
			});
	});
	menu.addItem((item) => {
		const canRemove = plugin.settings.workspaceFiles.length > 1;
		item.setTitle(t('workspace.removeTitle'))
			.setIcon('trash-2')
			.setDisabled(!canRemove);
		if (!canRemove) return;
		item.onClick(async () => {
			const confirmed = await showConfirmDialog(plugin.app, {
				title: t('workspace.removeTitle'),
				message: t('workspace.removeConfirm', { name: name || file, file: `${file}.md` }),
			});
			if (confirmed) await plugin.removeWorkspace(file);
		});
	});
	// Layout lives PER WORKSPACE: the active board's pill carries the
	// switcher (a non-active file has no open sync engine to write through).
	if (isActive) {
		menu.addSeparator();
		const activeView = plugin.getActiveDashboardView();
		const current = activeView?.getBoardData()?.layout ?? plugin.settings.layoutMode;
		for (const mode of ['side', 'stacked', 'immersive'] as const) {
			menu.addItem(item => {
				item
					.setTitle(t(mode === 'side' ? 'settings.layoutSide' : mode === 'stacked' ? 'settings.layoutStacked' : 'settings.layoutImmersive'))
					.setIcon(mode === 'side' ? 'panels-top-left' : mode === 'stacked' ? 'rows-3' : 'gallery-vertical')
					.setChecked(current === mode)
					.onClick(() => { void plugin.setActiveBoardLayout(mode); });
			});
		}
	}
	menu.showAtMouseEvent(ev);
}

/**
 * Workspace switcher: number pills + add button on the banner, at the
 * top-left corner of the stats view's center column (the CSS mirrors the
 * stats grid to find that edge). Resting semi-visible, full on hover/focus;
 * on mobile there is no hover, so the pills stay visible. Rebuilt on every
 * render so the active highlight always matches the current settings.
 */
export function renderWorkspaceSwitcher(container: HTMLElement, plugin: DashboardPlugin): void {
	const { workspaceFiles, workspaceNames, dashboardFile } = plugin.settings;
	const active = normalizeWorkspacePath(dashboardFile);

	const switcher = container.createDiv({ cls: 'dashboard-workspace-switcher' });

	workspaceFiles.forEach((file, i) => {
		const name = workspaceNames?.[i]?.trim() ?? '';
		const label = workspaceLabel(name, file);
		const isActive = normalizeWorkspacePath(file) === active;
		const btn = switcher.createEl('button', {
			cls: 'dashboard-workspace-btn' + (isActive ? ' active' : ''),
			text: String(i + 1),
			attr: { 'aria-label': label, title: label },
		});
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			void plugin.switchWorkspace(file);
		});
		btn.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			openWorkspaceMenu(plugin, file, name, isActive, ev as MouseEvent);
		});
	});

	const addBtn = switcher.createEl('button', {
		cls: 'dashboard-workspace-btn dashboard-workspace-add-btn',
		attr: { 'aria-label': t('workspace.newTitle'), title: t('workspace.newTitle') },
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		// Two birth flavours: a regular board, or an immersive hub page (the
		// poster-board layout is a workspace TYPE, not a global switch).
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(t('workspace.newTitle'))
			.setIcon('plus')
			.onClick(() => { void promptNewWorkspace(plugin); }));
		menu.addItem(item => item
			.setTitle(t('workspace.newImmersiveTitle'))
			.setIcon('gallery-vertical')
			.onClick(() => { void promptNewWorkspace(plugin, 'immersive'); }));
		menu.showAtMouseEvent(e);
	});
}
