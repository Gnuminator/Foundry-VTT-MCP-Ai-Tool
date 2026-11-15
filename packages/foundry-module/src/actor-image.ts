/**
 * `plan-actor-image`: the GM's Claude puts a portrait or token picture on an actor. The backend
 * reads a file from an allowed folder on the PC and sends the bytes here; this GM-client query
 * checks them again and stores the picture through Foundry's FilePicker.upload in one folder per
 * actor:
 *
 *   assets/ai-art/<actor slug>-<actor id>/
 *
 * Nothing from the caller names the folder or the file: the folder comes from the actor, the file
 * name is made here (`art-<time>-<random>.<ext>`, never an existing name). The query only stores
 * the file; the actor change itself is a guarded write the backend plans (apply confirms, Undo
 * puts the old paths back, the file stays). A write (write-gate.ts); GM client only.
 */
import type { UploadActorImageReply, UploadActorImageRequest } from '@gnuminator/shared';

import { featureName, featureOffMessage, isFeatureEnabled } from './guarded-features.js';
import {
  PORTRAIT_MAX_BYTES,
  playerSlug,
  sniffType,
  type PortraitPicker,
} from './player-portrait.js';

/** Query name (shared's UPLOAD_ACTOR_IMAGE_QUERY; a module file imports types only). */
export const UPLOAD_ACTOR_IMAGE_QUERY = 'uploadActorImage';

/** Guarded-write feature id (shared's ACTOR_IMAGE_FEATURE_ID). */
export const ACTOR_IMAGE_FEATURE_ID = 'actor-image';

/** The folder every actor folder sits in, relative to the Foundry Data folder. */
export const ART_FOLDER = 'assets/ai-art';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
type ImageType = keyof typeof TYPES;

export interface ImageActor {
  id?: string;
  name?: string;
  img?: string;
  prototypeToken?: { texture?: { src?: string } };
}
export interface ActorImageEnv {
  /** Whether the "Actor images" feature switch is on. */
  enabled(): boolean;
  actors(): ImageActor[];
  picker(): PortraitPicker;
  now(): Date;
  random(): string;
}

function liveEnv(): ActorImageEnv {
  const g = globalThis as unknown as {
    game?: { actors?: Iterable<ImageActor> };
    foundry?: { applications?: { apps?: { FilePicker?: { implementation?: PortraitPicker } } } };
  };
  return {
    enabled: () => isFeatureEnabled(ACTOR_IMAGE_FEATURE_ID),
    actors: () => (g.game?.actors ? Array.from(g.game.actors) : []),
    picker: (): PortraitPicker => {
      const picker = g.foundry?.applications?.apps?.FilePicker?.implementation;
      if (!picker) throw new Error('Foundry file upload is not available');
      return picker;
    },
    now: () => new Date(),
    random: () => Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
  };
}

function refuse(error: string): UploadActorImageReply {
  return { success: false, error };
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decode(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The file name: made here, with the time and a random part so no name repeats. */
export function artFileName(type: ImageType, now: Date, random: string): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `art-${stamp}-${random}.${type}`;
}

/** An actor by id, else by exact name (case-insensitive); null with a reason when not exactly one. */
export function findActor(
  actors: ImageActor[],
  wanted: string
): { actor: ImageActor } | { error: string } {
  const byId = actors.find(a => a.id === wanted);
  if (byId) return { actor: byId };
  const lower = wanted.trim().toLowerCase();
  const named = actors.filter(a => String(a.name ?? '').toLowerCase() === lower);
  if (named.length === 1) return { actor: named[0] };
  if (named.length > 1) {
    return { error: `${named.length} actors are named "${wanted}". Use the actor id instead.` };
  }
  return { error: `No actor "${wanted}". Use list-characters to find the right one.` };
}

/**
 * The actor's folder name: name slug and id. A name with no letters or digits has no slug, so it
 * is `actor-<id>` (not the player fallback twice).
 */
export function actorFolderName(name: string, id: string): string {
  const lowerId = id.toLowerCase();
  const slug = playerSlug(name, id);
  return slug === `player-${lowerId}` ? `actor-${lowerId}` : `${slug}-${lowerId}`;
}

/** Make `assets/ai-art/<folder>` (each level; "already there" is fine). */
async function ensureFolder(picker: PortraitPicker, folder: string): Promise<string> {
  let path = '';
  for (const part of [...ART_FOLDER.split('/'), folder]) {
    path = path ? `${path}/${part}` : part;
    try {
      await picker.createDirectory('data', path);
    } catch {
      // Foundry throws when the folder exists; the upload below fails if it truly is not there.
    }
  }
  return path;
}

/** The query handler: store a picture for an actor. */
export async function uploadActorImage(
  data: unknown,
  env: ActorImageEnv = liveEnv()
): Promise<UploadActorImageReply> {
  // The switch is checked here too, so the query refuses on its own and not only through the plan.
  if (!env.enabled()) return refuse(featureOffMessage(featureName(ACTOR_IMAGE_FEATURE_ID)));
  const body = (data ?? {}) as Partial<UploadActorImageRequest>;
  const { actor: wanted, data: base64 } = body;
  if (typeof wanted !== 'string' || wanted.trim() === '') return refuse('An actor is required.');
  if (typeof base64 !== 'string' || base64 === '' || !BASE64.test(base64)) {
    return refuse('A picture is required.');
  }
  if (base64.length > Math.ceil(PORTRAIT_MAX_BYTES / 3) * 4) {
    return refuse('That picture is too big. The limit is 5 MB.');
  }
  const found = findActor(env.actors(), wanted);
  if ('error' in found) return refuse(found.error);
  const actor = found.actor;
  if (typeof actor.id !== 'string' || actor.id === '') return refuse('That actor has no id.');

  let bytes: Uint8Array;
  try {
    bytes = decode(base64);
  } catch {
    return refuse('A picture is required.');
  }
  if (bytes.length > PORTRAIT_MAX_BYTES)
    return refuse('That picture is too big. The limit is 5 MB.');
  const type = sniffType(bytes);
  if (!type) return refuse('Only PNG, JPG or WebP pictures work.');

  const picker = env.picker();
  const folder = await ensureFolder(picker, actorFolderName(String(actor.name ?? ''), actor.id));
  const name = artFileName(type, env.now(), env.random());
  const file = new File([bytes as BlobPart], name, { type: TYPES[type] });
  const stored = (await picker.upload('data', folder, file, {}, { notify: false })) as
    | { path?: unknown; status?: unknown }
    | false
    | undefined;
  if (!stored || typeof stored !== 'object' || typeof stored.path !== 'string') {
    return refuse('Foundry did not accept the picture.');
  }
  const path = `${folder}/${name}`;
  if (!decodeURIComponent(stored.path).endsWith(path)) {
    return refuse('Foundry stored the picture somewhere unexpected.');
  }
  return {
    success: true,
    path,
    actorId: actor.id,
    actorName: String(actor.name ?? ''),
    currentImg: typeof actor.img === 'string' ? actor.img : '',
    currentTokenImg:
      typeof actor.prototypeToken?.texture?.src === 'string'
        ? actor.prototypeToken.texture.src
        : '',
  };
}
