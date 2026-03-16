import { describe, it, expect } from 'vitest';

// Extracted from renderer.js — simple LIFO stack for closed session IDs
class ClosedTabStack {
  constructor() { this.stack = []; }
  push(sessionId) { this.stack.push(sessionId); }
  pop() { return this.stack.pop() || null; }
  get length() { return this.stack.length; }
  clear() { this.stack = []; }
}

describe('ClosedTabStack', () => {
  it('push adds to stack', () => {
    const stack = new ClosedTabStack();
    stack.push('session-1');
    expect(stack.length).toBe(1);
  });

  it('pop returns last pushed (LIFO)', () => {
    const stack = new ClosedTabStack();
    stack.push('session-1');
    stack.push('session-2');
    stack.push('session-3');
    expect(stack.pop()).toBe('session-3');
    expect(stack.pop()).toBe('session-2');
    expect(stack.pop()).toBe('session-1');
  });

  it('pop returns null when empty', () => {
    const stack = new ClosedTabStack();
    expect(stack.pop()).toBeNull();
  });

  it('multiple push/pop maintains order', () => {
    const stack = new ClosedTabStack();
    stack.push('a');
    stack.push('b');
    expect(stack.pop()).toBe('b');
    stack.push('c');
    expect(stack.pop()).toBe('c');
    expect(stack.pop()).toBe('a');
    expect(stack.pop()).toBeNull();
  });

  it('length tracks correctly', () => {
    const stack = new ClosedTabStack();
    expect(stack.length).toBe(0);
    stack.push('x');
    expect(stack.length).toBe(1);
    stack.push('y');
    expect(stack.length).toBe(2);
    stack.pop();
    expect(stack.length).toBe(1);
    stack.pop();
    expect(stack.length).toBe(0);
  });

  it('clear empties the stack', () => {
    const stack = new ClosedTabStack();
    stack.push('a');
    stack.push('b');
    stack.push('c');
    expect(stack.length).toBe(3);
    stack.clear();
    expect(stack.length).toBe(0);
    expect(stack.pop()).toBeNull();
  });

  it('can push same ID multiple times', () => {
    const stack = new ClosedTabStack();
    stack.push('dup');
    stack.push('dup');
    stack.push('dup');
    expect(stack.length).toBe(3);
    expect(stack.pop()).toBe('dup');
    expect(stack.pop()).toBe('dup');
    expect(stack.pop()).toBe('dup');
    expect(stack.pop()).toBeNull();
  });
});
