import { describe, expect, it } from 'vitest';

import { randomId } from './documents.js';

describe('foundry-mock randomId', () => {
  it('gives 16-character ids', () => {
    expect(randomId('actor')).toHaveLength(16);
    expect(randomId()).toHaveLength(16);
  });

  it('never repeats, even for a prefix of 16 characters or more', () => {
    const long = 'averyveryverylongtypename';
    const ids = new Set([randomId(long), randomId(long), randomId(long.slice(0, 16))]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toHaveLength(16);
  });
});
