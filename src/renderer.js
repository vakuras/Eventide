const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { deriveSessionState } = require('./session-state');
const { createTerminalKeyHandler } = require('./keyboard-shortcuts');
const { collectTerminalSearchMatches } = require('./terminal-search');
const { resolveSidebarDragWidth } = require('./sidebar-resize');

// State
const terminals = new Map();
const sessionBusyState = new Map(); // sessionId → boolean (has recent pty output)
const sessionAliveState = new Set(); // sessionIds with live pty processes
let activeSessionId = null;
let allSessions = [];
let searchQuery = '';
let currentSidebarTab = 'active';
let originalInstructions = '';
let currentInstructions = '';
let currentTheme = 'mocha';
const openingSession = new Set();
const cwdChangingSessions = new Set(); // sessions undergoing cwd change (suppress exit handling)
const recentlyClosedSessions = []; // stack of session IDs closed by the user
const sessionLastUsed = new Map();
let creatingSession = false;
const ipcCleanups = []; // unsubscribe fns for IPC listeners
let sidebarSearchResultIds = null;
let sidebarSearchLoading = false;
let sidebarSearchTimer = null;
let sidebarSearchRequestSeq = 0;
let sidebarCollapsed = false;
let sidebarHidden = false;
let lastExpandedSidebarWidth = 280;
const sessionPromptGhostState = new Map();

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 450;
const SIDEBAR_COLLAPSED_WIDTH = 68;

// Tab group state
let tabGroups = []; // Array of { id, name, color, collapsed, tabIds }
let sessionOrder = []; // Manual ordering of active session IDs in sidebar
const GROUP_COLORS = [
  { name: 'Grey', value: '#585b70' },
  { name: 'Blue', value: '#89b4fa' },
  { name: 'Red', value: '#f38ba8' },
  { name: 'Yellow', value: '#f9e2af' },
  { name: 'Green', value: '#a6e3a1' },
  { name: 'Pink', value: '#f5c2e7' },
  { name: 'Purple', value: '#cba6f7' },
  { name: 'Cyan', value: '#94e2d5' },
];
let nextGroupColorIdx = 0;

function saveTabState() {
  const openTabs = [...terminals.keys()];
  window.api.updateSettings({ openTabs, activeTab: activeSessionId, tabGroups, sessionOrder });
}

// Theme palettes for xterm.js
const XTERM_THEMES = {
  mocha: {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
    selectionBackground: '#45475a', selectionForeground: '#cdd6f4',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
    brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8'
  },
  latte: {
    background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', cursorAccent: '#eff1f5',
    selectionBackground: '#acb0be', selectionForeground: '#4c4f69',
    black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
    blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
    brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d',
    brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc'
  },
  midnight: {
    background: '#121212', foreground: '#e8eaed', cursor: '#e8eaed', cursorAccent: '#121212',
    selectionBackground: '#3c4043', selectionForeground: '#e8eaed',
    black: '#3c4043', red: '#f28b82', green: '#81c995', yellow: '#fdd663',
    blue: '#8ab4f8', magenta: '#d7aefb', cyan: '#78d9ec', white: '#dadce0',
    brightBlack: '#5f6368', brightRed: '#f28b82', brightGreen: '#81c995', brightYellow: '#fdd663',
    brightBlue: '#8ab4f8', brightMagenta: '#d7aefb', brightCyan: '#78d9ec', brightWhite: '#e8eaed'
  }
};

// DOM elements
const sessionList = document.getElementById('session-list');
const searchInput = document.getElementById('search');
const searchClear = document.getElementById('search-clear');
const sidebarSearchToggle = document.getElementById('sidebar-search-toggle');
const terminalContainer = document.getElementById('terminal-container');
const terminalPromptGhost = document.getElementById('terminal-prompt-ghost');
const sessionSearch = document.getElementById('session-search');
const sessionSearchInput = document.getElementById('session-search-input');
const sessionSearchCount = document.getElementById('session-search-count');
const sessionSearchPrev = document.getElementById('session-search-prev');
const sessionSearchNext = document.getElementById('session-search-next');
const sessionSearchClose = document.getElementById('session-search-close');
const terminalTabs = document.getElementById('terminal-tabs');
const tabsScrollArea = terminalTabs.querySelector('.tabs-scroll-area');
const tabScrollLeft = terminalTabs.querySelector('.tab-scroll-left');
const tabScrollRight = terminalTabs.querySelector('.tab-scroll-right');
const emptyState = document.getElementById('empty-state');
const btnNew = document.getElementById('btn-new');
const btnNewCenter = document.getElementById('btn-new-center');
const maxConcurrentInput = document.getElementById('max-concurrent');
const promptWorkdirInput = document.getElementById('prompt-workdir');
const defaultWorkdirInput = document.getElementById('default-workdir');
const btnPickDefaultWorkdir = document.getElementById('btn-pick-default-workdir');
const btnClearDefaultWorkdir = document.getElementById('btn-clear-default-workdir');
const instructionsPanel = document.getElementById('instructions-panel');
const instructionsRendered = document.getElementById('instructions-rendered');
const btnInstructions = document.getElementById('btn-instructions');
const btnCloseInstructions = document.getElementById('btn-close-instructions');
const terminalArea = document.getElementById('terminal-area');
const settingsOverlay = document.getElementById('settings-overlay');
const btnSettings = document.getElementById('btn-settings');
const statusPanel = document.getElementById('status-panel');
const statusPanelBody = document.getElementById('status-panel-body');
const btnToggleStatus = document.getElementById('btn-toggle-status');
const notificationBadge = document.getElementById('notification-badge');
const notificationPanel = document.getElementById('notification-panel');
const notificationListEl = document.getElementById('notification-list');
const feedbackPanel = null; // removed
const toastContainer = document.getElementById('toast-container');

const titlebar = document.getElementById('titlebar');
const NOTIF_ICONS = { 'task-done': '✓', 'needs-input': '◌', 'error': '!', 'info': '·' };

const OVERLAY_BASE_PX = 140;
async function syncTitlebarPadding() {
  const zoom = await window.api.getZoom();
  titlebar.style.paddingRight = `${Math.ceil(OVERLAY_BASE_PX / zoom)}px`;
}
syncTitlebarPadding();

let sessionSearchMatches = [];
let sessionSearchIndex = -1;

function getActiveTerminalEntry() {
  return activeSessionId ? terminals.get(activeSessionId) : null;
}

function updateSessionSearchUi() {
  const hasQuery = !!sessionSearchInput.value.trim();
  const hasMatches = sessionSearchMatches.length > 0;
  if (!hasQuery) {
    sessionSearchCount.textContent = '';
  } else {
    sessionSearchCount.textContent = hasMatches ? `${sessionSearchIndex + 1}/${sessionSearchMatches.length}` : '0/0';
  }
  sessionSearchPrev.disabled = !hasMatches;
  sessionSearchNext.disabled = !hasMatches;
}

function clearActiveTerminalSelection() {
  const entry = getActiveTerminalEntry();
  if (entry) entry.terminal.clearSelection();
}

function syncTerminalViewport(sessionId, { refreshSearch = false } = {}) {
  const entry = terminals.get(sessionId);
  if (!entry || entry.isSyncingViewport) return;

  entry.isSyncingViewport = true;
  try {
    entry.terminal._core?.viewport?.syncScrollArea(true);

    if (
      refreshSearch &&
      sessionId === activeSessionId &&
      !sessionSearch.classList.contains('hidden') &&
      sessionSearchInput.value.trim()
    ) {
      refreshSessionSearch(true);
    }
  } finally {
    entry.isSyncingViewport = false;
  }
}

function scheduleTerminalViewportSync(sessionId, { refreshSearch = false } = {}) {
  const entry = terminals.get(sessionId);
  if (!entry) return;

  entry.pendingViewportRefreshSearch = entry.pendingViewportRefreshSearch || refreshSearch;
  if (entry.viewportSyncTimer) clearTimeout(entry.viewportSyncTimer);
  entry.viewportSyncTimer = setTimeout(() => {
    entry.viewportSyncTimer = null;
    const currentEntry = terminals.get(sessionId);
    if (!currentEntry) return;
    const shouldRefreshSearch = !!currentEntry.pendingViewportRefreshSearch;
    currentEntry.pendingViewportRefreshSearch = false;

    requestAnimationFrame(() => {
      syncTerminalViewport(sessionId, { refreshSearch: shouldRefreshSearch });
    });
  }, 20);
}

function collectSessionSearchMatches(query) {
  const entry = getActiveTerminalEntry();
  if (!entry || !query) return [];
  return collectTerminalSearchMatches(entry.terminal.buffer.active, entry.terminal.cols, query);
}

function revealSessionSearchMatch(index, keepSearchFocus = false) {
  if (index < 0 || index >= sessionSearchMatches.length) return false;
  const entry = getActiveTerminalEntry();
  const match = sessionSearchMatches[index];
  if (!entry || !match) return false;
  const matchSessionId = activeSessionId;

  sessionSearchIndex = index;
  updateSessionSearchUi();

  const targetViewportY = Math.max(0, match.row - Math.floor(entry.terminal.rows / 2));
  syncTerminalViewport(matchSessionId);
  entry.terminal.scrollToLine(targetViewportY);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (activeSessionId !== matchSessionId) return;
      const currentEntry = terminals.get(matchSessionId);
      if (!currentEntry) return;
      syncTerminalViewport(matchSessionId);
      currentEntry.terminal.clearSelection();
      currentEntry.terminal.select(match.col, match.row, match.length);
      if (keepSearchFocus) sessionSearchInput.focus();
      else currentEntry.terminal.focus();
    });
  });

  return true;
}

function refreshSessionSearch(preserveIndex = false) {
  const trimmed = sessionSearchInput.value.trim();
  if (!trimmed || !activeSessionId) {
    sessionSearchMatches = [];
    sessionSearchIndex = -1;
    clearActiveTerminalSelection();
    updateSessionSearchUi();
    return;
  }

  const previousIndex = preserveIndex ? sessionSearchIndex : -1;
  sessionSearchMatches = collectSessionSearchMatches(trimmed);
  if (!sessionSearchMatches.length) {
    sessionSearchIndex = -1;
    clearActiveTerminalSelection();
    updateSessionSearchUi();
    return;
  }

  const nextIndex = previousIndex >= 0
    ? Math.min(previousIndex, sessionSearchMatches.length - 1)
    : 0;
  revealSessionSearchMatch(nextIndex, true);
}

function stepSessionSearch(direction) {
  if (!sessionSearchMatches.length) {
    refreshSessionSearch(false);
    return;
  }
  const nextIndex = sessionSearchIndex < 0
    ? 0
    : (sessionSearchIndex + direction + sessionSearchMatches.length) % sessionSearchMatches.length;
  revealSessionSearchMatch(nextIndex, true);
}

function openSessionSearch() {
  if (!activeSessionId || !terminals.has(activeSessionId)) {
    focusSidebarSearch();
    return;
  }

  sessionSearch.classList.remove('hidden');
  updateSessionSearchUi();
  refreshSessionSearch(true);
  requestAnimationFrame(() => {
    sessionSearchInput.focus();
    sessionSearchInput.select();
  });
}

function closeSessionSearch({ restoreTerminalFocus = true } = {}) {
  sessionSearch.classList.add('hidden');
  sessionSearchInput.value = '';
  sessionSearchMatches = [];
  sessionSearchIndex = -1;
  clearActiveTerminalSelection();
  updateSessionSearchUi();

  if (restoreTerminalFocus) {
    const entry = getActiveTerminalEntry();
    if (entry) entry.terminal.focus();
  }
}

function getSessionPromptGhost(sessionId) {
  if (!sessionPromptGhostState.has(sessionId)) {
    sessionPromptGhostState.set(sessionId, {
      lastPrompt: '',
      isTyping: false,
      requestSeq: 0
    });
  }
  return sessionPromptGhostState.get(sessionId);
}

function updateSessionPromptGhost(sessionId) {
  if (!terminalPromptGhost) return;

  if (!sessionId || sessionId !== activeSessionId) {
    terminalPromptGhost.innerHTML = '';
    terminalPromptGhost.classList.add('empty');
    return;
  }

  const session = allSessions.find(s => s.id === sessionId);
  const title = session?.title || 'New Session';
  const shortId = sessionId.substring(0, 8);
  const state = getSessionPromptGhost(sessionId);
  const lastPrompt = state.lastPrompt || '';

  const esc = (s) => { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; };

  let html = `<span class="info-badge">Session Context</span><span class="info-title">${esc(title)}</span>`;
  if (lastPrompt) {
    html += `<span class="info-divider">│</span>`;
    html += `<span class="info-prompt" title="${esc(lastPrompt)}">💬 ${esc(lastPrompt)}</span>`;
  }

  terminalPromptGhost.innerHTML = html;
  terminalPromptGhost.classList.remove('empty');
}

function scheduleSessionPromptGhostRefresh(sessionId, delays = [0, 400, 1200]) {
  const state = getSessionPromptGhost(sessionId);
  const requestId = ++state.requestSeq;
  const runRefresh = async () => {
    try {
      const lastPrompt = await window.api.getLastUserPrompt(sessionId);
      const currentState = getSessionPromptGhost(sessionId);
      if (currentState.requestSeq !== requestId) return;
      currentState.lastPrompt = lastPrompt || '';
      updateSessionPromptGhost(sessionId);
    } catch {
      // Ignore transient transcript-read failures.
    }
  };

  for (const delay of delays) {
    setTimeout(runRefresh, delay);
  }
}

function handleSessionPromptInput(sessionId, data) {
  const state = getSessionPromptGhost(sessionId);
  if (!data) return;

  if (data.includes('\r') || data.includes('\n')) {
    state.isTyping = false;
    // Transcript takes time to be written after send — use longer delays
    scheduleSessionPromptGhostRefresh(sessionId, [800, 2000, 5000]);
    return;
  }

  state.isTyping = true;
}

function matchesSidebarMetadata(session, queryLower) {
  if (session.title.toLowerCase().includes(queryLower)) return true;
  if (session.cwd && session.cwd.toLowerCase().includes(queryLower)) return true;
  if (session.tags && session.tags.some(tag => tag.toLowerCase().includes(queryLower))) return true;
  if (session.resources && session.resources.some(resource =>
    String(resource.id || '').toLowerCase().includes(queryLower) ||
    String(resource.url || '').toLowerCase().includes(queryLower) ||
    String(resource.name || '').toLowerCase().includes(queryLower) ||
    String(resource.repo || '').toLowerCase().includes(queryLower)
  )) {
    return true;
  }
  return false;
}

function queueSidebarSearch(query) {
  if (sidebarSearchTimer) clearTimeout(sidebarSearchTimer);
  const needle = query.trim();
  const requestId = ++sidebarSearchRequestSeq;

  if (!needle) {
    sidebarSearchLoading = false;
    sidebarSearchResultIds = null;
    renderSessionList();
    return;
  }

  sidebarSearchLoading = true;
  renderSessionList();
  sidebarSearchTimer = setTimeout(async () => {
    try {
      const results = await window.api.searchSessions(needle);
      if (requestId !== sidebarSearchRequestSeq) return;
      sidebarSearchResultIds = new Set(results.map(result => result.id));
    } catch {
      if (requestId !== sidebarSearchRequestSeq) return;
      sidebarSearchResultIds = null;
    } finally {
      if (requestId === sidebarSearchRequestSeq) {
        sidebarSearchLoading = false;
        renderSessionList();
      }
    }
  }, 120);
}

function syncSidebarCollapsedUi() {
  lastExpandedSidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, lastExpandedSidebarWidth));
  sidebar.classList.toggle('collapsed', sidebarCollapsed && !sidebarHidden);
  sidebar.classList.toggle('hidden-full', sidebarHidden);
  resizeHandle.classList.toggle('collapsed', sidebarCollapsed || sidebarHidden);
  resizeHandle.classList.toggle('sidebar-hidden', sidebarHidden);
  if (sidebarHidden) {
    sidebar.style.width = '0px';
  } else {
    sidebar.style.width = `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : lastExpandedSidebarWidth}px`;
  }
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  if (collapsed === sidebarCollapsed && sidebar.style.width) {
    syncSidebarCollapsedUi();
    return;
  }

  if (collapsed) {
    const currentWidth = parseInt(sidebar.style.width, 10) || Math.round(sidebar.getBoundingClientRect().width) || lastExpandedSidebarWidth;
    if (currentWidth >= SIDEBAR_MIN_WIDTH) lastExpandedSidebarWidth = currentWidth;
  }

  sidebarCollapsed = collapsed;
  syncSidebarCollapsedUi();

  if (window._cachedSettings) {
    window._cachedSettings.sidebarCollapsed = collapsed;
    window._cachedSettings.sidebarWidth = lastExpandedSidebarWidth;
  }

  if (persist) window.api.updateSettings({ sidebarCollapsed: collapsed });
  renderSessionList();
  fitActiveTerminal();
}

function persistSidebarWidth(width) {
  lastExpandedSidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
  if (window._cachedSettings) window._cachedSettings.sidebarWidth = lastExpandedSidebarWidth;
  window.api.updateSettings({ sidebarWidth: lastExpandedSidebarWidth });
}

function focusSidebarSearch() {
  if (sidebarCollapsed) setSidebarCollapsed(false);
  queueAfterNextPaint(() => {
    searchInput.focus();
    searchInput.select();
    document.getElementById('search-wrapper').classList.add('search-active');
  });
}

// Delegated event handling for session list items (avoids per-item listener churn)
let _titleClickTimeout = null;
let _titleClickSessionId = null;
sessionList.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.session-close');
  if (closeBtn) {
    e.stopPropagation();
    const item = closeBtn.closest('.session-item');
    if (item) closeTab(item.dataset.sessionId);
    return;
  }
  const deleteBtn = e.target.closest('.session-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const item = deleteBtn.closest('.session-item');
    if (item) {
      const session = allSessions.find(s => s.id === item.dataset.sessionId);
      if (session) confirmDeleteSession(session.id, session.title);
    }
    return;
  }
  // Cwd click → pick new directory
  const cwdEl = e.target.closest('.session-cwd');
  if (cwdEl) {
    e.stopPropagation();
    const sid = cwdEl.dataset.sessionId;
    if (sid) handleCwdClick(sid);
    return;
  }
  const titleEl = e.target.closest('.session-title');
  if (titleEl) {
    e.stopPropagation();
    const item = titleEl.closest('.session-item');
    const sid = item?.dataset.sessionId;
    if (!sid) return;
    if (_titleClickTimeout && _titleClickSessionId === sid) {
      clearTimeout(_titleClickTimeout);
      _titleClickTimeout = null;
      _titleClickSessionId = null;
      return; // dblclick handler will fire
    }
    // Clear any pending timeout for a different session
    if (_titleClickTimeout) clearTimeout(_titleClickTimeout);
    _titleClickSessionId = sid;
    _titleClickTimeout = setTimeout(() => { _titleClickTimeout = null; _titleClickSessionId = null; openSession(sid); }, 250);
    return;
  }
  const item = e.target.closest('.session-item');
  if (item) openSession(item.dataset.sessionId);
});
sessionList.addEventListener('dblclick', (e) => {
  const titleEl = e.target.closest('.session-title');
  if (!titleEl) return;
  e.stopPropagation();
  if (_titleClickTimeout) { clearTimeout(_titleClickTimeout); _titleClickTimeout = null; _titleClickSessionId = null; }
  const item = titleEl.closest('.session-item');
  if (item) startRenameSession(item.dataset.sessionId, titleEl);
});
sessionList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const cwdEl = e.target.closest('.session-cwd');
    if (cwdEl) {
      e.preventDefault();
      e.stopPropagation();
      const sid = cwdEl.dataset.sessionId;
      if (sid) handleCwdClick(sid);
      return;
    }
  }
  if (e.key !== 'Enter') return;
  const item = e.target.closest('.session-item');
  if (item) openSession(item.dataset.sessionId);
});

// Initialize
async function init() {
  const settings = await window.api.getSettings();
  window._cachedSettings = settings;
  maxConcurrentInput.value = settings.maxConcurrent;
  promptWorkdirInput.checked = !!settings.promptForWorkdir;
  defaultWorkdirInput.value = settings.defaultWorkdir || '';
  lastExpandedSidebarWidth = settings.sidebarWidth || 280;
  sidebarHidden = !!settings.sidebarCollapsed;
  sidebarCollapsed = false;
  syncSidebarCollapsedUi();
  applyTheme(settings.theme || 'mocha');

  // Restore last sidebar tab — must be set BEFORE refreshSessionList
  if (settings.lastActiveTab) {
    currentSidebarTab = settings.lastActiveTab;
    document.querySelectorAll('.sidebar-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === currentSidebarTab);
    });
  }

  await refreshSessionList();

  // Clean up any previous IPC listeners (guards against double-init on reload)
  while (ipcCleanups.length) ipcCleanups.pop()();

  ipcCleanups.push(window.api.onPtyData((sessionId, data) => {
    const entry = terminals.get(sessionId);
    if (entry) {
      entry.terminal.write(data, () => {
        scheduleTerminalViewportSync(sessionId, { refreshSearch: true });
      });
    }
    sessionAliveState.add(sessionId);
    sessionBusyState.set(sessionId, true);
    patchSessionStateBadges();
  }));

  ipcCleanups.push(window.api.onPtyExit((sessionId, exitCode) => {
    // Skip disposal if session is changing cwd (will be respawned)
    if (cwdChangingSessions.has(sessionId)) return;

    const entry = terminals.get(sessionId);
    if (entry) {
      entry.exited = true;
      entry.terminal.write(`\r\n\x1b[90m[Session ended with code ${exitCode}]\x1b[0m\r\n`, () => {
        scheduleTerminalViewportSync(sessionId, { refreshSearch: true });
      });
      // Dispose terminal after a short delay so the exit message is visible
      entry.exitTimeout = setTimeout(() => {
        const e = terminals.get(sessionId);
        if (e && e.exited) {
          if (e.titlePoll) clearInterval(e.titlePoll);
          e.terminal.dispose();
          e.wrapper.remove();
          terminals.delete(sessionId);
          const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
          if (tab) tab.remove();
          updateTabScrollButtons();
          if (activeSessionId === sessionId) {
            activeSessionId = null;
            updateSessionPromptGhost(null);
            const remaining = document.querySelectorAll('.tab');
            if (remaining.length > 0) switchToSession(remaining[remaining.length - 1].dataset.sessionId);
            else { emptyState.classList.remove('hidden'); updateStatusPanel(null); }
          }
          saveTabState();
          scheduleRenderSessionList();
        }
      }, 3000);
    }
    sessionAliveState.delete(sessionId);
    sessionBusyState.delete(sessionId);
    sessionIdleCount.delete(sessionId);
    cwdChangingSessions.delete(sessionId);
    updateTabStatus(sessionId, false);
    patchSessionStateBadges();
  }));

  const evictedUnsub = window.api.onPtyEvicted?.((sessionId) => {
    sessionAliveState.delete(sessionId);
    sessionBusyState.delete(sessionId);
    sessionIdleCount.delete(sessionId);
    cwdChangingSessions.delete(sessionId);
    const entry = terminals.get(sessionId);
    if (entry) {
      if (entry.titlePoll) clearInterval(entry.titlePoll);
      entry.terminal.write('\r\n\x1b[90m[Session evicted to free capacity]\x1b[0m\r\n');
      entry.terminal.dispose();
      entry.wrapper.remove();
      terminals.delete(sessionId);
    }
    const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    if (tab) tab.remove();
    updateTabScrollButtons();
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      updateSessionPromptGhost(null);
      const remaining = document.querySelectorAll('.tab');
      if (remaining.length > 0) switchToSession(remaining[remaining.length - 1].dataset.sessionId);
      else { emptyState.classList.remove('hidden'); updateStatusPanel(null); }
    }
    renderSessionList();
    saveTabState();
  });
  if (evictedUnsub) ipcCleanups.push(evictedUnsub);

  let resizeTimer = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      fitActiveTerminal();
    }, 50);
  });
  resizeObserver.observe(terminalContainer);

  // Sidebar tab switching
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentSidebarTab = tab.dataset.tab;
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderSessionList();
      window.api.updateSettings({ lastActiveTab: currentSidebarTab });
    });
  });

  // Settings modal
  btnSettings.addEventListener('click', openSettings);

  // Home link — deselect active session
  document.getElementById('titlebar-home').addEventListener('click', showHome);
  settingsOverlay.querySelector('.settings-close').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

  // Update status listener (auto-update only, no manual button)
  ipcCleanups.push(window.api.onUpdateStatus(handleUpdateStatus));

  // Theme switcher
  settingsOverlay.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      window.api.updateSettings({ theme });
      settingsOverlay.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
    });
  });

  // Status panel
  btnToggleStatus.addEventListener('click', toggleStatusPanel);
  statusPanel.querySelector('.status-panel-close').addEventListener('click', () => {
    statusPanel.classList.add('collapsed');
    btnToggleStatus.classList.remove('active');
    fitActiveTerminal();
  });
  statusPanelBody.addEventListener('click', async (event) => {
    const copyButton = event.target.closest('.status-copy-session-id');
    if (!copyButton) return;

    const sessionId = copyButton.dataset.sessionId;
    if (!sessionId) return;

    try {
      await window.api.copyText(sessionId);
      showToast({ type: 'success', title: 'Session ID copied', body: sessionId });
    } catch {
      showToast({ type: 'error', title: 'Copy failed', body: 'Could not copy the session ID.' });
    }
  });

  // Tab scroll buttons
  tabScrollLeft.addEventListener('click', () => {
    tabsScrollArea.scrollBy({ left: -200, behavior: 'smooth' });
  });
  tabScrollRight.addEventListener('click', () => {
    tabsScrollArea.scrollBy({ left: 200, behavior: 'smooth' });
  });
  tabsScrollArea.addEventListener('scroll', updateTabScrollButtons);
  new ResizeObserver(updateTabScrollButtons).observe(tabsScrollArea);

  // Notifications
  document.getElementById('btn-notifications').addEventListener('click', toggleNotificationPanel);
  document.getElementById('btn-close-notifications').addEventListener('click', () => notificationPanel.classList.add('hidden'));
  document.getElementById('btn-clear-notifications').addEventListener('click', async () => {
    await window.api.clearAllNotifications();
    await refreshNotifications();
  });

  document.addEventListener('click', (e) => {
    if (!notificationPanel.classList.contains('hidden') &&
        !notificationPanel.contains(e.target) && 
        !e.target.closest('#btn-notifications')) {
      notificationPanel.classList.add('hidden');
    }
  });

  // Feedback — removed

  ipcCleanups.push(window.api.onNotification((notification) => {
    showToast(notification);
    refreshNotifications();
  }));

  ipcCleanups.push(window.api.onNotificationClick(async (notification) => {
    if (notification.sessionId) {
      await openSession(notification.sessionId);
    }
  }));

  await refreshNotifications();

  // Restore previously open tabs
  if (settings.openTabs && settings.openTabs.length > 0) {
    const validIds = new Set(allSessions.map(s => s.id));
    const tabsToRestore = settings.openTabs.filter(id => validIds.has(id));
    await Promise.allSettled(tabsToRestore.map(id => openSession(id)));

    // Restore tab groups (with validation)
    if (Array.isArray(settings.tabGroups) && settings.tabGroups.length > 0) {
      tabGroups = settings.tabGroups.filter(g =>
        g && typeof g.id === 'string' && typeof g.name === 'string' &&
        Array.isArray(g.tabIds) && g.tabIds.some(id => terminals.has(id))
      ).map(g => ({
        id: g.id,
        name: (g.name || 'Group').substring(0, 50),
        color: g.color || GROUP_COLORS[0].value,
        collapsed: !!g.collapsed,
        tabIds: g.tabIds.filter(id => terminals.has(id)),
      }));
    }

    // Restore session order
    if (Array.isArray(settings.sessionOrder) && settings.sessionOrder.length > 0) {
      sessionOrder = settings.sessionOrder.filter(id => terminals.has(id));
    }

    renderSessionList();

    // Switch to the previously active tab
    if (settings.activeTab && terminals.has(settings.activeTab)) {
      switchToSession(settings.activeTab);
    }
  }
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Update existing terminals
  const xtermTheme = XTERM_THEMES[theme];
  for (const [, entry] of terminals) {
    entry.terminal.options.theme = xtermTheme;
  }

  // Update settings modal active state
  settingsOverlay.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

function openSettings() {
  settingsOverlay.classList.remove('hidden');
  populateAboutSection();
}

async function populateAboutSection() {
  const version = await window.api.getVersion();
  const changelog = await window.api.getChangelog();
  document.getElementById('about-version').textContent = `v${version}`;
  const changelogEl = document.getElementById('about-changelog');
  changelogEl.textContent = changelog || 'No changelog available.';

  // Restore current update status
  const updateData = await window.api.getUpdateStatus();
  if (updateData) handleUpdateStatus(updateData);
}

function handleUpdateStatus(data) {
  const statusEl = document.getElementById('update-status');
  const progressEl = document.getElementById('update-progress');
  const progressBar = document.getElementById('update-progress-bar');

  statusEl.classList.remove('hidden');
  progressEl.classList.add('hidden');

  switch (data.status) {
    case 'checking':
      statusEl.textContent = 'Checking for updates…';
      break;
    case 'available':
      statusEl.textContent = `Downloading v${data.info?.version}…`;
      statusEl.className = 'update-status';
      setUpdateBadge(true, data.info?.version, false);
      break;
    case 'not-available':
      statusEl.textContent = 'You\'re on the latest version.';
      statusEl.className = 'update-status';
      setUpdateBadge(false);
      break;
    case 'downloading':
      statusEl.textContent = `Downloading… ${Math.round(data.progress?.percent || 0)}%`;
      progressEl.classList.remove('hidden');
      progressBar.style.width = `${data.progress?.percent || 0}%`;
      break;
    case 'downloaded':
      statusEl.textContent = `v${data.info?.version} will be installed on next quit.`;
      statusEl.className = 'update-status update-available';
      setUpdateBadge(true, data.info?.version, true);
      break;
    case 'error':
      statusEl.textContent = `Update error: ${data.error}`;
      statusEl.className = 'update-status update-error';
      break;
    case 'idle':
      statusEl.classList.add('hidden');
      break;
  }
}

function setUpdateBadge(show, version, notify) {
  let badge = document.getElementById('update-badge');
  if (show) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'update-badge';
      badge.className = 'update-badge';
      btnSettings.appendChild(badge);
    }
    badge.textContent = '↑';
    badge.title = `v${version} available`;
    badge.classList.remove('hidden');
    if (notify) {
      showToast({ type: 'info', title: 'Update ready', body: `v${version} downloaded — will apply next time you close Eventide.` });
    }
  } else if (badge) {
    badge.classList.add('hidden');
  }
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

async function refreshSessionList() {
  allSessions = await window.api.listSessions();
  const validIds = new Set([...allSessions.map(s => s.id), ...terminals.keys()]);
  for (const session of allSessions) {
    if (terminals.has(session.id)) {
      updateTabTitle(session.id, session.title);
    }
  }
  // Prune stale entries from tracking maps
  for (const id of sessionLastUsed.keys()) {
    if (!validIds.has(id)) sessionLastUsed.delete(id);
  }
  await updateSessionBusyStates();
  if (searchQuery) queueSidebarSearch(searchQuery);
  scheduleRenderSessionList();
  if (!activeSessionId) emptyState.classList.remove('hidden');
}

const BUSY_THRESHOLD_MS = 30000;
const STATUS_POLL_MS = 3000;
// Consecutive idle polls required before transitioning Working → Waiting.
// Prevents flickering when AI pauses briefly between output bursts.
const IDLE_GRACE_POLLS = 3;
const sessionIdleCount = new Map();

async function updateSessionBusyStates() {
  try {
    const activeSessions = await window.api.getActiveSessions();
    const now = Date.now();
    const newAlive = new Set();
    for (const s of activeSessions) {
      newAlive.add(s.id);
      const recentOutput = s.lastDataAt && (now - s.lastDataAt) < BUSY_THRESHOLD_MS;
      if (recentOutput) {
        // Active output — immediately mark as busy, reset idle counter
        sessionBusyState.set(s.id, true);
        sessionIdleCount.delete(s.id);
      } else if (sessionBusyState.get(s.id)) {
        // Was busy, now idle — require sustained idle before flipping
        const count = (sessionIdleCount.get(s.id) || 0) + 1;
        sessionIdleCount.set(s.id, count);
        if (count >= IDLE_GRACE_POLLS) {
          sessionBusyState.set(s.id, false);
          sessionIdleCount.delete(s.id);
        }
      } else {
        sessionBusyState.set(s.id, false);
      }
    }
    // Sync alive state from main process
    sessionAliveState.clear();
    for (const id of newAlive) sessionAliveState.add(id);
    // Clear stale entries
    for (const id of sessionBusyState.keys()) {
      if (!newAlive.has(id)) {
        sessionBusyState.delete(id);
        sessionIdleCount.delete(id);
      }
    }
  } catch {}
}

function patchSessionStateBadges() {
  document.querySelectorAll('.session-item[data-session-id]').forEach(el => {
    const sessionId = el.dataset.sessionId;
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;

    const isRunning = sessionAliveState.has(sessionId);
    const hasPR = session.resources && session.resources.some(r => r.type === 'pr' && (!r.state || r.state === 'active'));
    const { label, cls, tip } = deriveSessionState({
      isRunning,
      isActive: sessionId === activeSessionId,
      hasPR,
      isHistory: currentSidebarTab === 'history',
      isBusy: sessionBusyState.get(sessionId) || false
    });

    const badge = el.querySelector('.session-state');
    if (badge && (badge.textContent !== label || !badge.classList.contains(cls))) {
      badge.className = 'session-state ' + cls;
      badge.textContent = label;
      badge.title = tip;
    }
  });
}

async function pollSessionStatus() {
  await updateSessionBusyStates();
  patchSessionStateBadges();
}

setInterval(pollSessionStatus, STATUS_POLL_MS);

let _renderScheduled = false;
function scheduleRenderSessionList() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    renderSessionList();
  });
}

function createSessionItem(session, group, index) {
  const el = document.createElement('div');
  el.className = 'session-item';
  el.dataset.sessionId = session.id;
  if (session.id === activeSessionId) el.classList.add('active');
  if (sessionAliveState.has(session.id)) el.classList.add('running');
  if (group) {
    el.classList.add('grouped');
  }

  const lastUsedTime = sessionLastUsed.get(session.id);
  const lastUsedDate = new Date(lastUsedTime || session.updatedAt);
  const isToday = lastUsedDate.toDateString() === new Date().toDateString();
  const timeStr = isToday
    ? lastUsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : lastUsedDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + lastUsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  let tagsHtml = '';
  const allPills = [];
  if (session.resources && session.resources.length > 0) {
    const prs = session.resources.filter(r => r.type === 'pr');
    const wis = session.resources.filter(r => r.type === 'workitem');
    if (prs.length > 0) allPills.push(`<span class="tag tag-pr" title="${escapeHtml(prs.map(p => 'PR ' + p.id + (p.repo ? ' (' + p.repo + ')' : '') + (p.state ? ' [' + p.state + ']' : '')).join('\n'))}">PR ${prs.map(p => p.id).join(', ')}</span>`);
    if (wis.length > 0) allPills.push(`<span class="tag tag-wi" title="${escapeHtml(wis.map(w => 'WI ' + w.id).join('\n'))}">WI ${wis.map(w => w.id).join(', ')}</span>`);
  }
  if (session.tags && session.tags.length > 0) {
    const repos = session.tags.filter(t => t.startsWith('repo:'));
    const rest = session.tags.filter(t => !t.startsWith('repo:'));
    for (const t of [...repos, ...rest]) {
      const cls = t.startsWith('repo:') ? 'tag tag-repo' : 'tag';
      const label = t.replace(/^(repo|tool):/, '');
      allPills.push(`<span class="${cls}">${escapeHtml(label)}</span>`);
    }
  }
  if (allPills.length > 0) {
    const MAX_VISIBLE = 3;
    const visible = allPills.slice(0, MAX_VISIBLE).join('');
    const hiddenCount = allPills.length - MAX_VISIBLE;
    const hidden = hiddenCount > 0
      ? `<span class="tag tag-overflow">+${hiddenCount}</span><span class="tags-hidden">${allPills.slice(MAX_VISIBLE).join('')}</span>`
      : '';
    tagsHtml = `<div class="session-tags">${visible}${hidden}</div>`;
  }

  const isRunning = sessionAliveState.has(session.id);
  const hasPR = session.resources && session.resources.some(r => r.type === 'pr' && (!r.state || r.state === 'active'));
  const { label: stateLabel, cls: stateCls, tip: stateTip } = deriveSessionState({
    isRunning,
    isActive: session.id === activeSessionId,
    hasPR,
    isHistory: currentSidebarTab === 'history',
    isBusy: sessionBusyState.get(session.id) || false
  });

  // Truncate cwd for display — show last folder name or short path
  let cwdHtml = '';
  if (session.cwd) {
    const cwdDisplay = shortenPath(session.cwd);
    cwdHtml = `<span class="session-cwd" role="button" tabindex="0" data-session-id="${session.id}" title="${escapeHtml(session.cwd)}">📂 ${escapeHtml(cwdDisplay)}</span>`;
  }

  el.innerHTML = `
    <div class="session-collapsed-index" title="${escapeHtml(`Session ${index + 1}`)}">${index + 1}</div>
    <div class="session-header-row">
      <div class="session-title" data-title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</div>
      <span class="session-state ${stateCls}" title="${escapeHtml(stateTip)}">${stateLabel}</span>
    </div>
    <div class="session-meta"><span>${timeStr}</span>${cwdHtml}</div>
    ${tagsHtml}
    ${currentSidebarTab === 'history' ? '<button class="session-delete" title="Delete session">✕</button>' : ''}
    ${currentSidebarTab === 'active' && isRunning ? '<button class="session-close" tabindex="-1" title="Close session">✕</button>' : ''}
  `;

  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.title = session.title;

  // Drag-and-drop + context menu for active sessions
  if (currentSidebarTab === 'active') {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-session-id', session.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      sessionList.querySelectorAll('.drop-above, .drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      el.classList.toggle('drop-above', above);
      el.classList.toggle('drop-below', !above);
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-above', 'drop-below');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-above', 'drop-below');
      const draggedId = e.dataTransfer.getData('application/x-session-id');
      if (!draggedId || draggedId === session.id) return;
      const rect = el.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      handleSessionReorder(draggedId, session.id, above, group);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSessionContextMenu(e, session.id);
    });
  }

  return el;
}

function renderSessionList() {
  const activeIds = new Set([...terminals.keys()]);

  let displayed;
  if (currentSidebarTab === 'active') {
    displayed = allSessions.filter(s => activeIds.has(s.id));
    // Use manual order if available, fall back to last-used sort
    if (sessionOrder.length > 0) {
      const orderMap = new Map(sessionOrder.map((id, i) => [id, i]));
      displayed.sort((a, b) => {
        const oa = orderMap.has(a.id) ? orderMap.get(a.id) : 99999;
        const ob = orderMap.has(b.id) ? orderMap.get(b.id) : 99999;
        if (oa !== ob) return oa - ob;
        return (sessionLastUsed.get(b.id) || 0) - (sessionLastUsed.get(a.id) || 0);
      });
    } else {
      displayed.sort((a, b) => (sessionLastUsed.get(b.id) || 0) - (sessionLastUsed.get(a.id) || 0));
    }
  } else {
    displayed = [...allSessions];
    displayed.sort((a, b) => (sessionLastUsed.get(b.id) || 0) - (sessionLastUsed.get(a.id) || 0));
  }

  // Filter by search (title + tags + resources)
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    displayed = displayed.filter(s => {
      if (matchesSidebarMetadata(s, q)) return true;
      if (sidebarSearchResultIds && sidebarSearchResultIds.has(s.id)) return true;
      return false;
    });
  }

  sessionList.innerHTML = '';

  if (displayed.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-list';
    emptyEl.textContent = sidebarSearchLoading
      ? 'Searching sessions...'
      : currentSidebarTab === 'active'
        ? 'No active sessions. Click a session in History or start a new one.'
        : searchQuery ? 'No sessions match your search.' : 'No sessions found.';
    sessionList.appendChild(emptyEl);
    return;
  }

  let displayIndex = 0;
  const appendSessionItem = (session, group = null) => {
    const el = createSessionItem(session, group, displayIndex);
    displayIndex += 1;
    sessionList.appendChild(el);
  };

  if (currentSidebarTab === 'active' && tabGroups.length > 0 && !searchQuery && !sidebarCollapsed) {
    // Render grouped sessions
    const displayedIds = new Set(displayed.map(s => s.id));

    for (const group of tabGroups) {
      const groupSessions = group.tabIds
        .filter(id => displayedIds.has(id))
        .map(id => displayed.find(s => s.id === id))
        .filter(Boolean);

      if (groupSessions.length === 0) continue;

      // Group header
      const headerEl = document.createElement('div');
      headerEl.className = 'session-group-header' + (group.collapsed ? ' collapsed' : '');
      headerEl.dataset.groupId = group.id;
      headerEl.innerHTML = `
        <span class="session-group-chevron">${group.collapsed ? '▸' : '▾'}</span>
        <span class="session-group-dot" style="background: ${group.color}"></span>
        <span class="session-group-name">${escapeHtml(group.name)}</span>
        <span class="session-group-count">${groupSessions.length}</span>
      `;
      headerEl.addEventListener('click', (e) => {
        if (e.target.getAttribute('contenteditable') === 'true') return;
        group.collapsed = !group.collapsed;
        renderSessionList();
        saveTabState();
      });
      headerEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startGroupRename(group);
      });
      headerEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showGroupContextMenu(e, group.id);
      });

      // Make group header a drop target
      headerEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        headerEl.classList.add('drag-over');
      });
      headerEl.addEventListener('dragleave', () => headerEl.classList.remove('drag-over'));
      headerEl.addEventListener('drop', (e) => {
        e.preventDefault();
        headerEl.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('application/x-session-id');
        if (draggedId) addTabToGroup(draggedId, group.id);
      });

      const groupEl = document.createElement('div');
      groupEl.className = 'session-group';
      if (group.collapsed) groupEl.classList.add('collapsed');
      groupEl.style.setProperty('--group-color', group.color);
      groupEl.appendChild(headerEl);

      // Group sessions (if not collapsed)
      if (!group.collapsed) {
        for (const session of groupSessions) {
          const el = createSessionItem(session, group, displayIndex);
          displayIndex += 1;
          groupEl.appendChild(el);
        }
      }

      sessionList.appendChild(groupEl);
    }

    // Ungrouped sessions
    const groupedIds = new Set(tabGroups.flatMap(g => g.tabIds));
    const ungrouped = displayed.filter(s => !groupedIds.has(s.id));
    for (const session of ungrouped) {
      appendSessionItem(session);
    }
  } else {
    // Original rendering (history tab or search active)
    for (const session of displayed) {
      appendSessionItem(session);
    }
  }

  window.api.getNotifications().then(notifications => {
    sessionList.querySelectorAll('.session-item').forEach(el => {
      const sessionId = el.dataset.sessionId;
      if (!sessionId) return;
      const unread = notifications.filter(n => !n.read && n.sessionId === sessionId).length;
      if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'session-notification-badge';
        badge.textContent = unread;
        const titleEl = el.querySelector('.session-title');
        if (titleEl) titleEl.appendChild(badge);
      }
    });
  });
}

function startRenameSession(sessionId, titleEl) {
  const currentTitle = titleEl.dataset.title || titleEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = currentTitle;

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      await window.api.renameSession(sessionId, newTitle);
      await refreshSessionList();
    } else {
      titleEl.textContent = currentTitle;
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

const cwdPickerActive = new Set();

async function handleCwdClick(sessionId) {
  if (cwdPickerActive.has(sessionId)) return;
  cwdPickerActive.add(sessionId);

  try {
    const session = allSessions.find(s => s.id === sessionId);
    const defaultPath = session?.cwd || undefined;
    const picked = await window.api.pickDirectory(defaultPath);
    if (!picked) return;

    const isAlive = sessionAliveState.has(sessionId);
    if (isAlive) {
      const entry = terminals.get(sessionId);
      if (entry) {
        entry.terminal.write('\r\n\x1b[90m[Changing working directory…]\x1b[0m\r\n', () => {
          scheduleTerminalViewportSync(sessionId, { refreshSearch: true });
        });
      }
      cwdChangingSessions.add(sessionId);
      try {
        await window.api.changeCwd(sessionId, picked);
        sessionAliveState.add(sessionId);
      } finally {
        cwdChangingSessions.delete(sessionId);
      }
    } else {
      await window.api.changeCwd(sessionId, picked);
    }

    // Update local state
    if (session) session.cwd = picked;
    await refreshSessionList();
  } finally {
    cwdPickerActive.delete(sessionId);
  }
}

function confirmDeleteSession(sessionId, title) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>Delete session?</h3>
      <p>This will permanently delete "<strong>${escapeHtml(title)}</strong>" and all its data. This cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn-secondary confirm-cancel">Cancel</button>
        <button class="btn-danger confirm-delete">Delete</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const cleanup = () => overlay.remove();
  overlay.querySelector('.confirm-cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  overlay.querySelector('.confirm-delete').addEventListener('click', async () => {
    cleanup();
    // Close tab if open
    if (terminals.has(sessionId)) {
      await closeTab(sessionId);
    }
    await window.api.deleteSession(sessionId);
    await refreshSessionList();
  });

  // Esc to cancel
  const onKey = (e) => { if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

async function openSession(sessionId) {
  const existing = terminals.get(sessionId);
  if (existing && !existing.exited) {
    switchToSession(sessionId);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return;
  }
  // Clean up dead terminal from exit delay if present
  if (existing && existing.exited) {
    if (existing.exitTimeout) clearTimeout(existing.exitTimeout);
    if (existing.titlePoll) clearInterval(existing.titlePoll);
    existing.terminal.dispose();
    existing.wrapper.remove();
    terminals.delete(sessionId);
    const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    if (tab) tab.remove();
  }
  if (openingSession.has(sessionId)) return;
  openingSession.add(sessionId);

  try {
    await window.api.openSession(sessionId);
    sessionAliveState.add(sessionId);
    createTerminal(sessionId);
    switchToSession(sessionId);

    const session = allSessions.find(s => s.id === sessionId);
    addTab(sessionId, session?.title || sessionId.substring(0, 8));
    renderSessionList();
    saveTabState();
    // Wait for rAF focus to complete
    await new Promise(resolve => requestAnimationFrame(resolve));
  } finally {
    openingSession.delete(sessionId);
  }
}

async function newSession() {
  if (creatingSession) return;
  creatingSession = true;

  try {
    // Prompt for working directory if enabled
    let cwd = undefined;
    const settings = await window.api.getSettings();
    if (settings.promptForWorkdir) {
      const picked = await window.api.pickDirectory(settings.defaultWorkdir || undefined);
      if (picked === null) { creatingSession = false; return; } // user cancelled
      cwd = picked;
    } else if (settings.defaultWorkdir) {
      cwd = settings.defaultWorkdir;
    }

    const sessionId = await window.api.newSession(cwd);
    sessionAliveState.add(sessionId);
    createTerminal(sessionId);
    switchToSession(sessionId);
    addTab(sessionId, 'New Session');

    // Inject placeholder so the active list renders immediately
    if (!allSessions.find(s => s.id === sessionId)) {
      allSessions.unshift({ id: sessionId, title: 'New Session', cwd: cwd || '', updatedAt: new Date().toISOString(), tags: [], resources: [] });
    }

    currentSidebarTab = 'active';
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'active'));
    renderSessionList();

    // Retry refresh to pick up real metadata once the CLI writes it
    for (const delay of [3000, 8000, 15000]) {
      setTimeout(() => {
        if (terminals.has(sessionId)) refreshSessionList();
      }, delay);
    }
    // Continue polling every 15s until title is no longer "New Session"
    const titlePoll = setInterval(() => {
      if (!terminals.has(sessionId)) { clearInterval(titlePoll); return; }
      const session = allSessions.find(s => s.id === sessionId);
      if (session && session.title !== 'New Session') { clearInterval(titlePoll); return; }
      refreshSessionList();
    }, 15000);
    // Store on terminal entry so it can be cleared on close/exit/eviction
    const termEntry = terminals.get(sessionId);
    if (termEntry) termEntry.titlePoll = titlePoll;
    saveTabState();
  } finally {
    creatingSession = false;
  }
}

function createTerminal(sessionId) {
  const terminal = new Terminal({
    theme: XTERM_THEMES[currentTheme],
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
    scrollOnOutput: true
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon((e, uri) => window.api.openExternal(uri)));

  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.id = `term-${sessionId}`;
  terminalContainer.appendChild(wrapper);

  terminal.open(wrapper);
  fitAddon.fit();

  terminal.onData((data) => {
    handleSessionPromptInput(sessionId, data);
    window.api.writePty(sessionId, data);
  });
  terminal.onResize(({ cols, rows }) => {
    window.api.resizePty(sessionId, cols, rows);
    scheduleTerminalViewportSync(sessionId, { refreshSearch: true });
  });
  terminal.onScroll(() => {
    const currentEntry = terminals.get(sessionId);
    if (!currentEntry || currentEntry.isSyncingViewport) return;
    scheduleTerminalViewportSync(sessionId);
  });

  // Defense-in-depth: suppress xterm's native paste handler.
  // Primary fix is in main.js (custom menu without 'paste' role), but this
  // catches any residual browser-level paste events that slip through.
  if (terminal.textarea) {
    terminal.textarea.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  // Intercept terminal shortcuts via the shared helper so local behavior layers on
  // top of main's current shortcut plumbing instead of replacing it.
  terminal.attachCustomKeyEventHandler(createTerminalKeyHandler(sessionId, terminal, window.api, {
    onInput: (data) => handleSessionPromptInput(sessionId, data)
  }));

  terminals.set(sessionId, {
    terminal,
    fitAddon,
    wrapper,
    isSyncingViewport: false,
    pendingViewportRefreshSearch: false
  });
  scheduleTerminalViewportSync(sessionId);
  scheduleSessionPromptGhostRefresh(sessionId, [0, 400]);
}

function switchToSession(sessionId) {
  hideInstructions();

  if (activeSessionId && terminals.has(activeSessionId)) {
    terminals.get(activeSessionId).wrapper.classList.remove('visible');
    updateSessionPromptGhost(activeSessionId);
  }

  activeSessionId = sessionId;
  sessionLastUsed.set(sessionId, Date.now());

  // Ensure sidebar shows the active tab when switching to a session
  if (currentSidebarTab !== 'active') {
    currentSidebarTab = 'active';
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'active'));
  }

  const entry = terminals.get(sessionId);
  if (entry) {
    entry.wrapper.classList.add('visible');
    updateSessionPromptGhost(sessionId);
    scheduleSessionPromptGhostRefresh(sessionId);
    emptyState.classList.add('hidden');
    const currentId = sessionId;
    requestAnimationFrame(() => {
      if (activeSessionId !== currentId) return;
      entry.fitAddon.fit();
      entry.terminal.focus();
      window.api.resizePty(currentId, entry.terminal.cols, entry.terminal.rows);
      syncTerminalViewport(currentId);
      scheduleTerminalViewportSync(currentId, { refreshSearch: true });
      if (!sessionSearch.classList.contains('hidden')) refreshSessionSearch(true);
    });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
  });

  // Scroll the active tab into view
  const activeTab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
  if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

  updateStatusPanel(sessionId);
  patchActiveHighlight();
  patchSessionStateBadges();
  saveTabState();
}

// Lightweight: just toggles .active class on session items without rebuilding DOM
function patchActiveHighlight() {
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.sessionId === activeSessionId);
  });
}

function showHome() {
  if (activeSessionId && terminals.has(activeSessionId)) {
    terminals.get(activeSessionId).wrapper.classList.remove('visible');
    updateSessionPromptGhost(activeSessionId);
  }
  closeSessionSearch({ restoreTerminalFocus: false });
  activeSessionId = null;
  updateSessionPromptGhost(null);
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  emptyState.classList.remove('hidden');
  updateStatusPanel(null);
}

function addTab(sessionId, title) {
  if (document.querySelector(`.tab[data-session-id="${sessionId}"]`)) return;

  const tab = document.createElement('div');
  tab.className = 'tab active';
  tab.dataset.sessionId = sessionId;
  tab.setAttribute('tabindex', '0');
  tab.setAttribute('role', 'tab');

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = title.length > 25 ? title.substring(0, 22) + '...' : title;
  titleSpan.title = title;

  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(sessionId); });

  tab.appendChild(titleSpan);
  tab.appendChild(closeBtn);
  tab.addEventListener('click', () => switchToSession(sessionId));
  tab.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle mouse button
      e.preventDefault();
      closeTab(sessionId);
    }
  });

  tabsScrollArea.appendChild(tab);
  updateTabScrollButtons();
}

function updateTabTitle(sessionId, title) {
  const tab = document.querySelector(`.tab[data-session-id="${sessionId}"] .tab-title`);
  if (!tab) return;
  const display = title.length > 25 ? title.substring(0, 22) + '...' : title;
  if (tab.textContent !== display) {
    tab.textContent = display;
    tab.title = title;
  }
}

function updateTabScrollButtons() {
  const el = tabsScrollArea;
  const overflows = el.scrollWidth > el.clientWidth;
  tabScrollLeft.classList.toggle('visible', overflows && el.scrollLeft > 0);
  tabScrollRight.classList.toggle('visible', overflows && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
}

async function closeTab(sessionId) {
  await window.api.killSession(sessionId);

  // Remember for Ctrl+Shift+T restore
  recentlyClosedSessions.push(sessionId);

  const entry = terminals.get(sessionId);
  if (entry) {
    if (entry.exitTimeout) clearTimeout(entry.exitTimeout);
    if (entry.titlePoll) clearInterval(entry.titlePoll);
    entry.terminal.dispose();
    entry.wrapper.remove();
    terminals.delete(sessionId);
  }
  sessionAliveState.delete(sessionId);
  sessionBusyState.delete(sessionId);
  sessionIdleCount.delete(sessionId);
  sessionLastUsed.delete(sessionId);
  cwdChangingSessions.delete(sessionId);

  // Remove from any tab group
  for (const group of tabGroups) {
    const idx = group.tabIds.indexOf(sessionId);
    if (idx !== -1) {
      group.tabIds.splice(idx, 1);
      if (group.tabIds.length === 0) {
        tabGroups = tabGroups.filter(g => g.id !== group.id);
      }
      break;
    }
  }

  const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
  if (tab) tab.remove();
  updateTabScrollButtons();

  if (activeSessionId === sessionId) {
    activeSessionId = null;
    updateSessionPromptGhost(null);
    const remainingTabs = document.querySelectorAll('.tab');
    if (remainingTabs.length > 0) {
      switchToSession(remainingTabs[remainingTabs.length - 1].dataset.sessionId);
    } else {
      closeSessionSearch({ restoreTerminalFocus: false });
      emptyState.classList.remove('hidden');
      updateStatusPanel(null);
    }
  }

  renderSessionList();
  saveTabState();
}

function updateTabStatus(sessionId, alive) {
  const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
  if (tab) tab.style.opacity = alive ? '1' : '0.5';
}

// ───────────── Session Reordering ─────────────

function ensureSessionOrder() {
  // Build sessionOrder from current active sessions if it's empty or stale
  const activeIds = new Set([...terminals.keys()]);
  // Add any active sessions not yet in sessionOrder
  for (const id of activeIds) {
    if (!sessionOrder.includes(id)) sessionOrder.push(id);
  }
  // Remove closed sessions
  sessionOrder = sessionOrder.filter(id => activeIds.has(id));
}

function handleSessionReorder(draggedId, targetId, insertAbove, targetGroup) {
  ensureSessionOrder();

  // If dragged into a group, add to that group
  const draggedGroup = getGroupForTab(draggedId);
  if (targetGroup && (!draggedGroup || draggedGroup.id !== targetGroup.id)) {
    // Move into target group at the right position within group.tabIds
    if (draggedGroup) {
      draggedGroup.tabIds = draggedGroup.tabIds.filter(id => id !== draggedId);
      if (draggedGroup.tabIds.length === 0) tabGroups = tabGroups.filter(g => g.id !== draggedGroup.id);
    }
    const targetIdx = targetGroup.tabIds.indexOf(targetId);
    const insertIdx = insertAbove ? targetIdx : targetIdx + 1;
    if (!targetGroup.tabIds.includes(draggedId)) {
      targetGroup.tabIds.splice(insertIdx, 0, draggedId);
    }
  } else if (targetGroup && draggedGroup && draggedGroup.id === targetGroup.id) {
    // Reorder within same group
    draggedGroup.tabIds = draggedGroup.tabIds.filter(id => id !== draggedId);
    const targetIdx = draggedGroup.tabIds.indexOf(targetId);
    const insertIdx = insertAbove ? targetIdx : targetIdx + 1;
    draggedGroup.tabIds.splice(insertIdx, 0, draggedId);
  } else if (!targetGroup && draggedGroup) {
    // Dragging out of group to ungrouped area
    draggedGroup.tabIds = draggedGroup.tabIds.filter(id => id !== draggedId);
    if (draggedGroup.tabIds.length === 0) tabGroups = tabGroups.filter(g => g.id !== draggedGroup.id);
  }

  // Update global sessionOrder
  sessionOrder = sessionOrder.filter(id => id !== draggedId);
  const targetIdx = sessionOrder.indexOf(targetId);
  if (targetIdx !== -1) {
    sessionOrder.splice(insertAbove ? targetIdx : targetIdx + 1, 0, draggedId);
  } else {
    sessionOrder.push(draggedId);
  }

  renderSessionList();
  saveTabState();
}

// ───────────── Tab Grouping ─────────────

function generateGroupId() {
  return 'grp-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function getGroupForTab(sessionId) {
  return tabGroups.find(g => g.tabIds.includes(sessionId)) || null;
}

function createGroup(tabIds, name) {
  const color = GROUP_COLORS[nextGroupColorIdx % GROUP_COLORS.length].value;
  nextGroupColorIdx++;
  const group = {
    id: generateGroupId(),
    name: name || `Group ${tabGroups.length + 1}`,
    color,
    collapsed: false,
    tabIds: tabIds || [],
  };
  tabGroups.push(group);
  renderSessionList();
  saveTabState();
  return group;
}

function removeGroup(groupId, closeTabs) {
  const group = tabGroups.find(g => g.id === groupId);
  if (!group) return;
  if (closeTabs) {
    for (const tabId of [...group.tabIds]) {
      closeTab(tabId);
    }
  }
  tabGroups = tabGroups.filter(g => g.id !== groupId);
  renderSessionList();
  saveTabState();
}

function addTabToGroup(sessionId, groupId) {
  // Remove from any existing group first
  for (const g of tabGroups) {
    const idx = g.tabIds.indexOf(sessionId);
    if (idx !== -1) g.tabIds.splice(idx, 1);
  }
  // Clean up empty groups left behind
  tabGroups = tabGroups.filter(g => g.tabIds.length > 0 || g.id === groupId);
  const group = tabGroups.find(g => g.id === groupId);
  if (group && !group.tabIds.includes(sessionId)) {
    group.tabIds.push(sessionId);
    renderSessionList();
    saveTabState();
  }
}

function removeTabFromGroup(sessionId) {
  for (const g of tabGroups) {
    const idx = g.tabIds.indexOf(sessionId);
    if (idx !== -1) {
      g.tabIds.splice(idx, 1);
      if (g.tabIds.length === 0) {
        tabGroups = tabGroups.filter(grp => grp.id !== g.id);
      }
      break;
    }
  }
  renderSessionList();
  saveTabState();
}

function toggleGroupCollapse(groupId) {
  const group = tabGroups.find(g => g.id === groupId);
  if (group) {
    group.collapsed = !group.collapsed;
    renderSessionList();
    saveTabState();
  }
}

// ───────────── Context Menus ─────────────

function hideContextMenu() {
  const existing = document.getElementById('tab-context-menu');
  if (existing) existing.remove();
}

function showContextMenu(x, y, items) {
  hideContextMenu();

  const menu = document.createElement('div');
  menu.id = 'tab-context-menu';
  menu.className = 'context-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      continue;
    }

    if (item.colors) {
      const colorsDiv = document.createElement('div');
      colorsDiv.className = 'context-menu-colors';
      for (const c of GROUP_COLORS) {
        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        if (c.value === item.currentColor) swatch.classList.add('selected');
        swatch.style.background = c.value;
        swatch.title = c.name;
        swatch.addEventListener('click', () => {
          item.onSelect(c.value);
          hideContextMenu();
        });
        colorsDiv.appendChild(swatch);
      }
      menu.appendChild(colorsDiv);
      continue;
    }

    if (item.submenu) {
      const submenuWrapper = document.createElement('div');
      submenuWrapper.className = 'context-menu-submenu';
      const trigger = document.createElement('div');
      trigger.className = 'context-menu-item';
      trigger.textContent = item.label + ' →';
      submenuWrapper.appendChild(trigger);

      const sub = document.createElement('div');
      sub.className = 'context-menu hidden';
      for (const subItem of item.submenu) {
        const subEl = document.createElement('div');
        subEl.className = 'context-menu-item';
        if (subItem.colorDot) {
          const dot = document.createElement('span');
          dot.className = 'color-swatch';
          dot.style.background = subItem.colorDot;
          dot.style.width = '10px';
          dot.style.height = '10px';
          subEl.appendChild(dot);
        }
        const labelSpan = document.createElement('span');
        labelSpan.textContent = subItem.label;
        subEl.appendChild(labelSpan);
        subEl.addEventListener('click', () => {
          subItem.action();
          hideContextMenu();
        });
        sub.appendChild(subEl);
      }
      submenuWrapper.appendChild(sub);
      menu.appendChild(submenuWrapper);
      continue;
    }

    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    el.addEventListener('click', () => {
      item.action();
      hideContextMenu();
    });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);

  // Position, keeping within viewport
  const menuRect = menu.getBoundingClientRect();
  if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
  if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Close on click outside
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      hideContextMenu();
      document.removeEventListener('mousedown', closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 0);
}

function showSessionContextMenu(e, sessionId) {
  if (currentSidebarTab !== 'active') return;
  const group = getGroupForTab(sessionId);
  const items = [];

  items.push({
    label: 'Rename',
    action: () => {
      const el = sessionList.querySelector(`.session-item[data-session-id="${sessionId}"] .session-title`);
      if (el) startRenameSession(sessionId, el);
    },
  });

  items.push({
    label: 'Add to new group',
    action: () => {
      if (group) removeTabFromGroupSilent(sessionId);
      createGroup([sessionId]);
    },
  });

  const otherGroups = tabGroups.filter(g => !group || g.id !== group.id);
  if (otherGroups.length > 0) {
    items.push({
      label: 'Move to group',
      submenu: otherGroups.map(g => ({
        label: g.name,
        colorDot: g.color,
        action: () => addTabToGroup(sessionId, g.id),
      })),
    });
  }

  if (group) {
    items.push({
      label: 'Remove from group',
      action: () => removeTabFromGroup(sessionId),
    });
  }

  showContextMenu(e.clientX, e.clientY, items);
}

function startGroupRename(group) {
  const header = sessionList.querySelector(`.session-group-header[data-group-id="${group.id}"]`);
  if (!header) return;
  const nameSpan = header.querySelector('.session-group-name');
  nameSpan.setAttribute('contenteditable', 'true');
  nameSpan.focus();
  const range = document.createRange();
  range.selectNodeContents(nameSpan);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finishRename = () => {
    nameSpan.setAttribute('contenteditable', 'false');
    let newName = nameSpan.textContent.trim().substring(0, 50);
    if (newName) group.name = newName;
    else nameSpan.textContent = group.name;
    saveTabState();
    renderSessionList();
    nameSpan.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finishRename(); }
    if (ev.key === 'Escape') { nameSpan.textContent = group.name; finishRename(); }
  };
  nameSpan.addEventListener('blur', finishRename);
  nameSpan.addEventListener('keydown', onKey);
}

function showGroupContextMenu(e, groupId) {
  const group = tabGroups.find(g => g.id === groupId);
  if (!group) return;

  const items = [
    {
      label: 'Rename group',
      action: () => startGroupRename(group),
    },
    {
      label: 'Change color',
      colors: true,
      currentColor: group.color,
      onSelect: (color) => {
        group.color = color;
        renderSessionList();
        saveTabState();
      },
    },
    { separator: true },
    {
      label: 'Ungroup',
      action: () => removeGroup(groupId, false),
    },
    {
      label: 'Close group',
      action: () => removeGroup(groupId, true),
    },
  ];

  showContextMenu(e.clientX, e.clientY, items);
}

function removeTabFromGroupSilent(sessionId) {
  for (const g of tabGroups) {
    const idx = g.tabIds.indexOf(sessionId);
    if (idx !== -1) {
      g.tabIds.splice(idx, 1);
      if (g.tabIds.length === 0) {
        tabGroups = tabGroups.filter(grp => grp.id !== g.id);
      }
      break;
    }
  }
}

// Status panel
function toggleStatusPanel() {
  const collapsed = statusPanel.classList.toggle('collapsed');
  btnToggleStatus.classList.toggle('active', !collapsed);
  if (!collapsed && activeSessionId) updateStatusPanel(activeSessionId);
  // Refit terminal once the CSS width transition actually finishes
  let fitted = false;
  statusPanel.addEventListener('transitionend', function onEnd(e) {
    if (e.propertyName === 'width') {
      statusPanel.removeEventListener('transitionend', onEnd);
      fitted = true;
      fitActiveTerminal();
    }
  });
  // Fallback if transitionend doesn't fire (e.g. transition disabled or instant)
  setTimeout(() => { if (!fitted) fitActiveTerminal(); }, 350);
}

// Section expand/collapse state
let statusSectionState = {};

function loadStatusSectionState() {
  try {
    const settings = window._cachedSettings || {};
    statusSectionState = settings.statusPanelSections || {
      summary: true, nextSteps: false, prs: false, workitems: false,
      files: false, pipelines: false, timeline: false
    };
  } catch { /* defaults above */ }
}

function saveStatusSectionState() {
  window.api.updateSettings({ statusPanelSections: statusSectionState });
}

function toggleStatusSection(sectionKey, el) {
  const expanded = el.classList.toggle('expanded');
  statusSectionState[sectionKey] = expanded;
  saveStatusSectionState();
}

function renderStatusSection(key, icon, title, badge, contentHtml) {
  if (!contentHtml) return '';
  const expanded = statusSectionState[key] ? 'expanded' : '';
  return `<div class="status-section ${expanded}" data-section="${key}">
    <div class="status-section-header">
      <span class="status-section-icon">${icon}</span>
      <span class="status-section-title">${escapeHtml(title)}</span>
      ${badge ? `<span class="status-section-badge">${escapeHtml(String(badge))}</span>` : ''}
      <span class="status-section-chevron">▶</span>
    </div>
    <div class="status-section-content">${contentHtml}</div>
  </div>
  <div class="status-divider"></div>`;
}

function renderResourceItems(resources) {
  const ICONS = {
    pr: ['PR', 'status-resource-icon-pr'],
    workitem: ['WI', 'status-resource-icon-wi'],
    pipeline: ['Build', 'status-resource-icon-pipeline'],
    release: ['Rel', 'status-resource-icon-release'],
    repo: ['Repo', 'status-resource-icon-repo'],
    wiki: ['Wiki', 'status-resource-icon-wiki'],
    link: ['🔗', 'status-resource-icon-link'],
  };

  return resources.map(r => {
    const [iconText, iconClass] = ICONS[r.type] || ['·', ''];
    let label = '';
    if (r.type === 'pr') {
      const stateTag = r.state ? ` <span class="status-pr-state status-pr-${r.state}">${r.state}</span>` : '';
      label = `<span class="status-resource-id">${escapeHtml(r.id)}</span> ${r.repo ? escapeHtml(r.repo) : ''}${stateTag}`;
    } else if (r.type === 'workitem') {
      label = `<span class="status-resource-id">${escapeHtml(r.id)}</span>`;
    } else if (r.type === 'pipeline') {
      const displayId = r.id.startsWith('def-') ? `Def ${r.id.slice(4)}` : `#${r.id}`;
      label = `<span class="status-resource-id">${escapeHtml(displayId)}</span>`;
    } else if (r.type === 'release') {
      label = `<span class="status-resource-id">#${escapeHtml(r.id)}</span>`;
    } else if (r.type === 'repo') {
      label = escapeHtml(r.name || r.url);
    } else if (r.type === 'wiki') {
      try { label = escapeHtml(decodeURIComponent(r.url.split('/').pop() || r.url)); }
      catch { label = escapeHtml(r.url.split('/').pop() || r.url); }
    } else {
      label = escapeHtml(r.name || r.url || '');
    }

    const url = r.url || '#';
    return `<div class="status-resource-item" data-url="${escapeHtml(url)}">
      <span class="status-resource-icon ${iconClass}">${escapeHtml(iconText)}</span>
      <span class="status-resource-details">${label}</span>
    </div>`;
  }).join('');
}

async function updateStatusPanel(sessionId) {
  if (statusPanel.classList.contains('collapsed')) return;
  loadStatusSectionState();

  if (!sessionId) {
    statusPanelBody.innerHTML = '<div class="status-empty">Open a session to see its status</div>';
    return;
  }

  // Fetch status data and resources in parallel
  const [statusData, session] = await Promise.all([
    window.api.getSessionStatus(sessionId).catch(() => null),
    Promise.resolve(allSessions.find(s => s.id === sessionId)),
  ]);

  const resources = session?.resources || [];
  const status = statusData || { intent: null, summary: null, nextSteps: [], files: [], timeline: [] };

  let html = '';

  // Current intent
  if (status.intent) {
    html += `<div class="status-intent">
      <div class="status-intent-pulse"></div>
      <span class="status-intent-text">${escapeHtml(status.intent)}</span>
    </div>`;
  }

  // Summary section
  const summaryText = status.summary?.text
    ? `<div class="status-summary-text">${escapeHtml(status.summary.text)}</div>`
    : '<div class="status-summary-empty">No summary yet for this session.</div>';
  const summaryMeta = `<div class="status-summary-meta">
      <span class="status-summary-id" title="${escapeHtml(sessionId)}">
        <span class="status-summary-id-label">🆔 Session ID</span>
        <code>${escapeHtml(sessionId)}</code>
      </span>
      <button class="status-copy-session-id" type="button" data-session-id="${escapeHtml(sessionId)}" title="Copy session ID">Copy</button>
    </div>`;
  html += renderStatusSection('summary', '📝', 'Summary', null, `${summaryText}${summaryMeta}`);

  // Next steps
  if (status.nextSteps.length > 0) {
    const total = status.nextSteps.length;
    const doneCount = status.nextSteps.filter(s => s.done).length;
    const remaining = total - doneCount;
    const stepsHtml = status.nextSteps.map((step, i) => {
      const cls = step.done ? 'done' : step.current ? 'current' : '';
      const num = step.done ? '✓' : String(i + 1);
      return `<div class="status-step ${cls}">
        <span class="status-step-num">${num}</span>
        <span class="status-step-text">${escapeHtml(step.text)}</span>
      </div>`;
    }).join('');
    // Show badge only when there's a mix of done/pending (i.e. progress is meaningful)
    const badge = doneCount > 0 && remaining > 0 ? `${remaining} remaining` : remaining > 0 ? `${total} steps` : 'done';
    html += renderStatusSection('nextSteps', '🎯', 'Next Steps', badge, stepsHtml);
  }

  // Pull requests
  const prs = resources.filter(r => r.type === 'pr');
  if (prs.length > 0) {
    html += renderStatusSection('prs', '⤴', 'Pull Requests', prs.length, renderResourceItems(prs));
  }

  // Work items
  const wis = resources.filter(r => r.type === 'workitem');
  if (wis.length > 0) {
    html += renderStatusSection('workitems', '📌', 'Work Items', wis.length, renderResourceItems(wis));
  }

  // Files changed
  if (status.files.length > 0) {
    const filesHtml = status.files.map(f => {
      const badgeCls = f.action === 'A' ? 'status-file-added' : 'status-file-modified';
      return `<div class="status-file-item">
        <span class="status-file-badge ${badgeCls}">${f.action}</span>
        <span class="status-file-path">${escapeHtml(f.path)}</span>
      </div>`;
    }).join('');
    html += renderStatusSection('files', '📂', 'Files Changed', status.files.length, filesHtml);
  }

  // Pipelines, releases, repos, wikis, links
  const otherResources = resources.filter(r => !['pr', 'workitem'].includes(r.type));
  if (otherResources.length > 0) {
    html += renderStatusSection('pipelines', '🔗', 'Resources', otherResources.length, renderResourceItems(otherResources));
  }

  // Timeline
  if (status.timeline.length > 0) {
    const DOT_COLORS = {
      start: 'var(--text-dim)', resume: 'var(--text-dim)', user: 'var(--accent)',
      plan: 'var(--yellow)', agent: 'var(--mauve)',
    };
    const timelineHtml = status.timeline.map(ev => {
      const time = new Date(ev.time);
      const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      const color = DOT_COLORS[ev.type] || 'var(--text-dim)';
      return `<div class="status-timeline-item">
        <span class="status-timeline-time">${hhmm}</span>
        <div class="status-timeline-dot" style="background:${color}"></div>
        <span class="status-timeline-text">${escapeHtml(ev.text)}</span>
      </div>`;
    }).join('');
    html += renderStatusSection('timeline', '🕐', 'Timeline', null, timelineHtml);
  }

  if (!html) {
    html = '<div class="status-empty">No status data yet for this session</div>';
  }

  statusPanelBody.innerHTML = html;

  // Wire section expand/collapse
  statusPanelBody.querySelectorAll('.status-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.status-section');
      const key = section.dataset.section;
      toggleStatusSection(key, section);
    });
  });

  // Wire resource item clicks → open in external browser
  statusPanelBody.querySelectorAll('.status-resource-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      if (url && url !== '#') window.api.openExternal(url);
    });
  });
}

function fitActiveTerminal() {
  if (activeSessionId && terminals.has(activeSessionId)) {
    const entry = terminals.get(activeSessionId);
    entry.fitAddon.fit();
    window.api.resizePty(activeSessionId, entry.terminal.cols, entry.terminal.rows);
    // Force viewport scroll area sync even when fit() is a no-op (same cols/rows).
    syncTerminalViewport(activeSessionId);
    // Reset any horizontal scroll offset that xterm's viewport may have retained
    // from a wider column count (e.g. when status panel opens and narrows the container).
    const viewport = entry.terminal.element?.querySelector('.xterm-viewport');
    if (viewport) viewport.scrollLeft = 0;
    const screen = entry.terminal.element?.querySelector('.xterm-screen');
    if (screen) screen.style.width = '';
    scheduleTerminalViewportSync(activeSessionId, { refreshSearch: true });
  }
}

// Instructions panel
async function showInstructions() {
  const content = await window.api.readInstructions();
  originalInstructions = content;
  currentInstructions = content;

  renderMarkdown(content);

  instructionsPanel.classList.remove('hidden');
  terminalArea.style.display = 'none';
}

function renderMarkdown(md, changedLineNumbers) {
  const changedSet = new Set(changedLineNumbers || []);
  const lines = md.replace(/\r\n/g, '\n').split('\n');

  // First pass: collect headers for TOC
  const headers = [];
  let inCB = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { inCB = !inCB; continue; }
    if (inCB) continue;
    const m3 = lines[i].match(/^(#{1,3}) (.+)$/);
    if (m3) {
      const level = m3[1].length;
      const text = m3[2].replace(/\*\*/g, '').replace(/\*/g, '');
      const id = 'sec-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      headers.push({ level, text, id, lineNum: i });
    }
  }

  // Build TOC
  let toc = '<nav class="instructions-toc"><div class="toc-title">Contents</div><ul>';
  for (const h of headers) {
    const indent = h.level === 1 ? '' : h.level === 2 ? 'toc-l2' : 'toc-l3';
    toc += `<li class="${indent}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
  }
  toc += '</ul></nav>';

  // Second pass: render content grouped into collapsible sections
  // Each h1/h2 starts a new <details> section; h3 stays inside the current one
  let html = toc;
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockStartLine = -1;
  let listItems = [];
  let openDetails = 0; // nesting depth of open <details>

  function flushList() {
    if (listItems.length === 0) return;
    const anyChanged = listItems.some(li => changedSet.has(li.lineNum));
    const cls = anyChanged ? ' class="changed-line"' : '';
    html += `<ul${cls}>` + listItems.map(li => `<li>${processInline(li.text)}</li>`).join('') + '</ul>';
    listItems = [];
  }

  function processInline(text) {
    const codeSpans = [];
    text = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, (match, code) => {
        codeSpans.push(`<code>${code}</code>`);
        return `\x00CODE${codeSpans.length - 1}\x00`;
      })
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\x00CODE(\d+)\x00/g, (_, i) => codeSpans[parseInt(i)]);
    return text;
  }

  function closeOpenDetails() {
    flushList();
    while (openDetails > 0) { html += '</div></details>'; openDetails--; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const changed = changedSet.has(i);
    const cls = changed ? ' class="changed-line"' : '';

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const anyChanged = changedSet.has(codeBlockStartLine) || changedSet.has(i);
        const ccls = anyChanged ? ' class="changed-line"' : '';
        html += `<pre${ccls}><code>${codeBlockContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()}</code></pre>`;
        inCodeBlock = false;
        codeBlockContent = '';
      } else {
        flushList();
        inCodeBlock = true;
        codeBlockStartLine = i;
        codeBlockContent = '';
      }
      continue;
    }
    if (inCodeBlock) { codeBlockContent += line + '\n'; continue; }

    // List items
    if (/^[-*] /.test(line)) {
      listItems.push({ text: line.replace(/^[-*] /, ''), lineNum: i });
      continue;
    } else {
      flushList();
    }

    // Empty line
    if (line.trim() === '') { html += '\n'; continue; }

    // Headers — h1/h2 start collapsible sections
    const headerInfo = headers.find(h => h.lineNum === i);
    if (headerInfo) {
      if (headerInfo.level <= 2) {
        closeOpenDetails();
        const tag = headerInfo.level === 1 ? 'h1' : 'h2';
        html += `<details class="section-collapse" open><summary${cls}><${tag} id="${headerInfo.id}">${processInline(headerInfo.text)}</${tag}></summary><div class="section-body">`;
        openDetails++;
      } else {
        flushList();
        html += `<h3 id="${headerInfo.id}"${cls}>${processInline(headerInfo.text)}</h3>`;
      }
      continue;
    }

    // HR
    if (/^---+$/.test(line)) { html += '<hr>'; continue; }

    // Blockquote
    if (line.startsWith('> ')) { html += `<blockquote${cls}>${processInline(line.slice(2))}</blockquote>`; continue; }

    // Table rows
    if (line.startsWith('|') && line.endsWith('|')) {
      let tableRows = [{ line, lineNum: i }];
      while (i + 1 < lines.length && lines[i + 1].startsWith('|') && lines[i + 1].endsWith('|')) {
        i++;
        tableRows.push({ line: lines[i], lineNum: i });
      }
      const anyChanged = tableRows.some(r => changedSet.has(r.lineNum));
      const tcls = anyChanged ? ' class="changed-line"' : '';
      let table = `<table${tcls}>`;
      tableRows.forEach((row, ri) => {
        const cells = row.line.split('|').filter(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c.trim()))) return;
        const tag = ri === 0 ? 'th' : 'td';
        table += '<tr>' + cells.map(c => `<${tag}>${processInline(c.trim())}</${tag}>`).join('') + '</tr>';
      });
      table += '</table>';
      html += table;
      continue;
    }

    // Paragraph
    html += `<p${cls}>${processInline(line)}</p>`;
  }
  closeOpenDetails();

  instructionsRendered.innerHTML = html;

  // TOC click — smooth scroll
  instructionsRendered.querySelectorAll('.instructions-toc a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.getAttribute('href').slice(1);
      const target = instructionsRendered.querySelector('#' + id);
      if (target) {
        // Make sure parent details is open
        const details = target.closest('details');
        if (details && !details.open) details.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Fade out change highlights — handled by CSS animation now
}

function hideInstructions() {
  instructionsPanel.classList.add('hidden');
  terminalArea.style.display = '';
}

// Import/export instructions
async function exportInstructions() {
  const content = currentInstructions || await window.api.readInstructions();
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'copilot-instructions.md';
  a.click();
  URL.revokeObjectURL(url);
}

function importInstructions(mode) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.txt,.markdown';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();

    if (mode === 'override') {
      currentInstructions = text;
      await window.api.writeInstructions(text);
      renderMarkdown(text);
    } else {
      // Merge — append non-duplicate lines
      const existingLines = new Set(
        currentInstructions.split('\n')
          .map(l => l.trim())
          .filter(l => l && l !== '---' && !l.match(/^#{1,6}\s/) && l !== '```')
      );
      const newLines = text.split('\n');
      const toAdd = [];
      newLines.forEach(line => {
        if (line.trim() && !existingLines.has(line.trim())) {
          toAdd.push(line);
        }
      });
      if (toAdd.length > 0) {
        const merged = currentInstructions.trimEnd() + '\n\n' + toAdd.join('\n') + '\n';
        currentInstructions = merged;
        await window.api.writeInstructions(merged);
        renderMarkdown(merged);
      }
    }
  });
  input.click();
}

btnInstructions.addEventListener('click', showInstructions);
btnCloseInstructions.addEventListener('click', hideInstructions);

// Import/export
document.getElementById('btn-export-instructions').addEventListener('click', exportInstructions);
document.getElementById('btn-import-instructions').addEventListener('click', () => {
  showImportMenu();
});

function showImportMenu() {
  // Remove existing menu if any
  document.querySelectorAll('.import-menu').forEach(el => el.remove());

  const btn = document.getElementById('btn-import-instructions');
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'import-menu';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.innerHTML = `
    <button class="import-menu-item" data-mode="merge">
      <span class="import-menu-icon">+</span>
      <span><strong>Merge</strong><br><span class="import-menu-desc">Add new lines, keep existing</span></span>
    </button>
    <button class="import-menu-item" data-mode="override">
      <span class="import-menu-icon">↻</span>
      <span><strong>Override</strong><br><span class="import-menu-desc">Replace everything</span></span>
    </button>
  `;
  document.body.appendChild(menu);

  menu.querySelectorAll('.import-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      importInstructions(item.dataset.mode);
      menu.remove();
    });
  });

  // Close on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.remove();
      document.removeEventListener('click', closeMenu, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
}

// Date helpers
function getDateLabel(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function shortenPath(p) {
  if (!p) return '';
  const sep = p.includes('/') ? '/' : '\\';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 2) return p;
  // Show drive/root + ... + last folder
  return parts[0] + sep + '…' + sep + parts[parts.length - 1];
}


// Sidebar resize
const resizeHandle = document.getElementById('resize-handle');
const sidebar = document.getElementById('sidebar');
let isResizing = false;
let resizeStartX = 0;
let resizeDidDrag = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeStartX = e.clientX;
  resizeDidDrag = false;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  if (!resizeDidDrag && Math.abs(e.clientX - resizeStartX) > 3) resizeDidDrag = true;
  if (!resizeDidDrag) return;
  // Un-hide on drag
  if (sidebarHidden) {
    sidebarHidden = false;
    sidebarCollapsed = false;
    syncSidebarCollapsedUi();
    renderSessionList();
  }

  const nextSidebarState = resolveSidebarDragWidth(e.clientX, {
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH
  });

  if (nextSidebarState.mode === 'collapsed') {
    // Dragged narrow enough → snap into collapsed icon mode.
    setSidebarCollapsed(true, { persist: false });
  } else {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false, { persist: false });
    }
    sidebar.style.width = nextSidebarState.width + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (!resizeDidDrag) {
      // Click → toggle full hide
      sidebarHidden = !sidebarHidden;
      if (sidebarHidden) sidebarCollapsed = false;
      syncSidebarCollapsedUi();
      if (window._cachedSettings) window._cachedSettings.sidebarCollapsed = sidebarHidden;
      window.api.updateSettings({ sidebarCollapsed: sidebarHidden });
      renderSessionList();
    } else {
      const width = parseInt(sidebar.style.width, 10);
      if (sidebarCollapsed) {
        if (window._cachedSettings) window._cachedSettings.sidebarCollapsed = false;
        window.api.updateSettings({ sidebarCollapsed: false });
      } else if (width) {
        persistSidebarWidth(width);
        if (window._cachedSettings) window._cachedSettings.sidebarCollapsed = false;
        window.api.updateSettings({ sidebarCollapsed: false });
      }
    }

    fitActiveTerminal();
  }
});

// Events
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  searchClear.classList.toggle('hidden', !searchQuery);
  queueSidebarSearch(searchQuery);
  renderSessionList();
});
searchInput.addEventListener('focus', () => {
  document.getElementById('search-wrapper').classList.add('search-active');
});
searchInput.addEventListener('blur', () => {
  document.getElementById('search-wrapper').classList.remove('search-active');
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.add('hidden');
  queueSidebarSearch('');
  renderSessionList();
  searchInput.focus();
});
sidebarSearchToggle.addEventListener('click', () => focusSidebarSearch());
sessionSearchInput.addEventListener('input', () => {
  refreshSessionSearch(false);
});
sessionSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    stepSessionSearch(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSessionSearch();
  }
});
sessionSearchPrev.addEventListener('click', () => stepSessionSearch(-1));
sessionSearchNext.addEventListener('click', () => stepSessionSearch(1));
sessionSearchClose.addEventListener('click', () => closeSessionSearch());
btnNew.addEventListener('click', newSession);
if (btnNewCenter) btnNewCenter.addEventListener('click', newSession);

maxConcurrentInput.addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val >= 1 && val <= 20) window.api.updateSettings({ maxConcurrent: val });
});

promptWorkdirInput.addEventListener('change', (e) => {
  window.api.updateSettings({ promptForWorkdir: e.target.checked });
});

btnPickDefaultWorkdir.addEventListener('click', async () => {
  const current = defaultWorkdirInput.value || undefined;
  const picked = await window.api.pickDirectory(current);
  if (picked) {
    defaultWorkdirInput.value = picked;
    window.api.updateSettings({ defaultWorkdir: picked });
  }
});

btnClearDefaultWorkdir.addEventListener('click', () => {
  defaultWorkdirInput.value = '';
  window.api.updateSettings({ defaultWorkdir: '' });
});

// Notification functions
async function toggleNotificationPanel() {
  const wasHidden = notificationPanel.classList.contains('hidden');
  notificationPanel.classList.toggle('hidden');
  if (wasHidden) {
    await window.api.markAllNotificationsRead();
    await refreshNotifications();
  }
}

function toggleFeedbackPanel() {
  // removed
}

async function openFeedbackIssue(type) {
  // removed
}

async function refreshNotifications() {
  const notifications = await window.api.getNotifications();
  const unread = notifications.filter(n => !n.read).length;

  // Update badge
  if (unread > 0) {
    notificationBadge.textContent = unread > 99 ? '99+' : unread;
    notificationBadge.classList.remove('hidden');
  } else {
    notificationBadge.classList.add('hidden');
  }

  // Update dropdown list
  if (notifications.length === 0) {
    notificationListEl.innerHTML = '<div class="notification-empty">No notifications</div>';
    return;
  }

  notificationListEl.innerHTML = notifications
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map(n => {
      const icon = NOTIF_ICONS[n.type] || 'ℹ️';
      const cls = n.read ? '' : ' unread';
      const time = formatNotifTime(n.timestamp);
      return `<div class="notification-item${cls}" data-id="${n.id}" data-session="${escapeHtml(n.sessionId || '')}">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="notification-body">${escapeHtml(n.body)}</div>` : ''}
          <div class="notification-time">${time}</div>
        </div>
        <button class="notification-dismiss" data-dismiss="${n.id}" title="Dismiss">✕</button>
      </div>`;
    }).join('');

  // Wire up click handlers
  notificationListEl.querySelectorAll('.notification-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.notification-dismiss')) return;
      const id = parseInt(el.dataset.id);
      const sessionId = el.dataset.session;
      await window.api.markNotificationRead(id);
      notificationPanel.classList.add('hidden');
      if (sessionId) await openSession(sessionId);
      refreshNotifications();
    });
  });

  notificationListEl.querySelectorAll('.notification-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.dismiss);
      await window.api.dismissNotification(id);
      refreshNotifications();
    });
  });
}

function formatNotifTime(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function showToast(notification) {
  const icon = NOTIF_ICONS[notification.type] || 'ℹ️';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(notification.title)}</div>
      ${notification.body ? `<div class="toast-body">${escapeHtml(notification.body)}</div>` : ''}
    </div>`;

  toast.addEventListener('click', async () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
    if (notification.sessionId) await openSession(notification.sessionId);
  });

  toastContainer.appendChild(toast);

  // Auto-dismiss after 6 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);
}

// Zoom — refit all terminals after the zoom factor changes
async function applyZoom(direction) {
  await window.api.setZoom(direction);
  syncTitlebarPadding();
  // Small delay lets Electron apply the new factor before we refit
  setTimeout(() => {
    for (const { terminal, fitAddon } of terminals.values()) {
      try { fitAddon.fit(); } catch {}
      try { terminal.scrollToBottom(); } catch {}
    }
  }, 100);
}

// Ctrl+Scroll zoom
document.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  applyZoom(e.deltaY < 0 ? 'in' : 'out');
}, { passive: false });

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl/Cmd+N or Ctrl/Cmd+T: Create new session from anywhere
  if (mod && (e.key === 'n' || e.key === 't')) { 
    e.preventDefault(); 
    newSession(); 
  }

  // Zoom: Ctrl/Cmd + '+'/'-'/'0'
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom('in'); return; }
  if (mod && e.key === '-') { e.preventDefault(); applyZoom('out'); return; }
  if (mod && e.key === '0') { e.preventDefault(); applyZoom('reset'); return; }

  // Ctrl/Cmd+Tab: Switch between session tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const tabs = [...document.querySelectorAll('.tab')];
    if (tabs.length < 2) return;
    const i = tabs.findIndex(t => t.dataset.sessionId === activeSessionId);
    const next = e.shiftKey ? (i - 1 + tabs.length) % tabs.length : (i + 1) % tabs.length;
    switchToSession(tabs[next].dataset.sessionId);
  }

  // Ctrl/Cmd+W: Close current session tab
  if (mod && e.key === 'w') {
    e.preventDefault();
    const ae = document.activeElement;
    const isXterm = ae?.classList.contains('xterm-helper-textarea');
    if (!isXterm && (ae?.tagName === 'INPUT' || ae?.tagName === 'TEXTAREA')) return;
    if (activeSessionId) closeTab(activeSessionId);
  }

  // Ctrl/Cmd+Shift+T: Restore last closed tab
  if (mod && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    const sessionId = recentlyClosedSessions.pop();
    if (sessionId) openSession(sessionId);
  }

  // Ctrl/Cmd+I: Toggle status panel
  if (mod && e.key === 'i') {
    e.preventDefault();
    toggleStatusPanel();
  }

  // Ctrl/Cmd+F: Open in-session search when a session is active
  if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (activeSessionId && terminals.has(activeSessionId)) openSessionSearch();
    else focusSidebarSearch();
  }

  if (e.key === 'Escape') {
    if (!sessionSearch.classList.contains('hidden')) {
      closeSessionSearch();
      return;
    }
    // Close context menu first if open
    const ctxMenu = document.getElementById('tab-context-menu');
    if (ctxMenu) {
      hideContextMenu();
    } else if (!notificationPanel.classList.contains('hidden')) {
      notificationPanel.classList.add('hidden');
    } else if (!settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    } else if (!instructionsPanel.classList.contains('hidden')) {
      hideInstructions();
    } else if (document.activeElement === searchInput) {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.add('hidden');
      document.getElementById('search-wrapper').classList.remove('search-active');
      renderSessionList();
      if (activeSessionId && terminals.has(activeSessionId)) terminals.get(activeSessionId).terminal.focus();
    }
  }
});

init();
