import { describe, it, expect } from 'vitest';

// Extract shortenPath since it's embedded in renderer.js — replicate it here for testing
function shortenPath(p) {
  if (!p) return '';
  const sep = p.includes('/') ? '/' : '\\';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 2) return p;
  return parts[0] + sep + '…' + sep + parts[parts.length - 1];
}

describe('shortenPath', () => {
  it('returns empty string for falsy input', () => {
    expect(shortenPath('')).toBe('');
    expect(shortenPath(null)).toBe('');
    expect(shortenPath(undefined)).toBe('');
  });

  it('returns short Unix paths unchanged', () => {
    expect(shortenPath('/home')).toBe('/home');
    expect(shortenPath('/home/user')).toBe('/home/user');
  });

  it('returns short Windows paths unchanged', () => {
    expect(shortenPath('C:\\')).toBe('C:\\');
    expect(shortenPath('C:\\Users')).toBe('C:\\Users');
  });

  it('shortens long Unix paths', () => {
    expect(shortenPath('/home/user/projects/myapp')).toBe('home/…/myapp');
  });

  it('shortens long Windows paths', () => {
    expect(shortenPath('C:\\Users\\itsela\\source\\DeepSky')).toBe('C:\\…\\DeepSky');
  });

  it('handles deeply nested paths', () => {
    expect(shortenPath('/a/b/c/d/e/f/g')).toBe('a/…/g');
  });

  it('handles paths with trailing separator', () => {
    // filter(Boolean) removes empty trailing element
    expect(shortenPath('/home/user/project/')).toBe('home/…/project');
  });

  it('uses correct separator for Windows paths', () => {
    const result = shortenPath('D:\\work\\repos\\big-project');
    expect(result).toContain('\\');
    expect(result).not.toContain('/');
  });

  it('uses correct separator for Unix paths', () => {
    const result = shortenPath('/usr/local/bin/tool');
    expect(result).toContain('/');
    expect(result).not.toContain('\\');
  });
});
