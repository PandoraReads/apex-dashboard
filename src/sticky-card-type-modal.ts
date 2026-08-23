import { Modal, setIcon } from 'obsidian';
import { t } from './i18n';

/** The two card flavors a sticky-notes ("便利贴") section can hold. */
export type StickyCardKind = 'memo' | 'todo';

/**
 * Chooses which kind of card to create inside a sticky-notes section: a
 * free-form memo card or a checkable todo card. Rendered as icon+label
 * buttons (same widget-type-btn styling as the dashboard widget picker).
 */
export class StickyCardTypeModal extends Modal {
	private readonly onSelect: (kind: StickyCardKind) => void;
	private readonly theme: string;

	constructor(
		app: import('obsidian').App,
		onSelect: (kind: StickyCardKind) => void,
		theme?: string,
	) {
		super(app);
		this.onSelect = onSelect;
		this.theme = theme ?? 'earth';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		contentEl.createEl('h2', { text: t('sticky.selectType') });

		const row = contentEl.createDiv({ cls: 'widget-type-row' });

		const kinds: { value: StickyCardKind; icon: string; labelKey: string; descKey: string }[] = [
			{ value: 'memo', icon: 'sticky-note', labelKey: 'sticky.memoLabel', descKey: 'sticky.memoDesc' },
			{ value: 'todo', icon: 'check-square', labelKey: 'sticky.todoLabel', descKey: 'sticky.todoDesc' },
		];

		for (const kind of kinds) {
			const btn = row.createDiv({ cls: 'widget-type-btn' });
			btn.setAttribute('role', 'button');
			const iconEl = btn.createDiv({ cls: 'widget-type-btn-icon' });
			setIcon(iconEl, kind.icon);
			btn.createDiv({ cls: 'widget-type-btn-name', text: t(kind.labelKey) });
			btn.createDiv({ cls: 'widget-type-btn-desc', text: t(kind.descKey) });
			btn.addEventListener('click', () => {
				this.onSelect(kind.value);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
