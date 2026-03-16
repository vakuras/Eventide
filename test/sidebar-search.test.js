import { describe, it, expect } from 'vitest';

// Extracted from renderer.js sidebar search filtering logic
function matchesSidebarMetadata(session, queryLower) {
  if (session.title.toLowerCase().includes(queryLower)) return true;
  if (session.cwd && session.cwd.toLowerCase().includes(queryLower)) return true;
  if (session.tags && session.tags.some(tag => tag.toLowerCase().includes(queryLower))) return true;
  if (session.resources && session.resources.some(resource =>
    String(resource.id || '').toLowerCase().includes(queryLower) ||
    String(resource.url || '').toLowerCase().includes(queryLower) ||
    String(resource.name || '').toLowerCase().includes(queryLower) ||
    String(resource.repo || '').toLowerCase().includes(queryLower)
  )) return true;
  return false;
}

function makeSession(overrides = {}) {
  return { title: 'Default Session', cwd: undefined, tags: undefined, resources: undefined, ...overrides };
}

describe('matchesSidebarMetadata', () => {
  it('matches title (case-insensitive)', () => {
    const session = makeSession({ title: 'My Cool Project' });
    expect(matchesSidebarMetadata(session, 'cool')).toBe(true);
    expect(matchesSidebarMetadata(session, 'COOL')).toBe(false); // queryLower should already be lowercase
    expect(matchesSidebarMetadata(session, 'my cool')).toBe(true);
  });

  it('matches cwd path', () => {
    const session = makeSession({ cwd: 'C:\\Users\\dev\\projects\\foo' });
    expect(matchesSidebarMetadata(session, 'projects')).toBe(true);
    expect(matchesSidebarMetadata(session, 'foo')).toBe(true);
  });

  it('matches tag', () => {
    const session = makeSession({ tags: ['React', 'TypeScript', 'frontend'] });
    expect(matchesSidebarMetadata(session, 'react')).toBe(true);
    expect(matchesSidebarMetadata(session, 'typescript')).toBe(true);
    expect(matchesSidebarMetadata(session, 'backend')).toBe(false);
  });

  it('matches resource id', () => {
    const session = makeSession({ resources: [{ id: 'res-abc-123', url: '', name: '', repo: '' }] });
    expect(matchesSidebarMetadata(session, 'abc')).toBe(true);
  });

  it('matches resource url', () => {
    const session = makeSession({ resources: [{ id: '', url: 'https://github.com/org/repo', name: '', repo: '' }] });
    expect(matchesSidebarMetadata(session, 'github.com')).toBe(true);
  });

  it('matches resource name', () => {
    const session = makeSession({ resources: [{ id: '', url: '', name: 'My Repository', repo: '' }] });
    expect(matchesSidebarMetadata(session, 'my repository')).toBe(true);
  });

  it('matches resource repo', () => {
    const session = makeSession({ resources: [{ id: '', url: '', name: '', repo: 'deepsky' }] });
    expect(matchesSidebarMetadata(session, 'deepsky')).toBe(true);
  });

  it('returns false for no match', () => {
    const session = makeSession({
      title: 'Session Alpha',
      cwd: '/home/user',
      tags: ['node'],
      resources: [{ id: '1', url: 'http://x', name: 'thing', repo: 'r' }],
    });
    expect(matchesSidebarMetadata(session, 'zzzznotfound')).toBe(false);
  });

  it('handles missing cwd (undefined)', () => {
    const session = makeSession({ title: 'Test', cwd: undefined });
    expect(matchesSidebarMetadata(session, 'test')).toBe(true);
    expect(matchesSidebarMetadata(session, 'cwd-value')).toBe(false);
  });

  it('handles missing tags (undefined)', () => {
    const session = makeSession({ title: 'Test', tags: undefined });
    expect(matchesSidebarMetadata(session, 'sometag')).toBe(false);
  });

  it('handles empty tags array', () => {
    const session = makeSession({ title: 'Test', tags: [] });
    expect(matchesSidebarMetadata(session, 'sometag')).toBe(false);
  });

  it('handles missing resources (undefined)', () => {
    const session = makeSession({ title: 'Test', resources: undefined });
    expect(matchesSidebarMetadata(session, 'someres')).toBe(false);
  });

  it('handles empty resources array', () => {
    const session = makeSession({ title: 'Test', resources: [] });
    expect(matchesSidebarMetadata(session, 'someres')).toBe(false);
  });

  it('handles resources with null fields', () => {
    const session = makeSession({
      resources: [{ id: null, url: null, name: null, repo: null }],
    });
    // String(null || '') === '' — should not crash
    expect(() => matchesSidebarMetadata(session, 'anything')).not.toThrow();
    expect(matchesSidebarMetadata(session, 'anything')).toBe(false);
  });

  it('handles resources with missing fields (undefined)', () => {
    const session = makeSession({
      resources: [{}],
    });
    expect(() => matchesSidebarMetadata(session, 'anything')).not.toThrow();
    expect(matchesSidebarMetadata(session, 'anything')).toBe(false);
  });

  it('empty query matches anything with a title', () => {
    const session = makeSession({ title: 'Anything' });
    expect(matchesSidebarMetadata(session, '')).toBe(true);
  });
});
