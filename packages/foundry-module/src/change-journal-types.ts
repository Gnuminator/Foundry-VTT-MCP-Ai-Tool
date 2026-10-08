/**
 * The module's copy of the change journal wire contract (I-109). Mirrors
 * `shared/src/change-journal.ts`: the module does not import the shared
 * package (the browser cannot resolve it), so `change-journal.contract.test.ts`
 * compares every constant, the ignored-path rule and the types against the
 * shared file. Change both together, never one.
 */
import type { PathValue } from './data-access/guarded-write.js';

export const CHANGE_JOURNAL_VERSION = 1;

/** Records kept per GM browser (lost on reload; the backend stores what it pulled). */
export const CHANGE_JOURNAL_RING = 5000;

/** Most bytes (UTF-8 JSON) the ring keeps in all: the oldest records go first. */
export const CHANGE_JOURNAL_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** Most records one `getChangeJournal` call returns. */
export const CHANGE_JOURNAL_MAX_LIMIT = 500;

/** A record whose JSON (UTF-8 bytes) is larger than this keeps its metadata but drops its values. */
export const CHANGE_JOURNAL_MAX_RECORD_BYTES = 256 * 1024;

/** Two changes from this browser closer together than this share an `actionId`. */
export const CHANGE_JOURNAL_ACTION_GAP_MS = 300;

/** A new `actionId` once the current one is this old or holds this many operations (a stream). */
export const CHANGE_JOURNAL_ACTION_MAX_MS = 30_000;
export const CHANGE_JOURNAL_ACTION_MAX_OPS = 2000;

/** Document types the journal covers (hooks are registered for the names present in `CONFIG`). */
export const CHANGE_JOURNAL_DOCUMENTS = [
  'Actor',
  'Item',
  'ActiveEffect',
  'Token',
  'Scene',
  'Combat',
  'Combatant',
  'Wall',
  'AmbientLight',
  'AmbientSound',
  'Tile',
  'Drawing',
  'Note',
  'Region',
  'MeasuredTemplate',
  'JournalEntry',
  'JournalEntryPage',
] as const;

export type ChangeJournalDocument = (typeof CHANGE_JOURNAL_DOCUMENTS)[number];

/** Paths never recorded: equal to one of these or below it. */
export const CHANGE_JOURNAL_IGNORED_PATHS = [
  '_id',
  '_stats',
  'sort',
  '_movementHistory',
  'delta',
  'flags.core.sheetLock',
] as const;

export type ChangeOp = 'create' | 'update' | 'delete';

export type ChangeWriteMode = 'apply' | 'undo' | 'rollback';

/** The stash under `options["foundry-mcp-bridge"]` of a create, update or delete. */
export interface ChangeJournalOptions {
  journal?: {
    actionId: string;
    before?: Record<string, PathValue[]>;
  };
  changeId?: string;
  changeMode?: ChangeWriteMode;
}

export interface ChangeRecord {
  v: typeof CHANGE_JOURNAL_VERSION;
  key: string;
  seq: number;
  t: number;
  actionId: string;
  op: ChangeOp;
  userId: string | null;
  userName: string | null;
  userIsGM: boolean;
  documentName: string;
  uuid: string;
  parentUuid: string | null;
  name: string | null;
  rootUuid: string;
  rootName: string | null;
  sceneId: string | null;
  before?: PathValue[];
  after?: PathValue[];
  unknownBefore?: string[];
  data?: Record<string, unknown>;
  modifiedTime?: number | null;
  oversize?: boolean;
  changeId?: string;
  changeMode?: ChangeWriteMode;
}

/** Response of the module query `foundry-mcp-bridge.getChangeJournal`. */
export interface ChangeJournalResponse {
  success: boolean;
  error?: string;
  clientId: string;
  records: ChangeRecord[];
  oldestSeq: number;
  latestSeq: number;
}

/** True when `path` is one of CHANGE_JOURNAL_IGNORED_PATHS or below one. */
export function isIgnoredChangePath(path: string): boolean {
  return CHANGE_JOURNAL_IGNORED_PATHS.some(
    ignored => path === ignored || path.startsWith(`${ignored}.`)
  );
}
