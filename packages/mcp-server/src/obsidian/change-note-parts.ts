import type { Logger } from '../logger.js';
import type { AuditEntry } from '../vault/audit.js';
import { AUDIT_HISTORY_FILE } from '../vault/audit.js';
import type { VaultStore } from '../vault/store.js';
import { mergeChangeHistory, type ChangeEntry } from './audit-merge.js';
import { splitChangeNotes, type ChangeNotePart } from './render.js';

/** One month's Changes/ notes, for every month that has a change: `<month>`, `<month>-p2`, ... */
export function changeNoteParts(entries: readonly ChangeEntry[]): Map<string, ChangeNotePart[]> {
  const byMonth = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    const month = e.appliedAt.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(e);
    byMonth.set(month, list);
  }
  const parts = new Map<string, ChangeNotePart[]>();
  for (const [month, list] of byMonth) parts.set(month, splitChangeNotes(month, list));
  return parts;
}

/**
 * Which `AI Tool/Changes/` note (file name without `.md`) holds each change. The export writes
 * the notes from changeNoteParts and `notePart` of list-recent-changes uses this over the same
 * split, so the dashboard link opens the note the export wrote.
 */
export function changeNoteNames(parts: ReadonlyMap<string, ChangeNotePart[]>): Map<string, string> {
  const names = new Map<string, string>();
  for (const list of parts.values()) {
    for (const part of list) for (const e of part.entries) names.set(e.changeId, part.name);
  }
  return names;
}

/** gm-scope store file listing the Changes/ notes the last export wrote (read by list-recent-changes). */
export const CHANGE_NOTES_WRITTEN_FILE = 'changes-notes-written.json';

export interface ChangeNotesWritten {
  names: string[];
}

/** The notes the last export wrote; null until an export has recorded them (the flag is then left out). */
async function readWrittenChangeNotes(
  store: Pick<VaultStore, 'read'>,
  worldId: string
): Promise<ReadonlySet<string> | null> {
  const recorded = (await store.read<ChangeNotesWritten>(worldId, 'gm', CHANGE_NOTES_WRITTEN_FILE))
    ?.data;
  return Array.isArray(recorded?.names) ? new Set(recorded.names) : null;
}

/**
 * For list-recent-changes: change id to `{ notePart, notePartWritten? }`, from the same split over
 * the full history as the export. Best effort: an unreadable history gives no fields, so links
 * open the month note.
 */
export async function changeNoteLookup(
  store: Pick<VaultStore, 'read' | 'readLines'>,
  worldId: string,
  ring: AuditEntry[],
  logger: Pick<Logger, 'warn'>
): Promise<(changeId: string) => { notePart?: string; notePartWritten?: boolean }> {
  try {
    const written = await readWrittenChangeNotes(store, worldId);
    const jsonl = await store.readLines(worldId, 'gm', AUDIT_HISTORY_FILE);
    const names = changeNoteNames(changeNoteParts(mergeChangeHistory(ring, jsonl)));
    return changeId => {
      const notePart = names.get(changeId);
      if (!notePart) return {};
      return { notePart, ...(written ? { notePartWritten: written.has(notePart) } : {}) };
    };
  } catch (error) {
    logger.warn('Changes note parts unavailable; links open the month note', {
      error: error instanceof Error ? error.message : String(error),
    });
    return () => ({});
  }
}
