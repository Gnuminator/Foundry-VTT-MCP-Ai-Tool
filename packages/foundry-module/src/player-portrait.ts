/**
 * "Upload my portrait": a player puts their own art on a character they own, from the dashboard's
 * player page. The dashboard maps the player's private link key to a Foundry user id and checks
 * the bytes; this GM-client query checks them again, checks the player OWNS the character, and
 * stores the picture through Foundry's FilePicker.upload, as the GM, in one fixed folder:
 *
 *   assets/players/<player slug>-<user id>/
 *
 * Nothing from the client names the folder or the file: the folder is made from the Foundry user's
 * name plus the user id (two users never share one), the file name is made here (`portrait-<time>-<random>.<ext>`, never an existing name).
 * The query only stores the file; the actor change itself is a guarded write the backend plans
 * and applies (Recent Changes, Undo). A write (write-gate.ts); never an MCP tool. GM client only.
 */
import type { UploadPlayerPortraitReply, UploadPlayerPortraitRequest } from '@gnuminator/shared';

import { isFeatureEnabled } from './guarded-features.js';

/** Query name (shared's UPLOAD_PLAYER_PORTRAIT_QUERY; a module file imports types only). */
export const UPLOAD_PLAYER_PORTRAIT_QUERY = 'uploadPlayerPortrait';

/** The feature switch (shared's PLAYER_PORTRAIT_FEATURE_ID; a module file imports types only). */
const PLAYER_PORTRAIT_FEATURE_ID = 'player-portrait';

/** Most placed tokens one picture change reaches, so a plan stays readable. */
export const MAX_PLACED_TOKENS = 100;

/** The same cap as shared's PORTRAIT_MAX_BYTES. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

/** The folder every player folder sits in, relative to the Foundry Data folder. */
export const PLAYERS_FOLDER = 'assets/players';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
type PortraitType = keyof typeof TYPES;

/** The picture type by its first bytes (a copy of shared's sniffPortraitType), or null. */
export function sniffType(b: Uint8Array): PortraitType | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** A folder name from a user name: lower case letters, digits and single dashes; never empty. */
export function playerSlug(name: string, userId: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || `player-${userId.toLowerCase()}`;
}

/** The player's folder name: the slug plus the user id, so two users never share a folder. */
export function playerFolder(name: string, userId: string): string {
  const slug = playerSlug(name, userId);
  return slug === `player-${userId.toLowerCase()}` ? slug : `${slug}-${userId.toLowerCase()}`;
}

/** The file name: made here, with the time and a random part so no name repeats. */
export function portraitFileName(type: PortraitType, now: Date, random: string): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `portrait-${stamp}-${random}.${type}`;
}

interface PortraitUser {
  id?: string;
  isGM?: boolean;
  name?: string;
}
interface PortraitActor {
  id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  testUserPermission?: (user: PortraitUser, level: string) => boolean;
}
export interface PortraitPicker {
  createDirectory(source: string, target: string, options?: object): Promise<unknown>;
  upload(
    source: string,
    path: string,
    file: File,
    body?: object,
    options?: object
  ): Promise<unknown>;
}
export interface PortraitEnv {
  user(id: string): PortraitUser | undefined;
  actor(id: string): PortraitActor | undefined;
  picker(): PortraitPicker;
  /** Is the `player-portrait` switch on? */
  featureEnabled(): boolean;
  /** Uuids (`Scene.<id>.Token.<id>`) of the tokens already placed on scenes for this actor. */
  placedTokens(actorId: string): string[];
  now(): Date;
  random(): string;
}

function liveEnv(): PortraitEnv {
  const g = globalThis as unknown as {
    game?: {
      users?: { get?: (id: string) => PortraitUser | undefined };
      actors?: { get?: (id: string) => PortraitActor | undefined };
      scenes?: Iterable<{
        id?: string;
        tokens?: Iterable<{ id?: string; actorId?: string | null }>;
      }>;
    };
    foundry?: { applications?: { apps?: { FilePicker?: { implementation?: PortraitPicker } } } };
  };
  return {
    user: id => g.game?.users?.get?.(id),
    actor: id => g.game?.actors?.get?.(id),
    picker: (): PortraitPicker => {
      const picker = g.foundry?.applications?.apps?.FilePicker?.implementation;
      if (!picker) throw new Error('Foundry file upload is not available');
      return picker;
    },
    featureEnabled: () => isFeatureEnabled(PLAYER_PORTRAIT_FEATURE_ID),
    placedTokens: (actorId): string[] => {
      const out: string[] = [];
      for (const scene of g.game?.scenes ?? []) {
        for (const token of scene.tokens ?? []) {
          if (token.actorId === actorId && scene.id && token.id) {
            out.push(`Scene.${scene.id}.Token.${token.id}`);
          }
        }
      }
      return out.slice(0, MAX_PLACED_TOKENS);
    },
    now: () => new Date(),
    random: () => Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
  };
}

function decode(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ID = /^[A-Za-z0-9]{16}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function refuse(error: string): UploadPlayerPortraitReply {
  return { success: false, error };
}

/** Make `assets/players/<slug>` (each level; "already there" is fine). */
async function ensureFolder(picker: PortraitPicker, slug: string): Promise<string> {
  const parts = [...PLAYERS_FOLDER.split('/'), slug];
  let path = '';
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    try {
      await picker.createDirectory('data', path);
    } catch {
      // Foundry throws when the folder exists; the upload below fails if it truly is not there.
    }
  }
  return path;
}

/** The query handler: store a picture for a character the player owns. */
export async function uploadPlayerPortrait(
  data: unknown,
  env: PortraitEnv = liveEnv()
): Promise<UploadPlayerPortraitReply> {
  // The switch is checked here too, not only by the backend: a direct bridge query must not store
  // a file while "Player portraits" is off.
  if (!env.featureEnabled()) {
    return refuse('Changing your picture from this page is switched off. Ask your GM.');
  }
  const body = (data ?? {}) as Partial<UploadPlayerPortraitRequest>;
  const { userId, actorId, data: base64 } = body;
  if (typeof userId !== 'string' || !ID.test(userId)) return refuse('A player is required.');
  if (typeof actorId !== 'string' || !ID.test(actorId)) return refuse('A character is required.');
  if (typeof base64 !== 'string' || base64 === '' || !BASE64.test(base64)) {
    return refuse('A picture is required.');
  }
  // Longest base64 of the cap, so an oversized body is refused before it is decoded.
  if (base64.length > Math.ceil(PORTRAIT_MAX_BYTES / 3) * 4) {
    return refuse('That picture is too big. The limit is 5 MB.');
  }

  const user = env.user(userId);
  if (!user || user.isGM) return refuse('No such player.');
  const actor = env.actor(actorId);
  if (actor?.type !== 'character' || actor.testUserPermission?.(user, 'OWNER') !== true) {
    return refuse('That is not your character.');
  }

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
  const folder = await ensureFolder(picker, playerFolder(String(user.name ?? ''), userId));
  const name = portraitFileName(type, env.now(), env.random());
  const file = new File([bytes as BlobPart], name, { type: TYPES[type] });
  const stored = (await picker.upload('data', folder, file, {}, { notify: false })) as
    | { path?: unknown; status?: unknown }
    | false
    | undefined;
  if (!stored || typeof stored !== 'object') {
    return refuse('Foundry did not accept the picture. Ask your GM.');
  }
  // Foundry answers with the path it stored; trust it only when it is the folder and name we made.
  const path = `${folder}/${name}`;
  // Foundry's own failure replies (`{}` after a dropped request, `undefined`, `false`) carry no
  // path: that is a failed upload, never a success.
  if (typeof stored.path !== 'string') {
    return refuse('Foundry did not accept the picture. Ask your GM.');
  }
  if (!decodeURIComponent(stored.path).endsWith(path)) {
    return refuse('Foundry stored the picture somewhere unexpected. Ask your GM.');
  }
  return {
    success: true,
    path,
    actorUuid: actor.uuid ?? `Actor.${actorId}`,
    actorName: String(actor.name ?? ''),
    userName: String(user.name ?? ''),
    placedTokens: env.placedTokens(actorId),
  };
}
