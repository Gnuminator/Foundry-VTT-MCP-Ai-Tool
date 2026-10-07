/**
 * @module change-journal
 *
 * Wire types of the change journal (I-109, undo for everything in Foundry):
 * every create, update and delete of a covered document, by anyone (players,
 * the GM, the AI), with the values before and after, so the backend can undo
 * human changes the same way it undoes guarded AI changes.
 *
 * How a record is made:
 *   1. The browser that makes a change (any user) runs `preCreate*`,
 *      `preUpdate*` and `preDelete*` hooks that write a
 *      {@link ChangeJournalOptions} stash into the operation options under
 *      the module id. Foundry carries custom options to every client (dnd5e
 *      relies on the same thing for `options.dnd5e.hp`).
 *   2. Every GM browser builds a {@link ChangeRecord} in the `create*`,
 *      `update*` and `delete*` hooks from the document, Foundry's `userId`
 *      argument and the stash, and keeps the newest
 *      {@link CHANGE_JOURNAL_RING} records in memory.
 *   3. The backend pulls them with the GM-gated read query
 *      `foundry-mcp-bridge.getChangeJournal({sinceSeq, limit})` ->
 *      {@link ChangeJournalResponse}, the same cursor pattern as
 *      `getPlayRecords`. Several GM browsers report the same change with the
 *      same `key`, so the backend dedupes by key.
 *
 * The module keeps its own copy of these types and constants in
 * `packages/foundry-module/src/change-journal-types.ts` (it does not import
 * this package); `change-journal.contract.test.ts` compares the two.
 */

import type { PathValue } from './guarded-write.js';

export const CHANGE_JOURNAL_VERSION = 1;

/** Records kept per GM browser (lost on reload; the backend stores what it pulled). */
export const CHANGE_JOURNAL_RING = 5000;

/** Most records one `getChangeJournal` call returns. */
export const CHANGE_JOURNAL_MAX_LIMIT = 500;

/**
 * A record whose JSON is larger than this keeps its metadata but drops
 * `before`, `after` and `data` and sets `oversize` (shown, not undoable).
 */
export const CHANGE_JOURNAL_MAX_RECORD_BYTES = 256 * 1024;

/**
 * Two changes from the same browser less than this far apart share an
 * `actionId` (a long rest writes the actor and every item; deleting a token
 * also deletes its combatant). Measured from the previous change.
 */
export const CHANGE_JOURNAL_ACTION_GAP_MS = 300;

/**
 * Document types the journal covers. The module registers hooks only for the
 * names that exist in `CONFIG` on the running core. Never covered: ChatMessage
 * (rolls are not un-rolled; their effects are), User, Setting, Folder, Macro,
 * Playlist, RollTable, Cards, ActorDelta (a synthetic actor's change is
 * recorded on the synthetic Actor itself).
 */
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

/**
 * Paths never recorded: a path equal to one of these or below it
 * (`_stats` covers `_stats.modifiedTime`). An update that touches only ignored
 * paths makes no record. `delta` is a Token's synthetic-actor data, recorded
 * on the synthetic Actor instead.
 */
export const CHANGE_JOURNAL_IGNORED_PATHS = [
  '_id',
  '_stats',
  'sort',
  '_movementHistory',
  'delta',
  'flags.core.sheetLock',
] as const;

export type ChangeOp = 'create' | 'update' | 'delete';

/**
 * Why a guarded write made a change: `apply` and `undo` match the audit
 * entry's mode; `rollback` is a failed apply putting things back (the backend
 * hides both the failed ops and their rollback).
 */
export type ChangeWriteMode = 'apply' | 'undo' | 'rollback';

/**
 * The stash under `options["foundry-mcp-bridge"]` of a create, update or
 * delete. One operation can carry many documents (`updateEmbeddedDocuments`),
 * so per-document data is keyed by document id. Other keys under the module id
 * are left as they are.
 */
export interface ChangeJournalOptions {
  journal?: {
    /** Set by the browser that makes the change (see CHANGE_JOURNAL_ACTION_GAP_MS). */
    actionId: string;
    /**
     * update only: the values before, by document id, for every recorded path
     * in the change (leaf paths of the flattened change; arrays are whole
     * values; with `recursive: false` or a forced replacement, the whole
     * top-level key).
     */
    before?: Record<string, PathValue[]>;
  };
  /** Set by the module's guarded-write executor: the AI change (audit changeId) that made it. */
  changeId?: string;
  changeMode?: ChangeWriteMode;
}

export interface ChangeRecord {
  v: typeof CHANGE_JOURNAL_VERSION;
  /**
   * The same in every GM browser: `<op>:<uuid>:<time>`, where time is the
   * operation's server time (`options.modifiedTime`) for an update or a
   * delete, else the document's `_stats.modifiedTime`, and `_stats.createdTime`
   * for a create (server times, so every client agrees; a synthetic actor's
   * delta has no `_stats` of its own).
   */
  key: string;
  /** Per browser, from 1; restarts with a new `clientId`. */
  seq: number;
  /** Epoch ms: the server time used in `key`, else this browser's clock. */
  t: number;
  /**
   * The stash's actionId, or `solo:<key>` when the change came without a
   * stash (an older module in that browser).
   */
  actionId: string;
  op: ChangeOp;
  /** The user whose browser made the change (Foundry's `userId` hook argument). */
  userId: string | null;
  userName: string | null;
  userIsGM: boolean;
  documentName: string;
  uuid: string;
  parentUuid: string | null;
  name: string | null;
  /**
   * The "thing" undo groups by (I-109 "Everything since"): walk up the
   * parents and stop below a Scene or at the top. So an Item or effect on a
   * world actor gives the Actor; anything on a synthetic (unlinked) actor
   * gives its Token; a Combatant gives the Combat; a Token or placeable gives
   * itself; a page gives its JournalEntry.
   */
  rootUuid: string;
  rootName: string | null;
  sceneId: string | null;
  /** update: values before (from the stash) and after (read from the document). */
  before?: PathValue[];
  after?: PathValue[];
  /** update: changed paths with no before value in the stash (cannot be undone). */
  unknownBefore?: string[];
  /** delete: the full source before deletion (for re-creating it with its id). */
  data?: Record<string, unknown>;
  /** create and update: `_stats.modifiedTime` after the change (undo conflict check). */
  modifiedTime?: number | null;
  /** The record was larger than CHANGE_JOURNAL_MAX_RECORD_BYTES; values were dropped. */
  oversize?: boolean;
  /** A guarded write made it (see ChangeJournalOptions.changeId). */
  changeId?: string;
  changeMode?: ChangeWriteMode;
}

/** Response of the module query `foundry-mcp-bridge.getChangeJournal`. */
export interface ChangeJournalResponse {
  success: boolean;
  error?: string;
  /** Random per page load; a new id means the sequence restarted. */
  clientId: string;
  /** Records with `seq > sinceSeq`, oldest first, at most `limit`. */
  records: ChangeRecord[];
  /** Oldest and newest sequence numbers still in the buffer (0 when empty). */
  oldestSeq: number;
  latestSeq: number;
}

/** True when `path` is one of CHANGE_JOURNAL_IGNORED_PATHS or below one. */
export function isIgnoredChangePath(path: string): boolean {
  return CHANGE_JOURNAL_IGNORED_PATHS.some(
    ignored => path === ignored || path.startsWith(`${ignored}.`)
  );
}
