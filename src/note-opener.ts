import { App, TFile } from 'obsidian';
import { NotePopoverModal } from './note-popover-modal';

/**
 * Opens notes honoring the workspace's "disable popover" setting — the same
 * rule the dashboard board applies on card clicks (view.ts openNote), packed
 * for standalone surfaces (the material library view, lightbox jumps) so they
 * don't need to import the dashboard view.
 *
 * One popover at a time: opening a note closes the previous popover so the
 * embedded leaves never stack. Non-markdown files always take the tab path —
 * the popover hosts a MarkdownView and renders anything else broken.
 */
export class NoteOpener {
	private popover: NotePopoverModal | null = null;

	constructor(
		private readonly app: App,
		/** Read live like the config getters: a settings flip applies to the
		 *  next open, not the next view reload. */
		private readonly disablePopover: () => boolean,
	) {}

	open(file: TFile): void {
		if (this.disablePopover() || file.extension !== 'md') {
			void this.app.workspace.openLinkText(file.path, '');
			return;
		}
		this.popover?.close();
		const modal = new NotePopoverModal(this.app, file);
		this.popover = modal;
		modal.open();
	}

	/** View teardown: close any popover still holding an embedded leaf. */
	close(): void {
		this.popover?.close();
		this.popover = null;
	}
}
