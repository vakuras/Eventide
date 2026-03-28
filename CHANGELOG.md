# Changelog

All notable changes to Eventide are documented here.

## [0.1.0] - 2025-07-13

### Added
- **Tauri v2 migration** — rebuilt from Electron to Tauri with Rust backend
  - ~90% smaller binary, lower memory usage, faster startup
  - 7 backend services ported to Rust (Settings, Sessions, PTY, Tags, Resources, Status, Notifications)
  - portable-pty for terminal management (ConPTY on Windows)
  - Frontend bridge preserves existing `window.api` interface — zero renderer changes
- **Custom window controls** — minimize, maximize, close buttons (frameless window)
- **Separate settings** — `eventide-settings.json` (no longer shared with DeepSky)
- **New identity** — Eventide branding, custom icon, updated metadata
