import { App, Modal, setIcon, TFile, TFolder } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export type PathPickerMode = 'file' | 'folder';

interface PickerEntry {
	/** Full vault path, e.g. "Templates/daily.md". */
	path: string;
	/** Basename without extension, for the primary label. */
	name: string;
}

/** The vault's pickable entries for a mode: markdown files or folders
 *  (root excluded), both sorted by path. */
function collectEntries(app: App, mode: PathPickerMode): PickerEntry[] {
	if (mode === 'file') {
		return app.vault.getMarkdownFiles()
			.map((f: TFile) => ({ path: f.path, name: f.basename }))
			.sort((a, b) => a.path.localeCompare(b.path));
	}
	return app.vault.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && f.path !== '/')
		.map((f: TFolder) => ({ path: f.path, name: f.name }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** Simple substring relevance: basename prefix > basename hit > path hit. */
function scoreOf(entry: PickerEntry, query: string): number {
	if (!query) return 1;
	const q = query.toLowerCase();
	const nameIdx = entry.name.toLowerCase().indexOf(q);
	if (nameIdx === 0) return 3;
	if (nameIdx > 0) return 2;
	return entry.path.toLowerCase().includes(q) ? 1 : 0;
}

/** How many entries render at once — a guard for very large vaults; typing
 *  narrows past the cap instantly. */
const MAX_RENDERED = 200;

/**
 * Vault path picker: a compact modal with a fuzzy search box listing the
 * vault's markdown files or folders. Clicking an entry calls `onPick` with its
 * full path and closes — designed to sit next to settings path inputs as the
 * "browse" affordance (see attachPathPicker).
 */
export class PathPickerModal extends Modal {
	private readonly mode: PathPickerMode;
	private readonly onPick: (path: string) => void;
	private entries: PickerEntry[] = [];

	constructor(app: App, mode: PathPickerMode, onPick: (path: string) => void) {
		super(app);
		this.mode = mode;
		this.onPick = onPick;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		containerEl.setCssProps({
			background: 'transparent',
			backgroundColor: 'transparent',
			border: 'none',
			boxShadow: 'none',
		});

		this.entries = collectEntries(this.app, this.mode);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-pathpicker' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({
			cls: 'dashboard-modal-title',
			text: t(this.mode === 'folder' ? 'pathPicker.pickFolder' : 'pathPicker.pickFile'),
		});

		const body = container.createDiv({ cls: 'dashboard-modal-body dashboard-pathpicker-body' });
		const search = body.createEl('input', {
			cls: 'dashboard-modal-input dashboard-pathpicker-search',
			attr: { type: 'text', placeholder: t('pathPicker.searchPh') },
		});
		const list = body.createDiv({ cls: 'dashboard-pathpicker-list' });
		search.focus();

		const renderList = (): void => {
			list.empty();
			const scored = this.entries
				.map(entry => ({ entry, score: scoreOf(entry, search.value.trim()) }))
				.filter(item => item.score > 0)
				.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
			if (scored.length === 0) {
				list.createDiv({ cls: 'dashboard-library-empty', text: t('pathPicker.empty') });
				return;
			}
			for (const { entry } of scored.slice(0, MAX_RENDERED)) {
				const row = list.createDiv({ cls: 'dashboard-pathpicker-item', attr: { role: 'button', tabindex: '0' } });
				row.createDiv({ cls: 'dashboard-pathpicker-name', text: entry.name });
				const parent = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')));
				if (parent) row.createDiv({ cls: 'dashboard-pathpicker-parent', text: parent });
				const pick = (): void => {
					this.onPick(entry.path);
					this.close();
				};
				row.addEventListener('click', pick);
				row.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
				});
			}
			if (scored.length > MAX_RENDERED) {
				list.createDiv({
					cls: 'dashboard-pathpicker-more',
					text: t('pathPicker.moreCount', { count: String(scored.length - MAX_RENDERED) }),
				});
			}
		};
		search.addEventListener('input', renderList);
		renderList();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * The browse button for a settings path input: a small square icon button that
 * opens the picker and writes the chosen path back into `input` (then fires
 * `onPick` so the caller persists it).
 */
export function attachPathPicker(
	btnParent: HTMLElement,
	input: HTMLInputElement,
	app: App,
	mode: PathPickerMode,
	onPick: (path: string) => void,
): HTMLButtonElement {
	const btn = btnParent.createEl('button', {
		cls: 'dashboard-quicknote-cfg-icon-btn dashboard-pathpicker-btn',
		attr: {
			type: 'button',
			'aria-label': t(mode === 'folder' ? 'pathPicker.pickFolder' : 'pathPicker.pickFile'),
			title: t(mode === 'folder' ? 'pathPicker.pickFolder' : 'pathPicker.pickFile'),
		},
	});
	setIcon(btn, mode === 'folder' ? 'folder-search' : 'file-search');
	btn.addEventListener('click', () => {
		new PathPickerModal(app, mode, (path) => {
			input.value = path;
			onPick(path);
		}).open();
	});
	return btn;
}
