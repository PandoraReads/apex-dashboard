import { App, Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import { WECHAT_GROUP_QR_DATA_URL } from './assets/wechat-group-qr';

interface GuideFeature {
	readonly icon: string;
	readonly textKey: string;
}

/** The Dataview section capabilities showcased in the announcement modal. */
const GUIDE_FEATURES: ReadonlyArray<GuideFeature> = [
	{ icon: 'table-2', textKey: 'dataviewGuide.featureDql' },
	{ icon: 'braces', textKey: 'dataviewGuide.featureFields' },
	{ icon: 'calendar-days', textKey: 'dataviewGuide.featureViews' },
	{ icon: 'puzzle', textKey: 'dataviewGuide.featureNoPlugin' },
];

/**
 * One-time announcement for the Dataview section + WeChat community group.
 * Shown once per plugin version on startup (after layout ready). The QR code
 * is base64-bundled, so the modal works offline; a fallback line tells users
 * to add WeChat contact "PandoraReads" when the group invite has expired.
 */
export class DataviewGuideModal extends Modal {
	private readonly onSeen: () => void;
	private seen = false;

	constructor(app: App, onSeen: () => void) {
		super(app);
		this.onSeen = onSeen;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-modal', 'dashboard-dataview-guide-modal');

		contentEl.createEl('h2', {
			text: t('dataviewGuide.title'),
			cls: 'dashboard-dataview-guide-title',
		});

		contentEl.createEl('p', {
			text: t('dataviewGuide.intro'),
			cls: 'dashboard-dataview-guide-intro',
		});

		const list = contentEl.createDiv({ cls: 'dashboard-dataview-guide-features' });
		for (const feature of GUIDE_FEATURES) {
			const row = list.createDiv({ cls: 'dashboard-dataview-guide-feature' });
			const iconWrap = row.createDiv({ cls: 'dashboard-dataview-guide-feature-icon' });
			setIcon(iconWrap, feature.icon);
			row.createSpan({ text: t(feature.textKey) });
		}

		// --- Community group card ---
		const groupCard = contentEl.createDiv({ cls: 'dashboard-dataview-guide-group' });
		const groupText = groupCard.createDiv({ cls: 'dashboard-dataview-guide-group-text' });
		groupText.createDiv({ cls: 'dashboard-dataview-guide-group-title', text: t('dataviewGuide.groupTitle') });
		groupText.createDiv({ cls: 'dashboard-dataview-guide-group-desc', text: t('dataviewGuide.groupDesc') });

		const qrWrap = groupCard.createDiv({ cls: 'dashboard-dataview-guide-qr-wrap' });
		const qrImg = qrWrap.createEl('img', {
			cls: 'dashboard-dataview-guide-qr',
			attr: { src: WECHAT_GROUP_QR_DATA_URL, alt: t('dataviewGuide.qrAlt') },
		});
		qrImg.addEventListener('click', () => {
			// Open the raw QR in a new window so it can be scanned at full size
			// (or saved) even when the modal renders it small.
			window.open(WECHAT_GROUP_QR_DATA_URL, '_blank');
		});
		qrWrap.createDiv({ cls: 'dashboard-dataview-guide-qr-hint', text: t('dataviewGuide.qrHint') });

		groupText.createDiv({ cls: 'dashboard-dataview-guide-group-fallback', text: t('dataviewGuide.groupFallback') });

		const actions = contentEl.createDiv({ cls: 'dashboard-dataview-guide-actions' });
		const gotItBtn = actions.createEl('button', {
			text: t('dataviewGuide.gotIt'),
			cls: 'dashboard-dataview-guide-gotit',
		});
		gotItBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		if (!this.seen) {
			this.seen = true;
			this.onSeen();
		}
		this.contentEl.empty();
	}
}
