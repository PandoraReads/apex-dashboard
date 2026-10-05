/**
 * Minimal self-contained HTML -> Markdown pipeline (zero dependencies).
 *
 * The dashboard's security stance is "never innerHTML": remote article HTML
 * (RSS full-text content, extracted web pages) is parsed here into a plain
 * node tree, re-serialized as Markdown text, and rendered through Obsidian's
 * MarkdownRenderer — so no remote markup ever reaches the DOM directly.
 *
 * This is deliberately NOT a full HTML5 parser. RSS article HTML is mostly
 * well-formed; the tokenizer is lenient (stray close tags ignored, unclosed
 * tags fall off the stack at the end) because fidelity of *text* matters more
 * than fidelity of *structure*. Everything is pure string/array work, so
 * verification scripts exercise the whole pipeline in Node (see
 * scripts/verify-rss-parse.ts).
 */

/** A parsed element node. Void elements (br, img, …) simply have no children. */
export interface HtmlElementNode {
	type: 'element';
	tag: string;
	attrs: Record<string, string>;
	children: HtmlNode[];
}

/** A decoded text node (entities already resolved, whitespace collapsed later). */
export interface HtmlTextNode {
	type: 'text';
	text: string;
}

export type HtmlNode = HtmlElementNode | HtmlTextNode;

/** Elements that never take a closing tag. */
const VOID_TAGS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements dropped entirely at serialization time (no output, no children). */
const STRIP_TAGS = new Set([
	'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'object', 'embed',
	'form', 'button', 'input', 'select', 'textarea', 'template', 'link', 'meta',
]);

/** Elements that force a paragraph boundary around their rendered content. */
const BLOCK_TAGS = new Set([
	'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div',
	'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
	'h4', 'h5', 'h6', 'header', 'hr', 'legend', 'li', 'main', 'nav', 'ol', 'p',
	'pre', 'section', 'summary', 'table', 'ul',
]);

/* ---------------------------- entity decoding ---------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
	hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
	ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
	copy: '©', reg: '®', trade: '™', deg: '°',
	middot: '·', bull: '•', dagger: '†', prime: '′',
	times: '×', divide: '÷', plusmn: '±', minus: '−',
	frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
	agrave: 'à', aacute: 'á', eacute: 'é', egrave: 'è',
	ecirc: 'ê', ccedil: 'ç', uuml: 'ü', ouml: 'ö',
	auml: 'ä', ntilde: 'ñ', szlig: 'ß',
	iexcl: '¡', iquest: '¿', para: '¶', sect: '§', shy: '',
	ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
};

/** Decode the common named entities plus decimal/hex numeric references. */
export function decodeHtmlEntities(input: string): string {
	if (!input.includes('&')) return input;
	return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
		if (body.startsWith('#')) {
			const hex = body[1] === 'x' || body[1] === 'X';
			const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
			try {
				return String.fromCodePoint(code);
			} catch {
				return whole;
			}
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named !== undefined ? named : whole;
	});
}

/* ------------------------------- tokenizer ------------------------------- */

interface Token {
	kind: 'open' | 'close' | 'text' | 'comment';
	tag?: string;
	attrs?: Record<string, string>;
	text?: string;
	selfClosing?: boolean;
}

const ATTR_NAME_RE = /[^\s=/>]+/;

/** Parse one tag's attributes starting after the tag name. Lenient: unquoted,
 *  single- and double-quoted values all parse; a value-less name is ''. */
function parseAttrs(src: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let i = 0;
	while (i < src.length) {
		// skip whitespace and stray slashes
		while (i < src.length && /[\s/]/.test(src[i]!)) i++;
		if (i >= src.length) break;
		const nameStart = i;
		while (i < src.length && !/[\s=/>]/.test(src[i]!)) i++;
		if (i === nameStart) { i++; continue; }
		const name = src.slice(nameStart, i).toLowerCase();
		while (i < src.length && /\s/.test(src[i]!)) i++;
		let value = '';
		if (src[i] === '=') {
			i++;
			while (i < src.length && /\s/.test(src[i]!)) i++;
			const quote = src[i];
			if (quote === '"' || quote === "'") {
				i++;
				const vStart = i;
				while (i < src.length && src[i] !== quote) i++;
				value = src.slice(vStart, i);
				i++; // closing quote
			} else {
				const vStart = i;
				while (i < src.length && !/[\s>]/.test(src[i]!)) i++;
				value = src.slice(vStart, i);
			}
		}
		attrs[name] = decodeHtmlEntities(value);
	}
	return attrs;
}

/** Scan an HTML string into open/close/text/comment tokens. */
function tokenize(html: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const pushText = (raw: string): void => {
		if (raw.length > 0) tokens.push({ kind: 'text', text: raw });
	};
	while (i < html.length) {
		const lt = html.indexOf('<', i);
		if (lt === -1) {
			pushText(html.slice(i));
			break;
		}
		pushText(html.slice(i, lt));
		if (html.startsWith('<!--', lt)) {
			const end = html.indexOf('-->', lt + 4);
			const stop = end === -1 ? html.length : end + 3;
			tokens.push({ kind: 'comment', text: html.slice(lt, stop) });
			i = stop;
			continue;
		}
		if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
			// doctype / processing instruction: skip to '>'
			const end = html.indexOf('>', lt);
			i = end === -1 ? html.length : end + 1;
			continue;
		}
		if (html.startsWith('</', lt)) {
			const end = html.indexOf('>', lt);
			if (end === -1) { i = html.length; continue; }
			const name = html.slice(lt + 2, end).trim().toLowerCase().split(/[\s/]/)[0] ?? '';
			if (name.length > 0) tokens.push({ kind: 'close', tag: name });
			i = end + 1;
			continue;
		}
		// opening tag: find the '>' that closes it (attrs may contain quoted '>')
		let j = lt + 1;
		let quote: string | null = null;
		while (j < html.length) {
			const ch = html[j]!;
			if (quote !== null) {
				if (ch === quote) quote = null;
			} else if (ch === '"' || ch === "'") {
				quote = ch;
			} else if (ch === '>') {
				break;
			}
			j++;
		}
		if (j >= html.length) { i = html.length; continue; }
		const inner = html.slice(lt + 1, j);
		const nameMatch = ATTR_NAME_RE.exec(inner);
		if (!nameMatch) { i = j + 1; continue; }
		const tag = nameMatch[0].toLowerCase();
		const selfClosing = inner.trimEnd().endsWith('/');
		tokens.push({
			kind: 'open',
			tag,
			attrs: parseAttrs(inner.slice(nameMatch[0].length)),
			selfClosing,
		});
		i = j + 1;
	}
	return tokens;
}

/** Parse HTML into a node forest (no single root — fragments are the norm). */
export function parseHtml(html: string): HtmlNode[] {
	const tokens = tokenize(html);
	const root: HtmlNode[] = [];
	// Stack of open element nodes; index 0 is a virtual root replaced below.
	const stack: HtmlElementNode[] = [{ type: 'element', tag: '#root', attrs: {}, children: root }];
	for (const token of tokens) {
		const top = stack[stack.length - 1]!;
		if (token.kind === 'text') {
			top.children.push({ type: 'text', text: decodeHtmlEntities(token.text!) });
			continue;
		}
		if (token.kind === 'comment') continue;
		if (token.kind === 'open') {
			const node: HtmlElementNode = {
				type: 'element',
				tag: token.tag!,
				attrs: token.attrs ?? {},
				children: [],
			};
			top.children.push(node);
			if (!token.selfClosing && !VOID_TAGS.has(node.tag)) stack.push(node);
			continue;
		}
		// close: pop to the matching open tag; a stray closer with no match is
		// ignored (common in hand-written feed HTML).
		const idx = stack.findIndex(node => node.tag === token.tag);
		if (idx > 0) stack.length = idx;
	}
	return root;
}

/* ---------------------------- tree helper APIs --------------------------- */

/** Find the first descendant element with the given tag name. */
export function findTag(nodes: HtmlNode[], tag: string): HtmlElementNode | null {
	for (const node of nodes) {
		if (node.type === 'element') {
			if (node.tag === tag) return node;
			const hit = findTag(node.children, tag);
			if (hit) return hit;
		}
	}
	return null;
}

/** All descendant elements with the given tag name, document order. */
export function findAllTags(nodes: HtmlNode[], tag: string): HtmlElementNode[] {
	const out: HtmlElementNode[] = [];
	const walk = (list: HtmlNode[]): void => {
		for (const node of list) {
			if (node.type !== 'element') continue;
			if (node.tag === tag) out.push(node);
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

/** Concatenated text of a subtree, entities decoded, whitespace collapsed. */
export function textOf(nodes: HtmlNode[]): string {
	let out = '';
	const walk = (list: HtmlNode[]): void => {
		for (const node of list) {
			if (node.type === 'text') out += node.text;
			else walk(node.children);
		}
	};
	walk(nodes);
	return out.replace(/\s+/g, ' ').trim();
}

/** Text content with all markup stripped (for length heuristics). */
export function stripHtmlText(html: string): string {
	return textOf(parseHtml(html));
}

/* ------------------------------ serialization ---------------------------- */

export interface ToMarkdownOptions {
	/** Base for absolutizing relative link/image URLs. */
	baseUrl?: string;
	/** Drop a leading h1 that just repeats the article title (the note's
	 *  filename / modal header already shows it). Default false. */
	skipFirstHeading?: boolean;
}

/** Resolve `url` against `base`; passthrough for absolute/data/anchor URLs. */
function absolutize(url: string, base?: string): string {
	const trimmed = url.trim();
	if (!trimmed || !base) return trimmed;
	if (/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(trimmed)) return trimmed;
	try {
		return new URL(trimmed, base).toString();
	} catch {
		return trimmed;
	}
}

/** Inline rendering context — carries the base URL through the recursion. */
interface Ctx {
	baseUrl?: string;
}

/** Render inline content (text + inline elements) into a markdown string. */
function renderInline(nodes: HtmlNode[], ctx: Ctx): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'text') {
			out += node.text.replace(/\s+/g, ' ');
			continue;
		}
		const { tag, attrs, children } = node;
		switch (tag) {
			case 'br':
				out += '\n';
				break;
			case 'img': {
				const src = absolutize(attrs['src'] ?? '', ctx.baseUrl);
				const alt = textOf(children) || (attrs['alt'] ?? '').trim();
				if (src) out += `![${alt.replace(/[[\]]/g, '')}](${src})`;
				break;
			}
			case 'a': {
				const href = absolutize(attrs['href'] ?? '', ctx.baseUrl);
				const label = renderInline(children, ctx).trim();
				if (href && label) out += `[${label}](${href})`;
				else if (href) out += `<${href}>`;
				else out += label;
				break;
			}
			case 'strong': case 'b': {
				const inner = renderInline(children, ctx).trim();
				if (inner) out += `**${inner}**`;
				break;
			}
			case 'em': case 'i': case 'cite': {
				const inner = renderInline(children, ctx).trim();
				if (inner) out += `*${inner}*`;
				break;
			}
			case 'del': case 's': case 'strike': {
				const inner = renderInline(children, ctx).trim();
				if (inner) out += `~~${inner}~~`;
				break;
			}
			case 'code': {
				// Inline code: keep inner text verbatim (no nested markdown).
				const inner = textOf(children);
				if (inner) out += `\`${inner.replace(/`/g, "'")}\``;
				break;
			}
			case 'mark': {
				const inner = renderInline(children, ctx).trim();
				if (inner) out += `==${inner}==`;
				break;
			}
			default:
				// Unknown inline-ish tags render transparently.
				out += renderInline(children, ctx);
				break;
		}
	}
	return out;
}

/** Render a subtree as markdown block content (paragraphs separated by
 *  blank lines). Block elements emit their own boundaries; loose inline
 *  content between blocks coalesces into a paragraph. */
function renderBlock(nodes: HtmlNode[], ctx: Ctx, listDepth = 0): string {
	const parts: string[] = [];
	let para = '';
	const flushPara = (): void => {
		const text = para.replace(/\s+/g, ' ').trim();
		if (text) parts.push(text);
		para = '';
	};
	for (const node of nodes) {
		if (node.type === 'text') {
			para += node.text;
			continue;
		}
		const { tag, attrs, children } = node;
		if (STRIP_TAGS.has(tag)) continue;
		if (tag === 'hr') {
			flushPara();
			parts.push('---');
			continue;
		}
		if (tag === 'br') {
			para += '\n';
			continue;
		}
		if (tag === 'pre') {
			flushPara();
			parts.push(renderPre(node, ctx));
			continue;
		}
		if (tag === 'blockquote') {
			flushPara();
			const inner = renderBlock(children, ctx, 0).trim();
			if (inner) parts.push(inner.split('\n').map(l => `> ${l}`.trimEnd()).join('\n'));
			continue;
		}
		if (tag === 'ul' || tag === 'ol') {
			flushPara();
			const inner = renderList(node, ctx, listDepth);
			if (inner) parts.push(inner);
			continue;
		}
		if (tag === 'table') {
			flushPara();
			const inner = renderTable(node, ctx);
			if (inner) parts.push(inner);
			continue;
		}
		if (/^h[1-6]$/.test(tag)) {
			flushPara();
			const level = Number(tag[1]);
			const text = renderInline(children, ctx).replace(/\s+/g, ' ').trim();
			if (text) parts.push(`${'#'.repeat(level)} ${text}`);
			continue;
		}
		if (tag === 'li') {
			// A stray li outside a list: render as a bullet.
			flushPara();
			const inner = renderBlock(children, ctx, listDepth).trim();
			if (inner) parts.push(inner.split('\n').map(l => `- ${l}`.trimEnd()).join('\n'));
			continue;
		}
		if (BLOCK_TAGS.has(tag)) {
			// Block container (p, div, article, …): paragraph boundary around
			// its content. Wrapper divs collapse to plain boundaries, and a
			// div-per-paragraph layout (no <p> tags at all) still gets one
			// paragraph per div because div itself is block-level here.
			flushPara();
			const inner = renderBlock(children, ctx, listDepth).trim();
			if (inner) parts.push(inner);
			continue;
		}
		// Inline element flowing inside the current paragraph.
		para += renderInline([node], ctx);
	}
	flushPara();
	return parts.join('\n\n');
}

/** Fenced code block from a <pre>; language from class="language-x". */
function renderPre(pre: HtmlElementNode, ctx: Ctx): string {
	const codeEl = pre.children.find(child => child.type === 'element' && child.tag === 'code') as HtmlElementNode | undefined;
	const langMatch = /(?:^|\s)(?:language|lang)-([\w+-]+)/.exec((codeEl?.attrs['class'] ?? pre.attrs['class'] ?? ''));
	const lang = langMatch ? langMatch[1]! : '';
	// Code text keeps internal formatting (no whitespace collapsing); <br>
	// inside pre reads as a newline.
	const raw: string[] = [];
	const walk = (nodes: HtmlNode[]): void => {
		for (const node of nodes) {
			if (node.type === 'text') raw.push(node.text);
			else if (node.tag === 'br') raw.push('\n');
			else walk(node.children);
		}
	};
	walk(pre.children);
	const body = raw.join('').replace(/\n+$/, '').replace(/^\n+/, '');
	return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** Bullet/ordered list; nested lists indent under their parent item. */
function renderList(list: HtmlElementNode, ctx: Ctx, depth: number): string {
	const lines: string[] = [];
	const ordered = list.tag === 'ol';
	const items = list.children.filter(child => child.type === 'element' && child.tag === 'li') as HtmlElementNode[];
	items.forEach((li, idx) => {
		const marker = ordered ? `${idx + 1}.` : '-';
		const body = renderBlock(li.children, ctx, depth + 1).trim();
		if (!body) return;
		const indented = body.split('\n').map((line, i) => i === 0 ? line : `${'    '.repeat(depth + 1)}${line}`.trimEnd());
		lines.push(`${'    '.repeat(depth)}${marker} ${indented[0]!}`);
		lines.push(...indented.slice(1));
	});
	return lines.join('\n');
}

/** GFM pipe table; the header row is the first <tr> (th cells or not). */
function renderTable(table: HtmlElementNode, ctx: Ctx): string {
	const rows = findAllTags([table], 'tr');
	if (rows.length === 0) return '';
	// Cell extraction walks each row's children in document order (a row may
	// mix th/td or nest them in wrapper markup).
	const cellsOf = (tr: HtmlElementNode): string[] => {
		const out: string[] = [];
		for (const child of tr.children) {
			if (child.type !== 'element') continue;
			if (child.tag === 'td' || child.tag === 'th') {
				out.push(renderInline(child.children, ctx).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
			} else {
				out.push(...cellsOf(child));
			}
		}
		return out;
	};
	const header = cellsOf(rows[0]!);
	if (header.length === 0) return '';
	const body = rows.slice(1).map(cellsOf).filter(cells => cells.length > 0);
	const width = Math.max(header.length, ...body.map(cells => cells.length));
	const pad = (cells: string[]): string[] => {
		const out = [...cells];
		while (out.length < width) out.push('');
		return out.slice(0, width);
	};
	const lines = [
		`| ${pad(header).join(' | ')} |`,
		`| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
		...body.map(cells => `| ${pad(cells).join(' | ')} |`),
	];
	return lines.join('\n');
}

/**
 * Serialize an already-parsed node forest to Markdown (htmlToMarkdown's core;
 * exposed so extraction code that already holds a pruned tree can skip the
 * parse step).
 */
export function nodesToMarkdown(nodes: HtmlNode[], opts?: ToMarkdownOptions): string {
	const ctx: Ctx = { baseUrl: opts?.baseUrl };
	let out = renderBlock(nodes, ctx);
	if (opts?.skipFirstHeading) {
		// A leading h1/h2 usually repeats the article title, which the note's
		// filename / modal header already carries — drop exactly one.
		out = out.replace(/^#{1,2}[^\n]*\n+/, '');
	}
	return out
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

/**
 * Convert an HTML fragment or document to Markdown. When the markup contains
 * a <body>, only its children are serialized (page chrome drops away).
 */
export function htmlToMarkdown(html: string, opts?: ToMarkdownOptions): string {
	let nodes = parseHtml(html);
	const body = findTag(nodes, 'body');
	if (body) nodes = body.children;
	// A full document's <head> (title/meta/style) never survives as content.
	nodes = nodes.filter(node => node.type !== 'element' || node.tag !== 'head');
	return nodesToMarkdown(nodes, opts);
}
