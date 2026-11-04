/**
 * Verifies the onboarding tour's decision layer (the DOM spotlight itself is
 * real-browser territory — the Playwright harness covers that):
 *
 * 1. shouldAutoStartOnboardingTour: fresh install only, desktop only, once
 *    per tour version.
 * 2. persistTourSeen: immutable settings update, saved exactly once,
 *    idempotent on re-run.
 * 3. buildTourSteps: step order, centered intro/outro, every spotlight step
 *    resolves a live anchor; click-to-advance only on real controls; the
 *    switch step is condition-gated (skipIf + advanceWhen) and never
 *    auto-switches anything itself; the add step scrolls its anchor in.
 * 4. Term highlighter: escapes HTML, wraps feature names, longest phrase
 *    wins over its substring, ASCII word boundaries hold, locale maps back
 *    to the right term list.
 *
 * Run: `npm run test:onboarding-tour`
 */
import { strict as assert } from 'node:assert';
import {
	shouldAutoStartOnboardingTour,
	persistTourSeen,
	buildTourSteps,
	ONBOARDING_TOUR_VERSION,
} from '../src/onboarding-tour';
import { highlightTextWithTerms, localeToTourLanguage } from '../src/onboarding-tour-terms';
import type DashboardPlugin from '../src/main';

/** A plugin stand-in covering exactly the surface buildTourSteps touches at
 *  definition time (closures are never invoked here — the runner does that
 *  in the real app). */
const makePlugin = (seenVersion = '') => {
	const plugin = {
		settings: {
			workspaceFiles: ['board', 'classic'],
			dashboardFile: 'board',
			onboardingTourSeenVersion: seenVersion,
		},
		saves: 0,
		async saveSettings(): Promise<void> {
			plugin.saves += 1;
		},
		dashboardRibbonEl: null,
	};
	return plugin;
};

const CLICK_STEPS = ['tabs', 'pin', 'banner', 'add'] as const;
const LAYOUT_STEPS = ['layoutBanner', 'layoutQuick', 'layoutSidebar', 'layoutBoard'] as const;

const run = (): void => {
	// 1. Auto-start gate: fresh install + desktop + unseen version.
	assert.equal(shouldAutoStartOnboardingTour(true, '', false), true, 'fresh desktop install starts the tour');
	assert.equal(shouldAutoStartOnboardingTour(false, '', false), false, 'upgraders never get the auto tour');
	assert.equal(shouldAutoStartOnboardingTour(true, ONBOARDING_TOUR_VERSION, false), false, 'seen version does not re-run');
	assert.equal(shouldAutoStartOnboardingTour(true, '', true), false, 'mobile never auto-runs');

	// 2. persistTourSeen: immutable, persisted once, idempotent.
	const seenPlugin = makePlugin();
	const before = seenPlugin.settings;
	void persistTourSeen(seenPlugin as unknown as DashboardPlugin);
	assert.equal(seenPlugin.saves, 1, 'tour-start persists settings');
	assert.notEqual(seenPlugin.settings, before, 'settings object is replaced, not mutated');
	assert.equal(before.onboardingTourSeenVersion, '', 'original settings object untouched');
	void persistTourSeen(seenPlugin as unknown as DashboardPlugin);
	assert.equal(seenPlugin.saves, 1, 'second persist is a no-op');

	// 3. Step table shape.
	const steps = buildTourSteps(makePlugin() as unknown as DashboardPlugin);
	assert.deepEqual(
		steps.map(s => s.id),
		['welcome', 'open', 'tabs', 'switch', 'pin', 'banner', 'layoutBanner', 'layoutQuick', 'layoutSidebar', 'layoutBoard', 'add', 'done'],
		'step order',
	);
	assert.equal(steps[0]!.centered, true, 'welcome is a centered card');
	assert.equal(steps[steps.length - 1]!.centered, true, 'done is a centered card');
	assert.equal(steps[1]!.advanceOnDashboardActive, true, 'ribbon step advances when the view activates');
	for (const step of steps.slice(1, -1)) {
		assert.equal(typeof step.anchor, 'function', `${step.id} resolves a live anchor`);
	}
	const byId = new Map(steps.map(s => [s.id, s]));
	for (const id of CLICK_STEPS) {
		assert.ok(byId.get(id)!.advanceClickSelector, `${id} advances on a real click`);
	}
	// The board switch is TAUGHT, never performed: the step waits for the
	// user's own pill click (advanceWhen) and skips when there is nothing
	// to switch (skipIf) — no ensure hook, no click-selector shortcut.
	const switchStep = byId.get('switch')!;
	assert.equal(switchStep.advanceClickSelector, undefined, 'switch step has no click shortcut');
	assert.equal(typeof switchStep.skipIf, 'function', 'switch step skips when already classic');
	assert.equal(typeof switchStep.advanceWhen, 'function', 'switch step waits for the user switch');
	assert.equal(switchStep.ensure, undefined, 'switch step never switches anything itself');
	for (const id of LAYOUT_STEPS) {
		assert.equal(byId.get(id)!.advanceClickSelector, undefined, `${id} is a read-only spotlight`);
	}
	assert.equal(typeof byId.get('add')!.onAnchor, 'function', 'add step scrolls its anchor into view');
	assert.equal(byId.get('pin')!.ensure, undefined, 'pin step no longer auto-switches boards');

	// 4. Term highlighter.
	assert.equal(highlightTextWithTerms('<b>&</b>', []), '&lt;b&gt;&amp;&lt;/b&gt;', 'html is escaped before wrapping');
	assert.ok(
		highlightTextWithTerms('左侧是小组件栏', ['小组件']).includes('<span class="apex-tour-term">小组件</span>'),
		'terms are wrapped in the accent span',
	);
	const zhWrapped = highlightTextWithTerms('切到普通工作台再回工作台', ['工作台', '普通工作台']);
	assert.equal((zhWrapped.match(/apex-tour-term/g) ?? []).length, 2, 'longest term wins over its substring');
	assert.ok(zhWrapped.includes('<span class="apex-tour-term">普通工作台</span>'), 'the full phrase is one span');
	assert.equal(
		highlightTextWithTerms('unpinned, it tucks away', ['pin']).includes('apex-tour-term'),
		false,
		'word boundary: pin does not match inside unpinned',
	);
	assert.ok(
		highlightTextWithTerms('Toggle the Settings', ['settings']).includes('apex-tour-term'),
		'latin terms match case-insensitively',
	);
	assert.equal(localeToTourLanguage('zh-CN'), 'zh', 'mainland locale maps to zh terms');
	assert.equal(localeToTourLanguage('zh-TW'), 'zh-TW', 'traditional locale maps to zh-TW terms');
	assert.equal(localeToTourLanguage('pt-BR'), 'pt-BR', 'pt-BR keeps its own terms');
	assert.equal(localeToTourLanguage('en-US'), 'en', 'unknown locales fall back to en');

	console.log('verify-onboarding-tour: all checks passed');
};

run();
