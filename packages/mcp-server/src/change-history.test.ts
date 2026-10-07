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
  OWN_ACTION_SUFFIX,
  buildActions,
  describeRecord,
  labelOf,
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

  it("splits a person's records on other things out of an AI burst, and keeps the follow-ups", () => {
    const ai = hpChange(11, 5, { actionId: 'B', changeId: 'chg-1', changeMode: 'apply' });
    // dnd5e's Bloodied on the same actor: the AI change's own follow-up.
    const bloodied = rec({
      actionId: 'B',
      op: 'create',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e1',
      parentUuid: 'Actor.a1',
      name: 'Bloodied',
    });
    // The GM's own edit of another actor within the action gap, in the bridge's browser.
    const own = hpChange(20, 18, {
      actionId: 'B',
      uuid: 'Actor.a2',
      rootUuid: 'Actor.a2',
      name: 'Strahd',
      rootName: 'Strahd',
      userName: 'Gamemaster',
      userIsGM: true,
    });
    const later = hpChange(3, 2, { actionId: 'C' });
    const actions = buildActions([ai, bloodied, own, later]);
    expect(actions.map(a => a.actionId)).toEqual(['B', `B${OWN_ACTION_SUFFIX}`, 'C']);
    expect(actions[0]).toMatchObject({ changeId: 'chg-1', records: [ai, bloodied] });
    expect(actions[1]).toMatchObject({
      records: [own],
      userName: 'Gamemaster',
      summary: 'Strahd: HP 20 -> 18',
      things: [{ uuid: 'Actor.a2', name: 'Strahd' }],
    });
    expect(actions[1]?.changeId).toBeUndefined();
    expect(undoBlocker(actions[1])).toBeNull();
  });

  it("keeps Foundry's own cascade on a Combat with the AI change instead of making it a person's action", () => {
    // The AI deletes a token: Foundry removes its combatant and moves the turn (root Combat).
    const ai = rec({
      actionId: 'D',
      changeId: 'chg-2',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'Token',
      uuid: 'Scene.s1.Token.t1',
      parentUuid: 'Scene.s1',
      name: 'Goblin',
      rootUuid: 'Scene.s1',
      rootName: 'Cave',
    });
    const combatant = rec({
      actionId: 'D',
      op: 'delete',
      documentName: 'Combatant',
      uuid: 'Combat.c1.Combatant.cb1',
      parentUuid: 'Combat.c1',
      name: 'Goblin',
      rootUuid: 'Combat.c1',
      rootName: null,
    });
    const turn = rec({
      actionId: 'D',
      documentName: 'Combat',
      uuid: 'Combat.c1',
      name: null,
      rootUuid: 'Combat.c1',
      rootName: null,
      before: [val('turn', 2)],
      after: [val('turn', 1)],
    });
    // The GM's own edit of an actor in the same burst still splits off.
    const own = hpChange(20, 18, {
      actionId: 'D',
      uuid: 'Actor.a2',
      rootUuid: 'Actor.a2',
      name: 'Strahd',
      rootName: 'Strahd',
    });
    const actions = buildActions([ai, combatant, turn, own]);
    expect(actions.map(a => a.actionId)).toEqual(['D', `D${OWN_ACTION_SUFFIX}`]);
    expect(actions[0]).toMatchObject({ changeId: 'chg-2', records: [ai, combatant, turn] });
    expect(actions[1]).toMatchObject({ records: [own] });
  });

  it('names the owner in an ownership line when the user is known', () => {
    const owner = rec({
      before: [val('ownership.u2', 0)],
      after: [val('ownership.u2', 3)],
    });
    const users = new Map([['u2', 'Anna']]);
    expect(describeRecord(owner)).toEqual(['Ireena: ownership for user u2 0 -> 3']);
    expect(describeRecord(owner, users)).toEqual(['Ireena: ownership for Anna 0 -> 3']);
    expect(buildActions([owner], users)[0]?.lines).toEqual(['Ireena: ownership for Anna 0 -> 3']);
    expect(labelOf('ownership.default', users)).toBe('default ownership');
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

  function makeHistory(
    extra: { pullNow?: (() => Promise<void>) | null; journalStart?: number } = {}
  ): ChangeHistory {
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
      ...(extra.journalStart !== undefined
        ? { journalStart: (): Promise<number> => Promise.resolve(extra.journalStart!) }
        : {}),
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

  it('says how many changes an undo took back, and leaves it out otherwise', async () => {
    audit = [
      aiChange({
        changeId: 'undo-1',
        feature: 'change-undo',
        undoes: { actions: ['a1', 'a2'], changes: ['chg-0'] },
      }),
      aiChange({ changeId: 'chg-0', appliedAt: new Date(NOW - 9 * MIN).toISOString() }),
    ];
    const { changes } = await makeHistory().list({ source: 'ai' });
    expect(changes[0]).toMatchObject({ id: 'undo-1', covers: 3 });
    expect(changes[1]).not.toHaveProperty('covers');
  });

  it('groups everyone by local day, oldest first, without a limit or a pull', async () => {
    const yesterday = new Date(2026, 9, 6, 20).getTime();
    const records = [hpChange(11, 5, { actionId: 'old', t: yesterday })];
    for (let i = 0; i < 40; i++)
      records.push(hpChange(10 - i, 9 - i, { actionId: `a${i}`, t: NOW - (50 - i) * MIN }));
    await writeDay(records);
    audit = [aiChange({ changeId: 'chg-x', appliedAt: new Date(NOW - 44.5 * MIN).toISOString() })];
    const days = (await makeHistory().byDay('w1'))!;
    expect(days.map(d => d.date)).toEqual(['2026-10-06', '2026-10-07']);
    expect(days[0].changes.map(c => c.id)).toEqual(['act:old']);
    expect(days[1].changes.length).toBe(41);
    expect(days[1].changes[0].id).toBe('act:a0');
    expect(days[1].changes[6].id).toBe('chg-x');
    expect(days.every(d => d.incompleteBefore === undefined)).toBe(true);
    expect(pullNow).not.toHaveBeenCalled();
    // The history reads the current world: another world gets nothing, not the current one's days.
    expect(await makeHistory().byDay('w2')).toBeNull();
  });

  it('puts an action that runs past midnight on the day it started, in order by its start', async () => {
    const lateStart = new Date(2026, 9, 6, 23, 58).getTime();
    await writeDay([
      hpChange(11, 5, { actionId: 'cross', t: lateStart }),
      hpChange(5, 4, { actionId: 'cross', t: lateStart + 4 * MIN }),
      hpChange(20, 19, { actionId: 'evening', t: lateStart - 60 * MIN }),
    ]);
    const days = (await makeHistory().byDay('w1'))!;
    expect(days.map(d => d.date)).toEqual(['2026-10-06']);
    expect(days[0].changes.map(c => [c.id, c.at.slice(11, 16)])).toEqual([
      ['act:evening', new Date(lateStart - 60 * MIN).toISOString().slice(11, 16)],
      ['act:cross', new Date(lateStart).toISOString().slice(11, 16)],
    ]);
  });

  it('leaves out a day that is no longer whole, and marks today when it is not', async () => {
    // Seven days back: its midnight is before the cutoff (NOW - 7 days, at noon), so the day's
    // note must stay as it was written; today is still returned.
    const weekAgo = new Date(2026, 8, 30, 14).getTime();
    await writeDay([
      hpChange(11, 5, { actionId: 'old', t: weekAgo }),
      hpChange(10, 9, { actionId: 'today', t: NOW - 10 * MIN }),
    ]);
    expect((await makeHistory().byDay('w1'))!.map(d => d.date)).toEqual(['2026-10-07']);

    // The size cap removed a file inside the span: a day that starts before the new start is
    // left out too, and today is whole.
    const yesterday = new Date(2026, 9, 6, 20).getTime();
    await writeDay([hpChange(8, 7, { actionId: 'yday', t: yesterday })]);
    const pruned = makeHistory({ journalStart: new Date(2026, 9, 7).getTime() });
    expect((await pruned.byDay('w1'))!.map(d => [d.date, d.incompleteBefore])).toEqual([
      ['2026-10-07', undefined],
    ]);

    // The AI audit ring is full and its oldest entry is from this morning: older AI changes are
    // gone, so yesterday is left out and today is marked incomplete from that time.
    audit = Array.from({ length: 500 }, (_, i) =>
      aiChange({ changeId: `chg-${i}`, appliedAt: new Date(NOW - (i + 1) * MIN).toISOString() })
    );
    const ringFrom = NOW - 500 * MIN;
    const full = (await makeHistory().byDay('w1'))!;
    expect(full.map(d => [d.date, d.incompleteBefore])).toEqual([['2026-10-07', ringFrom]]);
    expect(full[0].changes.length).toBe(501);
    // `list()` is not affected by the ring's size.
    expect((await makeHistory().list({ limit: 200 })).changes.length).toBe(200);
  });

  it('counts an undo-change undo (the AI tab, the toast) as covering the one change it undid', async () => {
    audit = [aiChange({ changeId: 'undo-2', mode: 'undo', undoOf: 'chg-0' })];
    const { changes } = await makeHistory().list({ source: 'ai' });
    expect(changes[0]).toMatchObject({ id: 'undo-2', covers: 1 });
  });

  it('starts the history at the span cutoff, or later when the pump removed files inside it, and says so', async () => {
    const cutoff = NOW - 7 * 24 * 60 * 60 * 1000;
    expect(await makeHistory().historyStart()).toBe(cutoff);
    expect(await makeHistory({ journalStart: 0 }).historyStart()).toBe(cutoff);
    expect((await makeHistory({ journalStart: 0 }).list()).note).toBeUndefined();

    const twoDaysAgo = new Date(2026, 9, 5).getTime();
    const pruned = makeHistory({ journalStart: twoDaysAgo });
    expect(await pruned.historyStart()).toBe(twoDaysAgo);
    expect((await pruned.list()).note).toMatch(/before 2026-10-05 are gone/);
    expect((await pruned.list({ source: 'ai' })).note).toBeUndefined();
  });

  it('skips lines of the files that are not change records', async () => {
    await writeDay([hpChange(10, 5, { actionId: 'ok' })]);
    await store.appendLines('w1', 'gm', changeJournalFileName(localDateKey(NOW - 10 * MIN)), [
      { key: 'junk', note: 'not a record' },
      'text',
      null,
    ]);
    const { changes } = await makeHistory().list();
    expect(changes.map(c => c.id)).toEqual(['act:ok']);
  });

  it("lists a GM edit made within the action gap of an AI write as the GM's own, undoable change", async () => {
    await writeDay([
      hpChange(11, 5, { actionId: 'ai', changeId: 'chg-1', changeMode: 'apply' }),
      hpChange(20, 18, {
        actionId: 'ai',
        uuid: 'Actor.a2',
        rootUuid: 'Actor.a2',
        name: 'Strahd',
        rootName: 'Strahd',
        userName: 'Gamemaster',
        userIsGM: true,
      }),
    ]);
    audit = [aiChange()];
    const history = makeHistory();
    const { changes } = await history.list();
    expect(changes.map(c => c.id)).toEqual(['chg-1', `act:ai${OWN_ACTION_SUFFIX}`]);
    expect(changes[1]).toMatchObject({ kind: 'human', by: 'Gamemaster', canUndo: true });
    expect((await history.humanActions()).map(a => a.actionId)).toEqual([`ai${OWN_ACTION_SUFFIX}`]);
    expect(await history.userNames()).toEqual(new Map([['u1', 'Gamemaster']]));
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
