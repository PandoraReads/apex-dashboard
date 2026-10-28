import { App, Modal, TFile, setIcon } from 'obsidian';
import { resolveVaultImage } from './banner';
import { releaseVideoMedia } from './media-section';
import { MediaTagEditModal } from './media-tag-editor-modal';
import { t } from './i18n';

/** localStorage key for the lightbox video player's stretched width (percent). */
const VIDEO_WIDTH_KEY = 'apex-dashboard-lightbox-video-width';
/** A drag that ends over the backdrop makes the browser fire its click on the
 *  common ancestor of the down/up targets — the stage — which the backdrop
 *  handler reads as "close". Swallow backdrop clicks for this long after any
 *  gesture (video grip drag, image pan) ends. */
const GESTURE_CLICK_GUARD_MS = 400;

/** Tag access hooks so the lightbox can show/edit per-file tags without
 *  owning the store. onTagsChange commits the new list. */
export interface MediaTagHooks {
	getTags(file: TFile): string[];
	getAllTags(): string[];
	onTagsChange(file: TFile, tags: string[]): void;
}

/**
 * Full-screen lightbox for browsing a list of image or video files.
 * Images show large; videos play inline (controls + autoplay). Left/right
 * arrows (buttons or keyboard) step through the list; Esc / background click
 * closes. Media src comes from {@link resolveVaultImage} which works for both.
 * With tagHooks set, a tag bar below the caption shows and edits per-file
 * tags; saving updates the bar in place so the playing video never restarts.
 * Below the tags, a centered list names every note that references the file
 * (backlinks); a click closes the lightbox and opens the note through
 * openNote — popover-setting-aware when the caller wires it that way.
 */
export class MediaLightboxModal extends Modal {
	private readonly files: TFile[];
	private index: number;
	private readonly kind: 'image' | 'video';
	private readonly tagHooks?: MediaTagHooks;
	/** Note-jump hook for the backlinks list (falls back to openLinkText). */
	private readonly openNote?: (file: TFile) => void;
	/** Document-level gesture teardown (zoom pan, video resize) — run on close
	 *  so a drag interrupted by Esc/unload never leaks its move listeners. */
	private readonly gestureDisposers: Array<() => void> = [];
	/** Timestamp of the last finished drag gesture (see GESTURE_CLICK_GUARD_MS). */
	private lastGestureEndAt = 0;

	constructor(app: App, files: TFile[], startIndex: number, kind: 'image' | 'video', tagHooks?: MediaTagHooks, openNote?: (file: TFile) => void) {
		super(app);
		this.files = files;
		this.index = files.length === 0 ? 0 : Math.max(0, Math.min(startIndex, files.length - 1));
		this.kind = kind;
		this.tagHooks = tagHooks;
		this.openNote = openNote;
	}

	onOpen(): void {
		const { contentEl, containerEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-media-lightbox');
		// Tag every layer so CSS can override Obsidian's default modal sizing and
		// let the media fill + center in the viewport.
		modalEl.addClass('dashboard-media-lightbox-modal');
		containerEl.addClass('dashboard-media-lightbox-container');

		// Keyboard navigation (Esc is handled by Modal already)
		this.scope.register([], 'ArrowLeft', () => { this.show(this.index - 1); return false; });
		this.scope.register([], 'ArrowRight', () => { this.show(this.index + 1); return false; });

		// Click the backdrop (not the media) to close. Registered once here —
		// renderCurrent() runs per item and would otherwise stack a listener
		// per navigation, each closing the modal again.
		contentEl.addEventListener('click', (e) => this.onBackdropClick(e));

		this.renderCurrent();
	}

	/** Backdrop click → close, unless the click is the tail of a drag gesture
	 *  (a grip/pan release over the backdrop synthesizes a click on the stage). */
	private onBackdropClick(e: MouseEvent): void {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (target !== this.contentEl && !target.classList.contains('dashboard-media-lightbox-stage')) return;
		if (Date.now() - this.lastGestureEndAt < GESTURE_CLICK_GUARD_MS) return;
		this.close();
	}

	/** Mark the end of a drag so the click it synthesizes can't close us. */
	private endGesture(): void {
		this.lastGestureEndAt = Date.now();
	}

	private renderCurrent(): void {
		const { contentEl } = this;
		// Release the previously shown video (pause + clear src + load) before
		// wiping the DOM so navigating between items never stacks decoders.
		releaseVideoMedia(contentEl);
		contentEl.empty();
		const file = this.files[this.index];
		if (!file) {
			contentEl.createDiv({ cls: 'dashboard-media-lightbox-empty', text: '—' });
			return;
		}
		const src = resolveVaultImage(this.app, file.path);
		if (!src) return;

		const stage = contentEl.createDiv({ cls: 'dashboard-media-lightbox-stage' });
		if (this.kind === 'image') {
			const img = stage.createEl('img', {
				cls: 'dashboard-media-lightbox-img',
				attr: { src, alt: file.basename },
			});
			this.wireImageZoom(img);
		} else {
			this.buildResizableVideo(stage, src);
		}

		contentEl.createDiv({
			cls: 'dashboard-media-lightbox-caption',
			text: `${file.basename}  (${this.index + 1} / ${this.files.length})`,
		});

		if (this.tagHooks) {
			const tagBar = contentEl.createDiv({ cls: 'dashboard-media-lightbox-tags' });
			this.renderTagBar(tagBar, file);
		}

		// Referencing notes (Rae): centered below the tag area; an empty host
		// stays childless and CSS hides it (:empty), so unreferenced files
		// render no section at all.
		const backlinksHost = contentEl.createDiv({ cls: 'dashboard-media-lightbox-backlinks' });
		this.renderBacklinks(backlinksHost, file);

		const prevBtn = contentEl.createDiv({ cls: 'dashboard-media-lightbox-nav dashboard-media-lightbox-nav--prev' });
		setIcon(prevBtn, 'chevron-left');
		if (this.index <= 0) prevBtn.addClass('is-disabled');
		prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.show(this.index - 1); });

		const nextBtn = contentEl.createDiv({ cls: 'dashboard-media-lightbox-nav dashboard-media-lightbox-nav--next' });
		setIcon(nextBtn, 'chevron-right');
		if (this.index >= this.files.length - 1) nextBtn.addClass('is-disabled');
		nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.show(this.index + 1); });
	}

	/** Tag pills + an add button under the caption. Rebuilt in place on save —
	 *  never via renderCurrent(), which would restart a playing video. */
	private renderTagBar(bar: HTMLElement, file: TFile): void {
		bar.empty();
		const hooks = this.tagHooks!;
		for (const tag of hooks.getTags(file)) {
			bar.createSpan({ cls: 'dashboard-media-lightbox-tag', text: tag });
		}
		const addBtn = bar.createDiv({ cls: 'dashboard-media-lightbox-tag dashboard-media-lightbox-tag--add' });
		setIcon(addBtn.createSpan({ cls: 'dashboard-media-lightbox-tag-icon' }), 'plus');
		addBtn.createSpan({ text: t('media.editTags') });
		addBtn.setAttribute('role', 'button');
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new MediaTagEditModal(
				this.app,
				file,
				hooks.getTags(file),
				hooks.getAllTags(),
				(tags) => {
					hooks.onTagsChange(file, tags);
					this.renderTagBar(bar, file);
				},
			).open();
		});
	}

	/** Notes referencing the current file, listed below the tag bar.
	 *  resolvedLinks maps every source path to its resolved targets (links
	 *  AND embeds), so an inverted scan collects exactly the referencing
	 *  notes; canvas boards and stale link texts never resolve, and the
	 *  md/instanceof filter drops anything that still slips through. Sorted
	 *  by path so the order survives index rebuilds. A click closes the
	 *  lightbox and opens the note (openNote honors the workspace popover
	 *  setting; openLinkText is the hook-less fallback). */
	private renderBacklinks(host: HTMLElement, file: TFile): void {
		// Optional-chained for the minimal node harnesses; a real App always
		// carries the metadata cache.
		const links = this.app.metadataCache?.resolvedLinks;
		if (!links) return;
		const notes: TFile[] = [];
		for (const [sourcePath, targets] of Object.entries(links)) {
			if (!(file.path in targets)) continue;
			const source = this.app.vault.getAbstractFileByPath(sourcePath);
			if (source instanceof TFile && source.extension === 'md') notes.push(source);
		}
		if (notes.length === 0) return;
		notes.sort((a, b) => a.path.localeCompare(b.path));
		host.createDiv({ cls: 'dashboard-media-lightbox-backlinks-title', text: t('media.backlinks') });
		for (const note of notes) {
			const row = host.createDiv({
				cls: 'dashboard-media-lightbox-backlink',
				attr: { role: 'link', title: note.path },
			});
			setIcon(row.createSpan({ cls: 'dashboard-media-lightbox-backlink-icon' }), 'file-text');
			row.createSpan({ cls: 'dashboard-media-lightbox-backlink-name', text: note.basename });
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				this.close();
				if (this.openNote) this.openNote(note);
				else void this.app.workspace.openLinkText(note.path, '');
			});
		}
	}

	private show(index: number): void {
		if (index < 0 || index >= this.files.length) return;
		this.index = index;
		this.renderCurrent();
	}

	/** Wheel zoom for images (Rae): scroll to magnify around the cursor,
	 *  drag to pan while magnified, double-click to reset. Transform is
	 *  translate + scale around the element center; the cursor-anchored
	 *  variant of t' = d - k·(d - t) keeps the point under the cursor fixed. */
	private wireImageZoom(img: HTMLElement): void {
		let scale = 1;
		let tx = 0;
		let ty = 0;
		const apply = (): void => {
			img.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${Math.round(scale * 100) / 100})`;
		};
		img.addEventListener('wheel', (e) => {
			e.preventDefault();
			const factor = (e as WheelEvent).deltaY < 0 ? 1.2 : 1 / 1.2;
			const next = Math.min(8, Math.max(0.2, scale * factor));
			const k = next / scale;
			const rect = img.getBoundingClientRect();
			const dX = e.clientX - (rect.left + rect.width / 2);
			const dY = e.clientY - (rect.top + rect.height / 2);
			tx = dX - k * (dX - tx);
			ty = dY - k * (dY - ty);
			scale = next;
			apply();
		}, { passive: false });
		// Pan while magnified (pointer capture dies on lostpointercapture in
		// embedded surfaces, so the move/up pair rides the document).
		img.addEventListener('pointerdown', (e) => {
			if (scale <= 1.02) return;
			e.preventDefault();
			let lastX = e.clientX;
			let lastY = e.clientY;
			const onMove = (ev: PointerEvent): void => {
				tx += ev.clientX - lastX;
				ty += ev.clientY - lastY;
				lastX = ev.clientX;
				lastY = ev.clientY;
				apply();
			};
			const onUp = (): void => {
				activeDocument.removeEventListener('pointermove', onMove, true);
				activeDocument.removeEventListener('pointerup', onUp, true);
				this.endGesture();
			};
			activeDocument.addEventListener('pointermove', onMove, true);
			activeDocument.addEventListener('pointerup', onUp, true);
			this.gestureDisposers.push(onUp);
		});
		img.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			scale = 1;
			tx = 0;
			ty = 0;
			apply();
		});
	}

	/** Corner-drag handle that stretches the video player (Rae): dragging the
	 *  bottom-right grip resizes the player width; the choice persists in
	 *  localStorage so the next lightbox opens at the same size.
	 *
	 *  The width lands on the WRAP, not the video: the stage has a definite
	 *  width, so a percentage there resolves predictably and the wrap stays a
	 *  centered flex item (a percentage on the video inside a shrink-to-fit
	 *  wrap resolved circularly and left the player off-center). The video
	 *  itself is width:100% of the wrap. */
	private buildResizableVideo(stage: HTMLElement, src: string): void {
		const wrap = stage.createDiv({ cls: 'dashboard-media-lightbox-video-wrap' });
		// Clicks inside the player (controls, letterbox padding, grip) never
		// reach the backdrop handler.
		wrap.addEventListener('click', (e) => e.stopPropagation());
		const video = wrap.createEl('video', {
			cls: 'dashboard-media-lightbox-video',
			attr: { src, controls: '', autoplay: '', playsinline: '' },
		});
		const stored = this.app.loadLocalStorage(VIDEO_WIDTH_KEY);
		const parsed = typeof stored === 'string' ? Number.parseFloat(stored) : Number.NaN;
		let pct = Number.isFinite(parsed) ? Math.min(95, Math.max(20, parsed)) : 70;
		wrap.style.width = `${Math.round(pct)}%`;
		const grip = wrap.createDiv({
			cls: 'dashboard-media-lightbox-resize',
			attr: { role: 'button', 'aria-label': t('media.resizeVideo'), title: t('media.resizeVideo') },
		});
		setIcon(grip, 'maximize-2');
		grip.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startPct = pct;
			const base = Math.max(1, activeDocument.body.clientWidth || window.innerWidth);
			const onMove = (ev: PointerEvent): void => {
				pct = Math.min(95, Math.max(20, startPct + ((ev.clientX - startX) / base) * 100));
				wrap.style.width = `${Math.round(pct)}%`;
			};
			const onUp = (): void => {
				activeDocument.removeEventListener('pointermove', onMove, true);
				activeDocument.removeEventListener('pointerup', onUp, true);
				this.endGesture();
				this.app.saveLocalStorage(VIDEO_WIDTH_KEY, String(Math.round(pct)));
			};
			activeDocument.addEventListener('pointermove', onMove, true);
			activeDocument.addEventListener('pointerup', onUp, true);
			this.gestureDisposers.push(onUp);
		});
	}

	onClose(): void {
		for (const dispose of this.gestureDisposers.splice(0)) dispose();
		releaseVideoMedia(this.contentEl);
		this.contentEl.empty();
	}
}
