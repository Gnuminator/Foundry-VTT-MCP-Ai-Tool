import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  STUDIO_KINDS,
  consoleFindingId,
  featureProblemId,
  findingId,
  splitExpected,
  chooseHeroes,
  classify,
  compareHeroes,
  comparablePicks,
  countStudioKinds,
  multisetDiff,
  pickOrigin,
} from '../lib/studio-compare.mjs';
import {
  NEVER_RESTORE,
  choosePick,
  narrowSources,
  packOfUuid,
  restorable,
  shownAs,
  studioSettingsFor,
} from '../lib/studio.mjs';
import {
  describeBasis,
  isFixedIn,
  loadExpected,
  parseForkVersion,
  setStudioVersion,
} from '../lib/studio-expected.mjs';
import { validateScenario } from '../lib/contract.mjs';

/** Two heroes that agree on everything; each test breaks one thing on the Studio side. */
function pair() {
  const picks = [
    {
      level: 0,
      advancement: 'Trait',
      title: 'Soldier: Background Proficiencies',
      chosen: ['tool:game:card'],
    },
    {
      level: 1,
      advancement: 'Trait',
      title: 'Fighter: Skill Proficiencies',
      chosen: ['skills:his', 'skills:per'],
    },
    { level: 1, advancement: 'ItemChoice', title: 'Fighter: Fighting Style', chosen: ['Archery'] },
    {
      level: 3,
      advancement: 'Subclass',
      title: 'Fighter: Martial Archetype',
      chosen: ['Champion'],
    },
  ];
  const hero = () => ({
    picks: structuredClone(picks),
    actor: {
      level: 5,
      classes: [{ identifier: 'fighter', levels: 5, subclass: 'champion' }],
      hp: { max: 44, value: 44 },
      abilities: {
        str: { value: 16 },
        dex: { value: 16 },
        con: { value: 14 },
        int: { value: 12 },
        wis: { value: 10 },
        cha: { value: 8 },
      },
    },
    features: {
      prof: 3,
      ac: { value: 13, calc: 'unarmored' },
      hd: { max: 5, classes: [{ levels: 5, denomination: 'd10' }] },
      spells: {},
      scale: { fighter: { 'second-wind': 3, 'action-surge': 1 } },
    },
    build: {
      saves: { str: true, con: true, dex: false },
      skills: { his: 1, per: 1, ath: 0 },
      proficiencies: {
        languages: ['common'],
        weapons: ['mar'],
        armor: ['hvy'],
        tools: ['game:card'],
        damageResistances: [],
        damageImmunities: [],
        conditionImmunities: [],
      },
      size: 'sm',
      movement: { walk: 30 },
      senses: {},
      items: [
        {
          type: 'feat',
          name: 'Second Wind',
          origin: { item: 'class:Fighter', advancement: 'a1', title: 'Features' },
          root: null,
        },
        {
          type: 'feat',
          name: 'Archery',
          origin: { item: 'class:Fighter', advancement: 'a2', title: 'Fighting Style' },
          root: null,
        },
      ],
      advancements: [
        {
          item: 'class:Fighter',
          id: 'a1',
          type: 'ItemGrant',
          title: 'Features',
          level: 1,
          value: { added: ['Compendium.x.Item.sw'] },
        },
        {
          item: 'class:Fighter',
          id: 'a2',
          type: 'ItemChoice',
          title: 'Fighting Style',
          level: 1,
          value: { added: { 1: ['Compendium.x.Item.ar'] } },
        },
      ],
    },
  });
  return { raw: hero(), studio: hero() };
}

test('two heroes that agree have no differences', () => {
  const { raw, studio } = pair();
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(v.problems, []);
  assert.equal(v.sameChoices, true);
  assert.match(v.summary, /0 differences/);
});

test("the subclass pick is Actor Studio's own and is not compared", () => {
  const { raw, studio } = pair();
  studio.picks = studio.picks.filter(p => p.advancement !== 'Subclass');
  assert.deepEqual(compareHeroes({ raw, studio }).problems, []);
  assert.equal(comparablePicks(raw.picks).length, 3);
});

test('a different class level, hit point total or granted item is a STUDIO difference', () => {
  const { raw, studio } = pair();
  studio.actor.classes[0].levels = 4;
  studio.actor.hp.max = 40;
  studio.build.items = studio.build.items.filter(i => i.name !== 'Second Wind');
  const v = compareHeroes({ raw, studio });
  const whats = v.problems.map(p => p.what);
  assert.ok(whats.includes('class levels or subclass'));
  assert.ok(whats.includes('maximum hit points'));
  assert.ok(whats.includes('granted items'));
  assert.ok(v.problems.every(p => p.kind === 'STUDIO'));
});

test('a new hero that cannot spend its spell slots or starts hurt is reported', () => {
  const { raw, studio } = pair();
  raw.features.spells = { spell1: { max: 4, value: 4 } };
  studio.features.spells = { spell1: { max: 4, value: 0 } };
  studio.actor.hp.value = 30;
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(v.problems.map(p => [p.kind, p.what]).sort(), [
    ['STUDIO', 'a new hero does not start at full hit points'],
    ['SYSTEM', 'spell slots a new hero can spend'],
  ]);
  // A maximum raised by an effect leaves the current value behind: that is the system's.
  const x = pair();
  x.studio.actor.hp.value = 39;
  x.studio.actor.hp.sources = [
    { item: 'Draconic Resilience', keys: ['system.attributes.hp.bonuses.level'] },
  ];
  assert.deepEqual(
    compareHeroes(x).problems.map(p => p.kind),
    ['SYSTEM']
  );
  // The raw twin may have been hurt by an earlier scenario: that is not a difference.
  const w = pair();
  w.raw.actor.hp.value = 10;
  assert.deepEqual(compareHeroes(w).problems, []);
});

test('a spell slot or a scale value that differs is STUDIO', () => {
  const { raw, studio } = pair();
  raw.features.spells = { spell1: { max: 4, value: 4 } };
  studio.features.spells = { spell1: { max: 3, value: 3 } };
  studio.features.scale.fighter['second-wind'] = 2;
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(v.problems.map(p => p.what).sort(), ['scale values', 'spell slots']);
});

test('different choices are one KIT problem and the choice-dependent differences become notes', () => {
  const { raw, studio } = pair();
  studio.picks[1].chosen = ['skills:acr', 'skills:ins'];
  studio.build.skills = { acr: 1, ins: 1, his: 0, per: 0, ath: 0 };
  studio.actor.abilities.str.value = 17;
  const v = compareHeroes({ raw, studio });
  assert.equal(v.sameChoices, false);
  assert.equal(v.problems.length, 1);
  assert.equal(v.problems[0].kind, 'KIT');
  assert.match(v.problems[0].evidence, /skills:acr/);
  assert.ok(v.notes.some(n => /skill proficiencies/.test(n)));
  assert.ok(v.notes.some(n => /ability scores/.test(n)));
});

test('the same choices with other skills is a STUDIO difference', () => {
  const { raw, studio } = pair();
  studio.build.skills = { acr: 1, per: 1 };
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(
    v.problems.map(p => [p.kind, p.what]),
    [['STUDIO', 'skill proficiencies']]
  );
});

test('a pump error is a KIT problem', () => {
  const { raw, studio } = pair();
  const v = compareHeroes({ raw, studio, pumpErrors: ['Fighter / Trait "Skills" failed: boom'] });
  assert.deepEqual(
    v.problems.map(p => p.kind),
    ['KIT']
  );
});

test('the origin of an item and the value of an advancement are compared', () => {
  const { raw, studio } = pair();
  studio.build.items[0].origin = null;
  studio.build.advancements[0].value = { added: [] };
  const v = compareHeroes({ raw, studio });
  const whats = v.problems.map(p => p.what);
  assert.ok(whats.includes('advancement origin of items'));
  assert.ok(whats.includes('advancement value of Features'));
});

test('a known cause moves a difference to its own kind', () => {
  const { raw, studio } = pair();
  raw.build.advancements.push({
    item: 'race:Human',
    id: 's1',
    type: 'Size',
    title: 'Size',
    level: 1,
    value: {},
  });
  studio.build.advancements.push({
    item: 'race:Human',
    id: 's1',
    type: 'Size',
    title: 'Size',
    level: 1,
    value: { size: 'sm' },
  });
  const v = compareHeroes({ raw, studio });
  assert.equal(v.problems.length, 1);
  assert.equal(v.problems[0].kind, 'SYSTEM');
  assert.match(v.problems[0].evidence, /Small/);
  assert.deepEqual(classify('nothing', 'STUDIO', 'x'), { kind: 'STUDIO', why: '' });
  assert.equal(
    classify(
      'feature problems',
      'STUDIO',
      'refused: No 1st Level slots available to spend, 1 required'
    ).kind,
    'SYSTEM'
  );
});

test('class spells the raw hero lacks are a KIT finding, spells it has and Studio lacks follow the choices', () => {
  const { raw, studio } = pair();
  studio.build.items.push(
    { type: 'spell', name: 'Light', level: 0, origin: null },
    { type: 'spell', name: 'Shield', level: 1, origin: null }
  );
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(
    v.problems.map(p => p.kind),
    ['KIT']
  );
  assert.match(v.problems[0].evidence, /1 cantrips, 1 leveled/);
  const w = pair();
  w.raw.build.items.push({ type: 'spell', name: 'Bless', level: 1, origin: null });
  const missing = compareHeroes(w);
  assert.deepEqual(
    missing.problems.map(p => [p.kind, p.what]),
    [['STUDIO', 'spells missing from the Studio hero']]
  );
});

test('multisetDiff counts repeats; countStudioKinds counts the four kinds', () => {
  assert.deepEqual(multisetDiff(['a', 'a', 'b'], ['a', 'c']), { onlyA: ['a', 'b'], onlyB: ['c'] });
  const counts = countStudioKinds([
    { kind: 'STUDIO', what: '', evidence: '' },
    { kind: 'KIT', what: '', evidence: '' },
    { kind: 'STUDIO', what: '', evidence: '' },
  ]);
  assert.deepEqual(counts, { KIT: 1, CONTENT: 0, SYSTEM: 0, STUDIO: 2 });
  assert.deepEqual([...STUDIO_KINDS], ['KIT', 'CONTENT', 'SYSTEM', 'STUDIO']);
});

test('chooseHeroes takes one tier hero per class, the highest at or below the level', () => {
  const row = (name, classIdentifier, level, role = 'tier') => ({
    name,
    classIdentifier,
    level,
    role,
    classUuid: `u.${classIdentifier}`,
    actorId: name,
  });
  const kit = {
    heroes: [
      row('Kit Fighter 1', 'fighter', 1),
      row('Kit Fighter 5', 'fighter', 5),
      row('Kit Fighter 11', 'fighter', 11),
      row('Kit Champion 20', 'fighter', 20, 'subclass'),
      row('Kit Wizard 1', 'wizard', 1),
      { ...row('Kit Rogue 5', 'rogue', 5), buildError: 'boom' },
    ],
  };
  const chosen = chooseHeroes(/** @type {any} */ (kit), 5);
  assert.deepEqual(chosen.map(h => h.name).sort(), ['Kit Fighter 5', 'Kit Wizard 1']);
  assert.deepEqual(
    chooseHeroes(/** @type {any} */ (kit), 5, ['wizard']).map(h => h.name),
    ['Kit Wizard 1']
  );
});

test('pickOrigin takes the named 2024 entry, else the first 2024 one', () => {
  const entries = [
    { uuid: 'u.old', name: 'Human', rules: '2014' },
    { uuid: 'u.new', name: 'Human', rules: '2024' },
    { uuid: 'u.elf', name: 'Elf', rules: '2024' },
  ];
  assert.equal(pickOrigin(entries, 'Human'), 'u.new');
  assert.equal(pickOrigin(entries, 'Dwarf'), 'u.elf');
});

test('names are shown the way Actor Studio shows them, and packs come out of uuids', () => {
  assert.equal(shownAs('Fighter (Legacy)'), 'Fighter');
  assert.equal(shownAs('Dragonborn, Gold'), 'Dragonborn');
  assert.equal(shownAs('Champion'), 'Champion');
  assert.equal(packOfUuid('Compendium.dnd5e.classes24.Item.abc'), 'dnd5e.classes24');
  assert.equal(packOfUuid('Actor.abc'), '');
});

/** The PHB 2024 species pack as the module lists it: one group, entries sorted by shown label. */
const SPECIES_PACK = [
  { uuid: 'u.drow', name: 'Elf, Drow' },
  { uuid: 'u.high', name: 'Elf, High' },
  { uuid: 'u.wood', name: 'Elf, Wood' },
  { uuid: 'u.forest', name: 'Gnome, Forest' },
  { uuid: 'u.rock', name: 'Gnome, Rock' },
  { uuid: 'u.human', name: 'Human' },
];
const GROUP = 'PHB 2024 Species';
const listed = (/** @type {string[]} */ labels, group = GROUP) =>
  labels.map(label => ({ label, group }));

test('choosePick: a lineage shown in full is found by its full label, not the first Elf', () => {
  const shown = listed([
    'Elf, Drow',
    'Elf, High',
    'Elf, Wood',
    'Gnome, Forest',
    'Gnome, Rock',
    'Human',
  ]);
  const pick = (/** @type {string} */ uuid, /** @type {string} */ name) =>
    choosePick({ shown, name, uuid, group: GROUP, peers: SPECIES_PACK });
  assert.deepEqual(pick('u.high', 'Elf, High'), {
    index: 1,
    how: `full label "Elf, High" in group "${GROUP}"`,
  });
  assert.equal(pick('u.wood', 'Elf, Wood').index, 2);
  assert.equal(pick('u.rock', 'Gnome, Rock').index, 4);
  assert.equal(pick('u.human', 'Human').index, 5);
});

test('choosePick: when the list shows only "Elf", the position among the pack\'s elves decides', () => {
  const shown = listed(['Elf', 'Elf', 'Elf', 'Gnome', 'Gnome', 'Human']);
  const pick = (/** @type {string} */ uuid, /** @type {string} */ name) =>
    choosePick({ shown, name, uuid, group: GROUP, peers: SPECIES_PACK });
  assert.equal(pick('u.drow', 'Elf, Drow').index, 0);
  assert.equal(pick('u.high', 'Elf, High').index, 1);
  assert.equal(pick('u.wood', 'Elf, Wood').index, 2);
  assert.equal(pick('u.forest', 'Gnome, Forest').index, 3);
  assert.equal(pick('u.rock', 'Gnome, Rock').index, 4);
  assert.equal(pick('u.human', 'Human').index, 5);
});

test("choosePick: another pack's entries are ignored by group; unequal counts fail loudly", () => {
  const other = listed(['Elf', 'Gnome'], '2014 SRD Races');
  const shown = [...other, ...listed(['Elf', 'Elf', 'Elf', 'Gnome', 'Gnome', 'Human'])];
  const got = choosePick({
    shown,
    name: 'Elf, Wood',
    uuid: 'u.wood',
    group: GROUP,
    peers: SPECIES_PACK,
  });
  assert.equal(got.index, 4);
  assert.equal('how' in got ? got.how : '', `label "Elf" by position in group "${GROUP}"`);
  // No heading matches: the whole list is searched, and the answer says so.
  const nogroup = choosePick({
    shown: other,
    name: 'Gnome, Rock',
    uuid: 'u.rock',
    group: GROUP,
    peers: SPECIES_PACK,
  });
  assert.equal(nogroup.index, -1);
  assert.match(
    'why' in nogroup ? nogroup.why : '',
    /no "PHB 2024 Species" group in the list, all 2 entries searched/
  );
  // No heading matches and two books both show "Goliath" for one in the pack: neither is picked.
  const twins = choosePick({
    shown: [...listed(['Goliath'], '2014 SRD Races'), ...listed(['Goliath'], 'Other Origins')],
    name: 'Goliath',
    uuid: 'u.goliath',
    group: GROUP,
    peers: [{ uuid: 'u.goliath', name: 'Goliath' }],
  });
  assert.equal(twins.index, -1);
  assert.match(
    'why' in twins ? twins.why : '',
    /2 "Goliath" entries for 1 in the pack \(no "PHB 2024 Species" group in the list/
  );
  // Two "Elf" entries in the group for three elves in the pack: the position cannot be trusted.
  const short = listed(['Elf', 'Elf', 'Gnome', 'Gnome', 'Human']);
  const bad = choosePick({
    shown: short,
    name: 'Elf, Wood',
    uuid: 'u.wood',
    group: GROUP,
    peers: SPECIES_PACK,
  });
  assert.equal(bad.index, -1);
  assert.match('why' in bad ? bad.why : '', /2 "Elf" entries for 3 in the pack/);
});

/**
 * The species drop-down as the test server showed it on 2026-10-09 (PHB 2024 origins pack, one
 * heading "Character Origins": the pack has no sourceBook flag, so the heading is its label alone),
 * with Actor Studio 2.10.5-aitool.4 before (labels cut at the comma) and after the label fix.
 */
const REAL_GROUP = 'Character Origins';
const REAL_PACK = [
  'Aasimar',
  'Dragonborn',
  'Dwarf',
  'Elf, Drow',
  'Elf, High',
  'Elf, Wood',
  'Gnome, Forest',
  'Gnome, Rock',
  'Goliath',
  'Halfling',
  'Human',
  'Orc',
  'Tiefling, Abyssal',
  'Tiefling, Chthonic',
  'Tiefling, Infernal',
].map(name => ({ uuid: `u.${name}`, name }));

test('choosePick: the real species drop-down, before and after the label fix', () => {
  const fixed = listed(
    REAL_PACK.map(p => p.name),
    REAL_GROUP
  );
  const cut = listed(
    REAL_PACK.map(p => shownAs(p.name)),
    REAL_GROUP
  );
  const pick = (/** @type {typeof fixed} */ shown, /** @type {string} */ name) =>
    choosePick({ shown, name, uuid: `u.${name}`, group: REAL_GROUP, peers: REAL_PACK });
  assert.deepEqual(pick(fixed, 'Elf, High'), {
    index: 4,
    how: 'full label "Elf, High" in group "Character Origins"',
  });
  assert.equal(pick(fixed, 'Tiefling, Chthonic').index, 13);
  assert.deepEqual(pick(cut, 'Elf, High'), {
    index: 4,
    how: 'label "Elf" by position in group "Character Origins"',
  });
  assert.equal(pick(cut, 'Gnome, Rock').index, 7);
  assert.equal(pick(cut, 'Aasimar').index, 0);
});

test('choosePick: a plain name, a legacy twin and a missing entry', () => {
  const peers = [
    { uuid: 'u.fighter', name: 'Fighter' },
    { uuid: 'u.legacy', name: 'Fighter (Legacy)' },
  ];
  const shown = listed(['Fighter', 'Fighter'], '');
  assert.equal(choosePick({ shown, name: 'Fighter (Legacy)', uuid: 'u.legacy', peers }).index, 1);
  assert.equal(choosePick({ shown, name: 'Fighter', uuid: 'u.fighter', peers }).index, 0);
  // No peers known (a world item): first label wins, as before.
  assert.equal(choosePick({ shown, name: 'Fighter', uuid: 'Item.x' }).index, 0);
  const none = choosePick({ shown, name: 'Wizard', uuid: 'u.w', peers });
  assert.equal(none.index, -1);
  assert.match('why' in none ? none.why : '', /not in the list/);
});

test('the settings follow the profile and each hero gets its own packs', () => {
  const profile = {
    packs: {
      classes: ['a.new', 'a.old'],
      subclasses: ['a.new', 'a.sub'],
      species: ['o.new'],
      backgrounds: ['o.new'],
      monsters: [],
      spells: ['s.new'],
      feats: ['f.new'],
    },
  };
  const s = studioSettingsFor(profile);
  assert.deepEqual(s.compendiumSources.classes, ['a.new', 'a.old']);
  assert.equal(s.forceTakeAverageHitPoints, true);
  assert.equal(s.enableEquipmentSelection, false);
  assert.equal(s['usage-tracking'], false);
  const narrowed = narrowSources(s.compendiumSources, {
    species: 'o.new',
    background: 'o.new',
    class: 'a.new',
    subclass: 'a.sub',
  });
  assert.deepEqual(narrowed.classes, ['a.new']);
  assert.deepEqual(narrowed.subclasses, ['a.sub']);
  assert.deepEqual(narrowed.spells, ['s.new']);
  // A pack the profile does not list leaves the list as it was.
  assert.deepEqual(
    narrowSources(s.compendiumSources, { species: 'x', background: 'x', class: 'x' }).classes,
    ['a.new', 'a.old']
  );
});

test('a scenario may name console errors it reports itself, and only as valid expressions', () => {
  const base = {
    id: 'x-test',
    title: 't',
    sizes: ['smoke'],
    tags: ['build'],
    needs: [],
    tools: [],
    run: async () => {},
  };
  assert.deepEqual(validateScenario({ ...base, knownConsoleErrors: ['gas\\.x', 'studio'] }), []);
  assert.match(
    validateScenario({ ...base, knownConsoleErrors: ['('] }).join(),
    /knownConsoleErrors/
  );
  assert.match(validateScenario({ ...base, knownConsoleErrors: 'x' }).join(), /knownConsoleErrors/);
});

test('hit point effects that differ between the heroes make a maximum difference the systems own', () => {
  const { raw, studio } = pair();
  studio.actor.hp.max = 49;
  studio.actor.hp.value = 49;
  studio.actor.hp.sources = [{ item: 'Tough', keys: [] }];
  raw.actor.hp.sources = [];
  const v = compareHeroes({ raw, studio });
  assert.deepEqual(
    v.problems.map(p => [p.kind, p.what]),
    [['SYSTEM', 'maximum hit points']]
  );
  assert.match(v.problems[0].evidence, /Tough/);
  // Without a source that explains it, the difference is Actor Studio's.
  const w = pair();
  w.studio.actor.hp.max = 49;
  w.studio.actor.hp.value = 49;
  assert.deepEqual(
    compareHeroes(w).problems.map(p => p.kind),
    ['STUDIO']
  );
});

test('findings carry an id that is the same for every class', () => {
  const { raw, studio } = pair();
  raw.build.advancements.push({
    item: 'class:Fighter',
    id: 'x',
    type: 'Subclass',
    title: 'Subclass',
    level: 3,
    value: { uuid: 'u' },
  });
  studio.build.advancements.push({
    item: 'class:Fighter',
    id: 'x',
    type: 'Subclass',
    title: 'Subclass',
    level: 3,
    value: { uuid: null },
  });
  const v = compareHeroes({ raw, studio });
  assert.equal(v.problems[0].id, 'advancement-values:advancement-value-of-subclass');
  // The advancement is titled after the class, the finding is not.
  const t2 = pair();
  t2.raw.build.advancements.push({
    item: 'class:X',
    id: 'y',
    type: 'Subclass',
    title: 'Artificer Specialist',
    level: 3,
    value: { uuid: 'u' },
  });
  t2.studio.build.advancements.push({
    item: 'class:X',
    id: 'y',
    type: 'Subclass',
    title: 'Artificer Specialist',
    level: 3,
    value: { uuid: null },
  });
  assert.equal(
    compareHeroes(t2).problems[0].id,
    'advancement-values:advancement-value-of-subclass'
  );
  assert.equal(
    findingId('Spell slots', 'Spell slots a new hero can spend'),
    'spell-slots:spell-slots-a-new-hero-can-spend'
  );
  assert.equal(
    featureProblemId(
      '[SYSTEM] refused: Font of Magic: No 1st Level slots available to spend, 1 required.'
    ),
    'feature-problems:no-slot-to-spend'
  );
  assert.equal(
    consoleFindingId(
      "Error thrown in hooked function '' for hook 'gas.captureAdvancement'. x",
      'http://h/modules/m/a.js:9'
    ),
    'console:gas.captureAdvancement'
  );
  assert.equal(
    consoleFindingId('Failed to load resource', 'http://h/modules/x/assets/black-parchment.webp:0'),
    'console:black-parchment.webp'
  );
});

test('expected findings are counted and anything new, or of another kind, is fresh', () => {
  const problems = [
    { kind: 'SYSTEM', what: 'a', evidence: '', id: 'c:a' },
    { kind: 'SYSTEM', what: 'a', evidence: '', id: 'c:a' },
    { kind: 'STUDIO', what: 'a', evidence: '', id: 'c:a' },
    { kind: 'KIT', what: 'b', evidence: '', id: 'c:b' },
    { kind: 'KIT', what: 'no id', evidence: '' },
  ];
  const r = splitExpected(problems, [{ id: 'c:a', kind: 'SYSTEM' }]);
  assert.equal(r.expected.length, 2);
  assert.deepEqual(r.counts, { 'c:a': 2 });
  assert.deepEqual(
    r.fresh.map(p => p.what),
    ['a', 'b', 'no id']
  );
});

const FORK_FIXED = [
  'advancement-values:advancement-value-of-subclass',
  'feature-problems:no-slot-to-spend',
  'console:gas.captureAdvancement',
  'console:black-parchment.webp',
];
// fixed one build later: 2.10.5-aitool.2 fills the slots on every level up; aitool.1 filled level 1 only
const SLOTS = 'spell-slots-available:spell-slots-a-new-hero-can-spend';
const ALWAYS = [
  'advancement-values:advancement-value-of-size',
  'spells:the-raw-hero-has-no-class-spells',
  'current-hit-points:a-new-hero-does-not-start-at-full-hit-points',
];

test('the expected list for upstream 2.10.5 holds every finding, the fork-fixed ones too', () => {
  const list = loadExpected(undefined, '2.10.5');
  const ids = list.map(e => e.id);
  for (const id of [...ALWAYS, SLOTS, ...FORK_FIXED]) assert.ok(ids.includes(id), id);
  assert.ok(list.every(e => e.why && e.kind));
  // the fixed ones are the entries that carry fixedIn, and nothing else does
  assert.deepEqual(
    list
      .filter(e => e.fixedIn)
      .map(e => e.id)
      .sort(),
    [...FORK_FIXED, SLOTS].sort()
  );
});

test('the expected list for the fork build drops what the fork fixed', () => {
  // aitool.1 still expects the slot finding (it fills level 1 only), aitool.2 and later do not
  const first = loadExpected(undefined, '2.10.5-aitool.1').map(e => e.id);
  assert.deepEqual(first.sort(), [...ALWAYS, SLOTS].sort(), '2.10.5-aitool.1');
  for (const version of ['2.10.5-aitool.2', '2.10.5-aitool.3', '2.10.6-aitool.1']) {
    const ids = loadExpected(undefined, version).map(e => e.id);
    assert.deepEqual(ids.sort(), [...ALWAYS].sort(), version);
  }
});

test('an unknown version, or none, falls back to the upstream list and says so', () => {
  const upstream = loadExpected(undefined, '2.10.5').map(e => e.id);
  for (const version of ['2.11.0', '', null, 'fake', '2.10.5-beta', '2.10.4-aitool.1']) {
    assert.deepEqual(
      loadExpected(undefined, version).map(e => e.id),
      upstream,
      String(version)
    );
  }
  assert.equal(describeBasis('2.10.5').basis, 'upstream');
  assert.equal(describeBasis('2.10.5-aitool.1').basis, 'fork');
  const unknown = describeBasis('2.11.0');
  assert.equal(unknown.basis, 'fallback');
  assert.match(unknown.text, /not one the list knows/);
  assert.equal(describeBasis(null).basis, 'fallback');
});

test('a fork build older than the fix does not get the entry dropped', () => {
  assert.deepEqual(parseForkVersion('2.10.5-aitool.12'), [2, 10, 5, 12]);
  assert.equal(parseForkVersion('2.10.5'), null);
  assert.equal(isFixedIn('2.10.5-aitool.1', '2.10.5-aitool.1'), true);
  assert.equal(isFixedIn('2.10.5-aitool.10', '2.10.5-aitool.2'), true);
  assert.equal(isFixedIn('2.10.4-aitool.9', '2.10.5-aitool.1'), false);
  assert.equal(isFixedIn('2.10.5', '2.10.5-aitool.1'), false);
});

test('the installed version set by the scenario picks the list loadExpected() returns', () => {
  try {
    setStudioVersion('2.10.5-aitool.2');
    assert.equal(loadExpected().length, ALWAYS.length);
    setStudioVersion('2.10.5-aitool.1');
    assert.equal(loadExpected().length, ALWAYS.length + 1);
    setStudioVersion('2.10.5');
    assert.equal(loadExpected().length, ALWAYS.length + FORK_FIXED.length + 1);
    setStudioVersion(null);
    assert.equal(loadExpected().length, ALWAYS.length + FORK_FIXED.length + 1);
  } finally {
    setStudioVersion(null);
  }
});

test('a fixedIn that is not a fork build is refused', () => {
  const file = path.join(tmpdir(), `studio-expected-bad-${process.pid}.json`);
  writeFileSync(file, JSON.stringify([{ id: 'a:b', kind: 'STUDIO', why: 'x', fixedIn: '2.10.5' }]));
  try {
    assert.throws(() => loadExpected(file, null), /fixedIn/);
  } finally {
    rmSync(file, { force: true });
  }
});

test('usage tracking is never put back by a restore', () => {
  assert.deepEqual(NEVER_RESTORE, ['usage-tracking']);
  assert.deepEqual(restorable({ 'usage-tracking': true, milestoneLeveling: false }), {
    milestoneLeveling: false,
  });
});
