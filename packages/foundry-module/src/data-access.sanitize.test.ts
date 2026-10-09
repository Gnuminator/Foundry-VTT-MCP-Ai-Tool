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
