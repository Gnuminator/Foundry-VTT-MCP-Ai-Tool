import { describe, expect, it } from 'vitest';

import { filterStash, goldLine, stashOf } from '../public/party-stash.js';

import { buildPartyStash } from './party-stash.js';

describe('buildPartyStash', () => {
  it('hides unidentified and secret items completely', () => {
    const s = buildPartyStash([
      {
        sheets: [
          {
            id: 'a',
            name: 'Brenna',
            inventory: [
              { name: 'Vorpal Sword', type: 'weapon', quantity: 1, identified: false },
              { name: 'Real Name', type: 'loot', quantity: 1, secret: true },
              { name: 'Rope', type: 'loot', quantity: 3 },
              { name: 'Rings', type: 'loot', quantity: 5, identified: false },
            ],
          },
        ],
      },
    ]);
    expect(s.holders[0].items).toEqual([
      { name: 'Rope', quantity: 3, type: 'loot', unidentified: false },
      { name: 'Unidentified item', quantity: 1, type: 'unknown', unidentified: true },
      { name: 'Unidentified item', quantity: 1, type: 'unknown', unidentified: true },
      { name: 'Unidentified item', quantity: 1, type: 'unknown', unidentified: true },
    ]);
    expect(JSON.stringify(s)).not.toMatch(/Vorpal|Real Name/);
  });

  it('sums coins exactly in gold and counts a shared character once', () => {
    const sheet = { id: 'a', name: 'B', currency: { pp: 1, gp: 2, ep: 1, sp: 3, cp: 4 } };
    const s = buildPartyStash([{ sheets: [sheet] }, { sheets: [sheet] }, 'junk', null]);
    expect(s.holders).toHaveLength(1);
    expect(s.totalGold).toBe(12.84);
  });
});

describe('filterStash', () => {
  const stash = stashOf({
    holders: [
      { name: 'A', items: [{ name: 'Rope', quantity: 2 }] },
      { name: 'B', items: [{ name: 'Unidentified item', unidentified: true }] },
    ],
    totalGold: 5,
  });
  it('filters by name and drops empty holders', () => {
    expect(filterStash(stash, 'rop').map(h => h.name)).toEqual(['A']);
    expect(filterStash(stash, '')).toHaveLength(2);
    expect(filterStash(stash, 'sword')).toEqual([]);
  });
  it('formats gold', () => {
    expect(goldLine(5)).toBe('5 gp');
    expect(goldLine(52.57)).toBe('52.57 gp');
  });
});
