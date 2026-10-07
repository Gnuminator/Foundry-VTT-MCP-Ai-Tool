import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ChangeRecord, GuardedOp, GuardedOpResult, PathValue } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildActions, type ChangeAction } from '../change-history.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog, type AuditEntry } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';

import { GuardedWriteService, type PlanInput, type PlanView } from './service.js';
import { UndoPlanner, type UndoPlanView } from './undo-planner.js';

// The scopes beyond one change: everything since, world since, folding, ordering, `undoes`.

const T0 = Date.parse('2026-10-07T10:00:00Z');
const MIN = 60_000;

const num = (path: string, value: number): PathValue => ({ path, present: true, value });
const gone = (path: string): PathValue => ({ path, present: false });
const HP = 'system.attributes.hp.value';

let counter = 0;

function rec(min: number, overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  counter += 1;
  return {
    v: 1,
    key: `k${counter}`,
    seq: counter,
    t: T0 + min * MIN,
    actionId: `a${counter}`,
    op: 'update',
    userId: 'u1',
    userName: 'Ireena',
    userIsGM: false,
    documentName: 'Actor',
    uuid: 'Actor.a',
    parentUuid: null,
    name: 'Ireena',
    rootUuid: 'Actor.a',
    rootName: 'Ireena',
    sceneId: null,
    ...overrides,
  };
}

function hp(min: number, before: number, after: number, actionId: string): ChangeRecord {
  return rec(min, { actionId, before: [num(HP, before)], after: [num(HP, after)] });
}

function entry(changeId: string, min: number, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    changeId,
    planId: `plan-${changeId}`,
    feature: 'live-play',
    summary: `AI ${changeId}`,
    risk: 'write',
    target: 'foundry',
    mode: 'apply',
    appliedAt: new Date(T0 + min * MIN).toISOString(),
    diff: [],
    results: [],
    ...extra,
  };
}

function actorUpdate(before: PathValue[], after: PathValue[]): GuardedOpResult {
  return {
    index: 0,
    kind: 'update',
    uuid: 'Actor.a',
    documentName: 'Actor',
    name: 'Ireena',
    parentUuid: null,
    before,
    after,
  };
}

function itemResult(
  kind: GuardedOpResult['kind'],
  uuid: string,
  name: string,
  extra: Partial<GuardedOpResult> = {}
): GuardedOpResult {
  return { index: 0, kind, uuid, documentName: 'Item', name, parentUuid: 'Actor.a', ...extra };
}

/** A person's record of an embedded Item of Actor.a. */
function itemRecord(min: number, actionId: string, overrides: Partial<ChangeRecord>): ChangeRecord {
  return rec(min, {
    actionId,
    uuid: 'Actor.a.Item.n',
    documentName: 'Item',
    name: 'Rope',
    parentUuid: 'Actor.a',
    ...overrides,
  });
}

let ring: AuditEntry[];
let records: ChangeRecord[];
let foundry: FakeFoundry;
let createPlan: ReturnType<typeof vi.fn>;
let planner: UndoPlanner;

function planInput(): PlanInput {
  return createPlan.mock.calls.at(-1)?.[0] as PlanInput;
}

function opsOf(): GuardedOp[] {
  return planInput().ops as GuardedOp[];
}

function plan(
  id: string,
  scope: 'just-this' | 'everything-since' | 'world-since',
  rewindTable?: boolean
): Promise<UndoPlanView> {
  return planner.plan({ id, scope, ...(rewindTable ? { rewindTable } : {}) });
}

beforeEach((): void => {
  counter = 0;
  ring = [];
  records = [];
  foundry = new FakeFoundry();
  foundry.add('Actor.a', 'Actor', {
    name: 'Ireena',
    system: { attributes: { hp: { value: 5, max: 12 } } },
  });
  createPlan = vi.fn(
    (input: PlanInput): Promise<PlanView> =>
      Promise.resolve({
        planId: 'plan-1',
        feature: input.feature,
        summary: input.summary,
        target: 'foundry',
        risk: input.risk ?? 'write',
        worldId: 'w1',
        createdAt: '',
        expiresAt: '',
        diff: [],
        requires: { confirm: true, confirmDestructive: input.risk === 'destructive' },
      })
  );
  planner = new UndoPlanner({
    changeHistory: {
      humanActions: (): Promise<ChangeAction[]> => Promise.resolve(buildActions(records)),
    },
    guardedWrites: { createPlan } as never,
    audit: {
      ring: (): Promise<AuditEntry[]> => Promise.resolve(ring),
      resultsWithDeleted: (_world: string, e: AuditEntry): Promise<GuardedOpResult[]> =>
        Promise.resolve(e.results ?? []),
    },
    worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
    foundryClient: foundry as never,
  });
});

describe('everything-since', () => {
  it('takes in later changes to the same thing, AI results included, and folds to the oldest before', async () => {
    foundry.add('Actor.a.Item.i', 'Item', { name: 'Dagger', system: { quantity: 3 } });
    foundry.add('Actor.b', 'Actor', { name: 'Wolf', system: { attributes: { hp: { value: 1 } } } });
    foundry.edit('Actor.a', num(HP, 6));
    records.push(
      hp(1, 10, 8, 'first'),
      rec(2, { actionId: 'second', userName: 'Danni', before: [num(HP, 8)], after: [num(HP, 6)] }),
      rec(4, {
        actionId: 'wolf',
        uuid: 'Actor.b',
        rootUuid: 'Actor.b',
        name: 'Wolf',
        rootName: 'Wolf',
        before: [num(HP, 3)],
        after: [num(HP, 1)],
      })
    );
    ring.push(
      entry('chg-item', 3, {
        results: [
          itemResult('update', 'Actor.a.Item.i', 'Dagger', {
            before: [num('system.quantity', 4)],
            after: [num('system.quantity', 3)],
          }),
        ],
      })
    );
    const view = await plan('act:first', 'everything-since');
    expect(view.later).toEqual([]);
    expect(view.count).toBe(3);
    expect(opsOf()).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
      { kind: 'update', uuid: 'Actor.a.Item.i', changes: { 'system.quantity': 4 }, unset: [] },
    ]);
    expect(planInput().undoes).toEqual({ actions: ['first', 'second'], changes: ['chg-item'] });
    expect(planInput().summary).toMatch(/^Undo since \d\d:\d\d: 3 changes on Ireena$/);
  });

  it('turns a create plus a later update into one delete', async () => {
    foundry.add('Actor.a.Item.n', 'Item', { name: 'Rope', system: { quantity: 2 } });
    ring.push(
      entry('chg-c', 1, {
        results: [itemResult('create', 'Actor.a.Item.n', 'Rope', { modifiedTime: 5 })],
      })
    );
    records.push(
      itemRecord(2, 'q', {
        before: [num('system.quantity', 1)],
        after: [num('system.quantity', 2)],
      })
    );
    await plan('chg-c', 'everything-since');
    expect(opsOf()).toEqual([{ kind: 'delete', uuid: 'Actor.a.Item.n' }]);
  });

  it('plans nothing for a document created and deleted inside the set', async () => {
    ring.push(entry('chg-c', 1, { results: [itemResult('create', 'Actor.a.Item.n', 'Rope')] }));
    records.push(
      itemRecord(2, 'd', { op: 'delete', data: { _id: 'n', name: 'Rope' } }),
      hp(3, 10, 8, 'hp')
    );
    await plan('chg-c', 'everything-since');
    expect(opsOf()).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
    ]);
  });

  it('turns an update then a delete into a create with the older before folded in', async () => {
    foundry.docs.delete('Actor.a');
    records.push(
      hp(1, 10, 8, 'u'),
      rec(2, {
        actionId: 'd',
        op: 'delete',
        data: { _id: 'a', name: 'Ireena', system: { attributes: { hp: { value: 8, max: 12 } } } },
      })
    );
    await plan('act:u', 'everything-since');
    expect(opsOf()).toEqual([
      {
        kind: 'create',
        documentName: 'Actor',
        data: { _id: 'a', name: 'Ireena', system: { attributes: { hp: { value: 10, max: 12 } } } },
        keepId: true,
      },
    ]);
  });

  it('orders the ops: deletes, then updates, then creates', async () => {
    foundry.add('Actor.a.Item.n', 'Item', { name: 'Rope' });
    ring.push(entry('chg-c', 1, { results: [itemResult('create', 'Actor.a.Item.n', 'Rope')] }));
    records.push(
      itemRecord(2, 'd', {
        op: 'delete',
        uuid: 'Actor.a.Item.old',
        name: 'Dagger',
        data: { _id: 'old', name: 'Dagger' },
      }),
      hp(3, 10, 8, 'hp')
    );
    await plan('chg-c', 'everything-since');
    expect(opsOf().map(op => op.kind)).toEqual(['delete', 'update', 'create']);
    expect(opsOf()[2]).toMatchObject({ documentName: 'Item', parentUuid: 'Actor.a', keepId: true });
  });

  it('drops the changes inside a document that goes away with its parent', async () => {
    foundry.add('Actor.a.Item.n', 'Item', { name: 'Rope', system: { quantity: 2 } });
    ring.push(
      entry('chg-c', 1, {
        results: [{ ...itemResult('create', 'Actor.a', 'Ireena'), documentName: 'Actor' }],
      })
    );
    records.push(
      itemRecord(2, 'q', {
        before: [num('system.quantity', 1)],
        after: [num('system.quantity', 2)],
      })
    );
    await plan('chg-c', 'everything-since');
    expect(opsOf()).toEqual([{ kind: 'delete', uuid: 'Actor.a' }]);
  });

  it('leaves out a later AI change that also wrote to the vault, and says so', async () => {
    records.push(hp(1, 10, 8, 'first'));
    ring.push(
      entry('chg-v', 2, {
        summary: 'Reveal the page',
        results: [actorUpdate([num(HP, 8)], [num(HP, 5)])],
        vaultOps: [{ file: 'f.json', path: 'p', before: gone('p'), after: num('p', 1) }],
      })
    );
    await plan('act:first', 'everything-since');
    expect(planInput().undoes).toEqual({ actions: ['first'] });
    expect(planInput().notes).toEqual([
      'Not undone: "Reveal the page" also wrote to the AI Tool\'s own data (undo it with undo-change)',
    ]);
  });
});

describe('world-since', () => {
  it('includes later changes to other things', async () => {
    foundry.add('Actor.b', 'Actor', { name: 'Wolf', system: { attributes: { hp: { value: 1 } } } });
    records.push(
      hp(1, 10, 8, 'first'),
      rec(2, {
        actionId: 'wolf',
        uuid: 'Actor.b',
        rootUuid: 'Actor.b',
        name: 'Wolf',
        rootName: 'Wolf',
        before: [num(HP, 3)],
        after: [num(HP, 1)],
      })
    );
    await plan('act:first', 'world-since', true);
    expect(opsOf().map(op => (op as { uuid: string }).uuid)).toEqual(['Actor.a', 'Actor.b']);
    expect(planInput().undoes).toEqual({ actions: ['first', 'wolf'] });
  });
});

describe('undone changes inside a since-set (live check 2026-10-07)', () => {
  it('lets an undone change and its undo cancel out, also for a delete and its restore', async () => {
    foundry.add('Actor.b', 'Actor', { name: 'Wolf', system: { attributes: { hp: { value: 1 } } } });
    foundry.add('Actor.a.Item.n', 'Item', { name: 'Rope', system: { quantity: 1 } });
    foundry.edit('Actor.a', num(HP, 10));
    records.push(
      rec(1, {
        actionId: 'wolf',
        uuid: 'Actor.b',
        rootUuid: 'Actor.b',
        name: 'Wolf',
        rootName: 'Wolf',
        before: [num(HP, 3)],
        after: [num(HP, 1)],
      }),
      hp(2, 10, 5, 'hit'),
      itemRecord(3, 'drop', { op: 'delete', data: { _id: 'n', name: 'Rope' } })
    );
    ring.push(
      entry('U1', 4, {
        feature: 'change-undo',
        undoes: { actions: ['hit'] },
        results: [actorUpdate([num(HP, 5)], [num(HP, 10)])],
      }),
      entry('U2', 5, {
        feature: 'change-undo',
        undoes: { actions: ['drop'] },
        results: [itemResult('create', 'Actor.a.Item.n', 'Rope')],
      })
    );
    const view = await plan('act:wolf', 'world-since', true);
    // Ireena is back at 10 and the rope is back: only the wolf's own change is left to undo.
    expect(opsOf()).toEqual([{ kind: 'update', uuid: 'Actor.b', changes: { [HP]: 3 }, unset: [] }]);
    // The undone changes and their undos cancel out: the count is what the GM sees as live.
    expect(view.count).toBe(3);
    expect(planInput().undoes).toEqual({ actions: ['wolf', 'hit', 'drop'], changes: ['U1', 'U2'] });
  });

  it('names the person behind a window undo among the later changes', async () => {
    records.push(hp(1, 12, 10, 'first'));
    ring.push(
      entry('U1', 2, {
        feature: 'change-undo',
        requestedBy: 'Danni',
        undoes: { actions: [] },
        results: [actorUpdate([num(HP, 10)], [num(HP, 9)])],
      })
    );
    foundry.edit('Actor.a', num(HP, 9));
    const view = await plan('act:first', 'just-this');
    expect(view.later.map(l => l.by)).toEqual(['Danni']);
  });

  it('leaves the module rules stamp out of an AI change', async () => {
    const stamp = 'flags.foundry-mcp-bridge.rules';
    ring.push(
      entry('chg', 1, {
        results: [
          actorUpdate(
            [num(HP, 10), gone(stamp)],
            [num(HP, 5), { path: stamp, present: true, value: { version: '2024' } }]
          ),
        ],
      })
    );
    await plan('chg', 'just-this');
    expect(opsOf()).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
    ]);
  });
});

describe('guards on one change', () => {
  it('refuses to restore a document whose id exists again', async () => {
    records.push(rec(1, { actionId: 'd', op: 'delete', data: { _id: 'a', name: 'Ireena' } }));
    await expect(plan('act:d', 'just-this')).rejects.toThrow(/id exists again/);
  });

  it('says later changes to a created document go with it, unless nothing changed it', async () => {
    foundry.add('Actor.a.Item.n', 'Item', { name: 'Rope' });
    ring.push(
      entry('chg-c', 1, {
        results: [itemResult('create', 'Actor.a.Item.n', 'Rope', { modifiedTime: 5 })],
      })
    );
    await plan('chg-c', 'just-this');
    expect(opsOf()).toEqual([{ kind: 'delete', uuid: 'Actor.a.Item.n' }]);
    expect(planInput().notes).toEqual(['Rope: later changes to it go with it']);

    foundry.docs.get('Actor.a.Item.n')!.source._stats.modifiedTime = 5;
    await plan('chg-c', 'just-this');
    expect(planInput().notes).toEqual([]);
  });

  it('skips a document that no longer exists', async () => {
    foundry.docs.delete('Actor.a');
    records.push(hp(1, 10, 5, 'x'));
    await expect(plan('act:x', 'just-this')).rejects.toThrow(/Ireena no longer exists/);
  });
});

describe('what a new undo says it undid', () => {
  function threeEntries(): void {
    ring.push(
      entry('T', 1, { results: [actorUpdate([num(HP, 12)], [num(HP, 10)])] }),
      entry('A', 2, { results: [actorUpdate([num(HP, 10)], [num(HP, 5)])] }),
      entry('E1', 3, {
        feature: 'change-undo',
        undoes: { changes: ['A'] },
        results: [actorUpdate([num(HP, 5)], [num(HP, 10)])],
      })
    );
    foundry.edit('Actor.a', num(HP, 10));
  }

  it('adds what an undone undo had undone when the rewind goes past it', async () => {
    threeEntries();
    await plan('T', 'world-since', true);
    expect(opsOf()[0]).toMatchObject({ changes: { [HP]: 12 } });
    expect(planInput().undoes).toEqual({ changes: ['T', 'A', 'E1'] });
    // A is undone (by E1): it cannot be planned on its own.
    await expect(plan('A', 'just-this')).rejects.toThrow(/already undone \(E1\)/);
  });

  it('names only the undo itself when redoing it', async () => {
    threeEntries();
    await plan('E1', 'just-this');
    expect(opsOf()[0]).toMatchObject({ changes: { [HP]: 5 } });
    expect(planInput().undoes).toEqual({ changes: ['E1'] });
  });
});

describe('plan, apply, redo with the real service', () => {
  let dataDir: string;

  beforeEach(async (): Promise<void> => {
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'undo-planner-'));
  });

  afterEach(async (): Promise<void> => {
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('records what the undo undid, lets the undo be undone, and then plans again', async () => {
    const store = new VaultStore({ dataDir });
    const audit = new AuditLog(store);
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    foundry.features.push({
      id: 'change-undo',
      name: 'Undo',
      hint: '',
      enabled: true,
      writesAllowed: true,
    });
    const worldIds = { current: (): Promise<string> => Promise.resolve('curse-of-strahd') };
    const service = new GuardedWriteService({
      foundryClient: foundry as never,
      worldIds,
      store,
      audit,
      logger,
    });
    const real = new UndoPlanner({
      changeHistory: {
        humanActions: (): Promise<ChangeAction[]> => Promise.resolve(buildActions(records)),
      },
      guardedWrites: service,
      audit,
      worldIds,
      foundryClient: foundry as never,
    });
    records.push(hp(1, 10, 5, 'x'));

    const view = await real.plan({ id: 'act:x' });
    expect(view.diff.map(d => d.text)).toEqual(['Actor "Ireena": HP 5 → 10']);
    const applied = await service.applyPlan(view.planId, { confirm: true });
    expect(foundry.docs.get('Actor.a')!.source.system.attributes.hp.value).toBe(10);
    const stored = await audit.get('curse-of-strahd', applied.changeId);
    expect(stored).toMatchObject({ feature: 'change-undo', undoes: { actions: ['x'] } });
    expect((await service.undoState()).get('act:x')?.undoneBy).toBe(applied.changeId);
    await expect(real.plan({ id: 'act:x' })).rejects.toThrow(/already undone/);

    // Undoing the undo is the redo: the person's change is live again.
    const redo = await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.a')!.source.system.attributes.hp.value).toBe(5);
    expect((await service.undoState()).has('act:x')).toBe(false);
    expect((await service.undoState()).get(applied.changeId)?.undoneBy).toBe(redo.changeId);
    await expect(real.plan({ id: 'act:x' })).resolves.toMatchObject({ scope: 'just-this' });
  });
});
