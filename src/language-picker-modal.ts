import { App, FuzzySuggestModal } from 'obsidian';
import { LANGUAGE_OPTIONS, t, type LanguageSetting } from './i18n';

export class LanguagePickerModal extends FuzzySuggestModal<LanguageSetting> {
	constructor(app: App, private readonly onSelect: (language: LanguageSetting) => void) {
		super(app);
		this.setPlaceholder(t('settings.language'));
	}

	getItems(): LanguageSetting[] {
		return LANGUAGE_OPTIONS.map(option => option.value);
	}

	getItemText(language: LanguageSetting): string {
		if (language === 'system') return t('settings.languageSystem');
		return LANGUAGE_OPTIONS.find(option => option.value === language)?.label ?? language;
	}

	onChooseItem(language: LanguageSetting): void {
		this.onSelect(language);
	}
}
