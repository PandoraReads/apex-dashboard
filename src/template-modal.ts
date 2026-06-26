import { Modal, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import type { TaskTemplate } from './types';
import { t } from './i18n';
import { showConfirmDialog } from './confirm-dialog';

type TemplateSelectCallback = (template: TaskTemplate) => void;

export class TemplatePickerModal extends Modal {
	private plugin: DashboardPlugin;
	private onSelect: TemplateSelectCallback;
	private theme: string;
	private mode: 'pick' | 'edit' = 'pick';
	private editingTemplate: TaskTemplate | null = null;

	constructor(
		app: import('obsidian').App,
		plugin: DashboardPlugin,
		onSelect: TemplateSelectCallback,
		theme?: string,
	) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
		this.theme = theme ?? 'earth';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		this.render();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}

	private getTemplates(): TaskTemplate[] {
		return this.plugin.settings.taskTemplates ?? [];
	}

	private async saveTemplates(templates: TaskTemplate[]): Promise<void> {
		this.plugin.settings = {
			...this.plugin.settings,
			taskTemplates: templates,
		};
		await this.plugin.saveSettings();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.mode === 'edit') {
			this.renderEditMode(contentEl);
			return;
		}

		const templates = this.getTemplates();

		const header = contentEl.createDiv({ cls: 'template-modal-header' });
		header.createEl('h2', { text: t('template.selectTemplate') });

		const manageBtn = header.createEl('button', {
			cls: 'template-modal-manage-btn',
			text: t('template.manageTemplates'),
		});
		manageBtn.addEventListener('click', () => {
			this.mode = 'edit';
			this.editingTemplate = null;
			this.render();
		});

		if (templates.length === 0) {
			const empty = contentEl.createDiv({ cls: 'template-modal-empty' });
			empty.createDiv({ text: t('template.empty') });
			const createBtn = empty.createEl('button', {
				cls: 'mod-cta',
				text: t('template.createFirst'),
			});
			createBtn.addEventListener('click', () => {
				this.editingTemplate = null;
				this.mode = 'edit';
				this.render();
			});
			return;
		}

		const list = contentEl.createDiv({ cls: 'template-modal-list' });

		let selectedId: string | null = null;

		for (const tmpl of templates) {
			const item = list.createDiv({ cls: 'template-modal-item' });
			item.dataset.templateId = tmpl.id;

			const info = item.createDiv({ cls: 'template-modal-item-info' });
			info.createDiv({ cls: 'template-modal-item-name', text: tmpl.name });
			info.createDiv({
				cls: 'template-modal-item-count',
				text: t('template.taskCount', { count: tmpl.tasks.length }),
			});

			// Task preview
			if (tmpl.tasks.length > 0) {
				const preview = item.createDiv({ cls: 'template-modal-item-preview' });
				const maxPreview = 3;
				for (let i = 0; i < Math.min(tmpl.tasks.length, maxPreview); i++) {
					preview.createDiv({ cls: 'template-modal-item-preview-task', text: tmpl.tasks[i]! });
				}
				if (tmpl.tasks.length > maxPreview) {
					preview.createDiv({
						cls: 'template-modal-item-preview-more',
						text: `+${tmpl.tasks.length - maxPreview}`,
					});
				}
			}

			item.addEventListener('click', () => {
				list.querySelectorAll('.template-modal-item').forEach(el => {
					(el as HTMLElement).removeClass('template-modal-item--selected');
				});
				item.addClass('template-modal-item--selected');
				selectedId = tmpl.id;
			});
		}

		const actions = contentEl.createDiv({ cls: 'template-modal-actions' });

		const confirmBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('template.confirm'),
		});
		confirmBtn.addEventListener('click', () => {
			if (!selectedId) return;
			const found = templates.find(tmpl => tmpl.id === selectedId);
			if (found) {
				this.onSelect(found);
				this.close();
			}
		});
	}

	private renderEditMode(contentEl: HTMLElement): void {
		const templates = this.getTemplates();
		const isNew = this.editingTemplate === null;
		const editing = this.editingTemplate;

		const header = contentEl.createDiv({ cls: 'template-modal-header' });
		header.createEl('h2', { text: isNew ? t('template.create') : t('template.edit') });

		const backBtn = header.createEl('button', {
			cls: 'template-modal-back-btn',
			text: t('template.back'),
		});
		backBtn.addEventListener('click', () => {
			this.mode = 'pick';
			this.editingTemplate = null;
			this.render();
		});

		// Template list (when not editing a specific template)
		if (isNew) {
			if (templates.length > 0) {
				const existingList = contentEl.createDiv({ cls: 'template-modal-manage-list' });
				for (const tmpl of templates) {
					const row = existingList.createDiv({ cls: 'template-modal-manage-row' });
					row.createDiv({ cls: 'template-modal-manage-name', text: tmpl.name });
					row.createDiv({
						cls: 'template-modal-manage-count',
						text: t('template.taskCount', { count: tmpl.tasks.length }),
					});

					const editBtn = row.createEl('button', {
						cls: 'template-modal-manage-edit',
						attr: { 'aria-label': t('template.edit') },
					});
					setIcon(editBtn, 'pencil');
					editBtn.addEventListener('click', () => {
						this.editingTemplate = { ...tmpl, tasks: [...tmpl.tasks] };
						this.render();
					});

					const deleteBtn = row.createEl('button', {
						cls: 'template-modal-manage-delete',
						attr: { 'aria-label': t('template.delete') },
					});
					setIcon(deleteBtn, 'trash-2');
					const tmplId = tmpl.id;
					deleteBtn.addEventListener('click', () => {
						void (async () => {
							const confirmed = await showConfirmDialog(this.app, {
								title: t('common.confirmDelete'),
								message: t('common.confirmDeleteMessage'),
							});
							if (!confirmed) return;
							const updated = templates.filter(item => item.id !== tmplId);
							await this.saveTemplates(updated);
							this.render();
						})();
					});
				}
			}

			const createBtn = contentEl.createEl('button', {
				cls: 'template-modal-create-btn mod-cta',
				text: t('template.create'),
			});
			createBtn.addEventListener('click', () => {
				this.editingTemplate = {
					id: `tmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
					name: '',
					tasks: [''],
				};
				this.render();
			});
			return;
		}

		// Edit form
		const form = contentEl.createDiv({ cls: 'template-modal-form' });

		const nameField = form.createDiv({ cls: 'template-modal-field' });
		nameField.createEl('label', { text: t('template.nameLabel') });
		const nameInput = nameField.createEl('input', {
			cls: 'dashboard-modal-input template-modal-input',
			attr: {
				type: 'text',
				placeholder: t('template.namePlaceholder'),
				value: editing!.name,
			},
		});

		const tasksField = form.createDiv({ cls: 'template-modal-field' });
		tasksField.createEl('label', { text: t('template.tasksLabel') });

		const taskList = tasksField.createDiv({ cls: 'template-modal-task-list' });

		const taskInputs: HTMLInputElement[] = [];

		const renderTaskInputs = () => {
			taskList.empty();
			taskInputs.length = 0;

			const tasks = editing!.tasks;
			for (let i = 0; i < tasks.length; i++) {
				const taskRow = taskList.createDiv({ cls: 'template-modal-task-row' });
				const input = taskRow.createEl('input', {
					cls: 'dashboard-modal-input template-modal-input',
					attr: {
						type: 'text',
						placeholder: t('template.taskPlaceholder'),
						value: tasks[i] ?? '',
					},
				});
				taskInputs.push(input);

				const taskIndex = i;
				input.addEventListener('input', () => {
					const newTasks = [...editing!.tasks];
					newTasks[taskIndex] = input.value;
					editing!.tasks = newTasks;
				});

				const removeBtn = taskRow.createEl('button', {
					cls: 'template-modal-task-remove',
					attr: { 'aria-label': t('template.delete') },
				});
				setIcon(removeBtn, 'x');
				removeBtn.addEventListener('click', () => {
					const newTasks = editing!.tasks.filter((_, idx) => idx !== taskIndex);
					editing!.tasks = newTasks.length === 0 ? [''] : newTasks;
					renderTaskInputs();
				});
			}

			const addTaskBtn = taskList.createEl('button', {
				cls: 'template-modal-add-task',
				text: t('template.addTask'),
			});
			addTaskBtn.addEventListener('click', () => {
				editing!.tasks = [...editing!.tasks, ''];
				renderTaskInputs();
				const lastInput = taskInputs[taskInputs.length - 1];
				if (lastInput) {
					lastInput.focus();
				}
			});
		};

		renderTaskInputs();

		const actions = form.createDiv({ cls: 'template-modal-form-actions' });

		const saveBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('template.save'),
		});
		saveBtn.addEventListener('click', () => {
			void (async () => {
				const name = nameInput.value.trim();
				if (!name) {
					nameInput.focus();
					return;
				}

				const tasks = editing!.tasks.filter(task => task.trim() !== '');
				if (tasks.length === 0) {
					return;
				}

				const saved: TaskTemplate = { ...editing!, name, tasks: [...tasks] };

				const existing = [...this.getTemplates()];
				const idx = existing.findIndex(tmpl => tmpl.id === saved.id);
				if (idx >= 0) {
					existing[idx] = saved;
				} else {
					existing.push(saved);
				}

				await this.saveTemplates(existing);
				this.editingTemplate = null;
				this.mode = 'edit';
				this.render();
			})();
		});

		nameInput.focus();
	}
}
