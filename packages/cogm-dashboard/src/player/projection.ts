import {
  CORE_STATUS_LABELS,
  UNKNOWN_CREATURE,
  type EventVisibility,
  type PlayerCombat,
  type PlayerCombatant,
  type PlayerEvent,
  type PlayerHandout,
  type PlayerState,
  type PlayerVisibility,
} from '@gnuminator/shared';

import type { PlayerViewConfig } from '../config.js';
import type {
  BridgeStatus,
  Combatant,
  CombatState,
  SessionEvent,
  WorldInfo,
} from '../feed/types.js';

/**
 * The player page's data, built by projection (docs/design/CURSE-OF-STRAHD-PLAN.md
 * feature 2, M2): every field a player receives is copied from an allowlist or
 * generated from a fixed template; GM objects are never forwarded with parts
 * removed. Pure functions, so they test exhaustively without a server.
 *
 * Rules:
 * - Events: default deny. An event needs a known type AND the module's
 *   visibility stamp (events from older modules have none and are dropped).
 *   Text is regenerated from templates with the player-facing name; numbers
 *   only for PCs; `details` is never copied. Public rolls (`roll`,
 *   `damage-roll`) keep the module's player-safe line (what Foundry's public
 *   chat shows), with the roller renamed to the player-facing name.
 * - Combat: hidden combatants and tokens players cannot see are dropped;
 *   names come from the visibility context; conditions only from core status
 *   ids; HP numbers and death saves only for PCs.
 */

/** How many feed lines the player page keeps. */
export const PLAYER_FEED_LIMIT = 60;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function statusLabels(statuses: readonly unknown[] | undefined): string[] {
  const labels: string[] = [];
  for (const id of statuses ?? []) {
    const label = typeof id === 'string' ? CORE_STATUS_LABELS[id] : undefined;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** The name players know the event's subject by, or null when they may not learn of it. */
function subjectName(v: EventVisibility): string | null {
  const name = str(v.playerName);
  if (!name) return null;
  if (v.subject === 'pc') return name;
  if (v.subject === 'npc' && v.tokenVisible) return name;
  return null;
}

function isPc(v: EventVisibility): boolean {
  return v.subject === 'pc' && str(v.playerName) !== null;
}

/**
 * A public roll's player-safe line ("<speaker>, <label>: <dice>"), as players
 * may see it. A PC's line is kept as is. For anyone else the subject rule of
 * every other event applies (an NPC with a visible, named token) and the
 * speaker head is rebuilt with the player-facing name: Foundry's chat alias
 * can be a name players never see on the canvas (the true name of a token
 * whose name display is off, or a world actor rolled from its sheet). A line
 * whose head is not the event's speaker is dropped.
 */
function rollLine(e: SessionEvent, v: EventVisibility): string | null {
  const line = str(e.description);
  if (!line) return null;
  if (isPc(v)) return line;
  const name = subjectName(v);
  const speaker = str(e.actorName);
  if (!name || !speaker || !line.startsWith(`${speaker}, `)) return null;
  return `${name}, ${line.slice(speaker.length + 2)}`;
}

type Template = (event: SessionEvent, v: EventVisibility) => string | null;

const TEMPLATES: Readonly<Record<string, Template>> = {
  'combat-start': () => 'Combat started.',
  'combat-end': e => {
    const rounds = num(e.details.rounds);
    return rounds !== null && rounds > 0
      ? `Combat ended after ${rounds} round${rounds === 1 ? '' : 's'}.`
      : 'Combat ended.';
  },
  damage: (e, v) => {
    const name = subjectName(v);
    if (!name) return null;
    const amount = num(e.details.amount);
    return isPc(v) && amount !== null ? `${name} took ${amount} damage.` : `${name} was hit.`;
  },
  healing: (e, v) => {
    const name = subjectName(v);
    if (!name) return null;
    const amount = num(e.details.amount);
    return isPc(v) && amount !== null ? `${name} regained ${amount} HP.` : `${name} was healed.`;
  },
  death: (_e, v) => {
    const name = subjectName(v);
    if (!name) return null;
    return isPc(v) ? `${name} dropped to 0 HP.` : `${name} went down.`;
  },
  stabilize: (_e, v) => (isPc(v) ? `${str(v.playerName)} is back up.` : null),
  'condition-applied': (_e, v) => {
    const name = subjectName(v);
    const labels = statusLabels(v.statuses);
    return name && labels.length > 0 ? `${name} is now ${labels.join(', ')}.` : null;
  },
  'condition-removed': (_e, v) => {
    const name = subjectName(v);
    const labels = statusLabels(v.statuses);
    return name && labels.length > 0 ? `${name} is no longer ${labels.join(', ')}.` : null;
  },
  'resource-spent': (e, v) => {
    if (!isPc(v)) return null;
    const resource = str(e.details.resource);
    const level = resource ? /^spell([1-9])$/.exec(resource)?.[1] : undefined;
    if (level) return `${str(v.playerName)} used a level ${level} spell slot.`;
    if (resource === 'pact') return `${str(v.playerName)} used a pact magic slot.`;
    return null;
  },
  'scene-change': (_e, v) => {
    const scene = str(v.sceneName);
    return scene ? `Scene: ${scene}.` : null;
  },
  // Public rolls: the module's player-safe line, named as players know the roller.
  roll: rollLine,
  'damage-roll': rollLine,
};

/** One session event as a player may see it, or null (default deny). */
export function projectEvent(event: SessionEvent): PlayerEvent | null {
  const template = Object.prototype.hasOwnProperty.call(TEMPLATES, event.eventType)
    ? TEMPLATES[event.eventType]
    : undefined;
  const visibility = event.visibility;
  if (!template || !visibility) return null;
  const text = template(event, visibility);
  if (!text) return null;
  return {
    id: String(event.id),
    timestampMs: num(event.timestampMs) ?? 0,
    type: event.eventType,
    text,
  };
}

/** The newest `limit` events players may see, oldest first. */
export function projectEvents(
  events: readonly SessionEvent[],
  limit = PLAYER_FEED_LIMIT
): PlayerEvent[] {
  const out: PlayerEvent[] = [];
  for (const event of events) {
    const projected = projectEvent(event);
    if (projected) out.push(projected);
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

function hpBand(c: Combatant): PlayerCombatant['hpBand'] {
  const value = num(c.hp?.value);
  const max = num(c.hp?.max);
  if (value === null || max === null || max <= 0) return null;
  if (value <= 0) return 'down';
  const ratio = value / max;
  if (ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'bloodied';
  return 'healthy';
}

/**
 * The combat tracker as players may see it. Without a visibility context (not
 * fetched yet, or an older module), non-PC combatants are listed as
 * `UNKNOWN_CREATURE` unless hidden.
 */
export function projectCombat(
  combat: CombatState | null,
  visibility: PlayerVisibility | null,
  opts: PlayerViewConfig
): PlayerCombat | null {
  if (!combat || !combat.active) return null;
  const pcActors = new Set(visibility?.pcActorIds ?? []);
  const visibleTokens = new Map((visibility?.tokens ?? []).map(t => [t.tokenId, t] as const));
  const combatants: PlayerCombatant[] = [];
  for (const c of combat.combatants) {
    if (c.hidden === true) continue;
    const actorId = str(c.actorId);
    const pc = visibility && actorId ? pcActors.has(actorId) : c.isPC === true;
    let name: string;
    if (pc) {
      name = str(c.name) ?? UNKNOWN_CREATURE;
    } else if (visibility) {
      const token = c.tokenId ? visibleTokens.get(c.tokenId) : undefined;
      if (!token) continue; // hidden token, or not on the scene players see
      name = str(token.name) ?? UNKNOWN_CREATURE;
    } else {
      name = UNKNOWN_CREATURE;
    }
    const conditions = pc || opts.showEnemyConditions ? statusLabels(c.statuses) : [];
    combatants.push({
      id: String(c.id),
      name,
      initiative: num(c.initiative),
      isCurrentTurn: c.isCurrentTurn === true,
      isPC: pc,
      side: pc ? 'pc' : c.category === 'enemy' ? 'enemy' : 'npc',
      defeated: c.defeated === true,
      hp:
        pc && c.hp
          ? { value: num(c.hp.value) ?? 0, max: num(c.hp.max) ?? 0, temp: num(c.hp.temp) ?? 0 }
          : null,
      hpBand: !pc && opts.showEnemyHpBands ? hpBand(c) : null,
      conditions,
      deathSaves:
        pc && c.deathSaves
          ? {
              successes: num(c.deathSaves.successes) ?? 0,
              failures: num(c.deathSaves.failures) ?? 0,
            }
          : null,
    });
  }
  return { active: true, round: num(combat.round) ?? 0, combatants };
}

export function playerStatus(status: BridgeStatus): PlayerState['status'] {
  if (status.controlChannel !== 'connected') return 'disconnected';
  if (status.foundry === 'reachable') return 'live';
  if (status.foundry === 'unreachable') return 'foundry-offline';
  return 'connecting';
}

export interface PlayerStateInputs {
  status: BridgeStatus;
  world: WorldInfo | null;
  visibility: PlayerVisibility | null;
  combat: CombatState | null;
  events: readonly SessionEvent[];
  handouts: readonly PlayerHandout[];
  opts: PlayerViewConfig;
}

/** Everything the player page shows, projected. */
export function buildPlayerState(input: PlayerStateInputs): PlayerState {
  return {
    status: playerStatus(input.status),
    world: input.world ? { title: input.world.title, systemId: input.world.systemId } : null,
    scene: input.visibility?.scene ? input.visibility.scene.name : null,
    combat: projectCombat(input.combat, input.visibility, input.opts),
    events: projectEvents(input.events),
    handouts: input.handouts.map(h => ({
      id: h.id,
      title: h.title,
      html: h.html,
      revealedAt: h.revealedAt,
    })),
  };
}
