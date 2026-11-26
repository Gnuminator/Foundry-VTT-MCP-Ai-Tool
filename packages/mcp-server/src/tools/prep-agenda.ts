/**
 * The table agenda for `get-prep-digest`: open questions carried over from earlier sessions. The
 * voice pipeline (tools/session-notes agenda.py) keeps them in `table-agenda.json` in the sessions
 * folder. Only that one file is read, never a transcript. Settled and dropped items are counted.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { PREP_AGENDA_MAX_ITEMS, type PrepAgenda, type PrepAgendaItem } from '@gnuminator/shared';

const AGENDA_FILE = 'table-agenda.json';
const MAX_BYTES = 1024 * 1024;
const BOM = String.fromCharCode(0xfeff);

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Never throws. */
export async function readAgenda(sessionsDir: string): Promise<PrepAgenda> {
  const file = join(sessionsDir, AGENDA_FILE);
  let raw: string;
  try {
    if ((await stat(file)).size > MAX_BYTES) {
      return { status: 'unreachable', note: `The table agenda ${file} is too large to read.` };
    }
    raw = await readFile(file, 'utf-8');
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') {
      return {
        status: 'none',
        note: 'No table agenda yet: it is written when session notes are made for a session.',
      };
    }
    return { status: 'unreachable', note: `The table agenda ${file} could not be read.` };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);
  } catch {
    return { status: 'unreachable', note: `The table agenda ${file} is not valid JSON.` };
  }
  const rows = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(rows)) {
    return { status: 'unreachable', note: `The table agenda ${file} has no item list.` };
  }
  const open: PrepAgendaItem[] = [];
  let settled = 0;
  let dropped = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    if (!row || typeof row !== 'object') continue;
    if (row.status === 'settled') settled++;
    else if (row.status === 'dropped') dropped++;
    else if (row.status === 'open') {
      const text = str(row.en) || str(row.da);
      if (!text) continue;
      const time = str((row.source as { time?: unknown } | undefined)?.time);
      open.push({
        id: str(row.id),
        session: str(row.session),
        topic: row.topic === 'open' ? 'open' : 'proposed',
        text,
        ...(time ? { time } : {}),
      });
    }
  }
  const items = open.slice(0, PREP_AGENDA_MAX_ITEMS);
  return {
    status: 'found',
    items,
    omitted: open.length - items.length,
    settled,
    dropped,
    note:
      open.length === 0
        ? 'No open table questions.'
        : `${open.length} open table question(s) from earlier sessions: the "Settle at the start" list (settle or drop one with session-notes agenda).`,
  };
}
