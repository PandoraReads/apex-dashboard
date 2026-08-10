# Changelog

## 1.6.3 (2026-08-10)

### Fixed
- **iOS tap crash** — Tapping the dashboard just after it finished rendering could crash the Obsidian render process on iOS (the app would restart and you'd lose your place). The mobile backdrop-filter pass now disables *all* blur, not just the variable-driven panels: hardcoded blur layers (file-suggest dropdown, heatmap popup) and modal blur were still active and, combined with iOS's sticky-`:hover` repaint on the first tap, pushed the WKWebView past its GPU/memory limit

### Changed
- **Banner statistics on phones** — The three-column statistics banner now shows only the center (Activity) column on phone-width screens; the left and right columns were being clipped and forced horizontal scrolling

## 1.6.2 (2026-08-09)

### Added
- **Banner Statistics view** — A second banner mode alongside Poster & Quotes, switched via a new segmented control at the top of the wand (edit) modal. Renders a three-column, role-differentiated dashboard (1:3:1): **Scale** (total-notes hero + a small stat strip), **Activity** (day-streak hero + a horizontal contribution heatmap), and **Productivity** (task-completion / links-per-note / connectivity rows with progress bars). New `banner-stats.ts` module; `BannerMode`, `BannerStatsConfig`, and `mode`/`statsConfig` fields on `BannerData`
- **Live vault statistics** — Every metric computes in a single metadata-cache + `resolvedLinks` pass with no file reads: total notes, tag count, total & average links, new this month & week, task totals (done/pending) + completion rate, day streak (core Daily-notes-aware with an any-note fallback), connectivity & orphan rate, plus a ~14-week activity series for the heatmap
- **Configurable stats banner** — Per-column show/hide, left/center hero-stat pickers, right-column progress-metric checkboxes, background **blur** & **darkness** sliders, accent color, and a daily-notes folder override for the streak — all in the wand modal
- **Blurred background in stats mode** — The poster image stays visible behind the stats panel through an adjustable `backdrop-filter` blur + dark scrim (defaults: blur 2, darkness 20, accent `#bff038`)

### Changed
- **Default UI language is now 中文** — `DEFAULT_SETTINGS.language` and the i18n fallback default flipped to `zh`. Users who explicitly chose English keep it
- **Banner layout polish** — Left/center hero labels sit inline to the right of the big number; the left stat strip stacks vertically with icons; the heatmap is a wide horizontal strip that fills the center column

### Fixed
- **Banner view reset on reload** — `mode` and `statsConfig` are now serialized into the dashboard frontmatter (previously only the legacy quote/image fields were written), so the selected view and its config survive a plugin reload/update instead of snapping back to Poster
- **Stats not refreshing** — The debounced vault-change refresh was silently skipped whenever a stats config hadn't been saved (a `config !== undefined` guard); it now always refreshes in stats mode, so totals and the heatmap update as you edit

## 1.6.1 (2026-08-09)

### Added
- **Capture template** — Fleeting notes created via the capture box's folder flow can now be seeded from a template. New `quickCaptureTemplate` setting (vault path to a template file) in the Common Actions config modal; the template's `{{date}}`/`{{time}}` vars are substituted and the captured line is appended below. Shared `readTemplateContent` helper extracted so preset creation and capture share one template-loading path

### Changed
- **Capture timestamp** — Captured lines are now stamped `[[YYYY-MM-DD]] HH:mm` (a wiki-link to the daily note plus time) instead of time-only `HH:mm`, enabling cross-vault date filtering and daily-note backlink integration
- **Capture section label** — The "Capture" section in the Common Actions config modal is now "Fleeting Capture" / "收集闪念"
- **Weather cards refresh in place** — The periodic weather refresh now updates only weather cards (`refreshWeatherCards`) instead of rebuilding the whole dashboard, removing the main source of periodic jank on mobile
- **Lighter mobile blur** — Removed `backdrop-filter` blur from buttons/cards and capped modal blur to 6px on mobile, cutting GPU load when opening modals

### Fixed
- **Capture-to-file created a stray file** — When the capture target was a note path without a `.md` suffix (the natural Obsidian way to reference a note), capture failed to find the existing note and created an extensionless file instead of appending. `getOrCreateNote` now resolves the `.md` fallback via `resolveFile` and normalizes the extension when creating

## 1.6.0 (2026-08-07)

### Added
- **Quick Notes first-run guide** — A centered welcome popup on startup walks you through the new Common Actions toolbar and can turn it on in one click. Shows once per plugin version (`quick-note-guide-modal.ts`)
- **Drag-to-reorder Quick Notes buttons** — Rearrange create/pinned buttons by dragging in the config modal; the toolbar layout is refined (Today leads the strip, action zone grouped)

### Changed
- **Weread shelf & key validation** — Shelf pagination and progress-bar rendering refined; the API key is validated upfront (must start with `wrk-`)

### Fixed
- **Daily Notes template** — `{{date}}` and other template variables are now substituted when the Today button creates a note, and the Daily Notes lookup is more resilient across Obsidian versions

## 1.5.0 (2026-08-07)

### Added
- **Appearance Studio** — New "Customize appearance" entry in settings opens a modal to override the active theme's colors, set a global dashboard background image (dim / blur / fill controls), and fine-tune card opacity, glass blur, and corner radius. Changes apply live to all open dashboards. New `appearance.ts` + `theme-studio-modal.ts`
- **Quick Notes** — Sidebar capture-thought input, note presets, pinned notes, and an "open today's note" action, with a config modal. New `quick-note-section.ts` + `quick-note-config-modal.ts`
- **Reusable icon picker** — New `icon-picker-modal.ts`
- **Dashboard backup & restore** — Periodic snapshots of the dashboard file into the plugin folder (`<vault>/.obsidian/plugins/apex-dashboard/backups/`): enable toggle + hourly/daily/weekly/monthly cadence + retention count, plus one-click "Back up now" and "Restore latest backup" (handles both overwrite and deleted-file cases, live reloads open dashboards). New `backup-service.ts`
- **Year-progress sidebar widget** — Shows how much % of the current year has elapsed, with a themed progress bar and day-of-year count; toggle in settings, reorderable like other widgets
- **More file formats** — Canvas whiteboards, Base databases, PDF, and audio now open in their native Obsidian view (no longer forced into the markdown popover) and show per-type icons in doc lists and search results. New central `file-types.ts` helper

### Changed
- **Folder section kanban: Trello-style scrolling** — Each group column now scrolls its own cards internally (sticky column header) and the board row is bounded to the section height, so the horizontal scrollbar always stays in view instead of being pushed to the very bottom by long lists. Layout refactor scopes the change to kanban view only (`data-view-mode`); grid/list/table keep their scroll, with the toolbar now staying pinned
- **Kanban scrollbars** — Folder/library and all-tasks kanban horizontal scrollbar is now thin (3px), always-visible, theme-accented; per-column vertical scrollbar hidden (wheel/trackpad still scroll)
- **Sidebar collapse indicator** — The expand grip bar is always visible now (was hover-only)
- **Confirm dialog** — Opaque theme-aware background so text is readable in every theme; the dialog now also supports a non-destructive accent confirm button (used by Restore)

### Fixed
- **Moving a parent todo/doc with sub-items to another card** — Sub-items are no longer deleted; the whole subtree is preserved on before/after drops (`moveTaskToCard` / `moveDocToCard`)
- **Mobile todo row** — Task text gets priority width (`min-width:0` + wrapping) and the action buttons are compacted so they no longer dominate the row
- **Tablet quick-action edit/delete buttons** — Render as proper circular icon buttons (sized up, always shown on touch via `.is-mobile`) instead of deformed blobs
- **Table view scrollbar** — Themed to match the dashboard

## 1.4.4 (2026-07-04)

### Added
- **TickTick timezone setting** — Configurable IANA timezone (default `Asia/Shanghai`) used to render TickTick dates. Fixes today's todos, recently-completed window, and habit checkin stamp being computed in the runtime's local timezone, which was wrong whenever the device timezone differed from the user's TickTick account. All wall-clock derivations — today filter, day-diff, time display, and the edit-modal date/time inputs plus save output — now go through the configured zone via `Intl.DateTimeFormat` (no new dependency). Invalid input falls back to `Asia/Shanghai` with a notice. New shared helper module `ticktick-tz.ts`
- **Open notes directly in a tab** — New `disableNotePopover` setting (defaults off) and a command-palette command `Toggle: open notes directly in a tab` that skips the in-dashboard note popover: clicking a document card opens the note in a tab immediately. The popover remains the default behavior

## 1.4.2 (2026-07-02)

### Fixed
- **Weread "upgrade required" load failure** — Pinned `skill_version` raised from `1.0.3` to `1.0.4` to match the official Weread Agent Skill; the gateway was returning `upgrade_info` for the old version, surfacing as a "skill needs upgrade" / load-failed state. The official `upgrade_info.message` is now forwarded to the UI, and a non-zero gateway `errcode` is now treated as an error (previously only mentioned in a comment)
- **Weread highlight import failure** — Highlight import no longer fails on fresh vaults: the import folder is now created recursively. Obsidian's `vault.createFolder` only creates a single level, so the default two-level `Weread/划线` path silently failed when neither level existed. Import errors are now logged to the console instead of being swallowed

### Changed
- **Weread notebook import button** — Moved the per-book import button out of the centered slot to the top-right of the row (immediately left of the collapse chevron), and stripped its background/shadow so it reads as a bare icon like the chevron

## 1.4.1 (2026-07-01)

### Changed
- **TickTick lists view redesign** — Replaced the widget-stack config with two header toggle buttons: "Today" (three cards: today's tasks + completed + habits) and "Lists" (project cards with horizontal scroll + drag-to-resize width). Project filter to show/hide specific lists. Old widget config auto-migrates
- **Heatmap stats button** — Statistics (streak / total / rate) moved from inline to a header button popup, keeping the grid visually clean. Cell colors now follow the theme accent with `brightness` + `saturate` for vivid, non-glowing cells
- **Folder section property settings** — Folder config modal now has card property display controls (show/hide toggle + property limit), matching the library section
- **Library kanban view** — Kanban view mode no longer paginates; all items show with horizontal scroll instead
- **Reduced GPU load** — Backdrop blur radius halved (24px → 12px); all 31 `transition: all` replaced with explicit property lists

### Fixed
- **Todo subtask nesting** — Dragging a task onto another to nest now targets the correct task (was always nesting into the first)
- **Section drag-after-refresh** — Library/folder/calendar sections that get re-rendered on vault changes now re-wire their DnD handlers (dedicated `dndCleanupFns`)
- **Section overlap on resize** — `flex-shrink: 0` on section rows prevents growing one section from squishing others
- **Heatmap layout** — Single-column strip fixed to a proper GitHub-style matrix via CSS class `grid-auto-flow: column`
- **Heatmap accent color** — Now correctly reads `--db-accent` from `.apex-dashboard-root` instead of `body`
- **Card property display** — `formatBadgeValue` now handles `Date` objects (previously all date-type frontmatter was silently dropped)
- **TickTick view/filter persistence** — `suppressNextRender` now updates `this.data` before skipping, so in-place refresh sees the new config
- **Countdown setInterval leak** — Timer registered in a module-level `Set` and cleared on every render cycle; self-cleans when DOM detaches
- **Database/folder view switch** — No longer jumps to other sections (uses `suppressNextRender` + `refreshSectionInPlace`)
- **New-section name input** — Visible border via higher-specificity CSS override (`.dashboard-task-input`'s `!important border:none` was winning)
- **Library config view switch** — Same scroll-jump fix as TickTick

### Removed
- **Ember theme** — Migrated to Eclipse (`carbon`) for existing users

## 1.4.0 (2026-07-01)

### Added
- **Weread (微信读书) section** — New section type that connects to the official Weread Agent Skill API (wrk- key). Stack multiple widgets: bookshelf (with cover/progress/author), reading statistics (total time, days, daily average), and notes/highlights. Shelf supports pagination, dynamic progress + category multi-select filters, and one-click import of a book's highlights into Obsidian as a markdown note
- **TickTick (滴答清单) section** — New section type using the unofficial V2 API (cookie auth). Stack multiple widgets: today's tasks, by-project (card layout), recently completed, and habits. Full interactivity: check/uncheck tasks, inline rename, edit due date/priority via modal, and drag-to-reorder — all synced back to TickTick in real time. Desktop popup login auto-captures the session token + CSRF; manual paste fallback for mobile
- **Heatmap section** — The former sidebar heatmap is now a standalone, multi-instance section type. Renders a GitHub-style year matrix (week columns, 7 day rows, month labels on top) that fills the section width. Two ranges: past year (365/366 days) or this year (Jan 1 → Dec 31). Each heatmap independently configured (folder, tracker key). Cell accent color follows the Obsidian theme
- **Section reordering** — Drag the grip handle on any section's header to reorder sections vertically (desktop only)
- **Section height resize** — Drag the bottom edge of any section to set a custom max-height (desktop only, persists per section)
- **Card view shows all properties** — Database and folder section grid cards now display all frontmatter properties as key:value badges (configurable: toggle on/off, cap the count). Reuses the existing badge CSS
- **Folder section kanban group-by** — The folder config modal now includes a "Group by" dropdown for the kanban view
- **Countdown multi-instance** — The sidebar countdown is no longer a single instance; manage multiple countdowns from settings (add / edit / remove). Each renders independently in the sidebar
- **Add-section modal** — The inline add-section row is replaced by a modal with an icon+label type grid (mobile-friendly) and a named input. The type picker now includes heatmap and weread
- **Popup login for TickTick** — Desktop users can log in to TickTick in an embedded Electron window; the plugin auto-captures both the `t` cookie and `_csrf_token` — no DevTools needed

### Fixed
- **Todo subtask nesting** — Dragging a task onto another to make it a subtask now correctly targets the specific task (previously always nested into the first task). Added `nestIntoTarget` with descendant-guard and path adjustment after removal
- **Section overlap on resize** — Growing one section's height no longer squishes adjacent sections (added `flex-shrink: 0` to section rows)
- **Library/folder/calendar lose drag-after-refresh** — Scanning sections that get re-rendered on vault changes now re-wire their DnD handlers (dedicated `dndCleanupFns`)
- **Heatmap layout** — Fixed from a single-column strip to a proper GitHub-style matrix by moving the grid layout to a CSS class with `grid-auto-flow: column`

### Changed
- **New section creation** — Replaced the cramped inline name+type row with a modal (better mobile UX)
- **Sidebar heatmap removed** — Promoted to a section type; the sidebar slot and its settings are deleted
- **Collapse toggle position** — Moved from before the title to right of the title (inside the title group), keeping it out of the header actions
- **Heatmap config simplified** — Removed rangeMode/days; period is now a simple pastYear/thisYear toggle. Removed the title field (section title suffices)

### Removed
- **Sidebar heatmap widget** — Replaced by the heatmap section type
- **Email/password TickTick login** — Removed in favor of popup login (auto-captures cookie+CSRF) and manual paste

## 1.2.9 (2026-06-27)

### Added
- **Calendar week view** — The Calendar section gains a Month | Week toggle. The in-column week view is a compact vertical 7-day list (tasks sorted by time-of-day with time labels). The full-screen modal's week view is a Google-Calendar-style time grid (left hour axis + 7 day columns, tasks positioned and sized by their start/end time, an all-day strip for untimed tasks, and a red "now" line). Times are read from `⏰` reminders and from `[due::]` / `[start::]` / `[end::]` when they carry `HH:MM`
- **Add a task to any day from the calendar** — Click a day in the calendar to open its agenda, then add a task with an optional time directly; it is written into that day's daily note (created from the core Daily Notes template/folder if it doesn't exist yet). Timed tasks use `⏰`, date-only tasks use `📅`

### Removed
- **All Tasks section** — Removed. It scanned and parsed every markdown file in the vault on each render; on mobile this caused sustained CPU load and overheating (confirmed: removing it brings phone temperature back under control). The Calendar section still offers dated-task aggregation with a far lighter footprint

### Fixed
- **Video library memory leak & mobile overheating** — `<video>` thumbnails no longer leak media decoders: decoders are now released on every re-render and when the lightbox closes. Previously they accumulated indefinitely, causing runaway memory growth and phone overheating/freezing
- **Mobile video thumbnails** — On mobile, video tiles render lightweight static placeholders (icon + file size) instead of live `<video>` elements, eliminating per-tile decoder cost entirely on phones
- **Dashboard no longer rebuilds on every note edit** — Vault file events now refresh only the affected sections (library / folder / calendar) in place, instead of tearing down and rebuilding the whole board. The video library and other sections no longer flicker / "keep refreshing" during sync or editing
- **Media filter popup listener leak** — The outside-click listener is now added/removed with the popup instead of accumulating one per render

### Changed
- **Desktop video thumbnails are lazy-loaded** — Only thumbnails scrolled into view mount a real `<video>` (via IntersectionObserver); off-screen tiles release their decoder. Live decoders are bounded to the visible few instead of the page size (up to 100)
- **Faster vault-task scan** — The scan behind the Calendar section now skips files with no checkboxes (via the metadata cache) and yields to the UI thread every ~50 files, so large vaults no longer freeze the app or spike CPU
- **Mobile glass blur disabled** — The per-card `backdrop-filter` blur is turned off on mobile (≤640px) to cut GPU load and heat; desktop glassmorphism is unchanged

## 1.2.8 (2026-06-26)

### Added
- **All Tasks section** — New section type that aggregates every checkbox task (`- [ ]` / `- [x]`) across the entire vault, like a dataview `TASK` query. Search, status filter (open/all/done), and sort (file/due/priority/modified)
- **Task grouping** — Group aggregated tasks by date (Overdue / Today / This week / Later / No due) or by priority (High / Medium / Low / None). List view shows collapsible group headers; kanban view lays groups out as columns
- **Kanban view** — All Tasks section gains a board view with one column per group (date or priority bucket)
- **Task write-back** — Checking a task off in the All Tasks or Calendar view flips the checkbox in its source note (atomic, line-precise edit)
- **Due date & priority parsing** — Tasks read due dates from `⏰` reminders, `[due::]` fields, and `📅` emoji; priority from `[priority:: high|medium|low]`
- **Exclude folders** — All Tasks and Calendar sections can be configured to skip given vault folders (e.g. Archive/Templates) when aggregating
- **Calendar section** — New section type showing a native month grid of every dated task across the vault (no dataview or external plugin needed)
- **Compact + fullscreen calendar** — In-column compact grid (each day lists its tasks; click a day for its agenda) plus a full-screen month grid modal with inline toggle and month navigation
- **Multi-day events** — Tasks with `[start::]` / `[end::]` (or `🛫` / `🛬`) span across days on the calendar

## 1.2.7 (2026-06-26)

### Added
- Images/videos sections: thumbnail size toggle (S/M/L) in the toolbar — small/medium/large grid thumbnails (medium = previous default)
- Images/videos sections: list and table views now show backlinks (notes that link to/embed each file) as clickable chips; click to open the note in the in-place editor popover (same as the database section)
- Images/videos sections: per-page count selector (20/50/100)
- Mobile: clicking document links (project docs) and wikilinks (in memos/todos) now opens the in-place note editor popover, matching desktop (previously mobile opened a new tab)

### Changed
- Images/videos sections are taller by default (more room for the thumbnail wall)
- Images/videos sections: file count and per-page selector moved to the far right of the toolbar (count left of the selector)

### Fixed
- Images/videos sections no longer overlap the sections / "add section" bar below after the height increase (section max-height was capping content)

## 1.2.6 (2026-06-26)

### Changed
- Images/videos sections: pagination now matches the database section style — centered, with multiple page numbers (first/last + ellipsis), instead of a single prev/next
- Images/videos filter funnel: the folder field now has a "Browse" button that opens a fuzzy folder search (same as the folder section config), instead of typing the path manually

## 1.2.5 (2026-06-26)

### Removed
- Tag filter removed from the database/folder section toolbar filter (funnel) popup — it was redundant there; the funnel now does date filtering only. (Folder section's tag filter in its gear config dialog is unchanged.)

## 1.2.4 (2026-06-26)

### Added
- Images/videos sections: a filter funnel in the toolbar to filter by created/modified date range and by folder path (subfolders included); active filters show as removable chips

### Changed
- Images/videos table view: the Name column is now a fixed width with ellipsis, instead of growing with long filenames

## 1.2.3 (2026-06-26)

### Added
- Images/videos sections now support list and table views (in addition to the grid thumbnail wall), with a view toggle in the toolbar
- Rename a media file by double-clicking its name in the table view — backlinks (`![[embeds]]`, `[[links]]`) update automatically
- Delete a media file from any view (grid/list/table) via a trash button with a confirmation dialog; deleted files go to the Obsidian trash (recoverable)

### Fixed
- Pomodoro week/month stats now use calendar boundaries (week = Monday→Sunday, month = 1st→end) instead of a rolling 7/30-day window, so this week/month no longer leaks last week/month's data
- Media lightbox: images and videos now fill and center correctly in the viewport (previously constrained/offset by the default modal sizing)

## 1.2.2 (2026-06-26)

### Changed
- Tag filter moved out of the database config dialog into the toolbar filter (funnel) popup — it now sits alongside the date filter; the config dialog no longer has a Tags section
- Database config: the property value search box now sits to the right of the property dropdown (same row) instead of below it
- Folder section grid cards show at most 2 tags (+N badge for the rest) on a single non-wrapping line, so cards no longer grow taller when a file has many tags

## 1.2.1 (2026-06-26)

### Added
- Images section — a new section type that scans the whole vault for image files (png/jpg/jpeg/gif/svg/webp/bmp) and shows them as a thumbnail wall; click any thumbnail to open a full-screen lightbox (←/→ to browse, Esc to close)
- Videos section — same idea for video files (mp4/mov/mkv/avi/webm/m4v); grid shows the first frame with a play badge, click to play inline in the lightbox
- Both sections support search, sort (modified/created/name) and pagination, reusing the database section's toolbar styling

## 1.2.0 (2026-06-26)

### Added
- Edit quick actions — hover a custom quick link/command chip to reveal an edit button (top-left), click to rename it and pick a new icon. Desktop only
- Delete section — every section header now has a trash button (right of the add-card button) that removes the whole section after a confirmation dialog

### Fixed
- "New Journal" quick action now goes through Obsidian's command system (`executeCommandById('daily-notes')`), so the created daily note honors the core Daily notes plugin's folder, date format, and template settings. Previously it created a root-level `YYYY-MM-DD.md` that ignored all of those.

## 1.1.9 (2026-06-26)

### Changed
- Folder section grid cards now show the file's tags (as small chips) instead of the folder path on the meta row
- Database section config: each property value picker now has a search box to filter the chip list, so you can quickly locate a value among many

### Added
- Database section config: "Group by" now defaults to tags (with an explanatory hint); the kanban view groups by tags unless you choose another property

## 1.1.8 (2026-06-26)

### Added
- Tag filter for folder and database sections — both config dialogs now have a dedicated Tags section listing every tag in the vault as toggleable chips. Select tags to show only files carrying any of them (OR); folder section combines folder path + tags, database section combines property filters + tags. All views (grid/list/table/kanban) honor it.

## 1.1.7 (2026-06-26)

### Added
- Folder section — a new section type that lists every document under a chosen vault folder (including subfolders). Pick a folder by typing the path or browsing with a fuzzy folder picker; the display reuses the database section's grid/list/table/kanban views with sort, search, and pagination. Whereas the database section filters by frontmatter properties, the folder section filters by folder path.

## 1.1.6 (2026-06-26)

### Added
- Save todo card to today's daily note — a new save button on each todo card (left of the delete button) writes all of the card's tasks, with completion state and nesting preserved, to the top of today's daily note (located automatically via the core "Daily notes" plugin settings)
- Archive completed tasks — a new archive button on the todo section header (left of the template button) moves every checked task off the board into a single accumulating archive file as a timestamped log, e.g. `- 2026-06-26 14:30 ✓ 完成「task」(card)`
- New setting: task archive file path (defaults to `归档/已完成.md`)

## 1.1.5 (2026-06-16)

### Added
- Hover preview for document links and `[[wikilinks]]` (Ctrl/Cmd + hover) across project/note card doc lists, inline wikilinks in memos and todos, and the database (library) section — native page-preview popover, no need to leave the dashboard
- In-place note editor popup — click a link to open a centered popup embedding a full Obsidian Markdown editor (Live Preview, reading/source toggle that remembers your last choice, and an "Open in tab" escape hatch)
- Database (library) section support for hover preview and the in-place edit popup across grid, list, table, and kanban views

### Changed
- Desktop-only feature; on mobile, links keep their original open-in-tab behavior

## 1.1.1 (2025-05-29)

### Fixed
- Library section config (filters, view mode, sort, page size) lost after restart — replaced custom YAML parser with `yaml` package to correctly handle nested objects in frontmatter
- Card grid position (gcol/grow) never serialized to file — empty `lines.push()` calls replaced with proper key-value output
- Write race condition — `lastWrittenHash` now set after file write completes instead of before, preventing stale data overwrite during rapid updates

## 1.0.9 (2025-05-26)

### Improved
- Pomodoro ring stroke width increased from 3px to 6px for better visibility
- Pomodoro dots moved inside the ring, positioned below the time display
- Stats hint (today count) moved to the top-left corner of the pomodoro widget, on the same line as the title
- Reduced pomodoro widget gap from 6px to 4px for a more compact layout
- All slider settings now show current value in the title (recent edits count, pomodoro work/break/interval)
- Weather API now has fallback: primary `api.open-meteo.com` with backup `archive-api.open-meteo.com`

### Fixed
- Stats hint now always visible (shows "Today 0" even when no sessions completed)
- Stats hint no longer displays total count, only today count
- Title "Pomodoro" stays centered with stats hint on the left

## 1.0.8 (2025-05-25)

### Added
- Sidebar widget: Pomodoro timer with ring progress, activity tracking, and stats
- Sidebar widget: Countdown timer with reminder notifications
- Sidebar widget: Lunar calendar with holiday support
- Todo card templates and mobile touch-friendly UI
- Banner quote color picker

### Fixed
- Preset quick actions reappear after deletion
- Blossom button hover flicker
- Removed bottom padding from banner
