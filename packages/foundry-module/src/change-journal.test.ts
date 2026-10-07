/**
 * Unit tests for ChangeJournal (I-109): the module's change journal recorder.
 *
 * Uses the Foundry-mock harness for `game`, `Hooks` and `foundry.utils` and
 * fires the hooks with small plain fixture documents (the approach
 * play-recorder.test.ts uses). `simulateUpdate`, `simulateCreate` and
 * `simulateDelete` mimic Foundry's order: the pre-hooks run in the browser
 * that makes the change, then the document changes, then the post-hooks run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { ChangeJournal, changedPaths } from './change-journal.js';
import {
  CHANGE_JOURNAL_ACTION_GAP_MS,
  CHANGE_JOURNAL_DOCUMENTS,
  CHANGE_JOURNAL_MAX_LIMIT,
  CHANGE_JOURNAL_MAX_RECORD_BYTES,
  CHANGE_JOURNAL_RING,
} from './change-journal-types.js';
import { MODULE_ID } from './constants.js';

const g = globalThis as any;

let world: TestWorld;
let restore: () => void;
let journal: ChangeJournal;

function setup(currentUser: { id: string; isGM: boolean } = { id: 'gm', isGM: true }): void {
  world = createTestWorld({ currentUser });
  restore = world.install();
  world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true });
  world.addUser({ id: 'p1', name: 'Player One', isGM: false });
  for (const name of CHANGE_JOURNAL_DOCUMENTS) g.CONFIG[name] ??= {};
  journal = new ChangeJournal();
  journal.registerHooks();
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  restore();
  delete g._del;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- Fixtures ----------------------------------------------------------------

interface FixtureOptions {
  documentName: string;
  id: string;
  uuid?: string;
  name?: string;
  parent?: any;
  source?: Record<string, any>;
  modifiedTime?: number;
  createdTime?: number;
  extra?: Record<string, any>;
}

let clock = 1_000_000;

function fixture(opts: FixtureOptions): any {
  const source: Record<string, any> = {
    _id: opts.id,
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.source ?? {}),
    _stats: {
      createdTime: opts.createdTime ?? 500,
      modifiedTime: opts.modifiedTime ?? 600,
    },
  };
  const doc: any = {
    id: opts.id,
    documentName: opts.documentName,
    name: opts.name,
    parent: opts.parent ?? null,
    _source: source,
    toObject: () => JSON.parse(JSON.stringify(source)),
    ...(opts.extra ?? {}),
  };
  const own = `${opts.documentName}.${opts.id}`;
  doc.uuid = opts.uuid ?? (doc.parent ? `${doc.parent.uuid}.${own}` : own);
  return doc;
}

/** Merge dot-keyed or nested changes into a document's source (enough for the fixtures). */
function applyChanges(source: Record<string, any>, changes: Record<string, any>): void {
  for (const [rawKey, value] of Object.entries(changes)) {
    const parts = rawKey.split('.');
    const last = parts.pop()!;
    let node = source;
    for (const part of parts) node = node[part] ??= {};
    if (last.startsWith('-=') || value === g._del) {
      delete node[last.replace(/^-=/, '')];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      node[last] ??= {};
      applyChanges(node[last], value);
    } else {
      node[last] = value;
    }
  }
}

interface SimulateOptions {
  userId?: string;
  options?: Record<string, any>;
  /** The diff the post-hook receives; defaults to `changes`. */
  changed?: Record<string, any>;
  /** Skip the pre-hook (an older module in the making browser). */
  skipPre?: boolean;
}

function simulateUpdate(
  doc: any,
  changes: Record<string, any>,
  sim: SimulateOptions = {}
): Record<string, any> {
  const userId = sim.userId ?? 'gm';
  const options = sim.options ?? {};
  const name = doc.documentName;
  if (!sim.skipPre) Hooks.callAll(`preUpdate${name}`, doc, changes, options, userId);
  applyChanges(doc._source, changes);
  doc._source._stats.modifiedTime = clock += 1;
  Hooks.callAll(`update${name}`, doc, sim.changed ?? changes, options, userId);
  return options;
}

function simulateCreate(doc: any, sim: SimulateOptions = {}): Record<string, any> {
  const userId = sim.userId ?? 'gm';
  const options = sim.options ?? {};
  const name = doc.documentName;
  if (!sim.skipPre) Hooks.callAll(`preCreate${name}`, doc, doc.toObject(), options, userId);
  Hooks.callAll(`create${name}`, doc, options, userId);
  return options;
}

function simulateDelete(doc: any, sim: SimulateOptions = {}): Record<string, any> {
  const userId = sim.userId ?? 'gm';
  const options = sim.options ?? {};
  const name = doc.documentName;
  if (!sim.skipPre) Hooks.callAll(`preDelete${name}`, doc, options, userId);
  Hooks.callAll(`delete${name}`, doc, options, userId);
  return options;
}

function records(): any[] {
  return journal.getChangeJournal({}).records;
}

function makeActor(id = 'act1', name = 'Ireena'): any {
  return fixture({
    documentName: 'Actor',
    id,
    name,
    source: { system: { attributes: { hp: { value: 10, max: 20 } } }, flags: {} },
  });
}

// --- The stash (pre-hooks) -----------------------------------------------------

describe('pre-hooks: the stash', () => {
  it('is written only by the browser that makes the change', () => {
    const actor = makeActor();
    const theirs = simulateUpdate(actor, { name: 'X' }, { userId: 'p1' });
    expect(theirs[MODULE_ID]).toBeUndefined();
    const mine = simulateUpdate(actor, { name: 'Y' }, { userId: 'gm' });
    expect(mine[MODULE_ID].journal.actionId).toEqual(expect.any(String));
    expect(mine[MODULE_ID].journal.before[actor.id]).toEqual([
      { path: 'name', present: true, value: 'X' },
    ]);
  });

  it('leaves the other keys under the module id alone', () => {
    const actor = makeActor();
    const options = simulateUpdate(
      actor,
      { name: 'Y' },
      { options: { [MODULE_ID]: { changeId: 'chg-1', changeMode: 'apply' } } }
    );
    expect(options[MODULE_ID].changeId).toBe('chg-1');
    expect(options[MODULE_ID].changeMode).toBe('apply');
    expect(options[MODULE_ID].journal.actionId).toEqual(expect.any(String));
  });

  it('stashes on a player client too, and a player client records nothing', () => {
    restore();
    setup({ id: 'p1', isGM: false });
    const actor = makeActor();
    const options = simulateUpdate(actor, { name: 'Mine' }, { userId: 'p1' });
    expect(options[MODULE_ID].journal.before[actor.id]).toEqual([
      { path: 'name', present: true, value: 'Ireena' },
    ]);
    simulateCreate(fixture({ documentName: 'Item', id: 'i1', name: 'Rope', parent: actor }), {
      userId: 'p1',
    });
    simulateDelete(actor, { userId: 'p1' });
    expect(journal.getChangeJournal({})).toMatchObject({ records: [], oldestSeq: 0, latestSeq: 0 });
  });

  it('shares an actionId inside the gap and starts a new one after it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2_000_000);
    const actor = makeActor();
    const a = simulateUpdate(actor, { name: 'A' });
    vi.setSystemTime(2_000_000 + CHANGE_JOURNAL_ACTION_GAP_MS - 1);
    const b = simulateUpdate(actor, { name: 'B' });
    // The gap is measured from the previous change, so a steady stream stays one action.
    vi.setSystemTime(2_000_000 + 2 * CHANGE_JOURNAL_ACTION_GAP_MS - 2);
    const c = simulateUpdate(actor, { name: 'C' });
    vi.setSystemTime(2_000_000 + 4 * CHANGE_JOURNAL_ACTION_GAP_MS);
    const d = simulateUpdate(actor, { name: 'D' });
    const ids = [a, b, c, d].map(o => o[MODULE_ID].journal.actionId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(records().map(r => r.actionId)).toEqual(ids);
  });

  it('keeps an actionId already in the stash and one before value per document id', () => {
    const one = makeActor('act1', 'One');
    const two = makeActor('act2', 'Two');
    const options: Record<string, any> = {};
    Hooks.callAll('preUpdateActor', one, { name: 'One2' }, options, 'gm');
    const first = options[MODULE_ID].journal.actionId;
    Hooks.callAll('preUpdateActor', two, { 'system.attributes.hp.value': 1 }, options, 'gm');
    expect(options[MODULE_ID].journal.actionId).toBe(first);
    expect(options[MODULE_ID].journal.before).toEqual({
      act1: [{ path: 'name', present: true, value: 'One' }],
      act2: [{ path: 'system.attributes.hp.value', present: true, value: 10 }],
    });
  });

  it('records one action for a multi-document operation', () => {
    const one = makeActor('act1', 'One');
    const two = makeActor('act2', 'Two');
    const options: Record<string, any> = {};
    for (const [doc, name] of [
      [one, 'One2'],
      [two, 'Two2'],
    ] as const) {
      Hooks.callAll('preUpdateActor', doc, { name }, options, 'gm');
    }
    for (const doc of [one, two]) {
      applyChanges(doc._source, { name: `${doc.name}2` });
      Hooks.callAll('updateActor', doc, { name: `${doc.name}2` }, options, 'gm');
    }
    const [r1, r2] = records();
    expect(r1.actionId).toBe(r2.actionId);
    expect(r1.before).toEqual([{ path: 'name', present: true, value: 'One' }]);
    expect(r2.before).toEqual([{ path: 'name', present: true, value: 'Two' }]);
  });
});

// --- Paths ---------------------------------------------------------------------

describe('changedPaths', () => {
  it('flattens to leaf paths, keeps arrays whole and drops ignored paths', () => {
    expect(
      changedPaths(
        {
          name: 'X',
          system: { attributes: { hp: { value: 3 } }, tags: ['a', 'b'] },
          sort: 5,
          _stats: { modifiedTime: 1 },
          flags: { core: { sheetLock: true }, other: { x: 1 } },
          delta: { name: 'Synthetic' },
          empty: {},
        },
        true
      ).sort()
    ).toEqual(['flags.other.x', 'name', 'system.attributes.hp.value', 'system.tags']);
  });

  it('records the key of a deletion or replacement as a whole', () => {
    g._del = Object.freeze({ forcedDeletion: true });
    expect(
      changedPaths(
        {
          'flags.mod.-=old': null,
          flags: { mod: { gone: g._del, '==cfg': { a: 1 } } },
          '-=top': null,
        },
        true
      ).sort()
    ).toEqual(['flags.mod.cfg', 'flags.mod.gone', 'flags.mod.old', 'top']);
  });

  it('treats a Foundry operator class instance as a leaf', () => {
    class ForcedReplacement {
      constructor(readonly value: unknown) {}
    }
    expect(changedPaths({ system: { map: new ForcedReplacement({ a: 1 }) } }, true)).toEqual([
      'system.map',
    ]);
  });

  it('with recursive false records each top-level key', () => {
    expect(
      changedPaths(
        { ownership: { default: 0, u1: 3 }, 'flags.x.y': 1, '-=old': null, sort: 2 },
        false
      )
    ).toEqual(['ownership', 'flags', 'old']);
  });
});

describe('update records: values', () => {
  it('keeps before from the stash and after from the document, per path', () => {
    const actor = makeActor();
    simulateUpdate(actor, { 'system.attributes.hp.value': 4, 'flags.x.y': 1 });
    const [r] = records();
    expect(r).toMatchObject({
      v: 1,
      op: 'update',
      documentName: 'Actor',
      uuid: 'Actor.act1',
      name: 'Ireena',
      rootUuid: 'Actor.act1',
      rootName: 'Ireena',
      parentUuid: null,
      sceneId: null,
      userId: 'gm',
      userName: 'Gamemaster',
      userIsGM: true,
      seq: 1,
    });
    expect(r.before).toEqual([
      { path: 'system.attributes.hp.value', present: true, value: 10 },
      { path: 'flags.x.y', present: false },
    ]);
    expect(r.after).toEqual([
      { path: 'system.attributes.hp.value', present: true, value: 4 },
      { path: 'flags.x.y', present: true, value: 1 },
    ]);
    expect(r.unknownBefore).toBeUndefined();
    expect(r.modifiedTime).toBe(actor._source._stats.modifiedTime);
    expect(r.key).toBe(`update:Actor.act1:${actor._source._stats.modifiedTime}`);
    expect(r.t).toBe(actor._source._stats.modifiedTime);
  });

  it('does not alias the document: later changes leave an earlier record alone', () => {
    const actor = makeActor();
    actor._source.flags = { mod: { list: [1] } };
    simulateUpdate(actor, { 'flags.mod.list': [1, 2] });
    actor._source.flags.mod.list.push(3);
    expect(records()[0].after).toEqual([{ path: 'flags.mod.list', present: true, value: [1, 2] }]);
    expect(records()[0].before).toEqual([{ path: 'flags.mod.list', present: true, value: [1] }]);
  });

  it('makes no record for an update of ignored paths only', () => {
    const actor = makeActor();
    simulateUpdate(actor, { sort: 5, 'flags.core.sheetLock': true, _stats: { x: 1 } });
    const token = fixture({ documentName: 'Token', id: 'tk1', name: 'Wolf' });
    simulateUpdate(token, { delta: { name: 'Wolf 2' } });
    expect(records()).toEqual([]);
  });

  it('drops ignored paths from a mixed update', () => {
    const actor = makeActor();
    simulateUpdate(actor, { name: 'New', sort: 9 });
    expect(records()[0].before.map((v: any) => v.path)).toEqual(['name']);
    expect(records()[0].after.map((v: any) => v.path)).toEqual(['name']);
  });

  it('records a -= deletion key as the whole key, absent after', () => {
    const actor = makeActor();
    actor._source.flags = { mod: { old: { a: 1 } } };
    simulateUpdate(actor, { 'flags.mod.-=old': null });
    expect(records()[0].before).toEqual([
      { path: 'flags.mod.old', present: true, value: { a: 1 } },
    ]);
    expect(records()[0].after).toEqual([{ path: 'flags.mod.old', present: false }]);
  });

  it('records a v14 ForcedDeletion marker as the whole key', () => {
    g._del = Object.freeze({ forcedDeletion: true });
    const actor = makeActor();
    actor._source.flags = { mod: { old: 7 } };
    simulateUpdate(actor, { flags: { mod: { old: g._del } } });
    expect(records()[0].before).toEqual([{ path: 'flags.mod.old', present: true, value: 7 }]);
    expect(records()[0].after).toEqual([{ path: 'flags.mod.old', present: false }]);
  });

  it('records the whole top-level key of a recursive:false update', () => {
    const actor = makeActor();
    actor._source.ownership = { default: 0, u1: 2, u2: 3 };
    const changes = { ownership: { default: 0, u2: 3 } };
    const options: Record<string, any> = { recursive: false, diff: false };
    Hooks.callAll('preUpdateActor', actor, changes, options, 'gm');
    // A recursive:false update replaces the key (the mock merge would keep u1).
    actor._source.ownership = { default: 0, u2: 3 };
    actor._source._stats.modifiedTime = clock += 1;
    Hooks.callAll('updateActor', actor, changes, options, 'gm');
    const [r] = records();
    expect(r.before).toEqual([
      { path: 'ownership', present: true, value: { default: 0, u1: 2, u2: 3 } },
    ]);
    expect(r.after).toEqual([{ path: 'ownership', present: true, value: { default: 0, u2: 3 } }]);
    expect(r.unknownBefore).toBeUndefined();
  });

  it('without a stash lists the changed paths as unknownBefore and uses a solo actionId', () => {
    const actor = makeActor();
    simulateUpdate(actor, { name: 'Late', 'flags.x.y': 1 }, { skipPre: true });
    const [r] = records();
    expect(r.before).toBeUndefined();
    expect(r.unknownBefore).toEqual(['name', 'flags.x.y']);
    expect(r.after.map((v: any) => v.path)).toEqual(['name', 'flags.x.y']);
    expect(r.actionId).toBe(`solo:${r.key}`);
  });

  it('puts a path the stash missed into unknownBefore (a hook that added changes)', () => {
    const actor = makeActor();
    const changes: Record<string, any> = { name: 'Late' };
    const options: Record<string, any> = {};
    Hooks.callAll('preUpdateActor', actor, changes, options, 'gm');
    // Another module adds a path after our pre-hook ran.
    changes['system.attributes.hp.max'] = 30;
    applyChanges(actor._source, changes);
    actor._source._stats.modifiedTime = clock += 1;
    Hooks.callAll('updateActor', actor, changes, options, 'gm');
    const [r] = records();
    expect(r.before.map((v: any) => v.path)).toEqual(['name']);
    expect(r.unknownBefore).toEqual(['system.attributes.hp.max']);
    expect(r.after.map((v: any) => v.path)).toEqual(['name', 'system.attributes.hp.max']);
  });
});

// --- Create and delete ---------------------------------------------------------

describe('create and delete records', () => {
  it('records nothing for a compendium document', () => {
    const actor = makeActor();
    actor.pack = 'world.monsters';
    simulateUpdate(actor, { name: 'Renamed' });
    simulateDelete(actor);
    expect(records()).toEqual([]);
  });

  it('keeps the full source of a delete and keys it by the last modifiedTime', () => {
    const actor = makeActor();
    actor._source.system.notes = 'secret';
    simulateDelete(actor);
    const [r] = records();
    expect(r.op).toBe('delete');
    expect(r.data).toEqual(actor.toObject());
    expect(r.data.system.notes).toBe('secret');
    expect(r.key).toBe('delete:Actor.act1:600');
    expect(r.t).toBe(600);
    expect(r.before).toBeUndefined();
    expect(r.modifiedTime).toBeUndefined();
  });

  it('keys a create by createdTime and records the modifiedTime', () => {
    const actor = makeActor();
    const item = fixture({
      documentName: 'Item',
      id: 'it1',
      name: 'Rope',
      parent: actor,
      createdTime: 777,
      modifiedTime: 888,
    });
    simulateCreate(item);
    const [r] = records();
    expect(r).toMatchObject({
      op: 'create',
      key: 'create:Actor.act1.Item.it1:777',
      t: 777,
      modifiedTime: 888,
      parentUuid: 'Actor.act1',
      uuid: 'Actor.act1.Item.it1',
    });
    expect(r.data).toBeUndefined();
  });

  it('falls back to the browser clock when the document has no server times', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(3_000_000);
    const actor = makeActor();
    delete actor._source._stats;
    simulateCreate(actor);
    expect(records()[0]).toMatchObject({ key: 'create:Actor.act1:3000000', t: 3_000_000 });
    expect(records()[0].modifiedTime).toBeNull();
  });

  it('copies the guarded-write changeId and mode from the options', () => {
    const actor = makeActor();
    simulateUpdate(
      actor,
      { name: 'Z' },
      {
        options: { [MODULE_ID]: { changeId: 'chg-7', changeMode: 'rollback' } },
      }
    );
    simulateUpdate(
      actor,
      { name: 'Y' },
      {
        options: { [MODULE_ID]: { changeId: 'chg-8', changeMode: 'bogus' } },
      }
    );
    simulateUpdate(actor, { name: 'W' });
    const [a, b, c] = records();
    expect(a).toMatchObject({ changeId: 'chg-7', changeMode: 'rollback' });
    expect(b.changeId).toBe('chg-8');
    expect(b.changeMode).toBeUndefined();
    expect(c.changeId).toBeUndefined();
  });

  it('records a map note by its text and the author of an unknown user as null', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Barovia' });
    const note = fixture({
      documentName: 'Note',
      id: 'n1',
      parent: scene,
      extra: { text: 'Old well' },
    });
    simulateCreate(note, { userId: 'nobody' });
    expect(records()[0]).toMatchObject({
      name: 'Old well',
      userId: 'nobody',
      userName: null,
      userIsGM: false,
      sceneId: 'sc1',
      rootUuid: note.uuid,
    });
  });
});

// --- The root ("thing") and the scene -----------------------------------------

describe('rootUuid', () => {
  it('is the actor for an item on a world actor', () => {
    const actor = makeActor();
    const item = fixture({ documentName: 'Item', id: 'it1', name: 'Rope', parent: actor });
    simulateUpdate(item, { name: 'Rope+1' });
    expect(records()[0]).toMatchObject({
      rootUuid: 'Actor.act1',
      rootName: 'Ireena',
      parentUuid: 'Actor.act1',
    });
  });

  it('is the actor for an effect on an item on an actor', () => {
    const actor = makeActor();
    const item = fixture({ documentName: 'Item', id: 'it1', name: 'Rope', parent: actor });
    const effect = fixture({
      documentName: 'ActiveEffect',
      id: 'ef1',
      name: 'Glow',
      parent: item,
    });
    simulateDelete(effect);
    expect(records()[0]).toMatchObject({
      uuid: 'Actor.act1.Item.it1.ActiveEffect.ef1',
      parentUuid: 'Actor.act1.Item.it1',
      rootUuid: 'Actor.act1',
      rootName: 'Ireena',
    });
  });

  it('is the token for an item on an unlinked token actor, and for the synthetic actor', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Courtyard' });
    const token = fixture({ documentName: 'Token', id: 'tk1', name: 'Wolf', parent: scene });
    const synthetic = fixture({
      documentName: 'Actor',
      id: 'act9',
      name: 'Wolf',
      parent: token,
      uuid: 'Scene.sc1.Token.tk1.Actor.act9',
      source: { system: { attributes: { hp: { value: 11 } } } },
      extra: { isToken: true, token },
    });
    const item = fixture({ documentName: 'Item', id: 'it1', name: 'Bite', parent: synthetic });
    simulateUpdate(item, { name: 'Bite+1' });
    simulateUpdate(synthetic, { 'system.attributes.hp.value': 5 });
    const [a, b] = records();
    expect(a).toMatchObject({
      uuid: 'Scene.sc1.Token.tk1.Actor.act9.Item.it1',
      rootUuid: 'Scene.sc1.Token.tk1',
      rootName: 'Wolf',
      sceneId: 'sc1',
    });
    expect(b).toMatchObject({
      uuid: 'Scene.sc1.Token.tk1.Actor.act9',
      parentUuid: 'Scene.sc1.Token.tk1',
      rootUuid: 'Scene.sc1.Token.tk1',
      sceneId: 'sc1',
    });
    expect(b.before).toEqual([{ path: 'system.attributes.hp.value', present: true, value: 11 }]);
  });

  it('is the combat for a combatant', () => {
    const combat = fixture({ documentName: 'Combat', id: 'cb1', name: 'Ambush' });
    const combatant = fixture({
      documentName: 'Combatant',
      id: 'cm1',
      name: 'Wolf',
      parent: combat,
    });
    simulateUpdate(combatant, { initiative: 14 });
    expect(records()[0]).toMatchObject({ rootUuid: 'Combat.cb1', rootName: 'Ambush' });
  });

  it('is the wall itself for a wall, with the scene id', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Courtyard' });
    const wall = fixture({ documentName: 'Wall', id: 'w1', parent: scene, source: { door: 0 } });
    simulateUpdate(wall, { door: 1 });
    expect(records()[0]).toMatchObject({
      rootUuid: 'Scene.sc1.Wall.w1',
      rootName: null,
      name: null,
      sceneId: 'sc1',
      parentUuid: 'Scene.sc1',
    });
  });

  it('is the journal entry for a page', () => {
    const entry = fixture({ documentName: 'JournalEntry', id: 'je1', name: 'Chapter 1' });
    const page = fixture({
      documentName: 'JournalEntryPage',
      id: 'pg1',
      name: 'Arrival',
      parent: entry,
      source: { text: { content: '<p>Hi</p>' } },
    });
    simulateUpdate(page, { 'text.content': '<p>Hello</p>' });
    expect(records()[0]).toMatchObject({
      rootUuid: 'JournalEntry.je1',
      rootName: 'Chapter 1',
      sceneId: null,
    });
  });

  it('is the scene itself for a scene, with no scene id', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Courtyard' });
    simulateUpdate(scene, { name: 'Courtyard 2' });
    expect(records()[0]).toMatchObject({ rootUuid: 'Scene.sc1', sceneId: null });
  });
});

describe('synthetic actor times', () => {
  it('keys a synthetic actor change by its token delta, not the base actor stats', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Courtyard' });
    const delta = fixture({ documentName: 'ActorDelta', id: 'act9', modifiedTime: 4242 });
    const token = fixture({
      documentName: 'Token',
      id: 'tk1',
      name: 'Wolf',
      parent: scene,
      extra: { delta },
    });
    const synthetic = fixture({
      documentName: 'Actor',
      id: 'act9',
      name: 'Wolf',
      parent: token,
      modifiedTime: 100,
      source: { system: { x: 1 } },
      extra: { isToken: true, token },
    });
    simulateUpdate(synthetic, { 'system.x': 2 });
    expect(records()[0].key).toBe(`update:${synthetic.uuid}:4242`);
  });

  it('prefers the operation time from the options (Foundry 14: a delta has no _stats)', () => {
    const scene = fixture({ documentName: 'Scene', id: 'sc1', name: 'Courtyard' });
    const token = fixture({ documentName: 'Token', id: 'tk1', name: 'Wolf', parent: scene });
    const synthetic = fixture({
      documentName: 'Actor',
      id: 'act9',
      name: 'Wolf',
      parent: token,
      source: { system: { x: 1 } },
      extra: { isToken: true, token },
    });
    simulateUpdate(synthetic, { 'system.x': 2 }, { options: { modifiedTime: 5151 } });
    const r = records()[0];
    expect(r.key).toBe(`update:${synthetic.uuid}:5151`);
    expect(r.t).toBe(5151);
    expect(r.modifiedTime).toBeNull();
  });
});

describe('operation times and no-op updates', () => {
  it('keys an update and a delete by the operation time, a create by createdTime', () => {
    const actor = makeActor();
    simulateUpdate(actor, { 'system.attributes.hp.value': 5 }, { options: { modifiedTime: 7001 } });
    simulateDelete(actor, { options: { modifiedTime: 7002 } });
    const [upd, del] = records();
    expect(upd.key).toBe('update:Actor.act1:7001');
    expect(upd.modifiedTime).toBe(actor._source._stats.modifiedTime);
    expect(del.key).toBe('delete:Actor.act1:7002');
  });

  it('drops a path the server left unchanged, and the record when none is left', () => {
    const actor = makeActor();
    // The server cleaned the value away: the post-hook sees no change of it.
    Hooks.callAll(
      'preUpdateActor',
      actor,
      { system: { attributes: { hp: { value: 10 } } } },
      {},
      'gm'
    );
    Hooks.callAll('updateActor', actor, { _id: 'act1' }, {}, 'gm');
    expect(records()).toHaveLength(0);

    simulateUpdate(actor, { 'system.attributes.hp.value': 10, 'system.attributes.hp.max': 25 });
    const r = records()[0];
    expect(r.before).toEqual([{ path: 'system.attributes.hp.max', present: true, value: 20 }]);
    expect(r.after).toEqual([{ path: 'system.attributes.hp.max', present: true, value: 25 }]);
  });

  it('records an empty name (a Combat) as no name', () => {
    const combat = fixture({ documentName: 'Combat', id: 'cb1', name: '' });
    simulateUpdate(combat, { round: 1 });
    expect(records()[0]).toMatchObject({ name: null, rootName: null });
  });
});

// --- Size, ring, query -----------------------------------------------------------

describe('limits', () => {
  it('drops the values of an oversize record and flags it', () => {
    const entry = fixture({ documentName: 'JournalEntry', id: 'je1', name: 'Big' });
    const page = fixture({
      documentName: 'JournalEntryPage',
      id: 'pg1',
      name: 'Long',
      parent: entry,
      source: { text: { content: 'a' } },
    });
    const big = 'x'.repeat(CHANGE_JOURNAL_MAX_RECORD_BYTES + 10);
    simulateUpdate(page, { 'text.content': big });
    simulateDelete(page);
    for (const r of records()) {
      expect(r.oversize).toBe(true);
      expect(r.before).toBeUndefined();
      expect(r.after).toBeUndefined();
      expect(r.data).toBeUndefined();
      expect(r.unknownBefore).toBeUndefined();
      expect(r.uuid).toBe(page.uuid);
      expect(r.rootUuid).toBe('JournalEntry.je1');
    }
    expect(records()).toHaveLength(2);
  });

  it('keeps only the newest records in the ring', () => {
    const actor = makeActor();
    for (let i = 0; i < CHANGE_JOURNAL_RING + 3; i += 1) {
      Hooks.callAll(
        'createItem',
        fixture({ documentName: 'Item', id: `i${i}`, parent: actor }),
        {},
        'gm'
      );
    }
    const all = journal.getChangeJournal({ limit: CHANGE_JOURNAL_MAX_LIMIT });
    expect(all.latestSeq).toBe(CHANGE_JOURNAL_RING + 3);
    expect(all.oldestSeq).toBe(4);
    const tail = journal.getChangeJournal({ sinceSeq: CHANGE_JOURNAL_RING + 1 });
    expect(tail.records.map(r => r.seq)).toEqual([
      CHANGE_JOURNAL_RING + 2,
      CHANGE_JOURNAL_RING + 3,
    ]);
  });
});

describe('getChangeJournal', () => {
  function fill(count: number): void {
    const actor = makeActor();
    for (let i = 0; i < count; i += 1)
      simulateCreate(fixture({ documentName: 'Item', id: `i${i}`, parent: actor }));
  }

  it('is empty at first and reports the client id', () => {
    const response = journal.getChangeJournal(undefined);
    expect(response).toMatchObject({ success: true, records: [], oldestSeq: 0, latestSeq: 0 });
    expect(response.clientId).toEqual(expect.any(String));
    expect(journal.getChangeJournal({}).clientId).toBe(response.clientId);
  });

  it('returns records after sinceSeq, oldest first, and clamps the limit', () => {
    fill(5);
    expect(journal.getChangeJournal({ sinceSeq: 2 }).records.map(r => r.seq)).toEqual([3, 4, 5]);
    expect(journal.getChangeJournal({ sinceSeq: 2, limit: 2 }).records.map(r => r.seq)).toEqual([
      3, 4,
    ]);
    expect(journal.getChangeJournal({ limit: 0 }).records).toHaveLength(1);
    expect(journal.getChangeJournal({ limit: -5 }).records).toHaveLength(1);
    expect(journal.getChangeJournal({ sinceSeq: -3 }).records).toHaveLength(5);
    expect(journal.getChangeJournal({ sinceSeq: 'x', limit: 'y' }).records).toHaveLength(5);
    expect(journal.getChangeJournal({ sinceSeq: 5 })).toMatchObject({
      records: [],
      oldestSeq: 1,
      latestSeq: 5,
    });
  });

  it('caps one call at the maximum limit', () => {
    fill(CHANGE_JOURNAL_MAX_LIMIT + 5);
    expect(journal.getChangeJournal({ limit: 100_000 }).records).toHaveLength(
      CHANGE_JOURNAL_MAX_LIMIT
    );
  });
});

describe('robustness', () => {
  it('never throws from a hook and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => {
      Hooks.callAll('updateActor', null, null, null, 'gm');
      Hooks.callAll('preUpdateActor', undefined, undefined, undefined, 'gm');
      Hooks.callAll('deleteItem', {}, {}, 'gm');
      Hooks.callAll(
        'preUpdateActor',
        {
          id: 'a',
          get _source(): never {
            throw new Error('boom');
          },
        },
        { name: 'x' },
        {},
        'gm'
      );
      Hooks.callAll(
        'preUpdateActor',
        {
          id: 'a',
          get _source(): never {
            throw new Error('boom');
          },
        },
        { name: 'x' },
        {},
        'gm'
      );
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(records()).toEqual([]);
  });

  it('registers no hooks for a document type this core lacks', () => {
    restore();
    world = createTestWorld();
    restore = world.install();
    for (const name of CHANGE_JOURNAL_DOCUMENTS) if (name !== 'Region') g.CONFIG[name] ??= {};
    journal = new ChangeJournal();
    journal.registerHooks();
    simulateCreate(fixture({ documentName: 'Region', id: 'rg1', name: 'Trap' }));
    simulateCreate(fixture({ documentName: 'Tile', id: 't1' }));
    expect(records().map(r => r.documentName)).toEqual(['Tile']);
  });

  it('registers once however often it is called', () => {
    journal.registerHooks();
    journal.registerHooks();
    simulateCreate(fixture({ documentName: 'Tile', id: 't1' }));
    expect(records()).toHaveLength(1);
  });

  it('records a role change at call time (a user promoted to GM starts recording)', () => {
    restore();
    setup({ id: 'p1', isGM: false });
    simulateCreate(fixture({ documentName: 'Tile', id: 't1' }), { userId: 'p1' });
    expect(records()).toHaveLength(0);
    g.game.user.isGM = true;
    simulateCreate(fixture({ documentName: 'Tile', id: 't2' }), { userId: 'p1' });
    expect(records()).toHaveLength(1);
  });
});
