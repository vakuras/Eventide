import { describe, it, expect } from 'vitest';

/**
 * Tests for the session close-button feature.
 *
 * The close button (✕) replaces the green running-dot on hover in the sidebar
 * session list, allowing users to close a session without switching to the tab
 * bar.  The HTML is generated inside createSessionItem via two template
 * expressions whose conditions we verify here.
 */

// Mirror the two template conditions used in renderer.js createSessionItem():
//   delete button:  currentSidebarTab === 'history'
//   close  button:  currentSidebarTab === 'active' && isRunning
function getSessionButtons(currentSidebarTab, isRunning) {
  const showDelete = currentSidebarTab === 'history';
  const showClose  = currentSidebarTab === 'active' && isRunning;
  return { showDelete, showClose };
}

describe('session close button visibility', () => {
  // --- active tab -----------------------------------------------------------
  it('shows close button for running session on active tab', () => {
    const { showClose, showDelete } = getSessionButtons('active', true);
    expect(showClose).toBe(true);
    expect(showDelete).toBe(false);
  });

  it('hides close button for non-running session on active tab', () => {
    const { showClose, showDelete } = getSessionButtons('active', false);
    expect(showClose).toBe(false);
    expect(showDelete).toBe(false);
  });

  // --- history tab ----------------------------------------------------------
  it('shows delete button on history tab (running)', () => {
    const { showClose, showDelete } = getSessionButtons('history', true);
    expect(showDelete).toBe(true);
    expect(showClose).toBe(false);
  });

  it('shows delete button on history tab (not running)', () => {
    const { showClose, showDelete } = getSessionButtons('history', false);
    expect(showDelete).toBe(true);
    expect(showClose).toBe(false);
  });

  // --- mutual exclusivity ---------------------------------------------------
  it('never shows both buttons at the same time', () => {
    for (const tab of ['active', 'history']) {
      for (const running of [true, false]) {
        const { showClose, showDelete } = getSessionButtons(tab, running);
        expect(showClose && showDelete).toBe(false);
      }
    }
  });
});

describe('session close button CSS contract', () => {
  // These tests document the CSS expectations so that style changes that break
  // the feature get flagged.  We parse the stylesheet rather than rendering.
  const fs = require('fs');
  const css = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  it('hides green dot on hover (.running:hover::after)', () => {
    expect(css).toContain('.session-item.running:hover::after');
    // The rule should set display: none
    const match = css.match(/\.session-item\.running:hover::after\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('display: none');
  });

  it('defines .session-close with opacity: 0 (hidden by default)', () => {
    const match = css.match(/\.session-close\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('opacity: 0');
  });

  it('reveals .session-close on hover of running item', () => {
    expect(css).toContain('.session-item.running:hover .session-close');
    const match = css.match(/\.session-item\.running:hover \.session-close\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('opacity');
  });

  it('.session-close turns red on hover', () => {
    const match = css.match(/\.session-close:hover\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('--red');
  });
});
