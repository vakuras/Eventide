import { describe, it, expect } from 'vitest';

// Extracted from main.js notification popup positioning logic
function calculateNotifPosition(workArea, activeCount) {
  const NOTIF_WIDTH = 360;
  const NOTIF_HEIGHT = 100;
  const PADDING = 20;
  const STACK_GAP = 8;
  const stackOffset = activeCount * (NOTIF_HEIGHT + STACK_GAP);
  const x = Math.round(workArea.x + workArea.width - NOTIF_WIDTH - PADDING);
  const y = Math.round(workArea.y + workArea.height - NOTIF_HEIGHT - PADDING - stackOffset);
  return { x, y, width: NOTIF_WIDTH, height: NOTIF_HEIGHT };
}

// Standard 1080p primary monitor
const PRIMARY_WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

describe('calculateNotifPosition', () => {
  it('first notification positioned at bottom-right (activeCount = 0)', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 0);
    expect(pos.x).toBe(1920 - 360 - 20); // 1540
    expect(pos.y).toBe(1040 - 100 - 20);  // 920
  });

  it('second notification stacked above first (activeCount = 1)', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 1);
    expect(pos.y).toBe(1040 - 100 - 20 - (100 + 8)); // 812
  });

  it('third notification stacks correctly (activeCount = 2)', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 2);
    expect(pos.y).toBe(1040 - 100 - 20 - 2 * (100 + 8)); // 704
  });

  it('works with non-zero workArea origin (multi-monitor)', () => {
    const secondMonitor = { x: 1920, y: 200, width: 2560, height: 1400 };
    const pos = calculateNotifPosition(secondMonitor, 0);
    expect(pos.x).toBe(1920 + 2560 - 360 - 20); // 4100
    expect(pos.y).toBe(200 + 1400 - 100 - 20);   // 1480
  });

  it('stacking gap is 8px between notifications', () => {
    const first = calculateNotifPosition(PRIMARY_WORK_AREA, 0);
    const second = calculateNotifPosition(PRIMARY_WORK_AREA, 1);
    // Gap between bottom of second and top of first = STACK_GAP
    expect(first.y - second.y).toBe(100 + 8); // 108
  });

  it('width is 360', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 0);
    expect(pos.width).toBe(360);
  });

  it('height is 100', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 0);
    expect(pos.height).toBe(100);
  });

  it('padding from screen edge is 20', () => {
    const pos = calculateNotifPosition(PRIMARY_WORK_AREA, 0);
    const rightEdge = PRIMARY_WORK_AREA.x + PRIMARY_WORK_AREA.width;
    const bottomEdge = PRIMARY_WORK_AREA.y + PRIMARY_WORK_AREA.height;
    expect(rightEdge - (pos.x + pos.width)).toBe(20);
    expect(bottomEdge - (pos.y + pos.height)).toBe(20);
  });
});
