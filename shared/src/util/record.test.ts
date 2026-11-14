import { describe, expect, it } from 'vitest';

import { sleep } from './async.js';
import { asRecord, isRecord } from './record.js';

describe('isRecord and asRecord', () => {
  it('accepts plain objects only', () => {
    const obj = { a: 1 };
    expect(isRecord(obj)).toBe(true);
    expect(asRecord(obj)).toBe(obj);
    for (const v of [null, undefined, [], [1], 'x', 3, true]) {
      expect(isRecord(v)).toBe(false);
      expect(asRecord(v)).toBeNull();
    }
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
