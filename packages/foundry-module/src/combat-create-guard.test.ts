import { describe, expect, it } from 'vitest';

import { guardCombatCreate, UNSTARTED_STATE } from './combat-create-guard.js';

interface FakeCombatLike {
  round: number;
  previous: unknown;
  _onCreate(...args: unknown[]): string;
}

function makeClass(): {
  FakeCombat: new () => FakeCombatLike;
  seen: unknown[];
} {
  const seen: unknown[] = [];
  class FakeCombat {
    round = 0;
    previous: unknown = undefined;
    _onCreate(...args: unknown[]): string {
      seen.push({ previous: this.previous, args });
      return 'done';
    }
  }
  return { FakeCombat, seen };
}

describe('guardCombatCreate', () => {
  it('gives a begun combat without a previous state the unstarted one', () => {
    const { FakeCombat, seen } = makeClass();
    expect(guardCombatCreate(FakeCombat)).toBe(true);
    const c = new FakeCombat();
    c.round = 1;
    expect(c._onCreate({ a: 1 }, {}, 'u')).toBe('done');
    expect(seen[0]).toEqual({ previous: UNSTARTED_STATE, args: [{ a: 1 }, {}, 'u'] });
  });

  it('leaves a combat that has a previous state, or has not begun, alone', () => {
    const { FakeCombat, seen } = makeClass();
    guardCombatCreate(FakeCombat);
    const begun = new FakeCombat();
    begun.round = 2;
    begun.previous = { round: 2 };
    begun._onCreate();
    const fresh = new FakeCombat();
    fresh._onCreate();
    expect(seen).toEqual([
      { previous: { round: 2 }, args: [] },
      { previous: undefined, args: [] },
    ]);
  });

  it('wraps once and refuses a class without _onCreate', () => {
    const { FakeCombat } = makeClass();
    guardCombatCreate(FakeCombat);
    const first = (FakeCombat.prototype as Record<string, unknown>)._onCreate;
    guardCombatCreate(FakeCombat);
    expect((FakeCombat.prototype as Record<string, unknown>)._onCreate).toBe(first);
    expect(guardCombatCreate({ prototype: {} })).toBe(false);
    expect(guardCombatCreate(undefined)).toBe(false);
  });
});
