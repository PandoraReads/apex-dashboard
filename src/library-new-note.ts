import { App, Menu, TFile } from 'obsidian';
import { ensureFolder } from './daily-notes';
import { sanitizeFilename, uniquePath, readTemplateContent, splitFrontmatter } from './quick-note-section';
import { nowMoment } from './datetime';
import { LibraryConfig } from './types';

/** Frontmatter pseudo-properties that no creation-time value can satisfy:
 *  `path` is the file location and `modified`/`created` are file stats. */
const NON_PREFILLABLE_PROPERTIES: readonly string[] = ['path', 'modified', 'created'];

/**
 * Derive the frontmatter properties a "new note" created for a library/folder
 * section should carry so it matches the section's property filters.
 *
 * equals (default) and contains filters contribute their first value (an exact
 * value also satisfies a contains check). The `tags` pseudo-property collects
 * its values into a YAML list. Filters that no single pre-filled value can
 * satisfy — notEquals, pseudo-properties, anything with a dateRange — are
 * returned in `skipped` so callers can tell the user to fill them manually.
 * Match-all filters (empty values, no dateRange) are ignored silently.
 */
export function buildNewNoteProps(config?: LibraryConfig): {
	props: Record<string, string | string[]>;
	skipped: string[];
} {
	const props: Record<string, string | string[]> = {};
	const skipped: string[] = [];
	if (!config?.filters) return { props, skipped };
	for (const filter of config.filters) {
		const property = (filter.property ?? '').trim();
		if (!property) continue;
		if (filter.dateRange) {
			skipped.push(property);
			continue;
		}
		if (NON_PREFILLABLE_PROPERTIES.includes(property)) {
			// Only report it when the filter actually narrows something.
			if ((filter.values ?? []).length > 0) skipped.push(property);
			continue;
		}
		const value = (filter.values ?? [])[0];
		if (typeof value !== 'string' || value.length === 0) continue;
		if (filter.operator === 'notEquals') {
			skipped.push(property);
			continue;
		}
		if (property === 'tags') {
			const existing = Array.isArray(props[property]) ? props[property] : [];
			if (!existing.includes(value)) props[property] = [...existing, value];
			continue;
		}
		if (property in props) {
			// A second filter on the same property: report it when the value we
			// already picked cannot satisfy this one too (queryVaultFiles ANDs
			// both, so the note would silently never match the section).
			const existing = props[property];
			const satisfied = filter.operator === 'contains'
				? typeof existing === 'string' && existing.toLowerCase().includes(value.toLowerCase())
				: filter.values.includes(String(existing));
			if (!satisfied && !skipped.includes(property)) skipped.push(property);
			continue;
		}
		props[property] = value;
	}
	return { props, skipped };
}

/**
 * Folder a notes/projects section's "new note" is created in: the section's
 * configured save folder (libraryConfig.folders[0]) when set — vault root
 * (empty string) otherwise.
 */
export function sectionNewNoteFolder(config?: LibraryConfig): string {
	return (config?.folders ?? [])[0]?.trim().replace(/^\/+|\/+$/g, '') ?? '';
}

/** Escape a YAML scalar body: flatten newlines, then backslashes, then quotes. */
function escapeYamlScalar(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Render frontmatter props as a YAML block (`---` fences, trailing newline).
 * Returns '' for empty props so filter-less sections create bare notes.
 * Keys and scalars are double-quoted so exotic property names/values stay
 * valid YAML.
 */
export function yamlFrontmatter(props: Record<string, string | string[]>): string {
	const keys = Object.keys(props).filter(k => k.trim().length > 0);
	if (keys.length === 0) return '';
	const lines: string[] = ['---'];
	for (const key of keys) {
		const value = props[key];
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`"${escapeYamlScalar(key)}": []`);
				continue;
			}
			lines.push(`"${escapeYamlScalar(key)}":`);
			for (const item of value) lines.push(`  - "${escapeYamlScalar(item)}"`);
		} else if (typeof value === 'string') {
			lines.push(`"${escapeYamlScalar(key)}": "${escapeYamlScalar(value)}"`);
		}
	}
	lines.push('---', '');
	return lines.join('\n');
}

/**
 * Group a template frontmatter block (fences stripped by the caller) into
 * top-level key sections: a `key: value` line at column 0 starts a section,
 * every following non-key line (indented child, flow-list wrap, …) belongs to
 * it. Sections are kept or dropped whole, so multiline values survive verbatim.
 */
function splitFrontmatterSections(fmLines: string[]): Array<{ key: string; lines: string[] }> {
	const KEY_LINE_RE = /^(?:"([^"]+)"|'([^']+)'|([^\s:#][^:]*)):/;
	const sections: Array<{ key: string; lines: string[] }> = [];
	for (const line of fmLines) {
		const m = KEY_LINE_RE.exec(line);
		if (m) {
			sections.push({ key: (m[1] ?? m[2] ?? m[3])!, lines: [line] });
		} else if (sections.length > 0) {
			sections[sections.length - 1]!.lines.push(line);
		}
	}
	return sections;
}

/**
 * Compose a new note's content from a template: the template's frontmatter
 * sections whose keys the filter props do NOT define are carried over with
 * their raw lines intact (flow-style lists, dates, spacing stay byte-for-byte;
 * no YAML re-render), the props themselves are added (winning any collision so
 * the note still matches the section's filters), and the template body
 * (variables already substituted) follows.
 */
export function mergeTemplateNoteContent(
	tplFm: string,
	tplBody: string,
	props: Record<string, string | string[]>,
): string {
	// splitFrontmatter's fm is `---\n…\n---\n`: peel the leading fence, the
	// trailing fence and the trailing newline. Interior blank lines stay — they
	// can be part of a `|`/`>` block value and must survive byte-for-byte.
	const fmLines = tplFm ? tplFm.split('\n') : [];
	if (fmLines.length > 0 && fmLines[0]!.trim() === '---') fmLines.shift();
	while (fmLines.length > 0 && fmLines[fmLines.length - 1]!.trim() === '') fmLines.pop();
	if (fmLines.length > 0 && fmLines[fmLines.length - 1]!.trim() === '---') fmLines.pop();
	const kept = splitFrontmatterSections(fmLines)
		.filter(section => !(section.key in props))
		.flatMap(section => section.lines);
	const propBlock = yamlFrontmatter(props);
	const propLines = propBlock ? propBlock.split('\n').slice(1, -2) : [];
	const allLines = [...propLines, ...kept];
	const fm = allLines.length > 0 ? `---\n${allLines.join('\n')}\n---\n` : '';
	if (!tplBody) return fm;
	return fm ? `${fm}${tplBody}\n` : `${tplBody}\n`;
}

/**
 * Create `folder/Title.md` (uniqued as `-2`, `-3`, … on collision) with the
 * given frontmatter props baked into the initial content — one atomic write,
 * so the vault-'create' refresh already sees a filter-matching note.
 * `templatePath`: a template note that seeds the new note — its body (with
 * {{title}}/{{date:…}} substituted) and the frontmatter properties the props
 * don't define (props win collisions) — the quick-note preset pipeline.
 */
export async function createNoteWithProps(
	app: App,
	folder: string,
	title: string,
	props: Record<string, string | string[]>,
	templatePath?: string,
): Promise<TFile> {
	const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '');
	const name = sanitizeFilename(title);
	if (!name) throw new Error('Note title is empty after sanitization');
	if (cleanFolder) await ensureFolder(app, cleanFolder);
	const base = cleanFolder ? `${cleanFolder}/${name}.md` : `${name}.md`;
	const path = await uniquePath(app, base);

	let content = yamlFrontmatter(props);
	const tpl = (templatePath ?? '').trim();
	if (tpl) {
		const { content: tplContent, found } = await readTemplateContent(app, tpl, { title, now: nowMoment() });
		if (!found) throw new Error(`Template not found: ${tpl}`);
		// The template's body seeds the note; its frontmatter properties merge
		// under the filter props (which win collisions so the note matches the
		// section's filters).
		const { fm, body } = splitFrontmatter(tplContent);
		content = mergeTemplateNoteContent(fm, body.replace(/^\n+/, ''), props);
	}
	return app.vault.create(path, content);
}

/**
 * Let the user pick one of several configured folders from a native Menu
 * anchored at `pos` (the toolbar click point). Resolves null when dismissed.
 */
export function pickFolderFromMenu(folders: string[], pos: { x: number; y: number }): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const menu = new Menu();
		for (const folder of folders) {
			menu.addItem((item) => {
				item.setIcon('folder');
				item.setTitle(folder).onClick(() => {
					if (settled) return;
					settled = true;
					resolve(folder);
				});
			});
		}
		menu.onHide(() => {
			if (settled) return;
			settled = true;
			resolve(null);
		});
		menu.showAtPosition(pos);
	});
}
