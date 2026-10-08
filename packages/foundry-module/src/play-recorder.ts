import { MODULE_ID } from './constants.js';
import { EffectEventDeduper } from './effect-dedupe.js';
import { hpChangeFitsRoll, originatingMessageId } from './hp-credit.js';
import {
  chatRollKind,
  dnd5eMessageItemRef,
  dnd5eRestType,
  dnd5eRollSubject,
  dnd5eRollType,
  dnd5eSpellLevel,
  isUsageCard,
} from './systems/dnd5e/chat-roll-kind.js';
import type {
  PlayActorRef,
  PlayItemRef,
  PlayRecord,
  PlayRecordKind,
  PlayRecordsResponse,
  PlayRollInfo,
  PlaySceneToken,
} from '@gnuminator/shared';

/**
 * PlayRecorder — the full play-log recorder (docs/design/OBSIDIAN-PLAN.md section 8,
 * O3). A singleton, mirroring `eventTracker` in `session-events.ts`, which it
 * runs alongside (and does not replace): the event tracker's chat-log /
 * session-event buffers are unchanged.
 *
 * Where `eventTracker` keeps a rolling log of human-readable *events*, this
 * keeps a rolling log of raw, typed `PlayRecord`s (one per changed value, roll
 * or lifecycle event) with enough structure for the backend to derive session
 * stats. Foundry's `update*` hooks only carry the *new* values, and
 * `preUpdate*` only fires on the client that made the change, so a true
 * "before" value requires a shadow copy of every watched value, seeded at
 * `ready` and kept current on every hook this class handles.
 *
 * Runs only on a GM client (`game.user.isGM`): every hook handler checks this
 * first, so a non-GM client's recorder never accumulates anything (it may
 * carry whispers, blind rolls and NPC names that must never reach a player's
 * browser). The module query handler (`getPlayRecords`, registered in
 * `queries.ts`) is additionally GM-gated the same way as `getRecentEvents`.
 *
 * Everything here is defensive: a hook handler that throws is caught at the
 * registration site, and a single malformed roll or field is dropped rather
 * than aborting the rest of the message/update it came with.
 *
 * Typing: Foundry's `Hooks.on` callback arguments are `any` at the boundary,
 * and a few ambient document fields are genuinely untyped (`system`, a
 * `FoundryCollection<any>`). Every hook handler takes `unknown` and narrows
 * through the small structural "*Like" interfaces and helpers below
 * (`shape`, `asRecord`, `num`, `str`, `bool`, `arr`), so nothing in this file
 * touches a value whose static type is `any`.
 */

// ---------------------------------------------------------------------------
// Narrow helpers
// ---------------------------------------------------------------------------

/** `v` as a plain object, or null. Also accepts an ambient `any`-typed value. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** Cast an unknown (or ambient `any`) value onto one of the local structural interfaces below. */
function shape<T>(v: unknown): T | null {
  return v !== null && typeof v === 'object' ? (v as T) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** `v` as an array, laundering the `any[]` `Array.isArray` narrows to (its lib.d.ts takes `arg: any`). */
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}

function statusesOf(v: unknown): string[] {
  if (v instanceof Set) return Array.from(v).filter((s): s is string => typeof s === 'string');
  return arr(v).filter((s): s is string => typeof s === 'string');
}

/**
 * `foundry`/`canvas` are ambient `declare global { const ... }` bindings:
 * fully typed, but (like any `const`/`let` global) never merged onto
 * `globalThis`'s type, and not guaranteed to exist at all in a test harness.
 * `typeof` is the one operator that reads an undeclared identifier without
 * throwing, so these are the safe way to read them.
 */
function currentFoundryNamespace(): FoundryNamespace | undefined {
  return typeof foundry === 'undefined' ? undefined : foundry;
}

function currentCanvas(): FoundryCanvas | undefined {
  return typeof canvas === 'undefined' ? undefined : canvas;
}

// ---------------------------------------------------------------------------
// Structural shapes of the Foundry/dnd5e values hook callbacks deliver
// ---------------------------------------------------------------------------

interface ActorLike {
  uuid?: unknown;
  documentName?: unknown;
  name?: unknown;
  type?: unknown;
  system?: unknown;
  items?: unknown;
  isToken?: unknown;
  token?: unknown;
  hasPlayerOwner?: unknown;
}

interface ItemLike {
  uuid?: unknown;
  name?: unknown;
  type?: unknown;
  system?: unknown;
  actor?: unknown;
  parent?: unknown;
}

interface EffectLike {
  uuid?: unknown;
  name?: unknown;
  label?: unknown;
  statuses?: unknown;
  parent?: unknown;
}

interface TokenDocLike {
  uuid?: unknown;
  name?: unknown;
  actor?: unknown;
  actorId?: unknown;
  actorLink?: unknown;
  hidden?: unknown;
  parent?: unknown;
  x?: unknown;
  y?: unknown;
}

interface CombatantLike {
  name?: unknown;
  actor?: unknown;
  hidden?: unknown;
  token?: unknown;
  sceneId?: unknown;
}

interface CombatLike {
  id?: unknown;
  round?: unknown;
  turn?: unknown;
  started?: unknown;
  combatant?: unknown;
  combatants?: unknown;
}

interface UserLike {
  id?: unknown;
  name?: unknown;
  isGM?: unknown;
}

interface ChatMessageLike {
  id?: unknown;
  speaker?: unknown;
  rolls?: unknown;
  content?: unknown;
  style?: unknown;
  whisper?: unknown;
  blind?: unknown;
  author?: unknown;
  timestamp?: unknown;
}

interface SpeakerLike {
  scene?: unknown;
  token?: unknown;
  actor?: unknown;
}

interface DiceResultLike {
  result?: unknown;
  active?: unknown;
}

interface DiceTermLike {
  faces?: unknown;
  number?: unknown;
  modifiers?: unknown;
  results?: unknown;
}

interface RollTermLike {
  options?: unknown;
}

interface RollLike {
  formula?: unknown;
  total?: unknown;
  dice?: unknown;
  terms?: unknown;
  options?: unknown;
}

// ---------------------------------------------------------------------------
// Shadow copy
// ---------------------------------------------------------------------------

/** The scalar (non-map) actor fields this class watches for changes. */
type ActorScalarField =
  | 'hp'
  | 'hpTemp'
  | 'hpMax'
  | 'deathSuccess'
  | 'deathFailure'
  | 'xp'
  | 'level';

interface ItemShadow {
  uuid: string;
  name: string;
  type: string;
  usesSpent: number | null;
  quantity: number | null;
  /** Class items only (`system.hd.spent` / legacy `system.hitDiceUsed`). */
  hdSpent: number | null;
}

interface ActorShadow {
  uuid: string;
  tokenUuid?: string;
  isPC: boolean;
  name: string;
  hp: number | null;
  hpTemp: number | null;
  hpMax: number | null;
  deathSuccess: number | null;
  deathFailure: number | null;
  xp: number | null;
  /** dnd5e `character` only (sum of class item `system.levels`); null for NPCs. */
  level: number | null;
  /** `system.spells.<key>.value`. */
  spells: Record<string, number>;
  /** `system.resources.<key>.value`. */
  resources: Record<string, number>;
  /** `system.currency.<denomination>`. */
  currency: Record<string, number>;
  items: Map<string, ItemShadow>;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Read a dotted path off a plain object, preferring `foundry.utils.getProperty`. */
function getPath(obj: unknown, path: string): unknown {
  const utils = currentFoundryNamespace()?.utils;
  if (utils && obj !== null && typeof obj === 'object') {
    try {
      return utils.getProperty(obj, path);
    } catch {
      // fall through to manual traversal
    }
  }
  return path.split('.').reduce<unknown>((acc, key) => asRecord(acc)?.[key], obj);
}

function numOrNull(value: unknown): number | null {
  return num(value) ?? null;
}

/** A document's server `_stats.modifiedTime`, or null when it has none. */
function modifiedTimeOf(doc: unknown): number | null {
  const stats = asRecord(asRecord(doc)?._stats);
  return numOrNull(stats?.modifiedTime);
}

/** A create/update hook's `_stats.modifiedTime` is trusted only within this many ms of now. */
const FRESH_MODIFIED_TIME_WINDOW_MS = 60_000;

/** `doc`'s `_stats.modifiedTime`, but only when it is within 60s of now (else null — stale or synthetic). */
function freshModifiedTimeOf(doc: unknown): number | null {
  const mt = modifiedTimeOf(doc);
  if (mt === null) return null;
  return Math.abs(Date.now() - mt) <= FRESH_MODIFIED_TIME_WINDOW_MS ? mt : null;
}

interface RecordTime {
  t: number;
  /** Whether `t` came from a fresh `_stats.modifiedTime` (vs falling back to `Date.now()`). */
  fresh: boolean;
}

/**
 * `PlayRecord.t` for a create/update hook: `doc`'s own `_stats.modifiedTime`
 * when it is within 60s of now, else `Date.now()`. A `synthetic` document (an
 * unlinked token's actor, or an item on one) never carries a reliable
 * `modifiedTime` — Foundry returns the base actor's old one — so it always
 * falls back to `Date.now()` even when that stale value looks "fresh".
 */
function createOrUpdateTime(doc: unknown, synthetic: boolean): RecordTime {
  if (!synthetic) {
    const mt = freshModifiedTimeOf(doc);
    if (mt !== null) return { t: mt, fresh: true };
  }
  return { t: Date.now(), fresh: false };
}

/** `PlayRecord.t` for a delete hook: always `Date.now()` — by the time the hook fires the document's own `_stats` is gone or stale. */
function deleteTime(): RecordTime {
  return { t: Date.now(), fresh: false };
}

/** An actor's embedded items as a plain array, whatever collection shape it is. */
function actorItems(actor: ActorLike): ItemLike[] {
  const items = actor.items;
  if (Array.isArray(items)) return items as unknown as ItemLike[];
  const contents = asRecord(items)?.contents;
  return Array.isArray(contents) ? (contents as unknown as ItemLike[]) : [];
}

/** A combat's combatants as a plain array. */
function combatantsOf(combat: CombatLike): CombatantLike[] {
  const combatants = combat.combatants;
  const list = Array.isArray(combatants) ? combatants : asRecord(combatants)?.contents;
  return Array.isArray(list) ? (list as unknown as CombatantLike[]) : [];
}

/** A scene's tokens as a plain array. */
function tokensOf(scene: { tokens?: unknown } | null | undefined): TokenDocLike[] {
  const contents = asRecord(scene)?.tokens;
  const list = Array.isArray(contents) ? contents : asRecord(contents)?.contents;
  return Array.isArray(list) ? (list as unknown as TokenDocLike[]) : [];
}

/** The id of the active scene (the one players see), or null. */
function activeSceneId(): string | null {
  try {
    return str(game.scenes.active?.id) ?? null;
  } catch {
    return null;
  }
}

/** Ids of the non-GM users online now, sorted. */
function onlinePlayerIds(): string[] {
  try {
    return game.users.contents
      .filter(user => user.active && !user.isGM)
      .map(user => str(user.id))
      .filter((id): id is string => id !== undefined)
      .sort();
  } catch {
    return [];
  }
}

/** `whisper`/`blind` flags for records made from a chat message (only the ones that are set). */
function privacyOf(message: ChatMessageLike): Record<string, true> {
  const flags: Record<string, true> = {};
  if (arr(message.whisper).length > 0) flags.whisper = true;
  if (bool(message.blind)) flags.blind = true;
  return flags;
}

/** State kinds that carry `data.hidden: true` when made through a token hidden from players. */
const HIDDEN_FLAG_KINDS: ReadonlySet<string> = new Set([
  'hp',
  'hp-temp',
  'death-save',
  'effect-add',
  'effect-remove',
  'combat-turn',
]);

/**
 * Whether the players cannot see this actor's token. Only the active scene (the one players
 * see) counts: an unlinked actor's own token is hidden or on another scene; a world actor has
 * no token there or every one of them is hidden. A PC without a token there still counts as
 * seen (its players see its sheet). With no active scene, only the token's own flag decides.
 */
function actorTokenHidden(ref: PlayActorRef): boolean {
  try {
    const activeId = activeSceneId();
    if (ref.tokenUuid) {
      const [, sceneId] = ref.tokenUuid.split('.');
      if (activeId && sceneId !== activeId) return !ref.isPC;
      const scene = sceneId ? game.scenes.get(sceneId) : undefined;
      const token = tokensOf(scene).find(t => str(t.uuid) === ref.tokenUuid);
      return bool(token?.hidden);
    }
    const parts = ref.uuid.split('.');
    if (!activeId || parts.length !== 2 || parts[0] !== 'Actor') return false;
    const tokens = tokensOf(game.scenes.get(activeId)).filter(t => str(t.actorId) === parts[1]);
    if (tokens.length === 0) return !ref.isPC;
    return tokens.every(t => bool(t.hidden));
  } catch {
    return false;
  }
}

/**
 * Whether the players cannot see this combatant's turn: hidden in the tracker, its token hidden,
 * or its token on a scene other than the active one. A combatant without a token counts as seen
 * (the tracker shows it).
 */
function combatantHidden(combatant: CombatantLike): boolean {
  try {
    if (bool(combatant.hidden)) return true;
    const token = shape<TokenDocLike>(combatant.token);
    if (!token) return false;
    if (bool(token.hidden)) return true;
    const activeId = activeSceneId();
    const sceneId = str(combatant.sceneId) ?? str(asRecord(token.parent)?.id);
    return Boolean(activeId && sceneId && sceneId !== activeId);
  } catch {
    return false;
  }
}

/** Most actors a scene snapshot lists (`data.tokens` of `scene` and `user-join` records). */
const MAX_SCENE_TOKENS = 200;

/**
 * A scene's tokens folded by base world actor, for the `data.tokens` snapshot: `Actor.<actorId>`
 * for linked and unlinked tokens alike (never the token-synthetic uuid), the base actor's name,
 * `hidden` only when every token of that actor is hidden. Tokens without an actor id are
 * skipped. Sorted by uuid and capped (visible actors are kept before hidden ones), so the same
 * scene always gives the same list.
 */
function sceneTokensOf(sceneId: string | null): PlaySceneToken[] {
  if (!sceneId) return [];
  const scene = game.scenes.get(sceneId);
  const byActor = new Map<string, PlaySceneToken & { allHidden: boolean }>();
  for (const token of tokensOf(scene)) {
    const actorId = str(token.actorId);
    if (!actorId) continue;
    const actorUuid = `Actor.${actorId}`;
    const hidden = bool(token.hidden);
    const known = byActor.get(actorUuid);
    if (known) {
      known.allHidden = known.allHidden && hidden;
      continue;
    }
    const base = shape<ActorLike>(game.actors.get(actorId));
    byActor.set(actorUuid, {
      actorUuid,
      name: str(base?.name) ?? str(token.name) ?? actorUuid,
      isPC: str(base?.type) === 'character',
      allHidden: hidden,
    });
  }
  const byUuid = (a: PlaySceneToken, b: PlaySceneToken): number =>
    a.actorUuid < b.actorUuid ? -1 : a.actorUuid > b.actorUuid ? 1 : 0;
  return [...byActor.values()]
    .sort((a, b) => Number(a.allHidden) - Number(b.allHidden) || byUuid(a, b))
    .slice(0, MAX_SCENE_TOKENS)
    .sort(byUuid)
    .map(
      ({ allHidden, ...entry }): PlaySceneToken => (allHidden ? { ...entry, hidden: true } : entry)
    );
}

/** Sum of `system.levels` across an actor's `class` items; null for non-characters. */
function computeLevel(actor: ActorLike): number | null {
  if (str(actor.type) !== 'character') return null;
  let total = 0;
  for (const item of actorItems(actor)) {
    if (str(item.type) === 'class') {
      const levels = num(asRecord(item.system)?.levels);
      if (levels !== undefined) total += levels;
    }
  }
  return total;
}

/** `{key: value}` from an object of `{key: {[subKey]: value}}` (or `{key: value}` when no subKey). */
function numRecord(obj: unknown, subKey?: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rec = asRecord(obj);
  if (rec) {
    for (const [key, raw] of Object.entries(rec)) {
      const value = subKey ? asRecord(raw)?.[subKey] : raw;
      const n = num(value);
      if (n !== undefined) out[key] = n;
    }
  }
  return out;
}

function htmlToText(html: unknown, maxLen = 500): string {
  const text = str(html)
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function randomClientId(): string {
  const utils = currentFoundryNamespace()?.utils;
  if (utils) {
    try {
      return utils.randomID(16);
    } catch {
      // fall through
    }
  }
  return `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The dnd5e message target with the largest AC's value, used as `roll.options.target` usually is. */
function rollDc(roll: RollLike): number | undefined {
  return num(asRecord(roll.options)?.target);
}

/** Damage types a damage/healing roll's terms carry (`term.options.flavor` / `roll.options.type`). */
function extractDamageTypes(roll: RollLike): string[] {
  const types = new Set<string>();
  for (const raw of arr(roll.terms)) {
    const term = shape<RollTermLike>(raw);
    const flavor = str(asRecord(term?.options)?.flavor);
    if (flavor) types.add(flavor.toLowerCase());
  }
  const optionType = str(asRecord(roll.options)?.type);
  if (optionType) types.add(optionType.toLowerCase());
  return Array.from(types);
}

/**
 * A dnd5e roll (a single entry of `message.rolls`) as a `PlayRollInfo`. Crit,
 * fumble and advantage detection mirrors `EventTracker.parseRoll`; `dc` and
 * `outcome` come from `roll.options.target` (the same field the system's own
 * `D20Roll#isSuccess`/`isFailure` getters read, stable across 5.x and 6.0).
 * `dice[].results` holds only the results that counted (kept); a dropped
 * keep-highest/lowest or reroll result goes in `dice[].dropped` instead.
 */
function parseRollInfo(
  rawRoll: unknown,
  rollType: string,
  subject: string | undefined
): PlayRollInfo {
  const roll = shape<RollLike>(rawRoll) ?? {};
  const dice: Array<{ faces: number; results: number[]; dropped?: number[] }> = [];
  let crit = false;
  let fumble = false;
  let advantage: 'advantage' | 'disadvantage' | null = null;

  for (const rawTerm of arr(roll.dice)) {
    const term = shape<DiceTermLike>(rawTerm);
    const faces = num(term?.faces);
    if (faces === undefined) continue;

    const kept: number[] = [];
    const dropped: number[] = [];
    for (const rawResult of arr(term?.results)) {
      const result = shape<DiceResultLike>(rawResult);
      const value = num(result?.result);
      if (value === undefined) continue;
      if (result?.active === false) dropped.push(value);
      else kept.push(value);
    }
    const entry: { faces: number; results: number[]; dropped?: number[] } = {
      faces,
      results: kept,
    };
    if (dropped.length > 0) entry.dropped = dropped;
    dice.push(entry);

    if (faces === 20) {
      if (kept.includes(20)) crit = true;
      if (kept.includes(1)) fumble = true;

      const mods = arr(term?.modifiers)
        .filter((m): m is string => typeof m === 'string')
        .join('');
      const count = num(term?.number) ?? 1;
      if (count >= 2 && /kh/i.test(mods)) advantage = 'advantage';
      else if (count >= 2 && /kl/i.test(mods)) advantage = 'disadvantage';
    }
  }
  const advMode = asRecord(roll.options)?.advantageMode;
  if (advMode === 1) advantage = 'advantage';
  else if (advMode === -1) advantage = 'disadvantage';

  const total = num(roll.total) ?? 0;
  const dc = rollDc(roll);
  const outcome: 'success' | 'failure' | undefined =
    dc === undefined ? undefined : total >= dc ? 'success' : 'failure';
  const damageTypes =
    rollType === 'damage' || rollType === 'healing' ? extractDamageTypes(roll) : [];

  const info: PlayRollInfo = {
    formula: str(roll.formula) ?? '',
    total,
    dice,
    crit,
    fumble,
    advantage,
    rollType,
  };
  if (subject) info.subject = subject;
  if (dc !== undefined) info.dc = dc;
  if (outcome) info.outcome = outcome;
  if (damageTypes.length > 0) info.damageTypes = damageTypes;
  return info;
}

/**
 * The actor behind a chat message's speaker: the unlinked token's synthetic
 * actor when the speaker names a token, else the world actor.
 */
function resolveSpeakerActor(message: ChatMessageLike): ActorLike | null {
  const speaker = shape<SpeakerLike>(message.speaker);
  const sceneId = str(speaker?.scene);
  const tokenId = str(speaker?.token);
  if (sceneId && tokenId) {
    const scene = game.scenes.get(sceneId);
    const token = scene ? (scene.tokens.get(tokenId) as TokenDocLike | undefined) : undefined;
    const tokenActor = shape<ActorLike>(token?.actor);
    if (tokenActor) return tokenActor;
  }
  const actorId = str(speaker?.actor);
  if (actorId) return shape<ActorLike>(game.actors.get(actorId)) ?? null;
  return null;
}

function chatMessageTime(message: ChatMessageLike): number {
  const mt = modifiedTimeOf(message);
  if (mt !== null) return mt;
  return num(message.timestamp) ?? Date.now();
}

// ---------------------------------------------------------------------------
// Key builders (contract 4)
// ---------------------------------------------------------------------------

/** Non-fresh (`Date.now()`-based) keys bucket `t` to this many ms, so two GM clients witnessing the same change within one bucket still produce one key. */
const KEY_TIME_BUCKET_MS = 2_000;

export const playRecordKeys = {
  /** A fresh `_stats.modifiedTime` is available: the document's own timestamp uniquely identifies the change. */
  docChange: (kind: string, uuid: string, path: string, t: number): string =>
    `${kind}:${uuid}:${path}:${t}`,
  /** No fresh modifiedTime: bucket `t` and fold in before/after so repeated identical changes stay distinct. */
  docChangeBucketed: (
    kind: string,
    uuid: string,
    path: string,
    before: unknown,
    after: unknown,
    t: number
  ): string =>
    `${kind}:${uuid}:${path}:${String(before)}->${String(after)}:${Math.floor(t / KEY_TIME_BUCKET_MS)}`,
  /** A fresh modifiedTime is available (creates only — deletes never have one; see `createDeleteBucketed`). */
  createDelete: (kind: string, uuid: string): string => `${kind}:${uuid}`,
  /** No fresh modifiedTime: every delete, and a create whose actor/item is synthetic or has a stale/missing modifiedTime. */
  createDeleteBucketed: (kind: string, uuid: string, t: number): string =>
    `${kind}:${uuid}:${Math.floor(t / KEY_TIME_BUCKET_MS)}`,
  roll: (messageId: string, index: number): string => `roll:${messageId}:${index}`,
  itemUse: (messageId: string): string => `item-use:${messageId}`,
  chat: (messageId: string): string => `chat:${messageId}`,
  combatStart: (combatId: string): string => `combat-start:${combatId}`,
  combatTurn: (combatId: string, round: number, turn: number): string =>
    `combat-turn:${combatId}:${round}:${turn}`,
  userJoin: (userId: string, t: number): string => `user-join:${userId}:${Math.floor(t / 10000)}`,
  userLeave: (userId: string, t: number): string => `user-leave:${userId}:${Math.floor(t / 10000)}`,
  worldTime: (worldTime: number): string => `world-time:${worldTime}`,
  rest: (actorUuid: string, tail: string | number): string => `rest:${actorUuid}:${tail}`,
  scene: (sceneId: string, t: number): string => `scene:${sceneId}:${Math.floor(t / 1000)}`,
  tokenMove: (tokenUuid: string, t: number): string => `token-move:${tokenUuid}:${t}`,
};

// ---------------------------------------------------------------------------
// PlayRecorder
// ---------------------------------------------------------------------------

/** Options accepted by the internal record builder; wider than `PlayRecord` itself so callers may pass `undefined` freely. */
interface BuildOpts {
  kind: PlayRecordKind;
  key: string;
  t: number;
  userId?: string | null | undefined;
  userName?: string | undefined;
  actor?: PlayActorRef | undefined;
  combat?: { id: string; round: number; turn: number } | undefined;
  item?: PlayItemRef | undefined;
  path?: string | undefined;
  before?: unknown;
  after?: unknown;
  delta?: number | undefined;
  roll?: PlayRollInfo | undefined;
  source?: PlayRecord['source'] | undefined;
  data?: Record<string, unknown> | undefined;
  /** Decides the `data.hidden` flag instead of the actor's tokens (a combatant's own state). */
  hidden?: boolean | undefined;
}

const MAX_BUFFER = 5000;
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
/** Attribute an HP change to a roll only when it happened within this many ms of it. */
const HP_ATTRIBUTION_WINDOW_MS = 10_000;
/** How long a damage/healing roll stays eligible for HP attribution. */
const RECENT_ROLL_TTL_MS = 15_000;

/**
 * A recent damage/healing roll, kept around for HP-change attribution. A
 * single roll can be an area effect hitting several targets, so it is usable
 * once per DISTINCT target actor (`attributedTo`), not once overall —
 * otherwise a second, later HP change on the same target could wrongly reuse
 * a roll already credited to that same actor.
 */
interface RecentRoll {
  t: number;
  messageId: string;
  /** Sum of the message's roll totals: a guessed HP change must fit it (`hpChangeFitsRoll`). */
  total: number;
  attributedTo: Set<string>;
}

/** How long a noted dnd5e damage application waits for its actor's HP change. */
const PENDING_APPLY_TTL_MS = 5_000;

/**
 * A dnd5e `applyDamage` in progress on this client (`dnd5e.preApplyDamage`
 * fires right before its actor update): the chat message it was applied from,
 * or `null` (token HP bar, a macro, the bridge's own tool).
 */
interface PendingApply {
  messageId: string | null;
  t: number;
}

/** Everything a document-state-change record needs beyond the path/before/after: computed once per hook call. */
interface ChangeContext {
  t: number;
  /** Whether `t` came from a fresh `_stats.modifiedTime` (picks the key format). */
  fresh: boolean;
  userId: string | null;
  userName: string | undefined;
  actorRef: PlayActorRef | undefined;
}

export class PlayRecorder {
  private readonly clientId = randomClientId();
  private seq = 0;
  private buffer: PlayRecord[] = [];
  private hooksRegistered = false;

  private readonly actorShadows = new Map<string, ActorShadow>();
  private viewedSceneId: string | null = null;
  /** Whether the viewed scene was the active one at its last `scene` record; null before the first. */
  private viewedSceneActive: boolean | null = null;
  private recentDamage: RecentRoll[] = [];
  private recentHealing: RecentRoll[] = [];
  private readonly pendingApply = new Map<string, PendingApply>();
  /** Each running combat's last turn: Foundry 14 nulls `combat.turn` before `deleteCombat` fires. */
  private readonly lastCombatTurn = new Map<string, number>();
  /** Drops the mirrored second ActiveEffect event (Automated Conditions 5e, P-026). */
  private readonly effectDeduper = new EffectEventDeduper();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register all hooks once (safe to call more than once). Runs regardless of GM status; each handler self-gates. */
  registerHooks(): void {
    if (this.hooksRegistered) return;
    this.hooksRegistered = true;

    const on = (hook: string, fn: (...args: unknown[]) => void): void => {
      Hooks.on(hook, (...args: unknown[]) => {
        try {
          fn(...args);
        } catch (error) {
          console.warn(`[${MODULE_ID}] PlayRecorder ${hook} handler failed:`, error);
        }
      });
    };

    try {
      on('updateActor', (a, c, o, u) => this.onUpdateActor(a, c, o, u));
      on('createActor', (a, d, o, u) => this.onCreateActor(a, d, o, u));
      on('deleteActor', (a, o, u) => this.onDeleteActor(a, o, u));
      on('createItem', (i, d, o, u) => this.onCreateItem(i, d, o, u));
      on('updateItem', (i, c, o, u) => this.onUpdateItem(i, c, o, u));
      on('deleteItem', (i, o, u) => this.onDeleteItem(i, o, u));
      on('createActiveEffect', (e, d, o, u) => this.onCreateActiveEffect(e, d, o, u));
      on('deleteActiveEffect', (e, o, u) => this.onDeleteActiveEffect(e, o, u));
      on('createToken', (t, d, o, u) => this.onCreateToken(t, d, o, u));
      on('deleteToken', (t, o, u) => this.onDeleteToken(t, o, u));
      on('updateToken', (t, c, o, u) => this.onUpdateToken(t, c, o, u));
      on('combatStart', c => this.onCombatStart(c));
      on('updateCombat', (c, ch, o, u) => this.onUpdateCombat(c, ch, o, u));
      on('deleteCombat', c => this.onDeleteCombat(c));
      on('canvasReady', () => this.onCanvasReady());
      on('updateScene', (s, c) => this.onUpdateScene(s, c));
      on('createChatMessage', (m, o, u) => this.onCreateChatMessage(m, o, u));
      on('dnd5e.restCompleted', (a, r) => this.onRestCompleted(a, r));
      on('dnd5e.preApplyDamage', (a, _amount, _updates, o) => this.onPreApplyDamage(a, o));
      on('dnd5e.applyDamage', a => this.onApplyDamageDone(a));
      on('updateWorldTime', (wt, dt, o, u) => this.onUpdateWorldTime(wt, dt, o, u));
      on('userConnected', (usr, c) => this.onUserConnected(usr, c));

      Hooks.once('ready', () => {
        try {
          this.seed();
        } catch (error) {
          console.warn(`[${MODULE_ID}] PlayRecorder seed failed:`, error);
        }
      });
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to register PlayRecorder hooks:`, error);
    }
  }

  private isGM(): boolean {
    return game.user?.isGM === true;
  }

  // -------------------------------------------------------------------------
  // Seeding
  // -------------------------------------------------------------------------

  /** Seed shadow copies from the current world state. Public so a GM client can also call it directly (and tests). */
  seed(): void {
    if (!this.isGM()) return;
    try {
      for (const actor of game.actors.contents) this.seedActor(actor);
      for (const scene of game.scenes.contents) {
        for (const token of tokensOf(scene)) {
          if (token.actorLink === false) {
            const tokenActor = shape<ActorLike>(token.actor);
            if (tokenActor) this.seedActor(tokenActor);
          }
        }
      }
      this.viewedSceneId = currentCanvas()?.scene?.id ?? game.scenes.current?.id ?? null;
      // A client without a canvas (canvasReady never fires) still records who is online at
      // load, on the active scene, so "Seen in" does not wait for a join or an activation.
      if (!currentCanvas()?.scene) this.maybeRecordScene(activeSceneId(), true);
    } catch (error) {
      console.warn(`[${MODULE_ID}] PlayRecorder seed failed:`, error);
    }
  }

  /** Seed one actor's shadow (and its items') if not already tracked. First sighting only; never emits a record. */
  private seedActor(actor: ActorLike): void {
    try {
      const uuid = str(actor.uuid);
      if (!uuid || this.actorShadows.has(uuid)) return;
      const sys = asRecord(actor.system);
      const shadow: ActorShadow = {
        uuid,
        isPC: str(actor.type) === 'character',
        name: str(actor.name) ?? 'Unknown',
        hp: numOrNull(getPath(sys, 'attributes.hp.value')),
        hpTemp: numOrNull(getPath(sys, 'attributes.hp.temp')),
        hpMax: numOrNull(getPath(sys, 'attributes.hp.max')),
        deathSuccess: numOrNull(getPath(sys, 'attributes.death.success')),
        deathFailure: numOrNull(getPath(sys, 'attributes.death.failure')),
        xp: numOrNull(getPath(sys, 'details.xp.value')),
        level: computeLevel(actor),
        spells: numRecord(sys?.spells, 'value'),
        resources: numRecord(sys?.resources, 'value'),
        currency: numRecord(sys?.currency),
        items: new Map(),
      };
      if (bool(actor.isToken)) {
        const tokenUuid = str(asRecord(actor.token)?.uuid);
        if (tokenUuid) shadow.tokenUuid = tokenUuid;
      }
      this.actorShadows.set(uuid, shadow);
      for (const item of actorItems(actor)) this.seedItemShadow(item, shadow);
    } catch (error) {
      console.warn(`[${MODULE_ID}] PlayRecorder failed to seed an actor:`, error);
    }
  }

  private seedItemShadow(item: ItemLike, shadow: ActorShadow): void {
    try {
      const uuid = str(item.uuid);
      if (!uuid || shadow.items.has(uuid)) return;
      const sys = asRecord(item.system);
      const usesSpent = numOrNull(getPath(sys, 'uses.spent') ?? getPath(sys, 'uses.value'));
      const quantity = numOrNull(getPath(sys, 'quantity'));
      const itemType = str(item.type) ?? 'item';
      const hdSpent =
        itemType === 'class'
          ? numOrNull(getPath(sys, 'hd.spent') ?? getPath(sys, 'hitDiceUsed'))
          : null;
      shadow.items.set(uuid, {
        uuid,
        name: str(item.name) ?? 'Item',
        type: itemType,
        usesSpent,
        quantity,
        hdSpent,
      });
    } catch (error) {
      console.warn(`[${MODULE_ID}] PlayRecorder failed to seed an item:`, error);
    }
  }

  /** The shadow for an actor, seeding it (lazily, from current state) if this is the first time it's been seen. */
  private shadowFor(actor: ActorLike): ActorShadow | undefined {
    const uuid = str(actor.uuid);
    if (!uuid) return undefined;
    if (!this.actorShadows.has(uuid)) this.seedActor(actor);
    return this.actorShadows.get(uuid);
  }

  private itemShadowFor(item: ItemLike, shadow: ActorShadow): ItemShadow | undefined {
    const uuid = str(item.uuid);
    if (!uuid) return undefined;
    if (!shadow.items.has(uuid)) this.seedItemShadow(item, shadow);
    return shadow.items.get(uuid);
  }

  // -------------------------------------------------------------------------
  // Context helpers
  // -------------------------------------------------------------------------

  private actorRefFor(actor: ActorLike): PlayActorRef | undefined {
    const uuid = str(actor.uuid);
    if (!uuid) return undefined;
    const ref: PlayActorRef = {
      uuid,
      isPC: str(actor.type) === 'character',
      name: str(actor.name) ?? 'Unknown',
    };
    if (ref.isPC && typeof actor.hasPlayerOwner === 'boolean') {
      ref.playerOwned = actor.hasPlayerOwner;
    }
    if (bool(actor.isToken)) {
      const tokenUuid = str(asRecord(actor.token)?.uuid);
      if (tokenUuid) ref.tokenUuid = tokenUuid;
    }
    return ref;
  }

  private itemRefFor(item: ItemLike): PlayItemRef | undefined {
    const uuid = str(item.uuid);
    if (!uuid) return undefined;
    return { uuid, name: str(item.name) ?? 'Item', type: str(item.type) ?? 'item' };
  }

  private activeCombatRef(): { id: string; round: number; turn: number } | undefined {
    const combat = game.combat;
    const id = combat ? str(combat.id) : undefined;
    if (combat?.started && id) {
      return { id, round: num(combat.round) ?? 0, turn: num(combat.turn) ?? 0 };
    }
    return undefined;
  }

  private currentSceneId(): string | null {
    return currentCanvas()?.scene?.id ?? this.viewedSceneId;
  }

  private uid(userId: unknown): string | null {
    return str(userId) ?? null;
  }

  /** That user's current display name, when `userId` names one Foundry still knows about. */
  private userNameFor(userId: string | null): string | undefined {
    if (!userId) return undefined;
    try {
      return str(game.users.get(userId)?.name);
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Record construction and the ring buffer
  // -------------------------------------------------------------------------

  private build(opts: BuildOpts): PlayRecord {
    const record: PlayRecord = {
      v: 2,
      key: opts.key,
      t: opts.t,
      seq: 0,
      kind: opts.kind,
      userId: opts.userId ?? null,
      sceneId: this.currentSceneId(),
    };
    // Every record that names a user also carries that user's name (O3 item 5).
    const userName = opts.userName ?? this.userNameFor(record.userId);
    if (userName) record.userName = userName;
    if (opts.actor) record.actor = opts.actor;
    const combat = opts.combat ?? this.activeCombatRef();
    if (combat) record.combat = combat;
    if (opts.item) record.item = opts.item;
    if (opts.path !== undefined) record.path = opts.path;
    if (opts.before !== undefined) record.before = opts.before;
    if (opts.after !== undefined) record.after = opts.after;
    if (opts.delta !== undefined) record.delta = opts.delta;
    if (opts.roll) record.roll = opts.roll;
    if (opts.source) record.source = opts.source;
    if (opts.data) record.data = opts.data;
    // "Seen in" skips state changes the players could not see (a hidden ambusher's HP).
    if (
      opts.actor &&
      HIDDEN_FLAG_KINDS.has(opts.kind) &&
      (opts.hidden ?? actorTokenHidden(opts.actor))
    ) {
      record.data = { ...(record.data ?? {}), hidden: true };
    }
    return record;
  }

  private push(record: PlayRecord): void {
    this.seq += 1;
    record.seq = this.seq;
    this.buffer.push(record);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
  }

  /** Module query `foundry-mcp-bridge.getPlayRecords` (GM-gated by the caller, like `getRecentEvents`). */
  getPlayRecords(data: { sinceSeq?: unknown; limit?: unknown } | undefined): PlayRecordsResponse {
    const sinceSeqRaw = num(data?.sinceSeq);
    const sinceSeq = sinceSeqRaw !== undefined && sinceSeqRaw >= 0 ? Math.trunc(sinceSeqRaw) : 0;
    const requested = num(data?.limit) ?? DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);
    const records = this.buffer.filter(r => r.seq > sinceSeq).slice(0, limit);
    return {
      success: true,
      clientId: this.clientId,
      records,
      oldestSeq: this.buffer[0]?.seq ?? 0,
      latestSeq: this.buffer[this.buffer.length - 1]?.seq ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Actor state (hp/hp-temp/hp-max/death-save/xp/slot/resource/currency/level)
  // -------------------------------------------------------------------------

  private stateChangeKey(
    kind: PlayRecordKind,
    uuid: string,
    path: string,
    before: unknown,
    after: unknown,
    ctx: Pick<ChangeContext, 't' | 'fresh'>
  ): string {
    return ctx.fresh
      ? playRecordKeys.docChange(kind, uuid, path, ctx.t)
      : playRecordKeys.docChangeBucketed(kind, uuid, path, before, after, ctx.t);
  }

  private diffActorScalar(
    kind: PlayRecordKind,
    actorUuid: string,
    shadow: ActorShadow,
    field: ActorScalarField,
    path: string,
    changed: unknown,
    ctx: ChangeContext
  ): void {
    const newVal = num(getPath(changed, path));
    if (newVal === undefined) return;
    const before = shadow[field];
    shadow[field] = newVal;
    if (before === null || before === newVal) return;
    const delta = newVal - before;
    const opts: BuildOpts = {
      kind,
      key: this.stateChangeKey(kind, actorUuid, path, before, newVal, ctx),
      t: ctx.t,
      userId: ctx.userId,
      userName: ctx.userName,
      actor: ctx.actorRef,
      path,
      before,
      after: newVal,
      delta,
    };
    if (kind === 'hp') {
      const source = this.hpChangeSource(actorUuid, shadow, before, newVal, changed, ctx.t);
      if (source) opts.source = source;
    }
    this.push(this.build(opts));
  }

  /**
   * The roll an HP change is credited to. Exact when dnd5e applied it from a
   * chat card (`dnd5e.preApplyDamage` noted the message just before this
   * update); otherwise a guess: the most recent damage/healing roll within 10 s,
   * not yet credited to this actor, whose total fits the change
   * (`hpChangeFitsRoll`; temp HP lost in the same update counts toward damage).
   */
  private hpChangeSource(
    actorUuid: string,
    shadow: ActorShadow,
    before: number,
    after: number,
    changed: unknown,
    t: number
  ): PlayRecord['source'] | undefined {
    const delta = after - before;
    const list = delta < 0 ? this.recentDamage : this.recentHealing;
    const pending = this.takePendingApply(actorUuid);
    if (pending?.messageId) {
      list.find(entry => entry.messageId === pending.messageId)?.attributedTo.add(actorUuid);
      return { messageId: pending.messageId, attributed: true, exact: true };
    }

    let amount = Math.abs(delta);
    let stoppedAtLimit: boolean;
    if (delta < 0) {
      const newTemp = num(getPath(changed, 'system.attributes.hp.temp'));
      if (shadow.hpTemp !== null && newTemp !== undefined && newTemp < shadow.hpTemp) {
        amount += shadow.hpTemp - newTemp;
      }
      stoppedAtLimit = after <= 0;
    } else {
      stoppedAtLimit = shadow.hpMax !== null && after >= shadow.hpMax;
    }

    let best: RecentRoll | undefined;
    for (const entry of list) {
      if (entry.attributedTo.has(actorUuid)) continue;
      const age = t - entry.t;
      if (age < 0 || age > HP_ATTRIBUTION_WINDOW_MS) continue;
      if (!hpChangeFitsRoll(amount, entry.total, stoppedAtLimit)) continue;
      if (!best || entry.t > best.t) best = entry;
    }
    if (!best) return undefined;
    best.attributedTo.add(actorUuid);
    return { messageId: best.messageId, attributed: true };
  }

  /** The dnd5e damage application noted for this actor, if still fresh; consumed. */
  private takePendingApply(actorUuid: string): PendingApply | undefined {
    const pending = this.pendingApply.get(actorUuid);
    if (!pending) return undefined;
    this.pendingApply.delete(actorUuid);
    return Date.now() - pending.t <= PENDING_APPLY_TTL_MS ? pending : undefined;
  }

  /**
   * `dnd5e.preApplyDamage(actor, amount, updates, options)` (dnd5e 6.0.5
   * `Actor5e#applyDamage`) fires on the applying client right before its actor
   * update. A chat card's Apply button passes the damage message as
   * `options.originatingMessage` (and `options.origin`); the token HP bar and
   * direct calls pass none.
   */
  private onPreApplyDamage(rawActor: unknown, rawOptions: unknown): void {
    if (!this.isGM()) return;
    const actorUuid = str(asRecord(rawActor)?.uuid);
    if (!actorUuid) return;
    this.pendingApply.set(actorUuid, {
      messageId: originatingMessageId(rawOptions),
      t: Date.now(),
    });
  }

  /** `dnd5e.applyDamage` fires after the update: a note its HP change did not use is dropped. */
  private onApplyDamageDone(rawActor: unknown): void {
    const actorUuid = str(asRecord(rawActor)?.uuid);
    if (actorUuid) this.pendingApply.delete(actorUuid);
  }

  private diffActorMapField(
    kind: PlayRecordKind,
    actorUuid: string,
    map: Record<string, number>,
    mapKey: string,
    path: string,
    newVal: number,
    ctx: ChangeContext
  ): void {
    const before = Object.prototype.hasOwnProperty.call(map, mapKey) ? map[mapKey] : null;
    map[mapKey] = newVal;
    if (before === null || before === newVal) return;
    this.push(
      this.build({
        kind,
        key: this.stateChangeKey(kind, actorUuid, path, before, newVal, ctx),
        t: ctx.t,
        userId: ctx.userId,
        userName: ctx.userName,
        actor: ctx.actorRef,
        path,
        before,
        after: newVal,
        delta: newVal - before,
      })
    );
  }

  private onUpdateActor(
    rawActor: unknown,
    rawChanged: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const actor = shape<ActorLike>(rawActor);
    const uuid = str(actor?.uuid);
    if (!actor || !uuid) return;
    const shadow = this.shadowFor(actor);
    if (!shadow) return;
    const changed = rawChanged;
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(actor, bool(actor.isToken));
    const ctx: ChangeContext = {
      t,
      fresh,
      userId: uid,
      userName: this.userNameFor(uid),
      actorRef: this.actorRefFor(actor),
    };

    this.diffActorScalar('hp', uuid, shadow, 'hp', 'system.attributes.hp.value', changed, ctx);
    this.diffActorScalar(
      'hp-temp',
      uuid,
      shadow,
      'hpTemp',
      'system.attributes.hp.temp',
      changed,
      ctx
    );
    this.diffActorScalar('hp-max', uuid, shadow, 'hpMax', 'system.attributes.hp.max', changed, ctx);
    this.diffActorScalar(
      'death-save',
      uuid,
      shadow,
      'deathSuccess',
      'system.attributes.death.success',
      changed,
      ctx
    );
    this.diffActorScalar(
      'death-save',
      uuid,
      shadow,
      'deathFailure',
      'system.attributes.death.failure',
      changed,
      ctx
    );
    this.diffActorScalar('xp', uuid, shadow, 'xp', 'system.details.xp.value', changed, ctx);

    const spellsChanged = asRecord(getPath(changed, 'system.spells'));
    if (spellsChanged) {
      for (const key of Object.keys(spellsChanged)) {
        const newVal = num(getPath(spellsChanged, `${key}.value`));
        if (newVal !== undefined) {
          this.diffActorMapField(
            'slot',
            uuid,
            shadow.spells,
            key,
            `system.spells.${key}.value`,
            newVal,
            ctx
          );
        }
      }
    }

    const resourcesChanged = asRecord(getPath(changed, 'system.resources'));
    if (resourcesChanged) {
      for (const key of Object.keys(resourcesChanged)) {
        // dnd5e 6 stores legendary actions and resistances as `spent`; `value` is derived.
        const newVal =
          num(getPath(resourcesChanged, `${key}.value`)) ??
          (num(getPath(resourcesChanged, `${key}.spent`)) !== undefined
            ? num(getPath(actor, `system.resources.${key}.value`))
            : undefined);
        if (newVal !== undefined) {
          this.diffActorMapField(
            'resource',
            uuid,
            shadow.resources,
            key,
            `system.resources.${key}.value`,
            newVal,
            ctx
          );
        }
      }
    }

    const currencyChanged = asRecord(getPath(changed, 'system.currency'));
    if (currencyChanged) {
      for (const [key, val] of Object.entries(currencyChanged)) {
        const n = num(val);
        if (n !== undefined) {
          this.diffActorMapField(
            'currency',
            uuid,
            shadow.currency,
            key,
            `system.currency.${key}`,
            n,
            ctx
          );
        }
      }
    }
  }

  private recomputeLevel(actor: ActorLike, ctx: ChangeContext): void {
    if (str(actor.type) !== 'character') return;
    const shadow = this.shadowFor(actor);
    if (!shadow) return;
    const newLevel = computeLevel(actor);
    const before = shadow.level;
    shadow.level = newLevel;
    if (newLevel === null || before === null || before === newLevel) return;
    const uuid = str(actor.uuid);
    if (!uuid) return;
    this.push(
      this.build({
        kind: 'level',
        key: this.stateChangeKey('level', uuid, 'system.details.level', before, newLevel, ctx),
        t: ctx.t,
        userId: ctx.userId,
        userName: ctx.userName,
        actor: ctx.actorRef,
        path: 'system.details.level',
        before,
        after: newLevel,
        delta: newLevel - before,
      })
    );
  }

  /** A create/delete lifecycle key: fresh modifiedTime keeps `<kind>:<uuid>`, else bucketed `t`. */
  private lifecycleKey(kind: PlayRecordKind, uuid: string, fresh: boolean, t: number): string {
    return fresh
      ? playRecordKeys.createDelete(kind, uuid)
      : playRecordKeys.createDeleteBucketed(kind, uuid, t);
  }

  private onCreateActor(
    rawActor: unknown,
    _data: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const actor = shape<ActorLike>(rawActor);
    const uuid = str(actor?.uuid);
    if (!actor || !uuid) return;
    this.seedActor(actor);
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(actor, bool(actor.isToken));
    this.push(
      this.build({
        kind: 'actor-create',
        key: this.lifecycleKey('actor-create', uuid, fresh, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
      })
    );
  }

  private onDeleteActor(rawActor: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const actor = shape<ActorLike>(rawActor);
    const uuid = str(actor?.uuid);
    if (!actor || !uuid) return;
    const uid = this.uid(userId);
    const { t } = deleteTime();
    this.push(
      this.build({
        kind: 'actor-delete',
        key: playRecordKeys.createDeleteBucketed('actor-delete', uuid, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
      })
    );
    this.actorShadows.delete(uuid);
  }

  // -------------------------------------------------------------------------
  // Items on actors (item-uses, item-quantity, hit-dice, item-create/delete)
  // -------------------------------------------------------------------------

  private ownerOf(item: ItemLike): ActorLike | null {
    return shape<ActorLike>(item.actor) ?? shape<ActorLike>(item.parent);
  }

  private onCreateItem(rawItem: unknown, _data: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const item = shape<ItemLike>(rawItem);
    const itemUuid = str(item?.uuid);
    if (!item || !itemUuid) return;
    const actor = this.ownerOf(item);
    if (!actor || str(actor.documentName) !== 'Actor') return;
    const shadow = this.shadowFor(actor);
    if (shadow) this.seedItemShadow(item, shadow);
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(item, bool(actor.isToken));
    const quantity = numOrNull(getPath(asRecord(item.system), 'quantity'));
    this.push(
      this.build({
        kind: 'item-create',
        key: this.lifecycleKey('item-create', itemUuid, fresh, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
        item: this.itemRefFor(item),
        // The stats builder counts 1 when `after` is absent; carry the item's
        // actual starting quantity when dnd5e set one (loot dropped in stacks).
        after: quantity ?? undefined,
      })
    );
    if (str(item.type) === 'class') {
      this.recomputeLevel(actor, {
        t,
        fresh,
        userId: uid,
        userName: this.userNameFor(uid),
        actorRef: this.actorRefFor(actor),
      });
    }
  }

  private onDeleteItem(rawItem: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const item = shape<ItemLike>(rawItem);
    const itemUuid = str(item?.uuid);
    if (!item || !itemUuid) return;
    const actor = this.ownerOf(item);
    if (!actor || str(actor.documentName) !== 'Actor') return;
    const uid = this.uid(userId);
    const { t } = deleteTime();
    this.push(
      this.build({
        kind: 'item-delete',
        key: playRecordKeys.createDeleteBucketed('item-delete', itemUuid, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
        item: this.itemRefFor(item),
      })
    );
    const actorUuid = str(actor.uuid);
    const shadow = actorUuid ? this.actorShadows.get(actorUuid) : undefined;
    shadow?.items.delete(itemUuid);
    if (str(item.type) === 'class') {
      this.recomputeLevel(actor, {
        t,
        fresh: false,
        userId: uid,
        userName: this.userNameFor(uid),
        actorRef: this.actorRefFor(actor),
      });
    }
  }

  private onUpdateItem(
    rawItem: unknown,
    rawChanged: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const item = shape<ItemLike>(rawItem);
    if (!item) return;
    const actor = this.ownerOf(item);
    if (!actor || str(actor.documentName) !== 'Actor') return;
    const shadow = this.shadowFor(actor);
    if (!shadow) return;
    const itemShadow = this.itemShadowFor(item, shadow);
    if (!itemShadow) return;
    const changed = rawChanged;
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(item, bool(actor.isToken));
    const ctx: ChangeContext = {
      t,
      fresh,
      userId: uid,
      userName: this.userNameFor(uid),
      actorRef: this.actorRefFor(actor),
    };
    const itemRef = this.itemRefFor(item);

    const usesSpent = num(getPath(changed, 'system.uses.spent'));
    const usesValueLegacy = num(getPath(changed, 'system.uses.value'));
    if (usesSpent !== undefined) {
      this.diffItemScalar(
        'item-uses',
        itemShadow,
        'usesSpent',
        'system.uses.spent',
        usesSpent,
        ctx,
        itemRef
      );
    } else if (usesValueLegacy !== undefined) {
      this.diffItemScalar(
        'item-uses',
        itemShadow,
        'usesSpent',
        'system.uses.value',
        usesValueLegacy,
        ctx,
        itemRef
      );
    }

    const quantity = num(getPath(changed, 'system.quantity'));
    if (quantity !== undefined) {
      this.diffItemScalar(
        'item-quantity',
        itemShadow,
        'quantity',
        'system.quantity',
        quantity,
        ctx,
        itemRef
      );
    }

    if (str(item.type) === 'class') {
      const hdSpent = num(getPath(changed, 'system.hd.spent'));
      const hdLegacy = num(getPath(changed, 'system.hitDiceUsed'));
      if (hdSpent !== undefined) {
        this.diffItemScalar(
          'hit-dice',
          itemShadow,
          'hdSpent',
          'system.hd.spent',
          hdSpent,
          ctx,
          itemRef
        );
      } else if (hdLegacy !== undefined) {
        this.diffItemScalar(
          'hit-dice',
          itemShadow,
          'hdSpent',
          'system.hitDiceUsed',
          hdLegacy,
          ctx,
          itemRef
        );
      }
      const levels = num(getPath(changed, 'system.levels'));
      if (levels !== undefined) this.recomputeLevel(actor, ctx);
    }
  }

  private diffItemScalar(
    kind: PlayRecordKind,
    shadow: ItemShadow,
    field: 'usesSpent' | 'quantity' | 'hdSpent',
    path: string,
    newVal: number,
    ctx: ChangeContext,
    itemRef: PlayItemRef | undefined
  ): void {
    const before = shadow[field];
    shadow[field] = newVal;
    if (before === null || before === newVal) return;
    this.push(
      this.build({
        kind,
        key: this.stateChangeKey(kind, shadow.uuid, path, before, newVal, ctx),
        t: ctx.t,
        userId: ctx.userId,
        userName: ctx.userName,
        actor: ctx.actorRef,
        item: itemRef,
        path,
        before,
        after: newVal,
        delta: newVal - before,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private onCreateActiveEffect(
    rawEffect: unknown,
    _data: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const effect = shape<EffectLike>(rawEffect);
    const effectUuid = str(effect?.uuid);
    if (!effect || !effectUuid) return;
    const actor = shape<ActorLike>(effect.parent);
    if (!actor || str(actor.documentName) !== 'Actor') return;
    if (this.isMirroredEffect('effect-add', actor, effect)) return;
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(effect, false);
    this.push(
      this.build({
        kind: 'effect-add',
        key: this.lifecycleKey('effect-add', effectUuid, fresh, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
        data: {
          effectName: str(effect.name) ?? str(effect.label) ?? 'Effect',
          statuses: statusesOf(effect.statuses),
        },
      })
    );
  }

  private onDeleteActiveEffect(rawEffect: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const effect = shape<EffectLike>(rawEffect);
    const effectUuid = str(effect?.uuid);
    if (!effect || !effectUuid) return;
    const actor = shape<ActorLike>(effect.parent);
    if (!actor || str(actor.documentName) !== 'Actor') return;
    if (this.isMirroredEffect('effect-remove', actor, effect)) return;
    const uid = this.uid(userId);
    const { t } = deleteTime();
    this.push(
      this.build({
        kind: 'effect-remove',
        key: playRecordKeys.createDeleteBucketed('effect-remove', effectUuid, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: this.actorRefFor(actor),
        data: {
          effectName: str(effect.name) ?? str(effect.label) ?? 'Effect',
          statuses: statusesOf(effect.statuses),
        },
      })
    );
  }

  /** The second of two matching effect events on one actor within 1.5 s (P-026). */
  private isMirroredEffect(kind: string, actor: ActorLike, effect: EffectLike): boolean {
    return this.effectDeduper.isDuplicate({
      actor: str(actor.uuid),
      kind,
      name: str(effect.name) ?? str(effect.label) ?? 'Effect',
      statuses: statusesOf(effect.statuses),
    });
  }

  // -------------------------------------------------------------------------
  // Tokens (create/delete/move)
  // -------------------------------------------------------------------------

  private onCreateToken(
    rawToken: unknown,
    _data: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const token = shape<TokenDocLike>(rawToken);
    const tokenUuid = str(token?.uuid);
    if (!token || !tokenUuid) return;
    const actor = shape<ActorLike>(token.actor);
    if (token.actorLink === false && actor) this.seedActor(actor);
    const uid = this.uid(userId);
    const { t, fresh } = createOrUpdateTime(token, false);
    this.push(
      this.build({
        kind: 'token-create',
        key: this.lifecycleKey('token-create', tokenUuid, fresh, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: actor ? this.actorRefFor(actor) : undefined,
      })
    );
  }

  private onDeleteToken(rawToken: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const token = shape<TokenDocLike>(rawToken);
    const tokenUuid = str(token?.uuid);
    if (!token || !tokenUuid) return;
    const actor = shape<ActorLike>(token.actor);
    const uid = this.uid(userId);
    const { t } = deleteTime();
    this.push(
      this.build({
        kind: 'token-delete',
        key: playRecordKeys.createDeleteBucketed('token-delete', tokenUuid, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: actor ? this.actorRefFor(actor) : undefined,
      })
    );
    const actorUuid = str(actor?.uuid);
    if (token.actorLink === false && actorUuid) this.actorShadows.delete(actorUuid);
  }

  private onUpdateToken(
    rawToken: unknown,
    rawChanged: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const token = shape<TokenDocLike>(rawToken);
    const tokenUuid = str(token?.uuid);
    if (!token || !tokenUuid) return;
    const changed = asRecord(rawChanged);
    if (changed?.x === undefined && changed?.y === undefined) return;
    const actor = shape<ActorLike>(token.actor);
    const uid = this.uid(userId);
    const { t } = createOrUpdateTime(token, false);
    this.push(
      this.build({
        kind: 'token-move',
        key: playRecordKeys.tokenMove(tokenUuid, t),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: actor ? this.actorRefFor(actor) : undefined,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  private onCombatStart(rawCombat: unknown): void {
    if (!this.isGM()) return;
    const combat = shape<CombatLike>(rawCombat);
    const combatId = str(combat?.id);
    if (!combat || !combatId) return;
    const { t, fresh } = createOrUpdateTime(combat, false);
    const round = num(combat.round) ?? 1;
    const turn = num(combat.turn) ?? 0;
    this.lastCombatTurn.set(combatId, turn);
    this.push(
      this.build({
        kind: 'combat-start',
        key: this.lifecycleKey('combat-start', combatId, fresh, t),
        t,
        combat: { id: combatId, round, turn },
        data: {
          combatantCount: num(asRecord(combat.combatants)?.size) ?? 0,
          roster: this.rosterOf(combat),
        },
      })
    );
  }

  /**
   * A combat's combatants by name (named like `combat-turn` records name their
   * actor, falling back to the combatant's own name), so the stats list every
   * participant, not only those whose turn came up.
   */
  private rosterOf(combat: CombatLike): string[] {
    const names = new Set<string>();
    for (const combatant of combatantsOf(combat)) {
      const actor = shape<ActorLike>(combatant.actor);
      const name = (actor ? this.actorRefFor(actor)?.name : undefined) ?? str(combatant.name);
      if (name) names.add(name);
    }
    return [...names].sort();
  }

  private onUpdateCombat(
    rawCombat: unknown,
    rawChanged: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const combat = shape<CombatLike>(rawCombat);
    const combatId = str(combat?.id);
    if (!combat || !combatId) return;
    const changed = asRecord(rawChanged);
    if (changed?.round === undefined && changed?.turn === undefined) return;
    const round = num(combat.round) ?? 0;
    const turn = num(combat.turn) ?? 0;
    this.lastCombatTurn.set(combatId, turn);
    const combatant = shape<CombatantLike>(combat.combatant);
    const actor = shape<ActorLike>(combatant?.actor);
    const uid = this.uid(userId);
    const { t } = createOrUpdateTime(combat, false);
    this.push(
      this.build({
        kind: 'combat-turn',
        key: playRecordKeys.combatTurn(combatId, round, turn),
        t,
        userId: uid,
        userName: this.userNameFor(uid),
        actor: actor ? this.actorRefFor(actor) : undefined,
        combat: { id: combatId, round, turn },
        data: { combatantName: str(combatant?.name) ?? null },
        hidden: combatant ? combatantHidden(combatant) : undefined,
      })
    );
  }

  private onDeleteCombat(rawCombat: unknown): void {
    if (!this.isGM()) return;
    const combat = shape<CombatLike>(rawCombat);
    const combatId = str(combat?.id);
    if (!combat || !combatId) return;
    const { t } = deleteTime();
    const round = num(combat.round) ?? 0;
    const turn = num(combat.turn) ?? this.lastCombatTurn.get(combatId) ?? 0;
    this.lastCombatTurn.delete(combatId);
    this.push(
      this.build({
        kind: 'combat-end',
        key: playRecordKeys.createDeleteBucketed('combat-end', combatId, t),
        t,
        // The ended combat's own round/turn, so the stats builder can close it out.
        combat: { id: combatId, round, turn },
        // The roster again: it catches combatants added after the start.
        data: { rounds: round, roster: this.rosterOf(combat) },
      })
    );
  }

  // -------------------------------------------------------------------------
  // Scene, world time, users
  // -------------------------------------------------------------------------

  private onCanvasReady(): void {
    if (!this.isGM()) return;
    const sceneId = currentCanvas()?.scene?.id ?? null;
    this.maybeRecordScene(sceneId, sceneId !== null && activeSceneId() === sceneId);
  }

  private onUpdateScene(rawScene: unknown, rawChanged: unknown): void {
    if (!this.isGM()) return;
    const changed = asRecord(rawChanged);
    if (changed?.active !== true) return;
    const scene = asRecord(rawScene);
    this.maybeRecordScene(str(scene?.id) ?? null, true, str(scene?.name));
  }

  /**
   * A `scene` record when the viewed scene, or whether it is the active one, changed. `active`
   * tells a GM-only preview (false) from the scene the players see (true); `players` lists the
   * players online at that moment ("Seen in" counts only what players saw).
   */
  private maybeRecordScene(
    sceneId: string | null,
    active: boolean,
    sceneName?: string | undefined
  ): void {
    if (!sceneId) return;
    if (sceneId === this.viewedSceneId && active === this.viewedSceneActive) return;
    this.viewedSceneId = sceneId;
    this.viewedSceneActive = active;
    const t = Date.now();
    const name = sceneName ?? game.scenes.get(sceneId)?.name ?? null;
    const record = this.build({
      kind: 'scene',
      key: playRecordKeys.scene(sceneId, t),
      t,
      data: {
        sceneName: name,
        active,
        players: onlinePlayerIds(),
        tokens: sceneTokensOf(sceneId),
      },
    });
    // The recorded scene, not the canvas: activating a scene fires updateScene before the
    // canvas switches to it, so the canvas still shows the previous one.
    record.sceneId = sceneId;
    this.push(record);
  }

  private onUpdateWorldTime(
    rawWorldTime: unknown,
    rawDt: unknown,
    _options: unknown,
    userId: unknown
  ): void {
    if (!this.isGM()) return;
    const worldTime = num(rawWorldTime);
    const dt = num(rawDt);
    if (worldTime === undefined || dt === undefined || dt === 0) return;
    const before = worldTime - dt;
    const uid = this.uid(userId);
    this.push(
      this.build({
        kind: 'world-time',
        key: playRecordKeys.worldTime(worldTime),
        t: Date.now(),
        userId: uid,
        userName: this.userNameFor(uid),
        path: 'worldTime',
        before,
        after: worldTime,
        delta: dt,
        data: { deltaSeconds: dt },
      })
    );
  }

  private onUserConnected(rawUser: unknown, connected: unknown): void {
    if (!this.isGM()) return;
    const user = shape<UserLike>(rawUser);
    const userId = str(user?.id);
    if (!userId) return;
    const t = Date.now();
    const kind: PlayRecordKind = connected === true ? 'user-join' : 'user-leave';
    const key =
      connected === true ? playRecordKeys.userJoin(userId, t) : playRecordKeys.userLeave(userId, t);
    const name = str(user?.name);
    // A player joining lands on the active scene: snapshot who is on it (not for a GM joining).
    const isGM = user?.isGM === true;
    const data: Record<string, unknown> = { name: name ?? null, isGM };
    if (kind === 'user-join' && !isGM) {
      const sceneId = activeSceneId();
      data.activeSceneId = sceneId;
      data.tokens = sceneTokensOf(sceneId);
    }
    this.push(
      this.build({
        kind,
        key,
        t,
        userId,
        userName: name,
        data,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Chat (rolls, item usage, rest, plain chat)
  // -------------------------------------------------------------------------

  private onCreateChatMessage(rawMessage: unknown, _options: unknown, userId: unknown): void {
    if (!this.isGM()) return;
    const message = shape<ChatMessageLike>(rawMessage);
    if (!message || !str(message.id)) return;
    const uid = this.uid(userId) ?? str(asRecord(message.author)?.id) ?? null;
    // `dnd5eRollType`/`isUsageCard`/`dnd5eRestType` read the dnd5e message
    // subtype (`message.type`) and `message.system`/`flags`, which are not on
    // `ChatMessageLike` (they belong to the dnd5e version adapter); cast once
    // to the ambient `ChatMessage` shape those helpers already accept.
    const dnd5eMessage = rawMessage as ChatMessage;
    const kind = chatRollKind(dnd5eMessage);
    // 6.0 keys a rest card off the message subtype; some 5.x builds never set
    // `flags.dnd5e.roll.type` for a rest (it is not a roll), only a
    // `flags.dnd5e.rest` descriptor, so check `dnd5eRestType` too.
    if (kind === 'rest' || dnd5eRestType(dnd5eMessage) !== undefined) {
      this.handleRestMessage(message, dnd5eMessage, uid);
    } else if (isUsageCard(dnd5eMessage)) {
      this.handleItemUseMessage(message, dnd5eMessage, uid);
    } else if (arr(message.rolls).length > 0) {
      this.handleRollMessage(message, dnd5eMessage, uid);
    } else {
      this.handleChatMessage(message, uid);
    }
  }

  private handleRollMessage(
    message: ChatMessageLike,
    dnd5eMessage: ChatMessage,
    userId: string | null
  ): void {
    const messageId = str(message.id);
    if (!messageId) return;
    const rollType = dnd5eRollType(dnd5eMessage);
    const subject = dnd5eRollSubject(dnd5eMessage);
    const itemRef = dnd5eMessageItemRef(dnd5eMessage);
    const actor = resolveSpeakerActor(message);
    const actorRef = actor ? this.actorRefFor(actor) : undefined;
    const t = chatMessageTime(message);
    const privacy = privacyOf(message);

    let recorded = false;
    let total = 0;
    arr(message.rolls).forEach((rawRoll, index) => {
      try {
        const info = parseRollInfo(rawRoll, rollType, subject);
        this.push(
          this.build({
            kind: 'roll',
            key: playRecordKeys.roll(messageId, index),
            t,
            userId,
            actor: actorRef,
            item: itemRef,
            roll: info,
            source: { messageId },
            ...(Object.keys(privacy).length > 0 ? { data: privacy } : {}),
          })
        );
        recorded = true;
        total += info.total;
      } catch (error) {
        console.warn(`[${MODULE_ID}] PlayRecorder dropped a roll:`, error);
      }
    });
    // One attribution entry per message: its rolls (e.g. slashing + fire) land as one HP change per target.
    if (recorded) {
      const recent: RecentRoll = { t, messageId, total, attributedTo: new Set() };
      if (rollType === 'damage') this.recentDamage.push(recent);
      else if (rollType === 'healing') this.recentHealing.push(recent);
    }
    this.trimRecentRolls();
  }

  private trimRecentRolls(): void {
    const cutoff = Date.now() - RECENT_ROLL_TTL_MS;
    if (this.recentDamage.length > 0)
      this.recentDamage = this.recentDamage.filter(e => e.t >= cutoff);
    if (this.recentHealing.length > 0)
      this.recentHealing = this.recentHealing.filter(e => e.t >= cutoff);
  }

  private handleItemUseMessage(
    message: ChatMessageLike,
    dnd5eMessage: ChatMessage,
    userId: string | null
  ): void {
    const messageId = str(message.id);
    if (!messageId) return;
    const itemRef = dnd5eMessageItemRef(dnd5eMessage);
    const actor = resolveSpeakerActor(message);
    const actorRef = actor ? this.actorRefFor(actor) : undefined;
    const t = chatMessageTime(message);
    const spellLevel = dnd5eSpellLevel(dnd5eMessage);
    const data: Record<string, unknown> = { ...privacyOf(message) };
    if (spellLevel !== undefined) data.spellLevel = spellLevel;
    this.push(
      this.build({
        kind: 'item-use',
        key: playRecordKeys.itemUse(messageId),
        t,
        userId,
        actor: actorRef,
        item: itemRef,
        source: { messageId },
        data: Object.keys(data).length > 0 ? data : undefined,
      })
    );
  }

  private handleRestMessage(
    message: ChatMessageLike,
    dnd5eMessage: ChatMessage,
    userId: string | null
  ): void {
    const actor = resolveSpeakerActor(message);
    const actorUuid = str(actor?.uuid);
    if (!actor || !actorUuid) return;
    const t = chatMessageTime(message);
    const restType = dnd5eRestType(dnd5eMessage);
    const messageId = str(message.id);
    const tail = messageId ?? String(modifiedTimeOf(message) ?? t);
    this.push(
      this.build({
        kind: 'rest',
        key: playRecordKeys.rest(actorUuid, tail),
        t,
        userId,
        actor: this.actorRefFor(actor),
        source: messageId ? { messageId } : undefined,
        data: restType ? { restType } : undefined,
      })
    );
  }

  /**
   * `dnd5e.restCompleted(actor, result, config)` (dnd5e 6.0.5 `Actor5e#_rest`)
   * fires only on the client that rested, after the rest card (when there is
   * one, `result.message`) was created. A rest with a card is recorded from the
   * card on every GM client (`handleRestMessage`), so this records only
   * card-less rests (`chat: false`, e.g. the bridge's `manage-rest` tool).
   */
  private onRestCompleted(rawActor: unknown, rawResult: unknown): void {
    if (!this.isGM()) return;
    const result = asRecord(rawResult);
    if (str(asRecord(result?.message)?.id)) return;
    const actor = shape<ActorLike>(rawActor);
    const actorUuid = str(actor?.uuid);
    if (!actor || !actorUuid) return;
    const t = Date.now();
    const restType = str(result?.type);
    this.push(
      this.build({
        kind: 'rest',
        key: playRecordKeys.rest(actorUuid, String(t)),
        t,
        userId: this.uid(game.user?.id),
        actor: this.actorRefFor(actor),
        data: restType ? { restType } : undefined,
      })
    );
  }

  private handleChatMessage(message: ChatMessageLike, userId: string | null): void {
    const messageId = str(message.id);
    if (!messageId) return;
    const actor = resolveSpeakerActor(message);
    const actorRef = actor ? this.actorRefFor(actor) : undefined;
    const t = chatMessageTime(message);
    const style = num(message.style);
    const whisperIds = arr(message.whisper);
    this.push(
      this.build({
        kind: 'chat',
        key: playRecordKeys.chat(messageId),
        t,
        userId,
        actor: actorRef,
        data: {
          style: style ?? null,
          whisper: whisperIds.length > 0,
          blind: bool(message.blind),
          text: htmlToText(message.content),
        },
      })
    );
  }
}

/** Singleton, mirroring the `eventTracker` pattern. */
export const playRecorder = new PlayRecorder();
