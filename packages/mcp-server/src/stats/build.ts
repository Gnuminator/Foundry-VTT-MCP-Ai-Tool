/**
 * Stats builder (docs/design/OBSIDIAN-PLAN.md section 8, O3): turns the raw play log
 * and the session log into a {@link StatsModel} (`stats/types.ts`) - campaign
 * totals, per-session, per-PC and dice statistics, rendered as `Stats/` notes
 * (`obsidian/render.ts`) and returned by the `get-play-stats` tool.
 *
 * Pure and deterministic: same input, same output, no clock reads, every
 * array sorted. Sessions are grouped exactly like the session notes
 * (`obsidian/grouping.ts`, shared contract 5: the union of session-log events
 * and play records), so a session number here always names the same span of
 * play as the session note of the same number.
 *
 * `shared/src/play-log.ts` pins each record's `kind`, its common fields
 * (`t`, `actor`, `combat`, `sceneId`, `roll`, `source`) and a `key`, but not
 * the exact shape of `path`/`before`/`after`/`data` for every kind - that is
 * the module recorder's own choice (Worker D, built alongside this). Where
 * this module has to guess a shape it does so defensively (missing or
 * unexpected fields degrade gracefully, they never throw) and the guess is
 * documented at the point it is made.
 */
import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';

import { localDateKey } from '../event-pump.js';
import { eventTimeMs, groupWithPlayRecords, type SessionEvent } from '../obsidian/grouping.js';

import type {
  CombatStats,
  DiceStats,
  HighestRoll,
  PcStats,
  SessionStats,
  StatsModel,
  Tally,
} from './types.js';

/** The d20 rolls that can be a session's highest roll (damage and healing totals do not count). */
const HIGHEST_ROLL_TYPES: ReadonlySet<string> = new Set([
  'attack',
  'save',
  'check',
  'skill',
  'tool',
  'initiative',
  'death',
]);

export interface BuildStatsInput {
  worldId: string;
  logEvents: SessionEvent[];
  playRecords: PlayRecord[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Smallest and largest of a list without spreading it into Math.min/max: a spread passes every
 * element as an argument, and a long play log (hundreds of thousands of records) overflows the
 * call stack ("Maximum call stack size exceeded").
 */
function minOf(values: readonly number[]): number {
  let min = Infinity;
  for (const v of values) if (v < min) min = v;
  return min;
}

function maxOf(values: readonly number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  return max;
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  if (amount === 0) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function tallyFromMap(map: Map<string, number>): Tally {
  const out: Tally = {};
  for (const key of [...map.keys()].sort()) out[key] = map.get(key) as number;
  return out;
}

/** `record.delta` when present, else `after - before` for a numeric pair. */
function numDelta(record: PlayRecord): number {
  if (typeof record.delta === 'number' && Number.isFinite(record.delta)) return record.delta;
  const before = typeof record.before === 'number' ? record.before : undefined;
  const after = typeof record.after === 'number' ? record.after : undefined;
  if (before !== undefined && after !== undefined) return after - before;
  return 0;
}

/** `system.spells.<key>.value` -> `<key>`; falls back to the raw path. */
function slotKeyFromPath(path: string | undefined): string {
  return /^system\.spells\.([^.]+)\.value$/.exec(path ?? '')?.[1] ?? path ?? 'unknown';
}

/** `system.resources.<key>.value` -> `<key>`; falls back to the raw path. */
function resourceKeyFromPath(path: string | undefined): string {
  return /^system\.resources\.([^.]+)\.value$/.exec(path ?? '')?.[1] ?? path ?? 'unknown';
}

/** `system.currency.<denomination>` -> `<denomination>`; falls back to the raw path. */
function currencyKeyFromPath(path: string | undefined): string {
  return /^system\.currency\.([^.]+)$/.exec(path ?? '')?.[1] ?? path ?? 'unknown';
}

/**
 * A scene's display name, when the record's own `data` carries one (a `scene`
 * record's guessed shape: `data.sceneName` or `data.name`). Other kinds never
 * carry this; callers get `null` and fall back to the id.
 */
function sceneNameFromData(record: PlayRecord): string | null {
  const data = record.data;
  if (typeof data?.sceneName === 'string') return data.sceneName;
  if (typeof data?.name === 'string') return data.name;
  return null;
}

/** Scene id -> name, from every `scene` record across the whole log. */
export function buildSceneNameIndex(playRecords: PlayRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const record of playRecords) {
    if (record.kind !== 'scene') continue;
    const name = sceneNameFromData(record);
    if (name && record.sceneId) index.set(record.sceneId, name);
  }
  return index;
}

export function sceneName(
  sceneId: string | null | undefined,
  index: Map<string, string>
): string | null {
  if (!sceneId) return null;
  return index.get(sceneId) ?? sceneId;
}

/** Every `roll` record, keyed by the chat message it came from (`source.messageId`).
 * Several rolls (attack, damage) can share one message. */
function buildRollsByMessage(playRecords: PlayRecord[]): Map<string, PlayRecord[]> {
  const byMessage = new Map<string, PlayRecord[]>();
  for (const record of playRecords) {
    if (record.kind !== 'roll') continue;
    const messageId = record.source?.messageId;
    if (!messageId) continue;
    const list = byMessage.get(messageId);
    if (list) list.push(record);
    else byMessage.set(messageId, [record]);
  }
  return byMessage;
}

/**
 * The actor an attributed HP change is credited to: the roll sharing the HP
 * record's `source.messageId`, preferring one whose `rollType` matches
 * (`damage` for a loss, `healing` for a gain) when several rolls share a
 * message, else the first one found. `null` when the change is not
 * attributed, or no roll is known for that message.
 */
function attributedActor(
  hpRecord: PlayRecord,
  rollsByMessage: Map<string, PlayRecord[]>,
  wantType: 'damage' | 'healing'
): PlayActorRef | null {
  if (!hpRecord.source?.attributed || !hpRecord.source.messageId) return null;
  const candidates = rollsByMessage.get(hpRecord.source.messageId);
  if (!candidates || candidates.length === 0) return null;
  const chosen = candidates.find(r => r.roll?.rollType === wantType) ?? candidates[0];
  return chosen?.actor ?? null;
}

/** The combatant names a `combat-start`/`combat-end` record lists (`data.roster`); older records have none. */
function rosterOf(record: PlayRecord): string[] {
  const roster = record.data?.roster;
  return Array.isArray(roster)
    ? roster.filter((n): n is string => typeof n === 'string' && !!n)
    : [];
}

/** userId -> name: a record's `userName`, or a `user-join`/`user-leave` record's
 * `data.name`; the newest name wins (records are in time order). */
function buildUserNames(playRecords: PlayRecord[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const record of playRecords) {
    if (!record.userId) continue;
    const joinName =
      record.kind === 'user-join' || record.kind === 'user-leave' ? record.data?.name : undefined;
    const name = record.userName ?? joinName;
    if (typeof name === 'string' && name.trim()) names.set(record.userId, name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Mutable accumulators (converted to the immutable StatsModel shapes at the end)
// ---------------------------------------------------------------------------

interface CombatBuilder {
  combatId: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  maxRound: number;
  sceneName: string | null;
  participants: Set<string>;
  damageTaken: Map<string, number>;
  damageDealt: Map<string, number>;
  healing: Map<string, number>;
  downs: string[];
  kills: string[];
  crits: number;
  fumbles: number;
}

function newCombatBuilder(combatId: string): CombatBuilder {
  return {
    combatId,
    startedAtMs: null,
    endedAtMs: null,
    maxRound: 0,
    sceneName: null,
    participants: new Set(),
    damageTaken: new Map(),
    damageDealt: new Map(),
    healing: new Map(),
    downs: [],
    kills: [],
    crits: 0,
    fumbles: 0,
  };
}

interface PcAccumulator {
  uuid: string;
  name: string;
  sessions: Set<number>;
  damageDealt: number;
  damageTaken: number;
  healingReceived: number;
  downs: number;
  kills: number;
  rolls: number;
  crits: number;
  fumbles: number;
  d20: number[];
  spellsCast: number;
  slotsSpent: Map<string, number>;
  resourcesSpent: Map<string, number>;
  itemsUsed: number;
  lootGained: Map<string, number>;
  currencyDelta: Map<string, number>;
  xpGained: number;
}

function newPcAccumulator(actor: PlayActorRef): PcAccumulator {
  return {
    uuid: actor.uuid,
    name: actor.name,
    sessions: new Set(),
    damageDealt: 0,
    damageTaken: 0,
    healingReceived: 0,
    downs: 0,
    kills: 0,
    rolls: 0,
    crits: 0,
    fumbles: 0,
    d20: new Array<number>(20).fill(0),
    spellsCast: 0,
    slotsSpent: new Map(),
    resourcesSpent: new Map(),
    itemsUsed: 0,
    lootGained: new Map(),
    currencyDelta: new Map(),
    xpGained: 0,
  };
}

interface DiceAccumulator {
  d20: number[];
  byUser: Map<string, { rolls: number; nat20: number; nat1: number; sum: number }>;
}

/** The kept d20 results of a roll (its `dice` entries with 20 faces). */
/** dnd5e skill and ability keys, for a roll label when the record has none. */
const SKILL_NAMES: Readonly<Record<string, string>> = {
  acr: 'Acrobatics',
  ani: 'Animal Handling',
  arc: 'Arcana',
  ath: 'Athletics',
  dec: 'Deception',
  his: 'History',
  ins: 'Insight',
  itm: 'Intimidation',
  inv: 'Investigation',
  med: 'Medicine',
  nat: 'Nature',
  prc: 'Perception',
  prf: 'Performance',
  per: 'Persuasion',
  rel: 'Religion',
  slt: 'Sleight of Hand',
  ste: 'Stealth',
  sur: 'Survival',
};
const ABILITY_NAMES: Readonly<Record<string, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/**
 * What a roll was: its own label, or one made from its type and subject key ("Perception
 * check", "Constitution save"); dnd5e 6 skill and save messages often carry no label.
 */
function rollLabel(roll: NonNullable<PlayRecord['roll']>): string | null {
  if (roll.label) return roll.label;
  const key = roll.subject ?? '';
  switch (roll.rollType) {
    case 'skill':
      return SKILL_NAMES[key] ? `${SKILL_NAMES[key]} check` : 'Skill check';
    case 'check':
      return ABILITY_NAMES[key] ? `${ABILITY_NAMES[key]} check` : 'Ability check';
    case 'save':
      return ABILITY_NAMES[key] ? `${ABILITY_NAMES[key]} save` : 'Saving throw';
    case 'attack':
      return 'Attack';
    case 'initiative':
      return 'Initiative';
    case 'death':
      return 'Death save';
    case 'tool':
      return 'Tool check';
    default:
      return null;
  }
}

function d20Results(record: PlayRecord): number[] {
  const dice = record.roll?.dice ?? [];
  return dice.filter(d => d.faces === 20).flatMap(d => d.results);
}

// ---------------------------------------------------------------------------
// Per-session build
// ---------------------------------------------------------------------------

interface SessionContext {
  sceneIndex: Map<string, string>;
  rollsByMessage: Map<string, PlayRecord[]>;
  userNames: Map<string, string>;
  pcs: Map<string, PcAccumulator>;
  /** Player characters no player owns in any record (spare and test characters, I-120). */
  spare: ReadonlySet<string>;
  dice: DiceAccumulator;
}

/** A party member: a player character a player owns (or whose records do not say). */
function isParty(
  actor: PlayActorRef | null | undefined,
  ctx: SessionContext
): actor is PlayActorRef {
  return !!actor?.isPC && !ctx.spare.has(actor.uuid);
}

/** Characters marked as not player-owned in some record and owned in none (a character handed
 * out later counts for the whole world, matching its per-PC stats). */
function spareCharacters(records: readonly PlayRecord[]): Set<string> {
  const owned = new Set<string>();
  const unowned = new Set<string>();
  for (const record of records) {
    const actor = record.actor;
    if (!actor?.isPC) continue;
    if (actor.playerOwned === true) owned.add(actor.uuid);
    else if (actor.playerOwned === false) unowned.add(actor.uuid);
  }
  for (const uuid of owned) unowned.delete(uuid);
  return unowned;
}

function pcFor(actor: PlayActorRef, ctx: SessionContext, sessionNumber: number): PcAccumulator {
  let pc = ctx.pcs.get(actor.uuid);
  if (!pc) {
    pc = newPcAccumulator(actor);
    ctx.pcs.set(actor.uuid, pc);
  }
  pc.sessions.add(sessionNumber);
  return pc;
}

function buildSession(
  number: number,
  group: { events: SessionEvent[]; playRecords: PlayRecord[] },
  ctx: SessionContext
): SessionStats {
  const records = group.playRecords;
  const allTimes = [...group.events.map(eventTimeMs), ...records.map(r => r.t)].filter(t =>
    Number.isFinite(t)
  );
  const startedAtMs = allTimes.length ? minOf(allTimes) : 0;
  const endedAtMs = allTimes.length ? maxOf(allTimes) : startedAtMs;
  const date = localDateKey(startedAtMs);

  const combats = new Map<string, CombatBuilder>();
  const combatFor = (id: string): CombatBuilder => {
    let c = combats.get(id);
    if (!c) {
      c = newCombatBuilder(id);
      combats.set(id, c);
    }
    return c;
  };

  const userIds = new Set<string>();
  let rolls = 0;
  let crits = 0;
  let fumbles = 0;
  let spellsCast = 0;
  let itemsUsed = 0;
  let spellSlotsSpent = 0;
  let resourcesSpent = 0;
  let partyDamageDealt = 0;
  let partyDamageTaken = 0;
  let partyHealing = 0;
  let pcDowns = 0;
  const pcDownsByName = new Map<string, number>();
  let npcKills = 0;
  let gameSeconds = 0;
  let highestRoll: HighestRoll | null = null;

  for (const record of records) {
    switch (record.kind) {
      case 'combat-start': {
        const id = record.combat?.id;
        if (!id) break;
        const c = combatFor(id);
        c.startedAtMs ??= record.t;
        c.sceneName ??= sceneName(record.sceneId, ctx.sceneIndex);
        if (record.combat) c.maxRound = Math.max(c.maxRound, record.combat.round);
        for (const name of rosterOf(record)) c.participants.add(name);
        break;
      }
      case 'combat-turn': {
        const combat = record.combat;
        if (!combat) break;
        const c = combatFor(combat.id);
        c.maxRound = Math.max(c.maxRound, combat.round);
        c.sceneName ??= sceneName(record.sceneId, ctx.sceneIndex);
        if (record.actor?.name) c.participants.add(record.actor.name);
        break;
      }
      case 'combat-end': {
        const combat = record.combat;
        if (!combat) break;
        const c = combatFor(combat.id);
        c.endedAtMs = record.t;
        c.maxRound = Math.max(c.maxRound, combat.round);
        for (const name of rosterOf(record)) c.participants.add(name);
        break;
      }
      case 'roll': {
        rolls++;
        if (record.roll?.crit) crits++;
        if (record.roll?.fumble) fumbles++;
        if (record.userId) userIds.add(record.userId);
        const results = d20Results(record);
        for (const v of results) if (v >= 1 && v <= 20) ctx.dice.d20[v - 1] += 1;
        if (record.userId) {
          const key = ctx.userNames.get(record.userId) ?? record.userId;
          const u = ctx.dice.byUser.get(key) ?? { rolls: 0, nat20: 0, nat1: 0, sum: 0 };
          for (const v of results) {
            u.rolls++;
            if (v === 20) u.nat20++;
            if (v === 1) u.nat1++;
            u.sum += v;
          }
          ctx.dice.byUser.set(key, u);
        }
        if (isParty(record.actor, ctx)) {
          const roll = record.roll;
          if (roll && HIGHEST_ROLL_TYPES.has(roll.rollType) && Number.isFinite(roll.total)) {
            if (!highestRoll || roll.total > highestRoll.total) {
              highestRoll = {
                total: roll.total,
                name: record.actor.name,
                label: rollLabel(roll),
                rollType: roll.rollType,
                natural: roll.natural ?? d20Results(record)[0] ?? null,
                at: new Date(record.t).toISOString(),
              };
            }
          }
          const pc = pcFor(record.actor, ctx, number);
          pc.rolls++;
          if (record.roll?.crit) pc.crits++;
          if (record.roll?.fumble) pc.fumbles++;
          for (const v of results) if (v >= 1 && v <= 20) pc.d20[v - 1] += 1;
        }
        if (record.combat) {
          const c = combatFor(record.combat.id);
          if (record.roll?.crit) c.crits++;
          if (record.roll?.fumble) c.fumbles++;
        }
        break;
      }
      case 'item-use': {
        itemsUsed++;
        const isSpell = record.item?.type === 'spell';
        if (isSpell) spellsCast++;
        if (isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          pc.itemsUsed++;
          if (isSpell) pc.spellsCast++;
        }
        break;
      }
      case 'slot': {
        const delta = numDelta(record);
        if (delta >= 0) break;
        spellSlotsSpent += -delta;
        if (isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.slotsSpent, slotKeyFromPath(record.path), -delta);
        }
        break;
      }
      case 'resource': {
        const delta = numDelta(record);
        if (delta >= 0) break;
        resourcesSpent += -delta;
        if (isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.resourcesSpent, resourceKeyFromPath(record.path), -delta);
        }
        break;
      }
      case 'item-uses': {
        const delta = numDelta(record);
        const legacy = (record.path ?? '').endsWith('.value');
        const spent = legacy ? (delta < 0 ? -delta : 0) : delta > 0 ? delta : 0;
        if (spent <= 0) break;
        resourcesSpent += spent;
        if (isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.resourcesSpent, record.item?.name ?? 'Item uses', spent);
        }
        break;
      }
      case 'hit-dice': {
        const delta = numDelta(record);
        if (delta <= 0) break;
        resourcesSpent += delta;
        if (isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.resourcesSpent, record.item?.name ?? 'Hit dice', delta);
        }
        break;
      }
      case 'item-create': {
        if (isParty(record.actor, ctx) && record.item) {
          const pc = pcFor(record.actor, ctx, number);
          const qty = typeof record.after === 'number' ? record.after : 1;
          bump(pc.lootGained, record.item.name, qty);
        }
        break;
      }
      case 'item-quantity': {
        const delta = numDelta(record);
        if (delta > 0 && isParty(record.actor, ctx) && record.item) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.lootGained, record.item.name, delta);
        }
        break;
      }
      case 'currency': {
        const delta = numDelta(record);
        if (delta !== 0 && isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          bump(pc.currencyDelta, currencyKeyFromPath(record.path), delta);
        }
        break;
      }
      case 'xp': {
        const delta = numDelta(record);
        if (delta > 0 && isParty(record.actor, ctx)) {
          const pc = pcFor(record.actor, ctx, number);
          pc.xpGained += delta;
        }
        break;
      }
      case 'hp': {
        const actor = record.actor;
        if (!actor) break;
        if (record.combat) combatFor(record.combat.id).participants.add(actor.name);
        const delta = numDelta(record);
        const before = typeof record.before === 'number' ? record.before : null;
        const after = typeof record.after === 'number' ? record.after : null;
        if (delta < 0) {
          const amount = -delta;
          if (isParty(actor, ctx)) {
            partyDamageTaken += amount;
            pcFor(actor, ctx, number).damageTaken += amount;
          }
          if (record.combat) bump(combatFor(record.combat.id).damageTaken, actor.name, amount);
          const attacker = attributedActor(record, ctx.rollsByMessage, 'damage');
          if (attacker) {
            if (isParty(attacker, ctx)) {
              partyDamageDealt += amount;
              pcFor(attacker, ctx, number).damageDealt += amount;
            }
            if (record.combat) bump(combatFor(record.combat.id).damageDealt, attacker.name, amount);
          }
          if (before !== null && after !== null && before > 0 && after <= 0) {
            if (actor.isPC) {
              // A spare character's down stays in its fight, out of the party counts.
              if (record.combat) combatFor(record.combat.id).downs.push(actor.name);
              if (isParty(actor, ctx)) {
                pcDowns++;
                pcDownsByName.set(actor.name, (pcDownsByName.get(actor.name) ?? 0) + 1);
                pcFor(actor, ctx, number).downs++;
              }
            } else {
              npcKills++;
              if (record.combat) combatFor(record.combat.id).kills.push(actor.name);
              if (isParty(attacker, ctx)) pcFor(attacker, ctx, number).kills++;
            }
          }
        } else if (delta > 0) {
          const amount = delta;
          if (isParty(actor, ctx)) {
            partyHealing += amount;
            pcFor(actor, ctx, number).healingReceived += amount;
          }
          if (record.combat) bump(combatFor(record.combat.id).healing, actor.name, amount);
        }
        break;
      }
      case 'world-time': {
        const delta = numDelta(record);
        if (delta > 0) gameSeconds += delta;
        break;
      }
      case 'user-join':
      case 'user-leave':
        if (record.userId) userIds.add(record.userId);
        break;
      default:
        break;
    }
  }

  // Scene minutes: every record names the scene the GM was viewing, so the
  // time from one record to the next counts for the earlier record's scene
  // (the last one runs to the session end). `scene` records only name scenes.
  const sceneMinutes: Tally = {};
  const timeline = [...records].filter(r => r.sceneId).sort((a, b) => a.t - b.t);
  for (let i = 0; i < timeline.length; i++) {
    const current = timeline[i];
    if (!current) continue;
    const nextMs = timeline[i + 1]?.t ?? endedAtMs;
    const minutes = Math.max(0, (nextMs - current.t) / 60000);
    const label = sceneName(current.sceneId, ctx.sceneIndex) ?? 'Unknown scene';
    sceneMinutes[label] = Math.round(((sceneMinutes[label] ?? 0) + minutes) * 10) / 10;
  }

  const gmChanges = group.events.filter(e => e.eventType === 'gm-change').length;
  const users = [...userIds].map(id => ctx.userNames.get(id) ?? id).sort();

  const combatList: CombatStats[] = [...combats.values()]
    .sort(
      (a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0) || a.combatId.localeCompare(b.combatId)
    )
    .map(c => ({
      combatId: c.combatId,
      startedAt: new Date(c.startedAtMs ?? startedAtMs).toISOString(),
      endedAt: c.endedAtMs !== null ? new Date(c.endedAtMs).toISOString() : null,
      rounds: c.maxRound,
      sceneName: c.sceneName,
      participants: [...c.participants].sort(),
      damageTaken: tallyFromMap(c.damageTaken),
      damageDealt: tallyFromMap(c.damageDealt),
      healing: tallyFromMap(c.healing),
      downs: c.downs,
      kills: c.kills,
      crits: c.crits,
      fumbles: c.fumbles,
    }));

  return {
    number,
    label: `${date} S${sessionLabelOf(number)}`,
    date,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMin: Math.max(0, Math.round((endedAtMs - startedAtMs) / 60000)),
    playRecords: records.length,
    combats: combatList,
    combatRounds: combatList.reduce((sum, c) => sum + c.rounds, 0),
    partyDamageDealt,
    partyDamageTaken,
    partyHealing,
    pcDowns,
    pcDownsByName: tallyFromMap(pcDownsByName),
    npcKills,
    rolls,
    crits,
    fumbles,
    spellsCast,
    spellSlotsSpent,
    resourcesSpent,
    itemsUsed,
    gmChanges,
    sceneMinutes,
    users,
    gameSeconds,
    highestRoll,
  };
}

function sessionLabelOf(n: number): string {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

/** Build the whole {@link StatsModel} from a world's logs. Pure, deterministic. */
export function buildStats(input: BuildStatsInput): StatsModel {
  const groups = groupWithPlayRecords(input.logEvents, input.playRecords);
  const ctx: SessionContext = {
    sceneIndex: buildSceneNameIndex(input.playRecords),
    rollsByMessage: buildRollsByMessage(input.playRecords),
    userNames: buildUserNames(input.playRecords),
    pcs: new Map(),
    spare: spareCharacters(input.playRecords),
    dice: { d20: new Array<number>(20).fill(0), byUser: new Map() },
  };

  const sessions = groups.map((group, i) => buildSession(i + 1, group, ctx));

  // Only characters a player owns (I-120): spare and test characters never reach `ctx.pcs`
  // (`isParty`). Records from before `playerOwned` do not say, so those characters stay.
  const pcs: PcStats[] = [...ctx.pcs.values()]
    .map(
      (pc): PcStats => ({
        uuid: pc.uuid,
        name: pc.name,
        sessions: [...pc.sessions].sort((a, b) => a - b),
        damageDealt: pc.damageDealt,
        damageTaken: pc.damageTaken,
        healingReceived: pc.healingReceived,
        downs: pc.downs,
        kills: pc.kills,
        rolls: pc.rolls,
        crits: pc.crits,
        fumbles: pc.fumbles,
        d20: pc.d20,
        spellsCast: pc.spellsCast,
        slotsSpent: tallyFromMap(pc.slotsSpent),
        resourcesSpent: tallyFromMap(pc.resourcesSpent),
        itemsUsed: pc.itemsUsed,
        lootGained: tallyFromMap(pc.lootGained),
        currencyDelta: tallyFromMap(pc.currencyDelta),
        xpGained: pc.xpGained,
      })
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));

  const byUser: DiceStats['byUser'] = {};
  for (const name of [...ctx.dice.byUser.keys()].sort()) {
    const u = ctx.dice.byUser.get(name);
    if (!u) continue;
    byUser[name] = {
      rolls: u.rolls,
      nat20: u.nat20,
      nat1: u.nat1,
      average: u.rolls > 0 ? Math.round((u.sum / u.rolls) * 100) / 100 : 0,
    };
  }

  const allTimes = [...input.logEvents.map(eventTimeMs), ...input.playRecords.map(r => r.t)].filter(
    t => Number.isFinite(t)
  );
  const lastRecordAt = allTimes.length ? new Date(maxOf(allTimes)).toISOString() : null;

  return {
    schema: 1,
    worldId: input.worldId,
    sessions,
    pcs,
    dice: { d20: ctx.dice.d20, byUser },
    campaign: {
      sessions: sessions.length,
      playMinutes: sessions.reduce((sum, s) => sum + s.durationMin, 0),
      combats: sessions.reduce((sum, s) => sum + s.combats.length, 0),
      rounds: sessions.reduce((sum, s) => sum + s.combatRounds, 0),
      pcDowns: sessions.reduce((sum, s) => sum + s.pcDowns, 0),
      npcKills: sessions.reduce((sum, s) => sum + s.npcKills, 0),
      rolls: sessions.reduce((sum, s) => sum + s.rolls, 0),
      crits: sessions.reduce((sum, s) => sum + s.crits, 0),
      fumbles: sessions.reduce((sum, s) => sum + s.fumbles, 0),
      spellsCast: sessions.reduce((sum, s) => sum + s.spellsCast, 0),
      gameSeconds: sessions.reduce((sum, s) => sum + s.gameSeconds, 0),
      lastRecordAt,
    },
  };
}
