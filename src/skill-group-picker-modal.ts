/**
 * One-skill group picker: radio rows for every configured group plus an
 * "ungrouped" option. Picking commits immediately through onPick (the
 * section routes it into dashboard-skills-prefs) — no footer buttons, the
 * modal is a quick assignment surface, not a form.
 */

import { App, Modal, setIcon } from 'obsidian';
import type { SkillSectionGroup } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export class SkillGroupPickerModal extends Modal {
	constructor(
		app: App,
		private readonly groups: readonly SkillSectionGroup[],
		private readonly currentId: string | null,
		private readonly onPick: (groupId: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-skillsec-grouppick-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-skillsec-grouppick' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skills.setGroup') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const renderRow = (label: string, id: string | null, icon: string): void => {
			const row = body.createDiv({
				cls: 'dashboard-skillsec-grouppick-row' + (this.currentId === id ? ' is-active' : ''),
				attr: { role: 'button', tabindex: '0' },
			});
			const check = row.createSpan({ cls: 'dashboard-skillsec-grouppick-check' });
			if (this.currentId === id) setIcon(check, 'check');
			row.createSpan({ cls: 'dashboard-skillsec-grouppick-label', text: label });
			const glyph = row.createSpan({ cls: 'dashboard-skillsec-grouppick-glyph' });
			setIcon(glyph, icon);
			const commit = (): void => {
				this.onPick(id);
				this.close();
			};
			row.addEventListener('click', commit);
			row.addEventListener('keydown', ev => {
				const key = (ev as KeyboardEvent).key;
				if (key === 'Enter' || key === ' ') {
					ev.preventDefault();
					commit();
				}
			});
		};
		renderRow(t('skills.ungrouped'), null, 'inbox');
		for (const group of this.groups) renderRow(group.name, group.id, 'folder');
	}
}
