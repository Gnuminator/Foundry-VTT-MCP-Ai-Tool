/**
 * Tests for `describeRoll` (O3 item 6), against dnd5e 6.0-shaped fixtures.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorld, type TestWorld } from '../../test-support/foundry-mock/index.js';
import { describeRoll } from './roll-breakdown.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
});

function makeActor(opts: {
  id?: string;
  name?: string;
  str?: number;
  dex?: number;
  wis?: number;
  prof?: number;
  items?: any[];
}): any {
  const actor: any = {
    id: opts.id ?? 'a1',
    uuid: `Actor.${opts.id ?? 'a1'}`,
    name: opts.name ?? 'Wolf',
    type: 'npc',
    system: {
      // Distinct by default so a number part matches at most one ability mod.
      abilities: {
        str: { mod: opts.str ?? 0 },
        dex: { mod: opts.dex ?? 2 },
        wis: { mod: opts.wis ?? -1 },
      },
      attributes: { prof: opts.prof ?? 99 },
    },
    items: opts.items ?? [],
  };
  world.actors.add(actor);
  return actor;
}

function d20Term(overrides: Record<string, any> = {}): any {
  return {
    faces: 20,
    number: 1,
    results: [{ result: 16, active: true }],
    ...overrides,
  };
}

function numberTerm(n: number): any {
  return { number: n };
}

function op(operator: '+' | '-'): any {
  return { operator };
}

function makeMessage(opts: {
  actorId?: string;
  itemUuid?: string;
  itemName?: string;
  itemType?: string;
  ability?: string;
  skill?: string;
  tool?: string;
  flavor?: string;
}): any {
  return {
    speaker: { actor: opts.actorId ?? 'a1' },
    flavor: opts.flavor,
    system: {
      ability: opts.ability,
      skill: opts.skill,
      tool: opts.tool,
      item: opts.itemUuid
        ? { uuid: opts.itemUuid, name: opts.itemName ?? 'Item', type: opts.itemType ?? 'weapon' }
        : undefined,
    },
  };
}

describe('describeRoll', () => {
  it('attack with a known target AC: labels DEX/proficiency, shows vs AC and hit', () => {
    makeActor({ dex: 2, prof: 2 });
    const message = makeMessage({ itemUuid: 'Item.sword', itemName: 'Longsword', ability: 'dex' });
    const roll = {
      formula: '1d20 + 2 + 2',
      total: 20,
      options: { target: 10 },
      terms: [d20Term(), op('+'), numberTerm(2), op('+'), numberTerm(2)],
    };
    const breakdown = describeRoll(message, roll, 'attack');
    expect(breakdown.label).toBe('Longsword attack');
    expect(breakdown.parts).toEqual([
      { kind: 'dice', formula: '1d20', results: [16] },
      { kind: 'number', value: 2, label: 'DEX' },
      { kind: 'number', value: 2, label: 'proficiency' },
    ]);
    expect(breakdown.natural).toBe(16);
    expect(breakdown.dc).toBe(10);
    expect(breakdown.outcome).toBe('success');
    expect(breakdown.text).toBe(
      'Wolf, Longsword attack: 1d20 (16) +2 DEX +2 proficiency = 20 vs AC 10: hit'
    );
  });

  it('save with a DC and a negative ability modifier', () => {
    makeActor({ wis: -1 });
    const message = makeMessage({ ability: 'wis' });
    const roll = {
      formula: '1d20 - 1',
      total: 4,
      options: { target: 13 },
      terms: [d20Term({ results: [{ result: 5, active: true }] }), op('-'), numberTerm(1)],
    };
    const breakdown = describeRoll(message, roll, 'save');
    expect(breakdown.label).toBe('Wisdom save');
    expect(breakdown.parts).toEqual([
      { kind: 'dice', formula: '1d20', results: [5] },
      { kind: 'number', value: -1, label: 'WIS' },
    ]);
    expect(breakdown.text).toBe('Wolf, Wisdom save: 1d20 (5) -1 WIS = 4 vs DC 13: failure');
  });

  it('skill check', () => {
    makeActor({ dex: 3, prof: 2 });
    const message = makeMessage({ ability: 'dex', skill: 'ste' });
    const roll = {
      formula: '1d20 + 3 + 2',
      total: 17,
      options: {},
      terms: [
        d20Term({ results: [{ result: 12, active: true }] }),
        op('+'),
        numberTerm(3),
        op('+'),
        numberTerm(2),
      ],
    };
    const breakdown = describeRoll(message, roll, 'skill');
    expect(breakdown.label).toBe('STE check');
    expect(breakdown.parts[1]).toEqual({ kind: 'number', value: 3, label: 'DEX' });
    expect(breakdown.parts[2]).toEqual({ kind: 'number', value: 2, label: 'proficiency' });
    expect(breakdown.dc).toBeUndefined();
    expect(breakdown.text).toBe('Wolf, STE check: 1d20 (12) +3 DEX +2 proficiency = 17');
  });

  it('damage roll names its damage type (roll.options.type, a single-type simple case)', () => {
    makeActor({ dex: 2 });
    const message = makeMessage({ itemUuid: 'Item.bite', itemName: 'Bite', itemType: 'weapon' });
    const roll = {
      formula: '2d4 + 2',
      total: 9,
      options: { type: 'piercing' },
      terms: [
        {
          faces: 4,
          number: 2,
          results: [
            { result: 3, active: true },
            { result: 4, active: true },
          ],
        },
        op('+'),
        numberTerm(2),
      ],
    };
    const breakdown = describeRoll(message, roll, 'damage');
    expect(breakdown.label).toBe('Bite damage');
    expect(breakdown.parts[0]).toEqual({ kind: 'dice', formula: '2d4', results: [3, 4] });
    expect(breakdown.parts[1]).toEqual({ kind: 'number', value: 2, label: 'DEX' });
    expect(breakdown.text).toBe('Wolf, Bite damage: 2d4 (3, 4) +2 DEX = 9 piercing');
  });

  it('never calls a damage bonus "proficiency" (5e never adds it to damage)', () => {
    makeActor({ str: 2, dex: 2, prof: 2 });
    const message = makeMessage({ itemUuid: 'Item.bite', itemName: 'Bite' });
    const roll = {
      formula: '1d6 + 2',
      total: 5,
      options: { type: 'piercing' },
      terms: [
        { faces: 6, number: 1, results: [{ result: 3, active: true }] },
        op('+'),
        numberTerm(2),
      ],
    };
    // STR and DEX are both +2: ambiguous, so an honest "modifier".
    expect(describeRoll(message, roll, 'damage').text).toBe(
      'Wolf, Bite damage: 1d6 (3) +2 modifier = 5 piercing'
    );
  });

  it('a zero part is a "modifier", never an ability whose mod happens to be 0', () => {
    makeActor({ str: 0, dex: 3, prof: 2 });
    const message = makeMessage({ itemUuid: 'Item.sword', itemName: 'Longsword', ability: 'dex' });
    const roll = {
      formula: '1d20 + 3 + 0',
      total: 14,
      options: {},
      terms: [
        d20Term({ results: [{ result: 11, active: true }] }),
        op('+'),
        numberTerm(3),
        op('+'),
        numberTerm(0),
      ],
    };
    expect(describeRoll(message, roll, 'attack').parts[2]).toEqual({
      kind: 'number',
      value: 0,
      label: 'modifier',
    });
  });

  it('a roll dnd5e did not type keeps its flavor as the title and guesses no sources', () => {
    makeActor({ wis: 1 });
    const message = makeMessage({ flavor: 'Alchemist fire damage' });
    const roll = {
      formula: '2d6 + 1',
      total: 7,
      options: {},
      terms: [
        {
          faces: 6,
          number: 2,
          results: [
            { result: 5, active: true },
            { result: 1, active: true },
          ],
        },
        op('+'),
        numberTerm(1),
      ],
    };
    expect(describeRoll(message, roll, 'other').text).toBe(
      'Wolf, Alchemist fire damage: 2d6 (5, 1) +1 modifier = 7'
    );
  });

  it('a function term (dnd5e hit die) shows its expression and inner dice', () => {
    makeActor({});
    const roll = {
      formula: 'max(1,1d10 + 2)',
      total: 4,
      options: {},
      terms: [
        {
          fn: 'max',
          terms: ['1', '1d10 + 2'],
          result: 4,
          rolls: [
            { formula: '1', total: 1, terms: [numberTerm(1)] },
            {
              formula: '1d10 + 2',
              total: 4,
              terms: [
                { faces: 10, number: 1, results: [{ result: 2, active: true }] },
                op('+'),
                numberTerm(2),
              ],
            },
          ],
        },
      ],
    };
    expect(describeRoll(makeMessage({}), roll, 'hitDie').text).toBe(
      'Wolf, Hit die: max(1, 1d10 + 2) (2) = 4'
    );
  });

  it("names a skill with dnd5e's own label", () => {
    (globalThis as any).CONFIG.DND5E.skills = { prc: { label: 'Perception' } };
    makeActor({ wis: -1 });
    const roll = {
      formula: '1d20 - 1',
      total: 9,
      options: {},
      terms: [d20Term({ results: [{ result: 10, active: true }] }), op('-'), numberTerm(1)],
    };
    expect(describeRoll(makeMessage({ ability: 'wis', skill: 'prc' }), roll, 'skill').label).toBe(
      'Perception check'
    );
  });

  it('a mixed-damage roll labels each dice group with its own flavor', () => {
    makeActor({});
    const message = makeMessage({
      itemUuid: 'Item.flame',
      itemName: 'Flame Tongue',
      itemType: 'weapon',
    });
    const roll = {
      formula: '1d8 + 1d6',
      total: 7,
      options: {},
      terms: [
        {
          faces: 8,
          number: 1,
          results: [{ result: 4, active: true }],
          options: { flavor: 'slashing' },
        },
        op('+'),
        {
          faces: 6,
          number: 1,
          results: [{ result: 3, active: true }],
          options: { flavor: 'fire' },
        },
      ],
    };
    const breakdown = describeRoll(message, roll, 'damage');
    expect(breakdown.parts).toEqual([
      { kind: 'dice', formula: '1d8', results: [4], label: 'slashing' },
      { kind: 'dice', formula: '1d6', results: [3], label: 'fire' },
    ]);
    expect(breakdown.text).toBe(
      'Wolf, Flame Tongue damage: 1d8 (4) slashing +1d6 (3) fire = 7 slashing/fire'
    );
  });

  it('advantage roll keeps the higher die, drops the other, and marks advantage/natural 20', () => {
    makeActor({});
    const message = makeMessage({ ability: 'dex' });
    const roll = {
      formula: '2d20kh',
      total: 20,
      options: { advantageMode: 1 },
      terms: [
        {
          faces: 20,
          number: 2,
          modifiers: ['kh'],
          results: [
            { result: 3, active: false },
            { result: 20, active: true },
          ],
        },
      ],
    };
    const breakdown = describeRoll(message, roll, 'check');
    expect(breakdown.parts).toEqual([
      { kind: 'dice', formula: '2d20kh', results: [20], dropped: [3] },
    ]);
    expect(breakdown.natural).toBe(20);
    expect(breakdown.text).toContain('natural 20');
    expect(breakdown.text).toContain('(advantage)');
  });

  it('an unmatched (parenthetical/pool) term falls back to a modifier number part from its total', () => {
    makeActor({});
    const message = makeMessage({ ability: 'dex' });
    const roll = {
      formula: '1d20 + (1d4)',
      total: 19,
      options: {},
      terms: [
        d20Term({ results: [{ result: 16, active: true }] }),
        op('+'),
        { class: 'ParentheticalTerm', total: 3 },
      ],
    };
    const breakdown = describeRoll(message, roll, 'check');
    expect(breakdown.parts[1]).toEqual({ kind: 'number', value: 3, label: 'modifier' });
  });

  it('player-safe text omits the target and outcome unless challengeVisibility is "all"', () => {
    makeActor({ dex: 2, prof: 2 });
    const message = makeMessage({ itemUuid: 'Item.sword', itemName: 'Longsword', ability: 'dex' });
    const roll = {
      formula: '1d20 + 2 + 2',
      total: 20,
      options: { target: 10 },
      terms: [d20Term(), op('+'), numberTerm(2), op('+'), numberTerm(2)],
    };

    const hidden = describeRoll(message, roll, 'attack');
    expect(hidden.textPlayerSafe).toBe(
      'Wolf, Longsword attack: 1d20 (16) +2 DEX +2 proficiency = 20'
    );
    expect(hidden.textPlayerSafe).not.toContain('AC');

    world.setSetting('dnd5e', 'challengeVisibility', 'all');
    const visible = describeRoll(message, roll, 'attack');
    expect(visible.textPlayerSafe).toBe(visible.text);
    expect(visible.textPlayerSafe).toContain('vs AC 10: hit');
  });

  it('never throws: a malformed roll still returns a minimal breakdown', () => {
    const message = makeMessage({});
    const breakdown = describeRoll(message, { total: 'nope' }, 'other');
    expect(breakdown.label).toBeTruthy();
    expect(breakdown.text).toContain('= 0');
  });
});
