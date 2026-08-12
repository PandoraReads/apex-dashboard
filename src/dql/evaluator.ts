import type {
	BinOp, DataCommand, DqlError, Expression, FromClause, Page, Query, QueryResult,
	ResultRow,
} from './types';
import {
	asList, coerceNumber, coerceString, dqlCompare, dqlEquals, kindOf, makeDate,
	makeObject, truthy,
} from './values';
import { lookupFunction } from './functions';

/** Maximum expression-nesting depth. Guards against pathological / deeply
 *  nested expressions blowing the stack. Exceeding it yields a caught error. */
const MAX_DEPTH = 64;

interface EvalContext {
	readonly page: Page;
	/** Row-scoped fields produced by GROUP BY (e.g. `rows`) or FLATTEN. */
	readonly locals: Readonly<Record<string, unknown>>;
}

type Outcome = { ok: true; value: import('./types').DqlValue } | { ok: false; error: DqlError };

/** Evaluate a single expression against a context. Returns null on any
 *  per-expression error (so one bad field never kills the whole query). */
function evaluate(node: Expression, ctx: EvalContext, depth: number): Outcome {
	if (depth > MAX_DEPTH) return { ok: false, error: { stage: 'eval', message: 'Expression too deeply nested.' } };

	switch (node.type) {
		case 'literal':
			return { ok: true, value: node.value };

		case 'identifier':
			return { ok: true, value: resolveName(node.name, ctx) };

		case 'member':
			return evaluateMember(node, ctx, depth);

		case 'index': {
			const base = evaluate(node.object, ctx, depth);
			if (!base.ok) return base;
			const key = evaluate(node.index, ctx, depth);
			if (!key.ok) return key;
			return { ok: true, value: indexInto(base.value, coerceString(key.value)) };
		}

		case 'unary':
			return evaluateUnary(node, ctx, depth);

		case 'binary':
			return evaluateBinary(node, ctx, depth);

		case 'call':
			return evaluateCall(node, ctx, depth);

		case 'list': {
			const out: unknown[] = [];
			for (const el of node.elements) {
				const v = evaluate(el, ctx, depth);
				if (!v.ok) return v;
				out.push(v.value);
			}
			return { ok: true, value: out as import('./types').DqlValue };
		}

		case 'object': {
			const entries: Record<string, import('./types').DqlValue> = {};
			for (const e of node.entries) {
				const v = evaluate(e.value, ctx, depth);
				if (!v.ok) return v;
				entries[e.key] = v.value;
			}
			return { ok: true, value: makeObject(entries) };
		}
	}
}

/** Resolve a bare name: locals (rows/group vars) first, then page fields. */
function resolveName(name: string, ctx: EvalContext): import('./types').DqlValue {
	const lower = name.toLowerCase();
	if (Object.prototype.hasOwnProperty.call(ctx.locals, lower)) {
		return (ctx.locals[lower] ?? null) as import('./types').DqlValue;
	}
	if (Object.prototype.hasOwnProperty.call(ctx.page.fields, lower)) {
		return ctx.page.fields[lower] ?? null;
	}
	if (Object.prototype.hasOwnProperty.call(ctx.page.fields, name)) {
		return ctx.page.fields[name] ?? null;
	}
	return null;
}

function evaluateMember(node: Extract<Expression, { type: 'member' }>, ctx: EvalContext, depth: number): Outcome {
	// Special-case `file.*` — `file` is reserved and maps to the page's file.* fields.
	if (node.object.type === 'identifier' && node.object.name.toLowerCase() === 'file') {
		const key = `file.${node.field}`;
		if (Object.prototype.hasOwnProperty.call(ctx.page.fields, key)) {
			return { ok: true, value: ctx.page.fields[key] ?? null };
		}
		return { ok: true, value: null };
	}
	const base = evaluate(node.object, ctx, depth);
	if (!base.ok) return base;
	return { ok: true, value: indexInto(base.value, node.field) };
}

/** Index/member access over a value: objects by key, lists by numeric index. */
function indexInto(value: import('./types').DqlValue, key: string): import('./types').DqlValue {
	if (value === null) return null;
	if (kindOf(value) === 'object') {
		const entries = (value as { entries: Record<string, import('./types').DqlValue> }).entries;
		if (Object.prototype.hasOwnProperty.call(entries, key)) return entries[key] ?? null;
		const lower = key.toLowerCase();
		for (const k of Object.keys(entries)) if (k.toLowerCase() === lower) return entries[k] ?? null;
		return null;
	}
	if (Array.isArray(value)) {
		const n = Number(key);
		if (Number.isFinite(n)) {
			const idx = Math.trunc(n);
			return idx >= 0 && idx < value.length ? value[idx]! : null;
		}
		return null;
	}
	return null;
}

function evaluateUnary(node: Extract<Expression, { type: 'unary' }>, ctx: EvalContext, depth: number): Outcome {
	const operand = evaluate(node.operand, ctx, depth + 1);
	if (!operand.ok) return operand;
	if (node.op === 'not') return { ok: true, value: !truthy(operand.value) };
	// negation
	const n = coerceNumber(operand.value);
	return { ok: true, value: n === null ? null : -n };
}

function evaluateBinary(node: Extract<Expression, { type: 'binary' }>, ctx: EvalContext, depth: number): Outcome {
	// Logical operators short-circuit on truthiness.
	if (node.op === 'and' || node.op === '&') {
		const left = evaluate(node.left, ctx, depth + 1);
		if (!left.ok) return left;
		if (!truthy(left.value)) return { ok: true, value: false };
		const right = evaluate(node.right, ctx, depth + 1);
		if (!right.ok) return right;
		return { ok: true, value: truthy(right.value) };
	}
	if (node.op === 'or' || node.op === '|') {
		const left = evaluate(node.left, ctx, depth + 1);
		if (!left.ok) return left;
		if (truthy(left.value)) return { ok: true, value: true };
		const right = evaluate(node.right, ctx, depth + 1);
		if (!right.ok) return right;
		return { ok: true, value: truthy(right.value) };
	}

	const left = evaluate(node.left, ctx, depth + 1);
	if (!left.ok) return left;
	const right = evaluate(node.right, ctx, depth + 1);
	if (!right.ok) return right;
	return { ok: true, value: applyBinOp(node.op, left.value, right.value) };
}

function applyBinOp(op: BinOp, a: import('./types').DqlValue, b: import('./types').DqlValue): import('./types').DqlValue {
	switch (op) {
		case '=': return dqlEquals(a, b);
		case '!=': return !dqlEquals(a, b);
		case '<': { const c = dqlCompare(a, b); return c === null ? false : c < 0; }
		case '<=': { const c = dqlCompare(a, b); return c === null ? false : c <= 0; }
		case '>': { const c = dqlCompare(a, b); return c === null ? false : c > 0; }
		case '>=': { const c = dqlCompare(a, b); return c === null ? false : c >= 0; }
		case '+': return addValues(a, b);
		case '-': return subtractValues(a, b);
		case '*': { const x = coerceNumber(a); const y = coerceNumber(b); return x === null || y === null ? null : x * y; }
		case '/': { const x = coerceNumber(a); const y = coerceNumber(b); return x === null || y === null || y === 0 ? null : x / y; }
		case '%': { const x = coerceNumber(a); const y = coerceNumber(b); return x === null || y === null || y === 0 ? null : x % y; }
		default: return null;
	}
}

function addValues(a: import('./types').DqlValue, b: import('./types').DqlValue): import('./types').DqlValue {
	// date + duration → date; duration + date → date; else numeric/string.
	const ka = kindOf(a); const kb = kindOf(b);
	if (ka === 'date' && kb === 'duration') return makeDate((a as { ts: number }).ts + (b as { ms: number }).ms);
	if (ka === 'duration' && kb === 'date') return makeDate((b as { ts: number }).ts + (a as { ms: number }).ms);
	if (ka === 'duration' && kb === 'duration') return { kind: 'duration', ms: (a as { ms: number }).ms + (b as { ms: number }).ms };
	if (ka === 'date' && kb === 'date') return null;
	if (typeof a === 'string' || typeof b === 'string') return coerceString(a) + coerceString(b);
	const x = coerceNumber(a); const y = coerceNumber(b);
	return x === null || y === null ? null : x + y;
}

function subtractValues(a: import('./types').DqlValue, b: import('./types').DqlValue): import('./types').DqlValue {
	const ka = kindOf(a); const kb = kindOf(b);
	if (ka === 'date' && kb === 'duration') return makeDate((a as { ts: number }).ts - (b as { ms: number }).ms);
	if (ka === 'date' && kb === 'date') return { kind: 'duration', ms: (a as { ts: number }).ts - (b as { ts: number }).ts };
	if (ka === 'duration' && kb === 'duration') return { kind: 'duration', ms: (a as { ms: number }).ms - (b as { ms: number }).ms };
	const x = coerceNumber(a); const y = coerceNumber(b);
	return x === null || y === null ? null : x - y;
}

function evaluateCall(node: Extract<Expression, { type: 'call' }>, ctx: EvalContext, depth: number): Outcome {
	const func = lookupFunction(node.name);
	if (!func) return { ok: false, error: { stage: 'eval', message: `Unknown function "${node.name}".` } };
	const args: import('./types').DqlValue[] = [];
	for (const a of node.args) {
		const v = evaluate(a, ctx, depth + 1);
		if (!v.ok) return v;
		args.push(v.value);
	}
	if (args.length < func.minArgs || args.length > func.maxArgs) {
		const arity = func.maxArgs === Number.POSITIVE_INFINITY
			? `at least ${func.minArgs}`
			: func.minArgs === func.maxArgs ? `${func.minArgs}` : `${func.minArgs}-${func.maxArgs}`;
		return { ok: false, error: { stage: 'eval', message: `${func.name}() expects ${arity} argument(s), got ${args.length}.` } };
	}
	return func.apply(args);
}

/* ----------------------------- query runner ----------------------------- */

/** Run a parsed query against the indexed pages. */
export function runQuery(query: Query, pages: readonly Page[]): QueryResult {
	// 1. FROM: source resolution narrows the candidate pages.
	let rows = applyFrom(query.from, pages);

	// 1b. TASK queries flatten each page's file.tasks into per-task rows, so
	//     WHERE can filter individual tasks (e.g. WHERE !completed) and `text`
	//     / `completed` are directly addressable. Task fields also surface as
	//     row locals for unqualified access.
	if (query.queryType === 'TASK') {
		rows = flattenTaskRows(rows);
	}

	// 2. Data commands, in source order.
	let grouped = false;
	for (const cmd of query.commands) {
		const next = applyCommand(cmd, rows);
		rows = next.rows;
		grouped = grouped || next.grouped;
	}

	// 3. Projection per query type.
	return project(query, rows, grouped);
}

/** Expand file.tasks into one Row per task, exposing task fields as locals. */
function flattenTaskRows(rows: readonly Row[]): Row[] {
	const out: Row[] = [];
	for (const row of rows) {
		const tasks = asList(row.page.fields['file.tasks'] ?? []);
		for (const task of tasks) {
			if (task === null) continue;
			const fields = kindOf(task) === 'object' ? (task as { entries: Record<string, import('./types').DqlValue> }).entries : {};
			const locals: Record<string, import('./types').DqlValue> = { ...row.locals };
			// Surface common task fields unqualified (completed, text, due, …).
			for (const k of ['completed', 'checked', 'text', 'due', 'priority', 'created', 'link']) {
				locals[k] = fields[k] ?? null;
			}
			out.push({ page: row.page, locals, task: toDqlTask(fields) });
		}
	}
	return out;
}

/** Build the interactive payload the renderer needs to toggle a task checkbox. */
function toDqlTask(fields: Record<string, import('./types').DqlValue>): import('./types').DqlTask {
	const text = typeof fields['text'] === 'string' ? fields['text'] : '';
	const checked = fields['completed'] === true;
	const path = typeof fields['__path'] === 'string' ? fields['__path'] : '';
	const line = typeof fields['__line'] === 'number' ? fields['__line'] : -1;
	const original = typeof fields['__original'] === 'string' ? fields['__original'] : '';
	return { text, checked, path, line, originalLine: original };
}

interface Row {
	readonly page: Page;
	readonly locals: Readonly<Record<string, import('./types').DqlValue>>;
	/** Task payload attached when rows originate from file.tasks (TASK type). */
	readonly task?: import('./types').DqlTask;
}

function applyFrom(from: FromClause, pages: readonly Page[]): Row[] {
	const matched: Page[] = [];
	for (const page of pages) {
		if (matchesSource(from, page)) matched.push(page);
	}
	return matched.map(page => ({ page, locals: {} }));
}

function matchesSource(from: FromClause, page: Page): boolean {
	if (from === null) return true; // no FROM = all pages
	if (!('op' in from)) return matchesAtom(from, page);
	switch (from.op) {
		case 'and':
			return matchesSource(from.left, page) && matchesSource(from.right, page);
		case 'or':
			return matchesSource(from.left, page) || matchesSource(from.right, page);
		case 'not':
			return !matchesSource(from.left, page);
		default:
			return false;
	}
}

function matchesAtom(atom: FromClause, page: Page): boolean {
	if (atom === null) return true;
	if ('op' in atom) return matchesSource(atom, page);
	const a = atom;
	const path = page.file.path;
	const tags = asList(page.fields['file.tags'] ?? []);
	// file.tags values may be strings ("#tag") or Link values (page-builder
	// wraps them as {kind:'link', path:'#tag'}). Normalize to bare tag names.
	const rawTags = tags.map(t => {
		if (typeof t === 'string') return t.replace(/^#/, '');
		if (kindOf(t) === 'link') return (t as { path: string }).path.replace(/^#/, '');
		return '';
	}).filter(t => t.length > 0);
	const outlinks = asList(page.fields['file.outlinks'] ?? []).map(l => linkPath(l));
	const inlinks = asList(page.fields['file.inlinks'] ?? []).map(l => linkPath(l));

	switch (a.kind) {
		case 'folder': {
			const folder = a.value.replace(/^\/+|\/+$/g, '');
			if (folder === '') return true;
			const lp = path.toLowerCase();
			// Match folder prefix OR exact-basename folder (for files directly in it).
			return lp.startsWith(folder.toLowerCase() + '/') || lp === folder.toLowerCase();
		}
		case 'tag': {
			const want = a.value.replace(/^#/, '').toLowerCase();
			return rawTags.some(t => t.toLowerCase() === want);
		}
		case 'tag-subtree': {
			const want = a.value.replace(/^#/, '').toLowerCase();
			return rawTags.some(t => t.toLowerCase() === want || t.toLowerCase().startsWith(want + '/'));
		}
		case 'link': {
			const target = a.value.replace(/^\/+|\/+$/g, '').toLowerCase();
			const bare = stripMd(target);
			return outlinks.some(o => stripMd(o.toLowerCase()) === bare) || basenameMatch(outlinks, bare)
				|| inlinks.some(o => stripMd(o.toLowerCase()) === bare) || basenameMatch(inlinks, bare);
		}
		case 'outgoing': {
			const target = stripMd(a.value.toLowerCase());
			return outlinks.some(o => stripMd(o.toLowerCase()) === target) || basenameMatch(outlinks, target);
		}
		case 'incoming': {
			const target = stripMd(a.value.toLowerCase());
			return inlinks.some(o => stripMd(o.toLowerCase()) === target) || basenameMatch(inlinks, target);
		}
	}
}

function linkPath(l: import('./types').DqlValue): string {
	if (l === null) return '';
	if (kindOf(l) === 'link') return (l as { path: string }).path;
	return coerceString(l);
}

function stripMd(p: string): string {
	return p.replace(/\.md$/i, '');
}

function basenameMatch(links: string[], target: string): boolean {
	return links.some(l => stripMd(l.split('/').pop() ?? '').toLowerCase() === target);
}

/** Apply one data command, returning the new row list (and whether grouping
 *  occurred). Commands that error on a single row skip that row rather than
 *  aborting the query. */
function applyCommand(cmd: DataCommand, rows: readonly Row[]): { rows: Row[]; grouped: boolean } {
	switch (cmd.kind) {
		case 'where': {
			const out: Row[] = [];
			for (const row of rows) {
				const result = evaluate(cmd.expr, { page: row.page, locals: row.locals }, 0);
				if (result.ok && truthy(result.value)) out.push(row);
			}
			return { rows: out, grouped: false };
		}
		case 'sort': {
			const sorted = rows.slice();
			// Apply sort keys right-to-left for a stable multi-key sort.
			for (let k = cmd.keys.length - 1; k >= 0; k--) {
				const key = cmd.keys[k]!;
				const dir = key.direction === 'DESC' ? -1 : 1;
				sorted.sort((a, b) => {
					const av = evaluate(key.expr, { page: a.page, locals: a.locals }, 0);
					const bv = evaluate(key.expr, { page: b.page, locals: b.locals }, 0);
					const va = av.ok ? av.value : null;
					const vb = bv.ok ? bv.value : null;
					return (dqlCompare(va, vb) ?? 0) * dir;
				});
			}
			return { rows: sorted, grouped: false };
		}
		case 'limit': {
			const n = evaluate(cmd.expr, { page: rows[0]?.page ?? { file: null as never, fields: {} }, locals: {} }, 0);
			const limit = n.ok ? coerceNumber(n.value) ?? rows.length : rows.length;
			return { rows: rows.slice(0, Math.max(0, limit)), grouped: false };
		}
		case 'flatten': {
			return { rows: flattenRows(cmd, rows), grouped: false };
		}
		case 'group-by': {
			return { rows: groupRows(cmd, rows), grouped: true };
		}
	}
}

function flattenRows(cmd: Extract<DataCommand, { kind: 'flatten' }>, rows: readonly Row[]): Row[] {
	const out: Row[] = [];
	for (const row of rows) {
		const result = evaluate(cmd.expr, { page: row.page, locals: row.locals }, 0);
		const value = result.ok ? result.value : null;
		const aliasKey = (cmd.alias ?? '').toLowerCase();
		const list = asList(value);
		if (list.length === 0) {
			// FLATTEN of a non-list or empty: keep one row with the value itself.
			if (value !== null && !Array.isArray(value)) {
				out.push({ page: row.page, locals: aliasKey ? { ...row.locals, [aliasKey]: value } : row.locals });
			}
			continue;
		}
		for (const item of list) {
			out.push({ page: row.page, locals: aliasKey ? { ...row.locals, [aliasKey]: item } : row.locals });
		}
	}
	return out;
}

function groupRows(cmd: Extract<DataCommand, { kind: 'group-by' }>, rows: readonly Row[]): Row[] {
	const aliasKey = (cmd.alias ?? 'group').toLowerCase();
	const groups = new Map<string, { key: import('./types').DqlValue; rows: Row[] }>();
	for (const row of rows) {
		const result = evaluate(cmd.expr, { page: row.page, locals: row.locals }, 0);
		const key = result.ok ? result.value : null;
		const mapKey = keyLabel(key);
		const existing = groups.get(mapKey);
		if (existing) {
			existing.rows.push(row);
		} else {
			groups.set(mapKey, { key, rows: [row] });
		}
	}
	// Preserve insertion order (first-seen) for stable group output.
	const out: Row[] = [];
	for (const g of groups.values()) {
		const memberPages = g.rows.map(r => r.page);
		// Synthesize a pseudo-page whose `rows` local holds the group members,
		// and whose own fields are the first member's (so ungrouped field
		// references still resolve). Dataview exposes `rows` after GROUP BY.
		const pseudo: Page = { file: memberPages[0]?.file ?? null as never, fields: memberPages[0]?.fields ?? {} };
		const rowValues = g.rows as unknown as import('./types').DqlValue;
		out.push({ page: pseudo, locals: { [aliasKey]: g.key, rows: rowValues, group: g.key } });
	}
	return out;
}

/** Stable string key for a group value (for Map dedup). */
function keyLabel(v: import('./types').DqlValue): string {
	if (v === null) return '\0null';
	if (typeof v === 'string') return 's:' + v;
	if (typeof v === 'number') return 'n:' + v;
	if (typeof v === 'boolean') return 'b:' + v;
	return 'k:' + kindOf(v) + ':' + JSON.stringify(v);
}

/* ----------------------------- projection ----------------------------- */

function project(query: Query, rows: readonly Row[], grouped: boolean): QueryResult {
	const resultRows: ResultRow[] = rows.map(row => projectRow(query, row, grouped));
	const columns = query.queryType === 'TABLE'
		? buildColumns(query)
		: [];
	return {
		queryType: query.queryType,
		columns,
		rows: resultRows,
		grouped,
		calendarField: query.calendarField,
		heatmapValueField: query.heatmapValueField,
		heatmapDateField: query.heatmapDateField,
	};
}

function buildColumns(query: Query): { alias: string }[] {
	const cols: { alias: string }[] = [];
	if (!query.withoutId) cols.push({ alias: 'file' });
	for (const f of query.fields) cols.push({ alias: f.alias ?? exprLabel(f.expr) });
	return cols;
}

/** Best-effort human label for an expression with no alias. */
function exprLabel(expr: Expression): string {
	switch (expr.type) {
		case 'identifier': return expr.name;
		case 'member': return `${exprLabel(expr.object)}.${expr.field}`;
		case 'literal': return typeof expr.value === 'string' ? expr.value : coerceString(expr.value ?? '');
		case 'call': return expr.name + '()';
		default: return 'value';
	}
}

function projectRow(query: Query, row: Row, grouped: boolean): ResultRow {
	const ctx: EvalContext = { page: row.page, locals: row.locals };
	const values: import('./types').DqlValue[] = [];

	if (query.queryType === 'TABLE') {
		// Implicit first column: the file link (unless WITHOUT ID).
		if (!query.withoutId) {
			values.push(row.page.fields['file.link'] ?? null);
		}
		for (const f of query.fields) {
			const v = evaluate(f.expr, ctx, 0);
			values.push(v.ok ? v.value : null);
		}
	} else if (query.queryType === 'LIST') {
		if (query.fields.length > 0) {
			const v = evaluate(query.fields[0]!.expr, ctx, 0);
			values.push(v.ok ? v.value : null);
		} else {
			values.push(row.page.fields['file.link'] ?? null);
		}
	} else if (query.queryType === 'TASK') {
		// TASK projection happens at page-build (file.tasks flattened to rows);
		// here we surface the carried task payload.
		values.push(row.task?.text ? coerceString(row.task.text) : row.page.fields['file.link'] ?? null);
	} else if (query.queryType === 'CALENDAR') {
		values.push(row.page.fields['file.link'] ?? null);
		// When the user named a date field (CALENDAR <expr>), evaluate it per row
		// and surface the resolved DqlDate as the second value so the renderer can
		// place the dot on the intended day (not always file.cday).
		if (query.calendarField) {
			const dv = evaluate(query.calendarField, ctx, 0);
			values.push(dv.ok ? dv.value : null);
		}
	} else if (query.queryType === 'HEATMAP') {
		const value = query.heatmapValueField ? evaluate(query.heatmapValueField, ctx, 0) : { ok: true as const, value: null };
		values.push(value.ok ? coerceNumber(value.value) : null);
		const dateExpr = query.heatmapDateField ?? defaultFileDayExpr();
		const date = evaluate(dateExpr, ctx, 0);
		values.push(date.ok ? date.value : null);
	}

	const memberRows: ResultRow[] | undefined = grouped && row.locals['rows']
		? (row.locals['rows'] as unknown as Row[]).map(m => projectRow({ ...query, commands: [] }, m, false))
		: undefined;

	return {
		page: row.page,
		values,
		groupKey: grouped ? (row.locals['group']) : undefined,
		rows: memberRows,
		task: row.task,
	};
}

function defaultFileDayExpr(): Expression {
	return { type: 'member', object: { type: 'identifier', name: 'file' }, field: 'day' };
}

/* ----------------------------- public API ----------------------------- */

/** Evaluate an expression standalone (used by the config modal for live hints).
 *  Returns null on any error. */
export function evalExpressionForPage(expr: Expression, page: Page): import('./types').DqlValue {
	const result = evaluate(expr, { page, locals: {} }, 0);
	return result.ok ? result.value : null;
}

export type { Outcome, Row };
export { evaluate as evaluateExpression };
