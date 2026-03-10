import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createTerminalKeyHandler } = require('../src/keyboard-shortcuts');

/** Build a minimal synthetic keydown event. */
function key(overrides = {}) {
  return {
    type: 'keydown',
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe('createTerminalKeyHandler', () => {
  const SESSION_ID = 'test-session-1';
  let terminal, api, handler;

  beforeEach(() => {
    terminal = {
      hasSelection: vi.fn().mockReturnValue(false),
      getSelection: vi.fn().mockReturnValue('selected text'),
      clearSelection: vi.fn(),
    };
    api = {
      copyText: vi.fn(),
      writePty: vi.fn(),
      pasteText: vi.fn().mockResolvedValue('pasted'),
    };
    handler = createTerminalKeyHandler(SESSION_ID, terminal, api);
  });

  // ── Passthrough ──────────────────────────────────────────────────────────

  it('passes through non-keydown events unchanged', () => {
    expect(handler({ type: 'keyup', key: 'a', ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
    expect(handler({ type: 'keypress', key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
  });

  it('passes through regular printable keys', () => {
    expect(handler(key({ key: 'a' }))).toBe(true);
    expect(handler(key({ key: 'Z' }))).toBe(true);
    expect(handler(key({ key: ' ' }))).toBe(true);
  });

  it('passes through plain Enter', () => {
    expect(handler(key({ key: 'Enter' }))).toBe(true);
  });

  it('passes through plain Backspace', () => {
    expect(handler(key({ key: 'Backspace' }))).toBe(true);
  });

  // ── Bubble-to-document shortcuts ─────────────────────────────────────────

  it('bubbles Ctrl+= (zoom in)', () => {
    expect(handler(key({ ctrlKey: true, key: '=' }))).toBe(false);
  });

  it('bubbles Ctrl++ (zoom in)', () => {
    expect(handler(key({ ctrlKey: true, key: '+' }))).toBe(false);
  });

  it('bubbles Ctrl+- (zoom out)', () => {
    expect(handler(key({ ctrlKey: true, key: '-' }))).toBe(false);
  });

  it('bubbles Ctrl+0 (zoom reset)', () => {
    expect(handler(key({ ctrlKey: true, key: '0' }))).toBe(false);
  });

  it('bubbles Ctrl+N (new session)', () => {
    expect(handler(key({ ctrlKey: true, key: 'n' }))).toBe(false);
  });

  it('bubbles Ctrl+T (new session)', () => {
    expect(handler(key({ ctrlKey: true, key: 't' }))).toBe(false);
  });

  it('bubbles Ctrl+Tab (next tab)', () => {
    expect(handler(key({ ctrlKey: true, key: 'Tab' }))).toBe(false);
  });

  it('bubbles Ctrl+Shift+Tab (previous tab)', () => {
    expect(handler(key({ ctrlKey: true, shiftKey: true, key: 'Tab' }))).toBe(false);
  });

  it('bubbles Ctrl+W (close tab)', () => {
    expect(handler(key({ ctrlKey: true, key: 'w' }))).toBe(false);
  });

  it('bubbles Ctrl+I (status panel toggle)', () => {
    expect(handler(key({ ctrlKey: true, key: 'i' }))).toBe(false);
  });

  // ── Ctrl+C copy ───────────────────────────────────────────────────────────

  it('Ctrl+C with selection: copies text and clears selection', () => {
    terminal.hasSelection.mockReturnValue(true);
    const e = key({ ctrlKey: true, key: 'c' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.copyText).toHaveBeenCalledWith('selected text');
    expect(terminal.clearSelection).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+C without selection: passes through as SIGINT', () => {
    terminal.hasSelection.mockReturnValue(false);
    const result = handler(key({ ctrlKey: true, key: 'c' }));

    expect(result).toBe(true);
    expect(api.copyText).not.toHaveBeenCalled();
    expect(terminal.clearSelection).not.toHaveBeenCalled();
  });

  // ── Ctrl+Backspace word delete ────────────────────────────────────────────

  it('Ctrl+Backspace: sends word-backward-delete (\\x17) to PTY', () => {
    const e = key({ ctrlKey: true, key: 'Backspace' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.writePty).toHaveBeenCalledWith(SESSION_ID, '\x17');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('Meta+Backspace (macOS): also sends word-backward-delete (\\x17)', () => {
    const e = key({ metaKey: true, key: 'Backspace' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.writePty).toHaveBeenCalledWith(SESSION_ID, '\x17');
  });

  // ── Shift+Enter newline ───────────────────────────────────────────────────

  it('Shift+Enter: sends literal newline (\\n) to PTY', () => {
    const e = key({ shiftKey: true, key: 'Enter' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.writePty).toHaveBeenCalledWith(SESSION_ID, '\n');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('Shift+Enter: does not trigger paste logic', () => {
    const e = key({ shiftKey: true, key: 'Enter' });
    handler(e);
    expect(api.pasteText).not.toHaveBeenCalled();
  });

  // ── Paste shortcuts ───────────────────────────────────────────────────────

  it('Ctrl+V: calls pasteText and returns false', () => {
    const e = key({ ctrlKey: true, key: 'v' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.pasteText).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+V: writes pasted text to PTY when content is available', async () => {
    api.pasteText.mockResolvedValue('clipboard content');
    handler(key({ ctrlKey: true, key: 'v' }));

    await vi.waitFor(() => {
      expect(api.writePty).toHaveBeenCalledWith(SESSION_ID, 'clipboard content');
    });
  });

  it('Ctrl+V: does not write to PTY when clipboard is empty', async () => {
    api.pasteText.mockResolvedValue('');
    handler(key({ ctrlKey: true, key: 'v' }));

    await vi.waitFor(() => {
      expect(api.writePty).not.toHaveBeenCalled();
    });
  });

  it('Shift+Insert: triggers paste (same as Ctrl+V)', () => {
    const e = key({ shiftKey: true, key: 'Insert' });
    const result = handler(e);

    expect(result).toBe(false);
    expect(api.pasteText).toHaveBeenCalled();
  });

  // ── Meta (macOS Cmd) equivalents ──────────────────────────────────────────

  it('Meta+= bubbles for zoom (macOS)', () => {
    expect(handler(key({ metaKey: true, key: '=' }))).toBe(false);
  });

  it('Meta+N bubbles for new session (macOS)', () => {
    expect(handler(key({ metaKey: true, key: 'n' }))).toBe(false);
  });

  it('Meta+V triggers paste (macOS)', () => {
    const result = handler(key({ metaKey: true, key: 'v' }));
    expect(result).toBe(false);
    expect(api.pasteText).toHaveBeenCalled();
  });

  // ── Session ID isolation ──────────────────────────────────────────────────

  it('uses the correct sessionId when writing to PTY', () => {
    const specificHandler = createTerminalKeyHandler('my-unique-session', terminal, api);
    specificHandler(key({ ctrlKey: true, key: 'Backspace' }));
    expect(api.writePty).toHaveBeenCalledWith('my-unique-session', '\x17');
  });
});
