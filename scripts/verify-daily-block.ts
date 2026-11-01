/**
 * Verifies "save tasks to daily note" MERGE semantics:
 *
 * 1. Merge, not overwrite: entries present in BOTH the note block and the
 *    card are UPDATED in place (text / checked / reminder); entries only in
 *    the card are APPENDED; task lines only in the note are LEFT UNTOUCHED
 *    (the reported bug: repeated saves stacked duplicate blocks; the naive
 *    fix — whole-block replace — would have wiped hand-added lines).
 * 2. Section bounds: a same-or-higher heading (## / ###) ends the block;
 *    deeper headings (####) and prose stay inside it and survive a merge.
 * 3. A heading that is absent leaves the note untouched (replaced: false) so
 *    the caller falls back to prepend-after-frontmatter.
 * 4. Idempotence: merging twice yields byte-identical content and exactly
 *    one heading occurrence.
 * 5. Frontmatter above the block survives; CRLF notes keep their line
 *    endings; regex-special characters in the title are matched literally.
 * 6. view.ts wires the save path through mergeDailyTasksBlock.
 *
 * Run: `npm run test:daily-block`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dailyBlockHeading, mergeDailyTasksBlock, countDailyBlock } from '../src/daily-note-block';
import type { TaskItem } from '../src/types';

const task = (text: string, checked = false, reminder?: string, children?: TaskItem[]): TaskItem =>
	({ text, checked, reminder, children });

function run(): void {
	const heading = dailyBlockHeading('购物清单');

	// 1. Update / append / leave-alone in one pass.
	const note1 = [
		'---',
		'tags: daily',
		'---',
		'',
		'### 购物清单',
		'- [ ] 牛奶', // matches card, unchecked → becomes [x]
		'- [x] 旧任务（已从卡片删除）', // note-only → untouched
		'手写备注，别动我', // prose → untouched
		'- [ ] 面包 ⏰ 2026-11-02 09:00', // matches card with reminder → reminder dropped
		'',
		'## 下午',
		'写代码',
	].join('\n');
	const card1: TaskItem[] = [
		task('牛奶', true),
		task('面包'),
		task('新任务', false, undefined, [task('子任务')]),
	];
	const r1 = mergeDailyTasksBlock(note1, heading, card1);
	assert.ok(r1.replaced, '1: block merged');
	assert.equal(r1.updated, 2, '1: two entries updated');
	assert.equal(r1.appended, 2, '1: two entries appended');
	assert.ok(r1.content.includes('- [x] 牛奶'), '1: 牛奶 checked-state updated');
	assert.ok(r1.content.includes('- [x] 旧任务（已从卡片删除）'), '1: note-only entry kept');
	assert.ok(r1.content.includes('手写备注，别动我'), '1: prose kept');
	assert.ok(r1.content.includes('- [ ] 面包'), '1: 面包 state kept');
	assert.ok(!r1.content.includes('⏰ 2026-11-02'), '1: stale reminder removed');
	assert.ok(r1.content.includes('- [ ] 新任务'), '1: new task appended');
	assert.ok(/- \[ \] 新任务\n {4}- \[ \] 子任务/.test(r1.content), '1: new subtask appended nested');
	assert.equal(countDailyBlock(r1.content, heading), 1, '1: exactly one heading');
	assert.ok(r1.content.includes('## 下午\n写代码'), '1: following section intact');
	assert.ok(r1.content.startsWith('---\ntags: daily\n---\n\n### 购物清单'), '1: frontmatter + placement intact');
	const r1again = mergeDailyTasksBlock(r1.content, heading, card1);
	assert.equal(r1again.content, r1.content, '1: re-save is byte-identical (no blank-line drift)');

	// 1b. Hand-checked note line is re-synced to the card's unchecked state.
	const note1b = '### T\n- [x] a\n## Next\nkeep';
	const r1b = mergeDailyTasksBlock(note1b, '### T', [task('a')]);
	assert.ok(r1b.content.includes('- [ ] a'), '1b: card state wins over note state');

	// 2a. A `##` heading ends the merged section…
	const note2a = '### T\n- [ ] a\n## Next\nkeep';
	const r2a = mergeDailyTasksBlock(note2a, '### T', [task('b')]);
	assert.ok(r2a.content.endsWith('## Next\nkeep'), '2a: next heading onward untouched');
	assert.ok(r2a.content.includes('- [ ] a'), '2a: note task before next heading kept');

	// 2b. …but a deeper `####` heading stays INSIDE the block (its tasks merge).
	const note2b = '### T\n#### 买菜\n- [ ] 葱\n## Next\nkeep';
	const r2b = mergeDailyTasksBlock(note2b, '### T', [task('肉')]);
	assert.ok(r2b.content.includes('#### 买菜'), '2b: deeper heading survives');
	assert.ok(r2b.content.includes('- [ ] 葱'), '2b: task under deeper heading untouched');
	assert.ok(r2b.content.includes('- [ ] 肉'), '2b: new task appended');
	assert.ok(r2b.content.includes('## Next\nkeep'), '2b: next heading onward untouched');

	// 3. Absent heading → unchanged, caller prepends instead.
	const note3 = '## 今日\n- [ ] 其他';
	const r3 = mergeDailyTasksBlock(note3, heading, card1);
	assert.ok(!r3.replaced, '3: absent heading reports replaced:false');
	assert.equal(r3.content, note3, '3: note untouched when heading absent');
	assert.deepEqual([r3.updated, r3.appended], [0, 0], '3: counters zeroed');

	// 4. Idempotence: merge twice == merge once.
	const fresh = '---\nfm: 1\n---\n\nintro line';
	const first = mergeDailyTasksBlock(fresh, heading, card1);
	assert.ok(!first.replaced, '4: first save falls back to prepend');
	const firstSave = `${fresh}\n\n${heading}\n- [x] 牛奶\n- [ ] 面包\n- [ ] 新任务\n    - [ ] 子任务\n`;
	const second = mergeDailyTasksBlock(firstSave, heading, card1);
	assert.ok(second.replaced, '4: second save takes the merge branch');
	assert.equal(second.content, firstSave, '4: second save is byte-identical (no growth, no dup)');
	assert.equal(countDailyBlock(second.content, heading), 1, '4: no duplicate blocks');
	assert.deepEqual([second.updated, second.appended], [4, 0], '4: all four entries just updated');

	// 5a. CRLF line endings survive a merge.
	const note5a = '### T\r\n- [ ] a\r\n\r\n## Next\r\nkeep';
	const r5a = mergeDailyTasksBlock(note5a, '### T', [task('b')]);
	assert.ok(r5a.replaced && r5a.content.includes('\r\n') && !r5a.content.includes('\n###'), '5a: CRLF preserved');

	// 5b. Regex-special characters in the title match literally.
	const tricky = dailyBlockHeading('A.B (v2) [x] $^');
	const note5b = `intro\n${tricky}\n- [ ] old\n\n## 之后`;
	const r5b = mergeDailyTasksBlock(note5b, tricky, [task('old', true)]);
	assert.ok(r5b.replaced && r5b.content.includes('- [x] old'), '5b: special chars matched literally');

	// 5c. Duplicate blocks left by the OLD always-prepend save are collapsed:
	// first copy merges, every later same-heading copy is removed.
	const note5c = [
		'### 备忘录',
		'- [ ] 旧1',
		'',
		'### 备忘录',
		'- [ ] 旧2',
		'',
		'### 备忘录',
		'- [ ] 旧3',
		'',
		'## 其他',
		'正文',
	].join('\n');
	const r5c = mergeDailyTasksBlock(note5c, '### 备忘录', [task('旧1', true), task('新任务')]);
	assert.equal(countDailyBlock(r5c.content, '### 备忘录'), 1, '5c: duplicates collapsed to one block');
	assert.ok(r5c.content.includes('- [x] 旧1'), '5c: first copy merged');
	assert.ok(!r5c.content.includes('旧2') && !r5c.content.includes('旧3'), '5c: duplicate copies removed');
	assert.ok(r5c.content.includes('- [ ] 新任务'), '5c: new entry appended to surviving block');
	assert.ok(r5c.content.includes('## 其他\n正文'), '5c: other sections intact');
	const r5c2 = mergeDailyTasksBlock(r5c.content, '### 备忘录', [task('旧1', true), task('新任务')]);
	assert.equal(r5c2.content, r5c.content, '5c: healed note is stable on re-save');

	// 5d. A DIFFERENT card's duplicate blocks are not touched by this save.
	const note5d = '### A\n- [ ] x\n\n### B\n- [ ] y\n\n### B\n- [ ] y2';
	const r5d = mergeDailyTasksBlock(note5d, '### A', [task('x', true)]);
	assert.ok(r5d.content.includes('### B\n- [ ] y\n\n### B\n- [ ] y2'), '5d: other heading\'s duplicates untouched');

	// 6. view.ts wires saveTasksToDaily through the merge-then-prepend flow.
	const view = readFileSync('src/view.ts', 'utf8');
	assert.ok(view.includes('mergeDailyTasksBlock(raw, heading, card.tasks)'), '6: merge branch wired');
	assert.ok(view.includes("import { dailyBlockHeading, mergeDailyTasksBlock } from './daily-note-block'"), '6: helper imported');
	assert.ok(!view.includes('replaceDailyBlock'), '6: whole-block replace fully retired');

	console.log('verify-daily-block: all checks passed');
}

run();
