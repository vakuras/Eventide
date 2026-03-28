/**
 * Tauri Bridge — drop-in replacement for Electron's preload.js.
 *
 * Exposes the same `window.api` interface that renderer.js expects,
 * but routes calls through Tauri's invoke/listen instead of Electron IPC.
 *
 * This file is loaded as a regular ES module in the webview (not a preload script).
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Plugin APIs — accessed lazily to avoid startup errors if plugins load async
const getShellOpen = () => window.__TAURI__?.shell?.open;
const getDialogOpen = () => window.__TAURI__?.dialog?.open;
const getClipboardRead = () => window.__TAURI__?.clipboardManager?.readText;
const getClipboardWrite = () => window.__TAURI__?.clipboardManager?.writeText;

// Zoom state managed in the frontend (Tauri webview doesn't have per-window zoom API)
let currentZoom = 1.0;

window.api = {
  // ── Sessions ──────────────────────────────────────────────
  listSessions: () => invoke('list_sessions'),
  searchSessions: (query) => invoke('search_sessions', { query }),
  getLastUserPrompt: (sessionId) => invoke('get_last_user_prompt', { sessionId }),
  renameSession: (sessionId, title) => invoke('rename_session', { sessionId, title }),
  deleteSession: (sessionId) => invoke('delete_session', { sessionId }),
  addResource: (sessionId, url) => invoke('resource_add', { sessionId, url }),
  removeResource: (sessionId, key) => invoke('resource_remove', { sessionId, key }),
  getSessionStatus: (sessionId) => invoke('get_session_status', { sessionId }),
  openSession: (sessionId) => invoke('open_session', { sessionId }),
  newSession: (cwd) => invoke('new_session', { cwd: cwd || null }),
  killSession: (sessionId) => invoke('kill_pty', { sessionId }),
  pickDirectory: async (defaultPath) => {
    const openDialog = getDialogOpen();
    if (!openDialog) return null;
    const result = await openDialog({
      title: 'Choose working directory',
      defaultPath: defaultPath || undefined,
      directory: true,
      multiple: false,
    });
    return result || null;
  },
  changeCwd: (sessionId, cwd) => invoke('change_cwd', { sessionId, cwd }),

  // ── PTY I/O ───────────────────────────────────────────────
  writePty: (sessionId, data) => invoke('write_pty', { sessionId, data }),
  resizePty: (sessionId, cols, rows) => invoke('resize_pty', { sessionId, cols, rows }),

  onPtyData: (callback) => {
    let unlisten;
    listen('pty:data', (event) => {
      callback(event.payload.sessionId, event.payload.data);
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  },

  onPtyExit: (callback) => {
    let unlisten;
    listen('pty:exit', (event) => {
      callback(event.payload.sessionId, event.payload.exitCode);
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  },

  onPtyEvicted: (callback) => {
    let unlisten;
    listen('pty:evicted', (event) => {
      callback(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  },

  // ── Active sessions ───────────────────────────────────────
  getActiveSessions: () => invoke('get_active_sessions'),

  // ── Settings ──────────────────────────────────────────────
  getSettings: () => invoke('get_settings'),
  updateSettings: (settings) => invoke('update_settings', { partial: settings }),

  // ── Instructions ──────────────────────────────────────────
  readInstructions: () => invoke('read_instructions'),
  writeInstructions: (content) => invoke('write_instructions', { content }),

  // ── Shell ─────────────────────────────────────────────────
  openExternal: (url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      const open = getShellOpen();
      if (open) open(url);
    }
  },

  // ── Zoom (CSS-based in Tauri) ─────────────────────────────
  setZoom: async (direction) => {
    const ZOOM_MIN = 0.75;
    const ZOOM_MAX = 1.5;
    const ZOOM_STEP = 0.05;

    if (direction === 'in') currentZoom = Math.min(currentZoom + ZOOM_STEP, ZOOM_MAX);
    else if (direction === 'out') currentZoom = Math.max(currentZoom - ZOOM_STEP, ZOOM_MIN);
    else if (direction === 'reset') currentZoom = 1.0;
    else currentZoom = Math.min(Math.max(Number(direction) || 1.0, ZOOM_MIN), ZOOM_MAX);

    currentZoom = Math.round(currentZoom * 100) / 100;
    document.body.style.zoom = currentZoom;
    await invoke('update_settings', { partial: { zoomFactor: currentZoom } });
    return currentZoom;
  },

  getZoom: async () => currentZoom,

  // ── Clipboard ─────────────────────────────────────────────
  copyText: (text) => {
    const write = getClipboardWrite();
    return write ? write(text) : Promise.resolve();
  },
  pasteText: () => {
    const read = getClipboardRead();
    return read ? read() : Promise.resolve('');
  },

  // ── App info ──────────────────────────────────────────────
  getVersion: () => invoke('get_app_version'),
  getChangelog: () => invoke('get_app_changelog'),

  // ── Updates (Tauri built-in updater — stubs for now) ──────
  checkForUpdates: () => Promise.resolve(null),
  installUpdate: () => Promise.resolve(),
  getUpdateStatus: () => Promise.resolve({ status: 'not-available' }),
  onUpdateStatus: (callback) => {
    // TODO: Wire up Tauri updater events
    return () => {};
  },

  // ── Notifications ─────────────────────────────────────────
  getNotifications: () => invoke('get_notifications'),
  getUnreadCount: () => invoke('get_unread_count'),
  markNotificationRead: (id) => invoke('mark_notification_read', { id }),
  markAllNotificationsRead: () => invoke('mark_all_notifications_read'),
  dismissNotification: (id) => invoke('dismiss_notification', { id }),
  clearAllNotifications: () => invoke('clear_all_notifications'),

  onNotification: (callback) => {
    let unlisten;
    listen('notification:new', (event) => {
      callback(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  },

  onNotificationClick: (callback) => {
    let unlisten;
    listen('notification:click', (event) => {
      callback(event.payload);
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  },
};

// Restore persisted zoom on load
invoke('get_settings').then(settings => {
  if (settings?.zoomFactor && settings.zoomFactor !== 1.0) {
    currentZoom = settings.zoomFactor;
    document.body.style.zoom = currentZoom;
  }
});
