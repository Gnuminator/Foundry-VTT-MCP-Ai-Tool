/**
 * Links from a play session's note (`AI Tool/Sessions/<label>.md`) to the recorded session's
 * notes in Foundry (recap lane, D-087): the bridge puts them into a GM-only journal flagged
 * `sessionNotes`, which the Foundry mirror renders with its page text. The mirror names notes by
 * the journal name, with a short suffix only on a name clash, so the few candidate paths are
 * checked by their `fvtt_uuid` property (a 4 KB head read each, no vault scan).
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { NOTES_FOLDER, type StoredNotes } from '../session-notes/types.js';
import type { VaultStore } from '../vault/store.js';
import { MIRROR_FOLDERS, pathKey } from './mirror-common.js';
import { allocateNotePaths, folderPath } from './mirror-paths.js';

const FILE_PREFIX = 'session-notes.';
const HEAD_BYTES = 4096;

export interface SessionNotesLink {
  date: string;
  title: string;
  journalName: string;
  /** Campaign-relative path of the mirrored journal note, or null when there is none yet. */
  notePath: string | null;
}

async function head(file: string): Promise<string | null> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * The folders a session-notes journal's mirror note may sit in: the Foundry folder it lives in
 * (I-100: the mirror follows Foundry's folder tree), then the flat journal folder of mirrors
 * from before that.
 */
const NOTE_FOLDERS = [folderPath(MIRROR_FOLDERS.journal, [NOTES_FOLDER]), MIRROR_FOLDERS.journal];

/** The mirrored note of a journal, among the paths the mirror would have picked for it. */
async function mirroredNote(root: string, uuid: string, name: string): Promise<string | null> {
  const id = uuid.split('.')[1] ?? uuid;
  for (const folder of NOTE_FOLDERS) {
    const request = { uuid, id, folder, name, created: null };
    const taken = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const candidate = allocateNotePaths([request], new Map(), taken).get(uuid);
      if (!candidate) break;
      const text = await head(path.join(root, candidate));
      if (text?.includes(`fvtt_uuid: ${JSON.stringify(uuid)}`)) return candidate;
      taken.add(pathKey(candidate));
    }
  }
  return null;
}

/** Every session whose notes are in Foundry, with its mirrored note when there is one. */
export async function loadSessionNotesLinks(
  store: VaultStore,
  worldId: string,
  root: string
): Promise<SessionNotesLink[]> {
  const files = (await store.list(worldId, 'gm')).filter(
    f => f.startsWith(FILE_PREFIX) && f.endsWith('.json')
  );
  const links: SessionNotesLink[] = [];
  for (const file of files) {
    let notes: StoredNotes | undefined;
    try {
      notes = (await store.read<StoredNotes>(worldId, 'gm', file))?.data;
    } catch {
      continue;
    }
    if (!notes?.put?.journalUuid) continue;
    const journalName = `${notes.date}: ${notes.title}`;
    links.push({
      date: notes.date,
      title: notes.title,
      journalName,
      notePath: await mirroredNote(root, notes.put.journalUuid, journalName),
    });
  }
  return links.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Markdown lines for a session note in `AI Tool/Sessions/` (links relative to that folder). */
export function sessionNotesLines(links: readonly SessionNotesLink[]): string[] {
  return links.map(link => {
    if (!link.notePath) {
      return `- ${link.title}: in Foundry, journal "${link.journalName}" (no mirror note yet)`;
    }
    const rel = path.posix
      .relative('AI Tool/Sessions', link.notePath)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    return `- [${link.title.replace(/[[\]]/g, '')}](${rel})`;
  });
}
