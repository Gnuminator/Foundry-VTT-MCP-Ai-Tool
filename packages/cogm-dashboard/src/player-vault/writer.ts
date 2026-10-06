/**
 * Folder writer for the O7 player vault. One player's vault is built whole in a temporary sibling
 * folder and then swapped in by rename, so a reader (Obsidian, Syncthing) never sees a half
 * written vault and a file that left the new map is gone. A marker file names the owner; a folder
 * without our marker is never touched.
 */
import crypto from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';

import type { Logger } from '../logger.js';
import { safeFileName } from './names.js';
import type { PlayerVaultFiles, VaultPlayer } from './types.js';

/** The file in a player folder that says the dashboard wrote it, and for whom. */
export const PLAYER_MARKER_FILE = '.aitool-player.json';

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
}

type FolderState =
  | { kind: 'missing' }
  | { kind: 'ours'; userId: string }
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
    };
    if (marker.generatedBy === 'foundry-ai-tool' && typeof marker.userId === 'string') {
      return { kind: 'ours', userId: marker.userId };
    }
  } catch {
    // No readable marker: not ours.
  }
  return { kind: 'foreign', reason: `it has no ${PLAYER_MARKER_FILE} marker` };
}

/** Picks the folder name for the player: the plain name, or the name plus a user id fragment. */
async function chooseFolder(
  rootDir: string,
  player: VaultPlayer
): Promise<{ name: string; exists: boolean }> {
  // Twice: names.ts trims before it strips leading dots, so "..x" can leave a leading space.
  const base = safeFileName(safeFileName(player.name, 'Player'), 'Player');
  const first = await inspectFolder(path.join(rootDir, base));
  if (first.kind === 'missing') return { name: base, exists: false };
  if (first.kind === 'ours' && first.userId === player.userId) return { name: base, exists: true };
  if (first.kind === 'foreign') {
    throw new Error(
      `Cannot write the player vault: the folder "${base}" exists but is not ours (${first.reason}).`
    );
  }
  const alt = `${base} (${player.userId.slice(0, 6)})`;
  const second = await inspectFolder(path.join(rootDir, alt));
  if (second.kind === 'missing') return { name: alt, exists: false };
  if (second.kind === 'ours' && second.userId === player.userId) return { name: alt, exists: true };
  throw new Error(
    `Cannot write the player vault: the folder "${alt}" exists but belongs to someone else or is not ours.`
  );
}

/** Writes one player's vault under rootDir and returns the folder path. */
export async function writePlayerVault(
  rootDir: string,
  player: VaultPlayer,
  files: PlayerVaultFiles,
  logger: Logger
): Promise<string> {
  for (const rel of files.keys()) assertSafeRelativePath(rel);

  await fsp.mkdir(rootDir, { recursive: true });
  const { name, exists } = await chooseFolder(rootDir, player);
  const finalPath = path.join(rootDir, name);
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(rootDir, `.${name}.tmp-${suffix}`);
  const oldPath = path.join(rootDir, `.${name}.old-${suffix}`);

  try {
    await fsp.mkdir(tmpPath);
    for (const [rel, content] of files) {
      const target = path.join(tmpPath, ...rel.split('/'));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
    }
    const marker = {
      userId: player.userId,
      name: player.name,
      generatedBy: 'foundry-ai-tool',
      schema: 1,
    };
    await fsp.writeFile(
      path.join(tmpPath, PLAYER_MARKER_FILE),
      `${JSON.stringify(marker, null, 2)}\n`,
      'utf8'
    );

    if (exists) {
      await renameWithRetry(finalPath, oldPath);
      try {
        await renameWithRetry(tmpPath, finalPath);
      } catch (error) {
        try {
          await renameWithRetry(oldPath, finalPath);
        } catch (restoreError) {
          logger.error('Could not put the old player vault back', {
            folder: finalPath,
            error: restoreError instanceof Error ? restoreError.message : String(restoreError),
          });
        }
        throw error;
      }
      try {
        await fsp.rm(oldPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        logger.warn('Could not remove the old player vault folder', {
          folder: oldPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      await renameWithRetry(tmpPath, finalPath);
    }
  } catch (error) {
    await fsp.rm(tmpPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return finalPath;
}
