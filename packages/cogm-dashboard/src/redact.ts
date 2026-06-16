import type { PlayerViewConfig } from './config.js';
import type {
  BridgeStatus,
  Combatant,
  CombatState,
  CombatantHp,
  SessionEvent,
  WorldInfo,
} from './feed/types.js';

/**
 * Server-side redaction for the player view (Phase 6).
 *
 * The player view shows the **public combat order** and a **public event feed**
 * only. GM-only data is removed HERE, on the server, before it is ever written to
 * a player's SSE stream or REST response — never hidden in CSS. The leak vectors
 * this guards (verified against the bridge):
 *   - exact enemy/NPC HP            → combat `hp` for non-PCs is nulled
 *   - exact HP deltas/before-after  → event `details` (carries from/to HP) is dropped
 *   - GM-hidden combatants          → dropped when the bridge flags `hidden`
 *   - diagnostics, AI commentary,   → never broadcast to players at all
 *     settings, the GM action surface
 *
 * These are pure functions so they unit-test exhaustively without a server.
 */

/** A player-safe combatant: enemy HP is removed; only a coarse band may remain. */
export interface PublicCombatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  actedThisRound: boolean;
  hp: CombatantHp | null;
  /** Coarse band for enemies when enabled (never exact numbers). null otherwise. */
  hpBand: 'healthy' | 'bloodied' | 'critical' | 'down' | null;
  conditions: string[];
  isPC: boolean;
  category: string;
  defeated: boolean;
  deathSaves: { successes: number; failures: number } | null;
}

export interface PublicCombatState {
  active: boolean;
  round: number;
  turn: number;
  current: PublicCombatant | null;
  combatants: PublicCombatant[];
}

/** Event types a player is allowed to see (public table events). Default-deny. */
export const PUBLIC_EVENT_TYPES: ReadonlySet<string> = new Set([
  'combat-start',
  'combat-end',
  'damage',
  'damage-roll',
  'healing',
  'death',
  'stabilize',
  'condition-applied',
  'condition-removed',
  'resource-spent',
  'scene-change',
]);

function hpBand(hp: CombatantHp | null): PublicCombatant['hpBand'] {
  if (!hp?.max) return null;
  if (hp.value <= 0) return 'down';
  const ratio = hp.value / hp.max;
  if (ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'bloodied';
  return 'healthy';
}

/** Redact a single combatant for the player view. PCs keep full info; others are stripped. */
export function redactCombatantForPlayer(c: Combatant, opts: PlayerViewConfig): PublicCombatant {
  if (c.isPC) {
    // The party's own HP/conditions/death saves are shared knowledge at the table.
    return {
      id: c.id,
      name: c.name,
      initiative: c.initiative,
      isCurrentTurn: c.isCurrentTurn,
      actedThisRound: c.actedThisRound,
      hp: c.hp,
      hpBand: null,
      conditions: c.conditions,
      isPC: true,
      category: c.category,
      defeated: c.defeated,
      deathSaves: c.deathSaves,
    };
  }
  return {
    id: c.id,
    name: c.name,
    initiative: c.initiative,
    isCurrentTurn: c.isCurrentTurn,
    actedThisRound: c.actedThisRound,
    hp: null, // never leak exact enemy/NPC HP
    hpBand: opts.showEnemyHpBands ? hpBand(c.hp) : null,
    conditions: opts.showEnemyConditions ? c.conditions : [],
    isPC: false,
    category: c.category,
    defeated: c.defeated,
    deathSaves: null,
  };
}

/** Redact the whole combat snapshot: drop hidden combatants, strip enemy HP. */
export function redactCombatForPlayer(
  combat: CombatState | null,
  opts: PlayerViewConfig
): PublicCombatState | null {
  if (!combat) return null;
  const visible = combat.combatants.filter(c => c.hidden !== true);
  const current =
    combat.current && combat.current.hidden !== true
      ? redactCombatantForPlayer(combat.current, opts)
      : null;
  return {
    active: combat.active,
    round: combat.round,
    turn: combat.turn,
    current,
    combatants: visible.map(c => redactCombatantForPlayer(c, opts)),
  };
}

/** A player-safe event: public type only, structured `details` (HP from/to) removed. */
export function redactEventForPlayer(event: SessionEvent): SessionEvent | null {
  if (!PUBLIC_EVENT_TYPES.has(event.eventType)) return null;
  return {
    id: event.id,
    timestamp: event.timestamp,
    timestampMs: event.timestampMs,
    eventType: event.eventType,
    actorName: event.actorName,
    actorId: event.actorId,
    description: event.description,
    details: {}, // drop structured details (carries exact HP before/after)
  };
}

export function redactEventsForPlayer(events: SessionEvent[]): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (const e of events) {
    const r = redactEventForPlayer(e);
    if (r) out.push(r);
  }
  return out;
}

/** World descriptor minus GM-only bits (GM names). */
export function redactWorldForPlayer(world: WorldInfo | null): Omit<WorldInfo, 'gmNames'> | null {
  if (!world) return null;
  return {
    title: world.title,
    systemId: world.systemId,
    systemVersion: world.systemVersion,
    foundryVersion: world.foundryVersion,
  };
}

/** Connection status minus the internal lastError string. */
export function redactStatusForPlayer(status: BridgeStatus): Omit<BridgeStatus, 'lastError'> {
  return {
    controlChannel: status.controlChannel,
    foundry: status.foundry,
    lastPollAt: status.lastPollAt,
  };
}
