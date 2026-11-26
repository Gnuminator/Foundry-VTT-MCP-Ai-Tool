/** Encounter afterglow: planned vs actual cost per fight, and the toughness factor. */
import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { buildStats } from './build.js';
import { buildFightsReport, plannedBandOf } from './fights.js';

const PC: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ilvara' };
const T0 = Date.parse('2026-10-01T12:00:00.000Z');
const BUDGETS = { low: 100, moderate: 200, high: 400 };

function fightRecords(id: string, t: number, foeXp: number, hpLost: number): PlayRecord[] {
  const base = { v: 2 as const, seq: 1, userId: null, sceneId: null };
  const combat = (round: number): { id: string; round: number; turn: number } => ({
    id,
    round,
    turn: 0,
  });
  return [
    {
      ...base,
      key: `start-${id}`,
      t,
      kind: 'combat-start',
      combat: combat(1),
      data: {
        roster: ['Ilvara'],
        plan: {
          party: [{ name: 'Ilvara', level: 3, hpMax: 40 }],
          foes: 2,
          foeXp,
          budgets: BUDGETS,
        },
      },
    },
    {
      ...base,
      key: `hp-${id}`,
      t: t + 1000,
      kind: 'hp',
      actor: PC,
      combat: combat(2),
      path: 'system.attributes.hp.value',
      before: 40,
      after: 40 - hpLost,
      delta: -hpLost,
    },
    {
      ...base,
      key: `end-${id}`,
      t: t + 2000,
      kind: 'combat-end',
      combat: combat(3),
      data: { rounds: 3, roster: ['Ilvara'] },
    },
  ] as PlayRecord[];
}

describe('plannedBandOf', () => {
  it("uses dnd5e's rule: a budget is the ceiling of its difficulty", () => {
    expect(plannedBandOf(100, BUDGETS)).toBe('low');
    expect(plannedBandOf(101, BUDGETS)).toBe('moderate');
    expect(plannedBandOf(200, BUDGETS)).toBe('moderate');
    expect(plannedBandOf(201, BUDGETS)).toBe('high');
    expect(plannedBandOf(900, BUDGETS)).toBe('high');
    expect(plannedBandOf(0, BUDGETS)).toBeNull();
  });
});

describe('buildFightsReport', () => {
  it('measures three fights and says the party is tougher than planned', () => {
    const records = [
      ...fightRecords('c1', T0, 100, 2),
      ...fightRecords('c2', T0 + 60_000, 200, 4),
      ...fightRecords('c3', T0 + 120_000, 400, 10),
    ];
    const report = buildFightsReport(
      buildStats({ worldId: 'w', logEvents: [], playRecords: records }).sessions
    );
    expect(report.fights.map(f => f.plannedBand)).toEqual(['low', 'moderate', 'high']);
    expect(report.fights.map(f => f.hpLostPct)).toEqual([5, 10, 25]);
    expect(report.fights.map(f => f.rounds)).toEqual([3, 3, 3]);
    expect(report.measured).toBe(3);
    // targets 12.5 + 30 + 55 = 97.5 over actual 40 -> clamped to 2
    expect(report.toughness).toBe(2);
    expect(report.inBandPct).toBe(33);
    expect(report.byBand.moderate).toEqual({ fights: 1, avgHpLostPct: 10 });
  });

  it('gives no toughness until a fight with a plan has finished', () => {
    const report = buildFightsReport(
      buildStats({ worldId: 'w', logEvents: [], playRecords: [] }).sessions
    );
    expect(report.toughness).toBeNull();
    expect(report.summary).toMatch(/0 of 3 finished fights/);
  });

  it('fights that hurt more than planned lower toughness', () => {
    const records = [
      ...fightRecords('c1', T0, 200, 30), // moderate, 75% lost, target mid 30
      ...fightRecords('c2', T0 + 60_000, 200, 30),
      ...fightRecords('c3', T0 + 120_000, 200, 30),
    ];
    const report = buildFightsReport(
      buildStats({ worldId: 'w', logEvents: [], playRecords: records }).sessions
    );
    expect(report.toughness).toBe(0.5);
    expect(report.fights[0]?.inBand).toBe(false);
  });

  it('gives no toughness from fewer than three finished fights, even a free one', () => {
    const records = [...fightRecords('c1', T0, 100, 0), ...fightRecords('c2', T0 + 60_000, 100, 0)];
    const report = buildFightsReport(
      buildStats({ worldId: 'w', logEvents: [], playRecords: records }).sessions
    );
    expect(report.measured).toBe(2);
    expect(report.toughness).toBeNull();
    expect(report.summary).toMatch(/2 of 3/);
  });

  it('a fight that cost nothing counts as 1%, so one free fight does not read as infinitely easy', () => {
    const records = [
      ...fightRecords('c1', T0, 200, 0),
      ...fightRecords('c2', T0 + 60_000, 200, 12),
      ...fightRecords('c3', T0 + 120_000, 200, 12),
    ];
    const report = buildFightsReport(
      buildStats({ worldId: 'w', logEvents: [], playRecords: records }).sessions
    );
    // targets 90 over 1 + 30 + 30 = 61 -> 1.48
    expect(report.toughness).toBe(1.48);
  });
});
