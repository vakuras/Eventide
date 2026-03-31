import { describe, it, expect, vi, beforeEach } from 'vitest';
const PtyManager = require('../src/pty-manager');

function createMockPty() {
  const handlers = {};
  return {
    onData: (cb) => { handlers.data = cb; },
    onExit: (cb) => { handlers.exit = cb; },
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    _emitData: (data) => handlers.data?.(data),
    _emitExit: (code) => handlers.exit?.({ exitCode: code }),
  };
}

const mockPtyModule = { spawn: vi.fn(() => createMockPty()) };

function createManager(maxConcurrent = 5) {
  const settingsService = { get: () => ({ maxConcurrent }) };
  return new PtyManager('/fake/copilot', settingsService, mockPtyModule);
}

function getPty(manager, sessionId) {
  // Access internal session entry to get the mock pty
  const entry = manager.sessions.get(sessionId);
  return entry?.pty;
}

describe('PtyManager', () => {
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = createManager();
  });

  describe('lastDataAt tracking', () => {
    it('initializes lastDataAt as null on openSession', () => {
      const id = manager.openSession('test-1');
      const entry = manager.sessions.get(id);
      expect(entry.lastDataAt).toBeNull();
    });

    it('initializes lastDataAt as null on newSession', () => {
      const id = manager.newSession();
      const entry = manager.sessions.get(id);
      expect(entry.lastDataAt).toBeNull();
    });

    it('updates lastDataAt when pty emits data', () => {
      const id = manager.openSession('test-2');
      const entry = manager.sessions.get(id);
      expect(entry.lastDataAt).toBeNull();

      vi.advanceTimersByTime(1000);
      getPty(manager, id)._emitData('hello');

      expect(entry.lastDataAt).toBeGreaterThan(0);
    });
  });

  describe('getBusySessions', () => {
    it('returns sessions with recent output', () => {
      const id = manager.openSession('busy-1');
      // Simulate substantial output (>500 bytes to qualify as busy)
      getPty(manager, id)._emitData('x'.repeat(600));
      const busy = manager.getBusySessions(5000);
      expect(busy).toContain('busy-1');
    });

    it('excludes sessions with stale output', () => {
      manager.openSession('stale-1');
      vi.advanceTimersByTime(6000);

      const busy = manager.getBusySessions(5000);
      expect(busy).not.toContain('stale-1');
    });

    it('excludes dead sessions', () => {
      const id = manager.openSession('dead-1');
      manager.kill(id);

      const busy = manager.getBusySessions(5000);
      expect(busy).not.toContain('dead-1');
    });

    it('returns empty array when no sessions exist', () => {
      expect(manager.getBusySessions(5000)).toEqual([]);
    });

    it('excludes sessions with no output yet', () => {
      manager.openSession('fresh-no-output');
      const busy = manager.getBusySessions(5000);
      expect(busy).not.toContain('fresh-no-output');
    });

    it('uses threshold correctly', () => {
      const id = manager.openSession('threshold-1');
      getPty(manager, id)._emitData('x'.repeat(600));
      vi.advanceTimersByTime(3000);

      expect(manager.getBusySessions(5000)).toContain('threshold-1');
      expect(manager.getBusySessions(2000)).not.toContain('threshold-1');
    });
  });

  describe('killIdle', () => {
    it('kills sessions with stale output', () => {
      manager.openSession('idle-1');
      vi.advanceTimersByTime(6000);

      const killed = manager.killIdle(5000);
      expect(killed).toContain('idle-1');
      expect(manager.sessions.has('idle-1')).toBe(false);
    });

    it('keeps sessions with recent output', () => {
      const id = manager.openSession('fresh-1');
      getPty(manager, id)._emitData('output');

      const killed = manager.killIdle(5000);
      expect(killed).not.toContain('fresh-1');
      expect(manager.sessions.has('fresh-1')).toBe(true);
    });

    it('calls kill on the pty process', () => {
      const id = manager.openSession('kill-pty-1');
      const pty = getPty(manager, id);
      vi.advanceTimersByTime(6000);

      manager.killIdle(5000);
      expect(pty.kill).toHaveBeenCalled();
    });

    it('handles mixed busy and idle sessions', () => {
      const oldId = manager.openSession('old-1');
      getPty(manager, oldId)._emitData('output');
      vi.advanceTimersByTime(6000);
      const newId = manager.openSession('new-1');
      getPty(manager, newId)._emitData('output');

      const killed = manager.killIdle(5000);
      expect(killed).toContain('old-1');
      expect(killed).not.toContain('new-1');
      expect(manager.sessions.has('old-1')).toBe(false);
      expect(manager.sessions.has('new-1')).toBe(true);
    });

    it('is safe to call when no sessions exist', () => {
      expect(() => manager.killIdle(5000)).not.toThrow();
      expect(manager.killIdle(5000)).toEqual([]);
    });

    it('marks killed sessions as not alive', () => {
      const id = manager.openSession('alive-check');
      vi.advanceTimersByTime(6000);

      // Session is still in map before killIdle, with alive=true
      expect(manager.sessions.get(id).alive).toBe(true);

      manager.killIdle(5000);
      // Session should be deleted from map entirely
      expect(manager.sessions.has(id)).toBe(false);
    });
  });

  describe('integration: busy detection after data events', () => {
    it('session becomes busy again after receiving new data', () => {
      const id = manager.openSession('revive-1');
      vi.advanceTimersByTime(6000);
      expect(manager.getBusySessions(5000)).not.toContain('revive-1');

      // Simulate substantial new output
      getPty(manager, id)._emitData('x'.repeat(600));
      expect(manager.getBusySessions(5000)).toContain('revive-1');
    });

    it('killIdle spares a session that just received data', () => {
      const id = manager.openSession('just-in-time');
      vi.advanceTimersByTime(6000);

      // Right before killIdle, session gets output
      getPty(manager, id)._emitData('output');

      const killed = manager.killIdle(5000);
      expect(killed).not.toContain('just-in-time');
    });
  });

  describe('cwd parameter', () => {
    it('newSession passes cwd to pty.spawn', () => {
      mockPtyModule.spawn.mockClear();
      manager.newSession('/my/project');
      const callArgs = mockPtyModule.spawn.mock.calls[0];
      expect(callArgs[2].cwd).toBe('/my/project');
    });

    it('newSession defaults to homedir when no cwd provided', () => {
      mockPtyModule.spawn.mockClear();
      manager.newSession();
      const callArgs = mockPtyModule.spawn.mock.calls[0];
      expect(callArgs[2].cwd).toBe(require('os').homedir());
    });

    it('openSession passes cwd to pty.spawn', () => {
      mockPtyModule.spawn.mockClear();
      manager.openSession('cwd-test-1', '/custom/dir');
      const callArgs = mockPtyModule.spawn.mock.calls[0];
      expect(callArgs[2].cwd).toBe('/custom/dir');
    });

    it('openSession defaults to homedir when no cwd provided', () => {
      mockPtyModule.spawn.mockClear();
      manager.openSession('cwd-test-2');
      const callArgs = mockPtyModule.spawn.mock.calls[0];
      expect(callArgs[2].cwd).toBe(require('os').homedir());
    });

    it('stores cwd in session entry', () => {
      const id = manager.newSession('/stored/path');
      const entry = manager.sessions.get(id);
      expect(entry.cwd).toBe('/stored/path');
    });

    it('old pty exit does not affect new entry after kill+reopen', () => {
      // Simulate cwd change: kill old pty, open new one for same sessionId
      const id = manager.openSession('reopen-1', '/old/path');
      const oldPty = getPty(manager, id);

      // Kill old session
      manager.kill(id);
      expect(manager.sessions.has(id)).toBe(false);

      // Open new session with same id (like changeCwd does)
      manager.openSession('reopen-1', '/new/path');
      const newEntry = manager.sessions.get('reopen-1');
      expect(newEntry.alive).toBe(true);
      expect(newEntry.cwd).toBe('/new/path');

      // Old pty fires exit (async in real life)
      oldPty._emitExit(0);

      // New entry should still be alive
      expect(newEntry.alive).toBe(true);
      expect(manager.sessions.has('reopen-1')).toBe(true);
    });

    it('falls back to homedir when spawn with bad cwd fails', () => {
      mockPtyModule.spawn.mockClear();
      let callCount = 0;
      mockPtyModule.spawn.mockImplementation((...args) => {
        callCount++;
        if (callCount === 1) throw new Error('bad cwd');
        return createMockPty();
      });

      const id = manager.newSession('/nonexistent/path');
      // Should have called spawn twice (failed + fallback)
      expect(callCount).toBe(2);
      expect(manager.sessions.has(id)).toBe(true);

      // Restore default
      mockPtyModule.spawn.mockImplementation(() => createMockPty());
    });
  });

  describe('warmUp / claimStandby', () => {
    it('warmUp creates a standby session', () => {
      mockPtyModule.spawn.mockClear();
      manager.warmUp('/my/cwd');
      expect(mockPtyModule.spawn).toHaveBeenCalledTimes(1);
      expect(manager._standby).not.toBeNull();
      expect(manager._standby.alive).toBe(true);
      expect(manager._standby.cwd).toBe('/my/cwd');
    });

    it('warmUp uses homedir when no cwd provided', () => {
      mockPtyModule.spawn.mockClear();
      manager.warmUp();
      expect(manager._standby.cwd).toBe(require('os').homedir());
    });

    it('warmUp is a no-op if standby already exists', () => {
      manager.warmUp('/cwd');
      mockPtyModule.spawn.mockClear();
      manager.warmUp('/cwd');
      expect(mockPtyModule.spawn).not.toHaveBeenCalled();
    });

    it('warmUp does not spawn if at max capacity', () => {
      // Fill to capacity
      for (let i = 0; i < 5; i++) manager.newSession('/cwd');
      mockPtyModule.spawn.mockClear();
      manager.warmUp('/cwd');
      expect(mockPtyModule.spawn).not.toHaveBeenCalled();
      expect(manager._standby).toBeNull();
    });

    it('warmUp buffers data from the standby PTY', () => {
      manager.warmUp('/cwd');
      const standby = manager._standby;
      standby.pty._emitData('hello ');
      standby.pty._emitData('world');
      expect(standby.bufferedData).toEqual(['hello ', 'world']);
    });

    it('claimStandby returns standby with matching cwd', () => {
      manager.warmUp('/my/cwd');
      const result = manager.claimStandby('/my/cwd');
      expect(result).not.toBeNull();
      expect(result.id).toBeTruthy();
      expect(result.bufferedData).toEqual([]);
      expect(manager._standby).toBeNull();
    });

    it('claimStandby returns buffered data', () => {
      manager.warmUp('/cwd');
      manager._standby.pty._emitData('startup output');
      const result = manager.claimStandby('/cwd');
      expect(result.bufferedData).toEqual(['startup output']);
    });

    it('claimStandby registers session in sessions map', () => {
      manager.warmUp('/cwd');
      const result = manager.claimStandby('/cwd');
      expect(manager.sessions.has(result.id)).toBe(true);
      expect(manager.sessions.get(result.id).alive).toBe(true);
    });

    it('claimed session emits data events normally', () => {
      const dataHandler = vi.fn();
      manager.on('data', dataHandler);
      manager.warmUp('/cwd');
      const result = manager.claimStandby('/cwd');
      const pty = manager.sessions.get(result.id).pty;
      pty._emitData('post-claim data');
      expect(dataHandler).toHaveBeenCalledWith(result.id, 'post-claim data');
    });

    it('claimStandby returns null on cwd mismatch and kills standby', () => {
      manager.warmUp('/cwd-a');
      const standbyPty = manager._standby.pty;
      const result = manager.claimStandby('/cwd-b');
      expect(result).toBeNull();
      expect(standbyPty.kill).toHaveBeenCalled();
      expect(manager._standby).toBeNull();
    });

    it('claimStandby returns null when no standby exists', () => {
      expect(manager.claimStandby('/cwd')).toBeNull();
    });

    it('claimStandby returns null when standby died', () => {
      manager.warmUp('/cwd');
      manager._standby.pty._emitExit(1);
      expect(manager.claimStandby('/cwd')).toBeNull();
    });

    it('killAll cleans up standby', () => {
      manager.warmUp('/cwd');
      const standbyPty = manager._standby.pty;
      manager.killAll();
      expect(standbyPty.kill).toHaveBeenCalled();
      expect(manager._standby).toBeNull();
    });

    it('standby does not count toward active sessions', () => {
      manager.warmUp('/cwd');
      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });
});
