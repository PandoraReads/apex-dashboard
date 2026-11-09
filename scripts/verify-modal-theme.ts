import { strict as assert } from 'node:assert';
import { El } from './mini-dom';
import { applyModalTheme, activeDashboardRoot } from '../src/modal-theme';

/**
 * Reproduces the material-settings bug (Rae, 2026-11-09): after switching the
 * dashboard board to an immersive (dark) workspace and then opening the
 * material library view, the material settings dialog painted DARK —
 * `applyModalTheme` mirrored the FIRST `.apex-dashboard-root` in document
 * order, which is the dashboard view (still mounted as a hidden background
 * tab), not the visible material view the user clicked in.
 */

interface LayoutEl extends El {
	getClientRects?: () => number[];
}

function rootEl(cls: string, tokens: Record<string, string>, visible: boolean): LayoutEl {
	const el = new El('div') as LayoutEl;
	el.addClass(...cls.split(/\s+/));
	(el as unknown as { __vars: Record<string, string> }).__vars = tokens;
	el.getClientRects = () => (visible ? [1] : []);
	return el;
}

async function main(): Promise<void> {
	const doc = new El('div');

	// Single root: no ambiguity, tokens mirror through.
	const lone = rootEl('apex-dashboard-root', { '--db-bg': '#101014' }, true);
	doc.appendChild(lone);
	(globalThis as { activeDocument?: unknown }).activeDocument = doc;
	(globalThis as { getComputedStyle?: unknown }).getComputedStyle = (el: unknown): { getPropertyValue: (name: string) => string } => {
		const vars = (el as { __vars?: Record<string, string> }).__vars ?? {};
		return { getPropertyValue: (name: string) => vars[name] ?? '' };
	};
	assert.equal(activeDashboardRoot(), lone as unknown as HTMLElement, 'single root resolves to itself');
	const target = new El('div');
	applyModalTheme(target as unknown as HTMLElement);
	assert.equal(target.hasClass('dashboard-themed-surface'), true, 'mirrored surface is tagged');
	assert.equal(target.style.getPropertyValue('--db-bg'), '#101014');

	// The bug scenario: dashboard root FIRST (document order, hidden background
	// tab after the split's active tab switched away) with immersive dark
	// tokens, material root second and visible with light tokens.
	lone.getClientRects = () => [];
	const material = rootEl('apex-dashboard-root apex-material-root', { '--db-bg': '#ffffff' }, true);
	doc.appendChild(material);
	assert.equal(activeDashboardRoot(), material as unknown as HTMLElement, 'the VISIBLE root wins over the hidden first root');

	const dialog = new El('div');
	applyModalTheme(dialog as unknown as HTMLElement);
	assert.equal(dialog.style.getPropertyValue('--db-bg'), '#ffffff', 'material dialog mirrors the material root, not the hidden immersive one');

	// No root at all: the no-op path (dialog keeps its stylesheet defaults).
	const emptyDoc = new El('div');
	(globalThis as { activeDocument?: unknown }).activeDocument = emptyDoc;
	const plain = new El('div');
	applyModalTheme(plain as unknown as HTMLElement);
	assert.equal(plain.hasClass('dashboard-themed-surface'), false, 'no root -> not even the tag is set');

	console.log('verify-modal-theme: all assertions passed');
}

void main();
