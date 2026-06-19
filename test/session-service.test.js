import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const SessionService = require('../src/session-service');

let tmpDir;
let svc;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'deepsky-test-'));
  svc = new SessionService(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function createSession(id, yamlContent, extras = {}) {
  const dir = path.join(tmpDir, id);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'workspace.yaml'), yamlContent, 'utf8');
  if (extras.deepskyCwd) {
    await fs.promises.writeFile(path.join(dir, '.deepsky-cwd'), extras.deepskyCwd, 'utf8');
  }
  if (extras.deepskyTitle) {
    await fs.promises.writeFile(path.join(dir, '.deepsky-title'), extras.deepskyTitle, 'utf8');
  }
  if (extras.eventideTitle) {
    await fs.promises.writeFile(path.join(dir, '.eventide-title'), extras.eventideTitle, 'utf8');
  }
  if (extras.events) {
    const lines = extras.events.map(event => JSON.stringify(event)).join('\n') + '\n';
    await fs.promises.writeFile(path.join(dir, 'events.jsonl'), lines, 'utf8');
  }
}

describe('SessionService', () => {
  describe('saveCwd', () => {
    it('writes .deepsky-cwd file to session directory', async () => {
      await svc.saveCwd('sess-1', '/my/project');
      const content = await fs.promises.readFile(path.join(tmpDir, 'sess-1', '.deepsky-cwd'), 'utf8');
      expect(content).toBe('/my/project');
    });

    it('creates session directory if it does not exist', async () => {
      await svc.saveCwd('new-sess', 'C:\\Users\\test');
      const exists = await fs.promises.access(path.join(tmpDir, 'new-sess')).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('trims whitespace from cwd', async () => {
      await svc.saveCwd('sess-trim', '  /trimmed/path  ');
      const content = await fs.promises.readFile(path.join(tmpDir, 'sess-trim', '.deepsky-cwd'), 'utf8');
      expect(content).toBe('/trimmed/path');
    });

    it('overwrites existing .deepsky-cwd', async () => {
      await svc.saveCwd('sess-overwrite', '/old/path');
      await svc.saveCwd('sess-overwrite', '/new/path');
      const content = await fs.promises.readFile(path.join(tmpDir, 'sess-overwrite', '.deepsky-cwd'), 'utf8');
      expect(content).toBe('/new/path');
    });
  });

  describe('getCwd', () => {
    it('returns .deepsky-cwd content when it exists', async () => {
      await createSession('sess-cwd', 'cwd: /yaml/path\nsummary: test', { deepskyCwd: '/override/path' });
      const cwd = await svc.getCwd('sess-cwd');
      expect(cwd).toBe('/override/path');
    });

    it('.deepsky-cwd takes priority over workspace.yaml cwd', async () => {
      await createSession('sess-priority', 'cwd: /yaml/path\nsummary: test', { deepskyCwd: '/deepsky/path' });
      const cwd = await svc.getCwd('sess-priority');
      expect(cwd).toBe('/deepsky/path');
    });

    it('falls back to workspace.yaml cwd when .deepsky-cwd is absent', async () => {
      await createSession('sess-yaml', 'cwd: /yaml/fallback\nsummary: test');
      const cwd = await svc.getCwd('sess-yaml');
      expect(cwd).toBe('/yaml/fallback');
    });

    it('returns empty string when neither .deepsky-cwd nor workspace.yaml cwd exist', async () => {
      await createSession('sess-empty', 'summary: no cwd');
      const cwd = await svc.getCwd('sess-empty');
      expect(cwd).toBe('');
    });

    it('returns empty string when session directory does not exist', async () => {
      const cwd = await svc.getCwd('nonexistent');
      expect(cwd).toBe('');
    });

    it('ignores empty .deepsky-cwd and falls back to yaml', async () => {
      await createSession('sess-empty-file', 'cwd: /yaml/path\nsummary: test', { deepskyCwd: '   ' });
      const cwd = await svc.getCwd('sess-empty-file');
      expect(cwd).toBe('/yaml/path');
    });
  });

  describe('listSessions title resolution', () => {
    it('uses .eventide-title when present (highest priority)', async () => {
      await createSession('title-custom', 'name: cli-name\nsummary: auto summary', {
        eventideTitle: 'Manually Renamed',
      });
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'title-custom');
      expect(sess.title).toBe('Manually Renamed');
    });

    it("honors workspace.yaml `name` (Copilot CLI's /rename) when no .eventide-title", async () => {
      await createSession('title-cli', 'name: RPs\nsummary: original auto summary');
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'title-cli');
      expect(sess.title).toBe('RPs');
    });

    it('falls back to summary when neither .eventide-title nor name is set', async () => {
      await createSession('title-summary', 'summary: investigate rollout');
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'title-summary');
      expect(sess.title).toBe('investigate rollout');
    });

    it('does not truncate or sanitize a workspace.yaml `name`', async () => {
      // Long names from /rename should be treated as user-chosen (no 70-char truncation,
      // no quote stripping).
      const longName = 'A very long manually chosen name that exceeds seventy characters for sure indeed';
      await createSession('title-no-trunc', `name: ${longName}\nsummary: short`);
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'title-no-trunc');
      expect(sess.title).toBe(longName);
    });
  });

  describe('listSessions cwd resolution', () => {
    it('uses .deepsky-cwd override in session listing', async () => {
      await createSession('list-1', 'cwd: /yaml/dir\nsummary: test session', { deepskyCwd: '/override/dir' });
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'list-1');
      expect(sess.cwd).toBe('/override/dir');
    });

    it('uses workspace.yaml cwd when no .deepsky-cwd', async () => {
      await createSession('list-2', 'cwd: /yaml/only\nsummary: yaml session');
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'list-2');
      expect(sess.cwd).toBe('/yaml/only');
    });

    it('returns empty cwd when neither source has cwd', async () => {
      await createSession('list-3', 'summary: no cwd session');
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'list-3');
      expect(sess.cwd).toBe('');
    });
  });

  describe('saveCwd + getCwd roundtrip', () => {
    it('getCwd returns what saveCwd wrote', async () => {
      await createSession('roundtrip', 'summary: test');
      await svc.saveCwd('roundtrip', 'C:\\Users\\test\\project');
      const cwd = await svc.getCwd('roundtrip');
      expect(cwd).toBe('C:\\Users\\test\\project');
    });

    it('saveCwd updates cwd returned by listSessions', async () => {
      await createSession('roundtrip-list', 'cwd: /old\nsummary: test');
      await svc.saveCwd('roundtrip-list', '/updated');
      const sessions = await svc.listSessions();
      const sess = sessions.find(s => s.id === 'roundtrip-list');
      expect(sess.cwd).toBe('/updated');
    });
  });

  describe('searchSessions', () => {
    it('finds matches in event transcript content', async () => {
      await createSession('search-hit', 'summary: first session', {
        events: [
          { type: 'user.message', data: { content: 'Looking at deployment statistics for the session' } }
        ]
      });
      await createSession('search-miss', 'summary: second session', {
        events: [
          { type: 'user.message', data: { content: 'Nothing relevant here' } }
        ]
      });

      const matches = await svc.searchSessions('statistics');
      expect(matches.map(match => match.id)).toContain('search-hit');
      expect(matches.map(match => match.id)).not.toContain('search-miss');
    });

    it('returns a preview for nested event payload matches', async () => {
      await createSession('nested-hit', 'summary: investigate rollout', {
        events: [
          {
            type: 'assistant.message',
            data: {
              sections: [
                { title: 'Result', body: 'The multitarget publish completed successfully in EU3 yesterday.' }
              ]
            }
          }
        ]
      });

      const matches = await svc.searchSessions('eu3');
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('nested-hit');
      expect(matches[0].preview.toLowerCase()).toContain('eu3');
    });

    it('does not match hidden assistant tool request metadata', async () => {
      await createSession('search-hidden-tool', 'summary: hidden tool request', {
        events: [
          {
            type: 'assistant.message',
            data: {
              content: '',
              toolRequests: [
                {
                  name: 'searchSessions',
                  arguments: {
                    query: 'phantom-keyword'
                  }
                }
              ]
            }
          }
        ]
      });

      const matches = await svc.searchSessions('phantom-keyword');
      expect(matches.map(match => match.id)).not.toContain('search-hidden-tool');
    });

    it('matches against the manual rename in .eventide-title', async () => {
      await createSession('renamed', 'summary: irrelevant auto summary', {
        eventideTitle: "Review Vadim's Recommendation",
        events: [
          { type: 'user.message', data: { content: 'No keyword here' } }
        ]
      });

      const matches = await svc.searchSessions('vadim');
      expect(matches.map(match => match.id)).toContain('renamed');
      const hit = matches.find(m => m.id === 'renamed');
      expect(hit.preview.toLowerCase()).toContain('vadim');
      expect(hit.occurrences[0].sourceLabel).toBe('title');
    });

    it('falls back to workspace.yaml summary when there is no custom title', async () => {
      await createSession('summary-hit', 'summary: Investigate Phoenix telemetry pipeline', {
        events: [
          { type: 'user.message', data: { content: 'No keyword here' } }
        ]
      });

      const matches = await svc.searchSessions('phoenix');
      expect(matches.map(match => match.id)).toContain('summary-hit');
      const hit = matches.find(m => m.id === 'summary-hit');
      expect(hit.occurrences[0].sourceLabel).toBe('title');
    });

    it('prefers .eventide-title over workspace.yaml summary for title matches', async () => {
      // Custom rename hides the summary — searching for the old summary token should not match
      // (since the user explicitly renamed the session away from that content).
      await createSession('renamed-over-summary', 'summary: Original Auto Summary', {
        eventideTitle: 'Manually Renamed Session',
        events: [
          { type: 'user.message', data: { content: 'No keyword here' } }
        ]
      });

      const summaryMiss = await svc.searchSessions('original');
      expect(summaryMiss.map(m => m.id)).not.toContain('renamed-over-summary');

      const titleHit = await svc.searchSessions('renamed');
      expect(titleHit.map(m => m.id)).toContain('renamed-over-summary');
    });

    it('still returns event matches when the title does not contain the needle', async () => {
      await createSession('event-only', 'summary: unrelated title', {
        eventideTitle: 'Unrelated Title',
        events: [
          { type: 'user.message', data: { content: 'Looking at deployment statistics for the session' } }
        ]
      });

      const matches = await svc.searchSessions('statistics');
      expect(matches.map(match => match.id)).toContain('event-only');
    });

    it('cancels in-flight searches when a newer query starts (returns []), and the newer query completes normally', async () => {
      // Create enough sessions with substantial events.jsonl bodies that the
      // first scan can't possibly finish before the second one supersedes it.
      const longLine = (i) => JSON.stringify({
        type: 'user.message',
        data: { content: `Line ${i} ` + 'lorem '.repeat(200) }
      });
      for (let s = 0; s < 12; s++) {
        const lines = [];
        for (let i = 0; i < 200; i++) lines.push(longLine(i));
        const dir = path.join(tmpDir, `bulky-${s}`);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, 'workspace.yaml'), 'summary: bulky\n', 'utf8');
        await fs.promises.writeFile(path.join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');
      }

      const stale = svc.searchSessions('zzznomatch');
      // Yield once so the stale scan can register its seq.
      await new Promise(r => setImmediate(r));
      const current = svc.searchSessions('lorem');

      const [staleResult, currentResult] = await Promise.all([stale, current]);
      expect(staleResult).toEqual([]);
      expect(currentResult.length).toBeGreaterThan(0);
    });

    it("matches against workspace.yaml `name` (Copilot CLI's /rename)", async () => {
      await createSession('cli-rename', 'cwd: C:/Dev/Eventide\nname: RPs\nsummary: irrelevant\n', {
        events: [
          { type: 'user.message', data: { content: 'No keyword here' } }
        ]
      });

      const matches = await svc.searchSessions('rps');
      expect(matches.map(m => m.id)).toContain('cli-rename');
      const hit = matches.find(m => m.id === 'cli-rename');
      expect(hit.occurrences[0].sourceLabel).toBe('title');
    });

    it('prefers workspace.yaml `name` over `summary` for title matches', async () => {
      await createSession('name-over-summary', 'name: Manual CLI Name\nsummary: Auto Summary\n');

      // Auto summary should no longer be searchable when name is set.
      const summaryMiss = await svc.searchSessions('auto');
      expect(summaryMiss.map(m => m.id)).not.toContain('name-over-summary');

      const nameHit = await svc.searchSessions('manual');
      expect(nameHit.map(m => m.id)).toContain('name-over-summary');
    });
  });

  describe('getLastUserPrompt', () => {
    it('returns the most recent user prompt from the transcript', async () => {
      await createSession('last-prompt', 'summary: prompt tracking', {
        events: [
          { type: 'user.message', data: { content: 'First prompt' } },
          { type: 'assistant.message', data: { content: 'Working on it' } },
          { type: 'user.message', data: { transformedContent: 'Second prompt with more detail' } }
        ]
      });

      const prompt = await svc.getLastUserPrompt('last-prompt');
      expect(prompt).toBe('Second prompt with more detail');
    });
  });
});
