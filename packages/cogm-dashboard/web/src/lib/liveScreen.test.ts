import { describe, expect, it } from 'vitest';

import { LIVE_SCREEN_HREF, isLiveScreen } from './liveScreen';

describe('isLiveScreen', () => {
  it('is on for ?live=1 only', () => {
    expect(isLiveScreen('?live=1')).toBe(true);
    expect(isLiveScreen(new URL(LIVE_SCREEN_HREF, 'http://x/next/').search)).toBe(true);
    expect(isLiveScreen('')).toBe(false);
    expect(isLiveScreen('?live=0')).toBe(false);
    expect(isLiveScreen('?strip=1')).toBe(false);
  });
});
