/**
 * Play statistics (docs/design/OBSIDIAN-PLAN.md section 8, O3): derived from the raw
 * play log (`sessions/<date>.play.jsonl`) and the session log
 * (`sessions/<date>.jsonl`, for session markers and guarded changes) by a pure,
 * deterministic builder. Nothing here is stored as truth: it can be rebuilt
 * from the logs at any time, and a rebuild equals the incremental result.
 *
 * Counting rules: damage and healing come from HP deltas (`hp` records), never
 * from damage rolls, so nothing is counted twice. A PC "down" is an `hp` record
 * that takes a PC from above 0 to 0 or below; an NPC "kill" the same for an
 * NPC. Damage "dealt" is credited to the actor of the roll a HP change is
 * attributed to (`source.messageId`), when there is one.
 */

/** Numbers keyed by a name (actor, damage type, resource, denomination...). */
export type Tally = Record<string, number>;

export interface CombatStats {
  combatId: string;
  startedAt: string;
  endedAt: string | null;
  rounds: number;
  sceneName: string | null;
  /** Actor names that had a turn, sorted. */
  participants: string[];
  /** HP lost per actor name. */
  damageTaken: Tally;
  /** HP lost by others, credited to the attacker's name (attributed HP changes only). */
  damageDealt: Tally;
  /** HP regained per actor name. */
  healing: Tally;
  /** PC names that went down (each time), in order. */
  downs: string[];
  /** NPC names that dropped to 0, in order. */
  kills: string[];
  crits: number;
  fumbles: number;
}

export interface SessionStats {
  /** 1-based, the same numbering as the session notes (O2 grouping over both logs). */
  number: number;
  /** `<local date> S<NN>`, the session note's file name without `.md`. */
  label: string;
  date: string;
  startedAt: string;
  endedAt: string;
  durationMin: number;
  playRecords: number;
  combats: CombatStats[];
  combatRounds: number;
  partyDamageDealt: number;
  partyDamageTaken: number;
  partyHealing: number;
  pcDowns: number;
  npcKills: number;
  rolls: number;
  crits: number;
  fumbles: number;
  spellsCast: number;
  spellSlotsSpent: number;
  resourcesSpent: number;
  itemsUsed: number;
  gmChanges: number;
  /** Minutes per scene name (time between scene records), sorted by name. */
  sceneMinutes: Tally;
  /** User names seen joining or acting. */
  users: string[];
  /** In-game seconds that passed (world-time records). */
  gameSeconds: number;
}

export interface PcStats {
  uuid: string;
  name: string;
  /** Session numbers with at least one record for this PC. */
  sessions: number[];
  damageDealt: number;
  damageTaken: number;
  healingReceived: number;
  downs: number;
  kills: number;
  rolls: number;
  crits: number;
  fumbles: number;
  /** Natural d20 results 1..20 (index 0 = a natural 1), kept dice only. */
  d20: number[];
  spellsCast: number;
  /** Spell slots spent by slot key (`spell1`, `pact`, ...). */
  slotsSpent: Tally;
  /** Class resources and item uses spent, by name. */
  resourcesSpent: Tally;
  itemsUsed: number;
  /** Items gained (item-create on the PC, or quantity up), by item name. */
  lootGained: Tally;
  /** Net change per currency denomination. */
  currencyDelta: Tally;
  xpGained: number;
}

export interface DiceStats {
  /** Natural d20 results 1..20 across everyone, kept dice only. */
  d20: number[];
  /** Per user name: d20 rolls, natural 20s and 1s, average natural d20. */
  byUser: Record<string, { rolls: number; nat20: number; nat1: number; average: number }>;
}

export interface StatsModel {
  schema: 1;
  worldId: string;
  sessions: SessionStats[];
  /** Sorted by name. */
  pcs: PcStats[];
  dice: DiceStats;
  campaign: {
    sessions: number;
    playMinutes: number;
    combats: number;
    rounds: number;
    pcDowns: number;
    npcKills: number;
    rolls: number;
    crits: number;
    fumbles: number;
    spellsCast: number;
    gameSeconds: number;
    /** Time of the newest record in the logs (ISO), or null. */
    lastRecordAt: string | null;
  };
}
