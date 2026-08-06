import { App, FuzzyMatch, FuzzySuggestModal, setIcon } from 'obsidian';
import { t } from './i18n';

/**
 * Curated set of Lucide icon names offered in the picker. All are valid for
 * Obsidian's `setIcon`. Grouped roughly by theme so related icons sit together.
 */
const ICONS: readonly string[] = [
	// Notes & files
	'file-plus', 'file-text', 'notebook', 'notebook-pen', 'sticky-note', 'folder', 'folder-plus', 'bookmark', 'pin', 'tag', 'hash',
	// Time & dates
	'calendar', 'calendar-days', 'calendar-plus', 'clock', 'alarm-clock', 'sun', 'moon', 'cloud-sun',
	// Writing & ideas
	'pencil', 'edit', 'pen-line', 'feather', 'lightbulb', 'brain', 'sparkles', 'quote', 'zap', 'rocket',
	// Reading & media
	'book-open', 'book-plus', 'camera', 'image', 'mic', 'music', 'film', 'link',
	// Tasks & goals
	'list', 'list-checks', 'check-square', 'checkbox', 'target', 'flag', 'flame', 'award', 'trophy', 'star', 'heart',
	// Life & misc
	'coffee', 'utensils', 'dumbbell', 'briefcase', 'shopping-cart', 'map-pin', 'compass', 'plane', 'gift', 'leaf', 'droplet', 'palette',
	// People & comms
	'user', 'users', 'mail', 'message-circle', 'phone', 'bell', 'eye',
	// UI
	'home', 'search', 'plus', 'plus-circle', 'settings', 'settings-2',
];

/**
 * Fuzzy-searchable Lucide icon picker. Each suggestion renders the icon glyph
 * alongside its name; choosing one invokes `onPick` with the icon name.
 */
export class IconPickerModal extends FuzzySuggestModal<string> {
	private readonly onPick: (icon: string) => void;

	constructor(app: App, onPick: (icon: string) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder(t('quickNote.iconPickerPlaceholder'));
		this.emptyStateText = t('quickNote.iconPickerEmpty');
	}

	getItems(): string[] {
		return [...ICONS];
	}

	getItemText(item: string): string {
		return item;
	}

	renderSuggestion(result: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass('dashboard-icon-picker-item');
		setIcon(el.createSpan({ cls: 'dashboard-icon-picker-glyph' }), result.item);
		el.createSpan({ cls: 'dashboard-icon-picker-name', text: result.item });
	}

	onChooseItem(item: string): void {
		if (item) this.onPick(item);
	}
}
