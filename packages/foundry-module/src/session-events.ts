import { MODULE_ID } from './constants.js';
import {
  chatRollKind,
  dnd5eRestType,
  dnd5eRollType,
  isDamageRoll,
  isUsageCard,
} from './systems/dnd5e/chat-roll-kind.js';
import { describeMessageRolls } from './systems/dnd5e/roll-breakdown.js';
import { hpChangeFitsRoll, originatingMessageId } from './hp-credit.js';
import { eventVisibilityFor, playerFacingSceneName } from './player-visibility.js';
import { EffectEventDeduper } from './effect-dedupe.js';
import { logInfo } from './log.js';
import { dig, rec, type Rec } from './doc-read.js';
import type { EventVisibility } from '@gnuminator/shared';

/**
 * Event tracking for the Foundry MCP Bridge.
 *
 * This module owns two rolling in-memory buffers that live for the duration of
 * the browser session (i.e. while the world is loaded):
 *
 *   1. A chat-log buffer  — every ChatMessage as it is created, parsed into a
 *      structured shape (rolls, damage, flavor, advantage, crit/fumble, etc.).
 *   2. A session-event log — significant world events (combat start/end, HP
 *      changes, deaths, conditions, resource spend, scene changes, journals).
 *
 * The MCP server requests these buffers on demand via the query handlers; the
 * data itself never leaves the browser until queried. Hooks are registered once
 * during the module's init hook.
 *
 * Everything here is intentionally defensive: parsing live Foundry/system data
 * must never throw in a way that breaks the chat log or combat tracker.
 */

export interface ChatRollInfo {
  formula: string;
  total: number;
  dice: Array<{ faces: number; results: number[] }>;
  isCritical: boolean;
  isFumble: boolean;
  advantage: 'advantage' | 'disadvantage' | null;
}

export interface ChatDamageInfo {
  total: number;
  types: string[];
}

export interface ChatLogEntry {
  id: string;
  timestamp: string; // ISO string
  timestampMs: number;
  speakerName: string;
  actorId: string | null;
  messageType: string; // 'roll' | 'damage' | 'ic' | 'ooc' | 'emote' | 'whisper' | 'other'
  isRoll: boolean;
  content: string; // raw HTML/text content
  flavor: string | null;
  roll: ChatRollInfo | null;
  damage: ChatDamageInfo | null;
  whisperTo: string[];
}

export interface SessionLogEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: string;
  actorName: string | null;
  actorId: string | null;
  description: string;
  details: Record<string, unknown>;
  /** Stamped at creation (M2): what players may see of this event's subject. */
  visibility?: EventVisibility;
}

/** A value as it would read inside a template literal (`${value}`), for untyped document data. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/** `value || null` for untyped document data that is a string in practice. */
function orNull(value: unknown): string | null {
  return value ? (value as string) : null;
}

/** Stamped on events with no subject actor (combat start/end, journal events). */
const NO_SUBJECT_VISIBILITY: EventVisibility = {
  subject: null,
  tokenVisible: false,
  playerName: null,
};

/** One chat action inside a combat turn of the play-by-play. */
export interface PlayByPlayAction {
  actor: string;
  summary: string;
  timestamp: string;
  rollTotal: number | null;
  damage: number | null;
}

export interface PlayByPlayTurn {
  combatant: string;
  actions: PlayByPlayAction[];
}

export interface PlayByPlayEvent {
  type: string;
  description: string;
  actor: string | null;
  timestamp: string;
}

export interface CombatTimelineEntry {
  round: number;
  turn: number;
  combatantName: string;
  actorId: string | null;
  timestampMs: number;
}

const DEFAULT_CHAT_BUFFER = 200;
const MAX_SESSION_BUFFER = 1000;

export class EventTracker {
  private chatLog: ChatLogEntry[] = [];
  private sessionLog: SessionLogEntry[] = [];
  private combatTimeline: CombatTimelineEntry[] = [];

  /** Cache of last-seen HP per actor id, for damage/heal/death detection. */
  private hpCache: Map<string, number> = new Map();
  /** Cache of last-seen temp HP per actor (null or missing counts as 0), same keys as hpCache. */
  private tempCache: Map<string, number> = new Map();
  /** Cache of last-seen spell-slot / resource totals per actor, for spend detection. */
  private resourceCache: Map<string, number> = new Map();
  /** Drops the mirrored second ActiveEffect event (Automated Conditions 5e, P-026). */
  private readonly effectDeduper = new EffectEventDeduper();

  /** dnd5e damage applications in progress on this client (actor uuid -> source message). */
  private pendingApply: Map<string, { messageId: string | null; t: number }> = new Map();

  private hooksRegistered = false;
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `evt-${Date.now().toString(36)}-${this.seq}`;
  }

  private getChatBufferSize(): number {
    try {
      const configured = game.settings?.get(MODULE_ID, 'chatLogBufferSize');
      if (typeof configured === 'number' && configured > 0) {
        return Math.min(configured, 1000);
      }
    } catch {
      // setting may not be registered; fall through to default
    }
    return DEFAULT_CHAT_BUFFER;
  }

  /**
   * Register all Foundry hooks. Safe to call multiple times — only registers
   * once. Called from the module init hook so every capability is live as soon
   * as the module loads.
   */
  registerHooks(): void {
    if (this.hooksRegistered) return;
    this.hooksRegistered = true;

    try {
      Hooks.on('createChatMessage', (message: unknown) => {
        try {
          this.onCreateChatMessage(message);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker createChatMessage failed:`, error);
        }
      });

      Hooks.on('combatStart', (combat: unknown) => {
        try {
          this.onCombatStart(combat);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker combatStart failed:`, error);
        }
      });

      Hooks.on('deleteCombat', (combat: unknown) => {
        try {
          this.onCombatEnd(combat);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker deleteCombat failed:`, error);
        }
      });

      Hooks.on('updateCombat', (combat: unknown, changed: unknown) => {
        try {
          this.onUpdateCombat(combat, changed);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker updateCombat failed:`, error);
        }
      });

      Hooks.on('updateActor', (actor: unknown, changed: unknown) => {
        try {
          this.onUpdateActor(actor, changed);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker updateActor failed:`, error);
        }
      });

      // Keep the HP / resource caches per actor uuid in step with what exists: a monster
      // placed mid-session gets its baseline now, so its first damage is not dropped.
      Hooks.on('createActor', (actor: unknown) => {
        try {
          this.seedActor(actor);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker createActor failed:`, error);
        }
      });

      Hooks.on('deleteActor', (actor: unknown) => {
        try {
          this.forgetActor(actor);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker deleteActor failed:`, error);
        }
      });

      Hooks.on('createToken', (token: unknown) => {
        try {
          const tokenActor = this.unlinkedTokenActor(token);
          if (tokenActor) this.seedActor(tokenActor);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker createToken failed:`, error);
        }
      });

      Hooks.on('deleteToken', (token: unknown) => {
        try {
          const tokenActor = this.unlinkedTokenActor(token);
          if (tokenActor) this.forgetActor(tokenActor);
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker deleteToken failed:`, error);
        }
      });

      Hooks.on(
        'dnd5e.preApplyDamage',
        (actor: unknown, _amount: unknown, _updates: unknown, options: unknown): void => {
          const uuid = (actor as { uuid?: unknown } | null)?.uuid;
          if (typeof uuid !== 'string') return;
          this.pendingApply.set(uuid, { messageId: originatingMessageId(options), t: Date.now() });
        }
      );

      Hooks.on('dnd5e.applyDamage', (actor: unknown): void => {
        const uuid = (actor as { uuid?: unknown } | null)?.uuid;
        if (typeof uuid === 'string') this.pendingApply.delete(uuid);
      });

      Hooks.on('createActiveEffect', (effect: unknown) => {
        try {
          this.onActiveEffect(effect, 'condition-applied');
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker createActiveEffect failed:`, error);
        }
      });

      Hooks.on('deleteActiveEffect', (effect: unknown) => {
        try {
          this.onActiveEffect(effect, 'condition-removed');
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker deleteActiveEffect failed:`, error);
        }
      });

      Hooks.on('updateScene', (scene: unknown, changed: unknown) => {
        try {
          if (dig(changed, 'active') === true) {
            this.logSessionEvent('scene-change', `Scene changed to "${text(dig(scene, 'name'))}"`, {
              actorName: null,
              actorId: null,
              details: { sceneId: dig(scene, 'id'), sceneName: dig(scene, 'name') },
              visibility: { ...NO_SUBJECT_VISIBILITY, sceneName: playerFacingSceneName(scene) },
            });
          }
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker updateScene failed:`, error);
        }
      });

      Hooks.on('createJournalEntry', (journal: unknown) => {
        try {
          const name = dig(journal, 'name');
          this.logSessionEvent('journal-created', `Journal entry created: "${text(name)}"`, {
            actorName: null,
            actorId: null,
            details: { journalId: dig(journal, 'id'), name },
            visibility: NO_SUBJECT_VISIBILITY,
          });
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker createJournalEntry failed:`, error);
        }
      });

      Hooks.on('updateJournalEntry', (journal: unknown) => {
        try {
          const name = dig(journal, 'name');
          this.logSessionEvent('journal-updated', `Journal entry updated: "${text(name)}"`, {
            actorName: null,
            actorId: null,
            details: { journalId: dig(journal, 'id'), name },
            visibility: NO_SUBJECT_VISIBILITY,
          });
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker updateJournalEntry failed:`, error);
        }
      });

      // Seed HP / resource caches once the world is ready so the FIRST damage,
      // heal, death, or resource-spend of the session is detected (otherwise the
      // first updateActor has no baseline to diff against and is dropped).
      Hooks.once('ready', () => {
        try {
          this.seedCaches();
        } catch (error) {
          console.warn(`[${MODULE_ID}] EventTracker seedCaches failed:`, error);
        }
      });

      logInfo(`[${MODULE_ID}] EventTracker hooks registered`);
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to register EventTracker hooks:`, error);
    }
  }

  /**
   * The HP / resource cache key of an actor: its uuid. Every unlinked token's synthetic actor
   * shares its base actor's id but has its own uuid (Scene.x.Token.y.Actor.z), so keying by id
   * diffed one token's HP against its base actor or another token of the same monster. A linked
   * token's actor is the world actor itself, so they share one key. Falls back to the id.
   */
  private cacheKey(actor: unknown): string {
    const a = actor as { id?: unknown; uuid?: unknown } | null | undefined;
    return typeof a?.uuid === 'string' && a.uuid.length > 0 ? a.uuid : String(a?.id);
  }

  /** An unlinked token's synthetic actor, or null for a linked token (its actor is the world actor). */
  private unlinkedTokenActor(token: unknown): unknown {
    const t = token as { actorLink?: unknown; actor?: unknown } | null | undefined;
    return t?.actorLink === false && t.actor ? t.actor : null;
  }

  /** Seed the HP and resource caches from current actor state: world actors and every unlinked token's actor. */
  private seedCaches(): void {
    const actors = game.actors as unknown as { contents?: Iterable<unknown> } | undefined;
    for (const actor of actors?.contents ?? []) this.seedActor(actor);
    const scenes = game.scenes as unknown as { contents?: Iterable<unknown> } | undefined;
    for (const scene of scenes?.contents ?? []) {
      try {
        const tokens = (scene as { tokens?: Iterable<unknown> } | null)?.tokens ?? [];
        for (const token of tokens) {
          const tokenActor = this.unlinkedTokenActor(token);
          if (tokenActor) this.seedActor(tokenActor);
        }
      } catch {
        // skip this scene
      }
    }
  }

  private seedActor(actor: unknown): void {
    try {
      const k = this.cacheKey(actor);
      const sys = dig(actor, 'system');
      const hpData = rec(dig(sys, 'attributes', 'hp'));
      const hp = hpData?.value;
      if (typeof hp === 'number') {
        this.hpCache.set(k, hp);
        this.tempCache.set(k, typeof hpData?.temp === 'number' ? hpData.temp : 0);
      }

      const spells = rec(dig(sys, 'spells'));
      if (spells) {
        for (const [key, value] of Object.entries(spells)) {
          const amount = dig(value, 'value');
          if (typeof amount === 'number') {
            this.resourceCache.set(`${k}:spells.${key}`, amount);
          }
        }
      }
      const resources = rec(dig(sys, 'resources'));
      if (resources) {
        for (const [key, value] of Object.entries(resources)) {
          const amount = dig(value, 'value');
          if (typeof amount === 'number') {
            this.resourceCache.set(`${k}:resources.${key}`, amount);
          }
        }
      }
    } catch {
      // skip this actor
    }
  }

  /** Forget a deleted actor's cache entries, so the caches do not grow over a long session. */
  private forgetActor(actor: unknown): void {
    const k = this.cacheKey(actor);
    this.hpCache.delete(k);
    this.tempCache.delete(k);
    for (const key of [...this.resourceCache.keys()]) {
      if (key.startsWith(`${k}:`)) this.resourceCache.delete(key);
    }
  }

  // ===========================================================================
  // Chat log
  // ===========================================================================

  private onCreateChatMessage(message: unknown): void {
    const entry = this.parseChatMessage(message);
    this.chatLog.push(entry);

    // Trim to configured buffer size
    const max = this.getChatBufferSize();
    if (this.chatLog.length > max) {
      this.chatLog.splice(0, this.chatLog.length - max);
    }

    // Rolls are also significant session events
    this.logRollEvent(message, entry);
  }

  /**
   * The session event for a roll message (O3 item 6). A public roll becomes
   * `roll` (`damage-roll` for damage): its `description` is the player-safe
   * line the `/player` feed shows (no target AC/DC or outcome unless dnd5e's
   * `challengeVisibility` is `all`), `details.breakdown` the GM's full line. A
   * whispered, blind or self roll becomes `gm-roll`, which the dashboard never
   * sends to a player. Rest and usage cards get no roll event.
   */
  private logRollEvent(rawMessage: unknown, entry: ChatLogEntry): void {
    const source = rawMessage as { rolls?: unknown; whisper?: unknown; blind?: unknown };
    const rolls: unknown[] = Array.isArray(source.rolls) ? source.rolls : [];
    if (rolls.length === 0) return;
    const message = rawMessage as ChatMessage;
    if (chatRollKind(message) === 'rest' || dnd5eRestType(message) !== undefined) return;
    if (isUsageCard(message)) return;

    const dnd5eType = dnd5eRollType(message);
    // A plain `/r` roll flavored as damage still counts as damage (`parseDamage`), but its
    // line keeps its own flavor as the title and guesses no sources (`other`).
    const rollType = dnd5eType === 'other' && entry.damage ? 'damage' : dnd5eType;
    const described = describeMessageRolls(message, rolls, dnd5eType);
    const whisper: unknown[] = Array.isArray(source.whisper) ? source.whisper : [];
    const isPrivate = whisper.length > 0 || source.blind === true;

    const details: Record<string, unknown> = {
      rollType,
      total: described.total,
      breakdown: described.text,
      messageId: entry.id,
    };
    const [only] = described.rolls;
    if (only && described.rolls.length === 1) {
      if (only.natural !== undefined) details.natural = only.natural;
      if (only.dc !== undefined) details.dc = only.dc;
      if (only.outcome !== undefined) details.outcome = only.outcome;
    }
    if (entry.damage) {
      details.types = entry.damage.types;
      details.flavor = entry.flavor;
    }

    const eventType = isPrivate ? 'gm-roll' : rollType === 'damage' ? 'damage-roll' : 'roll';
    this.logSessionEvent(eventType, isPrivate ? described.text : described.textPlayerSafe, {
      actorName: entry.speakerName,
      actorId: entry.actorId,
      details,
      visibility: eventVisibilityFor(this.resolveSpeakerActor(message)),
    });
  }

  /**
   * The acting actor behind a message's speaker, resolved the same way
   * `resolveActor` does in `systems/dnd5e/roll-breakdown.ts`: the speaker
   * token first (`speaker.scene` + `speaker.token`), else `speaker.actor`.
   * Returns `unknown` (not `any`) — the only use is `eventVisibilityFor`,
   * which narrows it itself.
   */
  private resolveSpeakerActor(message: ChatMessage): unknown {
    try {
      const speaker = (message as unknown as { speaker?: unknown }).speaker as
        | { scene?: unknown; token?: unknown; actor?: unknown }
        | undefined;
      const sceneId = typeof speaker?.scene === 'string' ? speaker.scene : undefined;
      const tokenId = typeof speaker?.token === 'string' ? speaker.token : undefined;
      if (sceneId && tokenId) {
        const scene = game.scenes.get(sceneId);
        const token = scene?.tokens.get(tokenId) as { actor?: unknown } | undefined;
        if (token?.actor) return token.actor;
      }
      const actorId = typeof speaker?.actor === 'string' ? speaker.actor : undefined;
      return actorId ? game.actors.get(actorId) : null;
    } catch {
      return null;
    }
  }

  private parseChatMessage(message: unknown): ChatLogEntry {
    const rawTimestamp = dig(message, 'timestamp');
    const timestampMs: number = typeof rawTimestamp === 'number' ? rawTimestamp : Date.now();

    const speakerActorId = dig(message, 'speaker', 'actor');
    const speakerActorName =
      typeof speakerActorId === 'string' ? game.actors?.get(speakerActorId)?.name : undefined;
    const speakerName: string = (dig(message, 'speaker', 'alias') ||
      dig(message, 'alias') ||
      (speakerActorName ?? '') ||
      dig(message, 'author', 'name') ||
      dig(message, 'user', 'name') ||
      'Unknown') as string;

    const actorId: string | null = orNull(speakerActorId);

    const rawRolls = dig(message, 'rolls');
    const rolls: unknown[] = Array.isArray(rawRolls) ? rawRolls : [];
    const isRoll: boolean = Boolean(dig(message, 'isRoll') ?? false) || rolls.length > 0;

    const roll = isRoll && rolls.length > 0 ? this.parseRoll(rolls[0]) : null;
    const damage = this.parseDamage(message, rolls);

    const rawWhisper = dig(message, 'whisper');
    const whisperIds: unknown[] = Array.isArray(rawWhisper) ? rawWhisper : [];
    const whisperTo: string[] = [];
    for (const id of whisperIds) {
      if (typeof id === 'string') whisperTo.push(game.users?.get(id)?.name ?? id);
    }

    const messageType = this.classifyMessage(
      message,
      isRoll,
      damage !== null,
      whisperTo.length > 0
    );

    const content = dig(message, 'content');
    return {
      id: (dig(message, 'id') || this.nextId()) as string,
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      speakerName,
      actorId,
      messageType,
      isRoll,
      content: typeof content === 'string' ? content : '',
      flavor: orNull(dig(message, 'flavor')),
      roll,
      damage,
      whisperTo,
    };
  }

  private classifyMessage(
    message: unknown,
    isRoll: boolean,
    isDamage: boolean,
    isWhisper: boolean
  ): string {
    if (isDamage) return 'damage';
    if (isRoll) return 'roll';
    if (isWhisper) return 'whisper';

    const CMS: Record<string, unknown> =
      rec(CONST.CHAT_MESSAGE_STYLES) ?? rec(dig(CONST, 'CHAT_MESSAGE_TYPES')) ?? {};
    // Use `style` only: in Foundry v13 `message.type` is the document subtype
    // (a string), not the numeric chat style, so reading it would misclassify.
    const style = dig(message, 'style');

    if (style === CMS.IC) return 'ic';
    if (style === CMS.EMOTE) return 'emote';
    if (style === CMS.OOC) return 'ooc';
    return 'other';
  }

  private parseRoll(roll: unknown): ChatRollInfo {
    const dice: Array<{ faces: number; results: number[] }> = [];
    let isCritical = false;
    let isFumble = false;
    let advantage: 'advantage' | 'disadvantage' | null = null;

    try {
      const rawDice = dig(roll, 'dice');
      const diceTerms: unknown[] = Array.isArray(rawDice) ? rawDice : [];
      for (const term of diceTerms) {
        // Dice terms carry numeric faces and numeric results; read as they are.
        const faces = dig(term, 'faces') as number;
        const rawResults = dig(term, 'results');
        const resultList: unknown[] | null = Array.isArray(rawResults) ? rawResults : null;
        const results: number[] = resultList ? resultList.map(r => dig(r, 'result') as number) : [];
        dice.push({ faces, results });

        // Crit / fumble detection on the d20 only, considering kept (active) results
        if (faces === 20) {
          const activeResults: number[] = resultList
            ? resultList
                .filter(r => dig(r, 'active') !== false)
                .map(r => dig(r, 'result') as number)
            : results;
          if (activeResults.includes(20)) isCritical = true;
          if (activeResults.includes(1)) isFumble = true;

          // Advantage / disadvantage from kept-highest/lowest modifiers
          const rawModifiers = dig(term, 'modifiers');
          const mods: string = Array.isArray(rawModifiers) ? rawModifiers.join('') : '';
          const count = (dig(term, 'number') ?? 1) as number;
          if (count >= 2 && /kh/i.test(mods)) advantage = 'advantage';
          else if (count >= 2 && /kl/i.test(mods)) advantage = 'disadvantage';
        }
      }

      // dnd5e records advantage explicitly on roll options
      const advMode = dig(roll, 'options', 'advantageMode');
      if (advMode === 1) advantage = 'advantage';
      else if (advMode === -1) advantage = 'disadvantage';
    } catch {
      // best-effort parsing
    }

    const total = dig(roll, 'total');
    return {
      formula: (dig(roll, 'formula') || '') as string,
      total: typeof total === 'number' ? total : 0,
      dice,
      isCritical,
      isFumble,
      advantage,
    };
  }

  private parseDamage(message: unknown, rolls: unknown[]): ChatDamageInfo | null {
    try {
      const dnd = dig(message, 'flags', 'dnd5e');
      const flavor = (dig(message, 'flavor') || '') as string;
      const rollType = dig(dnd, 'roll', 'type') || dig(dnd, 'messageType');
      // dnd5e 6.0 keys damage off the message subtype (`isDamageRoll`), 5.x off flags.
      const isDamage =
        isDamageRoll(message as ChatMessage) ||
        rollType === 'damage' ||
        rollType === 'damage-roll' ||
        /\bdamage\b/i.test(flavor);

      if (!isDamage || rolls.length === 0) return null;

      let total = 0;
      const types = new Set<string>();

      for (const r of rolls) {
        const rollTotal = dig(r, 'total');
        if (typeof rollTotal === 'number') total += rollTotal;

        // Each damage roll term may carry a flavor that is the damage type
        const rawTerms = dig(r, 'terms');
        const terms: unknown[] = Array.isArray(rawTerms) ? rawTerms : [];
        for (const t of terms) {
          const fl = dig(t, 'options', 'flavor');
          if (fl && typeof fl === 'string') types.add(fl.toLowerCase());
        }
        const optType = dig(r, 'options', 'type');
        if (optType && typeof optType === 'string') types.add(optType.toLowerCase());
      }

      // dnd5e sometimes records the damage types on the message flags
      const flagTypes = dig(dnd, 'roll', 'damageTypes') || dig(dnd, 'damageTypes');
      const flagTypeList: unknown[] = Array.isArray(flagTypes) ? flagTypes : [];
      for (const t of flagTypeList) if (typeof t === 'string') types.add(t.toLowerCase());

      return { total, types: Array.from(types) };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Session events
  // ===========================================================================

  logSessionEvent(
    eventType: string,
    description: string,
    opts: {
      actorName?: string | null;
      actorId?: string | null;
      details?: Record<string, unknown>;
      visibility?: EventVisibility;
    } = {}
  ): void {
    const entry: SessionLogEntry = {
      id: this.nextId(),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      eventType,
      actorName: opts.actorName ?? null,
      actorId: opts.actorId ?? null,
      description,
      details: opts.details ?? {},
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    };
    this.sessionLog.push(entry);
    if (this.sessionLog.length > MAX_SESSION_BUFFER) {
      this.sessionLog.splice(0, this.sessionLog.length - MAX_SESSION_BUFFER);
    }
  }

  private onCombatStart(combat: unknown): void {
    const combatantCount = dig(combat, 'combatants', 'size') ?? 0;
    this.logSessionEvent('combat-start', `Combat started with ${text(combatantCount)} combatants`, {
      details: { combatId: dig(combat, 'id'), round: dig(combat, 'round') ?? 1, combatantCount },
      visibility: NO_SUBJECT_VISIBILITY,
    });
    // Seed the timeline with round 1
    this.recordCombatTurn(combat);
  }

  private onCombatEnd(combat: unknown): void {
    const rounds = dig(combat, 'round') ?? 0;
    this.logSessionEvent('combat-end', `Combat ended after ${text(rounds)} rounds`, {
      details: { combatId: dig(combat, 'id'), rounds },
      visibility: NO_SUBJECT_VISIBILITY,
    });
  }

  private onUpdateCombat(combat: unknown, changed: unknown): void {
    if (dig(changed, 'round') !== undefined || dig(changed, 'turn') !== undefined) {
      this.recordCombatTurn(combat);
    }
  }

  private recordCombatTurn(combat: unknown): void {
    try {
      const current = dig(combat, 'combatant');
      const entry: CombatTimelineEntry = {
        round: (dig(combat, 'round') ?? 0) as number,
        turn: (dig(combat, 'turn') ?? 0) as number,
        combatantName: (dig(current, 'name') ||
          dig(current, 'token', 'name') ||
          'Unknown') as string,
        actorId: orNull(dig(current, 'actor', 'id')),
        timestampMs: Date.now(),
      };
      this.combatTimeline.push(entry);
      // Cap timeline to a sane size
      if (this.combatTimeline.length > MAX_SESSION_BUFFER) {
        this.combatTimeline.splice(0, this.combatTimeline.length - MAX_SESSION_BUFFER);
      }
    } catch {
      // best-effort
    }
  }

  private onUpdateActor(actor: unknown, changed: unknown): void {
    const actorIdValue = dig(actor, 'id');
    if (!actorIdValue) return;
    // Foundry actor ids and names are strings; they are recorded as they are.
    const actorId = actorIdValue as string;
    const actorName = dig(actor, 'name') as string;
    const visibility = eventVisibilityFor(actor);

    // --- HP change detection (hit points and temp HP) ---
    // dnd5e takes damage from temp HP first and writes temp and value in one update; damage that
    // only hits temp HP changes `hp.temp` alone. Damage is the drop in both (the play recorder's
    // rule). Temp HP going up (gained, or an Undo putting it back) is never healing.
    const key = this.cacheKey(actor);
    const newHp: unknown = this.getProp(changed, 'system.attributes.hp.value');
    const rawTemp: unknown = this.getProp(changed, 'system.attributes.hp.temp');
    const hpChanged = typeof newHp === 'number';
    const tempChanged = rawTemp !== undefined;
    if (hpChanged || tempChanged) {
      const prev = this.hpCache.get(key);
      const prevTemp = this.tempCache.get(key) ?? 0;
      const to = hpChanged ? newHp : prev;
      const toTemp = tempChanged ? (typeof rawTemp === 'number' ? rawTemp : 0) : prevTemp;
      if (to !== undefined) this.hpCache.set(key, to);
      this.tempCache.set(key, toTemp);

      const delta = prev !== undefined && to !== undefined ? to - prev : 0;
      const tempLost = Math.max(0, prevTemp - toTemp);
      const damage = delta <= 0 ? tempLost - delta : 0;
      if (prev !== undefined && to !== undefined && (damage > 0 || delta > 0)) {
        const pending = this.takePendingApply(dig(actor, 'uuid'));

        if (damage > 0) {
          const credit = this.damageCredit(pending, damage, to <= 0);
          // Temp HP that just disappears (a rest, the GM clearing it) is no damage: a drop to
          // 0 temp HP with the hit points untouched counts only when a damage roll explains it.
          const tempCleared = delta === 0 && toTemp === 0 && !credit;
          if (!tempCleared) {
            const toTempText = tempLost > 0 ? ` (${tempLost} to temp HP)` : '';
            this.logSessionEvent('damage', `${actorName} took ${damage} damage${toTempText}`, {
              actorName,
              actorId,
              details: {
                amount: damage,
                from: prev,
                to,
                ...(tempLost > 0
                  ? { tempAbsorbed: tempLost, tempFrom: prevTemp, tempTo: toTemp }
                  : {}),
                source: credit?.label ?? null,
                ...(credit ? { sourceMessageId: credit.messageId, sourceExact: credit.exact } : {}),
              },
              visibility,
            });
          }
        } else {
          this.logSessionEvent('healing', `${actorName} healed ${delta} HP`, {
            actorName,
            actorId,
            details: { amount: delta, from: prev, to },
            visibility,
          });
        }
      }

      // Death and stabilization detection (hit points only)
      if (prev !== undefined && to !== undefined && prev !== to) {
        if (prev > 0 && to <= 0) {
          this.logSessionEvent('death', `${actorName} dropped to 0 HP`, {
            actorName,
            actorId,
            details: {},
            visibility,
          });
        } else if (prev <= 0 && to > 0) {
          this.logSessionEvent('stabilize', `${actorName} recovered above 0 HP`, {
            actorName,
            actorId,
            details: { to },
            visibility,
          });
        }
      }
    }

    // --- Spell slot / resource spend detection ---
    this.detectResourceSpend(actor, changed, visibility);
  }

  private detectResourceSpend(actor: unknown, changed: unknown, visibility: EventVisibility): void {
    try {
      const actorName = dig(actor, 'name') as string;
      const actorId = dig(actor, 'id') as string;
      const spells = rec(this.getProp(changed, 'system.spells'));
      if (spells) {
        for (const [key, value] of Object.entries(spells)) {
          const newVal = dig(value, 'value');
          if (typeof newVal !== 'number') continue;
          const cacheKey = `${this.cacheKey(actor)}:spells.${key}`;
          const prev = this.resourceCache.get(cacheKey);
          this.resourceCache.set(cacheKey, newVal);
          if (prev !== undefined && newVal < prev) {
            this.logSessionEvent(
              'resource-spent',
              `${actorName} expended a ${key} slot (${prev} → ${newVal})`,
              {
                actorName,
                actorId,
                details: { resource: key, from: prev, to: newVal },
                visibility,
              }
            );
          }
        }
      }

      const resources = rec(this.getProp(changed, 'system.resources'));
      if (resources) {
        for (const [key, value] of Object.entries(resources)) {
          // dnd5e 6 stores legendary actions and resistances as `spent`; `value` is derived.
          const entry = value as { value?: unknown; spent?: unknown } | null;
          const derived: unknown = this.getProp(actor, `system.resources.${key}.value`);
          const newVal =
            typeof entry?.value === 'number'
              ? entry.value
              : typeof entry?.spent === 'number'
                ? derived
                : undefined;
          if (typeof newVal !== 'number') continue;
          const cacheKey = `${this.cacheKey(actor)}:resources.${key}`;
          const prev = this.resourceCache.get(cacheKey);
          this.resourceCache.set(cacheKey, newVal);
          if (prev !== undefined && newVal < prev) {
            this.logSessionEvent(
              'resource-spent',
              `${actorName} spent ${prev - newVal} of ${key} (${prev} → ${newVal})`,
              {
                actorName,
                actorId,
                details: { resource: key, from: prev, to: newVal },
                visibility,
              }
            );
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  private onActiveEffect(effect: unknown, eventType: string): void {
    try {
      const parent = dig(effect, 'parent');
      const actorName = orNull(dig(parent, 'name'));
      const actorId = orNull(dig(parent, 'id'));
      const effectName = dig(effect, 'name') || dig(effect, 'label') || 'Unknown effect';
      const verb = eventType === 'condition-applied' ? 'gained' : 'lost';
      const statuses = Array.from((dig(effect, 'statuses') ?? []) as Iterable<unknown>).filter(
        (s: unknown): s is string => typeof s === 'string'
      );
      if (
        this.effectDeduper.isDuplicate({
          actor: typeof actorId === 'string' ? actorId : null,
          kind: eventType,
          name: text(effectName),
          statuses,
        })
      ) {
        return;
      }
      this.logSessionEvent(eventType, `${actorName || 'An actor'} ${verb} "${text(effectName)}"`, {
        actorName,
        actorId,
        details: { effectName, statuses },
        visibility: { ...eventVisibilityFor(parent), statuses },
      });
    } catch {
      // best-effort
    }
  }

  /** The noted dnd5e damage application for this actor, if at most 5 s old; consumed. */
  private takePendingApply(uuid: unknown): { messageId: string | null; t: number } | undefined {
    if (typeof uuid !== 'string') return undefined;
    const pending = this.pendingApply.get(uuid);
    this.pendingApply.delete(uuid);
    return pending && Date.now() - pending.t <= 5_000 ? pending : undefined;
  }

  /**
   * The damage roll an HP loss came from (the same rule as the play log): the
   * card it was applied from (exact), else the latest damage roll within 10 s
   * whose total fits the loss (`hpChangeFitsRoll`).
   */
  private damageCredit(
    pending: { messageId: string | null } | undefined,
    amount: number,
    stoppedAtZero: boolean
  ): { messageId: string; label: string | null; exact: boolean } | null {
    const labelOf = (entry: ChatLogEntry | undefined): string | null =>
      entry ? entry.flavor || entry.speakerName : null;
    if (pending?.messageId) {
      const messageId = pending.messageId;
      const entry = this.chatLog.find(e => e.id === messageId);
      return { messageId, label: labelOf(entry), exact: true };
    }
    const cutoff = Date.now() - 10_000;
    for (let i = this.chatLog.length - 1; i >= 0; i--) {
      const entry = this.chatLog[i];
      if (!entry || entry.timestampMs < cutoff || !entry.damage) continue;
      if (hpChangeFitsRoll(amount, entry.damage.total, stoppedAtZero)) {
        return { messageId: entry.id, label: labelOf(entry), exact: false };
      }
    }
    return null;
  }

  private getProp(obj: unknown, path: string): unknown {
    try {
      const fu = (
        globalThis as {
          foundry?: { utils?: { getProperty?: (object: object, key: string) => unknown } };
        }
      ).foundry?.utils;
      if (fu?.getProperty) return fu.getProperty(obj as object, path);
    } catch {
      // fall through to manual traversal
    }
    return path
      .split('.')
      .reduce<unknown>((acc, key) => (acc == null ? acc : (acc as Rec)[key]), obj);
  }

  // ===========================================================================
  // Accessors (used by the query handlers / data-access layer)
  // ===========================================================================

  getChatLog(
    filters: {
      limit?: number;
      speakerName?: string;
      messageType?: string;
      sinceTimestamp?: string;
    } = {}
  ): ChatLogEntry[] {
    let entries = this.chatLog.slice();

    if (filters.speakerName) {
      const name = filters.speakerName.toLowerCase();
      entries = entries.filter(e => e.speakerName.toLowerCase().includes(name));
    }

    if (filters.messageType && filters.messageType !== 'all') {
      if (filters.messageType === 'roll') {
        entries = entries.filter(e => e.isRoll);
      } else if (filters.messageType === 'damage') {
        entries = entries.filter(e => e.damage !== null);
      } else {
        entries = entries.filter(e => e.messageType === filters.messageType);
      }
    }

    if (filters.sinceTimestamp) {
      const since = Date.parse(filters.sinceTimestamp);
      if (!Number.isNaN(since)) {
        entries = entries.filter(e => e.timestampMs > since);
      }
    }

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    return entries.slice(-limit);
  }

  getSessionLog(
    filters: {
      limit?: number;
      eventType?: string;
      actorName?: string;
      sinceTimestamp?: string;
    } = {}
  ): SessionLogEntry[] {
    let entries = this.sessionLog.slice();

    if (filters.eventType) {
      entries = entries.filter(e => e.eventType === filters.eventType);
    }
    if (filters.actorName) {
      const name = filters.actorName.toLowerCase();
      entries = entries.filter(e => (e.actorName || '').toLowerCase().includes(name));
    }
    if (filters.sinceTimestamp) {
      const since = Date.parse(filters.sinceTimestamp);
      if (!Number.isNaN(since)) {
        entries = entries.filter(e => e.timestampMs > since);
      }
    }

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), MAX_SESSION_BUFFER);
    return entries.slice(-limit);
  }

  getCombatTimeline(): CombatTimelineEntry[] {
    return this.combatTimeline.slice();
  }

  /** Raw chat log (unfiltered) — used by combat play-by-play synthesis. */
  getRawChatLog(): ChatLogEntry[] {
    return this.chatLog.slice();
  }

  /**
   * Pure synthesis of a combat play-by-play from the in-memory buffers. Kept
   * free of Foundry globals so it can be unit-tested; the data-access layer
   * passes in the lightweight combat descriptor it reads from `game.combat`.
   */
  buildPlayByPlay(combat: { round?: number; started?: boolean } | null): {
    success: true;
    combatActive: boolean;
    totalRounds: number;
    rounds: Array<{ round: number; turns: PlayByPlayTurn[] }>;
    significantEvents: PlayByPlayEvent[];
    summary: { totalRounds: number; damageByActor: Record<string, number>; note: string | null };
  } {
    const chat = this.chatLog.slice();
    const timeline = this.combatTimeline.slice();
    const sessionEvents = this.sessionLog.slice();

    const combatStarts = sessionEvents.filter(e => e.eventType === 'combat-start');
    const startMs = combatStarts.length
      ? combatStarts[combatStarts.length - 1].timestampMs
      : (timeline[0]?.timestampMs ?? 0);

    const relevant = chat.filter(e => e.timestampMs >= startMs && (e.isRoll || e.damage !== null));

    const summarizeAction = (e: ChatLogEntry): PlayByPlayAction => {
      const parts: string[] = [];
      if (e.flavor) parts.push(e.flavor);
      if (e.roll) {
        let r = `rolled ${e.roll.total}`;
        if (e.roll.isCritical) r += ' (CRIT!)';
        if (e.roll.isFumble) r += ' (FUMBLE)';
        if (e.roll.advantage) r += ` [${e.roll.advantage}]`;
        parts.push(r);
      }
      if (e.damage) {
        parts.push(
          `${e.damage.total} ${e.damage.types.join('/')} damage`.replace(/\s+/g, ' ').trim()
        );
      }
      return {
        actor: e.speakerName,
        summary: parts.join(' — '),
        timestamp: e.timestamp,
        rollTotal: e.roll?.total ?? null,
        damage: e.damage?.total ?? null,
      };
    };

    const roundMap = new Map<number, { round: number; turns: PlayByPlayTurn[] }>();

    const turnWindows = timeline
      .filter(t => t.timestampMs >= startMs)
      .map((t, i, arr) => ({
        round: t.round,
        turn: t.turn,
        combatant: t.combatantName,
        startMs: t.timestampMs,
        endMs: arr[i + 1]?.timestampMs ?? Number.POSITIVE_INFINITY,
      }));

    if (turnWindows.length > 0) {
      for (const w of turnWindows) {
        const actions = relevant
          .filter(e => e.timestampMs >= w.startMs && e.timestampMs < w.endMs)
          .map(summarizeAction);
        if (!roundMap.has(w.round)) roundMap.set(w.round, { round: w.round, turns: [] });
        roundMap.get(w.round)!.turns.push({ combatant: w.combatant, actions });
      }
    } else {
      const r = combat?.round ?? 1;
      roundMap.set(r, {
        round: r,
        turns: [{ combatant: '(unattributed)', actions: relevant.map(summarizeAction) }],
      });
    }

    const significantEvents = sessionEvents
      .filter(
        e =>
          e.timestampMs >= startMs &&
          ['death', 'stabilize', 'condition-applied', 'condition-removed'].includes(e.eventType)
      )
      .map(e => ({
        type: e.eventType,
        description: e.description,
        actor: e.actorName,
        timestamp: e.timestamp,
      }));

    const damageByActor: Record<string, number> = {};
    for (const e of relevant) {
      if (e.damage)
        damageByActor[e.speakerName] = (damageByActor[e.speakerName] || 0) + e.damage.total;
    }

    const rounds = Array.from(roundMap.values()).sort((a, b) => a.round - b.round);
    const totalRounds = combat?.round ?? rounds.length;

    return {
      success: true,
      combatActive: !!combat?.started,
      totalRounds,
      rounds,
      significantEvents,
      summary: {
        totalRounds,
        damageByActor,
        note:
          turnWindows.length === 0
            ? 'No per-turn timeline was recorded for this combat (it may have started before the module loaded); actions are aggregated into a single round.'
            : null,
      },
    };
  }
}

/** Singleton, mirroring the permissionManager / transactionManager pattern. */
export const eventTracker = new EventTracker();
