import { describe, expect, it } from 'vitest';

import {
  canFight,
  defaultTicks,
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
