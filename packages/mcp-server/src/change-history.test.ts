import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ChangeRecord, PathValue } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANGE_JOURNAL_RETENTION_DAYS,
  ChangeJournalPump,
  changeJournalFileName,
} from './change-journal-pump.js';
import {
  CHANGE_HISTORY_DAYS,
  ChangeHistory,
  MAX_ACTION_LINES,
  OWN_ACTION_SUFFIX,
  buildActions,
  describeRecord,
  historyStartLabel,
  journalLinks,
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

describe('historyStartLabel', () => {
  it('says a day for midnight and adds the time otherwise', () => {
    expect(historyStartLabel(new Date(2026, 9, 5).getTime())).toBe('2026-10-05');
    expect(historyStartLabel(new Date(2026, 9, 5, 9, 7, 30).getTime())).toBe('2026-10-05 09:07');
  });
});

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

  it("keeps dnd5e's dependent deletes with the AI change that deleted an effect or an item", () => {
    // The AI ends concentration on Strahd: dnd5e removes the effect it put on Ireena, the spell's
    // template, its region and the summoned token, in the GM browser that is the bridge's.
    const dependentsOf = (...uuids: string[]): Record<string, unknown> => ({
      flags: { dnd5e: { dependents: uuids.map(uuid => ({ uuid })) } },
    });
    const ai = rec({
      actionId: 'E',
      changeId: 'chg-3',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.e1',
      parentUuid: 'Actor.a2',
      name: 'Concentrating: Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: dependentsOf(
        'Actor.a1.ActiveEffect.e2',
        'Scene.s1.MeasuredTemplate.m1',
        'Scene.s1.Region.r1',
        'Scene.s1.Token.t9'
      ),
    });
    const dependents = [
      rec({
        actionId: 'E',
        op: 'delete',
        documentName: 'ActiveEffect',
        uuid: 'Actor.a1.ActiveEffect.e2',
        parentUuid: 'Actor.a1',
        name: 'Hold Person',
      }),
      rec({
        actionId: 'E',
        op: 'delete',
        documentName: 'MeasuredTemplate',
        uuid: 'Scene.s1.MeasuredTemplate.m1',
        parentUuid: 'Scene.s1',
        name: null,
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
      }),
      rec({
        actionId: 'E',
        op: 'delete',
        documentName: 'Region',
        uuid: 'Scene.s1.Region.r1',
        parentUuid: 'Scene.s1',
        name: 'Darkness',
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
      }),
      rec({
        actionId: 'E',
        op: 'delete',
        documentName: 'Token',
        uuid: 'Scene.s1.Token.t9',
        parentUuid: 'Scene.s1',
        name: 'Wolf (summoned)',
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
      }),
    ];
    // The GM's own HP edit of Ireena in the same burst still splits off, and so does a delete
    // the AI's effect does not name as a dependent (the GM removed another token just then).
    const own = hpChange(20, 18, { actionId: 'E' });
    const unrelated = rec({
      ...dependents[3],
      uuid: 'Scene.s1.Token.t2',
      name: 'Bat',
    });
    const actions = buildActions([ai, ...dependents, own, unrelated]);
    expect(actions.map(a => a.actionId)).toEqual(['E', `E${OWN_ACTION_SUFFIX}`]);
    expect(actions[0]).toMatchObject({ changeId: 'chg-3', records: [ai, ...dependents] });
    expect(actions[1]).toMatchObject({ records: [own, unrelated] });

    // An AI item delete counts as a source, followed through its concentration effect (deleted
    // with it on the same actor) to that effect's dependents.
    const item = rec({
      ...ai,
      documentName: 'Item',
      uuid: 'Actor.a2.Item.i1',
      name: 'Wand of Hold Person',
      data: { name: 'Wand of Hold Person' },
    });
    const concentration = rec({ ...ai, changeId: undefined, changeMode: undefined });
    const viaItem = buildActions([item, concentration, ...dependents, unrelated]);
    expect(viaItem.map(a => a.actionId)).toEqual(['E', `E${OWN_ACTION_SUFFIX}`]);
    expect(viaItem[0].records).toEqual([item, concentration, ...dependents]);
    expect(viaItem[1].records).toEqual([unrelated]);

    // When the deleted document's data was too large to keep, the link cannot be read: every
    // delete of a dependent kind in the burst stays with the AI change.
    const oversize = rec({ ...ai, data: undefined, oversize: true });
    expect(buildActions([oversize, ...dependents, unrelated, own]).map(a => a.records)).toEqual([
      [oversize, ...dependents, unrelated],
      [own],
    ]);

    // Without an AI effect or item delete, the same deletes are the person's own action.
    const update = rec({ ...ai, op: 'update', before: [val('disabled', false)] });
    expect(buildActions([update, ...dependents]).map(a => a.actionId)).toEqual([
      'E',
      `E${OWN_ACTION_SUFFIX}`,
    ]);
    const creates = dependents.map(r => ({ ...r, op: 'create' as const }));
    expect(buildActions([ai, ...creates]).map(a => a.actionId)).toEqual([
      'E',
      `E${OWN_ACTION_SUFFIX}`,
    ]);
  });

  it('hands the planner only the follow-ups on other things, and reads the dependents link from sources only', () => {
    const dependentsOf = (...uuids: string[]): Record<string, unknown> => ({
      flags: { dnd5e: { dependents: uuids.map(uuid => ({ uuid })) } },
    });
    const ai = rec({
      actionId: 'G',
      changeId: 'chg-4',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.e1',
      parentUuid: 'Actor.a2',
      name: 'Concentrating: Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: dependentsOf('Actor.a1.ActiveEffect.e2'),
    });
    const held = rec({
      actionId: 'G',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e2',
      parentUuid: 'Actor.a1',
      name: 'Hold Person',
      data: { name: 'Hold Person' },
    });
    // dnd5e's derived record on the AI's own target (Bloodied going with an HP change in the
    // same burst) stays in the action but is not a follow-up: Foundry makes it again by itself.
    const bloodied = rec({
      actionId: 'G',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.b1',
      parentUuid: 'Actor.a2',
      name: 'Bloodied',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: { name: 'Bloodied' },
    });
    const [action] = buildActions([ai, bloodied, held]);
    expect(action.records).toEqual([ai, bloodied, held]);
    expect(action.followUps).toEqual([held]);

    // A dependent too large to keep does not switch the burst to the kind rule: a delete the
    // link does not name is still the person's own action.
    const oversizeHeld = { ...held, data: undefined, oversize: true };
    const unrelated = rec({
      actionId: 'G',
      op: 'delete',
      documentName: 'Token',
      uuid: 'Scene.s1.Token.t2',
      parentUuid: 'Scene.s1',
      name: 'Bat',
      rootUuid: 'Scene.s1',
      rootName: 'Castle',
    });
    const split = buildActions([ai, oversizeHeld, unrelated]);
    expect(split.map(a => a.records)).toEqual([[ai, oversizeHeld], [unrelated]]);
    expect(split[0].followUps).toEqual([oversizeHeld]);

    // An AI item delete: the concentration effect dnd5e ended on the same actor is a follow-up
    // too, and its dependents with it; the derived record still is not.
    const item = rec({
      actionId: 'G',
      changeId: 'chg-4',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'Item',
      uuid: 'Actor.a2.Item.i1',
      parentUuid: 'Actor.a2',
      name: 'Wand of Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: { name: 'Wand of Hold Person' },
    });
    const concentration = {
      ...ai,
      changeId: undefined,
      changeMode: undefined,
      data: { statuses: ['concentrating'], ...dependentsOf('Actor.a1.ActiveEffect.e2') },
    };
    const viaItem = buildActions([item, concentration, bloodied, held]);
    expect(viaItem.map(a => a.records)).toEqual([[item, concentration, bloodied, held]]);
    expect(viaItem[0].followUps).toEqual([concentration, held]);

    // A person's action has none.
    expect(buildActions([hpChange(20, 18, { actionId: 'H' })])[0].followUps).toEqual([]);
  });

  it('gives each AI change in one burst its own action and follow-ups', () => {
    // Two AI changes 100 ms apart share a burst: the GM's prep edit before them, the first
    // change's ended concentration with its dependent, then a second change on another actor
    // with a dependent of its own, and a token delete the GM made in between.
    const prep = hpChange(20, 18, { actionId: 'K' });
    const first = rec({
      actionId: 'K',
      changeId: 'chg-5',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.e1',
      parentUuid: 'Actor.a2',
      name: 'Concentrating: Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: { flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e2' }] } } },
    });
    const firstDependent = rec({
      actionId: 'K',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e2',
      parentUuid: 'Actor.a1',
      name: 'Hold Person',
      data: { name: 'Hold Person' },
    });
    const gmToken = rec({
      actionId: 'K',
      op: 'delete',
      documentName: 'Token',
      uuid: 'Scene.s1.Token.t2',
      parentUuid: 'Scene.s1',
      name: 'Bat',
      rootUuid: 'Scene.s1',
      rootName: 'Castle',
    });
    const second = rec({
      ...first,
      changeId: 'chg-6',
      uuid: 'Actor.a3.ActiveEffect.e3',
      parentUuid: 'Actor.a3',
      name: 'Concentrating: Bless',
      rootUuid: 'Actor.a3',
      rootName: 'Ismark',
      data: { flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e4' }] } } },
    });
    const secondDependent = rec({
      ...firstDependent,
      uuid: 'Actor.a1.ActiveEffect.e4',
      name: 'Bless',
      data: { name: 'Bless' },
    });
    const actions = buildActions([prep, first, firstDependent, gmToken, second, secondDependent]);
    expect(actions.map(a => [a.actionId, a.changeId])).toEqual([
      ['K', 'chg-5'],
      ['K:2', 'chg-6'],
      [`K${OWN_ACTION_SUFFIX}`, undefined],
    ]);
    expect(actions[0].records).toEqual([first, firstDependent]);
    expect(actions[0].followUps).toEqual([firstDependent]);
    expect(actions[1].records).toEqual([second, secondDependent]);
    expect(actions[1].followUps).toEqual([secondDependent]);
    expect(actions[2].records).toEqual([prep, gmToken]);
  });

  it("files a follow-up that arrives after the next AI change's first record under its own change", () => {
    // Change A deletes a token and ends a concentration; change B (another actor's HP) lands
    // before Foundry's combatant delete and dnd5e's dependent delete for A come through. A
    // combatant the GM removed from the tracker meanwhile names no token A deleted: by position.
    const tokenA = rec({
      actionId: 'M',
      changeId: 'chg-7',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'Token',
      uuid: 'Scene.s1.Token.t1',
      parentUuid: 'Scene.s1',
      name: 'Wolf',
      rootUuid: 'Scene.s1',
      rootName: 'Castle',
      sceneId: 's1',
      data: { _id: 't1', name: 'Wolf' },
    });
    const effectA = rec({
      actionId: 'M',
      changeId: 'chg-7',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.e1',
      parentUuid: 'Actor.a2',
      name: 'Concentrating: Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: { flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e9' }] } } },
    });
    const hpB = hpChange(20, 18, {
      actionId: 'M',
      changeId: 'chg-8',
      changeMode: 'apply',
      uuid: 'Actor.a3',
      rootUuid: 'Actor.a3',
      rootName: 'Ismark',
      name: 'Ismark',
    });
    const combatantA = rec({
      actionId: 'M',
      op: 'delete',
      documentName: 'Combatant',
      uuid: 'Combat.c1.Combatant.cb1',
      parentUuid: 'Combat.c1',
      name: 'Wolf',
      rootUuid: 'Combat.c1',
      rootName: null,
      sceneId: 's1',
      data: { _id: 'cb1', tokenId: 't1', sceneId: 's1' },
    });
    const dependentA = rec({
      actionId: 'M',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e9',
      parentUuid: 'Actor.a1',
      name: 'Hold Person',
      data: { name: 'Hold Person' },
    });
    const gmCombatant = rec({
      ...combatantA,
      uuid: 'Combat.c1.Combatant.cb2',
      name: 'Bat',
      data: { _id: 'cb2', tokenId: 't2', sceneId: 's1' },
    });
    const actions = buildActions([tokenA, effectA, hpB, combatantA, dependentA, gmCombatant]);
    expect(actions.map(a => [a.actionId, a.changeId])).toEqual([
      ['M', 'chg-7'],
      ['M:2', 'chg-8'],
    ]);
    expect(actions[0].records).toEqual([tokenA, effectA, combatantA, dependentA]);
    expect(actions[0].followUps).toEqual([combatantA, dependentA]);
    expect(actions[1].records).toEqual([hpB, gmCombatant]);
    expect(actions[1].followUps).toEqual([gmCombatant]);
  });

  describe('two AI changes on one actor in one burst', () => {
    const strahd = { parentUuid: 'Actor.a2', rootUuid: 'Actor.a2', rootName: 'Strahd' };
    const ai = (changeId: string, o: Partial<ChangeRecord>): ChangeRecord =>
      rec({ actionId: 'P', changeId, changeMode: 'apply', op: 'delete', ...strahd, ...o });
    const spellA = (): ChangeRecord =>
      ai('chg-a', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i1',
        name: 'Dagger',
        data: { name: 'Dagger' },
      });
    const spellB = (): ChangeRecord =>
      ai('chg-b', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i2',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });
    const concentration = (): ChangeRecord =>
      rec({
        actionId: 'P',
        op: 'delete',
        documentName: 'ActiveEffect',
        uuid: 'Actor.a2.ActiveEffect.c1',
        name: 'Concentrating: Hold Person',
        ...strahd,
        data: {
          statuses: ['concentrating'],
          flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e2' }] } },
        },
      });
    const dependent = (): ChangeRecord =>
      rec({
        actionId: 'P',
        op: 'delete',
        documentName: 'ActiveEffect',
        uuid: 'Actor.a1.ActiveEffect.e2',
        parentUuid: 'Actor.a1',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });

    it("files another change's concentration chain to that change, not to an earlier condition removal", () => {
      // (a) A removes a condition on Strahd; B deletes his concentration spell.
      const condition = ai('chg-a', {
        documentName: 'ActiveEffect',
        uuid: 'Actor.a2.ActiveEffect.x1',
        name: 'Frightened',
        data: { name: 'Frightened' },
      });
      const b = spellB();
      const conc = concentration();
      const dep = dependent();
      const actions = buildActions([condition, b, conc, dep]);
      expect(actions.map(a => a.changeId)).toEqual(['chg-a', 'chg-b']);
      expect(actions[0].records).toEqual([condition]);
      expect(actions[0].followUps).toEqual([]);
      expect(actions[1].records).toEqual([b, conc, dep]);
      expect(actions[1].followUps).toEqual([conc, dep]);
    });

    it('files the concentration chain to the later item delete that ended it, not the first item delete', () => {
      // (b) A deletes an item on Strahd; B deletes his concentration spell.
      const a = spellA();
      const b = spellB();
      const conc = concentration();
      const dep = dependent();
      const actions = buildActions([a, b, conc, dep]);
      expect(actions[0].records).toEqual([a]);
      expect(actions[0].followUps).toEqual([]);
      expect(actions[1].records).toEqual([b, conc, dep]);
      expect(actions[1].followUps).toEqual([conc, dep]);
    });

    it('still files a late concentration chain to the item delete that ended it', () => {
      // B (an HP change elsewhere) lands before the chain of A's concentration spell comes through.
      const a = ai('chg-a', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i2',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });
      const hpB = hpChange(20, 18, {
        actionId: 'P',
        changeId: 'chg-b',
        changeMode: 'apply',
        uuid: 'Actor.a3',
        rootUuid: 'Actor.a3',
        rootName: 'Ismark',
        name: 'Ismark',
      });
      const conc = concentration();
      const dep = dependent();
      const actions = buildActions([a, hpB, conc, dep]);
      expect(actions[0].records).toEqual([a, conc, dep]);
      expect(actions[0].followUps).toEqual([conc, dep]);
      expect(actions[1].records).toEqual([hpB]);
    });

    it('files a concentration effect that names its spell to the change that deleted that spell', () => {
      // A deletes the spell, B the dagger, and dnd5e's concentration delete comes after B started:
      // the effect names the spell (origin and flags.dnd5e.item.uuid), so it stays with A.
      const a = ai('chg-a', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i2',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });
      const b = ai('chg-b', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.i1',
        name: 'Dagger',
        data: { name: 'Dagger' },
      });
      const named = (data: Record<string, unknown>): ChangeRecord => {
        const plain = concentration();
        return { ...plain, data: { ...plain.data, ...data } };
      };
      for (const conc of [
        named({ origin: 'Actor.a2.Item.i2' }),
        named({
          flags: {
            dnd5e: {
              item: { uuid: 'Actor.a2.Item.i2' },
              dependents: [{ uuid: 'Actor.a1.ActiveEffect.e2' }],
            },
          },
        }),
      ]) {
        const dep = dependent();
        const actions = buildActions([a, b, conc, dep]);
        expect(actions.map(x => x.changeId)).toEqual(['chg-a', 'chg-b']);
        expect(actions[0].records).toEqual([a, conc, dep]);
        expect(actions[0].followUps).toEqual([conc, dep]);
        expect(actions[1].records).toEqual([b]);
        expect(actions[1].followUps).toEqual([]);
      }
      // Case (b) with the spell named: B deleted the spell, A only the dagger.
      const spell = named({ origin: 'Actor.a2.Item.i2' });
      const dep = dependent();
      const reverse = buildActions([spellA(), spellB(), spell, dep]);
      expect(reverse[0].followUps).toEqual([]);
      expect(reverse[1].followUps).toEqual([spell, dep]);
    });

    it('keeps the actor rule when the effect names a spell no AI change deleted', () => {
      const named = (origin: string): ChangeRecord => {
        const plain = concentration();
        return { ...plain, data: { ...plain.data, origin } };
      };
      // (a) The AI deletes a wand; dnd5e deletes the wand's cached spell, whose concentration names
      // the cached spell, not the wand.
      const wand = ai('chg-a', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.w1',
        name: 'Wand of Hold Person',
        data: { name: 'Wand of Hold Person' },
      });
      const cached = rec({
        actionId: 'P',
        op: 'delete',
        documentName: 'Item',
        uuid: 'Actor.a2.Item.k1',
        name: 'Hold Person',
        ...strahd,
        data: { name: 'Hold Person' },
      });
      const viaWand = named('Actor.a2.Item.k1');
      const depA = dependent();
      const wandActions = buildActions([wand, cached, viaWand, depA]);
      expect(wandActions.map(x => x.changeId)).toEqual(['chg-a']);
      expect(wandActions[0].followUps).toEqual(expect.arrayContaining([viaWand, depA]));
      // (b) A stale uuid: the effect names the base actor's item, the delete is the token actor's.
      const tokenSpell = ai('chg-b', {
        documentName: 'Item',
        uuid: 'Scene.s1.Token.t1.Actor.a2.Item.i2',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });
      const stale = named('Actor.a2.Item.i2');
      const depB = dependent();
      const staleActions = buildActions([tokenSpell, stale, depB]);
      expect(staleActions.map(x => x.changeId)).toEqual(['chg-b']);
      expect(staleActions[0].followUps).toEqual([stale, depB]);
    });

    it('files a wand or stale-uuid concentration to its own change when a later change deleted another item', () => {
      const named = (origin: string): ChangeRecord => {
        const plain = concentration();
        return { ...plain, data: { ...plain.data, origin } };
      };
      const dagger = (): ChangeRecord =>
        ai('chg-b', {
          documentName: 'Item',
          uuid: 'Actor.a2.Item.i1',
          name: 'Dagger',
          data: { name: 'Dagger' },
        });
      // (a) A deletes the wand, B the dagger; dnd5e deletes the cached spell (cast from the wand's
      // activity) and its concentration, which names the cached spell.
      const wand = ai('chg-a', {
        documentName: 'Item',
        uuid: 'Actor.a2.Item.w1',
        name: 'Wand of Hold Person',
        data: { name: 'Wand of Hold Person' },
      });
      const b = dagger();
      const cached = rec({
        actionId: 'P',
        op: 'delete',
        documentName: 'Item',
        uuid: 'Actor.a2.Item.k1',
        name: 'Hold Person',
        ...strahd,
        data: { name: 'Hold Person', flags: { dnd5e: { cachedFor: '.Item.w1.Activity.act1' } } },
      });
      const viaWand = named('Actor.a2.Item.k1');
      const depA = dependent();
      const wandActions = buildActions([wand, b, cached, viaWand, depA]);
      expect(wandActions.map(x => x.changeId)).toEqual(['chg-a', 'chg-b']);
      expect(wandActions[0].followUps).toEqual(expect.arrayContaining([viaWand, depA]));
      expect(wandActions[1].followUps).toEqual([]);
      // (b) A deletes the token actor's spell, B the dagger; the effect names the base actor's uuid.
      const tokenSpell = ai('chg-a', {
        documentName: 'Item',
        uuid: 'Scene.s1.Token.t1.Actor.a2.Item.i2',
        name: 'Hold Person',
        data: { name: 'Hold Person' },
      });
      const b2 = dagger();
      const stale = named('Actor.a2.Item.i2');
      const depB = dependent();
      const staleActions = buildActions([tokenSpell, b2, stale, depB]);
      expect(staleActions.map(x => x.changeId)).toEqual(['chg-a', 'chg-b']);
      expect(staleActions[0].followUps).toEqual([stale, depB]);
      expect(staleActions[1].followUps).toEqual([]);
    });
  });

  it('files a combatant delete to the latest change that deleted its token, and never to a later change', () => {
    const token = (changeId: string, op: ChangeRecord['op']): ChangeRecord =>
      rec({
        actionId: 'Q',
        changeId,
        changeMode: 'apply',
        op,
        documentName: 'Token',
        uuid: 'Scene.s1.Token.t1',
        parentUuid: 'Scene.s1',
        name: 'Wolf',
        rootUuid: 'Scene.s1',
        rootName: 'Castle',
        sceneId: 's1',
        data: { _id: 't1', name: 'Wolf' },
      });
    const combatant = (id: string): ChangeRecord =>
      rec({
        actionId: 'Q',
        op: 'delete',
        documentName: 'Combatant',
        uuid: `Combat.c1.Combatant.${id}`,
        parentUuid: 'Combat.c1',
        name: 'Wolf',
        rootUuid: 'Combat.c1',
        rootName: null,
        sceneId: 's1',
        data: { _id: id, tokenId: 't1', sceneId: 's1' },
      });
    // (d) A person removed the wolf from the tracker before A: their own action.
    const early = combatant('cb0');
    const a = token('chg-a', 'delete');
    const cbA = combatant('cb1');
    // (c) B (an undo) re-creates the token and its combatant, C deletes it again.
    const b = token('chg-b', 'create');
    const cbB = rec({ ...combatant('cb2'), changeId: 'chg-b', changeMode: 'apply', op: 'create' });
    const c = token('chg-c', 'delete');
    const cbC = combatant('cb2');
    const actions = buildActions([early, a, cbA, b, cbB, c, cbC]);
    expect(actions.map(x => [x.actionId, x.changeId])).toEqual([
      ['Q', 'chg-a'],
      ['Q:2', 'chg-b'],
      ['Q:3', 'chg-c'],
      [`Q${OWN_ACTION_SUFFIX}`, undefined],
    ]);
    expect(actions[0].followUps).toEqual([cbA]);
    expect(actions[1].followUps).toEqual([]);
    expect(actions[2].records).toEqual([c, cbC]);
    expect(actions[2].followUps).toEqual([cbC]);
    expect(actions[3].records).toEqual([early]);
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
    extra: {
      pullNow?: (() => Promise<void>) | null;
      journalStart?: number;
      maxChars?: number;
      /** What each read of the journal's cut actions returns (the last one repeats). */
      cutActions?: string[][];
    } = {}
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
      ...(extra.maxChars !== undefined ? { maxChars: extra.maxChars } : {}),
      ...(extra.cutActions
        ? {
            journalCutActions: (): Promise<ReadonlySet<string>> => {
              const reads = extra.cutActions!;
              return Promise.resolve(new Set(reads.length > 1 ? reads.shift() : reads[0]));
            },
          }
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

  it('holds at most its size cap of the newest records, and says from when it is complete', async () => {
    // A bulk delete can fill a day's file past what one string holds: the history reads it line
    // by line and keeps the newest records within its cap.
    const records = Array.from({ length: 10 }, (_, i) =>
      hpChange(20 - i, 19 - i, { actionId: `b${i}`, t: NOW - (20 - i) * MIN })
    );
    await writeDay(records);
    const size = (r: ChangeRecord): number => JSON.stringify(r).length;
    const cap = size(records[7]) + size(records[8]) + size(records[9]);
    const history = makeHistory({ maxChars: cap });
    const { changes, note } = await history.list();
    expect(changes.map(c => c.id)).toEqual(['act:b9', 'act:b8', 'act:b7']);
    const start = records[6].t + 1;
    expect(await history.historyStart()).toBe(start);
    expect(note).toContain(`before ${historyStartLabel(start)} are gone`);
    expect(note).toContain('left the oldest records out');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Live appends past the cap leave the oldest out too, and the warning is not repeated.
    const later = hpChange(5, 4, { actionId: 'b10', t: NOW - MIN });
    history.addRecords('w1', [later]);
    const after = await history.list();
    expect(after.changes.map(c => c.id)).toEqual(['act:b10', 'act:b9']);
    expect(await history.historyStart()).toBe(records[8].t + 1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Under the cap nothing is left out and there is no note.
    const roomy = makeHistory();
    expect((await roomy.list()).changes).toHaveLength(10);
    expect((await roomy.list()).note).toBeUndefined();
  });

  it('never keeps part of an action: the cap, the journal cut and the span leave one out whole', async () => {
    const size = (r: ChangeRecord): number => JSON.stringify(r).length;
    // A bulk action the cap reaches: its newer records (with another action between) go too.
    const at = (i: number): number => NOW - (30 - i) * MIN;
    const s0 = hpChange(9, 8, { actionId: 's0', t: at(0) });
    const bulk = [1, 2, 4, 5].map(i => hpChange(9, 8, { actionId: 'bulk', t: at(i) }));
    const mid = hpChange(9, 8, { actionId: 'mid', t: at(3) });
    const last = hpChange(9, 8, { actionId: 'last', t: at(6) });
    const records = [s0, bulk[0], bulk[1], mid, bulk[2], bulk[3], last];
    await writeDay(records);
    const cap = size(mid) + size(bulk[2]) + size(bulk[3]) + size(last);
    const history = makeHistory({ maxChars: cap });
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:last', 'act:mid']);
    expect(await history.historyStart()).toBe(bulk[3].t + 1);
    // A late record of the action left out stays out.
    history.addRecords('w1', [hpChange(9, 8, { actionId: 'bulk', t: at(7) })]);
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:last', 'act:mid']);
    expect(await history.historyStart()).toBe(at(7) + 1);

    // The actions the journal's day cap cut through are left out whole.
    const cut = makeHistory({ cutActions: [['mid']] });
    expect((await cut.list()).changes.map(c => c.id)).toEqual(['act:last', 'act:bulk', 'act:s0']);
    expect(await cut.historyStart()).toBe(mid.t + 1);
    // A cut made while the files were being read counts too.
    const during = makeHistory({ cutActions: [[], ['bulk']] });
    expect((await during.list()).changes.map(c => c.id)).toEqual(['act:last', 'act:mid', 'act:s0']);
    expect(await during.historyStart()).toBe(bulk[3].t + 1);
  });

  it('leaves out the whole action when a live append takes the history over its cap', async () => {
    const size = (r: ChangeRecord): number => JSON.stringify(r).length;
    const p0 = hpChange(9, 8, { actionId: 'p', t: NOW - 3 * MIN });
    const q0 = hpChange(9, 8, { actionId: 'q', t: NOW - 2 * MIN });
    await writeDay([p0, q0]);
    const history = makeHistory({ maxChars: size(p0) + size(q0) + 10 });
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:q', 'act:p']);
    const p1 = hpChange(8, 7, { actionId: 'p', t: NOW - MIN });
    history.addRecords('w1', [p1]);
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:q']);
    expect(await history.historyStart()).toBe(p1.t + 1);
  });

  it('leaves an action that began before the span out whole', async () => {
    const span = CHANGE_HISTORY_DAYS * DAY;
    const old = [
      hpChange(9, 8, { actionId: 'old', t: NOW - span - MIN }),
      hpChange(8, 7, { actionId: 'old', t: NOW - span + MIN }),
    ];
    await writeDay([...old, hpChange(7, 6, { actionId: 'new', t: NOW - MIN })]);
    const history = makeHistory();
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:new']);
    expect(await history.historyStart()).toBe(old[1].t + 1);
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

    // A start inside a day (the module's buffer wrapped) is said with its time.
    const wrapped = makeHistory({ journalStart: NOW - 2 * 60 * MIN });
    expect((await wrapped.list()).note).toMatch(/before 2026-10-07 10:00 are gone/);
    expect((await wrapped.list()).note).toMatch(/buffer wrapped/);
  });

  it('leaves out, whole, an action with a record within the action gap after the journal start', async () => {
    // Retention removed yesterday: an action that began before midnight kept only its later part.
    const midnight = new Date(2026, 9, 7).getTime();
    const straddle = [
      hpChange(10, 9, { actionId: 'straddle', t: midnight + 100 }),
      hpChange(9, 8, { actionId: 'straddle', t: midnight + 350 }),
    ];
    const clean = hpChange(8, 7, { actionId: 'clean', t: midnight + 5000 });
    await writeDay([...straddle, clean]);
    const history = makeHistory({ journalStart: midnight });
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:clean']);
    expect(await history.historyStart()).toBe(midnight + 351);
    // A later arrival of the same action stays out too.
    history.addRecords('w1', [hpChange(8, 6, { actionId: 'straddle', t: midnight + 600 })]);
    expect((await history.list()).changes.map(c => c.id)).toEqual(['act:clean']);
    expect(await history.historyStart()).toBe(midnight + 601);
  });

  it('remembers the AI changes some of whose records it left out', async () => {
    const old = rec({
      actionId: 'old',
      changeId: 'chg-old',
      changeMode: 'apply',
      t: NOW - 60 * MIN,
    });
    const kept = hpChange(5, 4, {
      actionId: 'kept',
      changeId: 'chg-kept',
      changeMode: 'apply',
      t: NOW - 5 * MIN,
    });
    await writeDay([old, kept]);
    const history = makeHistory({ maxChars: 1 });
    expect(await history.changeLeftOut('chg-old')).toBe(true);
    expect(await history.changeLeftOut('chg-kept')).toBe(false);
    expect(await history.changeLeftOut('chg-other')).toBe(false);
  });

  it('leaves the start at the span cutoff with no note when the pump only removed files by age', async () => {
    const cutoff = NOW - CHANGE_HISTORY_DAYS * DAY;
    const day = (back: number): string => localDateKey(NOW - back * DAY);
    const seed = (back: number, size = 10): Promise<void> =>
      store.appendLines('w1', 'gm', changeJournalFileName(day(back)), [
        { key: `${day(back)}-1`, pad: 'x'.repeat(size) },
      ]);
    const emptyJournal = {
      query: (): Promise<unknown> =>
        Promise.resolve({
          success: true,
          clientId: 'c1',
          records: [],
          oldestSeq: 0,
          latestSeq: 0,
        }),
      isConnected: (): boolean => true,
    };
    const worldIds = { current: (): Promise<string> => Promise.resolve('w1') };
    const makePump = (maxBytes?: number): ChangeJournalPump =>
      new ChangeJournalPump({
        foundryClient: emptyJournal,
        worldIds,
        store,
        logger,
        now: () => NOW,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      });

    // Two files older than the span go; the oldest kept day starts before the cutoff.
    await seed(CHANGE_JOURNAL_RETENTION_DAYS + 2);
    await seed(CHANGE_JOURNAL_RETENTION_DAYS + 1);
    await seed(CHANGE_JOURNAL_RETENTION_DAYS);
    await seed(1);
    const pump = makePump();
    await pump.pollOnce();
    expect(await pump.historyStart('w1')).toBeLessThan(cutoff);
    const history = makeHistory({ pullNow: null, journalStart: undefined });
    const linked = new ChangeHistory({
      store,
      worldIds,
      guardedWrites: {
        listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve(audit),
        undoState: (): Promise<UndoState> => Promise.resolve(undoState),
      },
      logger,
      ...journalLinks(() => pump),
      now: (): number => NOW,
    });
    expect(await linked.historyStart()).toBe(cutoff);
    expect(await history.historyStart()).toBe(cutoff);
    expect((await linked.list()).note).toBeUndefined();

    // The size cap removing a file inside the span moves the start and says so.
    await seed(3, 1000);
    await seed(2, 1000);
    const capped = makePump(1500);
    await capped.pollOnce();
    expect(await capped.historyStart('w1')).toBe(new Date(2026, 9, 5).getTime());
    const cappedHistory = new ChangeHistory({
      store,
      worldIds,
      guardedWrites: {
        listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve(audit),
        undoState: (): Promise<UndoState> => Promise.resolve(undoState),
      },
      logger,
      ...journalLinks(() => capped),
      now: (): number => NOW,
    });
    expect(await cappedHistory.historyStart()).toBe(new Date(2026, 9, 5).getTime());
    expect((await cappedHistory.list()).note).toMatch(/before 2026-10-05 are gone/);
  });

  it('links the history to a pump that is made later, and stands in while there is none', async () => {
    let pump: Pick<ChangeJournalPump, 'pullNow' | 'historyStart'> | null = null;
    const links = journalLinks(() => pump);
    await expect(links.pullNow()).resolves.toBeUndefined();
    expect(await links.journalStart('w1')).toBe(0);
    const pulled = vi.fn(() => Promise.resolve());
    pump = { pullNow: pulled, historyStart: (): Promise<number> => Promise.resolve(123) };
    await links.pullNow();
    expect(pulled).toHaveBeenCalledOnce();
    expect(await links.journalStart('w1')).toBe(123);
  });

  it('is wired to the pump in the backend (the history gets the pump links)', async () => {
    const backend = await fsp.readFile(new URL('./backend.ts', import.meta.url), 'utf8');
    const wiring =
      /new ChangeHistory\(\{[\s\S]*?journalLinks\([\s\S]*?changeJournalPump[\s\S]*?\}\);/;
    expect(backend).toMatch(wiring);
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

  it('lists what Foundry and dnd5e did with an AI change under it, and hands the planner those records', async () => {
    const aiDelete = rec({
      actionId: 'F',
      changeId: 'chg-f',
      changeMode: 'apply',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a2.ActiveEffect.e1',
      parentUuid: 'Actor.a2',
      name: 'Concentrating: Hold Person',
      rootUuid: 'Actor.a2',
      rootName: 'Strahd',
      data: { flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e2' }] } } },
    });
    const dependent = rec({
      actionId: 'F',
      op: 'delete',
      documentName: 'ActiveEffect',
      uuid: 'Actor.a1.ActiveEffect.e2',
      parentUuid: 'Actor.a1',
      name: 'Hold Person',
      data: { name: 'Hold Person' },
    });
    // The same apply's second op came over the action gap later (a big create, the Pi), so the
    // stash made a second action with the changeId: its follow-up counts too.
    const aiDelete2 = rec({
      ...aiDelete,
      key: 'delete:Actor.a2.ActiveEffect.e3:1',
      seq: 901,
      actionId: 'F2',
      uuid: 'Actor.a2.ActiveEffect.e3',
      name: 'Concentrating: Bless',
      data: { flags: { dnd5e: { dependents: [{ uuid: 'Actor.a1.ActiveEffect.e4' }] } } },
    });
    const dependent2 = rec({
      ...dependent,
      key: 'delete:Actor.a1.ActiveEffect.e4:1',
      seq: 902,
      actionId: 'F2',
      uuid: 'Actor.a1.ActiveEffect.e4',
      name: 'Bless',
      data: { name: 'Bless' },
    });
    await writeDay([aiDelete, dependent, aiDelete2, dependent2]);
    audit = [
      aiChange({
        changeId: 'chg-f',
        summary: 'End concentration: Strahd',
        diff: ['Strahd: effect "Concentrating: Hold Person" removed'],
      }),
    ];
    const history = makeHistory();
    const { changes } = await history.list();
    expect(changes.map(c => c.id)).toEqual(['chg-f']);
    expect(changes[0].lines).toEqual([
      'Strahd: effect "Concentrating: Hold Person" removed',
      'Ireena: effect "Hold Person" removed',
      'Ireena: effect "Bless" removed',
    ]);
    expect(await history.aiFollowUps('chg-f')).toEqual([dependent, dependent2]);
    expect(await history.aiFollowUps('chg-nope')).toEqual([]);
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
