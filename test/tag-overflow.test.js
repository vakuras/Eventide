import { describe, it, expect } from 'vitest';

// Mirrors the tag overflow click handler in renderer.js (sessionList click listener).
// Extracted for unit testing: given an overflowTag element and its sibling .tags-hidden,
// clicking the overflow badge should add 'expanded' to both.
function handleTagOverflowClick(overflowTag) {
  if (!overflowTag) return false;
  overflowTag.classList.add('expanded');
  const hidden = overflowTag.parentElement?.querySelector('.tags-hidden');
  if (hidden) hidden.classList.add('expanded');
  return true;
}

// Minimal DOM stub — just enough classList + querySelector support
function makeTagContainer(hiddenCount = 2) {
  const classes = new Set();
  const children = [];

  const tagsHidden = {
    classList: { _set: new Set(), add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); } },
    dataset: { settingsPanel: undefined },
  };

  const overflow = {
    classList: { _set: new Set(), add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); } },
    parentElement: {
      querySelector(sel) {
        return sel === '.tags-hidden' ? tagsHidden : null;
      },
    },
  };

  return { overflow, tagsHidden };
}

describe('tag overflow expand', () => {
  it('adds expanded class to overflow badge', () => {
    const { overflow } = makeTagContainer();
    handleTagOverflowClick(overflow);
    expect(overflow.classList.contains('expanded')).toBe(true);
  });

  it('adds expanded class to .tags-hidden sibling', () => {
    const { overflow, tagsHidden } = makeTagContainer();
    handleTagOverflowClick(overflow);
    expect(tagsHidden.classList.contains('expanded')).toBe(true);
  });

  it('returns true when overflow tag is present', () => {
    const { overflow } = makeTagContainer();
    expect(handleTagOverflowClick(overflow)).toBe(true);
  });

  it('returns false and does nothing when overflow tag is null', () => {
    expect(handleTagOverflowClick(null)).toBe(false);
  });

  it('calling twice is idempotent (expanded stays expanded)', () => {
    const { overflow, tagsHidden } = makeTagContainer();
    handleTagOverflowClick(overflow);
    handleTagOverflowClick(overflow);
    expect(overflow.classList.contains('expanded')).toBe(true);
    expect(tagsHidden.classList.contains('expanded')).toBe(true);
  });

  it('works even when .tags-hidden is absent', () => {
    const overflow = {
      classList: { _set: new Set(), add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); } },
      parentElement: { querySelector() { return null; } },
    };
    expect(() => handleTagOverflowClick(overflow)).not.toThrow();
    expect(overflow.classList.contains('expanded')).toBe(true);
  });
});
