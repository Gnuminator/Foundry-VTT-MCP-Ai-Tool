import type { ChangeEntry } from './audit-merge.js';
import { splitChangeNotes } from './render.js';

/**
 * Which `AI Tool/Changes/` note (file name without `.md`) holds each change: `<month>` or
 * `<month>-p2`, ... when a month is split (see splitChangeNotes). The export and the
 * `notePart` of list-recent-changes both use it, so the dashboard link opens the note the export wrote.
 */
export function changeNoteNames(entries: readonly ChangeEntry[]): Map<string, string> {
  const byMonth = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    const month = e.appliedAt.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(e);
    byMonth.set(month, list);
  }
  const names = new Map<string, string>();
  for (const [month, list] of byMonth) {
    for (const part of splitChangeNotes(month, list)) {
      for (const e of part.entries) names.set(e.changeId, part.name);
    }
  }
  return names;
}
