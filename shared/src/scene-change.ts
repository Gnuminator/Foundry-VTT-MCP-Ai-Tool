/**
 * Scene dressing changes with undo (I-112): AoE templates, clearing templates,
 * darkness and global light, map notes and loot (`plan-scene-change`) go through
 * plan, confirm and undo instead of writing at once.
 *
 * Flow:
 * - The bridge tool `plan-scene-change` (play set) sends a
 *   {@link SceneChangeRequest} to the module's read-only `planSceneChange`
 *   query. The module builds generic guarded ops (`create`, `update`, `delete`)
 *   on the viewed scene or on an actor; nothing is written there.
 * - The bridge stores the ops as a guarded plan (feature `live-play`, the same
 *   switch as damage and conditions); `apply-planned-change` applies it and
 *   `undo-change` reverts it, so every change shows in Recent Changes.
 * - A plan with a delete (clearing a template, removing a note) is destructive
 *   and never applies without confirming. Other plans apply at once when the GM
 *   switched on "apply without confirming" for live play.
 *
 * Music stays a direct tool (`play-playlist`): starting or stopping a playlist
 * leaves nothing to undo.
 *
 * GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const SCENE_PLAN_QUERY = 'planSceneChange';

/** What `plan-scene-change` can do. */
export const SCENE_CHANGE_ACTIONS = [
  'template',
  'clear-templates',
  'mood',
  'note',
  'remove-note',
  'loot',
] as const;
export type SceneChangeAction = (typeof SCENE_CHANGE_ACTIONS)[number];

/** The AoE shapes `template` takes. */
export const SCENE_TEMPLATE_SHAPES = ['circle', 'cone', 'ray', 'rect'] as const;
export type SceneTemplateShape = (typeof SCENE_TEMPLATE_SHAPES)[number];

/** Place an AoE template (a MeasuredTemplate on Foundry 13, a flagged Region on 14). */
export interface SceneTemplateRequest {
  action: 'template';
  shape: SceneTemplateShape;
  /** Reach in scene units (ft). */
  distance: number;
  /** Origin in pixels, or the center of `originTokenName`. */
  x?: number;
  y?: number;
  originTokenName?: string;
  direction?: number;
  /** cone: the opening angle (default 53.13). */
  angle?: number;
  /** ray: the width in scene units (default 5). */
  width?: number;
  fillColor?: string;
}

/** Remove one template by id, or every template this tool placed. */
export interface SceneClearTemplatesRequest {
  action: 'clear-templates';
  templateId?: string;
  all?: boolean;
}

/** Set the viewed scene's darkness and/or global light. */
export interface SceneMoodRequest {
  action: 'mood';
  /** 0 (bright) to 1 (dark); clamped. */
  darkness?: number;
  globalLight?: boolean;
}

/** Drop a labeled map pin, optionally linked to a journal entry. */
export interface SceneNoteRequest {
  action: 'note';
  text?: string;
  /** Position in pixels, or the position of `tokenName`. */
  x?: number;
  y?: number;
  tokenName?: string;
  journalName?: string;
  entryId?: string;
  icon?: string;
  iconSize?: number;
}

/** Remove a map pin by id, or every pin with exactly this label. */
export interface SceneRemoveNoteRequest {
  action: 'remove-note';
  noteId?: string;
  text?: string;
}

/** Give currency and/or items (by UUID) to a character, and announce it in chat. */
export interface SceneLootRequest {
  action: 'loot';
  targetCharacter?: string;
  /** pp, gp, ep, sp, cp amounts added on top of the current balance. */
  currency?: Record<string, number>;
  itemUuids?: string[];
  /** Post a chat card (default true). */
  announce?: boolean;
}

/** Any request the `planSceneChange` query takes. */
export type SceneChangeRequest =
  | SceneTemplateRequest
  | SceneClearTemplatesRequest
  | SceneMoodRequest
  | SceneNoteRequest
  | SceneRemoveNoteRequest
  | SceneLootRequest;

/** A token a placed template covers. */
export interface SceneTokenInside {
  name: string;
  actorId: string | null;
}

/** The module's answer: the ops of one plan plus what the planner worked out. */
export interface SceneChangePlan {
  summary: string;
  ops: GuardedOp[];
  /** The scene the change is on (not set for loot). */
  sceneId?: string;
  /** template: the tokens inside the area at plan time. */
  tokensInside?: SceneTokenInside[];
  /** loot: item UUIDs left out (did not resolve, are not an Item, or no target character), each with its reason when it is not the plain UUID. */
  skippedItems?: string[];
}

/** What `plan-scene-change` returns beside the guarded plan. */
export interface SceneChangePlanResult {
  tokensInside?: SceneTokenInside[];
  skippedItems?: string[];
  /**
   * The GM switched on "apply without confirming" for live play: apply this plan
   * at once (apply-planned-change) without asking. Only ever true for a plan of
   * risk "write", so never when the plan deletes something.
   */
  autoApply: boolean;
}
