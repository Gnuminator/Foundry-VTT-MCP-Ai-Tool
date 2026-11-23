import { describe, expect, it } from 'vitest';

import type { GuardedOutcome, GuardedTools } from './guarded';
import {
  actionsOf,
  activityArgs,
  appliedLine,
  applyParts,
  damageParts,
  landed,
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
  it('counts a critical as a hit even when the total is under the AC', () => {
    const nat20 = readActivity({ attackTotal: 14, targetAC: 15, hit: false, isCritical: true });
    expect(landed(nat20)).toBe(true);
    expect(resultLine('G', 'Bow', nat20)).toContain(': hit, critical');
  });
});

describe('damageParts', () => {
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
    expect(damageParts(readActivity({ hit: true, damageTotal: 4 }))).toEqual([
      { type: null, total: 4 },
    ]);
  });
  it('lists damage on an unknown verdict (applied behind the confirm only), none on a miss', () => {
    const unknown = readActivity({ hit: null, damageTotal: 4 });
    expect(damageParts(unknown)).toEqual([{ type: null, total: 4 }]);
    expect(landed(unknown)).toBe(false);
    expect(damageParts(readActivity({ hit: false, damageTotal: 4 }))).toEqual([]);
  });
  it('lists the damage of a critical that read as a miss', () => {
    const nat20 = readActivity({ hit: false, isCritical: true, damageTotal: 8 });
    expect(damageParts(nat20)).toEqual([{ type: null, total: 8 }]);
  });
});

describe('applyParts and appliedLine', () => {
  const parts = [
    { type: 'piercing', total: 7 },
    { type: 'poison', total: 5 },
  ];
  const target = { tokenId: 'tok', name: 'Ilvara' };
  const fake = (outcomes: GuardedOutcome[]): { plan: GuardedTools['plan']; calls: unknown[][] } => {
    const calls: unknown[][] = [];
    const plan: GuardedTools['plan'] = (tool, args, options) => {
      calls.push([tool, args, options]);
      return Promise.resolve(outcomes[calls.length - 1] ?? { status: 'done', result: null });
    };
    return { plan, calls };
  };
  it('asks once for all parts, then applies the rest at once', async () => {
    const { plan, calls } = fake([]);
    const out = await applyParts(plan, target, parts, true);
    expect(out.applied).toBe(2);
    const first = calls[0]?.[2] as {
      confirmLine?: { question: string };
      skipConfirmWhenAutoApply?: boolean;
    };
    expect(first.confirmLine?.question).toBe('Deal 7 piercing and 5 poison damage to Ilvara?');
    expect(first.skipConfirmWhenAutoApply).toBe(true);
    expect(calls[0]?.[1]).toEqual({
      action: 'damage',
      targets: ['tok'],
      amount: 7,
      damageType: 'piercing',
    });
    expect(calls[1]?.[2]).toEqual({ label: 'Apply damage' });
  });
  it('never skips the question when the verdict is unknown', async () => {
    const { plan, calls } = fake([]);
    await applyParts(plan, target, [{ type: null, total: 4 }], false);
    const first = calls[0]?.[2] as { skipConfirmWhenAutoApply?: boolean };
    expect(first.skipConfirmWhenAutoApply).toBe(false);
    expect((calls[0]?.[2] as { confirmLine?: { question: string } }).confirmLine?.question).toBe(
      'Hit not confirmed (check the chat card). Deal 4 damage to Ilvara?'
    );
    expect(calls[0]?.[1]).not.toHaveProperty('damageType');
  });
  it('stops at the first part when the GM cancels: nothing applied', async () => {
    const { plan, calls } = fake([{ status: 'cancelled' }]);
    const out = await applyParts(plan, target, parts, false);
    expect(out.applied).toBe(0);
    expect(calls).toHaveLength(1);
    expect(appliedLine(parts, out.applied, false)).toBe(
      'Damage not applied: 7 piercing and 5 poison not applied'
    );
  });
  it('says what went in when a later part fails', async () => {
    const { plan } = fake([
      { status: 'done', result: null },
      { status: 'failed', error: 'x' },
    ]);
    const out = await applyParts(plan, target, parts, false);
    expect(out.applied).toBe(1);
    expect(appliedLine(parts, 1, false)).toBe('7 piercing applied; 5 poison not applied');
    expect(appliedLine(parts, 1, true)).toBe(
      '7 piercing applied; 5 poison may have applied (check Recent Changes)'
    );
    expect(appliedLine(parts, 2, false)).toBe('');
  });
});
