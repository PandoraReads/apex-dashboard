import { App, Modal, setIcon } from 'obsidian';
import type { TickTickConfig, TickTickWidget } from './types';
import { t } from './i18n';
import { TickTickClient } from './ticktick-service';
import type { TickTickProject } from './ticktick-service';

const VIEW_OPTIONS: Array<{ value: TickTickWidget['view']; labelKey: string }> = [
	{ value: 'today', labelKey: 'ticktick.viewToday' },
	{ value: 'projects', labelKey: 'ticktick.viewProjects' },
	{ value: 'completed', labelKey: 'ticktick.viewCompleted' },
	{ value: 'habits', labelKey: 'ticktick.viewHabits' },
];

/**
 * Configuration modal for a TickTick section: an ordered list of widgets
 * (add / remove / reorder; per-widget type, optional title, project filter for
 * the "projects" widget, days-back for the "completed" widget).
 */
export class TickTickConfigModal extends Modal {
	private widgets: TickTickWidget[];
	private readonly projects: TickTickProject[];
	private readonly onSave: (config: TickTickConfig) => void;

	constructor(app: App, config: TickTickConfig, projects: TickTickProject[], onSave: (config: TickTickConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.projects = projects;
		this.widgets = (config.widgets?.length ? config.widgets : [{ id: 'w1', view: 'today' as const }]).map(w => ({ ...w }));
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('ticktick.configure') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({ cls: 'dashboard-library-config-section-title', text: t('ticktick.widgetsLabel') });
		if (this.projects.length === 0) {
			body.createDiv({ cls: 'dashboard-library-config-hint', text: t('ticktick.projectFilterHint') });
		}

		const list = body.createDiv({ cls: 'dashboard-ticktick-cfg-list' });

		const render = (): void => {
			list.empty();
			this.widgets.forEach((w, i) => {
				const row = list.createDiv({ cls: 'dashboard-weread-cfg-row dashboard-ticktick-cfg-row' });
				const main = row.createDiv({ cls: 'dashboard-weread-cfg-main' });

				const titleInput = main.createEl('input', {
					cls: 'dashboard-weread-cfg-title',
					attr: { type: 'text', placeholder: t('ticktick.widgetTitlePlaceholder'), value: w.title ?? '' },
				});
				titleInput.addEventListener('change', () => {
					const v = titleInput.value.trim();
					w.title = v.length > 0 ? v : undefined;
				});

				const viewSelect = main.createEl('select', { cls: 'dashboard-library-filter-property' });
				for (const v of VIEW_OPTIONS) {
					const opt = viewSelect.createEl('option', { text: t(v.labelKey), attr: { value: v.value } });
					if (w.view === v.value) opt.selected = true;
				}
				viewSelect.addEventListener('change', () => {
					w.view = viewSelect.value as TickTickWidget['view'];
					render();
				});

				if (w.view === 'projects' && this.projects.length > 0) {
					const projSelect = main.createEl('select', { cls: 'dashboard-library-filter-property dashboard-weread-cfg-filter' });
					projSelect.createEl('option', { text: t('ticktick.allProjects'), attr: { value: '' } });
					for (const p of this.projects) {
						const opt = projSelect.createEl('option', { text: p.name, attr: { value: p.id } });
						if (w.projectId === p.id) opt.selected = true;
					}
					projSelect.addEventListener('change', () => {
						w.projectId = projSelect.value || undefined;
					});
				}
				if (w.view === 'completed') {
					const daysInput = main.createEl('input', {
						cls: 'dashboard-library-config-number',
						attr: { type: 'number', min: '1', max: '90', value: String(w.days ?? 1), 'aria-label': t('ticktick.daysBack') },
					});
					daysInput.title = t('ticktick.daysBack');
					daysInput.addEventListener('change', () => {
						w.days = Math.max(1, Math.min(90, Math.floor(Number(daysInput.value) || 1)));
					});
				}

				const ops = row.createDiv({ cls: 'dashboard-weread-cfg-ops' });
				const upBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': 'Move up' } });
				setIcon(upBtn, 'chevron-up');
				upBtn.disabled = i === 0;
				upBtn.addEventListener('click', () => this.swap(i, i - 1, render));
				const downBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': 'Move down' } });
				setIcon(downBtn, 'chevron-down');
				downBtn.disabled = i === this.widgets.length - 1;
				downBtn.addEventListener('click', () => this.swap(i, i + 1, render));
				const rmBtn = ops.createEl('button', { cls: 'dashboard-weread-cfg-op', attr: { type: 'button', 'aria-label': t('common.delete') } });
				setIcon(rmBtn, 'trash-2');
				rmBtn.addEventListener('click', () => {
					this.widgets = this.widgets.filter((_, idx) => idx !== i);
					render();
				});
			});
		};

		body.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm dashboard-weread-cfg-add',
			text: t('ticktick.addWidget'),
		}).addEventListener('click', () => {
			this.widgets = [...this.widgets, { id: `w${Date.now()}`, view: 'today' }];
			render();
		});

		render();

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave({ widgets: this.widgets.length > 0 ? this.widgets : [{ id: 'w1', view: 'today' }] });
			this.close();
		});
	}

	private swap(a: number, b: number, rerender: () => void): void {
		if (b < 0 || b >= this.widgets.length) return;
		const next = [...this.widgets];
		const tmp = next[a]!;
		next[a] = next[b]!;
		next[b] = tmp;
		this.widgets = next;
		rerender();
	}
}

/** Helper for view.ts: fetch the project list to populate the config modal's project filter. */
export async function fetchTickTickProjects(region: 'dida365' | 'ticktick', cookie: string, deviceVersion?: string): Promise<TickTickProject[]> {
	const client = new TickTickClient(region, cookie, deviceVersion);
	if (!client.isConfigured()) return [];
	try {
		return (await client.fetchSnapshot()).projects;
	} catch {
		return [];
	}
}
