/**
 * settleCreated (createHero's wait for dnd5e's unawaited species link and cached spells) with a
 * stub actor and a fake clock. Also checks that its source survives the trip into the page
 * (gm.mjs helperSources, rebuilt with `new Function` in createHero).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleCreated } from '../lib/settle-created.mjs';
import { helperSources } from '../lib/gm.mjs';
import { classifyBuildError } from '../lib/advancement.mjs';

/**
 * A stub dnd5e actor: an optional species item and items with Cast activities. `tick()` runs
 * scheduled writes, as dnd5e's unawaited updates landing later.
 * @param {{race?: {id: string, name: string}, linked?: boolean,
 *   casts?: Array<{item: string, name: string, uuid: string, cached?: boolean}>}} o
 */
function stubActor({ race, linked = false, casts = [] }) {
  const source = { system: { details: { race: linked && race ? race.id : '' } } };
  const items = new Map();
  for (const c of casts) {
    if (!items.has(c.item)) items.set(c.item, { name: c.item, acts: [] });
    items
      .get(c.item)
      .acts.push({ name: c.name, spell: { uuid: c.uuid }, cachedSpell: c.cached ? {} : null });
  }
  const contents = [...items.values()].map(it => ({
    name: it.name,
    system: { activities: { getByType: type => (type === 'cast' ? it.acts : []) } },
    acts: it.acts,
  }));
  return {
    itemTypes: { race: race ? [race] : [] },
    _source: source,
    items: { contents },
    link: () => (source.system.details.race = race.id),
    linkTo: id => (source.system.details.race = id),
    cache: name => {
      for (const it of contents) for (const a of it.acts) if (a.name === name) a.cachedSpell = {};
    },
  };
}

/** A fake clock: sleep advances it and runs what is due. */
function fakeClock() {
  let t = 0;
  const due = [];
  return {
    now: () => t,
    at: (ms, fn) => due.push({ ms, fn }),
    sleep: async ms => {
      t += ms;
      for (const d of due.filter(d => !d.done && d.ms <= t)) {
        d.done = true;
        d.fn();
      }
    },
    get t() {
      return t;
    },
  };
}

const ELF = { id: 'race1', name: 'Elf' };
const exists = async () => ({});

test('settleCreated returns at once when the species is linked and every spell is cached', async () => {
  const actor = stubActor({
    race: ELF,
    linked: true,
    casts: [{ item: 'Lineage', name: 'Cast Light', uuid: 'Compendium.s.Item.light', cached: true }],
  });
  const clock = fakeClock();
  await settleCreated(actor, 'species', {
    resolveUuid: exists,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.equal(clock.t, 0);
});

test('settleCreated waits for a species link that lands late', async () => {
  const actor = stubActor({ race: ELF });
  const clock = fakeClock();
  clock.at(300, () => actor.link());
  await settleCreated(actor, 'species', {
    resolveUuid: exists,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.equal(clock.t, 300);
  assert.equal(actor._source.system.details.race, 'race1');
});

test('settleCreated waits for a species that replaced the first one mid-wait', async () => {
  const actor = stubActor({ race: ELF });
  const DWARF = { id: 'race2', name: 'Dwarf' };
  const clock = fakeClock();
  // The Elf links, then a Dwarf replaces it before the check: the Dwarf must link too.
  clock.at(100, () => {
    actor.link();
    actor.itemTypes.race = [DWARF];
  });
  clock.at(500, () => actor.linkTo('race2'));
  await settleCreated(actor, 'species', {
    resolveUuid: exists,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.equal(clock.t, 500);
});

test('settleCreated fails a species that never links, and the error classifies as SYSTEM', async () => {
  const actor = stubActor({ race: ELF });
  const clock = fakeClock();
  await assert.rejects(
    settleCreated(actor, 'species', { resolveUuid: exists, sleep: clock.sleep, now: clock.now }),
    err => {
      assert.match(err.message, /createHero: species: the species Elf is not linked to the actor/);
      assert.equal(classifyBuildError(err.message).kind, 'SYSTEM');
      return true;
    }
  );
  assert.ok(clock.t > 10000 && clock.t <= 10100, `gave up at ${clock.t} ms`);
});

test('settleCreated waits for a cached spell and fails one that never arrives', async () => {
  const casts = [
    { item: 'Air Genasi', name: 'Cast Shocking Grasp', uuid: 'Compendium.s.Item.grasp' },
    { item: 'Air Genasi', name: 'Cast Feather Fall', uuid: 'Compendium.s.Item.fall' },
  ];
  const late = stubActor({ casts });
  const clock = fakeClock();
  clock.at(150, () => late.cache('Cast Shocking Grasp'));
  clock.at(400, () => late.cache('Cast Feather Fall'));
  await settleCreated(late, 'species', { resolveUuid: exists, sleep: clock.sleep, now: clock.now });
  assert.equal(clock.t, 400);

  const never = stubActor({ casts });
  const clock2 = fakeClock();
  clock2.at(150, () => never.cache('Cast Feather Fall'));
  await assert.rejects(
    settleCreated(never, 'background', {
      resolveUuid: exists,
      sleep: clock2.sleep,
      now: clock2.now,
    }),
    err => {
      assert.equal(
        err.message,
        'createHero: background: no cached spell for Air Genasi: Cast Shocking Grasp'
      );
      assert.equal(classifyBuildError(err.message).kind, 'SYSTEM');
      return true;
    }
  );
});

test('settleCreated resolves spell uuids with the async resolver, once each', async () => {
  // A spell in a pack whose index is not loaded: fromUuidSync would say null and skip it; the
  // async resolver finds it, so the wait holds until the copy is cached.
  const actor = stubActor({
    casts: [{ item: 'Lineage', name: 'Cast Grasp', uuid: 'Compendium.unindexed.Item.grasp' }],
  });
  const clock = fakeClock();
  clock.at(200, () => actor.cache('Cast Grasp'));
  const asked = [];
  const resolveUuid = async uuid => {
    asked.push(uuid);
    await Promise.resolve();
    return { uuid };
  };
  await settleCreated(actor, 'species', { resolveUuid, sleep: clock.sleep, now: clock.now });
  assert.equal(clock.t, 200);
  assert.deepEqual(asked, ['Compendium.unindexed.Item.grasp']);
});

test('settleCreated does not wait for a spell whose uuid resolves to nothing', async () => {
  const actor = stubActor({
    casts: [{ item: 'Lineage', name: 'Cast Gone', uuid: 'Compendium.removed.Item.x' }],
  });
  const clock = fakeClock();
  await settleCreated(actor, 'species', {
    resolveUuid: async () => null,
    sleep: clock.sleep,
    now: clock.now,
  });
  assert.equal(clock.t, 0);
});

test('helperSources sends createHero a settleCreated that works rebuilt from its source', async () => {
  const sources = helperSources('createHero');
  assert.deepEqual(Object.keys(sources), ['settleCreated']);
  assert.deepEqual(helperSources('worldStatus'), {});
  // What createHero does in the page: no module scope is reachable from the rebuilt function.
  const rebuilt = new Function(`return (${sources.settleCreated});`)();
  const actor = stubActor({ race: ELF });
  const clock = fakeClock();
  clock.at(100, () => actor.link());
  await rebuilt(actor, 'species', { resolveUuid: exists, sleep: clock.sleep, now: clock.now });
  assert.equal(clock.t, 100);
});
