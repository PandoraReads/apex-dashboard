/**
 * `--db-*` theme variables are declared on `.apex-dashboard-root[data-theme]`,
 * but Obsidian renders Modal dialogs in the body-level modal layer outside that
 * root. Without mirroring the resolved values onto the modal container, every
 * `var(--db-*)` inside a dialog degrades: fallback-less rules resolve to nothing
 * (transparent backgrounds, invisible buttons), stock themes leak their generic
 * fallbacks, and the Appearance Studio overrides (custom colors, radius scale,
 * glass blur — all set inline on the root) never reach dialogs at all.
 *
 * `applyModalTheme` reads the ACTIVE root's computed custom properties — which
 * already reflect the theme, the current light/dark mode, and every user
 * override — and copies them onto the target so all its descendants resolve the
 * same tokens the dashboard itself uses. Call once per dialog, right after the
 * modal's container classes are wired in `onOpen`.
 *
 * Keep the list in sync with the `--db-*` set styles.css declares per theme,
 * minus the `--db-aurora-*` background-animation internals (root-only).
 */
const MODAL_THEME_VARS: readonly string[] = [
	'--db-accent', '--db-accent-light',
	'--db-bg', '--db-bg-card', '--db-bg-card-hover', '--db-bg-hover', '--db-bg-hover-strong',
	'--db-bg-section', '--db-bg-sidebar', '--db-bg-input', '--db-bg-banner',
	'--db-bg-btn', '--db-bg-btn-hover', '--db-bg-add-section', '--db-bg-overlay',
	'--db-bg-modal', '--db-bg-modal-raised',
	'--db-bg-drop-indicator',
	'--db-text', '--db-text-muted', '--db-text-faint',
	'--db-text-inverse', '--db-text-inverse-muted',
	'--db-border', '--db-border-card', '--db-border-section', '--db-border-sidebar',
	'--db-border-input', '--db-border-input-focus', '--db-border-btn', '--db-border-add-section',
	'--db-radius-sm', '--db-radius-md', '--db-radius-lg',
	'--db-danger', '--db-font', '--db-backdrop-blur',
	'--db-shadow-card', '--db-shadow-card-hover',
	'--db-link', '--db-checkbox', '--db-quote-border',
	'--db-progress-from', '--db-progress-to',
	// Obsidian core field paint, re-anchored on the root (styles.css): mirror
	// it too so core input[type]/:hover rules inside body-level dialogs paint
	// the dashboard's input token instead of the Obsidian appearance's form-
	// field color (white under Minimal light).
	'--background-modifier-form-field', '--background-modifier-form-field-hover',
];

/**
 * Resolve the dashboard root a body-level dialog should mirror. Several roots
 * can be mounted at once (the dashboard view plus the standalone material
 * library view, or several boards); `querySelector` returns whichever comes
 * first in document order — typically the dashboard, which stays mounted as a
 * hidden background tab after the user switches to the material view. Opening
 * the material settings then mirrored the DASHBOARD's tokens, so a dark
 * immersive board painted the material dialog dark. Preference order:
 *
 *  1. the root holding keyboard focus (the view the user just acted in),
 *  2. a VISIBLE root inside the active workspace leaf,
 *  3. any visible root (hidden background tabs are `display: none`),
 *  4. the document-order first root (single-board setups, hidden windows).
 */
export function activeDashboardRoot(doc: Document = activeDocument): HTMLElement | null {
	// Plain-object test stubs expose only querySelector — degrade to the
	// single-root path there (real documents always have querySelectorAll).
	const roots = typeof doc.querySelectorAll === 'function'
		? Array.from(doc.querySelectorAll<HTMLElement>('.apex-dashboard-root'))
		: [doc.querySelector<HTMLElement>('.apex-dashboard-root')].filter((el): el is HTMLElement => el !== null);
	if (roots.length <= 1) return roots[0] ?? null;
	// Node test bundles have no DOM globals — the focus probe is renderer-only.
	const focusTarget = doc.activeElement;
	if (focusTarget && typeof HTMLElement !== 'undefined' && focusTarget instanceof HTMLElement) {
		const focused = roots.find(root => root === focusTarget || root.contains(focusTarget));
		if (focused) return focused;
	}
	// Stub elements have no layout API — treat them as visible rather than
	// throwing, so modal tests keep exercising the single-root path.
	const isVisible = (root: HTMLElement): boolean =>
		typeof root.getClientRects === 'function' ? root.getClientRects().length > 0 : true;
	const visible = roots.filter(isVisible);
	const pool = visible.length > 0 ? visible : roots;
	return pool.find(root => root.closest('.workspace-leaf.mod-active') !== null) ?? pool[0]!;
}

/**
 * Mirror the active dashboard's resolved `--db-*` tokens onto a dialog element.
 * No-op when no dashboard is open (tokens stay unset; dialogs fall back to their
 * stylesheet defaults). This supersedes the per-modal `inheritDashboardTheme`
 * copies that had drifted across calendar-modal / renderer / stats overlays.
 */
export function applyModalTheme(target: HTMLElement): void {
	const root = activeDashboardRoot();
	if (!root) return;
	// Marker for the modal-layer input-legibility rules (styles.css): every
	// mirrored surface — modals, body-level popovers, floating panels — gets
	// one hook so field text can follow the mirrored --db-text regardless of
	// which board (light or immersive dark-glass) opened it.
	target.addClass('dashboard-themed-surface');
	const computed = getComputedStyle(root);
	for (const name of MODAL_THEME_VARS) {
		const value = computed.getPropertyValue(name).trim();
		if (value) target.style.setProperty(name, value);
	}
}

/**
 * Remove the native modal close button that Obsidian auto-renders in the modal's
 * top-right corner. Obsidian 1.13+ desktop shows it (as `.modal-header-button`;
 * older/mobile builds use `.modal-close-button`), which duplicates the close
 * button our own modal headers already render.
 *
 * Removing the node (rather than CSS `display: none`) keeps it immune to theme
 * specificity fights. Only call this from modals that have their own close
 * control — for modals that rely on the native button, leave it in place.
 */
export function removeNativeModalCloseButton(modalEl: HTMLElement): void {
	// The button is modalEl's first child; query both class names Obsidian has
	// shipped so far to cover version drift.
	modalEl.querySelector(':scope > .modal-header-button, :scope > .modal-close-button')?.remove();
}
