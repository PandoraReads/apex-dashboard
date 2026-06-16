import { Modal, setIcon } from 'obsidian';
import { t } from './i18n';

export type WidgetType = 'weather' | 'tracker';

export class WidgetTypeModal extends Modal {
	private onSelect: (type: WidgetType) => void;
	private theme: string;

	constructor(
		app: import('obsidian').App,
		onSelect: (type: WidgetType) => void,
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
		contentEl.createEl('h2', { text: t('widget.selectType') });

		const row = contentEl.createDiv({ cls: 'widget-type-row' });

		const types: { value: WidgetType; icon: string; labelKey: string; descKey: string }[] = [
			{ value: 'weather', icon: 'cloud-sun', labelKey: 'widget.weatherLabel', descKey: 'widget.weatherDesc' },
			{ value: 'tracker', icon: 'activity', labelKey: 'widget.trackerLabel', descKey: 'widget.trackerDesc' },
		];

		for (const wt of types) {
			const btn = row.createDiv({ cls: 'widget-type-btn' });
			const iconEl = btn.createDiv({ cls: 'widget-type-btn-icon' });
			setIcon(iconEl, wt.icon);
			btn.createDiv({ cls: 'widget-type-btn-name', text: t(wt.labelKey) });
			btn.createDiv({ cls: 'widget-type-btn-desc', text: t(wt.descKey) });
			btn.addEventListener('click', () => {
				this.onSelect(wt.value);
				this.close();
			});
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
