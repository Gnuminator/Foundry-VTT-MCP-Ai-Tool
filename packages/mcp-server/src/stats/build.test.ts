/**
 * The stats builder (docs/OBSIDIAN-PLAN.md section 8, O3): damage/healing come
 * only from HP deltas (never double-counted against the roll that caused
 * them), downs/kills, attribution when several rolls share a chat message,
 * combats, resources of every kind, and that session numbering always
 * matches `groupWithPlayRecords` (the same grouping the session notes use).
 */
import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { groupWithPlayRecords, type SessionEvent } from '../obsidian/grouping.js';

import { buildStats } from './build.js';
import type { StatsModel } from './types.js';

const PC: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ireena' };
const NPC: PlayActorRef = { uuid: 'Actor.npc1', isPC: false, name: 'Rahadin' };
const T0 = Date.parse('2026-10-01T12:00:00.000Z');

function roll(
  key: string,
  t: number,
  actor: PlayActorRef,
  messageId: string,
  overrides: Partial<PlayRecord['roll']> = {},
  extra: Partial<PlayRecord> = {}
): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'roll',
    userId: 'user1',
    sceneId: null,
    actor,
    roll: {
      formula: '1d20',
      total: 10,
      dice: [{ faces: 20, results: [10] }],
      crit: false,
      fumble: false,
      advantage: null,
      rollType: 'attack',
      ...overrides,
    },
    source: { messageId },
    ...extra,
  };
}

function hp(
  key: string,
  t: number,
  actor: PlayActorRef,
  before: number,
  after: number,
  extra: Partial<PlayRecord> = {}
): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'hp',
    userId: null,
    sceneId: null,
    actor,
    path: 'system.attributes.hp.value',
    before,
    after,
    delta: after - before,
    ...extra,
  };
}

function build(records: PlayRecord[], logEvents: SessionEvent[] = []): StatsModel {
  return buildStats({ worldId: 'test-world', logEvents, playRecords: records });
}

describe('buildStats', () => {
  it('counts damage and healing only from HP deltas, never from the roll total', () => {
    const records: PlayRecord[] = [
      roll('roll:m1:0', T0, PC, 'm1', { rollType: 'damage', total: 999 }),
      hp('hp:1', T0 + 100, NPC, 20, 12, { source: { messageId: 'm1', attributed: true } }),
    ];
    const stats = build(records);
    expect(stats.sessions[0]?.partyDamageDealt).toBe(8); // the HP delta, not the roll total (999)
    expect(stats.sessions[0]?.rolls).toBe(1);
    expect(stats.campaign.rolls).toBe(1);
  });

  it('detects a PC down and an NPC kill from the before/after HP crossing zero', () => {
    const records: PlayRecord[] = [
      hp('hp:pc-down', T0, PC, 5, 0),
      hp('hp:npc-kill', T0 + 100, NPC, 3, -1),
      hp('hp:not-a-down', T0 + 200, PC, 10, 6),
    ];
    const stats = build(records);
    expect(stats.sessions[0]?.pcDowns).toBe(1);
    expect(stats.sessions[0]?.npcKills).toBe(1);
    const pc = stats.pcs.find(p => p.uuid === PC.uuid);
    expect(pc?.downs).toBe(1);
  });

  it('attributes an HP loss to the roll sharing its messageId, preferring the matching rollType', () => {
    const records: PlayRecord[] = [
      roll('roll:m1:0', T0, PC, 'm1', { rollType: 'attack' }),
      roll('roll:m1:1', T0 + 10, PC, 'm1', { rollType: 'damage' }),
      hp('hp:1', T0 + 100, NPC, 10, 4, { source: { messageId: 'm1', attributed: true } }),
    ];
    const stats = build(records);
    expect(stats.sessions[0]?.partyDamageDealt).toBe(6);
    const pc = stats.pcs.find(p => p.uuid === PC.uuid);
    expect(pc?.damageDealt).toBe(6);
  });

  it('does not attribute an HP change when the record is not marked attributed', () => {
    const records: PlayRecord[] = [
      roll('roll:m1:0', T0, PC, 'm1', { rollType: 'damage' }),
      hp('hp:1', T0 + 100, NPC, 10, 4, { source: { messageId: 'm1' } }), // attributed omitted
    ];
    const stats = build(records);
    expect(stats.sessions[0]?.partyDamageDealt).toBe(0);
    expect(stats.sessions[0]?.partyDamageTaken).toBe(0); // the NPC is not a PC either
  });

  it('builds one CombatStats per combat id with rounds, participants, downs and kills', () => {
    const records: PlayRecord[] = [
      {
        v: 2,
        key: 'combat-start:c1',
        t: T0,
        seq: 1,
        kind: 'combat-start',
        userId: null,
        sceneId: 's1',
        combat: { id: 'c1', round: 1, turn: 0 },
      },
      {
        v: 2,
        key: 'combat-turn:c1:1:0',
        t: T0 + 10,
        seq: 2,
        kind: 'combat-turn',
        userId: null,
        sceneId: 's1',
        actor: PC,
        combat: { id: 'c1', round: 1, turn: 0 },
      },
      {
        v: 2,
        key: 'combat-turn:c1:3:0',
        t: T0 + 20,
        seq: 3,
        kind: 'combat-turn',
        userId: null,
        sceneId: 's1',
        actor: NPC,
        combat: { id: 'c1', round: 3, turn: 0 },
      },
      hp('hp:1', T0 + 30, NPC, 5, 0, { combat: { id: 'c1', round: 3, turn: 0 } }),
      {
        v: 2,
        key: 'combat-end:c1',
        t: T0 + 40,
        seq: 4,
        kind: 'combat-end',
        userId: null,
        sceneId: 's1',
        combat: { id: 'c1', round: 3, turn: 1 },
      },
    ];
    const stats = build(records);
    expect(stats.sessions[0]?.combats).toHaveLength(1);
    const combat = stats.sessions[0]?.combats[0];
    expect(combat?.rounds).toBe(3);
    expect(combat?.participants).toEqual(['Ireena', 'Rahadin']);
    expect(combat?.kills).toEqual(['Rahadin']);
    expect(stats.sessions[0]?.combatRounds).toBe(3);
  });

  it('tallies spell slots, resources (new and legacy), hit dice, loot, currency and xp for a PC', () => {
    const records: PlayRecord[] = [
      {
        v: 2,
        key: 'slot:1',
        t: T0,
        seq: 1,
        kind: 'slot',
        userId: null,
        sceneId: null,
        actor: PC,
        path: 'system.spells.spell1.value',
        before: 4,
        after: 3,
        delta: -1,
      },
      {
        v: 2,
        key: 'resource:1',
        t: T0 + 1,
        seq: 2,
        kind: 'resource',
        userId: null,
        sceneId: null,
        actor: PC,
        path: 'system.resources.primary.value',
        before: 2,
        after: 1,
        delta: -1,
      },
      // dnd5e 4+: uses.spent increases when an item charge is spent.
      {
        v: 2,
        key: 'item-uses:1',
        t: T0 + 2,
        seq: 3,
        kind: 'item-uses',
        userId: null,
        sceneId: null,
        actor: PC,
        item: { uuid: 'Item.wand', name: 'Wand of Magic Missiles', type: 'weapon' },
        path: 'system.uses.spent',
        before: 0,
        after: 1,
        delta: 1,
      },
      // legacy: uses.value decreases when spent.
      {
        v: 2,
        key: 'item-uses:2',
        t: T0 + 3,
        seq: 4,
        kind: 'item-uses',
        userId: null,
        sceneId: null,
        actor: PC,
        item: { uuid: 'Item.torch', name: 'Torch', type: 'consumable' },
        path: 'system.uses.value',
        before: 5,
        after: 4,
        delta: -1,
      },
      {
        v: 2,
        key: 'hit-dice:1',
        t: T0 + 4,
        seq: 5,
        kind: 'hit-dice',
        userId: null,
        sceneId: null,
        actor: PC,
        item: { uuid: 'Item.fighter', name: 'Fighter', type: 'class' },
        path: 'system.hd.spent',
        before: 1,
        after: 2,
        delta: 1,
      },
      {
        v: 2,
        key: 'item-create:1',
        t: T0 + 5,
        seq: 6,
        kind: 'item-create',
        userId: null,
        sceneId: null,
        actor: PC,
        item: { uuid: 'Item.gem', name: 'Ruby', type: 'loot' },
        after: 2,
      },
      {
        v: 2,
        key: 'currency:1',
        t: T0 + 6,
        seq: 7,
        kind: 'currency',
        userId: null,
        sceneId: null,
        actor: PC,
        path: 'system.currency.gp',
        before: 10,
        after: 22,
        delta: 12,
      },
      {
        v: 2,
        key: 'xp:1',
        t: T0 + 7,
        seq: 8,
        kind: 'xp',
        userId: null,
        sceneId: null,
        actor: PC,
        before: 0,
        after: 300,
        delta: 300,
      },
    ];
    const stats = build(records);
    const pc = stats.pcs.find(p => p.uuid === PC.uuid);
    expect(pc?.slotsSpent).toEqual({ spell1: 1 });
    expect(pc?.resourcesSpent).toEqual({
      primary: 1,
      'Wand of Magic Missiles': 1,
      Torch: 1,
      Fighter: 1,
    });
    expect(pc?.lootGained).toEqual({ Ruby: 2 });
    expect(pc?.currencyDelta).toEqual({ gp: 12 });
    expect(pc?.xpGained).toBe(300);
    expect(stats.sessions[0]?.spellSlotsSpent).toBe(1);
    expect(stats.sessions[0]?.resourcesSpent).toBe(4);
  });

  it('names users from userName on any record, falling back to the id', () => {
    const stats = build([
      roll('roll:n1', T0, PC, 'mn1', {}, { userId: 'u1', userName: 'Anna' }),
      roll('roll:n2', T0 + 1000, PC, 'mn2', {}, { userId: 'u2' }),
    ]);
    expect(stats.sessions[0]?.users).toEqual(['Anna', 'u2']);
    expect(Object.keys(stats.dice.byUser).sort()).toEqual(['Anna', 'u2']);
  });

  it('splits session time by the scene each record was made in', () => {
    const scene = (key: string, t: number, sceneId: string, name: string): PlayRecord => ({
      v: 2,
      key,
      t,
      seq: 1,
      kind: 'scene',
      userId: null,
      sceneId,
      data: { sceneName: name },
    });
    const stats = build([
      scene('scene:a', T0, 'sA', 'Village'),
      roll('roll:s1', T0 + 10 * 60000, PC, 'ms1', {}, { sceneId: 'sA' }),
      roll('roll:s2', T0 + 20 * 60000, PC, 'ms2', {}, { sceneId: 'sB' }),
      roll('roll:s3', T0 + 50 * 60000, PC, 'ms3', {}, { sceneId: 'sB' }),
    ]);
    // Village: 0 to 20 min; sB (no scene record, so its id): 20 to 50 min.
    expect(stats.sessions[0]?.sceneMinutes).toEqual({ Village: 20, sB: 30 });
  });

  it('numbers sessions exactly like groupWithPlayRecords (contract 5)', () => {
    const logEvents: SessionEvent[] = [
      { id: 'e1', timestampMs: T0, eventType: 'session-start', actorName: null },
      { id: 'e2', timestampMs: T0 + 1000, eventType: 'note', actorName: null },
    ];
    const far = T0 + 4 * 60 * 60 * 1000; // past the 3h gap: a second session
    const records: PlayRecord[] = [
      roll('roll:a', T0 + 500, PC, 'ma'),
      roll('roll:b', far, PC, 'mb'),
    ];
    const stats = build(records, logEvents);
    const groups = groupWithPlayRecords(logEvents, records);
    expect(stats.sessions).toHaveLength(groups.length);
    stats.sessions.forEach((s, i) => {
      expect(s.number).toBe(i + 1);
      expect(s.playRecords).toBe(groups[i]?.playRecords.length);
    });
  });

  it('builds 60,000 records in under a second', () => {
    const records: PlayRecord[] = [];
    for (let i = 0; i < 60_000; i++) {
      const t = T0 + i * 1000;
      records.push(
        i % 2 === 0
          ? roll(`roll:${i}`, t, PC, `m${i}`, { rollType: 'damage' })
          : hp(`hp:${i}`, t, NPC, 10, 4, { source: { messageId: `m${i - 1}`, attributed: true } })
      );
    }
    const start = Date.now();
    const stats = buildStats({ worldId: 'perf-world', logEvents: [], playRecords: records });
    const elapsedMs = Date.now() - start;
    expect(stats.campaign.rolls).toBe(30_000);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
