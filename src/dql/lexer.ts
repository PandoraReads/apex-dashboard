import type { Result } from './types';
import { ok, parseError } from './types';

export type TokenType =
	| 'keyword'        // LIST / TABLE / FROM / WHERE / ... (case-insensitive, uppercased)
	| 'identifier'     // bare field/function name
	| 'number'
	| 'string'
	| 'link'           // [[...]]
	| 'tag'            // #tag or #tag/sub
	| 'op'             // operators: + - * / % < <= > >= = != & | ::
	| 'punct'          // ( ) [ ] { } , .
	| 'eof';

export interface Token {
	readonly type: TokenType;
	/** Uppercased for keywords, raw text otherwise. */
	readonly text: string;
	readonly line: number;
	readonly column: number;
}

/** Reserved DQL keywords. Recognized case-insensitively; emitted as `keyword`
 *  with an UPPERCASE `text` so the parser can match by exact string. */
const KEYWORDS = new Set([
	'LIST', 'TABLE', 'TASK', 'CALENDAR', 'HEATMAP',
	'FROM', 'WHERE', 'SORT', 'GROUP', 'BY', 'FLATTEN', 'LIMIT',
	'USING',
	'ASC', 'DESC',
	'AND', 'OR', 'NOT',
	'WITHOUT', 'ID',
	'AS',
	// Boolean/null literals are surfaced as keywords but the parser maps them
	// back to literal values.
	'TRUE', 'FALSE', 'NULL',
	// Temporal pseudo-identifiers handled as keywords so they never collide
	// with user frontmatter keys; the parser converts them to date() calls.
	'TODAY', 'NOW', 'TOMORROW', 'YESTERDAY', 'CURRENT',
]);

const TWO_CHAR_OPS = new Set(['<=', '>=', '!=', '::', '&&', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '!']);

/** Tokenize a DQL query string. Never throws; returns a Result. */
export function tokenize(src: string): Result<Token[]> {
	const tokens: Token[] = [];
	let i = 0;
	let line = 1;
	let col = 1;

	const advance = (n: number): void => {
		for (let k = 0; k < n; k++) {
			const ch = src[i + k];
			if (ch === '\n') { line++; col = 1; } else { col++; }
		}
		i += n;
	};

	const push = (type: TokenType, text: string, startLine: number, startCol: number): void => {
		tokens.push({ type, text, line: startLine, column: startCol });
	};

	while (i < src.length) {
		const ch = src[i]!;
		const startLine = line;
		const startCol = col;

		// Whitespace and commas-as-separators are insignificant; commas are
		// emitted as punct so the parser can use them in arg/field lists.
		if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { advance(1); continue; }

		// Line comments: `// ...` to end of line (DQL supports these).
		if (ch === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') advance(1);
			continue;
		}

		// Wikilink [[target]] or [[target|alias]] or [[target#heading]].
		if (ch === '[' && src[i + 1] === '[') {
			let j = i + 2;
			advance(2);
			let text = '';
			while (j < src.length && !(src[j] === ']' && src[j + 1] === ']')) {
				text += src[j];
				advance(1);
				j++;
			}
			if (j >= src.length) {
				return parseError<Token[]>('Unterminated wikilink "[[...".', startLine, startCol);
			}
			advance(2); // consume "]]"
			push('link', text, startLine, startCol);
			continue;
		}

		// String literals — single OR double quoted. Backslash escapes.
		if (ch === '"' || ch === "'") {
			const quote = ch;
			advance(1);
			let text = '';
			let closed = false;
			while (i < src.length) {
				const c = src[i]!;
				if (c === '\\' && i + 1 < src.length) {
					const next = src[i + 1]!;
					text += next === 'n' ? '\n' : next === 't' ? '\t' : next;
					advance(2);
					continue;
				}
				if (c === quote) { advance(1); closed = true; break; }
				text += c;
				advance(1);
			}
			if (!closed) {
				return parseError<Token[]>(`Unterminated string starting with ${quote}.`, startLine, startCol);
			}
			push('string', text, startLine, startCol);
			continue;
		}

		// Tag source: `#tag` or `#tag/sub`. Emitted as its own token type so the
		// parser's source-atom handler can pick it up unambiguously.
		if (ch === '#') {
			let text = '#';
			advance(1);
			while (i < src.length && isTagPart(src[i]!)) { text += src[i]; advance(1); }
			push('tag', text, startLine, startCol);
			continue;
		}

		// Numbers: integer or decimal. Leading `-` is handled as an operator
		// so the parser can disambiguate subtraction from negation.
		if (isDigit(ch)) {
			let text = '';
			while (i < src.length && isDigit(src[i]!)) { text += src[i]; advance(1); }
			if (src[i] === '.' && isDigit(src[i + 1]!)) {
				text += '.';
				advance(1);
				while (i < src.length && isDigit(src[i]!)) { text += src[i]; advance(1); }
			}
			push('number', text, startLine, startCol);
			continue;
		}

		// Identifiers / keywords. Allow UTF-8 letters so non-latin field names
		// (e.g. Chinese keys) work, matching Dataview's field-name rules.
		if (isIdentStart(ch)) {
			let text = '';
			while (i < src.length && isIdentPart(src[i]!)) { text += src[i]; advance(1); }
			const upper = text.toUpperCase();
			if (KEYWORDS.has(upper)) {
				push('keyword', upper, startLine, startCol);
			} else {
				push('identifier', text, startLine, startCol);
			}
			continue;
		}

		// Two-char operators first, then one-char.
		const two = src.slice(i, i + 2);
		if (TWO_CHAR_OPS.has(two)) { push('op', two, startLine, startCol); advance(2); continue; }
		if (ONE_CHAR_OPS.has(ch)) { push('op', ch, startLine, startCol); advance(1); continue; }

		// Punctuation.
		if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === ',' || ch === '.') {
			push('punct', ch, startLine, startCol);
			advance(1);
			continue;
		}

		return parseError<Token[]>(`Unexpected character "${ch}".`, startLine, startCol);
	}

	tokens.push({ type: 'eof', text: '', line, column: col });
	return ok(tokens);
}

function isDigit(c: string): boolean {
	return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
	if (!c) return false;
	// ASCII letter, underscore. (Numbers handled above.)
	const code = c.charCodeAt(0);
	const asciiAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
	if (asciiAlpha) return true;
	// Non-ASCII → allow (UTF-8 letter-like, incl. CJK).
	return code >= 0x80;
}

function isIdentPart(c: string): boolean {
	if (!c) return false;
	if (isIdentStart(c)) return true;
	const code = c.charCodeAt(0);
	// digits, dash, colon-as-soft-token (we keep `::` as op, so a lone `:` is
	// not valid mid-identifier — users write `my-field` not `my:field`).
	return (code >= 48 && code <= 57) || c === '-' || c === '\\';
}

/** Tag chars: alphanumerics, underscore, dash, slash (for subtags), and emoji. */
function isTagPart(c: string): boolean {
	if (!c) return false;
	if (isIdentPart(c)) return true;
	return c === '/' || c === '.' || c === '+';
}
