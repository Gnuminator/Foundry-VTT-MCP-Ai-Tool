/**
 * Encounter afterglow: joins what a fight was planned to be (the plan the module stamps on
 * `combat-start`) with what it cost (HP lost as a share of the party's max, rounds, slots, downs),
 * and turns the finished fights into a party "toughness" factor that
 * `suggest-balanced-encounter` can take as input. Pure, no clock, no I/O.
 */
import type { CombatStats, FightPlan, SessionStats } from './types.js';

/** The plan a `combat-start` record carries (`data.plan`), or null for older or malformed ones. */
export function parseFightPlan(value: unknown): FightPlan | null {
  const raw = value as Partial<FightPlan> | null | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.party) || !raw.budgets) return null;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    party: raw.party.map(p => ({
      name: String(p?.name ?? ''),
      level: n(p?.level),
      hpMax: n(p?.hpMax),
    })),
    foes: n(raw.foes),
    foeXp: n(raw.foeXp),
    budgets: {
      low: n(raw.budgets.low),
      moderate: n(raw.budgets.moderate),
      high: n(raw.budgets.high),
    },
  };
}

export type FightBand = 'low' | 'moderate' | 'high';

/** The share of the party's max HP a fight of that planned size should cost (percent, [from, to]). */
const COST_TARGETS: Record<FightBand, [number, number]> = {
  low: [5, 20],
  moderate: [20, 40],
  high: [40, 70],
};

export interface FightRow {
  combatId: string;
  session: number;
  startedAt: string;
  sceneName: string | null;
  /** The size the foes' XP landed on; null when the fight had no plan or no foe XP. */
  plannedBand: FightBand | null;
  foes: number;
  foeXp: number;
  /** The XP budget of the planned band, null with no band. */
  budgetXp: number | null;
  rounds: number;
  /** HP the party lost as a percent of its max HP; null without a plan. */
  hpLostPct: number | null;
  slotsSpent: number;
  downs: number;
  kills: number;
  finished: boolean;
  /** Inside the cost band of its planned size; null when it cannot be told. */
  inBand: boolean | null;
}

export interface FightsReport {
  fights: FightRow[];
  targets: Record<FightBand, [number, number]>;
  byBand: Record<FightBand, { fights: number; avgHpLostPct: number | null }>;
  /** Fights that finished with a plan and a band (the ones toughness is measured on). */
  measured: number;
  /** Share of measured fights inside their cost band, or null. */
  inBandPct: number | null;
  /**
   * Target cost divided by actual cost over the measured fights, clamped to 0.5 to 2: above 1 the
   * party shrugged its fights off (plan bigger), below 1 they hurt more than planned. Null until
   * a fight has been measured.
   */
  toughness: number | null;
  /** One line a person can read. */
  summary: string;
}

/** Which planned size the foes' XP is closest to: a midpoint between budgets splits the bands. */
export function plannedBandOf(
  foeXp: number,
  budgets: { low: number; moderate: number; high: number }
): FightBand | null {
  if (foeXp <= 0 || budgets.moderate <= 0) return null;
  if (foeXp >= (budgets.moderate + budgets.high) / 2) return 'high';
  if (foeXp >= (budgets.low + budgets.moderate) / 2) return 'moderate';
  return 'low';
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mid = (b: FightBand): number => (COST_TARGETS[b][0] + COST_TARGETS[b][1]) / 2;

function rowOf(session: number, c: CombatStats): FightRow {
  const plan = c.plan;
  const band = plan ? plannedBandOf(plan.foeXp, plan.budgets) : null;
  let hpLostPct: number | null = null;
  if (plan) {
    const hpMax = plan.party.reduce((sum, p) => sum + p.hpMax, 0);
    if (hpMax > 0) {
      const lost = plan.party.reduce((sum, p) => sum + (c.damageTaken[p.name] ?? 0), 0);
      hpLostPct = round1((lost / hpMax) * 100);
    }
  }
  const finished = c.endedAt !== null;
  const inBand =
    band && hpLostPct !== null && finished
      ? hpLostPct >= COST_TARGETS[band][0] && hpLostPct <= COST_TARGETS[band][1]
      : null;
  return {
    combatId: c.combatId,
    session,
    startedAt: c.startedAt,
    sceneName: c.sceneName,
    plannedBand: band,
    foes: plan?.foes ?? 0,
    foeXp: plan?.foeXp ?? 0,
    budgetXp: plan && band ? plan.budgets[band] : null,
    rounds: c.rounds,
    hpLostPct,
    slotsSpent: c.slotsSpent ?? 0,
    downs: c.downs.length,
    kills: c.kills.length,
    finished,
    inBand,
  };
}

export function buildFightsReport(sessions: SessionStats[]): FightsReport {
  const fights = sessions
    .flatMap(s => s.combats.map(c => rowOf(s.number, c)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.combatId.localeCompare(b.combatId));

  const byBand = {} as FightsReport['byBand'];
  for (const band of ['low', 'moderate', 'high'] as FightBand[]) {
    const rows = fights.filter(f => f.plannedBand === band && f.finished && f.hpLostPct !== null);
    byBand[band] = {
      fights: rows.length,
      avgHpLostPct: rows.length
        ? round1(rows.reduce((sum, f) => sum + (f.hpLostPct ?? 0), 0) / rows.length)
        : null,
    };
  }

  const measuredRows = fights.filter(f => f.plannedBand && f.finished && f.hpLostPct !== null);
  const measured = measuredRows.length;
  const inBandPct = measured
    ? Math.round((measuredRows.filter(f => f.inBand).length / measured) * 100)
    : null;

  let toughness: number | null = null;
  if (measured > 0) {
    const target = measuredRows.reduce((sum, f) => sum + mid(f.plannedBand as FightBand), 0);
    const actual = measuredRows.reduce((sum, f) => sum + (f.hpLostPct ?? 0), 0);
    const raw = actual > 0 ? target / actual : 2;
    toughness = Math.round(Math.min(2, Math.max(0.5, raw)) * 100) / 100;
  }

  const summary =
    measured === 0
      ? 'No finished fight with a plan yet, so no toughness is measured.'
      : `${measured} measured fight${measured === 1 ? '' : 's'}, ${inBandPct}% inside their cost band; ` +
        `toughness ${toughness} (${
          (toughness ?? 1) > 1.05
            ? 'the party shrugs these fights off, plan bigger'
            : (toughness ?? 1) < 0.95
              ? 'fights hurt more than planned, plan smaller'
              : 'fights cost about what was planned'
        }).`;

  return { fights, targets: COST_TARGETS, byBand, measured, inBandPct, toughness, summary };
}
