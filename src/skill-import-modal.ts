/**
 * Skill import modal. Three sources feed one install flow:
 *
 *  - picked folder (hidden webkitdirectory input — the FileList carries
 *    every file with its relative path, no fs permission needed to read)
 *  - typed local path, validated through the desktop seam
 *  - GitHub URL (repo or /tree/<branch>/<subfolder>): two API calls list
 *    every skill folder in the repo; picked skills download raw-file-by-
 *    raw-file through Obsidian's requestUrl (see skill-github)
 *
 * Destination is a checkbox per skill store (three home dirs + custom
 * skillSourceFolders); an existing same-name folder is replaced — the old
 * copy moves to the OS trash first, never an in-place merge. The last
 * checkbox set persists onto the section config so the next import starts
 * where the previous one ended.
 */

import { App, Modal, Notice } from 'obsidian';
import type { AgentTarget } from './types';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { expandHomePath } from './skill-registry';
import {
	desktopSkillFs, importSkillDir, importSkillFiles, inspectSkillDir, parseSkillDoc,
	resolveSkillStores, skillStoreAgent, skillStoreLabel,
	type SkillFs, type SkillImportSource, type SkillImportTarget, type SkillStoreDef,
} from './skill-store';
import {
	fetchGithubSkillDirs, importGithubSkills, parseGithubUrl,
	type GithubRepoRef, type GithubRequest, type GithubSkillCandidate,
} from './skill-github';

export interface SkillImportParams {
	/** Custom skill folders CSV from settings (extra install targets). */
	foldersCsv: string;
	/** Store ids checked last time (section config memory). */
	defaultTargets: string[];
	/** Persist the checked set for the next import. */
	onSaveTargets: (ids: string[]) => void;
	/** Import finished — the host rescans and remembers the name per agent. */
	onImported: (name: string, agents: AgentTarget[]) => void;
	/** Test seam; production resolves the desktop fs. */
	fs?: SkillFs;
	/** Test seam for the GitHub listing/downloader. */
	githubRequest?: GithubRequest;
}

type ImportSource =
	| { kind: 'dir'; dir: string }
	| { kind: 'files'; rootName: string; files: File[] }
	| { kind: 'github'; ref: GithubRepoRef; paths: string[]; picked: GithubSkillCandidate[] };

export class SkillImportModal extends Modal {
	private readonly fs: SkillFs | undefined;
	private readonly stores: SkillStoreDef[];
	private source: ImportSource | null = null;
	private preview: SkillImportSource | null = null;
	private checked: Set<string>;
	private statusEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private githubEl: HTMLElement | null = null;
	private readonly conflictEls = new Map<string, HTMLElement>();
	private confirmBtn: HTMLButtonElement | null = null;
	private githubBusy = false;
	/** All candidates from the last GitHub fetch (checkbox state source). */
	private githubCandidates: GithubSkillCandidate[] = [];
	private githubChecked = new Set<string>();
	private readonly githubRequest?: GithubRequest;

	constructor(app: App, private readonly params: SkillImportParams) {
		super(app);
		this.fs = params.fs ?? desktopSkillFs();
		this.githubRequest = params.githubRequest;
		this.stores = this.fs ? resolveSkillStores(params.foldersCsv, this.fs.homeDir()) : [];
		const remembered = params.defaultTargets.filter(id => this.stores.some(s => s.id === id));
		this.checked = new Set(remembered.length > 0 ? remembered : ['claude']);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-skillsec-import-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-skillsec-import' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('skills.importTitle') });

		this.renderBody(container.createDiv({ cls: 'dashboard-modal-body' }));

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		this.confirmBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('skills.import'),
			attr: { type: 'button' },
		});
		this.confirmBtn.addEventListener('click', () => void this.runImport());
		this.syncConfirm();
	}

	/** Body is rendered once — validation, preview, GitHub list and conflict
	 *  notes update in place so inputs never lose state. */
	private renderBody(body: HTMLElement): void {
		body.empty();
		this.conflictEls.clear();
		this.statusEl = null;
		this.previewEl = null;
		this.githubEl = null;

		if (!this.fs) {
			body.createDiv({ cls: 'dashboard-library-config-hint', text: t('skills.desktopOnly') });
			if (this.confirmBtn) this.confirmBtn.disabled = true;
			return;
		}

		// ── Source ────────────────────────────────────────────────────────
		const sourceSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		sourceSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.importSource') });

		const pickRow = sourceSection.createDiv({ cls: 'dashboard-skillsec-import-pick' });
		const pickBtn = pickRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('skills.importPickFolder'),
			attr: { type: 'button' },
		});
		const fileInput = pickRow.createEl('input', {
			cls: 'dashboard-skillsec-import-file',
			attr: { type: 'file', webkitdirectory: '' },
		});
		pickBtn.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', () => void this.pickFolder(fileInput));

		const pathRow = sourceSection.createDiv({ cls: 'dashboard-skillsec-import-path-row' });
		const pathInput = pathRow.createEl('input', {
			cls: 'dashboard-skillsec-import-path',
			attr: { type: 'text', placeholder: t('skills.importPathPh'), 'aria-label': t('skills.importPathLabel') },
		});
		pathInput.addEventListener('change', () => void this.pickPath(pathInput.value));
		const goBtn = pathRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-skillsec-import-go',
			text: t('skills.importValidate'),
			attr: { type: 'button' },
		});
		goBtn.addEventListener('click', () => void this.pickPath(pathInput.value));

		// GitHub: URL + fetch → multi-select candidate list.
		const ghRow = sourceSection.createDiv({ cls: 'dashboard-skillsec-import-path-row' });
		const ghInput = ghRow.createEl('input', {
			cls: 'dashboard-skillsec-import-path',
			attr: { type: 'text', placeholder: t('skills.importGithubPh'), 'aria-label': t('skills.importGithubLabel') },
		});
		const ghBtn = ghRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-skillsec-import-go',
			text: t('skills.importGithubFetch'),
			attr: { type: 'button' },
		});
		ghBtn.addEventListener('click', () => void this.fetchGithub(ghInput.value));
		ghInput.addEventListener('change', () => void this.fetchGithub(ghInput.value));

		this.statusEl = sourceSection.createDiv({ cls: 'dashboard-dataview-validation dashboard-skillsec-import-status' });
		this.githubEl = sourceSection.createDiv({ cls: 'dashboard-skillsec-import-github is-hidden' });
		this.previewEl = sourceSection.createDiv({ cls: 'dashboard-skillsec-import-preview is-hidden' });

		// ── Destinations ─────────────────────────────────────────────────
		const targetSection = body.createDiv({ cls: 'dashboard-library-config-section' });
		targetSection.createDiv({ cls: 'dashboard-library-config-section-title', text: t('skills.importTargets') });
		for (const store of this.stores) {
			this.renderTargetRow(targetSection, store);
		}
	}

	private setStatus(message: string, kind: 'ok' | 'error'): void {
		if (!this.statusEl) return;
		this.statusEl.removeClass('is-ok', 'is-error');
		this.statusEl.addClass(`is-${kind}`);
		this.statusEl.setText(message);
	}

	private renderPreview(): void {
		if (!this.previewEl) return;
		this.previewEl.empty();
		if (!this.preview) {
			this.previewEl.addClass('is-hidden');
			return;
		}
		this.previewEl.removeClass('is-hidden');
		this.previewEl.createDiv({ cls: 'dashboard-skillsec-import-preview-name', text: this.preview.name });
		if (this.preview.description) {
			this.previewEl.createDiv({ cls: 'dashboard-skillsec-import-preview-desc', text: this.preview.description });
		}
		this.previewEl.createDiv({ cls: 'dashboard-skillsec-import-preview-count', text: t('skills.importFileCount', { n: String(this.preview.fileCount) }) });
	}

	/** GitHub candidate checklist (multi-select — repos usually carry many). */
	private renderGithubList(): void {
		if (!this.githubEl) return;
		this.githubEl.empty();
		if (this.source?.kind !== 'github') {
			this.githubEl.addClass('is-hidden');
			return;
		}
		this.githubEl.removeClass('is-hidden');
		this.githubEl.createDiv({
			cls: 'dashboard-skillsec-import-github-hint',
			text: t('skills.importGithubHint', { n: String(this.githubChecked.size) }),
		});
		const list = this.githubEl.createDiv({ cls: 'dashboard-skillsec-import-github-list' });
		for (const candidate of this.githubCandidates) {
			const row = list.createDiv({ cls: 'dashboard-skillsec-import-github-row' });
			const label = row.createEl('label', { cls: 'dashboard-skillsec-import-github-label' });
			const cb = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			cb.checked = this.githubChecked.has(candidate.path);
			cb.addEventListener('change', () => {
				this.githubChecked = new Set(cb.checked
					? [...this.githubChecked, candidate.path]
					: [...this.githubChecked].filter(p => p !== candidate.path));
				this.syncGithubSource();
			});
			label.createSpan({ cls: 'dashboard-skillsec-import-github-name', text: candidate.name });
			label.createSpan({ cls: 'dashboard-skillsec-import-github-path', text: candidate.path, attr: { title: candidate.path } });
		}
	}

	/** Fold checkbox state back into the github source + preview + confirm. */
	private syncGithubSource(): void {
		if (this.source?.kind !== 'github') return;
		const picked = this.githubCandidates.filter(c => this.githubChecked.has(c.path));
		this.source = { ...this.source, picked };
		this.preview = picked.length > 0
			? { name: picked.length === 1 ? picked[0]!.name : t('skills.importGithubMulti', { n: String(picked.length) }), description: `${this.source.ref.owner}/${this.source.ref.repo}`, fileCount: 0 }
			: null;
		this.renderPreview();
		this.syncConfirm();
	}

	private renderTargetRow(parent: HTMLElement, store: SkillStoreDef): void {
		const row = parent.createDiv({ cls: 'dashboard-skillsec-import-target' });
		const label = row.createEl('label', { cls: 'dashboard-skillsec-import-target-label' });
		const cb = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
		cb.checked = this.checked.has(store.id);
		cb.addEventListener('change', () => {
			this.checked = new Set(cb.checked ? [...this.checked, store.id] : [...this.checked].filter(id => id !== store.id));
			this.syncConflictNote(store.id);
			this.syncConfirm();
		});
		label.createSpan({ cls: 'dashboard-skillsec-import-target-name', text: skillStoreLabel(store.id) });
		label.createSpan({ cls: 'dashboard-skillsec-import-target-dir', text: store.dir, attr: { title: store.dir } });
		const note = row.createSpan({ cls: 'dashboard-skillsec-import-conflict is-hidden' });
		this.conflictEls.set(store.id, note);
		if (this.preview) this.syncConflictNote(store.id);
	}

	/** Conflict note per target: "exists — will be replaced" when the
	 *  destination already holds a folder of the same name. */
	private syncConflictNote(storeId: string): void {
		const note = this.conflictEls.get(storeId);
		if (!note || !this.fs || !this.preview) {
			note?.classList.add('is-hidden');
			return;
		}
		const store = this.stores.find(s => s.id === storeId);
		if (!store) return;
		const dest = `${store.dir.replace(/\/+$/, '')}/${this.preview.name}`;
		void this.fs.exists(dest).then(exists => {
			if (exists && this.checked.has(storeId)) {
				note.setText(t('skills.importExists'));
				note.classList.remove('is-hidden');
			} else {
				note.classList.add('is-hidden');
			}
		});
	}

	private syncConfirm(): void {
		if (!this.confirmBtn) return;
		this.confirmBtn.disabled = !this.preview || this.checked.size === 0;
	}

	/** webkitdirectory pick: the FileList carries relative paths rooted at
	 *  the chosen folder — SKILL.md validation happens on its bytes. */
	private async pickFolder(input: HTMLInputElement): Promise<void> {
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0 || !this.fs) return;
		const rootName = (files[0]!.webkitRelativePath || files[0]!.name).split('/')[0]!;
		const doc = files.find(file => (file.webkitRelativePath || file.name) === `${rootName}/SKILL.md`);
		if (!doc) {
			this.failValidation(t('skills.importInvalid'));
			return;
		}
		const meta = parseSkillDoc(await doc.text(), rootName);
		this.source = { kind: 'files', rootName, files };
		this.preview = { name: rootName, description: meta.description, fileCount: files.length };
		this.githubCandidates = [];
		this.setStatus(t('skills.importReady', { name: rootName }), 'ok');
		this.afterSourceChange();
	}

	private async pickPath(rawPath: string): Promise<void> {
		if (!this.fs) return;
		const dir = expandHomePath(rawPath, this.fs.homeDir());
		if (!dir.trim()) return;
		const preview = await inspectSkillDir(this.fs, dir);
		if (!preview) {
			this.failValidation(t('skills.importInvalid'));
			return;
		}
		this.source = { kind: 'dir', dir };
		this.preview = preview;
		this.githubCandidates = [];
		this.setStatus(t('skills.importReady', { name: preview.name }), 'ok');
		this.afterSourceChange();
	}

	/** GitHub fetch: parse URL → default branch + recursive tree → skill
	 *  folder list. Errors surface in the status line (403/429 = rate limit). */
	private async fetchGithub(rawUrl: string): Promise<void> {
		if (!this.fs || this.githubBusy || !this.githubEl) return;
		const ref = parseGithubUrl(rawUrl);
		if (!ref) {
			this.failValidation(t('skills.importGithubBadUrl'));
			return;
		}
		this.githubBusy = true;
		this.setStatus(t('skills.importGithubFetching'), 'ok');
		try {
			const result = await fetchGithubSkillDirs(ref, this.githubRequest);
			this.githubCandidates = result.skills;
			this.githubChecked = new Set();
			this.source = { kind: 'github', ref: result.ref, paths: result.paths, picked: [] };
			this.preview = null;
			if (result.skills.length === 0) {
				this.setStatus(t('skills.importGithubEmpty'), 'error');
			} else {
				this.setStatus(t('skills.importGithubFound', { n: String(result.skills.length) }), 'ok');
			}
			this.afterSourceChange();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.failValidation(t('skills.importGithubFailed', { message }));
		} finally {
			this.githubBusy = false;
		}
	}

	private failValidation(message: string): void {
		this.source = null;
		this.preview = null;
		this.githubCandidates = [];
		this.setStatus(message, 'error');
		this.afterSourceChange();
	}

	/** After the source changes: refresh preview, GitHub list, all conflict
	 *  notes, and the confirm button — without touching inputs. */
	private afterSourceChange(): void {
		this.renderGithubList();
		this.renderPreview();
		for (const storeId of this.conflictEls.keys()) this.syncConflictNote(storeId);
		this.syncConfirm();
	}

	private async runImport(): Promise<void> {
		if (!this.fs || !this.source || !this.preview) return;
		const targets: SkillImportTarget[] = this.stores
			.filter(store => this.checked.has(store.id))
			.map(store => ({ storeId: store.id, dir: store.dir }));
		if (targets.length === 0) {
			new Notice(t('skills.importNoTarget'));
			return;
		}
		if (this.confirmBtn) this.confirmBtn.disabled = true;

		if (this.source.kind === 'github') {
			await this.runGithubImport(this.source, targets);
			return;
		}
		const outcomes = this.source.kind === 'dir'
			? await importSkillDir(this.fs, this.source.dir, targets)
			: await importSkillFiles(this.fs, this.source.rootName, this.source.files, targets);
		const okOutcomes = outcomes.filter(o => o.ok);
		const agents = [...new Set(okOutcomes.map(o => skillStoreAgent(o.storeId)).filter((a): a is AgentTarget => !!a))];
		if (okOutcomes.length === 0) {
			const first = outcomes.find(o => !o.ok);
			new Notice(t('skills.importFailed', { message: first?.error ?? '' }));
			if (this.confirmBtn) this.confirmBtn.disabled = false;
			return;
		}
		if (okOutcomes.length < outcomes.length) {
			new Notice(t('skills.importPartial', { n: String(okOutcomes.length), total: String(outcomes.length) }));
		} else {
			new Notice(t('skills.importDone', { name: this.preview.name, n: String(okOutcomes.length) }));
		}
		this.params.onSaveTargets([...this.checked]);
		this.params.onImported(this.preview.name, agents);
		this.close();
	}

	/** Multi-skill GitHub install: per skill per target outcomes; importers
	 *  report per installed skill so the pickers learn every name. */
	private async runGithubImport(source: Extract<ImportSource, { kind: 'github' }>, targets: readonly SkillImportTarget[]): Promise<void> {
		if (source.picked.length === 0) {
			new Notice(t('skills.importGithubPickFirst'));
			if (this.confirmBtn) this.confirmBtn.disabled = false;
			return;
		}
		try {
			const results = await importGithubSkills(this.fs!, source.ref, source.paths, source.picked, targets, this.githubRequest);
			let installed = 0;
			let failed = 0;
			for (const result of results) {
				const okOutcomes = result.outcomes.filter(o => o.ok);
				const agents = [...new Set(okOutcomes.map(o => skillStoreAgent(o.storeId)).filter((a): a is AgentTarget => !!a))];
				if (okOutcomes.length > 0) {
					installed += 1;
					this.params.onImported(result.name, agents);
				} else {
					failed += 1;
				}
			}
			this.params.onSaveTargets([...this.checked]);
			if (installed > 0 && failed > 0) new Notice(t('skills.importGithubPartial', { n: String(installed), failed: String(failed) }));
			else if (installed > 0) new Notice(t('skills.importGithubDone', { n: String(installed) }));
			else new Notice(t('skills.importFailed', { message: 'all downloads failed' }));
			if (installed > 0) this.close();
			else if (this.confirmBtn) this.confirmBtn.disabled = false;
		} catch (err) {
			new Notice(t('skills.importFailed', { message: err instanceof Error ? err.message : String(err) }));
			if (this.confirmBtn) this.confirmBtn.disabled = false;
		}
	}
}
