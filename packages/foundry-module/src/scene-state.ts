/**
 * Scene state for the scene restore (I-128): the module's read-only `getSceneState` query returns
 * one scene's walls, lights, tiles and tokens as plain source data, so the backend can compare them
 * with a backup copy and plan the restore as guarded ops. Nothing is written here.
 *
 * The wire contract is `shared/src/scene-restore.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The query and feature names are mirrored here
 * and pinned by `scene-state.test.ts`.
 */
import type { SceneStateReply } from '@gnuminator/shared';

import { ERROR_MESSAGES } from './constants.js';

/** Query name (mirror of the shared `SCENE_STATE_QUERY`). */
export const SCENE_STATE_QUERY = 'getSceneState';

/** Feature id (mirror of the shared `SCENE_RESTORE_FEATURE_ID`). */
export const SCENE_RESTORE_FEATURE_ID = 'scene-restore';

interface Doc {
  toObject?: () => Record<string, unknown>;
}
type Collection = { contents?: Doc[] } | Doc[] | undefined;
interface SceneLike {
  id: string;
  name: string;
  walls: Collection;
  lights: Collection;
  tiles: Collection;
  tokens: Collection;
}
interface ScenesLike {
  current?: SceneLike;
  get?: (id: string) => SceneLike | undefined;
}

/** The contents of a Foundry collection (or a plain array) as an array. */
function contentsOf(collection: Collection): Doc[] {
  if (Array.isArray(collection)) return collection;
  return collection?.contents ?? [];
}

/** A document's source data as a plain object, without the stats Foundry stamps on every write. */
function sourceOf(doc: Doc): Record<string, unknown> {
  const data = doc.toObject?.() ?? { ...doc };
  delete data._stats;
  return data;
}

/** One scene's embedded walls, lights, tiles and tokens; the viewed scene when no id is given. */
export function getSceneState(request: unknown): SceneStateReply {
  const sceneId =
    request && typeof (request as { sceneId?: unknown }).sceneId === 'string'
      ? (request as { sceneId: string }).sceneId
      : undefined;
  const scenes = game.scenes as unknown as ScenesLike | undefined;
  const scene = sceneId ? scenes?.get?.(sceneId) : scenes?.current;
  if (!scene) {
    throw new Error(sceneId ? `No scene with id "${sceneId}"` : ERROR_MESSAGES.SCENE_NOT_FOUND);
  }
  return {
    sceneId: scene.id,
    name: scene.name,
    viewed: scenes?.current?.id === scene.id,
    walls: contentsOf(scene.walls).map(sourceOf),
    lights: contentsOf(scene.lights).map(sourceOf),
    tiles: contentsOf(scene.tiles).map(sourceOf),
    tokens: contentsOf(scene.tokens).map(sourceOf),
  };
}
