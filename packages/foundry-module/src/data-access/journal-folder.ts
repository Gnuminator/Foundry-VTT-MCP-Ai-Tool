/**
 * `ensureJournalFolder({name})` (recap lane, D-087): the top-level journal folder the bridge puts
 * session notes into, created when it is missing. The folder is outside the guarded change on
 * purpose: undoing one session's notes must never delete a folder that holds other sessions.
 * A write (write-gate.ts), GM-only. Folders have no ownership; the entries in it are GM-only.
 */
import { MODULE_ID } from '../constants.js';

const MAX_NAME = 100;

interface FolderLike {
  id: string;
  name: string;
  type: string;
  folder?: unknown;
}

export async function ensureJournalFolder(
  data: unknown
): Promise<{ folderId: string; created: boolean }> {
  const name = (data as { name?: unknown } | null | undefined)?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) {
    throw new Error('ensureJournalFolder needs a folder name');
  }
  const folders = (game.folders?.contents ?? []) as unknown as FolderLike[];
  const existing = folders.find(f => f.type === 'JournalEntry' && f.name === name && !f.folder);
  if (existing) return { folderId: existing.id, created: false };
  const created = (await Folder.create({
    name,
    type: 'JournalEntry',
    sorting: 'a',
    flags: { [MODULE_ID]: { sessionNotesFolder: true } },
  })) as unknown as FolderLike | undefined;
  // Read it back: Foundry can drop a write silently (P-064).
  if (!created?.id || !game.folders?.get(created.id)) {
    throw new Error(`Foundry did not create the journal folder "${name}"`);
  }
  return { folderId: created.id, created: true };
}
