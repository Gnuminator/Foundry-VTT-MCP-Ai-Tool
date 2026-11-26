/**
 * Room setup tools (I-133): Claude builds parts of a scene with Foundry 14's own Regions, all
 * through guarded writes (plan, confirm, apply, undo), behind the feature `room-setup`
 * (off by default).
 *
 * Flow:
 * - The bridge tool `plan-room-setup` (build set) sends a {@link RoomSetupRequest} to the
 *   module's read-only `planRoomSetup` query. The module knows the scene's grid, levels, tokens
 *   and actors, so it turns grid squares into pixels, finds free squares and builds generic
 *   guarded ops (`create` of Regions and Tokens). Nothing is written there.
 * - The backend stores the ops as a plan (feature `room-setup`); `apply-planned-change` applies
 *   it and `undo-change` deletes what it made again, so it shows in Recent Changes.
 *
 * Region kinds in this first version:
 * - `teleport`: a rectangle that moves a token that enters it to another rectangle (same scene
 *   or another), Foundry's `teleportToken` Region behavior. Optionally both ways.
 * - `spawn`: Foundry 14 has no "spawn token" Region behavior, so a spawn is a labelled room
 *   Region plus Tokens made from actors and set on free squares inside it, hidden by default.
 *
 * Part 2 (Backlog `room-setup-levels`): `levels` makes Scene Levels, `stairs` a Region with a
 * `changeLevel` behavior, `hazard` a Region with difficult terrain, darkness or an existing
 * ActiveEffect (I-122, core behaviors only, never code). GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** The guarded feature id and its world-setting switch (`feature.room-setup.enabled`). */
export const ROOM_SETUP_FEATURE_ID = 'room-setup';

/** Module query name (prefixed with the module id on the wire). GM client only, read-only. */
export const ROOM_SETUP_QUERY = 'planRoomSetup';

export const ROOM_SETUP_ACTIONS = [
  'teleport',
  'spawn',
  'levels',
  'stairs',
  'hazard',
  'whisper',
  'practice',
] as const;
export type RoomSetupAction = (typeof ROOM_SETUP_ACTIONS)[number];

/** Where teleported tokens land inside the destination (Foundry's own choices). */
export const ROOM_TELEPORT_PLACEMENTS = ['random', 'center', 'relative'] as const;
export type RoomTeleportPlacement = (typeof ROOM_TELEPORT_PLACEMENTS)[number];

/** A rectangle in grid squares: top-left square (column x, row y) and size in squares. */
export interface RoomArea {
  x: number;
  y: number;
  width: number;
  height: number;
  /** A scene id or name; default the scene the GM is viewing. */
  scene?: string;
  /** Confine the Region to one Scene Level (name or id); default the viewed level. */
  level?: string;
}

/** Hazard kinds: Foundry's own Region behaviors, no code. */
export const ROOM_HAZARD_KINDS = ['difficult', 'darkness', 'effect'] as const;
export type RoomHazardKind = (typeof ROOM_HAZARD_KINDS)[number];

/** adjustDarknessLevel modes (Foundry's own 0, 1, 2). */
export const ROOM_DARKNESS_MODES = ['override', 'brighten', 'darken'] as const;

export interface RoomTeleportRequest {
  action: 'teleport';
  /** The Region name; the destination is named "<name> (arrival)". */
  name?: string;
  from: RoomArea;
  to: RoomArea;
  /** Also teleport back from the destination (default false). */
  twoWay?: boolean;
  /** Ask the token's player to confirm before teleporting (default false). */
  choice?: boolean;
  placement?: RoomTeleportPlacement;
}

export interface RoomSpawnCreature {
  /** An actor id or name. */
  actor: string;
  /** How many tokens (default 1, at most 20). */
  count?: number;
}

export interface RoomSpawnRequest {
  action: 'spawn';
  /** The room Region's name. */
  name: string;
  area: RoomArea;
  creatures: RoomSpawnCreature[];
  /** Tokens start hidden from players (default true). */
  hidden?: boolean;
}

/** One Scene Level to create. Elevations are in the scene's distance units; top null is open ended. */
export interface RoomLevelSpec {
  name: string;
  bottom: number;
  top?: number | null;
  /** A background image path in Foundry's data folder. */
  background?: string;
}

export interface RoomLevelsRequest {
  action: 'levels';
  /** A scene id or name; default the viewed scene. */
  scene?: string;
  levels: RoomLevelSpec[];
}

/** A staircase: a Region whose `changeLevel` behavior offers the listed levels. */
export interface RoomStairsRequest {
  action: 'stairs';
  name: string;
  area: RoomArea;
  /** Level names or ids it joins (at least 2); default every level of the scene. */
  levels?: string[];
  /** Movement actions that trigger it (e.g. walk, climb); default all. */
  movementActions?: string[];
}

export interface RoomHazardRequest {
  action: 'hazard';
  name: string;
  area: RoomArea;
  kind: RoomHazardKind;
  /** difficult: dnd5e difficult terrain (movement costs double); magical terrain is told apart by which creatures can ignore it. */
  magical?: boolean;
  /** darkness: how it changes the scene darkness, and by how much (0 to 1). */
  darknessMode?: (typeof ROOM_DARKNESS_MODES)[number];
  modifier?: number;
  /** effect: the uuid of an existing ActiveEffect to apply while a token is inside. */
  effectUuid?: string;
}

/**
 * A room card whispered to the GMs only when a token enters the area (I-168): a Region with
 * Foundry's `executeScript` behavior that posts one whispered chat message from the active GM's
 * client. Foundry loads a behavior's source on every client, so the card text is NOT in it: it
 * lives on a GM-only journal entry (ownership none) made in the same plan; the script only names
 * its uuid. Players are shown nothing (live check on 14.370: Foundry itself still delivers
 * whispers and no-access entries to every client, as it does for any whisper, so a player's
 * browser console can read them). The Region name and the entry name: use a neutral name.
 */
export interface RoomWhisperRequest {
  action: 'whisper';
  name: string;
  area: RoomArea;
  /** The card text the GM reads (plain text, at most 2000 characters). */
  text: string;
  /** Whisper only the first time a token enters (the behavior turns itself off). Default false. */
  once?: boolean;
}

/**
 * A practice room for new players (idea 2.14): one plan makes a small scene, a training dummy,
 * one practice hero per player (owned by that player, with a weapon attack and a cantrip), a
 * short step list as a journal entry and a begun combat, so a new player can move, attack, cast
 * and end a turn without the GM. Generic: no book or campaign content. Undo removes all of it until someone has played in the room (then the documents have changed and Undo refuses).
 */
export interface RoomPracticeRequest {
  action: 'practice';
  /** The scene name (default "Practice Room"). */
  name?: string;
}

export type RoomSetupRequest =
  | RoomPracticeRequest
  | RoomTeleportRequest
  | RoomSpawnRequest
  | RoomLevelsRequest
  | RoomStairsRequest
  | RoomHazardRequest
  | RoomWhisperRequest;

/** A Region the plan creates, for the dashboard and Claude's answer. */
export interface RoomRegionSummary {
  name: string;
  sceneName: string;
  /** Grid squares: x, y, width, height. */
  squares: [number, number, number, number];
  role: 'entry' | 'arrival' | 'room' | 'stairs' | 'hazard' | 'whisper';
}

/** The module's answer: the ops of one plan plus what the planner worked out. */
export interface RoomSetupPlan {
  summary: string;
  ops: GuardedOp[];
  regions: RoomRegionSummary[];
  /** levels: the Scene Levels that will be made. */
  levels?: { name: string; bottom: number; top: number | null }[];
  /** spawn: the tokens that will be made. */
  tokens?: { name: string; actorId: string; x: number; y: number }[];
  /** spawn: creatures left out, each with the reason. */
  skipped?: { name: string; reason: string }[];
  warnings: string[];
}
