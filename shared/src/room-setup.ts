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
 * Scene Levels and further behaviors are a follow-up (Backlog `room-setup-levels`). GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** The guarded feature id and its world-setting switch (`feature.room-setup.enabled`). */
export const ROOM_SETUP_FEATURE_ID = 'room-setup';

/** Module query name (prefixed with the module id on the wire). GM client only, read-only. */
export const ROOM_SETUP_QUERY = 'planRoomSetup';

export const ROOM_SETUP_ACTIONS = ['teleport', 'spawn'] as const;
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
}

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

export type RoomSetupRequest = RoomTeleportRequest | RoomSpawnRequest;

/** A Region the plan creates, for the dashboard and Claude's answer. */
export interface RoomRegionSummary {
  name: string;
  sceneName: string;
  /** Grid squares: x, y, width, height. */
  squares: [number, number, number, number];
  role: 'entry' | 'arrival' | 'room';
}

/** The module's answer: the ops of one plan plus what the planner worked out. */
export interface RoomSetupPlan {
  summary: string;
  ops: GuardedOp[];
  regions: RoomRegionSummary[];
  /** spawn: the tokens that will be made. */
  tokens?: { name: string; actorId: string; x: number; y: number }[];
  /** spawn: creatures left out, each with the reason. */
  skipped?: { name: string; reason: string }[];
  warnings: string[];
}
