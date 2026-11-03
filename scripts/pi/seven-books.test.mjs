// Tests for the seven-book trim (scripts/pi/remote/seven-books-trim.js, seven-books-delete-legacy.js and stage 22,
// scripts/pi/remote/22-seven-books.sh):
//   node --test scripts/pi/seven-books.test.mjs
// - the two GM scripts against a fake `game` with in-memory packs: what moves, what stays as a dependency, the SRD
//   links, the hidden packs, a second run changing nothing, the delete refusing while a kept entry links to it;
// - with PI_STAGE22_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the stage itself in a Debian 13 ARM64
//   container with stand-ins for systemd (scripts/pi/container-test/stage22-scenarios.sh).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const trimSource = readFileSync(path.join(remote, 'seven-books-trim.js'), 'utf8');
const deleteSource = readFileSync(path.join(remote, 'seven-books-delete-legacy.js'), 'utf8');

const id = n => `Zz${String(n).padStart(14, '0')}`; // 16 characters, like a Foundry id
const HIDDEN = { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
const link = (pack, docId, type = 'Item') => `@UUID[Compendium.${pack}.${type}.${docId}]{x}`;

class Index extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
}
class Packs extends Map {
  filter(fn) {
    return [...this.values()].filter(fn);
  }
}

function makePack(
  collection,
  documentName,
  entries = [],
  ownership = { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER' }
) {
  const docs = new Map(entries.map(e => [e._id, structuredClone(e)]));
  const pack = {
    collection,
    documentName,
    locked: false,
    ownership,
    docs,
    unlocks: 0,
    get index() {
      const out = new Index();
      for (const [k, d] of docs)
        out.set(k, {
          _id: d._id,
          name: d.name,
          type: d.type,
          system: d.system,
          effects: d.effects,
        });
      return out;
    },
    async getIndex() {
      return this.index;
    },
    async getDocuments({ _id__in }) {
      return _id__in.filter(x => docs.has(x)).map(x => this.doc(x));
    },
    async getDocument(x) {
      return this.doc(x);
    },
    doc(x) {
      const d = docs.get(x);
      return {
        id: x,
        toObject: () => structuredClone(d),
        async update(change) {
          Object.assign(d, structuredClone(change));
        },
        async updateEmbeddedDocuments() {},
      };
    },
    async configure(change) {
      if ('locked' in change) {
        if (!change.locked) this.unlocks++;
        this.locked = change.locked;
      }
      if (change.ownership) this.ownership = { ...change.ownership };
    },
    async deleteCompendium() {
      pack.deleted = true;
    },
  };
  return pack;
}

function fakeWorld({
  spells,
  items,
  classes = [],
  srdItems = [],
  extraPacks = [],
  legacy = null,
} = {}) {
  const packs = new Packs();
  const add = p => packs.set(p.collection, p);
  for (const name of ['classes', 'species', 'backgrounds', 'feats', 'spells', 'items']) {
    const entries = { classes, spells, items }[name] ?? [];
    add(makePack(`aitool-content.${name}`, 'Item', entries));
  }
  add(makePack('dnd-players-handbook.equipment', 'Item'));
  add(makePack('dnd5e.items', 'Item', srdItems));
  add(makePack('dnd5e.monsters', 'Actor'));
  add(makePack('dnd5e.classes', 'Item'));
  add(makePack('dnd5e.tables', 'RollTable'));
  add(makePack('dnd5e.rules', 'JournalEntry'));
  for (const p of extraPacks) add(p);
  if (legacy) add(legacy);
  const sink = (kind, docName) => ({
    async createDocuments(data, { pack }) {
      const target = packs.get(pack);
      for (const d of data) target.docs.set(d._id, structuredClone(d));
      return data;
    },
    async deleteDocuments(ids, { pack }) {
      for (const x of ids) packs.get(pack).docs.delete(x);
    },
  });
  const globals = {
    game: { packs },
    Item: sink('Item'),
    Actor: sink('Actor'),
    CompendiumCollection: {
      async createCompendium({ type, name }) {
        const p = makePack(`world.${name}`, type);
        packs.set(p.collection, p);
        return p;
      },
    },
  };
  return { packs, globals };
}

async function run(source, world, dryRun) {
  const lines = [];
  const fn = new AsyncFunction('args', 'game', 'Item', 'Actor', 'CompendiumCollection', source);
  const result = await fn(
    { dryRun, log: t => lines.push(t) },
    world.globals.game,
    world.globals.Item,
    world.globals.Actor,
    world.globals.CompendiumCollection
  );
  return { result, lines };
}

const spell = (n, name, book, extra = '') => ({
  _id: id(n),
  name,
  type: 'spell',
  system: { source: book ? { book } : {}, description: { value: extra } },
});
const names = pack => [...pack.docs.values()].map(d => d.name).sort();

function standardWorld() {
  const srdBag = { _id: id(900), name: 'Backpack', type: 'container', system: {} };
  return fakeWorld({
    spells: [
      spell(1, 'Fireball', 'PHB 2024'), // kept; links to Light (a 2014 spell) and to the SRD backpack
      spell(2, 'Light', 'PHB', ''), // moves, but Fireball links to it: stays
      spell(3, 'Bane', 'PHB'), // moves
      spell(4, 'Mystery', null), // no book: stays
      spell(5, 'Sacred Flame', 'PHB'), // linked from a dependency: stays too
    ],
    items: [
      {
        _id: id(10),
        name: 'Pack',
        type: 'loot',
        system: {
          source: { book: 'DMG 2024' },
          description: { value: link('dnd5e.items', id(900)) },
        },
      },
      {
        _id: id(11),
        name: 'Sword of Elsewhere',
        type: 'weapon',
        system: { source: { book: 'Other' } },
      },
    ],
    srdItems: [srdBag],
  });
}

function wire(world) {
  const s = world.packs.get('aitool-content.spells').docs;
  s.get(id(1)).system.description.value =
    `${link('aitool-content.spells', id(2))} ${link('dnd5e.items', id(900))}`;
  s.get(id(2)).system.description.value = link('aitool-content.spells', id(5));
}

describe('seven-books-trim.js', () => {
  test('a dry run counts and changes nothing', async () => {
    const world = standardWorld();
    wire(world);
    const { result, lines } = await run(trimSource, world, true);
    assert.equal(result.move, 2); // Bane + Sword; Light and Sacred Flame stay as dependencies
    assert.equal(names(world.packs.get('aitool-content.spells')).length, 5);
    assert.ok(!world.packs.has('world.legacy-other-books'));
    assert.match(lines.join('\n'), /DEPENDENCIES kept although another book: 2/);
  });

  test('moves the other books with their ids, keeps dependencies, re-points SRD links and hides the packs', async () => {
    const world = standardWorld();
    wire(world);
    const { result } = await run(trimSource, world, false);
    const spells = world.packs.get('aitool-content.spells');
    assert.deepEqual(names(spells), ['Fireball', 'Light', 'Mystery', 'Sacred Flame']);
    const legacy = world.packs.get('world.legacy-other-books');
    assert.deepEqual(names(legacy), ['Bane', 'Sword of Elsewhere']);
    assert.ok(legacy.docs.has(id(3)), 'same id in the legacy pack');
    assert.deepEqual(legacy.ownership, HIDDEN);
    assert.equal(result.moved, 2);
    // the SRD backpack is copied to a player-visible pack and the links point at it
    const linked = world.packs.get('world.linked-srd-items');
    assert.deepEqual([...linked.docs.keys()], [id(900)]);
    assert.equal(linked.ownership.PLAYER, 'OBSERVER');
    const fireball = spells.docs.get(id(1)).system.description.value;
    assert.match(fireball, /Compendium\.world\.linked-srd-items\.Item\./);
    assert.doesNotMatch(fireball, /Compendium\.dnd5e\.items/);
    assert.doesNotMatch(
      world.packs.get('aitool-content.items').docs.get(id(10)).system.description.value,
      /dnd5e\.items/
    );
    for (const p of ['dnd5e.items', 'dnd5e.monsters', 'dnd5e.classes', 'dnd5e.tables']) {
      assert.deepEqual(world.packs.get(p).ownership, HIDDEN, p);
    }
    assert.notDeepEqual(world.packs.get('dnd5e.rules').ownership, HIDDEN, 'rules stay visible');
    for (const p of world.packs.values()) assert.equal(p.locked, false);
  });

  test('a second run changes nothing', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    const before = JSON.stringify(
      [...world.packs].map(([k, p]) => [k, [...p.docs.keys()], p.ownership])
    );
    const { result, lines } = await run(trimSource, world, true);
    assert.deepEqual(result, { move: 0, comeBack: 0, repoint: 0, hide: 0 });
    const again = await run(trimSource, world, false);
    assert.equal(again.result.moved, 0);
    assert.equal(
      JSON.stringify([...world.packs].map(([k, p]) => [k, [...p.docs.keys()], p.ownership])),
      before
    );
    assert.match(lines.join('\n'), /BACK FROM LEGACY \(kept entries link to them\): 0/);
  });

  test('a kept entry that links to something only the legacy pack has gets it back', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    // the hand-trim bug: Bane was moved although Mystery links to it
    const spells = world.packs.get('aitool-content.spells');
    spells.docs.get(id(4)).system.description.value = link('aitool-content.spells', id(3));
    const { result } = await run(trimSource, world, false);
    assert.equal(result.comeBack, 1);
    assert.ok(spells.docs.has(id(3)));
    assert.ok(!world.packs.get('world.legacy-other-books').docs.has(id(3)));
  });

  test('a pack goes back to locked when a chunk fails, and nothing of that chunk is deleted', async () => {
    const world = standardWorld();
    wire(world);
    const spells = world.packs.get('aitool-content.spells');
    spells.locked = true;
    world.globals.Item.createDocuments = async () => [];
    await assert.rejects(run(trimSource, world, false), /created 0 of/);
    assert.equal(spells.locked, true);
    assert.ok(spells.docs.has(id(3)));
  });

  test('skips a world without the aitool-content packs', async () => {
    const { result } = await run(trimSource, { globals: { game: { packs: new Packs() } } }, false);
    assert.deepEqual(result, { skipped: true });
  });
});

describe('seven-books-delete-legacy.js', () => {
  test('refuses while a kept entry links to a legacy-only entry, then deletes the pack', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    const spells = world.packs.get('aitool-content.spells');
    spells.docs.get(id(4)).system.description.value = link('aitool-content.spells', id(3));
    await assert.rejects(run(deleteSource, world, true), /still links to the legacy pack/);
    spells.docs.get(id(4)).system.description.value = '';
    const dry = await run(deleteSource, world, true);
    assert.deepEqual(dry.result, { wouldDelete: 2 });
    assert.ok(!world.packs.get('world.legacy-other-books').deleted);
    const real = await run(deleteSource, world, false);
    assert.deepEqual(real.result, { deleted: true, entries: 2 });
    assert.ok(world.packs.get('world.legacy-other-books').deleted);
  });

  test('refuses a legacy pack that players can see', async () => {
    const world = fakeWorld({
      spells: [],
      items: [],
      legacy: makePack('world.legacy-other-books', 'Item'),
    });
    await assert.rejects(run(deleteSource, world, true), /visible to players/);
  });
});

describe('ddb-source-filter.js', () => {
  const source = readFileSync(path.join(remote, 'ddb-source-filter.js'), 'utf8');
  const make = (filter, sources) => {
    const values = new Map([
      ['ddb-importer.munching-policy-use-source-filter', filter],
      ['ddb-importer.munching-policy-muncher-sources', sources],
    ]);
    return {
      user: { isGM: true },
      settings: {
        settings: new Map([...values.keys()].map(k => [k, {}])),
        get: (ns, key) => values.get(`${ns}.${key}`),
        async set(ns, key, v) {
          values.set(`${ns}.${key}`, v);
        },
      },
    };
  };
  const exec = (game, dryRun) => {
    const lines = [];
    return new AsyncFunction('args', 'game', source)(
      { dryRun, log: t => lines.push(t) },
      game
    ).then(result => ({ result, lines }));
  };

  test('sets the filter and the nine source ids, reads them back, and a rerun changes nothing', async () => {
    const game = make(false, [2, '3']);
    assert.deepEqual((await exec(game, true)).result.todo.length, 2);
    assert.equal(game.settings.get('ddb-importer', 'munching-policy-use-source-filter'), false);
    const real = await exec(game, false);
    assert.equal(real.result.changed.length, 2);
    assert.deepEqual(
      game.settings.get('ddb-importer', 'munching-policy-muncher-sources'),
      [5, 6, 26, 27, 67, 85, 145, 146, 147]
    );
    assert.deepEqual((await exec(game, false)).result.todo, []);
  });

  test('refuses when the module does not register the settings', async () => {
    const game = make(false, []);
    game.settings.settings.clear();
    await assert.rejects(exec(game, true), /does not register/);
  });
});

describe(
  'stage 22 in the ARM64 container',
  { skip: process.env.PI_STAGE22_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const image =
        'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';
      const res = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          'linux/arm64',
          '-v',
          `${repo}:/repo:ro`,
          image,
          'bash',
          '/repo/scripts/pi/container-test/stage22-scenarios.sh',
        ],
        { encoding: 'utf8' }
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.doesNotMatch(res.stdout, /FAIL/);
    });
  }
);
