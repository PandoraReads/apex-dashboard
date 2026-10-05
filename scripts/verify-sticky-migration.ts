/**
 * Verifies the retirement of the standalone memo (备忘录) and todo (待办清单)
 * section types into sticky ("便利贴"), mirroring verify-notes-cover for the
 * earlier notes→projects fold:
 *
 * 1. Parse-time migration: `type: memo` / `type: todo` columns (explicit
 *    frontmatter, heading-name fallback, and card-composition heuristics)
 *    become sticky; cards keep their flavor and content byte-for-byte; height
 *    and pairing survive. Serialize persists `type: sticky` and never writes
 *    the retired types; the round trip is stable.
 * 2. Rendering: a parsed legacy memo column paints generic cards as memo
 *    cards and task cards as todo cards through the whole pipeline.
 * 3. Fresh dashboards (generateDefaultMarkdown): a single sticky demo column
 *    carrying both card flavors; no memo/todo columns anywhere.
 * 4. AddSectionModal no longer offers memo or todo.
 *
 * Run: `npm run test:sticky-migration`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { parse, serialize, generateDefaultMarkdown } from '../src/parser';
import { renderSection } from '../src/renderer';
import { SECTION_TYPE_OPTIONS } from '../src/add-section-modal';
import type { DashboardColumn, RenderCallbacks } from '../src/types';

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
// Document-level createEl (reminder buttons and other task-item markup render
// through the Obsidian global, not a parent element): build via the mini-dom
// factory, then detach so callers own the node.
{
	const scratch = new El('div');
	(globalThis as Record<string, unknown>).createEl = (tag: string, o?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): El => {
		const el = scratch.createEl(tag, o);
		scratch.removeChild(el);
		return el;
	};
}

const app = {
	vault: { getFileByPath: () => null, getMarkdownFiles: () => [] },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
} as unknown as App;
const callbacks = {} as unknown as RenderCallbacks;

// 1. Migration: explicit types, name fallback, and heuristics all land on
//    sticky with cards untouched; layout fields survive; disk never keeps the
//    retired types.
{
	const legacy = `---
columns:
  - name: 备忘录
    color: "#f59e0b"
    type: memo
    height: 320
  - name: 待办清单
    color: "#6366f1"
    type: todo
  - name: Memo
  - name: Todo
---
## 备忘录
### 想法
id: m1
type: generic
第一条想法
第二条 [[笔记]]
## 待办清单
### 事项
id: t1
type: task
- [x] 完成事项
    - [ ] 子任务 ⏰ 2026-09-15 09:00
## Memo
### 草稿
id: m2
type: generic
随手记
## Todo
### 琐事
id: t2
type: task
- [ ] 浇花
`;
	const data = parse(legacy);
	const byName = (name: string): DashboardColumn => data.columns.find(c => c.name === name)!;
	for (const name of ['备忘录', '待办清单', 'Memo', 'Todo']) {
		assert.equal(byName(name).sectionType, 'sticky', `1: ${name} migrates to sticky`);
	}
	assert.equal(byName('备忘录').height, 320, '1: dragged height survives migration');
	const card = (id: string) => data.columns.flatMap(c => c.cards).find(c => c.id === id)!;
	assert.equal(card('m1').type, 'generic', '1: memo card keeps its flavor');
	assert.equal(card('m1').body, '第一条想法\n第二条 [[笔记]]', '1: memo card body untouched');
	assert.equal(card('t1').type, 'task', '1: todo card keeps its flavor');
	assert.equal(card('t1').tasks[0]?.checked, true, '1: task tree untouched');
	assert.equal(card('t1').tasks[0]?.children?.[0]?.reminder, '2026-09-15 09:00', '1: reminder untouched');
	assert.equal(card('m2').type, 'generic');
	assert.equal(card('t2').type, 'task');

	const out = serialize(data);
	assert.doesNotMatch(out, /type: (memo|todo)\b/, '1: serialize never writes the retired types');
	assert.match(out, /type: sticky/, '1: serialize writes the migrated form');
	assert.equal(serialize(parse(out)), out, '1: migration round trip is stable');
}

// 1b. Card-composition heuristics: task-only and generic-only sections
//     without any explicit type resolve to sticky too; the dashboard-widget
//     heuristic still stands.
{
	const data = parse(`---
columns: []
---
## 纯待办
### 事项
id: a1
type: task
- [ ] 事项
## 纯备忘
### 想法
id: b1
type: generic
想法
## 仪表
### 天气
id: w1
type: weather
`);
	const byName = (name: string) => data.columns.find(c => c.name === name)!;
	assert.equal(byName('纯待办').sectionType, 'sticky', '1b: task-only heuristic → sticky');
	assert.equal(byName('纯备忘').sectionType, 'sticky', '1b: generic-only heuristic → sticky');
	assert.equal(byName('仪表').sectionType, 'dashboard', '1b: widget heuristic untouched');
}

// 2. Rendering: the parse→render bridge paints migrated columns exactly like
//    a native sticky section — generic cards as memo, task cards as todo.
{
	const parsed = parse(`---
columns:
  - name: 备忘录
    type: memo
  - name: 待办清单
    type: todo
---
## 备忘录
### 想法
id: m1
type: generic
正文一行
## 待办清单
### 事项
id: t1
type: task
- [ ] 完成事项
`);
	const memoSection = renderSection(parsed.columns[0]!, callbacks, app) as unknown as El;
	assert.equal(memoSection.getAttribute('data-section-type'), 'sticky', '2: migrated memo section renders as sticky');
	assert.ok(findByClass(memoSection, 'dashboard-memo-view').length > 0, '2: generic card paints as memo');
	const todoSection = renderSection(parsed.columns[1]!, callbacks, app) as unknown as El;
	assert.equal(todoSection.getAttribute('data-section-type'), 'sticky', '2: migrated todo section renders as sticky');
	assert.ok(findByClass(todoSection, 'dashboard-task-list').length > 0, '2: task card paints as todo');
}

// 3. Fresh dashboards: one sticky demo column with both flavors.
{
	const fresh = parse(generateDefaultMarkdown());
	assert.ok(fresh.columns.length > 0, '3: demo board has columns');
	const stickyColumns = fresh.columns.filter(c => c.sectionType === 'sticky');
	assert.equal(stickyColumns.length, 1, '3: exactly one sticky demo column');
	const flavors = new Set(stickyColumns[0]!.cards.map(c => c.type));
	assert.ok(flavors.has('generic'), '3: demo column carries memo cards');
	assert.ok(flavors.has('task'), '3: demo column carries todo cards');
	assert.ok(fresh.columns.every(c => c.sectionType !== 'memo' && c.sectionType !== 'todo'), '3: no retired types in demo board');
	assert.equal(serialize(parse(serialize(fresh))), serialize(fresh), '3: demo board round trip is stable');
}

// 4. The add-section picker no longer offers the retired types.
{
	assert.ok(!SECTION_TYPE_OPTIONS.some(o => o.value === 'memo' || o.value === 'todo'), '4: picker has no memo/todo option');
	assert.ok(SECTION_TYPE_OPTIONS.some(o => o.value === 'sticky'), '4: picker still offers sticky');
}

console.log('verify-sticky-migration: parse migration, rendering, demo defaults and picker checks passed');
