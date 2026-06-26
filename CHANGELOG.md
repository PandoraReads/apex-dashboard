# Changelog

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
