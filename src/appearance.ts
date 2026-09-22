import { Platform, type App } from 'obsidian';
import type { CustomColors, DashboardSettings } from './types';
import { resolveVaultImage } from './banner';

/**
 * Maps each {@link CustomColors} field to the `--db-*` CSS custom property it
 * overrides on the dashboard root. Single source of truth for apply + clear.
 */
export const CUSTOM_COLOR_TOKENS: Readonly<Record<keyof CustomColors, string>> = {
	accent: '--db-accent',
	accentLight: '--db-accent-light',
	bg: '--db-bg',
	bgCard: '--db-bg-card',
	bgSection: '--db-bg-section',
	text: '--db-text',
	textMuted: '--db-text-muted',
	borderCard: '--db-border-card',
};

/**
 * One-click light/dark presets for the theme-studio color dropdown. When a
 * {@link CustomColors} field holds the 'light'/'dark' sentinel, the matching
 * entry here is the concrete CSS color applied to the `--db-*` token. Text
 * presets match the widget-background foreground recipe (white / near-black);
 * surface presets stay slightly translucent where the theme idiom is.
 */
const COLOR_PRESETS: Readonly<Record<'light' | 'dark', Readonly<Partial<Record<keyof CustomColors, string>>>>> = {
	light: {
		text: '#ffffff',
		textMuted: 'rgba(255, 255, 255, 0.62)',
		accent: '#ffffff',
		accentLight: 'rgba(255, 255, 255, 0.7)',
		bg: '#f5f5f7',
		bgCard: '#ffffff',
		bgSection: '#ededf0',
		borderCard: 'rgba(0, 0, 0, 0.14)',
	},
	dark: {
		text: '#111111',
		textMuted: 'rgba(17, 17, 17, 0.62)',
		accent: '#111111',
		accentLight: 'rgba(17, 17, 17, 0.7)',
		bg: '#141416',
		bgCard: '#1d1d20',
		bgSection: '#101013',
		borderCard: 'rgba(255, 255, 255, 0.16)',
	},
};

/** Stored color value -> concrete CSS color. 'light'/'dark' map to their
 *  per-field preset; hex / rgba / undefined pass through untouched. */
export function resolveCustomColorValue(
	field: keyof CustomColors,
	value: string | undefined,
): string | undefined {
	if (value !== 'light' && value !== 'dark') return value;
	return COLOR_PRESETS[value][field] ?? (value === 'light' ? '#ffffff' : '#111111');
}

const DEFAULT_DIM = 40;

/** Root font-size multipliers per fontScale option. em-based sizes across the
    dashboard cascade from the root, so one multiplier scales titles, body,
    banner, sidebar and widget labels proportionally while keeping their
    relative differences. 'medium' clears the override (inherited base size). */
const FONT_SCALE_SIZES: Readonly<Record<DashboardSettings['fontScale'], string>> = {
	small: '0.85em',
	medium: '',
	large: '1.15em',
};

/** Surface tokens whose alpha surfaceOpacity scales (read computed, re-emit rgba). */
const SURFACE_TOKENS = ['--db-bg-card', '--db-bg-section', '--db-bg-sidebar'] as const;
/** Radius tokens driven by radiusScale (md = base, sm = base-4, lg = base+4). */
const RADIUS_TOKENS = {
	sm: '--db-radius-sm',
	md: '--db-radius-md',
	lg: '--db-radius-lg',
} as const;

/**
 * Apply user appearance overrides to a dashboard root container:
 *  - a global background-image layer (`.apex-dashboard-bg`) with dim + blur + fill
 *  - custom color overrides on `--db-*` tokens (win over `[data-theme]` via inline specificity)
 *  - advanced overrides: glass blur, corner radius, surface opacity
 *
 * Call once per full render, right after `data-theme` is set. The container is
 * emptied by the caller before each render, so a fresh layer is created each time.
 * Advanced overrides run last; surfaceOpacity reads the computed surface color
 * (which already reflects any customColors override) to compose color + opacity.
 */
export function applyAppearance(container: HTMLElement, app: App, settings: DashboardSettings): void {
	// Start clean: the root element survives full re-renders (only its
	// children are emptied), so inline overrides from a previous settings
	// state — notably the custom page background paint — must be dropped or a
	// cleared color would stay stuck over the theme's own background.
	clearCustomColors(container);
	applyBackground(container, app, settings);
	applyCustomColors(container, settings.customColors);
	applyAdvanced(container, settings);
}

/**
 * Live-update appearance on already-rendered dashboards WITHOUT a full re-render.
 * Used by the Appearance modal for buttery preview while dragging sliders/pickers:
 * it swaps the background layer and rewrites the `--db-*` overrides in place.
 */
export function refreshAppearanceLive(app: App, settings: DashboardSettings): void {
	const roots = activeDocument.querySelectorAll<HTMLElement>('.apex-dashboard-root');
	roots.forEach(root => {
		root.querySelectorAll(':scope > .apex-dashboard-bg').forEach(el => el.remove());
		clearCustomColors(root);
		clearAdvanced(root);
		applyBackground(root, app, settings);
		applyCustomColors(root, settings.customColors);
		applyAdvanced(root, settings);
	});
}

function applyBackground(container: HTMLElement, app: App, settings: DashboardSettings): void {
	const path = settings.bgImage?.trim();
	if (!path) return;

	const resolved = resolveVaultImage(app, path);
	if (!resolved) return;

	const layer = container.createDiv({ cls: 'apex-dashboard-bg' });
	layer.style.backgroundImage = `url("${resolved}")`;
	layer.style.backgroundSize = settings.bgSize === 'contain' ? 'contain' : 'cover';
	// background-position/repeat come from the .apex-dashboard-bg CSS class.

	const blur = Platform.isMobile ? 0 : clampNumber(settings.bgBlur, 0, 30, 0);
	if (blur > 0) {
		// Slight overscale so the blur's faded edge stays off-screen.
		layer.style.filter = `blur(${blur}px)`;
		layer.style.transform = `scale(${1 + blur / 200})`;
	}

	const dim = clampNumber(settings.bgDim, 0, 100, DEFAULT_DIM);
	if (dim > 0) {
		const scrim = layer.createDiv({ cls: 'apex-dashboard-bg-scrim' });
		scrim.style.background = `rgba(0,0,0,${dim / 100})`;
	}
}

/** Apply the customColors overrides (presets resolved) onto a dashboard root.
 *  Exported for the verify scripts; runtime callers go through
 *  applyAppearance / refreshAppearanceLive. */
export function applyCustomColors(root: HTMLElement, custom: CustomColors | undefined): void {
	if (!custom) return;
	// Apply only the user's explicit overrides — we deliberately do NOT rewrite
	// the text tokens to force contrast; that would alter the theme's own color
	// scheme. (Per-element readability, e.g. the quick-notes bar, is handled
	// locally where it renders, not by mutating theme tokens here.)
	(Object.keys(custom) as (keyof CustomColors)[]).forEach(key => {
		// Resolve 'light'/'dark' sentinels first so every write below (token,
		// inline page paint, later computed reads) sees a concrete color.
		const value = resolveCustomColorValue(key, custom[key]);
		if (value && value.trim()) {
			root.style.setProperty(CUSTOM_COLOR_TOKENS[key], value.trim());
			// The page background ALSO paints inline: the wash themes paint
			// their drifting gradients on the root without referencing
			// --db-bg at all, so the token alone changes nothing there. An
			// inline background beats every theme rule (specificity of style
			// attributes), which is exactly the override a user-set page
			// color/alpha needs — at alpha 0 the Obsidian background shows.
			if (key === 'bg') root.style.background = value.trim();
		}
	});
}

/** Remove every `--db-*` override this module may have set, restoring theme defaults. */
export function clearCustomColors(root: HTMLElement): void {
	for (const token of Object.values(CUSTOM_COLOR_TOKENS)) {
		root.style.removeProperty(token);
	}
	// The inline page-background paint (see applyCustomColors) goes with them,
	// or a cleared custom color would leave the last picked color stuck over
	// the theme's own background.
	root.style.removeProperty('background');
}

/**
 * Advanced overrides: glass blur, corner radius, surface opacity. Each is
 * independent and no-op when its setting is null (theme default preserved).
 * Must run AFTER applyCustomColors so surfaceOpacity composes with custom colors.
 */
function applyAdvanced(root: HTMLElement, settings: DashboardSettings): void {
	if (Platform.isMobile) {
		root.setCssProps({ '--db-backdrop-blur': 'none' });
	} else if (settings.glassBlur != null) {
		const px = clampNumber(settings.glassBlur, 0, 20, 0);
		root.style.setProperty('--db-backdrop-blur', px <= 0 ? 'none' : `blur(${px}px)`);
	}
	if (settings.radiusScale != null) {
		const md = clampNumber(settings.radiusScale, 0, 22, 14);
		root.style.setProperty(RADIUS_TOKENS.md, `${md}px`);
		root.style.setProperty(RADIUS_TOKENS.sm, `${Math.max(0, md - 4)}px`);
		root.style.setProperty(RADIUS_TOKENS.lg, `${md + 4}px`);
	}
	applyFontScale(root, settings.fontScale);
	if (settings.surfaceOpacity != null) {
		applySurfaceOpacity(root, settings.surfaceOpacity);
	}
}

/** Scale the dashboard's base font size ('' clears back to the inherited default). */
function applyFontScale(root: HTMLElement, scale: DashboardSettings['fontScale']): void {
	const size = FONT_SCALE_SIZES[scale] ?? '';
	if (size) root.style.fontSize = size;
	else root.style.removeProperty('font-size');
}

/** Re-emit surface tokens as rgba(rgb, alpha), preserving the effective color. */
function applySurfaceOpacity(root: HTMLElement, opacity: number): void {
	const alpha = clampNumber(opacity, 0, 100, 100) / 100;
	const cs = getComputedStyle(root);
	for (const token of SURFACE_TOKENS) {
		const rgb = parseRgb(cs.getPropertyValue(token).trim());
		if (rgb) {
			root.style.setProperty(token, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
		}
	}
}

/** Remove the `--db-*` overrides applyAdvanced may have set (surface tokens + blur + radii). */
export function clearAdvanced(root: HTMLElement): void {
	root.style.removeProperty('--db-backdrop-blur');
	root.style.removeProperty('font-size');
	root.style.removeProperty(RADIUS_TOKENS.sm);
	root.style.removeProperty(RADIUS_TOKENS.md);
	root.style.removeProperty(RADIUS_TOKENS.lg);
	for (const token of SURFACE_TOKENS) {
		root.style.removeProperty(token);
	}
}

/** Parse a CSS color (hex or rgb/rgba) into an {r,g,b} triple, else null. */
function parseRgb(raw: string): Rgb | null {
	const s = raw.trim();
	let hex: string | null = null;
	if (/^#[0-9a-fA-F]{6}$/.test(s)) hex = s.slice(1);
	else if (/^#[0-9a-fA-F]{3}$/.test(s)) hex = s.slice(1).split('').map(c => c + c).join('');
	if (hex) {
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16),
		};
	}
	const m = s.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const parts = m[1]!.split(',').map(p => parseFloat(p.trim()));
		return { r: clampByte(parts[0] ?? 0), g: clampByte(parts[1] ?? 0), b: clampByte(parts[2] ?? 0) };
	}
	return null;
}

type Rgb = { r: number; g: number; b: number };

function clampByte(n: number): number {
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(255, Math.round(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}
