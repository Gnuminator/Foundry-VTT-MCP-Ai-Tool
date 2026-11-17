/**
 * Where the voice recordings and their notes live: `FVTT_SESSIONS_DIR`, else the sessions folder
 * inside the data folder (`FVTT_DATA_DIR`), else `<home>/Documents/FoundrySessions`. One place for
 * the dashboard's session notes route and the recorder bot (scripts/voice-stack.ps1,
 * tools/session-notes and the bot's `.env` file say the same default in their own language).
 *
 * The data folder holds FoundryDemo, FoundryNarration, FoundryRehearsals, FoundrySessions,
 * VoiceBench and VoiceTest. While `FVTT_DATA_DIR` is set but a folder has not been moved there
 * yet, the old `Documents\<name>` place still answers, so a half-done move breaks nothing.
 *
 * The recorder bot is deployed alone on the Pi, without the shared package, so it keeps an
 * identical copy of this file at packages/discord-bot/src/sessions-dir.ts. After an edit here,
 * copy the file over; a test in the bot fails while the two differ.
 *
 * It uses only `node:os`, `node:fs` and `node:path`: do not import it from the Foundry module (the
 * module runs in the browser).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * One data folder by name (for example `FoundrySessions`). Without `dataDir` it is
 * `<home>/Documents/<name>`. With it, `<dataDir>/<name>`, unless that is missing and the old
 * Documents folder exists (the folder has not been moved yet).
 */
export function dataFolder(
  name: string,
  dataDir: string | undefined = process.env.FVTT_DATA_DIR,
  home: string = homedir()
): string {
  const legacy = join(home, 'Documents', name);
  if (!dataDir) return legacy;
  const moved = join(dataDir, name);
  return existsSync(moved) || !existsSync(legacy) ? moved : legacy;
}

/** The default sessions folder when `FVTT_SESSIONS_DIR` is not set. */
export function defaultSessionsDir(
  home: string = homedir(),
  dataDir: string | undefined = process.env.FVTT_DATA_DIR
): string {
  return dataFolder('FoundrySessions', dataDir, home);
}

/** The sessions folder: `FVTT_SESSIONS_DIR` when it is set and not empty, else the default. */
export function sessionsDirFrom(
  value: string | undefined,
  home: string = homedir(),
  dataDir: string | undefined = process.env.FVTT_DATA_DIR
): string {
  return value ? value : defaultSessionsDir(home, dataDir);
}
