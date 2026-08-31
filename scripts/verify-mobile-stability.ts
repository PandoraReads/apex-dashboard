import { strict as assert } from 'node:assert';
import { dashboardMarkdownPath, planDashboardUpdate } from '../src/render-update';
import type { DashboardData } from '../src/types';

const base: DashboardData = {
	banner: { quote: '', author: '', image: '', images: [], quotes: [], mode: 'quote' },
	quickActions: [],
	columns: [
		{
			name: 'Todo',
			color: '#000000',
			sectionType: 'todo',
			cards: [{
				id: 'todo-1',
				title: 'Today',
				type: 'task',
				column: 'Todo',
				body: '',
				tasks: [{ text: 'Ship mobile fix', checked: false }],
				docs: [],
				url: '',
				wikiLink: '',
				progress: -1,
				streak: 0,
				dueDate: '',
				blockquote: '',
				color: '',
				coverImage: '',
				width: 0,
				size: 'M',
				gridCols: 0,
				gridRows: 0,
				gridCol: 0,
				gridRow: 0,
			}],
		},
		{
			name: 'Dataview',
			color: '#000000',
			sectionType: 'dataview',
			cards: [],
		},
	],
};

const toggled: DashboardData = {
	...base,
	columns: base.columns.map((column) => column.name === 'Todo'
		? {
			...column,
			cards: column.cards.map((card) => ({
				...card,
				tasks: card.tasks.map((task) => ({ ...task, checked: true })),
			})),
		}
		: column),
};

assert.deepEqual(
	planDashboardUpdate(base, toggled, 'local'),
	{ kind: 'sections', names: ['Todo'] },
	'a local todo edit must not rebuild the whole dashboard',
);

const resizedWidget: DashboardData = {
	...base,
	columns: base.columns.map((column) => column.name === 'Todo'
		? { ...column, cards: column.cards.map((card) => ({ ...card, width: 320 })) }
		: column),
};
assert.deepEqual(
	planDashboardUpdate(base, resizedWidget, 'local'),
	{ kind: 'sections', names: ['Todo'] },
	'a local card/widget edit must stay section-scoped',
);

assert.deepEqual(
	planDashboardUpdate(base, { ...base, banner: { ...base.banner, mode: 'stats' } }, 'local'),
	{ kind: 'full' },
	'banner changes still require a full render',
);

assert.deepEqual(
	planDashboardUpdate(base, toggled, 'external'),
	{ kind: 'full' },
	'external file changes must use the conservative full-render path',
);

assert.equal(
	dashboardMarkdownPath('/assets/99_system/dashboard'),
	'assets/99_system/dashboard.md',
	'the own-file event guard must match the active dashboard markdown path',
);

console.log('mobile interaction stability: 5/5 passed');
