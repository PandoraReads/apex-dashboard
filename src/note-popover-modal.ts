import { App, MarkdownView, Modal, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { t } from './i18n';

const MODE_STORAGE_KEY = 'apex-dashboard-note-popover-mode';
type NoteViewMode = 'source' | 'preview';

/**
 * Centered modal that embeds a real Obsidian MarkdownView editor for a single
 * note, so the user can read and edit it without leaving the dashboard.
 *
 * The editor is a detached WorkspaceLeaf re-parented into the modal content. On
 * close the view is flushed (MarkdownView.save) and the leaf is detached so no
 * state or DOM leaks. Reading/source mode is toggled via setViewState and the
 * last choice is remembered.
 */
export class NotePopoverModal extends Modal {
	private readonly file: TFile;
	private readonly theme: string;
	private leaf: WorkspaceLeaf | null = null;
	private toggleBtn: HTMLElement | null = null;
	private mode: NoteViewMode;

	constructor(app: App, file: TFile, theme = 'earth') {
		super(app);
		this.file = file;
		this.theme = theme;
		this.mode = (this.app.loadLocalStorage(MODE_STORAGE_KEY) as string | null) === 'preview' ? 'preview' : 'source';
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		modalEl.addClass('note-popover-modal-wrap');
		modalEl.dataset.theme = this.theme;
		contentEl.empty();
		contentEl.addClass('note-popover-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'note-popover-header' });

		const titleWrap = header.createDiv({ cls: 'note-popover-title' });
		setIcon(titleWrap.createSpan(), 'file-text');
		titleWrap.createSpan({ text: this.file.basename });

		const actions = header.createDiv({ cls: 'note-popover-actions' });

		this.toggleBtn = actions.createEl('button', { cls: 'note-popover-btn' });
		this.toggleBtn.setAttribute('aria-label', t('notePopover.toggleView'));
		setIcon(this.toggleBtn, this.mode === 'source' ? 'pencil' : 'eye');
		this.toggleBtn.addEventListener('click', () => { void this.toggleMode(); });

		const openTabBtn = actions.createEl('button', { cls: 'note-popover-btn' });
		openTabBtn.setAttribute('aria-label', t('notePopover.openInTab'));
		setIcon(openTabBtn, 'arrow-up-right');
		openTabBtn.addEventListener('click', () => {
			void this.app.workspace.getLeaf(false).openFile(this.file);
			this.close();
		});

		const closeBtn = actions.createEl('button', { cls: 'note-popover-btn' });
		closeBtn.setAttribute('aria-label', t('common.close'));
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		// Editor host
		const host = contentEl.createDiv({ cls: 'note-popover-editor' });

		// WorkspaceLeaf has no publicly-declared constructor in the typings, but
		// the runtime accepts the app instance. The cast keeps tsc happy while we
		// create a leaf that lives outside the workspace tab bar. Its containerEl
		// (the .workspace-leaf node) likewise exists at runtime but is untyped, so
		// narrow it via an intersection type.
		const LeafCtor = WorkspaceLeaf as unknown as new (app: App) => WorkspaceLeaf;
		const leaf = new LeafCtor(this.app) as WorkspaceLeaf & { containerEl: HTMLElement };
		this.leaf = leaf;
		await leaf.openFile(this.file, { state: { mode: this.mode } });
		host.appendChild(leaf.containerEl);
	}

	private async toggleMode(): Promise<void> {
		if (!this.leaf) return;
		this.mode = this.mode === 'source' ? 'preview' : 'source';
		this.app.saveLocalStorage(MODE_STORAGE_KEY, this.mode);
		if (this.toggleBtn) setIcon(this.toggleBtn, this.mode === 'source' ? 'pencil' : 'eye');
		await this.leaf.setViewState({
			type: 'markdown',
			state: { file: this.file.path, mode: this.mode },
		});
	}

	onClose(): void {
		const leaf = this.leaf;
		this.leaf = null;
		this.toggleBtn = null;
		if (leaf) {
			void this.detachLeaf(leaf);
		}
		this.contentEl.empty();
	}

	private async detachLeaf(leaf: WorkspaceLeaf): Promise<void> {
		try {
			if (leaf.view instanceof MarkdownView) {
				await leaf.view.save();
			}
		} catch {
			// Best-effort flush; detach regardless so nothing leaks.
		}
		leaf.detach();
	}
}
