/**
 * Play log v2 (docs/design/OBSIDIAN-PLAN.md section 8, O3): one record per thing that
 * happened at the table, captured by the Foundry module on a GM client and
 * appended by the backend to `sessions/<YYYY-MM-DD>.play.jsonl` in the bridge
 * vault (local date of `t`). GM-only: records may carry whispers, blind rolls
 * and NPC names.
 *
 * Records are raw facts; everything else (sessions, per-PC totals, dice
 * spreads) is derived from them and can be rebuilt at any time.
 */

/** What a record describes. */
export type PlayRecordKind =
  // Chat
  | 'roll' // a dice roll from a chat message (one record per roll in the message)
  | 'item-use' // a dnd5e usage card: a spell, feature or item was used
  | 'chat' // a chat message without rolls (in character, out of character, emote, whisper)
  | 'rest' // a short or long rest finished
  // Actor state (before/after from the recorder's shadow copy)
  | 'hp' // system.attributes.hp.value
  | 'hp-temp' // system.attributes.hp.temp
  | 'hp-max' // system.attributes.hp.max
  | 'death-save' // system.attributes.death.success / .failure
  | 'slot' // system.spells.<key>.value
  | 'resource' // system.resources.<key>.value
  | 'currency' // system.currency.<denomination>
  | 'xp' // system.details.xp.value
  | 'level' // character level (sum of class levels) or system.details.level
  // Items on actors
  | 'item-uses' // an item's uses (system.uses.spent, or legacy system.uses.value)
  | 'item-quantity' // system.quantity
  | 'hit-dice' // a class item's system.hd.spent (dnd5e 4+) or legacy hitDiceUsed
  | 'item-create' // an item was added to an actor (loot, purchase, new spell)
  | 'item-delete' // an item was removed from an actor
  // Effects
  | 'effect-add'
  | 'effect-remove'
  // Documents on the canvas
  | 'actor-create'
  | 'actor-delete'
  | 'token-create'
  | 'token-delete'
  | 'token-move' // a token's x/y changed (counted, positions kept)
  | 'scene' // the viewed or active scene changed
  // Combat
  | 'combat-start'
  | 'combat-turn'
  | 'combat-end'
  // Table
  | 'user-join'
  | 'user-leave'
  | 'world-time'; // game.time.worldTime advanced (seconds)

/** An actor as a record names it. Unlinked tokens have their own actor uuid. */
export interface PlayActorRef {
  /** `Actor.<id>`, or `Scene.<id>.Token.<id>.Actor.<id>` for an unlinked token. */
  uuid: string;
  /** The token the change happened through, when known. */
  tokenUuid?: string;
  /** A player character (dnd5e `character`) rather than an NPC. */
  isPC: boolean;
  /**
   * For a `character`: whether a player owns it (Foundry `hasPlayerOwner`). The stats keep a PC
   * only when a player owns it, so test or spare characters get no stats note (I-120). Absent on
   * records from before 2026-10 and on NPCs.
   */
  playerOwned?: boolean;
  name: string;
}

/**
 * One actor on a scene, as `scene` and `user-join` records snapshot it in `data.tokens`: the
 * tokens of the recording GM's viewed scene folded by world actor. Linked and unlinked tokens
 * both name the base world actor, so "who was in the scene" needs no name matching.
 */
export interface PlaySceneToken {
  /** `Actor.<id>` of the base world actor (never a token-synthetic uuid). */
  actorUuid: string;
  /** The base actor's name (the token's own name when the actor is gone). */
  name: string;
  /** A player character (dnd5e `character`) rather than an NPC. */
  isPC: boolean;
  /** Present (true) only when every token of this actor on the scene is hidden. */
  hidden?: true;
}

/** One term of a roll, in order: dice (with what they rolled) or a flat bonus or penalty. */
export type PlayRollPart =
  | {
      kind: 'dice';
      /** e.g. `1d20`, `2d4`, `2d20kh`. */
      formula: string;
      /** Kept results. */
      results: number[];
      dropped?: number[];
      /** A damage type, or where extra dice come from (e.g. `Bless`). */
      label?: string;
      /** -1 when the dice are subtracted. */
      sign?: 1 | -1;
    }
  | {
      kind: 'number';
      /** Signed value as applied (e.g. 2, -1). */
      value: number;
      /** Where it comes from when known or inferred: `DEX`, `proficiency`, `magic`, `skill bonus`; else `modifier`. */
      label: string;
    };

export interface PlayRollInfo {
  /** What was rolled, e.g. `Bite attack`, `Constitution save`, `Perception check`, `Bite damage`. */
  label?: string;
  /** The roll term by term (dice with results, then each bonus or penalty). */
  parts?: PlayRollPart[];
  /** The kept natural d20 result, for d20 rolls. */
  natural?: number;
  formula: string;
  total: number;
  /**
   * Per dice term: the results that counted (`results`) and the ones dropped by
   * keep-highest/lowest or rerolls (`dropped`), so dice statistics use kept dice only.
   */
  dice: Array<{ faces: number; results: number[]; dropped?: number[] }>;
  /** A kept natural 20 on a d20. */
  crit: boolean;
  /** A kept natural 1 on a d20. */
  fumble: boolean;
  advantage: 'advantage' | 'disadvantage' | null;
  /** attack, damage, save, check, skill, tool, initiative, death, hitDie, healing, other. */
  rollType: string;
  /** The ability, skill or tool key when the message names one (e.g. `dex`, `ste`). */
  subject?: string;
  /** Target number when known (save DC, or the target's AC for an attack). */
  dc?: number;
  outcome?: 'success' | 'failure';
  /** Damage types for damage rolls. */
  damageTypes?: string[];
}

export interface PlayItemRef {
  uuid: string;
  name: string;
  /** dnd5e item type: weapon, spell, feat, consumable, loot, class, ... */
  type: string;
}

export interface PlayRecord {
  v: 2;
  /**
   * Deterministic id, the same on every GM client that sees the same change
   * (e.g. `hp:<actorUuid>:<path>:<modifiedTime>`, `roll:<messageId>:<index>`),
   * so the backend can drop duplicates.
   */
  key: string;
  /** Time in ms since the epoch: the document's server `modifiedTime` when there is one. */
  t: number;
  /** The recording client's sequence number (restarts with each page load). */
  seq: number;
  kind: PlayRecordKind;
  /** The user whose action caused the record, when Foundry says. */
  userId: string | null;
  /** That user's name at the time (stats show names, and the backend cannot look them up). */
  userName?: string;
  /** The scene the recording GM was viewing. */
  sceneId: string | null;
  actor?: PlayActorRef;
  combat?: { id: string; round: number; turn: number };
  item?: PlayItemRef;
  /** For state changes: the changed path, the value before and after, and after - before for numbers. */
  path?: string;
  before?: unknown;
  after?: unknown;
  delta?: number;
  roll?: PlayRollInfo;
  /**
   * What caused it: the chat message (rolls, usage cards); for HP changes the
   * damage or healing roll credited with it (`attributed: true`): `exact: true`
   * when dnd5e applied it from that message's card, else a guess (a roll within
   * 10 s whose total fits the change); a guarded change's id for AI Tool writes.
   */
  source?: { messageId?: string; changeId?: string; attributed?: boolean; exact?: boolean };
  /**
   * Kind-specific extras (effect name and statuses, chat style and text, rest type, ...).
   * `scene` records, and `user-join` records of non-GM users, may carry `tokens: PlaySceneToken[]`:
   * the tokens on the recording GM's viewed scene, folded by actor, sorted by `actorUuid`, at
   * most 200 entries. GM-only like everything in the play log (hidden tokens are marked, not
   * dropped).
   */
  data?: Record<string, unknown>;
}

/** Response of the module query `foundry-mcp-bridge.getPlayRecords`. */
export interface PlayRecordsResponse {
  success: boolean;
  error?: string;
  /** Random per page load; a new id means the sequence restarted. */
  clientId: string;
  /** Records with `seq > sinceSeq`, oldest first, at most `limit`. */
  records: PlayRecord[];
  /** Oldest and newest sequence numbers still in the module's buffer (0 when empty). */
  oldestSeq: number;
  latestSeq: number;
}

/** File name of a day's play log in the vault's `sessions` area. */
export function playLogFileName(dateKey: string): string {
  return `${dateKey}.play.jsonl`;
}

export const PLAY_LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.play\.jsonl$/;
