import { describe, expect, it } from 'vitest';
import type { RulesCheckLine } from '@gnuminator/shared';
import { classifyActivation, evaluateAction, parseRange, type RulesFacts } from './evaluate.js';

const base: RulesFacts = {
  actor: 'Ireena',
  item: 'Longsword',
  spellLevel: null,
  castLevel: null,
  activation: 'Action',
  range: '5 Feet',
  combat: { active: true, round: 2, inCombat: true, isCurrentTurn: true, currentName: 'Ireena' },
  target: 'Zombie',
  distance: { feet: 5 },
  slots: {},
  uses: [],
};

const line = (f: RulesFacts, check: string): RulesCheckLine | undefined =>
  evaluateAction(f).checks.find(c => c.check === check);

describe('classifyActivation', () => {
  it('sorts labels and raw types', () => {
    expect(classifyActivation('Action')).toBe('action');
    expect(classifyActivation('bonus')).toBe('bonus');
    expect(classifyActivation('Bonus Action')).toBe('bonus');
    expect(classifyActivation('Reaction')).toBe('reaction');
    expect(classifyActivation('1 Minute')).toBe('long');
    expect(classifyActivation('Legendary Action')).toBe('other');
    expect(classifyActivation('')).toBe('none');
    expect(classifyActivation(undefined)).toBe('none');
  });
});

describe('parseRange', () => {
  it('reads feet, long range, miles and keywords', () => {
    expect(parseRange('60 Feet')).toEqual({ kind: 'feet', normal: 60 });
    expect(parseRange('80/320 ft')).toEqual({ kind: 'feet', normal: 80, long: 320 });
    expect(parseRange('1 Mile')).toEqual({ kind: 'feet', normal: 5280 });
    expect(parseRange('Self')).toEqual({ kind: 'self' });
    expect(parseRange('Touch')).toEqual({ kind: 'touch' });
    expect(parseRange('Sight')).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
});

describe('evaluateAction', () => {
  it('calls a melee attack in reach on its turn legal', () => {
    const r = evaluateAction(base);
    expect(r.verdict).toBe('legal');
    expect(r.checks.map(c => c.check)).toEqual(['turn', 'action-cost', 'range']);
    expect(r.limits.length).toBeGreaterThan(0);
  });

  it('warns when it is not the actor turn, but lets a reaction through', () => {
    const off = {
      ...base.combat,
      isCurrentTurn: false,
      currentName: 'Zombie',
    } as RulesFacts['combat'];
    expect(line({ ...base, combat: off }, 'turn')?.status).toBe('warn');
    expect(line({ ...base, combat: off, activation: 'Reaction' }, 'turn')?.status).toBe('pass');
    expect(evaluateAction({ ...base, combat: off }).verdict).toBe('unclear');
  });

  it('skips turn order outside combat or when the actor is not in the encounter', () => {
    expect(line({ ...base, combat: { active: false } }, 'turn')?.status).toBe('info');
    const out = {
      active: true,
      round: 1,
      inCombat: false,
      isCurrentTurn: false,
      currentName: 'X',
    } as const;
    expect(line({ ...base, combat: out }, 'turn')?.status).toBe('info');
  });

  it('fails a target out of range, warns at long range, passes touch within 5 ft', () => {
    expect(line({ ...base, distance: { feet: 30 } }, 'range')?.status).toBe('fail');
    // Centre to centre: a large token can still be in reach of a 5 ft attack.
    expect(line({ ...base, distance: { feet: 10 } }, 'range')?.status).toBe('warn');
    expect(line({ ...base, range: '60 Feet', distance: { feet: 70 } }, 'range')?.status).toBe(
      'fail'
    );
    const bow = { ...base, range: '80/320 Feet' };
    expect(line({ ...bow, distance: { feet: 120 } }, 'range')?.status).toBe('warn');
    expect(line({ ...bow, distance: { feet: 400 } }, 'range')?.status).toBe('fail');
    expect(line({ ...base, range: 'Touch', distance: { feet: 5 } }, 'range')?.status).toBe('pass');
  });

  it('does not guess when range or distance is unreadable', () => {
    expect(line({ ...base, range: 'Sight' }, 'range')?.status).toBe('unknown');
    expect(line({ ...base, distance: { feet: null, error: 'no token' } }, 'range')?.status).toBe(
      'unknown'
    );
    expect(line({ ...base, target: undefined, distance: undefined }, 'range')?.status).toBe('info');
    expect(line({ ...base, range: 'Self' }, 'range')?.status).toBe('info');
  });

  it('checks spell slots: exact, higher, pact, none, below level', () => {
    const spell = {
      ...base,
      item: 'Fireball',
      spellLevel: 3,
      range: '150 Feet',
      distance: { feet: 30 },
    };
    const slots = (s: RulesFacts['slots']): RulesFacts => ({ ...spell, slots: s });
    expect(line(slots({ level3: { current: 1, max: 3 } }), 'slots')?.status).toBe('pass');
    expect(
      line(slots({ level3: { current: 0, max: 3 }, level4: { current: 1, max: 2 } }), 'slots')
        ?.reason
    ).toMatch(/level 4/);
    expect(line(slots({ level3: { current: 0, max: 3 } }), 'slots')?.status).toBe('fail');
    expect(line(slots({ pact: { current: 1, max: 2, level: 3 } }), 'slots')?.status).toBe('pass');
    expect(
      line({ ...slots({ level3: { current: 1, max: 3 } }), castLevel: 2 }, 'slots')?.status
    ).toBe('fail');
    expect(line(slots({}), 'slots')?.status).toBe('unknown');
    expect(evaluateAction(slots({ level3: { current: 0, max: 3 } })).verdict).toBe('problem');
  });

  it('uses no slot for at-will and innate spells, and the right slot for pact magic', () => {
    const spell = { ...base, item: 'Misty Step', spellLevel: 2, slots: {} };
    expect(line({ ...spell, spellMethod: 'atwill' }, 'slots')?.status).toBe('info');
    expect(line({ ...spell, spellMethod: 'innate' }, 'slots')?.reason).toMatch(/innately/);
    const pact = (level: number | null, current = 1): RulesFacts['slots'] => ({
      pact: { current, max: 2, level },
    });
    const cast = { ...spell, spellMethod: 'pact' };
    expect(line({ ...cast, slots: pact(3) }, 'slots')?.status).toBe('pass');
    expect(line({ ...cast, slots: pact(null) }, 'slots')?.status).toBe('unknown');
    expect(line({ ...cast, slots: pact(1) }, 'slots')?.status).toBe('fail');
    expect(line({ ...cast, slots: pact(3, 0) }, 'slots')?.status).toBe('fail');
    expect(line({ ...cast, slots: pact(3), castLevel: 2 }, 'slots')?.status).toBe('fail');
    // A pact slot does not stand in for a lower cast level or an unreadable level.
    const plain = { ...spell, spellMethod: 'spell', slots: pact(3), castLevel: 2 };
    expect(line(plain, 'slots')?.status).toBe('fail');
    expect(line({ ...plain, castLevel: null, slots: pact(null) }, 'slots')?.status).toBe('fail');
  });

  it('warns instead of failing for a ritual with no slot', () => {
    const spell = {
      ...base,
      item: 'Detect Magic',
      spellLevel: 1,
      slots: { level1: { current: 0, max: 2 } },
    };
    expect(line({ ...spell, ritual: true }, 'slots')?.status).toBe('warn');
    expect(line(spell, 'slots')?.status).toBe('fail');
  });

  it('cannot tell the turn when several tokens share the actor', () => {
    const several = {
      active: true,
      round: 1,
      inCombat: true,
      ambiguous: true,
      isCurrentTurn: false,
      currentName: 'Wolf 2',
    } as const;
    expect(line({ ...base, combat: several }, 'turn')?.status).toBe('unknown');
  });

  it('only calls a long activation a combat problem for a combatant', () => {
    const out = {
      active: true,
      round: 1,
      inCombat: false,
      isCurrentTurn: false,
      currentName: 'X',
    } as const;
    expect(line({ ...base, activation: '1 Minute', combat: out }, 'action-cost')?.status).toBe(
      'info'
    );
  });

  it('needs no slot for a cantrip and adds no slot line for a weapon', () => {
    expect(line({ ...base, spellLevel: 0 }, 'slots')?.status).toBe('info');
    expect(line(base, 'slots')).toBeUndefined();
  });

  it('checks uses', () => {
    expect(line({ ...base, uses: [{ value: 2, max: 3 }] }, 'uses')?.status).toBe('pass');
    const empty = line({ ...base, uses: [{ value: 0, max: 3, recovery: 'lr' }] }, 'uses');
    expect(empty?.status).toBe('fail');
    expect(empty?.reason).toMatch(/lr/);
    expect(line({ ...base, uses: [{ value: 0, max: 0 }] }, 'uses')).toBeUndefined();
  });

  it('flags a slow activation as a problem in combat only', () => {
    expect(line({ ...base, activation: '1 Minute' }, 'action-cost')?.status).toBe('warn');
    expect(
      line({ ...base, activation: '1 Minute', combat: { active: false } }, 'action-cost')?.status
    ).toBe('info');
  });

  it('puts the failing reason in the summary', () => {
    const r = evaluateAction({ ...base, distance: { feet: 30 } });
    expect(r.verdict).toBe('problem');
    expect(r.summary).toMatch(/not legal.*30 ft/);
  });
});
