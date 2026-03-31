const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CACHE_FILE = 'session-tags.json';
const REBUILD_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Patterns for extracting tags from session content
const REPO_PATTERN = /(?:^|\s|\/)((?:Cloud|Detection|Mgmt|InR|InE|Nexus|WDATP|WD|MD|MDE|TVM|NDR|Response|Sense|OneCyber|MDATP|AutomatedIR|CaseManagement|Geneva|XSPM|FE|Subscriptions|AAPT)[\w.]*)/g;
const TOOL_TAGS = {
  'kusto-mcp': 'kusto',
  'ado-mcp': 'azure-devops',
  'workiq': 'work-iq',
  'nexus-meridian': 'nexus-meridian',
  'github-mcp-server': 'github',
  'sql': 'sql',
};
const TOPIC_KEYWORDS = {
  'deploy': 'deployment',
  'deploying': 'deployment',
  'deployment': 'deployment',
  'pipeline': 'pipelines',
  'build': 'build',
  'test': 'testing',
  'monitor': 'monitoring',
  'alert': 'alerting',
  'incident': 'incidents',
  'bug': 'bugs',
  'fix': 'bugfix',
  'PR': 'pull-requests',
  'pull request': 'pull-requests',
  'review': 'code-review',
  'config': 'configuration',
  'configuration': 'configuration',
  'telemetry': 'telemetry',
  'kusto': 'kusto',
  'KQL': 'kusto',
  'NuGet': 'nuget',
  'connect': 'connect',
  'EKG': 'ekg-uploader',
  'wiki': 'wiki',
  'security': 'security',
  'API': 'api',
  'throttl': 'throttling',
  'onboard': 'onboarding',
  'migration': 'migration',
  'diagram': 'diagrams',
  'architecture': 'architecture',
  'investigate': 'investigation',
  'debug': 'debugging',
  'error': 'errors',
  'SQL': 'sql',
  'sqlite': 'sql',
  'database': 'sql',
  'retry': 'retry-logic',
};

class TagIndexer {
  constructor(sessionStateDir) {
    this.sessionStateDir = sessionStateDir;
    this.cachePath = path.join(sessionStateDir, CACHE_FILE);
    this.cache = {}; // sessionId -> { tags: string[], indexedAt: number }
    this._rebuildTimer = null;
  }

  async init() {
    await this._loadCache();
    await this.rebuildIfStale();
    this._startPeriodicRebuild();
  }

  async _loadCache() {
    try {
      const data = await fs.promises.readFile(this.cachePath, 'utf8');
      this.cache = JSON.parse(data);
    } catch {
      this.cache = {};
    }
  }

  async _saveCache() {
    try {
      await fs.promises.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch {}
  }

  _startPeriodicRebuild() {
    this._rebuildTimer = setInterval(() => this.rebuildIfStale(), REBUILD_INTERVAL_MS);
  }

  stop() {
    if (this._rebuildTimer) clearInterval(this._rebuildTimer);
  }

  async rebuildIfStale() {
    const entries = await fs.promises.readdir(this.sessionStateDir, { withFileTypes: true });
    const currentIds = new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
    let updated = false;

    // Prune orphaned cache entries
    for (const id of Object.keys(this.cache)) {
      if (!currentIds.has(id)) { delete this.cache[id]; updated = true; }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const sessionDir = path.join(this.sessionStateDir, sessionId);

      // Skip if already indexed and session hasn't been modified since
      const cached = this.cache[sessionId];
      if (cached) {
        try {
          const stat = await fs.promises.stat(sessionDir);
          if (stat.mtime.getTime() <= cached.indexedAt) continue;
        } catch { continue; }
      }

      const tags = await this._extractTags(sessionDir);
      if (tags.length > 0 || !cached) {
        this.cache[sessionId] = { tags, indexedAt: Date.now() };
        updated = true;
      }
    }

    if (updated) await this._saveCache();
  }

  async _extractTags(sessionDir) {
    const tags = new Set();
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    try {
      await fs.promises.access(eventsPath);
    } catch {
      return [];
    }

    return new Promise((resolve) => {
      const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          const event = JSON.parse(line);

          // Extract from user messages
          if (event.type === 'user.message' && event.data?.content) {
            const content = event.data.content;

            // Repo mentions
            let match;
            const repoRegex = new RegExp(REPO_PATTERN.source, 'g');
            while ((match = repoRegex.exec(content)) !== null) {
              tags.add(`repo:${match[1]}`);
            }

            // Topic keywords
            for (const [keyword, tag] of Object.entries(TOPIC_KEYWORDS)) {
              if (content.toLowerCase().includes(keyword.toLowerCase())) {
                tags.add(tag);
              }
            }
          }

          // Extract from tool usage
          if (event.type === 'tool.call' && event.data?.toolName) {
            const toolName = event.data.toolName;
            for (const [prefix, tag] of Object.entries(TOOL_TAGS)) {
              if (toolName.startsWith(prefix) || toolName.includes(prefix)) {
                tags.add(`tool:${tag}`);
              }
            }
          }

          // Extract from assistant messages mentioning files/repos
          if (event.type === 'assistant.message' && event.data?.content) {
            const content = event.data.content;
            const repoRegex2 = new RegExp(REPO_PATTERN.source, 'g');
            while ((match = repoRegex2.exec(content)) !== null) {
              tags.add(`repo:${match[1]}`);
            }
          }
        } catch {}
      });

      rl.on('close', () => {
        resolve([...tags]);
      });

      rl.on('error', () => {
        resolve([...tags]);
      });
    });
  }

  getTagsForSession(sessionId) {
    return this.cache[sessionId]?.tags || [];
  }

  getAllTags() {
    const tagCounts = {};
    for (const entry of Object.values(this.cache)) {
      for (const tag of entry.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    return tagCounts;
  }

  searchByTags(query) {
    const q = query.toLowerCase();
    const matchingSessionIds = new Set();

    for (const [sessionId, entry] of Object.entries(this.cache)) {
      for (const tag of entry.tags) {
        if (tag.toLowerCase().includes(q)) {
          matchingSessionIds.add(sessionId);
          break;
        }
      }
    }

    return matchingSessionIds;
  }
}

module.exports = TagIndexer;
