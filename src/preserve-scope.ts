/** The live-DOM scope that render-preserving destroy sweeps must leave alone.
 *  Side/stacked layouts preserve ONE detached container element (the widgets
 *  area); the immersive grid preserves individual card elements (a Set). */
export type PreserveScope = HTMLElement | Set<HTMLElement> | null | undefined;

/** True when `node` sits inside the preserved scope. */
export function isInPreserveScope(scope: PreserveScope, node: Node): boolean {
	if (!scope) return false;
	return scope instanceof Set ? scope.has(node as HTMLElement) : scope.contains(node);
}
