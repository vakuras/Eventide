const EventEmitter = require('events');
const crypto = require('crypto');

const os = require('os');

// Default to node-pty, but allow injection for testing
let defaultPty;
try { defaultPty = require('node-pty'); } catch { defaultPty = null; }

class PtyManager extends EventEmitter {
  constructor(copilotPath, settingsService, ptyModule) {
    super();
    this.copilotPath = copilotPath;
    this.sessions = new Map();
    this.settingsService = settingsService;
    this._pty = ptyModule || defaultPty;

    // On Windows, .cmd files must be spawned via cmd.exe
    this._useCmd = process.platform === 'win32' &&
      copilotPath.toLowerCase().endsWith('.cmd');
    this._standby = null;
  }

  _generateId() {
    return crypto.randomUUID();
  }

  _spawnArgs(extraArgs) {
    if (this._useCmd) {
      return { file: 'cmd.exe', args: ['/c', this.copilotPath, ...extraArgs] };
    }
    return { file: this.copilotPath, args: extraArgs };
  }

  get maxConcurrent() {
    return this.settingsService?.get().maxConcurrent || 5;
  }

  openSession(sessionId, cwd) {
    // If already alive, just return the id
    if (this.sessions.has(sessionId) && this.sessions.get(sessionId).alive) {
      return sessionId;
    }

    // Bug #26: clean up dead entry before respawning
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
    }

    // Evict oldest if at max capacity
    this._evictIfNeeded();

    const spawnCwd = cwd || os.homedir();
    let ptyProcess;
    try {
      const { file, args } = this._spawnArgs(['--resume', sessionId, '--yolo']);
      ptyProcess = this._pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: spawnCwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    } catch (err) {
      // If spawn fails with given cwd, retry with homedir
      if (cwd && cwd !== os.homedir()) {
        try {
          const { file, args } = this._spawnArgs(['--resume', sessionId, '--yolo']);
          ptyProcess = this._pty.spawn(file, args, {
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
            cwd: os.homedir(),
            env: { ...process.env, TERM: 'xterm-256color' }
          });
        } catch (err2) {
          throw new Error(`Failed to spawn PTY for session ${sessionId}: ${err2.message}`);
        }
      } else {
        throw new Error(`Failed to spawn PTY for session ${sessionId}: ${err.message}`);
      }
    }

    // Capture entry reference directly so exit/data handlers don't
    // accidentally operate on a NEW entry after kill+respawn
    const sessionEntry = {
      pty: ptyProcess,
      alive: true,
      openedAt: Date.now(),
      lastDataAt: null,
      dataBytesSinceIdle: 0,
      cwd: spawnCwd
    };

    ptyProcess.onData((data) => {
      if (sessionEntry.alive) {
        const now = Date.now();
        // Reset burst counter after 5s of silence (new burst = new activity)
        if (sessionEntry.lastDataAt && (now - sessionEntry.lastDataAt) > 5000) {
          sessionEntry.dataBytesSinceIdle = 0;
        }
        sessionEntry.lastDataAt = now;
        sessionEntry.dataBytesSinceIdle += data.length;
        this.emit('data', sessionId, data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (sessionEntry.alive) {
        sessionEntry.alive = false;
        this.emit('exit', sessionId, exitCode);
        // Only remove from map if this is still the current entry
        if (this.sessions.get(sessionId) === sessionEntry) {
          this.sessions.delete(sessionId);
        }
      }
    });

    this.sessions.set(sessionId, sessionEntry);
    return sessionId;
  }

  newSession(cwd) {
    const sessionId = this._generateId();

    this._evictIfNeeded();

    const spawnCwd = cwd || os.homedir();
    let ptyProcess;
    try {
      const { file, args } = this._spawnArgs(['--resume', sessionId, '--yolo']);
      ptyProcess = this._pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: spawnCwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    } catch (err) {
      if (cwd && cwd !== os.homedir()) {
        try {
          const { file, args } = this._spawnArgs(['--resume', sessionId, '--yolo']);
          ptyProcess = this._pty.spawn(file, args, {
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
            cwd: os.homedir(),
            env: { ...process.env, TERM: 'xterm-256color' }
          });
        } catch (err2) {
          throw new Error(`Failed to spawn PTY for session ${sessionId}: ${err2.message}`);
        }
      } else {
        throw new Error(`Failed to spawn PTY for session ${sessionId}: ${err.message}`);
      }
    }

    const sessionEntry = {
      pty: ptyProcess,
      alive: true,
      openedAt: Date.now(),
      lastDataAt: null,
      dataBytesSinceIdle: 0,
      cwd: spawnCwd
    };

    ptyProcess.onData((data) => {
      if (sessionEntry.alive) {
        const now = Date.now();
        if (sessionEntry.lastDataAt && (now - sessionEntry.lastDataAt) > 5000) {
          sessionEntry.dataBytesSinceIdle = 0;
        }
        sessionEntry.lastDataAt = now;
        sessionEntry.dataBytesSinceIdle += data.length;
        this.emit('data', sessionId, data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (sessionEntry.alive) {
        sessionEntry.alive = false;
        this.emit('exit', sessionId, exitCode);
        if (this.sessions.get(sessionId) === sessionEntry) {
          this.sessions.delete(sessionId);
        }
      }
    });

    this.sessions.set(sessionId, sessionEntry);
    return sessionId;
  }

  write(sessionId, data) {
    const entry = this.sessions.get(sessionId);
    if (entry && entry.alive) {
      entry.pty.write(data);
    }
  }

  resize(sessionId, cols, rows) {
    const entry = this.sessions.get(sessionId);
    if (entry && entry.alive) {
      entry.pty.resize(cols, rows);
    }
  }

  kill(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (entry && entry.alive) {
      entry.pty.kill();
      entry.alive = false;
    }
    this.sessions.delete(sessionId);
  }

  warmUp(cwd) {
    if (this._standby && this._standby.alive) return;
    this._standby = null;

    // Don't warm if at capacity
    const aliveCount = [...this.sessions.values()].filter(e => e.alive).length;
    if (aliveCount >= this.maxConcurrent) return;

    const sessionId = this._generateId();
    const spawnCwd = cwd || os.homedir();
    try {
      const { file, args } = this._spawnArgs(['--resume', sessionId, '--yolo']);
      const ptyProcess = this._pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: spawnCwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });

      const entry = {
        id: sessionId,
        pty: ptyProcess,
        cwd: spawnCwd,
        bufferedData: [],
        alive: true,
        claimed: false
      };

      ptyProcess.onData((data) => {
        if (!entry.claimed && entry.alive) {
          entry.bufferedData.push(data);
        }
      });

      ptyProcess.onExit(() => {
        if (!entry.claimed) {
          entry.alive = false;
          if (this._standby === entry) this._standby = null;
        }
      });

      this._standby = entry;
    } catch {
      // Pre-warm failed — cold start will still work
    }
  }

  claimStandby(cwd) {
    const standby = this._standby;
    if (!standby || !standby.alive) return null;

    const spawnCwd = cwd || os.homedir();
    if (standby.cwd !== spawnCwd) {
      // CWD mismatch — discard standby
      try { standby.pty.kill(); } catch {}
      standby.alive = false;
      this._standby = null;
      return null;
    }

    standby.claimed = true;
    this._standby = null;

    this._evictIfNeeded();

    const sessionEntry = {
      pty: standby.pty,
      alive: true,
      openedAt: Date.now(),
      lastDataAt: standby.bufferedData.length > 0 ? Date.now() : null,
      dataBytesSinceIdle: 0,
      cwd: standby.cwd
    };

    standby.pty.onData((data) => {
      if (sessionEntry.alive) {
        const now = Date.now();
        if (sessionEntry.lastDataAt && (now - sessionEntry.lastDataAt) > 5000) {
          sessionEntry.dataBytesSinceIdle = 0;
        }
        sessionEntry.lastDataAt = now;
        sessionEntry.dataBytesSinceIdle += data.length;
        this.emit('data', standby.id, data);
      }
    });

    standby.pty.onExit(({ exitCode }) => {
      if (sessionEntry.alive) {
        sessionEntry.alive = false;
        this.emit('exit', standby.id, exitCode);
        if (this.sessions.get(standby.id) === sessionEntry) {
          this.sessions.delete(standby.id);
        }
      }
    });

    this.sessions.set(standby.id, sessionEntry);
    return { id: standby.id, bufferedData: standby.bufferedData };
  }

  killAll() {
    if (this._standby && this._standby.alive) {
      try { this._standby.pty.kill(); } catch {}
      this._standby.alive = false;
      this._standby = null;
    }
    for (const [id, entry] of this.sessions) {
      if (entry.alive) {
        try { entry.pty.kill(); } catch {}
      }
    }
    this.sessions.clear();
  }

  getActiveSessions() {
    const result = [];
    for (const [id, entry] of this.sessions) {
      if (entry.alive) {
        result.push({ id, openedAt: entry.openedAt, lastDataAt: entry.lastDataAt || 0 });
      }
    }
    return result;
  }

  /**
   * Returns sessions that are actively producing significant output.
   * A session is "busy" only if it received output within `thresholdMs` AND
   * the current output burst has substantial volume (>500 bytes), which
   * distinguishes AI-generated content from a prompt/cursor redraw.
   */
  getBusySessions(thresholdMs = 5000) {
    const now = Date.now();
    const MIN_BUSY_BYTES = 500;
    const result = [];
    for (const [id, entry] of this.sessions) {
      if (entry.alive && entry.lastDataAt &&
          (now - entry.lastDataAt) < thresholdMs &&
          entry.dataBytesSinceIdle >= MIN_BUSY_BYTES) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Kill sessions that haven't produced output within `thresholdMs`.
   * Returns the IDs of sessions that were killed.
   */
  killIdle(thresholdMs = 5000) {
    const now = Date.now();
    const killed = [];
    for (const [id, entry] of this.sessions) {
      if (entry.alive && (!entry.lastDataAt || (now - entry.lastDataAt) >= thresholdMs)) {
        try { entry.pty.kill(); } catch {}
        entry.alive = false;
        this.sessions.delete(id);
        killed.push(id);
      }
    }
    return killed;
  }

  updateSettings(settings) {
    // Settings are persisted by SettingsService; just evict if needed
  }

  _evictIfNeeded() {
    let alive = [...this.sessions.entries()].filter(([, e]) => e.alive);
    alive.sort((a, b) => a[1].openedAt - b[1].openedAt);
    let i = 0;
    while (alive.length - i >= this.maxConcurrent) {
      const [oldestId, oldestEntry] = alive[i];
      oldestEntry.alive = false;
      this.emit('evicted', oldestId);
      try { oldestEntry.pty.kill(); } catch {}
      this.sessions.delete(oldestId);
      i++;
    }
  }
}

module.exports = PtyManager;
