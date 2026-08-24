# Changelog

## 1.8.8 (2026-08-24)

### Fixed
- **Community-plugin review compliance (re-submission)** — Style and DOM helper usages flagged by the Obsidian linter are resolved: the quick-note capture box's auto-grow assigns height through `setCssStyles` instead of direct `element.style` writes; the detached weather city-suggest dropdown is built with the global `createDiv()` helper instead of `ownerDocument.createElement`; plain-text rendering goes through `appendText()` instead of `appendChild(createTextNode(...))`
- **Deleting one section deleted every same-named section** — Deletion and rename matched columns purely by name, so two sections sharing a title (easy to hit now that a blank name falls back to the type name) meant the trash button removed all of them at once and rename edited all of them together. Delete and rename now carry the exact section's identity (index with a name guard) from the UI into the data layer, so only the section you clicked is affected; creating or renaming into an existing name auto-suffixes it ("名称 2", "名称 3") so duplicates can no longer be created in the first place.
- **Calendar excluded-folders: manual add row vanished after removing a chip** — The chip re-render emptied the container that also held the input/browse controls, so the add row disappeared after any chip removal or multi-select confirm. The add row is now a sibling of the chip list and survives every update.

### Added
- **Stats banner: streak source toggle** — A checkbox under the daily-notes folder setting chooses whether the center streak counts daily notes (default) or any note creation across the vault. When counting notes the metric label switches to "Active days", keeping the number's meaning unambiguous.
- **Stats banner: excluded folders** — Folders chosen in the stats settings (searchable multi-select tree with parent-covers-children, or manual path entry for folders outside the vault tree) are excluded from every statistic — totals, heatmap, activity streak, tasks, tags — and link stats are filtered on both ends so connectivity, orphan rate, and average links per note stay consistent with the filtered file set.

### Changed
- **Section name is now optional** — Leaving the name blank in the "Add section" modal uses the localized type name as the section title; the confirm button no longer stays disabled on an empty input
- **First install opens discoverable** — A brand-new install (no settings data yet) starts with the sidebar pinned open and the Common Actions bar enabled, and the sample guide card reads "unpin the sidebar" accordingly. Existing installs keep their current state untouched.
- **Default guide card teaches renaming instead of file editing** — The memo-section tip card no longer tells users to edit dashboard.md to delete sections (the section menu already covers that); it now demonstrates double-clicking a section title to rename it.

## 1.8.7 (2026-08-24)

### Added
- **Sticky Notes ("便利贴") section — memos and todos in one section** — A new section type that mixes free-form memo cards and checkable todo cards in the same horizontal row. Clicking the add button opens a type chooser (icon + label + description) before the card is created. Memo cards behave exactly like memo-section cards (inline textarea editing, palette color, save-as-note, drag-to-resize); todo cards behave exactly like todo-section cards (task list with progress, save-to-daily). The section header keeps the one-click archive button for completed tasks but drops the task-template button — each card is chosen explicitly. Section layout follows the todo section (scrollable row, 260px cards); the type persists as `type: sticky` in the dashboard file and round-trips with mixed card types
- **Global text size** — A Small / Medium / Large segmented control in Theme Studio scales the whole dashboard proportionally (titles, body, banner, sidebar, widgets) through one root font-size multiplier; Medium keeps the inherited default
- **Library quick date filter** — "Within N days" rolling-window chips next to the fixed date range, evaluated relative to today (by created or modified date)
- **Calendar excluded folders: multi-select picker** — Manage the whole exclusion set from a searchable folder tree in one place; selecting a parent folder covers all of its subfolders (rows show "via parent"). Manual path input remains for paths outside the vault tree
- **Dataview `WITHOUT ID` + Free view** — `LIST WITHOUT ID ...` drops the file-link column. A third "Free view" mode (sparkles icon) renders each query type in its native Dataview shape — TABLE → compact table, LIST → bullet list, TASK → checkbox list — instead of forcing one layout across all queries

### Changed
- **Sidebar widgets survive dashboard edits** — Widgets (calendar, countdown, weather, pomodoro, reading) are detached and re-attached by signature instead of rebuilt on every dashboard data mutation: month navigation stays on the opened month, countdowns keep ticking, no re-scans — cards re-render around them. The sidebar week calendar also refreshes in place (debounced) on vault task changes instead of triggering a full dashboard rebuild
- **Calendar / all-tasks typography** — Calendar grids, event times, and all-tasks list labels move to em-based sizes so they follow the new text-size setting

## 1.8.6 (2026-08-17)

### Fixed
- **"New section: Dataview" popup on every Obsidian launch** — The announcement had its version gate removed during 1.8.2 verification and never got it back, so it appeared (and wrote settings) on every startup. The gate is restored: it now shows once per plugin version — on install/update or a plugin reload, not on each vault launch.
- **Quick commands lost after restart** — Commands added in the Common Actions config modal only reached disk when "Save" was clicked; closing the modal via Esc or the X silently discarded them. Adding, deleting, or drag-reordering a command now persists immediately (label/icon tweaks still ride on Save).
- **Sidebar collapsing when switching the calendar widget between week/month** — The toggle rebuilt its own buttons inside the click handler, detaching the clicked button from the DOM before the click bubbled out; the sidebar's "click outside to collapse" check no longer recognized the detached target and folded an unpinned sidebar. The toggle's clicks now stay inside the sidebar (same for the expand button).
- **Calendar expand button pushed out of view** — The two-segment week/month control is now a single toggle button (icon shows the view you'd switch to), leaving room for the expand button. The expand button is also restyled as a bare icon — no background or border — matching the toggle and nav arrows (hover still tints it).

## 1.8.5 (2026-08-17)

### Added
- **Quick commands in the Common Actions bar** — A fourth chip type on the pinned top bar: one-click execution of any Obsidian command (core or plugin). In the bar's config modal, a new "Quick commands" section lets you add commands via a live-filtered search over the vault's entire command registry (match by name or id), then rename, re-icon (fuzzy icon picker), and drag-reorder each row. Clicking a command chip runs it through Obsidian's command system; a stale id (plugin disabled or removed) shows a notice instead of failing silently. Commands persist in global plugin settings, and the bar's chip order is Today → create buttons → pinned notes → commands.

## 1.8.4 (2026-08-16)

### Fixed
- **Settings tab layout broken on Obsidian 1.13+** — The declarative settings bridge exposed each module as a navigable sub-page, so the new Obsidian settings UI scattered the modules into separate pages and squeezed dozens of setting rows sideways inside horizontal flex rows. The tab is now a single vertical page: every module (General / Widgets / Lunar / Year Progress / Calendar / Backup) renders inline under its own heading, searchable in the unified settings search, identical to the pre-1.13 layout. Also removes a double-render that drew all modules twice on both old and new Obsidian, and fixes `version-bump.mjs` so `versions.json` actually records each new version (a bad `Object.values` check meant entries were silently skipped).

## 1.8.2 (2026-08-15)

### Added
- **Dataview announcement + WeChat community group** — A one-time popup shown on plugin update (once per version, after layout ready) introduces the Dataview section's capabilities and invites users to the WeChat exchange group. The QR code is base64-bundled into the plugin (works offline, no vault file dependency); clicking it opens the full-size image for scanning. A fallback line tells users to add WeChat contact `PandoraReads` when the group invite has expired. Staggered against the Quick Notes guide so the two modals never overlap.

### Fixed
- **Wikilinks with heading/block subpaths only opened the note** — `[[note#heading]]` / `[[note#^block]]` in memo cards and Dataview sections parsed the `#fragment` but dropped it on click. The fragment now flows through the whole open-note chain: opening in a tab resolves the anchor via native `openLinkText`, the in-dashboard note popover scrolls to it with `setEphemeralState`, and hover previews include the subpath so they preview at the anchor.

## 1.8.1 (2026-08-15)

### Fixed
- **Stats overlay rendered blank** — All `--db-*` theme variables live on `.apex-dashboard-root[data-theme]`, but the stats and tag-manager overlays were appended to `document.body` — outside that scope — so every `var()` reference (chart fills, text colors, card backgrounds, the `color-mix()` heatmap gradient) resolved to nothing. Both overlays now mount under the themed root (falling back to body when no dashboard view exists).
- **Stats range "All" wrapped to two lines** — Range toggle buttons now keep their label on one line (`white-space: nowrap`), matching Day/Week/Month/Year.
- **Right column blank until a range click** — The heatmap SVG carried `width: 100%` with no height inside an overflow-auto grid; the percentage width fed the grid row-height cycle and collapsed to 0 on first paint. The SVG gets an explicit height, the container a fixed aspect-ratio, and the grid track `minmax(0, 1fr)`.
- **Daily goal had no visible entry point** — New inline editor: the pencil next to the hero goal number opens a `− N +` stepper (1–16) that persists immediately; previously only reachable in plugin settings.
- **Stats header/range text too small** — Title 1em → 1.3em, insight line 0.68em → 0.8em, range buttons 0.65em → 0.82em with a shadow on the active pill.
- **Tag manager actions were anonymous icon buttons** — Tags now render as bubble chips (color dot + name; pinned chips tinted with a pin glyph). Clicking a chip expands labeled pill buttons (Pin/Unpin, Rename, Merge, Delete — red on hover), with tooltips explaining pinning and merging, plus a header hint line.

## 1.8.0 (2026-08-15)

### Added
- **Focus statistics landscape dashboard** — The pomodoro stats popup is redesigned as a ~1040px three-column view. Left: grouped KPIs — Today (hero goal card with progress bar, focus time, efficiency score, interruptions, break adherence, streak with encouragement) and History (range total with period-over-period delta, 7-day average, total, best day). Middle: interactive donut (hover expands a segment; center switches to that tag's time) that becomes a daily-goal gauge when there's a single activity, plus an adaptive trend chart (day = 24 hour bars, week/month = days, year/all = months) with a dashed daily-goal baseline and click-to-drill day panels, and a 24-hour time-of-day distribution strip with a peak-hour badge. Right: activity ranking bars (click filters the trend to one activity, with a removable filter chip), a 12-week 4-step gradient heatmap with less→more legend, and a today timeline showing each work record with its break-rhythm sub-line (break minutes taken / skipped, interruptions). Day/Week/Month/Year/All natural-period ranges; collapses to one column under 900px.
- **Daily pomodoro goal** — New `pomodoroDailyGoal` setting (default 8, slider 1–16 in settings, inline stepper on the stats hero card). Drives the hero progress card, the single-activity gauge, the trend baseline, and efficiency score.
- **Pomodoro tag management** — Rename / delete (history falls into the default activity) / merge / pin tags via the stats header gear. Tag metadata persists in `pomodoro.json`; pinned tags always lead the widget's recent-activity chips.
- **Pomodoro data v2** — `pomodoro.json` upgrades to `{ version, currentActivity, tags, sessions }`; bare-array v1 files migrate transparently. The current activity persists across restarts. Records log actual focused minutes (pauses excluded via wall-clock accounting), interruption counts, and break outcomes (minutes taken or skipped; legacy records read as unknown, not zero). The `pomodoroAutoStartBreak` setting is now honored — phases park in standby with a "Start Break"/"Resume Focus" button instead of auto-running.
- **Insight line** — The stats header shows a one-line, state-aware summary (goal hit / streak alive / gentle restart nudge).
- **Media tags for images & videos sections** — Tag individual images and videos directly in the dashboard and filter the section by tag. Tags live in plugin data (no vault files touched), follow files across rename/move, and are pruned when a file is deleted. Three ways to edit: a tag button on each grid/list tile, a Tags column in table view, and a tag bar inside the lightbox (saving there never restarts a playing video). The filter popup gains a tag-chips row (OR within tags, AND with search/date/folder filters, matching the library section's semantics). Tag writes are debounced so batch tagging produces a single settings write, and tag edits only re-render the affected section — never the whole board.

## 1.8.0 (2026-08-15)

### Added
- **Media tags for images & videos sections** — Tag individual images and videos directly in the dashboard and filter the section by tag. Tags live in plugin data (no vault files touched), follow files across rename/move, and are pruned when a file is deleted. Three ways to edit: a tag button on each grid/list tile, a Tags column in table view, and a tag bar inside the lightbox (saving there never restarts a playing video). The filter popup gains a tag-chips row (OR within tags, AND with search/date/folder filters, matching the library section's semantics). Tag writes are debounced so batch tagging produces a single settings write, and tag edits only re-render the affected section — never the whole board.

## 1.7.1 (2026-08-14)

### Fixed
- **Tablet: Quick Notes toolbar split into two rows** — Obsidian sets `.is-mobile` on phones *and* tablets, so the phone-only rule that wraps the Quick Notes bar (capture input on its own row, chips above) was hijacking the tablet layout too. The wrap rules are now scoped to `.is-phone`; tablets keep the desktop single-row toolbar.
- **Tablet: scroll-to-top button distorted with no visible icon** — Obsidian's tablet stylesheet ships `.is-tablet button:not(.clickable-icon) { padding: 4px 20px }` (specificity 0,2,1), which overrode the plugin's `padding: 0` and inflated the 36px round button into a wide pill, pushing the arrow glyph out of view. The plugin now re-asserts zero padding at matching specificity for its fixed-size icon buttons (scroll-to-top, calendar expand, calendar refresh).
- **Tablet: todo delete & reminder buttons squeezing task text** — The same Obsidian tablet button-padding rule added 40px of horizontal padding to *each* of the todo row's two action buttons, eating ~80px of task-text width on every row. Both buttons are back to their intended 2px footprint (icon size unchanged — only the occupied width).
- **Tablet: sidebar calendar stuck on "tap refresh to load" with no refresh button** — The widget used `Platform.isMobile` to pick the phone's deferred manual-load branch; tablets also match, so they showed the manual-load hint forever with no way to load. Tablets now auto-load the grid like desktop, and the phone branch gained an actual refresh button under the hint text.

## 1.7.0 (2026-08-12)

### Added
- **Dataview section — query your vault with DQL** — A brand-new section type that runs Dataview-style queries directly inside the dashboard, no external plugin required. Write a self-contained DQL engine covering `TABLE`, `LIST`, `TASK`, `CALENDAR`, and `HEATMAP` query types with the full clause set (`FROM` folders/tags/links with `AND`/`OR`/`NOT`, `WHERE`, `SORT`, `GROUP BY`, `FLATTEN`, `LIMIT`), ~40 built-in functions, all `file.*` implicit fields, YAML frontmatter, and inline fields (`[key:: value]`). The config modal offers live syntax validation and one-click sample queries; `TASK` rows toggle back to the source note, `CALENDAR` plots a month grid, and `HEATMAP` plots a year contribution grid from any numeric field. Results reuse the dashboard's glassmorphism theme and refresh on demand (manual refresh button).
- **Dataview heatmap queries** — `HEATMAP <value> [USING <date>]` aggregates a numeric field by day into a year heatmap; `USING` may sit before or after `FROM`.
- **Scroll-to-top button** — A small floating button in the bottom-right corner smoothly scrolls the dashboard back to the top once you've scrolled down, with safe-area inset on mobile so it clears the native bottom bar.

### Changed
- **Calendar DQL date fields** — `CALENDAR <field>` now uses the requested date field instead of silently falling back to file creation dates.

### Fixed
- **Subtask collapse/expand lag** — Tapping the chevron to expand or collapse a parent task's subtasks (or a project's nested docs) could take several seconds to respond. The "quiet" collapse path was still echoing through the full-board re-render: the deferred disk write unconditionally notified the view, rebuilding the entire dashboard a second after every toggle. The write is now silent, and the chevron handler tracks collapse state locally instead of reading a stale closed-over snapshot (which could only ever fold once after the re-render was removed). Toggling is now instant.
- **Collapsed parent could not be expanded after a sibling change** — If a parent task (or nested doc) was collapsed and then anything triggered a full re-render of the card — e.g. checking off a sibling task, which moves the completed task to the bottom — the collapsed parent's children were never re-created in the DOM, so the in-place expand had nothing to unhide and the chevron appeared dead. The renderer now always builds the child DOM (hidden via a class when collapsed) and recomputes visibility from a DOM-readable `aria-expanded` flag, so collapse/expand stays correct across full re-renders, including nested collapse.
- **Memo card drag lag and afterimage** — Dragging a memo card to a new spot felt sluggish and left a brief visual ghost. The move triggered a full-board re-render (every section, every card, with each memo line re-parsing links), which is what the user waited on, and it landed during the dragged card's `transform` settle transition — tearing the half-rotated card into a double image. Card moves are now zero-rebuild: the dragged card's DOM node is physically relocated (keeping its already-parsed links and hover bindings intact) while the data persists in the background, so the drop is instant and no re-render interrupts the transition.

### Performance
- **Wikilink resolution on large vaults** — Every `[[link]]` in a memo or project card that didn't match by exact path used to fall back to scanning the entire vault for a matching basename — once per link, per render. On a vault with thousands of notes this added hundreds of ms to each render and scaled with the number of links. Links now resolve against a cached basename index (built once, kept in sync on file create/delete/rename), turning the per-link cost from a full vault scan into a hash lookup.

### Removed
- **Standalone heatmap section** — The old heatmap section type has been removed. Use a Dataview section with `HEATMAP rating FROM "Books" USING finished`, or the existing tracker card heatmap style, depending on the use case. Existing `type: heatmap` sections safely fall back to regular project-style sections on load.
- **Legacy sidebar heatmap widget settings** — Dropped the unused `widgetHeatmap*` settings strings left over from the removed sidebar widget.

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
