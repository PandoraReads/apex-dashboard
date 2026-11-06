/**
 * Verifies the calendar day-agenda "add task" refresh hand-off:
 *
 * A day with no daily note falls back to writing the task into the DASHBOARD
 * file (insertTaskForDay step 3). The view's vault fan-out deliberately skips
 * its own dashboard path, so that write never reached the calendar rescan —
 * the sidebar grid kept its pre-add snapshot and every agenda click (built
 * from that snapshot) showed nothing until a view-switch rebuild.
 *
 * 1. calendar-modal invalidates the destination path and dispatches
 *    `dashboard-calendar-refresh` on .apex-dashboard-root right after a
 *    successful add.
 * 2. view.ts listens on the STABLE containerEl (survives render rebuilds)
 *    and refreshes both calendar surfaces: the sidebar widget and every
 *    embedded calendar section.
 * 3. The dashboard-path skip in record() — the reason the event is needed —
 *    is still in place (so the two sides never silently drift apart).
 *
 * Run: `npm run test:calendar-add-refresh`
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const modalSrc = readFileSync('src/calendar-modal.ts', 'utf-8');
const viewSrc = readFileSync('src/view.ts', 'utf-8');

// 1. Modal side: invalidation + dispatch, wired into the add path.
assert.ok(modalSrc.includes('function requestCalendarRefresh('),
	'modal exposes a requestCalendarRefresh helper');
assert.ok(modalSrc.includes('invalidatePath(targetPath)'),
	'the written file drops its scan-cache entry before the rescan');
assert.ok(modalSrc.includes("new CustomEvent('dashboard-calendar-refresh'"),
	'modal dispatches the refresh request');
assert.ok(modalSrc.includes("querySelector<HTMLElement>('.apex-dashboard-root')"),
	'the event is dispatched on the board root (bubbles to the view)');

// Placed after the successful-insert branch (after the target notice), i.e.
// a failed add must not trigger a pointless rescan.
{
	const noticeIdx = modalSrc.indexOf("'calendar.taskAddedDashboard'");
	const refreshIdx = modalSrc.indexOf('requestCalendarRefresh(target.file.path)');
	assert.ok(noticeIdx > 0 && refreshIdx > noticeIdx,
		'refresh fires after a successful add (not on the failure paths)');
}

// Toggles share the same blind spot (a task living in the dashboard file),
// so both modal toggle paths nudge the grid too.
{
	const toggles = modalSrc.split('requestCalendarRefresh(task.path)').length - 1;
	assert.ok(toggles >= 2, `both modal toggles nudge the grid (found ${toggles})`);
}

// 2. View side: listener on the stable host, both surfaces refreshed.
{
	const listenIdx = viewSrc.indexOf("addEventListener('dashboard-calendar-refresh'");
	assert.ok(listenIdx > 0, 'view listens for the refresh request');
	const block = viewSrc.slice(listenIdx, listenIdx + 300);
	assert.ok(block.includes('this.refreshCalendarSurfaces()'),
		'the listener goes through the shared surface refresher');
	// The refresher owns the actual work (shared with the note-editor close
	// path, which has the same stale-snapshot problem).
	const helperIdx = viewSrc.indexOf('private refreshCalendarSurfaces(');
	assert.ok(helperIdx > 0, 'the shared refresher exists');
	const helper = viewSrc.slice(helperIdx, helperIdx + 400);
	assert.ok(helper.includes('this.refreshSidebarCalendarNow()'),
		'the sidebar calendar widget re-scans (dots + day agendas)');
	assert.ok(helper.includes('refreshCalendarSections('),
		'embedded calendar sections re-scan as well');
	assert.ok(viewSrc.slice(Math.max(0, listenIdx - 400), listenIdx).includes('this.containerEl'),
		'the listener rides containerEl (stable across render rebuilds)');
}

// 3. Direct nudge: the agenda tells the surface that OPENED it to rescan, so
//    the refresh no longer depends on finding .apex-dashboard-root in the live
//    document (which silently no-ops in a popout window, or when the board is
//    mid-rebuild).
{
	assert.ok(modalSrc.includes('onTaskWritten?: () => void'),
		'callbacks carry an onTaskWritten hook');
	assert.ok(modalSrc.includes('this.cb.onTaskWritten?.()'),
		'the day agenda calls it after a successful add');
	const widgetSrc = readFileSync('src/calendar-widget.ts', 'utf-8');
	const sectionSrc = readFileSync('src/calendar-section.ts', 'utf-8');
	assert.ok(widgetSrc.includes('onTaskWritten'), 'the sidebar widget wires the hook');
	assert.ok(sectionSrc.includes('onTaskWritten'), 'the calendar section wires the hook');
	assert.ok(sectionSrc.includes('function reloadInPlace('),
		'the section reuses ONE in-place reloader for vault events and agenda writes');
}

// 4. The dashboard-path skip in record() — the reason the event is needed —
//    is still in place (so the two sides never silently drift apart).
assert.ok(modalSrc.includes('dashboard-file destination'),
	'modal documents why the explicit nudge is required');
assert.ok(viewSrc.includes("if (file.path !== dashboardPath) this.vaultChangePaths.add(file.path);"),
	'record() still skips the dashboard path (the premise of this fix)');

console.log('verify-calendar-add-refresh: all checks passed');
