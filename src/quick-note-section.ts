import { App, Notice, TFile, moment, setIcon } from 'obsidian';
import type { DashboardSettings, PinnedNote, QuickNotePreset, RenderCallbacks } from './types';
import { ensureFolder, getOrCreateDailyNote, substituteTemplateVars } from './daily-notes';
import { showPromptDialog } from './prompt-dialog';
import { t } from './i18n';

/**
 * Render the Quick Notes region — a non-reorderable, non-deletable strip pinned
 * to the top of the kanban, above all sections. Renders only when
 * `settings.quickNotesEnabled`. Empty sub-rows hide themselves so the strip
 * stays compact; an empty state nudges the user to configure it.
 */
export function renderQuickNoteRegion(
	container: HTMLElement,
	settings: DashboardSettings,
	callbacks: RenderCallbacks,
): void {
	const region = container.createDiv({ cls: 'dashboard-quicknote' });

	const presets = settings.quickNotePresets ?? [];
	const pinned = settings.pinnedNotes ?? [];
	const captureOn = !!settings.quickCaptureEnabled;
	const dailyOn = !!settings.quickDailyEnabled;
	const hasChips = presets.length > 0 || pinned.length > 0 || dailyOn;

	// Scrollable nav of chips — sits on the left.
	const nav = region.createDiv({ cls: 'dashboard-quicknote-nav' });
	if (!hasChips && !captureOn) {
		const empty = nav.createDiv({ cls: 'dashboard-quicknote-empty' });
		empty.createSpan({ cls: 'dashboard-quicknote-empty-text', text: t('quickNote.empty') });
		const cfg = empty.createEl('button', { cls: 'dashboard-quicknote-empty-btn', text: t('quickNote.configure') });
		cfg.addEventListener('click', () => callbacks.onQuickNoteConfig());
	} else {
		for (const preset of presets) {
			chip(nav, 'dashboard-quicknote-chip', preset.icon || 'file-plus', preset.label, () => callbacks.onQuickNoteCreate(preset));
		}
		if (dailyOn) {
			chip(nav, 'dashboard-quicknote-chip dashboard-quicknote-today', 'sun', t('quickNote.today'), () => callbacks.onQuickNoteDaily());
		}
		for (const note of pinned) {
			chip(nav, 'dashboard-quicknote-chip dashboard-quicknote-pin', note.icon || 'pin', note.label, () => callbacks.onOpenPinnedNote(note));
		}
	}

	// Capture input — fixed, just left of the config cog.
	if (captureOn) {
		const input = region.createEl('input', {
			cls: 'dashboard-modal-input dashboard-quicknote-capture-input',
			attr: {
				type: 'text',
				placeholder: t('quickNote.capturePlaceholder'),
				'aria-label': t('quickNote.capture'),
			},
		});
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const text = input.value.trim();
				if (text) {
					callbacks.onQuickNoteCapture(text);
					input.value = '';
				}
			}
		});
	}

	// Config cog — fixed at the right; small + faint until hovered.
	const cog = region.createEl('button', {
		cls: 'dashboard-quicknote-cog',
		attr: { 'aria-label': t('quickNote.config') },
	});
	setIcon(cog, 'settings-2');
	cog.addEventListener('click', () => callbacks.onQuickNoteConfig());
}

function chip(parent: HTMLElement, cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
	const btn = parent.createEl('button', { cls });
	setIcon(btn.createSpan({ cls: 'dashboard-quicknote-icon' }), icon);
	btn.appendText(label);
	btn.addEventListener('click', onClick);
	return btn;
}

// ── Behaviors (called from view.ts callbacks) ──────────────────────────────

/** Create a note from a preset: resolve template + vars + folder, then open. */
export async function createNoteFromPreset(app: App, preset: QuickNotePreset): Promise<void> {
	const filenamePattern = preset.filename?.trim() || '{{date:YYYY-MM-DD}}';
	let title = '';
	if (filenamePattern.includes('{{title}}')) {
		const input = await showPromptDialog(app, {
			title: t('quickNote.titlePrompt'),
			placeholder: t('quickNote.titlePlaceholder'),
		});
		if (input == null) return; // cancelled
		title = input.trim();
		if (!title) return;
	}

	const now = moment();
	let filename = sanitizeFilename(substituteTemplateVars(filenamePattern, { title, now }));
	if (!filename) filename = now.format('YYYY-MM-DD');

	const folder = (preset.folder || '').trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const ext = filename.toLowerCase().endsWith('.md') ? '' : '.md';
	let path = folder ? `${folder}/${filename}${ext}` : `${filename}${ext}`;
	path = await uniquePath(app, path);

	let content = '';
	const tplPath = (preset.templatePath || '').trim();
	if (tplPath) {
		const tpl = resolveFile(app, tplPath);
		if (tpl) {
			try { content = await app.vault.read(tpl); } catch { /* ignore read errors */ }
		} else {
			new Notice(t('quickNote.templateNotFound'));
		}
	}
	content = substituteTemplateVars(content, { title, now });

	const file = await app.vault.create(path, content);
	await app.workspace.getLeaf('tab').openFile(file);
	new Notice(t('quickNote.created', { name: file.basename }));
}

/** Capture a fleeting thought: append to the target note, or create a new note. */
export async function captureThought(app: App, settings: DashboardSettings, text: string): Promise<void> {
	const now = moment();
	const line = `- ${text} *(${now.format('HH:mm')})*`;
	const target = (settings.quickCaptureTarget || '').trim();

	if (target) {
		const file = await getOrCreateNote(app, target);
		if (file) {
			const raw = await app.vault.read(file);
			const sep = raw.endsWith('\n') ? '' : '\n';
			await app.vault.modify(file, `${raw}${sep}${line}\n`);
			new Notice(t('quickNote.captured'));
			return;
		}
	}

	const folder = (settings.quickCaptureFolder || '').trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const filename = now.format('YYYY-MM-DD-HHmm');
	let path = folder ? `${folder}/${filename}.md` : `${filename}.md`;
	path = await uniquePath(app, path);
	await app.vault.create(path, `${line}\n`);
	new Notice(t('quickNote.captured'));
}

/** Open a pinned note in a new tab. */
export function openPinnedNote(app: App, note: PinnedNote): void {
	const file = resolveFile(app, note.path);
	if (file) {
		void app.workspace.getLeaf('tab').openFile(file);
	} else {
		new Notice(t('quickNote.notFound'));
	}
}

/** Create (from the core Daily Notes template) / open today's daily note. */
export async function openTodayNote(app: App): Promise<void> {
	const iso = moment().format('YYYY-MM-DD');
	const file = await getOrCreateDailyNote(app, iso);
	if (!file) {
		new Notice(t('quickNote.dailyDisabled'));
		return;
	}
	await app.workspace.getLeaf('tab').openFile(file);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a vault file path, trying `.md` append if needed. */
function resolveFile(app: App, path: string): TFile | null {
	const p = path.trim();
	let f = app.vault.getAbstractFileByPath(p);
	if (f instanceof TFile) return f;
	if (!p.toLowerCase().endsWith('.md')) {
		f = app.vault.getAbstractFileByPath(`${p}.md`);
		if (f instanceof TFile) return f;
	}
	return null;
}

/** Strip characters that are illegal in filenames across OSes. */
function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

/** Return a non-conflicting vault path, appending `-2`, `-3`, … as needed. */
async function uniquePath(app: App, path: string): Promise<string> {
	if (!(await app.vault.adapter.exists(path))) return path;
	const dot = path.lastIndexOf('.');
	const hasExt = dot > path.lastIndexOf('/');
	const base = hasExt ? path.slice(0, dot) : path;
	const ext = hasExt ? path.slice(dot) : '';
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base}-${i}${ext}`;
		if (!(await app.vault.adapter.exists(candidate))) return candidate;
	}
	return `${base}-${Date.now()}${ext}`;
}

/** Get an existing note, or create it (empty) so capture can append to it. */
async function getOrCreateNote(app: App, path: string): Promise<TFile | null> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (folder) await ensureFolder(app, folder);
	try {
		return await app.vault.create(path, '');
	} catch {
		return null;
	}
}
