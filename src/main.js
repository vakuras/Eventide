const { app, BrowserWindow, ipcMain, shell, Menu, dialog, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const SessionService = require('./session-service');
const PtyManager = require('./pty-manager');
const TagIndexer = require('./tag-indexer');
const ResourceIndexer = require('./resource-indexer');
const { parseUrlToResource } = require('./resource-indexer');
const StatusService = require('./status-service');
const SettingsService = require('./settings-service');
const NotificationService = require('./notification-service');
const UpdateService = require('./update-service');

// Prevent Chromium GPU compositing artifacts(rectangular patches of wrong shade on dark backgrounds)
app.commandLine.appendSwitch('disable-gpu-compositing');

let mainWindow;
let updateService;

// Active notification popup windows, used for stacking
let activeNotifWindows = [];
// Maps BrowserWindow.id → notification object for click handling
const notifWindowData = new Map();

function showNotificationPopup(notification) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const NOTIF_WIDTH = 360;
  const NOTIF_HEIGHT = 100; // tall enough for title + body + padding
  const PADDING = 20;
  const STACK_GAP = 8;

  const stackOffset = activeNotifWindows.length * (NOTIF_HEIGHT + STACK_GAP);
  const x = Math.round(workArea.x + workArea.width - NOTIF_WIDTH - PADDING);
  const y = Math.round(workArea.y + workArea.height - NOTIF_HEIGHT - PADDING - stackOffset);

  const notifWin = new BrowserWindow({
    width: NOTIF_WIDTH,
    height: NOTIF_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'notification-popup-preload.js'),
    },
  });

  notifWin.loadFile(path.join(__dirname, 'notification-popup.html'));

  notifWin.webContents.on('did-finish-load', () => {
    const theme = settingsService.get().theme || 'mocha';
    notifWin.webContents.send('notification:show', { ...notification, theme });
    notifWin.showInactive();
  });

  activeNotifWindows.push(notifWin);
  notifWindowData.set(notifWin.id, notification);

  const dismissTimer = setTimeout(() => {
    if (!notifWin.isDestroyed()) notifWin.close();
  }, 6000);

  notifWin.on('closed', () => {
    clearTimeout(dismissTimer);
    activeNotifWindows = activeNotifWindows.filter(w => w !== notifWin);
    notifWindowData.delete(notifWin.id);
  });
}

let sessionService;
let ptyManager;
let tagIndexer;
let resourceIndexer;
let settingsService;
let notificationService;
let statusService;
let ptyFlushTimer = null;

const COPILOT_PATH = resolveCopilotPath();
const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');
const COPILOT_CONFIG_DIR = path.join(os.homedir(), '.copilot');
const NOTIFICATIONS_DIR = path.join(COPILOT_CONFIG_DIR, 'notifications');
const INSTRUCTIONS_PATH = path.join(COPILOT_CONFIG_DIR, 'copilot-instructions.md');

function resolveCopilotPath() {
  const { execSync } = require('child_process');
  // 1. Check PATH for copilot binary (copilot.exe and copilot.cmd on Windows)
  const names = ['copilot.exe', 'copilot.cmd'];
  for (const bin of names) {
    const whichCmd = `where ${bin}`;
    try {
      const result = execSync(whichCmd, { encoding: 'utf8', timeout: 5000 }).trim();
      const firstMatch = result.split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
    } catch {}
  }

  // 2. Known install locations
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'copilot.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'copilot-cli', 'copilot.exe'),
    path.join(process.env.PROGRAMFILES || '', 'GitHub Copilot CLI', 'copilot.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Fall back to bare command name — let the OS resolve it at spawn time
  return bin;
}

function createWindow() {
  const theme = settingsService.get().theme || 'mocha';
  const bg = theme === 'latte' ? '#eff1f5' : '#1e1e2e';
  const fg = theme === 'latte' ? '#4c4f69' : '#cdd6f4';

  const winOptions = {
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'eventide.ico'),
    backgroundColor: bg,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };

  winOptions.titleBarStyle = 'hidden';
  winOptions.titleBarOverlay = { color: bg, symbolColor: fg, height: 36 };

  mainWindow = new BrowserWindow(winOptions);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Restore persisted zoom level
  const zoomFactor = settingsService.get().zoomFactor || 1.0;
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(zoomFactor);
  });

  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(async () => {
  settingsService = new SettingsService(COPILOT_CONFIG_DIR);
  await settingsService.load();

  const copilotExe = settingsService.get().copilotPath || COPILOT_PATH;
  sessionService = new SessionService(SESSION_STATE_DIR);
  ptyManager = new PtyManager(copilotExe, settingsService);

  tagIndexer = new TagIndexer(SESSION_STATE_DIR);
  await tagIndexer.init();

  resourceIndexer = new ResourceIndexer(SESSION_STATE_DIR);
  await resourceIndexer.init();

  statusService = new StatusService(SESSION_STATE_DIR);

  await sessionService.cleanEmptySessions();

  notificationService = new NotificationService(NOTIFICATIONS_DIR);

  // Forward notifications to renderer + show OS notification
  // Registered before .start() so _scanExisting() events aren't dropped (bug #8)
  notificationService.on('notification', (notification) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification:new', notification);
    }

    // Show notification popup pinned to primary display
    showNotificationPopup(notification);
  });

  notificationService.start();

  // Custom menu without 'paste' or 'copy' — xterm's custom key handler owns
  // Ctrl+C / Ctrl+V / Cmd+C / Cmd+V.  The default Electron menu fires
  // webContents.copy()/paste() before keydown reaches the renderer, which
  // interferes with xterm's canvas-based selection model.
  const menuTemplate = [];
  menuTemplate.push(
    { label: 'Edit', submenu: [{ role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }, { role: 'forceReload' }] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  createWindow();

  updateService = new UpdateService(mainWindow, settingsService);
  mainWindow.webContents.on('did-finish-load', () => {
    updateService.checkOnStartup();
  });

  // IPC: Open/resume a session
  ipcMain.handle('session:open', async (event, sessionId) => {
    const cwd = await sessionService.getCwd(sessionId);
    return ptyManager.openSession(sessionId, cwd || undefined);
  });

  // IPC: Start a new session
  ipcMain.handle('session:new', async (event, cwd) => {
    // Try pre-warmed standby for instant startup
    const claimed = ptyManager.claimStandby(cwd || undefined);
    if (claimed) {
      if (cwd) await sessionService.saveCwd(claimed.id, cwd);
      // Flush buffered startup output to renderer
      if (claimed.bufferedData.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:data', {
          sessionId: claimed.id,
          data: claimed.bufferedData.join('')
        });
      }
      scheduleWarmUp();
      return claimed.id;
    }

    // Cold start fallback
    const sessionId = ptyManager.newSession(cwd || undefined);
    if (cwd) {
      await sessionService.saveCwd(sessionId, cwd);
    }
    scheduleWarmUp();
    return sessionId;
  });

  // IPC: Pick a directory (native OS dialog)
  ipcMain.handle('dialog:pickDirectory', async (event, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose working directory',
      defaultPath: defaultPath || os.homedir(),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // IPC: Change working directory of a session (save + kill + respawn)
  const cwdChangingSessions = new Set();
  ipcMain.handle('session:changeCwd', async (event, sessionId, cwd) => {
    await sessionService.saveCwd(sessionId, cwd);
    cwdChangingSessions.add(sessionId);
    ptyManager.kill(sessionId);
    const result = ptyManager.openSession(sessionId, cwd);
    cwdChangingSessions.delete(sessionId);
    return result;
  });

  // IPC: Write to a session's pty
  ipcMain.on('pty:write', (event, { sessionId, data }) => {
    try { ptyManager.write(sessionId, data); } catch {}
  });

  // IPC: Resize a session's pty
  ipcMain.on('pty:resize', (event, { sessionId, cols, rows }) => {
    try { ptyManager.resize(sessionId, cols, rows); } catch {}
  });

  // IPC: Kill a session's pty
  ipcMain.handle('pty:kill', (event, sessionId) => {
    ptyManager.kill(sessionId);
  });

  // IPC: Get settings
  ipcMain.handle('settings:get', () => {
    return settingsService.get();
  });

  // IPC: Update settings
  ipcMain.handle('settings:update', async (event, partial) => {
    const updated = await settingsService.update(partial);
    ptyManager.updateSettings(updated);

    // Update window chrome for theme changes
    if (partial.theme && mainWindow && !mainWindow.isDestroyed()) {
      const bg = partial.theme === 'latte' ? '#eff1f5' : '#1e1e2e';
      const fg = partial.theme === 'latte' ? '#4c4f69' : '#cdd6f4';
      mainWindow.setTitleBarOverlay({ color: bg, symbolColor: fg });
      mainWindow.setBackgroundColor(bg);
    }

    return updated;
  });

  // IPC: Zoom
  const ZOOM_MIN = 0.75;
  const ZOOM_MAX = 1.5;
  const ZOOM_STEP = 0.05;

  ipcMain.handle('zoom:get', () => mainWindow.webContents.getZoomFactor());

  ipcMain.handle('zoom:set', async (event, direction) => {
    const current = mainWindow.webContents.getZoomFactor();
    let next;
    if (direction === 'in') next = Math.min(current + ZOOM_STEP, ZOOM_MAX);
    else if (direction === 'out') next = Math.max(current - ZOOM_STEP, ZOOM_MIN);
    else if (direction === 'reset') next = 1.0;
    else next = Math.min(Math.max(Number(direction) || 1.0, ZOOM_MIN), ZOOM_MAX);
    next = Math.round(next * 100) / 100;
    mainWindow.webContents.setZoomFactor(next);
    await settingsService.update({ zoomFactor: next });
    return next;
  });

  // IPC: Get active sessions
  ipcMain.handle('pty:active', () => {
    return ptyManager.getActiveSessions();
  });

  // IPC: Read instructions file
  ipcMain.handle('instructions:read', async () => {
    try {
      return await fs.promises.readFile(INSTRUCTIONS_PATH, 'utf8');
    } catch {
      return '';
    }
  });

  // IPC: Write instructions file
  ipcMain.handle('instructions:write', async (event, content) => {
    await fs.promises.writeFile(INSTRUCTIONS_PATH, content, 'utf8');
  });

  // IPC: Clipboard (main process owns clipboard — not available in sandboxed preloads)
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_, text) => clipboard.writeText(text));

  // IPC: Open external URL
  ipcMain.handle('shell:openExternal', (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });

  // IPC: Notifications
  ipcMain.handle('notifications:getAll', () => notificationService.getAll());
  ipcMain.handle('notifications:getUnreadCount', () => notificationService.getUnreadCount());
  ipcMain.handle('notifications:markRead', (event, id) => notificationService.markRead(id));
  ipcMain.handle('notifications:markAllRead', () => notificationService.markAllRead());
  ipcMain.handle('notifications:dismiss', (event, id) => notificationService.dismiss(id));
  ipcMain.handle('notifications:clearAll', () => notificationService.clearAll());

  // IPC: Notification popup interactions
  ipcMain.on('notification-popup:click', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const notification = win ? notifWindowData.get(win.id) : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      if (notification?.sessionId) {
        mainWindow.webContents.send('notification:click', notification);
      }
    }
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.on('notification-popup:dismiss', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // IPC: App info
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getChangelog', () => {
    try {
      return fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf-8');
    } catch { return ''; }
  });

  // Auto-notify on session exit
  ptyManager.on('exit', (sessionId, exitCode) => {
    // Suppress exit handling during cwd change (session will be respawned)
    if (cwdChangingSessions.has(sessionId)) return;

    // Flush any remaining buffered data before signalling exit
    if (ptyDataBuffers.has(sessionId) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:data', { sessionId, data: ptyDataBuffers.get(sessionId).join('') });
      ptyDataBuffers.delete(sessionId);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', { sessionId, exitCode });
    }
    // Push a notification for session exit
    const session = allSessionsCache.find(s => s.id === sessionId);
    const title = session?.title || sessionId.substring(0, 8);
    notificationService.push({
      type: exitCode === 0 ? 'task-done' : 'error',
      title: exitCode === 0 ? `Session ended: ${title}` : `Session error: ${title}`,
      body: `Exited with code ${exitCode}`,
      sessionId,
    });
  });

  ptyManager.on('evicted', (sessionId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:evicted', sessionId);
    }
  });

  let allSessionsCache = [];
  const sessionMatchesSidebarSearch = (session, query) => {
    if (session.title?.toLowerCase().includes(query)) return true;
    if (session.cwd?.toLowerCase().includes(query)) return true;
    if (session.tags?.some(tag => tag.toLowerCase().includes(query))) return true;
    if (session.resources?.some(resource =>
      String(resource.id || '').toLowerCase().includes(query) ||
      String(resource.url || '').toLowerCase().includes(query) ||
      String(resource.name || '').toLowerCase().includes(query) ||
      String(resource.repo || '').toLowerCase().includes(query)
    )) {
      return true;
    }
    return false;
  };

  const hydrateSessionsCache = async () => {
    const sessions = await sessionService.listSessions();
    allSessionsCache = sessions.map(s => ({
      ...s,
      tags: tagIndexer.getTagsForSession(s.id),
      resources: resourceIndexer.getResourcesForSession(s.id)
    }));
    return allSessionsCache;
  };

  // IPC: Get session list (with tags and resources) — also caches for notification titles
  ipcMain.handle('sessions:list', hydrateSessionsCache);

  ipcMain.handle('sessions:search', async (event, query) => {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];

    const [sessions, contentMatches] = await Promise.all([
      hydrateSessionsCache(),
      sessionService.searchSessions(needle)
    ]);
    const contentMatchIds = new Set(contentMatches.map(match => match.id));

    return sessions
      .filter(session => contentMatchIds.has(session.id) || sessionMatchesSidebarSearch(session, needle));
  });

  ipcMain.handle('session:getLastUserPrompt', async (event, sessionId) => {
    return sessionService.getLastUserPrompt(sessionId);
  });

  ipcMain.handle('session:rename', async (event, sessionId, title) => {
    await sessionService.renameSession(sessionId, title);
  });

  ipcMain.handle('session:delete', async (event, sessionId) => {
    ptyManager.kill(sessionId);
    await sessionService.deleteSession(sessionId);
  });

  ipcMain.handle('resource:add', async (event, sessionId, url) => {
    const resource = parseUrlToResource(url);
    return resourceIndexer.addManualResource(sessionId, resource);
  });

  ipcMain.handle('resource:remove', async (event, sessionId, key) => {
    await resourceIndexer.removeResource(sessionId, key);
  });

  // IPC: Get session status (intent, summary, plan, timeline, files)
  ipcMain.handle('session:getStatus', async (event, sessionId) => {
    return statusService.getSessionStatus(sessionId);
  });

  // Forward pty output to renderer — batch at 16ms intervals to prevent IPC flooding
  const ptyDataBuffers = new Map(); // sessionId -> string[]

  function flushPtyData() {
    ptyFlushTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      ptyDataBuffers.clear();
      return;
    }
    for (const [sessionId, chunks] of ptyDataBuffers) {
      mainWindow.webContents.send('pty:data', { sessionId, data: chunks.join('') });
    }
    ptyDataBuffers.clear();
  }

  ptyManager.on('data', (sessionId, data) => {
    if (!ptyDataBuffers.has(sessionId)) ptyDataBuffers.set(sessionId, []);
    ptyDataBuffers.get(sessionId).push(data);
    if (!ptyFlushTimer) {
      ptyFlushTimer = setTimeout(flushPtyData, 16);
    }
  });

  // Pre-warm a standby session for instant new-session creation
  function scheduleWarmUp() {
    setTimeout(() => {
      const settings = settingsService.get();
      if (settings.promptForWorkdir) return;
      const cwd = settings.defaultWorkdir || undefined;
      ptyManager.warmUp(cwd);
    }, 3000);
  }
  scheduleWarmUp();
});

app.on('window-all-closed', () => {
  tagIndexer.stop();
  resourceIndexer.stop();
  notificationService.stop();
  if (ptyFlushTimer) { clearTimeout(ptyFlushTimer); ptyFlushTimer = null; }
  ptyManager.killAll();
  app.quit();
});
