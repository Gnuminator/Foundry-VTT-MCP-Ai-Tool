import { describe, expect, it } from 'vitest';
import type { RulesCheckLine } from '@gnuminator/shared';
import { evaluateAction, type RulesFacts } from './evaluate.js';

const base: RulesFacts = {
  actor: 'Ilvara',
  item: 'Longsword',
  spellLevel: null,
  castLevel: null,
  activation: 'Action',
  range: '5 Feet',
  combat: { active: true, round: 2, inCombat: true, isCurrentTurn: true, currentName: 'Ilvara' },
  target: 'Zombie',
  distance: { feet: 5 },
  slots: {},
  uses: [],
};

const cost = (f: RulesFacts): RulesCheckLine | undefined =>
  evaluateAction(f).checks.find(c => c.check === 'action-cost');
const use = (
  item: string,
  activation: string,
  itemType = 'weapon'
): { item: string; itemType: string; activation: string } => ({
  item,
  itemType,
  activation,
});

describe('spent actions', () => {
  it('keeps the plain line when the ledger has nothing to say', () => {
    expect(cost(base)?.reason).toContain('does not track');
    expect(evaluateAction(base).limits[0]).toContain('does not record');
  });

  it('says nothing has been spent yet', () => {
    const r = cost({ ...base, spent: { uses: [use('Fire Bolt', 'bonus', 'spell')] } });
    expect(r?.status).toBe('info');
    expect(r?.reason).toContain('yet this turn');
    expect(evaluateAction({ ...base, spent: { uses: [] } }).limits[0]).toContain('through Foundry');
  });

  it('lets a second weapon attack through as Extra Attack', () => {
    const r = cost({ ...base, spent: { uses: [use('Longsword', 'action')] } });
    expect(r?.status).toBe('info');
    expect(r?.reason).toContain('Extra Attack');
  });

  it('warns when a spell and another action meet', () => {
    const spellFirst = cost({ ...base, spent: { uses: [use('Fireball', 'action', 'spell')] } });
    expect(spellFirst?.status).toBe('warn');
    const spellNow = cost({
      ...base,
      item: 'Fireball',
      spellLevel: 3,
      spent: { uses: [use('Longsword', 'action')] },
    });
    expect(spellNow?.status).toBe('warn');
  });

  it('warns on a second bonus action', () => {
    const r = cost({
      ...base,
      activation: 'Bonus Action',
      spent: { uses: [use('Healing Word', 'bonus', 'spell')] },
    });
    expect(r?.status).toBe('warn');
    expect(r?.reason).toContain('only one per turn');
  });

  it("warns on a second reaction even on another creature's turn", () => {
    const r = cost({
      ...base,
      activation: 'Reaction',
      combat: { ...(base.combat as object), isCurrentTurn: false, currentName: 'Zombie' } as never,
      spent: { uses: [use('Shield', 'reaction', 'spell')] },
    });
    expect(r?.status).toBe('warn');
    expect(r?.reason).toContain('next turn');
  });

  it('does not count an action against a creature whose turn it is not', () => {
    const r = cost({
      ...base,
      combat: { ...(base.combat as object), isCurrentTurn: false, currentName: 'Zombie' } as never,
      spent: { uses: [use('Fireball', 'action', 'spell')] },
    });
    expect(r?.reason).toContain('does not track');
  });

  it('ignores the ledger for same-named tokens', () => {
    const r = cost({
      ...base,
      combat: {
        active: true,
        round: 2,
        inCombat: true,
        ambiguous: true,
        isCurrentTurn: false,
        currentName: null,
      },
      spent: { uses: [use('Fireball', 'action', 'spell')] },
    });
    expect(r?.reason).toContain('does not track');
  });
});

describe('rules version', () => {
  const rulesLine = (f: RulesFacts): RulesCheckLine | undefined =>
    evaluateAction(f).checks.find(c => c.check === 'rules-version');

  it('says nothing when the item has no tag', () => {
    expect(rulesLine(base)).toBeUndefined();
    expect(rulesLine({ ...base, rules: { item: null, actor: null } })).toBeUndefined();
  });

  it('only names the item version when the actor version is a world default', () => {
    const r = rulesLine({
      ...base,
      rules: { item: '2014', actor: { version: '2024', source: 'world-setting' } },
    });
    expect(r?.status).toBe('info');
  });

  it('reports a match as info and a mismatch as a warning', () => {
    const same = rulesLine({
      ...base,
      rules: { item: '2024', actor: { version: '2024', source: 'system.source.rules' } },
    });
    expect(same?.status).toBe('info');
    const diff = rulesLine({
      ...base,
      rules: { item: '2014', actor: { version: '2024', source: 'system.source.rules' } },
    });
    expect(diff?.status).toBe('warn');
    expect(diff?.reason).toContain('2014');
    expect(diff?.reason).toContain('2024');
  });
});
