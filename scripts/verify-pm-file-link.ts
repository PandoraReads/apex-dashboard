/**
 * Verifies the PM board modal's "Project files" linked-file unlink: clicking
 * the unlink button on one linked file removes exactly that path from the
 * note's frontmatter `files` list (the others survive), and the re-render
 * reflects the shortened list.
 *
 * Run: `npm run test:pm-file-link`
 */
import { strict as assert } from 'node:assert';
import { El, findByClass } from './mini-dom';
import { PmBoardModal } from '../src/pm-board-modal';
import { parseNoteFrontmatter, pmLinkedFiles } from '../src/pm-model';

const stubBody = new El('body');
(globalThis as unknown as Record<string, unknown>).activeDocument = {
	querySelector: () => null,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => true,
	body: stubBody,
};

// The note's on-disk content — its YAML frontmatter IS the `files` state.
let content = [
	'---',
	'type: project',
	'stage: 执行中',
	'files:',
	'  - 项目/a.md',
	'  - 项目/b.md',
	'  - 项目/c.md',
	'---',
	'## 里程碑',
	'- [ ] m1',
	'## 待办',
	'- [ ] t1',
	'',
].join('\n');

const file = { path: '项目/A官网.md', basename: 'A官网', stat: { mtime: 1, ctime: 1 } };

const app = {
	vault: {
		read: async (): Promise<string> => content,
		modify: async (_f: unknown, next: string): Promise<void> => { content = next; },
		getFiles: (): Array<{ path: string }> => [],
		getFileByPath: (p: string): { path: string; basename: string } | null =>
			['项目/a.md', '项目/b.md', '项目/c.md'].includes(p)
				? { path: p, basename: p.split('/').pop() ?? p }
				: null,
	},
	metadataCache: {
		getFileCache: (): { frontmatter: Record<string, unknown> } => ({ frontmatter: parseNoteFrontmatter(content) }),
	},
	fileManager: {
		processFrontMatter: async (
			_f: unknown,
			fn: (fm: Record<string, unknown>) => void,
		): Promise<void> => {
			const fm = parseNoteFrontmatter(content);
			fn(fm);
			const files = pmLinkedFiles(fm);
			const lines = content.split('\n');
			// Rebuild the frontmatter block with the (possibly emptied) files.
			const start = lines.indexOf('---');
			const end = lines.indexOf('---', start + 1);
			const head = ['---', 'type: project', 'stage: 执行中'];
			if (files.length > 0) {
				head.push('files:');
				for (const p of files) head.push(`  - ${p}`);
			}
			content = [...head, '---', ...lines.slice(end + 1)].join('\n');
		},
	},
};

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

async function main(): Promise<void> {
	const modal = new PmBoardModal(app as never, file as never, { rootFolder: '项目', stages: [{ label: '执行中' }] } as never);
	modal.open();
	(modal as unknown as { onOpen(): void }).onOpen();
	await flush();

	const board = modal.contentEl as unknown as El;
	const linkedRows = findByClass(board, 'dashboard-pmsec-file--linked');
	assert.equal(linkedRows.length, 3, 'three linked files rendered');

	// Unlink the FIRST linked file.
	findByClass(linkedRows[0]!, 'dashboard-pmsec-file-unlink')[0]!.click();
	await flush();
	await flush();

	assert.deepEqual(pmLinkedFiles(parseNoteFrontmatter(content)), ['项目/b.md', '项目/c.md'], 'only the clicked path is removed');

	// The re-render reflects the shortened list.
	const after = findByClass(modal.contentEl as unknown as El, 'dashboard-pmsec-file--linked');
	assert.deepEqual(
		after.map(row => findByClass(row, 'dashboard-pmsec-file-name')[0]!.textContent),
		['b.md', 'c.md'],
		'board re-renders with the remaining two links',
	);

	console.log('verify-pm-file-link: only the clicked path removed');
}

void main().catch(err => {
	console.error(err);
	process.exit(1);
});
