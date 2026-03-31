import { describe, it, expect } from 'vitest';

const { resolveSidebarDragWidth } = require('../src/sidebar-resize');

describe('resolveSidebarDragWidth', () => {
  const limits = { minWidth: 200, maxWidth: 450 };

  it('collapses when dragged all the way left', () => {
    expect(resolveSidebarDragWidth(0, limits)).toEqual({ mode: 'collapsed' });
  });

  it('collapses when dragged below the minimum expanded width', () => {
    expect(resolveSidebarDragWidth(68, limits)).toEqual({ mode: 'collapsed' });
    expect(resolveSidebarDragWidth(199, limits)).toEqual({ mode: 'collapsed' });
  });

  it('expands at the minimum width threshold', () => {
    expect(resolveSidebarDragWidth(200, limits)).toEqual({ mode: 'expanded', width: 200 });
  });

  it('keeps expanded widths within the allowed range', () => {
    expect(resolveSidebarDragWidth(280, limits)).toEqual({ mode: 'expanded', width: 280 });
    expect(resolveSidebarDragWidth(900, limits)).toEqual({ mode: 'expanded', width: 450 });
  });
});
