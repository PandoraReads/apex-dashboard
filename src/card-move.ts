import type { DashboardCard, DashboardColumn, DashboardData, DocNode, TaskItem } from './types';

/** Memo editing and rendering use the same complete text, including task trees. */
export function memoCardText(card: DashboardCard): string {
	const taskLines = (tasks: TaskItem[], depth = 0): string[] => tasks.flatMap(task => [
		`${'    '.repeat(depth)}- [${task.checked ? 'x' : ' '}] ${task.text}${task.reminder ? ` \u23f0 ${task.reminder}` : ''}${task.collapsed ? ' <!--collapsed-->' : ''}`,
		...taskLines(task.children ?? [], depth + 1),
	]);
	const docLines = (docs: DocNode[], depth = 0): string[] => docs.flatMap(doc => [
		`${'    '.repeat(depth)}- [[${doc.path}]]${doc.collapsed ? ' <!--collapsed-->' : ''}`,
		...docLines(doc.children ?? [], depth + 1),
	]);
	return [card.blockquote.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n'),
		card.body, ...taskLines(card.tasks), ...docLines(card.docs),
		card.wikiLink ? `[[${card.wikiLink}]]` : '', card.url].filter(Boolean).join('\n');
}

function sectionType(column: DashboardColumn): string {
	return column.sectionType ?? column.name.toLowerCase();
}

function additionalTasks(card: DashboardCard): TaskItem[] {
	const docs = (nodes: DocNode[]): TaskItem[] => nodes.map(node => ({
		text: `[[${node.path}]]`, checked: false, collapsed: node.collapsed,
		...(node.children ? { children: docs(node.children) } : {}),
	}));
	return [
		...[card.blockquote, card.body].flatMap(text => text.split('\n'))
			.map(text => text.trim()).filter(Boolean).map(text => ({ text, checked: false })),
		...docs(card.docs),
		...(card.wikiLink ? [{ text: `[[${card.wikiLink}]]`, checked: false }] : []),
		...(card.url ? [{ text: card.url, checked: false }] : []),
	];
}

export function convertMovedCard(card: DashboardCard, source: DashboardColumn, target: DashboardColumn): DashboardCard {
	const sourceType = sectionType(source);
	const targetType = sectionType(target);
	const moved = { ...card, column: target.name };
	if (source.name === target.name) return moved;
	if (targetType === 'sticky' && (sourceType === 'projects' || sourceType === 'notes')) {
		return { ...moved, noteStyle: sourceType === 'notes' ? 'plain' : 'cover' };
	}
	if (targetType === 'memo' || (targetType === 'sticky' && sourceType === 'memo')) {
		return { ...moved, type: 'generic' };
	}
	if (targetType === 'todo' || (targetType === 'sticky' && sourceType === 'todo')) {
		return { ...moved, type: 'task', tasks: [...card.tasks, ...additionalTasks(card)],
			body: '', blockquote: '', docs: [], wikiLink: '', url: '' };
	}
	return moved;
}

/** Validate before removing the source: invalid destinations must never lose cards.
 * targetIndex uses the post-removal coordinates supplied by desktop/touch DnD. */
export function moveDashboardCard(data: DashboardData, cardId: string, targetName: string, targetIndex: number): DashboardData {
	if (!Number.isInteger(targetIndex)) return data;
	const source = data.columns.find(column => column.cards.some(card => card.id === cardId));
	const target = data.columns.find(column => column.name === targetName);
	if (!source || !target || !['memo', 'todo', 'sticky', 'projects', 'notes', 'dashboard'].includes(sectionType(target))) return data;
	const card = source.cards.find(item => item.id === cardId);
	if (!card) return data;
	const moved = convertMovedCard(card, source, target);
	return { ...data, columns: data.columns.map(column => {
		if (column !== source && column !== target) return column;
		const cards = column.cards.filter(item => item.id !== cardId);
		if (column !== target) return { ...column, cards };
		const index = Math.max(0, Math.min(targetIndex, cards.length));
		return { ...column, cards: [...cards.slice(0, index), moved, ...cards.slice(index)] };
	}) };
}
