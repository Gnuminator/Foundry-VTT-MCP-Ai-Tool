import type { ChangeEntry } from './audit-merge.js';
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
