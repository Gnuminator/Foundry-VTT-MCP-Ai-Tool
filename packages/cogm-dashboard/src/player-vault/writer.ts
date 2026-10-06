/**
 * Folder writer for the O7 player vault. A player's folder is created once and then updated in
 * place: it is never renamed or removed, so Syncthing keeps sharing it (its `.stfolder` and
 * `.stignore` stay) and a file watcher keeps following it. Each changed file is written to a temp
 * file in its own folder and renamed over the old one, so a reader never sees a half written
 * note; a file whose content did not change is not touched (its mtime stays).
 *
 * Ownership: a marker file names the owner and lists the files the dashboard wrote (the
 * manifest). A folder without our marker is never touched. Only files on the manifest are ever
 * deleted (a note that left the render map); files the GM or the player put there are kept, and
 * nothing whose name starts with `.st` (Syncthing: `.stfolder`, `.stignore`, `.stversions`) is
 * ever written, renamed or deleted, at any depth.
 */
import crypto from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';

import type { Logger } from '../logger.js';
import { safeFileName } from './names.js';
import type { PlayerVaultFiles, VaultPlayer } from './types.js';

/** The file in a player folder that says the dashboard wrote it, for whom, and which files. */
export const PLAYER_MARKER_FILE = '.aitool-player.json';

/** The marker's schema: 2 adds the `files` manifest (schema 1 folders delete nothing once). */
const MARKER_SCHEMA = 2;

const RETRY_DELAYS_MS = [50, 100, 200, 400, 800];
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A rename that retries when Windows says a file is in use (EPERM, EBUSY). */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!RETRY_CODES.has(code) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** True for a name Syncthing owns (`.stfolder`, `.stignore`, `.stversions`, ...). */
function isSyncthingName(segment: string): boolean {
  return segment.toLowerCase().startsWith('.st');
}

/** Throws unless the path is a plain relative path with forward slashes and no `..`. */
function assertSafeRelativePath(rel: string): void {
  const bad =
    rel === '' ||
    rel.includes('\\') ||
    rel.includes('\0') ||
    rel.startsWith('/') ||
    /^[A-Za-z]:/.test(rel) ||
    path.isAbsolute(rel) ||
    rel.split('/').some(seg => seg === '' || seg === '.' || seg === '..');
  if (bad) throw new Error(`Unsafe player vault file path: ${JSON.stringify(rel)}`);
  if (rel === PLAYER_MARKER_FILE) {
    throw new Error(`The player vault file map must not contain ${PLAYER_MARKER_FILE}`);
  }
  if (rel.split('/').some(isSyncthingName)) {
    throw new Error(`The player vault file map must not contain Syncthing names: ${rel}`);
  }
}

/** Throws when one path needs a folder where another path is a file ("a" and "a/b.md"). */
function assertNoFileFolderClash(rels: Iterable<string>): void {
  const lower = new Set([...rels].map(r => r.toLowerCase()));
  for (const rel of lower) {
    const segs = rel.split('/');
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i).join('/');
      if (lower.has(prefix)) {
        throw new Error(`Player vault file map has "${prefix}" as both a file and a folder`);
      }
    }
  }
}

interface Marker {
  userId: string;
  name: string;
  generatedBy: 'foundry-ai-tool';
  schema: number;
  /** The vault-relative files the dashboard wrote (sorted), the only ones it may delete. */
  files: string[];
}

type FolderState =
  | { kind: 'missing' }
  | { kind: 'ours'; userId: string; files: string[] | null }
  | { kind: 'foreign'; reason: string };

async function inspectFolder(folder: string): Promise<FolderState> {
  try {
    const stat = await fsp.stat(folder);
    if (!stat.isDirectory()) return { kind: 'foreign', reason: 'it is not a folder' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  try {
    const marker = JSON.parse(
      await fsp.readFile(path.join(folder, PLAYER_MARKER_FILE), 'utf8')
    ) as {
      userId?: unknown;
      generatedBy?: unknown;
      files?: unknown;
    };
    if (marker.generatedBy === 'foundry-ai-tool' && typeof marker.userId === 'string') {
      const files = Array.isArray(marker.files)
        ? marker.files.filter((f): f is string => typeof f === 'string')
        : null;
      return { kind: 'ours', userId: marker.userId, files };
    }
  } catch {
    // No readable marker: not ours.
  }
  return { kind: 'foreign', reason: `it has no ${PLAYER_MARKER_FILE} marker` };
}

/** Picks the folder for the player: the plain name, or the name plus a user id fragment. */
async function chooseFolder(
  rootDir: string,
  player: VaultPlayer
): Promise<{ name: string; state: FolderState & { kind: 'missing' | 'ours' } }> {
  // Twice: names.ts trims before it strips leading dots, so "..x" can leave a leading space.
  const base = safeFileName(safeFileName(player.name, 'Player'), 'Player');
  const first = await inspectFolder(path.join(rootDir, base));
  if (first.kind === 'missing') return { name: base, state: first };
  if (first.kind === 'ours' && first.userId === player.userId) return { name: base, state: first };
  if (first.kind === 'foreign') {
    throw new Error(
      `Cannot write the player vault: the folder "${base}" exists but is not ours (${first.reason}).`
    );
  }
  const alt = `${base} (${player.userId.slice(0, 6)})`;
  const second = await inspectFolder(path.join(rootDir, alt));
  if (second.kind === 'missing') return { name: alt, state: second };
  if (second.kind === 'ours' && second.userId === player.userId) {
    return { name: alt, state: second };
  }
  throw new Error(
    `Cannot write the player vault: the folder "${alt}" exists but belongs to someone else or is not ours.`
  );
}

/** The file's current text, or null when it does not exist (or is not a readable file). */
async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') return null;
    throw error;
  }
}

/** Writes `content` to `target` by a temp file in the same folder and a rename. */
async function writeAtomic(target: string, content: string): Promise<void> {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.aitool-tmp-${crypto.randomBytes(4).toString('hex')}`
  );
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await renameWithRetry(tmp, target);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Writes `content` unless the file already holds exactly that; true when it wrote. */
async function writeIfChanged(target: string, content: string): Promise<boolean> {
  if ((await readIfExists(target)) === content) return false;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await writeAtomic(target, content);
  return true;
}

async function writeMarker(folder: string, marker: Marker): Promise<void> {
  await writeIfChanged(
    path.join(folder, PLAYER_MARKER_FILE),
    `${JSON.stringify(marker, null, 2)}\n`
  );
}

/**
 * Deletes a file we wrote that left the map, then every parent folder (below the vault folder)
 * that it left empty. Never touches a Syncthing name and never a folder that holds anything else.
 */
async function removeOwnedFile(folder: string, rel: string, logger: Logger): Promise<void> {
  const segs = rel.split('/');
  if (
    segs.some(seg => seg === '' || seg === '.' || seg === '..' || isSyncthingName(seg)) ||
    rel.includes('\\') ||
    path.isAbsolute(rel) ||
    rel === PLAYER_MARKER_FILE
  ) {
    return;
  }
  const target = path.join(folder, ...segs);
  try {
    const stat = await fsp.lstat(target);
    if (!stat.isFile()) return; // A folder or link the GM made in its place: not ours.
    await fsp.rm(target, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('Could not remove an old player vault note', {
      file: target,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (let i = segs.length - 1; i >= 1; i--) {
    const dir = path.join(folder, ...segs.slice(0, i));
    try {
      if ((await fsp.readdir(dir)).length > 0) return;
      await fsp.rmdir(dir);
    } catch {
      return;
    }
  }
}

/** True when two vault paths name the same file (a case-insensitive file system), or on doubt. */
async function sameFile(folder: string, a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([
      fsp.stat(path.join(folder, ...a.split('/')), { bigint: true }),
      fsp.stat(path.join(folder, ...b.split('/')), { bigint: true }),
    ]);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    // The old name is gone (nothing to delete) or cannot be read: keep it either way.
    return true;
  }
}

/** Writes one player's vault under rootDir, in place, and returns the folder path. */
export async function writePlayerVault(
  rootDir: string,
  player: VaultPlayer,
  files: PlayerVaultFiles,
  logger: Logger
): Promise<string> {
  for (const rel of files.keys()) assertSafeRelativePath(rel);
  assertNoFileFolderClash(files.keys());

  await fsp.mkdir(rootDir, { recursive: true });
  const { name, state } = await chooseFolder(rootDir, player);
  const folder = path.join(rootDir, name);
  if (state.kind === 'missing') await fsp.mkdir(folder);

  const next = [...files.keys()].sort();
  const previous = state.kind === 'ours' ? (state.files ?? []) : [];
  const base = {
    userId: player.userId,
    name: player.name,
    generatedBy: 'foundry-ai-tool' as const,
  };

  // First claim every file this pass may create, so a pass that stops halfway never leaves a
  // file of ours off the manifest (it would then count as foreign and stay forever).
  const claimed = [...new Set([...previous, ...next])].sort();
  await writeMarker(folder, { ...base, schema: MARKER_SCHEMA, files: claimed });

  for (const [rel, content] of files) {
    await writeIfChanged(path.join(folder, ...rel.split('/')), content);
  }

  // A note that left the map is deleted. After a case-only rename the old name can be the new
  // file itself (Windows, macOS): then it stays.
  const nextSet = new Set(next);
  const byLower = new Map(next.map(r => [r.toLowerCase(), r]));
  for (const rel of previous) {
    if (nextSet.has(rel)) continue;
    const twin = byLower.get(rel.toLowerCase());
    if (twin && (await sameFile(folder, rel, twin))) continue;
    await removeOwnedFile(folder, rel, logger);
  }

  await writeMarker(folder, { ...base, schema: MARKER_SCHEMA, files: next });
  return folder;
}
