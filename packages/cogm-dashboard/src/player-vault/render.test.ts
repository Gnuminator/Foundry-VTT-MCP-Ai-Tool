import type { CharacterSheet, PlayerHandout } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { RECAP_TITLE, renderPlayerVault } from './render.js';
import type { PlayerVaultInput, VaultSession } from './types.js';

const PLAYER = { userId: 'u1', name: 'Alice' };

function handout(over: Partial<PlayerHandout> & { title: string }): PlayerHandout {
  return { id: over.id ?? over.title, html: '<p>Body</p>', revealedAt: null, ...over };
}

function sheet(over: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id: 'a1',
    name: 'Ireena',
    level: 0,
    classes: [],
    species: null,
    background: null,
    alignment: null,
    xp: null,
    size: null,
    ac: null,
    hp: { value: 10, max: 10, temp: 0 },
    hitDice: { value: 0, max: 0 },
    deathSaves: { success: 0, failure: 0 },
    exhaustion: 0,
    inspiration: false,
    proficiencyBonus: null,
    initiative: null,
    speed: {},
    speedUnits: null,
    senses: [],
    abilities: [],
    skills: [],
    passivePerception: null,
    conditions: [],
    concentration: null,
    spellcasting: { ability: null, dc: null, attack: null },
    slots: [],
    spells: [],
    features: [],
    inventory: [],
    currency: {},
    languages: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    personality: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '' },
    ...over,
  };
}

function input(over: Partial<PlayerVaultInput> = {}): PlayerVaultInput {
  return {
    worldTitle: 'Curse of Strahd',
    player: PLAYER,
    handouts: [],
    sheets: [],
    sessions: [],
    theme: { id: 'neutral', css: null },
    ...over,
  };
}

function get(files: Map<string, string>, path: string): string {
  const content = files.get(path);
  if (content === undefined)
    throw new Error(`missing ${path}; have ${[...files.keys()].join(', ')}`);
  return content;
}

describe('RECAP_TITLE', () => {
  it('matches the word recap in any case, not a longer word', () => {
    expect(RECAP_TITLE.test('Session 3 Recap')).toBe(true);
    expect(RECAP_TITLE.test('RECAP: the road')).toBe(true);
    expect(RECAP_TITLE.test('Recapitulation')).toBe(false);
    expect(RECAP_TITLE.test('A letter')).toBe(false);
  });
});

describe('renderPlayerVault: handouts and recaps', () => {
  it('routes recaps to Recaps/ and everything else to Handouts/', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({ title: 'Session 1 Recap', revealedAt: '2026-11-30T20:00:00.000Z' }),
          handout({
            title: 'A Letter',
            revealedAt: '2026-11-29T20:00:00.000Z',
            html: '<p>Dear <b>Ireena</b></p>',
          }),
        ],
      })
    );
    expect(files.has('Recaps/Session 1 Recap.md')).toBe(true);
    expect(files.has('Handouts/A Letter.md')).toBe(true);
    expect(get(files, 'Handouts/A Letter.md')).toBe(
      '# A Letter\n\nRevealed: 2026-11-29\n\nDear **Ireena**\n'
    );
  });

  it('writes no Revealed line when revealedAt is null', () => {
    const files = renderPlayerVault(input({ handouts: [handout({ title: 'Map' })] }));
    expect(get(files, 'Handouts/Map.md')).toBe('# Map\n\nBody\n');
  });

  it('drops a handout meant for another player, keeps one for this player and one for everybody', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({ title: 'Bob only', players: ['u2'] }),
          handout({ title: 'Alice only', players: ['u1'] }),
          handout({ title: 'Alice and Bob', players: ['u2', 'u1'] }),
          handout({ title: 'Everybody' }),
          handout({ title: 'Nobody', players: [] }),
        ],
      })
    );
    const names = [...files.keys()].filter(p => p.startsWith('Handouts/')).sort();
    expect(names).toEqual([
      'Handouts/Alice and Bob.md',
      'Handouts/Alice only.md',
      'Handouts/Everybody.md',
    ]);
    const all = [...files.values()].join('\n');
    expect(all).not.toContain('Bob only');
    expect(all).not.toContain('Nobody');
  });

  it('gives duplicate titles unique names and a fallback for empty ones', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({ id: 'a', title: 'Letter', revealedAt: '2026-11-29T10:00:00Z' }),
          handout({ id: 'b', title: 'Letter', revealedAt: '2026-11-29T11:00:00Z' }),
          handout({ id: 'c', title: 'LETTER', revealedAt: '2026-11-29T12:00:00Z' }),
          handout({ id: 'd', title: '???', revealedAt: '2026-11-29T13:00:00Z' }),
        ],
      })
    );
    const names = [...files.keys()].filter(p => p.startsWith('Handouts/'));
    expect(names).toEqual([
      'Handouts/Letter.md',
      'Handouts/Letter (2).md',
      'Handouts/LETTER (3).md',
      'Handouts/Handout.md',
    ]);
  });

  it('keeps recap and handout names apart (own folders, own counters)', () => {
    const files = renderPlayerVault(
      input({ handouts: [handout({ title: 'Recap' }), handout({ id: 'x', title: 'Recap again' })] })
    );
    expect(files.has('Recaps/Recap.md')).toBe(true);
    expect(files.has('Recaps/Recap again.md')).toBe(true);
  });

  it('orders by revealedAt, then title', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({ title: 'B', revealedAt: '2026-11-29T10:00:00Z' }),
          handout({ title: 'A', revealedAt: '2026-11-29T10:00:00Z' }),
          handout({ title: 'Z', revealedAt: '2026-11-28T10:00:00Z' }),
        ],
      })
    );
    expect([...files.keys()].filter(p => p.startsWith('Handouts/'))).toEqual([
      'Handouts/Z.md',
      'Handouts/A.md',
      'Handouts/B.md',
    ]);
  });

  it('neutralizes a hostile title and body', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({
            title: '[[Evil]] <% tp %> obsidian://x',
            html: '<p>[[a]]</p><pre>dataviewjs\ndv.x()</pre>',
          }),
        ],
      })
    );
    for (const [path, content] of files) {
      expect(path).not.toContain('[[');
      expect(content).not.toContain('[[');
      expect(content).not.toContain('<%');
      expect(content.toLowerCase()).not.toContain('obsidian:');
      expect(content).not.toMatch(/```\w/);
    }
  });
});

describe('renderPlayerVault: characters', () => {
  it('one sheet goes to My character.md', () => {
    const files = renderPlayerVault(input({ sheets: [sheet()] }));
    expect(files.has('My character.md')).toBe(true);
    expect([...files.keys()].some(p => p.startsWith('My characters/'))).toBe(false);
    expect(get(files, 'My character.md').startsWith('# Ireena\n')).toBe(true);
  });

  it('several sheets go to My characters/<name>.md, duplicate names made unique', () => {
    const files = renderPlayerVault(
      input({
        sheets: [
          sheet({ id: '1', name: 'Ireena' }),
          sheet({ id: '2', name: 'Ismark' }),
          sheet({ id: '3', name: 'Ireena' }),
        ],
      })
    );
    expect(files.has('My character.md')).toBe(false);
    expect([...files.keys()].filter(p => p.startsWith('My characters/'))).toEqual([
      'My characters/Ireena.md',
      'My characters/Ismark.md',
      'My characters/Ireena (2).md',
    ]);
  });

  it('renders the overview, abilities, skills, spells, features and equipment', () => {
    const files = renderPlayerVault(
      input({
        sheets: [
          sheet({
            level: 5,
            classes: [
              { name: 'Fighter', levels: 3, subclass: 'Champion', hitDie: 'd10' },
              { name: 'Wizard', levels: 2, subclass: null, hitDie: 'd6' },
            ],
            species: 'Human',
            background: 'Soldier',
            alignment: 'Lawful Good',
            ac: 17,
            hp: { value: 30, max: 44, temp: 5 },
            hitDice: { value: 4, max: 5 },
            speed: { walk: 30, fly: 0 },
            speedUnits: 'ft',
            senses: ['Darkvision 60 ft'],
            proficiencyBonus: 3,
            initiative: 2,
            passivePerception: 13,
            conditions: ['Poisoned'],
            abilities: [
              { key: 'str', label: 'Strength', score: 16, mod: 3, save: 6, saveProficient: true },
              {
                key: 'dex',
                label: 'Dexterity',
                score: 8,
                mod: -1,
                save: -1,
                saveProficient: false,
              },
            ],
            skills: [
              {
                key: 'ath',
                label: 'Athletics',
                ability: 'str',
                total: 6,
                passive: 16,
                proficiency: 1,
              },
              {
                key: 'acr',
                label: 'Acrobatics',
                ability: 'dex',
                total: -1,
                passive: 9,
                proficiency: 0,
              },
              {
                key: 'prc',
                label: 'Perception',
                ability: 'wis',
                total: 5,
                passive: 15,
                proficiency: 2,
              },
            ],
            spellcasting: { ability: 'int', dc: 13, attack: 5 },
            slots: [
              { level: 1, value: 2, max: 3, pact: false },
              { level: 2, value: 0, max: 0, pact: false },
            ],
            spells: [
              {
                id: 's1',
                name: 'Fire Bolt',
                level: 0,
                school: 'evocation',
                prepared: true,
                castingTime: '1 action',
                range: '120 ft',
                duration: 'Instantaneous',
                concentration: false,
                ritual: false,
                components: 'V, S',
                material: null,
              },
              {
                id: 's2',
                name: 'Shield',
                level: 1,
                school: null,
                prepared: false,
                castingTime: null,
                range: null,
                duration: null,
                concentration: false,
                ritual: true,
                components: '',
                material: null,
              },
            ],
            features: [
              {
                id: 'f1',
                name: 'Second Wind',
                kind: 'class',
                uses: { value: 1, max: 1, recovery: 'short rest' },
                description: '<p>Regain <b>hit points</b>.</p>',
              },
            ],
            inventory: [
              {
                id: 'i1',
                name: 'Longsword',
                type: 'weapon',
                quantity: 1,
                equipped: true,
                attuned: false,
                attunement: null,
                uses: null,
                attack: '+6',
                damage: '1d8 + 3 slashing',
                description: 'A good blade.',
              },
              {
                id: 'i2',
                name: 'Arrows',
                type: 'consumable',
                quantity: 20,
                equipped: false,
                attuned: false,
                attunement: null,
                uses: null,
                attack: null,
                damage: null,
                description: '',
              },
            ],
            currency: { gp: 12, sp: 0, pp: 1 },
            languages: ['Common', 'Elvish'],
            armorProficiencies: ['Heavy armor'],
            resistances: ['Fire'],
            personality: {
              traits: 'Brave\nand loud',
              ideals: '',
              bonds: 'Family',
              flaws: '',
              appearance: '',
            },
          }),
        ],
      })
    );
    const md = get(files, 'My character.md');
    expect(md).toContain('- Class: Fighter 3 (Champion), Wizard 2');
    expect(md).toContain('- Hit points: 30/44 (+5 temporary)');
    expect(md).toContain('- Hit dice: 4/5 (d10, d6)');
    expect(md).toContain('- Speed: walk 30 ft');
    expect(md).not.toContain('fly');
    expect(md).toContain('- Proficiency bonus: +3');
    expect(md).toContain('| Strength | 16 | +3 | +6 | Yes |');
    expect(md).toContain('| Dexterity | 8 | -1 | -1 |  |');
    expect(md).toContain('| Athletics | str | +6 | 16 | Proficient |');
    expect(md).toContain('| Perception | wis | +5 | 15 | Expertise |');
    expect(md).toContain('- Spell save DC: 13');
    expect(md).toContain('- Spell attack: +5');
    expect(md).toContain('- Level 1 slots: 2/3');
    expect(md).not.toContain('Level 2 slots');
    expect(md).toContain('### Cantrips');
    expect(md).toContain(
      '- **Fire Bolt** (evocation, prepared): casting time 1 action; range 120 ft'
    );
    expect(md).toContain('### Level 1');
    expect(md).toContain('### Second Wind');
    expect(md).toContain('1/1 uses, short rest');
    expect(md).toContain('Regain **hit points**.');
    expect(md).toContain('- **Longsword** (weapon), equipped: attack +6; damage 1d8 + 3 slashing');
    expect(md).toContain('  A good blade.');
    expect(md).toContain('- **Arrows** (consumable) x20');
    expect(md).toContain('**Currency:** 1 pp, 12 gp');
    expect(md).toContain('- Languages: Common, Elvish');
    expect(md).toContain('- Resistances: Fire');
    expect(md).toContain('- Traits: Brave and loud');
    expect(md).toContain('- Bonds: Family');
    expect(md).not.toContain('Ideals');
  });

  it('skips empty sections', () => {
    const md = get(renderPlayerVault(input({ sheets: [sheet()] })), 'My character.md');
    for (const heading of [
      '## Abilities',
      '## Skills',
      '## Spellcasting',
      '## Spells',
      '## Features',
      '## Equipment',
      '## Proficiencies and languages',
      '## Defenses',
      '## Personality',
    ]) {
      expect(md).not.toContain(heading);
    }
    expect(md).toContain('## Overview');
  });

  it('neutralizes sheet strings and descriptions', () => {
    const md = get(
      renderPlayerVault(
        input({
          sheets: [
            sheet({
              name: '[[Hax]]',
              species: '<% tp %>',
              features: [
                {
                  id: 'f',
                  name: 'obsidian://x',
                  kind: 'feat',
                  uses: null,
                  description: '[[secret]] `= this.x`',
                },
              ],
            }),
          ],
        })
      ),
      'My character.md'
    );
    expect(md).not.toContain('[[');
    expect(md).not.toContain('<%');
    expect(md.toLowerCase()).not.toContain('obsidian:');
    expect(md).not.toMatch(/(?<!\\)`/); // every backtick is escaped: no code span, no Dataview query
  });
});

describe('renderPlayerVault: sessions', () => {
  const at = (h: number, m: number): number => new Date(2026, 10, 29, h, m, 5).getTime();
  const sessions: VaultSession[] = [
    {
      label: '2026-11-29',
      events: [
        { id: 'e1', timestampMs: at(9, 5), type: 'chat', text: 'The party enters Vallaki' },
        { id: 'e2', timestampMs: at(21, 30), type: 'roll', text: 'Ismark rolls [[1d20]] <% x %>' },
      ],
    },
    {
      label: '2026-11-30',
      events: [
        {
          id: 'e3',
          timestampMs: new Date(2026, 10, 30, 10, 0).getTime(),
          type: 'chat',
          text: 'Next day',
        },
      ],
    },
  ];

  it('writes one note per session with zero-padded local HH:MM lines', () => {
    const files = renderPlayerVault(input({ sessions }));
    const pad = (n: number): string => String(n).padStart(2, '0');
    const d1 = new Date(sessions[0].events[0].timestampMs);
    const d2 = new Date(sessions[0].events[1].timestampMs);
    const md = get(files, 'Session log/2026-11-29.md');
    expect(md.startsWith('# Session 2026-11-29\n\n')).toBe(true);
    expect(md).toContain(
      `- ${pad(d1.getHours())}:${pad(d1.getMinutes())} The party enters Vallaki`
    );
    expect(md).toContain(`- ${pad(d2.getHours())}:${pad(d2.getMinutes())} Ismark rolls`);
    expect(md).toContain('09:05');
    expect(md).not.toContain('[[');
    expect(md).not.toContain('<%');
  });

  it('lists the newest session first on Home', () => {
    const home = get(renderPlayerVault(input({ sessions })), 'Home.md');
    expect(home.indexOf('2026-11-30')).toBeGreaterThan(-1);
    expect(home.indexOf('2026-11-30')).toBeLessThan(home.indexOf('2026-11-29'));
  });

  it('a second session with a label that needs a safe name still links to its file', () => {
    const files = renderPlayerVault(input({ sessions: [{ label: '2026-11-29 (2)', events: [] }] }));
    expect(files.has('Session log/2026-11-29 (2).md')).toBe(true);
    expect(get(files, 'Home.md')).toContain('(Session%20log/2026-11-29%20%282%29.md)');
  });
});

describe('renderPlayerVault: Home', () => {
  it('names the world and the player, warns that edits are overwritten, uses Markdown links with encoded paths', () => {
    const files = renderPlayerVault(
      input({
        handouts: [
          handout({ title: 'My Note', revealedAt: '2026-11-29T10:00:00Z' }),
          handout({ title: 'Session 1 Recap', revealedAt: '2026-11-29T11:00:00Z' }),
        ],
        sheets: [sheet()],
      })
    );
    const home = get(files, 'Home.md');
    expect(home.startsWith('# Curse of Strahd\n')).toBe(true);
    expect(home).toContain('Player: Alice');
    expect(home).toContain('Edits you make here are overwritten');
    expect(home).toContain('[My Note](Handouts/My%20Note.md)');
    expect(home).toContain('[Session 1 Recap](Recaps/Session%201%20Recap.md)');
    expect(home).toContain('[Ireena](My%20character.md)');
    expect(home).not.toContain('[[');
  });

  it('every link on Home points at a file in the map', () => {
    const files = renderPlayerVault(
      input({
        handouts: [handout({ title: 'A (b) & c' }), handout({ id: 'r', title: 'Recap #1' })],
        sheets: [sheet({ id: '1', name: 'One' }), sheet({ id: '2', name: 'Two' })],
        sessions: [{ label: '2026-11-29', events: [] }],
      })
    );
    const home = get(files, 'Home.md');
    const targets = [...home.matchAll(/\]\(([^)]+)\)/g)].map(m => decodeURIComponent(m[1] ?? ''));
    expect(targets.length).toBe(5);
    for (const target of targets) expect(files.has(target)).toBe(true);
  });

  it('omits sections that have nothing', () => {
    const home = get(renderPlayerVault(input()), 'Home.md');
    expect(home).not.toContain('## ');
  });
});

describe('renderPlayerVault: theme', () => {
  it('writes the snippet and appearance.json only when css is present', () => {
    const files = renderPlayerVault(
      input({ theme: { id: 'veil', css: 'body { color: red; }\n' } })
    );
    expect(get(files, '.obsidian/snippets/aitool-theme-veil.css')).toBe('body { color: red; }\n');
    expect(get(files, '.obsidian/appearance.json')).toBe(
      '{\n  "enabledCssSnippets": [\n    "aitool-theme-veil"\n  ]\n}\n'
    );
  });

  it('writes no .obsidian files when css is null or empty', () => {
    for (const css of [null, '']) {
      const files = renderPlayerVault(input({ theme: { id: 'neutral', css } }));
      expect([...files.keys()].some(p => p.startsWith('.obsidian/'))).toBe(false);
    }
  });
});

describe('renderPlayerVault: whole vault', () => {
  const full = (): PlayerVaultInput =>
    input({
      handouts: [
        handout({ title: 'B', revealedAt: '2026-11-29T10:00:00Z' }),
        handout({
          title: 'Recap',
          revealedAt: '2026-11-29T09:00:00Z',
          html: '<ul><li>x</li></ul>',
        }),
      ],
      sheets: [sheet()],
      sessions: [
        {
          label: '2026-11-29',
          events: [{ id: 'e', timestampMs: 1_700_000_000_000, type: 'chat', text: 'Hi' }],
        },
      ],
      theme: { id: 'veil', css: '.a{}' },
    });

  it('is deterministic: same input, same paths in the same order, same content', () => {
    const a = renderPlayerVault(full());
    const b = renderPlayerVault(full());
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('uses forward slashes and no wikilink characters in any path or generated note', () => {
    const files = renderPlayerVault(full());
    for (const [path, content] of files) {
      expect(path).not.toContain('\\');
      expect(path).not.toContain('[[');
      if (path.endsWith('.md')) expect(content).not.toContain('[[');
    }
    expect([...files.keys()][0]).toBe('Home.md');
  });

  it('does not change its input', () => {
    const data = full();
    const copy = structuredClone(data);
    renderPlayerVault(data);
    expect(data).toEqual(copy);
  });
});
