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

const domainEntry = prepared => ({
  _id: 'MNyZVxdtyB9spWr8',
  name: 'Grave Domain',
  system: {
    advancement: {
      feat1: { _id: 'feat1', type: 'ItemGrant', level: 1, configuration: { items: [] } },
      sp1: {
        _id: 'sp1',
        type: 'ItemGrant',
        level: 1,
        configuration: { items: [], spell: { method: 'spell', prepared } },
      },
      sp3: {
        _id: 'sp3',
        type: 'ItemGrant',
        level: 3,
        configuration: { items: [], spell: { method: 'spell', prepared } },
      },
    },
  },
});

function makeWorld() {
  const classes = makePack('aitool-content.classes', [
    domainEntry(0),
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
  test('a dry run lists the four changes and writes nothing', async () => {
    const w = makeWorld();
    const { result } = await run(w, { dryRun: true });
    assert.equal(result.todo.length, 4);
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

  test('the Domain Spells grants become always prepared and the feature grant is left alone', async () => {
    const w = makeWorld();
    await run(w);
    const adv = w.classes.docs.get('MNyZVxdtyB9spWr8').system.advancement;
    assert.equal(adv.sp1.configuration.spell.prepared, 2);
    assert.equal(adv.sp3.configuration.spell.prepared, 2);
    assert.equal(adv.feat1.configuration.spell, undefined);
    assert.equal(w.classes.locked, true);
  });

  test('a stored <hr /> in the Spare the Dying copy counts as the same text as <hr>', async () => {
    const w = makeWorld();
    w.phb.docs.get('phbsplSparetheDy').system.description = { value: 'a<hr />b' };
    await run(w);
    // Foundry stores <hr /> as <hr>: the stored copy holding the cleaned form is not drift
    w.spells.docs.get('aitGraveSpareDy1').system.description = { value: 'a<hr>b' };
    const ok = await run(w, { dryRun: true, mode: 'check' });
    assert.equal(ok.result.patched, true);
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

  test('an extra consumption target on the activity counts as drift', async () => {
    const w = makeWorld();
    await run(w);
    const act = w.classes.docs.get('RC9A6n8RjP4gtPoF').system.activities.utilityPtGclNe00;
    act.consumption.targets.push({ type: 'itemUses', target: 'feat:other', value: '1' });
    await assert.rejects(run(w, { dryRun: true, mode: 'check' }), /grave domain patch missing/);
  });

  test('a wrong entry under a known id stops the run before any write', async () => {
    const w = makeWorld();
    w.classes.docs.get('cVLrkyhsPzELan6D').name = 'Something else';
    await assert.rejects(run(w), /is not Circle of Mortality/);
    assert.equal(w.spells.docs.size, 0);
  });

  test('a subclass that is not Grave Domain stops the run before any write', async () => {
    const w = makeWorld();
    w.classes.docs.get('MNyZVxdtyB9spWr8').name = 'Something else';
    await assert.rejects(run(w), /is not Grave Domain\. Nothing was changed/);
    assert.equal(w.spells.docs.size, 0);
  });

  test('a Grave Domain without spell grants stops the run before any write', async () => {
    const w = makeWorld();
    w.classes.docs.get('MNyZVxdtyB9spWr8').system.advancement = {};
    await assert.rejects(run(w), /has no domain spell grants\. Nothing was changed/);
    assert.equal(w.spells.docs.size, 0);
  });

  test('check mode flags a player-classes subclass copy with an empty advancement', async () => {
    const w = makeWorld();
    await run(w);
    const empty = { ...domainEntry(0), system: { advancement: {} } };
    const pi = makePack('world.player-items', [
      structuredClone(w.classes.docs.get('cVLrkyhsPzELan6D')),
      structuredClone(w.classes.docs.get('RC9A6n8RjP4gtPoF')),
    ]);
    const pc = makePack('world.player-classes', [empty]);
    const ps = makePack('world.player-spells', [
      structuredClone(w.spells.docs.get('aitGraveSpareDy1')),
    ]);
    for (const p of [pc, pi, ps]) w.packs.set(p.collection, p);
    await assert.rejects(
      run(w, { dryRun: true, mode: 'check' }),
      /world\.player-classes: Grave Domain spell grants are not always prepared/
    );
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
    // the baseline puts the subclass in player-classes and the two class features (feat items) in player-items
    const pc = makePack('world.player-classes', [domainEntry(0)]);
    const pi = makePack('world.player-items', [
      {
        _id: 'cVLrkyhsPzELan6D',
        name: 'Circle of Mortality',
        system: { advancement: {}, activities: {} },
      },
      { _id: 'RC9A6n8RjP4gtPoF', name: 'Path', system: { advancement: {}, activities: {} } },
    ]);
    const ps = makePack('world.player-spells', []);
    for (const p of [pc, pi, ps]) w.packs.set(p.collection, p);
    await assert.rejects(run(w, { dryRun: true, mode: 'check' }), /run the baseline/);
    // the module packs are patched, only the player copies are behind: the error says run the baseline, not the patch
    await assert.rejects(
      run(w, { dryRun: true, mode: 'check' }),
      /module packs are patched but the player copies are not: run the baseline/
    );
    // a baseline refresh copies the patched entries over
    pc.docs.set('MNyZVxdtyB9spWr8', structuredClone(w.classes.docs.get('MNyZVxdtyB9spWr8')));
    pi.docs.set('cVLrkyhsPzELan6D', structuredClone(w.classes.docs.get('cVLrkyhsPzELan6D')));
    // an extra consumption target on the player copy of the Use activity is drift (the shared actCovers count)
    const copyPath = structuredClone(w.classes.docs.get('RC9A6n8RjP4gtPoF'));
    copyPath.system.activities.utilityPtGclNe00.consumption.targets.push({ type: 'itemUses' });
    pi.docs.set('RC9A6n8RjP4gtPoF', copyPath);
    await assert.rejects(
      run(w, { dryRun: true, mode: 'check' }),
      /world\.player-items: Path to the Grave lacks the Use activity/
    );
    pi.docs.set('RC9A6n8RjP4gtPoF', structuredClone(w.classes.docs.get('RC9A6n8RjP4gtPoF')));
    ps.docs.set('aitGraveSpareDy1', structuredClone(w.spells.docs.get('aitGraveSpareDy1')));
    const ok = await run(w, { dryRun: true, mode: 'check' });
    assert.equal(ok.result.patched, true);
  });
});
