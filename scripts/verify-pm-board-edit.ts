/**
 * Verifies the PM board modal's checklist editing interactions (DOM level):
 *
 * 1. Double-click a task label → inline editor opens (Enter commits through
 *    renameProjectTask: checkbox state and [due::] markers preserved;
 *    Escape restores without writing).
 * 2. Grip drag (guarded pointer drag): rows live-reorder under the shield;
 *    release commits the DOM order through reorderProjectTasks; a press
 *    without moves writes nothing.
 *
 * Run: `npm run test:pm-board-edit`
 */
import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { PmBoardModal } from '../src/pm-board-modal';

// Obsidian globals absent in Node — the guarded drag mounts its shield on
// activeDocument.body (table-columns harness idiom).
const stubBody = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => true,
	body: stubBody,
};

// Line map (assertions key off these): 5/6/7 milestones, 9/10 todos.
const CONTENT = [
	'---',
	'type: project',
	'stage: 执行中',
	'---',
	'## 里程碑',
	'- [x] 需求确认',
	'- [ ] 初稿',
	'- [ ] 终稿',
	'## 待办',
	'- [ ] 发素材 [due:: 2026-10-20]',
	'- [ ] 联系客户',
	'',
].join('\n');

const file = { path: '项目/A官网.md', basename: 'A官网', stat: { mtime: 1, ctime: 1 } };
let content = CONTENT;
const app = {
	vault: {
		read: async (): Promise<string> => content,
		modify: async (_f: unknown, next: string): Promise<void> => { content = next; },
		getFiles: (): Array<{ path: string }> => [],
	},
	metadataCache: {
		getFileCache: (): { frontmatter: Record<string, unknown> } => ({ frontmatter: { type: 'project', stage: '执行中' } }),
	},
	fileManager: {},
};

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

async function main(): Promise<void> {
	const modal = new PmBoardModal(app as never, file as never, { rootFolder: '项目', stages: [{ label: '执行中' }] } as never);
	// The stub's open() records but does not fire onOpen — drive the render.
	modal.open();
	(modal as unknown as { onOpen(): void }).onOpen();
	await flush();

	// PmBoardModal types against the real obsidian API; the bundle alias swaps
	// in the stub at run time, so the DOM nodes are mini-dom Els.
	const board = modal.contentEl as unknown as El;
	const milestoneSec = (): El => findByClass(board, 'dashboard-pmsec-section--milestone')[0] ?? assert.fail('milestone section rendered');
	const todoSec = (): El => findByClass(board, 'dashboard-pmsec-section--todo')[0] ?? assert.fail('todo section rendered');

	// --- 1. Structure: grip per row, line keys on the items. ---
	{
		const items = findByClass(milestoneSec(), 'dashboard-pmsec-check-item');
		assert.deepEqual(items.map(item => item.dataset.taskLine), ['5', '6', '7'], 'line keys ride the rows');
		assert.equal(findByClass(milestoneSec(), 'dashboard-pmsec-check-grip').length, 3, 'one grip per milestone');
		assert.equal(findByClass(todoSec(), 'dashboard-pmsec-check-grip').length, 2, 'one grip per todo');
	}

	// --- 2. Double-click edit: Enter commits, checkbox + due marker preserved. ---
	{
		const label = findByClass(findByClass(todoSec(), 'dashboard-pmsec-check-item')[0]!, 'dashboard-pmsec-check-text')[0]!;
		label.dispatchEvent({ type: 'dblclick', target: label });
		const input = findByClass(todoSec(), 'dashboard-pmsec-check-edit')[0] ?? assert.fail('inline editor opened on dblclick');
		input.value = '发设计稿';
		input.dispatchEvent({ type: 'keydown', target: input, key: 'Enter' });
		await flush();
		assert.ok(content.includes('- [ ] 发设计稿 [due:: 2026-10-20]'), 'rename keeps the due marker');
		assert.ok(content.includes('## 里程碑\n- [x] 需求确认'), 'milestone lines untouched by the todo rename');
		// Fresh render replaced the editor row.
		assert.equal(findByClass(todoSec(), 'dashboard-pmsec-check-edit').length, 0, 'editor gone after commit');
	}

	// Escape restores without writing.
	{
		const before = content;
		const item = findByClass(milestoneSec(), 'dashboard-pmsec-check-item')[1]!; // 初稿
		const label = findByClass(item, 'dashboard-pmsec-check-text')[0]!;
		label.dispatchEvent({ type: 'dblclick', target: label });
		const input = findByClass(milestoneSec(), 'dashboard-pmsec-check-edit')[0]!;
		input.value = '不应落盘';
		input.dispatchEvent({ type: 'keydown', target: input, key: 'Escape' });
		await flush();
		assert.equal(content, before, 'Escape writes nothing');
		assert.equal(findByClass(item, 'dashboard-pmsec-check-text')[0]!.textContent, '初稿', 'label restored');
	}

	// --- 3. Grip drag: 终稿 (line 7) dragged to the top of the milestones. ---
	{
		const sec = milestoneSec();
		const items = findByClass(sec, 'dashboard-pmsec-check-item');
		const grip = findByClass(items[2]!, 'dashboard-pmsec-check-grip')[0]!;
		grip.dispatchEvent({ type: 'pointerdown', target: grip, pointerId: 1, clientY: 100 });
		const shield = findByClass(stubBody, 'dashboard-drag-shield')[0] ?? assert.fail('guarded drag mounted its shield');
		// Stub rects are zero-height: a far-negative Y lands above every row.
		shield.dispatchEvent({ type: 'pointermove', target: shield, pointerId: 1, clientY: -999 });
		shield.dispatchEvent({ type: 'pointerup', target: shield, pointerId: 1, clientY: -999 });
		assert.equal(findByClass(stubBody, 'dashboard-drag-shield').length, 0, 'shield removed after release');
		await flush();
		assert.ok(content.includes('## 里程碑\n- [ ] 终稿\n- [x] 需求确认\n- [ ] 初稿\n## 待办'), 'dragged row committed first, checked state travels with the text');
		// The re-rendered list reflects the new order (line slots unchanged —
		// contents swapped).
		assert.deepEqual(
			findByClass(milestoneSec(), 'dashboard-pmsec-check-item').map(item => item.dataset.taskLine),
			['5', '6', '7'],
			'line slots unchanged (contents swapped)',
		);
	}

	// Press without movement: same order → no disk write.
	{
		const before = content;
		const grip = findByClass(findByClass(milestoneSec(), 'dashboard-pmsec-check-item')[0]!, 'dashboard-pmsec-check-grip')[0]!;
		grip.dispatchEvent({ type: 'pointerdown', target: grip, pointerId: 2, clientY: 100 });
		const shield = findByClass(stubBody, 'dashboard-drag-shield')[0]!;
		shield.dispatchEvent({ type: 'pointerup', target: shield, pointerId: 2, clientY: 100 });
		await flush();
		assert.equal(content, before, 'no-move drag writes nothing');
	}

	console.log('verify-pm-board-edit: all assertions passed');
}

void main().catch(err => {
	console.error(err);
	process.exit(1);
});
