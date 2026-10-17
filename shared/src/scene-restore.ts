/**
 * Scene restore from backup (I-128): put a scene's walls, lights, tiles and tokens back from a
 * copy of the world (the Pi's nightly backup restored on the PC, or any copy of the world folder).
 *
 * Flow:
 * - The backend tool `plan-scene-restore` reads the backup scene straight from the copy's
 *   `scenes` database (the module cannot: it runs in the browser) and the live scene from the
 *   module's read-only `getSceneState` query.
 * - It compares the two by document id and builds generic guarded ops (create with the old id,
 *   update the differing fields, delete) under the feature `scene-restore`, off by default.
 * - `apply-planned-change` applies the plan after a confirmation (deletes need the second one);
 *   `undo-change` reverts it, and it shows in Recent Changes like any guarded change.
 *
 * GM only.
 */

/** The guarded feature id and its world-setting switch (`feature.scene-restore.enabled`). */
export const SCENE_RESTORE_FEATURE_ID = 'scene-restore';

/** Module query name (prefixed with the module id on the wire). GM client only, read-only. */
export const SCENE_STATE_QUERY = 'getSceneState';

/** The embedded collections a restore can put back, in plan order. */
export const SCENE_RESTORE_PARTS = ['walls', 'lights', 'tiles', 'tokens'] as const;
export type SceneRestorePart = (typeof SCENE_RESTORE_PARTS)[number];

/** The embedded document name of each part (for ops and uuids). */
export const SCENE_RESTORE_DOCUMENT: Record<SceneRestorePart, string> = {
  walls: 'Wall',
  lights: 'AmbientLight',
  tiles: 'Tile',
  tokens: 'Token',
};

/** Request of `getSceneState`: a scene id, or the viewed scene when omitted. */
export interface SceneStateRequest {
  sceneId?: string;
}

/** Reply of `getSceneState`: the scene's embedded documents as plain source data. */
export interface SceneStateReply {
  sceneId: string;
  name: string;
  /** True when this is the scene the GM is viewing. */
  viewed: boolean;
  walls: Record<string, unknown>[];
  lights: Record<string, unknown>[];
  tiles: Record<string, unknown>[];
  tokens: Record<string, unknown>[];
}
