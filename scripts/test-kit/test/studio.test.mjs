import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_KINDS,
  chooseHeroes,
  classify,
  compareHeroes,
  comparablePicks,
  countStudioKinds,
  multisetDiff,
  pickOrigin,
} from '../lib/studio-compare.mjs';
import { narrowSources, packOfUuid, shownAs, studioSettingsFor } from '../lib/studio.mjs';
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
