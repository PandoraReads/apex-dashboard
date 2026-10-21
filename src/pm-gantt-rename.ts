/** Follow vault moves without relying on cached metadata or touching note bodies. */
export function renameGanttReferences(frontmatter: Record<string, unknown>, oldPath: string, nextPath: string): Record<string, unknown> {
	if (!Array.isArray(frontmatter.columns)) return frontmatter;
	let changed = false;
	const columns = frontmatter.columns.map((value: unknown) => {
		if (!value || typeof value !== 'object') return value;
		const column = value as Record<string, unknown>;
		if (!column.pm || typeof column.pm !== 'object') return column;
		const pm = column.pm as Record<string, unknown>;
		if (!Array.isArray(pm.ganttSources)) return column;
		let columnChanged = false;
		const refs = pm.ganttSources.map((value: unknown) => {
			if (!value || typeof value !== 'object') return value;
			const ref = value as Record<string, unknown>;
			if (typeof ref.path !== 'string' || (ref.path !== oldPath && !ref.path.startsWith(oldPath + '/'))) return ref;
			changed = true; columnChanged = true;
			return { ...ref, path: nextPath + ref.path.slice(oldPath.length) };
		});
		return columnChanged ? { ...column, pm: { ...pm, ganttSources: refs } } : column;
	});
	return changed ? { ...frontmatter, columns } : frontmatter;
}
