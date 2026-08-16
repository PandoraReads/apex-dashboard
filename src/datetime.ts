import { moment } from 'obsidian';

/** Time units this plugin manipulates via moment (moment accepts singular and plural). */
export type MomentUnit =
	| 'day' | 'days'
	| 'week' | 'weeks'
	| 'month' | 'months'
	| 'quarter'
	| 'year' | 'years';

/**
 * Minimal moment surface this plugin relies on, declared locally instead of
 * relying on the ambient `moment` typings re-exported by `obsidian`.
 *
 * Why: the community plugin scanner runs type-checked lint rules in an
 * environment where `moment` (a transitive dependency of `obsidian`) does not
 * resolve, which degrades every moment value to `any` and cascades into
 * dozens of `no-unsafe-call` warnings (obsidianmd/eslint-plugin#182). Casting
 * once at this boundary pins the type for all downstream code, in every
 * environment, without changing runtime behavior.
 */
export interface MomentLike {
	format(format?: string): string;
	startOf(unit: MomentUnit): MomentLike;
	subtract(amount: number, unit: MomentUnit): MomentLike;
	clone(): MomentLike;
	valueOf(): number;
	isValid(): boolean;
}

/** Overloads of the moment factory used by this plugin. */
type MomentFactory = {
	(): MomentLike;
	(value: number | string): MomentLike;
	(input: string, format: string, strict: boolean): MomentLike;
};

/** The single cast boundary: everything downstream is typed by `MomentLike`. */
const createMoment = moment as unknown as MomentFactory;

/** Current time, like `moment()`. */
export function nowMoment(): MomentLike {
	return createMoment();
}

/** Wrap an epoch-ms value or ISO/date string, like `moment(value)`. */
export function momentOf(value: number | string): MomentLike {
	return createMoment(value);
}

/** Strictly parse `input` against a moment format string (invalid input yields
 *  an object whose `isValid()` is false), like `moment(input, format, true)`. */
export function parseStrict(input: string, format: string): MomentLike {
	return createMoment(input, format, true);
}
