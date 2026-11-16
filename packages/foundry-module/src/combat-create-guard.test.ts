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

  it('gives a mutable copy, and a restored fight its own current state', () => {
    const { FakeCombat, seen } = makeClass();
    guardCombatCreate(FakeCombat);
    const c = new FakeCombat();
    c.round = 1;
    c._onCreate({}, {}, 'u');
    const prev = (seen[0] as { previous: object }).previous;
    expect(prev).not.toBe(UNSTARTED_STATE);
    expect(Object.isFrozen(prev)).toBe(false);

    const back = new FakeCombat();
    back.round = 3;
    (back as unknown as { current: object }).current = { round: 3, turn: 2 };
    back._onCreate({}, { 'foundry-mcp-bridge': { changeMode: 'undo' } }, 'u');
    expect((seen[1] as { previous: unknown }).previous).toEqual({ round: 3, turn: 2 });
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

  it('keeps the captured _onCreate of a class that has its own', () => {
    class Base {
      round = 0;
      previous: unknown = undefined;
      _onCreate(): string {
        return 'base';
      }
    }
    class Child extends Base {
      override _onCreate(): string {
        return 'own';
      }
    }
    expect(guardCombatCreate(Child)).toBe(true);
    const c = new Child();
    expect(c._onCreate()).toBe('own');
    // Patching the parent does not replace a class's own _onCreate.
    (Base.prototype as unknown as { _onCreate: () => string })._onCreate = (): string => 'patched';
    expect(c._onCreate()).toBe('own');
  });

  it('looks up an inherited _onCreate on the parent prototype on every call', () => {
    class Base {
      round = 0;
      previous: unknown = undefined;
      _onCreate(): string {
        return 'base';
      }
    }
    class Child extends Base {}
    expect(guardCombatCreate(Child)).toBe(true);
    const c = new Child();
    expect(c._onCreate()).toBe('base');
    // A patch registered on the parent after the guard went in is not skipped.
    (Base.prototype as unknown as { _onCreate: () => string })._onCreate = (): string => 'patched';
    expect(c._onCreate()).toBe('patched');
  });
});
