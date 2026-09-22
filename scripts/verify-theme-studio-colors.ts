import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { El, findByClass, findTag } from './mini-dom';
import {
	applyCustomColors,
	resolveCustomColorValue,
} from '../src/appearance';
import { ThemeStudioModal } from '../src/theme-studio-modal';
import type { CustomColors, DashboardSettings } from '../src/types';

// Theme-studio color scheme: per-area mode dropdown (follow theme / light /
// dark / custom, the widget-background foreground recipe). Checks the preset
// resolver, applyCustomColors sentinel handling, and the modal row wiring —
// dropdown state derives from the stored value, picker/slider only drive the
// value in custom mode, presets seed custom picks color + alpha.

// Obsidian globals absent in Node: activeDocument (root query misses ->
// theme-default reading and live refresh no-op, fine for these checks) and
// window (scheduleApply debounces via window.setTimeout).
(globalThis as { activeDocument?: unknown }).activeDocument = {
	querySelector: () => null,
	querySelectorAll: () => [],
};
(globalThis as { window?: unknown }).window = globalThis;

function makeApp(): App {
	return { vault: { getFileByPath: () => null, adapter: {} } } as unknown as App;
}

function makeSettings(customColors: CustomColors): DashboardSettings {
	return {
		customColors,
		bgImage: '',
		bgDim: 40,
		bgBlur: 0,
		bgSize: 'cover',
		surfaceOpacity: null,
		glassBlur: null,
		radiusScale: null,
		fontScale: 'medium',
	} as unknown as DashboardSettings;
}

/** Build the modal and open it; returns the modal plus a handle to the plugin
 *  stand-in so assertions can read what scheduleApply persisted. */
function openStudio(customColors: CustomColors): {
	modal: ThemeStudioModal;
	plugin: { settings: DashboardSettings; saveSettings: () => Promise<void> };
} {
	const plugin = {
		settings: makeSettings(customColors),
		saveSettings: async () => {},
	};
	const modal = new ThemeStudioModal(makeApp(), plugin as never);
	modal.onOpen();
	return { modal, plugin };
}

interface RowParts {
	row: El;
	select: El;
	picker: El;
	slider: El;
}

/** Locate the color row for a field by its label text (row order-safe). */
function rowByLabel(root: El, label: string): RowParts {
	const rows = findByClass(root, 'dashboard-theme-studio-color-row');
	const row = rows.find(r => r.children[0]?.textContent === label);
	assert.ok(row, `row with label ${label} rendered`);
	const select = findTag(row!, 'select')[0]!;
	const inputs = findTag(row!, 'input');
	return { row: row!, select, picker: inputs[0]!, slider: inputs[1]! };
}

function optionValues(select: El): string[] {
	return select.children.map(o => o.getAttribute('value') ?? '');
}

function main(): void {
	// 1. resolveCustomColorValue: sentinels map per field; everything else
	//    passes through untouched.
	{
		assert.equal(resolveCustomColorValue('text', 'light'), '#ffffff', '1: text light preset');
		assert.equal(resolveCustomColorValue('text', 'dark'), '#111111', '1: text dark preset');
		assert.equal(resolveCustomColorValue('textMuted', 'light'), 'rgba(255, 255, 255, 0.62)', '1: muted keeps hierarchy');
		assert.equal(resolveCustomColorValue('borderCard', 'dark'), 'rgba(255, 255, 255, 0.16)', '1: dark border translucent');
		assert.equal(resolveCustomColorValue('bgCard', 'light'), '#ffffff', '1: light card surface');
		assert.equal(resolveCustomColorValue('text', '#123456'), '#123456', '1: hex passthrough');
		assert.equal(resolveCustomColorValue('text', undefined), undefined, '1: undefined passthrough');
	}

	// 2. applyCustomColors: sentinels never reach the style bag — the resolved
	//    color lands on the token, and the page bg also paints inline resolved.
	{
		const root = new El('div');
		applyCustomColors(root as unknown as HTMLElement, {
			text: 'light',
			bg: 'dark',
			bgCard: '#abcdef',
		});
		assert.equal(root.style.getPropertyValue('--db-text'), '#ffffff', '2: text token resolved');
		assert.equal(root.style.getPropertyValue('--db-bg'), '#141416', '2: bg token resolved');
		assert.equal(root.style.getPropertyValue('--db-bg-card'), '#abcdef', '2: custom hex unaffected');
		assert.equal(root.style.background, '#141416', '2: inline page paint uses resolved color');
		assert.ok(!root.style.getPropertyValue('--db-text').includes('light'), '2: sentinel never leaks');
	}

	// 3. Rows render a 4-option dropdown; mode derives from the stored value;
	//    picker + slider disable outside custom mode but preview the preset.
	{
		const { modal } = openStudio({ text: 'light', accent: '#e76f51' });
		const content = modal.contentEl as unknown as El;
		const rows = findByClass(content, 'dashboard-theme-studio-color-row');
		assert.equal(rows.length, 8, '3: all eight areas render');

		const text = rowByLabel(content, '文字');
		assert.deepEqual(optionValues(text.select), ['theme', 'light', 'dark', 'custom'], '3: dropdown offers the four modes');
		assert.equal(text.select.value, 'light', '3: sentinel selects light mode');
		assert.equal(text.picker.disabled, true, '3: picker disabled in preset mode');
		assert.equal(text.slider.disabled, true, '3: slider disabled in preset mode');
		assert.equal(text.picker.value, '#ffffff', '3: picker previews the preset color');

		const accent = rowByLabel(content, '主色');
		assert.equal(accent.select.value, 'custom', '3: hex value selects custom mode');
		assert.equal(accent.picker.disabled, false, '3: picker enabled in custom mode');
		assert.equal(accent.picker.value, '#e76f51', '3: picker shows the stored hex');

		const bg = rowByLabel(content, '页面底色');
		assert.equal(bg.select.value, 'theme', '3: unset field selects follow-theme');
		assert.equal(bg.picker.disabled, true, '3: picker disabled in theme mode');
	}

	// 4. Dropdown changes: theme clears the field, presets store the sentinel,
	//    custom seeds from the previewed color (and preset alpha carries over).
	{
		const { modal, plugin } = openStudio({ text: 'dark', textMuted: 'light' });
		const content = modal.contentEl as unknown as El;

		const text = rowByLabel(content, '文字');
		text.select.value = 'custom';
		text.select.dispatchEvent({ type: 'change' });
		assert.equal(plugin.settings.customColors.text, '#111111', '4: custom seeds from the dark preset');
		assert.equal(text.picker.disabled, false, '4: picker enabled after switching to custom');

		const muted = rowByLabel(content, '文字（次要）');
		muted.select.value = 'custom';
		muted.select.dispatchEvent({ type: 'change' });
		assert.equal(
			plugin.settings.customColors.textMuted,
			'rgba(255, 255, 255, 0.62)',
			'4: preset alpha carries into the seeded custom value',
		);

		text.select.value = 'theme';
		text.select.dispatchEvent({ type: 'change' });
		assert.equal(plugin.settings.customColors.text, undefined, '4: follow-theme deletes the override');

		const card = rowByLabel(content, '卡片底色');
		card.select.value = 'dark';
		card.select.dispatchEvent({ type: 'change' });
		assert.equal(plugin.settings.customColors.bgCard, 'dark', '4: preset stores the sentinel');
		assert.equal(card.picker.value, '#1d1d20', '4: picker previews the dark card preset');
	}

	// 5. Accent swatches flip the accent row to custom mode.
	{
		const { modal, plugin } = openStudio({ accent: 'dark' });
		const content = modal.contentEl as unknown as El;
		const accent = rowByLabel(content, '主色');
		assert.equal(accent.select.value, 'dark', '5: starts in preset mode');

		const swatch = findByClass(content, 'dashboard-theme-studio-swatch')[0]!;
		swatch.click();
		assert.equal(accent.select.value, 'custom', '5: swatch flips the dropdown to custom');
		assert.equal(accent.picker.disabled, false, '5: picker re-enabled');
		const hex = swatch.getAttribute('title')!;
		assert.equal(plugin.settings.customColors.accent, hex, '5: swatch hex persisted');
	}

	// 6. Section reset returns every row to follow-theme.
	{
		const { modal, plugin } = openStudio({ text: 'light', accent: '#e76f51', borderCard: 'dark' });
		const content = modal.contentEl as unknown as El;
		findByClass(content, 'dashboard-theme-studio-reset')[0]!.click();
		assert.deepEqual(plugin.settings.customColors, {}, '6: reset clears every override');
		const text = rowByLabel(content, '文字');
		assert.equal(text.select.value, 'theme', '6: dropdown back to follow-theme');
		assert.equal(text.picker.disabled, true, '6: picker disabled again');
	}

	// 7. Clear button on a row resets just that field (dropdown included).
	{
		const { modal, plugin } = openStudio({ text: 'light', accent: '#e76f51' });
		const content = modal.contentEl as unknown as El;
		const text = rowByLabel(content, '文字');
		findTag(text.row, 'button')[0]!.click();
		assert.equal(plugin.settings.customColors.text, undefined, '7: clear removes only that field');
		assert.equal(plugin.settings.customColors.accent, '#e76f51', '7: sibling untouched');
		assert.equal(text.select.value, 'theme', '7: dropdown follows');
	}

	console.log('verify-theme-studio-colors: all 7 checks passed');
}

main();
