# Changelog

All notable changes to Eventide are documented here.

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
