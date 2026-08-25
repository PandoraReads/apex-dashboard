import { Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

export type WidgetType = 'weather' | 'tracker';

export class WidgetTypeModal extends Modal {
	private onSelect: (type: WidgetType) => void;

	constructor(
		app: import('obsidian').App,
		onSelect: (type: WidgetType) => void,
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
		header.createDiv({ cls: 'dashboard-modal-title', text: t('widget.selectType') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		const row = body.createDiv({ cls: 'widget-type-row' });

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
