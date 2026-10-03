/**
 * Session notes in Foundry (recap lane, D-087): the contract of the host-only control method
 * `session_notes` (vault `Design/Session notes into Foundry (recap lane).md`, Contract draft 3).
 */

export const SESSION_NOTES_FEATURE = 'session-notes';

export const PAGE_KEYS = ['recap', 'summary', 'scenes'] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** Page titles in Foundry, in this order. */
export const PAGE_TITLES: Record<PageKey, string> = {
  recap: 'Recap',
  summary: 'GM summary',
  scenes: 'Scenes',
};

/** The journal folder every session's entry goes into. */
export const NOTES_FOLDER = 'Session notes';

export type NotesStatus = 'staged' | 'in-foundry' | 'approved';

/** What keeps a staged item from going into Foundry by itself right now. */
export type WaitingFor = 'foundry' | 'writes-off' | 'feature-off';

export const ERROR_CODES = [
  'feature-off',
  'writes-off',
  'not-staged',
  'not-found',
  'conflict',
  'not-connected',
  'no-world',
  'bad-request',
] as const;
export type SessionNotesErrorCode = (typeof ERROR_CODES)[number];

/** A refusal with a stable `code` (sent as `{error: {message, code}}` on the control channel). */
export class SessionNotesError extends Error {
  constructor(
    readonly code: SessionNotesErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SessionNotesError';
  }
}

export interface NotesPage {
  key: PageKey;
  title: string;
  html: string;
}

/** Where a put landed (cleared again by its Undo). */
export interface PutRecord {
  changeId: string;
  putAt: string;
  journalUuid: string;
  recapPageUuid: string;
  /** Page uuid per key. */
  pageUuids: Partial<Record<PageKey, string>>;
  /** `_stats.modifiedTime` of every page right after the put (the Undo's edit check). */
  pageTimes: Record<string, number | null>;
  /** True when the bridge put it by itself (D-087). */
  auto: boolean;
}

/** One session, stored as `gm/session-notes.<sessionId>.json` in the world's bridge vault. */
export interface StoredNotes {
  sessionId: string;
  date: string;
  title: string;
  languages: string[];
  pages: NotesPage[];
  stagedAt: string;
  /** The bridge puts it into Foundry by itself; false after an Undo until a manual put. */
  autoPut: boolean;
  put?: PutRecord;
  approvedAt?: string;
  approvedBy?: string;
  lastError?: string;
}

/** The item every action returns (no page HTML except from `get`). */
export interface NotesItem {
  sessionId: string;
  date: string;
  title: string;
  status: NotesStatus;
  languages: string[];
  pages: Array<{ key: PageKey; title: string; html?: string }>;
  stagedAt: string;
  putAt?: string;
  changeId?: string;
  approvedAt?: string;
  approvedBy?: string;
  journalUuid?: string;
  recapPageUuid?: string;
  recapRevealed: boolean;
  autoPut: boolean;
  /** Empty when nothing blocks the next put (or it is already in Foundry). */
  waitingFor: WaitingFor[];
  lastError?: string;
}
