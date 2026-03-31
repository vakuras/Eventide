# Eventide 🌒

**Your command center for GitHub Copilot CLI.**

Stop juggling session IDs. Eventide gives you a sleek desktop app to manage, search, and switch between all your Copilot CLI sessions — so you can focus on building, not bookkeeping.

![Windows](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)
![Tauri](https://img.shields.io/badge/Tauri%20v2-Rust-orange?logo=tauri)

> **Eventide is a fork of [DeepSky](https://github.com/itsela-ms/DeepSky)** — the original Electron-based Copilot CLI session manager. Eventide extends DeepSky with a dual-runtime architecture (Electron + Tauri), additional themes, a diff panel, and various UI improvements. All credit for the original concept, design, and Electron implementation goes to the DeepSky project.

---

## Why Eventide?

Copilot CLI is powerful, but managing sessions is painful. You're copying UUIDs, grepping through directories, and losing track of what's running. Eventide fixes all of that with a visual interface purpose-built for power users.

## Two Flavors, One App

Eventide ships as **two installers** from a single codebase — pick the one that suits you:

| | Electron | Tauri |
|---|---|---|
| **Size** | ~150 MB | ~12 MB |
| **Backend** | Node.js | Rust |
| **Terminal** | node-pty | ConPTY (pty_host.exe) |
| **Renderer** | Chromium | WebView2 |
| **Auto-update** | electron-updater | tauri-plugin-updater |
| **Installer** | `Eventide-Electron-Setup-X.X.X.exe` | `Eventide-Tauri-Setup-X.X.X.exe` |

Both flavors share the same frontend (HTML/CSS/JS), settings file (`eventide-settings.json`), session data, and feature set. Installing one automatically uninstalls the other — they use the same app identity.

---

## ✨ Features

### Session Management
- **Visual sidebar** with all your sessions — active and historical — searchable by title, tags, or linked resources
- **Concurrent sessions** — keep multiple sessions alive in the background with smart eviction when you hit the limit
- **Session rename** — double-click any title to give it a meaningful name
- **Instant resume** — click to reopen any past session exactly where you left off

### Embedded Terminal
- Full-featured terminal with 10,000-line scrollback, link detection, and clipboard support
- Multi-tab interface — switch between sessions like browser tabs
- Full ANSI support, resize, and colors

### Diff Panel
- Dedicated sidebar with file list grouped by directory
- Unified and split diff views with syntax-highlighted additions/deletions
- Resizable panel with persisted width across sessions
- Toggle with `Ctrl+D` or the `±` toolbar button

### Smart Search & Resources
- Find sessions by title, tags, PR numbers, work item IDs, or repo names
- Every session shows its linked PRs, work items, repos, and wiki pages as clickable links
- Auto-extracted tags: repo names, tools, topics

### Session Status
- Live Copilot intent indicator
- Session summary, next steps, and timeline
- Files changed with added/modified badges
- Status and diff panels overlay the terminal (no resize)

### Notifications
- Real-time alerts when tasks complete, sessions error out, or input is needed
- Badge counter, dropdown panel, and toast popups

### Polish
- **Four themes** — Midnight (default, navy-blue dark), Mocha (Catppuccin dark), Latte (Catppuccin light), Retro (Apple Classic amber)
- Custom window controls with native Windows icons
- Settings organized in 3 tabs: General, Shortcuts, About
- Auto-update with opt-out toggle (stable channel)
- Runtime flavor shown in About: "Eventide (Electron)" or "Eventide (Tauri)"

---

## Architecture

```
src/                    # Shared frontend (both runtimes)
├── renderer.js         # Main UI logic
├── styles.css          # All themes and layout
├── index.html          # App shell
├── tauri-bridge.js     # Tauri → window.api adapter
├── preload.js          # Electron → window.api adapter
├── main.js             # Electron main process
├── settings-service.js # Electron settings
├── session-service.js  # Electron session management
├── status-service.js   # Electron status + diffs
└── ...                 # Other Electron services

src-tauri/              # Tauri backend (Rust)
├── src/
│   ├── lib.rs          # Tauri command registration
│   ├── commands/       # IPC command handlers
│   ├── services/       # 7 Rust services (settings, sessions, PTY, tags, resources, status, notifications)
│   └── bin/pty_host.rs # ConPTY helper binary
└── tauri.conf.json

resources/              # Shared icons and images (both runtimes)
```

---

## Installation

### From Releases

Download the latest installer from [Releases](https://github.com/vakuras/Eventide/releases):
- **`Eventide-Electron-Setup-X.X.X.exe`** — Electron build (larger, uses Chromium)
- **`Eventide-Tauri-Setup-X.X.X.exe`** — Tauri build (lightweight, uses WebView2)

### From Source

**Prerequisites:**
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) — `winget install github.copilot`
- [Node.js](https://nodejs.org/) (18+)
- [Rust](https://rustup.rs/) (1.77+) — only needed for Tauri builds

```bash
git clone https://github.com/vakuras/Eventide.git
cd Eventide
npm install
```

#### Run Electron
```bash
npm start
```

#### Run Tauri
```bash
npm run tauri:dev
```

#### Build Installers
```bash
# Electron
npx electron-builder --win --publish never

# Tauri
npm run tauri:build
```

---

## Origin

Eventide started as a fork of [DeepSky](https://github.com/itsela-ms/DeepSky), an Electron app for managing GitHub Copilot CLI sessions. The Tauri backend was built from scratch to provide a lightweight alternative, and the two runtimes now coexist in a single repository sharing the same frontend code.

Key differences from DeepSky:
- Dual-runtime support (Electron + Tauri)
- Four themes (DeepSky has two)
- Diff panel with unified/split view
- Overlay panels (don't resize terminal)
- Consolidated settings with fewer tabs
- Session files use `.eventide-*` naming
- Unified `resources/` directory for all assets

---

## License

MIT