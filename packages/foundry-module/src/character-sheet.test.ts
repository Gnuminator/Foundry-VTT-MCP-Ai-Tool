/**
 * My character (I-096): the projection is an allowlist of sheet fields; unidentified items and
 * secret blocks stay hidden; a player gets only the character actors their user OWNS.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { plainText, stripSecrets } from './character-sheet-fields.js';
import { characterSheets, projectCharacterSheet, type SheetActor } from './character-sheet.js';

const g = globalThis as any;
const savedGame = g.game;
afterEach(() => {
  g.game = savedGame;
});

function hero(overrides: Partial<SheetActor> = {}): SheetActor {
  return {
    id: 'hero00000000001',
    name: 'Brenna',
    type: 'character',
    system: {
      details: { level: 3, alignment: 'Neutral Good', xp: { value: 900 }, trait: '<p>Loyal.</p>' },
      attributes: {
        ac: { value: 16 },
        hp: { value: 24, max: 28, temp: 2 },
        hd: { value: 2, max: 3 },
        death: { success: 1, failure: 0 },
        prof: 2,
        init: { total: 3 },
        movement: { walk: 30, fly: 0, units: 'ft' },
        senses: { darkvision: 60, units: 'ft' },
        spellcasting: 'wis',
        spell: { dc: 13, attack: 5 },
      },
      abilities: {
        str: { value: 16, mod: 3, proficient: 1, save: { value: 5 } },
        wis: { value: 14, mod: 2, proficient: 0, save: 2 },
      },
      skills: { prc: { total: 4, passive: 14, value: 1, ability: 'wis' } },
      spells: { spell1: { value: 1, max: 3 }, spell2: { value: 0, max: 0 } },
      currency: { gp: 12, sp: 5 },
      traits: { size: 'med', languages: { value: ['common', 'elvish'], custom: 'Thieves cant' } },
      flags: { secret: 'GM only' },
    },
    items: [
      {
        id: 'cls',
        name: 'Fighter',
        type: 'class',
        system: { levels: 3, identifier: 'fighter', hd: { denomination: 'd10' } },
      },
      { id: 'sub', name: 'Champion', type: 'subclass', system: { classIdentifier: 'fighter' } },
      { id: 'race', name: 'Human', type: 'race', system: {} },
      {
        id: 'sword',
        name: 'Longsword',
        type: 'weapon',
        system: {
          quantity: 1,
          equipped: true,
          description: { value: '<p>Sharp.</p><section class="secret">Cursed!</section>' },
        },
        labels: { toHit: '+5', damages: [{ label: '1d8 + 3 Slashing' }] },
      },
      {
        id: 'ring',
        name: 'Ring of the Vampire Lord',
        type: 'equipment',
        system: {
          identified: false,
          unidentified: { name: 'Plain ring', description: '<p>A cold iron ring.</p>' },
          description: { value: 'Drains life. Belonged to the count.' },
          attunement: 'required',
        },
        labels: { toHit: '+9' },
      },
      {
        id: 'cure',
        name: 'Cure Wounds',
        type: 'spell',
        system: { level: 1, prepared: 1, properties: ['vocal', 'somatic'] },
        labels: { range: 'Touch' },
      },
      {
        id: 'second',
        name: 'Second Wind',
        type: 'feat',
        system: {
          type: { value: 'class' },
          uses: { spent: 1, max: 1, recovery: [{ period: 'sr' }] },
        },
      },
    ],
    statuses: ['prone'],
    ...overrides,
  };
}

describe('projectCharacterSheet', () => {
  it('projects the sheet fields', () => {
    const s = projectCharacterSheet(hero());
    expect(s).toMatchObject({
      name: 'Brenna',
      level: 3,
      classes: [{ name: 'Fighter', levels: 3, subclass: 'Champion', hitDie: 'd10' }],
      species: 'Human',
      alignment: 'Neutral Good',
      xp: 900,
      ac: 16,
      hp: { value: 24, max: 28, temp: 2 },
      hitDice: { value: 2, max: 3 },
      proficiencyBonus: 2,
      initiative: 3,
      speed: { walk: 30 },
      senses: ['darkvision 60 ft'],
      passivePerception: 14,
      conditions: ['prone'],
      spellcasting: { ability: 'wis', dc: 13, attack: 5 },
      slots: [{ level: 1, value: 1, max: 3, pact: false }],
      currency: { gp: 12, sp: 5 },
      languages: ['common', 'elvish', 'Thieves cant'],
    });
    expect(s.abilities).toEqual([
      { key: 'str', label: 'str', score: 16, mod: 3, save: 5, saveProficient: true },
      { key: 'wis', label: 'wis', score: 14, mod: 2, save: 2, saveProficient: false },
    ]);
    expect(s.spells[0]).toMatchObject({
      name: 'Cure Wounds',
      level: 1,
      prepared: true,
      components: 'V, S',
      range: 'Touch',
    });
    expect(s.features[0]).toMatchObject({
      name: 'Second Wind',
      kind: 'class',
      uses: { value: 0, max: 1, recovery: 'sr' },
    });
    expect(s.personality.traits).toBe('Loyal.');
  });

  it("leaves out dnd5e's default spellcasting for a character without spells or slots", () => {
    const base = hero();
    const s = projectCharacterSheet({
      ...base,
      system: { ...base.system, spells: {} },
      items: (base.items ?? []).filter(i => i.type !== 'spell'),
    });
    expect(s.spellcasting).toEqual({ ability: null, dc: null, attack: null });
  });

  it('shows the label of a use recovery period when dnd5e has one', () => {
    g.CONFIG = { DND5E: { limitedUsePeriods: { sr: { label: 'Short Rest' } } } };
    try {
      expect(projectCharacterSheet(hero()).features[0]?.uses?.recovery).toBe('Short Rest');
    } finally {
      delete g.CONFIG;
    }
  });

  it('shows an unidentified item only by its unidentified name and description', () => {
    const ring = projectCharacterSheet(hero()).inventory.find(i => i.id === 'ring');
    expect(ring).toMatchObject({
      name: 'Plain ring',
      description: 'A cold iron ring.',
      attack: null,
      attunement: 'required',
    });
    expect(JSON.stringify(projectCharacterSheet(hero()))).not.toMatch(/Vampire|Drains life|count/);
  });

  it('drops secret blocks and never carries flags', () => {
    const s = projectCharacterSheet(hero());
    const sword = s.inventory.find(i => i.id === 'sword');
    expect(sword).toMatchObject({
      description: 'Sharp.',
      attack: '+5',
      damage: '1d8 + 3 Slashing',
    });
    expect(JSON.stringify(s)).not.toMatch(/Cursed|GM only|flags/);
  });
});

describe('characterSheets', () => {
  const user = { id: 'player000000001', name: 'Player', isGM: false };
  const gm = { id: 'gm0000000000001', name: 'GM', isGM: true };
  const owned = {
    ...hero(),
    testUserPermission: (u: unknown, level: string): boolean => u === user && level === 'OWNER',
  };
  const observed = {
    ...hero({ id: 'other0000000001', name: 'Tamsin' }),
    testUserPermission: (): boolean => false,
  };
  const npc = {
    ...hero({ id: 'wolf00000000001', name: 'Wolf', type: 'npc' }),
    testUserPermission: (): boolean => true,
  };

  function install(): void {
    g.game = {
      users: { get: (id: string) => [user, gm].find(u => u.id === id) },
      actors: [owned, observed, npc],
    };
  }

  it('returns only the character actors the user owns', async () => {
    install();
    const result = await characterSheets({ userId: user.id });
    expect(result.userName).toBe('Player');
    expect(result.sheets.map(s => s.name)).toEqual(['Brenna']);
  });

  it('refuses a GM user and an unknown user', async () => {
    install();
    await expect(characterSheets({ userId: gm.id })).rejects.toThrow('No such player');
    await expect(characterSheets({ userId: 'nobody000000000' })).rejects.toThrow('No such player');
    await expect(characterSheets({})).rejects.toThrow('No such player');
  });
});

describe('stripSecrets and plainText', () => {
  it('drops a secret section with a nested section, tail included (#155 review point 6)', () => {
    const html =
      '<p>Open.</p><section class="secret"><section><p>Inner</p></section><p>Tail of the secret</p></section><p>After.</p>';
    expect(plainText(html)).toBe('Open.\nAfter.');
    expect(stripSecrets(html)).toBe('<p>Open.</p><p>After.</p>');
  });

  it('drops secrets nested in other tags, revealed secrets, secret-block and GM-only classes', () => {
    const html = [
      '<div class="note secret revealed"><div>a</div><div>b</div>x</div>',
      '<secret-block><section class="secret">y</section></secret-block>',
      "<span class='gm-only'>z</span><p class=gmnote>w</p>",
      '<!-- hidden --><p>kept</p>',
    ].join('');
    expect(plainText(html)).toBe('kept');
  });

  it('keeps void and self-closing tags out of the depth count', () => {
    const html = '<section class="secret">a<br><img src="x.png"/><section/>b</section><p>c</p>';
    expect(plainText(html)).toBe('c');
  });

  it('reads quoted attributes that hold ">" and drops an unclosed secret to the end', () => {
    expect(plainText('<p title="a>b">one</p><div class="secret">two<p>three</p>')).toBe('one');
  });

  it('reads the class attribute, not data-class', () => {
    expect(plainText('<div data-class="x" class="secret">hidden</div><p>shown</p>')).toBe('shown');
  });

  it('keeps ordinary content', () => {
    expect(
      plainText('<p class="lead">Hello <em>there</em></p><ul><li>one</li><li>two</li></ul>')
    ).toBe('Hello there\none\ntwo');
  });
});
