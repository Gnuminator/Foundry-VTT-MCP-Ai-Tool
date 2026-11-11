/**
 * "Upload my portrait": a player puts their own art on their character from the dashboard's
 * player page. The dashboard maps the player's private link key to a Foundry user id, checks the
 * bytes, and asks the bridge's control method `player_portrait`; the module query
 * `uploadPlayerPortrait` (a write behind the write gate) checks the player owns the character and
 * stores the file under `assets/players/<user slug>-<user id>/` with a name it makes itself. The backend
 * then records the actor change as a guarded write, so it shows in Recent Changes with an Undo.
 */

/** Module query name (the module keeps its own copy; a module file imports types only). */
export const UPLOAD_PLAYER_PORTRAIT_QUERY = 'uploadPlayerPortrait';

/** The guarded-write feature the actor change is recorded under (Recent Changes, Undo). */
export const PLAYER_PORTRAIT_FEATURE_ID = 'player-portrait';

/** Largest picture, in bytes. 5 MB keeps the base64 body under the 8 MB control line. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

export type PortraitType = 'png' | 'jpg' | 'webp';
export type PortraitTarget = 'portrait' | 'both';

export const PORTRAIT_MIME: Record<PortraitType, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** The picture type by its first bytes (never by the file name or the sent type), or null. */
export function sniffPortraitType(b: Uint8Array): PortraitType | null {
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
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

export interface UploadPlayerPortraitRequest {
  userId: string;
  actorId: string;
  /** The sniffed type; the module checks the bytes again. */
  type: PortraitType;
  /** The picture, base64. */
  data: string;
}

export interface UploadPlayerPortraitReply {
  success: boolean;
  error?: string;
  /** Where the file is, relative to the Foundry Data folder. */
  path?: string;
  actorUuid?: string;
  actorName?: string;
  userName?: string;
  /** Tokens already placed on scenes for the actor (`Scene.<id>.Token.<id>`), at most 100. */
  placedTokens?: string[];
}

export interface PlayerPortraitResult {
  ok: true;
  path: string;
  actorName: string;
  changeId: string;
}
