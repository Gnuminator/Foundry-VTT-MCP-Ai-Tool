// The initiative ribbon's rules: the order from the current turn, the next two, the round break,
// the lair marker and who is out.
import { describe, expect, it } from 'vitest';

import type { CombatState } from './combat';
import { initialsOf, lairCount, ribbonItems, ribbonSummary, type RibbonItem } from './ribbon';
import { FIGHT, FIGHT_BOSS, FIGHT_DEATH_SAVES, combatant } from '../storybook/fixtures/combat';

/** A compact picture of the strip: `id:role`, `|round` and `lair:count`. */
function shape(items: RibbonItem[] | null): string[] {
  return (items ?? []).map(i =>
    i.kind === 'creature'
      ? `${i.id}:${i.role}`
      : i.kind === 'round'
        ? `|${i.round}`
        : `lair:${i.count}`
  );
}

describe('initialsOf', () => {
  it('takes two words or the start of one', () => {
    expect(initialsOf('Ogre Brute')).toBe('OB');
    expect(initialsOf('Brannoc')).toBe('BR');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('ribbonItems', () => {
  it('is null without a fight, without anybody, or on a turn outside the list', () => {
    expect(ribbonItems(null)).toBeNull();
    expect(ribbonItems({ ...FIGHT, combatants: [] })).toBeNull();
    expect(ribbonItems({ ...FIGHT, turn: 9 })).toBeNull();
    expect(ribbonItems({ ...FIGHT, turn: -1 })).toBeNull();
  });

  it('starts at the first turn with the current large, two next and the rest later', () => {
    expect(shape(ribbonItems(FIGHT))).toEqual([
      'pc-brannoc:current',
      'en-ogre:next',
      'pc-mira:next',
      'en-goblin:later',
      'np-tamsin:later',
    ]);
  });

  it('wraps into the next round after the last creature', () => {
    const state: CombatState = { ...FIGHT, turn: 3 };
    expect(shape(ribbonItems(state))).toEqual([
      'en-goblin:current',
      'np-tamsin:next',
      '|4',
      'pc-brannoc:next',
      'en-ogre:later',
      'pc-mira:later',
    ]);
  });

  it('never counts a defeated creature as next', () => {
    const state: CombatState = { ...FIGHT_DEATH_SAVES, turn: 1 };
    // Ogre is up; Mira (down on death saves but not defeated) is next, the goblin is out.
    expect(shape(ribbonItems(state))).toEqual([
      'en-ogre:current',
      'pc-mira:next',
      'en-goblin:down',
      'np-tamsin:next',
      '|4',
      'pc-brannoc:later',
    ]);
  });

  it('puts the lair marker before the first creature under its count', () => {
    // FIGHT_BOSS: wyrm 24, Brannoc 19, Mira 13, Tamsin 6; the lair counts 20; Brannoc is up.
    expect(shape(ribbonItems(FIGHT_BOSS))).toEqual([
      'pc-brannoc:current',
      'pc-mira:next',
      'np-tamsin:next',
      '|3',
      'en-wyrm:later',
      'lair:20',
    ]);
  });

  it('puts the lair at the end of the round when nobody is under its count', () => {
    const wyrm = combatant('w', 'Wyrm', {
      initiative: 25,
      boss: { legendary: null, resistances: null, lair: { inside: true, initiative: null } },
    });
    const state: CombatState = {
      active: true,
      round: 1,
      turn: 0,
      current: wyrm,
      combatants: [wyrm],
    };
    expect(shape(ribbonItems(state))).toEqual(['w:current', 'lair:20']);
  });

  it('carries concentration first among the conditions', () => {
    const c = combatant('a', 'Mira', { conditions: ['Prone', 'Concentrating: Bless'] });
    const items = ribbonItems({ active: true, round: 1, turn: 0, current: c, combatants: [c] });
    const first = items?.[0];
    expect(first?.kind === 'creature' && first.conditions).toEqual([
      'Concentrating: Bless',
      'Prone',
    ]);
    expect(first?.kind === 'creature' && first.concentrating).toBe(true);
  });
});

describe('ribbon portraits and pan target', () => {
  it('carries the token image and uuid of each creature', () => {
    const fight: CombatState = {
      ...FIGHT,
      combatants: FIGHT.combatants.map((c, i) =>
        i === 0 ? { ...c, img: 'http://x/a.webp', tokenUuid: 'Scene.s.Token.t' } : c
      ),
    };
    const first = ribbonItems(fight)?.find(i => i.kind === 'creature');
    expect(first).toMatchObject({ img: 'http://x/a.webp', tokenUuid: 'Scene.s.Token.t' });
    const other = ribbonItems(fight)?.filter(i => i.kind === 'creature')[1];
    expect(other).toMatchObject({ img: null, tokenUuid: null });
  });
});

describe('lairCount', () => {
  it('is null without a lair, the lair count with one, 20 by default', () => {
    expect(lairCount(FIGHT.combatants)).toBeNull();
    expect(lairCount(FIGHT_BOSS.combatants)).toBe(20);
  });
});

describe('ribbonSummary', () => {
  it('says whose turn it is and who follows', () => {
    expect(ribbonSummary(ribbonItems(FIGHT) ?? [])).toBe('Brannoc is up, then Ogre Brute and Mira');
  });
});
