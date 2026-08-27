import { App, Notice, TFile, setIcon } from 'obsidian';
import type { DashboardSettings, PinnedNote, QuickNotePreset, RenderCallbacks } from './types';
import { MomentLike, nowMoment } from './datetime';
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
	const commands = settings.quickCommands ?? [];
	const captureOn = !!settings.quickCaptureEnabled;
	const dailyOn = !!settings.quickDailyEnabled;
	const hasChips = presets.length > 0 || pinned.length > 0 || commands.length > 0 || dailyOn;

	// Scrollable nav of chips — sits on the left.
	const nav = region.createDiv({ cls: 'dashboard-quicknote-nav' });
	if (!hasChips && !captureOn) {
		const empty = nav.createDiv({ cls: 'dashboard-quicknote-empty' });
		empty.createSpan({ cls: 'dashboard-quicknote-empty-text', text: t('quickNote.empty') });
		const cfg = empty.createEl('button', { cls: 'dashboard-quicknote-empty-btn', text: t('quickNote.configure') });
		cfg.addEventListener('click', () => callbacks.onQuickNoteConfig());
	} else {
		// "Today" leads the strip (leftmost) when enabled; presets and pinned follow.
		if (dailyOn) {
			chip(nav, 'dashboard-quicknote-chip dashboard-quicknote-today', 'sun', t('quickNote.today'), () => callbacks.onQuickNoteDaily());
		}
		for (const preset of presets) {
			chip(nav, 'dashboard-quicknote-chip', preset.icon || 'file-plus', preset.label, () => callbacks.onQuickNoteCreate(preset));
		}
		for (const note of pinned) {
			chip(nav, 'dashboard-quicknote-chip dashboard-quicknote-pin', note.icon || 'pin', note.label, () => callbacks.onOpenPinnedNote(note));
		}
		for (const cmd of commands) {
			chip(nav, 'dashboard-quicknote-chip', cmd.icon || 'terminal', cmd.label, () => callbacks.onQuickCommand(cmd));
		}
	}

	// ── Right zone: capture pill + config cog, grouped so the controls read
	// as one cohesive unit instead of a box "floating" apart from the chips.
	const actions = region.createDiv({ cls: 'dashboard-quicknote-actions' });

	if (captureOn) {
		const capture = actions.createDiv({ cls: 'dashboard-quicknote-capture' });
		setIcon(capture.createSpan({ cls: 'dashboard-quicknote-capture-icon' }), 'pencil');
		// Auto-growing capture field: empty it looks exactly like the old
		// one-line pill; once the text wraps, the box grows smoothly (CSS height
		// transition) to fit every line so long thoughts stay fully readable.
		// Enter still captures instantly - Shift+Enter breaks the line instead -
		// and IME composition Enter (confirming a Chinese candidate) is ignored,
		// keeping the "type anywhere, hit Enter, done" flow intact.
		const input = capture.createEl('textarea', {
			cls: 'dashboard-quicknote-capture-input',
			attr: {
				rows: '1',
				spellcheck: 'false',
				placeholder: t('quickNote.capturePlaceholder'),
				'aria-label': t('quickNote.capture'),
			},
		});
		// Cap the growth so a runaway thought scrolls inside the box instead of
		// stretching the whole quick-note bar off-screen.
		const MAX_CAPTURE_HEIGHT = 160;
		const resize = () => {
			input.setCssStyles({ height: 'auto' });
			const target = Math.max(26, Math.min(input.scrollHeight, MAX_CAPTURE_HEIGHT));
			// Assigning 'auto' and the target height in the same frame keeps the
			// CSS transition running from the previous height to the new one
			// instead of snapping through the intermediate auto layout.
			input.setCssStyles({ height: `${target}px` });
			const expanded = target > 30;
			capture.toggleClass('dashboard-quicknote-capture--expanded', expanded);
			// Mirror on the bar: at rest it vertically centers its single-line
			// content; once the field grows past one line it re-anchors to the
			// top so the box extends downward and the chips row stays put.
			region.toggleClass('dashboard-quicknote--capture-expanded', expanded);
		};
		input.addEventListener('input', resize);
		const submit = () => {
			const text = input.value.trim();
			if (text) {
				callbacks.onQuickNoteCapture(text);
				input.value = '';
			}
			resize();
		};
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				submit();
			}
		});
	}

	// Config cog — the persistent operation icon at the far right.
	const cog = actions.createEl('button', {
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

	const now = nowMoment();
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
		const tpl = await readTemplateContent(app, tplPath, { title, now });
		if (!tpl.found) {
			new Notice(t('quickNote.templateNotFound'));
		}
		content = tpl.content;
	}

	const file = await app.vault.create(path, content);
	await app.workspace.getLeaf('tab').openFile(file);
	new Notice(t('quickNote.created', { name: file.basename }));
}

/** Capture a fleeting thought: insert into the target note — top (after any
 *  frontmatter) or bottom, per quickCapturePosition — or create a new note.
 *  New notes place the line the same way against their template content. */
export async function captureThought(app: App, settings: DashboardSettings, text: string): Promise<void> {
	const now = nowMoment();
	// Wiki-link date (jumps to the daily note + shows up in its backlinks) plus
	// time-of-day; the plain date text is also globally searchable for filtering.
	const line = `- ${text} *([[${now.format('YYYY-MM-DD')}]] ${now.format('HH:mm')})*`;
	const target = (settings.quickCaptureTarget || '').trim();

	if (target) {
		const file = await getOrCreateNote(app, target);
		if (file) {
			const raw = await app.vault.read(file);
			await app.vault.modify(file, placeCaptureLine(raw, line, settings.quickCapturePosition));
			new Notice(t('quickNote.captured'));
			return;
		}
	}

	const folder = (settings.quickCaptureFolder || '').trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const filename = now.format('YYYY-MM-DD-HHmm');
	let path = folder ? `${folder}/${filename}.md` : `${filename}.md`;
	path = await uniquePath(app, path);
	// Seed new notes with the configured template (if any), then place the
	// captured line top/bottom of it exactly as for an existing target note.
	const { content: tplContent } = await readTemplateContent(app, settings.quickCaptureTemplate, { now });
	await app.vault.create(path, placeCaptureLine(tplContent, line, settings.quickCapturePosition));
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

/** Create (seeded with the core Daily Notes template) / open today's daily note,
 *  in the folder + format the core "Daily notes" plugin is configured for. A
 *  stale blank note (e.g. from earlier, before the template was wired up) is
 *  auto-seeded with the template. Shows a hint when the core plugin is disabled. */
export async function openTodayNote(app: App): Promise<void> {
	const iso = nowMoment().format('YYYY-MM-DD');
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

/** Read a template file (vault path, `.md` fallback) and substitute
 *  {{date}}/{{time}}/{{title}} vars. An empty path returns { '', true }
 *  (no template configured — not an error); a missing or unreadable file
 *  returns { '', false } so callers can warn the user. */
async function readTemplateContent(
	app: App,
	tplPath: string,
	opts: { title?: string; now?: MomentLike },
): Promise<{ content: string; found: boolean }> {
	const p = (tplPath || '').trim();
	if (!p) return { content: '', found: true };
	const tpl = resolveFile(app, p);
	if (!tpl) return { content: '', found: false };
	try {
		const raw = await app.vault.read(tpl);
		return { content: substituteTemplateVars(raw, opts), found: true };
	} catch {
		return { content: '', found: false };
	}
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

/** Place a captured line into `raw` — at the top (after any YAML frontmatter)
 *  or at the bottom — per the configured capture position. */
function placeCaptureLine(raw: string, line: string, position: 'start' | 'end'): string {
	if (position === 'start') {
		const { fm, body } = splitFrontmatter(raw);
		// Keep the body's own leading blank line when present; otherwise add one
		// so the line never glues onto the first paragraph (a bare "- x\ntext"
		// would render "text" as a lazy continuation of the list item).
		const sep = body === '' || body.startsWith('\n') ? '' : '\n';
		return `${fm}${line}\n${sep}${body}`;
	}
	const sep = raw === '' || raw.endsWith('\n') ? '' : '\n';
	return `${raw}${sep}${line}\n`;
}

/** Split a leading YAML frontmatter block (a closed `---` fence at line 1)
 *  from the note body. Returns { fm: '', body: raw } when there is none. */
function splitFrontmatter(raw: string): { fm: string; body: string } {
	if (!raw.startsWith('---')) return { fm: '', body: raw };
	const lines = raw.split('\n');
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]!.trim() === '---') {
			return { fm: `${lines.slice(0, i + 1).join('\n')}\n`, body: lines.slice(i + 1).join('\n') };
		}
	}
	return { fm: '', body: raw };
}

/** Get an existing note (resolving a `.md` suffix if the path omits it), or
 *  create it (empty, as a proper `.md` note) so capture can append to it. */
async function getOrCreateNote(app: App, path: string): Promise<TFile | null> {
	const existing = resolveFile(app, path);
	if (existing) return existing;
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (folder) await ensureFolder(app, folder);
	const ext = path.toLowerCase().endsWith('.md') ? '' : '.md';
	try {
		return await app.vault.create(`${path}${ext}`, '');
	} catch {
		return null;
	}
}
