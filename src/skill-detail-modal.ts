/**
 * Skill detail modal: full SKILL.md preview (MarkdownRenderer, desktop fs
 * only) plus one row per installed instance — store badge, path, mtime and
 * the instance actions (Finder reveal / copy path / OS-trash delete). The
 * modal owns no section state: mutations call back onChanged so the section
 * rescans, and the modal's own rows re-render from a local copy.
 */

import { App, Component, MarkdownRenderer, Modal, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { showConfirmDialog } from './confirm-dialog';
import { momentOf } from './datetime';
import {
	copySkillPath, revealSkillFolder, skillStoreBadge, skillStoreLabel, trashSkillFolder,
	type SkillEntry, type SkillFs, type SkillGroup,
} from './skill-store';

/** Full-file read cap for the preview — real SKILL.md bodies are far below
 *  this; the cap only guards against a mistaken giant file. */
const DETAIL_READ_BYTES = 262_144;

export interface SkillDetailModalOptions {
	/** Desktop seam; undefined (mobile) hides fs-dependent rows/actions. */
	fs?: SkillFs;
	pinned?: boolean;
	onTogglePin?: () => void;
	/** Called after an instance was trashed — the section rescans. */
	onChanged?: () => void;
	/** Open straight into the delete flow (card menu on a single instance). */
	focusDelete?: boolean;
}

export class SkillDetailModal extends Modal {
	private instances: SkillEntry[];
	private pinned: boolean;
	private description: string;
	/** MarkdownRenderer needs a live Component — created per render and
	 *  unloaded on close (rss-article-modal idiom). */
	private renderComponent: Component | null = null;

	constructor(
		app: App,
		private readonly group: SkillGroup,
		private readonly options: SkillDetailModalOptions,
	) {
		super(app);
		this.instances = group.instances.map(inst => ({ ...inst }));
		this.pinned = options.pinned ?? false;
		this.description = group.description;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-skillsec-detail-modal');
		// Widen the .modal element itself (not an inner div — Obsidian sizes
		// and centers .modal via --dialog-width, and an oversized inner div
		// spills right past the clip).
		containerEl.addClass('modal--dashboard', 'dashboard-skillsec-detail-modal');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-skillsec-detail' });

		const header = container.createDiv({ cls: 'dashboard-modal-header dashboard-skillsec-detail-header' });
		const titleRow = header.createDiv({ cls: 'dashboard-skillsec-detail-title-row' });
		titleRow.createDiv({ cls: 'dashboard-modal-title', text: this.group.name });
		const badges = titleRow.createDiv({ cls: 'dashboard-skillsec-badges' });
		for (const instance of this.instances) {
			badges.createSpan({
				cls: `dashboard-skillsec-badge is-${instance.storeId.startsWith('custom:') ? 'custom' : instance.storeId}`,
				text: skillStoreBadge(instance.storeId),
				attr: { title: instance.dirPath },
			});
		}
		if (this.options.onTogglePin) {
			const pinBtn = header.createEl('button', {
				cls: 'dashboard-skillsec-detail-pin' + (this.pinned ? ' is-pinned' : ''),
				attr: { type: 'button', 'aria-label': this.pinned ? t('skills.unpin') : t('skills.pin'), title: this.pinned ? t('skills.unpin') : t('skills.pin') },
			});
			setIcon(pinBtn, this.pinned ? 'pin-off' : 'pin');
			pinBtn.addEventListener('click', () => {
				this.pinned = !this.pinned;
				setIcon(pinBtn, this.pinned ? 'pin-off' : 'pin');
				pinBtn.classList[this.pinned ? 'add' : 'remove']('is-pinned');
				this.options.onTogglePin!();
			});
		}

		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-skillsec-detail-body' });
		this.renderBody(body);

		if (this.options.focusDelete && this.instances.length === 1) {
			void this.confirmRemove(this.instances[0]!);
		}
	}

	onClose(): void {
		this.renderComponent?.unload();
		this.renderComponent = null;
	}

	private renderBody(body: HTMLElement): void {
		body.empty();

		if (this.description) {
			body.createDiv({ cls: 'dashboard-skillsec-detail-desc', text: this.description });
		}

		const section = body.createDiv({ cls: 'dashboard-library-config-section' });
		section.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.detailInstances') });
		for (const instance of this.instances) {
			this.renderInstanceRow(section, instance);
		}

		// Full SKILL.md preview (desktop fs only — mobile shows the metadata
		// above; the snapshot carries descriptions but not file bodies).
		if (this.options.fs) {
			const docSection = body.createDiv({ cls: 'dashboard-library-config-section' });
			docSection.createDiv({ cls: 'dashboard-library-config-section-title', text: 'SKILL.md' });
			const docBody = docSection.createDiv({ cls: 'dashboard-skillsec-detail-doc' });
			docBody.createDiv({ cls: 'dashboard-skillsec-detail-doc-loading', text: t('skills.scanning') });
			void this.options.fs.readTextHead(`${this.group.instances[0]!.dirPath}/SKILL.md`, DETAIL_READ_BYTES)
				.then(content => {
					docBody.empty();
					const component = new Component();
					component.load();
					this.renderComponent = component;
					// Rendered markdown unloads with the modal (onClose).
					return MarkdownRenderer.render(this.app, content, docBody, '', component);
				})
				.catch(() => {
					docBody.empty();
					docBody.createDiv({ cls: 'dashboard-skillsec-detail-doc-error', text: t('skills.docReadFailed') });
				});
		}
	}

	private renderInstanceRow(parent: HTMLElement, instance: SkillEntry): void {
		const row = parent.createDiv({ cls: 'dashboard-skillsec-instance' });
		row.dataset.dirpath = instance.dirPath;
		row.createSpan({
			cls: `dashboard-skillsec-badge is-${instance.storeId.startsWith('custom:') ? 'custom' : instance.storeId}`,
			text: skillStoreBadge(instance.storeId),
			attr: { title: skillStoreLabel(instance.storeId) },
		});
		const main = row.createDiv({ cls: 'dashboard-skillsec-instance-main' });
		main.createDiv({ cls: 'dashboard-skillsec-instance-path', text: instance.dirPath, attr: { title: instance.dirPath } });
		const m = momentOf(instance.mtimeMs);
		main.createDiv({ cls: 'dashboard-skillsec-instance-date', text: t('skills.detailModified', { date: m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '—' }) });

		const actions = row.createDiv({ cls: 'dashboard-skillsec-instance-actions' });
		if (this.options.fs) {
			const revealBtn = actions.createEl('button', {
				cls: 'dashboard-skillsec-instance-btn',
				attr: { type: 'button', 'aria-label': t('skills.reveal'), title: t('skills.reveal') },
			});
			setIcon(revealBtn, 'folder-open');
			revealBtn.addEventListener('click', ev => {
				ev.stopPropagation();
				revealSkillFolder(instance.dirPath);
			});
		}
		const copyBtn = actions.createEl('button', {
			cls: 'dashboard-skillsec-instance-btn',
			attr: { type: 'button', 'aria-label': t('skills.copyPath'), title: t('skills.copyPath') },
		});
		setIcon(copyBtn, 'copy');
		copyBtn.addEventListener('click', ev => {
			ev.stopPropagation();
			void copySkillPath(instance.dirPath).then(ok => {
				new Notice(ok ? t('skills.copied') : t('skills.copyFailed'));
			});
		});
		if (this.options.fs) {
			const deleteBtn = actions.createEl('button', {
				cls: 'dashboard-skillsec-instance-btn dashboard-skillsec-instance-delete',
				attr: { type: 'button', 'aria-label': t('skills.remove'), title: t('skills.remove') },
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', ev => {
				ev.stopPropagation();
				void this.confirmRemove(instance);
			});
		}
	}

	private async confirmRemove(instance: SkillEntry): Promise<void> {
		const confirmed = await showConfirmDialog(null, {
			title: t('skills.removeConfirmTitle'),
			message: t('skills.removeConfirmMsg', { name: this.group.name, store: skillStoreLabel(instance.storeId), path: instance.dirPath }),
			confirmLabel: t('skills.remove'),
			destructive: true,
		});
		if (!confirmed) return;
		const ok = await trashSkillFolder(instance.dirPath);
		if (!ok) return;
		new Notice(t('skills.removed', { name: this.group.name }));
		this.instances = this.instances.filter(inst => inst.dirPath !== instance.dirPath);
		if (this.instances.length === 0) {
			this.options.onChanged?.();
			this.close();
			return;
		}
		const body = this.contentEl.querySelector('.dashboard-skillsec-detail-body');
		if (body) this.renderBody(body as HTMLElement);
		this.options.onChanged?.();
	}
}
