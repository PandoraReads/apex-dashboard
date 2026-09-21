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
 * Create `folder/Title.md` (uniqued as `-2`, `-3`, … on collision) with the
 * given frontmatter props baked into the initial content — one atomic write,
 * so the vault-'create' refresh already sees a filter-matching note.
 * `templatePath`: a template note whose body (frontmatter stripped) seeds the
 * note under the props block, with {{title}}/{{date:…}} substituted — the
 * quick-note preset pipeline.
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
		// The template's own frontmatter is dropped: the props block (built
		// from the section's filters) owns the new note's frontmatter.
		const body = splitFrontmatter(tplContent).body.replace(/^\n+/, '');
		content = content === '' ? (body ? `${body}\n` : '') : (body ? `${content}${body}\n` : content);
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
