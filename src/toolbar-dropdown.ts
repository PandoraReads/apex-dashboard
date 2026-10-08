import { Menu, setIcon } from 'obsidian';

export interface ToolbarDropdownItem {
	/** Stable key handed to onPick. */
	key: string;
	/** Full label shown in the menu. */
	label: string;
	/** Icon (Lucide name) shown on the collapsed button and in the menu. */
	icon?: string;
	/** Short text shown on the collapsed button when the item has no icon
	 *  (e.g. the S/M/L size letters). */
	short?: string;
	/** Item count appended in the menu as "label (n)" — e.g. an RSS bucket's
	 *  article tally. */
	count?: number;
}

/**
 * Single-button dropdown toggle for section toolbars: one pill showing the
 * CURRENT selection (its icon, or short text for letter-style entries), click
 * opens the native Obsidian menu with every option (a check on the active
 * one). Replaces the old row of always-visible view/size buttons.
 */
export function createToolbarDropdown(
	parent: HTMLElement,
	currentKey: string,
	items: readonly ToolbarDropdownItem[],
	onPick: (key: string) => void,
): HTMLElement {
	const current = items.find(i => i.key === currentKey) ?? items[0]!;
	const btn = parent.createDiv({
		cls: 'dashboard-library-view-btn dashboard-toolbar-dropdown',
		attr: { 'aria-label': current.label, 'aria-haspopup': 'menu' },
	});
	btn.title = current.label;
	if (current.icon) {
		setIcon(btn, current.icon);
	} else {
		btn.createSpan({ cls: 'dashboard-toolbar-dropdown-text', text: current.short ?? current.label });
	}

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		const menu = new Menu();
		for (const item of items) {
			const menuTitle = item.count !== undefined ? `${item.label} (${item.count})` : item.label;
			menu.addItem(mi => mi
				.setTitle(menuTitle)
				.setIcon(item.icon ?? '')
				.setChecked(item.key === currentKey)
				.onClick(() => { if (item.key !== currentKey) onPick(item.key); }));
		}
		menu.showAtMouseEvent(e);
	});
	return btn;
}
