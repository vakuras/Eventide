const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CACHE_FILE = 'session-resources.json';
const REBUILD_INTERVAL_MS = 10 * 60 * 1000;

// Patterns for extracting resources
const PR_URL_RE = /https?:\/\/[^\s"\\)]*\/pullrequest\/(\d+)/g;
const WI_URL_RE = /https?:\/\/[^\s"\\)]*\/_workitems\/edit\/(\d+)/g;
const GIT_URL_RE = /https?:\/\/(?:microsoft\.visualstudio\.com|dev\.azure\.com\/microsoft)\/(?:DefaultCollection\/)?(\w+)\/_git\/([^\s"\\);,]+)/g;
const WIKI_URL_RE = /https?:\/\/[^\s"\\)]*\/_wiki\/[^\s"\\)]+/g;
const PIPELINE_URL_RE = /https?:\/\/[^\s"\\)]*\/_build\/results\?buildId=(\d+)[^\s"\\)]*/g;
const PIPELINE_DEF_URL_RE = /https?:\/\/[^\s"\\)]*\/_build\?definitionId=(\d+)[^\s"\\)]*/g;
const RELEASE_URL_RE = /https?:\/\/[^\s"\\)]*\/_releaseProgress\?[^\s"\\)]*releaseId=(\d+)[^\s"\\)]*/g;
const PR_ID_TOOL_RE = /"pullRequestId"\s*:\s*(\d+)/g;
const PR_STATUS_RE = /"pullRequestId"\s*:\s*(\d+)[^}]*?"status"\s*:\s*"(active|completed|abandoned)"/gi;
const PR_STATUS_ESCAPED_RE = /\\?"pullRequestId\\?"\s*:\s*(\d+)[\s\S]{0,200}?\\?"status\\?"\s*:\s*(\d+|\\?"(?:active|completed|abandoned)\\?")/gi;
const WI_ID_TOOL_RE = /"workItemId"\s*:\s*(\d+)/g;

function normalizeRepoUrl(url) {
  url = (url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  // Canonicalize host variants to a consistent form
  url = url.replace(/microsoft\.visualstudio\.com/, 'dev.azure.com/microsoft');
  url = url.replace(/\/DefaultCollection\//, '/');
  // Strip path segments after /_git/RepoName
  const gitIdx = url.indexOf('/_git/');
  if (gitIdx !== -1) {
    const afterGit = url.substring(gitIdx + 6);
    const repoName = afterGit.split('/')[0];
    url = url.substring(0, gitIdx + 6) + repoName;
  }
  return url;
}

function resourceKey(r) {
  if (r.id) return `${r.type}:${r.id}`;
  const url = r.type === 'repo' ? normalizeRepoUrl(r.url) : (r.url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `${r.type}:${url}`;
}

class ResourceIndexer {
  constructor(sessionStateDir) {
    this.sessionStateDir = sessionStateDir;
    this.cachePath = path.join(sessionStateDir, CACHE_FILE);
    this.cache = {};
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

      const cached = this.cache[sessionId];
      if (cached) {
        try {
          const stat = await fs.promises.stat(sessionDir);
          if (stat.mtime.getTime() <= cached.indexedAt) continue;
        } catch { continue; }
      }

      const resources = await this._extractResources(sessionDir);
      this.cache[sessionId] = { resources, indexedAt: Date.now() };
      updated = true;
    }

    if (updated) await this._saveCache();
  }

  async _extractResources(sessionDir) {
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    try { await fs.promises.access(eventsPath); } catch { return []; }

    const prs = new Map();       // prId -> { id, url?, repo? }
    const workItems = new Map(); // wiId -> { id, url? }
    const repos = new Set();     // repo URLs
    const wikiUrls = new Set();
    const pipelines = new Map(); // buildId -> { id, url }
    const releases = new Map();  // releaseId -> { id, url }

    return new Promise((resolve) => {
      const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        // Search the raw line for efficiency (most patterns work across any field)
        let m;

        // PR URLs (includes PR ID + repo context)
        const prUrlRe = new RegExp(PR_URL_RE.source, 'g');
        while ((m = prUrlRe.exec(line)) !== null) {
          const prId = m[1];
          const url = m[0].replace(/[)}\]"\\]+$/, ''); // strip trailing junk
          const repoMatch = url.match(/_git\/([^/]+)\/pullrequest/);
          const existing = prs.get(prId);
          if (existing) {
            if (!existing.url) existing.url = url;
            if (!existing.repo && repoMatch) existing.repo = repoMatch[1];
          } else {
            prs.set(prId, {
              id: prId,
              url,
              repo: repoMatch ? repoMatch[1] : null,
              type: 'pr',
              state: null
            });
          }
        }

        // PR IDs from tool calls
        const prIdRe = new RegExp(PR_ID_TOOL_RE.source, 'g');
        while ((m = prIdRe.exec(line)) !== null) {
          const prId = m[1];
          if (!prs.has(prId)) {
            prs.set(prId, { id: prId, url: null, repo: null, type: 'pr', state: null });
          }
        }

        // PR status from tool call arguments (e.g. "pullRequestId": 123, ..., "status": "Active")
        const prStatusRe = new RegExp(PR_STATUS_RE.source, 'gi');
        while ((m = prStatusRe.exec(line)) !== null) {
          const prId = m[1];
          const state = m[2].toLowerCase();
          const existing = prs.get(prId);
          if (existing) {
            existing.state = state;
          }
        }

        // PR status from escaped JSON in tool responses (e.g. \"status\":1 or \"status\":\"active\")
        const prStatusEscRe = new RegExp(PR_STATUS_ESCAPED_RE.source, 'gi');
        while ((m = prStatusEscRe.exec(line)) !== null) {
          const prId = m[1];
          const rawState = m[2].replace(/\\?"/g, '');
          const STATUS_MAP = { '1': 'active', '2': 'abandoned', '3': 'completed', 'active': 'active', 'abandoned': 'abandoned', 'completed': 'completed' };
          const state = STATUS_MAP[rawState.toLowerCase()];
          if (state) {
            const existing = prs.get(prId);
            if (existing) existing.state = state;
          }
        }

        // Work item URLs
        const wiUrlRe = new RegExp(WI_URL_RE.source, 'g');
        while ((m = wiUrlRe.exec(line)) !== null) {
          const wiId = m[1];
          const url = m[0].replace(/[)}\]"\\]+$/, '');
          workItems.set(wiId, { id: wiId, url, type: 'workitem' });
        }

        // Work item IDs from tool calls
        const wiIdRe = new RegExp(WI_ID_TOOL_RE.source, 'g');
        while ((m = wiIdRe.exec(line)) !== null) {
          const wiId = m[1];
          if (!workItems.has(wiId)) {
            workItems.set(wiId, { id: wiId, url: null, type: 'workitem' });
          }
        }

        // Git repo URLs (exclude PR URLs)
        const gitUrlRe = new RegExp(GIT_URL_RE.source, 'g');
        while ((m = gitUrlRe.exec(line)) !== null) {
          let repoUrl = m[0].replace(/[)}\]"\\;,]+$/, '');
          if (!repoUrl.includes('/pullrequest/')) {
            // Normalize: keep only up to /_git/RepoName
            const gitIdx = repoUrl.indexOf('/_git/');
            if (gitIdx !== -1) {
              const afterGit = repoUrl.substring(gitIdx + 6);
              const repoName = afterGit.split('/')[0];
              repoUrl = repoUrl.substring(0, gitIdx + 6) + repoName;
            }
            repos.add(repoUrl);
          }
        }

        // Wiki URLs
        const wikiRe = new RegExp(WIKI_URL_RE.source, 'g');
        while ((m = wikiRe.exec(line)) !== null) {
          wikiUrls.add(m[0].replace(/[)}\]"\\]+$/, ''));
        }

        // Pipeline URLs (build results)
        const pipelineRe = new RegExp(PIPELINE_URL_RE.source, 'g');
        while ((m = pipelineRe.exec(line)) !== null) {
          const buildId = m[1];
          if (!pipelines.has(buildId)) {
            pipelines.set(buildId, { id: buildId, url: m[0].replace(/[)}\]"\\]+$/, ''), type: 'pipeline' });
          }
        }
        const pipelineDefRe = new RegExp(PIPELINE_DEF_URL_RE.source, 'g');
        while ((m = pipelineDefRe.exec(line)) !== null) {
          const defId = `def-${m[1]}`;
          if (!pipelines.has(defId)) {
            pipelines.set(defId, { id: defId, url: m[0].replace(/[)}\]"\\]+$/, ''), type: 'pipeline' });
          }
        }

        // Release URLs
        const releaseRe = new RegExp(RELEASE_URL_RE.source, 'g');
        while ((m = releaseRe.exec(line)) !== null) {
          const releaseId = m[1];
          if (!releases.has(releaseId)) {
            releases.set(releaseId, { id: releaseId, url: m[0].replace(/[)}\]"\\]+$/, ''), type: 'release' });
          }
        }
      });

      rl.on('close', () => {
        const resources = [
          ...[...prs.values()],
          ...[...workItems.values()],
          ...[...repos].map(url => {
            const repoName = url.match(/_git\/(.+)/)?.[1] || url;
            return { type: 'repo', name: repoName, url };
          }),
          ...[...wikiUrls].map(url => ({ type: 'wiki', url })),
          ...[...pipelines.values()],
          ...[...releases.values()]
        ];
        resolve(resources);
      });

      rl.on('error', () => resolve([]));
    });
  }

  getResourcesForSession(sessionId) {
    const entry = this.cache[sessionId];
    if (!entry) return [];
    const auto = entry.resources || [];
    const manual = entry.manualResources || [];
    const removed = new Set(entry.removedKeys || []);
    const seen = new Set();
    const merged = [];
    for (const r of [...auto, ...manual]) {
      const key = resourceKey(r);
      if (removed.has(key) || seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    return merged;
  }

  async addManualResource(sessionId, resource) {
    if (!this.cache[sessionId]) {
      this.cache[sessionId] = { resources: [], indexedAt: 0 };
    }
    const entry = this.cache[sessionId];
    if (!entry.manualResources) entry.manualResources = [];
    if (!entry.removedKeys) entry.removedKeys = [];

    const key = resourceKey(resource);
    // Check for duplicates across auto + manual
    const allKeys = new Set([
      ...(entry.resources || []).map(resourceKey),
      ...entry.manualResources.map(resourceKey)
    ]);
    if (allKeys.has(key)) return { added: false, reason: 'duplicate' };

    // Un-remove if it was previously removed
    entry.removedKeys = entry.removedKeys.filter(k => k !== key);

    entry.manualResources.push(resource);
    await this._saveCache();
    return { added: true };
  }

  async removeResource(sessionId, key) {
    const entry = this.cache[sessionId];
    if (!entry) return;
    if (!entry.removedKeys) entry.removedKeys = [];
    if (!entry.removedKeys.includes(key)) entry.removedKeys.push(key);
    // Also remove from manual if it was manually added
    if (entry.manualResources) {
      entry.manualResources = entry.manualResources.filter(r => resourceKey(r) !== key);
    }
    await this._saveCache();
  }

  search(query) {
    const q = query.toLowerCase();
    const results = new Set();

    for (const [sessionId, entry] of Object.entries(this.cache)) {
      for (const r of entry.resources) {
        if (r.id && r.id.includes(q)) { results.add(sessionId); break; }
        if (r.url && r.url.toLowerCase().includes(q)) { results.add(sessionId); break; }
        if (r.name && r.name.toLowerCase().includes(q)) { results.add(sessionId); break; }
        if (r.repo && r.repo.toLowerCase().includes(q)) { results.add(sessionId); break; }
      }
    }

    return results;
  }
}

module.exports = ResourceIndexer;
module.exports.resourceKey = resourceKey;

module.exports.parseUrlToResource = function parseUrlToResource(url) {
  url = url.trim();
  let m;
  if ((m = url.match(/\/pullrequest\/(\d+)/))) {
    const repoMatch = url.match(/_git\/([^/]+)\/pullrequest/);
    return { type: 'pr', id: m[1], url, repo: repoMatch ? repoMatch[1] : null, state: null };
  }
  if ((m = url.match(/\/_workitems\/edit\/(\d+)/))) {
    return { type: 'workitem', id: m[1], url };
  }
  if ((m = url.match(/\/_build\/results\?buildId=(\d+)/))) {
    return { type: 'pipeline', id: m[1], url };
  }
  if ((m = url.match(/\/_build\?definitionId=(\d+)/))) {
    return { type: 'pipeline', id: `def-${m[1]}`, url };
  }
  if ((m = url.match(/releaseId=(\d+)/))) {
    return { type: 'release', id: m[1], url };
  }
  if (url.match(/_wiki\//)) {
    return { type: 'wiki', url };
  }
  if (url.match(/_git\//)) {
    url = normalizeRepoUrl(url);
    const repoName = url.match(/_git\/(.+)/)?.[1] || url;
    return { type: 'repo', name: repoName, url };
  }
  // Generic link
  return { type: 'link', url, name: url.replace(/^https?:\/\//, '').split('/').slice(0, 3).join('/') };
};
