import { requestUrl } from 'obsidian';

/**
 * Embeddability precheck for the web section: probe whether a site's response
 * headers would let a browser frame it, so the section can pick iframe vs
 * desktop webview (or a mobile fallback card) instead of rendering a blank
 * frame. All policy logic is pure — the network fetch is an injectable
 * `HeaderFetcher` so verification scripts run without touching the network.
 */

/** Outcome of probing a URL's framing policy. */
export type FrameVerdict = 'allowed' | 'blocked' | 'unknown';

export interface PrecheckResult {
	verdict: FrameVerdict;
	/** Diagnostic only: 'xfo' | 'csp' | 'network' | 'invalid'. */
	reason?: string;
}

/** Confirmed verdicts (allowed/blocked) live a day — a site's framing policy
 *  is stable within a session. Network failures retry much sooner. */
const CONFIRMED_TTL_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 5 * 60 * 1000;

/** Upper bound for one probe: a black-holed connection must not pend forever
 *  (the caller mounts an optimistic iframe meanwhile, so a slow loser is
 *  invisible — but its result should still arrive or expire, not hang). */
const PRECHECK_TIMEOUT_MS = 8000;

const MAX_URL_LENGTH = 2000;

/* ----------------------------- pure helpers ----------------------------- */

/** Trim and add the https:// scheme when the input has none. Inputs that
 *  already carry any scheme (http:, ftp:, …) pass through untouched so
 *  isValidWebUrl can reject non-http ones rather than silently rewriting. */
export function normalizeWebUrl(input: string): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) return '';
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

/** A URL is embeddable-candidate only when it parses, is http(s), has a host,
 *  carries no userinfo, and is not absurdly long. */
export function isValidWebUrl(url: string): boolean {
	if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	if (parsed.hostname.length === 0) return false;
	if (parsed.username.length > 0 || parsed.password.length > 0) return false;
	return true;
}

/** Lower-case header keys and flatten array values, so the classifier never
 *  depends on the platform's header-casing quirks. */
export function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		out[key.toLowerCase()] = Array.isArray(value)
			? value.map(v => String(v)).join(', ')
			: String(value);
	}
	return out;
}

/** Decide from response headers whether a browser would frame this site.
 *
 *  X-Frame-Options DENY/SAMEORIGIN block. ALLOW-FROM is dead (Chromium ignores
 *  it) and Obsidian's iframe origin (app:// or capacitor://localhost) is never
 *  the site's own, so SAMEORIGIN always rejects here — no origin math needed.
 *
 *  CSP frame-ancestors: several policies may be comma-merged into one header;
 *  the strictest one wins, so ANY directive whose source list lacks `*` blocks. */
export function classifyFramePolicy(headers: Record<string, string>): FrameVerdict {
	const xfo = (headers['x-frame-options'] ?? '').trim().toUpperCase();
	if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return 'blocked';

	const csp = headers['content-security-policy'] ?? '';
	const directives = csp.match(/frame-ancestors\s+([^;,]+)/gi) ?? [];
	for (const directive of directives) {
		const sources = directive.replace(/^frame-ancestors\s+/i, '').trim().split(/\s+/);
		if (!sources.includes('*')) return 'blocked';
	}
	return 'allowed';
}

/* ------------------------------- fetcher -------------------------------- */

export type HeaderFetcher = (url: string) => Promise<Record<string, string>>;

/** Default fetcher: requestUrl bypasses CORS and follows redirects, so the
 *  headers seen here are the final response's — the same ones the browser's
 *  frame decision uses. GET rather than HEAD: some servers answer HEAD badly. */
export const requestUrlFetcher: HeaderFetcher = async (url) => {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: { Accept: 'text/html,application/xhtml+xml' },
	});
	return normalizeHeaders(((response as { headers?: Record<string, unknown> }).headers ?? {}));
};

/* -------------------------------- cache --------------------------------- */

const verdictCache = new Map<string, { verdict: FrameVerdict; at: number }>();

/** Cached verdict for a normalized URL, or undefined when absent/expired.
 *  Note: a cached 'unknown' returns 'unknown' — callers distinguish "recently
 *  failed precheck" (frame optimistically) from "never checked" (probe). */
export function getCachedVerdict(url: string): FrameVerdict | undefined {
	const entry = verdictCache.get(url);
	if (!entry) return undefined;
	const ttl = entry.verdict === 'unknown' ? UNKNOWN_TTL_MS : CONFIRMED_TTL_MS;
	if (Date.now() - entry.at > ttl) {
		verdictCache.delete(url);
		return undefined;
	}
	return entry.verdict;
}

/** Drop one URL's verdict (manual refresh re-probes), or the whole cache. */
export function clearPrecheckCache(url?: string): void {
	if (url === undefined) verdictCache.clear();
	else verdictCache.delete(url);
}

/** Probe a URL's framing policy. Never rejects: network errors and probes
 *  exceeding `timeoutMs` resolve to { verdict: 'unknown' } so the caller can
 *  still keep its optimistic iframe attempt.
 *
 *  Concurrent first probes of the same URL may each fetch once — no promise
 *  dedup by design; the verdict cache absorbs everything after the first. */
export async function precheckEmbed(
	url: string,
	fetcher: HeaderFetcher = requestUrlFetcher,
	timeoutMs: number = PRECHECK_TIMEOUT_MS,
): Promise<PrecheckResult> {
	if (!isValidWebUrl(url)) return { verdict: 'unknown', reason: 'invalid' };
	const cached = getCachedVerdict(url);
	if (cached !== undefined) return { verdict: cached };

	// DOM window timer id (the lint rule mandates window.* timers for popout
	// compatibility; number — not Node's Timeout — under the DOM signature).
	let timer: number | undefined;
	try {
		const headers = await Promise.race([
			fetcher(url),
			new Promise<never>((_, reject) => {
				timer = window.setTimeout((): void => reject(new Error('precheck timeout')), timeoutMs);
			}),
		]);
		if (timer !== undefined) window.clearTimeout(timer);
		const verdict = classifyFramePolicy(headers);
		verdictCache.set(url, { verdict, at: Date.now() });
		return {
			verdict,
			reason: verdict === 'blocked' ? (headers['x-frame-options'] !== undefined ? 'xfo' : 'csp') : undefined,
		};
	} catch (err) {
		if (timer !== undefined) window.clearTimeout(timer); // fetch lost the race — cancel the bound
		console.error('[Dashboard] web precheck failed:', url, err);
		verdictCache.set(url, { verdict: 'unknown', at: Date.now() });
		return { verdict: 'unknown', reason: 'network' };
	}
}
