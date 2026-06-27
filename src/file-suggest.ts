import { App, TFile } from 'obsidian';

export interface FileSuggestHandle {
	isActive(): boolean;
	destroy(): void;
}

interface SuggestItem {
	text: string;
	subtext?: string;
	indent?: number;
	select: () => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'pdf']);

export function attachFileSuggest(
	inputEl: HTMLTextAreaElement | HTMLInputElement,
	app: App,
): FileSuggestHandle {
	let dropdown: HTMLElement | null = null;
	let items: SuggestItem[] = [];
	let selectedIdx = 0;
	let bracketPos = -1;
	let active = false;
	let selectedFile: TFile | null = null;
	let suppressInput = false;

	// === Dropdown rendering ===

	function createDropdown() {
		hide();
		dropdown = activeDocument.body.createDiv({ cls: 'dashboard-file-suggest' });
		const rect = inputEl.getBoundingClientRect();
		dropdown.setCssProps({
			position: 'fixed',
			left: `${rect.left}px`,
			top: `${rect.bottom + 2}px`,
			width: `${Math.min(rect.width, 320)}px`,
		});
		dropdown.addEventListener('mousedown', (e) => e.preventDefault());
	}

	function renderItems() {
		if (!dropdown) return;
		dropdown.empty();

		items.forEach((item, idx) => {
			const el = dropdown!.createDiv({
				cls: 'dashboard-file-suggest-item' + (idx === selectedIdx ? ' active' : ''),
			});

			if (item.indent) {
				el.style.paddingLeft = `${item.indent * 10 + 10}px`;
			}

			el.createSpan({ text: item.text, cls: 'dashboard-file-suggest-name' });
			if (item.subtext) {
				el.createSpan({ text: item.subtext, cls: 'dashboard-file-suggest-path' });
			}

			el.addEventListener('click', () => item.select());
		});
	}

	function hide() {
		if (dropdown) {
			dropdown.remove();
			dropdown = null;
		}
		active = false;
	}

	// === Link content manipulation ===

	function insertClosedLink(path: string) {
		const pos = inputEl.selectionStart ?? 0;
		const text = inputEl.value;
		const before = text.slice(0, bracketPos);
		let after = text.slice(pos);
		if (after.startsWith(']]')) {
			after = after.slice(2);
		}
		inputEl.value = before + `[[${path}]]` + after;
		const cursorPos = bracketPos + 2 + path.length;
		inputEl.setSelectionRange(cursorPos, cursorPos);
	}

	function dispatchInput() {
		suppressInput = true;
		inputEl.dispatchEvent(new Event('input'));
	}

	// === File resolution ===

	function resolveFile(query: string): TFile | null {
		let file = app.vault.getFileByPath(query);
		if (file) return file;
		file = app.vault.getFileByPath(query + '.md');
		if (file) return file;
		return app.vault.getFiles().find(f => f.basename === query) ?? null;
	}

	// === Show functions ===

	function showFiles(query: string) {
		const q = query.toLowerCase();
		const files = app.vault.getFiles()
			.filter(f => !f.path.startsWith('.'))
			.filter(f => f.extension === 'md' || IMAGE_EXTENSIONS.has(f.extension))
			.filter(f => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
			.slice(0, 10);

		if (files.length === 0) { hide(); return; }

		active = true;
		items = files.map(f => ({
			text: f.basename,
			subtext: f.parent?.path,
			select: () => selectFile(f),
		}));

		createDropdown();
		selectedIdx = 0;
		renderItems();
	}

	function showHeadings(file: TFile, query: string) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.headings?.length) { hide(); return; }

		const q = query.toLowerCase();
		const headings = q
			? cache.headings.filter(h => h.heading.toLowerCase().includes(q))
			: cache.headings;

		if (!headings.length) { hide(); return; }

		active = true;
		items = headings.map(h => ({
			text: h.heading,
			indent: h.level,
			select: () => selectHeading(h.heading),
		}));

		createDropdown();
		selectedIdx = 0;
		renderItems();
	}

	async function showBlocks(file: TFile, query: string) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.blocks) { hide(); return; }

		const blockEntries = Object.entries(cache.blocks);
		if (!blockEntries.length) { hide(); return; }

		const content = await app.vault.cachedRead(file);
		const lines = content.split('\n');
		const q = query.toLowerCase();

		const filtered = q
			? blockEntries.filter(([id]) => id.toLowerCase().includes(q))
			: blockEntries;

		if (!filtered.length) { hide(); return; }

		active = true;
		items = filtered.slice(0, 10).map(([id, info]) => {
			const lineNum = info.position.start.line;
			let lineText = lines[lineNum] ?? '';
			lineText = lineText.replace(/\s*\^[a-zA-Z0-9]+$/, '').trim();
			if (lineText.length > 60) lineText = lineText.slice(0, 57) + '...';
			return {
				text: lineText || `^${id}`,
				subtext: lineText ? `^${id}` : undefined,
				select: () => selectBlock(id),
			};
		});

		createDropdown();
		selectedIdx = 0;
		renderItems();
	}

	// === Selection handlers ===

	function selectFile(file: TFile) {
		insertClosedLink(file.path);
		selectedFile = file;
		dispatchInput();
		hide();
	}

	function selectHeading(heading: string) {
		insertClosedLink(`${selectedFile!.path}#${heading}`);
		dispatchInput();
		hide();
	}

	function selectBlock(blockId: string) {
		insertClosedLink(`${selectedFile!.path}#^${blockId}`);
		dispatchInput();
		hide();
	}

	// === Input handler ===

	function onInput() {
		if (suppressInput) {
			suppressInput = false;
			return;
		}

		const pos = inputEl.selectionStart ?? 0;
		const text = inputEl.value;
		const beforeCursor = text.slice(0, pos);
		const lastBracket = beforeCursor.lastIndexOf('[[');

		if (lastBracket === -1) { hide(); return; }

		const between = beforeCursor.slice(lastBracket + 2);
		if (between.includes(']]') || pos - lastBracket > 200) {
			hide();
			return;
		}

		bracketPos = lastBracket;

		// Alias mode
		if (between.includes('|')) {
			hide();
			return;
		}

		// Heading/block mode
		const hashIdx = between.indexOf('#');
		if (hashIdx !== -1) {
			const filePath = between.slice(0, hashIdx).trim();
			const afterHash = between.slice(hashIdx + 1);

			const file = resolveFile(filePath);
			if (!file) { hide(); return; }

			selectedFile = file;

			if (afterHash.startsWith('^')) {
				void showBlocks(file, afterHash.slice(1).trim());
			} else {
				showHeadings(file, afterHash.trim());
			}
			return;
		}

		// File search mode
		selectedFile = null;
		showFiles(between.trim());
	}

	// === Key handler ===

	function onKeyDown(e: KeyboardEvent) {
		// Auto-insert # before ^ when inside [[ ]] without #
		if (e.key === '^') {
			const pos = inputEl.selectionStart ?? 0;
			const text = inputEl.value;
			const beforeCursor = text.slice(0, pos);
			const lastBracket = beforeCursor.lastIndexOf('[[');

			if (lastBracket !== -1) {
				const between = beforeCursor.slice(lastBracket + 2);
				if (!between.includes(']]') && !between.includes('#') && between.length > 0) {
					e.preventDefault();
					const before = text.slice(0, pos);
					const after = text.slice(pos);
					inputEl.value = before + '#^' + after;
					const newPos = pos + 2;
					inputEl.setSelectionRange(newPos, newPos);
					inputEl.dispatchEvent(new Event('input'));
					return;
				}
			}
		}

		if (!active) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopImmediatePropagation();
			selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
			renderItems();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopImmediatePropagation();
			selectedIdx = Math.max(selectedIdx - 1, 0);
			renderItems();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (items[selectedIdx]) {
				items[selectedIdx]!.select();
			}
		} else if (e.key === 'Escape') {
			hide();
		}
	}

	inputEl.addEventListener('input', onInput);
	inputEl.addEventListener('keydown', onKeyDown);
	inputEl.addEventListener('blur', () => window.setTimeout(hide, 150));

	return {
		isActive: () => active,
		destroy() {
			inputEl.removeEventListener('input', onInput);
			inputEl.removeEventListener('keydown', onKeyDown);
			hide();
		},
	};
}
