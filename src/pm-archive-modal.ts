import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { PmConfig } from './types';
import { t } from './i18n';
import { applyModalTheme, removeNativeModalCloseButton } from './modal-theme';
import { collectArchivedPmProjects, pmField, pmStageColor } from './pm-model';
import { normalizeFolderPath } from './pipeline-model';
import { PmBoardModal, deletePmProject, notifyPmChanged } from './pm-board-modal';

/** Restore: clear the archived flag and, when the note sits inside the
 *  configured archive folder, move it back into the section root. */
export async function restorePmProject(app: App, file: TFile, cfg: PmConfig): Promise<void> {
	await app.fileManager.processFrontMatter(file, fm => { delete fm['archived']; });
	const archive = normalizeFolderPath(cfg.archiveFolder ?? '');
	const root = normalizeFolderPath(cfg.rootFolder ?? '');
	if (archive && root && file.path.toLowerCase().startsWith(archive.toLowerCase() + '/')) {
		try {
			await app.fileManager.renameFile(file, `${root}/${file.name}`);
		} catch {
			// Name conflict back in the root: the flag is already cleared, so
			// the project boards again from wherever the file sits.
		}
	}
	new Notice(t('pm.archive.restored'));
	notifyPmChanged();
}

/**
 * Lightweight archived-projects viewer: one compact row per archived note —
 * title, stage badge, milestone/todo counts — clicking opens the FULL
 * project board (overview, milestones, todos all stay readable/editable;
 * archiving only removes a note from the live board). Restore clears the
 * flag (and moves the note home); delete trashes it after a confirm.
 */
export class PmArchiveModal extends Modal {
	private readonly cfg: PmConfig;
	private readonly onChanged: (() => void) | null;

	constructor(app: App, cfg: PmConfig, onChanged?: () => void) {
		super(app);
		this.cfg = cfg;
		this.onChanged = onChanged ?? null;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-pmsec-archive' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('pm.archive.title') });
		const closeBtn = header.createEl('button', { cls: 'dashboard-pmsec-close', attr: { 'aria-label': t('common.close') } });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());
		removeNativeModalCloseButton(containerEl);

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const projects = collectArchivedPmProjects(this.app, this.cfg);
		if (projects.length === 0) {
			body.createDiv({ cls: 'dashboard-library-empty', text: t('pm.archive.empty') });
			return;
		}

		const list = body.createDiv({ cls: 'dashboard-pmsec-arch-list' });
		for (const project of projects) {
			const row = list.createDiv({ cls: 'dashboard-pmsec-arch-item' });
			const main = row.createDiv({ cls: 'dashboard-pmsec-arch-main' });
			main.createDiv({ cls: 'dashboard-pmsec-arch-title', text: project.file.basename });
			const stage = pmField(project.frontmatter, 'stage');
			if (stage) {
				const badge = main.createSpan({ cls: 'dashboard-pmsec-badge' });
				badge.createSpan({ cls: 'dashboard-pmsec-badge-dot' });
				badge.createSpan({ cls: 'dashboard-pmsec-badge-text', text: stage });
				badge.style.setProperty('--pmsec-stage', pmStageColor(this.cfg.stages, stage));
			}
			main.createSpan({
				cls: 'dashboard-pmsec-arch-counts',
				text: `${t('pm.board.milestones')} ${project.milestones.done}/${project.milestones.total}`
					+ ` · ${t('pm.board.todos')} ${project.todos.done}/${project.todos.total}`,
			});
			// The whole row opens the full board — archived data stays
			// completely viewable (and editable).
			row.addEventListener('click', () => {
				new PmBoardModal(this.app, project.file, this.cfg, this.onChanged ?? undefined).open();
			});
			const restoreBtn = row.createEl('button', {
				cls: 'dashboard-modal-btn',
				text: t('pm.archive.restore'),
				attr: { type: 'button' },
			});
			restoreBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void (async () => {
					await restorePmProject(this.app, project.file, this.cfg);
					this.onChanged?.();
					await this.rerender();
				})();
			});
			const deleteBtn = row.createEl('button', {
				cls: 'dashboard-pmsec-arch-delete',
				attr: { type: 'button', 'aria-label': t('pm.board.delete'), title: t('pm.board.delete') },
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void (async () => {
					if (await deletePmProject(this.app, project.file)) await this.rerender();
				})();
			});
		}
	}

	private async rerender(): Promise<void> {
		// Rebuild in place (restore/delete changed the collection). Close when
		// nothing archived remains — an empty viewer is noise.
		if (collectArchivedPmProjects(this.app, this.cfg).length === 0) {
			this.close();
			return;
		}
		this.onOpen();
	}
}
