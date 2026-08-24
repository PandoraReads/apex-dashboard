import { App, setIcon } from 'obsidian';
import type { BannerCenterStat, BannerLeftStat, BannerRightStat, BannerStatsConfig } from './types';
import { momentOf, nowMoment, parseStrict } from './datetime';
import { getDailyNotesConfig } from './daily-notes';
import { t } from './i18n';

export const DEFAULT_STATS_CONFIG: BannerStatsConfig = {
	showDetails: true,
	leftStat: 'totalNotes',
	centerStat: 'streak',
	rightStats: ['taskCompletion', 'connectivity', 'avgLinksPerNote'],
};

/** Dropdown options shared by the render code and the settings modal. */
export const LEFT_STAT_OPTIONS: BannerLeftStat[] = [
	'totalNotes', 'tagsCount', 'totalLinks', 'newThisMonth', 'newThisWeek', 'totalTasks', 'doneTasks', 'pendingTasks',
];
export const CENTER_STAT_OPTIONS: BannerCenterStat[] = ['streak', 'taskCompletion', 'connectivity', 'newThisWeek'];
export const RIGHT_STAT_OPTIONS: BannerRightStat[] = ['taskCompletion', 'connectivity', 'orphanRate', 'avgLinksPerNote'];

/** Fill a (possibly partial / absent) config with defaults. Returns a fresh copy. */
export function resolveStatsConfig(config?: BannerStatsConfig): BannerStatsConfig {
	return {
		dailyFolder: config?.dailyFolder,
		dailyFormat: config?.dailyFormat,
		streakFromDaily: config?.streakFromDaily,
		excludeFolders: config?.excludeFolders ? [...config.excludeFolders] : undefined,
		accent: config?.accent,
		blur: config?.blur,
		darkness: config?.darkness,
		showDetails: config?.showDetails ?? true,
		showLeft: config?.showLeft ?? true,
		showCenter: config?.showCenter ?? true,
		showRight: config?.showRight ?? true,
		leftStat: config?.leftStat ?? 'totalNotes',
		centerStat: config?.centerStat ?? 'streak',
		rightStats: config?.rightStats && config.rightStats.length > 0
			? [...config.rightStats]
			: ['taskCompletion', 'connectivity', 'avgLinksPerNote'],
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Heatmap spans this many days, laid out as a wrapping horizontal strip. */
const HEATMAP_DAYS = 98; // ≈ 14 weeks

const LEFT_ICONS: Record<BannerLeftStat, string> = {
	totalNotes: 'file-text', tagsCount: 'hash', totalLinks: 'link',
	newThisMonth: 'calendar-plus', newThisWeek: 'calendar-check',
	totalTasks: 'list-checks', doneTasks: 'check-check', pendingTasks: 'circle-dashed',
};
const CENTER_ICONS: Record<BannerCenterStat, string> = {
	streak: 'flame', taskCompletion: 'check-check', connectivity: 'network', newThisWeek: 'calendar-check',
};
const RIGHT_ICONS: Record<BannerRightStat, string> = {
	taskCompletion: 'list-checks', connectivity: 'network', orphanRate: 'circle-slash', avgLinksPerNote: 'link',
};

export interface BannerStatsResult {
	totalNotes: number;
	newThisMonth: number;
	newThisWeek: number;
	tagsCount: number;
	/** Consecutive days with a daily note. Only meaningful when `hasDailySource`
	 *  is true; otherwise the daily-notes folder could not be resolved and the
	 *  streak falls back to `activeStreak` semantics (see below). */
	streak: number;
	/** True when a daily-notes source (manual folder or the core plugin) was
	 *  resolved AND yielded at least one matching note. When false, `streak`
	 *  equals `activeStreak` and the label must read "活跃天数", not "连续记录",
	 *  so the number never silently switches meaning between page loads. */
	hasDailySource: boolean;
	/** Consecutive days on which ANY markdown file was created in the vault —
	 *  the same dataset the heatmap is drawn from. Deterministic across loads. */
	activeStreak: number;
	totalLinks: number;
	orphanNotes: number;
	orphanRate: number; // 0–100
	avgLinksPerNote: number;
	connectivity: number; // 0–100
	totalTasks: number;
	doneTasks: number;
	pendingTasks: number;
	taskCompletion: number; // 0–100
	/** Notes created per day for the last HEATMAP_DAYS, oldest → today. */
	activity: number[];
}

/** Compute every banner statistic in a single vault pass (no file reads — uses
 *  `file.stat`, the metadata cache, and the prebuilt `resolvedLinks` map). */
export function computeBannerStats(app: App, config?: BannerStatsConfig): BannerStatsResult {
	// Excluded folders are matched by path prefix (case-insensitive), same
	// semantics as the calendar widget's exclusions — a checked parent covers
	// its whole subtree.
	const excludeFolders = (config?.excludeFolders ?? [])
		.map(f => f.trim().toLowerCase())
		.filter(f => f !== '' && f !== '/');
	const isExcluded = (path: string): boolean => {
		if (excludeFolders.length === 0) return false;
		const lower = path.toLowerCase();
		return excludeFolders.some(f => lower === f || lower.startsWith(f + '/'));
	};
	const files = app.vault.getMarkdownFiles().filter(f => !isExcluded(f.path));
	const now = nowMoment();
	const startOfMonth = now.clone().startOf('month').valueOf();
	const weekAgoMs = now.clone().subtract(6, 'days').startOf('day').valueOf();
	const todayStartMs = now.clone().startOf('day').valueOf();
	const heatStartMs = now.clone().subtract(HEATMAP_DAYS - 1, 'days').startOf('day').valueOf();

	let totalNotes = 0;
	let newThisMonth = 0;
	let newThisWeek = 0;
	let orphanNotes = 0;
	const activity = new Array<number>(HEATMAP_DAYS).fill(0);
	const tagCounts = new Map<string, number>();
	const activityDates = new Set<string>();

	const resolved = app.metadataCache.resolvedLinks;
	const hasOutgoing = new Set<string>();
	const hasIncoming = new Set<string>();
	let totalLinks = 0;
	for (const [src, targets] of Object.entries(resolved)) {
		if (isExcluded(src)) continue;
		// Links touching excluded folders on either end do not count, so
		// connectivity/orphan stats stay consistent with the filtered file set.
		let kept = 0;
		for (const [tgt, count] of Object.entries(targets)) {
			if (isExcluded(tgt)) continue;
			hasIncoming.add(tgt);
			totalLinks += count;
			kept++;
		}
		if (kept > 0) hasOutgoing.add(src);
	}

	let totalTasks = 0;
	let doneTasks = 0;

	for (const file of files) {
		if (file.path.startsWith('.')) continue;
		totalNotes++;

		const ctime = file.stat.ctime;
		if (ctime >= startOfMonth) newThisMonth++;
		if (ctime >= weekAgoMs) newThisWeek++;
		if (ctime >= heatStartMs) {
			const dayDiff = Math.floor((todayStartMs - momentOf(ctime).startOf('day').valueOf()) / DAY_MS);
			if (dayDiff >= 0 && dayDiff < HEATMAP_DAYS) activity[HEATMAP_DAYS - 1 - dayDiff]! += 1;
		}
		activityDates.add(momentOf(ctime).format('YYYY-MM-DD'));

		if (!hasOutgoing.has(file.path) && !hasIncoming.has(file.path)) orphanNotes++;

		const cache = app.metadataCache.getFileCache(file);
		const fmTags: unknown = cache?.frontmatter?.tags;
		const addTag = (raw: unknown): void => {
			if (raw == null) return;
			if (Array.isArray(raw)) {
				for (const tg of raw) addTag(tg);
			} else if (typeof raw === 'string' || typeof raw === 'number') {
				const tag = String(raw).replace(/^#/, '').trim();
				if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		};
		addTag(fmTags);
		if (cache?.tags) {
			for (const tg of cache.tags) {
				const tag = tg.tag.replace(/^#/, '').trim();
				if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		if (cache?.listItems) {
			for (const li of cache.listItems) {
				if (li.task === undefined) continue;
				totalTasks++;
				if (li.task === 'x' || li.task === 'X') doneTasks++;
			}
		}
	}

	const manual = (config?.dailyFolder ?? '').trim();
	const dailyCfg = manual ? { folder: manual, format: config?.dailyFormat || 'YYYY-MM-DD' } : getDailyNotesConfig(app);

	// `activeStreak` is always derived from the same file-creation set the
	// heatmap uses, so it is stable across loads. It is the ONLY streak value
	// when no daily-notes source is available.
	const activeStreak = computeDateStreak(activityDates);

	// The "real" streak counts daily notes only. We must NOT silently fall back
	// to `activityDates` when the daily source is empty/unavailable — that was
	// the root cause of the number flipping meaning between page loads (a small
	// daily-note streak one load, a large all-vault streak the next). Instead
	// we record whether a daily source was usable; the renderer swaps the LABEL
	// (连续记录 vs 活跃天数) so the number's meaning is always unambiguous.
	// `streakFromDaily: false` opts out of the daily source entirely: the
	// streak then counts any note creation (the 活跃天数 semantics).
	let streak = 0;
	let hasDailySource = false;
	if (config?.streakFromDaily !== false && dailyCfg) {
		const dailyDates = collectDailyNoteDates(app, dailyCfg.folder, dailyCfg.format);
		if (dailyDates.size > 0) {
			streak = computeDateStreak(dailyDates);
			hasDailySource = true;
		}
	}
	if (!hasDailySource) streak = activeStreak;

	return {
		totalNotes, newThisMonth, newThisWeek, tagsCount: tagCounts.size,
		streak, hasDailySource, activeStreak, totalLinks, orphanNotes,
		orphanRate: totalNotes > 0 ? Math.round((orphanNotes / totalNotes) * 100) : 0,
		avgLinksPerNote: totalNotes > 0 ? totalLinks / totalNotes : 0,
		connectivity: totalNotes > 0 ? Math.round(((totalNotes - orphanNotes) / totalNotes) * 100) : 0,
		totalTasks, doneTasks, pendingTasks: totalTasks - doneTasks,
		taskCompletion: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
		activity,
	};
}

function collectDailyNoteDates(app: App, folder: string, format: string): Set<string> {
	const dates = new Set<string>();
	const prefix = folder ? `${folder}/` : '';
	for (const file of app.vault.getMarkdownFiles()) {
		if (prefix && !file.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;
		if (prefix && file.path.slice(prefix.length).includes('/')) continue;
		const m = parseStrict(file.basename, format);
		if (m.isValid()) dates.add(m.format('YYYY-MM-DD'));
	}
	return dates;
}

function computeDateStreak(dates: Set<string>): number {
	if (dates.size === 0) return 0;
	let cursor = nowMoment().startOf('day');
	if (!dates.has(cursor.format('YYYY-MM-DD'))) cursor = cursor.subtract(1, 'day');
	let streak = 0;
	while (dates.has(cursor.format('YYYY-MM-DD'))) {
		streak++;
		cursor = cursor.subtract(1, 'day');
	}
	return streak;
}

function formatInt(n: number): string {
	return n.toLocaleString();
}

/** Push the blur/darkness config onto the banner element as CSS vars consumed
 *  by the `.dashboard-banner--stats::before` scrim. */
function applyBackdropVars(bannerEl: HTMLElement, config: BannerStatsConfig): void {
	const blur = config.blur ?? 2;
	const darkness = config.darkness ?? 20;
	const bright = Math.max(0.3, 1 - (darkness / 100) * 0.7);
	const scrim = 0.25 + (darkness / 100) * 0.5;
	bannerEl.style.setProperty('--banner-blur', `${blur}px`);
	bannerEl.style.setProperty('--banner-bright', String(bright));
	bannerEl.style.setProperty('--banner-scrim', String(scrim));
}

export function renderBannerStats(
	parent: HTMLElement,
	config: BannerStatsConfig | undefined,
	app: App,
): HTMLElement {
	const resolved = resolveStatsConfig(config);
	applyBackdropVars(parent, resolved);
	applyAccentVar(parent, resolved.accent);
	const el = parent.createDiv({ cls: 'dashboard-banner-stats' });
	renderStatColumns(el, resolved, computeBannerStats(app, config), true);
	return el;
}

export function refreshBannerStats(container: HTMLElement, config: BannerStatsConfig | undefined, app: App): void {
	if (!container.isConnected) return;
	const resolved = resolveStatsConfig(config);
	const bannerEl = container.parentElement;
	if (bannerEl) {
		applyBackdropVars(bannerEl, resolved);
		applyAccentVar(bannerEl, resolved.accent);
	}
	container.empty();
	renderStatColumns(container, resolved, computeBannerStats(app, config), false);
}

/** Accent lives on the banner element so both the ::after tint (pseudo of the
 *  banner) and the descendant icons/heatmap inherit it. Defaults to #bff038
 *  when unset (cleared via the modal reset). */
function applyAccentVar(bannerEl: HTMLElement, accent: string | undefined): void {
	bannerEl.style.setProperty('--banner-stat-accent', accent ?? '#bff038');
}

function renderStatColumns(container: HTMLElement, config: BannerStatsConfig, r: BannerStatsResult, animate: boolean): void {
	if (config.showLeft !== false) renderLeftColumn(container, config, r, animate);
	if (config.showCenter !== false) renderCenterColumn(container, config, r, animate);
	if (config.showRight !== false) renderRightColumn(container, config, r);
}

/** Hero row shared by left & center: icon + big number, top-aligned. */
function renderHeroRow(parent: HTMLElement, icon: string, numText: string): HTMLElement {
	const hero = parent.createDiv({ cls: 'dashboard-banner-stat-hero' });
	const iconWrap = hero.createDiv({ cls: 'dashboard-banner-stat-icon' });
	setIcon(iconWrap, icon);
	hero.createDiv({ cls: 'dashboard-banner-stat-num', text: numText });
	return hero;
}

/** Left (flex 1) — Scale: big number + label up top, iconified strip at bottom. */
function renderLeftColumn(container: HTMLElement, config: BannerStatsConfig, r: BannerStatsResult, animate: boolean): void {
	const col = container.createDiv({ cls: 'dashboard-banner-stat-col dashboard-banner-stat-col--left' });
	const stat = config.leftStat ?? 'totalNotes';

	const top = col.createDiv({ cls: 'dashboard-banner-stat-top' });
	const hero = renderHeroRow(top, LEFT_ICONS[stat], '');
	const numEl = hero.querySelector('.dashboard-banner-stat-num') as HTMLElement;
	animateCount(numEl, leftValue(stat, r), formatInt, animate);
	// Label sits inline to the right of the big number (e.g. "1,284 总笔记").
	hero.createDiv({ cls: 'dashboard-banner-stat-label dashboard-banner-stat-label--inline', text: t(`banner.stats.${stat}`) });

	if (config.showDetails !== false) {
		const strip = col.createDiv({ cls: 'dashboard-banner-stat-strip' });
		appendStripItem(strip, 'calendar-plus', t('banner.stats.stripMonth', { n: r.newThisMonth }));
		appendStripItem(strip, 'hash', t('banner.stats.stripTags', { n: r.tagsCount }));
		appendStripItem(strip, 'link', t('banner.stats.stripLinks', { n: r.totalLinks }));
	}
}

/** Center (flex 3) — Activity: hero + label + sub up top, heatmap at bottom. */
function renderCenterColumn(container: HTMLElement, config: BannerStatsConfig, r: BannerStatsResult, animate: boolean): void {
	const col = container.createDiv({ cls: 'dashboard-banner-stat-col dashboard-banner-stat-col--center' });
	const stat = config.centerStat ?? 'streak';

	const top = col.createDiv({ cls: 'dashboard-banner-stat-top' });
	const hero = renderHeroRow(top, CENTER_ICONS[stat], '');
	const numEl = hero.querySelector('.dashboard-banner-stat-num') as HTMLElement;
	const { text, format } = centerValue(stat, r);
	animateCount(numEl, text, format, animate);
	// Label sits inline to the right of the big number (e.g. "7天 连续记录").
	// When the daily-notes source is unavailable the center streak is really an
	// "active days" count — surface that in the label so the number's meaning is
	// always unambiguous and never silently flips between page loads.
	const labelKey = stat === 'streak' && !r.hasDailySource ? 'banner.stats.active' : `banner.stats.${stat}`;
	hero.createDiv({ cls: 'dashboard-banner-stat-label dashboard-banner-stat-label--inline', text: t(labelKey) });

	if (config.showDetails !== false) {
		col.createDiv({ cls: 'dashboard-banner-stat-sub', text: centerSub(stat, r) });
		const chart = col.createDiv({ cls: 'dashboard-banner-stat-chart' });
		renderHeatmap(chart, r.activity);
	}
}

/** Right (flex 1) — Productivity: rows of [icon+label ... value] + progress bar. */
function renderRightColumn(container: HTMLElement, config: BannerStatsConfig, r: BannerStatsResult): void {
	const col = container.createDiv({ cls: 'dashboard-banner-stat-col dashboard-banner-stat-col--right' });
	const stats = config.rightStats ?? ['taskCompletion', 'connectivity', 'avgLinksPerNote'];
	for (const stat of stats) {
		const { value, pct } = rightValue(stat, r);
		const row = col.createDiv({ cls: 'dashboard-banner-stat-prog' });
		const head = row.createDiv({ cls: 'dashboard-banner-stat-prog-head' });
		const left = head.createDiv({ cls: 'dashboard-banner-stat-prog-title' });
		const ico = left.createDiv({ cls: 'dashboard-banner-stat-prog-icon' });
		setIcon(ico, RIGHT_ICONS[stat]);
		left.createSpan({ text: t(`banner.stats.${stat}`) });
		head.createDiv({ cls: 'dashboard-banner-stat-prog-val', text: value });
		if (config.showDetails !== false) {
			const track = row.createDiv({ cls: 'dashboard-banner-stat-prog-track' });
			track.createDiv({ cls: 'dashboard-banner-stat-prog-fill' }).style.width = `${pct}%`;
		}
	}
}

function appendStripItem(strip: HTMLElement, icon: string, text: string): void {
	const item = strip.createDiv({ cls: 'dashboard-banner-stat-strip-item' });
	const ico = item.createDiv({ cls: 'dashboard-banner-stat-strip-icon' });
	setIcon(ico, icon);
	item.createSpan({ text });
}

function leftValue(stat: BannerLeftStat, r: BannerStatsResult): number {
	switch (stat) {
		case 'totalNotes': return r.totalNotes;
		case 'tagsCount': return r.tagsCount;
		case 'totalLinks': return r.totalLinks;
		case 'newThisMonth': return r.newThisMonth;
		case 'newThisWeek': return r.newThisWeek;
		case 'totalTasks': return r.totalTasks;
		case 'doneTasks': return r.doneTasks;
		case 'pendingTasks': return r.pendingTasks;
	}
}

/** Center hero: returns the raw number to count up + a formatter (streak adds a
 *  unit suffix, percentages are plain integers shown as `n%`). */
function centerValue(stat: BannerCenterStat, r: BannerStatsResult): { text: number; format: (n: number) => string } {
	switch (stat) {
		case 'streak': return { text: r.streak, format: n => `${n}${t('banner.stats.dayUnit')}` };
		case 'taskCompletion': return { text: r.taskCompletion, format: n => `${n}%` };
		case 'connectivity': return { text: r.connectivity, format: n => `${n}%` };
		case 'newThisWeek': return { text: r.newThisWeek, format: formatInt };
	}
}

function centerSub(stat: BannerCenterStat, r: BannerStatsResult): string {
	switch (stat) {
		case 'streak': return t(r.hasDailySource ? 'banner.stats.centerSubStreak' : 'banner.stats.centerSubActive', { week: r.newThisWeek, month: r.newThisMonth });
		case 'taskCompletion': return t('banner.stats.centerSubTask', { done: r.doneTasks, total: r.totalTasks });
		case 'connectivity': return t('banner.stats.centerSubConn', { n: r.orphanNotes });
		case 'newThisWeek': return t('banner.stats.centerSubWeek', { n: r.streak });
	}
}

function rightValue(stat: BannerRightStat, r: BannerStatsResult): { value: string; pct: number } {
	switch (stat) {
		case 'taskCompletion': return { value: `${r.taskCompletion}%`, pct: r.taskCompletion };
		case 'connectivity': return { value: `${r.connectivity}%`, pct: r.connectivity };
		case 'orphanRate': return { value: `${r.orphanRate}%`, pct: r.orphanRate };
		case 'avgLinksPerNote': return { value: r.avgLinksPerNote.toFixed(1), pct: Math.min(100, Math.round((r.avgLinksPerNote / 3) * 100)) };
	}
}

/** Horizontal contribution strip: cells flow oldest → today and wrap to fill
 *  the center column width (wide, short). Today's cell is the last one. */
function renderHeatmap(parent: HTMLElement, series: number[]): void {
	const max = Math.max(1, ...series);
	const grid = parent.createDiv({ cls: 'dashboard-banner-heatmap' });
	for (let i = 0; i < series.length; i++) {
		const cell = grid.createDiv({ cls: 'dashboard-banner-heatmap-cell' });
		cell.addClass(`dashboard-banner-heatmap-cell--l${heatLevel(series[i]!, max)}`);
		if (i === series.length - 1) cell.addClass('dashboard-banner-heatmap-cell--today');
	}
}

function heatLevel(v: number, max: number): number {
	if (v <= 0) return 0;
	const ratio = v / max;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}

/** Count-up from 0 → target over ~800ms; respects prefers-reduced-motion.
 *  Stops early if the element is detached. When `animate` is false (refresh),
 *  the final value is set instantly. */
function animateCount(el: HTMLElement, target: number, format: (n: number) => string, animate: boolean): void {
	const reduced = typeof window !== 'undefined'
		&& window.matchMedia
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (!animate || reduced || target <= 0) {
		el.textContent = format(target);
		return;
	}
	const duration = 800;
	const start = performance.now();
	const step = (nowTs: number) => {
		if (!el.isConnected) return;
		const elapsed = nowTs - start;
		const p = Math.min(1, elapsed / duration);
		const eased = 1 - Math.pow(1 - p, 3);
		el.textContent = format(Math.round(target * eased));
		if (p < 1) window.requestAnimationFrame(step);
	};
	window.requestAnimationFrame(step);
}
