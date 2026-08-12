import type { TFile } from 'obsidian';

/**
 * DQL runtime value model. A single discriminated union covers every value a
 * field expression can produce. Null is used for "field missing / error" rather
 * than undefined, mirroring Dataview's own null semantics.
 */
export type DqlValue =
	| null
	| boolean
	| number
	| string
	| DqlDate
	| DqlDuration
	| DqlLink
	| DqlValue[]
	| DqlObject;

/** A wrapped date so the evaluator can distinguish it from a plain string. */
export interface DqlDate {
	readonly kind: 'date';
	readonly ts: number;
}

/** A duration in milliseconds, so arithmetic with dates is unit-consistent. */
export interface DqlDuration {
	readonly kind: 'duration';
	readonly ms: number;
}

/** A wikilink-like reference to a note. `path` is the vault-relative target. */
export interface DqlLink {
	readonly kind: 'link';
	readonly path: string;
	readonly display?: string;
	/** True for `embed()` / `![[...]]` embeds (rendered inline in the future). */
	readonly embed?: boolean;
}

/** A key→value record (e.g. a frontmatter object or `{a: 1}` literal). */
export interface DqlObject {
	readonly kind: 'object';
	readonly entries: Readonly<Record<string, DqlValue>>;
}

/* ----------------------------- error model ----------------------------- */

export type DqlStage = 'parse' | 'eval' | 'source';

export interface DqlError {
	readonly stage: DqlStage;
	readonly message: string;
	/** Optional 1-based position in the source query for parse errors. */
	readonly line?: number;
	readonly column?: number;
}

/** Result envelope used throughout the engine — success never carries an error
 *  and failure never carries a value, so callers can branch on `ok`. */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DqlError };

export function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

export function fail<T>(error: DqlError): Result<T> {
	return { ok: false, error };
}

/** Build a parse-error result, normalizing an optional position. */
export function parseError<T>(message: string, line?: number, column?: number): Result<T> {
	return fail<T>({ stage: 'parse', message, line, column });
}

/** Build an eval-error result. */
export function evalError<T>(message: string): Result<T> {
	return fail<T>({ stage: 'eval', message });
}

/* ----------------------------- AST: query ----------------------------- */

export type QueryType = 'TABLE' | 'LIST' | 'TASK' | 'CALENDAR' | 'HEATMAP';

export interface FieldSpec {
	/** The expression producing this column/list-item value. */
	readonly expr: Expression;
	/** Alias from `AS "Name"`; falls back to the expression's source text. */
	readonly alias?: string;
}

export type FromClause = FromAtom | FromCombination | null;

export type FromAtomKind = 'folder' | 'tag' | 'tag-subtree' | 'link' | 'outgoing' | 'incoming';

export interface FromAtom {
	readonly kind: FromAtomKind;
	/** Folder path, `#tag`, `[[Note]]`, etc. — raw, as written. */
	readonly value: string;
	/** Source position for nicer error reporting. */
	readonly line?: number;
	readonly column?: number;
}

export interface FromCombination {
	readonly op: 'and' | 'or' | 'not';
	readonly left: FromClause;
	readonly right: FromClause;
}

export interface SortKey {
	readonly expr: Expression;
	readonly direction: 'ASC' | 'DESC';
}

export type DataCommand =
	| { readonly kind: 'where'; readonly expr: Expression }
	| { readonly kind: 'sort'; readonly keys: readonly SortKey[] }
	| { readonly kind: 'group-by'; readonly expr: Expression; readonly alias?: string }
	| { readonly kind: 'flatten'; readonly expr: Expression; readonly alias?: string }
	| { readonly kind: 'limit'; readonly expr: Expression };

/** A parsed DQL query. `commands` are kept in source order; the evaluator
 *  applies them sequentially. */
export interface Query {
	readonly queryType: QueryType;
	readonly fields: readonly FieldSpec[];
	/** TABLE/LIST `WITHOUT ID` suppresses the implicit name/link column. */
	readonly withoutId: boolean;
	readonly from: FromClause;
	readonly commands: readonly DataCommand[];
	/** CALENDAR's date field expression (e.g. `file.ctime`). */
	readonly calendarField?: Expression;
	/** HEATMAP's numeric value expression. */
	readonly heatmapValueField?: Expression;
	/** HEATMAP's date field expression; defaults to `file.day`. */
	readonly heatmapDateField?: Expression;
}

/* ----------------------------- AST: expressions ----------------------------- */

export type BinOp =
	| '+' | '-' | '*' | '/' | '%'
	| '=' | '!=' | '<' | '<=' | '>' | '>='
	| 'and' | 'or' | '&' | '|';

export type Expression =
	| { readonly type: 'literal'; readonly value: DqlValue; readonly raw?: string }
	| { readonly type: 'identifier'; readonly name: string }
	| { readonly type: 'member'; readonly object: Expression; readonly field: string }
	| { readonly type: 'index'; readonly object: Expression; readonly index: Expression }
	| { readonly type: 'binary'; readonly op: BinOp; readonly left: Expression; readonly right: Expression }
	| { readonly type: 'unary'; readonly op: 'not' | 'neg'; readonly operand: Expression }
	| { readonly type: 'call'; readonly name: string; readonly args: readonly Expression[] }
	| { readonly type: 'list'; readonly elements: readonly Expression[] }
	| { readonly type: 'object'; readonly entries: readonly { readonly key: string; readonly value: Expression }[] };

/* ----------------------------- page model ----------------------------- */

/** One indexed markdown file: the source TFile plus a flat field map that
 *  already merges `file.*` implicit fields, frontmatter, and inline fields. */
export interface Page {
	readonly file: TFile;
	readonly fields: Readonly<Record<string, DqlValue>>;
}

/* ----------------------------- query result ----------------------------- */

/** One output row. `page` links back to the source file (null for synthetic
 *  rows produced by GROUP BY). `fields` is the projected column values. */
export interface ResultRow {
	readonly page: Page | null;
	readonly values: readonly DqlValue[];
	/** For grouped queries, the group key value and the bundled member rows. */
	readonly groupKey?: DqlValue;
	readonly rows?: readonly ResultRow[];
	/** TASK rows carry the raw task payload for interactive rendering. */
	readonly task?: DqlTask;
}

/** A flattened checkbox task attached to a TASK query row. */
export interface DqlTask {
	readonly text: string;
	readonly checked: boolean;
	readonly path: string;
	readonly line: number;
	readonly originalLine: string;
}

export interface QueryResult {
	readonly queryType: QueryType;
	/** Column descriptors for TABLE; empty for other types. */
	readonly columns: readonly { readonly alias: string }[];
	readonly rows: readonly ResultRow[];
	/** True when GROUP BY was applied (rows then carry `groupKey`/`rows`). */
	readonly grouped: boolean;
	/** CALENDAR's resolved date field, if applicable. */
	readonly calendarField?: Expression;
	/** HEATMAP's numeric value expression, if applicable. */
	readonly heatmapValueField?: Expression;
	/** HEATMAP's resolved date field, if applicable. */
	readonly heatmapDateField?: Expression;
}
