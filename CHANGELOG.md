# Changelog

All notable changes to Eventide are documented here.

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
