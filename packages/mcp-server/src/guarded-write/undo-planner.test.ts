import type { ChangeRecord, GuardedOp, GuardedOpResult, PathValue } from '@gnuminator/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildActions, type ChangeAction } from '../change-history.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import type { AuditEntry } from '../vault/audit.js';

import type { PlanInput, PlanView } from './service.js';
import { MAX_LATER, UndoPlanner, type UndoPlanView } from './undo-planner.js';

const T0 = Date.parse('2026-10-07T10:00:00Z');
const MIN = 60_000;

const num = (path: string, value: number): PathValue => ({ path, present: true, value });
const str = (path: string, value: string): PathValue => ({ path, present: true, value });
const gone = (path: string): PathValue => ({ path, present: false });
const HP = 'system.attributes.hp.value';

let counter = 0;

/** A journal record, `min` minutes after T0. */
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

function update(uuid: string, before: PathValue[], after: PathValue[]): GuardedOpResult {
  return {
    index: 0,
    kind: 'update',
    uuid,
    documentName: 'Actor',
    name: 'Ireena',
    parentUuid: null,
    before,
    after,
  };
}

let ring: AuditEntry[];
let records: ChangeRecord[];
/** What the history says it is complete from (0: everything the tests hold). */
let historyStart = 0;
let foundry: FakeFoundry;
let createPlan: ReturnType<typeof vi.fn>;
let planner: UndoPlanner;

function planInput(): PlanInput {
  return createPlan.mock.calls.at(-1)?.[0] as PlanInput;
}

function plan(
  id: string,
  scope?: 'just-this' | 'everything-since' | 'world-since',
  rewindTable?: boolean
): Promise<UndoPlanView> {
  return planner.plan({ id, ...(scope ? { scope } : {}), ...(rewindTable ? { rewindTable } : {}) });
}

beforeEach((): void => {
  counter = 0;
  ring = [];
  records = [];
  historyStart = 0;
  foundry = new FakeFoundry();
  foundry.add('Actor.a', 'Actor', {
    name: 'Ireena',
    system: { attributes: { hp: { value: 5, max: 12 } } },
    flags: {},
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
      historyStart: (): Promise<number> => Promise.resolve(historyStart),
      aiFollowUps: (changeId: string): Promise<ChangeRecord[]> =>
        Promise.resolve(
          buildActions(records)
            .find(a => a.changeId === changeId)
            ?.records.filter(r => !r.changeId) ?? []
        ),
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

describe('refusals', () => {
  it("says an unknown change is unknown, and how long people's changes are kept", async () => {
    await expect(plan('act:nope')).rejects.toThrow(/No change act:nope in the kept history/);
    await expect(plan('act:nope')).rejects.toThrow(/kept 7 days, less when/);
    await expect(plan('chg-nope')).rejects.toThrow(/No recorded change chg-nope/);
  });

  it('refuses a set that starts before the kept history, and only says so for just-this', async () => {
    ring.push(entry('chg-old', 1, { results: [update('Actor.a', [num(HP, 12)], [num(HP, 5)])] }));
    records.push(hp(10, 5, 3, 'later'));
    historyStart = T0 + 5 * MIN;
    await expect(plan('chg-old', 'world-since', true)).rejects.toThrow(
      /changes before 2026-10-07 \d\d:\d\d are no longer in the history/
    );
    await expect(plan('chg-old', 'everything-since')).rejects.toThrow(/Undo just this change/);
    await expect(plan('chg-old')).resolves.toMatchObject({ scope: 'just-this' });
    expect(planInput().notes).toContainEqual(expect.stringMatching(/no longer in the history/));
    // A target inside the kept history is not affected.
    historyStart = T0;
    await plan('chg-old', 'everything-since');
    expect(planInput().notes ?? []).not.toContainEqual(expect.stringMatching(/no longer/));
  });

  it('refuses a change that is already undone, from the derived state', async () => {
    records.push(hp(1, 10, 5, 'x'));
    ring.push(entry('chg-e', 2, { feature: 'change-undo', undoes: { actions: ['x'] } }));
    await expect(plan('act:x')).rejects.toThrow(/already undone \(chg-e\)/);
    ring.push(entry('chg-r', 3, { mode: 'undo', undoOf: 'chg-e', results: [] }));
    // Its undo was undone (redo): the change is live again.
    await expect(plan('act:x')).resolves.toMatchObject({ scope: 'just-this' });
  });

  it("refuses a person's change that cannot be put back", async () => {
    records.push(rec(1, { actionId: 'big', oversize: true }));
    await expect(plan('act:big')).rejects.toThrow(/too large/);
    records.push(rec(2, { actionId: 'unk', unknownBefore: [HP] }));
    await expect(plan('act:unk')).rejects.toThrow(/not recorded/);
  });

  it('refuses an AI change that also wrote to the vault, or has nothing to undo', async () => {
    ring.push(
      entry('chg-v', 1, {
        results: [update('Actor.a', [num(HP, 1)], [num(HP, 5)])],
        vaultOps: [{ file: 'f.json', path: 'p', before: gone('p'), after: num('p', 1) }],
      }),
      entry('chg-empty', 2)
    );
    await expect(plan('chg-v')).rejects.toThrow(/undo-change/);
    await expect(plan('chg-empty')).rejects.toThrow(/nothing to undo/);
  });

  it('refuses world-since without rewindTable, and rewinds with it', async () => {
    records.push(hp(1, 10, 5, 'x'));
    await expect(plan('act:x', 'world-since')).rejects.toThrow(/rewindTable/);
    const view = await plan('act:x', 'world-since', true);
    expect(view.scope).toBe('world-since');
    expect(planInput().risk).toBe('destructive');
    expect(planInput().summary).toMatch(/^Rewind the table to \d\d:\d\d: 1 change$/);
  });

  it('says there is nothing to undo when the documents are already as they were', async () => {
    // The change set hp 5 (from 5), and it is 5 now: nothing to put back.
    records.push(hp(1, 5, 5, 'y'));
    await expect(plan('act:y')).rejects.toThrow(/nothing to undo/);
    expect(createPlan).not.toHaveBeenCalled();
  });
});

describe('just-this', () => {
  it("restores the before values of a person's change as one update op", async () => {
    records.push(hp(1, 10, 5, 'x'));
    const view = await plan('act:x');
    expect(createPlan).toHaveBeenCalledTimes(1);
    const input = planInput();
    expect(input.feature).toBe('change-undo');
    expect(input.summary).toBe('Undo: Ireena: HP 10 -> 5');
    expect(input.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
    ]);
    expect(input.undoes).toEqual({ actions: ['x'] });
    expect(input.pathLabels).toEqual({ [HP]: 'HP' });
    expect(input.risk).toBeUndefined();
    expect(view).toMatchObject({ planId: 'plan-1', scope: 'just-this', later: [] });
  });

  it('plans an AI change from its audit entry and puts its id under undoes.changes', async () => {
    ring.push(entry('chg-1', 1, { results: [update('Actor.a', [num(HP, 10)], [num(HP, 5)])] }));
    await plan('chg-1');
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
    ]);
    expect(planInput().undoes).toEqual({ changes: ['chg-1'] });
    expect(planInput().summary).toBe('Undo: AI chg-1');
  });

  it('puts back what dnd5e deleted with an AI change, and says what it cannot', async () => {
    // The AI ends concentration (an effect delete, in the audit log); dnd5e removed the
    // summoned token and a template with it (journal records of the same burst, not the AI's).
    foundry.add('Scene.s1', 'Scene', { name: 'Castle' });
    ring.push(
      entry('chg-1', 1, {
        results: [
          {
            index: 0,
            kind: 'delete',
            uuid: 'Actor.a.ActiveEffect.e1',
            documentName: 'ActiveEffect',
            name: 'Concentrating',
            parentUuid: 'Actor.a',
            deleted: { name: 'Concentrating', _id: 'e1' },
          },
        ],
      })
    );
    records.push(
      rec(1, {
        actionId: 'F',
        changeId: 'chg-1',
        changeMode: 'apply',
        op: 'delete',
        documentName: 'ActiveEffect',
        uuid: 'Actor.a.ActiveEffect.e1',
        parentUuid: 'Actor.a',
        name: 'Concentrating',
        data: {
          flags: {
            dnd5e: {
              dependents: [{ uuid: 'Scene.s1.Token.t9' }, { uuid: 'Scene.s1.MeasuredTemplate.m1' }],
            },
          },
        },
      }),
      rec(1, {
        actionId: 'F',
        op: 'delete',
        documentName: 'Token',
        uuid: 'Scene.s1.Token.t9',
        parentUuid: 'Scene.s1',
        name: 'Wolf',
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
        data: { _id: 't9', name: 'Wolf' },
      }),
      rec(1, {
        actionId: 'F',
        op: 'delete',
        documentName: 'MeasuredTemplate',
        uuid: 'Scene.s1.MeasuredTemplate.m1',
        parentUuid: 'Scene.s1',
        name: null,
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
      })
    );
    const view = await plan('chg-1');
    expect(planInput().ops).toEqual([
      expect.objectContaining({
        kind: 'create',
        documentName: 'ActiveEffect',
        parentUuid: 'Actor.a',
        data: { name: 'Concentrating', _id: 'e1' },
      }),
      expect.objectContaining({
        kind: 'create',
        documentName: 'Token',
        parentUuid: 'Scene.s1',
        data: { _id: 't9', name: 'Wolf' },
      }),
    ]);
    expect(planInput().notes).toContainEqual(
      expect.stringMatching(/Not restored: MeasuredTemplate on Castle \(its data was not kept\)/)
    );
    // The follow-ups are not a person's action: nothing else to list.
    expect(view.later).toEqual([]);
  });

  it('undoes an AI undo entry too (the redo of an AI undo)', async () => {
    ring.push(
      entry('chg-1', 1, { results: [update('Actor.a', [num(HP, 10)], [num(HP, 5)])] }),
      entry('chg-u', 2, {
        mode: 'undo',
        undoOf: 'chg-1',
        results: [update('Actor.a', [num(HP, 5)], [num(HP, 10)])],
      })
    );
    foundry.edit('Actor.a', num(HP, 10));
    await plan('chg-u');
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 5 }, unset: [] },
    ]);
    // chg-1 is older than the undo: it stays undone-by-nothing, so it is not added to undoes.
    expect(planInput().undoes).toEqual({ changes: ['chg-u'] });
  });

  it("adjusts a number by this change's part when a later change touched it", async () => {
    records.push(hp(1, 10, 5, 'x'), hp(2, 5, 3, 'later'));
    foundry.edit('Actor.a', num(HP, 3));
    const view = await plan('act:x');
    // 3 + (10 - 5) = 8
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 8 }, unset: [] },
    ]);
    expect(view.later.map(l => l.id)).toEqual(['act:later']);
    expect(view.later[0]).toMatchObject({ by: 'Ireena', summary: 'Ireena: HP 5 -> 3' });
  });

  it('clamps an adjusted number to 0 and to the max beside it', async () => {
    records.push(hp(1, 2, 8, 'low'), hp(2, 8, 1, 'later'));
    foundry.edit('Actor.a', num(HP, 1));
    await plan('act:low');
    // 1 + (2 - 8) = -5, clamped to 0
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 0 }, unset: [] },
    ]);

    records.length = 0;
    records.push(hp(1, 30, 4, 'big'), hp(2, 4, 10, 'later2'));
    foundry.edit('Actor.a', num(HP, 10));
    await plan('act:big');
    // 10 + (30 - 4) = 36, clamped to hp.max 12
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 12 }, unset: [] },
    ]);
  });

  it('adjusts only amounts: a later code or a negative number is kept, not added up', async () => {
    records.push(
      rec(1, {
        actionId: 'open',
        before: [num('flags.door.ds', 0), num('system.attributes.hp.tempmax', 0)],
        after: [num('flags.door.ds', 1), num('system.attributes.hp.tempmax', -2)],
      }),
      rec(2, {
        actionId: 'lock',
        before: [num('flags.door.ds', 1), num('system.attributes.hp.tempmax', -2)],
        after: [num('flags.door.ds', 2), num('system.attributes.hp.tempmax', -5)],
      })
    );
    foundry.edit('Actor.a', num('flags.door.ds', 2));
    foundry.edit('Actor.a', num('system.attributes.hp.tempmax', -5));
    // 2 + (0 - 1) = 1 would open a locked door; -5 + 2 = -3 is not what anyone set.
    const error = await plan('act:open').then(
      () => '',
      (e: Error) => e.message
    );
    expect(error).toMatch(/^There is nothing to undo: /);
    expect(error).toContain('Kept, changed later: Ireena: flags.door.ds stays 2');
    expect(error).toMatch(/stays -5/);
  });

  it('keeps a value that is not a number when it changed later, and says so', async () => {
    records.push(
      rec(1, {
        actionId: 'x',
        before: [num(HP, 10), str('flags.mood', 'calm')],
        after: [num(HP, 5), str('flags.mood', 'angry')],
      })
    );
    foundry.edit('Actor.a', str('flags.mood', 'scared'));
    await plan('act:x');
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: { [HP]: 10 }, unset: [] },
    ]);
    expect(planInput().notes).toEqual(['Kept, changed later: Ireena: flags.mood stays "scared"']);
  });

  it('lists paths that were not recorded as kept, and still undoes the recorded ones', async () => {
    records.push(
      rec(1, {
        actionId: 'x',
        before: [num(HP, 10)],
        after: [num(HP, 5)],
        unknownBefore: ['system.details.xp', 'flags.mood'],
      })
    );
    await plan('act:x');
    expect(planInput().notes).toEqual([
      'Not recorded, kept: Ireena: system.details.xp, flags.mood',
    ]);
    expect((planInput().ops as GuardedOp[])[0]).toMatchObject({ changes: { [HP]: 10 } });
  });

  it('unsets a path that did not exist before', async () => {
    records.push(
      rec(1, { actionId: 'x', before: [gone('flags.mood')], after: [str('flags.mood', 'angry')] })
    );
    foundry.edit('Actor.a', str('flags.mood', 'angry'));
    await plan('act:x');
    expect(planInput().ops).toEqual([
      { kind: 'update', uuid: 'Actor.a', changes: {}, unset: ['flags.mood'] },
    ]);
  });

  it('lists at most MAX_LATER later changes to the same thing, newest first', async () => {
    records.push(hp(1, 10, 9, 'first'));
    for (let i = 0; i < MAX_LATER + 5; i++) records.push(hp(2 + i, 9 - i, 8 - i, `l${i}`));
    records.push(
      rec(100, {
        actionId: 'other',
        uuid: 'Actor.b',
        rootUuid: 'Actor.b',
        before: [num(HP, 1)],
        after: [num(HP, 2)],
      })
    );
    const view = await plan('act:first');
    expect(view.later).toHaveLength(MAX_LATER);
    expect(view.later[0]?.id).toBe(`act:l${MAX_LATER + 4}`);
    expect(view.later.map(l => l.id)).not.toContain('act:other');
  });
});
