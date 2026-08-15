import { App, Notice, TFile, setIcon } from 'obsidian';
import { resolveVaultImage } from './banner';
import { t } from './i18n';
import { renameMediaFile } from './media-utils';

/** Shape shared by the grid/list/table media views. */
export interface MediaFileResult {
	file: TFile;
	basename: string;
	path: string;
	mtime: number;
	ctime: number;
	ext: string;
	size: number;
	/** User-defined tags for this file (empty array when untagged). */
	tags: string[];
}

export type MediaKind = 'image' | 'video';
export type ThumbSize = 'small' | 'medium' | 'large';

/** Lazy mounter handle for desktop video thumbnails (see media-section). */
export interface LazyVideoMounter {
	observe(tile: HTMLElement, src: string): void;
	disconnect(): void;
}

/** Notes that link to or embed the given media file (backlinks via resolvedLinks). */
export function getMediaBacklinks(app: App, file: TFile): TFile[] {
	const target = file.path;
	const out: TFile[] = [];
	const resolved = app.metadataCache.resolvedLinks;
	for (const [srcPath, targets] of Object.entries(resolved)) {
		if (targets[target]) {
			const src = app.vault.getFileByPath(srcPath);
			if (src) out.push(src);
		}
	}
	out.sort((a, b) => a.basename.localeCompare(b.basename));
	return out;
}

/** Render backlinks as clickable chips that open the note in a popover. */
export function appendBacklinks(container: HTMLElement, files: TFile[], onOpenNote?: (file: TFile) => void): void {
	if (files.length === 0) {
		container.createDiv({ cls: 'dashboard-media-no-links', text: '—' });
		return;
	}
	const wrap = container.createDiv({ cls: 'dashboard-media-backlinks' });
	for (const f of files.slice(0, 5)) {
		const chip = wrap.createDiv({ cls: 'dashboard-media-backlink', text: f.basename });
		chip.title = f.path;
		chip.setAttribute('role', 'button');
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			onOpenNote?.(f);
		});
	}
	if (files.length > 5) {
		wrap.createDiv({ cls: 'dashboard-media-backlink dashboard-media-backlink--more', text: `+${files.length - 5}` });
	}
}

/** Static placeholder shown for video tiles until (desktop) a real `<video>` is
 *  lazily mounted, or always (mobile, where no `<video>` is ever created). */
export function renderVideoThumbPlaceholder(parent: HTMLElement, result: MediaFileResult, showSize: boolean): void {
	const ph = parent.createDiv({ cls: 'dashboard-media-thumb dashboard-media-thumb--video-placeholder' });
	setIcon(ph.createDiv({ cls: 'dashboard-media-thumb-icon' }), 'film');
	if (showSize) {
		const size = formatFileSize(result.size);
		if (size) ph.createDiv({ cls: 'dashboard-media-size-badge', text: size });
	}
}

/** Human-readable file size for the static video placeholder badge. */
export function formatFileSize(bytes: number): string {
	if (!bytes || bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let val = bytes / 1024;
	let i = 0;
	while (val >= 1024 && i < units.length - 1) {
		val /= 1024;
		i++;
	}
	return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function renderMediaGrid(
	container: HTMLElement,
	results: MediaFileResult[],
	app: App,
	kind: MediaKind,
	thumbSize: ThumbSize,
	onOpen: (index: number) => void,
	onDelete: (file: TFile) => void,
	mounter: LazyVideoMounter | null,
	onEditTags?: (result: MediaFileResult) => void,
): void {
	const grid = container.createDiv({ cls: `dashboard-media-grid dashboard-media-grid--${thumbSize}` });

	for (let i = 0; i < results.length; i++) {
		const result = results[i]!;
		const src = resolveVaultImage(app, result.path);
		const item = grid.createDiv({ cls: 'dashboard-media-item' });

		if (src) {
			if (kind === 'image') {
				item.createEl('img', {
					cls: 'dashboard-media-thumb',
					attr: { src, alt: result.basename, loading: 'lazy' },
				});
			} else {
				// Static placeholder first; on desktop a real <video> is lazily
				// mounted only when this tile scrolls into view (mounter.observe),
				// on mobile no <video> is ever created on the board.
				renderVideoThumbPlaceholder(item, result, true);
				if (mounter) mounter.observe(item, src);
				const play = item.createDiv({ cls: 'dashboard-media-play' });
				setIcon(play, 'play');
			}
		} else {
			item.createDiv({ cls: 'dashboard-media-thumb dashboard-media-thumb--broken' });
		}

		const name = item.createDiv({ cls: 'dashboard-media-name', text: result.basename });
		name.title = `${result.path}\n${formatDate(result.mtime)}`;

		if (result.tags.length > 0) {
			const tagRow = item.createDiv({ cls: 'dashboard-media-tile-tags' });
			for (const tag of result.tags.slice(0, 2)) {
				tagRow.createSpan({ cls: 'dashboard-media-tile-tag', text: tag });
			}
			if (result.tags.length > 2) {
				tagRow.createSpan({ cls: 'dashboard-media-tile-tag dashboard-media-tile-tag--more', text: `+${result.tags.length - 2}` });
			}
		}

		if (onEditTags) {
			const tagBtn = item.createEl('button', {
				cls: 'dashboard-media-delete dashboard-media-tagbtn',
				attr: { 'aria-label': t('media.editTags') },
			});
			setIcon(tagBtn, 'tags');
			tagBtn.addEventListener('click', (e) => { e.stopPropagation(); onEditTags(result); });
		}

		const delBtn = item.createEl('button', {
			cls: 'dashboard-qa-remove dashboard-media-delete',
			attr: { 'aria-label': t('media.delete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(result.file); });

		item.addEventListener('click', () => onOpen(i));
		item.setAttribute('role', 'button');
	}
}

export function renderMediaList(
	container: HTMLElement,
	results: MediaFileResult[],
	app: App,
	kind: MediaKind,
	onOpen: (index: number) => void,
	onDelete: (file: TFile) => void,
	refresh?: () => void,
	onOpenNote?: (file: TFile) => void,
	mounter: LazyVideoMounter | null = null,
	onEditTags?: (result: MediaFileResult) => void,
): void {
	const list = container.createDiv({ cls: 'dashboard-media-list' });
	for (let i = 0; i < results.length; i++) {
		const result = results[i]!;
		const row = list.createDiv({ cls: 'dashboard-media-list-row' });

		// Small thumbnail — the only click target that opens the lightbox,
		// so the data area stays free for inline editing.
		const src = resolveVaultImage(app, result.path);
		const thumb = row.createDiv({ cls: 'dashboard-media-list-thumb' });
		thumb.setAttribute('role', 'button');
		if (src) {
			if (kind === 'image') {
				thumb.createEl('img', { attr: { src, alt: result.basename, loading: 'lazy' } });
			} else {
				renderVideoThumbPlaceholder(thumb, result, false);
				if (mounter) mounter.observe(thumb, src);
			}
		}
		thumb.addEventListener('click', () => onOpen(i));

		const info = row.createDiv({ cls: 'dashboard-media-list-info' });
		// Double-click the name to rename (backlinks update automatically) —
		// same interaction as the table view's name cell.
		const nameDiv = info.createDiv({ cls: 'dashboard-media-list-name', text: result.basename });
		nameElClick(nameDiv, result, app, refresh ?? (() => { /* no-op when not provided */ }));
		info.createDiv({ cls: 'dashboard-media-list-meta', text: `${result.path} · ${formatDate(result.mtime)}` });
		if (result.tags.length > 0) {
			const tagRow = info.createDiv({ cls: 'dashboard-media-list-tags' });
			for (const tag of result.tags.slice(0, 3)) {
				tagRow.createSpan({ cls: 'dashboard-media-tile-tag', text: tag });
			}
			if (result.tags.length > 3) {
				tagRow.createSpan({ cls: 'dashboard-media-tile-tag dashboard-media-tile-tag--more', text: `+${result.tags.length - 3}` });
			}
		}
		appendBacklinks(info, getMediaBacklinks(app, result.file), onOpenNote);

		if (onEditTags) {
			const tagBtn = row.createEl('button', {
				cls: 'dashboard-media-icon-btn dashboard-media-tagbtn dashboard-media-tagbtn--list',
				attr: { 'aria-label': t('media.editTags') },
			});
			setIcon(tagBtn, 'tags');
			tagBtn.addEventListener('click', (e) => { e.stopPropagation(); onEditTags(result); });
		}

		const delBtn = row.createEl('button', {
			cls: 'dashboard-media-icon-btn dashboard-media-delete--list',
			attr: { 'aria-label': t('media.delete') },
		});
		setIcon(delBtn, 'trash-2');
		delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(result.file); });
	}
}

/** Double-click the element to rename the file (backlinks update
 *  automatically via fileManager.renameFile). Used by the list view's
 *  name line. */
export function nameElClick(td: HTMLElement, result: MediaFileResult, app: App, refresh: () => void): void {
	td.addClass('dashboard-media-table-name-cell');
	td.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		if (td.querySelector('input')) return;
		const original = result.basename;
		td.empty();
		const input = td.createEl('input', {
			cls: 'dashboard-library-table-edit-input',
			attr: { type: 'text', value: original },
		});
		input.focus();
		input.select();

		const finish = async (save: boolean): Promise<void> => {
			if (!input.isConnected) return;
			const raw = input.value.trim();
			input.remove();
			if (!save || !raw || raw === original) {
				td.textContent = original;
				return;
			}
			td.textContent = raw;
			try {
				await renameMediaFile(app, result.file, raw);
				refresh();
			} catch (err) {
				console.error('[Dashboard] media rename failed:', err);
				new Notice(t('media.renameFailed'));
				td.textContent = original;
			}
		};

		input.addEventListener('keydown', (ke: KeyboardEvent) => {
			if (ke.key === 'Enter') { ke.preventDefault(); void finish(true); }
			else if (ke.key === 'Escape') { ke.preventDefault(); void finish(false); }
		});
		input.addEventListener('blur', () => { void finish(true); });
	});
}
