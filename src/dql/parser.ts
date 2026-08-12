import type {
	BinOp, DataCommand, Expression, FieldSpec, FromAtom, FromClause,
	Query, QueryType, Result, SortKey,
} from './types';
import { fail, ok, parseError } from './types';
import type { Token } from './lexer';
import { tokenize } from './lexer';
import { makeDate, makeDuration, makeLink, makeObject } from './values';

/**
 * Recursive-descent DQL parser. Produces a {@link Query} AST or a parse error.
 * Grammar (simplified):
 *   query        := queryType (withoutId)? (fieldList)? from? command* (calendarField)?
 *   from         := FROM source
 *   source       := sourceTerm (('AND'|'&' | 'OR'|'|') sourceTerm)*
 *                 | sourceTerm 'AND' 'NOT' sourceTerm
 *   command      := WHERE expr | SORT sortKey (',' sortKey)* | GROUP BY expr (AS str)?
 *                 | FLATTEN expr (AS str)? | LIMIT expr
 *   expr         := precedence-climbing over binary/unary operators (see parseBinary)
 */
export function parseQuery(src: string): Result<Query> {
	const lexed = tokenize(src);
	if (!lexed.ok) return lexed;
	return new Parser(lexed.value).parse();
}

/* ----------------------------- parser core ----------------------------- */

/** Operator precedence for the precedence-climbing expression parser.
 *  Higher binds tighter. `and`/`or` are lower than comparisons. */
const PRECEDENCE: Record<string, number> = {
	'or': 1, '|': 1,
	'and': 2, '&': 2,
	'=': 3, '!=': 3,
	'<': 4, '<=': 4, '>': 4, '>=': 4,
	'+': 5, '-': 5,
	'*': 6, '/': 6, '%': 6,
};

class Parser {
	private readonly tokens: Token[];
	private pos = 0;

	constructor(tokens: Token[]) { this.tokens = tokens; }

	parse(): Result<Query> {
		const queryType = this.parseQueryType();
		if (!queryType.ok) return queryType;

		const withoutId = this.consumeWithoutId();
		const fields = this.parseFieldList(queryType.value);
		if (!fields.ok) return fields;

		// CALENDAR's date field sits BETWEEN the query type and FROM
		// (e.g. `CALENDAR file.cday FROM ...`). Parse it here, before FROM.
		let calendarField: Expression | undefined;
		if (queryType.value === 'CALENDAR' && this.peek().type !== 'eof'
			&& !(this.peek().type === 'keyword' && this.peek().text === 'FROM')) {
			const cf = this.parseExpression(0);
			if (!cf.ok) return cf;
			calendarField = cf.value;
		}

		const from = this.parseFrom();
		if (!from.ok) return from;

		const commands: DataCommand[] = [];
		let limitSeen = false;
		for (;;) {
			const cmd = this.peekCommand();
			if (!cmd) break;
			if (cmd === 'limit') {
				if (limitSeen) return parseError<Query>('Duplicate LIMIT clause.');
				limitSeen = true;
			}
			const parsed = this.parseCommand(cmd);
			if (!parsed.ok) return parsed;
			commands.push(parsed.value);
		}

		const got = this.peek();
		if (got.type !== 'eof') {
			return parseError<Query>(`Unexpected token "${got.text}".`, got.line, got.column);
		}

		return ok<Query>({
			queryType: queryType.value,
			fields: fields.value,
			withoutId,
			from: from.value,
			commands,
			calendarField,
		});
	}

	/* ----------------------------- query type + fields ----------------------------- */

	private parseQueryType(): Result<QueryType> {
		const tok = this.peek();
		if (tok.type === 'keyword' && (tok.text === 'LIST' || tok.text === 'TABLE' || tok.text === 'TASK' || tok.text === 'CALENDAR')) {
			this.advance();
			return ok<QueryType>(tok.text);
		}
		if (tok.type === 'eof') return parseError<QueryType>('Query must start with LIST, TABLE, TASK, or CALENDAR.');
		return parseError<QueryType>(`Expected a query type (LIST/TABLE/TASK/CALENDAR) but found "${tok.text}".`, tok.line, tok.column);
	}

	private consumeWithoutId(): boolean {
		const saved = this.pos;
		if (this.peek().type === 'keyword' && this.peek().text === 'WITHOUT') {
			this.advance();
			const idTok = this.peek();
			if (idTok.type === 'keyword' && idTok.text === 'ID') {
				this.advance();
				return true;
			}
			this.pos = saved; // not a valid WITHOUT ID; rewind
		}
		return false;
	}

	/** TABLE fields / LIST field / TASK none / CALENDAR none. */
	private parseFieldList(queryType: QueryType): Result<FieldSpec[]> {
		if (queryType === 'TABLE' || queryType === 'LIST') {
			if (this.startsFieldList()) {
				return this.parseFieldSpecs(queryType === 'TABLE');
			}
		}
		return ok<FieldSpec[]>([]);
	}

	/** A field list begins with a token that can open an expression but is NOT
	 *  a command keyword or FROM. */
	private startsFieldList(): boolean {
		const tok = this.peek();
		if (tok.type === 'eof') return false;
		if (tok.type === 'keyword') {
			return tok.text === 'FROM' ? false : !this.isCommandKeyword(tok.text);
		}
		return true;
	}

	private parseFieldSpecs(allowMultiple: boolean): Result<FieldSpec[]> {
		const fields: FieldSpec[] = [];
		for (;;) {
			const expr = this.parseExpression(0);
			if (!expr.ok) return expr;
			const alias = this.consumeAlias();
			fields.push({ expr: expr.value, alias });
			if (!allowMultiple) break;
			if (this.peek().type === 'punct' && this.peek().text === ',') {
				this.advance();
				continue;
			}
			break;
		}
		return ok(fields);
	}

	private consumeAlias(): string | undefined {
		const tok = this.peek();
		if (tok.type === 'keyword' && tok.text === 'AS') {
			this.advance();
			const name = this.peek();
			if (name.type === 'string') { this.advance(); return name.text; }
			if (name.type === 'identifier') { this.advance(); return name.text; }
			return undefined; // tolerate missing alias; recover silently
		}
		return undefined;
	}

	/* ----------------------------- FROM ----------------------------- */

	private parseFrom(): Result<FromClause> {
		const tok = this.peek();
		if (!(tok.type === 'keyword' && tok.text === 'FROM')) {
			return ok<FromClause>(null);
		}
		this.advance();
		return this.parseSource();
	}

	/** source := sourceTerm (('AND'|'&') ['NOT'] sourceTerm | ('OR'|'|') sourceTerm)* */
	private parseSource(): Result<FromClause> {
		const first = this.parseSourceTerm();
		if (!first.ok) return first;
		let leftValue: FromClause = first.value;

		for (;;) {
			const tok = this.peek();
			const op = this.sourceOp(tok);
			if (!op) break;
			this.advance();
			const negate = this.peek().type === 'keyword' && this.peek().text === 'NOT';
			if (negate) this.advance();
			const right = this.parseSourceTerm();
			if (!right.ok) return right;
			if (op === 'and' && negate) {
				// `A AND NOT B` → A & !B
				leftValue = { op: 'and', left: leftValue, right: { op: 'not', left: right.value, right: null } };
			} else if (op === 'and') {
				leftValue = { op: 'and', left: leftValue, right: right.value };
			} else {
				leftValue = { op: 'or', left: leftValue, right: right.value };
			}
		}
		return ok<FromClause>(leftValue);
	}

	private sourceOp(tok: Token): 'and' | 'or' | null {
		if (tok.type !== 'keyword' && tok.type !== 'op') return null;
		if (tok.text === 'AND' || tok.text === '&') return 'and';
		if (tok.text === 'OR' || tok.text === '|') return 'or';
		return null;
	}

	private parseSourceTerm(): Result<FromClause> {
		const tok = this.peek();
		// Negation: `NOT sourceTerm` or a leading `-`. (Bare `-` is ambiguous
		// with subtraction in expressions, but FROM sources have no
		// arithmetic, so we accept `-` here.)
		if ((tok.type === 'keyword' && tok.text === 'NOT') || (tok.type === 'op' && tok.text === '-')) {
			this.advance();
			const inner = this.parseSourceTerm();
			if (!inner.ok) return inner;
			return ok<FromClause>({ op: 'not', left: inner.value, right: null });
		}
		if (tok.type === 'punct' && tok.text === '(') {
			this.advance();
			const inner = this.parseSource();
			if (!inner.ok) return inner;
			const close = this.peek();
			if (!(close.type === 'punct' && close.text === ')')) {
				return parseError<FromClause>('Expected ")" to close a FROM group.', close.line, close.column);
			}
			this.advance();
			return inner;
		}

		// Source atoms: folder "Books", tag #tag, link [[Note]], outgoing(...), incoming(...)
		const atom = this.parseSourceAtom();
		if (!atom.ok) return atom;
		return ok<FromClause>(atom.value);
	}

	private parseSourceAtom(): Result<FromAtom> {
		const tok = this.peek();
		// outgoing([[X]]) / incoming([[X]])
		if (tok.type === 'identifier' && (tok.text === 'outgoing' || tok.text === 'incoming')) {
			const fn = tok.text;
			this.advance();
			const open = this.peek();
			if (!(open.type === 'punct' && open.text === '(')) {
				return parseError<FromAtom>(`${fn}( requires "(".`, open.line, open.column);
			}
			this.advance();
			const inner = this.peek();
			if (inner.type !== 'link') {
				return parseError<FromAtom>(`${fn}( requires a [[wikilink]] argument.`, inner.line, inner.column);
			}
			this.advance();
			const close = this.peek();
			if (!(close.type === 'punct' && close.text === ')')) {
				return parseError<FromAtom>(`${fn}( missing ")".`, close.line, close.column);
			}
			this.advance();
			return ok<FromAtom>({ kind: fn, value: inner.text, line: tok.line, column: tok.column });
		}
		// Wikilink source: [[Note]]
		if (tok.type === 'link') {
			this.advance();
			return ok<FromAtom>({ kind: 'link', value: tok.text, line: tok.line, column: tok.column });
		}
		// Tag source: #tag or #tag/sub (lexed as a single 'tag' token).
		if (tok.type === 'tag') {
			this.advance();
			return ok<FromAtom>({ kind: 'tag-subtree', value: tok.text, line: tok.line, column: tok.column });
		}
		// Folder source: quoted string "Books".
		if (tok.type === 'string') {
			this.advance();
			return ok<FromAtom>({ kind: 'folder', value: tok.text, line: tok.line, column: tok.column });
		}
		// Bare identifier in FROM: treated as a tag-subtree (no leading '#').
		if (tok.type === 'identifier') {
			this.advance();
			return ok<FromAtom>({ kind: 'tag-subtree', value: '#' + tok.text, line: tok.line, column: tok.column });
		}
		return parseError<FromAtom>(`Expected a folder, tag, or link in FROM but found "${tok.text}".`, tok.line, tok.column);
	}

	/* ----------------------------- data commands ----------------------------- */

	private isCommandKeyword(text: string): boolean {
		return text === 'WHERE' || text === 'SORT' || text === 'GROUP' || text === 'FLATTEN' || text === 'LIMIT';
	}

	private peekCommand(): string | null {
		const tok = this.peek();
		if (tok.type !== 'keyword') return null;
		if (tok.text === 'WHERE') return 'where';
		if (tok.text === 'SORT') return 'sort';
		if (tok.text === 'GROUP') return 'group-by';
		if (tok.text === 'FLATTEN') return 'flatten';
		if (tok.text === 'LIMIT') return 'limit';
		return null;
	}

	private parseCommand(kind: string): Result<DataCommand> {
		switch (kind) {
			case 'where': {
				this.advance(); // WHERE
				const expr = this.parseExpression(0);
				if (!expr.ok) return expr;
				return ok<DataCommand>({ kind: 'where', expr: expr.value });
			}
			case 'sort': {
				this.advance(); // SORT
				const keys: SortKey[] = [];
				for (;;) {
					const expr = this.parseExpression(0);
					if (!expr.ok) return expr;
					let direction: 'ASC' | 'DESC' = 'ASC';
					const dir = this.peek();
					if (dir.type === 'keyword' && (dir.text === 'ASC' || dir.text === 'DESC')) {
						direction = dir.text === 'DESC' ? 'DESC' : 'ASC';
						this.advance();
					}
					keys.push({ expr: expr.value, direction });
					if (this.peek().type === 'punct' && this.peek().text === ',') { this.advance(); continue; }
					break;
				}
				return ok<DataCommand>({ kind: 'sort', keys });
			}
			case 'group-by': {
				this.advance(); // GROUP
				const by = this.peek();
				if (!(by.type === 'keyword' && by.text === 'BY')) {
					return parseError<DataCommand>('Expected "BY" after "GROUP".', by.line, by.column);
				}
				this.advance();
				const expr = this.parseExpression(0);
				if (!expr.ok) return expr;
				return ok<DataCommand>({ kind: 'group-by', expr: expr.value, alias: this.consumeAlias() });
			}
			case 'flatten': {
				this.advance(); // FLATTEN
				const expr = this.parseExpression(0);
				if (!expr.ok) return expr;
				return ok<DataCommand>({ kind: 'flatten', expr: expr.value, alias: this.consumeAlias() });
			}
			case 'limit': {
				this.advance(); // LIMIT
				const expr = this.parseExpression(0);
				if (!expr.ok) return expr;
				return ok<DataCommand>({ kind: 'limit', expr: expr.value });
			}
		}
		return parseError<DataCommand>(`Unknown command "${kind}".`);
	}

	/* ----------------------------- expressions (precedence climbing) ----------------------------- */

	private parseExpression(minPrec: number): Result<Expression> {
		const first = this.parseUnary();
		if (!first.ok) return first;
		let leftValue: Expression = first.value;

		for (;;) {
			const tok = this.peek();
			const op = this.binaryOp(tok);
			if (!op) break;
			const prec = PRECEDENCE[op] ?? 0;
			if (prec < minPrec) break;
			this.advance();
			const right = this.parseExpression(prec + 1);
			if (!right.ok) return right;
			leftValue = { type: 'binary', op, left: leftValue, right: right.value };
		}
		return ok<Expression>(leftValue);
	}

	private binaryOp(tok: Token): BinOp | null {
		if (tok.type === 'op') {
			if (tok.text === '+' || tok.text === '-' || tok.text === '*' || tok.text === '/' || tok.text === '%') return tok.text;
			if (tok.text === '=' || tok.text === '!=' || tok.text === '<' || tok.text === '<=' || tok.text === '>' || tok.text === '>=') return tok.text;
			if (tok.text === '&') return '&';
			if (tok.text === '|') return '|';
		}
		if (tok.type === 'keyword') {
			if (tok.text === 'AND') return 'and';
			if (tok.text === 'OR') return 'or';
		}
		return null;
	}

	private parseUnary(): Result<Expression> {
		const tok = this.peek();
		if (tok.type === 'op' && tok.text === '-') {
			this.advance();
			const operand = this.parseUnary();
			if (!operand.ok) return operand;
			return ok<Expression>({ type: 'unary', op: 'neg', operand: operand.value });
		}
		if (tok.type === 'op' && tok.text === '!') {
			this.advance();
			const operand = this.parseUnary();
			if (!operand.ok) return operand;
			return ok<Expression>({ type: 'unary', op: 'not', operand: operand.value });
		}
		if (tok.type === 'keyword' && tok.text === 'NOT') {
			this.advance();
			const operand = this.parseUnary();
			if (!operand.ok) return operand;
			return ok<Expression>({ type: 'unary', op: 'not', operand: operand.value });
		}
		return this.parsePrimary();
	}

	private parsePrimary(): Result<Expression> {
		const tok = this.peek();

		// Parenthesized expression.
		if (tok.type === 'punct' && tok.text === '(') {
			this.advance();
			const inner = this.parseExpression(0);
			if (!inner.ok) return inner;
			const close = this.peek();
			if (!(close.type === 'punct' && close.text === ')')) {
				return parseError<Expression>('Expected ")" to close an expression.', close.line, close.column);
			}
			this.advance();
			return this.parsePostfix(inner.value);
		}

		// List literal [a, b, c].
		if (tok.type === 'punct' && tok.text === '[') {
			return this.parseListLiteral();
		}
		// Object literal {a: 1, b: 2}.
		if (tok.type === 'punct' && tok.text === '{') {
			return this.parseObjectLiteral();
		}

		// Literals.
		if (tok.type === 'number') {
			this.advance();
			const num = Number(tok.text);
			return this.parsePostfix({ type: 'literal', value: num, raw: tok.text });
		}
		if (tok.type === 'string') {
			this.advance();
			return this.parsePostfix({ type: 'literal', value: tok.text, raw: tok.text });
		}
		if (tok.type === 'link') {
			this.advance();
			return this.parsePostfix({ type: 'literal', value: makeLink(tok.text) });
		}
		if (tok.type === 'keyword') {
			const lit = this.keywordLiteral(tok);
			if (lit) {
				this.advance();
				return this.parsePostfix(lit);
			}
		}

		// Identifier or function call.
		if (tok.type === 'identifier') {
			this.advance();
			// Function call?
			if (this.peek().type === 'punct' && this.peek().text === '(') {
				return this.parseCall(tok.text, tok.line, tok.column);
			}
			return this.parsePostfix({ type: 'identifier', name: tok.text });
		}

		if (tok.type === 'eof') return parseError<Expression>('Unexpected end of query.');
		return parseError<Expression>(`Unexpected token "${tok.text}" in expression.`, tok.line, tok.column);
	}

	/** Map keyword literals (true/false/null/today/now/...) to expressions. */
	private keywordLiteral(tok: Token): Expression | null {
		switch (tok.text) {
			case 'TRUE': return { type: 'literal', value: true };
			case 'FALSE': return { type: 'literal', value: false };
			case 'NULL': return { type: 'literal', value: null };
			case 'TODAY': return { type: 'call', name: 'date', args: [{ type: 'literal', value: 'today' }] };
			case 'NOW': return { type: 'call', name: 'date', args: [{ type: 'literal', value: 'now' }] };
			case 'TOMORROW': return { type: 'call', name: 'date', args: [{ type: 'literal', value: 'tomorrow' }] };
			case 'YESTERDAY': return { type: 'call', name: 'date', args: [{ type: 'literal', value: 'yesterday' }] };
			default: return null;
		}
	}

	private parseCall(name: string, line: number, column: number): Result<Expression> {
		const open = this.peek();
		if (!(open.type === 'punct' && open.text === '(')) {
			return parseError<Expression>(`Expected "(" after function "${name}".`, line, column);
		}
		this.advance();
		const args: Expression[] = [];
		if (!(this.peek().type === 'punct' && this.peek().text === ')')) {
			for (;;) {
				const arg = this.parseExpression(0);
				if (!arg.ok) return arg;
				args.push(arg.value);
				if (this.peek().type === 'punct' && this.peek().text === ',') { this.advance(); continue; }
				break;
			}
		}
		const close = this.peek();
		if (!(close.type === 'punct' && close.text === ')')) {
			return parseError<Expression>(`Expected ")" to close "${name}(".`, close.line, close.column);
		}
		this.advance();
		return this.parsePostfix({ type: 'call', name, args });
	}

	private parseListLiteral(): Result<Expression> {
		this.advance(); // [
		const elements: Expression[] = [];
		if (!(this.peek().type === 'punct' && this.peek().text === ']')) {
			for (;;) {
				const el = this.parseExpression(0);
				if (!el.ok) return el;
				elements.push(el.value);
				if (this.peek().type === 'punct' && this.peek().text === ',') { this.advance(); continue; }
				break;
			}
		}
		const close = this.peek();
		if (!(close.type === 'punct' && close.text === ']')) {
			return parseError<Expression>('Expected "]" to close a list.', close.line, close.column);
		}
		this.advance();
		return ok<Expression>({ type: 'list', elements });
	}

	private parseObjectLiteral(): Result<Expression> {
		this.advance(); // {
		const entries: { key: string; value: Expression }[] = [];
		if (!(this.peek().type === 'punct' && this.peek().text === '}')) {
			for (;;) {
				const keyTok = this.peek();
				let key: string;
				if (keyTok.type === 'string' || keyTok.type === 'identifier') {
					key = keyTok.text;
					this.advance();
				} else {
					return parseError<Expression>('Expected an object key.', keyTok.line, keyTok.column);
				}
				const colon = this.peek();
				if (!(colon.type === 'op' && colon.text === '::') && !(colon.type === 'punct' && colon.text === '.')) {
					// Accept a single ':' — but ':' isn't tokenized. Use '::'.
					return parseError<Expression>('Expected "::" after object key.', colon.line, colon.column);
				}
				this.advance();
				const val = this.parseExpression(0);
				if (!val.ok) return val;
				entries.push({ key, value: val.value });
				if (this.peek().type === 'punct' && this.peek().text === ',') { this.advance(); continue; }
				break;
			}
		}
		const close = this.peek();
		if (!(close.type === 'punct' && close.text === '}')) {
			return parseError<Expression>('Expected "}" to close an object.', close.line, close.column);
		}
		this.advance();
		return ok<Expression>({ type: 'object', entries });
	}

	/** Postfix: member access `a.b` and index `a[expr]`, chained. */
	private parsePostfix(expr: Expression): Result<Expression> {
		let node = expr;
		for (;;) {
			const tok = this.peek();
			if (tok.type === 'punct' && tok.text === '.') {
				this.advance();
				const field = this.peek();
				if (field.type !== 'identifier' && field.type !== 'keyword') {
					return parseError<Expression>('Expected a field name after ".".', field.line, field.column);
				}
				this.advance();
				node = { type: 'member', object: node, field: field.text.toLowerCase() };
				continue;
			}
			if (tok.type === 'punct' && tok.text === '[') {
				this.advance();
				const idx = this.parseExpression(0);
				if (!idx.ok) return idx;
				const close = this.peek();
				if (!(close.type === 'punct' && close.text === ']')) {
					return parseError<Expression>('Expected "]" for index access.', close.line, close.column);
				}
				this.advance();
				node = { type: 'index', object: node, index: idx.value };
				continue;
			}
			break;
		}
		return ok(node);
	}

	/* ----------------------------- token helpers ----------------------------- */

	private peek(): Token { return this.tokens[this.pos]!; }
	private advance(): void { if (this.pos < this.tokens.length - 1) this.pos++; }
}

/* Re-export value constructors used by the parser so callers need one import. */
export { makeDate, makeDuration, makeLink, makeObject, fail, ok };
