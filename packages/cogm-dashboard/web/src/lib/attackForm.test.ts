import { describe, expect, it } from 'vitest';

import {
  FOUNDRY_TARGETS,
  attackArgs,
  attackLabel,
  attackers,
  defaultAttacker,
  defaultTarget,
  spellAttacksOf,
  weaponsOf,
} from './attackForm';
import type { Combatant } from './combat';

const c = (id: string, over: Partial<Combatant> = {}): Combatant =>
  ({
    id,
    name: id,
    isCurrentTurn: false,
    defeated: false,
    tokenId: `tok-${id}`,
    ...over,
  }) as Combatant;

describe('attackers', () => {
  it('drops combatants without a token or defeated', () => {
    const list = [c('a'), c('b', { tokenId: null }), c('d', { defeated: true })];
    expect(attackers(list).map(x => x.id)).toEqual(['a']);
  });
});

describe('defaultAttacker', () => {
  it('is the current turn, else the first', () => {
    expect(defaultAttacker([c('a'), c('b', { isCurrentTurn: true })])).toBe('b');
    expect(defaultAttacker([c('a'), c('b')])).toBe('a');
    expect(defaultAttacker([])).toBe('');
  });
});

describe('defaultTarget', () => {
  it('takes exactly one other picked combatant, else Foundry targets', () => {
    expect(defaultTarget(['b'], 'a')).toBe('b');
    expect(defaultTarget(['a', 'b'], 'a')).toBe('b');
    expect(defaultTarget(['a'], 'a')).toBe(FOUNDRY_TARGETS);
    expect(defaultTarget(['b', 'd'], 'a')).toBe(FOUNDRY_TARGETS);
    expect(defaultTarget([], 'a')).toBe(FOUNDRY_TARGETS);
  });
});

describe('weaponsOf', () => {
  it('keeps matches with an id and a name', () => {
    expect(
      weaponsOf({ matches: [{ id: 'w1', name: 'Scimitar' }, { id: 3 }, null, { name: 'x' }] })
    ).toEqual([{ id: 'w1', name: 'Scimitar', label: 'Scimitar' }]);
    expect(
      weaponsOf({
        matches: [
          { id: 'w1', name: 'Scimitar', hasAttack: true },
          { id: 'w2', name: 'Shield', hasAttack: false },
          { id: 'w3', name: 'Dagger' },
        ],
      }).map(w => w.id)
    ).toEqual(['w1', 'w3']);
    expect(weaponsOf(null)).toEqual([]);
    expect(weaponsOf({})).toEqual([]);
  });
});

describe('spellAttacksOf', () => {
  it('keeps cantrips and prepared spells that have an attack, labelled by level', () => {
    expect(
      spellAttacksOf({
        matches: [
          { id: 's1', name: 'Toll the Dead', level: 0, hasAttack: true },
          { id: 's2', name: 'Guiding Bolt', level: 1, prepared: true, hasAttack: true },
          { id: 's3', name: 'Inflict Wounds', level: 1, prepared: false, hasAttack: true },
          { id: 's4', name: 'Bless', level: 1, prepared: true },
          { name: 'no id', hasAttack: true },
        ],
      })
    ).toEqual([
      { id: 's1', name: 'Toll the Dead', label: 'Toll the Dead (cantrip)' },
      { id: 's2', name: 'Guiding Bolt', label: 'Guiding Bolt (level 1)' },
    ]);
    expect(spellAttacksOf(null)).toEqual([]);
  });
});

describe('attackArgs', () => {
  it('needs attacker, weapon and a target', () => {
    expect(attackArgs(null, 'w', ['t'])).toBeNull();
    expect(attackArgs('a', '', ['t'])).toBeNull();
    expect(attackArgs('a', 'w', [])).toBeNull();
  });

  it('asks use-item to roll the attack', () => {
    expect(attackArgs('a', 'w', ['t1', 't2'])).toEqual({
      actorIdentifier: 'a',
      itemIdentifier: 'w',
      targets: ['t1', 't2'],
      rollAttack: true,
    });
  });
});

describe('attackLabel', () => {
  it('says what the button does', () => {
    expect(attackLabel('Randal', 'Scimitar', 'Wolf 1')).toBe('Randal attacks Wolf 1 with Scimitar');
    expect(attackLabel('Randal', '', 'Wolf 1')).toBe('Pick a weapon or spell');
  });
});
