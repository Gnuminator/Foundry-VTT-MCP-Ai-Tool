/**
 * The player page's "You" section (public/player-me.js): your turn, next up, your character card
 * and the concentration reminder.
 */
import type { PlayerCombat, PlayerCombatant } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import {
  concentrationDc,
  concentrationReminders,
  mySheets,
  parseDamageLine,
  rollBannerLines,
  turnLine,
  turnOptions,
  turnStatus,
} from '../public/player-me.js';

function c(over: Partial<PlayerCombatant>): PlayerCombatant {
  return {
    id: 'c',
    name: 'Goblin',
    initiative: 10,
    isCurrentTurn: false,
    isPC: false,
    actorId: null,
    side: 'enemy',
    defeated: false,
    hp: null,
    hpBand: null,
    conditions: [],
    deathSaves: null,
    ...over,
  };
}

const hero = (id: string, actorId: string, over: Partial<PlayerCombatant> = {}): PlayerCombatant =>
  c({ id, name: `Hero ${id}`, isPC: true, actorId, side: 'pc', ...over });

function combat(combatants: PlayerCombatant[]): PlayerCombat {
  return { active: true, round: 3, combatants };
}

describe('turnStatus', () => {
  const order = [
    c({ id: 'g1', isCurrentTurn: true }),
    hero('p1', 'actor-1'),
    c({ id: 'g2', defeated: true }),
    c({ id: 'g3' }),
    hero('p2', 'actor-2'),
  ];

  it('says whose turn it is and who is up next, from the visible order', () => {
    expect(turnStatus(combat(order), ['actor-1'])).toMatchObject({ state: 'next', round: 3 });
    expect(turnStatus(combat(order), ['actor-2'])).toMatchObject({ state: 'later', turnsAway: 3 });
    const mine = order.map(o => ({ ...o, isCurrentTurn: o.id === 'p1' }));
    expect(turnStatus(combat(mine), ['actor-1'])).toMatchObject({ state: 'yours' });
  });

  it('wraps to the top of the round and skips defeated creatures', () => {
    const last = order.map(o => ({ ...o, isCurrentTurn: o.id === 'p2' }));
    expect(turnStatus(combat(last), ['actor-1'])).toMatchObject({ state: 'later', turnsAway: 2 });
    expect(turnStatus(combat(last), ['nobody'])).toMatchObject({ state: 'out' });
  });

  it("with two of the player's characters, follows the one whose turn comes first", () => {
    const two = [
      c({ id: 'g1', isCurrentTurn: true }),
      c({ id: 'g2' }),
      hero('p1', 'actor-1'),
      hero('p2', 'actor-2'),
    ];
    // actor-2 is listed after actor-1 but acts second; actor-1 is two turns away.
    const out = turnStatus(combat(two), ['actor-2', 'actor-1']);
    expect(out).toMatchObject({ state: 'later', turnsAway: 2, name: 'Hero p1' });
    const wrapped = two.map(o => ({ ...o, isCurrentTurn: o.id === 'p1' }));
    expect(turnStatus(combat(wrapped), ['actor-2', 'actor-1'])).toMatchObject({
      state: 'yours',
      name: 'Hero p1',
    });
  });

  it('is null without an active combat, and an NPC never matches an actor id', () => {
    expect(turnStatus(null, ['actor-1'])).toBeNull();
    expect(turnStatus({ active: false, round: 0, combatants: [] }, ['actor-1'])).toBeNull();
    const npcOnly = combat([c({ id: 'n', isCurrentTurn: true, actorId: 'actor-1' })]);
    expect(turnStatus(npcOnly, ['actor-1'])).toMatchObject({ state: 'out' });
  });

  it('words the banner and says nothing when out of the combat', () => {
    expect(turnLine({ state: 'yours', name: 'Brenna' })).toBe('Your turn, Brenna.');
    expect(turnLine({ state: 'next', name: 'Brenna' })).toBe('You are up next, Brenna.');
    expect(turnLine({ state: 'later', turnsAway: 2 })).toBe('2 turns until yours.');
    // The current creature is one players cannot see: the order they see has no marker.
    expect(turnLine({ state: 'later', turnsAway: null })).toBe('Not your turn yet.');
    expect(turnLine({ state: 'out' })).toBeNull();
    expect(turnLine(null)).toBeNull();
  });
});

describe('mySheets', () => {
  it('keeps the spell from dnd5e\'s "Concentrating: <spell>" effect name', () => {
    const [sheet] = mySheets({
      sheets: [{ id: 'a', name: 'Brenna', conditions: [], concentration: 'Concentrating: Bless' }],
    });
    expect(sheet.concentration).toBe('Bless');
    const [bare] = mySheets({
      sheets: [{ id: 'a', name: 'Brenna', conditions: [], concentration: 'Concentrating' }],
    });
    expect(bare.concentration).toBe('Concentrating');
  });

  it('keeps only what the card shows and drops malformed rows', () => {
    const out = mySheets({
      sheets: [
        {
          id: 'a',
          name: 'Brenna',
          hp: { value: 5, max: 20, temp: 0 },
          conditions: ['Prone', 3],
          concentration: 'Bless',
          secret: 'x',
        },
        { id: 7, name: 'bad' },
        null,
      ],
    });
    expect(out).toEqual([
      {
        id: 'a',
        name: 'Brenna',
        hp: { value: 5, max: 20, temp: 0 },
        conditions: ['Prone'],
        concentration: 'Bless',
      },
    ]);
    expect(mySheets(null)).toEqual([]);
  });
});

describe('concentration reminder', () => {
  const sheets = mySheets({
    sheets: [
      {
        id: 'a',
        name: 'Brenna',
        hp: { value: 5, max: 20 },
        conditions: [],
        concentration: 'Bless',
      },
      { id: 'b', name: 'Tobin', hp: { value: 5, max: 20 }, conditions: [], concentration: null },
    ],
  });

  it('uses 10 or half the damage, whichever is higher', () => {
    expect(concentrationDc(7)).toBe(10);
    expect(concentrationDc(30)).toBe(15);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(200)).toBe(30);
  });

  it('reminds once per damage line, only for a character that is concentrating', () => {
    const seen = new Set<string>();
    const events = [
      { id: 'e1', timestampMs: 1, type: 'damage', text: 'Brenna took 30 damage.' },
      { id: 'e2', timestampMs: 2, type: 'damage', text: 'Tobin took 9 damage.' },
      { id: 'e3', timestampMs: 3, type: 'damage', text: 'Goblin was hit.' },
      { id: 'e4', timestampMs: 4, type: 'healing', text: 'Brenna regained 4 HP.' },
    ];
    const first = concentrationReminders(events, sheets, seen);
    expect(first).toHaveLength(1);
    expect(first[0].text).toContain('Brenna took 30 damage while concentrating on Bless');
    expect(first[0].text).toContain('DC 15');
    expect(concentrationReminders(events, sheets, seen)).toEqual([]);
  });

  it('parses only the fixed damage template', () => {
    expect(parseDamageLine('Brenna took 7 damage.')).toEqual({ name: 'Brenna', amount: 7 });
    expect(parseDamageLine('Brenna was hit.')).toBeNull();
  });
});

describe('rollBannerLines', () => {
  const now = 1_000_000;
  const open = [
    { id: 'a', sentAt: now - 1000, label: 'Perception Skill Check (Private)', userId: 'u1' },
    { id: 'b', sentAt: now - 1000, label: 'Dexterity Saving Throw', userId: 'u2' },
  ];

  it('names the roll for the player it is for and nobody else', () => {
    expect(rollBannerLines(open, 'u1', now, false)?.title).toBe(
      'The GM asked you to roll: Perception Skill Check'
    );
    expect(rollBannerLines(open, 'u3', now, false)).toBeNull();
  });

  it('shows nothing before the player has picked a name', () => {
    expect(rollBannerLines(open, null, now, true)).toBeNull();
  });

  it('points a player without a personal link to Foundry or the link in Discord', () => {
    expect(rollBannerLines(open, 'u1', now, false)?.hint).toMatch(/pinned in Discord/);
    expect(rollBannerLines(open, 'u1', now, true)?.hint).toMatch(/Press Roll/);
  });

  it('lets an old request fade', () => {
    const old = [{ id: 'c', sentAt: now - 31 * 60 * 1000, label: 'Stealth', userId: 'u1' }];
    expect(rollBannerLines(old, 'u1', now, true)).toBeNull();
  });
});

describe('turnOptions', () => {
  const ebbe = {
    inventory: [{ name: 'Mace', equipped: true, attack: '+4', damage: '1d6+2 bludgeoning' }],
    features: [{ name: 'Channel Divinity', uses: { value: 2, max: 2 } }, { name: 'Darkvision' }],
    spells: [
      {
        name: 'Spare the Dying',
        level: 0,
        prepared: true,
        castingTime: 'Action',
        range: '15 ft',
      },
      { name: 'Healing Word', level: 1, prepared: true, castingTime: 'Bonus Action' },
      { name: 'Shield of Faith', level: 1, prepared: false, castingTime: 'Bonus Action' },
      { name: 'Identify', level: 1, prepared: true, castingTime: '1 Minute' },
    ],
  };

  it('groups a level 3 cleric by action cost with at least eight options', () => {
    const groups = turnOptions(ebbe);
    const names = (id: string): string[] =>
      (groups.find(g => g.id === id)?.options ?? []).map((o: { name: string }) => o.name);
    expect(names('action')).toEqual(
      expect.arrayContaining(['Spare the Dying', 'Channel Divinity', 'Dodge', 'Attack'])
    );
    expect(names('bonus')).toEqual(['Healing Word']);
    expect(names('reaction')).toContain('Opportunity attack');
    const all = groups.flatMap(g => g.options);
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.some(o => o.name === 'Shield of Faith' || o.name === 'Identify')).toBe(false);
    expect(all.every(o => o.note.length <= 70)).toBe(true);
  });

  it('files 2024 costs right and keeps odd action labels', () => {
    const groups = turnOptions({
      features: [{ name: 'Wild Shape' }, { name: 'Lay on Hands' }, { name: 'Divine Smite' }],
      spells: [{ name: 'Zap', level: 0, prepared: true, castingTime: 'Magic action' }],
    });
    const names = (id: string): string[] =>
      (groups.find(g => g.id === id)?.options ?? []).map((o: { name: string }) => o.name);
    expect(names('bonus')).toEqual(['Wild Shape', 'Lay on Hands']);
    expect(names('action')).toContain('Zap');
    expect(groups.flatMap(g => g.options.map((o: { name: string }) => o.name))).not.toContain(
      'Divine Smite'
    );
  });

  it('lists movement from the sheet speed and slots left on spells', () => {
    const groups = turnOptions({
      speed: { walk: 30, fly: 60, swim: 0 },
      speedUnits: 'ft',
      slots: [{ level: 1, value: 2, max: 4, pact: false }],
      spells: [{ name: 'Healing Word', level: 1, prepared: true, castingTime: 'Bonus Action' }],
    });
    type Grp = { id: string; options: { name: string; note: string }[] };
    const mv = (groups as Grp[]).find((g: Grp) => g.id === 'movement')?.options ?? [];
    expect(mv.map(o => o.name)).toEqual(['Move', 'Fly']);
    expect(mv[0]?.note).toMatch(/30 ft/);
    const hw = (groups as Grp[]).find((g: Grp) => g.id === 'bonus')?.options[0];
    expect(hw?.note).toMatch(/2\/4 slots left/);
    expect((turnOptions({ features: [] }) as Grp[]).some((g: Grp) => g.id === 'movement')).toBe(
      false
    );
  });

  it('returns nothing without a sheet', () => {
    expect(turnOptions(null)).toEqual([]);
  });
});
