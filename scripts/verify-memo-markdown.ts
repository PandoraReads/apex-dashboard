import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { Component } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { memoMarkdownSource, renderMemoMarkdown, renderSection } from '../src/renderer';
import type { DashboardCard, DashboardColumn, RenderCallbacks } from '../src/types';

// Memo card markdown rendering (memo + sticky sections): the textarea stays
// plain text; the view paint runs Obsidian's MarkdownRenderer over an adapted
// source — every plain line its own paragraph (existing line-per-line memos
// keep their look), consecutive list lines grouped, code fences untouched.
// The plain paint stands in synchronously and remains on render failure.

// Obsidian globals absent in Node (see verify-card-new-note for the idiom).
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
};
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};

const makeApp = (): App => ({
	vault: {
		getFileByPath: () => null,
		getMarkdownFiles: () => [],
	},
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App);

const makeCard = (over: Partial<DashboardCard> = {}): DashboardCard =>
	({
		id: 'c1',
		type: 'generic',
		column: 'memo',
		title: '卡片',
		body: '',
		tasks: [],
		docs: [],
		url: '',
		wikiLink: '',
		progress: 0,
		streak: 0,
		dueDate: '',
		blockquote: '',
		color: '',
		coverImage: '',
		width: 0,
		size: 'M',
		gridCols: 0,
		gridRows: 0,
		gridCol: 0,
		gridRow: 0,
		...over,
	} as unknown as DashboardCard);

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 10));

async function main(): Promise<void> {
	const app = makeApp();
	const callbacks = {} as unknown as RenderCallbacks;

	// 1. memoMarkdownSource: plain lines become their own paragraphs (no
	//    soft-wrap merge); `**bold**` is NOT a list item.
	{
		assert.equal(memoMarkdownSource('单行'), '单行', '1: single line passes through');
		const src = memoMarkdownSource('第一行\n**加粗**\n普通');
		assert.equal(
			src,
			'第一行\n\n**加粗**\n\n普通',
			'1: consecutive plain lines separated into paragraphs',
		);
	}

	// 2. List lines stay grouped (real lists render); indented continuations
	//    ride along; blank runs collapse.
	{
		assert.equal(
			memoMarkdownSource('- a\n- b\n  续行\n后续'),
			'- a\n- b\n  续行\n\n后续',
			'2: list + continuation grouped, trailing paragraph separate',
		);
		assert.equal(
			memoMarkdownSource('1. one\n2. two\n尾行\n\n\n再一段'),
			'1. one\n2. two\n\n尾行\n\n再一段',
			'2: ordered lists grouped, blank runs collapsed',
		);
	}

	// 3. Code-fence interiors pass through untouched.
	{
		const fenced = '前言\n```js\nconst a = 1;\nconst b = 2;\n```\n后记';
		const src = memoMarkdownSource(fenced);
		assert.ok(src.includes('const a = 1;\nconst b = 2;'), '3: fence interior keeps its line breaks');
		assert.ok(src.includes('```js'), '3: fences preserved');
	}

	// 4. Memo + sticky sections paint the plain lines synchronously (no
	//    component threaded through renderSection) — the legacy look is the
	//    fallback, and a failed markdown pass leaves it standing. mini-dom's
	//    appendText lands in the own-text slot (shadowed by element children),
	//    so read that slot directly.
	{
		for (const sectionType of ['memo', 'sticky'] as const) {
			const column = { id: 'col1', name: sectionType, sectionType, cards: [makeCard({ body: '一行\n两行' })] } as unknown as DashboardColumn;
			const section = renderSection(column, callbacks, app) as unknown as El;
			const view = findByClass(section, 'dashboard-memo-view')[0]!;
			assert.ok(view, `4: memo view rendered (${sectionType})`);
			assert.ok(!view.hasClass('dashboard-memo-view--md'), `4: no markdown class without a component (${sectionType})`);
			const ownText = (view as unknown as { text: string }).text;
			assert.ok(ownText.includes('一行') && ownText.includes('两行'), `4: plain paint shows the text (${sectionType})`);
		}
	}

	// 5. renderMemoMarkdown swaps the paint and hands the renderer the adapted
	//    source (the stub echoes it back). The view must be connected — the
	//    swap guard discards renders into detached containers.
	{
		const bodyRoot = new El('body');
		const view = new El('div');
		bodyRoot.appendChild(view);
		view.textContent = '旧内容';
		const promise = renderMemoMarkdown(view as unknown as HTMLElement, '行一\n行二', app, new Component());
		await promise;
		await flush();
		assert.ok(view.hasClass('dashboard-memo-view--md'), '5: markdown class applied on success');
		assert.equal(view.textContent, '[md]行一\n\n行二', '5: renderer received the paragraph-adapted source');
		assert.ok(!view.textContent.includes('旧内容'), '5: plain paint replaced');
	}

	console.log('verify-memo-markdown: all 5 checks passed');
}

void main();
