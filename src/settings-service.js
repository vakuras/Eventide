const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  maxConcurrent: 5,
  sidebarWidth: 280,
  sidebarCollapsed: false,
  lastActiveTab: 'active', // 'active' or 'history'
  theme: 'midnight', // 'midnight', 'mocha', or 'latte'
  copilotPath: '', // auto-detect if empty; override with full path to copilot binary
  openTabs: [], // session IDs of tabs to restore on startup
  activeTab: null, // session ID of the last active tab
  tabGroups: [], // Array of { id, name, color, collapsed, tabIds }
  sessionOrder: [], // Manual ordering of active session IDs in sidebar
  zoomFactor: 1.0, // 0.75 – 1.5
  promptForWorkdir: false, // show directory picker when creating a new session
  defaultWorkdir: '', // default working directory for new sessions; empty = user home
  autoUpdateEnabled: true, // false = no update checks or downloads
  statusPanelSections: {}, // persisted expand/collapse state for status panel sections
};

class SettingsService {
  constructor(configDir) {
    this.configPath = path.join(configDir, 'eventide-settings.json');
    this.settings = { ...DEFAULTS };
  }

  async load() {
    try {
      const data = await fs.promises.readFile(this.configPath, 'utf8');
      const saved = JSON.parse(data);
      this.settings = { ...DEFAULTS, ...saved };
    } catch {
      this.settings = { ...DEFAULTS };
    }
    return this.settings;
  }

  async save() {
    try {
      const dir = path.dirname(this.configPath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(this.configPath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch {}
  }

  get() {
    return { ...this.settings };
  }

  async update(partial) {
    const allowed = Object.keys(DEFAULTS);
    const filtered = {};
    for (const key of allowed) { if (key in partial) filtered[key] = partial[key]; }
    Object.assign(this.settings, filtered);
    await this.save();
    return { ...this.settings };
  }
}

module.exports = SettingsService;
