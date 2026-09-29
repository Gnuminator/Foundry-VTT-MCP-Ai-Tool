/**
 * Note paths for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md section 3.4).
 *
 * `allocateNotePaths` is pure and deterministic: the same requests, the same
 * known notes and the same taken files always give the same paths, so two runs
 * (or two machines) pick the same file names.
 *
 * Rules:
 * - A uuid that already has a note keeps that path forever (the tool never
 *   renames or moves a note; the GM's links to it keep working).
 * - New documents are placed in `(created, id)` order (a missing `created`
 *   sorts last). The file stem is `safeFileName(name)`; on a collision the
 *   stem gets ` (<last 6 characters of the id>)`, then ` (<full id>)`.
 * - Uniqueness is per folder and case-insensitive after Unicode NFC (Windows
 *   and Obsidian), compared with `pathKey`, against the files already on disk
 *   (`taken`), the paths of the known notes, and the paths allocated in this call.
 * - A path longer than 240 characters (campaign-relative, `.md` included; the
 *   vault and `Campaigns/<world>/` prefix come on top) has its stem cut; the
 *   collision suffix is never cut.
 *
 * The pump calls it twice per cycle: once for the top-level notes (folders
 * `AI Tool/Foundry/{PCs,NPCs,Scenes,Journals,Items}`), then once for the
 * journal page notes, with the folder `pageNoteFolder(<journal note path>)`
 * (`AI Tool/Foundry/Journals/<journal note stem>`), so page notes sit in a
 * folder named like their index note.
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
}

/** The longest campaign-relative path (with `.md`) the mirror allocates. */
export const MAX_NOTE_PATH_CHARS = 240;

const EXTENSION = '.md';

/** The folder that holds a journal's page notes: its index note's path without `.md`. */
export function pageNoteFolder(journalNotePath: string): string {
  return journalNotePath.endsWith(EXTENSION)
    ? journalNotePath.slice(0, -EXTENSION.length)
    : journalNotePath;
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

function buildPath(folder: string, stem: string, suffix: string): string {
  const prefix = folder ? `${folder}/` : '';
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
 */
export function allocateNotePaths(
  requests: readonly PathRequest[],
  existing: ReadonlyMap<string, string>,
  taken: ReadonlySet<string>
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
    const suffixes = ['', ` (${id.slice(-6)})`, ` (${id})`];
    let chosen: string | null = null;
    for (const suffix of suffixes) {
      const candidate = buildPath(request.folder, stem, suffix);
      if (!used.has(pathKey(candidate))) {
        chosen = candidate;
        break;
      }
    }
    // Pathological: even the full id is taken. A counter always ends the search.
    for (let n = 2; chosen === null; n++) {
      const candidate = buildPath(request.folder, stem, ` (${id}) ${n}`);
      if (!used.has(pathKey(candidate))) chosen = candidate;
    }
    used.add(pathKey(chosen));
    result.set(request.uuid, chosen);
  }
  return result;
}
