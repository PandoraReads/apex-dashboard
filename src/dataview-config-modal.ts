import { App, Modal, setIcon } from 'obsidian';
import type { DataviewConfig } from './types';
import { t } from './i18n';
import { checkSyntax } from './dql';

/** One-click query templates shown as chips in the config modal. Each is a
 *  concrete, useful DQL query exercising different features. */
interface SampleQuery {
	readonly key: string;
	readonly dql: string;
}

const SAMPLE_QUERIES: readonly SampleQuery[] = [
	{
		key: 'dataview.sample_incompleteTasks',
		dql: 'TASK\nFROM #project\nWHERE !completed',
	},
	{
		key: 'dataview.sample_topBooks',
		dql: 'TABLE file.name AS "Title", rating AS "Rating", author AS "Author"\nFROM "Books"\nWHERE rating >= 4\nSORT rating DESC, file.name ASC\nLIMIT 10',
	},
	{
		key: 'dataview.sample_createdThisWeek',
		dql: 'LIST\nWHERE file.cday >= date(today) - dur("7 days")\nSORT file.cday DESC',
	},
	{
		key: 'dataview.sample_dueNotes',
		dql: 'TABLE rows.file.name AS "Notes"\nWHERE due\nGROUP BY dateformat(due, "yyyy-MM-dd") AS "Due"\nSORT due ASC',
	},
	{
		key: 'dataview.sample_flatTags',
		dql: 'TABLE file.name AS "Note", tag AS "Tag"\nFROM "Journal"\nFLATTEN file.tags AS tag\nSORT file.mtime DESC\nLIMIT 20',
	},
	{
		key: 'dataview.sample_authorCounts',
		dql: 'TABLE length(rows) AS "Books", rows.file.name AS "Titles"\nFROM "Books"\nGROUP BY author\nSORT length(rows) DESC',
	},
	{
		key: 'dataview.sample_heatmap',
		dql: 'HEATMAP rating FROM "Books" USING finished',
	},
];

/**
 * Configuration modal for a Dataview section. Edits the per-section
 * {@link DataviewConfig} (the raw DQL query + optional title). Provides live
 * syntax validation and one-click sample queries.
 */
export class DataviewConfigModal extends Modal {
	private config: DataviewConfig;
	private readonly onSave: (config: DataviewConfig) => void;
	private queryInput: HTMLTextAreaElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(app: App, config: DataviewConfig, onSave: (config: DataviewConfig) => void) {
		super(app);
		this.onSave = onSave;
		this.config = { ...config };
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });

		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('dataview.configure') });
		const closeBtn = header.createDiv({ cls: 'dashboard-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		// Sample query chips (inserted into the textarea on click).
		const sampleSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		sampleSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('dataview.samples') });
		const chipsHost = sampleSection.createDiv({ cls: 'dashboard-dataview-sample-chips' });
		for (const sample of SAMPLE_QUERIES) {
			const chip = chipsHost.createDiv({ cls: 'dashboard-dataview-sample-chip' });
			chip.createSpan({ text: t(sample.key) });
			chip.addEventListener('click', () => {
				this.config = { ...this.config, query: sample.dql };
				if (this.queryInput) this.queryInput.value = sample.dql;
				this.validate();
			});
		}

		// DQL query textarea.
		const querySection = body.createDiv({ cls: 'dashboard-library-config-section' });
		querySection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('dataview.queryLabel') });
		this.queryInput = querySection.createEl('textarea', {
			cls: 'dashboard-dataview-query-input',
			attr: {
				placeholder: t('dataview.queryPlaceholder'),
				spellcheck: 'false',
				rows: '8',
				autocomplete: 'off',
			},
		});
		this.queryInput.value = this.config.query;
		this.queryInput.addEventListener('input', () => {
			this.config = { ...this.config, query: this.queryInput?.value ?? '' };
			this.validate();
		});

		// Live validation status (rendered under the textarea).
		this.errorEl = querySection.createDiv({ cls: 'dashboard-dataview-validation' });
		this.validate();

		// Optional title override.
		const titleSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		titleSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('dataview.titleLabel') });
		const titleInput = titleSection.createEl('input', {
			cls: 'dashboard-task-input',
			attr: { type: 'text', placeholder: t('dataview.titlePlaceholder'), value: this.config.title ?? '' },
		});
		titleInput.addEventListener('change', () => {
			const value = titleInput.value.trim();
			this.config = { ...this.config, title: value.length > 0 ? value : undefined };
		});

		// Footer.
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.save'),
		}).addEventListener('click', () => {
			this.onSave(this.config);
			this.close();
		});

		window.setTimeout(() => this.queryInput?.focus(), 0);
	}

	/** Run a syntax check and reflect the result in the validation line. */
	private validate(): void {
		if (!this.errorEl) return;
		const query = this.config.query.trim();
		if (query.length === 0) {
			this.errorEl.empty();
			this.errorEl.removeClass('is-error');
			return;
		}
		const result = checkSyntax(this.config.query);
		if (result.ok) {
			this.errorEl.empty();
			this.errorEl.removeClass('is-error');
			this.errorEl.createSpan({ cls: 'dashboard-dataview-validation-ok', text: t('dataview.valid') });
		} else {
			this.errorEl.empty();
			this.errorEl.addClass('is-error');
			this.errorEl.createSpan({ text: t('dataview.parseError', { message: result.error.message }) });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
