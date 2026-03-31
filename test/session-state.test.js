import { describe, it, expect } from 'vitest';
const { deriveSessionState } = require('../src/session-state');

describe('deriveSessionState', () => {
  it('returns Idle when nothing is active', () => {
    const result = deriveSessionState({ isRunning: false, isActive: false, hasPR: false, isHistory: false, isBusy: false });
    expect(result).toEqual({ label: 'Idle', cls: 'state-idle', tip: 'New session \u2014 no activity yet' });
  });

  it('returns Working when running and busy', () => {
    const result = deriveSessionState({ isRunning: true, isActive: true, hasPR: false, isHistory: false, isBusy: true });
    expect(result).toEqual({ label: 'Working', cls: 'state-working', tip: 'AI is processing' });
  });

  it('returns Waiting when running but not busy', () => {
    const result = deriveSessionState({ isRunning: true, isActive: true, hasPR: false, isHistory: false, isBusy: false });
    expect(result).toEqual({ label: 'Waiting', cls: 'state-waiting', tip: 'Waiting on user response' });
  });

  it('returns Waiting when running and active but not busy', () => {
    const result = deriveSessionState({ isRunning: true, isActive: false, hasPR: false, isHistory: false, isBusy: false });
    expect(result).toEqual({ label: 'Waiting', cls: 'state-waiting', tip: 'Waiting on user response' });
  });

  it('returns Pending when has PR and not running', () => {
    const result = deriveSessionState({ isRunning: false, isActive: false, hasPR: true, isHistory: false, isBusy: false });
    expect(result).toEqual({ label: 'Pending PR', cls: 'state-pending', tip: 'Has a PR linked \u2014 waiting for review' });
  });

  it('returns Done when in history tab', () => {
    const result = deriveSessionState({ isRunning: false, isActive: false, hasPR: false, isHistory: true, isBusy: false });
    expect(result).toEqual({ label: '\u2713 Done', cls: 'state-done', tip: 'Session completed' });
  });

  // Priority tests
  it('Pending takes priority over Done (PR + history)', () => {
    const result = deriveSessionState({ isRunning: false, isActive: false, hasPR: true, isHistory: true, isBusy: false });
    expect(result).toEqual({ label: 'Pending PR', cls: 'state-pending', tip: 'Has a PR linked \u2014 waiting for review' });
  });

  it('Pending takes priority over Working (running + busy + PR)', () => {
    const result = deriveSessionState({ isRunning: true, isActive: true, hasPR: true, isHistory: false, isBusy: true });
    expect(result).toEqual({ label: 'Pending PR', cls: 'state-pending', tip: 'Has a PR linked \u2014 waiting for review' });
  });

  it('Pending takes priority over Waiting (running + PR + not busy)', () => {
    const result = deriveSessionState({ isRunning: true, isActive: false, hasPR: true, isHistory: false, isBusy: false });
    expect(result).toEqual({ label: 'Pending PR', cls: 'state-pending', tip: 'Has a PR linked \u2014 waiting for review' });
  });

  it('Done takes priority over Idle in history tab', () => {
    const result = deriveSessionState({ isRunning: false, isActive: false, hasPR: false, isHistory: true, isBusy: false });
    expect(result.cls).toBe('state-done');
  });

  it('isBusy false with running session yields Waiting, not Working', () => {
    const result = deriveSessionState({ isRunning: true, isActive: true, hasPR: false, isHistory: false, isBusy: false });
    expect(result.cls).toBe('state-waiting');
  });
});
