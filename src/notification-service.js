const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const MAX_NOTIFICATIONS = 500;
const MAX_PROCESSED_FILES = 1000;

class NotificationService extends EventEmitter {
  constructor(notificationsDir) {
    super();
    this.notificationsDir = notificationsDir;
    this.watcher = null;
    this.processedFiles = new Set();
    this.notifications = []; // { id, type, title, body, sessionId, timestamp, read }
    this.nextId = 1;
    this.stateFile = path.join(notificationsDir, '.state.json');

    // Ensure directory exists
    fs.mkdirSync(notificationsDir, { recursive: true });
    this._loadState();
  }

  start() {
    // Process any existing notification files on startup
    this._scanExisting();

    // Watch for new files
    try {
      this.watcher = fs.watch(this.notificationsDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json') || filename === '.state.json') return;
        if (eventType === 'rename' || eventType === 'change') {
          // Small delay to ensure file is fully written
          setTimeout(() => this._processFile(filename), 100);
        }
      });
      this.watcher.on('error', (err) => {
        console.error('[notifications] Watcher error:', err.message);
        this.watcher = null;
      });
    } catch (err) {
      console.error('[notifications] Failed to start watcher:', err.message);
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this._saveState();
  }

  _scanExisting() {
    try {
      const files = fs.readdirSync(this.notificationsDir)
        .filter(f => f.endsWith('.json') && f !== '.state.json');
      for (const file of files) {
        this._processFile(file);
      }
    } catch {}
  }

  _processFile(filename) {
    if (this.processedFiles.has(filename)) return;
    const filePath = path.join(this.notificationsDir, filename);
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      const notification = {
        id: this.nextId++,
        type: data.type || 'info',
        title: data.title || 'Notification',
        body: data.body || '',
        sessionId: data.sessionId || null,
        timestamp: data.timestamp || new Date().toISOString(),
        read: false,
      };

      this.notifications.push(notification);
      this.emit('notification', notification);
      this._saveState();

      this.processedFiles.add(filename);

      // Cap processed files set to prevent unbounded growth
      if (this.processedFiles.size > MAX_PROCESSED_FILES) {
        const excess = this.processedFiles.size - MAX_PROCESSED_FILES;
        const iter = this.processedFiles.values();
        for (let i = 0; i < excess; i++) {
          this.processedFiles.delete(iter.next().value);
        }
      }

      // Consume the file
      try { fs.unlinkSync(filePath); } catch {}
    } catch (err) {
      // Invalid JSON or read error — delete the bad file
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  // Push a notification programmatically (from GUI state detection)
  push(notification) {
    const n = {
      id: this.nextId++,
      type: notification.type || 'info',
      title: notification.title || 'Notification',
      body: notification.body || '',
      sessionId: notification.sessionId || null,
      timestamp: notification.timestamp || new Date().toISOString(),
      read: false,
    };
    this.notifications.push(n);
    this.emit('notification', n);
    this._saveState();
    return n;
  }

  markRead(id) {
    const n = this.notifications.find(n => n.id === id);
    if (n) { n.read = true; this._saveState(); }
  }

  markAllRead() {
    this.notifications.forEach(n => { n.read = true; });
    this._saveState();
  }

  dismiss(id) {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this._saveState();
  }

  clearAll() {
    this.notifications = [];
    this._saveState();
  }

  getAll() {
    return [...this.notifications];
  }

  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }

  getUnreadCountForSession(sessionId) {
    return this.notifications.filter(n => !n.read && n.sessionId === sessionId).length;
  }

  _loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        this.notifications = Array.isArray(data.notifications) ? data.notifications : [];
        this.nextId = typeof data.nextId === 'number' ? data.nextId : 1;
      }
    } catch {
      this.notifications = [];
      this.nextId = 1;
    }
  }

  _saveState() {
    try {
      if (this.notifications.length > MAX_NOTIFICATIONS) {
        this.notifications = this.notifications.slice(-MAX_NOTIFICATIONS);
      }
      fs.writeFileSync(this.stateFile, JSON.stringify({
        notifications: this.notifications,
        nextId: this.nextId,
      }, null, 2), 'utf8');
    } catch {}
  }
}

module.exports = NotificationService;
