import { App, Modal } from 'obsidian';
import type { TickTickProject } from './ticktick-service';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/**
 * Project-visibility picker for a TickTick section: one toggle row per remote
 * project (checked = visible). Save hands the hidden-id list back via onSave;
 * an empty set passes undefined so the setting stays clean.
 */
export class TickTickFilterModal extends Modal {
	private readonly projects: TickTickProject[];
	private readonly hidden: Set<string>;
	private readonly onSave: (hiddenProjects: string[] | undefined) => void;

	constructor(
		app: App,
		projects: TickTickProject[],
		hiddenProjects: string[] | undefined,
		onSave: (hiddenProjects: string[] | undefined) => void,
	) {
		super(app);
		this.projects = projects;
		this.hidden = new Set(hiddenProjects ?? []);
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('ticktick.filterProjects') });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		const list = body.createDiv({ cls: 'dashboard-library-config-filters' });
		for (const p of this.projects) {
			const row = list.createDiv({ cls: 'dashboard-library-config-inline-row' });
			const cb = row.createEl('input', {
				cls: 'dashboard-library-config-checkbox',
				attr: { type: 'checkbox' },
			});
			cb.checked = !this.hidden.has(p.id);
			cb.addEventListener('change', () => {
				if (cb.checked) this.hidden.delete(p.id);
				else this.hidden.add(p.id);
			});
			row.createDiv({ cls: 'dashboard-library-config-inline-label', text: p.name });
		}

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave(this.hidden.size > 0 ? [...this.hidden] : undefined);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
