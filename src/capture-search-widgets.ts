import { App, setIcon, TFile } from 'obsidian';
import type { DashboardSettings } from './types';
import { t } from './i18n';
import { captureThought } from './quick-note-section';
import { searchVaultFiles } from './vault-search';
import { iconForExtension } from './file-types';
import { getRecentDocs } from './recent';
import { applyModalTheme } from './modal-theme';

/**
 * The two quick-input sidebar widgets (Rae), styled after his reference
 * search bar (截屏 2026-10-09): ONE bright rounded bar — elevated surface,
 * light border — holding a leading glyph, a borderless field, and a single
 * round confirm key (the skills-orb texture). The widget card's own chrome
 * is stripped (see the CSS) so the bar is the only frame.
 *
 * Leading glyphs: the file-search bar carries a ➕ that opens the recently
 * browsed files in the shared floating popover (pick = open); the capture
 * bar carries a pencil marking its job.
 *
 * The file-search results open as a BODY-LEVEL floating popover anchored
 * under the bar (the music-popover pattern): rails and stacked cells are
 * scroll containers that would clip an in-card list.
 */

/** One row of the floating results popover. */
interface PopRow {
	icon: string;
	name: string;
	path: string;
	/** Right-aligned muted extra (e.g. "2 小时前"). */
	meta?: string;
}

/** Shared bar: leading glyph + borderless field + round confirm key. */
function renderBar(
	widget: HTMLElement,
	opts: {
		glyphIcon: string;
		glyphLabel?: string;
		/** Absent = decorative glyph (no button semantics, no handler). */
		onGlyph?: () => void;
		placeholder: string;
		ariaLabel: string;
		keyIcon: string;
		keyLabel: string;
		onSubmit: (input: HTMLInputElement) => void;
	},
): HTMLInputElement {
	const bar = widget.createDiv({ cls: 'dashboard-capturebar' });
	if (opts.onGlyph) {
		const glyph = bar.createEl('button', {
			cls: 'dashboard-capturebar-glyph',
			attr: { type: 'button', 'aria-label': opts.glyphLabel ?? '', title: opts.glyphLabel ?? '' },
		});
		setIcon(glyph, opts.glyphIcon);
		glyph.addEventListener('click', () => opts.onGlyph?.());
	} else {
		const glyph = bar.createSpan({
			cls: 'dashboard-capturebar-glyph dashboard-capturebar-glyph--static',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(glyph, opts.glyphIcon);
	}
	const input = bar.createEl('input', {
		cls: 'dashboard-capturebar-input',
		attr: {
			type: 'text',
			spellcheck: 'false',
			placeholder: opts.placeholder,
			'aria-label': opts.ariaLabel,
		},
	});
	const key = bar.createEl('button', {
		cls: 'dashboard-skills-orb dashboard-capturebar-key',
		attr: { type: 'button', 'aria-label': opts.keyLabel },
	});
	setIcon(key, opts.keyIcon);
	key.addEventListener('click', () => opts.onSubmit(input));
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			opts.onSubmit(input);
		}
	});
	return input;
}

/**
 * Body-level list popover (search results / recent files): fixed under the
 * anchor (height-capped, flipped above only when below is hopeless),
 * repositioned while the underlying rail scrolls, closed by a pick, Escape,
 * or any outside press.
 */
function openListPop(
	anchor: HTMLElement,
	rows: readonly PopRow[],
	emptyMessage: string,
	onPick: (row: PopRow) => void,
): void {
	const doc = anchor.ownerDocument;
	const pop = doc.body.createDiv({ cls: 'dashboard-filesearch-pop is-open' });
	applyModalTheme(pop);
	if (rows.length === 0) {
		pop.createDiv({ cls: 'dashboard-docsearch-hint', text: emptyMessage });
	} else {
		for (const row of rows) {
			const item = pop.createDiv({ cls: 'dashboard-docsearch-item' });
			setIcon(item.createSpan({ cls: 'dashboard-docsearch-icon' }), row.icon);
			const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
			info.createDiv({ cls: 'dashboard-docsearch-name', text: row.name });
			info.createDiv({ cls: 'dashboard-docsearch-path', text: row.path });
			if (row.meta) item.createSpan({ cls: 'dashboard-filesearch-meta', text: row.meta });
			// mousedown-preventDefault keeps focus quiet; the click picks.
			item.addEventListener('mousedown', (e) => e.preventDefault());
			item.addEventListener('click', () => {
				onPick(row);
				close();
			});
		}
	}

	/** Track the anchor: a re-render can detach it mid-life — then the pop
	 *  parks at its last rect and self-closes on the next outside press. */
	const rectOf = (): DOMRect | null => anchor.isConnected ? anchor.getBoundingClientRect() : null;
	const place = (): void => {
		const rect = rectOf();
		if (!rect) return;
		const vw = doc.defaultView?.innerWidth ?? 0;
		const vh = doc.defaultView?.innerHeight ?? 0;
		const w = pop.offsetWidth;
		const left = Math.min(rect.left, Math.max(8, vw - w - 8));
		pop.style.left = `${Math.max(8, left)}px`;
		if (vh <= 0) {
			pop.style.top = `${rect.bottom + 6}px`;
			return;
		}
		// Results belong UNDER the box (Rae): below wins whenever there is
		// usable room, with the list capped to that room instead of flipping;
		// flip above only when below is hopeless (anchor in the last sliver
		// of the viewport).
		const roomBelow = vh - rect.bottom - 14;
		const roomAbove = rect.top - 14;
		if (roomBelow >= 140 || roomBelow >= roomAbove) {
			pop.style.top = `${rect.bottom + 6}px`;
			pop.style.maxHeight = `${Math.max(120, Math.min(280, roomBelow))}px`;
		} else {
			pop.style.top = `${Math.max(8, rect.top - Math.min(280, Math.max(120, roomAbove)) - 6)}px`;
			pop.style.maxHeight = `${Math.max(120, Math.min(280, roomAbove))}px`;
		}
	};
	// Two placement passes: measure at natural width, then clamp against it.
	place();
	place();

	const onScrollResize = (): void => place();
	doc.addEventListener('scroll', onScrollResize, true);
	doc.defaultView?.addEventListener('resize', onScrollResize);
	const onDocPointerDown = (e: Event): void => {
		const target = e.target as Node | null;
		if (pop.contains(target) || anchor.contains(target)) return;
		close();
	};
	doc.addEventListener('pointerdown', onDocPointerDown, true);
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && !e.isComposing) {
			e.preventDefault();
			close();
		}
	};
	doc.addEventListener('keydown', onKey);

	function close(): void {
		doc.removeEventListener('scroll', onScrollResize, true);
		doc.defaultView?.removeEventListener('resize', onScrollResize);
		doc.removeEventListener('pointerdown', onDocPointerDown, true);
		doc.removeEventListener('keydown', onKey);
		pop.remove();
	}
}

/** Quick-capture widget: type a thought, hit the key (or Enter) — same
 *  capture pipeline (target note / fleeting note) as the quick-note bar. */
export function renderSidebarQuickCaptureWidget(container: HTMLElement, app: App, settings: DashboardSettings): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-capturebar' });
	let busy = false;
	renderBar(widget, {
		glyphIcon: 'pencil',
		placeholder: t('quickNote.capturePlaceholder'),
		ariaLabel: t('captureWidget.title'),
		keyIcon: 'send',
		keyLabel: t('captureWidget.submit'),
		onSubmit: (input) => {
			const text = input.value.trim();
			if (!text || busy) return;
			busy = true;
			void captureThought(app, settings, text).finally(() => {
				busy = false;
				if (input.isConnected) input.value = '';
			});
		},
	});
}

/** Resolve a recent-doc path to a TFile and open it (silently skips a file
 *  that vanished between listing and pick). */
function openByPath(app: App, path: string): void {
	const file = app.vault.getFileByPath(path);
	if (file) void app.workspace.getLeaf('tab').openFile(file);
}

/** File-search widget: type a query, hit the key (or Enter) — matches open
 *  in a floating popover below; the ➕ opens the recently browsed files. */
export function renderSidebarFileSearchWidget(container: HTMLElement, app: App): void {
	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-capturebar dashboard-sidebar-filesearch' });
	const recentRows = (): PopRow[] =>
		getRecentDocs(app, 10).map(doc => ({
			icon: 'file-text',
			name: doc.name,
			path: doc.path,
			meta: doc.relativeTime,
		}));
	renderBar(widget, {
		glyphIcon: 'plus',
		glyphLabel: t('fileSearchWidget.recent'),
		onGlyph: () => {
			openListPop(widget.querySelector<HTMLElement>('.dashboard-capturebar') ?? widget, recentRows(), t('recent.empty'), (row) => {
				openByPath(app, row.path);
			});
		},
		placeholder: t('quickNote.searchPlaceholder'),
		ariaLabel: t('fileSearchWidget.title'),
		keyIcon: 'search',
		keyLabel: t('fileSearchWidget.title'),
		onSubmit: (input) => {
			const q = input.value.trim();
			if (!q) return;
			const rows = searchVaultFiles(app, q, 8).map((file): PopRow => ({
				icon: iconForExtension(file.extension),
				name: file.basename,
				path: file.path,
			}));
			openListPop(input, rows, t('quickActions.noResults'), (row) => {
				openByPath(app, row.path);
			});
		},
	});
}
