// The combat strip's rules: reading a fight off the stream, the side tag, the hit point bar, which
// rows get a reaction button, the boss prompts, the reaction ticks, selection, the action bar and
// when the strip is out of date. Pure functions, no DOM.
import { describe, expect, it } from 'vitest';

import {
  AWAY_TEXT,
  NO_REACTIONS,
  NO_VALUE,
  SAMPLE_COMBAT,
  bossLine,
  bossPrompts,
  bridgeAway,
  canSelect,
  deathSavesWords,
  hpPercent,
  hpText,
  hpTone,
  hpWords,
  isBoss,
  lairTurnIndex,
  livingBosses,
  metaText,
  planRequest,
  pruneSelection,
  reactionLabel,
  reactionsFor,
  readCombat,
  selectedNames,
  showBossToggle,
  showDeathSaves,
  showReaction,
  sideOf,
  stripMode,
  toggleReaction,
  toggleSelection,
  type Combatant,
  type CombatState,
} from './combat';

const who = (over: Partial<Combatant> = {}): Combatant => ({
  id: 'a',
  name: 'Alder',
  initiative: 10,
  isCurrentTurn: false,
  hp: { value: 10, max: 20, temp: 0 },
  conditions: [],
  isPC: false,
  category: 'npc',
  defeated: false,
  deathSaves: null,
  boss: null,
  ...over,
});

const legendary = (remaining: number, max = 3): Combatant['boss'] => ({
  legendary: { max, spent: max - remaining, remaining },
  resistances: null,
  lair: null,
});

const fight = (combatants: Combatant[], over: Partial<CombatState> = {}): CombatState => ({
  active: true,
  round: 1,
  turn: 0,
  current: combatants[0] ?? null,
  combatants,
  ...over,
});

describe('reading a fight off the stream', () => {
  it('is null without a fight, and for anything that is not one', () => {
    expect(readCombat(null)).toBeNull();
    expect(readCombat(undefined)).toBeNull();
    expect(readCombat({ active: false, combatants: [] })).toBeNull();
    expect(readCombat('fight')).toBeNull();
    expect(readCombat([])).toBeNull();
  });

  it('keeps the bridge order and every field the strip uses', () => {
    const combat = readCombat({
      active: true,
      round: 3,
      turn: 1,
      current: { id: 'b', name: 'Bram' },
      combatants: [
        {
          id: 'a',
          name: 'Alder',
          initiative: 18,
          isPC: true,
          category: 'pc',
          hp: { value: 5, max: 9, temp: 2 },
        },
        {
          id: 'b',
          name: 'Bram',
          initiative: null,
          isCurrentTurn: true,
          conditions: ['prone', 7],
          category: 'enemy',
          defeated: true,
          deathSaves: { successes: 1, failures: 2 },
          boss: {
            legendary: { max: 3, spent: 1, remaining: 2 },
            lair: { inside: true, initiative: 20 },
          },
        },
      ],
    });
    expect(combat?.round).toBe(3);
    expect(combat?.turn).toBe(1);
    expect(combat?.combatants.map(c => c.id)).toEqual(['a', 'b']);
    expect(combat?.combatants[0]?.hp).toEqual({ value: 5, max: 9, temp: 2 });
    expect(combat?.combatants[1]).toMatchObject({
      initiative: null,
      isCurrentTurn: true,
      conditions: ['prone'],
      defeated: true,
      deathSaves: { successes: 1, failures: 2 },
      boss: {
        legendary: { remaining: 2 },
        resistances: null,
        lair: { inside: true, initiative: 20 },
      },
    });
    expect(combat?.current?.name).toBe('Bram');
  });

  it('skips a combatant it cannot read and reads a fight with nobody in it', () => {
    const combat = readCombat({ active: true, round: 1, combatants: [{ name: 'No id' }, 4, null] });
    expect(combat?.combatants).toEqual([]);
    expect(readCombat({ active: true })?.combatants).toEqual([]);
  });
});

describe('a row', () => {
  it('is a PC, an enemy or an NPC', () => {
    expect(sideOf(who({ isPC: true, category: 'pc' }))).toBe('pc');
    expect(sideOf(who({ category: 'enemy' }))).toBe('enemy');
    expect(sideOf(who({ category: 'npc' }))).toBe('npc');
    expect(sideOf(who({ category: 'something-else' }))).toBe('npc');
    expect(sideOf(who({ isPC: true, category: 'enemy' }))).toBe('pc');
  });

  it('fills the hit point bar from 0 to 100 and picks its colour at a third and two thirds', () => {
    expect(hpPercent({ value: 10, max: 20 })).toBe(50);
    expect(hpPercent({ value: -4, max: 20 })).toBe(0);
    expect(hpPercent({ value: 30, max: 20 })).toBe(100);
    expect(hpPercent({ value: 5, max: 0 })).toBe(0);
    expect(hpTone({ value: 20, max: 20 })).toBe('');
    expect(hpTone({ value: 14, max: 20 })).toBe('');
    expect(hpTone({ value: 66, max: 100 })).toBe('mid');
    expect(hpTone({ value: 34, max: 100 })).toBe('mid');
    expect(hpTone({ value: 33, max: 100 })).toBe('low');
    expect(hpTone({ value: 0, max: 100 })).toBe('low');
    expect(hpTone({ value: 3, max: 0 })).toBe('low');
  });

  it('writes the hit points, with temporary ones, and says them in words', () => {
    expect(hpText({ value: 12, max: 40, temp: 0 })).toBe('12/40');
    expect(hpText({ value: 12, max: 40, temp: 5 })).toBe('12/40 +5');
    expect(hpWords({ value: 12, max: 40, temp: 0 })).toBe('12 of 40 hit points');
    expect(hpWords({ value: 12, max: 40, temp: 5 })).toBe('12 of 40 hit points, 5 temporary');
  });

  it('shows death saves only at zero hit points or less, and only when the bridge sent them', () => {
    const saves = { successes: 1, failures: 2 };
    expect(showDeathSaves(who({ hp: { value: 0, max: 9, temp: 0 }, deathSaves: saves }))).toBe(
      true
    );
    expect(showDeathSaves(who({ hp: { value: -2, max: 9, temp: 0 }, deathSaves: saves }))).toBe(
      true
    );
    expect(showDeathSaves(who({ hp: { value: 1, max: 9, temp: 0 }, deathSaves: saves }))).toBe(
      false
    );
    expect(showDeathSaves(who({ hp: { value: 0, max: 9, temp: 0 }, deathSaves: null }))).toBe(
      false
    );
    expect(deathSavesWords(saves)).toBe('1 success, 2 failures');
    expect(deathSavesWords({ successes: 0, failures: 1 })).toBe('0 successes, 1 failure');
  });

  it('sums the fight up in the pane head', () => {
    expect(metaText(null)).toBe(NO_VALUE);
    expect(metaText(fight([who(), who({ id: 'b' })], { round: 2 }))).toBe('Round 2 · 2 combatants');
    expect(metaText(fight([who()]))).toBe('Round 1 · 1 combatant');
    expect(metaText(fight([]))).toBe('Round 1 · 0 combatants');
  });
});

describe('who is a boss, and who gets a reaction button', () => {
  const boss = who({ id: 'boss', boss: legendary(3) });
  const lair = who({
    id: 'lair',
    boss: { legendary: null, resistances: null, lair: { inside: false, initiative: null } },
  });
  const resistOnly = who({
    id: 'res',
    boss: { legendary: null, resistances: { max: 3, spent: 0, remaining: 3 }, lair: null },
  });

  it('is a creature with legendary actions or a lair; resistances alone do not make one', () => {
    expect(isBoss(boss)).toBe(true);
    expect(isBoss(lair)).toBe(true);
    expect(isBoss(resistOnly)).toBe(false);
    expect(isBoss(who())).toBe(false);
    expect(isBoss(who({ boss: legendary(0, 0) }))).toBe(false);
  });

  it('lists the bosses still standing', () => {
    const combat = fight([boss, who(), who({ id: 'dead', boss: legendary(3), defeated: true })]);
    expect(livingBosses(combat).map(c => c.id)).toEqual(['boss']);
    expect(livingBosses(null)).toEqual([]);
  });

  it('gives the reaction button to a living boss, and only while Boss prompts is on', () => {
    expect(showReaction(true, boss)).toBe(true);
    expect(showReaction(false, boss)).toBe(false);
    expect(showReaction(true, who())).toBe(false);
    expect(showReaction(true, who({ boss: legendary(3), defeated: true }))).toBe(false);
  });

  it('shows the Boss prompts switch when the flag is on or a boss is up, never outside a fight', () => {
    expect(showBossToggle(false, fight([who()]))).toBe(false);
    expect(showBossToggle(true, fight([who()]))).toBe(true);
    expect(showBossToggle(false, fight([boss]))).toBe(true);
    expect(showBossToggle(false, fight([who({ boss: legendary(3), defeated: true })]))).toBe(false);
    expect(showBossToggle(true, null)).toBe(false);
    expect(showBossToggle(false, null)).toBe(false);
  });

  it('writes the boss line only with Boss prompts on', () => {
    expect(bossLine(false, boss)).toBeNull();
    expect(bossLine(true, who())).toBeNull();
    const line = bossLine(true, {
      boss: {
        legendary: { max: 3, spent: 1, remaining: 2 },
        resistances: { max: 3, spent: 3, remaining: 0 },
        lair: { inside: true, initiative: 20 },
      },
    });
    expect(line?.legendary).toEqual({ filled: '◆◆', empty: '◇', remaining: 2, max: 3 });
    expect(line?.resistances).toEqual({ filled: '', empty: '◇◇◇', remaining: 0, max: 3 });
    expect(line?.lair).toBe('in lair');
    expect(bossLine(true, lair)?.lair).toBe('lair');
    expect(bossLine(true, { boss: { legendary: null, resistances: null, lair: null } })).toBeNull();
  });
});

describe('the boss prompts', () => {
  it('reminds of the legendary actions left, except on the boss own turn', () => {
    const boss = who({ id: 'boss', name: 'Strahd', initiative: 20, boss: legendary(2) });
    const pc = who({ id: 'pc', name: 'Alder', initiative: 10, isPC: true });
    expect(bossPrompts(fight([boss, pc], { turn: 1 })).map(p => p.text)).toEqual([
      'Strahd: 2 legendary actions left, one after this turn.',
    ]);
    expect(bossPrompts(fight([boss, pc], { turn: 0 }))).toEqual([]);
  });

  it('says one legendary action in the singular and says nothing at none', () => {
    const pc = who({ id: 'pc', initiative: 10 });
    const one = who({ id: 'boss', name: 'Strahd', boss: legendary(1) });
    const none = who({ id: 'b2', name: 'Drake', boss: legendary(0) });
    expect(bossPrompts(fight([pc, one, none], { turn: 0 })).map(p => p.text)).toEqual([
      'Strahd: 1 legendary action left, one after this turn.',
    ]);
  });

  it('reminds of a lair action before the turn just under the lair count', () => {
    const lairBoss = who({
      id: 'boss',
      name: 'Strahd',
      initiative: 25,
      boss: { legendary: null, resistances: null, lair: { inside: true, initiative: 20 } },
    });
    const fast = who({ id: 'f', name: 'Fast', initiative: 22 });
    const slow = who({ id: 's', name: 'Slow', initiative: 12 });
    const combatants = [lairBoss, fast, slow];
    expect(lairTurnIndex(combatants, 20)).toBe(2);
    const prompts = bossPrompts(fight(combatants, { turn: 2 }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ kind: 'lair', icon: '🏰' });
    expect(prompts[0]?.text).toBe("Lair action for Strahd (initiative 20), before Slow's turn.");
    expect(bossPrompts(fight(combatants, { turn: 1 }))).toEqual([]);
  });

  it('puts the lair at the top of the round when nobody is under its count, and counts 20 by default', () => {
    const a = who({ id: 'a', initiative: 25 });
    expect(lairTurnIndex([a], 20)).toBe(0);
    expect(lairTurnIndex([a, who({ id: 'n', initiative: null })], 20)).toBe(1);
    const boss = who({
      id: 'boss',
      name: 'Drake',
      initiative: 30,
      boss: { legendary: null, resistances: null, lair: { inside: true, initiative: null } },
    });
    expect(bossPrompts(fight([boss, a], { turn: 0 })).map(p => p.kind)).toEqual(['lair']);
  });

  it('is empty when no boss is up or Foundry sent no lair count and the lair is not entered', () => {
    expect(bossPrompts(null)).toEqual([]);
    expect(bossPrompts(fight([who()]))).toEqual([]);
    const idle = who({
      boss: { legendary: null, resistances: null, lair: { inside: false, initiative: null } },
    });
    expect(bossPrompts(fight([idle]))).toEqual([]);
  });
});

describe('the reaction ticks', () => {
  it('toggles one combatant and keeps the others', () => {
    let state = toggleReaction(NO_REACTIONS, 1, 'a');
    state = toggleReaction(state, 1, 'b');
    expect([...reactionsFor(state, 1)]).toEqual(['a', 'b']);
    state = toggleReaction(state, 1, 'a');
    expect([...reactionsFor(state, 1)]).toEqual(['b']);
  });

  it('starts every round with none, and does not change the state it was given', () => {
    const state = toggleReaction(NO_REACTIONS, 1, 'a');
    expect(reactionsFor(state, 2).size).toBe(0);
    expect(reactionsFor(state, 1).size).toBe(1);
    expect(NO_REACTIONS.used.size).toBe(0);
    const next = toggleReaction(state, 2, 'b');
    expect([...reactionsFor(next, 2)]).toEqual(['b']);
    expect(reactionsFor(next, 1).size).toBe(0);
  });

  it('names the button after the state and the combatant', () => {
    expect(reactionLabel('Strahd', false)).toBe('Reaction ready: Strahd');
    expect(reactionLabel('Strahd', true)).toBe('Reaction used: Strahd');
  });
});

describe('selecting combatants and the action bar', () => {
  const on = { combatButtons: true, gmActions: true, fightActive: true, sample: false };

  it('needs Combat buttons, GM Actions and a real fight', () => {
    expect(canSelect(on)).toBe(true);
    expect(canSelect({ ...on, combatButtons: false })).toBe(false);
    expect(canSelect({ ...on, gmActions: false })).toBe(false);
    expect(canSelect({ ...on, fightActive: false })).toBe(false);
    expect(canSelect({ ...on, sample: true })).toBe(false);
  });

  it('toggles a pick without touching the old set', () => {
    const none = new Set<string>();
    const one = toggleSelection(none, 'a');
    expect([...one]).toEqual(['a']);
    expect(none.size).toBe(0);
    expect(toggleSelection(one, 'a').size).toBe(0);
  });

  it('drops ids that left the fight, and everything when picking is not allowed', () => {
    const combat = fight([who({ id: 'a' }), who({ id: 'b' })]);
    const picked = new Set(['a', 'gone']);
    expect([...pruneSelection(picked, combat, true)]).toEqual(['a']);
    const same = new Set(['a', 'b']);
    expect(pruneSelection(same, combat, true)).toBe(same);
    expect(pruneSelection(picked, combat, false).size).toBe(0);
    expect(pruneSelection(picked, null, true).size).toBe(0);
    const empty = new Set<string>();
    expect(pruneSelection(empty, combat, false)).toBe(empty);
  });

  it('names the picked combatants in the bridge order, and asks the Tool runner for a plan', () => {
    const combat = fight([who({ id: 'a', name: 'Alder' }), who({ id: 'b', name: 'Bram' })]);
    expect(selectedNames(combat, new Set(['b', 'a']))).toEqual(['Alder', 'Bram']);
    expect(selectedNames(null, new Set(['a']))).toEqual([]);
    expect(planRequest('damage', ['Alder'])).toEqual({
      name: 'plan-actor-change',
      prefill: { action: 'damage', targets: ['Alder'] },
    });
    expect(planRequest('condition', ['A', 'B']).prefill).toEqual({
      action: 'condition',
      targets: ['A', 'B'],
    });
  });
});

describe('a fight the bridge cannot confirm', () => {
  const link = { controlChannel: 'connected', foundry: 'reachable' };

  it('is away when the channel is down or Foundry is not known to be reachable', () => {
    expect(bridgeAway(undefined)).toBe(false);
    expect(bridgeAway(link)).toBe(false);
    expect(bridgeAway({ ...link, controlChannel: 'disconnected' })).toBe(true);
    expect(bridgeAway({ ...link, foundry: 'unreachable' })).toBe(true);
    expect(bridgeAway({ ...link, foundry: 'unknown' })).toBe(true);
  });

  it('keeps the fight on screen, marked stale, and is live again when the bridge is back', () => {
    const combat = fight([who()]);
    expect(stripMode(null, false)).toBe('none');
    expect(stripMode(null, true)).toBe('none');
    expect(stripMode(combat, false)).toBe('live');
    expect(stripMode(combat, true)).toBe('stale');
    expect(AWAY_TEXT).toBe('The bridge is away: this is the fight as last seen.');
  });
});

describe('the trial sample fight', () => {
  it('is a made-up fight in round 2 with the Fighter up', () => {
    expect(SAMPLE_COMBAT.active).toBe(true);
    expect(SAMPLE_COMBAT.round).toBe(2);
    expect(SAMPLE_COMBAT.combatants.map(c => c.name)).toEqual([
      'Fighter',
      'Wolf',
      'Cleric',
      'Wolf',
    ]);
    expect(SAMPLE_COMBAT.combatants.filter(c => c.isCurrentTurn).map(c => c.name)).toEqual([
      'Fighter',
    ]);
    expect(new Set(SAMPLE_COMBAT.combatants.map(c => c.id)).size).toBe(4);
    expect(SAMPLE_COMBAT.combatants.some(isBoss)).toBe(false);
  });
});
