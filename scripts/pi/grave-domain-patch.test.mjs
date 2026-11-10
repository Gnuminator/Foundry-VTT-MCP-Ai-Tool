// Tests for the Grave Domain content patch (scripts/pi/remote/grave-domain-patch.js) against a fake `game` with
// in-memory packs:
//   node --test scripts/pi/grave-domain-patch.test.mjs
// The data is made up (names, ids and a stand-in spell); no book text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(
  path.join(repo, 'scripts', 'pi', 'remote', 'grave-domain-patch.js'),
  'utf8'
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const setPath = (obj, key, value) => {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = structuredClone(value);
};

function makePack(collection, entries, locked = true) {
  const docs = new Map(entries.map(e => [e._id, structuredClone(e)]));
  const pack = {
    collection,
    locked,
    docs,
    async configure({ locked: l }) {
      pack.locked = l;
    },
    async getDocument(id) {
      const raw = docs.get(id);
      if (!raw) return null;
      return {
        name: raw.name,
        toObject: () => structuredClone(raw),
        async update(changes) {
          if (pack.locked) throw new Error(`${collection} is locked`);
          for (const [k, v] of Object.entries(changes)) setPath(raw, k, v);
        },
      };
    },
  };
  return pack;
}

function makeWorld() {
  const classes = makePack('aitool-content.classes', [
    {
      _id: 'cVLrkyhsPzELan6D',
      name: 'Circle of Mortality',
      system: { advancement: {}, activities: {} },
    },
    {
      _id: 'RC9A6n8RjP4gtPoF',
      name: 'Channel Divinity: Path to the Grave',
      system: { advancement: {}, activities: {} },
    },
  ]);
  const spells = makePack('aitool-content.spells', []);
  const phb = makePack('dnd-players-handbook.spells', [
    {
      _id: 'phbsplSparetheDy',
      name: 'Spare the Dying',
      system: {
        range: { value: '', units: 'touch', special: '' },
        activation: { type: 'action', value: 1 },
        activities: {
          a1: { type: 'utility', activation: { type: 'action' }, range: { units: 'touch' } },
        },
      },
      flags: {},
    },
  ]);
  const packs = new Map([classes, spells, phb].map(p => [p.collection, p]));
  return { packs, classes, spells, phb };
}

async function run(world, { dryRun, mode } = {}) {
  const lines = [];
  const game = { packs: world.packs };
  const Item = {
    async createDocuments(docs, { pack }) {
      const p = world.packs.get(pack);
      if (p.locked) throw new Error(`${pack} is locked`);
      for (const d of docs) p.docs.set(d._id, structuredClone(d));
    },
  };
  const body = (mode ? `const GRAVE_MODE = '${mode}';\n` : '') + source;
  const fn = new AsyncFunction('args', 'game', 'Item', body);
  const result = await fn({ dryRun: !!dryRun, log: t => lines.push(t) }, game, Item);
  return { result, lines };
}

describe('grave-domain-patch.js', () => {
  test('a dry run lists the three changes and writes nothing', async () => {
    const w = makeWorld();
    const { result } = await run(w, { dryRun: true });
    assert.equal(result.todo.length, 3);
    assert.equal(w.spells.docs.size, 0);
    assert.deepEqual(w.classes.docs.get('cVLrkyhsPzELan6D').system.advancement, {});
  });

  test('a real run patches both packs and locks them again', async () => {
    const w = makeWorld();
    await run(w);
    const spare = w.spells.docs.get('aitGraveSpareDy1');
    assert.equal(spare.system.range.value, '30');
    assert.equal(spare.system.range.units, 'ft');
    assert.equal(spare.system.activation.type, 'bonus');
    assert.equal(spare.system.activities.a1.range.override, true);
    assert.equal(spare.system.activities.a1.activation.override, true);
    assert.equal(spare.flags['foundry-ai-tool'].graveDomainSpare, true);
    assert.equal(spare.system.source.book, 'XGtE'); // a kept book, so the seven-book trim keeps the copy
    const adv = w.classes.docs.get('cVLrkyhsPzELan6D').system.advancement.aitGraveSpare001;
    assert.equal(adv.type, 'ItemGrant');
    assert.equal(
      adv.configuration.items[0].uuid,
      'Compendium.aitool-content.spells.Item.aitGraveSpareDy1'
    );
    assert.deepEqual(adv.configuration.spell.ability, ['wis']);
    assert.equal(adv.configuration.spell.prepared, 2);
    const act = w.classes.docs.get('RC9A6n8RjP4gtPoF').system.activities.utilityPtGclNe00;
    assert.equal(act.type, 'utility');
    assert.equal(act.consumption.targets[0].type, 'itemUses');
    assert.equal(act.consumption.targets[0].target, 'feat:channel-divinity');
    assert.equal(act.consumption.targets[0].value, '1');
    assert.equal(w.classes.locked, true);
    assert.equal(w.spells.locked, true);
  });

  test('a second run changes nothing', async () => {
    const w = makeWorld();
    await run(w);
    const snap = () => JSON.stringify([...w.classes.docs]) + JSON.stringify([...w.spells.docs]);
    const before = snap();
    const { result } = await run(w);
    assert.deepEqual(result.todo, []);
    assert.equal(snap(), before);
  });

  test('a changed Use activity is put right again', async () => {
    const w = makeWorld();
    await run(w);
    w.classes.docs.get(
      'RC9A6n8RjP4gtPoF'
    ).system.activities.utilityPtGclNe00.consumption.targets[0].value = '2';
    const { result } = await run(w, { dryRun: true });
    assert.equal(result.todo.length, 1);
    await run(w);
    assert.equal(
      w.classes.docs.get('RC9A6n8RjP4gtPoF').system.activities.utilityPtGclNe00.consumption
        .targets[0].value,
      '1'
    );
  });

  test('check mode fails on a missing patch and passes on a patched world', async () => {
    const w = makeWorld();
    await assert.rejects(run(w, { dryRun: true, mode: 'check' }), /grave domain patch missing/);
    await run(w);
    const ok = await run(w, { dryRun: true, mode: 'check' });
    assert.equal(ok.result.patched, true);
    await assert.rejects(run(w, { mode: 'check' }), /check only/);
  });

  test('a wrong entry under a known id stops the run before any write', async () => {
    const w = makeWorld();
    w.classes.docs.get('cVLrkyhsPzELan6D').name = 'Something else';
    await assert.rejects(run(w), /is not Circle of Mortality/);
    assert.equal(w.spells.docs.size, 0);
  });

  test('a failure while writing still locks the packs and names what was done', async () => {
    const w = makeWorld();
    const original = w.classes.getDocument;
    w.classes.getDocument = async id => {
      const d = await original(id);
      if (d && id === 'RC9A6n8RjP4gtPoF')
        d.update = async () => {
          throw new Error('boom');
        };
      return d;
    };
    await assert.rejects(
      run(w),
      /boom[\s\S]*DONE BEFORE THE FAILURE[\s\S]*Spare the Dying copy aitGraveSpareDy1 in/
    );
    assert.equal(w.classes.locked, true);
    assert.equal(w.spells.locked, true);
  });

  test('a pack that cannot be locked again fails the run', async () => {
    const w = makeWorld();
    const configure = w.spells.configure;
    w.spells.configure = async arg => {
      if (arg.locked === true) throw new Error('stuck');
      return configure(arg);
    };
    await assert.rejects(run(w), /stuck[\s\S]*DONE BEFORE THE FAILURE/);
  });

  test('check mode also looks at the player copies once the baseline exists', async () => {
    const w = makeWorld();
    await run(w);
    const pc = makePack('world.player-classes', [
      {
        _id: 'cVLrkyhsPzELan6D',
        name: 'Circle of Mortality',
        system: { advancement: {}, activities: {} },
      },
      { _id: 'RC9A6n8RjP4gtPoF', name: 'Path', system: { advancement: {}, activities: {} } },
    ]);
    const ps = makePack('world.player-spells', []);
    w.packs.set(pc.collection, pc);
    w.packs.set(ps.collection, ps);
    await assert.rejects(run(w, { dryRun: true, mode: 'check' }), /run the baseline/);
    // a baseline refresh copies the patched entries over
    pc.docs.set('cVLrkyhsPzELan6D', structuredClone(w.classes.docs.get('cVLrkyhsPzELan6D')));
    pc.docs.set('RC9A6n8RjP4gtPoF', structuredClone(w.classes.docs.get('RC9A6n8RjP4gtPoF')));
    ps.docs.set('aitGraveSpareDy1', structuredClone(w.spells.docs.get('aitGraveSpareDy1')));
    const ok = await run(w, { dryRun: true, mode: 'check' });
    assert.equal(ok.result.patched, true);
  });
});
