# Changelog

All notable changes to DeepSky are documented here.

## [0.8.5] - 2026-03-16

### Added
- **Sidebar collapse** — click the sidebar border to fully collapse (width 0) with an expand strip; drag to icon-mode at smaller widths
- **Info bar** — structural bar below the terminal showing the session title and last prompt
- **Restore closed tab** — `Ctrl+Shift+T` reopens the last closed session tab
- **In-session search** — `Ctrl+F` opens buffer-only search with viewport sync and wrapped-line-aware matching
- **Sidebar content search** — search across all session content from the sidebar search bar
- **Session ID in status panel** — shows session ID with a copy button in the summary section
- **Keyboard shortcuts in Settings** — new section showing all shortcuts with styled keycaps
- **Rename from context menu** — right-click a session in the sidebar to rename it

### Changed
- **Themed scrollbar** — always-visible webkit scrollbar with Catppuccin styling
- **Next steps truncation** — long plan step labels are summarized to 6 words for cleaner status panel display
- **Zoom scroll fix** — terminal scrolls to bottom after zoom refit to prevent getting stuck

### Removed
- **"Check for Updates" button** — auto-update runs silently on startup and every 15 minutes; manual check no longer needed

## [0.8.4] - 2026-03-12

### Fixed
- **Terminal horizontal scroll** — fixed terminal content getting cut off on the left when the status panel is open, caused by stale xterm viewport scroll offset after container resize

## [0.8.3] - 2026-03-12

### Changed
- **Custom notification popups** — replaced Windows native toast notifications with themed Catppuccin popups that slide in from the bottom-right, stack when multiple arrive, auto-dismiss after 6 seconds, and navigate to the relevant session on click

## [0.8.2] - 2026-03-09

### Added
- **Feedback button** — new `✎` button in the toolbar opens a panel with "Report a Bug" and "Request a Feature" options, each pre-filling a GitHub issue with version info and structured templates

### Changed
- **Session timestamps** — sessions older than today now show the date (e.g. "Dec 12 14:30") instead of just the time, making history easier to navigate
- **History list** — removed date group headers ("Today", "Yesterday", etc.) for a cleaner, less cluttered session list
- **History sorting** — history tab now sorts sessions by most recently used first

## [0.8.1] - 2026-03-07

### Fixed
- Auto-update XML parse error when checking for new versions
- Release distribution now correctly serves from itsela-ms/DeepSky (public)

## [0.8.0] - 2026-03-04

### Added
- **Session Status panel** — replaces the Resource panel with a richer, collapsible status view (`Ctrl+I` / `📋` button)
  - Shows current Copilot intent (live pulse indicator)
  - Session summary extracted from session-summary.md or checkpoints
  - Next steps with progress tracking (done/current/pending states)
  - Timeline of session events with color-coded dots
  - Files changed with added/modified badges
  - Collapsible sections with persistent expand/collapse state
- **Status Service** — new backend service that reads session intent, summary, plan, files, and timeline from session state
- **Keyboard shortcut** — `Ctrl+I` toggles the status panel; works even when terminal is focused

### Changed
- **Repository migration** — DeepSky moved from `itsela-ms/DeepSky` to `itsela_microsoft/DeepSky` to enable community contributions. Auto-updater now points to the new repository — future updates arrive from the new location automatically.
- **Update badge** — now shows immediately when a download starts (not just after completion); toast notification only fires after download completes
- Resources (PRs, work items, pipelines, repos, links) are now displayed as sections inside the Status panel instead of the old dedicated Resource panel

## [0.7.0] - 2026-02-26

### Added
- **Working directory support** — choose a working directory per session
  - Optional directory picker on new session creation (enable in Settings)
  - Click the cwd path in the sidebar to change a running session's directory
  - Sessions respawn in the new directory; persisted across restarts via `.deepsky-cwd`
  - Default working directory setting in Settings panel
- **Session close button** — `✕` button on active session tabs for quick close (kills the PTY)
- **Resource panel: manual add** — paste any ADO link into the input to pin it to the session
- **Resource panel: remove button** — `×` hover button on each resource row to dismiss it
- **Resource panel: pipeline & release links** — auto-extracted from session events + manually addable
  - Build results (`_build/results?buildId=`), pipeline definitions (`_build?definitionId=`), releases (`_releaseProgress?releaseId=`)
- **Resource panel: generic links** — any non-ADO URL can be added as a generic link
- **Resource deduplication** — resources keyed by `{type}:{id|url}`; duplicates rejected on add and filtered on display

### Changed
- PTY session entry uses direct reference to prevent stale exit handlers after kill+respawn
- PTY spawn falls back to homedir if the specified cwd is invalid
- Resource panel 🔗 toggle button pinned outside the scrollable tab area (no longer disappears on tab overflow)

### Fixed
- Race condition where old PTY exit handler could delete a newly-opened session entry during cwd change

## [0.6.1] - 2026-02-25

### Added
- **PR status tracking** — resource panel and sidebar pills now show active/completed/abandoned state for linked PRs
- **Ctrl+T** shortcut to create a new session (same as Ctrl+N)
- **Ctrl+C copy** — when text is selected in the terminal, Ctrl+C copies to clipboard instead of sending SIGINT
- **Double-click group header** to rename (in addition to the existing context menu option)

### Changed
- Clipboard operations routed through main process IPC (fixes sandboxed preload restrictions)
- "Pending" state only triggers for active PRs (completed/abandoned PRs no longer count)
- Removed `copy` from Electron Edit menu to prevent double-handling with xterm's selection model

### Fixed
- Removed `Shift+Enter` custom handling that interfered with terminal input

## [0.6.0] - 2026-02-23

### Added
- **Session grouping** — Edge-style group management in the Active sidebar
  - Create, rename, and recolor groups via context menu
  - Drag-and-drop to reorder sessions and move them between groups
  - Collapse/expand groups with session count badges
  - Right-click context menus for sessions and group headers (rename, color, ungroup, close all)
  - 8 Catppuccin-themed preset group colors
- **Manual session ordering** — drag to reorder sessions freely; order persisted across restarts
- **Drop indicators** — top/bottom highlight when reordering via drag-and-drop
- **Input validation** — group names capped at 50 chars; corrupted group state gracefully restored

### Changed
- **Silent auto-updates** — updates download in the background and install on quit; no restart prompts
- Background update check every 15 minutes
- Green badge on settings gear when an update is pending
- Removed keyboard shortcuts section from README

## [0.5.5] - 2026-02-23

### Added
- CI workflow for Windows builds (GitHub Actions)
- Tab scroll indicators — left/right arrows appear when tabs overflow the tab bar
- SQL/SQLite/database tag recognition for sessions
- Pending sessions now surface on the active tab (not just running ones)

### Changed
- Removed macOS support (Windows-only for now)
- Replaced session dashboard with minimal empty state
- Cross-platform path handling (`os.homedir`), platform-aware binary discovery
- Tabs shrink instead of always overflowing (`flex-shrink: 1`, `min-width: 80px`)
- App icon upscaled to 512×512 for electron-builder

### Fixed
- Copilot CLI `.cmd` shim not found on Windows npm installs — now searches both `.exe` and `.cmd`, spawns via `cmd.exe /c`
- Titlebar buttons unclickable on Electron 35 — Windows `titleBarOverlay` intercepted clicks; fixed with explicit `app-region: no-drag`
- Horizontal scrollbar overflow in terminal area — flex `min-width: auto` prevented shrinking
- "Working" badge on startup lasting ~30s — `lastDataAt` was initialized to `Date.now()`
- "Pending" state never showing for sessions with PRs
- Session state priority reworked — Pending now overrides all states; updated tips for Working/Waiting/Idle
- Memory leaks — IPC listeners not cleaned up, xterm terminals not disposed on pty exit, dead pty entries accumulating in Map
- Unbounded memory — notification `processedFiles` Set uncapped, `sessionLastUsed`/`sessionAliveState`/`sessionIdleCount` not cleaned on close
- Event handling — replaced per-item `addEventListener` with event delegation; fixed title click race condition

## [0.5.4] - 2026-02-22

### Added
- Session dashboard view when no tabs are open
- Live session status polling — badges update every 3s based on actual pty output
- Session state now uses `isBusy` (recent output) instead of focused-session heuristic
- Graceful shutdown — busy sessions stay alive in background when closing (10-min timeout)
- Close confirmation dialog when AI sessions are still processing
- Unit test infrastructure (Vitest) with 27 tests for session-state and pty-manager
- Extracted `session-state.js` — pure function for state derivation

### Changed
- "Working" state now means AI is actively outputting (green), "Waiting" means idle terminal (yellow)
- `pty-manager` tracks `lastDataAt` per session and exposes it via `getActiveSessions()`
- `pty-manager` accepts injectable pty module for testability

### Fixed
- Notification click not focusing the target session (rAF race condition)
- Session state badges going stale between discrete UI events

## [0.5.3] - 2026-02-19

### Added
- Session state badges — each session shows a colored state pill (Idle / Working / Waiting / Pending / ✓ Done)
- Graceful shutdown — busy sessions stay alive in the background when closing, with a 10-minute timeout
- Close confirmation dialog when AI sessions are still processing

### Changed
- Resource panel toggle button changed from ⊞ to 🔗
- Resource icons (Repo/Wiki/PR/WI) styled as auto-width pill badges to prevent text overlap
- Sidebar session items have improved right padding to prevent badge collision

### Fixed
- Resource panel icon text ("Repo", "Wiki") overlapping with resource label names
- Session resource badges colliding with running indicator dot and delete button

## [0.5.2] - 2026-02-17

### Changed
- Smoother UI — softer borders in dark mode, eased transitions, borderless ghost buttons
- Clean icon glyphs (⚐ ☰ ⚙ ⊞) replace emojis everywhere, labels shown on hover
- Simplified update flow — single "Check for Updates" button, auto-downloads, prompts to restart

### Added
- Session persistence — open tabs and active tab restored on startup
- Session delete — red ✕ on hover in history tab with confirmation dialog
- Middle-click to close terminal tabs
- Running session indicator — green dot with subtle glow

### Fixed
- Horizontal scroll in sidebar active tab
- Inconsistent border colors in dark mode

## [0.5.1] - 2026-02-16

### Changed
- Rebranded from GroundControl to DeepSky — new name, new icon, new identity
- Switched to dark icon variant for better taskbar/tray visibility

### Added
- Session rename — double-click any session title in the sidebar to rename it

## [0.4.0] - 2025-02-15

### Added
- Auto-update via GitHub Releases (electron-updater)
- "Check for Updates" button in Settings with download progress
- "Restart & Update" one-click install for downloaded updates
- About section in Settings showing version and changelog
- Switched from portable `.exe` to NSIS installer (install/uninstall, Start Menu entry)

## [0.3.0] - 2025-02-15

### Added
- Version and changelog visible in Settings panel
- Active sidebar now sorts sessions by last used

### Fixed
- New session not appearing in active list immediately
- Tab title not updating after session gets a title
- Startup crash and close ReferenceError

## [0.2.0] - 2025-02-01

### Added
- Windows portable installer via electron-builder
- Custom DeepSky window icon
- Ctrl+V and Shift+Insert paste support in terminal
- Notification bell and notification panel
- Session tags and resource indexing (PRs, work items)
- Theme switcher (Mocha/Latte)
- Keyboard shortcuts: Ctrl+Tab, Ctrl+W, Ctrl+N, Ctrl+K
- Session search with tag and resource filtering
- Copilot instructions editor

### Fixed
- 34 bugs from QA review
- Notification bell white background in dark mode

### Initial
- Electron-based session manager for GitHub Copilot CLI
- Sidebar with Active/History session views
- Terminal multiplexer with tab management
- PTY management with automatic session eviction
