import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { getHabitService, habitFormatDate, HabitService, type Habit } from './habit-service';
import { showConfirmDialog } from './confirm-dialog';
import { showPromptDialog } from './prompt-dialog';

/** Heatmap window shown per habit in the stats overlay (12 weeks). */
const HEATMAP_DAYS = 84;

/**
 * Mount point for the stats overlay. The `--db-*` theme variables live on
 * `.apex-dashboard-root[data-theme]`, so the overlay must be appended INSIDE
 * that root (not doc.body) or every var() resolves to nothing (same reason as
 * the pomodoro stats overlay).
 */
function mountOverlay(doc: Document): HTMLElement {
	const root = doc.querySelector('.apex-dashboard-root');
	const host = root ?? doc.body;
	return host.createDiv({ cls: 'dashboard-habit-stats-overlay' });
}

/**
 * Habit statistics overlay: one card per habit with streak / 30-day rate /
 * total count chips and a 12-week check-in heatmap. Rename & delete live here
 * (the widget stays tap-to-toggle only); every mutation re-renders through
 * the service's subscribe fan-out.
 */
export function showHabitStats(doc: Document): void {
	const service = getHabitService();
	if (!service) return;

	const overlay = mountOverlay(doc);
	const modal = overlay.createDiv({ cls: 'dashboard-habit-stats-modal' });

	const header = modal.createDiv({ cls: 'dashboard-habit-stats-header' });
	header.createDiv({ cls: 'dashboard-habit-stats-title', text: t('habit.statsTitle') });
	const closeBtn = header.createDiv({ cls: 'dashboard-habit-stats-close' });
	setIcon(closeBtn, 'x');

	const body = modal.createDiv({ cls: 'dashboard-habit-stats-body' });

	let closed = false;
	function close(): void {
		closed = true;
		unsubscribe();
		doc.removeEventListener('keydown', onKey);
		overlay.remove();
	}
	function onKey(e: KeyboardEvent): void {
		// A confirm/prompt dialog may be stacked on top (rename/delete); it
		// also listens for Escape on the same document — let IT consume the
		// key so cancelling the dialog doesn't close the stats overlay too.
		if (e.key === 'Escape' && !doc.querySelector('.dashboard-confirm-overlay')) close();
	}
	doc.addEventListener('keydown', onKey);
	closeBtn.addEventListener('click', () => close());
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});

	const renderAll = (): void => {
		body.empty();
		const habits = service.getHabits();
		if (habits.length === 0) {
			body.createDiv({ cls: 'dashboard-habit-stats-empty', text: t('habit.statsEmpty') });
			return;
		}
		for (const habit of habits) {
			renderHabitCard(body, service, habit);
		}
	};

	// Live re-render on any habit data change (check-in, rename, delete...).
	// A full view re-render can detach the overlay's host root — unsubscribe
	// then instead of holding a dead listener until the next Escape.
	const unsubscribe = service.subscribe(() => {
		if (!overlay.isConnected) {
			unsubscribe();
			return;
		}
		if (!closed) renderAll();
	});

	renderAll();
}

function renderHabitCard(body: HTMLElement, service: HabitService, habit: Habit): void {
	const card = body.createDiv({ cls: 'dashboard-habit-stats-card' });

	const head = card.createDiv({ cls: 'dashboard-habit-stats-card-head' });
	head.createDiv({ cls: 'dashboard-habit-stats-card-name', text: habit.name });
	head.createDiv({ cls: 'dashboard-habit-stats-card-head-spacer' });

	const renameBtn = head.createDiv({ cls: 'dashboard-habit-stats-icon-btn' });
	renameBtn.setAttribute('aria-label', t('habit.renameTitle'));
	setIcon(renameBtn, 'pencil');
	renameBtn.addEventListener('click', () => {
		void (async () => {
			const name = await showPromptDialog(null, {
				title: t('habit.renameTitle'),
				defaultValue: habit.name,
			});
			if (name === null) return;
			// The service's notify fan-out re-renders the overlay on success;
			// a rejected rename (duplicate) surfaces as a Notice instead.
			if (!service.renameHabit(habit.id, name)) {
				new Notice(t('habit.duplicate'));
			}
		})();
	});

	const deleteBtn = head.createDiv({ cls: 'dashboard-habit-stats-icon-btn dashboard-habit-stats-icon-btn--danger' });
	deleteBtn.setAttribute('aria-label', t('habit.deleteTitle'));
	setIcon(deleteBtn, 'trash-2');
	deleteBtn.addEventListener('click', () => {
		void (async () => {
			const confirmed = await showConfirmDialog(null, {
				title: t('habit.deleteTitle'),
				message: t('habit.deleteConfirm', { name: habit.name }),
			});
			if (confirmed) {
				// Re-render comes from the service's notify fan-out.
				service.removeHabit(habit.id);
			}
		})();
	});

	const chips = card.createDiv({ cls: 'dashboard-habit-stats-chips' });
	appendChip(chips, 'flame', `${service.getStreak(habit.id)}${t('habit.dayUnit')}`, t('habit.streakLabel'));
	appendChip(chips, 'percent', `${service.getRate30(habit.id)}%`, t('habit.rate30'));
	appendChip(chips, 'check-circle-2', String(service.getTotal(habit.id)), t('habit.totalCount'));

	renderHabitHeatmap(card, service, habit);
}

function appendChip(parent: HTMLElement, icon: string, value: string, label: string): void {
	const chip = parent.createDiv({ cls: 'dashboard-habit-stats-chip' });
	const ico = chip.createDiv({ cls: 'dashboard-habit-stats-chip-icon' });
	setIcon(ico, icon);
	const text = chip.createDiv({ cls: 'dashboard-habit-stats-chip-text' });
	text.createDiv({ cls: 'dashboard-habit-stats-chip-value', text: value });
	text.createDiv({ cls: 'dashboard-habit-stats-chip-label', text: label });
}

/** 12-week × 7-day check-in grid, one square per day (oldest→today), boolean
 *  two-step fill: empty base color vs accent. Native <title> tooltips. */
function renderHabitHeatmap(card: HTMLElement, service: HabitService, habit: Habit): void {
	const section = card.createDiv({ cls: 'dashboard-habit-stats-heatmap-section' });
	const head = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-head' });
	head.createDiv({ cls: 'dashboard-habit-stats-heatmap-hint', text: t('habit.heatmapHint') });

	const wrap = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-wrap' });
	const series = service.getHeatmapDays(habit.id, HEATMAP_DAYS);

	const cell = 11;
	const gap = 3;
	const cols = 12;
	const rows = 7;
	const width = cols * (cell + gap);
	const height = rows * (cell + gap);

	const svg = wrap.createSvg('svg', {
		cls: 'dashboard-habit-stats-heatmap-svg',
		// Explicit height (viewBox ratio): a width:100% SVG inside an
		// overflow-auto grid collapses to 0 height on first paint otherwise.
		attr: { viewBox: `0 0 ${width} ${height}`, width: '100%', height: String(height) },
	});

	const start = new Date();
	start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
	series.forEach((done, i) => {
		const col = Math.floor(i / rows);
		const row = i % rows;
		const rect = svg.createSvg('rect', {
			cls: 'dashboard-habit-stats-heatmap-cell'
				+ (done > 0 ? ' dashboard-habit-stats-heatmap-cell--done' : ''),
			attr: { x: col * (cell + gap), y: row * (cell + gap), width: cell, height: cell, rx: 2.5 },
		});
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		const title = svg.createSvg('title');
		title.textContent = done > 0
			? `${habitFormatDate(d)} · ${t('habit.heatDone')}`
			: habitFormatDate(d);
		rect.appendChild(title);
	});

	// Empty-grid guidance for habits with no check-ins yet.
	if (series.every(v => v === 0)) {
		wrap.createDiv({ cls: 'dashboard-habit-stats-heatmap-empty', text: t('habit.heatEmpty') });
	}

	const legend = section.createDiv({ cls: 'dashboard-habit-stats-heatmap-legend' });
	legend.createSpan({ cls: 'dashboard-habit-stats-heatmap-legend-label', text: t('pomodoro.less') });
	legend.createDiv({ cls: 'dashboard-habit-stats-heatmap-legend-swatch' });
	legend.createDiv({
		cls: 'dashboard-habit-stats-heatmap-legend-swatch dashboard-habit-stats-heatmap-legend-swatch--done',
	});
	legend.createSpan({ cls: 'dashboard-habit-stats-heatmap-legend-label', text: t('pomodoro.more') });
}
