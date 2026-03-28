# Changelog

All notable changes to Eventide are documented here.

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
