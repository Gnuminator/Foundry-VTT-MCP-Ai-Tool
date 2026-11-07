import { describe, expect, it } from 'vitest';

import { createAlertLimit } from './alert-limit.js';

describe('createAlertLimit', () => {
  it('lets one alert through per window and the next one after it', () => {
    const allow = createAlertLimit(5 * 60_000);
    expect(allow(1_000)).toBe(true);
    expect(allow(1_001)).toBe(false);
    expect(allow(1_000 + 5 * 60_000 - 1)).toBe(false);
    expect(allow(1_000 + 5 * 60_000)).toBe(true);
    expect(allow(1_000 + 5 * 60_000 + 1)).toBe(false);
  });
});
