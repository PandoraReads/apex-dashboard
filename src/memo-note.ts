import type { App } from 'obsidian';
import { ensureFolder } from './daily-notes';
import { mergeTemplateNoteContent } from './library-new-note';
import { memoCardText } from './card-move';
import { nowMoment, type MomentLike } from './datetime';
import { readTemplateContent, sanitizeFilename, splitFrontmatter, uniquePath } from './quick-note-section';
import type { DashboardCard } from './types';

export interface MemoNoteResult {
	/** Vault path of the created note. */
	path: string;
	/** The configured template could not be read; the built-in default was
	 *  used and the save still succeeded (caller shows a notice). */
	templateMissing: boolean;
}

/**
 * Save a memo card as a note at `folder` (empty = vault root).
 *
 * Content: the configured template (when set) seeds the note — its body with
 * {{title}}/{{date:…}}/{{time:…}} substituted, its frontmatter merged under
 * the memo marker props — and the card's complete text (blockquote, body,
 * task and doc trees — the same serialization the memo editor shows, minus
 * nothing; the ⏰ and <!--collapsed--> markers ride along literally and stay
 * invisible in preview) is appended after a blank line. With no template the
 * built-in default applies: frontmatter with exactly 创建时间 and type: memo
 * plus the card text. Both paths inject those two props so every memo note
 * stays identifiable regardless of template.
 *
 * `untitled` labels untitled cards (localized by the caller — this module
 * stays free of i18n/Notice). `now` overrides the clock for deterministic
 * tests.
 */
export async function createMemoNote(
	app: App,
	input: {
		folder: string;
		templatePath: string;
		card: DashboardCard;
		untitled: string;
		now?: MomentLike;
	},
): Promise<MemoNoteResult> {
	const now = input.now ?? nowMoment();
	const title = input.card.title?.trim() || input.untitled;
	const safe = sanitizeFilename(title) || input.untitled;
	// Filename keeps the historical convention: title + local-time stamp.
	const fileName = `${safe}-${now.format('YYYYMMDD-HHmmss')}.md`;

	const folder = input.folder.trim().replace(/^\/+|\/+$/g, '');
	if (folder) await ensureFolder(app, folder);
	const base = folder ? `${folder}/${fileName}` : fileName;
	const path = await uniquePath(app, base);

	// Marker props every memo note carries; they win collisions with a
	// template's own frontmatter so type/创建时间 are guaranteed present.
	const props: Record<string, string> = {
		'创建时间': now.format('YYYY-MM-DD HH:mm'),
		'type': 'memo',
	};

	let tplFm = '';
	let tplBody = '';
	let templateMissing = false;
	const tplPath = input.templatePath.trim();
	if (tplPath) {
		const { content, found } = await readTemplateContent(app, tplPath, { title, now });
		if (!found) {
			// Fall through to the default template; the save must not fail.
			templateMissing = true;
		} else {
			const split = splitFrontmatter(content);
			tplFm = split.fm;
			// Same leading-newline strip the library new-note pipeline applies.
			tplBody = split.body.replace(/^\n+/, '');
		}
	}

	const cardText = memoCardText(input.card);
	const body = [tplBody, cardText].filter(s => s.trim().length > 0).join('\n\n');
	const content = mergeTemplateNoteContent(tplFm, body, props);

	await app.vault.create(path, content);
	return { path, templateMissing };
}
