/**
 * Verifies the stacked widget span system (src/widget-span.ts + renderer):
 *
 * 1. resolveStackedSpans: preferred-first placement, exact-fit downshift
 *    ("首选档 + 放不下自动换挡"), fresh column on misfit, fixed cards never
 *    adapt, the leftover-1-row hole, quickActions filling its column.
 * 2. buildStackedSpanSpecs: tier defaults (habit twoThirds=4, reading
 *    half=3), album per-instance ratio + legacy fallback to full,
 *    countdown-/anniversary- prefixes = 2, the fixed table, unknown key = 6.
 * 3. Render integration: a stacked build writes the packed span as inline
 *    --db-widget-span ONLY on tiered cards (habit/reading/album-*); fixed
 *    cards carry none; a side build writes none at all.
 * 4. Signature: habitHeightRatio / readingHeightRatio changes break the
 *    widget reuse signature; sidebarWidth / widgetUnitHeight must NOT
 *    (sizing applies as plain CSS variables every render and must never
 *    churn the widgets DOM — pinned decision).
 * 5. clampSidebarWidth / clampWidgetUnitHeight: bounds + dirty-value defaults.
 *
 * Run: `npm run test:widget-span`
 */
import { strict as assert } from 'node:assert';
import type { App } from 'obsidian';
import { renderSidebarWidgets, sidebarWidgetSignature } from '../src/renderer';
import {
	RATIO_SPAN,
	ALL_TIERS,
	STACKED_FIXED_SPANS,
	isTieredWidgetKey,
	buildStackedSpanSpecs,
	resolveStackedSpans,
	clampSidebarWidth,
	clampWidgetUnitHeight,
	type StackedRatios,
} from '../src/widget-span';
import { registerHabitService } from '../src/habit-service';
import type { ReadingService } from '../src/reading-service';
import type { DashboardSettings, AlbumConfig } from '../src/types';
import { El, findByClass } from './mini-dom';

const baseSettings = (over: Partial<DashboardSettings>): DashboardSettings =>
	({
		layoutMode: 'side',
		widgetQuickActionsEnabled: false,
		widgetLunarEnabled: false,
		widgetYearProgressEnabled: false,
		widgetWeatherEnabled: false,
		pomodoroEnabled: false,
		widgetCalendarEnabled: false,
		widgetHabitEnabled: false,
		widgetExpenseEnabled: false,
		widgetAlbumEnabled: false,
		widgetMusicEnabled: false,
		readingEnabled: false,
		countdownEnabled: false,
		countdowns: [],
		albums: [],
		anniversaryEnabled: false,
		anniversaries: [],
		widgetOrder: [],
		habitHeightRatio: 'twoThirds',
		readingHeightRatio: 'half',
		sidebarWidth: 220,
		widgetUnitHeight: 300,
		...over,
	} as unknown as DashboardSettings);

const spansFor = (keys: string[], ratios: StackedRatios = {}): number[] =>
	resolveStackedSpans(buildStackedSpanSpecs(keys, ratios));

const cssVarOf = (el: El, name: string): string | undefined =>
	(el as unknown as { cssProps?: Record<string, string> }).cssProps?.[name];

const albumCfg = (id: number, heightRatio?: AlbumConfig['heightRatio']): AlbumConfig =>
	({ id, folder: '', intervalSec: 8, recursive: true, ratio: '1:1', transition: 'fade', heightRatio } as AlbumConfig);

const run = (): void => {
	// Globals touched on the render path (modal-theme imports, album timers).
	(globalThis as { activeDocument?: unknown }).activeDocument = {
		querySelector: (): null => null,
		body: new El('body'),
		addEventListener: (): void => {},
		removeEventListener: (): void => {},
	};
	const intervals = new Map<number, () => void>();
	let intervalSeq = 0;
	(globalThis as { window?: unknown }).window = {
		setTimeout: globalThis.setTimeout.bind(globalThis) as (fn: () => void, ms?: number) => number,
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
		setInterval: (fn: () => void, _ms?: number): number => { const id = ++intervalSeq; intervals.set(id, fn); return id; },
		clearInterval: (id: number): void => { intervals.delete(id); },
	};
	(globalThis as Record<string, unknown>).Image = class { src = ''; };

	// --- 1. resolveStackedSpans: the packing rules -------------------------
	{
		// Preferred fits -> preferred stays (lunar 2 leaves 4; habit's default
		// two-thirds = 4 tiles the column exactly).
		assert.deepEqual(spansFor(['lunar', 'habit']), [2, 4], 'preferred tier fits the column remainder');
		// Misfit + exact tier match -> downshift fills the column.
		assert.deepEqual(spansFor(['weather', 'habit']), [4, 2], 'habit downshifts 4->2 to exactly fill after weather');
		assert.deepEqual(spansFor(['habit', 'reading']), [4, 2], 'reading downshifts 3->2 after a two-thirds habit');
		// Two halves tile one column.
		assert.deepEqual(spansFor(['reading', 'habit'], { habit: 'half' }), [3, 3], 'half + half tile one column');
		// FIXED cards never adapt: pomodoro (3) misfits the 2-row remainder and
		// starts a fresh column instead of shrinking.
		assert.deepEqual(spansFor(['weather', 'pomodoro']), [4, 3], 'fixed card misfit starts a fresh column');
		// Album participates in the downshift (full preferred, 2-row remainder).
		assert.deepEqual(spansFor(['weather', 'album-1'], { albums: [albumCfg(1, 'full')] }), [4, 2], 'album downshifts to fill');
		// Leftover-1 hole: 3+2=5 leaves 1 row; no tier equals 1, so the next
		// card (fixed OR tiered) starts a fresh column and the hole stays.
		assert.deepEqual(spansFor(['reading', 'lunar', 'countdown-x']), [3, 2, 2], 'countdown starts a new column after a 1-row hole');
		assert.deepEqual(spansFor(['reading', 'lunar', 'habit']), [3, 2, 4], 'tiered card also refuses a 1-row remainder (fresh column, preferred kept)');
		// quickActions (fixed 6) fills its column alone; the next card starts fresh.
		assert.deepEqual(spansFor(['quickActions', 'lunar']), [6, 2], 'quickActions owns a column');
		// Never grows: a third-tier card in an empty column keeps 2 (the rest
		// of the column is left for following cards).
		assert.deepEqual(spansFor(['habit'], { habit: 'third' }), [2], 'spans never grow beyond the preferred tier');
	}

	// --- 2. buildStackedSpanSpecs: tiers, prefixes, defaults ---------------
	{
		const specs = buildStackedSpanSpecs(
			['habit', 'reading', 'album-7', 'album-8', 'countdown-x', 'anniversary-y', 'weather', 'mystery'],
			{ albums: [albumCfg(7, 'third'), albumCfg(8)] },
		);
		assert.deepEqual(specs.map(s => s.preferred), [4, 3, 2, 6, 2, 2, 4, 6],
			'habit defaults two-thirds, reading half, album per-instance (legacy -> full), prefixes 2, fixed table, unknown 6');
		assert.deepEqual(specs.map(s => s.allowed ?? null), [ALL_TIERS, ALL_TIERS, ALL_TIERS, ALL_TIERS, null, null, null, null],
			'only tiered cards carry an allowed set');
		assert.equal(isTieredWidgetKey('habit'), true);
		assert.equal(isTieredWidgetKey('reading'), true);
		assert.equal(isTieredWidgetKey('album-1'), true);
		assert.equal(isTieredWidgetKey('album'), false, 'the bare order key is not a widget key');
		assert.equal(isTieredWidgetKey('weather'), false);
		assert.equal(isTieredWidgetKey('countdown-x'), false);
		// The fixed table must mirror the CSS per-type rules.
		assert.deepEqual(STACKED_FIXED_SPANS, {
			quickActions: 6, calendar: 6, weather: 4,
			pomodoro: 3, expense: 3, music: 3,
			lunar: 2, yearProgress: 2,
		}, 'STACKED_FIXED_SPANS unchanged (update styles.css together)');
		assert.deepEqual(RATIO_SPAN, { full: 6, twoThirds: 4, half: 3, third: 2 });
	}

	// --- 3. Render integration: inline spans on tiered cards only ----------
	const vaultApp = {
		vault: {
			getFiles: () => [],
			getFileByPath: () => null,
			adapter: { getResourcePath: (p: string) => `appres://${p}` },
		},
	} as unknown as App;
	// Habit renders through the registered singleton; an empty-habits stub is
	// enough for the structure (the span lives on the card element).
	registerHabitService({ getHabits: () => [], getDoneOn: () => [] } as never);
	const readingStub = {
		getState: () => ({ status: 'idle', elapsedSeconds: 0, currentBook: null }),
		getActiveBooks: () => [],
		setOnTick: () => {},
		getApp: () => vaultApp,
	} as unknown as ReadingService;

	const spanSettings = baseSettings({
		widgetLunarEnabled: true,
		widgetHabitEnabled: true,
		readingEnabled: true,
		habitHeightRatio: 'half',
		readingHeightRatio: 'half',
		albums: [albumCfg(1, 'full')],
		widgetOrder: ['lunar', 'habit', 'reading', 'album-1'],
	});

	const buildArea = (mode: 'side' | 'stacked'): El => {
		const host = new El('div');
		const area = renderSidebarWidgets(
			host as unknown as HTMLElement,
			baseSettings({ ...spanSettings, layoutMode: mode }),
			vaultApp,
			undefined, readingStub, undefined, undefined, undefined, undefined,
		);
		assert.ok(area, `${mode} build returns the widgets area`);
		return host;
	};

	{
		const host = buildArea('stacked');
		const row = findByClass(host, 'dashboard-sidebar-widgets-row')[0]!;
		assert.deepEqual(row.children.map(c => c.dataset.widgetKey ?? ''), ['lunar', 'habit', 'reading', 'album-1'],
			'stacked strip follows the saved order');
		// Packing: lunar 2 (fixed), habit preferred 3 fits the 4-row remainder,
		// reading preferred 3 misfits the 1-row remainder -> fresh column at 3,
		// album preferred 6 misfits the 3-row remainder -> downshifts to 3.
		const byKey = (k: string): El => row.children.find(c => c.dataset.widgetKey === k)!;
		assert.equal(cssVarOf(byKey('habit'), '--db-widget-span'), '3', 'habit carries its packed span inline');
		assert.equal(cssVarOf(byKey('reading'), '--db-widget-span'), '3', 'reading keeps its preferred in the fresh column');
		assert.equal(cssVarOf(byKey('album-1'), '--db-widget-span'), '3', 'album downshifts to exactly fill');
		assert.equal(cssVarOf(byKey('lunar'), '--db-widget-span'), undefined, 'fixed cards carry no inline span');
	}
	{
		const host = buildArea('side');
		const area = findByClass(host, 'dashboard-sidebar-widgets')[0]!;
		assert.equal(findByClass(host, 'dashboard-sidebar-widgets-row').length, 0, 'side build has no strip wrapper');
		for (const card of area.children) {
			assert.equal(cssVarOf(card, '--db-widget-span'), undefined,
				`side layout writes no span on ${card.dataset.widgetKey ?? '?'}`);
		}
	}
	registerHabitService(null);

	// --- 4. Signature: ratios in, sizing out -------------------------------
	{
		const sig = (over: Partial<DashboardSettings>): string =>
			sidebarWidgetSignature(baseSettings({ widgetHabitEnabled: true, readingEnabled: true, ...over }), false, true, false, '');
		const base = sig({});
		assert.notEqual(base, sig({ habitHeightRatio: 'full' }), 'habit ratio change breaks the signature');
		assert.notEqual(base, sig({ readingHeightRatio: 'third' }), 'reading ratio change breaks the signature');
		assert.equal(base, sig({ sidebarWidth: 400 }), 'sidebar width must NOT churn the widgets DOM');
		assert.equal(base, sig({ widgetUnitHeight: 500 }), 'strip unit height must NOT churn the widgets DOM');
	}

	// --- 5. Clamps ----------------------------------------------------------
	{
		assert.equal(clampSidebarWidth(300), 300);
		assert.equal(clampSidebarWidth(50), 180, 'below the floor clamps');
		assert.equal(clampSidebarWidth(999), 420, 'above the ceiling clamps');
		assert.equal(clampSidebarWidth('x'), 220, 'dirty value falls back to the default');
		assert.equal(clampSidebarWidth(undefined), 220);
		assert.equal(clampWidgetUnitHeight(420), 420);
		assert.equal(clampWidgetUnitHeight(100), 240);
		assert.equal(clampWidgetUnitHeight(9999), 560);
		assert.equal(clampWidgetUnitHeight(null), 300);
	}
};

run();
console.log('widget span: ALL PASS');
