import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const UpdateService = require('../src/update-service');

function makeMockAutoUpdater() {
  return {
    autoDownload: undefined,
    autoInstallOnAppQuit: undefined,
    allowPrerelease: undefined,
    on: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({}),
    quitAndInstall: vi.fn(),
  };
}

function makeMockIpcMain() {
  const handlers = {};
  return {
    ipcMain: { handle: vi.fn((channel, handler) => { handlers[channel] = handler; }) },
    handlers,
  };
}

function makeSettingsService(overrides = {}) {
  const defaults = { autoUpdateEnabled: true, updateChannel: 'stable' };
  const settings = { ...defaults, ...overrides };
  return { get: () => ({ ...settings }), update: (partial) => Object.assign(settings, partial) };
}

function makeMainWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

describe('UpdateService', () => {
  let mockAutoUpdater;
  let mockIpc;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAutoUpdater = makeMockAutoUpdater();
    mockIpc = makeMockIpcMain();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor — applies settings to autoUpdater', () => {
    it('enables auto-download when autoUpdateEnabled is true', () => {
      new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: true }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it('disables auto-download when autoUpdateEnabled is false', () => {
      new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: false }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.autoDownload).toBe(false);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
    });

    it('enables pre-releases when updateChannel is beta', () => {
      new UpdateService(makeMainWindow(), makeSettingsService({ updateChannel: 'beta' }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.allowPrerelease).toBe(true);
    });

    it('disables pre-releases when updateChannel is stable', () => {
      new UpdateService(makeMainWindow(), makeSettingsService({ updateChannel: 'stable' }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.allowPrerelease).toBe(false);
    });

    it('defaults to enabled + stable when settings are missing', () => {
      const svc = makeSettingsService({});
      new UpdateService(makeMainWindow(), svc, { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.allowPrerelease).toBe(false);
    });
  });

  describe('applySettings IPC — live toggle', () => {
    it('switches to beta channel when setting changes', () => {
      const settings = makeSettingsService({ updateChannel: 'stable' });
      new UpdateService(makeMainWindow(), settings, { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.allowPrerelease).toBe(false);

      settings.update({ updateChannel: 'beta' });
      mockIpc.handlers['update:applySettings']();
      expect(mockAutoUpdater.allowPrerelease).toBe(true);
    });

    it('disables auto-update when setting changes', () => {
      const settings = makeSettingsService({ autoUpdateEnabled: true });
      new UpdateService(makeMainWindow(), settings, { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.autoDownload).toBe(true);

      settings.update({ autoUpdateEnabled: false });
      mockIpc.handlers['update:applySettings']();
      expect(mockAutoUpdater.autoDownload).toBe(false);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);
    });

    it('re-enables auto-update when setting changes back', () => {
      const settings = makeSettingsService({ autoUpdateEnabled: false });
      new UpdateService(makeMainWindow(), settings, { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      expect(mockAutoUpdater.autoDownload).toBe(false);

      settings.update({ autoUpdateEnabled: true });
      mockIpc.handlers['update:applySettings']();
      expect(mockAutoUpdater.autoDownload).toBe(true);
    });
  });

  describe('checkOnStartup — respects autoUpdateEnabled', () => {
    it('skips startup check when auto-update is disabled', async () => {
      const svc = new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: false }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      await svc.checkOnStartup();
      vi.advanceTimersByTime(10000);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('schedules startup check when auto-update is enabled', async () => {
      const svc = new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: true }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      await svc.checkOnStartup();
      vi.advanceTimersByTime(6000); // past the 5s delay
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
    });
  });

  describe('periodic check — respects autoUpdateEnabled', () => {
    it('does not start periodic checks when disabled', async () => {
      const svc = new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: false }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      await svc.checkOnStartup();
      vi.advanceTimersByTime(20 * 60 * 1000); // 20 minutes
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('stops periodic timer when auto-update is disabled mid-session', async () => {
      const settings = makeSettingsService({ autoUpdateEnabled: true });
      const svc = new UpdateService(makeMainWindow(), settings, { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      await svc.checkOnStartup();
      // Flush the 5s startup timeout so it doesn't interfere
      await vi.advanceTimersByTimeAsync(6000);
      mockAutoUpdater.checkForUpdates.mockClear();

      // Disable mid-session
      settings.update({ autoUpdateEnabled: false });
      mockIpc.handlers['update:applySettings']();

      vi.advanceTimersByTime(20 * 60 * 1000);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  describe('settings persistence integration', () => {
    it('autoUpdateEnabled defaults to true in SettingsService', () => {
      const SettingsService = require('../src/settings-service');
      const svc = new SettingsService('/tmp/fake');
      expect(svc.get().autoUpdateEnabled).toBe(true);
    });

    it('updateChannel defaults to stable in SettingsService', () => {
      const SettingsService = require('../src/settings-service');
      const svc = new SettingsService('/tmp/fake');
      expect(svc.get().updateChannel).toBe('stable');
    });
  });

  describe('getStatus IPC', () => {
    it('returns current status', () => {
      new UpdateService(makeMainWindow(), makeSettingsService(), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      const result = mockIpc.handlers['update:getStatus']();
      expect(result).toEqual({ status: 'idle', info: null, progress: null, error: null });
    });
  });

  describe('dispose', () => {
    it('clears the periodic timer', async () => {
      const svc = new UpdateService(makeMainWindow(), makeSettingsService({ autoUpdateEnabled: true }), { autoUpdater: mockAutoUpdater, ipcMain: mockIpc.ipcMain });
      await svc.checkOnStartup();
      // Flush the 5s startup timeout so it doesn't interfere
      await vi.advanceTimersByTimeAsync(6000);
      mockAutoUpdater.checkForUpdates.mockClear();

      svc.dispose();
      vi.advanceTimersByTime(20 * 60 * 1000);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });
  });
});

