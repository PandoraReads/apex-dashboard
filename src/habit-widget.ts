import { App, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { getHabitService, habitToday, HABIT_MAX_NAME_LENGTH } from './habit-service';
import { showHabitStats } from './habit-stats-modal';
import { showPromptDialog } from './prompt-dialog';

/**
 * Habit check-in widget: one row per habit, tap to toggle today's completion.
 * Mutations go through HabitService only — the view's subscribe callback
 * refreshes every open widget/banner via refreshHabitWidget, so clicks never
 * patch the DOM directly and all views stay in sync.
 */
export function renderSidebarHabitWidget(container: HTMLElement, app: App): void {
	const service = getHabitService();
	if (!service) return;

	const widget = container.createDiv({ cls: 'dashboard-sidebar-widget dashboard-sidebar-habit' });

	const top = widget.createDiv({ cls: 'dashboard-sidebar-habit-top' });
	const titleEl = top.createDiv({ cls: 'dashboard-sidebar-habit-title' });
	const titleIcon = titleEl.createDiv({ cls: 'dashboard-sidebar-habit-title-icon' });
	setIcon(titleIcon, 'target');
	titleEl.createSpan({ text: t('habit.title') });
	const countEl = top.createDiv({ cls: 'dashboard-sidebar-habit-count' });
	top.createDiv({ cls: 'dashboard-sidebar-habit-top-spacer' });

	const addBtn = top.createDiv({ cls: 'dashboard-sidebar-habit-icon-btn' });
	addBtn.setAttribute('aria-label', t('habit.newTitle'));
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void (async () => {
			const name = await showPromptDialog(app, { title: t('habit.newTitle') });
			if (name === null) return;
			const habit = service.addHabit(name);
			if (!habit) {
				new Notice(name.trim().length === 0 || name.trim().length > HABIT_MAX_NAME_LENGTH
					? t('habit.tooLong') : t('habit.duplicate'));
			}
		})();
	});

	const statsBtn = top.createDiv({ cls: 'dashboard-sidebar-habit-icon-btn' });
	statsBtn.setAttribute('aria-label', t('habit.statsTitle'));
	setIcon(statsBtn, 'bar-chart-2');
	statsBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		showHabitStats(widget.ownerDocument);
	});

	const list = widget.createDiv({ cls: 'dashboard-sidebar-habit-list' });
	renderList(list, countEl);
}

/** Refill the habit list of an existing widget (title row buttons stay live).
 *  No-op when the widget is absent or the service is gone (e.g. unload). */
export function refreshHabitWidget(root: HTMLElement): void {
	const widget = root.querySelector<HTMLElement>('.dashboard-sidebar-habit');
	if (!widget || !widget.isConnected) return;
	const service = getHabitService();
	if (!service) return;
	const list = widget.querySelector<HTMLElement>('.dashboard-sidebar-habit-list');
	const countEl = widget.querySelector<HTMLElement>('.dashboard-sidebar-habit-count');
	if (!list) return;
	renderList(list, countEl);
}

function renderList(list: HTMLElement, countEl: HTMLElement | null): void {
	const service = getHabitService();
	if (!service) return;
	const habits = service.getHabits();
	const todayStr = habitToday();

	list.empty();
	if (countEl) {
		const done = service.getDoneOn(todayStr).length;
		countEl.setText(done > 0 ? `${done}/${habits.length}` : '');
	}

	if (habits.length === 0) {
		list.createDiv({ cls: 'dashboard-sidebar-habit-empty', text: t('habit.emptyHint') });
		return;
	}

	for (const habit of habits) {
		const isDone = service.isDone(habit.id, todayStr);
		const item = list.createDiv({
			cls: 'dashboard-sidebar-habit-item' + (isDone ? ' dashboard-sidebar-habit-item--done' : ''),
			attr: { 'data-habit-id': habit.id },
		});

		const check = item.createDiv({
			cls: 'dashboard-sidebar-habit-check' + (isDone ? ' dashboard-sidebar-habit-check--done' : ''),
		});
		if (isDone) setIcon(check, 'check');

		item.createDiv({ cls: 'dashboard-sidebar-habit-name', text: habit.name });

		const streak = service.getStreak(habit.id);
		if (streak > 0) {
			item.createDiv({
				cls: 'dashboard-sidebar-habit-streak',
				text: `${streak}${t('habit.dayUnit')}`,
			});
		}

		item.addEventListener('click', () => {
			service.toggle(habit.id);
		});
	}
}
