import { describe, expect, it } from 'vitest';

import { canMoveTo, moveTarget } from './handoutQueue';

describe('canMoveTo', () => {
  it('allows a move inside the queue to another place', () => {
    expect(canMoveTo(4, 1, 0)).toBe(true);
    expect(canMoveTo(4, 2, 3)).toBe(true);
  });
  it('refuses the edges, the same place and a bad index', () => {
    expect(canMoveTo(4, 0, -1)).toBe(false);
    expect(canMoveTo(4, 3, 4)).toBe(false);
    expect(canMoveTo(4, 2, 2)).toBe(false);
    expect(canMoveTo(4, 4, 3)).toBe(false);
  });
});

describe('moveTarget', () => {
  it('is one place up or down', () => {
    expect(moveTarget(2, 'up')).toBe(1);
    expect(moveTarget(2, 'down')).toBe(3);
  });
});
