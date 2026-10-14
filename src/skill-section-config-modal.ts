/**
 * Skills section settings: which home stores the library shows (custom
 * skillSourceFolders always show) and the group manager — group rows (drag
 * handle to reorder, name + match keywords, delete) with an add button. The
 * row list starts from the saved groups or, when the section has never saved
 * any, the built-in presets (fully editable — deleting every one and saving
 * persists an empty list). Pinned names, sort prefs, page size, assignments
 * and the import-target memory live on the same config and pass through
 * untouched — the toolbar's sort control owns them now (the old "default
 * sort" dropdown here was redundant with it).
 */

import { App, Modal, setIcon } from 'obsidian';
import type { SkillsSectionConfig, SkillCreateConfig, SkillSectionGroup } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { effectiveSkillGroups, getSkillLibraryStore, HOME_SKILL_STORES, UNGROUPED_ASSIGNMENT } from './skill-store';
import { startGuardedDrag } from './drag-guard';
import { SkillCreateConfigModal } from './skill-create-config-modal';
import type DashboardPlugin from './main';

/** Fresh group ids (config edits may rename or delete any row). */
let groupSeq = 0;
function newGroupId(): string {
	groupSeq += 1;
	return `g-${Date.now().toString(36)}-${groupSeq}`;
}

export class SkillSectionConfigModal extends Modal {
	private visibleStores: Set<string>;
	private groups: SkillSectionGroup[];

	constructor(
		app: App,
		private readonly existing: SkillsSectionConfig | undefined,
		private readonly onSave: (config: SkillsSectionConfig) => void,
		/** Needed for the nested new-skill config (skill picker context). */
		private readonly plugin?: DashboardPlugin,
	) {
		super(app);
		this.visibleStores = new Set(existing?.stores?.length ? existing.stores : HOME_SKILL_STORES.map(s => s.id));
		// Copy so Cancel discards edits; presets fill in until the user has
		// ever saved (undefined = never customized — see effectiveSkillGroups).
		this.groups = (existing?.groups ?? effectiveSkillGroups(undefined)).map(group => ({ ...group }));
		this.createSkill = existing?.createSkill;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-skillsec-cfg-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-skillsec-cfg' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skills.cfgTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const groupsSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		groupsSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.cfgGroups') });
		groupsSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.cfgGroupsHint') });
		this.listEl = groupsSection.createDiv({ cls: 'dashboard-skillsec-cfg-groups' });
		this.renderGroups();
		const addBtn = groupsSection.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-skillsec-cfg-add-group',
			text: t('skills.cfgAddGroup'),
			attr: { type: 'button' },
		});
		addBtn.addEventListener('click', () => {
			this.groups = [...this.groups, { id: newGroupId(), name: '', keywords: '' }];
			this.renderGroups();
		});

		const storesSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		storesSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.cfgStores') });
		storesSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.cfgStoresHint') });
		for (const store of HOME_SKILL_STORES) {
			const row = storesSection.createDiv({ cls: 'dashboard-skillsec-cfg-store' });
			const label = row.createEl('label', { cls: 'dashboard-skillsec-cfg-store-label' });
			const cb = label.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = this.visibleStores.has(store.id);
			cb.addEventListener('change', () => {
				this.visibleStores = new Set(cb.checked
					? [...this.visibleStores, store.id]
					: [...this.visibleStores].filter(id => id !== store.id));
			});
			label.createSpan({ cls: 'dashboard-skillsec-cfg-store-name', text: store.label });
			label.createSpan({ cls: 'dashboard-skillsec-cfg-store-dir', text: store.dir });
		}

		// Custom skill source folders — the entry point the home stores lack.
		// The scan engine (resolveSkillStores) has read settings.skillSourceFolders
		// all along; until now the only place to edit it was the quick-note
		// config. Desktop-only by nature ('~' allowed, comma-separated).
		if (this.plugin) {
			const foldersSection = body.createDiv({ cls: 'dashboard-library-config-section' });
			foldersSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.cfgFolders') });
			foldersSection.createDiv({ cls: 'dashboard-library-config-hint', text: t('skillPicker.foldersHint') });
			const foldersInput = foldersSection.createEl('input', {
				cls: 'dashboard-modal-input dashboard-skillsec-cfg-folders',
				attr: { type: 'text', placeholder: t('skillPicker.foldersPh') },
			});
			foldersInput.value = this.plugin.settings.skillSourceFolders ?? '';
			foldersInput.addEventListener('change', () => {
				this.foldersCsv = foldersInput.value.trim();
			});
		}

		// The header "new skill" button's dispatch config (re-configurable
		// here; the first click on the button itself sets it up otherwise).
		if (this.plugin) {
			const createSection = body.createDiv({ cls: 'dashboard-library-config-section' });
			createSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.cfgCreateBtn') });
			this.createSkillEl = createSection.createDiv({ cls: 'dashboard-skillsec-cfg-create-row' });
			this.renderCreateSkillRow();
		}

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
			attr: { type: 'button' },
		}).addEventListener('click', () => this.save());
	}

	private listEl: HTMLElement | null = null;
	private createSkill: SkillCreateConfig | undefined;
	private createSkillEl: HTMLElement | null = null;
	/** Draft of settings.skillSourceFolders — persisted on save when changed. */
	private foldersCsv: string | null = null;

	private renderGroups(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		if (this.groups.length === 0) {
			this.listEl.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.cfgNoGroups') });
			return;
		}
		for (const group of this.groups) {
			this.renderGroupRow(group);
		}
	}

	private renderGroupRow(group: SkillSectionGroup): void {
		const list = this.listEl!;
		const row = list.createDiv({ cls: 'dashboard-skillsec-cfg-group' });
		row.dataset.groupId = group.id;

		// Drag handle → live reorder (guarded pointer drag, table-columns
		// idiom); the group array re-reads from DOM order on release.
		const handle = row.createDiv({
			cls: 'dashboard-skillsec-cfg-group-handle',
			attr: { role: 'button', 'aria-label': t('skills.cfgGroupReorder') },
		});
		setIcon(handle, 'grip-vertical');
		handle.addEventListener('pointerdown', (ev) => {
			const e = ev;
			row.addClass('is-dragging');
			startGuardedDrag(e, {
				cursor: 'grabbing',
				onMove: (mv: PointerEvent): void => {
					const y = mv.clientY;
					const parent = row.parentElement;
					if (!parent) return;
					for (const sibling of Array.from(parent.children) as HTMLElement[]) {
						if (sibling === row) continue;
						const r = sibling.getBoundingClientRect();
						if (y < r.top + r.height / 2) {
							parent.insertBefore(row, sibling);
							return;
						}
					}
					parent.appendChild(row);
				},
				onUp: (): void => {
					row.removeClass('is-dragging');
					this.syncGroupsFromDom();
				},
			});
		});

		const nameInput = row.createEl('input', {
			cls: 'dashboard-skillsec-cfg-group-name',
			attr: { type: 'text', placeholder: t('skills.cfgGroupNamePh'), 'aria-label': t('skills.cfgGroupNamePh') },
		});
		nameInput.value = group.name;
		nameInput.addEventListener('input', () => {
			group.name = nameInput.value;
		});

		const kwInput = row.createEl('input', {
			cls: 'dashboard-skillsec-cfg-group-keywords',
			attr: { type: 'text', placeholder: t('skills.cfgGroupKeywordsPh'), 'aria-label': t('skills.cfgGroupKeywordsPh') },
		});
		kwInput.value = group.keywords ?? '';
		kwInput.addEventListener('input', () => {
			group.keywords = kwInput.value;
		});

		const delBtn = row.createEl('button', {
			cls: 'dashboard-skillsec-cfg-group-delete',
			attr: { type: 'button', 'aria-label': t('skills.cfgGroupDelete'), title: t('skills.cfgGroupDelete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', () => {
			this.groups = this.groups.filter(g => g.id !== group.id);
			this.renderGroups();
		});
	}

	/** Re-read group order from the DOM (drag's source of truth); the row
	 *  objects themselves already carry the latest name/keywords edits. */
	/** Current creator-skill dispatch summary + an edit launcher. */
	private renderCreateSkillRow(): void {
		if (!this.createSkillEl) return;
		this.createSkillEl.empty();
		this.createSkillEl.createSpan({
			cls: 'dashboard-skillsec-cfg-create-summary',
			text: this.createSkill
				? `${this.createSkill.skillName} → ${this.createSkill.agent}`
				: t('skills.cfgCreateUnset'),
		});
		const editBtn = this.createSkillEl.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-skillsec-cfg-create-edit',
			text: t('common.edit'),
			attr: { type: 'button' },
		});
		editBtn.addEventListener('click', () => {
			if (!this.plugin) return;
			new SkillCreateConfigModal(this.app, this.plugin, this.createSkill, cfg => {
				this.createSkill = cfg;
				this.renderCreateSkillRow();
			}).open();
		});
	}

	private syncGroupsFromDom(): void {
		if (!this.listEl) return;
		const byId = new Map(this.groups.map(g => [g.id, g]));
		this.groups = (Array.from(this.listEl.children) as HTMLElement[])
			.map(el => el.dataset.groupId ?? '')
			.filter(id => id.length > 0)
			.map(id => byId.get(id))
			.filter((g): g is SkillSectionGroup => !!g);
	}

	private save(): void {
		const visible = HOME_SKILL_STORES.map(s => s.id).filter(id => this.visibleStores.has(id));
		// Custom source folders changed → persist the global setting and bust
		// the scan cache BEFORE onSave, so the section refresh it triggers
		// re-renders with the new foldersCsv and rescans the added stores.
		const plugin = this.plugin;
		if (plugin && this.foldersCsv !== null && (plugin.settings.skillSourceFolders ?? '') !== this.foldersCsv) {
			plugin.settings = { ...plugin.settings, skillSourceFolders: this.foldersCsv };
			void plugin.saveSettings();
			getSkillLibraryStore(this.app).markDirty();
		}
		// Drop blank rows (add-button misclicks); trim the rest.
		const savedGroups = this.groups
			.map(g => ({ ...g, name: g.name.trim(), keywords: (g.keywords ?? '').trim() }))
			.filter(g => g.name.length > 0);
		// Assignments pointing at dropped groups go with them — the explicit
		// "ungrouped" sentinel survives (it's a state, not a group id).
		const keptIds = new Set(savedGroups.map(g => g.id));
		const assignments: Record<string, string> = {};
		for (const [skill, groupId] of Object.entries(this.existing?.assignments ?? {})) {
			if (keptIds.has(groupId) || groupId === UNGROUPED_ASSIGNMENT) assignments[skill] = groupId;
		}
		this.onSave({
			...this.existing,
			// All three visible is the default — persist nothing (round-trip
			// cleanliness; serialize omits defaults the same way).
			...(visible.length === HOME_SKILL_STORES.length ? {} : { stores: visible }),
			// Persisted whenever the modal saved — an explicitly emptied list
			// is meaningful (kills the preset fallback).
			groups: savedGroups,
			...(Object.keys(assignments).length > 0 ? { assignments } : {}),
			// The creator-skill dispatch config rides along (nested modal's
			// latest word wins over the pre-open snapshot).
			...(this.createSkill ? { createSkill: this.createSkill } : {}),
		});
		this.close();
	}
}
