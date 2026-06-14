import { describe, it, expect } from 'vitest';

const { stripMouseTracking } = require('../src/pty-data-filter');

describe('stripMouseTracking', () => {
  it('strips X10 / button-event / any-event mouse tracking enables', () => {
    expect(stripMouseTracking('\x1b[?1000h')).toBe('');
    expect(stripMouseTracking('\x1b[?1002h')).toBe('');
    expect(stripMouseTracking('\x1b[?1003h')).toBe('');
  });

  it('strips the matching disables', () => {
    expect(stripMouseTracking('\x1b[?1000l')).toBe('');
    expect(stripMouseTracking('\x1b[?1002l')).toBe('');
    expect(stripMouseTracking('\x1b[?1003l')).toBe('');
  });

  it('strips SGR / URXVT / UTF-8 mouse-encoding toggles', () => {
    expect(stripMouseTracking('\x1b[?1005h')).toBe('');
    expect(stripMouseTracking('\x1b[?1005l')).toBe('');
    expect(stripMouseTracking('\x1b[?1006h')).toBe('');
    expect(stripMouseTracking('\x1b[?1006l')).toBe('');
    expect(stripMouseTracking('\x1b[?1015h')).toBe('');
    expect(stripMouseTracking('\x1b[?1015l')).toBe('');
  });

  it('strips hilite tracking (1001)', () => {
    expect(stripMouseTracking('\x1b[?1001h')).toBe('');
    expect(stripMouseTracking('\x1b[?1001l')).toBe('');
  });

  it('strips legacy X10 mouse mode (9) and SGR-Pixels (1016)', () => {
    expect(stripMouseTracking('\x1b[?9h')).toBe('');
    expect(stripMouseTracking('\x1b[?9l')).toBe('');
    expect(stripMouseTracking('\x1b[?1016h')).toBe('');
    expect(stripMouseTracking('\x1b[?1016l')).toBe('');
  });

  it('strips combined mouse-only mode sequences (e.g. ?1000;1002;1006h)', () => {
    expect(stripMouseTracking('\x1b[?1000;1002;1006h')).toBe('');
    expect(stripMouseTracking('\x1b[?1002;1006h')).toBe('');
    expect(stripMouseTracking('\x1b[?1006;1002l')).toBe('');
    expect(stripMouseTracking('\x1b[?1002;1006;1016h')).toBe('');
  });

  it('removes only the mouse params from mixed-mode sequences, keeping the rest', () => {
    // Mouse drag (1002) bundled with cursor-show (25): drop 1002, keep 25.
    expect(stripMouseTracking('\x1b[?25;1002h')).toBe('\x1b[?25h');
    expect(stripMouseTracking('\x1b[?1002;25h')).toBe('\x1b[?25h');
    // Alt screen (1049) + SGR mouse (1006) + bracketed paste (2004) — keep alt screen and paste.
    expect(stripMouseTracking('\x1b[?1049;1006;2004h')).toBe('\x1b[?1049;2004h');
  });

  it('leaves unrelated private-mode sequences intact', () => {
    // Cursor show, alt screen, bracketed paste, app cursor keys — none are mouse modes.
    expect(stripMouseTracking('\x1b[?25h')).toBe('\x1b[?25h');
    expect(stripMouseTracking('\x1b[?25l')).toBe('\x1b[?25l');
    expect(stripMouseTracking('\x1b[?1049h')).toBe('\x1b[?1049h');
    expect(stripMouseTracking('\x1b[?1049l')).toBe('\x1b[?1049l');
    expect(stripMouseTracking('\x1b[?2004h')).toBe('\x1b[?2004h');
    expect(stripMouseTracking('\x1b[?1h')).toBe('\x1b[?1h');
  });

  it('leaves SGR color sequences and plain text intact', () => {
    expect(stripMouseTracking('\x1b[38;5;42mhello\x1b[0m')).toBe('\x1b[38;5;42mhello\x1b[0m');
    expect(stripMouseTracking('plain text with no escapes')).toBe('plain text with no escapes');
  });

  it('removes only the tracking sequences embedded in mixed content', () => {
    const input = 'before\x1b[?1002h\x1b[?1006hmiddle\x1b[?1002l\x1b[?1006lafter';
    expect(stripMouseTracking(input)).toBe('beforemiddleafter');
  });

  it('preserves a Copilot-CLI-style startup blob minus the mouse enables', () => {
    // Realistic mix: alt screen on, mouse tracking on, hide cursor, write text.
    const input = '\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[?25lContent\x1b[?25h';
    expect(stripMouseTracking(input)).toBe('\x1b[?1049h\x1b[?25lContent\x1b[?25h');
  });

  it('handles empty, null, and undefined input without throwing', () => {
    expect(stripMouseTracking('')).toBe('');
    expect(stripMouseTracking(null)).toBe(null);
    expect(stripMouseTracking(undefined)).toBe(undefined);
  });

  it('passes non-string input through unchanged', () => {
    const buf = Buffer.from([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x30, 0x32, 0x68]);
    expect(stripMouseTracking(buf)).toBe(buf);
  });
});
