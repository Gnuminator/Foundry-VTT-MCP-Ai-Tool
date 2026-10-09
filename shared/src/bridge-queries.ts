/**
 * @module bridge-queries
 *
 * The typed contract for the bridge queries: the request the backend sends in an `mcp-query`
 * frame and the reply the Foundry module's handler returns, per wire method. Both sides import
 * it, so a reply shape that drifts on one side fails the typecheck on the other.
 *
 * The method names, request fields and reply fields are wire contracts (see protocol.ts): an old
 * module talks to a new backend and the other way round, so add fields as optional and never
 * rename one. This file only gives the existing wire values names; it changes nothing on the wire.
 *
 * Not every method is here yet (lint zero step 2): the queries the `src/tools/` tools send are
 * added after the G0 lanes merge. An unlisted method still works through the untyped overload of
 * `FoundryClient.query` and the module's untyped `bridgeHandlers.set`.
 */

import type { ChangeJournalResponse } from './change-journal.js';
import type { CharacterEntityResult } from './character-entity.js';
import type { CharacterSheetsResult } from './character-sheet.js';
import { MODULE_ID } from './constants.js';
import type { ExportIndexRequest, ExportIndexResponse } from './export-index.js';
import type {
  GuardedApplyOutcome,
  GuardedApplyRequest,
  GuardedApplyResult,
  GuardedFeatureState,
  GuardedOp,
  OpSnapshot,
} from './guarded-write.js';
import type {
  LibraryDocumentsRequest,
  LibraryDocumentsResponse,
  LibraryIndexRequest,
  LibraryIndexResponse,
} from './library-index.js';
import type { PlayRecordsResponse } from './play-log.js';
import type { PageForPlayers } from './player-view.js';
import type { UsageRecordsResponse } from './usage.js';

/** Prefix of every bridge query method on the wire. */
export const BRIDGE_QUERY_PREFIX = `${MODULE_ID}.` as const;

/**
 * A refusal the module sends as the handler's reply (inside a successful `mcp-response`): the
 * GM gate (`Access denied` when the module runs on a client that is not the GM's) and handlers
 * that refuse without throwing. A thrown handler error arrives as a rejected query instead.
 */
export interface BridgeRefusal {
  success: false;
  error: string;
}

/** Whether a bridge reply is a {@link BridgeRefusal}. */
export function isBridgeRefusal(reply: unknown): reply is BridgeRefusal {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { success?: unknown }).success === false
  );
}

/**
 * The reply without the refusal: throws `<what>: <the module's error>` on a refusal. Replaces
 * the per-service `unwrap` helpers.
 */
export function unwrapBridgeReply<T>(reply: T | BridgeRefusal, what: string): T {
  if (isBridgeRefusal(reply)) {
    const error = (reply as { error?: unknown }).error;
    throw new Error(`${what}: ${typeof error === 'string' ? error : 'refused by Foundry'}`);
  }
  return reply;
}

/** Reply of `ping`. */
export interface BridgePingReply {
  status: string;
  timestamp: number;
  module: string;
  foundryVersion?: string;
  worldId?: string;
  userId?: string;
}

/** Request of the sequence-paged buffers (`getChangeJournal`, `getPlayRecords`, `getUsageRecords`). */
export interface BridgeSeqPageRequest {
  /** Records with a sequence number above this one. */
  sinceSeq?: number;
  limit?: number;
}

/** Request of `logGmChange`: one line in the GM's feed for a recorded apply or undo. */
export interface LogGmChangeRequest {
  changeId: string;
  feature: string;
  summary: string;
  mode: string;
}

/** Request of `showJournalPage` (I-110). */
export interface ShowJournalPageRequest {
  uuid: string;
  userIds: string[];
}

/** Reply of `showJournalPage`. */
export interface ShowJournalPageReply {
  shown: true;
  uuid: string;
  users: string[];
}

/** Reply of `ensureJournalFolder`. */
export interface EnsureJournalFolderReply {
  folderId: string;
  created: boolean;
}

/**
 * The typed bridge queries: wire method to request and reply. The reply is what the handler
 * returns when it does not refuse; every method may also answer with a {@link BridgeRefusal}.
 */
export interface BridgeQueryMap {
  'foundry-mcp-bridge.ping': { request: undefined; reply: BridgePingReply };
  'foundry-mcp-bridge.getChangeJournal': {
    request: BridgeSeqPageRequest;
    reply: ChangeJournalResponse;
  };
  'foundry-mcp-bridge.getPlayRecords': {
    request: BridgeSeqPageRequest;
    reply: PlayRecordsResponse;
  };
  'foundry-mcp-bridge.getUsageRecords': {
    request: BridgeSeqPageRequest;
    reply: UsageRecordsResponse;
  };
  'foundry-mcp-bridge.snapshotGuardedOps': { request: { ops: GuardedOp[] }; reply: OpSnapshot[] };
  'foundry-mcp-bridge.applyGuardedOps': { request: GuardedApplyRequest; reply: GuardedApplyResult };
  'foundry-mcp-bridge.guardedApplyOutcome': {
    request: { changeId: string };
    reply: GuardedApplyOutcome;
  };
  'foundry-mcp-bridge.logGmChange': { request: LogGmChangeRequest; reply: { logged: true } };
  'foundry-mcp-bridge.showJournalPage': {
    request: ShowJournalPageRequest;
    reply: ShowJournalPageReply;
  };
  'foundry-mcp-bridge.listGuardedFeatures': { request: undefined; reply: GuardedFeatureState[] };
  'foundry-mcp-bridge.ensureJournalFolder': {
    request: { name: string };
    reply: EnsureJournalFolderReply;
  };
  'foundry-mcp-bridge.aiChangesUpdated': { request: undefined; reply: { announced: true } };
  'foundry-mcp-bridge.getPagesForPlayers': {
    request: { uuids: string[] };
    reply: { pages: PageForPlayers[] };
  };
  'foundry-mcp-bridge.getExportIndex': { request: ExportIndexRequest; reply: ExportIndexResponse };
  'foundry-mcp-bridge.getLibraryIndex': {
    request: LibraryIndexRequest;
    reply: LibraryIndexResponse;
  };
  'foundry-mcp-bridge.getLibraryDocuments': {
    request: LibraryDocumentsRequest;
    reply: LibraryDocumentsResponse;
  };
  'foundry-mcp-bridge.characterSheet': {
    request: { userId: string };
    reply: CharacterSheetsResult;
  };
  'foundry-mcp-bridge.getCharacterEntity': {
    request: { characterIdentifier: string; entityIdentifier: string };
    reply: CharacterEntityResult;
  };
}

/** A bridge method the contract types. */
export type BridgeMethod = keyof BridgeQueryMap;

/** What the backend sends for `M` (`undefined` when the method takes nothing). */
export type BridgeRequest<M extends BridgeMethod> = BridgeQueryMap[M]['request'];

/** What the module's handler for `M` returns when it does not refuse. */
export type BridgeReply<M extends BridgeMethod> = BridgeQueryMap[M]['reply'];

/** What arrives at the backend for `M`: the reply or a refusal. */
export type BridgeAnswer<M extends BridgeMethod> = BridgeReply<M> | BridgeRefusal;

/** Per-query options the backend's connector understands. */
export interface BridgeQueryOptions {
  /** Overrides the connector's default query timeout. */
  timeoutMs?: number;
}

/** The arguments after the method: the request (optional when it may be undefined), then options. */
export type BridgeQueryArgs<M extends BridgeMethod> =
  undefined extends BridgeRequest<M>
    ? [data?: BridgeRequest<M>, options?: BridgeQueryOptions]
    : [data: BridgeRequest<M>, options?: BridgeQueryOptions];

/** A method string that the contract does not type (yet); `never` for a typed one. */
export type UntypedBridgeMethod<M extends string> = M &
  ([M] extends [BridgeMethod] ? never : unknown);

/**
 * Anything that can send typed bridge queries: the backend's `FoundryClient`, and the narrow
 * dependency the services take (so tests can pass a stub).
 */
export interface BridgeQuerier {
  query<M extends BridgeMethod>(method: M, ...args: BridgeQueryArgs<M>): Promise<BridgeAnswer<M>>;
}
