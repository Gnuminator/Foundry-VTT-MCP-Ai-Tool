import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, amountOf, applyLabel, damageArgs } from './damageForm';

describe('damageArgs', () => {
  it('needs an amount and a target', () => {
    expect(damageArgs(EMPTY_DRAFT, ['Wolf 1'])).toBeNull();
    expect(damageArgs({ ...EMPTY_DRAFT, amount: '0' }, ['Wolf 1'])).toBeNull();
    expect(damageArgs({ ...EMPTY_DRAFT, amount: '5' }, [])).toBeNull();
  });

  it('plans typed damage on several targets', () => {
    expect(damageArgs({ mode: 'damage', amount: '8', type: 'fire' }, ['Wolf 1', 'Wolf 2'])).toEqual(
      {
        action: 'damage',
        targets: ['Wolf 1', 'Wolf 2'],
        amount: 8,
        damageType: 'fire',
      }
    );
  });

  it('leaves the type out for untyped damage and for healing', () => {
    expect(damageArgs({ mode: 'damage', amount: '3', type: 'none' }, ['A'])).not.toHaveProperty(
      'damageType'
    );
    expect(damageArgs({ mode: 'healing', amount: '3', type: 'fire' }, ['A'])).toEqual({
      action: 'healing',
      targets: ['A'],
      amount: 3,
    });
  });
});

describe('applyLabel', () => {
  it('says what the button does', () => {
    expect(applyLabel({ mode: 'damage', amount: '8', type: 'fire' }, ['Wolf 2'])).toBe(
      'Deal 8 fire damage to Wolf 2 in Foundry'
    );
    expect(applyLabel({ mode: 'healing', amount: '5', type: 'none' }, ['A', 'B', 'C'])).toBe(
      'Heal 3 tokens for 5 in Foundry'
    );
    expect(applyLabel(EMPTY_DRAFT, ['A'])).toBe('Deal … damage to A in Foundry');
  });

  it('reads the amount', () => {
    expect(amountOf({ ...EMPTY_DRAFT, amount: ' 12 ' })).toBe(12);
    expect(amountOf({ ...EMPTY_DRAFT, amount: '1.5' })).toBeNull();
  });
});
