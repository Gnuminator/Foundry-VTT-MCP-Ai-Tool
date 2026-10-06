import type { EventVisibility } from '@gnuminator/shared';

/**
 * Shapes for the live game feed. These mirror the JSON returned by the MCP
 * bridge tools `get-recent-events` and `get-combat-state` (see the Foundry
 * module's session-events / data-access layers). The feed itself is exposed
 * behind the `GameFeed` interface so the polling implementation can later be
 * swapped for a push-based source without touching consumers.
 */

/** One significant session event (combat, damage, condition, resource, etc.). */
export interface SessionEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: string;
  actorName: string | null;
  actorId: string | null;
  description: string;
  details: Record<string, unknown>;
  /** What players can know about the event (M2); absent from older modules, whose events players never see. */
  visibility?: EventVisibility;
}

/** One captured module diagnostic (mirrors the bridge's DiagnosticEntry). */
export interface ModuleError {
  id: string;
  timestamp: string;
  timestampMs: number;
  level: 'error' | 'warn';
  message: string;
  stack: string | null;
  /** "module:<id>" / "system:<id>" / "world:<id>" parsed from the stack, or null. */
  module: string | null;
}

export interface CombatantHp {
  value: number;
  max: number;
  temp: number;
}

export interface DeathSaves {
  successes: number;
  failures: number;
}

export interface Combatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  actedThisRound: boolean;
  hp: CombatantHp;
  conditions: string[];
  isPC: boolean;
  category: string; // 'pc' | 'npc' | 'enemy'
  defeated: boolean;
  deathSaves: DeathSaves | null;
  /**
   * GM-hidden combatant (token hidden in the tracker). Surfaced by the bridge's
   * get-combat-state so the dashboard can drop it from the player view server-side.
   * Optional for forward-compatibility: undefined ⇒ treated as not hidden.
   */
  hidden?: boolean;
  /** M2: the combatant's token, actor and scene, and the actor's core status ids (absent from older modules). */
  tokenId?: string | null;
  actorId?: string | null;
  sceneId?: string | null;
  statuses?: string[];
  /** I-070: an NPC's legendary actions, legendary resistances and lair (GM only; absent from older modules). */
  boss?: BossResources | null;
}

/** A `{max, spent}` counter; `remaining` is `max - spent`. */
export interface BossCounter {
  max: number;
  spent: number;
  remaining: number;
}

export interface BossResources {
  legendary: BossCounter | null;
  resistances: BossCounter | null;
  /** `inside`: dnd5e's "in its lair" box; `initiative`: the lair's count (null means 20). */
  lair: { inside: boolean; initiative: number | null } | null;
}

export interface CombatState {
  active: boolean;
  round: number;
  turn: number;
  current: Combatant | null;
  combatants: Combatant[];
}

/** Lightweight world descriptor used to seed the AI's static context. */
export interface WorldInfo {
  /** Foundry world id (folder-safe slug), e.g. "ai-tool-test". GM-only: also the
   * `Campaigns/<worldId>` key the Obsidian renderer writes under. */
  id: string;
  title: string;
  systemId: string;
  systemVersion: string;
  foundryVersion: string;
  gmNames: string[];
}

export type ControlChannelStatus = 'connected' | 'disconnected';
export type FoundryReachability = 'reachable' | 'unreachable' | 'unknown';

export interface BridgeStatus {
  controlChannel: ControlChannelStatus;
  foundry: FoundryReachability;
  lastError: string | null;
  lastPollAt: string | null;
  /** ISO time Foundry first became 'unreachable' (link down); null while it is not. */
  foundryDownSince: string | null;
}

export interface GameFeedHandlers {
  onEvents(events: SessionEvent[], meta: { initial: boolean }): void;
  onCombat(combat: CombatState | null): void;
  onErrors(errors: ModuleError[], meta: { initial: boolean }): void;
  onStatus(status: BridgeStatus): void;
}

/**
 * A source of live game data. The polling implementation satisfies this today;
 * a future push feed can implement the same surface.
 */
export interface GameFeed {
  start(): void;
  stop(): void;
}
