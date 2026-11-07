import { describe, expect, it } from 'vitest';

import {
  TWIN_PACK,
  decideTwin,
  formatCr,
  normalizeName,
  parseMonsterUuid,
  statBlockFromActor,
  statBlockFromCompendium,
  twinSearchName,
} from './statblockTwin';

describe('normalizeName', () => {
  it('ignores case, accents, punctuation and a plural s', () => {
    expect(normalizeName('Vampire Spawn')).toBe('vampire spawn');
    expect(normalizeName('  Zombies ')).toBe('zombie');
    expect(normalizeName('Strahd von Zarovich')).toBe('strahd von zarovich');
    expect(normalizeName('Gnoll Pack-Lord')).toBe('gnoll pack lord');
    expect(normalizeName('Wolf')).toBe('wolf');
  });
});

describe('twinSearchName', () => {
  it('asks for the longest plain word', () => {
    expect(twinSearchName('Vampire Spawn')).toBe('vampire');
    expect(twinSearchName('Gnoll Pack-Lord')).toBe('gnoll');
    expect(twinSearchName('Zombies')).toBe('zombie');
    expect(twinSearchName('Rat')).toBe('rat');
  });
});

describe('decideTwin on the three monsters of the research note', () => {
  it('Vampire Spawn has a clear twin by name', () => {
    expect(decideTwin('Vampire Spawn', ['Vampire', 'Vampire Spawn', 'Vampire Familiar'])).toEqual({
      kind: 'twin',
      name: 'Vampire Spawn',
      how: 'name',
    });
  });
  it('Wereraven says there is no twin and only points at the wererat', () => {
    const v = decideTwin('Wereraven', ['Wererat', 'Werewolf']);
    expect(v).toMatchObject({ kind: 'none', closest: 'Wererat' });
  });
  it('Strahd says there is no twin even if a monster with that name were found', () => {
    const v = decideTwin('Strahd von Zarovich', ['Strahd von Zarovich', 'Vampire']);
    expect(v).toMatchObject({ kind: 'none', closest: 'Vampire' });
  });
});

describe('decideTwin rules', () => {
  it('no 2024 monster of that name is no twin, with nothing guessed', () => {
    const v = decideTwin('Vampire Spawn Lord', ['Vampire Spawn', 'Vampire']);
    expect(v.kind).toBe('none');
    expect(v).not.toHaveProperty('closest');
  });
  it('a cut-off search without a hit is unsure, never "no twin"', () => {
    expect(decideTwin('Rat', ['Giant Rat'], undefined, true).kind).toBe('unsure');
    expect(decideTwin('Rat', ['Rat'], undefined, true).kind).toBe('twin');
  });
  it('an empty search is no twin', () => {
    expect(decideTwin('Zombie', []).kind).toBe('none');
  });
  it('two monsters with one name is no single twin', () => {
    expect(decideTwin('Zombie', ['Zombie', 'zombie']).kind).toBe('none');
  });
  it('a monster picked from the 2024 pack is already 2024', () => {
    expect(decideTwin('Vampire', ['Vampire'], TWIN_PACK)).toEqual({ kind: 'already-2024' });
  });
});

describe('parseMonsterUuid', () => {
  it('reads compendium and world actors, nothing else', () => {
    expect(parseMonsterUuid('Compendium.dnd5e.monsters.Actor.zpaZb7I8alY32vWV')).toEqual({
      kind: 'compendium',
      pack: 'dnd5e.monsters',
      id: 'zpaZb7I8alY32vWV',
    });
    expect(parseMonsterUuid('Actor.VjTBkMPvgDBD1rxV')).toEqual({
      kind: 'world',
      id: 'VjTBkMPvgDBD1rxV',
    });
    expect(parseMonsterUuid('Compendium.dnd5e.items.Item.abc')).toBeNull();
    expect(parseMonsterUuid('Scene.abc.Token.def')).toEqual({ kind: 'token', id: 'def' });
    expect(parseMonsterUuid('Scene.abc.Note.def')).toBeNull();
    expect(parseMonsterUuid('')).toBeNull();
  });
});

describe('stat block readers', () => {
  it('reads a compendium actor', () => {
    const sb = statBlockFromCompendium({
      name: 'Vampire Spawn',
      fullData: {
        name: 'Vampire Spawn',
        system: {
          attributes: {
            ac: { override: 16 },
            hp: { value: 90, max: 90 },
            movement: { speeds: { walk: '30', fly: null } },
          },
          details: { cr: 5, type: { value: 'undead' } },
          traits: { size: 'med' },
          abilities: { str: { value: 16 }, dex: { value: 16 } },
        },
        items: [{ name: 'Multiattack' }, { name: 'Bite' }],
      },
    });
    expect(sb).toMatchObject({
      name: 'Vampire Spawn',
      size: 'Medium',
      creatureType: 'undead',
      cr: 5,
      ac: 16,
      hp: 90,
      speed: 'walk 30',
      features: ['Multiattack', 'Bite'],
    });
    expect(sb?.abilities).toHaveLength(6);
  });
  it('reads the AC the way dnd5e 6 stores it', () => {
    const make = (extra: Record<string, unknown>, ac: Record<string, unknown>): unknown => ({
      ...extra,
      fullData: { name: 'X', system: { attributes: { ac, hp: {} }, details: {} } },
    });
    // prepared value wins
    expect(
      statBlockFromCompendium(make({ system: { attributes: { ac: { value: 16 } } } }, { flat: 12 }))
        ?.ac
    ).toBe(16);
    // a fixed AC in override
    expect(statBlockFromCompendium(make({}, { override: 16, flat: null }))?.ac).toBe(16);
    // flat feeds only natural armour; armoured or unarmoured is not the flat number
    expect(statBlockFromCompendium(make({}, { calcs: ['natural'], flat: 13 }))?.ac).toBe(13);
    expect(
      statBlockFromCompendium(make({}, { calcs: ['unarmored', 'armored'], flat: 12 }))?.ac
    ).toBeNull();
  });
  it('leaves a missing ability score null instead of making one up', () => {
    const sb = statBlockFromActor({
      name: 'Wolf',
      stats: { armorClass: 12, abilities: { str: { value: 14 } } },
    });
    expect(sb?.abilities.find(a => a.key === 'str')?.value).toBe(14);
    expect(sb?.abilities.find(a => a.key === 'dex')?.value).toBeNull();
  });
  it('reads a world actor', () => {
    const sb = statBlockFromActor({
      name: 'Wolf',
      stats: {
        challengeRating: 0.25,
        armorClass: 12,
        hitPoints: { max: 11 },
        creatureType: 'beast',
        size: 'med',
        abilities: { str: { value: 14 } },
      },
      items: [{ name: 'Bite' }],
    });
    expect(sb).toMatchObject({ cr: 0.25, ac: 12, hp: 11, features: ['Bite'] });
  });
  it('gives null for an answer without a stat block', () => {
    expect(statBlockFromCompendium({})).toBeNull();
    expect(statBlockFromActor(null)).toBeNull();
  });
  it('writes small CRs as fractions', () => {
    expect([0.125, 0.25, 0.5, 5, null].map(formatCr)).toEqual(['1/8', '1/4', '1/2', '5', '?']);
  });
});
