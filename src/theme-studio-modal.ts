import { App, FuzzySuggestModal, Modal, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import type { BgSize, CustomColors, DashboardSettings } from './types';
import { CUSTOM_COLOR_TOKENS, refreshAppearanceLive, resolveCustomColorValue } from './appearance';
import { showConfirmDialog } from './confirm-dialog';
import { t } from './i18n';
import { applyModalTheme } from './modal-theme';

/** Image extensions offered by the background-image browser. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Curated quick-pick accents for the swatch row. */
const ACCENT_SWATCHES = [
	'#e76f51', '#e9c46a', '#2a9d8f', '#577590', '#6d597a',
	'#b56576', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981',
];

/** Ordered color fields rendered in the Color scheme section. */

/** '#rrggbb' -> 'rgba(r, g, b, a)' with two-decimal alpha. */
function hexToRgbaString(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
	const r = parseInt(full.slice(0, 2), 16);
	const g = parseInt(full.slice(2, 4), 16);
	const b = parseInt(full.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

/** The '#rrggbb' part of a stored color value (defaults null). */
function rgbPartOf(value: string | undefined): string | null {
	if (!value) return null;
	const m = value.match(/^#[0-9a-fA-F]{6}/);
	if (m) return m[0];
	const rgba = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (!rgba) return null;
	const to2 = (n: string) => Number(n).toString(16).padStart(2, '0');
	return `#${to2(rgba[1]!)}${to2(rgba[2]!)}${to2(rgba[3]!)}`;
}

/** Alpha percentage of a stored value (100 for plain hex / unset). */
function alphaPctOf(value: string | undefined): number {
	if (!value) return 100;
	const m = value.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
	return m ? Math.round(Number(m[1]) * 100) : 100;
}

const COLOR_FIELDS: ReadonlyArray<{ key: keyof CustomColors; labelKey: string }> = [
	{ key: 'accent', labelKey: 'themeStudio.color.accent' },
	{ key: 'accentLight', labelKey: 'themeStudio.color.accentLight' },
	{ key: 'bg', labelKey: 'themeStudio.color.bg' },
	{ key: 'bgCard', labelKey: 'themeStudio.color.bgCard' },
	{ key: 'bgSection', labelKey: 'themeStudio.color.bgSection' },
	{ key: 'text', labelKey: 'themeStudio.color.text' },
	{ key: 'textMuted', labelKey: 'themeStudio.color.textMuted' },
	{ key: 'borderCard', labelKey: 'themeStudio.color.borderCard' },
];

/** Defaults shown for advanced sliders while their setting is null (theme default). */
interface AdvancedDefaults {
	blur: number;
	radius: number;
}

/** Stored-value mode for the per-field dropdown (theme-studio color rows). */
type ColorMode = 'theme' | 'light' | 'dark' | 'custom';

/** Derive the dropdown mode from a stored CustomColors value: the light/dark
 *  sentinels select themselves, any other value is a custom pick, absent is
 *  follow-theme. */
function colorModeOf(value: string | undefined): ColorMode {
	if (value === 'light' || value === 'dark') return value;
	return value ? 'custom' : 'theme';
}

/**
 * Appearance Studio — global DIY panel for color overrides, a background image,
 * and advanced surface controls. Changes apply live to every open dashboard
 * (via refreshAppearanceLive, no full re-render) and persist on a short debounce.
 */
export class ThemeStudioModal extends Modal {
	private plugin: DashboardPlugin;
	private colors: CustomColors;
	private bgImage: string;
	private bgDim: number;
	private bgBlur: number;
	private bgSize: BgSize;
	private surfaceOpacity: number | null;
	private glassBlur: number | null;
	private radiusScale: number | null;
	private fontScale: DashboardSettings['fontScale'];
	private readonly themeDefaults: Partial<Record<keyof CustomColors, string>>;
	private readonly advancedDefaults: AdvancedDefaults;
	/** Per-row re-sync (dropdown + picker + slider state) so external writes —
	 *  the accent swatches, the section reset — refresh the row UI in place. */
	private readonly colorRowSyncs = new Map<keyof CustomColors, () => void>();
	private saveTimer: number | null = null;

	constructor(app: App, plugin: DashboardPlugin) {
		super(app);
		this.plugin = plugin;
		const s = plugin.settings;
		this.colors = { ...s.customColors };
		this.bgImage = s.bgImage;
		this.bgDim = s.bgDim;
		this.bgBlur = s.bgBlur;
		this.bgSize = s.bgSize;
		this.surfaceOpacity = s.surfaceOpacity;
		this.glassBlur = s.glassBlur;
		this.radiusScale = s.radiusScale;
		this.fontScale = s.fontScale ?? 'medium';
		this.themeDefaults = readThemeDefaults();
		this.advancedDefaults = readAdvancedDefaults();
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);
		this.renderBody();
	}

	onClose(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			void this.plugin.saveSettings();
		}
		this.contentEl.empty();
	}

	/** Build (or rebuild) the modal body. Safe to call on discrete clicks only —
	 *  never on continuous `input` events, or an open color picker would lose focus. */
	private renderBody(): void {
		const { contentEl } = this;
		contentEl.empty();
		const container = contentEl.createDiv({
			cls: 'dashboard-modal dashboard-modal--compact dashboard-theme-studio',
		});
		const header = container.createDiv({ cls: 'dashboard-modal-header dashboard-theme-studio-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('themeStudio.modalTitle') });

		// Global one-click restore, on the title row (right-aligned) so it's easy to find.
		const resetAllBtn = header.createEl('button', {
			cls: 'dashboard-theme-studio-resetall',
			attr: { 'aria-label': t('themeStudio.resetAll'), title: t('themeStudio.resetAll') },
		});
		setIcon(resetAllBtn.createSpan({ cls: 'dashboard-theme-studio-resetall-icon' }), 'rotate-ccw');
		resetAllBtn.appendText(t('themeStudio.resetAll'));
		resetAllBtn.addEventListener('click', () => { void this.confirmResetAll(); });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createEl('p', { cls: 'dashboard-theme-studio-hint', text: t('themeStudio.hint') });

		const form = body.createDiv({ cls: 'dashboard-modal-form' });
		this.renderColorsSection(form);
		this.renderBackgroundSection(form);
		this.renderAdvancedSection(form);
		this.renderActions(container);
	}

	// ── Color scheme ───────────────────────────────────────────────────────

	private renderColorsSection(form: HTMLElement): void {
		this.colorRowSyncs.clear();
		const section = form.createDiv({ cls: 'dashboard-theme-studio-section' });
		section.createEl('h3', { text: t('themeStudio.color.title') });
		section.createEl('p', { cls: 'dashboard-theme-studio-desc', text: t('themeStudio.color.desc') });

		// Quick accent swatches — set the accent field directly.
		const swatchRow = section.createDiv({ cls: 'dashboard-theme-studio-swatches' });
		for (const hex of ACCENT_SWATCHES) {
			const chip = swatchRow.createDiv({
				cls: 'dashboard-theme-studio-swatch',
				attr: { title: hex, 'aria-label': hex },
			});
			chip.style.background = hex;
			chip.addEventListener('click', () => {
				this.colors = { ...this.colors, accent: hex };
				// Sync the accent row so its dropdown flips to "custom" and the
				// picker/slider re-enable alongside the new value.
				this.colorRowSyncs.get('accent')?.();
				this.scheduleApply();
			});
		}

		const list = section.createDiv({ cls: 'dashboard-theme-studio-color-list' });
		for (const field of COLOR_FIELDS) {
			this.renderColorRow(list, field);
		}

		const resetBtn = section.createEl('button', {
			cls: 'dashboard-theme-studio-reset',
			text: t('themeStudio.color.reset'),
		});
		resetBtn.addEventListener('click', () => {
			this.colors = {};
			for (const field of COLOR_FIELDS) {
				this.colorRowSyncs.get(field.key)?.();
			}
			this.scheduleApply();
		});
	}

	private renderColorRow(list: HTMLElement, field: { key: keyof CustomColors; labelKey: string }): void {
		const row = list.createDiv({ cls: 'dashboard-theme-studio-color-row' });
		row.createSpan({ cls: 'dashboard-theme-studio-color-label', text: t(field.labelKey) });

		// Stored value grammar: '#rrggbb' at full opacity (legacy configs and
		// the swatches), 'rgba(r, g, b, a)' once the alpha slider moves below
		// 100, or the 'light'/'dark' one-click preset sentinels (resolved per
		// field in appearance.ts). The token consumers take the resolved form —
		// applyCustomColors writes it straight into the CSS variable.
		const compose = (hex: string, alphaPct: number): string =>
			alphaPct >= 100 ? hex : hexToRgbaString(hex, alphaPct / 100);

		// Mode dropdown (the widget-background "text and icon color" recipe):
		// follow-theme / one-click light & dark presets / custom picker. The
		// picker and alpha slider only drive the value in "custom" mode; the
		// other modes keep them disabled but preview the resulting color.
		const modeSelect = row.createEl('select', { cls: 'dashboard-modal-input dashboard-theme-studio-color-mode' });
		for (const opt of [
			{ value: 'theme', labelKey: 'themeStudio.color.modeTheme' },
			{ value: 'light', labelKey: 'themeStudio.color.modeLight' },
			{ value: 'dark', labelKey: 'themeStudio.color.modeDark' },
			{ value: 'custom', labelKey: 'themeStudio.color.modeCustom' },
		]) {
			modeSelect.createEl('option', { value: opt.value, text: t(opt.labelKey) });
		}

		const input = row.createEl('input', {
			cls: 'dashboard-modal-color-input',
			attr: { type: 'color', 'aria-label': t(field.labelKey) },
		});
		const alphaSlider = row.createEl('input', {
			cls: 'dashboard-theme-studio-alpha-slider',
			attr: { type: 'range', min: '0', max: '100', step: '5', 'aria-label': t('themeStudio.color.alpha') },
		});

		/** What the picker/slider should display now: the stored value with
		 *  presets resolved (falling back to the theme default when unset). */
		const displayOf = (): { hex: string; alphaPct: number } => {
			const resolved = resolveCustomColorValue(field.key, this.colors[field.key]);
			return {
				hex: rgbPartOf(resolved) ?? this.themeDefaults[field.key] ?? '#808080',
				alphaPct: alphaPctOf(resolved),
			};
		};

		const sync = (): void => {
			const mode = colorModeOf(this.colors[field.key]);
			modeSelect.value = mode;
			const { hex, alphaPct } = displayOf();
			input.value = hex;
			alphaSlider.value = String(alphaPct);
			input.disabled = mode !== 'custom';
			alphaSlider.disabled = mode !== 'custom';
		};
		sync();

		modeSelect.addEventListener('change', () => {
			const mode = modeSelect.value as ColorMode;
			if (mode === 'theme') {
				const next = { ...this.colors };
				delete next[field.key];
				this.colors = next;
			} else if (mode === 'light' || mode === 'dark') {
				this.colors = { ...this.colors, [field.key]: mode };
			} else {
				// Custom: seed from whatever the row previews (preset color and
				// alpha, or the theme default) so nudging a preset keeps it as
				// the starting point instead of jumping to plain white.
				const { hex, alphaPct } = displayOf();
				this.colors = { ...this.colors, [field.key]: compose(hex, alphaPct) };
			}
			sync();
			this.scheduleApply();
		});

		// `input` fires continuously while picking — apply live but never rebuild
		// the form, or the native picker would lose focus mid-drag.
		input.addEventListener('input', () => {
			this.colors = { ...this.colors, [field.key]: compose(input.value, alphaPctOf(this.colors[field.key])) };
			this.scheduleApply();
		});
		alphaSlider.addEventListener('input', () => {
			this.colors = { ...this.colors, [field.key]: compose(input.value, Number(alphaSlider.value)) };
			this.scheduleApply();
		});
		this.colorRowSyncs.set(field.key, sync);

		const clearBtn = row.createEl('button', {
			cls: 'dashboard-theme-studio-color-clear',
			attr: { 'aria-label': t('themeStudio.color.clear'), title: t('themeStudio.color.clear') },
		});
		setIcon(clearBtn, 'rotate-ccw');
		clearBtn.addEventListener('click', () => {
			const next = { ...this.colors };
			delete next[field.key];
			this.colors = next;
			sync();
			this.scheduleApply();
		});
	}

	// ── Background image ───────────────────────────────────────────────────

	private renderBackgroundSection(form: HTMLElement): void {
		const section = form.createDiv({ cls: 'dashboard-theme-studio-section' });
		section.createEl('h3', { text: t('themeStudio.bg.title') });
		section.createEl('p', { cls: 'dashboard-theme-studio-desc', text: t('themeStudio.bg.desc') });

		// Image path + browse + clear
		const imageRow = section.createDiv({ cls: 'dashboard-theme-studio-image-row' });
		const input = imageRow.createEl('input', {
			cls: 'dashboard-modal-input dashboard-theme-studio-image-input',
			attr: { type: 'text', placeholder: 'attachments/bg.jpg' },
		});
		input.value = this.bgImage;
		input.addEventListener('input', () => {
			this.bgImage = input.value;
			this.scheduleApply();
		});

		const browseBtn = imageRow.createEl('button', {
			cls: 'dashboard-theme-studio-browse',
			text: t('themeStudio.bg.browse'),
		});
		browseBtn.addEventListener('click', () => {
			new ImageFileSuggestModal(this.app, (path) => {
				this.bgImage = path;
				input.value = path;
				this.scheduleApply();
			}).open();
		});

		const clearImgBtn = imageRow.createEl('button', {
			cls: 'dashboard-theme-studio-image-clear',
			text: t('themeStudio.bg.clear'),
		});
		clearImgBtn.addEventListener('click', () => {
			this.bgImage = '';
			input.value = '';
			this.scheduleApply();
		});

		// Dim slider
		this.renderSlider(section, {
			label: t('themeStudio.bg.dim'),
			min: 0, max: 100, step: 1, value: this.bgDim,
			onChange: (v) => { this.bgDim = v; this.scheduleApply(); },
		});

		// Blur slider
		this.renderSlider(section, {
			label: t('themeStudio.bg.blur'),
			min: 0, max: 30, step: 1, value: this.bgBlur,
			onChange: (v) => { this.bgBlur = v; this.scheduleApply(); },
		});

		// Fill mode
		const sizeRow = section.createDiv({ cls: 'dashboard-theme-studio-size-row' });
		sizeRow.createSpan({ cls: 'dashboard-theme-studio-color-label', text: t('themeStudio.bg.size') });
		const sizeSelect = sizeRow.createEl('select', { cls: 'dashboard-modal-input dashboard-theme-studio-size' });
		const coverOpt = sizeSelect.createEl('option', { value: 'cover', text: t('themeStudio.bg.sizeCover') });
		const containOpt = sizeSelect.createEl('option', { value: 'contain', text: t('themeStudio.bg.sizeContain') });
		if (this.bgSize === 'contain') containOpt.selected = true; else coverOpt.selected = true;
		sizeSelect.addEventListener('change', () => {
			this.bgSize = sizeSelect.value === 'contain' ? 'contain' : 'cover';
			this.scheduleApply();
		});
	}

	// ── Advanced (glass blur, corner radius, surface opacity) ──────────────

	private renderAdvancedSection(form: HTMLElement): void {
		const section = form.createDiv({ cls: 'dashboard-theme-studio-section' });
		section.createEl('h3', { text: t('themeStudio.advanced.title') });
		section.createEl('p', { cls: 'dashboard-theme-studio-desc', text: t('themeStudio.advanced.desc') });

		this.renderNullableSlider(section, {
			label: t('themeStudio.advanced.surfaceOpacity'),
			min: 0, max: 100, step: 1,
			get: () => this.surfaceOpacity,
			displayDefault: 100,
			onChange: (v) => { this.surfaceOpacity = v; this.scheduleApply(); },
		});
		this.renderNullableSlider(section, {
			label: t('themeStudio.advanced.glassBlur'),
			min: 0, max: 20, step: 1,
			get: () => this.glassBlur,
			displayDefault: this.advancedDefaults.blur,
			onChange: (v) => { this.glassBlur = v; this.scheduleApply(); },
		});
		this.renderNullableSlider(section, {
			label: t('themeStudio.advanced.radius'),
			min: 0, max: 22, step: 1,
			get: () => this.radiusScale,
			displayDefault: this.advancedDefaults.radius,
			onChange: (v) => { this.radiusScale = v; this.scheduleApply(); },
		});
		this.renderFontScaleRow(section);
	}

	/** Segmented Small / Medium / Large text-size picker plus a one-click
	 *  reset back to the default ('medium' = inherited base size). */
	private renderFontScaleRow(section: HTMLElement): void {
		const row = section.createDiv({ cls: 'dashboard-theme-studio-fontscale-row' });
		row.createSpan({ cls: 'dashboard-theme-studio-color-label', text: t('themeStudio.fontSize') });

		const seg = row.createDiv({ cls: 'dashboard-theme-studio-fontscale' });
		const options: Array<{ value: DashboardSettings['fontScale']; labelKey: string }> = [
			{ value: 'small', labelKey: 'themeStudio.fontSizeSmall' },
			{ value: 'medium', labelKey: 'themeStudio.fontSizeMedium' },
			{ value: 'large', labelKey: 'themeStudio.fontSizeLarge' },
		];
		const renderSeg = (): void => {
			seg.empty();
			for (const opt of options) {
				const btn = seg.createEl('button', {
					cls: 'dashboard-theme-studio-fontscale-btn' + (this.fontScale === opt.value ? ' active' : ''),
					text: t(opt.labelKey),
				});
				btn.addEventListener('click', () => {
					if (this.fontScale === opt.value) return;
					this.fontScale = opt.value;
					renderSeg();
					this.scheduleApply();
				});
			}
		};
		renderSeg();

		// One-click restore to the default size.
		const resetBtn = row.createEl('button', {
			cls: 'dashboard-theme-studio-color-clear',
			attr: {
				'aria-label': t('themeStudio.fontSizeReset'),
				title: t('themeStudio.fontSizeReset'),
			},
		});
		setIcon(resetBtn, 'rotate-ccw');
		resetBtn.addEventListener('click', () => {
			if (this.fontScale === 'medium') return;
			this.fontScale = 'medium';
			renderSeg();
			this.scheduleApply();
		});
	}

	/** Slider for a nullable numeric override. null shows the theme-default
	 *  value + a hint and a × button to reset back to the theme default. */
	private renderNullableSlider(section: HTMLElement, opts: {
		label: string;
		min: number;
		max: number;
		step: number;
		get: () => number | null;
		displayDefault: number;
		onChange: (v: number | null) => void;
	}): void {
		const row = section.createDiv({ cls: 'dashboard-theme-studio-slider-row' });
		const current = opts.get();
		const label = row.createSpan({ cls: 'dashboard-theme-studio-color-label' });
		const hint = row.createSpan({ cls: 'dashboard-theme-studio-slider-hint' });

		const paint = () => {
			const v = opts.get();
			label.setText(`${opts.label}  ${v ?? opts.displayDefault}`);
			hint.textContent = v == null ? t('themeStudio.advanced.themeDefault') : '';
		};
		paint();

		const slider = row.createEl('input', {
			cls: 'dashboard-theme-studio-slider',
			attr: { type: 'range', min: String(opts.min), max: String(opts.max), step: String(opts.step) },
		});
		slider.value = String(current ?? opts.displayDefault);
		slider.addEventListener('input', () => {
			opts.onChange(Number(slider.value));
			paint();
		});

		const resetBtn = row.createEl('button', {
			cls: 'dashboard-theme-studio-color-clear',
			attr: { 'aria-label': t('themeStudio.advanced.resetToTheme'), title: t('themeStudio.advanced.resetToTheme') },
		});
		setIcon(resetBtn, 'rotate-ccw');
		resetBtn.addEventListener('click', () => {
			opts.onChange(null);
			slider.value = String(opts.displayDefault);
			paint();
		});
	}

	private renderSlider(
		section: HTMLElement,
		opts: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void },
	): void {
		const row = section.createDiv({ cls: 'dashboard-theme-studio-slider-row' });
		const label = row.createSpan({
			cls: 'dashboard-theme-studio-color-label',
			text: `${opts.label}  ${opts.value}`,
		});
		const slider = row.createEl('input', {
			cls: 'dashboard-theme-studio-slider',
			attr: { type: 'range', min: String(opts.min), max: String(opts.max), step: String(opts.step) },
		});
		slider.value = String(opts.value);
		slider.addEventListener('input', () => {
			const v = Number(slider.value);
			label.setText(`${opts.label}  ${v}`);
			opts.onChange(v);
		});
	}

	// ── Actions ────────────────────────────────────────────────────────────

	private renderActions(container: HTMLElement): void {
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('common.done'),
		}).addEventListener('click', () => this.close());
	}

	// ── Global one-click restore ───────────────────────────────────────────

	private async confirmResetAll(): Promise<void> {
		const ok = await showConfirmDialog(this.app, {
			title: t('themeStudio.resetAll'),
			message: t('themeStudio.resetAllConfirm'),
			confirmLabel: t('common.confirm'),
			destructive: false,
		});
		if (!ok) return;

		this.colors = {};
		this.bgImage = '';
		this.bgDim = 40;
		this.bgBlur = 0;
		this.bgSize = 'cover';
		this.surfaceOpacity = null;
		this.glassBlur = null;
		this.radiusScale = null;
		this.fontScale = 'medium';
		this.scheduleApply();
		this.contentEl.empty();
		this.renderBody();
	}

	// ── Apply + persist ────────────────────────────────────────────────────

	/** Write current edits into settings, live-apply to open dashboards, debounce-save. */
	private scheduleApply(): void {
		this.plugin.settings = {
			...this.plugin.settings,
			customColors: { ...this.colors },
			bgImage: this.bgImage.trim(),
			bgDim: this.bgDim,
			bgBlur: this.bgBlur,
			bgSize: this.bgSize,
			surfaceOpacity: this.surfaceOpacity,
			glassBlur: this.glassBlur,
			radiusScale: this.radiusScale,
			fontScale: this.fontScale,
		};
		refreshAppearanceLive(this.app, this.plugin.settings);
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			void this.plugin.saveSettings();
			this.saveTimer = null;
		}, 400);
	}
}

/** Fuzzy picker over vault image files for the background-image path. */
class ImageFileSuggestModal extends FuzzySuggestModal<TFileStub> {
	private readonly onChoosePath: (path: string) => void;

	constructor(app: App, onChoosePath: (path: string) => void) {
		super(app);
		this.onChoosePath = onChoosePath;
		this.setPlaceholder(t('themeStudio.bg.browsePlaceholder'));
		this.emptyStateText = t('themeStudio.bg.noImages');
	}

	getItems(): TFileStub[] {
		return this.app.vault.getFiles()
			.filter(f => IMAGE_EXTENSIONS.has(f.extension.toLowerCase()))
			.slice(0, 500)
			.map(f => ({ path: f.path, basename: f.basename }));
	}

	getItemText(item: TFileStub): string {
		return `${item.basename} — ${item.path}`;
	}

	onChooseItem(item: TFileStub): void {
		if (item) this.onChoosePath(item.path);
	}
}

interface TFileStub {
	path: string;
	basename: string;
}

// ── Theme-default reading (for sensible picker/slider starting values) ─────

function readThemeDefaults(): Partial<Record<keyof CustomColors, string>> {
	const root = activeDocument.querySelector<HTMLElement>('.apex-dashboard-root');
	if (!root) return {};
	const cs = getComputedStyle(root);
	const out: Partial<Record<keyof CustomColors, string>> = {};
	for (const key of Object.keys(CUSTOM_COLOR_TOKENS) as (keyof CustomColors)[]) {
		out[key] = colorToHex(cs.getPropertyValue(CUSTOM_COLOR_TOKENS[key]).trim());
	}
	return out;
}

/** Read the active theme's blur + radius so advanced sliders start at the right spot. */
function readAdvancedDefaults(): AdvancedDefaults {
	const root = activeDocument.querySelector<HTMLElement>('.apex-dashboard-root');
	if (!root) return { blur: 0, radius: 14 };
	const cs = getComputedStyle(root);
	const blurRaw = cs.getPropertyValue('--db-backdrop-blur').trim();
	const blurMatch = blurRaw.match(/blur\(([\d.]+)px\)/i);
	const blur = blurMatch ? Math.round(parseFloat(blurMatch[1]!)) : 0;
	const radiusRaw = cs.getPropertyValue('--db-radius-md').trim();
	const radiusMatch = radiusRaw.match(/([\d.]+)px/);
	const radius = radiusMatch ? Math.round(parseFloat(radiusMatch[1]!)) : 14;
	return { blur, radius };
}

/** Normalize any CSS color (hex / rgb / rgba) to a `#rrggbb` picker value. */
function colorToHex(raw: string): string {
	const s = raw.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
	if (/^#[0-9a-fA-F]{3}$/.test(s)) {
		const expanded = s.slice(1).split('').map(c => c + c).join('');
		return '#' + expanded.toLowerCase();
	}
	const m = s.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const parts = m[1]!.split(',').map(p => parseFloat(p.trim()));
		const hex = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
			.map(n => clampByte(n).toString(16).padStart(2, '0'))
			.join('');
		return '#' + hex;
	}
	return '#808080';
}

function clampByte(n: number): number {
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(255, Math.round(n)));
}
