import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCombat } from './combat-resolve.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
});

/** A combat as the world lists it; `game.combat` is null (this browser views no fight). */
function add(id: string, round: number, createdTime?: number): void {
  const combat = world.setCombat({ id, round });
  if (createdTime !== undefined) (combat as any)._stats = { createdTime };
  (world as any).currentCombat = null;
}

describe('resolveCombat', () => {
  it("prefers this browser's live combat", () => {
    const live = world.setCombat({ id: 'live', round: 0 });
    expect(resolveCombat()).toBe(live);
  });

  it('is undefined when the world has no fight', () => {
    expect(resolveCombat()).toBeUndefined();
  });

  it('takes a started fight over a newer encounter nobody began', () => {
    add('running', 2, 100);
    add('prep', 0, 900);
    expect((resolveCombat() as any).id).toBe('running');
  });

  it('takes the newest by creation time, whatever the collection order', () => {
    add('newer', 1, 500);
    add('older', 1, 100);
    expect((resolveCombat() as any).id).toBe('newer');
  });

  it('falls back to the last in the collection when no times are known', () => {
    add('first', 1);
    add('last', 1);
    expect((resolveCombat() as any).id).toBe('last');
  });
});
