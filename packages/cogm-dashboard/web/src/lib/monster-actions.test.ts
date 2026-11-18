import { describe, expect, it } from 'vitest';

import {
  actionsOf,
  activityArgs,
  applyArgs,
  applyQuestion,
  damageParts,
  readActivity,
  resultLine,
} from './monster-actions';

const items = (n: number): unknown => ({
  matches: Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `Attack ${i}`,
    hasAttack: true,
  })),
});

describe('actionsOf', () => {
  it('keeps at most four attacks', () => {
    expect(actionsOf(items(6)).map(a => a.id)).toEqual(['i0', 'i1', 'i2', 'i3']);
  });
  it('is empty for an unreadable answer', () => {
    expect(actionsOf(null)).toEqual([]);
  });
});

describe('activityArgs', () => {
  it('runs the item on the token', () => {
    expect(activityArgs('tok', 'i1')).toEqual({ actor: 'tok', itemName: 'i1', isPublic: true });
  });
});

describe('readActivity and resultLine', () => {
  const hit = readActivity({
    item: 'Scimitar',
    attackTotal: 17,
    targetAC: 15,
    targetName: 'Ilvara',
    hit: true,
    isCritical: true,
    damageTotal: 9,
    damageByType: [{ type: 'slashing', total: 9 }],
  });
  it('words a hit', () => {
    expect(resultLine('Goblin', 'x', hit)).toBe(
      'Goblin, Scimitar: 17 vs AC 15 at Ilvara: hit, critical, 9 damage'
    );
  });
  it('words a miss without damage', () => {
    const miss = readActivity({ attackTotal: 8, targetAC: 15, hit: false, damageTotal: 5 });
    expect(resultLine('Goblin', 'Bow', miss)).toBe('Goblin, Bow: 8 vs AC 15: miss');
    expect(damageParts(miss)).toEqual([]);
  });
  it('asks to check the card when the verdict is unknown', () => {
    expect(resultLine('G', 'Bow', readActivity({}))).toContain('check the chat card');
  });
});

describe('damageParts and applyArgs', () => {
  it('splits by type, else one untyped part', () => {
    const typed = readActivity({
      hit: true,
      damageTotal: 12,
      damageByType: [
        { type: 'piercing', total: 7 },
        { type: 'poison', total: 5 },
      ],
    });
    expect(damageParts(typed)).toHaveLength(2);
    const plain = readActivity({ hit: null, damageTotal: 4 });
    expect(damageParts(plain)).toEqual([{ type: null, total: 4 }]);
  });
  it('builds plan-actor-change arguments', () => {
    expect(applyArgs('t', { type: 'fire', total: 3 })).toEqual({
      action: 'damage',
      targets: ['t'],
      amount: 3,
      damageType: 'fire',
    });
    expect(applyArgs('t', { type: null, total: 3 })).not.toHaveProperty('damageType');
    expect(applyQuestion('Ilvara', { type: 'fire', total: 3 })).toBe(
      'Deal 3 fire damage to Ilvara?'
    );
  });
});
