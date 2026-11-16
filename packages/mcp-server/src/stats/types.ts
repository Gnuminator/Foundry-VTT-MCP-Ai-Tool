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

/**
 * What a paper sync (`plan-paper-sync`, `paper-night.ts`) changed on one character: sheet values
 * copied in from paper, not play, so they never reach the damage, healing, slot or loot numbers.
 */
export interface PaperNetPc {
  uuid: string;
  name: string;
  /** HP the sheet lost / regained over the night (sum of the sync's HP changes). */
  hpLost: number;
  hpGained: number;
  /** Spell slots the sheet used / got back. */
  slotsSpent: number;
  slotsRegained: number;
  /** Class resource and item uses, and hit dice, spent. */
  resourcesSpent: number;
  /** Net change per currency denomination (gold is `gp`). */
  currency: Tally;
  xpGained: number;
  itemsGained: Tally;
  itemsLost: Tally;
}

/** The "Paper night: net change" block: what the syncs after a paper night changed, per character. */
export interface PaperNet {
  /** Play records the syncs wrote. */
  records: number;
  characters: PaperNetPc[];
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
  /** Player characters who dropped to 0 HP this session, in a fight or not, by name. */
  pcDownsByName: Tally;
  npcKills: number;
  rolls: number;
  crits: number;
  fumbles: number;
  /**
   * The same three numbers counting only rolls whose play record says `visibility: 'public'`
   * (blind, GM, self and unrecorded rolls are left out). The only session roll counts that may
   * go to the players' Discord channel. Here crits and fumbles are natural 20s and 1s on any
   * public d20 roll; the PC fields of the same names count attack rolls only.
   */
  publicRolls: number;
  publicCrits: number;
  publicFumbles: number;
  spellsCast: number;
  spellSlotsSpent: number;
  resourcesSpent: number;
  itemsUsed: number;
  gmChanges: number;
  /** `paper`: sheets and dice on paper, started with `mark-play-session` `mode: "paper"`. */
  mode: 'live' | 'paper';
  /**
   * Paper night only: the net change of the paper syncs after it (null for a live session, or a
   * paper night nobody has synced). Roll numbers of a paper night are 0 unless Foundry dice were
   * used: physical dice are not tracked.
   */
  paperNet: PaperNet | null;
  /** Minutes per scene name (time between scene records), sorted by name. */
  sceneMinutes: Tally;
  /** User names seen joining or acting. */
  users: string[];
  /** In-game seconds that passed (world-time records). */
  gameSeconds: number;
  /**
   * The session's highest d20 roll by a player character (attack, save, check, skill, tool,
   * initiative or death save; damage and healing do not count), or null without one. The
   * earliest wins a tie. GM-only: this may be a private or blind roll. Players get
   * `PcStats.publicHighestRoll`, which counts public rolls only.
   */
  highestRoll: HighestRoll | null;
}

/** One roll, as `SessionStats.highestRoll` reports it. */
export interface HighestRoll {
  total: number;
  /** The player character's name. */
  name: string;
  /** What was rolled, e.g. `Athletics check`, when the roll says. */
  label: string | null;
  rollType: string;
  /** The kept natural d20 result, when known. */
  natural: number | null;
  /** When it was rolled (ISO). */
  at: string;
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
  /**
   * The same four numbers counting only rolls whose play record says `visibility: 'public'`
   * (blind, GM, self and unrecorded rolls are left out). These are the only roll numbers the
   * player vault may show.
   */
  publicRolls: number;
  publicCrits: number;
  publicFumbles: number;
  publicD20: number[];
  publicHighestRoll: HighestRoll | null;
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
    /** Sessions played on paper (they are also in `sessions`). */
    paperSessions: number;
    /** Net change of every paper sync, including ones no paper night claims; null without any. */
    paperNet: PaperNet | null;
    /** Time of the newest record in the logs (ISO), or null. */
    lastRecordAt: string | null;
  };
}
