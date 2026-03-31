import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

describe('session group connector contract', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  it('wraps grouped sessions in a session-group container', () => {
    expect(renderer).toContain("groupEl.className = 'session-group'");
    expect(renderer).toContain("groupEl.appendChild(headerEl)");
    expect(renderer).toContain("groupEl.appendChild(el)");
  });

  it('draws a vertical connector for expanded groups', () => {
    expect(css).toContain('.session-group:not(.collapsed)::before');
  });

  it('uses grouped session indentation without per-row horizontal connectors', () => {
    expect(css).toContain('.session-item.grouped');
    expect(css).not.toContain('.session-item.grouped::before');
  });
});
