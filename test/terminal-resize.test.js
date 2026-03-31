import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for terminal resize/fit behavior.
 *
 * These test the core logic of fitActiveTerminal, toggleStatusPanel,
 * and the ResizeObserver debounce — extracted patterns from renderer.js
 * verified against mock xterm objects.
 */

// --- Mock factories ---

function createMockTerminal(cols = 120, rows = 30) {
  const viewportEl = { scrollLeft: 50 };
  const screenEl = { style: { width: '1200px' } };
  return {
    cols,
    rows,
    element: {
      querySelector: vi.fn((sel) => {
        if (sel === '.xterm-viewport') return viewportEl;
        if (sel === '.xterm-screen') return screenEl;
        return null;
      }),
    },
    _core: {
      viewport: { syncScrollArea: vi.fn() },
    },
    _viewportEl: viewportEl,
    _screenEl: screenEl,
  };
}

function createMockFitAddon() {
  return { fit: vi.fn() };
}

function createMockApi() {
  return { resizePty: vi.fn() };
}

// --- fitActiveTerminal logic (extracted) ---

function fitActiveTerminal(activeSessionId, terminals, api) {
  if (activeSessionId && terminals.has(activeSessionId)) {
    const entry = terminals.get(activeSessionId);
    entry.fitAddon.fit();
    api.resizePty(activeSessionId, entry.terminal.cols, entry.terminal.rows);
    entry.terminal._core?.viewport?.syncScrollArea(true);
    const viewport = entry.terminal.element?.querySelector('.xterm-viewport');
    if (viewport) viewport.scrollLeft = 0;
    const screen = entry.terminal.element?.querySelector('.xterm-screen');
    if (screen) screen.style.width = '';
  }
}

// --- Tests ---

describe('fitActiveTerminal', () => {
  let terminal, fitAddon, api, terminals;
  const SESSION_ID = 'test-session';

  beforeEach(() => {
    terminal = createMockTerminal();
    fitAddon = createMockFitAddon();
    api = createMockApi();
    terminals = new Map();
    terminals.set(SESSION_ID, { terminal, fitAddon, wrapper: {} });
  });

  it('calls fitAddon.fit() for the active session', () => {
    fitActiveTerminal(SESSION_ID, terminals, api);
    expect(fitAddon.fit).toHaveBeenCalledOnce();
  });

  it('sends resizePty with current cols/rows', () => {
    fitActiveTerminal(SESSION_ID, terminals, api);
    expect(api.resizePty).toHaveBeenCalledWith(SESSION_ID, 120, 30);
  });

  it('calls syncScrollArea(true) on viewport', () => {
    fitActiveTerminal(SESSION_ID, terminals, api);
    expect(terminal._core.viewport.syncScrollArea).toHaveBeenCalledWith(true);
  });

  it('resets viewport scrollLeft to 0', () => {
    terminal._viewportEl.scrollLeft = 150;
    fitActiveTerminal(SESSION_ID, terminals, api);
    expect(terminal._viewportEl.scrollLeft).toBe(0);
  });

  it('clears xterm-screen inline width', () => {
    terminal._screenEl.style.width = '1500px';
    fitActiveTerminal(SESSION_ID, terminals, api);
    expect(terminal._screenEl.style.width).toBe('');
  });

  it('does nothing when no active session', () => {
    fitActiveTerminal(null, terminals, api);
    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(api.resizePty).not.toHaveBeenCalled();
  });

  it('does nothing when session not in terminals map', () => {
    fitActiveTerminal('nonexistent', terminals, api);
    expect(fitAddon.fit).not.toHaveBeenCalled();
  });

  it('handles missing _core.viewport gracefully', () => {
    terminal._core = null;
    expect(() => fitActiveTerminal(SESSION_ID, terminals, api)).not.toThrow();
    expect(fitAddon.fit).toHaveBeenCalledOnce();
  });

  it('handles missing terminal.element gracefully', () => {
    terminal.element = null;
    expect(() => fitActiveTerminal(SESSION_ID, terminals, api)).not.toThrow();
    expect(fitAddon.fit).toHaveBeenCalledOnce();
  });

  it('handles viewport querySelector returning null', () => {
    terminal.element.querySelector = vi.fn(() => null);
    expect(() => fitActiveTerminal(SESSION_ID, terminals, api)).not.toThrow();
    expect(fitAddon.fit).toHaveBeenCalledOnce();
  });
});

describe('toggleStatusPanel refit', () => {
  it('registers transitionend listener for width property', () => {
    const listeners = [];
    const statusPanel = {
      classList: {
        toggle: vi.fn(() => false), // returns false = panel opened
      },
      addEventListener: vi.fn((event, handler) => listeners.push({ event, handler })),
      removeEventListener: vi.fn(),
    };

    // Simulate toggleStatusPanel logic
    statusPanel.classList.toggle('collapsed');
    statusPanel.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName === 'width') {
        statusPanel.removeEventListener('transitionend', onEnd);
      }
    });

    expect(listeners).toHaveLength(1);
    expect(listeners[0].event).toBe('transitionend');

    // Simulate transition completing with width property
    listeners[0].handler({ propertyName: 'width' });
    expect(statusPanel.removeEventListener).toHaveBeenCalledWith('transitionend', expect.any(Function));
  });

  it('ignores transitionend for non-width properties', () => {
    const statusPanel = {
      classList: { toggle: vi.fn(() => false) },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    let handler;
    statusPanel.addEventListener = vi.fn((_, h) => { handler = h; });

    statusPanel.classList.toggle('collapsed');
    statusPanel.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName === 'width') {
        statusPanel.removeEventListener('transitionend', onEnd);
      }
    });

    // Fire with non-width property
    handler({ propertyName: 'padding' });
    expect(statusPanel.removeEventListener).not.toHaveBeenCalled();

    // Fire with width property
    handler({ propertyName: 'width' });
    expect(statusPanel.removeEventListener).toHaveBeenCalled();
  });
});

describe('ResizeObserver debounce', () => {
  it('debounces multiple rapid resize events into one fit call', async () => {
    vi.useFakeTimers();
    let fitCallCount = 0;
    const fitFn = () => { fitCallCount++; };

    // Simulate ResizeObserver debounce pattern
    let resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        fitFn();
      }, 50);
    }

    // Fire 5 rapid resizes
    onResize();
    onResize();
    onResize();
    onResize();
    onResize();

    // Before debounce completes
    expect(fitCallCount).toBe(0);

    // After debounce
    vi.advanceTimersByTime(50);
    expect(fitCallCount).toBe(1);

    vi.useRealTimers();
  });

  it('fires fit for each isolated resize after debounce window', async () => {
    vi.useFakeTimers();
    let fitCallCount = 0;
    const fitFn = () => { fitCallCount++; };

    let resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        fitFn();
      }, 50);
    }

    onResize();
    vi.advanceTimersByTime(50);
    expect(fitCallCount).toBe(1);

    onResize();
    vi.advanceTimersByTime(50);
    expect(fitCallCount).toBe(2);

    vi.useRealTimers();
  });
});

describe('scrollLeft reset on container resize', () => {
  it('resets scrollLeft after status panel opens (narrower container)', () => {
    const terminal = createMockTerminal(80, 24); // narrower after panel opens
    const fitAddon = createMockFitAddon();
    const api = createMockApi();
    const terminals = new Map();
    terminals.set('s1', { terminal, fitAddon, wrapper: {} });

    // Simulate: user had wide terminal, scrollLeft drifted
    terminal._viewportEl.scrollLeft = 200;
    terminal._screenEl.style.width = '1600px';

    fitActiveTerminal('s1', terminals, api);

    expect(terminal._viewportEl.scrollLeft).toBe(0);
    expect(terminal._screenEl.style.width).toBe('');
    expect(fitAddon.fit).toHaveBeenCalled();
    expect(api.resizePty).toHaveBeenCalledWith('s1', 80, 24);
  });

  it('resets scrollLeft even when already at 0 (no-op safe)', () => {
    const terminal = createMockTerminal();
    const fitAddon = createMockFitAddon();
    const api = createMockApi();
    const terminals = new Map();
    terminals.set('s1', { terminal, fitAddon, wrapper: {} });

    terminal._viewportEl.scrollLeft = 0;
    terminal._screenEl.style.width = '';

    fitActiveTerminal('s1', terminals, api);

    expect(terminal._viewportEl.scrollLeft).toBe(0);
    expect(terminal._screenEl.style.width).toBe('');
  });
});

describe('applyZoom scroll-to-bottom', () => {
  // Extracted zoom refit logic: after fitting each terminal, scroll to bottom
  function applyZoomRefit(terminals) {
    for (const [, entry] of terminals) {
      try {
        entry.fitAddon.fit();
      } catch (_) { /* ignore fit errors */ }
      try {
        entry.terminal.scrollToBottom();
      } catch (_) { /* ignore scroll errors */ }
    }
  }

  it('calls scrollToBottom on all terminals after fit', () => {
    const terminals = new Map();
    for (let i = 0; i < 3; i++) {
      terminals.set(`s${i}`, {
        fitAddon: createMockFitAddon(),
        terminal: { ...createMockTerminal(), scrollToBottom: vi.fn() },
      });
    }

    applyZoomRefit(terminals);

    for (const [, entry] of terminals) {
      expect(entry.fitAddon.fit).toHaveBeenCalledOnce();
      expect(entry.terminal.scrollToBottom).toHaveBeenCalledOnce();
    }
  });

  it('handles fit() throwing without stopping scroll', () => {
    const goodTerminal = { ...createMockTerminal(), scrollToBottom: vi.fn() };
    const badFit = { fit: vi.fn(() => { throw new Error('fit exploded'); }) };
    const badTerminal = { ...createMockTerminal(), scrollToBottom: vi.fn() };
    const goodFit2 = createMockFitAddon();
    const goodTerminal2 = { ...createMockTerminal(), scrollToBottom: vi.fn() };

    const terminals = new Map();
    terminals.set('s0', { fitAddon: createMockFitAddon(), terminal: goodTerminal });
    terminals.set('s1', { fitAddon: badFit, terminal: badTerminal });
    terminals.set('s2', { fitAddon: goodFit2, terminal: goodTerminal2 });

    expect(() => applyZoomRefit(terminals)).not.toThrow();

    // scrollToBottom still called on the terminal whose fit threw
    expect(badTerminal.scrollToBottom).toHaveBeenCalledOnce();
    // Other terminals processed normally
    expect(goodTerminal.scrollToBottom).toHaveBeenCalledOnce();
    expect(goodTerminal2.scrollToBottom).toHaveBeenCalledOnce();
    expect(goodFit2.fit).toHaveBeenCalledOnce();
  });

  it('handles scrollToBottom() throwing gracefully', () => {
    const terminal = {
      ...createMockTerminal(),
      scrollToBottom: vi.fn(() => { throw new Error('scroll exploded'); }),
    };
    const terminals = new Map();
    terminals.set('s0', { fitAddon: createMockFitAddon(), terminal });

    expect(() => applyZoomRefit(terminals)).not.toThrow();
    expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
  });
});
