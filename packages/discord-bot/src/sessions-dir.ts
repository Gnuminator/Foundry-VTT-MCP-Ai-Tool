/**
 * Where the voice recordings and their notes live: `FVTT_SESSIONS_DIR`, else
 * `<home>/Documents/FoundrySessions`. One place for the dashboard's session notes route and the
 * recorder bot (scripts/voice-stack.ps1, tools/session-notes and the bot's `.env` file say the
 * same default in their own language).
 *
 * The recorder bot is deployed alone on the Pi, without the shared package, so it keeps an
 * identical copy of this file at packages/discord-bot/src/sessions-dir.ts. After an edit here,
 * copy the file over; a test in the bot fails while the two differ.
 *
 * It uses only `node:os` and `node:path`: do not import it from the Foundry module (the module
 * runs in the browser).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The default sessions folder when `FVTT_SESSIONS_DIR` is not set. */
export function defaultSessionsDir(home: string = homedir()): string {
  return join(home, 'Documents', 'FoundrySessions');
}

/** The sessions folder: `FVTT_SESSIONS_DIR` when it is set and not empty, else the default. */
export function sessionsDirFrom(value: string | undefined, home: string = homedir()): string {
  return value ? value : defaultSessionsDir(home);
}
