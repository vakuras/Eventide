# Eventide ✦

**Your command center for GitHub Copilot CLI.**

Stop juggling session IDs. Eventide gives you a sleek desktop app to manage, search, and switch between all your Copilot CLI sessions — so you can focus on building, not bookkeeping.

![Windows](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-blue)

---

## Why Eventide?

Copilot CLI is powerful, but managing sessions is painful. You're copying UUIDs, grepping through directories, and losing track of what's running. Eventide fixes all of that with a visual interface purpose-built for power users.

## ✨ Features

### Session Management
- **Visual sidebar** with all your sessions — active and historical — searchable by title, tags, or linked resources
- **Concurrent sessions** — keep multiple sessions alive in the background with smart eviction when you hit the limit
- **Session rename** — double-click any title to give it a meaningful name
- **Instant resume** — click to reopen any past session exactly where you left off

### Embedded Terminal
- Full-featured terminal with 10,000-line scrollback, link detection, and clipboard support
- Multi-tab interface — switch between sessions like browser tabs
- ConPTY-backed terminal with full ANSI support, resize, and colors

### Smart Search & Resources
- Find sessions by title, tags, PR numbers, work item IDs, or repo names
- Every session shows its linked PRs, work items, repos, and wiki pages as clickable links
- Auto-extracted tags: repo names, tools, topics

### Session Status
- Live Copilot intent indicator
- Session summary, next steps, and timeline
- Files changed with added/modified badges

### Notifications
- Real-time alerts when tasks complete, sessions error out, or input is needed
- Badge counter, dropdown panel, and toast popups

### Polish
- **Three themes** — Mocha (dark), Latte (light), Midnight (true dark)
- Custom window controls with native Windows icons
- Separate settings from other tools (`eventide-settings.json`)

---

## Architecture

Eventide is built with **Tauri v2** (Rust backend + WebView2 frontend):

- **Backend**: 7 Rust services — Settings, Sessions, PTY, Tags, Resources, Status, Notifications
- **Frontend**: Vanilla JS with xterm.js terminal emulator
- **PTY Host**: Console-mode helper binary for ConPTY bridging (required because Tauri GUI apps can't create ConPTY children directly)

---

## Installation

### From Source

```bash
git clone https://github.com/vakuras/Eventide.git
cd Eventide
npm install
npm run dev
```

**Prerequisites:**
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) — `winget install github.copilot`
- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (18+)

### Build for Distribution

```bash
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/nsis/`

---

## License

MIT