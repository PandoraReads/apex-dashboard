import type { App, HoverParent, TFile } from 'obsidian';

/**
 * Attach Obsidian's native Page Preview hover popover to an arbitrary element.
 *
 * Triggers the `hover-link` workspace event, which the Page Preview core plugin
 * listens for and renders as a read-only popover — the same popover shown when
 * hovering an internal link inside a note. The dashboard's owning view must
 * implement HoverParent so Obsidian can track the popover lifecycle.
 *
 * subpath is the raw `#heading` / `#^block` fragment of a wikilink; when given,
 * the preview scrolls to that anchor instead of the note top.
 *
 * Desktop only: mobile has no hover, so callers keep the original open-in-tab
 * behaviour there.
 */
export function attachNoteHover(
	app: App,
	el: HTMLElement,
	file: TFile,
	hoverParent: HoverParent,
	subpath?: string,
): void {
	el.addEventListener('mouseover', (event: MouseEvent) => {
		app.workspace.trigger('hover-link', {
			event,
			source: 'apex-dashboard',
			hoverParent,
			targetEl: el,
			linktext: subpath ? `${file.basename}${subpath}` : file.basename,
			sourcePath: '',
		});
	});
}
