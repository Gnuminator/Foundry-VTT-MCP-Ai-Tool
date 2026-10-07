/**
 * Tests for the module side of guarded writes (plan step 0.2): snapshots,
 * apply/undo with every precondition, the conflict check, rollback, the rules
 * tag, and the GM-only `gm-change` feed event.
 *
 * The shared Foundry mock resolves no uuids and its `update` knows neither
 * `-=` keys nor the v14 `_del` marker, so this file keeps a small document
 * registry of its own: `fromUuid`, embedded creates, `keepId`, key deletion
 * (both spellings) and `_stats.modifiedTime`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from '../test-support/foundry-mock/index.js';
import { eventTracker, type SessionLogEntry } from '../session-events.js';
import { onAiChangesUpdated } from '../ai-changes-signal.js';
import { registerGuardedFeature, resetGuardedFeaturesForTests } from '../guarded-features.js';
import {
  GUARDED_OUTCOME_MEMORY,
  applyGuardedOps,
  guardedApplyOutcome,
  inverseOf,
  logGmChange,
  resetGuardedOutcomes,
  snapshotGuardedOps,
  type GuardedApplyRequest,
  type GuardedApplyResult,
  type GuardedOp,
  type OpSnapshot,
} from './guarded-write.js';

const MODULE_ID = 'foundry-mcp-bridge';
const FEATURE = 'test-feature';
const RULES_PATH = `flags.${MODULE_ID}.rules`;
const g = globalThis as any;

// ---------------------------------------------------------------------------
// In-test document registry
// ---------------------------------------------------------------------------

const EMBEDDED_KEYS: Record<string, string> = { Item: 'items', ActiveEffect: 'effects' };

let registry: Map<string, FakeDoc>;
let clock: number;
let idSeq: number;

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

class FakeDoc {
  source: Record<string, any>;
  failUpdates = false;
  /** Foundry 14 ignores the deletion of one `ownership.<userId>` key (seen live, F5 L3). */
  ignoreOwnershipKeyDeletion = false;
  /**
   * Every `ownership.<key>` deletion sent to update(), honoured or not. Foundry 14 logs
   * "ownership: is not a mapping of user IDs and document permission levels" for each.
   */
  ownershipKeyDeletions: string[] = [];

  constructor(
    readonly documentName: string,
    data: Record<string, any>,
    readonly parent: FakeDoc | null = null
  ) {
    this.source = clone(data);
    this.source._id ??= `id${String((idSeq += 1)).padStart(14, '0')}`;
    this.source._stats = { ...(this.source._stats ?? {}), modifiedTime: (clock += 1) };
    registry.set(this.uuid, this);
  }

  get id(): string {
    return this.source._id;
  }
  get uuid(): string {
    const own = `${this.documentName}.${this.id}`;
    return this.parent ? `${this.parent.uuid}.${own}` : own;
  }
  get name(): unknown {
    return this.source.name;
  }
  get system(): any {
    return this.source.system;
  }
  get flags(): any {
    return this.source.flags;
  }
  get actor(): FakeDoc | null {
    return this.parent?.documentName === 'Actor' ? this.parent : null;
  }

  toObject(): Record<string, any> {
    return clone(this.source);
  }

  update(changes: Record<string, unknown>): Promise<this> {
    if (this.failUpdates) return Promise.reject(new Error('database refused the update'));
    for (const [path, value] of Object.entries(changes)) {
      const parts = path.split('.');
      const last = parts.pop()!;
      const isDeletion = last.startsWith('-=') || (g._del !== undefined && value === g._del);
      if (parts[0] === 'ownership' && isDeletion) {
        this.ownershipKeyDeletions.push(path);
        if (this.ignoreOwnershipKeyDeletion) continue;
      }
      let node = this.source;
      for (const key of parts) node = node[key] ??= {};
      if (last.startsWith('-=')) delete node[last.slice(2)];
      else if (g._del !== undefined && value === g._del) delete node[last];
      else node[last] = clone(value);
    }
    this.source._stats.modifiedTime = clock += 1;
    return Promise.resolve(this);
  }

  delete(): Promise<this> {
    for (const uuid of [...registry.keys()]) {
      if (uuid === this.uuid || uuid.startsWith(`${this.uuid}.`)) registry.delete(uuid);
    }
    return Promise.resolve(this);
  }

  createEmbeddedDocuments(
    type: string,
    dataArray: Record<string, any>[],
    operation: { keepId?: boolean } = {}
  ): Promise<FakeDoc[]> {
    return Promise.resolve(dataArray.map(data => makeDoc(type, data, this, operation)));
  }
}

function makeDoc(
  documentName: string,
  data: Record<string, any>,
  parent: FakeDoc | null = null,
  operation: { keepId?: boolean } = {}
): FakeDoc {
  const copy = clone(data);
  if (!operation.keepId) delete copy._id;
  // Embedded children live in the parent's registry entries (see `delete`).
  if (parent) {
    const key = EMBEDDED_KEYS[documentName] ?? `${documentName.toLowerCase()}s`;
    (parent.source[key] ??= []).push(copy);
  }
  return new FakeDoc(documentName, copy, parent);
}

interface FakeDocumentConfig {
  documentClass: {
    create: (data: Record<string, any>, operation?: { keepId?: boolean }) => Promise<FakeDoc>;
  };
}

function fakeDocumentClass(documentName: string): FakeDocumentConfig {
  return {
    documentClass: {
      create: (data: Record<string, any>, operation: { keepId?: boolean } = {}): Promise<FakeDoc> =>
        Promise.resolve(makeDoc(documentName, data, null, operation)),
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let world: TestWorld;
let restore: () => void;

function install(foundryVersion = '13.351'): void {
  world = createTestWorld({ foundryVersion });
  restore = world.install();
  registry = new Map();
  clock = 1_000;
  idSeq = 0;
  g.fromUuid = (uuid: string): Promise<FakeDoc | null> =>
    Promise.resolve(registry.get(uuid) ?? null);
  g.CONFIG.Actor = fakeDocumentClass('Actor');
  g.CONFIG.Item = fakeDocumentClass('Item');
  g.CONFIG.JournalEntry = fakeDocumentClass('JournalEntry');
  g.game.settings.register = vi.fn();
  resetGuardedFeaturesForTests();
  registerGuardedFeature({ id: FEATURE, name: 'Test feature', hint: 'Test.' });
  world.setSetting(MODULE_ID, 'allowWriteOperations', true);
  world.setSetting(MODULE_ID, `feature.${FEATURE}.enabled`, true);
  world.setSetting('dnd5e', 'rulesVersion', 'modern');
}

beforeEach(() => {
  install();
  resetGuardedOutcomes();
});

afterEach(() => {
  restore();
  delete g._del;
  resetGuardedFeaturesForTests();
  vi.restoreAllMocks();
});

let changeSeq = 0;

async function request(
  ops: GuardedOp[],
  overrides: Partial<GuardedApplyRequest> = {}
): Promise<GuardedApplyRequest> {
  return {
    changeId: `chg-${(changeSeq += 1)}`,
    feature: FEATURE,
    mode: 'apply',
    summary: 'Test change',
    ops,
    expected: await snapshotGuardedOps(ops),
    ...overrides,
  };
}

/** Undo request as the backend builds it: inverse ops, expected = recorded `after`. */
function undoRequest(applied: GuardedApplyResult): GuardedApplyRequest {
  const results = [...applied.results].reverse();
  return {
    changeId: `undo-${applied.changeId}`,
    feature: FEATURE,
    mode: 'undo',
    summary: 'Undo test change',
    ops: results.map(inverseOf),
    expected: results.map((r): OpSnapshot => {
      if (r.kind === 'update') return { exists: true, values: r.after ?? [] };
      if (r.kind === 'create') return { exists: true, modifiedTime: r.modifiedTime ?? null };
      return { exists: true, idTaken: false };
    }),
  };
}

function gmChangeEvents(changeId: string): SessionLogEntry[] {
  return eventTracker
    .getSessionLog({ eventType: 'gm-change', limit: 1000 })
    .filter(e => e.details.changeId === changeId);
}

function addActor(data: Record<string, any> = {}): FakeDoc {
  return makeDoc('Actor', {
    name: 'Ireena',
    type: 'npc',
    system: { attributes: { hp: { value: 10, max: 10 } }, source: { rules: '2024' } },
    flags: {},
    ...data,
  });
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe('snapshotGuardedOps', () => {
  it('reads present and absent paths of an update target', async () => {
    const actor = addActor();
    const [snap] = await snapshotGuardedOps([
      {
        kind: 'update',
        uuid: actor.uuid,
        changes: { 'system.attributes.hp.value': 4, 'flags.x.y': 1 },
        unset: ['system.attributes.hp.max'],
      },
    ]);
    expect(snap).toEqual({
      exists: true,
      documentName: 'Actor',
      name: 'Ireena',
      values: [
        { path: 'system.attributes.hp.value', present: true, value: 10 },
        { path: 'flags.x.y', present: false },
        { path: 'system.attributes.hp.max', present: true, value: 10 },
      ],
    });
  });

  it('reports a missing document as not existing', async () => {
    const snaps = await snapshotGuardedOps([
      { kind: 'update', uuid: 'Actor.missing', changes: { name: 'X' } },
      { kind: 'delete', uuid: 'Actor.missing' },
    ]);
    expect(snaps).toEqual([{ exists: false }, { exists: false }]);
  });

  it('records modifiedTime for a delete target', async () => {
    const actor = addActor();
    const [snap] = await snapshotGuardedOps([{ kind: 'delete', uuid: actor.uuid }]);
    expect(snap).toEqual({
      exists: true,
      documentName: 'Actor',
      name: 'Ireena',
      modifiedTime: actor.source._stats.modifiedTime,
    });
  });

  it('checks the parent and a kept id for a create', async () => {
    const actor = addActor();
    const item = makeDoc('Item', { _id: 'item000000000001', name: 'Dagger' }, actor, {
      keepId: true,
    });
    const snaps = await snapshotGuardedOps([
      { kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data: { name: 'Rope' } },
      { kind: 'create', documentName: 'Item', parentUuid: 'Actor.gone', data: { name: 'Rope' } },
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: actor.uuid,
        data: { _id: item.id, name: 'Dagger' },
        keepId: true,
      },
      { kind: 'create', documentName: 'JournalEntry', data: { name: 'Notes' } },
    ]);
    expect(snaps.map(s => [s.exists, s.idTaken, s.name])).toEqual([
      [true, false, 'Rope'],
      [false, false, 'Rope'],
      [true, true, 'Dagger'],
      [true, false, 'Notes'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Op validation
// ---------------------------------------------------------------------------

describe('op validation', () => {
  it('rejects an empty or missing op list', async () => {
    await expect(snapshotGuardedOps([])).rejects.toThrow(/at least one op/);
    await expect(snapshotGuardedOps(undefined)).rejects.toThrow(/at least one op/);
  });

  it('rejects too many ops', async () => {
    const ops = Array.from({ length: 201 }, () => ({ kind: 'delete', uuid: 'Actor.x' }));
    await expect(snapshotGuardedOps(ops)).rejects.toThrow(/at most 200/);
  });

  it('rejects an unknown kind', async () => {
    await expect(snapshotGuardedOps([{ kind: 'replace', uuid: 'Actor.x' }])).rejects.toThrow(
      /Unknown op kind/
    );
    await expect(snapshotGuardedOps([null])).rejects.toThrow(/Unknown op kind/);
  });

  it('rejects _id and -= paths in an update', async () => {
    await expect(
      snapshotGuardedOps([{ kind: 'update', uuid: 'Actor.x', changes: { _id: 'y' } }])
    ).rejects.toThrow(/_id or use -= keys/);
    await expect(
      snapshotGuardedOps([{ kind: 'update', uuid: 'Actor.x', changes: { 'flags.-=x': null } }])
    ).rejects.toThrow(/_id or use -= keys/);
    await expect(
      snapshotGuardedOps([{ kind: 'update', uuid: 'Actor.x', changes: {}, unset: ['flags.-=x'] }])
    ).rejects.toThrow(/_id or use -= keys/);
  });

  it('rejects incomplete ops', async () => {
    await expect(snapshotGuardedOps([{ kind: 'update', uuid: 'Actor.x' }])).rejects.toThrow(
      /needs uuid and changes/
    );
    await expect(snapshotGuardedOps([{ kind: 'delete' }])).rejects.toThrow(/needs uuid/);
    await expect(snapshotGuardedOps([{ kind: 'create', data: {} }])).rejects.toThrow(
      /documentName and data/
    );
  });

  it('rejects a malformed apply request', async () => {
    const actor = addActor();
    const ops: GuardedOp[] = [{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }];
    const req = await request(ops);
    await expect(applyGuardedOps({ ...req, changeId: '' })).rejects.toThrow(/changeId/);
    await expect(applyGuardedOps({ ...req, mode: 'redo' })).rejects.toThrow(/apply or undo/);
    await expect(applyGuardedOps({ ...req, feature: 3 })).rejects.toThrow(/feature/);
    await expect(applyGuardedOps({ ...req, expected: [] })).rejects.toThrow(/one expected/);
    await expect(applyGuardedOps(null)).rejects.toThrow(/changeId/);
    expect(actor.name).toBe('Ireena');
  });
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe('applyGuardedOps: apply', () => {
  it('applies an update, records before/after with the rules tag, and logs gm-change', async () => {
    const actor = addActor();
    const req = await request([
      { kind: 'update', uuid: actor.uuid, changes: { 'system.attributes.hp.value': 4 } },
    ]);
    const result = await applyGuardedOps(req);

    expect(actor.system.attributes.hp.value).toBe(4);
    expect(actor.flags[MODULE_ID].rules).toMatchObject({
      version: '2024',
      source: 'system.source.rules',
    });
    const [op] = result.results;
    expect(op).toMatchObject({
      index: 0,
      kind: 'update',
      uuid: actor.uuid,
      documentName: 'Actor',
      name: 'Ireena',
      parentUuid: null,
    });
    expect(op.before).toEqual([
      { path: 'system.attributes.hp.value', present: true, value: 10 },
      { path: RULES_PATH, present: false },
    ]);
    expect(op.after?.[0]).toEqual({ path: 'system.attributes.hp.value', present: true, value: 4 });
    expect(op.after?.[1]).toMatchObject({ path: RULES_PATH, present: true });
    expect(result).toMatchObject({ changeId: req.changeId, mode: 'apply' });
    expect(Number.isNaN(Date.parse(result.appliedAt))).toBe(false);

    const events = gmChangeEvents(req.changeId);
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('Applied: Test change');
    expect(events[0].details).toEqual({
      changeId: req.changeId,
      feature: FEATURE,
      mode: 'apply',
      ops: 1,
      documents: [actor.uuid],
    });
  });

  it('leaves the AI changes window to the backend, which announces once it has recorded the change (I-108)', async () => {
    vi.useFakeTimers();
    try {
      const listener = vi.fn();
      const stop = onAiChangesUpdated(listener);
      const actor = addActor();
      await applyGuardedOps(
        await request([
          { kind: 'update', uuid: actor.uuid, changes: { 'system.attributes.hp.value': 4 } },
        ])
      );
      vi.advanceTimersByTime(5_000);
      expect(listener).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the GM rules choice and keeps an explicit rules tag in the changes', async () => {
    const actor = addActor({ system: { source: {} } });
    await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'A' } }], {
        rulesVersion: '2014',
      })
    );
    expect(actor.flags[MODULE_ID].rules).toMatchObject({ version: '2014', source: 'gm' });

    const explicit = { version: '2024', source: 'gm', at: 'then' };
    await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { [RULES_PATH]: explicit } }])
    );
    expect(actor.flags[MODULE_ID].rules).toEqual(explicit);
  });

  it('does not tag documents other than Actors and Items', async () => {
    const journal = makeDoc('JournalEntry', { name: 'Notes', flags: {} });
    const result = await applyGuardedOps(
      await request([{ kind: 'update', uuid: journal.uuid, changes: { name: 'Secret notes' } }])
    );
    expect(journal.flags[MODULE_ID]).toBeUndefined();
    expect(result.results[0].before).toEqual([{ path: 'name', present: true, value: 'Notes' }]);
  });

  it('unsets keys (v13 -= spelling)', async () => {
    const actor = addActor({ flags: { [MODULE_ID]: { attitude: 'friendly' } } });
    await applyGuardedOps(
      await request([
        { kind: 'update', uuid: actor.uuid, changes: {}, unset: [`flags.${MODULE_ID}.attitude`] },
      ])
    );
    expect(actor.flags[MODULE_ID]).not.toHaveProperty('attitude');
  });

  it('creates embedded and top-level documents with the rules tag', async () => {
    const actor = addActor();
    const result = await applyGuardedOps(
      await request([
        {
          kind: 'create',
          documentName: 'Item',
          parentUuid: actor.uuid,
          data: { name: 'Holy Symbol', system: { source: { rules: '2014' } } },
        },
        { kind: 'create', documentName: 'JournalEntry', data: { name: 'Notes' } },
      ])
    );
    const [item, journal] = result.results;
    expect(item).toMatchObject({ kind: 'create', documentName: 'Item', parentUuid: actor.uuid });
    expect(registry.get(item.uuid)?.flags[MODULE_ID].rules).toMatchObject({
      version: '2014',
      source: 'system.source.rules',
    });
    expect(item.modifiedTime).toBe(registry.get(item.uuid)?.source._stats.modifiedTime);
    expect(journal).toMatchObject({ documentName: 'JournalEntry', parentUuid: null });
    expect(registry.get(journal.uuid)?.flags).toBeUndefined();
  });

  it('deletes a document and keeps its source data for undo', async () => {
    const actor = addActor();
    const result = await applyGuardedOps(await request([{ kind: 'delete', uuid: actor.uuid }]));
    expect(registry.has(actor.uuid)).toBe(false);
    expect(result.results[0]).toMatchObject({ kind: 'delete', uuid: actor.uuid, name: 'Ireena' });
    expect(result.results[0].deleted).toMatchObject({ _id: actor.id, name: 'Ireena' });
  });
});

// ---------------------------------------------------------------------------
// Refusals and conflicts
// ---------------------------------------------------------------------------

describe('applyGuardedOps: refusals', () => {
  async function expectRefused(req: GuardedApplyRequest, message: RegExp): Promise<void> {
    await expect(applyGuardedOps(req)).rejects.toThrow(message);
    expect(gmChangeEvents(req.changeId)).toHaveLength(0);
  }

  it('refuses on a non-GM client', async () => {
    const actor = addActor();
    const req = await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }]);
    g.game.user = { ...g.game.user, isGM: false };
    await expectRefused(req, /GM client only/);
    expect(actor.name).toBe('Ireena');
  });

  it('refuses when write operations are off (apply and undo)', async () => {
    const actor = addActor();
    const req = await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }]);
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    await expectRefused(req, /Write operations are disabled/);
    await expectRefused({ ...req, mode: 'undo' }, /Write operations are disabled/);
    expect(actor.name).toBe('Ireena');
  });

  it('refuses when reading the write setting throws', async () => {
    const actor = addActor();
    const req = await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }]);
    g.game.settings.get = (): never => {
      throw new Error('not registered');
    };
    await expectRefused(req, /Write operations are disabled/);
  });

  it('refuses an unknown feature', async () => {
    const actor = addActor();
    const req = await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }], {
      feature: 'not-installed',
    });
    await expectRefused(req, /Unknown feature "not-installed"/);
    expect(actor.name).toBe('Ireena');
  });

  it('refuses a feature that is switched off, but allows undo', async () => {
    const actor = addActor();
    const applied = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'X' } }])
    );
    world.setSetting(MODULE_ID, `feature.${FEATURE}.enabled`, false);
    const again = await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'Y' } }]);
    await expectRefused(again, /switched off/);
    expect(actor.name).toBe('X');

    await applyGuardedOps(undoRequest(applied));
    expect(actor.name).toBe('Ireena');
  });

  it('writes nothing when any target changed since the plan', async () => {
    const a = addActor({ name: 'A' });
    const b = addActor({ name: 'B' });
    const req = await request([
      { kind: 'update', uuid: a.uuid, changes: { name: 'A2' } },
      { kind: 'update', uuid: b.uuid, changes: { name: 'B2' } },
    ]);
    await b.update({ name: 'B-edited' });
    await expect(applyGuardedOps(req)).rejects.toThrow(
      /Conflict, nothing was written: op 1 \(update\): "name" changed since/
    );
    expect([a.name, b.name]).toEqual(['A', 'B-edited']);
    expect(gmChangeEvents(req.changeId)).toHaveLength(0);
  });

  it('reports conflicts for vanished, reappearing and modified documents', async () => {
    const actor = addActor();
    const gone = addActor({ name: 'Gone' });
    const deleteReq = await request([{ kind: 'delete', uuid: actor.uuid }]);
    const updateReq = await request([{ kind: 'update', uuid: gone.uuid, changes: { name: 'Z' } }]);
    await actor.update({ name: 'Edited' });
    await gone.delete();
    await expect(applyGuardedOps(deleteReq)).rejects.toThrow(/was modified since/);
    await expect(applyGuardedOps(updateReq)).rejects.toThrow(/no longer exists/);

    const missing: GuardedOp[] = [{ kind: 'update', uuid: gone.uuid, changes: { name: 'Z' } }];
    const expectMissing = await request(missing);
    makeDoc('Actor', { ...gone.source }, null, { keepId: true });
    await expect(applyGuardedOps(expectMissing)).rejects.toThrow(/exists again/);
  });

  it('reports create conflicts: parent gone or id taken', async () => {
    const actor = addActor();
    const createReq = await request([
      { kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data: { name: 'Rope' } },
    ]);
    const keepIdReq = await request([
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: actor.uuid,
        data: { _id: 'item000000000009', name: 'Rope' },
        keepId: true,
      },
    ]);
    makeDoc('Item', { _id: 'item000000000009', name: 'Other' }, actor, { keepId: true });
    await expect(applyGuardedOps(keepIdReq)).rejects.toThrow(/id already exists/);
    await actor.delete();
    await expect(applyGuardedOps(createReq)).rejects.toThrow(/parent document no longer exists/);
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

describe('applyGuardedOps: rollback', () => {
  it('rolls back earlier ops when a later op fails', async () => {
    const a = addActor({ name: 'A' });
    const b = addActor({ name: 'B' });
    const victim = addActor({ name: 'Victim' });
    const req = await request([
      { kind: 'update', uuid: a.uuid, changes: { 'system.attributes.hp.value': 1 } },
      { kind: 'create', documentName: 'Item', parentUuid: a.uuid, data: { name: 'Rope' } },
      { kind: 'delete', uuid: victim.uuid },
      { kind: 'update', uuid: b.uuid, changes: { name: 'B2' } },
    ]);
    b.failUpdates = true;

    await expect(applyGuardedOps(req)).rejects.toThrow(
      /Op 3 \(update\) failed: database refused the update; the 3 earlier op\(s\) were rolled back/
    );
    expect(a.system.attributes.hp.value).toBe(10);
    expect(a.flags[MODULE_ID]).not.toHaveProperty('rules');
    expect([...registry.values()].filter(d => d.documentName === 'Item')).toHaveLength(0);
    expect(registry.get(victim.uuid)?.name).toBe('Victim');
    expect(b.name).toBe('B');
    expect(gmChangeEvents(req.changeId)).toHaveLength(0);
  });

  it('reports an incomplete rollback', async () => {
    const a = addActor({ name: 'A' });
    const b = addActor({ name: 'B' });
    const req = await request([
      { kind: 'update', uuid: a.uuid, changes: { name: 'A2' } },
      { kind: 'update', uuid: b.uuid, changes: { name: 'B2' } },
    ]);
    const realUpdate = a.update.bind(a);
    let calls = 0;
    a.update = (changes): Promise<FakeDoc> =>
      ++calls === 1 ? realUpdate(changes) : Promise.reject(new Error('lock'));
    b.failUpdates = true;
    await expect(applyGuardedOps(req)).rejects.toThrow(/rollback incomplete: op 0: lock/);
  });
});

// ---------------------------------------------------------------------------
// Change journal marker (I-109)
// ---------------------------------------------------------------------------

describe('applyGuardedOps: change journal marker', () => {
  const marker = (changeId: string, changeMode: string): Record<string, unknown> => ({
    [MODULE_ID]: { changeId, changeMode },
  });

  it('puts the changeId and mode on every write of an apply', async () => {
    const actor = addActor();
    const victim = addActor({ name: 'Victim' });
    const updateSpy = vi.spyOn(actor, 'update');
    const deleteSpy = vi.spyOn(victim, 'delete');
    const embeddedSpy = vi.spyOn(actor, 'createEmbeddedDocuments');
    const createSpy = vi.spyOn(g.CONFIG.Actor.documentClass, 'create');
    const req = await request([
      { kind: 'update', uuid: actor.uuid, changes: { name: 'Changed' } },
      { kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data: { name: 'Rope' } },
      { kind: 'create', documentName: 'Actor', data: { name: 'Wolf' } },
      { kind: 'delete', uuid: victim.uuid },
    ]);
    await applyGuardedOps(req);
    const expected = marker(req.changeId, 'apply');
    expect(updateSpy.mock.calls[0][1]).toEqual(expected);
    expect(embeddedSpy.mock.calls[0][2]).toEqual(expected);
    expect(createSpy.mock.calls[0][1]).toEqual(expected);
    expect(deleteSpy.mock.calls[0][0]).toEqual(expected);
  });

  it('keeps keepId and marks an undo', async () => {
    const actor = addActor();
    const applied = await applyGuardedOps(await request([{ kind: 'delete', uuid: actor.uuid }]));
    const createSpy = vi.spyOn(g.CONFIG.Actor.documentClass, 'create');
    const undo = undoRequest(applied);
    await applyGuardedOps(undo);
    expect(createSpy.mock.calls[0][1]).toEqual({
      keepId: true,
      ...marker(undo.changeId, 'undo'),
    });
  });

  it('rolls back with the original changeId and mode rollback', async () => {
    const a = addActor({ name: 'A' });
    const b = addActor({ name: 'B' });
    const victim = addActor({ name: 'Victim' });
    const updateSpy = vi.spyOn(a, 'update');
    const createSpy = vi.spyOn(g.CONFIG.Actor.documentClass, 'create');
    const req = await request([
      { kind: 'update', uuid: a.uuid, changes: { name: 'A2' } },
      { kind: 'delete', uuid: victim.uuid },
      { kind: 'update', uuid: b.uuid, changes: { name: 'B2' } },
    ]);
    b.failUpdates = true;
    await expect(applyGuardedOps(req)).rejects.toThrow(/rolled back/);
    expect(updateSpy.mock.calls.map(c => c[1])).toEqual([
      marker(req.changeId, 'apply'),
      marker(req.changeId, 'rollback'),
    ]);
    expect(createSpy.mock.calls[0][1]).toEqual({
      keepId: true,
      ...marker(req.changeId, 'rollback'),
    });
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('applyGuardedOps: undo', () => {
  it('restores values and unsets the rules tag (v13 -= keys)', async () => {
    const actor = addActor({ flags: { [MODULE_ID]: { attitude: 'hostile' } } });
    const applied = await applyGuardedOps(
      await request([
        {
          kind: 'update',
          uuid: actor.uuid,
          changes: { 'system.attributes.hp.value': 3, 'flags.other.note': 'x' },
          unset: [`flags.${MODULE_ID}.attitude`],
        },
      ])
    );
    expect(actor.flags[MODULE_ID].rules).toBeDefined();

    const undo = undoRequest(applied);
    const undone = await applyGuardedOps(undo);
    expect(actor.system.attributes.hp.value).toBe(10);
    expect(actor.flags.other).not.toHaveProperty('note');
    expect(actor.flags[MODULE_ID]).toEqual({ attitude: 'hostile' });
    expect(undone.mode).toBe('undo');
    expect(gmChangeEvents(undo.changeId)[0].description).toBe('Undid: Undo test change');
  });

  it('a second change to the same actor leaves the rules tag alone, so the first undo still works (F5)', async () => {
    const actor = addActor();
    const first = await applyGuardedOps(
      await request([
        { kind: 'update', uuid: actor.uuid, changes: { 'system.attributes.hp.temp': 5 } },
      ])
    );
    const tag = actor.flags[MODULE_ID].rules;
    const second = await applyGuardedOps(
      await request([
        { kind: 'update', uuid: actor.uuid, changes: { 'system.attributes.hp.value': 4 } },
      ])
    );
    expect(actor.flags[MODULE_ID].rules).toEqual(tag);
    expect(second.results[0]?.after?.map(v => v.path)).toEqual(['system.attributes.hp.value']);

    await applyGuardedOps(undoRequest(first));
    expect(actor.system.attributes.hp.temp ?? 0).toBe(0);
    expect(actor.system.attributes.hp.value).toBe(4);
  });

  it('unsets the rules tag with the v14 _del marker', async () => {
    restore();
    install('14.368');
    g._del = Object.freeze({ forcedDeletion: true });
    const actor = addActor();
    const applied = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'Changed' } }])
    );
    expect(actor.flags[MODULE_ID].rules).toBeDefined();
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(undoRequest(applied));
    expect(updateSpy.mock.calls[0][0]).toEqual({ name: 'Ireena', [RULES_PATH]: g._del });
    expect(actor.name).toBe('Ireena');
    expect(actor.flags[MODULE_ID]).not.toHaveProperty('rules');
  });

  it('does not tag on undo', async () => {
    const actor = addActor({ flags: {} });
    const applied = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { [RULES_PATH]: null } }])
    );
    const undo = undoRequest(applied);
    expect(undo.ops[0]).toEqual({
      kind: 'update',
      uuid: actor.uuid,
      changes: {},
      unset: [RULES_PATH],
    });
    await applyGuardedOps(undo);
    expect(actor.flags[MODULE_ID]).toEqual({});
  });

  it('reports a conflict instead of clobbering a later edit', async () => {
    const actor = addActor();
    const applied = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { name: 'Changed' } }])
    );
    await actor.update({ name: 'Edited by hand' });
    await expect(applyGuardedOps(undoRequest(applied))).rejects.toThrow(/"name" changed since/);
    expect(actor.name).toBe('Edited by hand');
  });

  it('round-trips create and delete, restoring the deleted id', async () => {
    const actor = addActor();
    const item = makeDoc('Item', { name: 'Dagger', system: { quantity: 1 } }, actor);
    const applied = await applyGuardedOps(
      await request([
        { kind: 'delete', uuid: item.uuid },
        { kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data: { name: 'Rope' } },
      ])
    );
    const ropeUuid = applied.results[1].uuid;
    expect(registry.has(item.uuid)).toBe(false);
    expect(registry.has(ropeUuid)).toBe(true);

    await applyGuardedOps(undoRequest(applied));
    expect(registry.has(ropeUuid)).toBe(false);
    const restored = registry.get(item.uuid);
    expect(restored?.id).toBe(item.id);
    expect(restored?.source).toMatchObject({ name: 'Dagger', system: { quantity: 1 } });
  });

  it('refuses to delete a created document that was edited since', async () => {
    const applied = await applyGuardedOps(
      await request([{ kind: 'create', documentName: 'JournalEntry', data: { name: 'Notes' } }])
    );
    await registry.get(applied.results[0].uuid)!.update({ name: 'Notes (edited)' });
    await expect(applyGuardedOps(undoRequest(applied))).rejects.toThrow(/modified since/);
  });
});

describe('inverseOf', () => {
  it('turns a top-level delete into a keepId create without parent', () => {
    expect(
      inverseOf({
        index: 0,
        kind: 'delete',
        uuid: 'Actor.a',
        documentName: 'Actor',
        name: 'A',
        parentUuid: null,
        deleted: { _id: 'a', name: 'A' },
      })
    ).toEqual({
      kind: 'create',
      documentName: 'Actor',
      data: { _id: 'a', name: 'A' },
      keepId: true,
    });
  });
});

// ---------------------------------------------------------------------------
// logGmChange
// ---------------------------------------------------------------------------

describe('logGmChange', () => {
  it('logs a vault change to the GM feed', () => {
    expect(
      logGmChange({ changeId: 'vault-1', feature: 'tarokka', summary: 'Dealt the cards' })
    ).toEqual({ logged: true });
    const [event] = gmChangeEvents('vault-1');
    expect(event.description).toBe('Applied: Dealt the cards');
    expect(event.details).toEqual({
      changeId: 'vault-1',
      feature: 'tarokka',
      mode: 'apply',
      vault: true,
    });
    logGmChange({ changeId: 'vault-2', feature: 'tarokka', mode: 'undo' });
    expect(gmChangeEvents('vault-2')[0].description).toBe('Undid:');
    // The backend names undos "Undo: <summary>"; the feed says it once.
    logGmChange({
      changeId: 'vault-3',
      feature: 'tarokka',
      mode: 'undo',
      summary: 'Undo: Update Tarokka links (Ally)',
    });
    expect(gmChangeEvents('vault-3')[0].description).toBe('Undid: Update Tarokka links (Ally)');
  });

  it('does not announce to the AI changes window itself (the backend does, after it records)', () => {
    const listener = vi.fn();
    const stop = onAiChangesUpdated(listener);
    logGmChange({ changeId: 'vault-9', feature: 'tarokka', summary: 'x' });
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('needs changeId and feature', () => {
    expect(() => logGmChange(undefined)).toThrow(/changeId and feature/);
    expect(() => logGmChange({ changeId: 'x' })).toThrow(/changeId and feature/);
  });
});

// ---------------------------------------------------------------------------
// Apply outcomes (PB-04): what the backend asks after a timeout or a dropped link
// ---------------------------------------------------------------------------

describe('guardedApplyOutcome', () => {
  const hpOp = (actor: FakeDoc, value: number): GuardedOp => ({
    kind: 'update',
    uuid: actor.uuid,
    changes: { 'system.attributes.hp.value': value },
  });

  it('is unknown for a changeId this browser never saw', () => {
    expect(guardedApplyOutcome({ changeId: 'never' })).toEqual({
      changeId: 'never',
      status: 'unknown',
    });
  });

  it('needs a changeId', () => {
    expect(() => guardedApplyOutcome({})).toThrow('Outcome request needs a changeId');
    expect(() => guardedApplyOutcome(undefined)).toThrow('Outcome request needs a changeId');
    expect(() => guardedApplyOutcome({ changeId: '' })).toThrow('Outcome request needs a changeId');
  });

  it('is in-progress while the apply runs, then applied with exactly the returned result', async () => {
    const actor = addActor();
    const req = await request([hpOp(actor, 4)]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const realUpdate = actor.update.bind(actor);
    actor.update = async (changes): Promise<FakeDoc> => {
      await gate;
      return realUpdate(changes);
    };

    const running = applyGuardedOps(req);
    await vi.waitFor(() =>
      expect(guardedApplyOutcome({ changeId: req.changeId })).toEqual({
        changeId: req.changeId,
        status: 'in-progress',
      })
    );

    release();
    const result = await running;
    expect(guardedApplyOutcome({ changeId: req.changeId })).toEqual({
      changeId: req.changeId,
      status: 'applied',
      result,
    });
  });

  it('is failed with the error message when an op fails and rolls back', async () => {
    const actor = addActor();
    actor.failUpdates = true;
    const req = await request([hpOp(actor, 4)]);

    const error = await applyGuardedOps(req).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(guardedApplyOutcome({ changeId: req.changeId })).toEqual({
      changeId: req.changeId,
      status: 'failed',
      error: (error as Error).message,
    });
  });

  it('is failed for a conflict too (nothing was written)', async () => {
    const actor = addActor();
    const req = await request([hpOp(actor, 4)]);
    await actor.update({ 'system.attributes.hp.value': 7 });

    await expect(applyGuardedOps(req)).rejects.toThrow(/Conflict/);

    expect(guardedApplyOutcome({ changeId: req.changeId })).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Conflict'),
    });
  });

  it('records nothing for a request that fails validation before it starts', async () => {
    const actor = addActor();
    const req = await request([hpOp(actor, 4)]);
    const { expected: _expected, ...withoutExpected } = req;

    await expect(applyGuardedOps(withoutExpected)).rejects.toThrow(/expected snapshot/);

    expect(guardedApplyOutcome({ changeId: req.changeId }).status).toBe('unknown');
  });

  it('keeps a separate entry for the undo of a change', async () => {
    const actor = addActor();
    const applied = await applyGuardedOps(await request([hpOp(actor, 4)]));
    const undo = undoRequest(applied);

    const undone = await applyGuardedOps(undo);

    expect(guardedApplyOutcome({ changeId: applied.changeId }).status).toBe('applied');
    expect(guardedApplyOutcome({ changeId: undo.changeId })).toEqual({
      changeId: undo.changeId,
      status: 'applied',
      result: undone,
    });
  });

  it('remembers only the last 50 applies and drops the oldest first', async () => {
    const actor = addActor();
    const ids: string[] = [];
    for (let i = 0; i < GUARDED_OUTCOME_MEMORY + 1; i++) {
      const req = await request([hpOp(actor, i + 1)]);
      ids.push(req.changeId);
      await applyGuardedOps(req);
    }

    expect(GUARDED_OUTCOME_MEMORY).toBe(50);
    expect(guardedApplyOutcome({ changeId: ids[0] }).status).toBe('unknown');
    expect(guardedApplyOutcome({ changeId: ids[1] }).status).toBe('applied');
    expect(guardedApplyOutcome({ changeId: ids[ids.length - 1] }).status).toBe('applied');
  });
});

// ---------------------------------------------------------------------------
// Ownership keys (F5 L3): Foundry 14 rejects deleting one `ownership.<userId>` key
// ---------------------------------------------------------------------------

describe('ownership key removal (F5 L3)', () => {
  function ownershipActor(ownership: Record<string, number>, ignoresDeletion = true): FakeDoc {
    const actor = addActor({ ownership });
    actor.ignoreOwnershipKeyDeletion = ignoresDeletion;
    return actor;
  }

  it('replaces the ownership map without the key, in one update', async () => {
    const actor = ownershipActor({ default: 0, u1: 2, u2: 3 });
    const updateSpy = vi.spyOn(actor, 'update');
    const result = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: {}, unset: ['ownership.u1'] }], {
        mode: 'undo',
      })
    );
    expect(actor.source.ownership).toEqual({ default: 0, u2: 3 });
    expect(updateSpy.mock.calls).toEqual([
      [
        { ownership: { default: 0, u2: 3 } },
        {
          diff: false,
          recursive: false,
          [MODULE_ID]: { changeId: expect.any(String), changeMode: 'undo' },
        },
      ],
    ]);
    // The recorded after value reads the final state: the entry is gone.
    expect(result.results[0].after).toContainEqual({ path: 'ownership.u1', present: false });
  });

  it('never sends a per-key ownership deletion (Foundry 14 logs a validation error)', async () => {
    // Seen live in live:sweep: "ownership: is not a mapping of user IDs and document
    // permission levels" for both the `-=` key and the v14 `_del` marker.
    for (const marker of [undefined, Object.freeze({ forcedDeletion: true })]) {
      restore();
      install(marker ? '14.368' : '13.351');
      g._del = marker;
      const actor = ownershipActor({ default: 0, u1: 2, u2: 3 });
      await applyGuardedOps(
        await request([
          {
            kind: 'update',
            uuid: actor.uuid,
            changes: { 'ownership.u2': 1 },
            unset: ['ownership.u1'],
          },
        ])
      );
      expect(actor.ownershipKeyDeletions).toEqual([]);
      expect(actor.source.ownership).toEqual({ default: 0, u2: 1 });
    }
  });

  it('applies the other changes first, then replaces the map', async () => {
    const actor = ownershipActor({ default: 0, u1: 2 });
    actor.source.flags = { x: { y: 1 } };
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request([
        {
          kind: 'update',
          uuid: actor.uuid,
          changes: { 'ownership.u2': 3 },
          unset: ['ownership.u1', 'flags.x.y'],
        },
      ])
    );
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(Object.keys(updateSpy.mock.calls[0][0])).not.toContain('ownership.-=u1');
    expect(updateSpy.mock.calls[1]).toEqual([
      { ownership: { default: 0, u2: 3 } },
      {
        diff: false,
        recursive: false,
        [MODULE_ID]: { changeId: expect.any(String), changeMode: 'apply' },
      },
    ]);
    expect(actor.source.flags.x).not.toHaveProperty('y');
  });

  it('removes several ownership keys in the one update', async () => {
    const actor = ownershipActor({ default: 0, u1: 2, u2: 3, u3: 1 });
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request(
        [
          {
            kind: 'update',
            uuid: actor.uuid,
            changes: {},
            unset: ['ownership.u1', 'ownership.u3'],
          },
        ],
        { mode: 'undo' }
      )
    );
    expect(actor.source.ownership).toEqual({ default: 0, u2: 3 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('undoes "give a player a level" so the entry is gone again (round trip)', async () => {
    const actor = ownershipActor({ default: 0 });
    const applied = await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { 'ownership.u1': 2 } }])
    );
    expect(actor.source.ownership).toEqual({ default: 0, u1: 2 });
    const undo = undoRequest(applied);
    expect(undo.ops[0]).toMatchObject({
      changes: {},
      unset: expect.arrayContaining(['ownership.u1']),
    });
    await applyGuardedOps(undo);
    expect(actor.source.ownership).toEqual({ default: 0 });
    expect(actor.ownershipKeyDeletions).toEqual([]);
  });

  it('makes no update when the key is not there', async () => {
    const actor = ownershipActor({ default: 0 });
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: {}, unset: ['ownership.u1'] }], {
        mode: 'undo',
      })
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(actor.source.ownership).toEqual({ default: 0 });
  });

  it('makes no extra update when no ownership key is unset', async () => {
    const actor = ownershipActor({ default: 0, u1: 2 });
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: { 'ownership.u1': 3 } }])
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(actor.source.ownership).toEqual({ default: 0, u1: 3 });
  });

  it('never triggers for other unset paths', async () => {
    const actor = ownershipActor({ default: 0, u1: 2 });
    actor.source.flags = { x: { y: 1 } };
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request([{ kind: 'update', uuid: actor.uuid, changes: {}, unset: ['flags.x.y'] }])
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(actor.source.flags.x).not.toHaveProperty('y');
    expect(actor.source.ownership).toEqual({ default: 0, u1: 2 });
  });

  it('only matches a single-key ownership path, not look-alike paths', async () => {
    const actor = ownershipActor({ default: 0, u1: 2 });
    actor.source.flags = { ownershipNote: { u1: 1 } };
    const updateSpy = vi.spyOn(actor, 'update');
    await applyGuardedOps(
      await request([
        { kind: 'update', uuid: actor.uuid, changes: {}, unset: ['flags.ownershipNote.u1'] },
      ])
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(actor.source.ownership).toEqual({ default: 0, u1: 2 });
  });
});
