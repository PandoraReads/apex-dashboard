import type {
	BannerData,
	BannerLeftStat,
	BannerCenterStat,
	BannerRightStat,
	BannerStatsConfig,
	CardType,
	CardSize,
	DashboardCard,
	DashboardColumn,
	DashboardData,
	QuickAction,
	TaskItem,
	DocNode,
	WeatherConfig,
	TrackerConfig,
	LibraryConfig,
	WereadConfig,
	TickTickConfig,
	DataviewConfig,
} from './types';
import { parse as parseYaml } from 'yaml';
import { t } from './i18n';
import { normalizeColumnPairs } from './column-pairs';

const KNOWN_METADATA_KEYS = new Set(['id', 'link', 'progress', 'due', 'streak', 'type', 'color', 'cover', 'width', 'size', 'lat', 'lon', 'city', 'track', 'days', 'cols', 'rows', 'gcol', 'grow']);
const SECTION_TYPES = new Set(['memo', 'todo', 'projects', 'notes', 'dashboard', 'library', 'folder', 'images', 'videos', 'alltasks', 'calendar', 'dataview', 'weread', 'ticktick', 'sticky']);

// Card colors are persisted without the leading '#' (see serialize) so Obsidian
// does not register them as tags. Restore the '#' here; legacy '#xxxxxx' values
// are still accepted.
function normalizeHexColor(value?: string): string {
	if (!value) return '';
	const trimmed = value.trim();
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

const REMINDER_REGEX = /\s*⏰\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/;
const COLLAPSED_REGEX = /\s*<!--collapsed-->\s*$/;
// Doc lines are `- [[path]]` / `[[path]]` (optionally indented for nesting).
// The path may itself contain single brackets (z-library books carry `[美]`
// etc.), so a lone `]` is allowed — the link only terminates on `]]`. Paths
// ending IN a bracket (`book].pdf`) still can't round-trip, matching the
// Obsidian core wikilink parser, which also stops at the first `]]`.
const DOC_LINE_REGEX = /^(\s*)(?:- )?\[\[((?:[^\]\n]|\](?!\]))+?)]](\s*<!--collapsed-->\s*)?$/;

const DEFAULT_BANNER: BannerData = {
	quote: 'The mind is everything. What you think you become.',
	author: 'Buddha',
	image: 'https://images.pexels.com/photos/2307638/pexels-photo-2307638.jpeg',
	images: [
		'https://images.pexels.com/photos/2307638/pexels-photo-2307638.jpeg',
		'https://images.pexels.com/photos/10664504/pexels-photo-10664504.jpeg',
	],
};

const DEFAULT_COLUMNS = [
	{ name: 'Memo', color: '#f59e0b', sectionType: 'memo' },
	{ name: 'Todo', color: '#6366f1', sectionType: 'todo' },
	{ name: 'Projects', color: '#10b981', sectionType: 'projects' },
	{ name: 'Library', color: '#8b5cf6', sectionType: 'projects' },
];

export function parse(markdown: string): DashboardData {
	const { frontmatter, body } = splitFrontmatter(markdown);
	const banner = parseBanner(frontmatter);
	const quickActions = parseQuickActions(frontmatter);
	const quickActionOrder = parseQuickActionOrder(frontmatter);
	const columnDefs = parseColumnDefs(frontmatter);
	const columns = parseColumns(body, columnDefs);

	const data: DashboardData = { banner, quickActions, columns };
	if (quickActionOrder) data.quickActionOrder = quickActionOrder;
	const hiddenPresets = parseHiddenPresets(frontmatter);
	if (hiddenPresets) data.hiddenPresets = hiddenPresets;
	return data;
}

export function serialize(data: DashboardData): string {
	const lines: string[] = [];

	lines.push('---');
	lines.push('dashboard: true');

	lines.push('banner:');
	lines.push(`  quote: "${escapeYamlString(data.banner.quote)}"`);
	lines.push(`  author: "${escapeYamlString(data.banner.author)}"`);
	if (data.banner.image) {
		lines.push(`  image: "${data.banner.image}"`);
	}
	if (data.banner.quoteColor) {
		lines.push(`  quoteColor: "${data.banner.quoteColor}"`);
	}
	if (data.banner.quotes && data.banner.quotes.length > 0) {
		lines.push('  quotes:');
		for (const q of data.banner.quotes) {
			lines.push(`    - quote: "${escapeYamlString(q.quote)}"`);
			lines.push(`      author: "${escapeYamlString(q.author)}"`);
		}
	}
	if (data.banner.images && data.banner.images.length > 0) {
		lines.push('  images:');
		for (const img of data.banner.images) {
			lines.push(`    - "${escapeYamlString(img)}"`);
		}
	}
	if (data.banner.mode === 'stats') {
		lines.push('  mode: stats');
	}
	if (data.banner.statsConfig) {
		lines.push('  statsConfig:');
		const sc = data.banner.statsConfig;
		if (sc.dailyFolder) lines.push(`    dailyFolder: "${escapeYamlString(sc.dailyFolder)}"`);
		if (sc.dailyFormat) lines.push(`    dailyFormat: "${escapeYamlString(sc.dailyFormat)}"`);
		if (typeof sc.streakFromDaily === 'boolean') lines.push(`    streakFromDaily: ${sc.streakFromDaily}`);
		if (sc.excludeFolders && sc.excludeFolders.length > 0) {
			lines.push('    excludeFolders:');
			for (const folder of sc.excludeFolders) lines.push(`      - "${escapeYamlString(folder)}"`);
		}
		if (sc.accent) lines.push(`    accent: "${sc.accent}"`); // quoted: '#' starts a YAML comment
		if (sc.blur !== undefined) lines.push(`    blur: ${sc.blur}`);
		if (sc.darkness !== undefined) lines.push(`    darkness: ${sc.darkness}`);
		if (sc.showDetails !== undefined) lines.push(`    showDetails: ${sc.showDetails}`);
		if (sc.showLeft !== undefined) lines.push(`    showLeft: ${sc.showLeft}`);
		if (sc.showCenter !== undefined) lines.push(`    showCenter: ${sc.showCenter}`);
		if (sc.showRight !== undefined) lines.push(`    showRight: ${sc.showRight}`);
		if (sc.leftStat) lines.push(`    leftStat: ${sc.leftStat}`);
		if (sc.centerStat) lines.push(`    centerStat: ${sc.centerStat}`);
		if (sc.heatmapSource) lines.push(`    heatmapSource: ${sc.heatmapSource}`);
		if (sc.heatmapHabitId) lines.push(`    heatmapHabitId: "${escapeYamlString(sc.heatmapHabitId)}"`);
		if (sc.rightStats && sc.rightStats.length > 0) {
			lines.push('    rightStats:');
			for (const rs of sc.rightStats) lines.push(`      - ${rs}`);
		}
	}

	if (data.quickActions.length > 0) {
		lines.push('quickActions:');
		for (const action of data.quickActions) {
			lines.push(`  - name: "${escapeYamlString(action.name)}"`);
			lines.push(`    icon: "${escapeYamlString(action.icon)}"`);
			lines.push(`    type: ${action.type}`);
			lines.push(`    target: "${escapeYamlString(action.target)}"`);
		}
	}

	if (data.quickActionOrder && data.quickActionOrder.length > 0) {
		lines.push('quickActionOrder:');
		for (const key of data.quickActionOrder) {
			lines.push(`  - "${escapeYamlString(key)}"`);
		}
	}

	if (data.hiddenPresets && data.hiddenPresets.length > 0) {
		lines.push('hiddenPresets:');
		for (const key of data.hiddenPresets) {
			lines.push(`  - "${escapeYamlString(key)}"`);
		}
	}

	lines.push('columns:');
	for (const col of data.columns) {
		lines.push(`  - name: ${col.name}`);
		lines.push(`    color: "${col.color}"`);
		if (col.sectionType) {
			lines.push(`    type: ${col.sectionType}`);
		}
		if (col.libraryConfig) {
			lines.push('    library:');
			const lc = col.libraryConfig;
			lines.push(`      viewMode: ${lc.viewMode}`);
			lines.push(`      sortBy: "${lc.sortBy}"`);
			lines.push(`      sortDesc: ${lc.sortDesc}`);
			if (lc.folders && lc.folders.length > 0) {
				lines.push('      folders:');
				for (const f of lc.folders) {
					lines.push(`        - "${escapeYamlString(f)}"`);
				}
			}
			if (lc.folderFilter && lc.folderFilter.length > 0) {
				lines.push('      folderFilter:');
				for (const f of lc.folderFilter) {
					lines.push(`        - "${escapeYamlString(f)}"`);
				}
			}
			if (lc.excludeFolders && lc.excludeFolders.length > 0) {
				lines.push('      excludeFolders:');
				for (const f of lc.excludeFolders) {
					lines.push(`        - "${escapeYamlString(f)}"`);
				}
			}
			if (lc.taskGroupBy) {
				lines.push(`      taskGroupBy: ${lc.taskGroupBy}`);
			}
			if (lc.kanbanGroupBy) {
				lines.push(`      kanbanGroupBy: "${escapeYamlString(lc.kanbanGroupBy)}"`);
			}
			// 'property' is the default group mode — only persist the opt-in.
			if (lc.groupMode === 'folder') {
				lines.push(`      groupMode: folder`);
			}
			if (lc.pageSize) {
				lines.push(`      pageSize: ${lc.pageSize}`);
			}
			if (lc.showProperties === false) {
				lines.push(`      showProperties: false`);
			}
			if (lc.propertyLimit != null) {
				lines.push(`      propertyLimit: ${lc.propertyLimit}`);
			}
				if (lc.quickDateFilter) {
					lines.push(`      quickDateFilter:`);
					lines.push(`        property: "${lc.quickDateFilter.property}"`);
					lines.push(`        start: "${lc.quickDateFilter.start}"`);
					lines.push(`        end: "${lc.quickDateFilter.end}"`);
					if (lc.quickDateFilter.days != null) {
						lines.push(`        days: ${lc.quickDateFilter.days}`);
					}
				}
			if (lc.filters.length > 0) {
				lines.push('      filters:');
				for (const filter of lc.filters) {
					lines.push(`        - property: "${escapeYamlString(filter.property)}"`);
					if (filter.values.length > 0) {
						lines.push(`          values: [${filter.values.map(v => `"${escapeYamlString(v)}"`).join(', ')}]`);
					} else {
						lines.push('          values: []');
					}
					if (filter.dateRange) {
						if (filter.dateRange.start) lines.push(`          dateStart: "${filter.dateRange.start}"`);
						if (filter.dateRange.end) lines.push(`          dateEnd: "${filter.dateRange.end}"`);
					}
				}
			}
		}
		if (col.height != null) {
			lines.push(`    height: ${col.height}`);
		}
		if (col.half) {
			lines.push('    half: true');
		}
		if (col.wereadConfig) {
			const wc = col.wereadConfig;
			lines.push('    weread:');
			lines.push('      widgets:');
			for (const w of wc.widgets) {
				lines.push(`        - id: "${escapeYamlString(w.id)}"`);
				lines.push(`          view: ${w.view}`);
				if (w.progressFilters?.length) {
					lines.push('          progressFilters:');
					for (const p of w.progressFilters) lines.push(`            - ${p}`);
				}
				if (w.categoryFilters?.length) {
					lines.push('          categoryFilters:');
					for (const c of w.categoryFilters) lines.push(`            - "${escapeYamlString(c)}"`);
				}
				if (w.title) lines.push(`          title: "${escapeYamlString(w.title)}"`);
			}
		}
		if (col.ticktickConfig) {
			const tc = col.ticktickConfig;
			lines.push('    ticktick:');
			lines.push(`      view: ${tc.view === 'lists' ? 'lists' : 'today'}`);
			if (tc.hiddenProjects?.length) {
				lines.push('      hiddenProjects:');
				for (const pid of tc.hiddenProjects) lines.push(`        - "${escapeYamlString(pid)}"`);
			}
		}
		if (col.dataviewConfig) {
			const dc = col.dataviewConfig;
			lines.push('    dataview:');
			// JSON.stringify yields a valid double-quoted YAML scalar and safely
			// escapes embedded newlines/quotes in the multi-line query.
			lines.push(`      query: ${JSON.stringify(dc.query)}`);
			if (dc.title) lines.push(`      title: ${JSON.stringify(dc.title)}`);
			if (dc.excludeFolders && dc.excludeFolders.length > 0) {
				lines.push('      excludeFolders:');
				for (const f of dc.excludeFolders) {
					lines.push(`        - "${escapeYamlString(f)}"`);
				}
			}
		}
	}

	lines.push('---');
	lines.push('');

	for (const column of data.columns) {
		lines.push(`## ${column.name}`);
		lines.push('');

		if (column.sectionType === 'library' || column.sectionType === 'folder' || column.sectionType === 'images' || column.sectionType === 'videos' || column.sectionType === 'alltasks' || column.sectionType === 'calendar' || column.sectionType === 'dataview') continue;

		for (const card of column.cards) {
			lines.push(`### ${card.title}`);

			if (card.id) {
				lines.push(`id: ${card.id}`);
			}

			if (card.type === 'task') {
				lines.push(`type: task`);
			}

			if (card.type === 'project') {
				lines.push(`type: project`);
			}

			if (card.wikiLink) {
				lines.push(`link: [[${card.wikiLink}]]`);
			} else if (card.url) {
				lines.push(`link: ${card.url}`);
			}

			if (card.progress >= 0 && card.type === 'project') {
				lines.push(`progress: ${card.progress}%`);
			}

			if (card.dueDate) {
				lines.push(`due: ${card.dueDate}`);
			}

			if (card.streak > 0 && card.type === 'habit') {
				lines.push(`streak: ${card.streak}`);
			}

			if (card.color) {
				// Store without the leading '#': a bare '#f59e0b' in the card body
				// would be picked up by Obsidian as a tag. Normalize back on read.
				lines.push(`color: ${card.color.replace(/^#/, '')}`);
			}

			if (card.coverImage) {
				lines.push(`cover: ${card.coverImage}`);
			}

			if (card.width > 0) {
				lines.push(`width: ${card.width}`);
			}
			if (card.size && card.size !== 'M') {
				lines.push(`size: ${card.size}`);
			}
			if (card.gridCols > 0) {
				lines.push(`cols: ${card.gridCols}`);
			}
			if (card.gridRows > 0) {
				lines.push(`rows: ${card.gridRows}`);
			}
			if (card.gridCol > 0) {
				lines.push(`gcol: ${card.gridCol}`);
			}
			if (card.gridRow > 0) {
				lines.push(`grow: ${card.gridRow}`);
			}
		if (card.weatherConfig) {
			const wc = card.weatherConfig;
			lines.push(`lat: ${wc.latitude}`);
			lines.push(`lon: ${wc.longitude}`);
			lines.push(`city: "${escapeYamlString(wc.cityName)}"`);
		}

		if (card.trackerConfig) {
			const tc = card.trackerConfig;
			lines.push(`track: ${tc.key}`);
			lines.push(`days: ${tc.days}`);
		}

			if (card.blockquote) {
				lines.push(`> ${card.blockquote}`);
			}

			if (card.tasks.length > 0) {
				const writeTask = (task: TaskItem, indent: number) => {
					const prefix = indent > 0 ? '    '.repeat(indent) : '';
					let taskLine = `${prefix}- [${task.checked ? 'x' : ' '}] ${task.text}`;
					if (task.reminder) taskLine += ` ⏰ ${task.reminder}`;
					if (task.collapsed) taskLine += ` <!--collapsed-->`;
					lines.push(taskLine);
					for (const child of task.children ?? []) writeTask(child, indent + 1);
				};
				for (const task of card.tasks) writeTask(task, 0);
			}

			if (card.docs.length > 0) {
				for (const docLine of serializeDocTree(card.docs)) lines.push(docLine);
			}

			const bodyLines = card.body.trim();
			if (bodyLines) {
				if (card.tasks.length > 0 || card.docs.length > 0 || card.blockquote || card.url || card.wikiLink) {
					lines.push('');
				}
				lines.push(bodyLines);
			}

			lines.push('');
		}
	}

	return lines.join('\n');
}

export function generateDefaultMarkdown(): string {
	const today = new Date();
	const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

	return serialize({
		banner: DEFAULT_BANNER,
		quickActions: [],
		columns: [
			{
				name: 'Memo',
				color: '#f59e0b',
				sectionType: 'memo',
				cards: [
					{
						id: 'demo-memo-1',
						title: t('default.memoTitle', { date: dateStr }),
						type: 'generic',
						column: 'Memo',
						body: t('default.memoBody'),
						tasks: [],
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
					},
					{
						id: 'demo-memo-path',
						title: t('default.memoPathTitle'),
						type: 'generic',
						column: 'Memo',
						body: t('default.memoPathBody'),
						tasks: [],
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
					},
					{
						id: 'demo-memo-rename',
						title: t('default.memoRenameTitle'),
						type: 'generic',
						column: 'Memo',
						body: t('default.memoRenameBody'),
						tasks: [],
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
					},
				],
			},
			{
				name: 'Todo',
				color: '#6366f1',
				sectionType: 'todo',
				cards: [
					{
						id: 'demo-todo-1',
						title: t('default.todoTitle1'),
						type: 'task',
						column: 'Todo',
						body: '',
						tasks: [
							{ text: t('default.todo1'), checked: false },
							{ text: t('default.todo2'), checked: false },
							{ text: t('default.todo3'), checked: false },
							{ text: t('default.todo4'), checked: false },
						],
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
					},
					{
						id: 'demo-todo-2',
						title: t('default.todoTitle2'),
						type: 'task',
						column: 'Todo',
						body: '',
						tasks: [
							{ text: t('default.guide1'), checked: false },
							{ text: t('default.guide2'), checked: false },
							{ text: t('default.guide3'), checked: false },
							{ text: t('default.guide4'), checked: false },
						],
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
					},
				],
			},
			{
				name: 'Projects',
				color: '#10b981',
				sectionType: 'projects',
				cards: [
					{
						id: 'demo-project-1',
						title: t('default.projectTitle'),
						type: 'project',
						column: 'Projects',
						body: '',
						tasks: [],
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
					},
				],
			},
			{
				name: 'Library',
				color: '#8b5cf6',
				sectionType: 'projects',
				cards: [
					{
						id: 'demo-lib-reading',
						title: 'Reading',
						type: 'project',
						column: 'Library',
						body: '',
						tasks: [],
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
					},
					{
						id: 'demo-lib-toread',
						title: 'To Read',
						type: 'project',
						column: 'Library',
						body: '',
						tasks: [],
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
					},
					{
						id: 'demo-lib-done',
						title: 'Done',
						type: 'project',
						column: 'Library',
						body: '',
						tasks: [],
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
					},
				],
			},
		],
	});
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
	const trimmed = markdown.trimStart();
	if (!trimmed.startsWith('---')) {
		return { frontmatter: {}, body: trimmed };
	}

	const end = trimmed.indexOf('---', 3);
	if (end === -1) {
		return { frontmatter: {}, body: trimmed };
	}

	const yaml = trimmed.slice(3, end).trim();
	const body = trimmed.slice(end + 3).trim();

	return { frontmatter: (parseYaml(yaml) ?? {}) as Record<string, unknown>, body };
}

function parseBanner(fm: Record<string, unknown>): BannerData {
	const raw = fm.banner as Record<string, unknown> | undefined;
	if (!raw) return { ...DEFAULT_BANNER, images: DEFAULT_BANNER.images ? [...DEFAULT_BANNER.images] : undefined };

	const quotesRaw = raw.quotes;
	let quotes: Array<{ quote: string; author: string }> | undefined;
	if (Array.isArray(quotesRaw)) {
		quotes = quotesRaw.map((item: Record<string, string>) => ({
			quote: item.quote ?? '',
			author: item.author ?? '',
		}));
	}

	const imagesRaw = raw.images;
	let images: string[] | undefined;
	if (Array.isArray(imagesRaw)) {
		images = (imagesRaw as unknown[]).map((item: unknown) => String(item)).filter((s: string) => s.trim());
	}

	return {
		quote: (raw.quote as string) ?? DEFAULT_BANNER.quote,
		author: (raw.author as string) ?? DEFAULT_BANNER.author,
		image: (raw.image as string) ?? '',
		quoteColor: (raw.quoteColor as string) || undefined,
		quotes,
		images,
		mode: raw.mode === 'stats' ? 'stats' : 'quote',
		statsConfig: parseStatsConfig(raw.statsConfig),
	};
}

/** Reconstruct the stats-banner config from frontmatter; undefined when absent
 *  (so resolveStatsConfig supplies defaults at render time). */
function parseStatsConfig(raw: unknown): BannerStatsConfig | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const r = raw as Record<string, unknown>;
	const cfg: BannerStatsConfig = {};
	if (typeof r.dailyFolder === 'string' && r.dailyFolder) cfg.dailyFolder = r.dailyFolder;
	if (typeof r.dailyFormat === 'string' && r.dailyFormat) cfg.dailyFormat = r.dailyFormat;
	if (typeof r.streakFromDaily === 'boolean') cfg.streakFromDaily = r.streakFromDaily;
	if (Array.isArray(r.excludeFolders)) {
		const folders = r.excludeFolders.filter((f): f is string => typeof f === 'string' && f.trim() !== '');
		if (folders.length > 0) cfg.excludeFolders = folders;
	}
	if (typeof r.accent === 'string' && r.accent) cfg.accent = r.accent;
	if (typeof r.blur === 'number') cfg.blur = r.blur;
	if (typeof r.darkness === 'number') cfg.darkness = r.darkness;
	if (typeof r.showDetails === 'boolean') cfg.showDetails = r.showDetails;
	if (typeof r.showLeft === 'boolean') cfg.showLeft = r.showLeft;
	if (typeof r.showCenter === 'boolean') cfg.showCenter = r.showCenter;
	if (typeof r.showRight === 'boolean') cfg.showRight = r.showRight;
	if (typeof r.leftStat === 'string') cfg.leftStat = r.leftStat as BannerLeftStat;
	if (typeof r.centerStat === 'string') cfg.centerStat = r.centerStat as BannerCenterStat;
	if (r.heatmapSource === 'notes' || r.heatmapSource === 'habit') cfg.heatmapSource = r.heatmapSource;
	if (typeof r.heatmapHabitId === 'string' && r.heatmapHabitId) cfg.heatmapHabitId = r.heatmapHabitId;
	if (Array.isArray(r.rightStats)) {
		const stats = r.rightStats.filter((s): s is BannerRightStat => typeof s === 'string');
		if (stats.length > 0) cfg.rightStats = stats;
	}
	return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function parseQuickActions(fm: Record<string, unknown>): QuickAction[] {
	const rawActions = fm.quickActions;
	if (Array.isArray(rawActions)) {
		return rawActions.map((item: Record<string, string>) => ({
			name: item.name ?? '',
			icon: item.icon ?? (item.type === 'command' ? 'terminal' : 'file-text'),
			type: item.type === 'command' ? 'command' as const : 'file' as const,
			target: item.target ?? '',
		})).filter(a => a.name && a.target);
	}

	// Backward compat: migrate old quickLinks
	const rawLinks = fm.quickLinks;
	if (Array.isArray(rawLinks)) {
		return rawLinks.map((item: Record<string, string>) => ({
			name: item.name ?? '',
			icon: 'file-text',
			type: 'file' as const,
			target: item.path ?? '',
		})).filter(a => a.name && a.target);
	}

	return [];
}

function parseQuickActionOrder(fm: Record<string, unknown>): string[] | undefined {
	const raw = fm.quickActionOrder;
	if (Array.isArray(raw) && raw.length > 0) {
		return raw.map((v: unknown) => String(v));
	}
	return undefined;
}

function parseHiddenPresets(fm: Record<string, unknown>): string[] | undefined {
	const raw = fm.hiddenPresets;
	if (Array.isArray(raw) && raw.length > 0) {
		return raw.map((v: unknown) => String(v));
	}
	return undefined;
}

function parseColumnDefs(fm: Record<string, unknown>): Array<{ name: string; color: string; sectionType?: string; libraryConfig?: LibraryConfig; wereadConfig?: WereadConfig; ticktickConfig?: TickTickConfig; dataviewConfig?: DataviewConfig; height?: number; half?: boolean }> {
	const raw = fm.columns;
	if (!Array.isArray(raw)) return DEFAULT_COLUMNS;

	return (raw as Array<Record<string, unknown>>).map(item => ({
			name: String((item.name ?? 'Unnamed') as string | number | boolean),
			color: String((item.color ?? '#6366f1') as string | number | boolean),
		sectionType: item.type ? String(item.type as string | number | boolean) : undefined,
		libraryConfig: item.library ? parseLibraryConfig(item.library as Record<string, unknown>) : undefined,
		wereadConfig: item.weread ? parseWereadConfig(item.weread as Record<string, unknown>) : undefined,
		ticktickConfig: item.ticktick ? parseTickTickConfig(item.ticktick as Record<string, unknown>) : undefined,
		dataviewConfig: item.dataview ? parseDataviewConfig(item.dataview as Record<string, unknown>) : undefined,
		height: typeof item.height === 'number' ? item.height : undefined,
		half: item.half === true ? true : undefined,
	}));
}

function parseColumns(body: string, defs: Array<{ name: string; color: string; sectionType?: string; libraryConfig?: LibraryConfig; wereadConfig?: WereadConfig; ticktickConfig?: TickTickConfig; dataviewConfig?: DataviewConfig; height?: number; half?: boolean }>): DashboardColumn[] {
	const sections = splitByH2(body);
	const defMap = new Map(defs.map(d => [d.name, d]));
	const usedDefIndices = new Set<number>();

	const mapped = sections.map((section, sectionIdx) => {
		let def = defMap.get(section.heading);
		if (!def && sectionIdx < defs.length && !usedDefIndices.has(sectionIdx)) {
			def = defs[sectionIdx];
		}
		if (def) {
			const defIdx = defs.indexOf(def);
			usedDefIndices.add(defIdx);
		}
		const cards = parseCards(section.content, section.heading);
		const resolvedType = resolveSectionType(section.heading, cards, def?.sectionType);
		return {
			name: section.heading,
			color: def?.color ?? '#6366f1',
			sectionType: resolvedType,
			// Memo cards render only their body text and never a doc list, so wikilinks
			// the parser lifted into `docs` would be invisible (and lost on round-trip).
			// Fold them back into the body so they display as clickable links and stay
			// stable across save/reload. Project/notes/etc. sections keep using `docs`.
			// Sticky ("便利贴") sections mix memo and todo cards; only their memo-ish
			// cards (generic/note) get the same folding — todo cards keep `docs` intact.
			cards: resolvedType === 'memo'
				? cards.map(foldDocsIntoBody)
				: resolvedType === 'sticky'
					? cards.map(c => (c.type === 'generic' || c.type === 'note') ? foldDocsIntoBody(c) : c)
					: cards,
			libraryConfig: def?.libraryConfig,
			wereadConfig: def?.wereadConfig,
			ticktickConfig: def?.ticktickConfig,
			dataviewConfig: def?.dataviewConfig,
			height: def?.height,
			half: def?.half,
		};
	});
	// Self-heal hand-edited frontmatter: a lone `half: true` (or an odd run)
	// pairs with no one and would render as an orphan half-width row.
	return normalizeColumnPairs(mapped);
}

// Memo sections keep their `[[wikilink]]` lines as body text instead of a doc list.
function foldDocsIntoBody(card: DashboardCard): DashboardCard {
	if (card.docs.length === 0) return card;

	const paths: string[] = [];
	const walk = (nodes: DocNode[]) => {
		for (const n of nodes) {
			paths.push(n.path);
			if (n.children) walk(n.children);
		}
	};
	walk(card.docs);

	const docLines = paths.map(p => `[[${p}]]`);
	const body = card.body ? `${card.body}\n${docLines.join('\n')}` : docLines.join('\n');
	return { ...card, body, docs: [] };
}

function resolveSectionType(
	name: string,
	cards: DashboardCard[],
	fallback?: string,
): string {
	if (fallback && SECTION_TYPES.has(fallback)) return fallback;

	const lower = name.toLowerCase();
	if (SECTION_TYPES.has(lower)) return lower;

	if (cards.length > 0) {
		const types = new Set(cards.map(c => c.type));
		const dashboardTypes = new Set(['weather', 'tracker']);
		if ([...types].every(t => dashboardTypes.has(t)) && types.size > 0) return 'dashboard';
		if (types.has('task') && types.size === 1) return 'todo';
		if (types.has('task') && !types.has('project')) return 'todo';
		if (types.has('project') && types.size === 1) return 'projects';
		if (types.has('generic') && !types.has('project') && !types.has('task')) return 'memo';
	}

	return 'projects';
}

function str(v: unknown): string {
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

function parseLibraryConfig(raw: Record<string, unknown>): LibraryConfig {
	const filters: import('./types').PropertyFilter[] = [];
	const rawFilters = raw.filters;
	if (Array.isArray(rawFilters)) {
		for (const item of rawFilters) {
			const rec = item as Record<string, unknown>;
			const property = str(rec.property ?? '');
			const rawValues = rec.values;
			const values = Array.isArray(rawValues) ? rawValues.map((v: unknown) => String(v)) : [];
			const dateStart = rec.dateStart ? str(rec.dateStart) : '';
			const dateEnd = rec.dateEnd ? str(rec.dateEnd) : '';
			const dateRange = (dateStart || dateEnd) ? { start: dateStart, end: dateEnd } : undefined;
			filters.push({ property, values, dateRange });
		}
	}

	return {
		filters,
		viewMode: (['grid', 'list', 'table', 'kanban'].includes(str(raw.viewMode ?? '')) ? raw.viewMode : 'grid') as import('./types').LibraryViewMode,
		sortBy: str(raw.sortBy ?? 'modified'),
		sortDesc: raw.sortDesc !== false,
		kanbanGroupBy: raw.kanbanGroupBy ? str(raw.kanbanGroupBy) : undefined,
		groupMode: ['property', 'folder'].includes(str(raw.groupMode ?? '')) ? (raw.groupMode as import('./types').LibraryConfig['groupMode']) : undefined,
		pageSize: typeof raw.pageSize === 'number' ? raw.pageSize : undefined,
		showProperties: raw.showProperties === false ? false : undefined,
		propertyLimit: typeof raw.propertyLimit === 'number' ? raw.propertyLimit : undefined,
		folders: Array.isArray(raw.folders) ? raw.folders.map((v: unknown) => String(v)) : (typeof raw.folder === 'string' ? [raw.folder] : undefined),
		folderFilter: Array.isArray(raw.folderFilter) ? raw.folderFilter.map((v: unknown) => String(v)) : undefined,
		excludeFolders: Array.isArray(raw.excludeFolders) ? raw.excludeFolders.map((v: unknown) => String(v)) : undefined,
		taskGroupBy: ['date', 'priority', 'none'].includes(str(raw.taskGroupBy ?? '')) ? (raw.taskGroupBy as import('./types').LibraryConfig['taskGroupBy']) : undefined,
			quickDateFilter: raw.quickDateFilter && typeof raw.quickDateFilter === 'object' ? {
				property: (raw.quickDateFilter as Record<string, unknown>).property === 'modified' ? 'modified' as const : 'created' as const,
				start: str((raw.quickDateFilter as Record<string, unknown>).start ?? ''),
				end: str((raw.quickDateFilter as Record<string, unknown>).end ?? ''),
				days: (() => {
					const d = (raw.quickDateFilter as Record<string, unknown>).days;
					return typeof d === 'number' && d > 0 ? d : undefined;
				})(),
			} : undefined,
		};
	}

function parseWereadConfig(raw: Record<string, unknown>): WereadConfig {
	const validView = (v: unknown): WereadConfig['widgets'][number]['view'] =>
		['shelf', 'stats', 'notes'].includes(str(v ?? '')) ? str(v) as WereadConfig['widgets'][number]['view'] : 'shelf';

	// New shape: widgets[]
	if (Array.isArray(raw.widgets)) {
		const widgets = (raw.widgets as Array<Record<string, unknown>>)
			.filter(w => w && typeof w === 'object')
			.map((w, i) => ({
				id: String((w.id ?? `w${i + 1}`) as string | number | boolean),
				view: validView(w.view),
				progressFilters: Array.isArray(w.progressFilters) ? (w.progressFilters as Array<unknown>).map(p => String(p as string | number | boolean)) : undefined,
				categoryFilters: Array.isArray(w.categoryFilters) ? (w.categoryFilters as Array<unknown>).map(c => String(c as string | number | boolean)) : undefined,
				title: w.title ? String(w.title as string | number | boolean) : undefined,
			}));
		if (widgets.length > 0) return { widgets };
	}
	// Legacy shape: single view (+ bookFilter) → migrate to a category filter.
	const legacyFilter = typeof raw.bookFilter === 'string' ? raw.bookFilter : undefined;
	return {
		widgets: [{
			id: 'w1',
			view: validView(raw.view),
			categoryFilters: legacyFilter && legacyFilter !== 'all' ? [legacyFilter] : undefined,
		}],
	};
}

function parseTickTickConfig(raw: Record<string, unknown>): TickTickConfig {
	const view: TickTickConfig['view'] = raw['view'] === 'lists' ? 'lists' : 'today';
	const hiddenProjects = Array.isArray(raw['hiddenProjects'])
		? (raw['hiddenProjects'] as Array<unknown>).map(v => String(v as string | number | boolean)).filter(v => v.length > 0)
		: undefined;
	return { view, hiddenProjects: hiddenProjects?.length ? hiddenProjects : undefined };
}

function parseDataviewConfig(raw: Record<string, unknown>): DataviewConfig {
	const query = str(raw.query ?? '');
	const title = raw.title ? str(raw.title) : undefined;
	return {
		query,
		title: title && title.length > 0 ? title : undefined,
		excludeFolders: Array.isArray(raw.excludeFolders) ? raw.excludeFolders.map((v: unknown) => String(v)) : undefined,
	};
}

function splitByH2(body: string): Array<{ heading: string; content: string }> {
	const lines = body.split('\n');
	const sections: Array<{ heading: string; content: string }> = [];
	let current: { heading: string; lines: string[] } | null = null;

	for (const line of lines) {
		if (line.startsWith('## ')) {
			if (current) {
				sections.push({ heading: current.heading, content: current.lines.join('\n').trim() });
			}
			current = { heading: line.slice(3).trim(), lines: [] };
		} else if (current) {
			current.lines.push(line);
		}
	}

	if (current) {
		sections.push({ heading: current.heading, content: current.lines.join('\n').trim() });
	}

	return sections;
}

function parseCards(content: string, columnName: string): DashboardCard[] {
	const blocks = splitByH3(content);
	return blocks.map(block => parseCard(block, columnName));
}

function splitByH3(content: string): Array<{ title: string; body: string }> {
	const lines = content.split('\n');
	const blocks: Array<{ title: string; body: string }> = [];
	let current: { title: string; lines: string[] } | null = null;

	for (const line of lines) {
		if (line.startsWith('### ')) {
			if (current) {
				blocks.push({ title: current.title, body: current.lines.join('\n').trim() });
			}
			current = { title: line.slice(4).trim(), lines: [] };
		} else if (current) {
			current.lines.push(line);
		}
	}

	if (current) {
		blocks.push({ title: current.title, body: current.lines.join('\n').trim() });
	}

	return blocks;
}

function parseCard(block: { title: string; body: string }, columnName: string): DashboardCard {
	const { metadata, tasks, docs, blockquote, cleanBody } = extractCardParts(block.body);
	const cardType = detectCardType(tasks, blockquote, metadata);
	const weatherConfig = cardType === 'weather' ? parseWeatherConfig(metadata) : undefined;
	const trackerConfig = cardType === 'tracker' ? parseTrackerConfig(metadata) : undefined;

	return {
		id: metadata.id ?? generateId(block.title, columnName),
		title: block.title,
		type: cardType,
		column: columnName,
		body: cleanBody,
		tasks,
		docs,
		url: extractUrl(metadata),
		wikiLink: extractWikiLink(metadata),
		progress: extractProgress(metadata),
		streak: extractStreak(metadata),
		dueDate: extractDue(metadata),
		blockquote,
		color: normalizeHexColor(metadata.color),
		coverImage: metadata.cover ?? '',
		width: parseInt(metadata.width ?? '0', 10) || 0,
			size: parseCardSize(metadata.size),
		gridCols: parseInt(metadata.cols ?? '0', 10) || 0,
		gridRows: parseInt(metadata.rows ?? '0', 10) || 0,
		gridCol: parseInt(metadata.gcol ?? '0', 10) || 0,
		gridRow: parseInt(metadata.grow ?? '0', 10) || 0,
			weatherConfig,
			trackerConfig,
	};
}

function extractCardParts(body: string): {
	metadata: Record<string, string>;
	tasks: TaskItem[];
	docs: DocNode[];
	blockquote: string;
	cleanBody: string;
} {
	const lines = body.split('\n');
	const metadata: Record<string, string> = {};
	const tasks: TaskItem[] = [];
	const docLines: string[] = [];
	const bodyLines: string[] = [];
	let blockquote = '';
	let currentParent: TaskItem | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		const isIndented = /^(\t| {4})/.test(line);

		const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
		if (kvMatch && kvMatch[1] && kvMatch[2] && KNOWN_METADATA_KEYS.has(kvMatch[1])) {
			metadata[kvMatch[1]] = kvMatch[2];
			currentParent = null;
			continue;
		}

		const taskMatch = trimmed.match(/^- \[([ xX])\]\s*(.+)$/);
		if (taskMatch && taskMatch[1] && taskMatch[2]) {
			let taskText = taskMatch[2];
			let taskReminder: string | undefined;
			let taskCollapsed = false;
			const collapsedMatch = taskText.match(COLLAPSED_REGEX);
			if (collapsedMatch) {
				taskText = taskText.replace(COLLAPSED_REGEX, '');
				taskCollapsed = true;
			}
			const reminderMatch = taskText.match(REMINDER_REGEX);
			if (reminderMatch) {
				taskText = taskText.replace(REMINDER_REGEX, '');
				taskReminder = reminderMatch[1];
			}
			const node: TaskItem = { checked: taskMatch[1] !== ' ', text: taskText, reminder: taskReminder, collapsed: taskCollapsed };
			if (isIndented && currentParent) {
				currentParent.children = [...(currentParent.children ?? []), node];
			} else {
				tasks.push(node);
				currentParent = node;
			}
			continue;
		}

		const docMatch = line.match(DOC_LINE_REGEX);
		if (docMatch) {
			docLines.push(line);
			continue;
		}

		currentParent = null;

		if (trimmed.startsWith('> ')) {
			blockquote += (blockquote ? '\n' : '') + trimmed.slice(2);
			continue;
		}

		if (trimmed) {
			bodyLines.push(trimmed);
		}
	}

	return { metadata, tasks, docs: parseDocTree(docLines), blockquote, cleanBody: bodyLines.join('\n') };
}

const DOC_TREE_INDENT = 4;

// Parse document-link lines (optionally nested list / indented) into a tree.
// Stack-based so arbitrary nesting depth is supported (unlike tasks' single parent).
function parseDocTree(rawLines: string[]): DocNode[] {
	const root: DocNode[] = [];
	const stack: { depth: number; node: DocNode }[] = [];
	for (const line of rawLines) {
		const m = line.match(DOC_LINE_REGEX);
		if (!m) continue;
		const indentSpaces = (m[1] ?? '').replace(/\t/g, '    ');
		const depth = Math.floor(indentSpaces.length / DOC_TREE_INDENT);
		const node: DocNode = { path: m[2]! };
		if (m[3]) node.collapsed = true;
		while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
		if (stack.length === 0) {
			root.push(node);
		} else {
			const parent = stack[stack.length - 1]!.node;
			parent.children = [...(parent.children ?? []), node];
		}
		stack.push({ depth, node });
	}
	return root;
}

function serializeDocTree(docs: DocNode[]): string[] {
	const lines: string[] = [];
	const write = (node: DocNode, indent: number) => {
		const prefix = indent > 0 ? '    '.repeat(indent) : '';
		let line = `${prefix}- [[${node.path}]]`;
		if (node.collapsed) line += ` <!--collapsed-->`;
		lines.push(line);
		for (const child of node.children ?? []) write(child, indent + 1);
	};
	for (const doc of docs) write(doc, 0);
	return lines;
}

function detectCardType(
	tasks: TaskItem[],
	blockquote: string,
	metadata: Record<string, string>,
): CardType {
	if (metadata.type === 'task') return 'task';
	if (metadata.type === 'project') return 'project';
	if (metadata.type === 'weather') return 'weather';
	if (metadata.type === 'tracker') return 'tracker';

	const link = metadata.link ?? '';

	if (tasks.length > 0) return 'task';
	if (blockquote) return 'note';
	if (metadata.streak) return 'habit';
	if (link.startsWith('[[')) return 'project';
	if (link.startsWith('http')) return 'link';
	if (metadata.progress) return 'project';
	return 'generic';
}

function parseCardSize(raw: string | undefined): CardSize {
	const v = (raw ?? '').toUpperCase().trim();
	if (v === 'S' || v === 'L') return v;
	return 'M';
}

function extractUrl(metadata: Record<string, string>): string {
	const link = metadata.link ?? '';
	return link.startsWith('http') ? link : '';
}

function extractWikiLink(metadata: Record<string, string>): string {
	const link = metadata.link ?? '';
	const match = link.match(/^\[\[(.+)]]$/);
	return match && match[1] ? match[1] : '';
}

function extractProgress(metadata: Record<string, string>): number {
	if (!metadata.progress) return -1;
	const num = parseInt(metadata.progress.replace('%', ''), 10);
	return isNaN(num) ? -1 : Math.min(100, Math.max(0, num));
}

function extractStreak(metadata: Record<string, string>): number {
	if (!metadata.streak) return 0;
	const num = parseInt(metadata.streak, 10);
	return isNaN(num) ? 0 : num;
}

function extractDue(metadata: Record<string, string>): string {
	return metadata.due ?? '';
}

function generateId(title: string, column: string): string {
	const raw = `${title}::${column}`;
	let hash = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw.charCodeAt(i);
		hash = ((hash << 5) - hash) + ch;
		hash |= 0;
	}
	return `card-${Math.abs(hash).toString(36)}`;
}

function escapeYamlString(str: string): string {
	return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function dequote(value: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
	}
	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}
	return value;
}

function parseWeatherConfig(metadata: Record<string, string>): WeatherConfig {
	return {
		latitude: parseFloat(metadata.lat ?? '0') || 0,
		longitude: parseFloat(metadata.lon ?? '0') || 0,
		cityName: dequote(metadata.city ?? ''),
	};
}

function parseTrackerConfig(metadata: Record<string, string>): TrackerConfig {
	const style = metadata.style ?? 'line';
	return {
		key: metadata.track ?? '',
		days: parseInt(metadata.days ?? '14', 10) || 14,
		style: style === 'heatmap' || style === 'bar' ? style : 'line',
	};
}
