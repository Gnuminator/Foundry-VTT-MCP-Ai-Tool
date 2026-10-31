import { describe, expect, it } from 'vitest';

import {
  canFight,
  defaultTicks,
  newNpcCombatantIds,
  npcTokenIds,
  pickerRows,
  sideWords,
  startArgs,
  type SceneToken,
} from './startCombat';

function tok(
  tokenId: string,
  name: string,
  category: SceneToken['category'],
  extra: Partial<SceneToken> = {}
): SceneToken {
  return { tokenId, name, actorId: `a-${tokenId}`, category, hidden: false, ...extra };
}

const SCENE = [
  tok('t4', 'Shopkeeper', 'npc'),
  tok('t2', 'Wolf', 'enemy'),
  tok('t1', 'Brannoc', 'pc'),
  tok('t3', 'Alder', 'pc'),
  tok('t5', 'Marker', 'enemy', { actorId: null }),
];

describe('the start-combat picker', () => {
  it('lists player characters, then Hostile, then the rest, by name', () => {
    expect(pickerRows(SCENE).map(t => t.name)).toEqual([
      'Alder',
      'Brannoc',
      'Marker',
      'Wolf',
      'Shopkeeper',
    ]);
    expect(pickerRows(undefined)).toEqual([]);
  });

  it('ticks player characters and Hostile tokens, not Neutral or Friendly, nor a token with no actor', () => {
    expect([...defaultTicks(pickerRows(SCENE))].sort()).toEqual(['t1', 't2', 't3']);
    expect(canFight(SCENE[4])).toBe(false);
  });

  it('sends the ticked tokens in the picker order, and never one that cannot fight', () => {
    const rows = pickerRows(SCENE);
    expect(startArgs(rows, new Set(['t4', 't2', 't5']))).toEqual({
      action: 'start',
      tokenIds: ['t2', 't4'],
    });
    expect(startArgs(rows, new Set()).tokenIds).toEqual([]);
    expect(startArgs(rows, new Set(['t2']), 'scene1').sceneId).toBe('scene1');
  });

  it('says Hostile for the enemies', () => {
    expect(sideWords(SCENE[1])).toBe('Hostile');
    expect(sideWords(SCENE[0])).toBe('Neutral or Friendly');
    expect(sideWords(SCENE[2])).toBe('PC');
  });
});

describe('rolling initiative for the fight just started', () => {
  it('names the ticked tokens that are not player characters', () => {
    const rows = pickerRows(SCENE);
    expect([...npcTokenIds(rows, new Set(['t1', 't2', 't4']))].sort()).toEqual(['t2', 't4']);
  });

  it('finds their combatants in the resolved fight and leaves the player characters out', () => {
    const state = {
      combatants: [
        { id: 'c1', tokenId: 't1', isPC: true },
        { id: 'c2', tokenId: 't2', isPC: false },
        { id: 'c9', tokenId: 'other', isPC: false },
      ],
    };
    expect(newNpcCombatantIds(state, new Set(['t1', 't2']))).toEqual(['c2']);
  });

  it('finds nothing when the resolved fight is another one, or the answer is odd', () => {
    expect(
      newNpcCombatantIds({ combatants: [{ id: 'old', tokenId: 'x' }] }, new Set(['t2']))
    ).toEqual([]);
    expect(newNpcCombatantIds(null, new Set(['t2']))).toEqual([]);
    expect(newNpcCombatantIds({ active: false }, new Set(['t2']))).toEqual([]);
  });
});
