// The remembered choices: what comes back, and that a blocked or stale store never breaks a page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REMEMBER, readChoice, readText, writeChoice } from './remember';

const TABS = ['tool', 'game', 'everything'] as const;

/** A localStorage over a Map; `blocked` makes every read and write throw, as blocked site data does. */
function stubStore(blocked = false): Map<string, string> {
  const data = new Map<string, string>();
  const guard = (): void => {
    if (blocked) throw new Error('blocked');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void data.set(k, v)),
  });
  return data;
}

beforeEach(() => void stubStore());
afterEach(() => vi.unstubAllGlobals());

describe('readChoice', () => {
  it('gives the default when nothing is saved', () => {
    expect(readChoice(REMEMBER.changesTab, TABS, 'tool')).toBe('tool');
  });

  it('gives back what was saved', () => {
    writeChoice(REMEMBER.changesTab, 'game');
    expect(readChoice(REMEMBER.changesTab, TABS, 'tool')).toBe('game');
  });

  it('gives the default for a value the picker no longer offers', () => {
    writeChoice(REMEMBER.changesTab, 'everyone');
    expect(readChoice(REMEMBER.changesTab, TABS, 'tool')).toBe('tool');
  });

  it('gives the default when the store throws, and a write then does nothing', () => {
    stubStore(true);
    expect(readChoice(REMEMBER.changesTab, TABS, 'tool')).toBe('tool');
    expect(readText(REMEMBER.changesPerson, 'all')).toBe('all');
    expect(() => writeChoice(REMEMBER.changesTab, 'game')).not.toThrow();
  });

  it('gives the default where there is no storage at all', () => {
    vi.unstubAllGlobals();
    expect(readChoice(REMEMBER.changesTab, TABS, 'tool')).toBe('tool');
  });
});

describe('readText', () => {
  it('keeps a free value such as a person', () => {
    writeChoice(REMEMBER.changesPerson, 'person:Brenna');
    expect(readText(REMEMBER.changesPerson, 'all')).toBe('person:Brenna');
  });
});

describe('the keys', () => {
  it('are all different and start with cogm_', () => {
    const keys = Object.values(REMEMBER);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(k => k.startsWith('cogm_'))).toBe(true);
  });
});
