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
