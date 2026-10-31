import { describe, expect, it } from 'vitest';

import type { AiChange } from './changes';
import type { Combatant } from './combat';
import {
  chipText,
  conditionArgs,
  displayNames,
  downWords,
  endQuestion,
  lastUndoable,
  pickText,
  undoLabel,
} from './liveStrip';

const hp = (value: number): Combatant['hp'] => ({ value, max: 20, temp: 0 });

function who(id: string, name: string): Combatant {
  return {
    id,
    name,
    initiative: 10,
    isCurrentTurn: false,
    hp: hp(10),
    conditions: [],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    boss: null,
    tokenId: `t-${id}`,
    tokenUuid: null,
    img: null,
  };
}

function change(over: Partial<AiChange>): AiChange {
  return {
    changeId: 'c1',
    summary: 'Wolf 2: 12 fire damage',
    feature: 'actor-change',
    target: '',
    appliedAt: '2026-10-30T20:00:00.000Z',
    mode: '',
    undoneBy: '',
    risk: 'write',
    canUndo: true,
    diff: [],
    requestedBy: '',
    ...over,
  };
}

describe('displayNames', () => {
  it('numbers creatures that share a name, in order, and leaves single names alone', () => {
    const names = displayNames([
      who('a', 'Bandit'),
      who('b', 'Ilvara'),
      who('c', 'Bandit'),
      who('d', 'Bandit'),
    ]);
    expect(names.get('a')).toBe('Bandit 1');
    expect(names.get('b')).toBe('Ilvara');
    expect(names.get('c')).toBe('Bandit 2');
    expect(names.get('d')).toBe('Bandit 3');
  });

  it('keeps names the world already numbered', () => {
    const names = displayNames([who('a', 'Wolf 1'), who('b', 'Wolf 2')]);
    expect([...names.values()]).toEqual(['Wolf 1', 'Wolf 2']);
  });
});

describe('downWords', () => {
  it('says nothing for a creature with hit points', () => {
    expect(downWords({ hp: hp(1), defeated: false, isPC: true })).toBeNull();
  });
  it('says dead for a monster at 0 and down, death saves for a player character', () => {
    expect(downWords({ hp: hp(0), defeated: true, isPC: false })).toBe('dead');
    expect(downWords({ hp: hp(0), defeated: false, isPC: true })).toBe('down, death saves');
  });
});

describe('pickText', () => {
  it('asks for a pick when empty, names one or two, counts more', () => {
    expect(pickText([])).toBe('pick a creature');
    expect(pickText(['Wolf 1'])).toBe('Wolf 1');
    expect(pickText(['Wolf 1', 'Wolf 2'])).toBe('Wolf 1 and Wolf 2');
    expect(pickText(['a', 'b', 'c'])).toBe('3 creatures');
  });
});

describe('chipText', () => {
  it('names an untimed condition as it is', () => {
    expect(chipText('Prone', undefined)).toBe('Prone');
  });
  it('says the rounds left, singular or plural, and when the time is up', () => {
    expect(chipText('Prone', 1)).toBe('Prone, 1 round');
    expect(chipText('Prone', 3)).toBe('Prone, 3 rounds');
    expect(chipText('Prone', 0)).toBe('Prone, ended');
  });
});

describe('conditionArgs', () => {
  it('adds the rounds when given', () => {
    expect(conditionArgs(['t1'], 'prone', 1)).toEqual({
      action: 'condition',
      targets: ['t1'],
      condition: 'prone',
      active: true,
      rounds: 1,
    });
  });
  it('turns a condition on for the tokens, with no duration', () => {
    expect(conditionArgs(['t1', 't2'], 'prone')).toEqual({
      action: 'condition',
      targets: ['t1', 't2'],
      condition: 'prone',
      active: true,
    });
  });
});

describe('endQuestion', () => {
  it('names the scene in words and says where Undo is', () => {
    expect(
      endQuestion('End combat on "Death House" (round 2, 5 combatants)', 'Not the effects.')
    ).toBe(
      'End combat on "Death House" (round 2, 5 combatants)? Undo stays in Recent Changes. Not the effects.'
    );
    expect(endQuestion(null, null)).toBe('End the fight? Undo stays in Recent Changes.');
  });
});

describe('the Undo button', () => {
  it('offers only the newest change, never an older one', () => {
    expect(lastUndoable([change({ changeId: 'z' }), change({ changeId: 'y' })])?.changeId).toBe(
      'z'
    );
    // After an undo the newest entry is the undo itself: nothing to offer.
    expect(
      lastUndoable([
        change({ changeId: 'u', mode: 'undo' }),
        change({ changeId: 'x', undoneBy: 'u' }),
      ])
    ).toBeNull();
    expect(
      lastUndoable([change({ changeId: 'y', canUndo: false }), change({ changeId: 'z' })])
    ).toBeNull();
    expect(lastUndoable([change({ changeId: 'x', undoneBy: 'u' })])).toBeNull();
    expect(lastUndoable([])).toBeNull();
  });

  it('labels the button with the change, cut when long', () => {
    expect(undoLabel(change({}))).toBe('Undo: Wolf 2: 12 fire damage');
    expect(undoLabel(null)).toBe('Nothing to undo');
    expect(undoLabel(change({ summary: 'x'.repeat(80) })).length).toBeLessThan(60);
  });
});
