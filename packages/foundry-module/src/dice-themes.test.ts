/**
 * Themed dice (I-085): the Dice So Nice colour sets are added on every client when Dice So Nice
 * is ready, and nothing happens without it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DICE_COLORSETS, addDiceThemes, registerDiceThemes } from './dice-themes.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('addDiceThemes', () => {
  it('adds The Veil and Neutral as named colour sets', async () => {
    const addColorset = vi.fn().mockResolvedValue(undefined);
    expect(await addDiceThemes({ addColorset })).toBe(2);
    expect(addColorset.mock.calls.map(c => [c[0].name, c[0].description, c[1]])).toEqual([
      ['ai-tool-veil', 'AI Tool: The Veil', 'default'],
      ['ai-tool-neutral', 'AI Tool: Neutral', 'default'],
    ]);
  });

  it('does nothing without a usable Dice So Nice API', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await addDiceThemes(undefined)).toBe(0);
    expect(await addDiceThemes({})).toBe(0);
    expect(await addDiceThemes({ addColorset: 'not a function' })).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps going when one colour set fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const addColorset = vi
      .fn()
      .mockRejectedValueOnce(new Error('bad'))
      .mockResolvedValue(undefined);
    expect(await addDiceThemes({ addColorset })).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses only hex colours and no em dashes', () => {
    for (const set of DICE_COLORSETS) {
      for (const key of ['foreground', 'background', 'outline', 'edge'] as const) {
        expect(set[key]).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(set.description).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('registerDiceThemes', () => {
  it('waits for diceSoNiceReady on every client, players included', async () => {
    g.game.user = { ...g.game.user, isGM: false };
    const once = vi.fn();
    g.Hooks.once = once;
    registerDiceThemes();
    expect(once).toHaveBeenCalledWith('diceSoNiceReady', expect.any(Function));
    const addColorset = vi.fn().mockResolvedValue(undefined);
    (once.mock.calls[0]?.[1] as (api: unknown) => void)({ addColorset });
    await vi.waitFor(() => expect(addColorset).toHaveBeenCalledTimes(2));
  });
});
