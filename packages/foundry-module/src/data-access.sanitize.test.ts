import { describe, expect, it } from 'vitest';
import { sanitizeData } from './data-access/shared.js';

describe('sanitizeData: dnd5e 6 Sets and Collections', () => {
  it('turns a Set (item properties) into an array', () => {
    const system = { properties: new Set(['stealthDisadvantage', 'mgc']) };
    expect(sanitizeData(system)).toEqual({ properties: ['stealthDisadvantage', 'mgc'] });
  });

  it('turns a Map (activities Collection) into the array of its values, via toJSON', () => {
    const parent = { name: 'Fire Bolt' };
    const activity = {
      type: 'attack',
      parent,
      toJSON: (): Record<string, unknown> => ({ _id: 'a1', type: 'attack', attack: { bonus: '' } }),
    };
    const system = { activities: new Map([['a1', activity]]), level: 0 };
    expect(sanitizeData(system)).toEqual({
      activities: [{ _id: 'a1', type: 'attack', attack: { bonus: '' } }],
      level: 0,
    });
  });

  it('keeps plain Map values without toJSON', () => {
    expect(sanitizeData({ m: new Map([['x', { a: 1 }]]) })).toEqual({ m: [{ a: 1 }] });
  });
});

describe('sanitizeData: save keys', () => {
  it("keeps an activity's save (ability and dc)", () => {
    const activity = {
      type: 'save',
      save: { ability: new Set(['dex']), dc: { calculation: 'spellcasting', formula: '' } },
    };
    expect(sanitizeData({ activities: new Map([['s1', activity]]) })).toEqual({
      activities: [
        {
          type: 'save',
          save: { ability: ['dex'], dc: { calculation: 'spellcasting', formula: '' } },
        },
      ],
    });
  });

  it('drops the save of an ability entry only', () => {
    const abilities = {
      str: { value: 16, proficient: 1, mod: 3, save: { value: 5 } },
    };
    expect(sanitizeData({ abilities })).toEqual({
      abilities: { str: { value: 16, proficient: 1, mod: 3 } },
    });
  });
});

describe('sanitizeData: shared references versus real cycles', () => {
  it('keeps the species item when details.race and items point at the same object', () => {
    const species = { _id: 'sp1', name: 'Hill Dwarf', type: 'race' };
    const actor = { name: 'Test PC', system: { details: { race: species } }, items: [species] };
    const out = sanitizeData(actor) as {
      system: { details: { race: unknown } };
      items: unknown[];
    };
    expect(out.system.details.race).toEqual(species);
    expect(out.items[0]).toEqual(species);
  });

  it('marks an indirect cycle (a to b to a)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.b = { name: 'b', back: a };
    expect(sanitizeData(a)).toEqual({ name: 'a', b: { name: 'b', back: '[Circular Reference]' } });
  });

  it('stops a heavily shared graph instead of walking every path', () => {
    let node: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i++) node = { left: node, right: node };
    const started = Date.now();
    const out = JSON.stringify(sanitizeData(node));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out).toContain('[Truncated]');
  });

  it('still marks a real cycle', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(sanitizeData(a)).toEqual({ name: 'a', self: '[Circular Reference]' });
  });
});
