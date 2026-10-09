import { describe, expect, it } from 'vitest';
import { activitySummary, itemEntityDetails } from './data-access/item-entity.js';

describe('activitySummary', () => {
  it('reads a save activity from its prepared labels', () => {
    expect(
      activitySummary({
        id: 'save000000000000',
        name: 'Breath',
        type: 'save',
        labels: {
          activation: '1 Action',
          target: '15 ft Cone',
          save: 'DC 13 Dexterity',
          damages: [{ formula: '2d6', label: '2d6 Fire' }],
        },
        uses: { spent: 0, max: 1, recovery: [{ period: 'sr' }] },
      })
    ).toEqual({
      id: 'save000000000000',
      name: 'Breath',
      type: 'save',
      activation: '1 Action',
      target: '15 ft Cone',
      save: 'DC 13 Dexterity',
      damage: '2d6 Fire',
      uses: { value: 1, max: 1, recovery: 'sr' },
    });
  });

  it('falls back to the raw activation type and `_id` when there are no labels', () => {
    expect(
      activitySummary({ _id: 'util000000000000', type: 'utility', activation: { type: 'bonus' } })
    ).toEqual({ id: 'util000000000000', name: '', type: 'utility', activation: 'bonus' });
  });
});

describe('itemEntityDetails', () => {
  it('reports rarity, quantity, equipped and attunement of a magic weapon', () => {
    expect(
      itemEntityDetails('weapon', {
        rarity: 'rare',
        quantity: 1,
        equipped: true,
        attunement: 'required',
        attuned: true,
        level: 5,
      })
    ).toEqual({
      rarity: 'rare',
      quantity: 1,
      equipped: true,
      attunement: 'required',
      attuned: true,
    });
  });

  it('gives a cantrip level 0 and leaves unset fields out', () => {
    expect(itemEntityDetails('spell', { level: 0, school: 'evo', attunement: '' })).toEqual({
      level: 0,
      school: 'evo',
    });
  });

  it('reads activities stored as an object keyed by id (source data)', () => {
    const details = itemEntityDetails('feat', {
      activities: {
        a1: { _id: 'a1', type: 'heal', labels: { activation: '1 Bonus Action' } },
        a2: { _id: 'a2', type: 'utility' },
      },
    });
    expect(details.activities?.map(a => [a.id, a.type, a.activation])).toEqual([
      ['a1', 'heal', '1 Bonus Action'],
      ['a2', 'utility', undefined],
    ]);
  });

  it('has no activities key for an item without any', () => {
    expect(itemEntityDetails('loot', { activities: { contents: [] } })).toEqual({});
  });
});
