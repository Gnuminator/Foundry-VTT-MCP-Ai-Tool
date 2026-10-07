import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ChangeRecord, PathValue } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeJournalFileName } from './change-journal-pump.js';
import {
  CHANGE_HISTORY_DAYS,
  ChangeHistory,
  MAX_ACTION_LINES,
  buildActions,
  describeRecord,
  undoBlocker,
} from './change-history.js';
import { localDateKey } from './event-pump.js';
import type { RecentChange } from './guarded-write/service.js';
import type { UndoState } from './guarded-write/undo-state.js';
import { VaultStore } from './vault/store.js';

const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const val = (p: string, value: unknown): PathValue => ({ path: p, present: true, value });

let counter = 0;
function rec(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  counter += 1;
  return {
    v: 1,
    key: `update:Actor.a1:${counter}`,
    seq: counter,
    t: NOW - 10 * MIN,
    actionId: `act-${counter}`,
    op: 'update',
    userId: 'u1',
    userName: 'Ireena',
    userIsGM: false,
    documentName: 'Actor',
    uuid: 'Actor.a1',
    parentUuid: null,
    name: 'Ireena',
    rootUuid: 'Actor.a1',
    rootName: 'Ireena',
    sceneId: null,
    ...overrides,
  };
}

function hpChange(
  before: number,
  after: number,
  overrides: Partial<ChangeRecord> = {}
): ChangeRecord {
  return rec({
    before: [val('system.attributes.hp.value', before)],
    after: [val('system.attributes.hp.value', after)],
    ...overrides,
  });
}

function aiChange(overrides: Partial<RecentChange> = {}): RecentChange {
  return {
    changeId: 'chg-1',
    planId: 'plan-1',
    feature: 'actor-change',
    summary: 'Damage Wolf 2',
    target: 'foundry',
    mode: 'apply',
    risk: 'write',
    appliedAt: new Date(NOW - 5 * MIN).toISOString(),
    diff: ['Actor "Wolf 2": HP 11 → 5'],
    documents: ['Actor.wolf2'],
    canUndo: true,
    ...overrides,
  };
}

describe('describeRecord', () => {
  it('reads an HP change with its label', () => {
    expect(describeRecord(hpChange(10, 5))).toEqual(['Ireena: HP 10 -> 5']);
  });

  it('names a nameless root (a Combat) by its kind', () => {
    const combatant = {
      documentName: 'Combatant',
      uuid: 'Combat.cb1.Combatant.cm1',
      parentUuid: 'Combat.cb1',
      name: 'Wolf 1',
      rootUuid: 'Combat.cb1',
      before: [val('initiative', null)],
      after: [val('initiative', 12)],
    };
    expect(describeRecord(rec({ ...combatant, rootName: null }))).toEqual([
      'Combat: Combatant "Wolf 1" initiative null -> 12',
    ]);
    // Records made before the module sent null for an empty name.
    expect(describeRecord(rec({ ...combatant, rootName: '' }))[0]).toMatch(/^Combat: /);
  });

  it('skips a field that only went from empty to empty (temp HP null -> 0)', () => {
    const r = rec({
      before: [val('system.attributes.hp.temp', null), val('system.attributes.hp.value', 11)],
      after: [val('system.attributes.hp.temp', 0), val('system.attributes.hp.value', 6)],
    });
    expect(describeRecord(r)).toEqual(['Ireena: HP 11 -> 6']);
    const only = rec({
      before: [val('system.attributes.hp.temp', null)],
      after: [val('system.attributes.hp.temp', 0)],
    });
    expect(describeRecord(only)).toEqual(['Ireena changed']);
  });

  it('names a plain path when it has no label, and says "now" without a before value', () => {
    expect(
      describeRecord(
        rec({ before: [val('flags.x.y', 1)], after: [val('flags.x.y', 2), val('flags.x.z', 3)] })
      )
    ).toEqual(['Ireena: flags.x.y 1 -> 2', 'Ireena: flags.x.z now 3']);
  });

  it('labels item quantity and uses on the owning actor', () => {
    const lines = describeRecord(
      rec({
        documentName: 'Item',
        uuid: 'Actor.a1.Item.i1',
        parentUuid: 'Actor.a1',
        name: 'Dagger',
        before: [val('system.quantity', 3), val('system.uses.spent', 0)],
        after: [val('system.quantity', 2), val('system.uses.spent', 1)],
      })
    );
    expect(lines).toEqual([
      'Ireena: Item "Dagger" quantity 3 -> 2',
      'Ireena: Item "Dagger" uses spent 0 -> 1',
    ]);
  });

  it('describes effects added and removed', () => {
    const effect = {
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e1',
      parentUuid: 'Actor.a1',
      name: 'Poisoned',
    };
    expect(describeRecord(rec({ ...effect, op: 'delete' }))).toEqual([
      'Ireena: effect "Poisoned" removed',
    ]);
    expect(describeRecord(rec({ ...effect, op: 'create' }))).toEqual([
      'Ireena: effect "Poisoned" added',
    ]);
  });

  it('describes creates and deletes, with the owner when there is one', () => {
    expect(
      describeRecord(
        rec({
          op: 'create',
          documentName: 'Item',
          uuid: 'Actor.a1.Item.i1',
          parentUuid: 'Actor.a1',
          name: 'Dagger',
        })
      )
    ).toEqual(['Created Item "Dagger" on Ireena']);
    expect(
      describeRecord(
        rec({
          op: 'delete',
          documentName: 'Wall',
          uuid: 'Scene.s1.Wall.w1',
          parentUuid: 'Scene.s1',
          name: null,
          rootUuid: 'Scene.s1.Wall.w1',
          rootName: null,
        })
      )
    ).toEqual(['Deleted Wall']);
  });

  it('says a token moved when only x and y changed', () => {
    expect(
      describeRecord(
        rec({
          documentName: 'Token',
          uuid: 'Scene.s1.Token.t1',
          parentUuid: 'Scene.s1',
          name: 'Wolf 2',
          rootUuid: 'Scene.s1.Token.t1',
          rootName: 'Wolf 2',
          before: [val('x', 100), val('y', 100)],
          after: [val('x', 200), val('y', 100)],
        })
      )
    ).toEqual(['Token "Wolf 2" moved']);
  });

  it('shows an oversize record and a record with unknown before values', () => {
    expect(describeRecord(rec({ oversize: true }))).toEqual([
      'Ireena changed (the details were too large to keep)',
    ]);
    expect(describeRecord(rec({ unknownBefore: ['system.attributes.hp.temp'] }))).toEqual([
      'Ireena: temp HP changed',
    ]);
  });
});

describe('buildActions', () => {
  it('groups by actionId in pump order, with who, when and the things touched', () => {
    const a1 = hpChange(10, 5, { actionId: 'A', t: NOW - 3 * MIN });
    const other = hpChange(7, 6, {
      actionId: 'B',
      userId: 'u2',
      userName: 'Strahd',
      userIsGM: true,
    });
    const a2 = rec({
      actionId: 'A',
      t: NOW - 3 * MIN + 100,
      op: 'create',
      documentName: 'Item',
      uuid: 'Actor.a1.Item.i1',
      parentUuid: 'Actor.a1',
      name: 'Dagger',
    });
    const actions = buildActions([a1, other, a2]);
    expect(actions.map(a => a.actionId)).toEqual(['A', 'B']);
    const [first] = actions;
    expect(first?.records).toEqual([a1, a2]);
    expect(first?.t).toBe(a1.t);
    expect(first?.tEnd).toBe(a2.t);
    expect(first?.userName).toBe('Ireena');
    expect(first?.userIsGM).toBe(false);
    expect(first?.things).toEqual([{ uuid: 'Actor.a1', name: 'Ireena' }]);
    expect(first?.summary).toBe('Ireena: HP 10 -> 5 and 1 more change');
    expect(first?.lines).toEqual(['Ireena: HP 10 -> 5', 'Created Item "Dagger" on Ireena']);
  });

  it('caps the lines and says how many more there were', () => {
    const records = Array.from({ length: 12 }, (_, i) => hpChange(i, i + 1, { actionId: 'long' }));
    const [action] = buildActions(records);
    expect(action?.lines).toHaveLength(MAX_ACTION_LINES);
    expect(action?.lines.at(-1)).toBe('and 5 more changes');
    expect(action?.summary).toBe('Ireena: HP 0 -> 1 and 11 more changes');
  });

  it('hides a failed apply and its rollback, and marks an AI action with its changeId', () => {
    const failed = hpChange(10, 5, { actionId: 'F', changeId: 'chg-fail', changeMode: 'apply' });
    const rollback = hpChange(5, 10, {
      actionId: 'F2',
      changeId: 'chg-fail',
      changeMode: 'rollback',
    });
    const ai = hpChange(10, 5, { actionId: 'G', changeId: 'chg-ok', changeMode: 'apply' });
    const actions = buildActions([failed, rollback, ai]);
    expect(actions.map(a => a.actionId)).toEqual(['G']);
    expect(actions[0]?.changeId).toBe('chg-ok');
  });
});

describe('ChangeHistory.list', () => {
  let dataDir: string;
  let store: VaultStore;
  let logger: any;
  let audit: RecentChange[];
  let undoState: UndoState;
  let pullNow: ReturnType<typeof vi.fn>;

  async function writeDay(records: ChangeRecord[]): Promise<void> {
    const byDate = new Map<string, ChangeRecord[]>();
    for (const r of records) {
      const date = localDateKey(r.t);
      byDate.set(date, [...(byDate.get(date) ?? []), r]);
    }
    for (const [date, rows] of byDate) {
      await store.appendLines('w1', 'gm', changeJournalFileName(date), rows);
    }
  }

  function makeHistory(extra: { pullNow?: (() => Promise<void>) | null } = {}): ChangeHistory {
    const pull = extra.pullNow === null ? undefined : (extra.pullNow ?? pullNow);
    return new ChangeHistory({
      store,
      worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
      guardedWrites: {
        listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve(audit),
        undoState: (): Promise<UndoState> => Promise.resolve(undoState),
      },
      logger,
      ...(pull ? { pullNow: pull } : {}),
      now: () => NOW,
    });
  }

  beforeEach(async () => {
    counter = 0;
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'change-history-'));
    store = new VaultStore({ dataDir });
    logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    audit = [];
    undoState = new Map();
    pullNow = vi.fn(() => Promise.resolve());
  });

  afterEach(async () => {
    await store.flush();
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('lists human actions newest first, from the files of the last 7 days', async () => {
    await writeDay([
      hpChange(10, 5, { actionId: 'old', t: NOW - 3 * DAY }),
      hpChange(5, 3, { actionId: 'new', t: NOW - MIN }),
      hpChange(20, 1, { actionId: 'ancient', t: NOW - (CHANGE_HISTORY_DAYS + 2) * DAY }),
    ]);
    const { changes, note } = await makeHistory().list();
    expect(note).toBeUndefined();
    expect(changes.map(c => c.id)).toEqual(['act:new', 'act:old']);
    expect(changes[0]).toMatchObject({
      kind: 'human',
      by: 'Ireena',
      userId: 'u1',
      isGM: false,
      summary: 'Ireena: HP 5 -> 3',
      records: 1,
      canUndo: true,
      undone: false,
    });
    expect(changes[0]?.at).toBe(new Date(NOW - MIN).toISOString());
  });

  it('merges AI changes from the audit log and keeps their undo fields', async () => {
    await writeDay([hpChange(10, 5, { actionId: 'h', t: NOW - 20 * MIN })]);
    audit = [
      aiChange({
        changeId: 'chg-2',
        appliedAt: new Date(NOW - 2 * MIN).toISOString(),
        requestedBy: 'Danni',
      }),
      aiChange({
        changeId: 'chg-1',
        appliedAt: new Date(NOW - 60 * MIN).toISOString(),
        canUndo: false,
        undoneBy: 'chg-3',
        undoneAt: new Date(NOW - 50 * MIN).toISOString(),
      }),
    ];
    const { changes } = await makeHistory().list();
    expect(changes.map(c => c.id)).toEqual(['chg-2', 'act:h', 'chg-1']);
    expect(changes[0]).toMatchObject({
      kind: 'ai',
      by: 'AI',
      canUndo: true,
      undone: false,
      requestedBy: 'Danni',
      lines: ['Actor "Wolf 2": HP 11 → 5'],
    });
    expect(changes[2]).toMatchObject({
      kind: 'ai',
      canUndo: false,
      undone: true,
      undoneBy: 'chg-3',
    });
  });

  it('does not list the records of an AI change as a human action, and hides a rolled-back one', async () => {
    await writeDay([
      hpChange(11, 5, { actionId: 'ai', changeId: 'chg-1', changeMode: 'apply' }),
      // dnd5e's own follow-up in the same burst (Bloodied added) belongs to the AI change.
      rec({
        actionId: 'ai',
        op: 'create',
        documentName: 'ActiveEffect',
        uuid: 'Actor.a1.ActiveEffect.e1',
        parentUuid: 'Actor.a1',
        name: 'Bloodied',
      }),
      hpChange(11, 5, { actionId: 'bad', changeId: 'chg-x', changeMode: 'apply' }),
      hpChange(5, 11, { actionId: 'bad-undo', changeId: 'chg-x', changeMode: 'rollback' }),
      hpChange(3, 2, { actionId: 'human' }),
    ]);
    audit = [aiChange()];
    const { changes } = await makeHistory().list();
    expect(changes.map(c => c.id)).toEqual(['chg-1', 'act:human']);
  });

  it('filters by source, person, thing and since', async () => {
    await writeDay([
      hpChange(10, 5, { actionId: 'ireena', t: NOW - 30 * MIN }),
      rec({
        actionId: 'strahd',
        t: NOW - 20 * MIN,
        userId: 'u2',
        userName: 'Strahd',
        userIsGM: true,
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i9',
        parentUuid: 'Actor.a2',
        name: 'Sword',
        rootUuid: 'Actor.a2',
        rootName: 'Wolf',
        before: [val('system.quantity', 1)],
        after: [val('system.quantity', 0)],
      }),
    ]);
    audit = [aiChange({ appliedAt: new Date(NOW - 10 * MIN).toISOString(), requestedBy: 'Danni' })];
    const history = makeHistory();
    const ids = async (o: Parameters<ChangeHistory['list']>[0]): Promise<string[]> =>
      (await history.list(o)).changes.map(c => c.id);

    expect(await ids({ source: 'ai' })).toEqual(['chg-1']);
    expect(await ids({ source: 'human' })).toEqual(['act:strahd', 'act:ireena']);
    expect(await ids({ userName: 'STRAHD' })).toEqual(['act:strahd']);
    expect(await ids({ userId: 'u1', userName: 'u1' })).toEqual(['act:ireena']);
    expect(await ids({ userName: 'danni' })).toEqual(['chg-1']);
    expect(await ids({ thingUuid: 'Actor.a2' })).toEqual(['act:strahd']);
    expect(await ids({ thingUuid: 'Actor.a2.Item.i9' })).toEqual(['act:strahd']);
    expect(await ids({ thingUuid: 'Actor.wolf2' })).toEqual(['chg-1']);
    expect(await ids({ sinceIso: new Date(NOW - 25 * MIN).toISOString() })).toEqual([
      'chg-1',
      'act:strahd',
    ]);
    expect(await ids({ limit: 1 })).toEqual(['chg-1']);
  });

  it('pulls the newest records first, and still lists when the pull fails', async () => {
    await writeDay([hpChange(10, 5, { actionId: 'a' })]);
    const history = makeHistory();
    expect((await history.list()).note).toBeUndefined();
    expect(pullNow).toHaveBeenCalledTimes(1);

    const failing = makeHistory({ pullNow: () => Promise.reject(new Error('down')) });
    const result = await failing.list();
    expect(result.changes).toHaveLength(1);
    expect(result.note).toContain('may be missing');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('says so when the journal is switched off', async () => {
    audit = [aiChange()];
    const result = await makeHistory({ pullNow: null }).list();
    expect(result.changes.map(c => c.id)).toEqual(['chg-1']);
    expect(result.note).toContain('switched off');
  });

  it('takes records the pump appends after the first read', async () => {
    await writeDay([hpChange(10, 5, { actionId: 'first', t: NOW - 20 * MIN })]);
    const history = makeHistory();
    expect((await history.list()).changes).toHaveLength(1);

    const added = [hpChange(5, 4, { actionId: 'second', t: NOW - MIN })];
    await writeDay(added);
    history.addRecords('w1', added);
    history.addRecords('w1', added); // a repeat changes nothing
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:second', 'act:first']);
  });

  it('ignores appends before the first read (the files already hold them) and keeps appends made while loading', async () => {
    const early = hpChange(1, 2, { actionId: 'early', t: NOW - 5 * MIN });
    await writeDay([early]);
    const history = makeHistory();
    history.addRecords('w1', [early]); // nothing loaded yet: ignored

    // Start the load by hand (list() waits for the pull first), then append while it reads.
    const late = hpChange(2, 3, { actionId: 'late', t: NOW - MIN });
    const loading = (history as any).load('w1') as Promise<unknown>;
    history.addRecords('w1', [late]); // the load is in flight: kept
    await loading;
    const ids = (await history.list()).changes.map(c => c.id);
    expect(ids).toEqual(['act:late', 'act:early']);
  });
});

describe('undoBlocker', () => {
  const actionOf = (...records: ChangeRecord[]): ReturnType<typeof buildActions>[number] =>
    buildActions(records)[0];

  it('lets an action with a recorded before value, a create or a delete with data through', () => {
    expect(undoBlocker(actionOf(hpChange(10, 5)))).toBeNull();
    expect(undoBlocker(actionOf(rec({ op: 'create' })))).toBeNull();
    expect(undoBlocker(actionOf(rec({ op: 'delete', data: { _id: 'a1' } })))).toBeNull();
  });

  it('blocks an oversize record, a delete without data and an update with nothing before', () => {
    const mixed = actionOf(
      hpChange(10, 5, { actionId: 'x' }),
      rec({ actionId: 'x', oversize: true })
    );
    expect(undoBlocker(mixed)).toMatch(/too large/);
    expect(undoBlocker(actionOf(rec({ op: 'delete' })))).toMatch(/not recorded/);
    const unknown = actionOf(rec({ unknownBefore: ['system.attributes.hp.value'] }));
    expect(undoBlocker(unknown)).toMatch(/not recorded/);
  });

  it('says the AI made an action that holds only its records', () => {
    expect(undoBlocker(actionOf(hpChange(1, 2, { changeId: 'chg-1' })))).toMatch(/AI/);
  });
});

describe('ChangeHistory.list undo state', () => {
  it('marks undone actions, and says an action with no usable record cannot be undone', async () => {
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'change-history-'));
    const store = new VaultStore({ dataDir });
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    try {
      await store.appendLines('w1', 'gm', changeJournalFileName(localDateKey(NOW - MIN)), [
        hpChange(10, 5, { actionId: 'a', t: NOW - 3 * MIN }),
        rec({ actionId: 'b', t: NOW - 2 * MIN, oversize: true }),
        hpChange(5, 3, { actionId: 'c', t: NOW - MIN }),
      ]);
      const undoneAt = new Date(NOW).toISOString();
      const history = new ChangeHistory({
        store,
        worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
        guardedWrites: {
          listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve([]),
          undoState: (): Promise<UndoState> =>
            Promise.resolve(new Map([['act:c', { undoneBy: 'chg-9', undoneAt }]])),
        },
        logger,
        now: (): number => NOW,
      });
      const { changes } = await history.list();
      expect(changes.map(c => [c.id, (c as { canUndo: boolean }).canUndo])).toEqual([
        ['act:c', false],
        ['act:b', false],
        ['act:a', true],
      ]);
      expect(changes[0]).toMatchObject({ undone: true, undoneBy: 'chg-9' });
      expect(changes[1]).toMatchObject({ undone: false });
      expect((await history.humanActions()).map(a => a.actionId)).toEqual(['a', 'b', 'c']);
    } finally {
      await store.flush();
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  });
});
