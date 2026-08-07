import { App, Modal, setIcon } from 'obsidian';
import { t } from './i18n';

interface GuideFeature {
	readonly icon: string;
	readonly textKey: string;
}

/** The four Quick Notes toolbar capabilities showcased in the first-run guide. */
const GUIDE_FEATURES: ReadonlyArray<GuideFeature> = [
	{ icon: 'sun', textKey: 'quickNote.guide.featureToday' },
	{ icon: 'file-plus', textKey: 'quickNote.guide.featureCreate' },
	{ icon: 'pin', textKey: 'quickNote.guide.featurePinned' },
	{ icon: 'square-pen', textKey: 'quickNote.guide.featureCapture' },
];

/**
 * First-run guide for the Quick Notes "Common Actions" toolbar.
 * A centered Obsidian Modal (not a corner Notice), shown once per plugin version.
 * Closing the modal marks it seen; the primary button additionally enables the bar.
 */
export class QuickNoteGuideModal extends Modal {
	private readonly onEnable: () => void;
	private readonly onSeen: () => void;
	private seen = false;

	constructor(app: App, onEnable: () => void, onSeen: () => void) {
		super(app);
		this.onEnable = onEnable;
		this.onSeen = onSeen;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-modal', 'dashboard-quicknote-guide-modal');

		contentEl.createEl('h2', {
			text: t('quickNote.guide.title'),
			cls: 'dashboard-quicknote-guide-title',
		});

		contentEl.createEl('p', {
			text: t('quickNote.guide.intro'),
			cls: 'dashboard-quicknote-guide-intro',
		});

		const list = contentEl.createDiv({ cls: 'dashboard-quicknote-guide-features' });
		for (const feature of GUIDE_FEATURES) {
			const row = list.createDiv({ cls: 'dashboard-quicknote-guide-feature' });
			const iconWrap = row.createDiv({ cls: 'dashboard-quicknote-guide-feature-icon' });
			setIcon(iconWrap, feature.icon);
			row.createSpan({ text: t(feature.textKey) });
		}

		contentEl.createEl('p', {
			text: t('quickNote.guide.hint'),
			cls: 'dashboard-quicknote-guide-hint',
		});

		const actions = contentEl.createDiv({ cls: 'dashboard-quicknote-guide-actions' });

		const dismissBtn = actions.createEl('button', {
			text: t('quickNote.guide.dismiss'),
			cls: 'dashboard-quicknote-guide-dismiss',
		});
		dismissBtn.addEventListener('click', () => this.close());

		const enableBtn = actions.createEl('button', {
			text: t('quickNote.guide.enable'),
			cls: 'dashboard-quicknote-guide-enable',
		});
		enableBtn.addEventListener('click', () => {
			this.onEnable();
			this.close();
		});
	}

	onClose(): void {
		// Mark seen exactly once, regardless of which button closed the modal.
		if (!this.seen) {
			this.seen = true;
			this.onSeen();
		}
		this.contentEl.empty();
	}
}
