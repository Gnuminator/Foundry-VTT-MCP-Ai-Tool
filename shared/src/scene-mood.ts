/**
 * Scene mood presets and scene music (I-034, I-129): darkness, global light, weather and a
 * playlist for a scene, saved as named presets on the scene, applied or set by hand, and
 * playlists started, stopped or switched, all as guarded changes under the feature `scene-mood`
 * (off by default).
 *
 * Flow:
 * - The bridge tool `plan-scene-mood` (play set) sends a {@link SceneMoodPlanRequest} to the
 *   module's read-only `planSceneMood` query. The module builds generic guarded ops (`update` of
 *   the scene's environment, of a playlist and its sounds, or of the scene's preset flag);
 *   nothing is written there.
 * - The bridge stores the ops as a guarded plan; `apply-planned-change` applies it and
 *   `undo-change` reverts it, so every change shows in Recent Changes.
 * - `list-scene-moods` reads the presets, the playlists and what is playing (query
 *   `getSceneMoods`, read-only).
 *
 * GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** The guarded feature id and its world-setting switch (`feature.scene-mood.enabled`). */
export const SCENE_MOOD_FEATURE_ID = 'scene-mood';

/** Module query names (prefixed with the module id on the wire). GM client only. */
export const SCENE_MOOD_PLAN_QUERY = 'planSceneMood';
export const SCENE_MOODS_QUERY = 'getSceneMoods';

/** Where the presets live: `flags.<module id>.moods.<slug>` on the scene. */
export const SCENE_MOOD_FLAG = 'moods';

/** What `plan-scene-mood` can do. */
export const SCENE_MOOD_ACTIONS = ['apply', 'set', 'save', 'remove-preset', 'music'] as const;
export type SceneMoodAction = (typeof SCENE_MOOD_ACTIONS)[number];

/** What a `music` change does with a playlist. */
export const SCENE_MUSIC_MODES = ['play', 'stop', 'switch'] as const;
export type SceneMusicMode = (typeof SCENE_MUSIC_MODES)[number];

/** The look and sound of a mood. Every field is optional; a missing one is left as it is. */
export interface SceneMoodSettings {
  /** 0 (bright) to 1 (dark). */
  darkness?: number;
  globalLight?: boolean;
  /** A weather effect id of the core (rain, snow, fog, ...), or "none" for clear. */
  weather?: string;
  /** Playlist name; it is switched to (others stop). "none" stops all music. */
  playlist?: string;
}

/** A preset as saved on the scene. */
export interface SceneMoodPreset extends SceneMoodSettings {
  name: string;
}

export interface SceneMoodPlanRequest extends SceneMoodSettings {
  action: SceneMoodAction;
  /** apply, save, remove-preset: the preset name. */
  preset?: string;
  /** save: take the values from what the scene looks like now (and what plays). */
  fromCurrent?: boolean;
  /** music: the playlist, and what to do with it. */
  playlistName?: string;
  mode?: SceneMusicMode;
}

/** The module's answer: the ops of one plan. */
export interface SceneMoodPlan {
  summary: string;
  ops: GuardedOp[];
  sceneId: string;
}

/** Reply of `getSceneMoods`. */
export interface SceneMoodsReply {
  sceneId: string;
  sceneName: string;
  presets: SceneMoodPreset[];
  current: { darkness: number; globalLight: boolean; weather: string };
  playlists: Array<{ name: string; sounds: number; playing: boolean }>;
}

/** What `plan-scene-mood` returns beside the guarded plan. */
export interface SceneMoodPlanResult {
  /** Never auto applied: the feature has no "apply without confirming" switch. */
  autoApply: false;
}
