import { App } from 'obsidian';
import { t } from './i18n';
import { extractFrontmatterProperties } from './library-section';

/**
 * Common properties offered even when the vault scan finds nothing, so a fresh
 * or sparse vault still has recognizable keys to pin. Purely a candidate-list
 * convenience: rendering skips any key the note lacks, so picking one that no
 * note has is harmless.
 */
const COMMON_PROPERTY_KEYS: readonly string[] = [
	'作者', '类型', '状态', '评分', 'author', 'type', 'status', 'rating', 'category', 'publisher',
];

/**
 * Reusable "pinned card properties" picker for section config modals: clickable
 * property chips (common keys first, then vault-scanned frontmatter keys, then
 * anything hand-added earlier) plus an input row to add custom keys, which
 * become picked immediately.
 *
 * State is owned by the editor; the caller reads `value` on save, so cancelling
 * the modal discards edits without touching the stored config. Pick order is
 * preserved — it is the display order on cards.
 */
export class VisiblePropertiesEditor {
	private picked: string[];
	private readonly customKeys: string[];

	constructor(app: App, host: HTMLElement, initial: readonly string[]) {
		this.picked = [...initial];
		// Keys typed by hand earlier survive vault rescans (their notes may be
		// gone) so a saved pick never silently disappears from the list.
		const scanned = [...extractFrontmatterProperties(app).keys()]
			// The extractor pre-seeds these synthetic filter keys; they are not
			// frontmatter badge candidates.
			.filter(k => k !== 'tags' && k !== 'modified' && k !== 'created' && k !== 'path')
			.sort();
		this.customKeys = [...new Set(initial.filter(k => !COMMON_PROPERTY_KEYS.includes(k) && !scanned.includes(k)))];

		host.createDiv({ cls: 'dashboard-library-config-hint', text: t('library.visiblePropertiesHint') });

		const chipsHost = host.createDiv({ cls: 'dashboard-library-filter-values' });
		const addRow = host.createDiv({ cls: 'dashboard-media-folder-input-row' });
		const input = addRow.createEl('input', {
			cls: 'dashboard-media-filter-folder',
			attr: { type: 'text', placeholder: t('library.visibleProperties') },
		});
		const addBtn = addRow.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('library.addProperty'),
		});

		const candidates = (): string[] => [
			...new Set([
				...COMMON_PROPERTY_KEYS,
				...scanned,
				...this.customKeys,
			]),
		];

		const renderChips = (): void => {
			chipsHost.empty();
			for (const key of candidates()) {
				const chip = chipsHost.createDiv({
					cls: 'dashboard-library-filter-chip' + (this.picked.includes(key) ? ' active' : ''),
					text: key,
				});
				chip.addEventListener('click', () => {
					this.picked = this.picked.includes(key)
						? this.picked.filter(k => k !== key)
						: [...this.picked, key];
					renderChips();
				});
			}
		};

		const addCustom = (): void => {
			const key = input.value.trim();
			input.value = '';
			if (!key) return;
			if (!candidates().includes(key)) this.customKeys.push(key);
			if (!this.picked.includes(key)) this.picked = [...this.picked, key];
			renderChips();
		};
		addBtn.addEventListener('click', addCustom);
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

		renderChips();
	}

	/** The current pick order (a copy); empty array = automatic mode. */
	get value(): string[] {
		return [...this.picked];
	}
}
