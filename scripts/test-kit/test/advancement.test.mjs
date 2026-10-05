import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHero, classifyBuildError, countByKind, problemText } from '../lib/advancement.mjs';

/** A hero, its expected data and its actor that agree with each other; tests break one thing. */
function fixture() {
  const hero = {
    name: 'Kit Cleric 5',
    classUuid: 'Compendium.p.Item.cleric',
    subclassUuid: 'Compendium.p.Item.life',
    level: 5,
    classIdentifier: 'cleric',
    subclassIdentifier: 'life',
    owner: undefined,
    warnings: [],
    picks: [
      {
        level: 0,
        advancement: 'Trait',
        title: 'Soldier: Background Proficiencies',
        chosen: ['tool:game:card'],
      },
      {
        level: 1,
        advancement: 'Trait',
        title: 'Cleric: Skill Proficiencies',
        chosen: ['skills:med', 'skills:rel'],
      },
      { level: 1, advancement: 'ItemChoice', title: 'Cleric: Order', chosen: ['Protector'] },
      {
        level: 4,
        advancement: 'AbilityScoreImprovement',
        title: 'Cleric: Ability Score Improvement',
        chosen: ['wis +2'],
      },
    ],
  };
  const expected = {
    grants: [
      {
        level: 1,
        uuid: 'Compendium.p.Item.spellcasting',
        name: 'Spellcasting',
        resolved: true,
        optional: false,
      },
      {
        level: 3,
        uuid: 'Compendium.p.Item.channel',
        name: 'Channel Divinity',
        resolved: true,
        optional: false,
      },
    ],
    choices: [
      { level: 1, advancement: 'Trait', count: 2 },
      { level: 1, advancement: 'ItemChoice', count: 1 },
      { level: 4, advancement: 'AbilityScoreImprovement', count: 1 },
    ],
    scale: [{ identifier: 'channel', value: 2 }],
    saves: ['cha', 'wis'],
    hitDie: 'd8',
    hpFixed: 28,
    spellcasting: { progression: 'full', ability: 'wis' },
    spellSlots: { leveled: { 1: 4, 2: 3, 3: 2 }, pact: null },
    skillsChosen: 2,
    subclassAt: 3,
  };
  const actor = {
    level: 5,
    classes: [{ identifier: 'cleric', levels: 5, subclass: 'life' }],
    hp: { value: 33, max: 33, bonuses: { level: 0, overall: 0 }, sources: [] },
    abilities: { con: { value: 13, mod: 1 } },
    items: [
      { name: 'Cleric', type: 'class', sourceUuid: 'Compendium.p.Item.cleric' },
      { name: 'Life', type: 'subclass', sourceUuid: 'Compendium.p.Item.life' },
      { name: 'Spellcasting', type: 'feat', sourceUuid: 'Compendium.p.Item.spellcasting' },
      { name: 'Channel Divinity', type: 'feat', sourceUuid: 'Compendium.p.Item.channel' },
      { name: 'Protector', type: 'feat', sourceUuid: 'Compendium.p.Item.protector' },
    ],
    scale: { cleric: { channel: 2 } },
    spells: { spell1: { max: 4 }, spell2: { max: 3 }, spell3: { max: 2 } },
    skills: { med: 1, rel: 1, ath: 1 },
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 1, cha: 1 },
    ownership: { default: 0, 'Kit GM': 3 },
  };
  return { hero, expected, actor };
}

/** @param {ReturnType<typeof fixture>} f */
const run = f => checkHero(f);
const kinds = (/** @type {{problems: any[]}} */ r) => r.problems.map(p => `${p.kind} ${p.what}`);

test('a hero that matches its advancement data has no problems and a summary', () => {
  const r = run(fixture());
  assert.deepEqual(r.problems, []);
  assert.match(
    r.summary,
    /HP 33 \(28 \+ 1x5\), 2 grants, 4 choices, 1 scale values, slots 4\/3\/2/
  );
});

test('a missing grant is SYSTEM, KIT when the builder warned, and names the feature', () => {
  const f = fixture();
  f.actor.items = f.actor.items.filter(i => i.name !== 'Channel Divinity');
  const r = run(f);
  assert.deepEqual(kinds(r), ['SYSTEM 1 grant(s) missing']);
  assert.match(r.problems[0].evidence, /Channel Divinity \(level 3\)/);
  f.hero.warnings = ['Cleric: Order level 1: refused'];
  assert.equal(run(f).problems[0].kind, 'KIT');
});

test('a grant whose uuid does not resolve is CONTENT and is not also reported as missing', () => {
  const f = fixture();
  f.expected.grants[1] = { ...f.expected.grants[1], name: '', resolved: false };
  f.actor.items = f.actor.items.filter(i => i.name !== 'Channel Divinity');
  const r = run(f);
  assert.deepEqual(kinds(r), ['CONTENT 1 grant uuid(s) do not resolve']);
  assert.match(r.problems[0].evidence, /Compendium\.p\.Item\.channel/);
});

test('an optional grant may be missing, a grant matched by name is accepted with a note', () => {
  const f = fixture();
  f.expected.grants.push({
    level: 2,
    uuid: 'Compendium.p.Item.extra',
    name: 'Extra',
    resolved: true,
    optional: true,
  });
  f.actor.items = f.actor.items.map(i =>
    i.name === 'Spellcasting' ? { ...i, sourceUuid: 'Compendium.other.Item.x' } : i
  );
  const r = run(f);
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.includes('1 grant(s) matched by name'));
});

test('hit points: a difference is KIT with the per level figure, a feat bonus is explained', () => {
  const f = fixture();
  f.actor.hp = { value: 28, max: 28, bonuses: { level: 0, overall: 0 }, sources: [] };
  let r = run(f);
  assert.deepEqual(kinds(r), ['KIT hit points']);
  assert.match(r.problems[0].evidence, /max 28, expected 33 = 28 \(d8 average\) \+ 1 CON x 5/);
  assert.match(r.problems[0].evidence, /-1 per level off/);

  const tough = fixture();
  tough.actor.hp = {
    value: 43,
    max: 43,
    bonuses: { level: 2, overall: 0 },
    sources: [{ item: 'Tough', keys: ['system.attributes.hp.bonuses.level'] }],
  };
  r = run(tough);
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join(), /HP extras \+2\/level from Tough/);
  assert.match(r.summary, /\+ extras/);

  const hurt = fixture();
  hurt.actor.hp.value = 30;
  assert.deepEqual(kinds(run(hurt)), ['KIT current hit points']);
});

test('choices: a shortfall is KIT, CONTENT when no options were offered, SYSTEM when refused', () => {
  const f = fixture();
  f.hero.picks = f.hero.picks.filter(p => p.advancement !== 'ItemChoice');
  assert.deepEqual(kinds(run(f)), ['KIT ItemChoice at level 1']);
  f.hero.warnings = ['Cleric: Order level 1: 1 choice(s) left, no options offered'];
  assert.equal(run(f).problems[0].kind, 'CONTENT');
  f.hero.warnings = ['Cleric: Order level 1: Protector refused: nope'];
  assert.equal(run(f).problems[0].kind, 'SYSTEM');
});

test('choices: picks of the species, the background or a feat are not counted for the class', () => {
  const f = fixture();
  f.hero.picks.push({
    level: 1,
    advancement: 'Trait',
    title: 'Skilled: Traits',
    chosen: ['skills:arc', 'skills:his', 'skills:ins'],
  });
  f.hero.picks.push({
    level: 0,
    advancement: 'ItemChoice',
    title: 'Human: Versatile',
    chosen: ['Tough'],
  });
  f.actor.items.push({ name: 'Tough', type: 'feat', sourceUuid: null });
  assert.deepEqual(run(f).problems, []);
});

test('a Trait pool with nothing left is a note when the builder said so, not a failure', () => {
  const f = fixture();
  f.expected.choices.push({ level: 3, advancement: 'Trait', count: 1 });
  assert.deepEqual(kinds(run(f)), ['KIT Trait at level 3']);
  f.hero.warnings = [
    'Cleric: Primal Knowledge level 3: 1 of 1 choice(s) left, every option is already taken',
  ];
  const r = run(f);
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join(), /level 3: 1 Trait choice\(s\) had no option left/);
});

test('picked items must be on the actor', () => {
  const f = fixture();
  f.actor.items = f.actor.items.filter(i => i.name !== 'Protector');
  assert.deepEqual(kinds(run(f)), ['SYSTEM picked items missing']);
});

test('scale values, spell slots, pact slots, saves and skills', () => {
  const scale = fixture();
  scale.actor.scale = { cleric: { channel: 3 } };
  assert.deepEqual(kinds(run(scale)), ['SYSTEM scale value channel']);
  scale.actor.scale = { cleric: {} };
  assert.match(run(scale).problems[0].evidence, /the actor has none/);

  const slots = fixture();
  slots.actor.spells = { spell1: { max: 4 }, spell2: { max: 2 }, spell3: { max: 2 } };
  assert.deepEqual(kinds(run(slots)), ['SYSTEM spell slots, level 2']);

  const pact = fixture();
  pact.expected.spellSlots = { leveled: {}, pact: { max: 2, level: 3 } };
  pact.actor.spells = { pact: { max: 2, level: 3 } };
  assert.deepEqual(run(pact).problems, []);
  assert.match(run(pact).summary, /slots pact 2 at level 3/);
  pact.actor.spells = { pact: { max: 2, level: 2 } };
  assert.deepEqual(kinds(run(pact)), ['SYSTEM pact slots']);

  const none = fixture();
  none.expected.spellSlots = null;
  assert.deepEqual(kinds(run(none)), [
    'SYSTEM spell slots, level 1',
    'SYSTEM spell slots, level 2',
    'SYSTEM spell slots, level 3',
  ]);

  const saves = fixture();
  saves.actor.saves.cha = 0;
  assert.deepEqual(kinds(run(saves)), ['SYSTEM saving throws']);

  const extra = fixture();
  extra.actor.saves.str = 1;
  assert.match(run(extra).problems[0].evidence, /str come from no effect/);
  extra.actor.saveSources = { str: ['Disciplined Survivor'] };
  const explained = run(extra);
  assert.deepEqual(explained.problems, []);
  assert.ok(explained.notes.includes('saves str also from Disciplined Survivor'));

  const feat = fixture();
  feat.actor.saves.int = 1;
  feat.hero.picks.push({
    level: 0,
    advancement: 'Trait',
    title: 'Resilient: Saving Throw',
    chosen: ['saves:int'],
  });
  const viaFeat = run(feat);
  assert.deepEqual(viaFeat.problems, []);
  assert.ok(viaFeat.notes.includes('saves int also from Resilient'));

  const skills = fixture();
  skills.actor.skills = { med: 1 };
  assert.deepEqual(kinds(run(skills)), ['KIT skill proficiencies']);
});

test('class, subclass and ownership', () => {
  const level = fixture();
  level.actor.classes = [{ identifier: 'cleric', levels: 4, subclass: 'life' }];
  assert.deepEqual(kinds(run(level)), ['SYSTEM class level']);

  const noSub = fixture();
  noSub.actor.classes = [{ identifier: 'cleric', levels: 5, subclass: null }];
  noSub.actor.items = noSub.actor.items.filter(i => i.type !== 'subclass');
  assert.deepEqual(kinds(run(noSub)), ['KIT subclass missing']);

  const early = fixture();
  early.hero.level = 2;
  early.actor.level = 2;
  early.actor.classes = [{ identifier: 'cleric', levels: 2, subclass: 'life' }];
  early.actor.hp = { value: 14, max: 14, bonuses: { level: 0, overall: 0 }, sources: [] };
  early.expected.hpFixed = 12;
  assert.ok(kinds(run(early)).includes('KIT subclass too early'));

  const noStep = fixture();
  noStep.expected.subclassAt = null;
  assert.deepEqual(kinds(run(noStep)), ['CONTENT subclass']);

  const owner = fixture();
  owner.hero.owner = 'Kit Player';
  assert.deepEqual(kinds(run(owner)), ['KIT ownership']);
  owner.actor.ownership['Kit Player'] = 3;
  assert.deepEqual(run(owner).problems, []);
});

test('classifyBuildError sorts a build error into a kind and keeps the message', () => {
  assert.equal(
    classifyBuildError('no class "warlock" in the profile\'s class packs').kind,
    'CONTENT'
  );
  assert.equal(classifyBuildError('createHero: no class Compendium.x.Item.y').kind, 'CONTENT');
  assert.equal(
    classifyBuildError('createHero: species: Human / Trait "x" / level 0 failed: boom').kind,
    'SYSTEM'
  );
  assert.equal(
    classifyBuildError('createHero: class: stuck after answering Fighter / ItemChoice').kind,
    'KIT'
  );
  assert.equal(classifyBuildError('invalid HP {"value":0,"max":0}').kind, 'KIT');
  assert.equal(classifyBuildError('anything').evidence, 'anything');
});

test('problemText puts the kind first and caps the list; countByKind counts', () => {
  const problems = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(what => ({
    kind: /** @type {const} */ ('KIT'),
    what,
    evidence: `e-${what}`,
  }));
  const text = problemText(problems);
  assert.match(text, /^\[KIT\] a: e-a \| \[KIT\] b: e-b/);
  assert.match(text, /and 2 more$/);
  assert.deepEqual(countByKind([...problems, { kind: 'CONTENT', what: 'x', evidence: '' }]), {
    KIT: 7,
    CONTENT: 1,
    SYSTEM: 0,
  });
});
