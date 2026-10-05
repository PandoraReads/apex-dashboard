/**
 * Lightweight readability-style main-content extraction for article pages
 * (feeds that ship only a summary). Operates on the html-md node tree, so it
 * shares the "no remote markup into the DOM" stance and runs in plain Node
 * under the verification scripts.
 *
 * Heuristics follow the classic Readability playbook in miniature: score
 * candidate subtrees by text mass times (1 - link density), with bonuses for
 * semantic tags (article/main/[role=main]) and content-ish class names, and
 * penalties for chrome names (nav/sidebar/comment/share/…). Losing pages fall
 * back to <body>, which after tag stripping is still readable text.
 */

import {
	findAllTags,
	findTag,
	nodesToMarkdown,
	parseHtml,
	textOf,
	type HtmlElementNode,
	type HtmlNode,
} from './html-md';

export interface ExtractedArticle {
	title: string;
	markdown: string;
}

/** class/id fragments that mark likely main content. */
const POSITIVE_RE = /(article|post|entry|content|markdown|story|blog|main|body-text)/i;
/** class/id fragments that mark chrome around the content. */
const NEGATIVE_RE = /(comment|sidebar|footer|header|nav|menu|advert|promo|sponsor|related|share|social|widget|pagination|toc|breadcrumb|subscribe|newsletter|popup|modal)/i;
/** Tags never worth keeping inside a chosen candidate. */
const STRIP_INNER_TAGS = new Set([
	'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'form',
	'button', 'input', 'select', 'textarea', 'nav', 'aside', 'template',
]);

/** Minimum stripped-text length for a page to count as extracted at all. */
const MIN_EXTRACT_CHARS = 80;
/** Candidates below this text mass are not worth scoring. */
const MIN_CANDIDATE_CHARS = 180;

function attr(node: HtmlElementNode, name: string): string {
	return node.attrs[name] ?? '';
}

function classIdHint(node: HtmlElementNode): string {
	return `${attr(node, 'class')} ${attr(node, 'id')}`;
}

/** Total text length inside a subtree. */
function textLen(nodes: HtmlNode[]): number {
	return textOf(nodes).replace(/\s+/g, '').length;
}

/** Share of a subtree's text that lives inside <a> elements (0..1). */
function linkDensity(node: HtmlElementNode): number {
	const total = textLen([node]);
	if (total === 0) return 1;
	const links = findAllTags([node], 'a');
	let linked = 0;
	for (const a of links) linked += textLen([a]);
	return Math.min(1, linked / total);
}

/** Collect element nodes in document order (self-inclusive). */
function allElements(nodes: HtmlNode[]): HtmlElementNode[] {
	const out: HtmlElementNode[] = [];
	const walk = (list: HtmlNode[]): void => {
		for (const node of list) {
			if (node.type !== 'element') continue;
			out.push(node);
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

/** Page title: og:title > <title> (site suffix trimmed) > first h1. */
function pageTitle(nodes: HtmlNode[]): string {
	const meta = allElements(nodes).find(node =>
		node.tag === 'meta'
		&& (attr(node, 'property').toLowerCase() === 'og:title' || attr(node, 'name').toLowerCase() === 'twitter:title'),
	);
	const metaTitle = meta ? attr(meta, 'content').trim() : '';
	if (metaTitle) return metaTitle;

	const titleTag = findTag(nodes, 'title');
	if (titleTag) {
		const raw = textOf([titleTag]);
		// "Article Title | Site" / "Site — Article Title": keep the longest
		// segment, which is nearly always the headline itself.
		const segments = raw.split(/\s+[|·•—–]\s+/).map(s => s.trim()).filter(Boolean);
		const best = segments.sort((a, b) => b.length - a.length)[0];
		if (best) return best;
	}

	const h1 = findTag(nodes, 'h1');
	if (h1) {
		const text = textOf([h1]);
		if (text) return text;
	}
	return '';
}

/** Recursively drop nodes that are chrome: strip tags and negative names. */
function pruneChrome(nodes: HtmlNode[]): HtmlNode[] {
	const out: HtmlNode[] = [];
	for (const node of nodes) {
		if (node.type === 'text') {
			out.push(node);
			continue;
		}
		if (STRIP_INNER_TAGS.has(node.tag)) continue;
		if (node.tag !== 'body' && NEGATIVE_RE.test(classIdHint(node))) continue;
		out.push({ ...node, children: pruneChrome(node.children) });
	}
	return out;
}

/** Pick the highest-scoring content candidate, or null when none qualifies. */
function pickCandidate(root: HtmlElementNode): HtmlElementNode | null {
	let best: HtmlElementNode | null = null;
	let bestScore = 0;
	for (const node of allElements([root])) {
		if (node === root) continue;
		const len = textLen([node]);
		if (len < MIN_CANDIDATE_CHARS) continue;
		const hint = classIdHint(node);
		let score = len * (1 - linkDensity(node));
		if (node.tag === 'article' || node.tag === 'main' || attr(node, 'role').toLowerCase() === 'main') score += len * 0.5;
		if (POSITIVE_RE.test(hint)) score += len * 0.3;
		if (NEGATIVE_RE.test(hint)) score *= 0.3;
		if (node.tag === 'nav' || node.tag === 'aside' || node.tag === 'footer' || node.tag === 'header') score *= 0.2;
		if (score > bestScore) {
			bestScore = score;
			best = node;
		}
	}
	return best;
}

/**
 * Extract an article's title and main-content Markdown from a page's HTML.
 * Returns null when the page yields too little text to be worth showing
 * (callers fall back to the feed summary + an open-in-browser affordance).
 */
export function extractArticle(html: string, baseUrl?: string): ExtractedArticle | null {
	const nodes = parseHtml(html);
	const body = findTag(nodes, 'body');
	const root: HtmlNode[] = body ? body.children : nodes;

	const title = pageTitle(nodes);
	const cleaned = pruneChrome(root);

	const candidate = pickCandidate({ type: 'element', tag: '#root', attrs: {}, children: cleaned });
	const chosen = candidate ? candidate.children : cleaned;

	// The page's own h1 usually repeats the extracted title; the reader modal
	// and the saved note both show the title already.
	const markdown = nodesToMarkdown(chosen, { baseUrl, skipFirstHeading: title.length > 0 });
	if (markdown.replace(/\s+/g, '').length < MIN_EXTRACT_CHARS) return null;
	return { title, markdown };
}
