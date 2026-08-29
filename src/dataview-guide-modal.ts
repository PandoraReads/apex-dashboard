import { App, Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import { WECHAT_GROUP_QR_DATA_URL } from './assets/wechat-group-qr';
import { applyModalTheme } from './modal-theme';

interface GuideFeature {
	readonly icon: string;
	readonly textKey: string;
}

/** The capabilities showcased in the announcement modal. Content is refreshed
 *  per release (see the `announce.*` i18n keys); icons are Lucide names. */
const GUIDE_FEATURES: ReadonlyArray<GuideFeature> = [
	{ icon: 'columns-2', textKey: 'announce.featureHabitLabel' },
];

/**
 * One-time version announcement (what's new) + WeChat community group card.
 * Shown once per plugin version on startup (after layout ready). The feature
 * list comes from the `announce.*` i18n keys — refresh those per release. The
 * QR code is base64-bundled, so the modal works offline; a fallback line tells
 * users to add WeChat contact "PandoraReads" when the group invite has expired.
 */
export class DataviewGuideModal extends Modal {
	private readonly onSeen: () => void;
	private seen = false;

	constructor(app: App, onSeen: () => void) {
		super(app);
		this.onSeen = onSeen;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-dataview-guide-modal' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-dataview-guide-title', text: t('announce.title') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		body.createEl('p', {
			text: t('announce.intro'),
			cls: 'dashboard-dataview-guide-intro',
		});

		const list = body.createDiv({ cls: 'dashboard-dataview-guide-features' });
		for (const feature of GUIDE_FEATURES) {
			const row = list.createDiv({ cls: 'dashboard-dataview-guide-feature' });
			const iconWrap = row.createDiv({ cls: 'dashboard-dataview-guide-feature-icon' });
			setIcon(iconWrap, feature.icon);
			row.createSpan({ text: t(feature.textKey) });
		}

		// --- Community group card: centered QR, one title, fallback below ---
		const groupCard = body.createDiv({ cls: 'dashboard-dataview-guide-group' });
		groupCard.createDiv({ cls: 'dashboard-dataview-guide-group-title', text: t('announce.groupTitle') });

		const qrWrap = groupCard.createDiv({ cls: 'dashboard-dataview-guide-qr-wrap' });
		const qrImg = qrWrap.createEl('img', {
			cls: 'dashboard-dataview-guide-qr',
			attr: { src: WECHAT_GROUP_QR_DATA_URL, alt: '' },
		});
		qrImg.addEventListener('click', () => {
			// Open the raw QR in a new window so it can be scanned at full size
			// (or saved) even when the modal renders it small.
			window.open(WECHAT_GROUP_QR_DATA_URL, '_blank');
		});
		qrWrap.createDiv({ cls: 'dashboard-dataview-guide-group-fallback', text: t('announce.groupFallback') });

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('announce.gotIt'),
		}).addEventListener('click', () => this.close());
	}

	onClose(): void {
		if (!this.seen) {
			this.seen = true;
			this.onSeen();
		}
		this.contentEl.empty();
	}
}
