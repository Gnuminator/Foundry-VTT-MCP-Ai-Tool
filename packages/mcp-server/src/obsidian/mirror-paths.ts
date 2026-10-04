/**
 * Note paths for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md section 3.4).
 *
 * `allocateNotePaths` is pure and deterministic: the same requests, the same
 * known notes and the same taken files always give the same paths, so two runs
 * (or two machines) pick the same file names.
 *
 * Rules:
 * - A uuid that already has a note keeps that path while its folder stays right.
 *   When the folder a note belongs in changes (its Foundry folder or its book,
 *   I-100), the caller asks for a new path and moves the note there once, never
 *   an edited one.
 * - New documents are placed in `(created, id)` order (a missing `created`
 *   sorts last). The file stem is `safeFileName(name)`; on a collision the
 *   stem gets ` (<short hash of the uuid>)`, then ` (<full id>)`.
 * - Uniqueness is per folder and case-insensitive after Unicode NFC (Windows
 *   and Obsidian), compared with `pathKey`, against the files already on disk
 *   (`taken`), the paths of the known notes, and the paths allocated in this call.
 *   A request that `ownsFolder` (a journal whose page notes sit in a folder named
 *   like it) also avoids a stem that is a reserved folder (a Foundry folder of the
 *   same name in the same parent).
 * - A path longer than 240 characters (campaign-relative, `.md` included; the
 *   vault and `Campaigns/<world>/` prefix come on top) is shortened: first the
 *   folder segments below the fixed base (`AI Tool/<Foundry or Library>/<Kind>`,
 *   see {@link fitFolder}), then the stem; the collision suffix is never cut.
 *
 * The pump calls it twice per cycle: once for the top-level notes (folders
 * `AI Tool/Foundry/{PCs,NPCs,Scenes,Journals,Items}/<Foundry folder path>`), then
 * once for the journal page notes, with the folder `pageNoteFolder(<journal note
 * path>)`, so page notes sit in a folder named like their index note.
 */
import { pathKey } from './mirror-common.js';
import { safeFileName } from './render.js';

/** One document that needs a note path. */
export interface PathRequest {
  uuid: string;
  /** The Foundry document id (16 characters); used for collision suffixes. */
  id: string;
  /** Campaign-relative folder without a trailing slash, e.g. `AI Tool/Foundry/NPCs`. */
  folder: string;
  /** The source name; sanitized with `safeFileName`. */
  name: string;
  /** `_stats.createdTime`, server ms, or null. */
  created: number | null;
  /** Its stem becomes a folder too (a journal with page notes): avoid `reservedFolders` as a stem. */
  ownsFolder?: boolean;
}

/** The longest campaign-relative path (with `.md`) the mirror allocates. */
export const MAX_NOTE_PATH_CHARS = 240;
/** The longest folder segment taken from a name (a Foundry folder, a book title, a pack group). */
export const SEGMENT_MAX_CHARS = 60;

const EXTENSION = '.md';
/** Room a folder leaves for the stem: at least this many characters... */
const MIN_STEM_CHARS = 24;
/** ...plus the longest collision suffix (` (<16-character id>) 99`). */
const SUFFIX_RESERVE = 24;
/** The longest folder (campaign-relative, no trailing slash) a note is placed in. */
export const MAX_FOLDER_CHARS =
  MAX_NOTE_PATH_CHARS - EXTENSION.length - 1 - MIN_STEM_CHARS - SUFFIX_RESERVE;
/** `AI Tool/<Foundry or Library>/<Kind>`: never shortened. */
const FIXED_SEGMENTS = 3;
const MIN_SEGMENT_CHARS = 8;
/** Windows device names, also with an extension (`nul.txt`). */
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A segment with no trailing dot or space (Windows drops them), never empty. */
function trimSegment(segment: string): string {
  return segment.replace(/[. ]+$/, '') || '_';
}

/**
 * A name as one folder segment: `safeFileName` (characters Windows or Obsidian links refuse,
 * control characters, trailing dots and spaces, device names), no leading dot (the scans skip dot
 * folders), no device name with an extension, at most {@link SEGMENT_MAX_CHARS} characters.
 */
export function safeFolderSegment(name: string): string {
  let segment = safeFileName(name).replace(/^\./, '_');
  if (DEVICE_NAME.test(segment)) segment = `_${segment}`;
  return trimSegment(cutToRoom(segment, SEGMENT_MAX_CHARS));
}

/**
 * A folder that leaves room for a stem and a collision suffix: when it is longer than
 * {@link MAX_FOLDER_CHARS}, the longest segments below the fixed base are cut first (down to 8
 * characters each), then the deepest segments are dropped. Deterministic, and a fitted folder
 * fits again unchanged.
 */
export function fitFolder(folder: string): string {
  if (folder.length <= MAX_FOLDER_CHARS) return folder;
  const parts = folder.split('/');
  const fixed = Math.min(FIXED_SEGMENTS, parts.length);
  const total = (): number => parts.join('/').length;
  while (total() > MAX_FOLDER_CHARS) {
    let longest = -1;
    for (let i = fixed; i < parts.length; i++) {
      const length = parts[i]?.length ?? 0;
      if (length > MIN_SEGMENT_CHARS && (longest < 0 || length > (parts[longest]?.length ?? 0))) {
        longest = i;
      }
    }
    if (longest < 0) break;
    const segment = parts[longest] ?? '';
    const keep = Math.max(MIN_SEGMENT_CHARS, segment.length - (total() - MAX_FOLDER_CHARS));
    parts[longest] = trimSegment(cutToRoom(segment, keep));
  }
  while (total() > MAX_FOLDER_CHARS && parts.length > fixed) parts.pop();
  return parts.join('/');
}

/** A folder below `base` from names (Foundry folders, a book title): safe segments, fitted. */
export function folderPath(base: string, names: readonly string[]): string {
  return fitFolder([base, ...names.map(safeFolderSegment)].join('/'));
}

/** The folder of a campaign-relative note path (no trailing slash). */
export function folderOf(notePath: string): string {
  const slash = notePath.lastIndexOf('/');
  return slash < 0 ? '' : notePath.slice(0, slash);
}

/** Whether a note at `notePath` sits in `folder` (normalized, case-insensitive). */
export function inFolder(notePath: string, folder: string): boolean {
  return pathKey(folderOf(notePath)) === pathKey(fitFolder(folder));
}

/**
 * The folder that holds a journal's page notes: its index note's path without `.md` (fitted,
 * so a page note always has room for its name).
 */
export function pageNoteFolder(journalNotePath: string): string {
  return fitFolder(
    journalNotePath.endsWith(EXTENSION)
      ? journalNotePath.slice(0, -EXTENSION.length)
      : journalNotePath
  );
}

/** The first `room` UTF-16 units of `text`, never splitting a surrogate pair. */
function cutToRoom(text: string, room: number): string {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > room) break;
    out += ch;
  }
  return out;
}

/** A stem that fits `room` characters, still a valid file name (no trailing dot or space, no device name). */
function fitStem(stem: string, room: number): string {
  if (stem.length <= room) return stem;
  const limit = Math.max(1, room);
  let cut = safeFileName(cutToRoom(stem, limit));
  // `safeFileName` may add a leading underscore (device names): try once more, one shorter.
  if (cut.length > limit && limit > 1) cut = safeFileName(cutToRoom(stem, limit - 1));
  return cut;
}

function suffixText(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '') || '_';
}

/**
 * The short collision suffix: six base-36 characters of an FNV-1a hash of the uuid. Stable across
 * runs, and unlike the end of the id it never reads `000000` (official compendium ids are padded
 * with zeros, `phbbrdBard000000`).
 */
export function shortSuffix(uuid: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

function buildPath(folder: string, stem: string, suffix: string): string {
  const fitted = fitFolder(folder);
  const prefix = fitted ? `${fitted}/` : '';
  const room = MAX_NOTE_PATH_CHARS - prefix.length - suffix.length - EXTENSION.length;
  return `${prefix}${fitStem(stem, room)}${suffix}${EXTENSION}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Allocate a campaign-relative `.md` path for every request.
 *
 * @param requests documents that need a path (existing notes may be included)
 * @param existing uuid to the path of its existing note (kept as is)
 * @param taken `pathKey` of every file that already exists in the folders
 * @param reservedFolders `pathKey` of folders a request that `ownsFolder` must not take as its
 *   page-note folder (Foundry folders beside it)
 */
export function allocateNotePaths(
  requests: readonly PathRequest[],
  existing: ReadonlyMap<string, string>,
  taken: ReadonlySet<string>,
  reservedFolders: ReadonlySet<string> = new Set()
): Map<string, string> {
  const used = new Set<string>(taken);
  for (const path of existing.values()) used.add(pathKey(path));

  const result = new Map<string, string>();
  const fresh: PathRequest[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.uuid)) continue;
    seen.add(request.uuid);
    const known = existing.get(request.uuid);
    if (known !== undefined) result.set(request.uuid, known);
    else fresh.push(request);
  }

  fresh.sort(
    (a, b) =>
      (a.created ?? Number.MAX_SAFE_INTEGER) - (b.created ?? Number.MAX_SAFE_INTEGER) ||
      compareText(a.id, b.id) ||
      compareText(a.uuid, b.uuid)
  );

  for (const request of fresh) {
    const stem = safeFileName(request.name);
    const id = suffixText(request.id);
    const suffixes = ['', ` (${shortSuffix(request.uuid)})`, ` (${id})`];
    const free = (candidate: string): boolean =>
      !used.has(pathKey(candidate)) &&
      !(request.ownsFolder === true && reservedFolders.has(pathKey(pageNoteFolder(candidate))));
    let chosen: string | null = null;
    for (const suffix of suffixes) {
      const candidate = buildPath(request.folder, stem, suffix);
      if (free(candidate)) {
        chosen = candidate;
        break;
      }
    }
    // Pathological: even the full id is taken. A counter always ends the search.
    for (let n = 2; chosen === null; n++) {
      const candidate = buildPath(request.folder, stem, ` (${id}) ${n}`);
      if (free(candidate)) chosen = candidate;
    }
    used.add(pathKey(chosen));
    result.set(request.uuid, chosen);
  }
  return result;
}
