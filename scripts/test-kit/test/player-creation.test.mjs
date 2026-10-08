import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeSheet, playerStudioSettings } from '../lib/player-creation.mjs';
import { narrowSources, studioSettingsFor } from '../lib/studio.mjs';

/** A level-1 wizard sheet that passes every check; tests break one thing. */
function fixture() {
  return {
    sheet: {
      name: 'Player Wizard 1',
      ownership: { default: 0, player1: 3 },
      level: 1,
      classes: [{ identifier: 'wizard', levels: 1, hitDie: 6, firstLevelHp: 'max' }],
      species: ['Elf'],
      backgrounds: ['Sage'],
      hp: { value: 8, max: 8 },
      conMod: 2,
      ac: 12,
      gp: 19,
      items: [
        { name: 'Dagger', type: 'weapon' },
        { name: 'Robe', type: 'equipment' },
        { name: 'Fire Bolt', type: 'spell' },
      ],
      spells: [{ name: 'Fire Bolt', identifier: 'fire-bolt', level: 0 }],
      armor: [],
    },
    playerId: 'player1',
    classIdentifier: 'wizard',
    planned: ['Dagger', 'Robe'],
    spellList: ['fire-bolt', 'magic-missile'],
  };
}

test('judgeSheet: a valid level-1 sheet has no problems', () => {
  const v = judgeSheet(fixture());
  assert.deepEqual(v.problems, []);
  assert.match(v.notes.at(-1) ?? '', /3 items, 1 spells, 19 gp, AC 12/);
});

test('judgeSheet: the player must own the character', () => {
  const o = fixture();
  o.sheet.ownership = { default: 0, player1: 2 };
  assert.match(judgeSheet(o).problems[0].what, /does not own/);
});

test('judgeSheet: level, class, species and background', () => {
  const o = fixture();
  o.sheet.level = 2;
  o.sheet.classes = [{ identifier: 'wizard', levels: 2, hitDie: 6, firstLevelHp: 'max' }];
  o.sheet.species = [];
  o.sheet.backgrounds = [];
  const what = judgeSheet(o).problems.map(p => p.what);
  assert.ok(what.includes('the character is not level 1'));
  assert.ok(what.some(w => /exactly one level of wizard/.test(w)));
  assert.ok(what.includes('the character has no species'));
  assert.ok(what.includes('the character has no background'));
});

test('judgeSheet: hit points: at least the hit die plus Constitution, the full die at level 1, full', () => {
  const o = fixture();
  o.sheet.hp = { value: 6, max: 7 };
  o.sheet.classes[0].firstLevelHp = 'avg';
  const p = judgeSheet(o).problems;
  assert.equal(p[0].evidence, 'max 7, at least d6 + Con 2 = 8');
  assert.equal(p[1].evidence, 'HitPoints advancement level 1: "avg"');
  assert.match(p[2].what, /full hit points/);
  // More is fine (the Tough feat from the Farmer background gives 2 at level 1).
  const tough = fixture();
  tough.sheet.hp = { value: 10, max: 10 };
  assert.deepEqual(judgeSheet(tough).problems, []);
  // A negative modifier never takes a level-1 hero below 1 hit point.
  const low = fixture();
  low.sheet.conMod = -6;
  low.sheet.hp = { value: 1, max: 1 };
  assert.deepEqual(judgeSheet(low).problems, []);
});

test('judgeSheet: planned starting equipment must reach the sheet', () => {
  const o = fixture();
  o.planned = ['Dagger', 'Robe', 'Spellbook'];
  const p = judgeSheet(o).problems;
  assert.equal(p.length, 1);
  assert.equal(p[0].evidence, 'Spellbook');
});

test('judgeSheet: spells off the class spell list are a problem; no list, no check', () => {
  const o = fixture();
  o.sheet.spells.push({ name: 'Bless', identifier: 'bless', level: 1 });
  const p = judgeSheet(o).problems;
  assert.match(p[0].what, /not on the wizard spell list/);
  assert.match(p[0].evidence, /1 of 2: Bless/);
  o.spellList = null;
  assert.deepEqual(judgeSheet(o).problems, []);
});

test('judgeSheet: pump errors fail; unequipped starting armor is a note', () => {
  const o = fixture();
  o.sheet.armor = [{ name: 'Chain Mail', equipped: false }];
  const v = judgeSheet({ ...o, pumpErrors: ['no option for Skills'] });
  assert.deepEqual(v.problems, [
    { what: 'an advancement answer failed', evidence: 'no option for Skills' },
  ]);
  assert.match(v.notes[0], /starting armor arrives unequipped \(Chain Mail; AC 12\)/);
});

test('playerStudioSettings: equipment on, class and origin lists narrowed, equipment packs kept', () => {
  const profile = {
    packs: {
      classes: ['phb.classes', 'dnd5e.classes24'],
      subclasses: ['phb.classes'],
      species: ['phb.origins', 'dnd5e.origins24'],
      backgrounds: ['phb.origins', 'dnd5e.origins24'],
      spells: ['phb.spells'],
      feats: ['phb.feats'],
      equipment: ['phb.equipment'],
    },
  };
  const s = playerStudioSettings(
    studioSettingsFor(profile),
    { class: 'phb.classes', species: 'phb.origins', background: 'phb.origins' },
    narrowSources
  );
  assert.equal(s.enableEquipmentSelection, true);
  assert.deepEqual(s.compendiumSources.classes, ['phb.classes']);
  assert.deepEqual(s.compendiumSources.races, ['phb.origins']);
  assert.deepEqual(s.compendiumSources.equipment, ['phb.equipment']);
  // Without equipment packs in the profile, the system's own 2024 equipment.
  const bare = studioSettingsFor({ packs: { ...profile.packs, equipment: undefined } });
  assert.deepEqual(bare.compendiumSources.equipment, ['dnd5e.equipment24']);
});
