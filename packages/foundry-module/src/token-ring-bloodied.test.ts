import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOODIED_RING_COLOR,
  installBloodiedRing,
  refreshRingsOfEffect,
  withBloodiedColor,
} from './token-ring-bloodied.js';

const g = globalThis as Record<string, unknown>;
let saved: unknown;

beforeEach(() => {
  saved = g.CONFIG;
});

afterEach(() => {
  g.CONFIG = saved;
});

interface FakeDoc {
  actor: { statuses: Set<string> } | null;
  getRingColors: () => Record<string, number>;
}

function fakeClass(base: () => Record<string, number>): new () => FakeDoc {
  class FakeTokenDocument {
    actor: { statuses: Set<string> } | null = null;
    getRingColors(): Record<string, number> {
      return base();
    }
  }
  g.CONFIG = { Token: { documentClass: FakeTokenDocument } };
  return FakeTokenDocument;
}

describe('withBloodiedColor', () => {
  it('adds the red ring only when bloodied and no colour is forced', () => {
    expect(withBloodiedColor({}, true)).toEqual({ ring: BLOODIED_RING_COLOR });
    expect(withBloodiedColor({}, false)).toEqual({});
    expect(withBloodiedColor({ ring: 0 }, true)).toEqual({ ring: 0 });
  });
});

describe('installBloodiedRing', () => {
  it('turns the ring red for a bloodied token and leaves a healthy one alone', () => {
    const Doc = fakeClass(() => ({}));
    expect(installBloodiedRing()).toBe(true);
    const hurt = new Doc();
    hurt.actor = { statuses: new Set(['bloodied']) };
    const fine = new Doc();
    fine.actor = { statuses: new Set() };
    expect(hurt.getRingColors()).toEqual({ ring: BLOODIED_RING_COLOR });
    expect(fine.getRingColors()).toEqual({});
    expect(new Doc().getRingColors()).toEqual({});
  });

  it('keeps the defeated black ring and does not wrap twice', () => {
    const Doc = fakeClass(() => ({ ring: 0 }));
    installBloodiedRing();
    installBloodiedRing();
    const token = new Doc();
    token.actor = { statuses: new Set(['bloodied', 'dead']) };
    expect(token.getRingColors()).toEqual({ ring: 0 });
  });

  it('returns false without a token document class', () => {
    g.CONFIG = {};
    expect(installBloodiedRing()).toBe(false);
  });
});

describe('refreshRingsOfEffect', () => {
  it('redraws the ring visuals of the actor tokens for the bloodied status only', () => {
    const set = vi.fn();
    const parent = {
      getActiveTokens: (): { renderFlags: { set: typeof set } }[] => [{ renderFlags: { set } }],
    };
    refreshRingsOfEffect({ parent, statuses: new Set(['bloodied']) });
    expect(set).toHaveBeenCalledWith({ refreshRingVisuals: true });
    set.mockClear();
    refreshRingsOfEffect({ parent, statuses: new Set(['poisoned']) });
    expect(set).not.toHaveBeenCalled();
  });
});
