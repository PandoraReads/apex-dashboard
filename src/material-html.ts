/**
 * HTML covers for the material library (素材库): saved web pages and
 * generated reports get a real preview instead of an icon.
 *
 * Two strategies, in order:
 *  1. A declared social image — og:image / twitter:image / first <img> —
 *     which web clips usually carry.
 *  2. A first-screen snapshot: the page (scripts stripped) is wrapped in an
 *     SVG <foreignObject> and loaded as an image data URL. Chromium renders
 *     embedded CSS in that mode, so styled pages keep their look; external
 *     images are not fetched (SVG-in-<img> is a static, no-network mode) and
 *     simply render as their alt/empty boxes.
 *
 * Strategy 2 prefers the platform DOMParser + XMLSerializer (tolerant parse,
 * well-formed output); a regex fallback covers the node test harness.
 */

/** First declared image URL of a page: og:image, twitter:image, then the
 *  first <img src>. '' when the page declares none. */
export function htmlMetaImage(text: string): string {
	const meta = /<meta\s[^>]*>/gi;
	for (const m of text.matchAll(meta)) {
		const tag = m[0];
		const prop = /(?:property|name)\s*=\s*["'](?:og:image|twitter:image(?::src)?)["']/i.exec(tag);
		if (!prop) continue;
		const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
		if (content && content[1]!.trim()) return content[1]!.trim();
	}
	const img = /<img\s[^>]*>/i.exec(text);
	if (img) {
		const src = /src\s*=\s*["']([^"']+)["']/i.exec(img[0]);
		if (src && src[1]!.trim()) return src[1]!.trim();
	}
	return '';
}

const HTML_VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

/** Make a loose HTML fragment XML-safe for embedding inside an SVG: strip
 *  scripts, close void elements, escape bare ampersands. */
export function sanitizeHtmlToXhtml(html: string): string {
	const noScripts = html
		.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
		.replace(/<script[^>]*\/>/gi, '');
	return noScripts
		.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
		.replace(/<([a-z][a-z0-9-]*)((?:\s[^<>]*?)?)(\/?)>/gi, (_all, tag: string, attrs: string, selfClose: string) => {
			if (selfClose === '/') return `<${tag}${attrs}/>`;
			if (HTML_VOID_TAGS.test(tag)) return `<${tag}${attrs}/>`;
			return `<${tag}${attrs}>`;
		});
}

/** Fixed snapshot viewport: wide enough for desktop pages, 4:3 like a first
 * screen. The aspect is known up front — no probe needed. */
export const HTML_SHOT_WIDTH = 1280;
export const HTML_SHOT_HEIGHT = 960;

/** Build the first-screen SVG for an HTML page, or null when the page has no
 * visible body to snapshot. */
export function htmlShotSvg(text: string): string | null {
	let inner: string;
	const Parser = typeof DOMParser === 'undefined' ? undefined : DOMParser;
	if (Parser) {
		try {
			const doc = new Parser().parseFromString(text, 'text/html');
			for (const script of Array.from(doc.querySelectorAll('script'))) script.remove();
			const Serializer = typeof XMLSerializer === 'undefined' ? undefined : XMLSerializer;
			const root = doc.documentElement;
			if (!root || !Serializer) return null;
			const xhtml = new Serializer().serializeToString(root);
			// XMLSerializer emits the XHTML namespace on the root; re-anchor it
			// defensively in case a foreign root slipped through.
			inner = /^<html[^>]*xmlns=/i.test(xhtml)
				? xhtml
				: `<html xmlns="http://www.w3.org/1999/xhtml">${xhtml.replace(/^<html[^>]*>|<\/html\s*>$/gi, '')}</html>`;
		} catch {
			return null;
		}
	} else {
		const styles = (text.match(/<style[\s\S]*?<\/style\s*>/gi) ?? []).join('');
		const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(text);
		if (!bodyMatch) return null;
		const attrs = /<body\b([^>]*)>/i.exec(text);
		inner = `<html xmlns="http://www.w3.org/1999/xhtml"><head>${sanitizeHtmlToXhtml(styles)}</head>` +
			`<body${attrs ? sanitizeHtmlToXhtml(attrs[1]!) : ''}>${sanitizeHtmlToXhtml(bodyMatch[1]!)}</body></html>`;
	}
	if (!inner.includes('<body')) return null;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${HTML_SHOT_WIDTH}" height="${HTML_SHOT_HEIGHT}" viewBox="0 0 ${HTML_SHOT_WIDTH} ${HTML_SHOT_HEIGHT}">` +
		`<foreignObject x="0" y="0" width="${HTML_SHOT_WIDTH}" height="${HTML_SHOT_HEIGHT}">${inner}</foreignObject></svg>`;
}
