import { setIcon } from 'obsidian';
import { t } from './i18n';
import type { PomodoroService, PomodoroTag } from './pomodoro-service';
import { activityColor } from './pomodoro-service';

/**
 * Tag management overlay: rename / delete / merge / pin tags.
 * Opened from the focus-statistics modal's header gear button; mutations go
 * through PomodoroService (which rewrites pomodoro.json history in place) and
 * the caller's onChange re-renders the stats.
 */
export function openPomodoroTagManager(doc: Document, service: PomodoroService, onChange: () => void): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-pomodoro-stats-overlay' });
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal dashboard-pomodoro-tagmanager' });

	function close() {
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
	doc.addEventListener('keydown', onKey);

	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	header.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: t('pomodoro.tagTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-pomodoro-stats-close' });
	setIcon(closeBtn, 'x');
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	const list = modal.createDiv({ cls: 'dashboard-pomodoro-tagmanager-list' });

	// All tag names present anywhere (managed tags plus names seen in history),
	// so records recorded before the tags array existed are manageable too.
	function allTagNames(): string[] {
		const names = new Set<string>(service.getTags().map(tg => tg.name));
		for (const [name] of service.getActivityBreakdown()) {
			if (name) names.add(name);
		}
		names.delete(t('pomodoro.defaultActivity'));
		return [...names].sort((a, b) => a.localeCompare(b));
	}

	function isPinned(name: string): boolean {
		return service.getTags().some(tg => tg.name === name && tg.pinned);
	}

	function render(): void {
		list.empty();
		const names = allTagNames();
		if (names.length === 0) {
			list.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: t('pomodoro.tagNoTags') });
			return;
		}

		for (const name of names) {
			const tag: PomodoroTag = { name, pinned: isPinned(name) };
			const row = list.createDiv({ cls: 'dashboard-pomodoro-tagmanager-row' });

			const head = row.createDiv({ cls: 'dashboard-pomodoro-tagmanager-row-head' });
			const dot = head.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' });
			dot.style.backgroundColor = activityColor(name);
			head.createDiv({ cls: 'dashboard-pomodoro-tagmanager-name', text: name });
			if (tag.pinned) {
				const pin = head.createDiv({ cls: 'dashboard-pomodoro-tagmanager-pin-badge' });
				setIcon(pin, 'pin');
				pin.setAttribute('aria-label', t('pomodoro.tagPinned'));
			}

			const actions = row.createDiv({ cls: 'dashboard-pomodoro-tagmanager-actions' });
			iconBtn(actions, 'pin', tag.pinned ? t('pomodoro.tagUnpin') : t('pomodoro.tagPin'), () => {
				void service.setTagPinned(name, !tag.pinned).then(() => { render(); onChange(); });
			}, tag.pinned ? 'dashboard-pomodoro-tagmanager-btn--active' : '');
			iconBtn(actions, 'pencil', t('pomodoro.tagRename'), () => promptRename(name));
			iconBtn(actions, 'git-merge', t('pomodoro.tagMerge'), () => promptMerge(name));
			iconBtn(actions, 'trash-2', t('pomodoro.tagDelete'), () => promptDelete(name));
		}
	}

	function iconBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void, extraCls = ''): void {
		const btn = parent.createDiv({ cls: `dashboard-pomodoro-tagmanager-btn ${extraCls}`.trim() });
		btn.setAttribute('aria-label', label);
		btn.setAttribute('title', label);
		setIcon(btn, icon);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
	}

	// --- Inline prompt row (avoids window.prompt, matches the plugin's modal style) ---
	let promptRow: HTMLElement | null = null;

	function closePrompt(): void {
		promptRow?.remove();
		promptRow = null;
	}

	function showPrompt(
		labelText: string,
		options: { placeholder?: string; initial?: string; confirmLabel: string; danger?: boolean; selectOptions?: string[] },
		onConfirm: (value: string) => Promise<void> | void,
	): void {
		closePrompt();
		promptRow = modal.createDiv({ cls: 'dashboard-pomodoro-tagmanager-prompt' });
		promptRow.createDiv({ cls: 'dashboard-pomodoro-tagmanager-prompt-label', text: labelText });

		let input: HTMLInputElement | HTMLSelectElement;
		if (options.selectOptions && options.selectOptions.length > 0) {
			const sel = promptRow.createEl('select', { cls: 'dashboard-pomodoro-tagmanager-prompt-select' });
			for (const opt of options.selectOptions) {
				sel.createEl('option', { text: opt, attr: { value: opt } });
			}
			input = sel;
		} else {
			input = promptRow.createEl('input', {
				cls: 'dashboard-pomodoro-tagmanager-prompt-input',
				attr: { type: 'text', placeholder: options.placeholder ?? '' },
			}) as HTMLInputElement;
			if (options.initial) input.value = options.initial;
		}

		const err = promptRow.createDiv({ cls: 'dashboard-pomodoro-tagmanager-prompt-error' });

		const btnRow = promptRow.createDiv({ cls: 'dashboard-pomodoro-tagmanager-prompt-btns' });
		const cancel = btnRow.createEl('button', { cls: 'dashboard-pomodoro-tagmanager-prompt-cancel', text: t('common.cancel') });
		cancel.addEventListener('click', closePrompt);
		const ok = btnRow.createEl('button', {
			cls: 'dashboard-pomodoro-tagmanager-prompt-ok' + (options.danger ? ' dashboard-pomodoro-tagmanager-prompt-ok--danger' : ''),
			text: options.confirmLabel,
		});
		ok.addEventListener('click', async () => {
			try {
				await onConfirm((input as HTMLInputElement).value.trim());
				closePrompt();
				render();
				onChange();
			} catch (msg) {
				err.textContent = String(msg);
			}
		});
		input.focus();
	}

	function promptRename(name: string): void {
		showPrompt(
			t('pomodoro.tagRenamePrompt', { name }),
			{ initial: name, confirmLabel: t('pomodoro.tagRename') },
			async (value) => {
				if (!value) return;
				const ok = await service.renameTag(name, value);
				if (!ok) throw t('pomodoro.tagExists');
			},
		);
	}

	function promptMerge(name: string): void {
		const others = allTagNames().filter(n => n !== name);
		if (others.length === 0) return;
		showPrompt(
			t('pomodoro.tagMergePrompt', { name }),
			{ confirmLabel: t('pomodoro.tagMerge'), selectOptions: others },
			async (dest) => {
				if (!dest) return;
				const ok = await service.mergeTags(name, dest);
				if (!ok) throw t('pomodoro.tagExists');
			},
		);
	}

	function promptDelete(name: string): void {
		showPrompt(
			t('pomodoro.tagDeleteConfirm', { name }),
			{ confirmLabel: t('pomodoro.tagDelete'), danger: true },
			async () => {
				await service.deleteTag(name);
			},
		);
	}

	render();
}
