/**
 * `plan-actor-image` (Build set): Claude puts a portrait and/or token picture on an actor from a
 * file on the GM's PC. The backend reads the file from an allowed folder, the module query
 * `uploadActorImage` (a write behind the write gate, GM client only) stores it under
 * `assets/ai-art/<actor slug>-<id>/` with a name it makes, and the actor change is a guarded
 * write under the `actor-image` feature (apply confirms, undo puts the old paths back).
 */
import type { PortraitType } from './player-portrait.js';

/** Module query name (the module keeps its own copy; a module file imports types only). */
export const UPLOAD_ACTOR_IMAGE_QUERY = 'uploadActorImage';

/** The guarded-write feature the actor change is recorded under. */
export const ACTOR_IMAGE_FEATURE_ID = 'actor-image';

/** What the picture is for. */
export const ACTOR_IMAGE_TARGETS = ['portrait', 'token', 'both'] as const;
export type ActorImageTarget = (typeof ACTOR_IMAGE_TARGETS)[number];

/** The environment variable naming the folders pictures may be read from (semicolon list). */
export const ACTOR_IMAGE_ROOTS_ENV = 'FOUNDRY_AI_TOOL_IMAGE_ROOTS';

export interface UploadActorImageRequest {
  /** An actor id or an exact actor name. */
  actor: string;
  /** The sniffed type; the module checks the bytes again. */
  type: PortraitType;
  /** The picture, base64. */
  data: string;
}

export interface UploadActorImageReply {
  success: boolean;
  error?: string;
  /** Where the file is, relative to the Foundry Data folder. */
  path?: string;
  actorId?: string;
  actorName?: string;
  /** The actor's current portrait and prototype token picture (for the plan preview). */
  currentImg?: string;
  currentTokenImg?: string;
}
