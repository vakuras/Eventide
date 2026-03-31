const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const readline = require('readline');

class SessionService {
  constructor(sessionStateDir) {
    this.dir = sessionStateDir;
  }

  async listSessions() {
    const entries = await fs.promises.readdir(this.dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    const results = await Promise.allSettled(dirs.map(entry => this._loadSession(entry)));
    const sessions = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    // Sort by last modified, newest first
    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async searchSessions(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];

    const entries = await fs.promises.readdir(this.dir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    const results = await Promise.allSettled(dirs.map(entry => this._searchSessionOccurrences(entry, needle)));
    return results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
  }

  async getLastUserPrompt(sessionId) {
    const sessionDir = path.join(this.dir, sessionId);
    return this._extractLastUserPromptFromEvents(sessionDir);
  }

  async _loadSession(entry) {
    const sessionDir = path.join(this.dir, entry.name);
    const yamlPath = path.join(sessionDir, 'workspace.yaml');

    try {
      const yamlContent = await fs.promises.readFile(yamlPath, 'utf8');
      const meta = yaml.load(yamlContent) || {};

      let title = null;
      let isCustomTitle = false;

      // Check for manual rename (takes priority, never overridden)
      const customTitlePath = path.join(sessionDir, '.eventide-title');
      try {
        title = (await fs.promises.readFile(customTitlePath, 'utf8')).trim();
        isCustomTitle = !!title;
      } catch {
        // No custom title — fall through to auto-detection
      }

      if (!title) {
        title = meta.summary || null;
      }

      // If no summary, try to extract from first user message in events.jsonl
      if (!title) {
        title = await this._extractTitleFromEvents(sessionDir);
      }

      if (!title) {
        title = `Session ${entry.name.substring(0, 8)}`;
      }

      if (!isCustomTitle) {
        // Clean up titles that are raw prompts (quoted strings from knowledge queries)
        if (title.startsWith('"')) {
          title = title.replace(/^"/, '').replace(/"$/, '');
          if (title.startsWith("Use the 'knowledge-based-answer'")) {
            const match = title.match(/answer:\s*(.+)/);
            title = match ? match[1].substring(0, 60) : title.substring(0, 60);
          }
          if (title.startsWith('Follow the workflow')) {
            title = title.substring(0, 60);
          }
        }

        // Truncate long titles
        if (title.length > 70) {
          title = title.substring(0, 67) + '...';
        }
      }

      // Resolve cwd: .eventide-cwd override → workspace.yaml cwd
      let cwd = meta.cwd || '';
      try {
        const customCwd = (await fs.promises.readFile(path.join(sessionDir, '.eventide-cwd'), 'utf8')).trim();
        if (customCwd) cwd = customCwd;
      } catch {}

      const stat = await fs.promises.stat(sessionDir);
      return {
        id: entry.name,
        title,
        cwd,
        createdAt: meta.created_at || stat.birthtime.toISOString(),
        updatedAt: meta.updated_at || stat.mtime.toISOString(),
        lastModified: stat.mtime.getTime()
      };
    } catch {
      // Skip sessions with unreadable metadata
      return null;
    }
  }

  async _searchSessionOccurrences(entry, needle) {
    const sessionDir = path.join(this.dir, entry.name);

    try {
      const occurrences = await this._searchEventsForOccurrences(sessionDir, needle);
      return occurrences.length ? { id: entry.name, occurrences, preview: occurrences[0].preview } : null;
    } catch {
      return null;
    }
  }

  async _readOptionalTrimmedFile(filePath) {
    try {
      return (await fs.promises.readFile(filePath, 'utf8')).trim();
    } catch {
      return '';
    }
  }

  _buildSearchPreview(value, needle) {
    if (!value || !needle) return '';
    return this._collectMatchesFromText(value, needle, { maxMatches: 1 })[0]?.preview || '';
  }

  _buildSearchPreviewFromMatch(text, matchIndex, matchLength) {
    const radius = 42;
    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(text.length, matchIndex + matchLength + radius);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }

  _normalizeSearchText(value) {
    if (!value) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  _buildSearchMatch(text, matchIndex, matchLength) {
    const previewRadius = 42;
    const contextRadius = 28;
    const previewStart = Math.max(0, matchIndex - previewRadius);
    const previewEnd = Math.min(text.length, matchIndex + matchLength + previewRadius);
    const contextStart = Math.max(0, matchIndex - contextRadius);
    const contextEnd = Math.min(text.length, matchIndex + matchLength + contextRadius);

    return {
      preview: `${previewStart > 0 ? '…' : ''}${text.slice(previewStart, previewEnd)}${previewEnd < text.length ? '…' : ''}`,
      beforeText: text.slice(contextStart, matchIndex),
      matchText: text.slice(matchIndex, matchIndex + matchLength),
      afterText: text.slice(matchIndex + matchLength, contextEnd)
    };
  }

  _collectMatchesFromText(value, needle, { sourceLabel = '', maxMatches = Infinity } = {}) {
    const text = this._normalizeSearchText(value);
    if (!text || !needle || maxMatches <= 0) return [];

    const matches = [];
    const lower = text.toLowerCase();
    let from = 0;
    while (from <= lower.length - needle.length && matches.length < maxMatches) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      matches.push({
        ...this._buildSearchMatch(text, idx, needle.length),
        sourceLabel
      });
      from = idx + Math.max(needle.length, 1);
    }
    return matches;
  }

  _extractVisibleEventTexts(event) {
    const texts = [];
    const push = (text, sourceLabel) => {
      const normalized = this._normalizeSearchText(text);
      if (normalized) texts.push({ text: normalized, sourceLabel });
    };

    switch (event.type) {
      case 'user.message':
        push(event.data?.content || event.data?.transformedContent, 'User');
        break;
      case 'assistant.message':
        this._collectVisibleAssistantTexts(event.data, (text) => push(text, 'Assistant'));
        break;
      case 'tool.execution_complete':
        push(event.data?.result?.content, 'Tool');
        push(event.data?.result?.detailedContent, 'Tool');
        break;
      default:
        break;
    }

    return texts;
  }

  _collectVisibleAssistantTexts(data, push) {
    if (!data) return;

    if (typeof data.content === 'string' && data.content.trim()) {
      push(data.content);
    }

    this._collectRenderableStrings(data.sections, push);
    this._collectRenderableStrings(data.parts, push);
    this._collectRenderableStrings(data.blocks, push);
  }

  _collectRenderableStrings(value, push, keyHint = '') {
    if (!value) return;

    const visibleKeys = new Set(['content', 'text', 'body', 'title', 'summary', 'markdown', 'message']);
    if (typeof value === 'string') {
      if (!keyHint || visibleKeys.has(keyHint)) push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) this._collectRenderableStrings(item, push, keyHint);
      return;
    }

    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        this._collectRenderableStrings(nested, push, key);
      }
    }
  }

  _collectSearchableStrings(value, output) {
    if (!value) return;

    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text) output.push(text);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) this._collectSearchableStrings(item, output);
      return;
    }

    if (typeof value === 'object') {
      for (const nested of Object.values(value)) this._collectSearchableStrings(nested, output);
    }
  }

  _getEventSourceLabel(eventType) {
    switch (eventType) {
      case 'user.message':
        return 'User';
      case 'assistant.message':
        return 'Assistant';
      case 'tool.execution_complete':
        return 'Tool';
      default:
        return '';
    }
  }

  async _searchEventsForOccurrences(sessionDir, needle, maxOccurrences = 3) {
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    try {
      await fs.promises.access(eventsPath);
    } catch {
      return [];
    }

    return new Promise((resolve) => {
      const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      const occurrences = [];
      let finished = false;

      const finish = (value = occurrences) => {
        if (finished) return;
        finished = true;
        resolve(value);
        rl.close();
        stream.destroy();
      };

      rl.on('line', (line) => {
        if (finished) return;
        try {
          const event = JSON.parse(line);
          const texts = this._extractVisibleEventTexts(event);
          for (const entry of texts) {
            const remaining = maxOccurrences - occurrences.length;
            if (remaining <= 0) {
              finish();
              return;
            }
            occurrences.push(...this._collectMatchesFromText(entry.text, needle, { sourceLabel: entry.sourceLabel, maxMatches: remaining }));
            if (occurrences.length >= maxOccurrences) {
              finish();
              return;
            }
          }
        } catch {
          // Skip malformed lines
        }
      });

      rl.on('close', () => {
        if (!finished) resolve(occurrences);
      });
      rl.on('error', () => finish([]));
      stream.on('error', () => finish([]));
    });
  }

  async _extractTitleFromEvents(sessionDir) {
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    try {
      await fs.promises.access(eventsPath);
    } catch {
      return null;
    }

    return new Promise((resolve) => {
      const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let found = false;

      rl.on('line', (line) => {
        if (found) return;
        try {
          const event = JSON.parse(line);
          if (event.type === 'user.message' && event.data?.content) {
            found = true;
            let content = event.data.content;
            // Strip leading whitespace and take first line
            content = content.trim().split('\n')[0];
            // Truncate
            if (content.length > 70) {
              content = content.substring(0, 67) + '...';
            }
            resolve(content);
            rl.close();
            stream.destroy();
          }
        } catch {
          // skip malformed lines
        }
      });

      rl.on('close', () => {
        if (!found) resolve(null);
      });
    });
  }

  async _extractLastUserPromptFromEvents(sessionDir) {
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    try {
      await fs.promises.access(eventsPath);
    } catch {
      return '';
    }

    return new Promise((resolve) => {
      const stream = fs.createReadStream(eventsPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lastPrompt = '';

      rl.on('line', (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type !== 'user.message') return;
          const prompt = this._normalizeSearchText(event.data?.content || event.data?.transformedContent);
          if (!prompt) return;
          lastPrompt = prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt;
        } catch {
          // Skip malformed lines
        }
      });

      rl.on('close', () => resolve(lastPrompt));
      rl.on('error', () => resolve(lastPrompt));
      stream.on('error', () => resolve(lastPrompt));
    });
  }

  async cleanEmptySessions() {
    const entries = await fs.promises.readdir(this.dir, { withFileTypes: true });
    let cleaned = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionDir = path.join(this.dir, entry.name);
      const eventsPath = path.join(sessionDir, 'events.jsonl');

      try {
        const eventsExist = await fs.promises.access(eventsPath).then(() => true).catch(() => false);

        if (!eventsExist) {
          // No events file at all — check if workspace.yaml has a summary
          const yamlPath = path.join(sessionDir, 'workspace.yaml');
          try {
            const yamlContent = await fs.promises.readFile(yamlPath, 'utf8');
            const meta = yaml.load(yamlContent);
            if (!meta.summary) {
              await fs.promises.rm(sessionDir, { recursive: true, force: true });
              cleaned++;
            }
          } catch {
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
            cleaned++;
          }
          continue;
        }

        // Events file exists but may be empty
        const stat = await fs.promises.stat(eventsPath);
        if (stat.size === 0) {
          const yamlPath = path.join(sessionDir, 'workspace.yaml');
          try {
            const yamlContent = await fs.promises.readFile(yamlPath, 'utf8');
            const meta = yaml.load(yamlContent);
            if (!meta.summary) {
              await fs.promises.rm(sessionDir, { recursive: true, force: true });
              cleaned++;
            }
          } catch {
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
            cleaned++;
          }
        }
      } catch {
        // Skip errors
      }
    }

    console.log(`Cleaned ${cleaned} empty sessions`);
    return cleaned;
  }
  async saveCwd(sessionId, cwd) {
    const sessionDir = path.join(this.dir, sessionId);
    await fs.promises.mkdir(sessionDir, { recursive: true });
    await fs.promises.writeFile(path.join(sessionDir, '.eventide-cwd'), cwd.trim(), 'utf8');
  }

  async getCwd(sessionId) {
    const sessionDir = path.join(this.dir, sessionId);
    // 1. Check for Eventide-managed cwd override
    try {
      const cwd = (await fs.promises.readFile(path.join(sessionDir, '.eventide-cwd'), 'utf8')).trim();
      if (cwd) return cwd;
    } catch {}
    // 2. Fallback to workspace.yaml cwd
    try {
      const yamlContent = await fs.promises.readFile(path.join(sessionDir, 'workspace.yaml'), 'utf8');
      const meta = yaml.load(yamlContent);
      if (meta.cwd) return meta.cwd;
    } catch {}
    return '';
  }

  async renameSession(sessionId, title) {
    const customTitlePath = path.join(this.dir, sessionId, '.eventide-title');
    await fs.promises.writeFile(customTitlePath, title.trim(), 'utf8');
  }

  async deleteSession(sessionId) {
    const sessionDir = path.join(this.dir, sessionId);
    await fs.promises.rm(sessionDir, { recursive: true, force: true });
  }
}

module.exports = SessionService;
