// Copilot CLI's TUI enables xterm mouse tracking (CSI ?1000/1002/1003 h
// with optional SGR encoding via ?1006 h). While that mode is active,
// xterm.js forwards mouse events to the PTY as escape sequences instead
// of using them to create a text selection — which makes drag-to-select
// and the existing Ctrl+C "copy selection" handler silently no-op.
//
// Copilot CLI doesn't actually use mouse input inside its TUI, so we strip
// the mouse-tracking enable/disable sequences from PTY output before
// handing the data to terminal.write(). This restores native selection
// without changing how Copilot CLI runs.
//
// Background: https://github.com/itsela-ms/DeepSky/issues/13

// DEC private modes that enable/disable mouse reporting in xterm.js.
//   9    — X10 compatibility mouse reporting (legacy)
//   1000 — VT200 normal-click tracking
//   1001 — hilite tracking
//   1002 — button-event (drag) tracking
//   1003 — any-event tracking
//   1005 — UTF-8 mouse encoding
//   1006 — SGR mouse encoding
//   1015 — URXVT mouse encoding
//   1016 — SGR-Pixels mouse encoding
const MOUSE_MODE_IDS = new Set(['9', '1000', '1001', '1002', '1003', '1005', '1006', '1015', '1016']);

// Match a DEC private-mode set/reset CSI: ESC [ ? <params> h|l
// Parameters are one or more decimal numbers separated by ';'.
// We rewrite the parameter list to drop mouse-mode IDs; if nothing
// remains, the entire sequence is dropped.
const DECSET_RE = /\x1b\[\?([\d;]+)([hl])/g;

function stripMouseTracking(data) {
  if (data == null) return data;
  if (typeof data !== 'string') return data;
  if (data.indexOf('\x1b[?') === -1) return data;
  return data.replace(DECSET_RE, (match, params, finalByte) => {
    const kept = params.split(';').filter(p => !MOUSE_MODE_IDS.has(p));
    if (kept.length === 0) return '';
    if (kept.length === params.split(';').length) return match;
    return `\x1b[?${kept.join(';')}${finalByte}`;
  });
}

module.exports = { stripMouseTracking };
