import { describe, expect, it } from 'vitest';

import { noticed } from './notice';

describe('noticed (I-078)', () => {
  it('passes at the DC and above, fails below', () => {
    expect(noticed(14, 14)).toBe(true);
    expect(noticed(15, 14)).toBe(true);
    expect(noticed(13, 14)).toBe(false);
  });

  it('is undecided without a DC or a score', () => {
    expect(noticed(14, null)).toBeNull();
    expect(noticed(null, 10)).toBeNull();
    expect(noticed(undefined, 10)).toBeNull();
  });
});
