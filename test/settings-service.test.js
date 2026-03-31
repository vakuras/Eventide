import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const SettingsService = require('../src/settings-service');

let tmpDir;
let svc;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'deepsky-settings-'));
  svc = new SettingsService(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  describe('defaults', () => {
    it('promptForWorkdir defaults to false', () => {
      const settings = svc.get();
      expect(settings.promptForWorkdir).toBe(false);
    });

    it('maxConcurrent defaults to 5', () => {
      expect(svc.get().maxConcurrent).toBe(5);
    });

    it('theme defaults to mocha', () => {
      expect(svc.get().theme).toBe('mocha');
    });
  });

  describe('update + persistence', () => {
    it('updates promptForWorkdir to false', async () => {
      await svc.update({ promptForWorkdir: false });
      expect(svc.get().promptForWorkdir).toBe(false);
    });

    it('persists promptForWorkdir across load', async () => {
      await svc.update({ promptForWorkdir: false });
      const svc2 = new SettingsService(tmpDir);
      await svc2.load();
      expect(svc2.get().promptForWorkdir).toBe(false);
    });

    it('rejects unknown settings keys', async () => {
      await svc.update({ unknownKey: 'bad', promptForWorkdir: false });
      const settings = svc.get();
      expect(settings.unknownKey).toBeUndefined();
      expect(settings.promptForWorkdir).toBe(false);
    });
  });

  describe('load', () => {
    it('returns defaults when config file does not exist', async () => {
      const settings = await svc.load();
      expect(settings.promptForWorkdir).toBe(false);
      expect(settings.maxConcurrent).toBe(5);
    });

    it('merges saved settings with defaults on load', async () => {
      const configPath = path.join(tmpDir, 'session-gui-settings.json');
      await fs.promises.writeFile(configPath, JSON.stringify({ maxConcurrent: 3 }), 'utf8');
      await svc.load();
      expect(svc.get().maxConcurrent).toBe(3);
      expect(svc.get().promptForWorkdir).toBe(false); // default fills in
    });
  });

  describe('defaultWorkdir', () => {
    it('defaults to empty string', () => {
      expect(svc.get().defaultWorkdir).toBe('');
    });

    it('persists across load', async () => {
      await svc.update({ defaultWorkdir: 'C:\\Projects' });
      const svc2 = new SettingsService(tmpDir);
      await svc2.load();
      expect(svc2.get().defaultWorkdir).toBe('C:\\Projects');
    });

    it('can be cleared back to empty', async () => {
      await svc.update({ defaultWorkdir: '/some/path' });
      await svc.update({ defaultWorkdir: '' });
      expect(svc.get().defaultWorkdir).toBe('');
    });
  });
});
