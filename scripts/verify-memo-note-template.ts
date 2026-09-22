/**
 * Verifies the memo-note template feature (createMemoNote in src/memo-note.ts):
 *
 * 1. Default template (no template configured) — frontmatter carries exactly
 *    the two marker fields 创建时间 (YYYY-MM-DD HH:mm) and type: memo, body is
 *    the card's complete text.
 * 2. Full-fidelity body — blockquote, body, task trees (⏰/collapsed markers),
 *    doc trees, wikiLink and url all survive into the note.
 * 3. Custom template — {{title}}/{{date:…}} substituted, template frontmatter
 *    merged under the marker props (props win collisions), card text appended
 *    after a blank line; extension-less template paths resolve via .md.
 * 4. Missing template — templateMissing=true, content identical to the
 *    default path, the note is still created.
 * 5. Collision — existing path gets the -2 suffix.
 * 6. Empty folder — vault root, no mkdir.
 * 7. Untitled card — filename falls back to the caller-provided label.
 *
 * Run: `npm run test:memo-note-template`
 */
import { strict as assert } from 'node:assert';
import { App, TFile } from 'obsidian';
import { createMemoNote } from '../src/memo-note';
import type { MomentLike } from '../src/datetime';
import type { DashboardCard } from '../src/types';

(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
};

/** Deterministic clock: only `format` is called by createMemoNote. */
const FORMATS: Record<string, string> = {
	'YYYYMMDD-HHmmss': '20260922-143005',
	'YYYY-MM-DD HH:mm': '2026-09-22 14:30',
	'YYYY-MM-DD': '2026-09-22',
};
const fakeNow = { format: (f?: string): string => FORMATS[f ?? ''] ?? f ?? '' } as unknown as MomentLike;

const makeCard = (over: Partial<DashboardCard> = {}): DashboardCard =>
	({
		id: 'c1',
		type: 'generic',
		column: 'memo',
		title: '买菜',
		body: '',
		tasks: [],
		docs: [],
		url: '',
		wikiLink: '',
		blockquote: '',
		...over,
	} as unknown as DashboardCard);

interface CreateCall { path: string; content: string }

/** Stub vault combining the template resolver with a mutable existence set:
 *  template files live in `templates`, created/known paths in `existing`. */
const makeApp = (templates: Record<string, string>, existing: Set<string>) => {
	const created: CreateCall[] = [];
	const mkdirs: string[] = [];
	const tplFile = (path: string) => Object.assign(new TFile(), { path });
	const app = {
		vault: {
			adapter: {
				exists: async (p: string): Promise<boolean> => existing.has(p),
				mkdir: async (p: string): Promise<void> => { mkdirs.push(p); existing.add(p); },
			},
			getAbstractFileByPath: (p: string): object | null => (p in templates ? tplFile(p) : null),
			read: async (f: { path: string }): Promise<string> => templates[f.path]!,
			create: async (path: string, content: string): Promise<{ path: string }> => {
				created.push({ path, content });
				existing.add(path);
				return { path };
			},
		},
	} as unknown as App;
	return { app, created, mkdirs };
};

const opts = (over: {
	folder?: string;
	templatePath?: string;
	card?: DashboardCard;
	untitled?: string;
} = {}) => ({
	folder: over.folder ?? 'Memos',
	templatePath: over.templatePath ?? '',
	card: over.card ?? makeCard(),
	untitled: over.untitled ?? 'Untitled',
	now: fakeNow,
});

async function main(): Promise<void> {
	const simpleCardText = '记得买牛奶';

	// 1. Default template: two marker fields, body = card text, folder made.
	{
		const { app, created, mkdirs } = makeApp({}, new Set());
		const res = await createMemoNote(app, opts({ card: makeCard({ body: simpleCardText }) }));
		assert.equal(res.templateMissing, false, 'default path is not a miss');
		assert.equal(res.path, 'Memos/买菜-20260922-143005.md', 'title + timestamp filename in the folder');
		assert.deepEqual(mkdirs, ['Memos'], 'destination folder created');
		assert.equal(created.length, 1, 'one vault.create call');
		const content = created[0]!.content;
		const lines = content.split('\n');
		assert.equal(lines[0], '---', 'frontmatter opens');
		const close = lines.indexOf('---', 1);
		assert.equal(close, 3, 'frontmatter holds exactly two field lines');
		assert.equal(lines[1], '"创建时间": "2026-09-22 14:30"', '创建时间 formatted YYYY-MM-DD HH:mm');
		assert.equal(lines[2], '"type": "memo"', 'type: memo marker');
		assert.equal(content, `---\n"创建时间": "2026-09-22 14:30"\n"type": "memo"\n---\n${simpleCardText}\n`,
			'default content byte-exact');
	}

	// 2. Full-fidelity body: every card part serializes into the note.
	{
		const fullCard = makeCard({
			blockquote: '引用一\n行二',
			body: '正文内容',
			tasks: [
				{ text: 'a', checked: true },
				{
					text: 'b', checked: false, reminder: '09:00 09-30', collapsed: true,
					children: [{ text: 'c', checked: false }],
				},
			],
			docs: [{ path: 'docs/a.md', children: [{ path: 'docs/b.md' }] }],
			wikiLink: 'Wiki',
			url: 'https://example.com',
		});
		const expectedBody = [
			'> 引用一',
			'> 行二',
			'正文内容',
			'- [x] a',
			'- [ ] b ⏰ 09:00 09-30 <!--collapsed-->',
			'    - [ ] c',
			'- [[docs/a.md]]',
			'    - [[docs/b.md]]',
			'[[Wiki]]',
			'https://example.com',
		].join('\n');
		const { app, created } = makeApp({}, new Set());
		await createMemoNote(app, opts({ card: fullCard }));
		assert.equal(created[0]!.content,
			`---\n"创建时间": "2026-09-22 14:30"\n"type": "memo"\n---\n${expectedBody}\n`,
			'full card text survives into the note');
	}

	// 3. Custom template: substitution, fm merge with props winning the type
	//    collision, card text appended after a blank line; .md fallback.
	const tpl = '---\ncustom: x\ntype: wrong\n---\n\n# {{title}}\n{{date:YYYY-MM-DD}}';
	{
		const { app, created, mkdirs } = makeApp({ 'Templates/memo.md': tpl }, new Set());
		await createMemoNote(app, opts({
			folder: 'Memos',
			templatePath: 'Templates/memo.md',
			card: makeCard({ body: simpleCardText }),
		}));
		assert.deepEqual(mkdirs, ['Memos']);
		assert.equal(created[0]!.content, [
			'---',
			'"创建时间": "2026-09-22 14:30"',
			'"type": "memo"',
			'custom: x',
			'---',
			'# 买菜',
			'2026-09-22',
			'',
			simpleCardText,
			'',
		].join('\n'), 'template applied, props win the type collision, card text appended');
	}
	{
		const { app, created } = makeApp({ 'Templates/memo.md': tpl }, new Set());
		await createMemoNote(app, opts({
			templatePath: 'Templates/memo',
			card: makeCard({ body: simpleCardText }),
		}));
		assert.ok(created[0]!.path.endsWith('.md') && created.length === 1, 'extension-less template path resolves');
	}

	// 4. Missing template: fall back to the default content, still create.
	{
		const { app, created } = makeApp({}, new Set());
		const res = await createMemoNote(app, opts({
			templatePath: 'nope.md',
			card: makeCard({ body: simpleCardText }),
		}));
		assert.equal(res.templateMissing, true, 'missing template reported');
		assert.equal(created[0]!.content,
			`---\n"创建时间": "2026-09-22 14:30"\n"type": "memo"\n---\n${simpleCardText}\n`,
			'fallback content identical to the default template');
	}

	// 5. Collision: existing path gets the -2 suffix.
	{
		const { app, created } = makeApp({}, new Set(['Memos/买菜-20260922-143005.md']));
		const res = await createMemoNote(app, opts({ card: makeCard({ body: 'x' }) }));
		assert.equal(res.path, 'Memos/买菜-20260922-143005-2.md', 'collision suffix applied');
	}

	// 6. Empty folder: vault root, no mkdir.
	{
		const { app, created, mkdirs } = makeApp({}, new Set());
		const res = await createMemoNote(app, opts({ folder: ' ', card: makeCard({ body: 'x' }) }));
		assert.equal(res.path, '买菜-20260922-143005.md', 'created at the vault root');
		assert.ok(!res.path.includes('/'), 'no folder segment');
		assert.deepEqual(mkdirs, [], 'no folder created');
		assert.equal(created.length, 1);
	}

	// 7. Untitled card: filename falls back to the caller's label.
	{
		const { app, created } = makeApp({}, new Set());
		await createMemoNote(app, opts({ card: makeCard({ title: '', body: 'x' }), untitled: '未命名' }));
		assert.equal(created[0]!.path, 'Memos/未命名-20260922-143005.md', 'untitled label in the filename');
	}

	console.log('memo note template: ALL PASS');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
