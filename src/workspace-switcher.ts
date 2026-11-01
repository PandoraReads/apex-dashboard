import { Menu, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { showPromptDialog } from './prompt-dialog';
import { showConfirmDialog } from './confirm-dialog';
import { normalizeWorkspacePath } from './workspace-registry';
import { isImmersiveMode } from './immersive-grid';
import type { DashboardLayoutMode } from './types';

/** Display label for a workspace: its name, else the file path. */
function workspaceLabel(name: string, path: string): string {
	return name.trim() || `${path}.md`;
}

/** Menu label + icon per layout mode. Both immersive tones share the poster
 *  icon language; the light one is marked by the sun so the two entries stay
 *  distinguishable at a glance. */
const LAYOUT_MENU_ENTRIES: Readonly<Record<DashboardLayoutMode, { label: string; icon: string }>> = {
	'side': { label: 'settings.layoutSide', icon: 'panels-top-left' },
	'stacked': { label: 'settings.layoutStacked', icon: 'rows-3' },
	'immersive': { label: 'settings.layoutImmersive', icon: 'gallery-vertical' },
	'immersive-light': { label: 'settings.layoutImmersiveLight', icon: 'sun' },
};

/** Order the layout entries appear in the menu. */
const LAYOUT_MENU_ORDER: readonly DashboardLayoutMode[] = ['side', 'stacked', 'immersive', 'immersive-light'];

/** Open the "new workspace" dialog and create the workspace on confirm.
 *  `layout` seeds the board file's `layout:` override (the immersive-hub
 *  flavour of the + menu). */
async function promptNewWorkspace(plugin: DashboardPlugin, layout?: DashboardLayoutMode): Promise<void> {
	const files = plugin.settings.workspaceFiles;
	const fallback = t('workspace.defaultName', { n: files.length + 1 });
	const name = await showPromptDialog(plugin.app, {
		title: isImmersiveMode(layout) ? t('workspace.newImmersiveTitle') : t('workspace.newTitle'),
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
		if (isImmersiveMode(current)) menu.addItem(item => item.setTitle(t('gantt.background')).setIcon('image').onClick(() => activeView?.editBackground()));
		for (const mode of LAYOUT_MENU_ORDER) {
			menu.addItem(item => {
				const entry = LAYOUT_MENU_ENTRIES[mode];
				item
					.setTitle(t(entry.label))
					.setIcon(entry.icon)
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
			openWorkspaceMenu(plugin, file, name, isActive, ev);
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
