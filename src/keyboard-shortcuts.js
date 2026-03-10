/**
 * Creates the xterm custom key event handler for a terminal session.
 *
 * Returns false  → let the event bubble up to the document-level keydown handler.
 * Returns true   → let xterm consume the event normally (standard terminal input).
 *
 * @param {string} sessionId - Active session identifier.
 * @param {import('@xterm/xterm').Terminal} terminal - The xterm terminal instance.
 * @param {object} api - The preload API bridge (window.api).
 */
function createTerminalKeyHandler(sessionId, terminal, api) {
  return (e) => {
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;

    // Bubble zoom shortcuts to the document handler
    if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) return false;

    // Bubble Ctrl+T and Ctrl+N to document handler for new session
    if (mod && (e.key === 't' || e.key === 'n')) return false;

    // Bubble Ctrl+Tab / Ctrl+Shift+Tab for tab switching
    if (e.ctrlKey && e.key === 'Tab') return false;

    // Bubble Ctrl+W for closing tabs
    if (mod && e.key === 'w') return false;

    // Bubble Ctrl+I for status panel toggle
    if (mod && e.key === 'i') return false;

    // Ctrl+C with a selection → copy to clipboard instead of sending SIGINT
    if (mod && e.key === 'c' && terminal.hasSelection()) {
      e.preventDefault();
      api.copyText(terminal.getSelection());
      terminal.clearSelection();
      return false;
    }

    // Ctrl+Backspace → delete previous word (sends \x17, equivalent to Ctrl+W in Unix shells)
    if (e.key === 'Backspace' && mod) {
      e.preventDefault();
      api.writePty(sessionId, '\x17');
      return false;
    }

    // Shift+Enter → insert a literal newline without executing the command
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      api.writePty(sessionId, '\n');
      return false;
    }

    // Ctrl+V / Shift+Insert → paste from clipboard
    const isPaste = (mod && e.key === 'v') || (e.shiftKey && e.key === 'Insert');
    if (isPaste) {
      e.preventDefault();
      api.pasteText().then(text => {
        if (text) api.writePty(sessionId, text);
      });
      return false;
    }

    return true;
  };
}

module.exports = { createTerminalKeyHandler };
