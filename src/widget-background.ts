import { App, Modal, Setting, setIcon, type TextComponent } from 'obsidian';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';
import { PathPickerModal } from './path-picker-modal';
import { resolveVaultImage } from './banner';
import { DEFAULT_WIDGET_BACKGROUND, type DashboardSettings, type WidgetBackground } from './types';

/** Runtime bridge to the plugin instance (the service-locator idiom the
 *  countdown settings button already uses): lets widget cards persist edits
 *  without the plugin being threaded through every render signature. */
export interface WidgetPluginHandle {
	settings: DashboardSettings;
	saveSettings(): Promise<void>;
	refreshAllDashboards(): void;
}

export function getWidgetPlugin(app: App): WidgetPluginHandle | null {
	const plugin = (app as unknown as {
		plugins?: { plugins?: Record<string, unknown> };
	}).plugins?.plugins?.['apex-dashboard'] as Partial<WidgetPluginHandle> | undefined;
	if (!plugin?.settings || !plugin.saveSettings || !plugin.refreshAllDashboards) return null;
	return plugin as WidgetPluginHandle;
}

/** Mount the half-hidden gear button at a card's top-right corner. Revealed
 *  on card hover (the countdown settings-button recipe); the click opens
 *  whatever the call site wires — background editor or full config modal. */
export function attachWidgetConfigButton(widget: HTMLElement, onOpen: () => void, label: string): void {
	widget.addClass('dashboard-sidebar-widget--cfg');
	const btn = widget.createEl('button', {
		cls: 'dashboard-widget-cfg-btn',
		attr: { 'aria-label': label },
	});
	setIcon(btn, 'settings');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onOpen();
	});
}

/** Config button variant that opens the background editor directly. */
export function attachBackgroundConfigButton(
	widget: HTMLElement,
	app: App,
	bg: WidgetBackground | undefined,
	onBgChange: (bg: WidgetBackground | undefined) => void,
): void {
	attachWidgetConfigButton(widget, () => {
		new WidgetBackgroundModal(app, bg, onBgChange).open();
	}, t('wbg.title'));
}

/** Inline variant for widgets whose header row already carries icon buttons
 *  (habit, music, quick actions): appends a matching ghost gear INTO that
 *  row's right-hand cluster instead of an absolute corner button that would
 *  overlap the existing ones. Returns the button so callers can position it
 *  within the cluster. */
export function appendInlineBackgroundButton(
	parent: HTMLElement,
	app: App,
	bg: WidgetBackground | undefined,
	onBgChange: (bg: WidgetBackground | undefined) => void,
): HTMLElement {
	const btn = parent.createDiv({
		cls: 'dashboard-widget-inline-cfg-btn',
		attr: { 'aria-label': t('wbg.title') },
	});
	setIcon(btn, 'settings');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		new WidgetBackgroundModal(app, bg, onBgChange).open();
	});
	return btn;
}

/** Map a foreground setting to a concrete color. null = follow theme. */
export function resolveWidgetForeground(foreground: string | undefined): string | null {
	if (!foreground) return null;
	if (foreground === 'light') return '#ffffff';
	if (foreground === 'dark') return '#111111';
	// Custom picker value (#rrggbb); anything malformed falls back to theme.
	return /^#[0-9a-fA-F]{3,8}$/.test(foreground) ? foreground : null;
}

/** Mount a decorative background layer on a widget card. No-op when the
 *  config is absent or its image cannot be resolved (wrong path, offline
 *  remote). The layer paints behind the card content via z-index -1 inside
 *  the isolation context the --has-bg class establishes. */
export function applyWidgetBackground(
	widget: HTMLElement,
	bg: WidgetBackground | undefined,
	app: App,
): void {
	if (!bg || !bg.image.trim()) return;
	const url = resolveVaultImage(app, bg.image.trim());
	if (!url) return;
	widget.addClass('dashboard-sidebar-widget--has-bg');
	// Foreground scheme: the card's theme text tokens are redirected to the
	// chosen color (see the --fg-set CSS), so text AND icons flip together.
	const fg = resolveWidgetForeground(bg.foreground);
	if (fg) {
		widget.addClass('dashboard-sidebar-widget--fg-set');
		widget.setCssProps({ '--wbg-fg': fg });
	}
	const layer = widget.createDiv({ cls: 'dashboard-widget-bg' });
	// Slight over-scale when blurred so the blur's faded edge never shows
	// inside the card (the classic bleed fix).
	layer.setCssProps({
		'--wbg-image': `url("${url}")`,
		'--wbg-opacity': String(Math.max(0, Math.min(100, bg.opacity)) / 100),
		'--wbg-dim': String(Math.max(0, Math.min(100, bg.dim)) / 100),
		'--wbg-blur': `${Math.max(0, Math.min(20, bg.blur))}px`,
		'--wbg-scale': String(1 + Math.max(0, Math.min(20, bg.blur)) * 0.05),
	});
}

/** Create/edit one widget card background: vault image (text or file picker)
 *  plus opacity / dim / blur sliders. Saving with an empty image yields
 *  undefined (background removed). */
export class WidgetBackgroundModal extends Modal {
	private readonly cfg: WidgetBackground;
	private readonly onSave: (bg: WidgetBackground | undefined) => void;

	constructor(app: App, bg: WidgetBackground | undefined, onSave: (bg: WidgetBackground | undefined) => void) {
		super(app);
		this.cfg = bg ? { ...bg } : DEFAULT_WIDGET_BACKGROUND();
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact' });
		const title = container.createDiv({ cls: 'dashboard-modal-title', text: t('wbg.title') });
		title.setCssProps({ fontSize: '1em' });
		const body = container.createDiv({ cls: 'dashboard-modal-body' });

		let imageInput: TextComponent | undefined;
		new Setting(body)
			.setName(t('wbg.image'))
			.setDesc(t('wbg.imageDesc'))
			.addText(text => {
				imageInput = text;
				text
					.setPlaceholder(t('wbg.imagePlaceholder'))
					.setValue(this.cfg.image)
					.onChange(v => { this.cfg.image = v.trim(); });
			})
			.addExtraButton(btn => btn
				.setIcon('file-search')
				.setTooltip(t('pathPicker.pickFile'))
				.onClick(() => {
					new PathPickerModal(this.app, 'image', (path) => {
						this.cfg.image = path;
						imageInput?.setValue(path);
					}).open();
				}));

		new Setting(body)
			.setName(t('wbg.opacity'))
			.setDesc(t('wbg.opacityDesc'))
			.addSlider(slider => slider
				.setLimits(10, 100, 5)
				.setValue(this.cfg.opacity)
				.onChange(v => { this.cfg.opacity = v; }));

		new Setting(body)
			.setName(t('wbg.dim'))
			.setDesc(t('wbg.dimDesc'))
			.addSlider(slider => slider
				.setLimits(0, 100, 5)
				.setValue(this.cfg.dim)
				.onChange(v => { this.cfg.dim = v; }));

		new Setting(body)
			.setName(t('wbg.blur'))
			.setDesc(t('wbg.blurDesc'))
			.addSlider(slider => slider
				.setLimits(0, 20, 1)
				.setValue(this.cfg.blur)
				.onChange(v => { this.cfg.blur = v; }));

		// Foreground scheme: follow-theme default, light/dark presets, or a
		// custom picker color. The picker only drives the value while the
		// dropdown sits on "custom".
		let fgColorInput: HTMLInputElement | null = null;
		const fgMode = (): string => {
			const v = this.cfg.foreground;
			if (!v) return 'theme';
			if (v === 'light' || v === 'dark') return v;
			return 'custom';
		};
		new Setting(body)
			.setName(t('wbg.foreground'))
			.setDesc(t('wbg.foregroundDesc'))
			.addDropdown(dropdown => {
				dropdown
					.addOption('theme', t('wbg.fgTheme'))
					.addOption('light', t('wbg.fgLight'))
					.addOption('dark', t('wbg.fgDark'))
					.addOption('custom', t('wbg.fgCustom'))
					.setValue(fgMode())
					.onChange(v => {
						if (v === 'theme') this.cfg.foreground = undefined;
						else if (v === 'light' || v === 'dark') this.cfg.foreground = v;
						else this.cfg.foreground = this.cfg.foreground?.startsWith('#') ? this.cfg.foreground : '#ffffff';
						const input = fgColorInput;
						if (input) {
							input.disabled = v !== 'custom';
							input.value = this.cfg.foreground?.startsWith('#') ? this.cfg.foreground : '#ffffff';
						}
					});
			})
			.addColorPicker(picker => {
				picker
					.setValue(this.cfg.foreground?.startsWith('#') ? this.cfg.foreground : '#ffffff')
					.onChange(v => { this.cfg.foreground = v; });
				fgColorInput = (picker as unknown as { inputEl?: HTMLInputElement }).inputEl ?? null;
			});

		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			text: t('wbg.clear'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
		}).addEventListener('click', () => {
			this.close();
			this.onSave(undefined);
		});
		footer.createEl('button', {
			text: t('common.save'),
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
		}).addEventListener('click', () => {
			this.close();
			// An empty image means "no background" — persist nothing so the
			// widget stays clean instead of carrying dead settings.
			this.onSave(this.cfg.image.trim() ? this.cfg : undefined);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
