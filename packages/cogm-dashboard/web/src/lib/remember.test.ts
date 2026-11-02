// The remembered choices: what comes back, and that a blocked or stale store never breaks a page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFoldChoices } from './duringFolds';
import {
  REMEMBER,
  readChoice,
  readJson,
  readMomentPin,
  readText,
  writeChoice,
  writeJson,
} from './remember';

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

describe('JSON choices', () => {
  it('read back what was written, and read nothing from text that is not JSON', () => {
    writeJson(REMEMBER.foldChoices, { a: 1 });
    expect(readJson(REMEMBER.foldChoices)).toEqual({ a: 1 });
    writeChoice(REMEMBER.foldChoices, '{oops');
    expect(readJson(REMEMBER.foldChoices)).toBeUndefined();
  });
});

describe('readFoldChoices', () => {
  it('keeps real situations and boolean folds, and drops the rest', () => {
    expect(
      readFoldChoices({
        'layered|calm|wide': { feed: true, party: 'yes', other: true },
        'layered|calm|huge': { feed: true },
        'auto|combat|phone': { handouts: false },
        'toggle|calm|medium': {},
      })
    ).toEqual({ 'layered|calm|wide': { feed: true }, 'auto|combat|phone': { handouts: false } });
  });

  it('gives no choices for anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 3, [1]]) expect(readFoldChoices(bad)).toEqual({});
  });
});

describe('readMomentPin', () => {
  it('reads a moment with the session state it was picked in', () => {
    expect(readMomentPin({ moment: 'after', open: false })).toEqual({
      moment: 'after',
      open: false,
    });
  });

  it('refuses a moment that does not exist or a missing flag', () => {
    expect(readMomentPin({ moment: 'later', open: true })).toBeNull();
    expect(readMomentPin({ moment: 'during' })).toBeNull();
    expect(readMomentPin(null)).toBeNull();
  });
});
