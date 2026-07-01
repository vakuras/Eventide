# Changelog

All notable changes to Eventide are documented here.

## [0.8.0] - 2026-07-01

### Changed
- **Tauri terminal now spawns Copilot directly via `portable-pty` — the `pty_host.exe` helper binary is gone.** Previously the Tauri backend shelled out to a separate console-subsystem helper (`src-tauri/src/bin/pty_host.rs`) to host the ConPTY child, based on the belief that a GUI-subsystem process couldn't create ConPTY children (`0xC0000142`). A spike (validated against [SideX](https://github.com/Sidenai/sidex)'s direct-spawn approach) proved this wrong: `pty_manager.rs` now opens the PTY and calls `spawn_command` in-process, streaming output over the same `pty:data` / `pty:exit` events and applying resize via `MasterPty::resize` directly (no escape-sequence protocol). Session kill now tears down the whole process tree (`taskkill /F /T` on Windows), fixing orphaned/locked `copilot`/`agency` processes after close. Net result: one fewer binary to build, sign, and ship, and cleaner process lifecycle. The public `PtyManager` API and all Tauri commands are unchanged; the Electron runtime (node-pty) is unaffected.

## [0.7.4] - 2026-06-16

### Added
- **Sidebar search now matches across all title sources** ([#6](https://github.com/vakuras/Eventide/pull/6)) — search previously only scanned `events.jsonl`, so sessions renamed via Eventide's double-click rename (`.eventide-title`) or Copilot CLI's `/rename` slash command (`workspace.yaml` `name`) were unreachable unless the new name also appeared in the transcript. Title resolution now walks `.eventide-title` → `meta.name` → `meta.summary` → events fallback, and `meta.name` is treated as a user-chosen title (no truncation, no quoted-prompt cleanup). The new `_searchTitleForOccurrences` reads the same priority chain and emits a `sourceLabel: 'title'` hit; title matches are prepended to the results so they rank above transcript hits (within the existing 3-occurrence cap).

### Tests
- Added test coverage in `test/session-service.test.js` for the new title-source resolution and search ranking (final results: 270 pass / 11 pre-existing failures, unchanged).

## [0.7.3] - 2026-06-15

### Fixed
- **Mouse-wheel scrolling cycled prompt history in REPL TUIs** ([#5](https://github.com/vakuras/Eventide/pull/5)) — regression from v0.7.2. With mouse-tracking stripped and the terminal on the alt screen buffer (Copilot CLI's TUI), xterm.js's default wheel handler translated wheel-up/down into cursor-up/down (`\x1b[A` / `\x1b[B`), which Copilot CLI's prompt consumed as arrow keys and cycled input history. Added `src/terminal-wheel.js` which re-implements the wheel→SGR mouse-button bridge ourselves via `attachCustomWheelEventHandler`: synthesizes `\x1b[<64;X;YM` (wheel up) / `\x1b[<65;X;YM` (wheel down), derives 1-based cell coords from the wrapper's bounding rect, caps ticks at 10 per event to prevent trackpad fling floods, and returns `false` to suppress the cursor-key fallback. Drag and click are not synthesized, so native selection and the existing `Ctrl+C` copy handler keep working.

### Tests
- Added 17 unit tests in `test/terminal-wheel.test.js` covering SGR encoding (buttons 64/65, M terminator), `deltaMode` 0/1/2 conversion, tick capping, zero/missing/non-numeric inputs, multi-tick escape emission, wrapper-based cell-coord derivation, fallback to (1, 1) without a wrapper, and defensive paths (missing api, throwing `writePty`).

## [0.7.2] - 2026-06-15

### Fixed
- **Terminal drag-to-select / `Ctrl+C` copy broken** ([#4](https://github.com/vakuras/Eventide/pull/4)) — Copilot CLI enables xterm mouse-tracking modes (`?1000`, `?1002`, `?1006`, …) on startup, which made xterm.js forward mouse events to the PTY instead of creating a native text selection. `terminal.hasSelection()` was always `false`, so `Ctrl+C` sent SIGINT instead of copying. Added `src/pty-data-filter.js` which strips `ESC [ ? <params> h|l` mouse-mode IDs (`9`, `1000`, `1001`, `1002`, `1003`, `1005`, `1006`, `1015`, `1016`) from PTY output before handing it to `terminal.write()`. Combined sequences like `\x1b[?25;1002h` correctly retain the non-mouse params (`\x1b[?25h`). Right-click and drag-select now work as expected; the existing copy handler in `keyboard-shortcuts.js` starts firing automatically.

### Tests
- Added 13 unit tests in `test/pty-data-filter.test.js` covering each tracking mode, combined-mode sequences, partial removal preserving non-mouse params, unrelated CSI passthrough, mixed content, and null/undefined/non-string inputs (243/243 non-pre-existing tests passing).

## [0.7.1] - 2026-06-02

### Fixed
- **Session start/resume broken on copilot CLI 1.0.57+** — the underlying `copilot --resume <id>` now only resumes *existing* sessions and rejects pre-generated UUIDs for new sessions. Switched both runtimes to `--session-id <id>`, which per `copilot --help` "Resume an existing session or task by ID, or set the UUID for a new session" — works for both new and resume.
- **`unexpected argument --resume` when using `agency.exe`** — the Electron build was spawning `agency --session-id ...` directly, but those flags belong to agency's `copilot` subcommand. Electron `pty-manager.js` now injects the `copilot` subcommand when the configured binary is `agency`/`agency.exe` (case-insensitive), matching the existing Tauri `pty_host.rs` behavior.

### Tests
- Added 7 new tests in `pty-manager.test.js` covering the flag name and agency subcommand injection (45/45 passing).

## [0.7.0] - 2026-04-03

### Fixed
- **Sidebar collapse restore** — sidebar now correctly restores to collapsed state on startup
- **PTY input delay** — reverted timer-based batching that caused characters to buffer
- **Update install** — kills PTY sessions before installing to prevent file-in-use errors
- **Update banner** — polished green card with "Restart to update" button

### Changed
- **Code quality** — moved regex out of hot loops, replaced panicking unwraps, removed dead code
- **Removed unused Job Object code** — simplified PTY lifecycle

## [0.6.9] - 2026-04-05

### Added
- **Collapsed sidebar popup tooltip** — hover shows styled session info (title, status, time, cwd, tags)
- **First-letter session icons** in collapsed sidebar (instead of numbers)
- **Polished update-ready banner** with green accent button

### Fixed
- **Sidebar restores collapsed state** on startup correctly
- **PTY input delay** reverted timer-based batching that buffered characters
- **UTF-8 emoji crash** in session titles (6 byte-slicing panics fixed)
- **Code quality** — regex out of loops, unwraps replaced with proper error handling
- **Kill PTY sessions** before update install to prevent file-in-use errors

## [0.6.8] - 2026-04-03

### Fixed
- **PTY input delay** — reverted timer-based batching that caused characters to buffer until next keystroke
- **Code quality** — moved regex compilation out of hot loops, replaced panicking unwraps with proper error handling, removed debug console.log

## [0.6.7] - 2026-04-03

### Fixed
- **Tauri auto-update fully working** — signing key, password, and `createUpdaterArtifacts` all configured correctly

## [0.6.6] - 2026-04-02

### Fixed
- **Tauri crash on emoji in session titles** — fixed 6 byte-slicing panics when titles contain ✅⬆️🎉 etc.
- **Tauri crash on large session resume** — PTY output now batched at 16ms intervals (prevents WebView2 flooding)
- **Tauri auto-update** — CI now correctly signs the installer, generates `latest.json` with valid signature and URL
- **Electron auto-update** — `latest.yml` now included in releases

## [0.6.5] - 2026-04-02

### Fixed
- **Tauri auto-update** — fix signing key password handling in CI; ensure `.nsis.zip` and signature are generated

## [0.6.4] - 2026-04-02

### Added
- **Sidebar minimize toggle** — `«`/`»` button at sidebar bottom, DevOps-style collapse to 48px icon strip
- **Copilot Instructions editor** — inline textarea replaces read-only viewer; Apply/Reset buttons, unsaved indicator
- **Tab rename** — double-click tab title to rename inline

### Changed
- **Titlebar button order** — Diff, Status, Alerts, Instructions, Settings (moved ±/☷ from tab bar to titlebar)
- **Instructions toggle** — ☰ button now opens AND closes the panel (no separate Close button)
- **Sidebar collapse** — resize handle click minimizes sidebar (instead of full-hide)
- **Hidden Active/History tabs** when sidebar is minimized
- **Search icon** — `⌕` replaces emoji, expands sidebar on click when minimized
- **Import** loads file into editor without auto-saving (Apply required)

### Removed
- Tab drag-to-reorder (inconsistent across Electron/Tauri)
- Markdown viewer and TOC rendering (replaced by editor)
- Close button from instructions panel

## [0.6.3] - 2026-04-01

### Added
- **Drag-to-reorder tabs** — drag tabs to rearrange, order persists across restarts
- **Double-click tab to rename** — inline rename input on tab title, saves via `.eventide-title`

### Changed
- **Tauri update UX** — downloads silently in background, shows "Restart to update" button instead of auto-restarting

## [0.6.2] - 2026-04-01

### Fixed
- **Tauri auto-update** — added signing key and `latest.json` generation so Tauri builds can auto-update from GitHub releases

## [0.6.1] - 2026-04-01

### Fixed
- **Instructions panel layout** — panel now correctly fills the main content area without covering the sidebar or titlebar
- **Status and diff panels positioning** — moved inside terminal column so overlay panels don't break instructions panel containment
- **Window ready-to-show** — app window stays hidden until fully loaded (no icon flash on startup)
- **Instructions header buttons** — Export/Import/Close no longer hidden behind window controls

## [0.6.0] - 2026-03-31

### Added
- **4 themes** — Midnight (default), Mocha, Latte, and Retro (Apple Classic) with full xterm palettes and preview swatches
- **Diff panel** — dedicated sidebar with file list, unified/split view toggle, drag-to-resize, and Ctrl+D shortcut
- **Session diffs in Electron** — `getSessionDiffs` implemented in the Electron backend (previously Tauri-only)
- **Tauri window controls** — custom minimize/maximize/close buttons for frameless Tauri window
- **Runtime flavor in About** — shows "Eventide (Electron)" or "Eventide (Tauri)" with version
- **Tauri auto-update on startup** — checks for updates on launch when enabled (respects opt-out)
- **Resource commands in Tauri** — `resource_add` and `resource_remove` Tauri commands with full URL parsing

### Changed
- **Panels overlay terminal** — status and diff panels slide over the terminal instead of resizing it
- **Panels are mutually exclusive** — opening one closes the other
- **Panel buttons disabled when no session** — grayed out and non-clickable without an active session
- **Settings consolidated to 3 tabs** — General, Shortcuts, About (Updates merged into About)
- **Fixed settings modal height** — consistent 560px across all tabs
- **Default theme is Midnight** — both Electron and Tauri default to midnight
- **Settings file renamed** — `session-gui-settings.json` → `eventide-settings.json`
- **Session files renamed** — `.deepsky-title`/`.deepsky-cwd` → `.eventide-title`/`.eventide-cwd`
- **Window hides until ready** — no more flash of default icon or unstyled content on launch
- **Icons consolidated** — single `resources/` directory serves both Electron and Tauri
- **Installer names aligned** — `Eventide-Electron-Setup-X.X.X.exe` and `Eventide-Tauri-Setup-X.X.X.exe`
- **Same app ID** — installing one flavor automatically uninstalls the other

### Removed
- **Feedback panel** — removed button, dropdown, and all related code
- **Beta/prerelease channel** — "Early adapter" toggle removed; stable-only updates
- **"New Session" button on empty state** — cleaner empty state with just the Eventide badge
- **Duplicate icon files** — removed `eventide.ico` and `src-tauri/icons/` in favor of `resources/`

### Fixed
- **Copilot path fallback bug** — `return bin` (out of scope) → `return 'copilot'`
- **statusPanelSections not persisting** — added to settings DEFAULTS so `update()` no longer filters it out
- **Rust settings test** — was writing to wrong filename (`session-gui-settings.json`)
- **Titlebar colors for all themes** — Electron window chrome now matches midnight/mocha/latte/retro
- **Empty state image path** — fixed for both Electron (`../resources/`) and Tauri (`eventide.png`)
- **Status panel icon** — restored to ☷ (trigram) from clipboard emoji

## [0.5.0] - 2026-03-31

### Changed
- **Dual-platform architecture** — Eventide now supports both Electron and Tauri builds from a single codebase
  - `npm start` / `npm run dist` → Electron build (full-featured, ~150MB)
  - `npm run tauri:dev` / `npm run tauri:build` → Tauri build (lightweight, ~12MB)
- **Electron frontend rebased on DeepSky v0.9.0** — brings all DeepSky features:
  - Pre-warmed standby sessions for instant startup
  - Custom notification popups (themed Catppuccin toasts)
  - Full notification service with file watcher
  - Session eviction with graceful shutdown
  - 20 unit tests
- **Tauri backend preserved** — all Rust services (PTY, sessions, settings, tags, resources, status, notifications) unchanged

### Added
- Electron build config (electron-builder, NSIS installer)
- `node-pty` + `electron-updater` dependencies for Electron mode
- Electron `main.js`, `preload.js`, and all Node.js backend services
- `tauri-bridge.js` provides the same `window.api` interface for Tauri builds

## [0.4.0] - 2026-03-30

### Added
- **Settings redesigned with tabs** — General, Updates, Shortcuts, About; logically grouped instead of one long scroll
- **Auto-update toggle** — enable or disable automatic update checking from the Updates tab
- **Toggle switches** — modern iOS/macOS-style toggles replace old checkbox controls
- **Expandable tag overflow** — clicking the "+N" badge on a session card expands all hidden tags (was hover-only)
- **Settings rows** — label + control side-by-side layout with descriptions

### Changed
- **Diff panel is now inline** — slides open like the status panel with a width transition instead of overlaying as an absolute panel
- **Diff panel header** — matches status panel styling exactly (same padding, font, spacing)
- **± and ☷ buttons unified** — identical size and styling in the tab bar
- **Selection color improved** — better contrast for both Mocha and Latte themes
- **Settings modal** — 480px width, flex layout with scrollable body and fixed header
- **Keyboard shortcuts** moved to dedicated Shortcuts tab
- **Theme selection** moved under General → Appearance

### Fixed
- Diff panel close button now works correctly (inline style no longer overrides collapsed class)
- Terminal refits after diff panel open/close transition

## [0.3.0] - 2026-03-28

### Added
- **Diff view panel** — view file diffs from session changes with unified/split toggle, file list, and resizable panel

## [0.2.5] - 2026-03-28

### Fixed
- **History session click error handling** — clicking a history session now shows a toast error if it fails to open, instead of silently failing
- Improved error visibility for session open failures

## [0.2.4] - 2026-03-28

### Fixed
- **Settings close button stays visible** — header is now sticky, × button no longer scrolls away
- Close button hover turns red for clarity — no longer mistaken for directory clear button

## [0.2.3] - 2026-03-28

### Fixed
- **Fix terminal input freezing** — removed pending buffer in pty_host stdin handler that could stall when escape sequences split across reads
- Improved write error handling — marks session as dead on write failure instead of propagating error
- Simplified pty_host stdin→PTY forwarding for reliability

## [0.2.2] - 2026-03-28

### Fixed
- **Clean startup** — window starts hidden and shows only after frontend is fully loaded (no more black flash)
- **Disable right-click context menu** — WebView2 default context menu no longer appears
- Added `core:window:allow-show` capability for deferred window display

## [0.2.1] - 2026-03-28

### Fixed
- **Hide pty_host console window** — pty_host.exe no longer opens a visible terminal window alongside Eventide (uses `CREATE_NO_WINDOW` flag on Windows)
- Closing the stray console window no longer kills the Eventide session

## [0.2.0] - 2026-03-28

### Added
- **Retro (Apple Classic) theme** — golden amber foreground (#D5A200), dark charcoal background (#2C2B2B), classic terminal ANSI colors
- **Midnight theme** — blue-tinted dark palette (#1e2028 base), set as default theme
- **4 themes available** — Mocha (Catppuccin dark), Latte (Catppuccin light), Midnight, Retro
- UTF-8 char boundary safety with `snap_to_char_boundary` helper
- 2 new unit tests for multi-byte string handling (43 total)

### Fixed
- **UTF-8 crash in session search** — em dash (—) and other multi-byte characters caused a panic when building search match previews
- Removed compilation warnings — unused imports, dead methods, unused fields

### Changed
- Default theme changed from Mocha to Midnight
- Removed unused `kill_all` method from PtyManager
- Suppressed `dead_code` warnings on utility functions (`is_cmd_shim`, `push`)

## [0.1.0] - 2026-03-28

### Added
- **Tauri v2 migration** — rebuilt from Electron to Tauri with Rust backend
  - ~90% smaller binary, lower memory usage, faster startup
  - 7 backend services ported to Rust (Settings, Sessions, PTY, Tags, Resources, Status, Notifications)
  - portable-pty for terminal management (ConPTY on Windows)
  - Frontend bridge preserves existing `window.api` interface — zero renderer changes
- **Custom window controls** — minimize, maximize, close buttons (frameless window)
- **Separate settings** — `eventide-settings.json` (no longer shared with DeepSky)
- **New identity** — Eventide branding, custom icon, updated metadata
