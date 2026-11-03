import { describe, expect, it } from 'vitest';

import type { AiChange } from './changes';
import type { Combatant, CombatState } from './combat';
import {
  chipText,
  chipTitle,
  conditionArgs,
  removeConditionArgs,
  turnText,
  displayNames,
  downWords,
  endQuestion,
  clearRefusedUndos,
  lastUndoable,
  markUndoRefused,
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

describe('removeConditionArgs and chipTitle', () => {
  it('turns one condition off on one token', () => {
    expect(removeConditionArgs('t1', 'prone')).toEqual({
      action: 'condition',
      targets: ['t1'],
      condition: 'prone',
      active: false,
    });
  });
  it('says the chip takes the condition off, and that an ended one is over', () => {
    expect(chipTitle('prone', undefined)).toBe('Click to take prone off.');
    expect(chipTitle('prone', 2)).toBe('Click to take prone off.');
    expect(chipTitle('restrained', 0)).toBe('Time is up. Click to take restrained off.');
  });
});

describe('turnText', () => {
  const fight = (a: Combatant, b: Combatant): CombatState => ({
    active: true,
    round: 3,
    turn: 1,
    current: b,
    combatants: [a, b],
  });
  it('names whose turn it is, with the numbered name', () => {
    const wolf1 = who('a', 'Wolf');
    const wolf2 = { ...who('b', 'Wolf'), isCurrentTurn: true };
    expect(turnText(fight(wolf1, wolf2), displayNames([wolf1, wolf2]))).toBe(
      "Round 3 · Wolf 2's turn"
    );
  });
  it('falls back to the round line when nobody has the turn', () => {
    expect(turnText(fight(who('a', 'Wolf'), who('b', 'Bat')), new Map())).toBe(
      'Round 3 · 2 combatants'
    );
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

  it('stops offering a change whose Undo was refused as a conflict', () => {
    clearRefusedUndos();
    expect(lastUndoable([change({ changeId: 'r' })])?.changeId).toBe('r');
    markUndoRefused('r');
    expect(lastUndoable([change({ changeId: 'r' })])).toBeNull();
    clearRefusedUndos();
  });

  it('labels the button with the change, cut when long', () => {
    expect(undoLabel(change({}))).toBe('Undo: Wolf 2: 12 fire damage');
    expect(undoLabel(null)).toBe('Nothing to undo');
    expect(undoLabel(change({ summary: 'x'.repeat(80) })).length).toBeLessThan(60);
  });
});
