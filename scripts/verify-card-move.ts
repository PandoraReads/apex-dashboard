import { SyncEngine } from '../src/sync';
import { TFile, type App } from 'obsidian';
import type { DashboardSettings } from '../src/types';
import { strict as assert } from 'node:assert';
import { parse, serialize, extractCardParts } from '../src/parser';
import { moveDashboardCard, memoCardText } from '../src/card-move';

const initial = parse(`---
columns:
  - name: 记录
    type: memo
  - name: 清单
    type: todo
  - name: 便签
    type: sticky
---
## 记录
### 想法
id: memo-1
color: aabbcc
第一条想法
第二条 [[笔记]]
## 清单
### 事项
id: todo-1
type: task
- [x] 完成事项
    - [ ] 子任务 ⏰ 2026-09-15 09:00
## 便签
`);
// Legacy memo/todo section types migrate to sticky at parse time.
for (const name of ['记录', '清单', '便签']) {
	assert.equal(initial.columns.find(c => c.name === name)?.sectionType, 'sticky', `${name} migrates to sticky`);
}
const snapshot = serialize(initial);
assert.match(snapshot, /type: sticky/, 'serialize persists the migrated form');
assert.equal(serialize(parse(snapshot)), snapshot, 'migration round trip is stable');

const find = (data: typeof initial, id: string) => data.columns.flatMap(c => c.cards).find(c => c.id === id)!;
for (const id of ['memo-1', 'todo-1']) {
	const moved = moveDashboardCard(initial, id, '便签', 0);
	assert.equal(find(moved, id).type, id === 'memo-1' ? 'generic' : 'task', 'flavor kept when moving into sticky');
	assert.equal(find(moved, id).column, '便签');
	assert.equal(moved.columns.flatMap(c => c.cards).filter(c => c.id === id).length, 1);
	assert.equal(find(parse(serialize(moved)), id).type, find(moved, id).type);
}
// Migrated memo/todo columns are sticky now: card flavor (and task trees)
// survive sticky-to-sticky moves instead of being coerced.
const toMemoCol = moveDashboardCard(initial, 'todo-1', '记录', 0);
assert.equal(find(toMemoCol, 'todo-1').type, 'task');
assert.equal(find(toMemoCol, 'todo-1').tasks[0]?.checked, true);
assert.equal(find(toMemoCol, 'todo-1').tasks[0]?.children?.[0]?.reminder, '2026-09-15 09:00');
const restoredTask = parse(serialize(toMemoCol));
assert.equal(find(restoredTask, 'todo-1').type, 'task');
assert.equal(find(restoredTask, 'todo-1').tasks[0]?.children?.[0]?.reminder, '2026-09-15 09:00');
const toTodoCol = moveDashboardCard(initial, 'memo-1', '清单', 0);
assert.equal(find(toTodoCol, 'memo-1').type, 'generic');
assert.equal(find(toTodoCol, 'memo-1').color, '#aabbcc');
assert.match(memoCardText(find(toTodoCol, 'memo-1')), /\[\[笔记\]\]/);
// Pin-to-top is a same-column move to index 0.
const pinned = moveDashboardCard(initial, 'todo-1', '清单', 0);
assert.equal(pinned.columns.find(c => c.name === '清单')?.cards[0]?.id, 'todo-1');
assert.equal(moveDashboardCard(initial, 'memo-1', '不存在', 0), initial);
assert.equal(moveDashboardCard(initial, 'missing', '便签', 0), initial);
assert.equal(moveDashboardCard(initial, 'memo-1', '便签', NaN), initial);
assert.equal(serialize(initial), snapshot, 'input is not mutated');
const nested = extractCardParts('- [ ] A\n    - [ ] B\n        - [x] C\n    - [ ] D');
assert.equal(nested.tasks[0]?.children?.[0]?.children?.[0]?.text, 'C');
assert.equal(nested.tasks[0]?.children?.[1]?.text, 'D');
for (const showCover of [true, false]) {
	const noteData = { ...initial, columns: [...initial.columns, {
		name: '笔记区', sectionType: 'projects', color: '#fff', ...(showCover ? {} : { showCover: false }), cards: [{ ...find(initial, 'memo-1'),
			id: 'note-1', column: '笔记区', type: 'project' as const, wikiLink: '原笔记', coverImage: 'cover.png',
			docs: [{ path: '附件', children: [{ path: '附件子项' }] }],
		}],
	}] };
	const stickyNote = moveDashboardCard(noteData, 'note-1', '便签', 0);
	const persisted = find(parse(serialize(stickyNote)), 'note-1');
	assert.equal(persisted.type, 'project');
	assert.equal(persisted.noteStyle, showCover ? 'cover' : 'plain');
	assert.equal(persisted.coverImage, 'cover.png');
	assert.equal(persisted.wikiLink, '原笔记');
	// Into migrated (sticky) columns the project card keeps its flavor + docs.
	const movedNote = find(parse(serialize(moveDashboardCard(noteData, 'note-1', '记录', 0))), 'note-1');
	assert.equal(movedNote.type, 'project');
	assert.equal(movedNote.docs[0]?.children?.[0]?.path, '附件子项');
}
process.stdout.write('verify-card-move: note appearance and linked documents OK\n');
process.stdout.write('verify-card-move: migration, flavor retention, pin move and persistence OK\n');

async function verifySync(): Promise<void> {
	let disk = snapshot;
	let writes = 0;
	const file = Object.assign(new TFile(), { path: 'test-board.md', basename: 'test-board' });
	const app = { vault: {
		getFileByPath: () => file,
		read: async () => disk,
		modify: async (_file: unknown, text: string) => { disk = text; writes += 1; },
		on: () => ({}), offref: () => {},
		adapter: { exists: async () => true, write: async () => {}, list: async () => ({ files: [] }) },
	} } as unknown as App;
	const sync = new SyncEngine(app, { dashboardFile: 'test-board' } as DashboardSettings);
	await sync.init();
	await sync.moveCard('todo-1', '记录', 0);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(find(parse(disk), 'todo-1').type, 'task', 'flavor survives sticky-to-sticky sync write');
	assert.equal(parse(disk).columns.find(c => c.name === '记录')?.sectionType, 'sticky');
	assert.equal(parse(disk).columns.find(c => c.name === '清单')?.cards.length, 0);
	const parts = extractCardParts(memoCardText(find(sync.getData()!, 'todo-1')).replace('完成事项', '已修改事项'));
	await sync.updateMemoCard('todo-1', { body: parts.cleanBody, blockquote: parts.blockquote, tasks: parts.tasks, docs: parts.docs });
	await sync.moveCard('todo-1', '清单', 0);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(find(parse(disk), 'todo-1').tasks[0]?.text, '已修改事项');
	assert.equal(find(parse(disk), 'todo-1').tasks[0]?.checked, true);
	const before = writes;
	await sync.moveCard('todo-1', '不存在', 0);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(writes, before);
	sync.destroy();
	process.stdout.write('verify-card-move: sync write, edit and reload integration OK\n');
}
void verifySync().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
