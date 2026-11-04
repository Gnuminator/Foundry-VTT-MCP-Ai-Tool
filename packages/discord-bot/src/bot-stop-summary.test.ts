import { describe, expect, it } from 'vitest';

import { stopSummary } from './bot.js';

describe('stopSummary (the public /record stop reply)', () => {
  it('gives tracks and minutes only', () => {
    const text = stopSummary([1800, 1750, 1790], false);
    expect(text).toBe('Recording stopped and saved: 3 tracks, about 30 minutes.');
    expect(text).not.toMatch(/packet|\\|\/|\.ogg|\.opus/i);
  });

  it('says one track and one minute in the singular', () => {
    expect(stopSummary([20], false)).toBe('Recording stopped and saved: 1 track, about 1 minute.');
  });

  it('says what to do when part could not be written', () => {
    expect(stopSummary([600], true)).toContain('Tell the owner');
  });
});
