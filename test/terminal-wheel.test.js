import { describe, it, expect, vi } from 'vitest';

const {
  createTerminalWheelHandler,
  deltaToTicks,
  buildSgrWheelSequence,
} = require('../src/terminal-wheel');

function makeApi() {
  return { writePty: vi.fn() };
}

function makeTerminal({ rows = 24, cols = 80 } = {}) {
  return { rows, cols };
}

function makeWrapper({ left = 0, top = 0, width = 800, height = 480 } = {}) {
  return {
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
  };
}

function wheel(overrides = {}) {
  return { deltaY: 0, deltaMode: 0, clientX: 10, clientY: 10, ...overrides };
}

describe('buildSgrWheelSequence', () => {
  it('encodes wheel-up as button 64 with M terminator', () => {
    expect(buildSgrWheelSequence(-1, 5, 7)).toBe('\x1b[<64;5;7M');
  });

  it('encodes wheel-down as button 65 with M terminator', () => {
    expect(buildSgrWheelSequence(1, 5, 7)).toBe('\x1b[<65;5;7M');
  });
});

describe('deltaToTicks', () => {
  it('returns 0 for zero deltaY', () => {
    expect(deltaToTicks(wheel({ deltaY: 0 }), makeTerminal())).toBe(0);
  });

  it('pixel-mode deltas (deltaMode 0) divide by ~100px per tick', () => {
    expect(deltaToTicks(wheel({ deltaY: 100, deltaMode: 0 }), makeTerminal())).toBe(1);
    expect(deltaToTicks(wheel({ deltaY: 300, deltaMode: 0 }), makeTerminal())).toBe(3);
    expect(deltaToTicks(wheel({ deltaY: -100, deltaMode: 0 }), makeTerminal())).toBe(-1);
  });

  it('line-mode deltas (deltaMode 1) pass through directly', () => {
    expect(deltaToTicks(wheel({ deltaY: 3, deltaMode: 1 }), makeTerminal())).toBe(3);
    expect(deltaToTicks(wheel({ deltaY: -3, deltaMode: 1 }), makeTerminal())).toBe(-3);
  });

  it('page-mode deltas (deltaMode 2) multiply by terminal rows', () => {
    // Single page should be capped at MAX_TICKS_PER_EVENT (10).
    expect(deltaToTicks(wheel({ deltaY: 1, deltaMode: 2 }), makeTerminal({ rows: 20 }))).toBe(10);
    expect(deltaToTicks(wheel({ deltaY: -1, deltaMode: 2 }), makeTerminal({ rows: 20 }))).toBe(-10);
  });

  it('small pixel deltas still register as at least one tick in the wheel direction', () => {
    expect(deltaToTicks(wheel({ deltaY: 10, deltaMode: 0 }), makeTerminal())).toBe(1);
    expect(deltaToTicks(wheel({ deltaY: -10, deltaMode: 0 }), makeTerminal())).toBe(-1);
  });

  it('caps very large deltas to MAX_TICKS_PER_EVENT (10)', () => {
    expect(deltaToTicks(wheel({ deltaY: 5000, deltaMode: 0 }), makeTerminal())).toBe(10);
    expect(deltaToTicks(wheel({ deltaY: -5000, deltaMode: 0 }), makeTerminal())).toBe(-10);
  });

  it('handles missing or non-numeric deltaY safely', () => {
    expect(deltaToTicks({}, makeTerminal())).toBe(0);
    expect(deltaToTicks({ deltaY: 'nope' }, makeTerminal())).toBe(0);
    expect(deltaToTicks(null, makeTerminal())).toBe(0);
    expect(deltaToTicks(undefined, makeTerminal())).toBe(0);
  });
});

describe('createTerminalWheelHandler', () => {
  it('cancels xterm default and writes wheel-down SGR escape to the PTY', () => {
    const api = makeApi();
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper(),
    });
    const result = handler(wheel({ deltaY: 100, deltaMode: 0 }));
    expect(result).toBe(false);
    expect(api.writePty).toHaveBeenCalledTimes(1);
    const [sessionId, payload] = api.writePty.mock.calls[0];
    expect(sessionId).toBe('sess-1');
    // One tick, button 65 (down), M terminator. Coords vary by wrapper.
    expect(payload).toMatch(/^\x1b\[<65;\d+;\d+M$/);
  });

  it('writes wheel-up SGR escape on negative deltaY', () => {
    const api = makeApi();
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper(),
    });
    handler(wheel({ deltaY: -100, deltaMode: 0 }));
    expect(api.writePty.mock.calls[0][1]).toMatch(/^\x1b\[<64;\d+;\d+M$/);
  });

  it('repeats the escape once per tick for larger deltas', () => {
    const api = makeApi();
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper(),
    });
    handler(wheel({ deltaY: 300, deltaMode: 0 }));
    const payload = api.writePty.mock.calls[0][1];
    // 3 ticks => 3 copies of the SGR wheel-down sequence
    expect(payload.match(/\x1b\[<65;/g)?.length).toBe(3);
  });

  it('does not call writePty when deltaY is zero', () => {
    const api = makeApi();
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper(),
    });
    handler(wheel({ deltaY: 0 }));
    expect(api.writePty).not.toHaveBeenCalled();
  });

  it('returns true (lets xterm handle the event) when api is missing', () => {
    const handler = createTerminalWheelHandler({ terminal: makeTerminal(), sessionId: 's', api: null });
    expect(handler(wheel({ deltaY: 100 }))).toBe(true);
  });

  it('does not throw if writePty throws', () => {
    const api = { writePty: () => { throw new Error('boom'); } };
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper(),
    });
    expect(() => handler(wheel({ deltaY: 100 }))).not.toThrow();
  });

  it('falls back to (1, 1) cell coords when no wrapper is provided', () => {
    const api = makeApi();
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal(),
      sessionId: 'sess-1',
      api,
    });
    handler(wheel({ deltaY: 100 }));
    expect(api.writePty.mock.calls[0][1]).toBe('\x1b[<65;1;1M');
  });

  it('derives cell coords from wrapper geometry when present', () => {
    const api = makeApi();
    // 800x480 wrapper at origin, 80 cols x 24 rows => cell ~10x20.
    const handler = createTerminalWheelHandler({
      terminal: makeTerminal({ cols: 80, rows: 24 }),
      sessionId: 'sess-1',
      api,
      wrapper: makeWrapper({ width: 800, height: 480 }),
    });
    handler(wheel({ deltaY: 100, clientX: 95, clientY: 95 }));
    // 95/10 = 9.5 => floor 9 + 1 = 10 (col); 95/20 = 4.75 => floor 4 + 1 = 5 (row).
    expect(api.writePty.mock.calls[0][1]).toBe('\x1b[<65;10;5M');
  });
});
