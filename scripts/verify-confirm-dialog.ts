import { strict as assert } from 'node:assert';
import { El } from './mini-dom';
import { showConfirmDialog } from '../src/confirm-dialog';

// Confirm dialog keyboard handling. Regression: the dialog never claimed
// focus, so the page button that opened it kept DOM focus and every Enter
// press re-opened another half-black overlay (screen darkened press by press).

/** Minimal activeDocument stand-in: body host + tracked keydown listeners. */
function makeDocument(): {
	doc: {
		body: El;
		addEventListener: (type: string, fn: (e: unknown) => void) => void;
		removeEventListener: (type: string, fn: (e: unknown) => void) => void;
	};
	press: (key: string, opts?: { target?: El; isComposing?: boolean }) => { prevented: boolean };
	listenerCount: () => number;
} {
	const listeners = new Map<string, Array<(e: unknown) => void>>();
	const doc = {
		body: new El('body'),
		// applyModalTheme probes for the dashboard root; none here (no-op).
		querySelector: (): null => null,
		addEventListener: (type: string, fn: (e: unknown) => void): void => {
			const list = listeners.get(type) ?? [];
			list.push(fn);
			listeners.set(type, list);
		},
		removeEventListener: (type: string, fn: (e: unknown) => void): void => {
			const list = (listeners.get(type) ?? []).filter(f => f !== fn);
			listeners.set(type, list);
		},
	};
	const press = (key: string, opts?: { target?: El; isComposing?: boolean }): { prevented: boolean } => {
		const result = { prevented: false };
		for (const fn of [...listeners.get('keydown') ?? []]) {
			fn({
				type: 'keydown',
				key,
				target: opts?.target ?? doc.body,
				isComposing: opts?.isComposing ?? false,
				preventDefault: () => { result.prevented = true; },
				stopPropagation: () => {},
			});
		}
		return result;
	};
	const listenerCount = (): number => (listeners.get('keydown') ?? []).length;
	return { doc, press, listenerCount };
}

/** The dialog card element: body > overlay > card. */
const cardOf = (doc: { body: El }): El => doc.body.children[0]!.children[0]!;

/** Promise state probe: null while pending, the value once settled. */
function spy<T>(promise: Promise<T>): { value: T | null } {
	const state = { value: null as T | null };
	void promise.then(v => { state.value = v; });
	return state;
}

async function main(): Promise<void> {
	// 1. The original bug: Enter while focus sits OUTSIDE the dialog (on the
	//    page button that opened it) must resolve the dialog — and the event's
	//    default activation of that button must be suppressed — instead of
	//    letting it re-open another overlay.
	{
		const { doc, press, listenerCount } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const opener = new El('button'); // still-focused section delete button
		const promise = showConfirmDialog(null, { title: 'T', message: 'M' });
		assert.equal(doc.body.children.length, 1, '1: overlay on body');
		assert.equal(listenerCount(), 1, '1: one keydown listener');

		const hit = press('Enter', { target: opener });
		assert.equal(await promise, false, '1: destructive default = cancel (safe)');
		assert.equal(hit.prevented, true, '1: native re-activation of the page button suppressed');
		assert.equal(doc.body.children.length, 0, '1: overlay removed — no stacking');
		assert.equal(listenerCount(), 0, '1: listener detached');
	}

	// 2. Non-destructive confirms: Enter outside the dialog confirms (OK).
	{
		const { doc, press } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const promise = showConfirmDialog(null, { title: 'T', message: 'M', destructive: false });
		const hit = press('Enter');
		assert.equal(await promise, true, '2: plain confirm default = OK');
		assert.equal(hit.prevented, true, '2: default suppressed');
		assert.equal(doc.body.children.length, 0, '2: overlay removed');
	}

	// 3. Enter landing inside the dialog (a focused button/card) is left to
	//    the native activation — the handler must not force a resolution.
	{
		const { doc, press } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const state = spy(showConfirmDialog(null, { title: 'T', message: 'M' }));
		const hit = press('Enter', { target: cardOf(doc) });
		assert.equal(hit.prevented, false, '3: in-dialog Enter not intercepted');
		await new Promise(r => setTimeout(r, 5));
		assert.equal(state.value, null, '3: dialog still open (native click handles it)');
		press('Escape');
		await new Promise(r => setTimeout(r, 5));
		assert.equal(state.value, false, '3: escape closes');
	}

	// 4. Escape still cancels, removes the overlay, and detaches the listener.
	{
		const { doc, press, listenerCount } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const promise = showConfirmDialog(null, { title: 'T', message: 'M' });
		press('Escape');
		assert.equal(await promise, false, '4: escape cancels');
		assert.equal(doc.body.children.length, 0, '4: overlay removed');
		assert.equal(listenerCount(), 0, '4: listener detached');
	}

	// 5. Button clicks resolve exactly once and clean up (no listener leak —
	//    a leaked Enter handler would swallow every later Enter page-wide).
	{
		const { doc, press, listenerCount } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const promise = showConfirmDialog(null, { title: 'T', message: 'M', destructive: false });
		const actions = cardOf(doc).children[cardOf(doc).children.length - 1]!;
		const confirmBtn = actions.children[1]!;
		confirmBtn.click();
		assert.equal(await promise, true, '5: confirm click resolves true');
		const stray = press('Enter');
		assert.equal(stray.prevented, false, '5: no live listener after close');
		assert.equal(doc.body.children.length, 0, '5: overlay gone');
		assert.equal(listenerCount(), 0, '5: listener detached');
	}

	// 6. IME mid-composition Enter is ignored (no accidental confirm).
	{
		const { doc, press } = makeDocument();
		(globalThis as Record<string, unknown>).activeDocument = doc;
		const state = spy(showConfirmDialog(null, { title: 'T', message: 'M', destructive: false }));
		const opener = new El('button');
		const hit = press('Enter', { target: opener, isComposing: true });
		assert.equal(hit.prevented, false, '6: composing Enter ignored');
		await new Promise(r => setTimeout(r, 5));
		assert.equal(state.value, null, '6: dialog still open');
		press('Escape');
		await new Promise(r => setTimeout(r, 5));
		assert.equal(state.value, false, '6: escape still closes');
	}

	console.log('verify-confirm-dialog: 6 scenarios OK');
}

void main();
