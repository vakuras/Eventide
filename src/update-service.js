const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

class UpdateService {
  constructor(mainWindow, settingsService, deps = {}) {
    this.mainWindow = mainWindow;
    this.settingsService = settingsService;
    this.autoUpdater = deps.autoUpdater || require('electron-updater').autoUpdater;
    this._ipcMain = deps.ipcMain || require('electron').ipcMain;
    this.status = 'idle'; // idle | checking | available | downloading | downloaded | not-available | error
    this.updateInfo = null;
    this.error = null;
    this.progress = null;
    this._checkTimer = null;

    this._applySettings();

    this.autoUpdater.on('checking-for-update', () => {
      this.status = 'checking';
      this._send('update:status', { status: this.status });
    });

    this.autoUpdater.on('update-available', (info) => {
      this.status = 'available';
      this.updateInfo = { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes };
      this._send('update:status', { status: this.status, info: this.updateInfo });
    });

    this.autoUpdater.on('update-not-available', (info) => {
      this.status = 'not-available';
      this.updateInfo = { version: info.version };
      this._send('update:status', { status: this.status, info: this.updateInfo });
    });

    this.autoUpdater.on('download-progress', (progress) => {
      this.status = 'downloading';
      this.progress = { percent: progress.percent, transferred: progress.transferred, total: progress.total };
      this._send('update:status', { status: this.status, progress: this.progress });
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      this.status = 'downloaded';
      this.updateInfo = { version: info.version, releaseDate: info.releaseDate };
      this._send('update:status', { status: this.status, info: this.updateInfo });
    });

    this.autoUpdater.on('error', (err) => {
      this.status = 'error';
      this.error = err?.message || 'Unknown error';
      this._send('update:status', { status: this.status, error: this.error });
    });

    this._registerIpc();
  }

  _send(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  _registerIpc() {
    this._ipcMain.handle('update:check', async () => {
      try {
        return await this.autoUpdater.checkForUpdates();
      } catch (err) {
        this.status = 'error';
        this.error = err?.message || 'Failed to check for updates';
        this._send('update:status', { status: this.status, error: this.error });
        return { status: 'error', error: this.error };
      }
    });

    this._ipcMain.handle('update:install', () => {
      this.autoUpdater.quitAndInstall(false, true);
    });

    this._ipcMain.handle('update:getStatus', () => {
      return { status: this.status, info: this.updateInfo, progress: this.progress, error: this.error };
    });

    this._ipcMain.handle('update:applySettings', () => {
      this._applySettings();
    });
  }

  _applySettings() {
    const settings = this.settingsService.get();
    const enabled = settings.autoUpdateEnabled !== false;

    this.autoUpdater.autoDownload = enabled;
    this.autoUpdater.autoInstallOnAppQuit = enabled;
    this.autoUpdater.allowPrerelease = false;

    if (!enabled && this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
  }

  async checkOnStartup() {
    const settings = this.settingsService.get();
    if (settings.autoUpdateEnabled === false) return;

    // Delay startup check by 5 seconds to not block app launch
    setTimeout(async () => {
      try {
        await this.autoUpdater.checkForUpdates();
      } catch {
        // Silent fail on startup — user can check manually
      }
    }, 5000);

    this._startPeriodicCheck();
  }

  _startPeriodicCheck() {
    const settings = this.settingsService.get();
    if (settings.autoUpdateEnabled === false) return;

    if (this._checkTimer) clearInterval(this._checkTimer);
    this._checkTimer = setInterval(async () => {
      if (this.status === 'downloaded' || this.status === 'downloading') return;
      try {
        await this.autoUpdater.checkForUpdates();
      } catch {
        // Silent fail — next interval will retry
      }
    }, CHECK_INTERVAL_MS);
  }

  dispose() {
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
  }
}

module.exports = UpdateService;
