/**
 * Headers that must stay on a static file whatever URL reached it.
 *
 * A path check in front of `express.static` is not enough: `/player%2Ehtml`,
 * `/x/../player.html` and (on a case-insensitive file system) `/Player.html`
 * all serve `public/player.html` with a different `req.path`. The hook below
 * runs inside `express.static` itself, on the file it is about to send, and
 * recognizes that file two ways:
 * - by its name, compared case-insensitively (decoding and dot segments are
 *   already resolved by then);
 * - by its identity (device and inode, read once at startup), which catches
 *   any other name the file system resolves to the same file, for example a
 *   Windows short name (`PLAYER~1.HTM`) or stream name (`player.html::$DATA`).
 * A file that is replaced (a new inode) while the process runs keeps the name
 * check; the identity check picks the new file up on the next start.
 *
 * NTFS file ids are 64 bits, with a reuse counter in the top 16. Once that
 * counter passes 31 the id is above 2^53 and the number `ino` that
 * `express.static` hands the hook is rounded, so two neighbouring files can
 * share it (`player.js` got `player.html`'s CSP on a well-used disk). An `ino`
 * outside the safe integer range is only a candidate; the hook confirms it
 * with a bigint stat of the served file.
 *
 * Routes that answer with `res.sendFile` (for example `/player`) do not go
 * through this hook and set their headers themselves.
 */
import * as fs from 'fs';
import type { ServerResponse } from 'http';
import * as path from 'path';

/** Some files in the public directory and the headers every response serving them gets. */
export interface StaticHeaderGroup {
  /** File names in the public directory (compared case-insensitively). */
  readonly files: readonly string[];
  /** Set the headers on a response that serves one of the files. */
  readonly apply: (res: ServerResponse) => void;
}

/** The `express.static` `setHeaders` hook. */
export type StaticSetHeaders = (res: ServerResponse, filePath: string, stat: unknown) => void;

interface FileId {
  readonly dev: number;
  readonly ino: number;
}

/** The exact identity, from a bigint stat. */
interface BigFileId {
  readonly dev: bigint;
  readonly ino: bigint;
}

/** A bigint stat of a path (`fs.statSync` with `bigint: true`); tests pass their own. */
export type BigStat = (filePath: string) => BigFileId;

const statBigint: BigStat = filePath => fs.statSync(filePath, { bigint: true });

/** A file's identity: the number form `express.static` reports, and the exact one. */
interface KnownFile extends FileId {
  readonly exact: BigFileId;
}

function isFileId(value: unknown): value is FileId {
  const v = value as Partial<FileId> | null;
  return (
    typeof v === 'object' && v !== null && typeof v.dev === 'number' && typeof v.ino === 'number'
  );
}

/** The identity of each file that exists (an inode of 0 means the file system has none). */
function fileIds(publicDir: string, files: readonly string[], statBig: BigStat): KnownFile[] {
  const ids: KnownFile[] = [];
  for (const name of files) {
    try {
      const exact = statBig(path.join(publicDir, name));
      if (exact.ino !== 0n) ids.push({ dev: Number(exact.dev), ino: Number(exact.ino), exact });
    } catch {
      // A missing file: the name check still applies.
    }
  }
  return ids;
}

/**
 * Whether the stat `express.static` passed is one of the known files. A rounded
 * (unsafe) `ino` is confirmed against a bigint stat of the served path.
 */
function isKnownFile(
  ids: readonly KnownFile[],
  filePath: string,
  stat: unknown,
  statBig: BigStat
): boolean {
  if (!isFileId(stat)) return false;
  const candidates = ids.filter(id => id.dev === stat.dev && id.ino === stat.ino);
  if (candidates.length === 0) return false;
  if (Number.isSafeInteger(stat.ino)) return true;
  let exact: BigFileId;
  try {
    exact = statBig(filePath);
  } catch {
    return false;
  }
  return candidates.some(id => id.exact.dev === exact.dev && id.exact.ino === exact.ino);
}

/**
 * One `setHeaders` hook for several groups: every group whose file is being
 * served (by name or by identity) applies its headers, in the order given.
 */
export function staticHeaders(
  publicDir: string,
  groups: readonly StaticHeaderGroup[],
  statBig: BigStat = statBigint
): StaticSetHeaders {
  const compiled = groups.map(group => ({
    names: new Set(group.files.map(name => name.toLowerCase())),
    ids: fileIds(publicDir, group.files, statBig),
    apply: group.apply,
  }));
  return (res, filePath, stat) => {
    const name = path.basename(filePath).toLowerCase();
    for (const group of compiled) {
      const byName = group.names.has(name);
      const byId = !byName && isKnownFile(group.ids, filePath, stat, statBig);
      if (byName || byId) group.apply(res);
    }
  };
}
