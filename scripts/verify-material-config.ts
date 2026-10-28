/**
 * Material library settings modal (src/material-config-modal.ts): the drop-in
 * destination field Rae asked for.
 *
 * 1. A saved importFolder renders normalized ('./x/' → 'x').
 * 2. Typing a new path + saving emits it in the config payload alongside the
 *    untouched scan scope and skill buttons (a save() rewrite that drops the
 *    field is the regression this guards).
 * 3. Clearing the input saves '' (= Obsidian's attachment folder).
 * 4. The folder-picker button is wired (opens a picker modal).
 *
 * Run: `npm run test:material-config`
 */
import { strict as assert } from 'node:assert';
import { El, findByClass, findTag } from './mini-dom';
import { Modal } from 'obsidian';
import type { MaterialLibraryConfig } from '../src/types';
import { MaterialConfigModal } from '../src/material-config-modal';

(globalThis as Record<string, unknown>).createDiv = (o?: { cls?: string; text?: string }): El => {
	const el = new El('div');
	if (o?.cls) el.addClass(...o.cls.split(/\s+/));
	if (o?.text !== undefined) el.textContent = o.text;
	return el;
};
// applyModalTheme probes the document root for the dashboard theme scope.
(globalThis as { activeDocument?: unknown }).activeDocument = { querySelector: (): null => null };
(globalThis as { window?: unknown }).window = globalThis;

const stubApp = {
	vault: { getMarkdownFiles: (): unknown[] => [], getFiles: (): unknown[] => [] },
	metadataCache: { getFileCache: (): null => null },
	plugins: { plugins: {} },
};

const BASE: MaterialLibraryConfig = {
	includeFolders: ['素材'],
	excludeFolders: ['回收站'],
	importFolder: ' ./素材/收件箱/ ',
	archiveFolder: ' ./归档箱/ ',
	skillButtons: [{ id: 'mb_1', label: '配图', icon: '', agent: 'claudian', skillName: '', promptTemplate: '' }],
};

/** The single import-folder input: the only text input inside its own row that
 *  sits under the destination section (the chip rows have their own inputs). */
function importInputOf(root: El): El & { value: string } {
	const picker = findByClass(root, 'dashboard-pathpicker-btn')[0];
	assert.ok(picker, 'the destination row carries a folder-picker button');
	const row = picker!.parent as El;
	const input = findTag(row, 'input')[0] as unknown as El & { value: string };
	assert.ok(input, 'the destination row carries a text input');
	return input!;
}

function main(): void {
	const StubModal = Modal as unknown as { last: Modal | null };

	// 1. a saved destination renders normalized
	const saved: MaterialLibraryConfig[] = [];
	const modal = new MaterialConfigModal(stubApp as never, BASE, cfg => saved.push(cfg));
	modal.onOpen();
	const root = modal.contentEl as unknown as El;
	const input = importInputOf(root);
	assert.equal(input.value, '素材/收件箱', 'a stored destination renders normalized');

	// 4. the picker button opens a picker modal
	StubModal.last = null;
	(findByClass(root, 'dashboard-pathpicker-btn')[0] as unknown as El).click();
	assert.ok(StubModal.last, 'the folder picker opens');

	// 2. typing a new path survives save() next to the other fields
	input.value = ' 素材/新收件箱 ';
	input.dispatchEvent({ type: 'input' });
	const saveBtn = findTag(root, 'button').filter(b => b.hasClass('dashboard-modal-btn--confirm')).pop() as unknown as El;
	assert.ok(saveBtn, 'the footer save button rendered');
	saveBtn!.click();
	assert.equal(saved.length, 1, 'save emits one config');
	assert.deepEqual(saved[0], {
		includeFolders: ['素材'],
		excludeFolders: ['回收站'],
		importFolder: '素材/新收件箱',
		archiveFolder: '归档箱',
		skillButtons: [{ id: 'mb_1', label: '配图', icon: '', agent: 'claudian', skillName: '', promptTemplate: '' }],
	}, 'the typed destination is normalized and the rest of the config is untouched');

	// 3. clearing it falls back to Obsidian's attachment folder
	const cleared: MaterialLibraryConfig[] = [];
	const modal2 = new MaterialConfigModal(stubApp as never, BASE, cfg => cleared.push(cfg));
	modal2.onOpen();
	const root2 = modal2.contentEl as unknown as El;
	const input2 = importInputOf(root2);
	input2.value = '';
	input2.dispatchEvent({ type: 'input' });
	(findTag(root2, 'button').filter(b => b.hasClass('dashboard-modal-btn--confirm')).pop() as unknown as El)!.click();
	assert.equal(cleared[0]!.importFolder, '', 'an empty destination saves as the vault default');

	// 4. the archive destination mirrors the drop-in field (renders
	//    normalized, types and saves independently of the import folder)
	const archived: MaterialLibraryConfig[] = [];
	const modal3 = new MaterialConfigModal(stubApp as never, { ...BASE, archiveFolder: ' ./归档箱/ ' }, cfg => archived.push(cfg));
	modal3.onOpen();
	const root3 = modal3.contentEl as unknown as El;
	const pickers3 = findByClass(root3, 'dashboard-pathpicker-btn');
	assert.equal(pickers3.length, 2, 'both destination rows carry folder-picker buttons');
	const archiveInput = findTag(pickers3[1]!.parent as El, 'input')[0] as unknown as El & { value: string };
	assert.equal(archiveInput.value, '归档箱', 'a saved archive folder renders normalized');
	archiveInput.value = ' 归档/2026 ';
	archiveInput.dispatchEvent({ type: 'input' });
	(findTag(root3, 'button').filter(b => b.hasClass('dashboard-modal-btn--confirm')).pop() as unknown as El)!.click();
	assert.equal(archived[0]!.archiveFolder, '归档/2026', 'the typed archive destination saves normalized');
	assert.equal(archived[0]!.importFolder, '素材/收件箱', 'and leaves the drop-in destination untouched');

	console.log('verify-material-config: OK (drop-in destination field renders, normalizes and saves)');
}

main();
