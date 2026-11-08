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
          flags: d.flags,
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
        async updateEmbeddedDocuments(name, updates) {
          if (name === 'JournalEntryPage') {
            for (const u of updates) {
              const p = (d.pages ?? []).find(x => x._id === u._id);
              if (p) Object.assign(p, structuredClone(u));
            }
            return;
          }
          for (const u of updates) {
            const e = (d.effects ?? []).find(x => x._id === u._id);
            if (e) Object.assign(e, structuredClone(u));
          }
        },
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
      async createCompendium({ type, name, ownership }) {
        const p = makePack(`world.${name}`, type, [], ownership ? { ...ownership } : undefined);
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

// The combined check file of 22-seven-books.sh MODE=check, built by reading the stage's own assembly block (printf and cat
// lines) instead of a hand-written copy, so a change to the stage shows up here.
function combinedCheckFile(trimSrc, baselineSrc) {
  const stage = readFileSync(path.join(remote, '22-seven-books.sh'), 'utf8');
  const start = stage.indexOf("printf 'const CHECK_ONLY");
  const end = stage.indexOf('} >"$GM_SCRIPT.new"', start);
  assert.ok(start > 0 && end > start, 'the check assembly block is in the stage');
  const sources = {
    '/root/seven-books-trim.js': trimSrc,
    '/root/seven-books-baseline.js': baselineSrc,
  };
  let out = '';
  for (const raw of stage.slice(start, end).split('\n')) {
    const line = raw.trim();
    const printf = line.match(/^printf (['"])(.*)\1$/);
    const cat = line.match(/^cat (\S+)$/);
    if (printf) out += printf[2].replaceAll('\\n', '\n');
    else if (cat) {
      assert.ok(cat[1] in sources, `unknown file in the check assembly: ${cat[1]}`);
      out += sources[cat[1]];
    } else
      assert.match(
        line,
        /^(|if \[ -f \/root\/seven-books-baseline\.js \]; then|fi)$/,
        `unexpected line: ${line}`
      );
  }
  return out;
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
    // the module packs are locked at the end, the world packs the run made are not
    for (const p of world.packs.values()) {
      const module = /^(aitool-content|dnd-players-handbook)\./.test(p.collection);
      assert.equal(p.locked, module, p.collection);
    }
    // the legacy copy says where it came from
    assert.equal(
      legacy.docs.get(id(3)).flags['foundry-ai-tool'].sourcePack,
      'aitool-content.spells'
    );
  });

  test('ownership that comes back with its keys in another order counts as the same', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    for (const p of world.packs.values()) {
      if (p.ownership.PLAYER === 'NONE')
        p.ownership = { GAMEMASTER: 'OWNER', ASSISTANT: 'OWNER', TRUSTED: 'NONE', PLAYER: 'NONE' };
    }
    const { result } = await run(trimSource, world, true);
    assert.equal(result.hide, 0);
  });

  test('a second run changes nothing', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    const before = JSON.stringify(
      [...world.packs].map(([k, p]) => [k, [...p.docs.keys()], p.ownership])
    );
    const { result, lines } = await run(trimSource, world, true);
    assert.deepEqual(result, { move: 0, comeBack: 0, repoint: 0, hide: 0, open: 0 });
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

  test('a pack left unlocked by a killed run is locked again, and a failure carries the progress', async () => {
    const world = standardWorld();
    wire(world);
    const items = world.packs.get('aitool-content.items');
    items.locked = false; // what a killed earlier run leaves behind
    world.globals.Item.createDocuments = async () => {
      throw new Error('socket closed');
    };
    await assert.rejects(
      run(trimSource, world, false),
      /socket closed\nDONE BEFORE THE FAILURE:\n[\s\S]*MOVE 2 entries/
    );
    for (const p of world.packs.values()) {
      if (/^aitool-content\./.test(p.collection)) assert.equal(p.locked, true, p.collection);
    }
  });

  test('a refused relock keeps the progress in the error and the other packs get locked', async () => {
    const world = standardWorld();
    wire(world);
    const feats = world.packs.get('aitool-content.feats');
    const configure = feats.configure.bind(feats);
    feats.configure = async change => {
      if (change.locked === true) throw new Error('refused');
      return configure(change);
    };
    await assert.rejects(
      run(trimSource, world, false),
      /module packs could not be locked[\s\S]*MOVE 2 entries[\s\S]*could not lock aitool-content\.feats again: refused/
    );
    assert.equal(world.packs.get('aitool-content.spells').locked, true);
    assert.equal(world.packs.get('aitool-content.items').locked, true);
  });

  test('the same id in two packs, or in the legacy pack for another entry, stops the run before any change', async () => {
    const world = standardWorld();
    wire(world);
    // Bane (spells) and a feat share an id
    world.packs.get('aitool-content.feats').docs.set(id(3), {
      _id: id(3),
      name: 'Other Feat',
      type: 'feat',
      system: { source: { book: 'Other' } },
    });
    await assert.rejects(run(trimSource, world, true), /id collision.*Bane/);
    assert.ok(!world.packs.has('world.legacy-other-books'));
    assert.ok(world.packs.get('aitool-content.spells').docs.has(id(3)));
    // the legacy pack already holds that id for a different entry
    world.packs.get('aitool-content.feats').docs.delete(id(3));
    const legacy = makePack('world.legacy-other-books', 'Item', [
      { _id: id(3), name: 'Not Bane', type: 'spell', system: {} },
    ]);
    legacy.ownership = HIDDEN;
    const world2 = standardWorld();
    wire(world2);
    world2.packs.set(legacy.collection, legacy);
    await assert.rejects(run(trimSource, world2, false), /the legacy pack holds Not Bane/);
    assert.ok(world2.packs.get('aitool-content.spells').docs.has(id(3)));
  });

  test('a step that fails while its relock is refused keeps both messages', async () => {
    const world = standardWorld();
    wire(world);
    const spells = world.packs.get('aitool-content.spells');
    spells.locked = true;
    const configure = spells.configure.bind(spells);
    spells.configure = async change => {
      if (change.locked === true) throw new Error('refused');
      return configure(change);
    };
    world.globals.Item.createDocuments = async () => [];
    await assert.rejects(
      run(trimSource, world, false),
      /created 0 of[\s\S]*could not lock aitool-content\.spells again: refused/
    );
  });

  test('a linked pack that is hidden already is named in the dry run and made visible by the real run', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'dnd5e.classes',
      id(800)
    );
    world.packs.get('dnd5e.classes').ownership = { ...HIDDEN };
    const { lines } = await run(trimSource, world, true);
    assert.match(lines.join('\n'), /WILL OPEN dnd5e\.classes: it is hidden from players/);
    // the check mode counts it as drift (the real run changes it), and the world is clean again after the real run
    const check = `const CHECK_ONLY = true;\n${trimSource}`;
    await run(trimSource, world, false);
    world.packs.get('dnd5e.classes').ownership = { ...HIDDEN };
    await assert.rejects(run(check, world, true), /DRIFT.*"open":1/);
    await run(trimSource, world, false);
    assert.notDeepEqual(world.packs.get('dnd5e.classes').ownership, HIDDEN);
  });

  test('copied SRD entries that link to dnd5e packs themselves are listed', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('dnd5e.items').docs.get(id(900)).system = {
      description: { value: link('dnd5e.classes', id(800)) },
    };
    const { lines } = await run(trimSource, world, true);
    assert.match(
      lines.join('\n'),
      /COPIED SRD ENTRIES THAT LINK TO dnd5e PACKS THEMSELVES[^:]*: 1 \(/
    );
    assert.match(lines.join('\n'), /packs the real run hides: dnd5e\.classes/);
  });

  test('a copied creature that links into dnd5e.items names that pack as hidden by the real run', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('dnd5e.monsters').docs.set(id(902), {
      _id: id(902),
      name: 'Armed Guard',
      type: 'npc',
      system: {},
      items: [{ system: { description: { value: link('dnd5e.items', id(900)) } } }],
    });
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'dnd5e.monsters',
      id(902),
      'Actor'
    );
    const { lines } = await run(trimSource, world, true);
    assert.match(lines.join('\n'), /packs the real run hides: dnd5e\.items/);
  });

  test('copied SRD creatures: links inside embedded features are found too', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('dnd5e.monsters').docs.set(id(901), {
      _id: id(901),
      name: 'Ghoul',
      type: 'npc',
      system: {},
      items: [{ system: { description: { value: link('dnd5e.classes', id(800)) } } }],
    });
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'dnd5e.monsters',
      id(901),
      'Actor'
    );
    const { lines } = await run(trimSource, world, true);
    assert.match(lines.join('\n'), /packs the real run hides: dnd5e\.classes/);
  });

  test('a pack that kept entries link to stays visible and is named', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'dnd5e.classes',
      id(800)
    );
    const { lines } = await run(trimSource, world, true);
    assert.match(
      lines.join('\n'),
      /LEFT VISIBLE because kept entries link to them: 1 \(dnd5e\.classes 1\)/
    );
    await run(trimSource, world, false);
    assert.notDeepEqual(world.packs.get('dnd5e.classes').ownership, HIDDEN);
    assert.deepEqual(world.packs.get('dnd5e.items').ownership, HIDDEN);
  });

  test('an entry that came back into aitool-content replaces its stale legacy copy', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    // a stage 11 push brings Bane back with new text; the legacy pack still holds the old one
    const spells = world.packs.get('aitool-content.spells');
    spells.docs.set(id(3), spell(3, 'Bane', 'PHB', 'new text'));
    await run(trimSource, world, false);
    const legacy = world.packs.get('world.legacy-other-books');
    assert.equal(legacy.docs.get(id(3)).system.description.value, 'new text');
    assert.ok(!spells.docs.has(id(3)));
  });

  test('the dry run says how many stale legacy copies a rerun replaces, and a failed create loses nothing', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    const spells = world.packs.get('aitool-content.spells');
    spells.docs.set(id(3), spell(3, 'Bane', 'PHB', 'new text'));
    const dry = await run(trimSource, world, true);
    assert.match(dry.lines.join('\n'), /REPLACE stale legacy copies .*: 1 \(Bane\)/);
    const create = world.globals.Item.createDocuments;
    world.globals.Item.createDocuments = async () => [];
    await assert.rejects(run(trimSource, world, false), /created 0 of/);
    assert.ok(spells.docs.has(id(3)), 'still in the content pack');
    world.globals.Item.createDocuments = create;
    await run(trimSource, world, false);
    assert.equal(
      world.packs.get('world.legacy-other-books').docs.get(id(3)).system.description.value,
      'new text'
    );
  });

  test('check mode is never a real run, and the stage keeps its snapshot and signal lines', async () => {
    const world = standardWorld();
    wire(world);
    await assert.rejects(
      run(`const CHECK_ONLY = true;\n${trimSource}`, world, false),
      /never a real run/
    );
    assert.ok(!world.packs.has('world.legacy-other-books'));
    const stage = readFileSync(path.join(remote, '22-seven-books.sh'), 'utf8');
    assert.match(stage, /trap '' HUP PIPE/);
    assert.match(stage, /^\[ "\$\{MODE:-trim\}" = check \] \|\| require_recent_snapshot/m);
    assert.match(stage, /MODE=check only reads/);
  });

  test('effect descriptions of re-pointed entries are re-pointed too', async () => {
    const world = standardWorld();
    wire(world);
    world.packs.get('aitool-content.spells').docs.get(id(1)).effects = [
      { _id: 'e1', changes: [], flags: {}, description: link('dnd5e.items', id(900)) },
    ];
    await run(trimSource, world, false);
    const eff = world.packs.get('aitool-content.spells').docs.get(id(1)).effects[0];
    assert.match(eff.description, /Compendium\.world\.linked-srd-items\.Item\./);
    assert.doesNotMatch(eff.description, /dnd5e\.items/);
  });

  test('check mode: a trimmed world has no drift; a book put back or a visible SRD pack is drift; a link into a GM-only pack is listed, not drift', async () => {
    const check = `const CHECK_ONLY = true;\n${trimSource}`;
    const world = standardWorld();
    wire(world);
    await assert.rejects(run(check, world, true), /DRIFT/); // not trimmed yet
    await run(trimSource, world, false);
    const ok = await run(check, world, true);
    assert.match(ok.lines.join('\n'), /no drift/);
    // a content module update puts a dropped book back
    world.packs.get('aitool-content.spells').docs.set(id(60), spell(60, 'Old Spell', 'Other'));
    await assert.rejects(run(check, world, true), /DRIFT.*"move":1/);
    world.packs.get('aitool-content.spells').docs.delete(id(60));
    // the dnd5e SRD pack is visible again
    world.packs.get('dnd5e.items').ownership = { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER' };
    await assert.rejects(run(check, world, true), /DRIFT.*"srdVisible":1/);
    world.packs.get('dnd5e.items').ownership = { ...HIDDEN };
    // a kept entry links into a pack players cannot open (summons and tables are the known ones)
    const hidden = makePack('aitool-content.summons', 'Actor', [], { ...HIDDEN });
    world.packs.set(hidden.collection, hidden);
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'aitool-content.summons',
      id(70),
      'Actor'
    );
    assert.match((await run(check, world, true)).lines.join('\n'), /unexpected: 0/);
    const odd = makePack('dnd-players-handbook.hidden', 'Item', [], { ...HIDDEN });
    world.packs.set(odd.collection, odd);
    world.packs.get('aitool-content.spells').docs.get(id(4)).system.description.value = link(
      'dnd-players-handbook.hidden',
      id(71)
    );
    // listed, but not drift: a rerun of the trim could not fix it
    const dead = await run(check, world, true);
    assert.match(dead.lines.join('\n'), /dnd-players-handbook\.hidden 1\), unexpected: 1/);
    assert.match(dead.lines.join('\n'), /no drift/);
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

  test('checks the pack a link names, not the pack it sits in', async () => {
    const world = standardWorld();
    wire(world);
    await run(trimSource, world, false);
    // Bane is in the legacy pack; a kept PHB 2024 entry links to the same id in aitool-content.spells
    world.packs.get('dnd-players-handbook.equipment').docs.set(id(50), {
      _id: id(50),
      name: 'Kept Elsewhere',
      type: 'spell',
      system: { description: { value: link('aitool-content.spells', id(3)) } },
    });
    await assert.rejects(run(deleteSource, world, true), /still links to the legacy pack/);
    // a link to an id of another pack's name in the legacy pack is not a dangling link
    world.packs.get('dnd-players-handbook.equipment').docs.get(id(50)).system.description.value =
      link('dnd-players-handbook.equipment', id(3));
    assert.deepEqual((await run(deleteSource, world, true)).result, { wouldDelete: 2 });
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

describe('seven-books-baseline.js', () => {
  const baselineSource = readFileSync(path.join(remote, 'seven-books-baseline.js'), 'utf8');
  const OPEN = { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
  const mk = (n, name, type, text = '', sub = undefined) => ({
    _id: id(n),
    name,
    type,
    system: { description: { value: text }, ...(sub ? { type: { value: sub } } : {}) },
    effects: [],
  });
  const worlds = () => {
    const phbClasses = makePack('dnd-players-handbook.classes', 'Item', [
      mk(1, 'Wizard', 'class', link('dnd-players-handbook.origins', id(3))),
      mk(2, 'Evoker', 'subclass', link('dnd-players-handbook.classes', id(1))),
      mk(11, 'Arcane Recovery', 'feat', '', 'class'), // a class feature is not a pickable feat
    ]);
    const origins = makePack('dnd-players-handbook.origins', 'Item', [
      mk(3, 'Elf', 'race', link('aitool-content.feats', id(5))),
      mk(4, 'Sage', 'background'),
    ]);
    const feats = makePack('aitool-content.feats', 'Item', [mk(5, 'Alert', 'feat', '', 'feat')]);
    const spells = makePack('aitool-content.spells', 'Item', [
      mk(6, 'Fireball', 'spell', link('aitool-content.summons', id(70))),
    ]);
    const items = makePack('aitool-content.items', 'Item', [mk(7, 'Rope', 'loot')]);
    const equipment = makePack('dnd-players-handbook.equipment', 'Item', [
      mk(8, 'Sword', 'weapon'),
    ]);
    const journal = makePack('dnd-players-handbook.content', 'JournalEntry', [
      {
        _id: id(100),
        name: 'Classes',
        pages: [
          {
            _id: id(101),
            name: 'Wizard text',
            text: {
              content: `${link('dnd-players-handbook.classes', id(1))} @Compendium[aitool-content.spells.${id(6)}]`,
            },
            system: {},
          },
          {
            _id: id(102),
            name: 'Spell list',
            type: 'spells',
            text: {},
            system: {
              spells: [
                `Compendium.aitool-content.spells.Item.${id(6)}`,
                'Compendium.dnd5e.rules.JournalEntry.x',
              ],
            },
          },
          { _id: id(103), name: 'Plain', text: { content: 'nothing' }, system: {} },
        ],
      },
    ]);
    const extra = [
      makePack('aitool-content.classes', 'Item'),
      makePack('aitool-content.species', 'Item'),
      makePack('aitool-content.backgrounds', 'Item'),
      makePack('dnd-players-handbook.feats', 'Item'),
      makePack('dnd-players-handbook.spells', 'Item'),
      makePack('aitool-content.summons', 'Item', [], HIDDEN),
      journal,
    ];
    const world = fakeWorld({
      extraPacks: [phbClasses, origins, feats, spells, items, equipment, ...extra],
    });
    // fakeWorld already made empty aitool packs: put the content into them
    for (const p of [feats, spells, items]) world.packs.set(p.collection, p);
    world.packs.set(
      'world.legacy-other-books',
      makePack('world.legacy-other-books', 'Item', [], HIDDEN)
    );
    return world;
  };
  const player = (world, n) => world.packs.get(`world.player-${n}`);
  const text = world => JSON.stringify([...world.packs.values()].map(p => [...p.docs.values()]));

  test('a dry run counts and changes nothing', async () => {
    const world = worlds();
    const before = text(world);
    const { result, lines } = await run(baselineSource, world, true);
    assert.deepEqual(result, { copy: 9, refresh: 0, journalPages: 2, hide: 11, missingPacks: 6 });
    assert.equal(text(world), before);
    assert.ok(!world.packs.has('world.player-classes'));
    assert.match(lines.join('\n'), /JOURNAL PAGES to rewrite: 2/);
  });

  test('copies by item type with the same ids, rewrites links in copies and journals, hides the old packs', async () => {
    const world = worlds();
    await run(baselineSource, world, true);
    await run(baselineSource, world, false);
    assert.deepEqual(names(player(world, 'classes')), ['Evoker', 'Wizard']);
    assert.deepEqual(names(player(world, 'species')), ['Elf']);
    assert.deepEqual(names(player(world, 'backgrounds')), ['Sage']);
    assert.deepEqual(names(player(world, 'feats')), ['Alert']);
    assert.deepEqual(names(player(world, 'spells')), ['Fireball']);
    assert.deepEqual(names(player(world, 'items')), ['Arcane Recovery', 'Rope', 'Sword']);
    assert.ok(player(world, 'classes').docs.has(id(1)), 'same id');
    assert.equal(
      player(world, 'classes').docs.get(id(1)).flags['foundry-ai-tool'].sourcePack,
      'dnd-players-handbook.classes'
    );
    // links name the world pack that now holds the target; others are untouched
    assert.match(
      player(world, 'classes').docs.get(id(1)).system.description.value,
      /Compendium\.world\.player-species\.Item\./
    );
    assert.match(
      player(world, 'species').docs.get(id(3)).system.description.value,
      /Compendium\.world\.player-feats\./
    );
    assert.match(
      player(world, 'spells').docs.get(id(6)).system.description.value,
      /Compendium\.aitool-content\.summons\./
    );
    const pages = world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages;
    assert.match(pages[0].text.content, /Compendium\.world\.player-classes\.Item\./);
    assert.match(
      pages[0].text.content,
      new RegExp(`@Compendium\\[world\\.player-spells\\.${id(6)}\\]`)
    );
    assert.deepEqual(pages[1].system.spells, [
      `Compendium.world.player-spells.Item.${id(6)}`,
      'Compendium.dnd5e.rules.JournalEntry.x',
    ]);
    assert.equal(pages[2].text.content, 'nothing');
    // players see the world packs, not the old ones; the journals stay visible; module packs are locked again
    for (const n of ['classes', 'species', 'backgrounds', 'feats', 'spells', 'items'])
      assert.deepEqual(player(world, n).ownership, OPEN, n);
    assert.deepEqual(world.packs.get('aitool-content.spells').ownership, HIDDEN);
    assert.deepEqual(world.packs.get('dnd-players-handbook.equipment').ownership, HIDDEN);
    assert.notDeepEqual(world.packs.get('dnd-players-handbook.content').ownership, HIDDEN);
    assert.equal(world.packs.get('dnd-players-handbook.content').locked, true);
    assert.equal(world.packs.get('aitool-content.spells').locked, true);
    // the old entries are still there
    assert.equal(world.packs.get('aitool-content.spells').docs.size, 1);
  });

  test('a second run changes nothing; a changed source is refreshed', async () => {
    const world = worlds();
    world.packs.get('aitool-content.spells').docs.get(id(6)).effects = [
      {
        _id: 'e1',
        name: 'x',
        _stats: { coreVersion: '14.368' },
        system: { changes: [{ _id: 'c1', key: 'k', value: '1' }] },
      },
    ];
    await run(baselineSource, world, true);
    await run(baselineSource, world, false);
    // Foundry stamps its own _stats on what it writes: that is not a change of content
    player(world, 'spells').docs.get(id(6)).effects[0]._stats.coreVersion = '14.370';
    player(world, 'spells').docs.get(id(6)).effects[0].system.changes[0]._id = 'c2'; // new random id on create
    const after = text(world);
    const again = await run(baselineSource, world, true);
    assert.deepEqual(again.result, {
      copy: 0,
      refresh: 0,
      journalPages: 0,
      hide: 0,
      missingPacks: 0,
    });
    await run(baselineSource, world, false);
    assert.equal(text(world), after);
    world.packs.get('aitool-content.feats').docs.get(id(5)).system.description.value = 'new text';
    const refresh = await run(baselineSource, world, true);
    assert.equal(refresh.result.refresh, 1);
    await run(baselineSource, world, false);
    assert.equal(player(world, 'feats').docs.get(id(5)).system.description.value, 'new text');
  });

  test('a copy that no kept pack has any more is an orphan: drift in check mode, removed by the real run; a hand-made entry stays', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    world.packs.get('aitool-content.feats').docs.delete(id(5)); // a trim moved it out
    player(world, 'feats').docs.set(id(77), mk(77, 'GM homebrew', 'feat', '', 'feat')); // no sourcePack tag
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    await assert.rejects(run(check, world, true), /DRIFT.*"orphans":1/s);
    const real = await run(baselineSource, world, false);
    assert.match(real.lines.join('\n'), /REMOVED 1 orphan copies from world\.player-feats/);
    assert.deepEqual(names(player(world, 'feats')), ['GM homebrew']);
    assert.match((await run(check, world, true)).lines.join('\n'), /NOT OURS.*: 1/);
  });

  test('a trimmed and baselined world passes the combined check of stage 22', async () => {
    const trimSrc = readFileSync(path.join(remote, 'seven-books-trim.js'), 'utf8');
    const world = worlds();
    await run(trimSrc, world, false);
    await run(baselineSource, world, false);
    const combined = combinedCheckFile(trimSrc, baselineSource);
    const { lines } = await run(combined, world, true);
    assert.match(lines.join('\n'), /no drift: the world matches the seven-book trim/);
    // the baseline hides the kept packs on purpose: they are no unexpected dead links for the trim check
    assert.match(lines.join('\n'), /LINKS INTO PACKS PLAYERS CANNOT OPEN.*unexpected: 0/);
    assert.match(lines.join('\n'), /no drift: the world matches the seven-book baseline/);
  });

  test('stops on id collisions and on a world entry that is another entry', async () => {
    const world = worlds();
    world.packs.get('aitool-content.items').docs.set(id(1), mk(1, 'Twin', 'loot'));
    await assert.rejects(run(baselineSource, world, true), /id collision/);
    const w2 = worlds();
    w2.packs.set(
      'world.player-feats',
      makePack('world.player-feats', 'Item', [mk(5, 'Not Alert', 'feat')])
    );
    await assert.rejects(run(baselineSource, w2, true), /not the kept ones/);
  });

  test('runs without the legacy pack after the baseline (MODE=delete removes it), but refuses before the trim', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    world.packs.delete('world.legacy-other-books');
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    const checked = await run(check, world, true);
    assert.match(checked.lines.join('\n'), /legacy-other-books is not in this world/);
    assert.match(checked.lines.join('\n'), /no drift/);
    const again = await run(baselineSource, world, false);
    assert.equal(again.result.copied, 0);
    // no legacy pack and no world pack: the trim was never run here (or MODE=delete ran first): a dry run and a real run both refuse
    const fresh = worlds();
    fresh.packs.delete('world.legacy-other-books');
    await assert.rejects(
      run(baselineSource, fresh, true),
      /run MODE=trim first.*MODE=delete already removed/s
    );
    await assert.rejects(
      run(baselineSource, fresh, false),
      /run MODE=trim first.*MODE=delete already removed/s
    );
    assert.ok(!fresh.packs.has('world.player-spells'));
  });

  test('a rerun with a whole source pack missing keeps its copies and says so', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    world.packs.delete('dnd-players-handbook.origins'); // Elf and Sage have no source pack now
    const dry = await run(baselineSource, world, true);
    assert.match(
      dry.lines.join('\n'),
      /SOURCE PACK MISSING \(copies kept\): dnd-players-handbook\.origins 2/
    );
    assert.doesNotMatch(dry.lines.join('\n'), /ORPHANS/);
    // an entry with only the trim's sourcePack tag (no baselineCopy) is not ours either
    player(world, 'feats').docs.set(id(78), {
      ...mk(78, 'Legacy-tagged', 'feat', '', 'feat'),
      flags: { 'foundry-ai-tool': { sourcePack: 'aitool-content.feats' } },
    });
    const real = await run(baselineSource, world, false);
    assert.doesNotMatch(real.lines.join('\n'), /REMOVED/);
    assert.deepEqual(names(player(world, 'species')), ['Elf']);
    assert.deepEqual(names(player(world, 'backgrounds')), ['Sage']);
    assert.deepEqual(names(player(world, 'feats')), ['Alert', 'Legacy-tagged']);
    assert.match(real.lines.join('\n'), /NOT OURS.*: 1/);
  });

  test('a failed copy hides nothing and still locks the module packs', async () => {
    const world = worlds();
    const real = world.globals.Item.createDocuments;
    world.globals.Item.createDocuments = async (data, opts) => {
      if (opts.pack === 'world.player-items') return [];
      return real(data, opts);
    };
    await assert.rejects(run(baselineSource, world, false), e => {
      assert.match(e.message, /created 0 of 3.*DONE BEFORE THE FAILURE/s);
      assert.doesNotMatch(e.message, /HALF-FINISHED/); // no journal page was touched yet
      return true;
    });
    assert.notDeepEqual(world.packs.get('aitool-content.spells').ownership, HIDDEN);
    // the world packs the run made stay hidden from players until the last step
    for (const n of ['classes', 'species', 'backgrounds', 'feats', 'spells', 'items'])
      assert.deepEqual(player(world, n).ownership, HIDDEN, n);
    assert.equal(world.packs.get('aitool-content.spells').locked, true);
    const pages = world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages;
    assert.doesNotMatch(pages[0].text.content, /world\.player/);
  });

  const wrapJournal = (world, onUpdate) => {
    const journal = world.packs.get('dnd-players-handbook.content');
    const orig = journal.doc.bind(journal);
    journal.doc = x => {
      const d = orig(x);
      const update = d.updateEmbeddedDocuments;
      d.updateEmbeddedDocuments = (...a) => onUpdate(update, d, a);
      return d;
    };
  };

  test('a real run that fails after the journal rewrite says HALF-FINISHED, and the check says it too', async () => {
    const world = worlds();
    let armed = false;
    const create = world.globals.CompendiumCollection.createCompendium;
    world.globals.CompendiumCollection.createCompendium = async opts => {
      const pack = await create(opts);
      const getIndex = pack.getIndex;
      pack.getIndex = function () {
        if (armed) throw new Error('scan failed');
        return getIndex.call(this);
      };
      return pack;
    };
    wrapJournal(world, async (update, d, a) => {
      await update.apply(d, a);
      armed = true; // the residual scan reads the world packs next
    });
    await assert.rejects(run(baselineSource, world, false), e => {
      assert.match(e.message, /scan failed/);
      assert.match(e.message, /HALF-FINISHED/);
      return true;
    });
    // players still see no world pack; the journal pages already name them
    for (const n of ['classes', 'items']) assert.deepEqual(player(world, n).ownership, HIDDEN, n);
    assert.equal(world.packs.get('dnd-players-handbook.content').locked, true);
    armed = false;
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    await assert.rejects(run(check, world, true), /HALF-FINISHED/);
    // a rerun finishes it
    await run(baselineSource, world, false);
    assert.deepEqual(player(world, 'classes').ownership, OPEN);
  });

  test('a successful run whose module packs could not be locked again does not print HALF-FINISHED', async () => {
    const world = worlds();
    const items = world.packs.get('aitool-content.items');
    items.configure = async change => {
      if (change.locked === true) throw new Error('lock refused');
    };
    await assert.rejects(run(baselineSource, world, false), e => {
      assert.match(e.message, /module packs could not be locked/);
      assert.doesNotMatch(e.message, /HALF-FINISHED/);
      return true;
    });
    assert.deepEqual(player(world, 'items').ownership, OPEN);
  });

  test('a refresh whose create fails puts the replaced copies back', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    world.packs.get('aitool-content.feats').docs.get(id(5)).system.description.value = 'new text';
    const real = world.globals.Item.createDocuments;
    let fail = true;
    world.globals.Item.createDocuments = async (data, opts) => {
      if (fail && opts.pack === 'world.player-feats') {
        fail = false; // only the new copy fails; the put-back goes through
        throw new Error('create failed');
      }
      return real(data, opts);
    };
    await assert.rejects(
      run(baselineSource, world, false),
      /create failed.*1 replaced copies put back/s
    );
    assert.deepEqual(names(player(world, 'feats')), ['Alert']);
    assert.equal(player(world, 'feats').docs.get(id(5)).system.description.value, '');
    await run(baselineSource, world, false);
    assert.equal(player(world, 'feats').docs.get(id(5)).system.description.value, 'new text');
  });

  test('a refresh whose create is short, or whose put-back fails, says so', async () => {
    const shortWorld = worlds();
    await run(baselineSource, shortWorld, false);
    shortWorld.packs.get('aitool-content.feats').docs.get(id(5)).system.description.value =
      'new text';
    const real = shortWorld.globals.Item.createDocuments;
    let first = true;
    shortWorld.globals.Item.createDocuments = async (data, opts) => {
      if (first && opts.pack === 'world.player-feats') {
        first = false;
        return []; // created nothing, no error
      }
      return real(data, opts);
    };
    await assert.rejects(
      run(baselineSource, shortWorld, false),
      /created 0 of 1; 1 replaced copies put back/
    );
    assert.deepEqual(names(player(shortWorld, 'feats')), ['Alert']);
    const failWorld = worlds();
    await run(baselineSource, failWorld, false);
    failWorld.packs.get('aitool-content.feats').docs.get(id(5)).system.description.value =
      'new text';
    const realFail = failWorld.globals.Item.createDocuments;
    failWorld.globals.Item.createDocuments = async (data, opts) => {
      if (opts.pack === 'world.player-feats') throw new Error('create failed');
      return realFail(data, opts);
    };
    await assert.rejects(
      run(baselineSource, failWorld, false),
      /create failed.*COULD NOT put the replaced copies back \(create failed\); run again/s
    );
  });

  test('a copy that names another kept pack than its source is a refresh; the rename exemption needs the same source', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    const tag = () => player(world, 'feats').docs.get(id(5)).flags['foundry-ai-tool'];
    tag().sourcePack = 'aitool-content.items';
    assert.equal((await run(baselineSource, world, true)).result.refresh, 1);
    await run(baselineSource, world, false);
    assert.equal(tag().sourcePack, 'aitool-content.feats');
    // renamed source, copy names another source pack: not the rename exemption
    world.packs.get('aitool-content.feats').docs.get(id(5)).name = 'Alert II';
    tag().sourcePack = 'aitool-content.items';
    await assert.rejects(run(baselineSource, world, true), /not the kept ones/);
  });

  test('a typed link to an id no kept pack maps is no name-form link', async () => {
    const world = worlds();
    world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content =
      '@Compendium[dnd-players-handbook.classes.Item.zzzzzzzzzzzzzzzz]{Gone}';
    const dry = await run(baselineSource, world, true);
    assert.match(dry.lines.join('\n'), /NAME-FORM LINKS.*: 0\b/);
  });

  test('a rename in a kept pack is a refresh; a copy made before the baselineCopy flag gets the flag', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    world.packs.get('aitool-content.feats').docs.get(id(5)).name = 'Alert II';
    const dry = await run(baselineSource, world, true);
    assert.equal(dry.result.refresh, 1);
    await run(baselineSource, world, false);
    assert.deepEqual(names(player(world, 'feats')), ['Alert II']);
    // an old copy without the flag
    delete player(world, 'spells').docs.get(id(6)).flags['foundry-ai-tool'].baselineCopy;
    assert.equal((await run(baselineSource, world, true)).result.refresh, 1);
    await run(baselineSource, world, false);
    assert.equal(
      player(world, 'spells').docs.get(id(6)).flags['foundry-ai-tool'].baselineCopy,
      true
    );
    // a renamed source AND a copy without the flag, same source pack: a refresh, and the flag is back after a real run
    const flagless = world.packs.get('aitool-content.feats').docs.get(id(5));
    delete player(world, 'feats').docs.get(id(5)).flags['foundry-ai-tool'].baselineCopy;
    flagless.name = 'Alert III';
    assert.equal((await run(baselineSource, world, true)).result.refresh, 1);
    await run(baselineSource, world, false);
    assert.equal(
      player(world, 'feats').docs.get(id(5)).flags['foundry-ai-tool'].baselineCopy,
      true
    );
    assert.deepEqual(names(player(world, 'feats')), ['Alert III']);
    // a hand-made entry with the same id and another name is still no copy of ours
    player(world, 'items').docs.set(id(7), mk(7, 'Not Rope', 'loot'));
    await assert.rejects(run(baselineSource, world, true), /not the kept ones/);
  });

  test('check mode fails on a missing source pack, and a new world pack is created hidden', async () => {
    const created = [];
    const world = worlds();
    const create = world.globals.CompendiumCollection.createCompendium;
    world.globals.CompendiumCollection.createCompendium = async opts => {
      created.push(opts.ownership);
      return create(opts);
    };
    await run(baselineSource, world, false);
    assert.equal(created.length, 6);
    for (const o of created) assert.deepEqual(o, HIDDEN);
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    world.packs.delete('dnd-players-handbook.origins');
    await assert.rejects(run(check, world, true), /DRIFT.*"missingSource":1/s);
  });

  test('the dry run counts name-form links, which are not rewritten', async () => {
    const world = worlds();
    world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content =
      '@Compendium[dnd-players-handbook.classes.Wizard]{Wizard}';
    const dry = await run(baselineSource, world, true);
    assert.match(dry.lines.join('\n'), /NAME-FORM LINKS.*: 1\b/);
    await run(baselineSource, world, false);
    assert.match(
      world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content,
      /@Compendium\[dnd-players-handbook\.classes\.Wizard\]/
    );
  });

  test('undo logs what it restored, stops on a page it could not point back, and a check after an undo ignores links it cannot map', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    const undo = `const BASELINE_MODE = 'undo';\n${baselineSource}`;
    // a journal update that does nothing: the residual scan stops the undo before any pack is shown or hidden
    wrapJournal(world, async () => undefined);
    await assert.rejects(run(undo, world, false), /journal pages still name a world pack/);
    assert.equal(world.packs.get('aitool-content.spells').ownership.PLAYER, 'NONE');
    assert.deepEqual(player(world, 'spells').ownership, OPEN);
    // the partly-pointed-back state: the wrapper rewrites every page of the entry except the first; the error counts pages, not links, and names the next step
    const part = worlds();
    await run(baselineSource, part, false);
    wrapJournal(part, async (update, d, a) => update.apply(d, [a[0], a[1].slice(1)]));
    await assert.rejects(run(undo, part, false), e => {
      assert.match(e.message, /^1 journal pages still name a world pack/);
      assert.match(e.message, /Rerun MODE=baseline-undo \(dry run first\) or MODE=baseline/);
      return true;
    });
    const fresh = worlds();
    await run(baselineSource, fresh, false);
    const done = await run(undo, fresh, false);
    assert.match(done.lines.join('\n'), /RESTORED aitool-content\.spells: Player NONE -> OBSERVER/);
    // an undo leaves a link to a world pack id with no copy alone and says so
    const orphanLink = worlds();
    await run(baselineSource, orphanLink, false);
    orphanLink.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content =
      `@UUID[Compendium.world.player-spells.Item.${id(99)}]`;
    const undone = await run(undo, orphanLink, false);
    assert.match(
      undone.lines.join('\n'),
      /links to world packs with no copy to map back \(left as they are\): 1/
    );
    // a link to a world pack id with no copy is no half-finished run
    fresh.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content =
      `@UUID[Compendium.world.player-spells.Item.${id(99)}]`;
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    assert.deepEqual((await run(check, fresh, true)).result, { applied: false });
    // nor is a link to a hand-made entry in a world pack (it has no sourcePack, the undo cannot map it)
    player(fresh, 'spells').docs.set(id(98), mk(98, 'GM homebrew', 'spell'));
    fresh.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[2].text.content =
      `@UUID[Compendium.world.player-spells.Item.${id(98)}]`;
    assert.deepEqual((await run(check, fresh, true)).result, { applied: false });
  });

  test('check mode: not applied is fine, applied is clean, drift is an error, and it never runs for real', async () => {
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    const world = worlds();
    assert.deepEqual((await run(check, world, true)).result, { applied: false });
    await assert.rejects(run(check, world, false), /check only/);
    await run(baselineSource, world, false);
    assert.match((await run(check, world, true)).lines.join('\n'), /no drift/);
    // a module update puts the old links back into a journal page and adds a kept entry
    world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages[0].text.content = link(
      'dnd-players-handbook.classes',
      id(1)
    );
    world.packs.get('aitool-content.feats').docs.set(id(9), mk(9, 'Lucky', 'feat'));
    await assert.rejects(run(check, world, true), /DRIFT.*"copy":1.*"journalPages":1/s);
  });

  test('undo points the journals back, shows the old packs, hides the world packs and deletes nothing', async () => {
    const world = worlds();
    const originalJournal = JSON.stringify(
      world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages
    );
    await run(baselineSource, world, false);
    const undo = `const BASELINE_MODE = 'undo';\n${baselineSource}`;
    const dry = await run(undo, world, true);
    assert.equal(dry.result.pages, 2);
    assert.equal(world.packs.get('aitool-content.spells').ownership.PLAYER, 'NONE');
    await run(undo, world, false);
    assert.equal(
      JSON.stringify(world.packs.get('dnd-players-handbook.content').docs.get(id(100)).pages),
      originalJournal
    );
    assert.equal(world.packs.get('aitool-content.spells').ownership.PLAYER, 'OBSERVER');
    assert.deepEqual(player(world, 'spells').ownership, HIDDEN);
    assert.equal(player(world, 'spells').docs.size, 1);
    // a rerun of the baseline brings the world packs back
    // an undone baseline is not checked (no false drift)
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    const undone = await run(check, world, true);
    assert.deepEqual(undone.result, { applied: false });
    assert.match(undone.lines.join('\n'), /baseline undone \(world packs hidden\): not checked/);
    await run(baselineSource, world, false);
    assert.deepEqual(player(world, 'spells').ownership, OPEN);
    assert.equal(world.packs.get('aitool-content.spells').ownership.PLAYER, 'NONE');
    assert.deepEqual((await run(undo, makePristine(), true)).result, { undone: false });
  });
  test('check reports a half-finished run (journals rewritten, world packs hidden) instead of undone', async () => {
    const world = worlds();
    await run(baselineSource, world, false);
    for (const n of ['classes', 'species', 'backgrounds', 'feats', 'spells', 'items'])
      player(world, n).ownership = { ...HIDDEN };
    for (const [pid, pack] of world.packs)
      if (pid.startsWith('aitool-content.') || pid.startsWith('dnd-players-handbook.'))
        pack.ownership = { ...OPEN };
    const check = `const BASELINE_MODE = 'check';\n${baselineSource}`;
    await assert.rejects(run(check, world, true), /HALF-FINISHED/);
    const undo = `const BASELINE_MODE = 'undo';\n${baselineSource}`;
    await run(undo, world, false);
    assert.deepEqual((await run(check, world, true)).result, { applied: false });
  });
  const makePristine = () => worlds();

  test('the combined check file of stage 22 (trim check, then baseline check) parses and runs both', async () => {
    const trimSrc = readFileSync(path.join(remote, 'seven-books-trim.js'), 'utf8');
    const combined = combinedCheckFile(trimSrc, baselineSource);
    assert.match(combined, /^const CHECK_ONLY = true;\nawait \(async \(\) => \{\n/);
    assert.match(combined, /\nawait \(async \(\) => \{\nconst BASELINE_MODE = 'check';\n/);
    const world = worlds();
    const { lines } = await run(combined, world, true).catch(e => ({ lines: [String(e.message)] }));
    // an untrimmed fake world is trim drift: the trim check runs first and its error is what comes out
    assert.match(lines.join('\n'), /DRIFT: the world no longer matches the seven-book trim/);
  });

  test('stage 22 has the baseline modes, runs the baseline check after the trim check and keeps the other gates', () => {
    const stage = readFileSync(path.join(remote, '22-seven-books.sh'), 'utf8');
    assert.match(stage, /baseline\) GM_SCRIPT=\/root\/seven-books-baseline\.js/);
    assert.match(stage, /baseline-undo\)/);
    assert.match(stage, /BASELINE_MODE = 'undo'/);
    assert.match(stage, /BASELINE_MODE = 'check'/);
    assert.match(stage, /\[ "\$MODE" = baseline \]/);
    assert.match(stage, /MODE must be trim, check, baseline, baseline-undo or delete/);
    assert.match(
      stage,
      /the undo points the journal pages of dnd-players-handbook\.content and aitool-content\.journals back at the old packs/
    );
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
