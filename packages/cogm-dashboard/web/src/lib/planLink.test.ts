import { describe, expect, it } from 'vitest';

import { planIdFromSearch } from './planLink';

describe('planIdFromSearch', () => {
  it('reads a plan id', () => {
    expect(planIdFromSearch('?plan=plan-abc-123')).toBe('plan-abc-123');
    expect(planIdFromSearch('?token=x&plan=plan-1')).toBe('plan-1');
  });

  it('ignores anything that is not a plan id', () => {
    for (const search of [
      '',
      '?plan=',
      '?plan=abc',
      '?plan=plan-',
      '?plan=plan-UPPER',
      '?plan=plan-1%20x',
      '?plan=plan-a/../b',
      `?plan=plan-${'a'.repeat(81)}`,
      '?other=plan-1',
    ]) {
      expect([search, planIdFromSearch(search)]).toEqual([search, null]);
    }
  });
});
