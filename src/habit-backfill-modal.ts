import { App, Modal, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { getHabitService, habitYesterday, type Habit } from './habit-service';
import { nowMoment } from './datetime';
import { applyModalTheme } from './modal-theme';

/**
 * Retro check-in dialog: pick which habits to mark done for YESTERDAY — no
 * date picker, no future days. Rows already done yesterday render checked and
 * locked (backfill only adds records, it never erases them); committing goes
 * through HabitService.markDoneMany so every widget/banner/stats view
 * refreshes via the usual subscribe fan-out. ExpenseBackfillModal skeleton.
 */
export class HabitBackfillModal extends Modal {
	/** Habit ids the user ticked in this session (locked rows never enter). */
	private selected = new Set<string>();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		contentEl.empty();
		contentEl.addClass('dashboard-library-config-modal');
		containerEl.addClass('modal--dashboard');
		containerEl.parentElement?.addClass('modal-bg--dashboard');
		applyModalTheme(containerEl);

		const service = getHabitService();
		const yesterday = habitYesterday();
		// Friendly day label in the plugin language's format (M月D日 / M/D);
		// the underlying data key stays the raw YYYY-MM-DD from habitYesterday.
		const yesterdayLabel = nowMoment().subtract(1, 'day').format(t('habit.backfillDateFormat'));

		const container = contentEl.createDiv({ cls: 'dashboard-modal dashboard-modal--compact dashboard-habit-backfill' });
		const header = container.createDiv({ cls: 'dashboard-modal-header' });
		header.createDiv({ cls: 'dashboard-modal-title', text: t('habit.backfillTitle') });

		const body = container.createDiv({ cls: 'dashboard-modal-body' });
		body.createDiv({
			cls: 'dashboard-habit-backfill-hint',
			text: t('habit.backfillHint', { date: yesterdayLabel }),
		});

		const habits = service?.getHabits() ?? [];
		if (habits.length === 0) {
			body.createDiv({ cls: 'dashboard-habit-backfill-empty', text: t('habit.statsEmpty') });
			return;
		}

		const doneYesterday = new Set(service?.getDoneOn(yesterday) ?? []);
		const missed = habits.filter(h => !doneYesterday.has(h.id));

		// Footer first so syncAll (declared below) can update the confirm
		// button's label and disabled state.
		const footer = container.createDiv({ cls: 'dashboard-modal-footer' });
		footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
		const confirmBtn = footer.createEl('button', {
			cls: 'dashboard-modal-btn dashboard-modal-btn--confirm',
			text: t('habit.backfillConfirm'),
		});
		confirmBtn.addEventListener('click', () => {
			const count = service ? service.markDoneMany([...this.selected], yesterday) : 0;
			if (count > 0) new Notice(t('habit.backfillDone', { count }));
			this.close();
		});

		/** One paint path for row ticks, select-all and the initial render. */
		const rowChecks = new Map<string, HTMLElement>();
		const syncAll = (): void => {
			for (const habit of habits) {
				const check = rowChecks.get(habit.id);
				const row = check?.parentElement;
				if (!check || !row) continue;
				const marked = doneYesterday.has(habit.id) || this.selected.has(habit.id);
				row.toggleClass('dashboard-habit-backfill-item--selected', marked);
				check.toggleClass('dashboard-habit-backfill-check--done', marked);
				check.empty();
				if (marked) setIcon(check, 'check');
			}
			const count = this.selected.size;
			confirmBtn.setText(count > 0
				? `${t('habit.backfillConfirm')} (${count})`
				: t('habit.backfillConfirm'));
			confirmBtn.toggleClass('is-disabled', count === 0);
		};

		// Header shortcut for the everything-was-missed case: one tap arms
		// every open row; it never un-ticks (same add-only rule as saving).
		if (missed.length > 0) {
			const selectAllBtn = header.createEl('button', {
				cls: 'dashboard-habit-backfill-selectall',
				text: t('habit.backfillSelectAll'),
			});
			selectAllBtn.addEventListener('click', () => {
				for (const habit of missed) this.selected.add(habit.id);
				syncAll();
			});
		}

		const list = body.createDiv({ cls: 'dashboard-library-config-section dashboard-habit-backfill-list' });
		for (const habit of habits) {
			const isDone = doneYesterday.has(habit.id);
			const row = renderBackfillRow(list, habit, isDone);
			rowChecks.set(habit.id, row.check);
			if (!isDone) {
				row.item.addEventListener('click', () => {
					if (this.selected.has(habit.id)) this.selected.delete(habit.id);
					else this.selected.add(habit.id);
					syncAll();
				});
			}
		}

		syncAll();
	}

	onClose(): void {
		this.selected.clear();
		this.contentEl.empty();
	}
}

/** One habit row: check bubble + name (+ a "done yesterday" badge on locked
 *  rows). Returns the row and its bubble so onOpen can restyle on tick. */
function renderBackfillRow(list: HTMLElement, habit: Habit, isDone: boolean): { item: HTMLElement; check: HTMLElement } {
	const item = list.createDiv({
		cls: 'dashboard-habit-backfill-item' + (isDone ? ' dashboard-habit-backfill-item--locked' : ''),
		attr: { 'data-habit-id': habit.id },
	});
	const check = item.createDiv({ cls: 'dashboard-habit-backfill-check' });
	item.createDiv({ cls: 'dashboard-habit-backfill-name', text: habit.name });
	if (isDone) {
		item.createDiv({
			cls: 'dashboard-habit-backfill-done-badge',
			text: t('habit.backfillDoneYesterday'),
		});
	}
	return { item, check };
}
