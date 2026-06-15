// Bridges mouse-wheel events to the PTY using SGR-encoded mouse-button
// reports, while preventing xterm.js from translating wheel events into
// cursor-up/down keys.
//
// Background: src/pty-data-filter.js strips the DECSET mouse-tracking
// enables (?1000/1002/1006/...) so that drag-to-select works and the
// existing Ctrl+C copy handler fires. The side effect is that xterm.js
// no longer forwards wheel events to the PTY as mouse reports, and
// instead falls back to translating wheel-up/down into cursor key
// sequences whenever the alt screen buffer is active or application
// cursor keys mode is on. In a REPL like Copilot CLI's TUI that
// corrupts the prompt by cycling input history.
//
// Copilot CLI's TUI does consume wheel events when delivered as SGR
// mouse reports — that's how scrolling worked before mouse tracking
// was stripped. So we resynthesize just the wheel events (not drag or
// click) and write them to the PTY, then return false to suppress
// xterm.js's default fallback handling. The net effect: wheel scrolls
// the TUI's own rendered history, while drag and click stay as native
// browser-level selection.

const DEFAULT_PIXELS_PER_LINE = 100;
const SGR_BUTTON_WHEEL_UP = 64;
const SGR_BUTTON_WHEEL_DOWN = 65;
const MAX_TICKS_PER_EVENT = 10;

function deltaToTicks(event, terminal) {
  const deltaY = (event && typeof event.deltaY === 'number') ? event.deltaY : 0;
  if (deltaY === 0) return 0;
  let ticks;
  if (event.deltaMode === 1) {
    // Line mode: one wheel notch == one line.
    ticks = deltaY;
  } else if (event.deltaMode === 2) {
    // Page mode: one notch == one viewport of rows.
    ticks = deltaY * Math.max(1, terminal?.rows || 1);
  } else {
    // Pixel mode: rough conversion to ticks. ~100px per tick is the typical
    // notched-wheel delta in Chromium.
    ticks = deltaY / DEFAULT_PIXELS_PER_LINE;
  }
  if (ticks > 0) return Math.min(MAX_TICKS_PER_EVENT, Math.max(1, Math.round(ticks)));
  return Math.max(-MAX_TICKS_PER_EVENT, Math.min(-1, Math.round(ticks)));
}

function buildSgrWheelSequence(direction, x, y) {
  const button = direction > 0 ? SGR_BUTTON_WHEEL_DOWN : SGR_BUTTON_WHEEL_UP;
  return `\x1b[<${button};${x};${y}M`;
}

function pickCell(event, terminal, wrapper) {
  // Best-effort cell coords. Copilot CLI's TUI ignores the exact location;
  // any cell inside the viewport works. Fall back to (1, 1) if anything
  // about the geometry is unavailable.
  try {
    if (wrapper && typeof wrapper.getBoundingClientRect === 'function') {
      const rect = wrapper.getBoundingClientRect();
      const cellW = rect.width / Math.max(1, terminal?.cols || 1);
      const cellH = rect.height / Math.max(1, terminal?.rows || 1);
      const col = Math.min(Math.max(1, Math.floor((event.clientX - rect.left) / cellW) + 1), terminal?.cols || 1);
      const row = Math.min(Math.max(1, Math.floor((event.clientY - rect.top) / cellH) + 1), terminal?.rows || 1);
      if (Number.isFinite(col) && Number.isFinite(row)) return { x: col, y: row };
    }
  } catch (_) { /* fall through */ }
  return { x: 1, y: 1 };
}

function createTerminalWheelHandler({ terminal, sessionId, api, wrapper } = {}) {
  return function handleWheel(event) {
    if (!terminal || !api || typeof api.writePty !== 'function') return true;
    try {
      const ticks = deltaToTicks(event, terminal);
      if (ticks === 0) return false;
      const { x, y } = pickCell(event, terminal, wrapper);
      const seq = buildSgrWheelSequence(ticks, x, y);
      const payload = seq.repeat(Math.abs(ticks));
      api.writePty(sessionId, payload);
    } catch (_) {
      // Defensive: never let the wheel handler crash the renderer.
    }
    return false;
  };
}

module.exports = {
  createTerminalWheelHandler,
  deltaToTicks,
  buildSgrWheelSequence,
};

