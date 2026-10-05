import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_PLAN } from '../lib/contract.mjs';
import { planHeroes, selectContent } from '../lib/builder.mjs';

/** One index row. @param {{name: string, type: string, cls?: string, rules?: string, pack?: string, id?: string, identifier?: string}} o */
function row(o) {
  const pack = o.pack ?? 'p.new';
  const id = o.id ?? `${o.type}-${o.name}-${o.rules ?? '2024'}`.replace(/\s+/g, '');
  return {
    packId: pack,
    id,
    uuid: `Compendium.${pack}.Item.${id}`,
    name: o.name,
    type: o.type,
    identifier: o.identifier ?? o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ...(o.cls ? { classIdentifier: o.cls } : {}),
    rules: o.rules ?? '2024',
    book: '',
  };
}
const klass = (name, rules = '2024', extra = {}) => row({ name, type: 'class', rules, ...extra });
const sub = (name, cls, rules = '2024', extra = {}) =>
  row({ name, type: 'subclass', cls, rules, ...extra });
const BOTH = { rules: ['2024', '2014'] };

test('selectContent: every 2024 class is a hero class, sorted by name', () => {
  const out = selectContent({
    classes: [klass('Wizard'), klass('Cleric'), klass('Fighter')],
    subclasses: [],
    select: BOTH,
  });
  assert.deepEqual(
    out.classes.map(c => c.name),
    ['Cleric', 'Fighter', 'Wizard']
  );
});

test('selectContent: a legacy class with a 2024 twin is not a hero class, one without it is', () => {
  const out = selectContent({
    classes: [klass('Fighter'), klass('Fighter', '2014'), klass('Warlock', '2014')],
    subclasses: [],
    select: BOTH,
  });
  assert.deepEqual(
    out.classes.map(c => `${c.name} ${c.rules}`),
    ['Fighter 2024', 'Warlock 2014']
  );
});

test('selectContent: a legacy subclass is skipped when a 2024 one has the same identifier or name', () => {
  const out = selectContent({
    classes: [klass('Fighter'), klass('Wizard')],
    subclasses: [
      sub('Champion', 'fighter'),
      sub('Champion', 'fighter', '2014'), // same name and identifier
      sub('School of Evocation', 'wizard', '2014', { identifier: 'evocation' }),
      sub('Evoker', 'wizard', '2024', { identifier: 'evocation' }), // same identifier, other name
      sub('Pit Fighter', 'fighter', '2014'),
    ],
    select: BOTH,
  });
  assert.deepEqual(
    out.subclasses.map(s => `${s.entry.name} ${s.entry.rules}`),
    ['Champion 2024', 'Pit Fighter 2014', 'Evoker 2024']
  );
  assert.equal(out.skipped.length, 2);
  assert.match(out.skipped.join(), /Champion \(legacy, a 2024 entry exists\)/);
  assert.match(out.skipped.join(), /School of Evocation/);
});

test('selectContent: a subclass of the same name under another class is not a twin', () => {
  const out = selectContent({
    classes: [klass('Fighter'), klass('Rogue')],
    subclasses: [sub('Tricks', 'rogue'), sub('Tricks', 'fighter', '2014')],
    select: BOTH,
  });
  assert.equal(out.subclasses.length, 2);
  assert.equal(out.skipped.length, 0);
});

test('selectContent: a legacy subclass pairs with the legacy class, else with the 2024 class', () => {
  const out = selectContent({
    classes: [klass('Fighter'), klass('Fighter', '2014'), klass('Rogue')],
    subclasses: [
      sub('Brawler', 'fighter', '2014'),
      sub('Trickster', 'rogue', '2014'),
      sub('Thief', 'rogue'),
    ],
    select: BOTH,
  });
  const by = new Map(out.subclasses.map(s => [s.entry.name, s.classEntry]));
  assert.equal(by.get('Brawler')?.rules, '2014');
  assert.equal(by.get('Trickster')?.rules, '2024'); // no legacy Rogue: the 2024 class
  assert.equal(by.get('Thief')?.rules, '2024');
});

test('selectContent: a 2024 subclass pairs with the 2024 class even when a legacy class comes first', () => {
  const out = selectContent({
    classes: [klass('Fighter', '2014'), klass('Fighter')],
    subclasses: [sub('Champion', 'fighter')],
    select: BOTH,
  });
  assert.equal(out.subclasses[0].classEntry?.rules, '2024');
});

test('selectContent: a subclass whose class is not in the profile has no class entry', () => {
  const out = selectContent({
    classes: [klass('Fighter')],
    subclasses: [sub('Fiend', 'warlock')],
    select: BOTH,
  });
  assert.equal(out.subclasses[0].classEntry, null);
});

test('selectContent: an exact duplicate in a later pack is dropped, the first pack wins', () => {
  const first = klass('Fighter', '2024', { pack: 'p.first', id: 'first' });
  const second = klass('Fighter', '2024', { pack: 'p.second', id: 'second' });
  const out = selectContent({ classes: [first, second], subclasses: [], select: BOTH });
  assert.equal(out.classes.length, 1);
  assert.equal(out.classes[0].packId, 'p.first');
});

test('selectContent: rules, skipNames and skipIds from the profile', () => {
  const classes = [klass('Fighter'), klass('Fighter', '2014'), klass('Warlock', '2014')];
  const subclasses = [
    sub('A', 'fighter'),
    sub('B', 'fighter', '2014'),
    sub('C', 'fighter', '2024', { id: 'junk-1' }),
  ];
  const only2024 = selectContent({ classes, subclasses, select: { rules: ['2024'] } });
  assert.deepEqual(
    only2024.classes.map(c => c.name),
    ['Fighter']
  );
  assert.deepEqual(
    only2024.subclasses.map(s => s.entry.name),
    ['A', 'C']
  );
  const skipped = selectContent({
    classes,
    subclasses,
    select: { rules: ['2024', '2014'], skipNames: ['warlock', 'A'], skipIds: '^junk' },
  });
  assert.deepEqual(
    skipped.classes.map(c => c.name),
    ['Fighter']
  );
  assert.deepEqual(
    skipped.subclasses.map(s => s.entry.name),
    ['B']
  );
});

test('selectContent: the same rows give the same choice, subclasses sorted by class then name', () => {
  const input = {
    classes: [klass('Wizard'), klass('Fighter')],
    subclasses: [sub('Zed', 'wizard'), sub('Beta', 'wizard'), sub('Alpha', 'fighter')],
    select: BOTH,
  };
  const a = selectContent(input);
  const b = selectContent(input);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.subclasses.map(s => s.entry.name),
    ['Alpha', 'Beta', 'Zed']
  );
});

/** A small content set for the plan tests. */
function content() {
  return selectContent({
    classes: [klass('Fighter'), klass('Wizard'), klass('Warlock', '2014')],
    subclasses: [
      sub('Champion', 'fighter'),
      sub('Brawler', 'fighter', '2014'),
      sub('Evoker', 'wizard'),
    ],
    select: BOTH,
  });
}

test('planHeroes smoke: every class once at level 5 with its first subclass', () => {
  const c = content();
  const plan = planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'smoke' });
  assert.deepEqual(HERO_PLAN.smoke.tierLevels, [5]);
  assert.deepEqual(
    plan.map(r => [r.name, r.role, r.level, r.subclassEntry?.name ?? null, r.rotation]),
    [
      ['Kit Fighter 5', 'tier', 5, 'Brawler', 0],
      ['Kit Warlock 5', 'tier', 5, null, 0],
      ['Kit Wizard 5', 'tier', 5, 'Evoker', 0],
    ]
  );
});

test('planHeroes full: tier levels, the subclass from its level, every subclass at 20, rotation by index', () => {
  const c = content();
  const plan = planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'full' });
  assert.equal(plan.length, 3 * 4 + 3);
  const fighter = plan.filter(r => r.classEntry?.name === 'Fighter');
  assert.deepEqual(
    fighter.map(r => [r.role, r.level, r.rotation, r.subclassEntry?.name ?? null]),
    [
      ['tier', 1, 0, null], // before level 3 there is no subclass
      ['tier', 5, 1, 'Brawler'],
      ['tier', 11, 2, 'Brawler'],
      ['tier', 17, 3, 'Brawler'],
      ['subclass', 20, 4, 'Brawler'],
      ['subclass', 20, 5, 'Champion'],
    ]
  );
  // The legacy Brawler pairs with the legacy Fighter; here only the 2024 Fighter is a hero class.
  assert.ok(
    plan.filter(r => r.role === 'subclass').every(r => r.level === HERO_PLAN.full.subclassLevel)
  );
  const warlock = plan.filter(r => r.classEntry?.name === 'Warlock');
  assert.deepEqual(
    warlock.map(r => r.rotation),
    [0, 1, 2, 3]
  );
  assert.ok(warlock.every(r => r.subclassEntry === null));
});

test('planHeroes: a class that gets its subclass early (subclassAt) has it from level 1', () => {
  const c = content();
  const warlockUuid = c.classes.find(x => x.name === 'Warlock')?.uuid ?? '';
  const fiend = sub('The Fiend', 'warlock', '2014');
  const withFiend = selectContent({
    classes: [klass('Warlock', '2014')],
    subclasses: [fiend],
    select: BOTH,
  });
  const plan = planHeroes({
    classes: withFiend.classes,
    subclasses: withFiend.subclasses,
    size: 'full',
    subclassAt: { [withFiend.classes[0].uuid]: 1 },
  });
  assert.ok(warlockUuid.length > 0);
  assert.deepEqual(
    plan.filter(r => r.role === 'tier').map(r => [r.level, r.subclassEntry?.name]),
    [
      [1, 'The Fiend'],
      [5, 'The Fiend'],
      [11, 'The Fiend'],
      [17, 'The Fiend'],
    ]
  );
});

test('planHeroes: names are unique and a subclass with no class entry keeps its row', () => {
  const c = selectContent({
    classes: [klass('Fighter')],
    subclasses: [sub('Fighter', 'fighter'), sub('Fiend', 'warlock')],
    select: BOTH,
  });
  const plan = planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'full' });
  const names = plan.map(r => r.name);
  assert.equal(new Set(names).size, names.length);
  const orphan = plan.find(r => r.subclassEntry?.name === 'Fiend');
  assert.equal(orphan?.classEntry, null);
  assert.equal(orphan?.level, 20);
  // Same plan twice: same names and rotations.
  assert.deepEqual(
    plan,
    planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'full' })
  );
});

test('planHeroes long is the full plan', () => {
  const c = content();
  assert.deepEqual(
    planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'long' }),
    planHeroes({ classes: c.classes, subclasses: c.subclasses, size: 'full' })
  );
});
