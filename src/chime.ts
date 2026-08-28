/**
 * Shared "ding" chime for the pomodoro and reading timers.
 *
 * Web Audio starts every AudioContext in `suspended` state outside a user
 * gesture on gesture-gated platforms (mobile WebViews, browser Chromium).
 * The context never self-resumes: the old per-beep `new AudioContext()` was
 * therefore silent on phones and fragile everywhere else. This module keeps
 * one cached context, arms a cheap gesture listener that resumes it, and
 * retries `resume()` at play time so a chime after an audio interruption
 * (phone call, Siri) heals on the next tap.
 */

let ctx: AudioContext | null = null;
let armed = false;

function context(): AudioContext | null {
	if (!ctx) {
		try {
			ctx = new AudioContext();
		} catch {
			return null;
		}
	}
	return ctx;
}

/** Resume the cached context if it is suspended. No-op when running. */
function resumeIfSuspended(): void {
	const ac = context();
	if (ac?.state === 'suspended') void ac.resume().catch(() => {});
}

/**
 * Arm the one-time-cost gesture unlock on a document. The capture-phase
 * listeners stay attached (one state check per pointerdown) so a context
 * re-suspended by an interruption heals on the next tap.
 */
export function unlockChime(doc: Document): void {
	if (armed) return;
	armed = true;
	doc.addEventListener('pointerdown', resumeIfSuspended, true);
	doc.addEventListener('keydown', resumeIfSuspended, true);
}

/** Bell partials: near-harmonic with one inharmonic splash. The metallic
 * "ting" comes from the upper partials decaying much faster than the
 * fundamental, leaving a pure tail — the shape of a struck small bell. */
const PARTIALS: readonly { ratio: number; gain: number; decay: number }[] = [
	{ ratio: 1.0, gain: 1.0, decay: 1.1 },
	{ ratio: 2.0, gain: 0.45, decay: 0.65 },
	{ ratio: 3.01, gain: 0.2, decay: 0.35 },
	{ ratio: 4.47, gain: 0.08, decay: 0.2 },
];

/** Play one bell-like "ding" at the given fundamental. */
export function playDing(fundamentalHz: number, masterGain = 0.22): void {
	const ac = context();
	if (!ac) return;
	resumeIfSuspended();

	const t0 = ac.currentTime;
	const master = ac.createGain();
	master.gain.value = masterGain;
	master.connect(ac.destination);

	for (const p of PARTIALS) {
		const osc = ac.createOscillator();
		const gain = ac.createGain();
		osc.type = 'sine';
		osc.frequency.value = fundamentalHz * p.ratio;
		// 2ms linear attack avoids the click of an instant-on partial.
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.linearRampToValueAtTime(p.gain, t0 + 0.002);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.decay);
		osc.connect(gain);
		gain.connect(master);
		osc.start(t0);
		osc.stop(t0 + p.decay);
	}
}
