import { App, FuzzyMatch, FuzzySuggestModal, setIcon } from 'obsidian';
import { t } from './i18n';
import { BUNDLED_ICON_NAMES } from './icon-names';

/**
 * Curated head of the picker: the hand-picked set the picker opened on for
 * years, kept first so the unfiltered view starts on familiar ground. All
 * names validated against the app's bundled dictionary (see
 * scripts/extract-icon-names.py); 'checkbox' was retired from Lucide and is
 * replaced by its current name 'square-check-big'. Grouped roughly by theme.
 */
const CURATED_ICONS: readonly string[] = [
	// Notes & files
	'file-plus', 'file-text', 'notebook', 'notebook-pen', 'sticky-note', 'folder', 'folder-plus', 'bookmark', 'pin', 'tag', 'hash',
	// Time & dates
	'calendar', 'calendar-days', 'calendar-plus', 'clock', 'alarm-clock', 'sun', 'moon', 'cloud-sun',
	// Writing & ideas
	'pencil', 'edit', 'pen-line', 'feather', 'lightbulb', 'brain', 'sparkles', 'quote', 'zap', 'rocket',
	// Reading & media
	'book-open', 'book-plus', 'camera', 'image', 'mic', 'music', 'film', 'link',
	// Tasks & goals
	'list', 'list-checks', 'check-square', 'square-check-big', 'target', 'flag', 'flame', 'award', 'trophy', 'star', 'heart',
	// Life & misc
	'coffee', 'utensils', 'dumbbell', 'briefcase', 'shopping-cart', 'map-pin', 'compass', 'plane', 'gift', 'leaf', 'droplet', 'palette',
	// People & comms
	'user', 'users', 'mail', 'message-circle', 'phone', 'bell', 'eye',
	// UI
	'home', 'search', 'plus', 'plus-circle', 'settings', 'settings-2',
];

/** Everything the picker offers: the curated picks first, then the rest of
 *  the app's bundled dictionary in sorted order — typing reaches any icon
 *  the running Obsidian can actually render. */
const ICONS: readonly string[] = [
	...CURATED_ICONS,
	...BUNDLED_ICON_NAMES.filter(name => !CURATED_ICONS.includes(name)),
];

/** FuzzySuggestModal builds one DOM row (with an inline SVG) per suggestion:
 *  at ~1900 bundled names an empty query would mount a huge list for no
 *  benefit. Cap the visible rows; any typed query narrows past the cap. */
const MAX_SUGGESTIONS = 400;

/**
 * Fuzzy-searchable Lucide icon picker over the FULL set the app bundles.
 * Each suggestion renders the icon glyph alongside its name; choosing one
 * invokes `onPick` with the icon name.
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

	getSuggestions(query: string): FuzzyMatch<string>[] {
		return super.getSuggestions(query).slice(0, MAX_SUGGESTIONS);
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
