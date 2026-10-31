import { describe, expect, it } from 'vitest';

import { LIVE_SCREEN_HREF, isLiveScreen, optInScreen } from './liveScreen';

describe('optInScreen', () => {
  it('picks the GM page by path, the strip and the Live view by query, else none', () => {
    expect(optInScreen('/gm', '')).toBe('gm');
    expect(optInScreen('/gm', '?strip=1')).toBe('gm');
    expect(optInScreen('/', '?strip=1')).toBe('strip');
    expect(optInScreen('/', '?strip=1&live=1')).toBe('strip');
    expect(optInScreen('/', '?live=1')).toBe('live');
    expect(optInScreen('/', '')).toBeNull();
    expect(optInScreen('/gmx', '?live=0')).toBeNull();
  });
});

describe('isLiveScreen', () => {
  it('is on for ?live=1 only', () => {
    expect(isLiveScreen('?live=1')).toBe(true);
    expect(isLiveScreen(new URL(LIVE_SCREEN_HREF, 'http://x/next/').search)).toBe(true);
    expect(isLiveScreen('')).toBe(false);
    expect(isLiveScreen('?live=0')).toBe(false);
    expect(isLiveScreen('?strip=1')).toBe(false);
  });
});
