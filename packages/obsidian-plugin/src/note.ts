/**
 * What the plugin reads from a note: the Obsidian mirror's frontmatter (O4,
 * `packages/mcp-server/src/obsidian/mirror-render.ts`): `fvtt_uuid`, `fvtt_type`, `fvtt_world`,
 * `name`. A note the GM wrote by hand works too when it has a `fvtt_uuid` line. No `obsidian`
 * import, so this runs in node tests.
 */
import type { RevealState } from './dashboard.js';

/** A Foundry document type as the mirror writes it (`fvtt_type`): Actor, Scene, JournalEntry, JournalEntryPage, Item. */
export type FoundryDocType = string;

export interface FoundryNote {
  uuid: string;
  type: FoundryDocType;
  world: string | null;
  name: string | null;
}

/** A Foundry uuid as the /open route accepts it (O4 design: letters, digits, dots). */
const UUID =
  /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9]{1,64}(\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9]{1,64})*$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The Foundry document a note points at, from its frontmatter; null when it has none. */
export function foundryNoteFrom(frontmatter: unknown): FoundryNote | null {
  if (frontmatter === null || typeof frontmatter !== 'object') return null;
  const fm = frontmatter as Record<string, unknown>;
  const uuid = str(fm.fvtt_uuid);
  if (!uuid || !UUID.test(uuid)) return null;
  const type = str(fm.fvtt_type) ?? uuid.split('.').at(-2) ?? uuid.split('.')[0] ?? '';
  return { uuid, type, world: str(fm.fvtt_world), name: str(fm.name) };
}

export function isJournalPage(note: FoundryNote): boolean {
  return note.type === 'JournalEntryPage';
}

const TYPE_LABELS: Record<string, string> = {
  Actor: 'actor',
  Scene: 'scene',
  JournalEntry: 'journal',
  JournalEntryPage: 'journal page',
  Item: 'item',
};

export type RevealStatus =
  | { kind: 'revealed'; asCopy: boolean; observable: boolean; seen: number; forSome: boolean }
  | { kind: 'queued' }
  | { kind: 'hidden' };

/** Where a journal page stands for players: revealed (as itself or a copy), queued, or hidden. */
export function revealStatus(note: FoundryNote, state: RevealState): RevealStatus {
  const page = state.pages.find(p => p.uuid === note.uuid || p.copiedFrom === note.uuid);
  if (page) {
    return {
      kind: 'revealed',
      asCopy: page.copiedFrom === note.uuid,
      observable: page.observable,
      seen: page.seenBy?.length ?? 0,
      forSome: Array.isArray(page.players) && page.players.length > 0,
    };
  }
  if (state.queue.some(q => q.uuid === note.uuid)) return { kind: 'queued' };
  return { kind: 'hidden' };
}

/** The status bar text for a note (`null` state: the dashboard did not answer). */
export function statusText(note: FoundryNote, status: RevealStatus | null | 'offline'): string {
  if (!isJournalPage(note) || status === null) {
    return `Foundry: ${TYPE_LABELS[note.type] ?? note.type.toLowerCase()}`;
  }
  if (status === 'offline') return 'Players: unknown (dashboard offline)';
  switch (status.kind) {
    case 'queued':
      return 'Players: queued for reveal';
    case 'hidden':
      return 'Players: not revealed';
    case 'revealed': {
      const parts = [status.asCopy ? 'revealed as a copy' : 'revealed'];
      if (status.forSome) parts.push('to some players');
      if (!status.observable) parts.push('but they cannot open it');
      if (status.seen > 0) parts.push(`seen by ${status.seen}`);
      return `Players: ${parts.join(', ')}`;
    }
  }
}
