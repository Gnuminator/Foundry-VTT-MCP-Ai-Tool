/**
 * The paper-night sheet (paper-print, public/me-paper.js): a write-in box for every field the
 * paper sync reads back, in the same order as the carry-over strip, for each class layout.
 */
import type { CharacterSheet } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { renderPaperNight } from '../public/me-paper.js';

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id: 'a1',
    name: 'Brann <Ironhand>',
    level: 5,
    classes: [{ name: 'Fighter', levels: 5, subclass: null, hitDie: 'd10' }],
    species: 'Dwarf',
    background: null,
    alignment: null,
    xp: 6500,
    size: 'med',
    ac: 18,
    hp: { value: 30, max: 44, temp: 3 },
    hitDice: { value: 3, max: 5 },
    deathSaves: { success: 0, failure: 0 },
    exhaustion: 1,
    inspiration: true,
    proficiencyBonus: 3,
    initiative: 1,
    speed: { walk: 25 },
    speedUnits: 'ft',
    senses: [],
    abilities: [],
    skills: [],
    passivePerception: 11,
    conditions: ['Poisoned'],
    concentration: null,
    spellcasting: { ability: null, dc: null, attack: null },
    slots: [],
    spells: [],
    features: [
      {
        id: 'f1',
        name: 'Second Wind',
        kind: 'class',
        uses: { value: 0, max: 1, recovery: 'sr' },
        description: '',
      },
    ],
    inventory: [
      {
        id: 'i1',
        name: 'Rope (50 ft)',
        type: 'loot',
        quantity: 2,
        equipped: false,
        attuned: false,
        attunement: null,
        uses: null,
        attack: null,
        damage: null,
        description: '',
      },
    ],
    currency: { cp: 0, sp: 4, ep: 0, gp: 120, pp: 0 },
    languages: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    personality: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '' },
    ...overrides,
  };
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;
const stripTitles = (html: string): string[] =>
  [
    ...html.slice(html.indexOf('class="strip"')).matchAll(/<li><i class="sq"><\/i>([^<]+)<\/li>/g),
  ].map(m => m[1]);

describe('renderPaperNight', () => {
  it('lists the fields of the paper sync in the strip, in order, without slots for a martial class', () => {
    const html = renderPaperNight(sheet());
    expect(stripTitles(html)).toEqual([
      'Hit points and temp HP',
      'Hit dice',
      'Class resources and item uses',
      'Coins',
      'Exhaustion',
      'Conditions',
      'Inspiration',
      'Death saves',
      'Inventory',
    ]);
    expect(html).not.toContain('Spell slots');
    expect(html).not.toContain('Spell save DC');
  });

  it('numbers the blocks the same way as the strip and escapes names', () => {
    const html = renderPaperNight(sheet());
    expect(html).toContain('<span class="n">1</span>Hit points and temp HP');
    expect(html).toContain('<span class="n">9</span>Inventory');
    expect(html).toContain('Brann &lt;Ironhand&gt;');
    expect(html).not.toContain('<Ironhand>');
  });

  it('crosses out the dice, uses and exhaustion already spent when it was printed', () => {
    const html = renderPaperNight(sheet());
    // 2 of 5 hit dice spent, the one Second Wind use, exhaustion 1.
    expect(count(html, '<i class="sq used">×</i>')).toBe(2 + 1 + 1);
    expect(html).toContain('had it at print');
    expect(html).toContain('3/5 at print');
    expect(html).toContain('2 spent at print');
    expect(html).toContain('Second Wind');
    expect(html).toContain('0/1 at print');
  });

  it('prints no XP: the table plays on milestones', () => {
    expect(renderPaperNight(sheet())).not.toMatch(/6500|Experience/);
  });

  it('gives a slot row per level and a pact row for a caster, with the spent slots crossed out', () => {
    const html = renderPaperNight(
      sheet({
        classes: [
          { name: 'Wizard', levels: 3, subclass: null, hitDie: 'd6' },
          { name: 'Warlock', levels: 2, subclass: null, hitDie: 'd8' },
        ],
        hitDice: { value: 4, max: 5 },
        spellcasting: { ability: 'int', dc: 14, attack: 6 },
        slots: [
          { level: 1, value: 2, max: 4, pact: false },
          { level: 2, value: 2, max: 2, pact: false },
          { level: 1, value: 0, max: 2, pact: true },
        ],
      })
    );
    expect(stripTitles(html)).toContain('Spell slots');
    expect(html).toContain('Level 1');
    expect(html).toContain('Pact slots (level 1)');
    expect(html).toContain('Spell save DC');
    // Level 1: 2 spent, pact: 2 spent. Plus the exhaustion square and the Second Wind use.
    expect(count(html, '<i class="sq used">×</i>')).toBe(2 + 2 + 1 + 1);
    expect(html).not.toContain('d10');
  });

  it('gives a multiclass one row of hit dice per class, empty, and the total left', () => {
    const html = renderPaperNight(
      sheet({
        classes: [
          { name: 'Wizard', levels: 3, subclass: null, hitDie: 'd6' },
          { name: 'Warlock', levels: 2, subclass: null, hitDie: 'd8' },
        ],
        hitDice: { value: 4, max: 5 },
      })
    );
    expect(html).toContain('Wizard d6');
    expect(html).toContain('Warlock d8');
    expect(html).toContain('4 of 5 left at print (all classes)');
  });

  it('writes a number in instead of a long row of squares', () => {
    const html = renderPaperNight(
      sheet({
        features: [
          {
            id: 'f2',
            name: 'Lay on Hands',
            kind: 'class',
            uses: { value: 18, max: 25, recovery: 'lr' },
            description: '',
          },
        ],
      })
    );
    expect(html).toContain('of 25');
    expect(html).toContain('18/25 at print');
  });

  it('gives every inventory line a Now box and leaves empty lines for new items', () => {
    const html = renderPaperNight(sheet());
    expect(html).toContain('Rope (50 ft)');
    expect(count(html, '<tr class="free">')).toBe(6);
    expect(count(html, 'wi-qty')).toBe(1 + 6);
  });

  it('lists an item with charges that never recharge, and writes a number in for 20 hit dice', () => {
    const base = sheet();
    const html = renderPaperNight(
      sheet({
        classes: [{ name: 'Fighter', levels: 20, subclass: null, hitDie: 'd10' }],
        hitDice: { value: 12, max: 20 },
        inventory: [
          {
            ...base.inventory[0],
            id: 'i2',
            name: 'Wand of Magic Missiles',
            uses: { value: 5, max: 7, recovery: null },
          },
        ],
      })
    );
    expect(html).toContain('Wand of Magic Missiles');
    expect(html).toContain('5/7 at print');
    expect(html).toContain('Fighter d10');
    expect(html).toContain('12/20 at print');
    expect(html).toContain('of 20');
  });

  it('has a write-in box for each of the five coins', () => {
    const html = renderPaperNight(sheet());
    for (const coin of ['CP', 'SP', 'EP', 'GP', 'PP']) expect(html).toContain(`${coin} at print`);
    expect(html).toContain('GP at print 120');
  });
});
