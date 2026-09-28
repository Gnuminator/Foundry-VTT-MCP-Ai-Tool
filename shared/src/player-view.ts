/**
 * Player view contract (docs/CURSE-OF-STRAHD-PLAN.md feature 2, M2).
 *
 * Foundry sends all world data to every client, so nothing in Foundry is
 * secret; the player page of the co-GM dashboard is the one place the tool
 * decides what a player sees. Everything it receives is built by PROJECTION:
 * an allowlisted copy of fields from GM data plus the visibility context
 * below, never by deleting known-bad fields from a GM object.
 *
 * Flow:
 * - The GM client computes what players can see (`getPlayerVisibility`) and
 *   stamps every session event with an `EventVisibility` when it is created.
 * - Combatants from `get-combat-state` carry `tokenId`, `actorId` and core
 *   `statuses` so the dashboard can name them the way players see them.
 * - Revealed pages (handouts) are the bridge vault's allowlist
 *   (`gm/reveals.json` `pages.<pageId>`) AND observable by a player per
 *   Foundry ownership; their HTML is sanitized by the dashboard server.
 * - The dashboard's `/api/player/state` and `/api/player/stream` always
 *   project, whatever credential is presented.
 */

/** Module query names (prefixed with the module id on the wire). */
export const PLAYER_VIEW_QUERIES = {
  /** `{}` -> `PlayerVisibility`. GM client only. */
  visibility: 'getPlayerVisibility',
  /** `{ uuids: string[] }` -> `{ pages: PageForPlayers[] }`. GM client only. */
  pages: 'getPagesForPlayers',
} as const;

/** The player-facing label for a token whose name players cannot see. */
export const UNKNOWN_CREATURE = 'Unknown creature';
/** The player-facing label for a scene without a navigation name. */
export const UNKNOWN_SCENE = 'Current scene';

/** What the players can see right now, computed on the GM client. */
export interface PlayerVisibility {
  schema: 1;
  /** When the GM client computed it (ms since epoch). */
  computedAt: number;
  /** Actor ids at least one non-GM user owns (OWNER): the party's characters and companions. */
  pcActorIds: string[];
  /** The active scene as players know it (`navName`, else `UNKNOWN_SCENE`); null without one. */
  scene: { id: string; name: string } | null;
  /** Tokens on the active scene that are not hidden, named the way a player sees them. */
  tokens: PlayerVisibleToken[];
}

export interface PlayerVisibleToken {
  tokenId: string;
  actorId: string | null;
  /**
   * The token's name when a player can see it: a player owns the token, or its
   * display mode shows the name to non-owners (Hover, Always). Else `UNKNOWN_CREATURE`.
   */
  name: string;
  /** A non-GM user owns the token's actor. */
  pc: boolean;
}

/** Stamped on a session event by the GM client when the event is created. */
export interface EventVisibility {
  /** `pc`: a non-GM user owns the subject actor; `npc`: any other actor; null: no subject. */
  subject: 'pc' | 'npc' | null;
  /** The subject has a non-hidden token on the active scene. */
  tokenVisible: boolean;
  /** The name players know the subject by (PC: actor name; NPC: visible token's player-facing name). */
  playerName: string | null;
  /** Condition events: the effect's core status ids (`effect.statuses`), the only condition data a player may see. */
  statuses?: string[];
  /** Scene events: the player-facing scene name. */
  sceneName?: string;
}

/** A page as `getPagesForPlayers` reports it (GM-side data, sanitized before any player sees it). */
export interface PageForPlayers {
  uuid: string;
  exists: boolean;
  name: string | null;
  /**
   * At least one non-GM user can open the page in Foundry: OBSERVER or more on
   * the page (own or inherited ownership) AND on its journal, since Foundry 14
   * lists a journal only for users who can observe it and treats its pages as
   * invisible otherwise.
   */
  observable: boolean;
  /** At least one non-GM user can observe the page's journal (it is listed for them). */
  journalObservable: boolean;
  /** `text.content` of a text page, else null. Raw GM HTML: never forward without sanitizing. */
  html: string | null;
}

// ---------------------------------------------------------------------------
// What the player page receives
// ---------------------------------------------------------------------------

/** One feed line on the player page. */
export interface PlayerEvent {
  id: string;
  timestampMs: number;
  type: string;
  text: string;
}

export interface PlayerCombatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  isPC: boolean;
  side: 'pc' | 'npc' | 'enemy';
  defeated: boolean;
  /** PCs only. */
  hp: { value: number; max: number; temp: number } | null;
  /** Non-PCs, when the GM enabled bands; never numbers. */
  hpBand: 'healthy' | 'bloodied' | 'critical' | 'down' | null;
  /** Labels of core status conditions only (`CORE_STATUS_LABELS`), never custom effect names. */
  conditions: string[];
  /** PCs only. */
  deathSaves: { successes: number; failures: number } | null;
}

export interface PlayerCombat {
  active: boolean;
  round: number;
  combatants: PlayerCombatant[];
}

export interface PlayerHandout {
  /** The page id (stable). */
  id: string;
  title: string;
  /** Sanitized HTML. */
  html: string;
  revealedAt: string | null;
}

/** `/api/player/state` and the player stream's `state` frame. */
export interface PlayerState {
  status: 'live' | 'foundry-offline' | 'disconnected' | 'connecting';
  world: { title: string; systemId: string } | null;
  scene: string | null;
  combat: PlayerCombat | null;
  events: PlayerEvent[];
  handouts: PlayerHandout[];
}

/**
 * Core and dnd5e status ids a player may see, with their labels. A status id
 * not listed here is dropped from the player view (custom effects never show).
 */
export const CORE_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bleeding: 'Bleeding',
  blinded: 'Blinded',
  bloodied: 'Bloodied',
  burning: 'Burning',
  burrowing: 'Burrowing',
  charmed: 'Charmed',
  concentrating: 'Concentrating',
  cursed: 'Cursed',
  dead: 'Dead',
  deafened: 'Deafened',
  dehydrated: 'Dehydrated',
  diseased: 'Diseased',
  dodging: 'Dodging',
  encumbered: 'Encumbered',
  ethereal: 'Ethereal',
  exceedingCarryingCapacity: 'Exceeding carrying capacity',
  exhaustion: 'Exhaustion',
  falling: 'Falling',
  flying: 'Flying',
  frightened: 'Frightened',
  grappled: 'Grappled',
  heavilyEncumbered: 'Heavily encumbered',
  hiding: 'Hiding',
  hovering: 'Hovering',
  incapacitated: 'Incapacitated',
  invisible: 'Invisible',
  malnourished: 'Malnourished',
  marked: 'Marked',
  paralyzed: 'Paralyzed',
  petrified: 'Petrified',
  poisoned: 'Poisoned',
  prone: 'Prone',
  restrained: 'Restrained',
  silenced: 'Silenced',
  sleeping: 'Sleeping',
  stable: 'Stable',
  stunned: 'Stunned',
  suffocating: 'Suffocating',
  surprised: 'Surprised',
  transformed: 'Transformed',
  unconscious: 'Unconscious',
});
