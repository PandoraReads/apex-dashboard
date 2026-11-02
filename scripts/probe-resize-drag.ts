/**
 * Browser probe driver (headless Edge): exercises the REAL
 * attachImmersiveResizeHandle + refitImmersiveGrid code against a realistic
 * pomodoro tile. Reports each stage into #report.
 */
import { attachImmersiveResizeHandle, refitImmersiveGrid } from '../src/immersive';
import type { ImmersiveItem } from '../src/immersive-grid';

declare const window: unknown;

const report: string[] = [];
const say = (line: string) => {
	report.push(line);
	(document.getElementById('report') as HTMLElement).textContent = report.join('\n');
};

/** Obsidian augments every HTMLElement with these helpers; the headless page
 *  needs the same surface for the plugin code under test. */
function augment(el: Element): void {
	const e = el as HTMLElement & Record<string, unknown>;
	e.hasClass = (c: string) => el.classList.contains(c);
	e.addClass = (...cs: string[]) => el.classList.add(...cs);
	e.removeClass = (...cs: string[]) => el.classList.remove(...cs);
	e.createDiv = (o?: { cls?: string }) => {
		const d = document.createElement('div');
		if (o?.cls) d.className = o.cls;
		el.appendChild(d);
		augment(d);
		return d as HTMLElement;
	};
	e.createEl = (tag: string, o?: { cls?: string; text?: string }) => {
		const d = document.createElement(tag);
		if (o?.cls) d.className = o.cls;
		if (o?.text) d.textContent = o.text;
		el.appendChild(d);
		augment(d);
		return d as HTMLElement;
	};
}
(window as { onerror: (e: unknown) => void }).onerror = (e) => say('WINDOW ERROR: ' + String(e));

function buildTile(id: string, key: string, col: number, withPomodoroDom: boolean): HTMLElement {
	const tile = document.createElement('div');
	tile.className = 'dashboard-sidebar-widget' + (withPomodoroDom ? ' dashboard-sidebar-pomodoro' : '');
	tile.dataset.widgetKey = key;
	tile.dataset.immId = id;
	tile.style.gridColumn = `${col} / span 3`;
	tile.style.gridRow = '1 / span 15';
	// The plugin calls Obsidian's augmented element helpers on tiles.
	const t = tile as HTMLElement & Record<string, unknown>;
	t.hasClass = (c: string) => tile.classList.contains(c);
	t.addClass = (...cs: string[]) => tile.classList.add(...cs);
	t.removeClass = (...cs: string[]) => tile.classList.remove(...cs);
	const augment = (el: HTMLElement): HTMLElement => {
		const e = el as HTMLElement & Record<string, unknown>;
		e.hasClass = (c: string) => el.classList.contains(c);
		e.addClass = (...cs: string[]) => el.classList.add(...cs);
		e.removeClass = (...cs: string[]) => el.classList.remove(...cs);
		e.createDiv = (o?: { cls?: string }) => {
			const d = document.createElement('div');
			if (o?.cls) d.className = o.cls;
			el.appendChild(d);
			return augment(d);
		};
		return el;
	};
	augment(tile);
	if (withPomodoroDom) {
		tile.innerHTML = `
			<div class="dashboard-sidebar-pomodoro-top">
				<div class="dashboard-sidebar-pomodoro-stats-hint">🍅 今日 0</div>
				<div class="dashboard-sidebar-pomodoro-top-spacer"></div>
				<div class="dashboard-pomodoro-activity-trigger"><span class="dashboard-pomodoro-activity-placeholder">点击设置活动</span></div>
				<div class="dashboard-sidebar-pomodoro-top-right"><div class="dashboard-sidebar-pomodoro-stats-btn"></div></div>
			</div>
			<div class="dashboard-sidebar-pomodoro-ring-wrap">
				<svg class="dashboard-sidebar-pomodoro-ring" viewBox="0 0 72 72" width="72" height="72"></svg>
				<div class="dashboard-sidebar-pomodoro-time">25:00</div>
				<div class="dashboard-sidebar-pomodoro-dots"><div></div><div></div></div>
			</div>
			<button class="dashboard-sidebar-pomodoro-main-btn">开始专注</button>`;
	} else {
		tile.innerHTML = '<div style="padding:10px">expense</div>';
	}
	return tile;
}

function firePointer(el: Element, type: string, x: number, y: number): void {
	const ev = new PointerEvent(type, {
		bubbles: true, cancelable: true, composed: true,
		clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
	});
	el.dispatchEvent(ev);
}

window.addEventListener('load', () => {
	// Obsidian provides this global; startGuardedDrag falls back to it when
	// a synthetic event carries no view (real events have e.view.document).
	(window as { activeDocument?: Document }).activeDocument = document;
	// doc.body.createDiv inside startGuardedDrag needs the same augmentation.
	augment(document.body);
	setTimeout(() => {
		try {
			const grid = document.querySelector<HTMLElement>('.dashboard-kanban')!;
			let items: ImmersiveItem[] = [
				{ id: 'widget:pomodoro', w: 3, h: 15 },
				{ id: 'widget:expense', w: 3, h: 15 },
			];
			const pomo = document.querySelector<HTMLElement>('[data-imm-id="widget:pomodoro"]')!;
			augment(pomo);
			const commit = (next: ImmersiveItem[]): void => {
				items = next;
				refitImmersiveGrid(grid, items, true);
				const it = items.find(i => i.id === 'widget:pomodoro')!;
				say(`commit: w=${it.w} h=${it.h} fixed=${String(it.fixed)}`);
			};
			refitImmersiveGrid(grid, items, true);
			attachImmersiveResizeHandle(pomo, 'widget:pomodoro', () => items, commit);

			const stripH = pomo.querySelector<HTMLElement>('.dashboard-imm-resize-h')!;
			const stripV = pomo.querySelector<HTMLElement>('.dashboard-imm-resize-v')!;
			say('strips present: h=' + String(!!stripH) + ' v=' + String(!!stripV));

			const before = pomo.style.gridRow + ' / ' + pomo.style.height;
			say('before: row=' + before + ' locked=' + (grid.dataset.layoutLocked ?? '(unset)'));

			// Vertical drag: press bottom edge, move down 60px, release.
			const vr = stripV.getBoundingClientRect();
			const x = vr.left + vr.width / 2, y = vr.top + vr.height / 2;
			firePointer(stripV, 'pointerdown', x, y);
			const shield = document.querySelector('.dashboard-drag-shield');
			say('after pointerdown: shield=' + String(!!shield) + ' resizing-class=' + String(pomo.classList.contains('dashboard-imm-tile--resizing')));
			for (let i = 1; i <= 6; i++) firePointer(document, 'pointermove', x, y + i * 10);
			say('after moves: row=' + pomo.style.gridRow + ' height=' + pomo.style.height);
			firePointer(document, 'pointerup', x, y + 60);
			say('after up: row=' + pomo.style.gridRow + ' height=' + pomo.style.height);
			say('items after: ' + JSON.stringify(items.find(i => i.id === 'widget:pomodoro')));

			// Horizontal drag: press right edge, move right 100px.
			const hr = stripH.getBoundingClientRect();
			const hx = hr.left + hr.width / 2, hy = hr.top + hr.height / 2;
			firePointer(stripH, 'pointerdown', hx, hy);
			for (let i = 1; i <= 5; i++) firePointer(document, 'pointermove', hx + i * 20, hy);
			firePointer(document, 'pointerup', hx + 100, hy);
			say('after h-drag: col=' + pomo.style.gridColumn + ' items=' + JSON.stringify(items.find(i => i.id === 'widget:pomodoro')));
		} catch (err) {
			say('EXCEPTION: ' + (err instanceof Error ? err.stack : String(err)));
		}
	}, 300);
});
