import type { DqlError, Expression, Page, QueryResult, Result } from './types';
import { ok } from './types';
import { parseQuery } from './parser';
import { runQuery } from './evaluator';
import { lookupFunction } from './functions';

/** Special sentinel: an empty/whitespace query is "unconfigured", not an error.
 *  The renderer shows a prompt rather than an error block in this case. */
export const EMPTY_QUERY = 'dataview:empty-query';

/** Walk an expression tree, collecting every function-call name. Used to flag
 *  typos like `lenght(...)` as a clear error instead of a silent empty result. */
function collectFunctionCalls(expr: Expression, acc: string[]): void {
	switch (expr.type) {
		case 'call':
			acc.push(expr.name);
			for (const a of expr.args) collectFunctionCalls(a, acc);
			break;
		case 'binary':
			collectFunctionCalls(expr.left, acc);
			collectFunctionCalls(expr.right, acc);
			break;
		case 'unary':
			collectFunctionCalls(expr.operand, acc);
			break;
		case 'member':
			collectFunctionCalls(expr.object, acc);
			break;
		case 'index':
			collectFunctionCalls(expr.object, acc);
			collectFunctionCalls(expr.index, acc);
			break;
		case 'list':
			for (const e of expr.elements) collectFunctionCalls(e, acc);
			break;
		case 'object':
			for (const e of expr.entries) collectFunctionCalls(e.value, acc);
			break;
		case 'literal':
		case 'identifier':
			break;
	}
}

/** Validate that every function called in the query is a known built-in.
 *  Returns the first unknown name, or null if all are recognized. */
function findUnknownFunction(query: import('./types').Query): string | null {
	const names: string[] = [];
	for (const f of query.fields) collectFunctionCalls(f.expr, names);
	if (query.calendarField) collectFunctionCalls(query.calendarField, names);
	for (const cmd of query.commands) {
		switch (cmd.kind) {
			case 'where': collectFunctionCalls(cmd.expr, names); break;
			case 'sort': for (const k of cmd.keys) collectFunctionCalls(k.expr, names); break;
			case 'group-by':
			case 'flatten':
			case 'limit':
				collectFunctionCalls(cmd.expr, names); break;
		}
	}
	for (const name of names) {
		if (!lookupFunction(name)) return name;
	}
	return null;
}

/**
 * The single public entry point for the DQL engine. Parses a query string and,
 * if valid, runs it against the indexed pages. Never throws — all failures
 * (parse errors, eval errors) surface as a `{ ok: false, error }` result the
 * caller renders gracefully.
 *
 * Returns a discriminated union:
 *   - `{ ok: true, empty: true }`  — no query written yet (show a prompt)
 *   - `{ ok: true, result }`       — a valid result (possibly zero rows)
 *   - `{ ok: false, error }`       — a parse or eval error
 */
export type ExecuteOutcome =
	| { readonly ok: true; readonly empty: false; readonly result: QueryResult }
	| { readonly ok: true; readonly empty: true }
	| { readonly ok: false; readonly error: DqlError };

export function executeDql(dql: string, pages: readonly Page[]): ExecuteOutcome {
	const trimmed = dql.trim();
	if (trimmed.length === 0) return { ok: true, empty: true };

	const parsed: Result<import('./types').Query> = parseQuery(trimmed);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const unknown = findUnknownFunction(parsed.value);
	if (unknown) {
		return { ok: false, error: { stage: 'eval', message: `Unknown function "${unknown}()".` } };
	}

	try {
		const result = runQuery(parsed.value, pages);
		return { ok: true, empty: false, result };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { stage: 'eval', message: `Runtime error: ${message}` } };
	}
}

/** Parse-only check (for the config modal's live validation badge). Also flags
 *  unknown function names so typos surface immediately while editing. */
export function checkSyntax(dql: string): { ok: true } | { ok: false; error: DqlError } {
	const trimmed = dql.trim();
	if (trimmed.length === 0) return { ok: true };
	const parsed = parseQuery(trimmed);
	if (!parsed.ok) return { ok: false, error: parsed.error };
	const unknown = findUnknownFunction(parsed.value);
	if (unknown) {
		return { ok: false, error: { stage: 'eval', message: `Unknown function "${unknown}()".` } };
	}
	return ok(true);
}
