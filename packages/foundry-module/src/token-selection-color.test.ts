import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SELECTION_COLOR, applySelectionColor } from './token-selection-color.js';

const g = globalThis as Record<string, unknown>;
let saved: { CONFIG: unknown; canvas: unknown };

beforeEach(() => {
  saved = { CONFIG: g.CONFIG, canvas: g.canvas };
});

afterEach(() => {
  g.CONFIG = saved.CONFIG;
  g.canvas = saved.canvas;
});

describe('applySelectionColor', () => {
  it('moves only the selection colour and redraws the borders of the tokens on the canvas', () => {
    const colors = { CONTROLLED: 0xff9829, HOSTILE: 0xe72124 };
    const set = vi.fn();
    g.CONFIG = { Canvas: { dispositionColors: colors } };
    g.canvas = { tokens: { placeables: [{ renderFlags: { set } }, { renderFlags: { set } }] } };
    expect(applySelectionColor()).toBe(true);
    expect(colors.CONTROLLED).toBe(SELECTION_COLOR);
    expect(colors.HOSTILE).toBe(0xe72124);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith({ refreshState: true, refreshBorder: true });
  });

  it('is a no-op without the disposition colours, and works before a canvas exists', () => {
    g.CONFIG = {};
    g.canvas = undefined;
    expect(applySelectionColor()).toBe(false);
    g.CONFIG = { Canvas: { dispositionColors: { CONTROLLED: 1 } } };
    expect(applySelectionColor()).toBe(true);
  });

  it('picks a colour that is none of core disposition colours or the turn marker orange', () => {
    // Core 14 defaults: hostile, neutral, friendly, inactive, party, secret, and the old controlled.
    const core = [0xe72124, 0xf1d836, 0x43dfdf, 0x555555, 0x33bc4e, 0xa612d4, 0xff9829];
    expect(core).not.toContain(SELECTION_COLOR);
  });
});
