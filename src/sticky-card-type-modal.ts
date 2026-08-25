import { Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/** The two card flavors a sticky-notes ("便利贴") section can hold. */
export type StickyCardKind = 'memo' | 'todo';

/**
 * Chooses which kind of card to create inside a sticky-notes section: a
 * free-form memo card or a checkable todo card. Rendered as icon+label
 * buttons (same widget-type-btn styling as the dashboard widget picker).
 */
export class StickyCardTypeModal extends Modal {
	private readonly onSelect: (kind: StickyCardKind) => void;

	constructor(
		app: import('obsidian').App,
		onSelect: (kind: StickyCardKind) => void,
	) {
		super(app);
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('sticky.selectType') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const row = body.createDiv({ cls: 'widget-type-row' });

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
