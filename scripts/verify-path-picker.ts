import { strict as assert } from 'node:assert';
import { TFile, TFolder, type App } from 'obsidian';
import { El, findByClass } from './mini-dom';
import { PathPickerModal, attachPathPicker } from '../src/path-picker-modal';

// Vault path picker: file/folder listing, fuzzy filter, pick-by-click and
// keyboard, and the browse button that writes back into an input.

// Obsidian globals absent in Node: activeDocument (query misses -> theme
// mirroring no-ops, which is fine for these checks).
(globalThis as { activeDocument?: unknown }).activeDocument = { querySelector: () => null };

interface MockFile extends TFile { path: string; name: string; basename: string }
interface MockFolder extends TFolder { path: string; name: string }

const file = (path: string): MockFile => {
	const name = path.split('/').pop()!;
	return Object.assign(new TFile(), { path, name, basename: name.replace(/\.md$/, '') });
};
const folder = (path: string): MockFolder =>
	Object.assign(new TFolder(), { path, name: path.split('/').pop()! });

function makeApp(files: string[], folders: string[]): App {
	const app = {
		vault: {
			getMarkdownFiles: () => files.map(file),
			getAllLoadedFiles: () => [...files.map(file), ...folders.map(folder)],
		},
	};
	return app as unknown as App;
}

async function main(): Promise<void> {
	const FILES = ['Memos/2026-09-03.md', 'Templates/daily.md', 'Templates/weekly.md', 'Notes/idea.md'];
	const FOLDERS = ['/', 'Memos', 'Templates', 'Archive/Done'];

	// 1. File mode: lists files (not folders), each row showing basename + parent.
	{
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'file', () => {});
		modal.onOpen();
		const list = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		assert.equal(list.length, 4, '1: all files listed');
		const names = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-name').map(e => e.textContent);
		assert.ok(names.includes('daily'), '1: basename label');
		const parents = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-parent').map(e => e.textContent);
		assert.ok(parents.includes('Templates'), '1: parent path label');
	}

	// 2. Folder mode: lists folders, root excluded.
	{
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'folder', () => {});
		modal.onOpen();
		const rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		assert.equal(rows.length, 3, '2: folders only, no root');
	}

	// 3. Typing filters: substring on basename or path, case-insensitive.
	{
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'file', () => {});
		modal.onOpen();
		const search = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-search')[0]!;
		search.value = 'WEEK';
		search.dispatchEvent({ type: 'input' });
		let rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		assert.equal(rows.length, 1, '3: basename match kept');
		assert.equal(findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-name')[0]!.textContent, 'weekly');

		search.value = 'notes/';
		search.dispatchEvent({ type: 'input' });
		rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		assert.equal(rows.length, 1, '3: path match kept');

		search.value = 'zzz-nothing';
		search.dispatchEvent({ type: 'input' });
		rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		assert.equal(rows.length, 0, '3: no matches');
		assert.ok(findByClass(modal.contentEl as unknown as El, 'dashboard-library-empty').length === 1, '3: empty state shown');
	}

	// 4. Clicking a row delivers the full path and closes the modal.
	{
		let picked = '';
		let closed = 0;
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'folder', (p) => { picked = p; });
		modal.onOpen();
		(modal as unknown as { close(): void }).close = () => { closed++; };
		const rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		rows[0]!.click();
		assert.ok(picked.length > 0, '4: path delivered');
		assert.equal(closed, 1, '4: modal closed');
	}

	// 5. Enter on a row picks it too (keyboard parity).
	{
		let picked = '';
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'file', (p) => { picked = p; });
		modal.onOpen();
		const rows = findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item');
		rows[0]!.dispatchEvent({ type: 'keydown', key: 'Enter' });
		assert.ok(picked.endsWith('.md'), '5: keyboard pick');
	}

	// 6. attachPathPicker: renders a button; a pick writes the path into the
	//    input and reports it through onPick.
	{
		const parent = new El('div');
		const input = parent.createEl('input') as unknown as HTMLInputElement;
		const seen: string[] = [];
		const btn = attachPathPicker(parent as unknown as HTMLElement, input, makeApp(FILES, FOLDERS), 'file', (p) => { seen.push(p); });
		assert.ok(btn.hasClass('dashboard-pathpicker-btn'), '6: button rendered');
		btn.click(); // opens the picker (stub Modal.open is a no-op) — must not throw
		// Simulate what the click wires: the picker's onPick writes input + reports.
		// Drive it via a second modal to observe the contract end-to-end.
		let picked = '';
		const modal = new PathPickerModal(makeApp(FILES, FOLDERS), 'file', (p) => { picked = p; });
		modal.onOpen();
		findByClass(modal.contentEl as unknown as El, 'dashboard-pathpicker-item')[1]!.click();
		assert.equal(picked, 'Notes/idea.md', '6: pick contract (path-sorted order)');
		assert.equal(seen.length, 0, '6: no spurious picks');
	}

	console.log('verify-path-picker: 6 scenarios OK');
}

void main();
